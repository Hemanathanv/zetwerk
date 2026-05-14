/**
 * Schema discovery: for each PDF under Input/<Category>/, call OpenRouter (Gemini Flash)
 * with the Phase 1 classification + ghost-field prompt, then merge unique fields per category.
 *
 * Usage:
 *   npm install
 *   npx tsx scripts/discover-schema.ts "Shipping Bill"
 *   npx tsx scripts/discover-schema.ts BOE
 *   npx tsx scripts/discover-schema.ts --all
 *   (Optional) SCHEMA_CATEGORY="CHA Bills" npx tsx scripts/discover-schema.ts
 *
 * Outputs per category: <Category>.json and <Category>.xlsx (one sheet, all merged columns).
 *
 * Env: see `.env.example` — OpenRouter settings via `src/config/openrouter-env.ts`.
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
import { buildClassificationPrompt } from "../src/prompts/classification-prompt.js";

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

interface SchemaFieldRow {
  fieldName: string;
  fieldType: string;
  section: string;
  required: boolean;
  description: string;
  exampleValue?: string;
}

interface ClassificationJson {
  documentType?: string;
  isCombinedDocument?: boolean;
  confidence?: number;
  alternativeTypes?: { type: string; confidence: number }[];
  visualLayout?: string;
  fields?: SchemaFieldRow[];
}

interface PerFileResult {
  fileName: string;
  relativePath: string;
  ok: boolean;
  error?: string;
  documentType?: string;
  confidence?: number;
  fieldCount?: number;
  fields?: SchemaFieldRow[];
  rawContent?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface MergedField extends SchemaFieldRow {
  seenInFiles: string[];
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let category: string | null = null;
  let all = false;
  let inputRoot = path.resolve(process.cwd(), "Input");
  let outDir = path.resolve(process.cwd(), "output", "schema-discovery");

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") all = true;
    else if (a === "--category" && argv[i + 1]) {
      category = argv[++i]!;
    } else if (a === "--input" && argv[i + 1]) {
      inputRoot = path.resolve(argv[++i]!);
    } else if (a === "--out" && argv[i + 1]) {
      outDir = path.resolve(argv[++i]!);
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  npx tsx scripts/discover-schema.ts "Shipping Bill"
  npx tsx scripts/discover-schema.ts --category "CHA Bills"
  npx tsx scripts/discover-schema.ts --all
  npx tsx scripts/discover-schema.ts --input ./Input --out ./output/schema-discovery
  SCHEMA_CATEGORY=BOE npx tsx scripts/discover-schema.ts   (Unix)

Requires OPENROUTER_API_KEY in .env.local`);
      process.exit(0);
    }
  }

  if (!all && !category && argv.length === 1 && !argv[0]!.startsWith("-")) {
    category = argv[0]!;
  }
  if (!all && !category && process.env.SCHEMA_CATEGORY?.trim()) {
    category = process.env.SCHEMA_CATEGORY.trim();
  }

  if (!all && !category) {
    console.error(
      'Pass a category folder name, --category "<name>", SCHEMA_CATEGORY env, or --all',
    );
    process.exit(1);
  }

  return { category, all, inputRoot, outDir };
}

function isPdf(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".pdf");
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

function mergeKey(f: SchemaFieldRow): string {
  return `${f.section.trim().toLowerCase()}::${f.fieldName.trim().toLowerCase()}`;
}

function mergeFields(
  merged: Map<string, MergedField>,
  fields: SchemaFieldRow[] | undefined,
  fileLabel: string,
): void {
  if (!fields?.length) return;
  for (const f of fields) {
    const key = mergeKey(f);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...f,
        seenInFiles: [fileLabel],
      });
      continue;
    }
    existing.seenInFiles.push(fileLabel);
    if (!existing.exampleValue && f.exampleValue) existing.exampleValue = f.exampleValue;
    if (f.description && f.description.length > (existing.description?.length ?? 0)) {
      existing.description = f.description;
    }
  }
}

async function callOpenRouterPdf(args: {
  apiKey: string;
  model: string;
  prompt: string;
  pdfPath: string;
  pdfEngine: string;
  temperature: number;
  maxTokens: number;
}): Promise<{ content: string; usage?: PerFileResult["usage"] }> {
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
    const err = JSON.stringify(data);
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const usage = data.usage as PerFileResult["usage"] | undefined;
  return { content, usage };
}

async function processCategory(
  category: ExportCategory,
  inputRoot: string,
  apiKey: string,
  model: string,
  pdfEngine: string,
  temperature: number,
  maxTokens: number,
): Promise<{
  category: string;
  mergedFields: MergedField[];
  perFile: PerFileResult[];
  source: string;
  modelUsed: string;
}> {
  const dir = path.join(inputRoot, category);
  let pdfs: string[] = [];
  try {
    pdfs = await listPdfFiles(dir);
  } catch {
    return {
      category,
      mergedFields: [],
      perFile: [
        {
          fileName: "",
          relativePath: path.relative(process.cwd(), dir),
          ok: false,
          error: "Category folder missing or unreadable",
        },
      ],
      source: "Gemini",
      modelUsed: model,
    };
  }

  if (pdfs.length === 0) {
    return {
      category,
      mergedFields: [],
      perFile: [
        {
          fileName: "",
          relativePath: path.relative(process.cwd(), dir),
          ok: false,
          error: "No PDF files in folder",
        },
      ],
      source: "Gemini",
      modelUsed: model,
    };
  }

  const prompt = buildClassificationPrompt(category);
  const merged = new Map<string, MergedField>();
  const perFile: PerFileResult[] = [];

  for (const pdfPath of pdfs) {
    const fileName = path.basename(pdfPath);
    const relativePath = path.relative(process.cwd(), pdfPath);
    try {
      const { content, usage } = await callOpenRouterPdf({
        apiKey,
        model,
        prompt,
        pdfPath,
        pdfEngine,
        temperature,
        maxTokens,
      });
      const jsonStr = extractJsonObject(content);
      const parsed = JSON.parse(jsonStr) as ClassificationJson;
      const fields = parsed.fields ?? [];
      mergeFields(merged, fields, fileName);
      perFile.push({
        fileName,
        relativePath,
        ok: true,
        documentType: parsed.documentType,
        confidence: parsed.confidence,
        fieldCount: fields.length,
        fields,
        rawContent: content.length > 8000 ? content.slice(0, 8000) + "…" : content,
        usage,
      });
      console.log(`  OK ${fileName} → ${fields.length} fields (type: ${parsed.documentType ?? "?"})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  FAIL ${fileName}: ${msg}`);
      perFile.push({
        fileName,
        relativePath,
        ok: false,
        error: msg,
      });
    }
  }

  return {
    category,
    mergedFields: [...merged.values()].sort((a, b) =>
      mergeKey(a).localeCompare(mergeKey(b)),
    ),
    perFile,
    source: "Gemini",
    modelUsed: model,
  };
}

function isExportCategory(name: string): name is ExportCategory {
  return (EXPORT_CATEGORIES as readonly string[]).includes(name);
}

/** Excel sheet names: max 31 chars; cannot contain : \ / ? * [ ] */
function excelSheetName(category: string): string {
  const cleaned = category.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : "Fields";
}

