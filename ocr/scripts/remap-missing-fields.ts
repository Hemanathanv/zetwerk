/**
 * Remap / gap pass: load frozen catalog from schema-discovery .xlsx (Section + FieldName + …),
 * then for each PDF in Input/<Category>/ ask the model for fields NOT in that catalog.
 *
 * Usage:
 *   npx tsx scripts/remap-missing-fields.ts "Shipping Bill"
 *   npx tsx scripts/remap-missing-fields.ts --xlsx "output/schema-discovery/Shipping Bill.xlsx" --category "Shipping Bill"
 *
 * Outputs (next to the source xlsx directory):
 *   <Category>.remap.json
 *   <Category>.remap-novel.xlsx  (sheet: Novel fields; optional sheet: Aliases)
 *
 * Env: see `.env.example` — OpenRouter via `src/config/openrouter-env.ts`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import * as XLSX from "xlsx";
import {
  getOpenRouterApiKey,
  getOpenRouterChatCompletionsUrl,
  getOpenRouterFlashPdfOptions,
} from "../src/config/openrouter-env.js";
import { buildRemapMissingFieldsPrompt } from "../src/prompts/remap-missing-fields-prompt.js";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const EXPORT_CATEGORIES = [
  "BOE",
  "BOL",
  "CHA Bills",
  "DDS",
  "Bill of Lading",
  "Freight Forwarder Bill",
  "Ocean Freight",
  "Packing List",
  "Sales Invoices",
  "Shipping Bill",
  "SSD_Metal Content",
] as const;

type ExportCategory = (typeof EXPORT_CATEGORIES)[number];

interface CatalogRow {
  section: string;
  fieldName: string;
  fieldType: string;
  required: boolean;
  description: string;
  exampleValue?: string;
}

interface NovelField {
  section: string;
  fieldName: string;
  fieldType: string;
  description: string;
  exampleValue?: string;
  confidence: number;
  page?: number;
}

interface AliasRow {
  catalogKey: string;
  seenAsOnDocument: string;
  page?: number;
}

interface RemapResponse {
  documentCategory?: string;
  aliasesOrNearDuplicates?: AliasRow[];
  novelFields?: NovelField[];
  auditNotes?: string;
}

interface MergedNovel extends NovelField {
  seenInFiles: string[];
}

interface MergedAlias extends AliasRow {
  seenInFiles: string[];
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

async function listPdfFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.isFile() && isPdf(e.name)) files.push(path.join(dir, e.name));
  }
  return files.sort();
}

function toDataUrlPdf(base64: string): string {
  return `data:application/pdf;base64,${base64}`;
}

function extractJsonObject(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function novelMergeKey(f: NovelField): string {
  return `${f.section.trim().toLowerCase()}::${f.fieldName.trim().toLowerCase()}`;
}

function aliasMergeKey(a: AliasRow): string {
  return `${a.catalogKey.trim().toLowerCase()}::${a.seenAsOnDocument.trim().toLowerCase()}`;
}

async function loadCatalogFromXlsx(xlsxPath: string): Promise<CatalogRow[]> {
  const buf = await fs.readFile(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`No sheets in ${xlsxPath}`);
  const sheet = wb.Sheets[sheetName]!;
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const rows: CatalogRow[] = [];
  for (const row of raw) {
    const section = String(row.Section ?? row.section ?? "").trim();
    const fieldName = String(row.FieldName ?? row.fieldName ?? "").trim();
    if (!fieldName && !section) continue;
    const req = row.Required;
    const required = req === "Yes" || req === true || req === "TRUE";
    rows.push({
      section,
      fieldName,
      fieldType: String(row.FieldType ?? row.fieldType ?? "string").trim() || "string",
      required,
      description: String(row.Description ?? row.description ?? "").trim(),
      exampleValue: (() => {
        const ex = row.ExampleValue ?? row.exampleValue;
        if (ex === undefined || ex === null || ex === "") return undefined;
        return String(ex);
      })(),
    });
  }
  return rows;
}

function catalogToMarkdown(rows: CatalogRow[]): string {
  const lines: string[] = [];
  lines.push("| # | Section | Field name | Type | Required | Description |");
  lines.push("|---|---------|------------|------|----------|-------------|");
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${escapeMdCell(r.section)} | ${escapeMdCell(r.fieldName)} | ${escapeMdCell(r.fieldType)} | ${r.required ? "Yes" : "No"} | ${escapeMdCell(r.description)} |`,
    );
  });
  return lines.join("\n");
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function callOpenRouterPdf(args: {
  apiKey: string;
  model: string;
  prompt: string;
  pdfPath: string;
  pdfEngine: string;
  temperature: number;
  maxTokens: number;
}): Promise<{ content: string; usage?: Record<string, number> }> {
  const buf = await fs.readFile(args.pdfPath);
  const base64 = buf.toString("base64");
  const fileData = toDataUrlPdf(base64);
  const fileName = path.basename(args.pdfPath);

  const body = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text", text: args.prompt },
          {
            type: "file",
            file: {
              filename: fileName,
              file_data: fileData,
            },
          },
        ],
      },
    ],
    plugins: [
      {
        id: "file-parser",
        pdf: { engine: args.pdfEngine },
      },
    ],
  };

  const res = await fetch(getOpenRouterChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)}`);
  }

  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected response: ${JSON.stringify(data).slice(0, 400)}`);
  }

  const usage = data.usage as Record<string, number> | undefined;
  return { content, usage };
}

function excelSheetName(name: string, max = 31): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, max);
  return cleaned.length > 0 ? cleaned : "Sheet1";
}

function writeRemapExcel(
  filePath: string,
  novel: MergedNovel[],
  aliases: MergedAlias[],
): void {
  const wb = XLSX.utils.book_new();

  const novelRows = novel.map((f, i) => ({
    Index: i + 1,
    Section: f.section,
    FieldName: f.fieldName,
    FieldType: f.fieldType,
    Description: f.description,
    ExampleValue: f.exampleValue ?? "",
    Confidence: f.confidence,
    Page: f.page ?? "",
    SeenInFiles: f.seenInFiles.join("; "),
  }));
  const ws1 = XLSX.utils.json_to_sheet(novelRows);
  ws1["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 36 },
    { wch: 14 },
    { wch: 50 },
    { wch: 28 },
    { wch: 10 },
    { wch: 6 },
    { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, excelSheetName("Novel fields"));

  const aliasRows = aliases.map((a, i) => ({
    Index: i + 1,
    CatalogKey: a.catalogKey,
    SeenAsOnDocument: a.seenAsOnDocument,
    Page: a.page ?? "",
    SeenInFiles: a.seenInFiles.join("; "),
  }));
  const ws2 = XLSX.utils.json_to_sheet(aliasRows);
  ws2["!cols"] = [{ wch: 6 }, { wch: 40 }, { wch: 40 }, { wch: 8 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, excelSheetName("Aliases near dupes"));

  XLSX.writeFile(wb, filePath);
}

function isExportCategory(name: string): name is ExportCategory {
  return (EXPORT_CATEGORIES as readonly string[]).includes(name);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let category: string | null = null;
  let xlsxPath: string | null = null;
  let inputRoot = path.resolve(process.cwd(), "Input");
  let catalogDir = path.resolve(process.cwd(), "output", "schema-discovery");

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--xlsx" && argv[i + 1]) xlsxPath = path.resolve(argv[++i]!);
    else if (a === "--category" && argv[i + 1]) category = argv[++i]!;
    else if (a === "--input" && argv[i + 1]) inputRoot = path.resolve(argv[++i]!);
    else if (a === "--catalog-dir" && argv[i + 1])
      catalogDir = path.resolve(argv[++i]!);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  npx tsx scripts/remap-missing-fields.ts "Shipping Bill"
  npx tsx scripts/remap-missing-fields.ts --xlsx "./output/schema-discovery/Shipping Bill.xlsx" --category "Shipping Bill"

Requires OPENROUTER_API_KEY; catalog .xlsx from discover-schema.`);
      process.exit(0);
    }
  }

  if (!category && argv.length === 1 && !argv[0]!.startsWith("-")) {
    category = argv[0]!;
  }

  if (!category || !isExportCategory(category)) {
    console.error(
      `Pass a valid category (one of: ${EXPORT_CATEGORIES.join(", ")})`,
    );
    process.exit(1);
  }

  if (!xlsxPath) {
    xlsxPath = path.join(catalogDir, `${category}.xlsx`);
  }

  return { category: category as ExportCategory, xlsxPath, inputRoot, catalogDir };
}

async function main() {
  const { category, xlsxPath, inputRoot, catalogDir } = parseArgs();
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY in .env.local (or .env)");
    process.exit(1);
  }

  const or = getOpenRouterFlashPdfOptions();
  const { model, pdfEngine, temperature, maxTokens } = or;

  try {
    await fs.access(xlsxPath);
  } catch {
    console.error(`Catalog xlsx not found: ${xlsxPath}`);
    process.exit(1);
  }

  const catalogRows = await loadCatalogFromXlsx(xlsxPath);
  if (catalogRows.length === 0) {
    console.error("Catalog xlsx has no rows.");
    process.exit(1);
  }

  const catalogMarkdown = catalogToMarkdown(catalogRows);
  const promptBase = buildRemapMissingFieldsPrompt({
    documentCategory: category,
    catalogMarkdown,
  });

  const pdfDir = path.join(inputRoot, category);
  const pdfs = await listPdfFiles(pdfDir).catch(() => []);
  if (pdfs.length === 0) {
    console.error(`No PDFs in ${pdfDir}`);
    process.exit(1);
  }

  const mergedNovel = new Map<string, MergedNovel>();
  const mergedAlias = new Map<string, MergedAlias>();
  const perFile: Array<{
    fileName: string;
    ok: boolean;
    error?: string;
    novelCount?: number;
    aliasCount?: number;
    auditNotes?: string;
    rawPreview?: string;
  }> = [];

  console.log(`Catalog: ${xlsxPath} (${catalogRows.length} rows)`);
  console.log(`PDFs: ${pdfs.length} in ${pdfDir}`);
  console.log(`Model: ${model}`);
  console.log(`PDF engine: ${pdfEngine}`);
  console.log(`temperature: ${temperature}`);
  console.log(`max_tokens: ${maxTokens}\n`);

  for (const pdfPath of pdfs) {
    const fileName = path.basename(pdfPath);
    try {
      const { content } = await callOpenRouterPdf({
        apiKey,
        model,
        prompt: promptBase,
        pdfPath,
        pdfEngine,
        temperature,
        maxTokens,
      });
      const parsed = JSON.parse(extractJsonObject(content)) as RemapResponse;
      const novel = parsed.novelFields ?? [];
      const aliases = parsed.aliasesOrNearDuplicates ?? [];

      for (const f of novel) {
        const key = novelMergeKey(f);
        const ex = mergedNovel.get(key);
        if (!ex) {
          mergedNovel.set(key, { ...f, seenInFiles: [fileName] });
        } else {
          ex.seenInFiles.push(fileName);
          if (
            f.description &&
            f.description.length > (ex.description?.length ?? 0)
          ) {
            ex.description = f.description;
          }
          if (!ex.exampleValue && f.exampleValue) ex.exampleValue = f.exampleValue;
        }
      }

      for (const a of aliases) {
        const key = aliasMergeKey(a);
        const ex = mergedAlias.get(key);
        if (!ex) {
          mergedAlias.set(key, { ...a, seenInFiles: [fileName] });
        } else {
          ex.seenInFiles.push(fileName);
        }
      }

      perFile.push({
        fileName,
        ok: true,
        novelCount: novel.length,
        aliasCount: aliases.length,
        auditNotes: parsed.auditNotes,
        rawPreview:
          content.length > 4000 ? content.slice(0, 4000) + "…" : content,
      });
      console.log(
        `  OK ${fileName} → novel: ${novel.length}, aliases: ${aliases.length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  FAIL ${fileName}: ${msg}`);
      perFile.push({ fileName, ok: false, error: msg });
    }
  }

  const novelList = [...mergedNovel.values()].sort((a, b) =>
    novelMergeKey(a).localeCompare(novelMergeKey(b)),
  );
  const aliasList = [...mergedAlias.values()].sort((a, b) =>
    aliasMergeKey(a).localeCompare(aliasMergeKey(b)),
  );

  const baseName = `${category.replace(/[/\\]/g, "_")}.remap`;
  const jsonPath = path.join(catalogDir, `${baseName}.json`);
  const xlsxOut = path.join(catalogDir, `${baseName}-novel.xlsx`);

  const payload = {
    documentCategory: category,
    source: "Gemini",
    modelUsed: model,
    catalogXlsx: path.relative(process.cwd(), xlsxPath),
    catalogRowCount: catalogRows.length,
    mergedNovelFieldCount: novelList.length,
    mergedAliasCount: aliasList.length,
    mergedNovelFields: novelList,
    mergedAliasesOrNearDuplicates: aliasList,
    perFile,
  };

  await fs.mkdir(catalogDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeRemapExcel(xlsxOut, novelList, aliasList);

  console.log(`\nWrote ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), xlsxOut)}`);
  console.log(
    `\nNext: merge catalog + remap with Pro → npx tsx scripts/finalize-schema-pro.ts "${category}"`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
