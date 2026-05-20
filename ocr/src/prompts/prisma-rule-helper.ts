import fs from "node:fs";
import path from "node:path";

let prismaSchemaCache: string | null = null;

function getPrismaSchemaText(): string {
  if (prismaSchemaCache) return prismaSchemaCache;
  const schemaPath = path.resolve(process.cwd(), "backend/prisma/schema.prisma");
  prismaSchemaCache = fs.readFileSync(schemaPath, "utf8");
  return prismaSchemaCache;
}

function extractModelFieldNames(modelName: string): Set<string> {
  const schema = getPrismaSchemaText();
  const modelRegex = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = schema.match(modelRegex);
  if (!match) return new Set<string>();

  const block = match[1] ?? "";
  const fields = new Set<string>();
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const firstToken = line.split(/\s+/)[0];
    if (!firstToken || firstToken.startsWith("@")) continue;
    if (firstToken === "id") continue;
    fields.add(firstToken);
  }
  return fields;
}

export function buildPrismaBackedSingleLocationRule(params: {
  modelName: string;
  sectionsByField: Map<string, string>;
}): string {
  const { modelName, sectionsByField } = params;
  const modelFields = extractModelFieldNames(modelName);

  const matches = [...sectionsByField.entries()]
    .filter(([field]) => modelFields.has(field))
    .sort(([a], [b]) => a.localeCompare(b));

  if (matches.length === 0) {
    return "**Single location per concept**: keep each concept in only one schema location; do not duplicate the same concept across multiple sections.";
  }

  const examples = matches
    .slice(0, 8)
    .map(([field, section]) => `\`${field}\` only under \`${section}\``)
    .join("; ");

  return `**Single location per concept (Prisma-aligned)**: keep each concept in only one schema location. Examples: ${examples}.`;
}
