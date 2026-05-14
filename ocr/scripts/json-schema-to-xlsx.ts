/**
 * One-off: build .xlsx from a schema-discovery JSON (same columns as discover-schema output).
 * Usage: npx tsx scripts/json-schema-to-xlsx.ts "output/schema-discovery/Shipping Bill.json"
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

interface MergedField {
  fieldName: string;
  fieldType: string;
  section: string;
  required: boolean;
  description: string;
  exampleValue?: string;
  seenInFiles: string[];
}

function excelSheetName(category: string): string {
  const cleaned = category.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : "Fields";
}

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: npx tsx scripts/json-schema-to-xlsx.ts "<path-to-.json>"');
  process.exit(1);
}

const abs = path.resolve(jsonPath);
const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as {
  category?: string;
  mergedFields?: MergedField[];
};
const fields = raw.mergedFields ?? [];
const category = raw.category ?? path.basename(abs, ".json");

const rows = fields.map((f, i) => ({
  Index: i + 1,
  Section: f.section,
  FieldName: f.fieldName,
  FieldType: f.fieldType,
  Required: f.required ? "Yes" : "No",
  Description: f.description,
  ExampleValue: f.exampleValue ?? "",
  SeenInFiles: (f.seenInFiles ?? []).join("; "),
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

const outPath = abs.replace(/\.json$/i, ".xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Wrote ${outPath}`);
