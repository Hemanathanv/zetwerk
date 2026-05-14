/**
 * Summarize OpenRouter `usage` from output/extraction-gemini/*.json
 * (same shape as Supabase export_document_extractions.usage JSONB).
 *
 * Run: node scripts/analyze-extraction-gemini-usage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "output", "extraction-gemini");

function categoryFromFilename(name) {
  if (name.startsWith("Entry_Summary_")) return "Entry Summary";
  if (name.startsWith("Packing_Lists_")) return "Packing Lists";
  if (name.startsWith("Sales_Invoices_")) return "Sales Invoices";
  if (name.startsWith("Shipping_Bill_")) return "Shipping Bill";
  return "Other";
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function extractUsageMetrics(usage) {
  if (!usage || typeof usage !== "object") return null;
  const cd = usage.cost_details;
  const cdObj = cd && typeof cd === "object" ? cd : {};
  return {
    cost: num(usage.cost) ?? num(cdObj.upstream_inference_cost),
    upstream_inference_cost: num(cdObj.upstream_inference_cost),
    upstream_inference_prompt_cost: num(cdObj.upstream_inference_prompt_cost),
    upstream_inference_completions_cost: num(cdObj.upstream_inference_completions_cost),
    prompt_tokens: num(usage.prompt_tokens),
    completion_tokens: num(usage.completion_tokens),
    total_tokens: num(usage.total_tokens),
  };
}

function agg(values) {
  const xs = values.filter((x) => x != null && Number.isFinite(x));
  if (xs.length === 0) return { count: 0, min: null, max: null, avg: null, sum: null };
  const sum = xs.reduce((a, b) => a + b, 0);
  return {
    count: xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
    avg: sum / xs.length,
    sum,
  };
}

function main() {
  if (!fs.existsSync(dir)) {
    console.error("Missing folder:", dir);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const byCat = new Map();
  const all = [];

  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const docType =
      typeof raw.documentType === "string" ? raw.documentType : categoryFromFilename(f);
    const cat = categoryFromFilename(f) === "Other" ? docType : categoryFromFilename(f);
    const m = extractUsageMetrics(raw.usage);
    if (!m || m.cost == null) {
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push({ file: f, skipped: true });
      continue;
    }
    const row = { file: f, category: cat, documentType: docType, ...m };
    all.push(row);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(row);
  }

  const keys = [
    "cost",
    "upstream_inference_prompt_cost",
    "upstream_inference_completions_cost",
    "upstream_inference_cost",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
  ];

  console.log("=== Local Gemini extraction folder:", dir, "===");
  console.log("JSON files:", files.length);
  console.log(
    "Note: Supabase column `usage` is the same OpenRouter object as `usage` in these JSON files.",
  );
  console.log("");

  for (const cat of [...byCat.keys()].sort()) {
    const rows = byCat.get(cat).filter((r) => !r.skipped);
    const skipped = byCat.get(cat).filter((r) => r.skipped).length;
    console.log(`--- ${cat} (n=${rows.length}${skipped ? `, skipped no usage: ${skipped}` : ""}) ---`);
    if (rows.length === 0) {
      console.log("(no usage data)\n");
      continue;
    }
    for (const k of keys) {
      const a = agg(rows.map((r) => r[k]));
      if (a.count === 0) continue;
      const label = k.replace(/_/g, " ");
      console.log(
        `  ${label}: min=${a.min?.toFixed(6)} max=${a.max?.toFixed(6)} avg=${a.avg?.toFixed(6)} sum=${a.sum?.toFixed(6)}`,
      );
    }
    console.log("");
  }

  console.log("=== All categories combined ===");
  for (const k of keys) {
    const a = agg(all.map((r) => r[k]));
    if (a.count === 0) continue;
    const label = k.replace(/_/g, " ");
    console.log(
      `  ${label}: n=${a.count} min=${a.min?.toFixed(6)} max=${a.max?.toFixed(6)} avg=${a.avg?.toFixed(6)} sum=${a.sum?.toFixed(6)}`,
    );
  }

  console.log("\n=== Entry Summary (Bill of Entry) — per file ===");
  const boe = all.filter((r) => r.category === "Entry Summary").sort((a, b) => a.file.localeCompare(b.file));
  for (const r of boe) {
    console.log(
      `${r.file}: total $${r.cost?.toFixed(6)} | prompt $${r.upstream_inference_prompt_cost?.toFixed(6)} | completion $${r.upstream_inference_completions_cost?.toFixed(6)} | tokens in/out/total ${r.prompt_tokens}/${r.completion_tokens}/${r.total_tokens}`,
    );
  }
}

main();
