/**
 * Insert local Bill of Entry (Entry Summary) structured extractions into Supabase
 * `export_document_extractions`, matching the row shape from `extract-entry-summary-gemini-db.ts`.
 *
 * Reads: output/extraction-gemini/Entry_Summary_*-extraction-structured.json
 *
 * Env (.env.local / .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY;
 * optional SUPABASE_APP_PROJECT_SLUG (default zf-export).
 *
 * Run:
 *   npx tsx scripts/push-entry-summary-extractions-to-supabase.ts
 *   npx tsx scripts/push-entry-summary-extractions-to-supabase.ts --dir path/to/json/folder
 *   npx tsx scripts/push-entry-summary-extractions-to-supabase.ts --dry-run
 *   npx tsx scripts/push-entry-summary-extractions-to-supabase.ts --force   (insert even if row exists)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const DOCUMENT_CATEGORY = "Entry Summary";

async function fetchAppProjectId(
  supabaseUrl: string,
  serviceKey: string,
  slug: string,
): Promise<string | null> {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/rest/v1/app_projects?slug=eq.${encodeURIComponent(slug)}&select=id`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase app_projects ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

async function rowExists(args: {
  base: string;
  serviceKey: string;
  sourceFileName: string;
  sourceRelativePath: string;
}): Promise<boolean> {
  const u = new URL(`${args.base}/rest/v1/export_document_extractions`);
  u.searchParams.set("select", "id");
  u.searchParams.set("document_category", `eq.${DOCUMENT_CATEGORY}`);
  u.searchParams.set("source_file_name", `eq.${args.sourceFileName}`);
  u.searchParams.set("source_relative_path", `eq.${args.sourceRelativePath}`);
  u.searchParams.set("limit", "1");
  const url = u.toString();
  const res = await fetch(url, {
    headers: {
      apikey: args.serviceKey,
      Authorization: `Bearer ${args.serviceKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase export_document_extractions GET ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function insertExportDocumentExtraction(args: {
  supabaseUrl: string;
  serviceKey: string;
  appProjectId: string;
  sourceFileName: string;
  sourceRelativePath: string;
  extractionMode: "flat" | "structured";
  modelId: string;
  pdfEngine: string;
  temperature: number;
  maxTokens: number;
  usage: Record<string, unknown> | undefined;
  extractJson: Record<string, unknown>;
}): Promise<void> {
  const base = args.supabaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/v1/export_document_extractions`, {
    method: "POST",
    headers: {
      apikey: args.serviceKey,
      Authorization: `Bearer ${args.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      app_project_id: args.appProjectId,
      document_category: DOCUMENT_CATEGORY,
      source_file_name: args.sourceFileName,
      source_relative_path: args.sourceRelativePath,
      extraction_mode: args.extractionMode,
      model_id: args.modelId,
      pdf_engine: args.pdfEngine,
      temperature: args.temperature,
      max_tokens: args.maxTokens,
      usage: args.usage ?? null,
      extract_json: args.extractJson,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Supabase export_document_extractions POST ${res.status}: ${await res.text()}`,
    );
  }
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let dir = path.resolve(process.cwd(), "output", "extraction-gemini");
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) dir = path.resolve(argv[++i]!);
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--force") force = true;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const appSlug = process.env.SUPABASE_APP_PROJECT_SLUG?.trim() || "zf-export";

  if (!dryRun && (!supabaseUrl || !supabaseKey)) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local / .env");
    process.exit(1);
  }

  if (!fs.existsSync(dir)) {
    console.error("Directory not found:", dir);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        f.startsWith("Entry_Summary_") &&
        f.endsWith(".json") &&
        f.includes("extraction-structured"),
    )
    .sort();

  if (files.length === 0) {
    console.error("No matching JSON files (Entry_Summary_*extraction-structured.json) in", dir);
    process.exit(1);
  }

  console.log(`Folder: ${dir}`);
  console.log(`Files: ${files.length}`);
  if (dryRun) {
    console.log("(dry-run — no Supabase calls)");
    for (const f of files) console.log("  ", f);
    return;
  }

  const appProjectId = await fetchAppProjectId(supabaseUrl!, supabaseKey!, appSlug);
  if (!appProjectId) {
    console.error(`No app_projects row with slug="${appSlug}".`);
    process.exit(1);
  }

  const base = supabaseUrl!.replace(/\/$/, "");
  let inserted = 0;
  let skipped = 0;

  for (const f of files) {
    const full = path.join(dir, f);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
    } catch (e) {
      console.error(`Skip (invalid JSON): ${f}`, e);
      continue;
    }

    const pdfRel = str(payload.pdfPath, "");
    if (!pdfRel) {
      console.error(`Skip (missing pdfPath): ${f}`);
      continue;
    }
    const sourceFileName = path.basename(pdfRel.replace(/[/\\]/g, path.sep));
    const extractionMode =
      payload.extractionMode === "flat" ? "flat" : "structured";
    const modelId = str(payload.modelUsed, "unknown");
    const pdfEngine = str(payload.pdfEngine, "native");
    const temperature = num(payload.temperature, 0.1);
    const maxTokens = num(payload.maxTokens, 131072);
    const usage = payload.usage as Record<string, unknown> | undefined;

    if (!force) {
      const exists = await rowExists({
        base,
        serviceKey: supabaseKey!,
        sourceFileName,
        sourceRelativePath: pdfRel,
      });
      if (exists) {
        console.log(`Skip (exists): ${sourceFileName}`);
        skipped += 1;
        continue;
      }
    }

    await insertExportDocumentExtraction({
      supabaseUrl: supabaseUrl!,
      serviceKey: supabaseKey!,
      appProjectId,
      sourceFileName,
      sourceRelativePath: pdfRel,
      extractionMode,
      modelId,
      pdfEngine,
      temperature,
      maxTokens,
      usage,
      extractJson: payload,
    });
    console.log(`Inserted: ${sourceFileName}`);
    inserted += 1;
  }

  console.log(`Done. Inserted: ${inserted}, skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
