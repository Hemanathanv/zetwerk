/**
 * Re-run `normalizeStructuredOceanFreightPayload` on cached structured JSON
 * (dates, totalContainers from container list) and refresh paired .xlsx when present.
 *
 * Usage: npx tsx scripts/reapply-ocean-freight-json-normalize.ts
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { normalizeStructuredOceanFreightPayload } from "../src/ocean-freight-structured-normalize.js";
import { writeOceanFreightWorkbookFromPayload } from "./ocean-freight-structured-excel.js";

const dir = path.resolve(process.cwd(), "output", "extraction-gemini");
const names = fs.readdirSync(dir).filter(
  (f) => f.startsWith("Ocean_Freight_") && f.endsWith("-extraction-structured.json"),
);

for (const name of names) {
  const jsonPath = path.join(dir, name);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  normalizeStructuredOceanFreightPayload(j);
  fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");

  const xlsxPath = path.join(dir, name.replace(/\.json$/, ".xlsx"));
  if (fs.existsSync(xlsxPath)) {
    writeOceanFreightWorkbookFromPayload(xlsxPath, j, [
      { key: "pdf", value: j.pdfPath },
      { key: "model", value: j.modelUsed },
      { key: "source", value: "Gemini" },
      { key: "usage", value: j.usage ?? {} },
    ]);
  }
  console.log("OK", name);
}
