/**
 * After discover-schema + remap-missing-fields: one Pro (text) pass to merge
 * original catalog + novel fields + aliases into a single final schema (JSON + XLSX).
 *
 * Usage:
 *   npx tsx scripts/finalize-schema-pro.ts "Sales Invoices"
 *   npx tsx scripts/finalize-schema-pro.ts --category "Sales Invoices" --catalog-xlsx "output/schema-discovery/Sales Invoices.xlsx" --remap-json "output/schema-discovery/Sales Invoices.remap.json"
 *
 * Outputs (same folder as catalog by default):
 *   <Category>.final-schema.json
 *   <Category>.final-schema.xlsx
 *
 * Env: OPENROUTER_* via src/config/openrouter-env.ts (uses Pro model + max tokens).
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import * as XLSX from "xlsx";
import {
  getOpenRouterApiKey,
  getOpenRouterChatCompletionsUrl,
  getOpenRouterProPdfOptions,
} from "../src/config/openrouter-env.js";
import { buildFinalizeSchemaAfterRemapPrompt } from "../src/prompts/finalize-schema-after-remap-prompt.js";

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
  confidence?: number;
  seenInFiles?: string[];
}

interface MergedAlias {
  catalogKey: string;
  seenAsOnDocument: string;
  page?: number;
  seenInFiles?: string[];
}

interface RemapJson {
  mergedNovelFields?: NovelField[];
  mergedAliasesOrNearDuplicates?: MergedAlias[];
}

interface FinalFieldRow {
  section: string;
  fieldName: string;
  fieldType: string;
  description: string;
  required: boolean;
  exampleValue?: string;
  provenance: string;
  alternateLabels?: string[];
  notes?: string;
}

interface FinalSchemaPayload {
  documentCategory: string;
  source?: string;
  modelUsed?: string;
  summary?: string;
  statistics?: Record<string, number>;
  fields: FinalFieldRow[];
}

function isExportCategory(s: string): s is ExportCategory {
  return (EXPORT_CATEGORIES as readonly string[]).includes(s);
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
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
  const lines: string[] = [
    "| # | Section | Field name | Type | Required | Description |",
    "|---|---------|------------|------|----------|-------------|",
  ];
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${escapeMdCell(r.section)} | ${escapeMdCell(r.fieldName)} | ${escapeMdCell(r.fieldType)} | ${r.required ? "Yes" : "No"} | ${escapeMdCell(r.description)} |`,
    );
  });
  return lines.join("\n");
}

function novelToMarkdown(rows: NovelField[]): string {
  const lines: string[] = [
    "| # | Section | Field name | Type | Description | Seen in files |",
    "|---|---------|------------|------|-------------|---------------|",
  ];
  rows.forEach((r, i) => {
    const files = (r.seenInFiles ?? []).join("; ");
    lines.push(
      `| ${i + 1} | ${escapeMdCell(r.section)} | ${escapeMdCell(r.fieldName)} | ${escapeMdCell(r.fieldType)} | ${escapeMdCell(r.description)} | ${escapeMdCell(files)} |`,
    );
  });
  return lines.join("\n");
}

function aliasesToMarkdown(rows: MergedAlias[]): string {
  const lines: string[] = [
    "| # | catalogKey (Section :: FieldName) | seenAsOnDocument | Seen in files |",
    "|---|-----------------------------------|------------------|---------------|",
  ];
  rows.forEach((r, i) => {
    const files = (r.seenInFiles ?? []).join("; ");
    lines.push(
      `| ${i + 1} | ${escapeMdCell(r.catalogKey)} | ${escapeMdCell(r.seenAsOnDocument)} | ${escapeMdCell(files)} |`,
    );
  });
  return lines.join("\n");
}

function extractJsonObject(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function extractAssistantText(data: Record<string, unknown>): string {
  const choices = data.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  const msg = choices?.[0]?.message;
  if (!msg || typeof msg !== "object") return "";
  const c = msg.content;
  if (typeof c === "string" && c.trim()) return c;
  if (Array.isArray(c)) {
    const chunks: string[] = [];
    for (const part of c) {
      if (typeof part === "string") chunks.push(part);
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") chunks.push(p.text);
        else if (typeof p.content === "string") chunks.push(p.content);
      }
    }
    const joined = chunks.join("\n").trim();
    if (joined) return joined;
  }
  if (typeof msg.reasoning === "string" && msg.reasoning.trim())
    return msg.reasoning.trim();
  return "";
}

async function callOpenRouterText(args: {
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<{ content: string; usage?: Record<string, unknown> }> {
  const body = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    messages: [{ role: "user" as const, content: args.prompt }],
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

  const content = extractAssistantText(data);
  if (!content.trim()) {
    throw new Error(
      `Empty assistant text: ${JSON.stringify(data).slice(0, 800)}`,
    );
  }

  const usage = data.usage as Record<string, unknown> | undefined;
  return { content, usage };
}

function writeFinalSchemaXlsx(outPath: string, fields: FinalFieldRow[]): void {
  const flat = fields.map((f, i) => ({
    Index: i + 1,
    Section: f.section,
    FieldName: f.fieldName,
    FieldType: f.fieldType,
    Required: f.required ? "Yes" : "No",
    Description: f.description,
    ExampleValue: f.exampleValue ?? "",
    Provenance: f.provenance,
    AlternateLabels: (f.alternateLabels ?? []).join(" | "),
    Notes: f.notes ?? "",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(flat);
  ws["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 28 },
    { wch: 12 },
    { wch: 8 },
    { wch: 40 },
    { wch: 24 },
    { wch: 14 },
    { wch: 36 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Final schema");
  XLSX.writeFile(wb, outPath);
}

function parseArgs(): {
  category: ExportCategory;
  catalogXlsx: string;
  remapJson: string;
  outDir: string;
} {
  const argv = process.argv.slice(2);
  let category: string | null = null;
  let catalogXlsx: string | null = null;
  let remapJson: string | null = null;
  let outDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--category" && argv[i + 1]) category = argv[++i]!;
    else if (a === "--catalog-xlsx" && argv[i + 1])
      catalogXlsx = path.resolve(argv[++i]!);
    else if (a === "--remap-json" && argv[i + 1])
      remapJson = path.resolve(argv[++i]!);
    else if (a === "--out-dir" && argv[i + 1])
      outDir = path.resolve(argv[++i]!);
    else if (a && !a.startsWith("-") && !category) category = a;
  }

  if (!category || !isExportCategory(category)) {
    console.error(
      `Usage: npx tsx scripts/finalize-schema-pro.ts "<ExportDocumentType>"\n` +
        `   or: --category "…" [--catalog-xlsx path] [--remap-json path] [--out-dir dir]\n` +
        `Categories: ${EXPORT_CATEGORIES.join(", ")}`,
    );
    process.exit(1);
  }

  const defaultDir = path.resolve(process.cwd(), "output", "schema-discovery");
  const catXlsx =
    catalogXlsx ??
    path.join(defaultDir, `${category}.xlsx`);
  const catRemap =
    remapJson ?? path.join(defaultDir, `${category}.remap.json`);
  const dirOut = outDir ?? path.dirname(catXlsx);

  return {
    category,
    catalogXlsx: catXlsx,
    remapJson: catRemap,
    outDir: dirOut,
  };
}

async function main(): Promise<void> {
  const { category, catalogXlsx, remapJson, outDir } = parseArgs();

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY");
    process.exit(1);
  }

  const or = getOpenRouterProPdfOptions();

  await fs.access(catalogXlsx).catch(() => {
    console.error(`Catalog not found: ${catalogXlsx}`);
    process.exit(1);
  });
  await fs.access(remapJson).catch(() => {
    console.error(`Remap JSON not found: ${remapJson}`);
    process.exit(1);
  });

  const catalogRows = await loadCatalogFromXlsx(catalogXlsx);
  if (catalogRows.length === 0) {
    console.error("Catalog xlsx has no rows.");
    process.exit(1);
  }

  const remapRaw = JSON.parse(
    await fs.readFile(remapJson, "utf8"),
  ) as RemapJson;
  const novelRows = remapRaw.mergedNovelFields ?? [];
  const aliasRows = remapRaw.mergedAliasesOrNearDuplicates ?? [];

  const prompt = buildFinalizeSchemaAfterRemapPrompt({
    documentCategory: category,
    originalCatalogMarkdown: catalogToMarkdown(catalogRows),
    novelFieldsMarkdown: novelToMarkdown(novelRows),
    aliasesMarkdown: aliasesToMarkdown(aliasRows),
  });

  console.log(`Category: ${category}`);
  console.log(`Catalog: ${catalogXlsx} (${catalogRows.length} rows)`);
  console.log(`Remap: ${remapJson} (novel ${novelRows.length}, aliases ${aliasRows.length})`);
  console.log(`Model: ${or.model}`);
  console.log(`max_tokens: ${or.maxTokens}`);
  console.log("Calling OpenRouter (Pro, text-only)…");

  const { content, usage } = await callOpenRouterText({
    apiKey,
    model: or.model,
    prompt,
    temperature: Math.min(or.temperature, 0.2),
    maxTokens: or.maxTokens,
  });

  let parsed: FinalSchemaPayload;
  try {
    parsed = JSON.parse(extractJsonObject(content)) as FinalSchemaPayload;
  } catch (e) {
    const errPath = path.join(outDir, "_last-finalize-raw.txt");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(errPath, content, "utf8");
    console.error("JSON parse failed. Raw saved to", errPath);
    throw e;
  }

  if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    throw new Error("Pro response missing non-empty fields[]");
  }

  const baseName = category.replace(/[/\\]/g, "_");
  const jsonPath = path.join(outDir, `${baseName}.final-schema.json`);
  const xlsxPath = path.join(outDir, `${baseName}.final-schema.xlsx`);

  const payloadOut = {
    ...parsed,
    modelUsed: or.model,
    source: "Gemini",
    pipeline: {
      catalogXlsx: path.relative(process.cwd(), catalogXlsx),
      remapJson: path.relative(process.cwd(), remapJson),
      inputOriginalRowCount: catalogRows.length,
      inputNovelCount: novelRows.length,
      inputAliasCount: aliasRows.length,
    },
    openrouterUsage: usage,
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(payloadOut, null, 2), "utf8");
  writeFinalSchemaXlsx(xlsxPath, parsed.fields);

  console.log(`Wrote ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), xlsxPath)}`);
  console.log(`Final field count: ${parsed.fields.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
