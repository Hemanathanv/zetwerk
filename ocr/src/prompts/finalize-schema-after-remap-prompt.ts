/**
 * Pro-model prompt: merge original discover-schema catalog + remap novel + alias rows into one final list.
 */

export function buildFinalizeSchemaAfterRemapPrompt(args: {
  documentCategory: string;
  originalCatalogMarkdown: string;
  novelFieldsMarkdown: string;
  aliasesMarkdown: string;
}): string {
  return `You are a senior data architect for trade-document extraction. You are given THREE inputs for category **"${args.documentCategory}"**:

(1) **ORIGINAL CATALOG** — merged field list from Flash schema-discovery (first pass).
(2) **NOVEL FIELDS** — merged from a remap/gap pass (fields seen on PDFs but not in the original catalog).
(3) **ALIASES / NEAR-DUPLICATES** — labels as printed on documents vs canonical catalog keys (\`Section :: FieldName\`).

---

## ORIGINAL CATALOG
${args.originalCatalogMarkdown}

---

## NOVEL FIELDS (from remap)
${args.novelFieldsMarkdown}

---

## ALIASES / NEAR-DUPLICATES
${args.aliasesMarkdown}

---

## YOUR TASK
Produce **one** final, deduplicated extraction schema as JSON:

1. **Preserve every original catalog field** at least once (same section + fieldName unless you merge true duplicates *within* the original list only — rare).
2. **Add** novel fields that are **not** the same semantic concept as any original field. If a novel field is the same meaning as an original, **do not** add a duplicate row; instead set \`provenance\` to \`"merged"\` on the original row and append context in \`notes\` / \`alternateLabels\`.
3. **Apply aliases**: for each alias row, attach the \`seenAsOnDocument\` string to the matching canonical field's \`alternateLabels\` array (match \`catalogKey\` to your section + fieldName). If no match, note in a field-level \`notes\` or omit if spurious.
4. Use **fieldType** from the best source (original > novel). **description** should be the clearest merged text.
5. **required**: carry from original when present; for novel-only fields default false unless clearly mandatory on the form.
6. **provenance** on each output field must be one of: \`"original"\` | \`"novel_remap"\` | \`"merged"\` (merged = original row that absorbed a novel or alias insight).

Respond with **ONLY** valid JSON (no markdown fences), shape:
{
  "documentCategory": "${args.documentCategory}",
  "source": "Gemini",
  "summary": "1–3 sentences on what was merged or added",
  "statistics": {
    "inputOriginalCount": <number>,
    "inputNovelCount": <number>,
    "inputAliasCount": <number>,
    "outputFieldCount": <number>
  },
  "fields": [
    {
      "section": "string",
      "fieldName": "string",
      "fieldType": "string",
      "description": "string",
      "required": false,
      "exampleValue": "string or omit",
      "provenance": "original|novel_remap|merged",
      "alternateLabels": ["optional printing variants"],
      "notes": "optional"
    }
  ]
}

Fill **statistics** from the input table row counts provided above (inputOriginalCount = rows in original, etc.). **outputFieldCount** = fields.length.`;
}
