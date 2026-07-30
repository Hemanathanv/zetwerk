type PermissionDocScopes = {
  activities?: string[] | null;
  docTypes?: Record<string, string[] | undefined> | null;
  documentScope?: string[] | null;
  activityDocTypes?: Record<string, string[] | undefined> | null;
};

export type DocGenerationOption = {
  type: 'packing-list' | 'outward-grn' | 'draft-boe';
  generatedDocType: 'PACKING_LIST' | 'US_PACKING_LIST' | 'ENTRY_SUMMARY';
  label: string;
  sourceDocTypes: string[];
};

export const DOC_GENERATION_ACTIVITY_CODES = [
  'documents.generate_draft',
  'DOC-003',
  'documents.view_draft',
  'documents.fill_manual_fields',
  'documents.modify_generated_fields',
  'documents.save_draft',
  'documents.submit_for_review',
  'documents.approve_generated_document',
  'documents.reject_generated_document',
  'documents.re_trigger_generation',
  'documents.discard_draft',
];

export const DOC_GENERATION_OPTIONS: DocGenerationOption[] = [
  {
    type: 'packing-list',
    generatedDocType: 'PACKING_LIST',
    label: 'Packing List',
    sourceDocTypes: ['SALES_INVOICE'],
  },
  {
    type: 'outward-grn',
    generatedDocType: 'US_PACKING_LIST',
    label: 'Outward GRN',
    sourceDocTypes: ['PACKING_LIST', 'BILL_OF_LADING'],
  },
  {
    type: 'draft-boe',
    generatedDocType: 'ENTRY_SUMMARY',
    label: 'Draft CBP FORM 7501',
    sourceDocTypes: ['BILL_OF_LADING', 'SALES_INVOICE'],
  },
];

function normalizeDocType(value: string): string {
  return value.trim().toUpperCase().replace(/[-\s]+/g, '_');
}

export function allowedDocGenerationOptions(permissions: PermissionDocScopes): DocGenerationOption[] {
  const activities = permissions.activities ?? [];
  if (!DOC_GENERATION_ACTIVITY_CODES.some((activity) => activities.includes(activity))) return [];

  const generateScope = [
    ...DOC_GENERATION_ACTIVITY_CODES.flatMap((activity) => permissions.activityDocTypes?.[activity] ?? []),
    ...(permissions.docTypes?.review_generation ?? []),
    ...(permissions.documentScope ?? []),
  ];
  const normalizedScope = new Set(generateScope.map(normalizeDocType));
  if (normalizedScope.has('*')) return DOC_GENERATION_OPTIONS;

  return DOC_GENERATION_OPTIONS.filter((option) => (
    normalizedScope.has(option.generatedDocType) ||
    option.sourceDocTypes.every((docType) => normalizedScope.has(docType))
  ));
}
