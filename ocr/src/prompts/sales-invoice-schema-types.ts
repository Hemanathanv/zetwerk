/** Shared schema row shape for Sales Invoices final-schema.json loaders. */

export interface SchemaRow {
  index: number;
  section: string;
  fieldName: string;
  fieldType: string;
  description: string;
  required: boolean;
  provenance?: string;
  alternateLabels?: string[];
  schemaNotes?: string;
}
