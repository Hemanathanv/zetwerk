/**
 * Prompt for second-pass audit: find fields on the PDF not covered by the frozen catalog from schema-discovery .xlsx.
 */
export function buildRemapMissingFieldsPrompt(args: {
  documentCategory: string;
  catalogMarkdown: string;
}): string {
  return `You are a Senior Trade Compliance Officer auditing Indian export documents (EXIM). A **frozen field catalog** for category "${args.documentCategory}" was built from prior runs. Each entry includes **Section** (logical area on the form) and **Field name** plus type and description.

FROZEN CATALOG (do not re-list these as novel unless the document shows a genuinely different data point that is NOT the same semantic field):
${args.catalogMarkdown}

TASK — REMapping / gap audit for the attached PDF:
1. Read the entire PDF (all pages). Treat tables, headers, footers, stamps, and marginalia as potential data locations.
2. Identify **only** extractable fields that are **NOT** already covered by the frozen catalog. "Covered" means: the same meaning in the same general section, even if wording differs slightly—use \`aliasesOrNearDuplicates\` for those instead of \`novelFields\`.
3. For **table column headers**: if a column concept is new vs the catalog, add it as a novel field with section e.g. "Line Items" or the table title shown on the document.
4. Do **not** output fields that are pure duplicates of catalog entries.

For each item in \`aliasesOrNearDuplicates\`:
- \`catalogKey\`: use format \`Section :: FieldName\` matching the closest catalog line above.
- \`seenAsOnDocument\`: exact or paraphrased label as printed.
- \`page\`: page number (1-based) if inferable.

For each item in \`novelFields\`:
- \`section\`: where on the document (align with catalog section style, e.g. "A. Status", "Line Items").
- \`fieldName\`: concise stable name for extraction.
- \`fieldType\`: one of string|number|date|currency|boolean|array|address|percentage|weight|dimension
- \`description\`: what it represents.
- \`exampleValue\`: literal from doc if visible, else omit.
- \`confidence\`: 0.0–1.0
- \`page\`: 1-based page if inferable, else omit.

Respond with **ONLY** valid JSON (no markdown fences, no commentary):
{
  "documentCategory": "${args.documentCategory}",
  "aliasesOrNearDuplicates": [
    { "catalogKey": "Section :: FieldName", "seenAsOnDocument": "string", "page": 1 }
  ],
  "novelFields": [
    { "section": "string", "fieldName": "string", "fieldType": "string", "description": "string", "exampleValue": "optional", "confidence": 0.0, "page": 1 }
  ],
  "auditNotes": "string"
}`;
}