function writeMergedFieldsExcel(
  filePath: string,
  category: string,
  fields: MergedField[],
): void {
  const rows = fields.map((f, i) => ({
    Index: i + 1,
    Section: f.section,
    FieldName: f.fieldName,
    FieldType: f.fieldType,
    Required: f.required ? "Yes" : "No",
    Description: f.description,
    ExampleValue: f.exampleValue ?? "",
    SeenInFiles: f.seenInFiles.join("; "),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 36 },
    { wch: 14 },
    { wch: 8 },
    { wch: 50 },
    { wch: 28 },
    { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, excelSheetName(category));
  XLSX.writeFile(wb, filePath);
}

async function main() {
  const { category, all, inputRoot, outDir } = parseArgs();
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY in .env.local (or .env)");
    process.exit(1);
  }

  const or = getOpenRouterFlashPdfOptions();
  const { model, pdfEngine, temperature, maxTokens } = or;

  await fs.mkdir(outDir, { recursive: true });

  let categories: ExportCategory[];
  if (all) {
    categories = [...EXPORT_CATEGORIES];
  } else if (category && isExportCategory(category)) {
    categories = [category];
  } else {
    console.error(
      `Unknown category "${category}". Expected one of: ${EXPORT_CATEGORIES.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Input: ${inputRoot}`);
  console.log(`Model: ${model}`);
  console.log(`PDF engine: ${pdfEngine}`);
  console.log(`temperature: ${temperature}`);
  console.log(`max_tokens: ${maxTokens}`);
  console.log(`Categories: ${categories.join(", ")}\n`);

  const summary: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: "Gemini",
    modelUsed: model,
    pdfEngine,
    temperature,
    maxTokens,
    inputRoot: path.relative(process.cwd(), inputRoot),
    categories: {},
  };

  for (const cat of categories) {
    console.log(`=== ${cat} ===`);
    const result = await processCategory(
      cat,
      inputRoot,
      apiKey,
      model,
      pdfEngine,
      temperature,
      maxTokens,
    );
    const outPath = path.join(
      outDir,
      `${cat.replace(/[/\\]/g, "_")}.json`,
    );
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          ...result,
          mergedFieldCount: result.mergedFields.length,
        },
        null,
        2,
      ),
      "utf8",
    );

    const excelPath = outPath.replace(/\.json$/i, ".xlsx");
    writeMergedFieldsExcel(excelPath, cat, result.mergedFields);

    console.log(
      `Wrote ${path.relative(process.cwd(), outPath)} (${result.mergedFields.length} merged fields)`,
    );
    console.log(`Wrote ${path.relative(process.cwd(), excelPath)}\n`);

    (summary.categories as Record<string, unknown>)[cat] = {
      mergedFieldCount: result.mergedFields.length,
      filesProcessed: result.perFile.filter((p) => p.ok).length,
      filesFailed: result.perFile.filter((p) => !p.ok).length,
      outputFile: path.relative(process.cwd(), outPath),
      excelFile: path.relative(process.cwd(), excelPath),
    };
  }

  await fs.writeFile(
    path.join(outDir, "_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log(`Summary: ${path.join(path.relative(process.cwd(), outDir), "_summary.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
