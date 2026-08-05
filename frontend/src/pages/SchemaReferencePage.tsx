import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Database, Table2, Hash } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

// ─── Type Definitions ──────────────────────────────────────────────────────

type FieldDef = {
  name: string;
  type: string;
  nullable: boolean;
  dbCol: string;
  pk?: boolean;
  fk?: string;
  unique?: boolean;
  notes?: string;
};

type ModelDef = {
  name: string;
  table: string;
  category: string;
  description?: string;
  fields: FieldDef[];
};

// ─── Schema Data ───────────────────────────────────────────────────────────

const f = (
  name: string,
  type: string,
  nullable: boolean,
  dbCol?: string,
  opts?: { pk?: boolean; fk?: string; unique?: boolean; notes?: string },
): FieldDef => ({
  name,
  type,
  nullable,
  dbCol: dbCol ?? name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''),
  ...opts,
});

const MODELS: ModelDef[] = [
  // ── AUTH & USERS ──────────────────────────────────────────────────────────
  {
    name: 'Organization',
    table: 'organizations',
    category: 'Auth & Users',
    description: 'Top-level tenant. Every user and document belongs to one org.',
    fields: [
      f('id',               'UUID',    false, 'id',               { pk: true }),
      f('name',             'String',  false),
      f('slug',             'String',  false, 'slug',             { unique: true }),
      f('subscriptionTier', 'String',  false, 'subscription_tier'),
      f('defaultCurrency',  'String',  false, 'default_currency'),
      f('defaultTimezone',  'String',  false, 'default_timezone'),
      f('dateFormat',       'String',  false, 'date_format'),
      f('numberFormat',     'String',  false, 'number_format'),
      f('logoUrl',          'String',  true,  'logo_url'),
      f('primaryColor',     'String',  true,  'primary_color'),
      f('isActive',         'Boolean', false, 'is_active'),
      f('createdAt',        'DateTime',false, 'created_at'),
      f('updatedAt',        'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'OrgSetting',
    table: 'org_settings',
    category: 'Auth & Users',
    description: 'Key-value settings per org, grouped by category.',
    fields: [
      f('id',           'UUID',   false, 'id', { pk: true }),
      f('orgId',        'UUID',   false, 'org_id', { fk: 'Organization.id' }),
      f('category',     'String', false),
      f('settingKey',   'String', false, 'setting_key'),
      f('settingValue', 'Json',   false, 'setting_value'),
      f('description',  'String', true),
      f('updatedAt',    'DateTime', false, 'updated_at'),
    ],
  },
  {
    name: 'User',
    table: 'users',
    category: 'Auth & Users',
    description: 'Platform user, scoped to an org with a role.',
    fields: [
      f('id',               'UUID',    false, 'id', { pk: true }),
      f('orgId',            'UUID',    false, 'org_id',   { fk: 'Organization.id' }),
      f('roleId',           'UUID',    true,  'role_id',  { fk: 'Role.id' }),
      f('email',            'String',  false),
      f('fullName',         'String',  false, 'full_name'),
      f('userType',         'String',  false, 'user_type', { notes: 'internal | external' }),
      f('status',           'String',  false, 'status', { notes: 'invited | active | suspended' }),
      f('phone',            'String',  true),
      f('avatarUrl',        'String',  true,  'avatar_url'),
      f('timezone',         'String',  true),
      f('passwordHash',     'String',  true,  'password_hash'),
      f('twoFactorEnabled', 'Boolean', false, 'two_factor_enabled'),
      f('invitedBy',        'UUID',    true,  'invited_by'),
      f('lastLoginAt',      'DateTime',true,  'last_login_at'),
      f('createdAt',        'DateTime',false, 'created_at'),
      f('updatedAt',        'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'UserSession',
    table: 'user_sessions',
    category: 'Auth & Users',
    description: 'Active login sessions per user.',
    fields: [
      f('id',               'UUID',    false, 'id', { pk: true }),
      f('userId',           'UUID',    false, 'user_id', { fk: 'User.id' }),
      f('ipAddress',        'String',  true,  'ip_address'),
      f('userAgent',        'String',  true,  'user_agent'),
      f('refreshTokenHash', 'String',  true,  'refresh_token_hash'),
      f('startedAt',        'DateTime',false, 'started_at'),
      f('expiresAt',        'DateTime',false, 'expires_at'),
      f('lastActivityAt',   'DateTime',false, 'last_activity_at'),
      f('isActive',         'Boolean', false, 'is_active'),
    ],
  },
  {
    name: 'Role',
    table: 'roles',
    category: 'Auth & Users',
    description: 'RBAC role scoped to an org.',
    fields: [
      f('id',              'UUID',    false, 'id', { pk: true }),
      f('orgId',           'UUID',    false, 'org_id', { fk: 'Organization.id' }),
      f('name',            'String',  false),
      f('description',     'String',  true),
      f('roleCategory',    'String',  false, 'role_category', { notes: 'ops | finance | admin | ...' }),
      f('isSystemDefault', 'Boolean', false, 'is_system_default'),
      f('isActive',        'Boolean', false, 'is_active'),
      f('clonedFrom',      'UUID',    true,  'cloned_from'),
      f('createdAt',       'DateTime',false, 'created_at'),
      f('updatedAt',       'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'RolePermission',
    table: 'role_permissions',
    category: 'Auth & Users',
    description: 'Module-level activity grants per role.',
    fields: [
      f('id',        'UUID',    false, 'id', { pk: true }),
      f('roleId',    'UUID',    false, 'role_id', { fk: 'Role.id' }),
      f('module',    'String',  false),
      f('activity',  'String',  false),
      f('dataScope', 'String',  false, 'data_scope', { notes: 'assigned | org | all' }),
      f('conditions','Json',    true),
      f('isGranted', 'Boolean', false, 'is_granted'),
    ],
  },
  {
    name: 'S3UserCredential',
    table: 's3_user_credentials',
    category: 'Auth & Users',
    description: 'SeaweedFS IAM credentials per user.',
    fields: [
      f('id',          'UUID',    false, 'id', { pk: true }),
      f('userId',      'UUID',    false, 'user_id', { fk: 'User.id' }),
      f('accessKeyId', 'String',  false, 'access_key_id', { unique: true }),
      f('keyHint',     'String',  true,  'key_hint', { notes: 'last 4 chars, display only' }),
      f('isActive',    'Boolean', false, 'is_active'),
      f('createdAt',   'DateTime',false, 'created_at'),
      f('expiresAt',   'DateTime',true,  'expires_at'),
    ],
  },
  {
    name: 'S3UserPolicy',
    table: 's3_user_policies',
    category: 'Auth & Users',
    description: 'Per-bucket RBAC policy for S3/SeaweedFS.',
    fields: [
      f('id',         'UUID',    false, 'id', { pk: true }),
      f('userId',     'UUID',    false, 'user_id', { fk: 'User.id' }),
      f('bucket',     'String',  false, 'bucket'),
      f('permission', 'Enum',    false, 'permission', { notes: 'READ | WRITE | READ_WRITE | ADMIN' }),
      f('grantedBy',  'String',  false, 'granted_by'),
      f('createdAt',  'DateTime',false, 'created_at'),
      f('updatedAt',  'DateTime',false, 'updated_at'),
    ],
  },

  // ── SHIPMENTS & WORKFLOW ──────────────────────────────────────────────────
  {
    name: 'Shipment',
    table: 'shipments',
    category: 'Shipments & Workflow',
    description: 'Core shipment entity. Hub for all documents and workflow state.',
    fields: [
      f('id',                 'UUID',   false, 'id', { pk: true }),
      f('orgId',              'UUID',   false, 'org_id', { fk: 'Organization.id' }),
      f('workflowTemplateId', 'UUID',   true,  'workflow_template_id', { fk: 'WorkflowTemplate.id' }),
      f('shipmentNumber',     'String', false, 'shipment_number', { unique: true }),
      f('status',             'String', false, 'status'),
      f('shipmentType',       'String', false, 'shipment_type'),
      f('origin',             'String', true),
      f('destination',        'String', true),
      f('exporterName',       'String', true,  'exporter_name'),
      f('importerName',       'String', true,  'importer_name'),
      f('commodity',          'String', true),
      f('etd',                'DateTime',true),
      f('eta',                'DateTime',true),
      f('assignedIndiaId',    'UUID',   true,  'assigned_india_id', { fk: 'User.id' }),
      f('assignedUsId',       'UUID',   true,  'assigned_us_id', { fk: 'User.id' }),
      f('createdById',        'UUID',   true,  'created_by_id', { fk: 'User.id' }),
      f('createdAt',          'DateTime',false,'created_at'),
      f('updatedAt',          'DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'WorkflowTemplate',
    table: 'workflow_templates',
    category: 'Shipments & Workflow',
    description: 'Reusable stage/activity blueprint for a shipment type.',
    fields: [
      f('id',           'UUID',    false, 'id', { pk: true }),
      f('orgId',        'UUID',    false, 'org_id', { fk: 'Organization.id' }),
      f('name',         'String',  false),
      f('description',  'String',  true),
      f('shipmentType', 'String',  false, 'shipment_type'),
      f('isActive',     'Boolean', false, 'is_active'),
      f('version',      'Int',     false),
      f('createdAt',    'DateTime',false, 'created_at'),
      f('updatedAt',    'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'WorkflowStage',
    table: 'workflow_stages',
    category: 'Shipments & Workflow',
    description: 'Ordered phase within a workflow template.',
    fields: [
      f('id',                'UUID',    false, 'id', { pk: true }),
      f('templateId',        'UUID',    false, 'template_id', { fk: 'WorkflowTemplate.id' }),
      f('name',              'String',  false),
      f('description',       'String',  true),
      f('stageOrder',        'Int',     false, 'stage_order'),
      f('isBlockingGate',    'Boolean', false, 'is_blocking_gate'),
      f('gateConditionType', 'String',  true,  'gate_condition_type'),
      f('gateConditions',    'Json',    true,  'gate_conditions'),
    ],
  },
  {
    name: 'TaskInstance',
    table: 'task_instances',
    category: 'Shipments & Workflow',
    description: 'A unit of work assigned to a user within a shipment stage.',
    fields: [
      f('id',           'UUID',    false, 'id', { pk: true }),
      f('shipmentId',   'UUID',    false, 'shipment_id', { fk: 'Shipment.id' }),
      f('stageId',      'UUID',    true,  'stage_id', { fk: 'WorkflowStage.id' }),
      f('title',        'String',  false),
      f('description',  'String',  true),
      f('status',       'String',  false, 'status', { notes: 'pending | in_progress | done | skipped' }),
      f('dueDate',      'DateTime',true,  'due_date'),
      f('completedById','UUID',    true,  'completed_by_id', { fk: 'User.id' }),
      f('completedAt',  'DateTime',true,  'completed_at'),
      f('createdAt',    'DateTime',false, 'created_at'),
      f('updatedAt',    'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'AuditLog',
    table: 'audit_logs',
    category: 'Shipments & Workflow',
    description: 'Immutable event trail for all user and system actions.',
    fields: [
      f('id',        'UUID',    false, 'id', { pk: true }),
      f('orgId',     'UUID',    false, 'org_id', { fk: 'Organization.id' }),
      f('userId',    'UUID',    true,  'user_id', { fk: 'User.id' }),
      f('action',    'String',  false),
      f('entity',    'String',  false, 'entity', { notes: 'document | shipment | user | ...' }),
      f('entityId',  'String',  true,  'entity_id'),
      f('payload',   'Json',    true),
      f('createdAt', 'DateTime',false, 'created_at'),
    ],
  },

  // ── DOCUMENTS ─────────────────────────────────────────────────────────────
  {
    name: 'Document',
    table: 'documents',
    category: 'Documents',
    description: 'Every uploaded file. Owns the extraction back-relations for all 18 doc types.',
    fields: [
      f('id',          'UUID',   false, 'id', { pk: true }),
      f('orgId',       'UUID',   false, 'org_id', { fk: 'Organization.id' }),
      f('shipmentId',  'UUID',   true,  'shipment_id', { fk: 'Shipment.id' }),
      f('stageId',     'UUID',   true,  'stage_id', { fk: 'WorkflowStage.id' }),
      f('docType',     'Enum',   false, 'doc_type', { notes: 'DocType enum — 18 values' }),
      f('status',      'Enum',   false, 'status', { notes: 'UPLOADED|QUEUED|PROCESSING|EXTRACTED|REVIEWED|REJECTED|REPROCESSING|ARCHIVED' }),
      f('bucket',      'String', false),
      f('objectKey',   'String', false, 'object_key'),
      f('fileName',    'String', false, 'file_name'),
      f('contentType', 'String', false, 'content_type'),
      f('sizeBytes',   'BigInt', false, 'size_bytes'),
      f('checksum',    'String', true),
      f('totalPages',  'Int',    true,  'total_pages'),
      f('uploadedBy',  'UUID',   false, 'uploaded_by', { fk: 'User.id' }),
      f('approvedBy',  'UUID',   true,  'approved_by', { fk: 'User.id' }),
      f('approvedAt',  'DateTime',true, 'approved_at'),
      f('isDeleted',   'Boolean',false, 'is_deleted'),
      f('deletedAt',   'DateTime',true, 'deleted_at'),
      f('createdAt',   'DateTime',false,'created_at'),
      f('updatedAt',   'DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'DocumentPage',
    table: 'document_pages',
    category: 'Documents',
    description: 'One page image/text per document, used as extraction source.',
    fields: [
      f('id',                'UUID',   false, 'id', { pk: true }),
      f('documentId',        'UUID',   false, 'document_id', { fk: 'Document.id' }),
      f('pageNo',            'Int',    false, 'page_no'),
      f('bucket',            'String', false),
      f('objectKey',         'String', false, 'object_key'),
      f('width',             'Int',    true),
      f('height',            'Int',    true),
      f('sizeBytes',         'BigInt', true,  'size_bytes'),
      f('rawText',           'String', true,  'raw_text'),
      f('isExtractionSource','Boolean',false, 'is_extraction_source'),
      f('createdAt',         'DateTime',false,'created_at'),
    ],
  },
  {
    name: 'DocumentVersion',
    table: 'document_versions',
    category: 'Documents',
    description: 'Version history for re-uploaded documents.',
    fields: [
      f('id',         'UUID',   false, 'id', { pk: true }),
      f('documentId', 'UUID',   false, 'document_id', { fk: 'Document.id' }),
      f('versionNo',  'Int',    false, 'version_no'),
      f('bucket',     'String', false),
      f('objectKey',  'String', false, 'object_key'),
      f('fileName',   'String', false, 'file_name'),
      f('sizeBytes',  'BigInt', false, 'size_bytes'),
      f('uploadedBy', 'UUID',   false, 'uploaded_by', { fk: 'User.id' }),
      f('createdAt',  'DateTime',false,'created_at'),
    ],
  },
  {
    name: 'DocumentTypeConfig',
    table: 'document_type_configs',
    category: 'Documents',
    description: 'Per-org config for each doc type (required, auto-extract, etc.).',
    fields: [
      f('id',          'UUID',    false, 'id', { pk: true }),
      f('orgId',       'UUID',    false, 'org_id', { fk: 'Organization.id' }),
      f('docType',     'Enum',    false, 'doc_type'),
      f('isRequired',  'Boolean', false, 'is_required'),
      f('autoExtract', 'Boolean', false, 'auto_extract'),
      f('config',      'Json',    true),
      f('updatedAt',   'DateTime',false, 'updated_at'),
    ],
  },

  // ── AI & EXTRACTION CORE ──────────────────────────────────────────────────
  {
    name: 'ExtractionLog',
    table: 'extraction_logs',
    category: 'AI & Extraction Core',
    description: 'Celery task record for each AI extraction run.',
    fields: [
      f('id',           'UUID',   false, 'id', { pk: true }),
      f('documentId',   'UUID',   false, 'document_id', { fk: 'Document.id' }),
      f('pageId',       'UUID',   true,  'page_id', { fk: 'DocumentPage.id', notes: 'null = full-doc run' }),
      f('celeryTaskId', 'String', true,  'celery_task_id', { unique: true }),
      f('model',        'String', false, 'model', { notes: 'e.g. gemini-2.0-flash' }),
      f('status',       'Enum',   false, 'status', { notes: 'QUEUED|RUNNING|SUCCESS|FAILED|RETRYING' }),
      f('confidence',   'Enum',   true,  'confidence', { notes: 'HIGH | MEDIUM | LOW' }),
      f('tokensUsed',   'Int',    true,  'tokens_used'),
      f('processingMs', 'Int',    true,  'processing_ms'),
      f('errorMessage', 'String', true,  'error_message'),
      f('retryCount',   'Int',    false, 'retry_count'),
      f('isLatest',     'Boolean',false, 'is_latest'),
      f('triggeredBy',  'String', true,  'triggered_by', { notes: 'userId or "system"' }),
      f('createdAt',    'DateTime',false,'created_at'),
      f('completedAt',  'DateTime',true, 'completed_at'),
    ],
  },
  {
    name: 'AiModelRegistry',
    table: 'ai_model_registry',
    category: 'AI & Extraction Core',
    description: 'Catalog of AI models with pricing snapshots.',
    fields: [
      f('id',                  'UUID',    false, 'id', { pk: true }),
      f('modelId',             'String',  false, 'model_id', { unique: true, notes: 'e.g. gemini-2.0-flash' }),
      f('provider',            'String',  false, 'provider', { notes: 'google | openai | alibaba | local' }),
      f('displayName',         'String',  false, 'display_name'),
      f('version',             'String',  true),
      f('isActive',            'Boolean', false, 'is_active'),
      f('isLocal',             'Boolean', false, 'is_local'),
      f('inputPricePer1M',     'Decimal', false, 'input_price_per_1m'),
      f('outputPricePer1M',    'Decimal', false, 'output_price_per_1m'),
      f('imagePricePer1K',     'Decimal', true,  'image_price_per_1k'),
      f('contextWindowTokens', 'Int',     true,  'context_window_tokens'),
      f('supportsVision',      'Boolean', false, 'supports_vision'),
      f('supportsOcr',         'Boolean', false, 'supports_ocr'),
      f('createdAt',           'DateTime',false, 'created_at'),
      f('updatedAt',           'DateTime',false, 'updated_at'),
    ],
  },
  {
    name: 'AiUsageRecord',
    table: 'ai_usage_records',
    category: 'AI & Extraction Core',
    description: 'Per-call cost ledger for all AI API calls.',
    fields: [
      f('id',                 'UUID',    false, 'id', { pk: true }),
      f('documentId',         'UUID',    false, 'document_id', { fk: 'Document.id' }),
      f('pageId',             'UUID',    true,  'page_id', { fk: 'DocumentPage.id' }),
      f('extractionLogId',    'UUID',    true,  'extraction_log_id'),
      f('modelRegistryId',    'UUID',    false, 'model_registry_id', { fk: 'AiModelRegistry.id' }),
      f('modelId',            'String',  false, 'model_id', { notes: 'snapshot at call time' }),
      f('provider',           'String',  false),
      f('inputTokens',        'Int',     false, 'input_tokens'),
      f('outputTokens',       'Int',     false, 'output_tokens'),
      f('totalTokens',        'Int',     false, 'total_tokens'),
      f('imageCount',         'Int',     true,  'image_count'),
      f('snapshotInputPrice', 'Decimal', false, 'snapshot_input_price'),
      f('snapshotOutputPrice','Decimal', false, 'snapshot_output_price'),
      f('inputCostUsd',       'Decimal', false, 'input_cost_usd'),
      f('outputCostUsd',      'Decimal', false, 'output_cost_usd'),
      f('imageCostUsd',       'Decimal', false, 'image_cost_usd'),
      f('totalCostUsd',       'Decimal', false, 'total_cost_usd'),
      f('docType',            'Enum',    false, 'doc_type'),
      f('taskType',           'String',  false, 'task_type', { notes: 'extraction|ocr|validation|retry' }),
      f('processingMs',       'Int',     true,  'processing_ms'),
      f('isRetry',            'Boolean', false, 'is_retry'),
      f('promptVersion',      'String',  true,  'prompt_version'),
      f('calledAt',           'DateTime',false, 'called_at'),
    ],
  },

  // ── EXTRACTION: INDIA EXPORT ──────────────────────────────────────────────
  {
    name: 'BillOfLading',
    table: 'bills_of_lading',
    category: 'Extraction: India Export',
    description: 'Parsed BOL fields. Child arrays: exportInvoices, containers, shippingBills.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),
      f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('bolNumber','String',true,'bol_number'),
      f('shipmentReferenceNumber','String',true,'shipment_reference_number'),
      f('negotiability','String',true),
      f('projectName','String',true,'project_name'),
      f('shipsRemarks','String',true,'ships_remarks'),
      f('documentCategory','String',true,'document_category'),
      f('carrierCompanyName','String',true,'carrier_company_name'),
      f('carrierMtoRegistrationNumber','String',true,'carrier_mto_registration_number'),
      f('carrierFmcNumber','String',true,'carrier_fmc_number'),
      f('shipperName','String',true,'shipper_name'),
      f('shipperAddress','String',true,'shipper_address'),
      f('consigneeName','String',true,'consignee_name'),
      f('consigneeAddress','String',true,'consignee_address'),
      f('consigneeContactName','String',true,'consignee_contact_name'),
      f('consigneePhone','String',true,'consignee_phone'),
      f('consigneeEmail','String',true,'consignee_email'),
      f('notifyPartyName','String',true,'notify_party_name'),
      f('notifyPartyAddress','String',true,'notify_party_address'),
      f('notifyPartyEmail','String',true,'notify_party_email'),
      f('notifyPartyPhone','String',true,'notify_party_phone'),
      f('secondNotifyName','String',true,'second_notify_name'),
      f('secondNotifyAddress','String',true,'second_notify_address'),
      f('deliveryAgentName','String',true,'delivery_agent_name'),
      f('deliveryAgentAddress','String',true,'delivery_agent_address'),
      f('deliveryAgentPhone','String',true,'delivery_agent_phone'),
      f('deliveryAgentEmail','String',true,'delivery_agent_email'),
      f('placeOfAcceptance','String',true,'place_of_acceptance'),
      f('portOfLoading','String',true,'port_of_loading'),
      f('placeOfReceipt','String',true,'place_of_receipt'),
      f('countryOfOrigin','String',true,'country_of_origin'),
      f('portOfDischarge','String',true,'port_of_discharge'),
      f('finalDestination','String',true,'final_destination'),
      f('placeOfDelivery','String',true,'place_of_delivery'),
      f('transhipmentPlace','String',true,'transhipment_place'),
      f('vesselName','String',true,'vessel_name'),
      f('vesselVoyageNumber','String',true,'vessel_voyage_number'),
      f('shippedOnBoardDate','String',true,'shipped_on_board_date'),
      f('vesselCarrierName','String',true,'vessel_carrier_name'),
      f('marksAndNumbers','String',true,'marks_and_numbers'),
      f('packageSummary','String',true,'package_summary'),
      f('totalPackages','String',true,'total_packages'),
      f('totalContainers','String',true,'total_containers'),
      f('goodsDescription','String',true,'goods_description'),
      f('grossWeight','String',true,'gross_weight'),
      f('grossWeightUnit','String',true,'gross_weight_unit'),
      f('netWeight','String',true,'net_weight'),
      f('netWeightUnit','String',true,'net_weight_unit'),
      f('measurementCbm','String',true,'measurement_cbm'),
      f('usHsnc','String',true,'us_hsnc'),
      f('iecNumber','String',true,'iec_number'),
      f('freightAmount','String',true,'freight_amount'),
      f('freightPayableAt','String',true,'freight_payable_at'),
      f('freightType','String',true,'freight_type'),
      f('fobCharges','String',true,'fob_charges'),
      f('issuancePlace','String',true,'issuance_place'),
      f('issuanceDate','String',true,'issuance_date'),
      f('numberOfOriginals','String',true,'number_of_originals'),
      f('charterPartyDate','String',true,'charter_party_date'),
      f('exportInvoiceNumber','String',true,'export_invoice_number'),
      f('exportInvoiceDate','String',true,'export_invoice_date'),
      f('exportShippingBillNumber','String',true,'export_shipping_bill_number'),
      f('exportShippingBillDate','String',true,'export_shipping_bill_date'),
      f('rawData','Json',true,'raw_data'),
      f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),
      f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),
      f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'SalesInvoiceExtraction',
    table: 'sales_invoice_extractions',
    category: 'Extraction: India Export',
    description: 'Indian commercial/export invoice. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('adCode','String',true,'ad_code'),f('cinNo','String',true,'cin_no'),f('gstin','String',true),
      f('irnNumber','String',true,'irn_number'),f('panNo','String',true,'pan_no'),f('rotationNo','String',true,'rotation_no'),
      f('signature','String',true),f('buyerName','String',true,'buyer_name'),f('buyerAddress','String',true,'buyer_address'),
      f('consigneeName','String',true,'consignee_name'),f('consigneeAddress','String',true,'consignee_address'),
      f('exporterName','String',true,'exporter_name'),f('exporterAddress','String',true,'exporter_address'),
      f('iec','String',true),f('notifyParty','String',true,'notify_party'),f('shipTo','String',true,'ship_to'),
      f('bankName','String',true,'bank_name'),f('bankAccountNo','String',true,'bank_account_no'),
      f('bankBranch','String',true,'bank_branch'),f('currency','String',true),f('ifscCode','String',true,'ifsc_code'),
      f('swiftCode','String',true,'swift_code'),f('incoterms','String',true),f('paymentTerms','String',true,'payment_terms'),
      f('taxAmount','String',true,'tax_amount'),f('cess','String',true),f('taxableValue','String',true,'taxable_value'),
      f('totalAmount','String',true,'total_amount'),f('invoiceNo','String',true,'invoice_no'),
      f('invoiceDate','String',true,'invoice_date'),f('buyerPoNo','String',true,'buyer_po_no'),
      f('buyerPoDate','String',true,'buyer_po_date'),f('zetwerkRef','String',true,'zetwerk_ref'),
      f('shippingBillNo','String',true,'shipping_bill_no'),f('shippingBillDate','String',true,'shipping_bill_date'),
      f('exporterEmail','String',true,'exporter_email'),f('invoiceType','String',true,'invoice_type'),
      f('lutArnNo','String',true,'lut_arn_no'),f('issueDate','String',true,'issue_date'),
      f('otherReferences','String',true,'other_references'),f('dispatchedThrough','String',true,'dispatched_through'),
      f('countryOfFinalDestination','String',true,'country_of_final_destination'),
      f('countryOfOrigin','String',true,'country_of_origin'),f('finalDestination','String',true,'final_destination'),
      f('placeOfReceipt','String',true,'place_of_receipt'),f('portOfDischarge','String',true,'port_of_discharge'),
      f('portOfLoading','String',true,'port_of_loading'),f('vesselFlightNo','String',true,'vessel_flight_no'),
      f('grossWeight','String',true,'gross_weight'),f('totalQuantity','String',true,'total_quantity'),
      f('packageDescription','String',true,'package_description'),f('preCarriageBy','String',true,'pre_carriage_by'),
      f('marksAndNumbers','String',true,'marks_and_numbers'),f('signatoryDesignation','String',true,'signatory_designation'),
      f('signatoryName','String',true,'signatory_name'),f('digitalSignatureDate','String',true,'digital_signature_date'),
      f('digitalSignatureLocation','String',true,'digital_signature_location'),
      f('digitalSignatureStatus','String',true,'digital_signature_status'),
      f('receivablesAssignmentBeneficiary','String',true,'receivables_assignment_beneficiary'),
      f('dinNumber','String',true,'din_number'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'PackingListExtraction',
    table: 'packing_list_extractions',
    category: 'Extraction: India Export',
    description: 'Indian packing list. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('gstin','String',true),f('signature','String',true),f('buyerName','String',true,'buyer_name'),
      f('buyerAddress','String',true,'buyer_address'),f('consigneeName','String',true,'consignee_name'),
      f('consigneeAddress','String',true,'consignee_address'),f('exporterName','String',true,'exporter_name'),
      f('exporterAddress','String',true,'exporter_address'),f('iec','String',true),f('shipTo','String',true,'ship_to'),
      f('invoiceNo','String',true,'invoice_no'),f('invoiceDate','String',true,'invoice_date'),
      f('buyerPoNo','String',true,'buyer_po_no'),f('buyerPoDate','String',true,'buyer_po_date'),
      f('zetwerkRef','String',true,'zetwerk_ref'),f('otherReferences','String',true,'other_references'),
      f('pickupAddress','String',true,'pickup_address'),f('totalBundles','String',true,'total_bundles'),
      f('totalQty','String',true,'total_qty'),f('totalNetWeightKgs','String',true,'total_net_weight_kgs'),
      f('totalGrossWeightKgs','String',true,'total_gross_weight_kgs'),
      f('countryOfFinalDestination','String',true,'country_of_final_destination'),
      f('countryOfOrigin','String',true,'country_of_origin'),f('finalDestination','String',true,'final_destination'),
      f('placeOfReceipt','String',true,'place_of_receipt'),f('portOfDischarge','String',true,'port_of_discharge'),
      f('portOfLoading','String',true,'port_of_loading'),f('vesselFlightNo','String',true,'vessel_flight_no'),
      f('preCarriageBy','String',true,'pre_carriage_by'),f('signatoryDesignation','String',true,'signatory_designation'),
      f('signatoryName','String',true,'signatory_name'),f('dinNumber','String',true,'din_number'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'ShippingBillExtraction',
    table: 'shipping_bill_extractions',
    category: 'Extraction: India Export',
    description: 'Indian customs shipping bill (ICEGATE). Child arrays: part1–5 sections.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('portCode','String',true,'port_code'),f('portName','String',true,'port_name'),
      f('sbNo','String',true,'sb_no'),f('sbDate','String',true,'sb_date'),
      f('iecBr','String',true,'iec_br'),f('gstinType','String',true,'gstin_type'),
      f('cbCode','String',true,'cb_code'),f('exporterNameAddress','String',true,'exporter_name_address'),
      f('consigneeNameAddress','String',true,'consignee_name_address'),f('cbName','String',true,'cb_name'),
      f('pkgCount','String',true,'pkg_count'),f('leoNo','String',true,'leo_no'),
      f('leoDate','String',true,'leo_date'),f('brcRealisationDate','String',true,'brc_realisation_date'),
      f('vesselName','String',true,'vessel_name'),f('portOfLoading','String',true,'port_of_loading'),
      f('portOfDischarge','String',true,'port_of_discharge'),
      f('countryOfFinalDest','String',true,'country_of_final_dest'),
      f('grossWeightKgs','String',true,'gross_weight_kgs'),
      f('invCount','String',true,'inv_count'),f('itemCount','String',true,'item_count'),f('contCount','String',true,'cont_count'),
      f('sectionAStatusMode','String',true,'section_a_status_mode'),
      f('sectionAStatusAssess','String',true,'section_a_status_assess'),
      f('sectionAStatusMeis','String',true,'section_a_status_meis'),
      f('sectionAStatusDbk','String',true,'section_a_status_dbk'),
      f('sectionAStatusLut','String',true,'section_a_status_lut'),
      f('sectionAStatusPortOfLoading','String',true,'section_a_status_port_of_loading'),
      f('sectionAStatusStateOfOrigin','String',true,'section_a_status_state_of_origin'),
      f('sectionBDeclarantExporterNameAndAddress','String',true,'section_b_declarant_exporter_name_and_address'),
      f('sectionBDeclarantAdCode','String',true,'section_b_declarant_ad_code'),
      f('sectionBDeclarantCbName','String',true,'section_b_declarant_cb_name'),
      f('sectionBDeclarantConsigneeNameAndAddress','String',true,'section_b_declarant_consignee_name_and_address'),
      f('sectionBDeclarantForexBankAcNo','String',true,'section_b_declarant_forex_bank_ac_no'),
      f('sectionBDeclarantDbkBankAcNo','String',true,'section_b_declarant_dbk_bank_ac_no'),
      f('sectionBTransactionPartiesExporterNameAndAddress','String',true,'section_b_transaction_parties_exporter_name_and_address'),
      f('sectionBTransactionPartiesBuyerNameAndAddress','String',true,'section_b_transaction_parties_buyer_name_and_address'),
      f('sectionCValueSummaryFobValue','String',true,'section_c_value_summary_fob_value'),
      f('sectionCValueSummaryFreight','String',true,'section_c_value_summary_freight'),
      f('sectionCValueSummaryInsurance','String',true,'section_c_value_summary_insurance'),
      f('sectionCValueSummaryDbkClaim','String',true,'section_c_value_summary_dbk_claim'),
      f('sectionCValueSummaryIgstAmt','String',true,'section_c_value_summary_igst_amt'),
      f('sectionDExportPromotionDbkClaim','String',true,'section_d_export_promotion_dbk_claim'),
      f('sectionDExportPromotionIgstAmt','String',true,'section_d_export_promotion_igst_amt'),
      f('sectionDExportPromotionRoDtepAmt','String',true,'section_d_export_promotion_ro_dtep_amt'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'ChaBillExtraction',
    table: 'cha_bill_extractions',
    category: 'Extraction: India Export',
    description: 'CHA (Customs House Agent) bill. Child arrays: containers, charges, taxSummary, bankDetails, flags.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('documentType','String',true,'document_type'),f('taxType','String',true,'tax_type'),
      f('issuerCompanyName','String',true,'issuer_company_name'),f('issuerAddress','String',true,'issuer_address'),
      f('issuerCin','String',true,'issuer_cin'),f('issuerPan','String',true,'issuer_pan'),
      f('issuerGstin','String',true,'issuer_gstin'),f('invoiceNumber','String',true,'invoice_number'),
      f('invoiceDate','String',true,'invoice_date'),f('dueDate','String',true,'due_date'),
      f('paymentTerms','String',true,'payment_terms'),f('irn','String',true),
      f('irnAckNumber','String',true,'irn_ack_number'),f('irnAckTime','String',true,'irn_ack_time'),
      f('customerName','String',true,'customer_name'),f('customerAddress','String',true,'customer_address'),
      f('customerGstin','String',true,'customer_gstin'),f('customerShipmentNumber','String',true,'customer_shipment_number'),
      f('shipmentShipper','String',true,'shipment_shipper'),f('shipmentConsignee','String',true,'shipment_consignee'),
      f('shipmentVesselName','String',true,'shipment_vessel_name'),f('shipmentMbl','String',true,'shipment_mbl'),
      f('shipmentHbl','String',true,'shipment_hbl'),f('shipmentOrigin','String',true,'shipment_origin'),
      f('shipmentDestination','String',true,'shipment_destination'),
      f('jobNumber','String',true,'job_number'),f('jobDate','String',true,'job_date'),
      f('containersRaw','String',true,'containers_raw'),
      f('totalsSubtotal','String',true,'totals_subtotal'),f('totalsIgstAmount','String',true,'totals_igst_amount'),
      f('totalsCgstAmount','String',true,'totals_cgst_amount'),f('totalsSgstAmount','String',true,'totals_sgst_amount'),
      f('totalsGrandTotalInr','String',true,'totals_grand_total_inr'),f('totalsAmountInWords','String',true,'totals_amount_in_words'),
      f('lutBondReference','String',true,'lut_bond_reference'),f('digitalSignature','String',true,'digital_signature'),
      f('bookingNumber','String',true,'booking_number'),f('remarks','String',true),
      f('extractionConfidence','String',true,'extraction_confidence'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },

  // ── EXTRACTION: US IMPORT ─────────────────────────────────────────────────
  {
    name: 'EntrySummaryExtraction',
    table: 'entry_summary_extractions',
    category: 'Extraction: US Import',
    description: 'CBP Form 7501 entry summary. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('filerCodeEntryNumber','String',true,'filer_code_entry_number'),f('entryType','String',true,'entry_type'),
      f('summaryDate','String',true,'summary_date'),f('suretyNumber','String',true,'surety_number'),
      f('bondType','String',true,'bond_type'),f('portCode','String',true,'port_code'),
      f('entryDate','String',true,'entry_date'),f('teamNumber','String',true,'team_number'),
      f('summaryStatus','String',true,'summary_status'),f('formVersion','String',true,'form_version'),
      f('importingCarrier','String',true,'importing_carrier'),f('modeOfTransport','String',true,'mode_of_transport'),
      f('importDate','String',true,'import_date'),f('blOrAwbNumber','String',true,'bl_or_awb_number'),
      f('houseBill','String',true,'house_bill'),f('manufacturerId','String',true,'manufacturer_id'),
      f('exportingCountry','String',true,'exporting_country'),f('exportDate','String',true,'export_date'),
      f('foreignPortOfLading','String',true,'foreign_port_of_lading'),f('usPortOfUnlading','String',true,'us_port_of_unlading'),
      f('countryOfOrigin','String',true,'country_of_origin'),f('locationOfGoods','String',true,'location_of_goods'),
      f('consigneeNumber','String',true,'consignee_number'),f('importerNumber','String',true,'importer_number'),
      f('ultimateConsigneeName','String',true,'ultimate_consignee_name'),
      f('ultimateConsigneeAddress','String',true,'ultimate_consignee_address'),
      f('importerOfRecordName','String',true,'importer_of_record_name'),
      f('importerOfRecordAddress','String',true,'importer_of_record_address'),
      f('countryOfMeltAndPour','String',true,'country_of_melt_and_pour'),
      f('mpfTotal','String',true,'mpf_total'),f('hmfTotal','String',true,'hmf_total'),
      f('totalEnteredValue','String',true,'total_entered_value'),f('totalDuty','String',true,'total_duty'),
      f('grandTotal','String',true,'grand_total'),f('declarantName','String',true,'declarant_name'),
      f('declarantCompany','String',true,'declarant_company'),f('brokerName','String',true,'broker_name'),
      f('brokerAddress','String',true,'broker_address'),f('brokerPhone','String',true,'broker_phone'),
      f('brokerImporterFileNumber','String',true,'broker_importer_file_number'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'UsCargoReleaseExtraction',
    table: 'us_cargo_release_extractions',
    category: 'Extraction: US Import',
    description: 'ISF / cargo release order from customs broker.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('customsBroker','String',true,'customs_broker'),f('brokerContact','String',true,'broker_contact'),
      f('brokerAddress','String',true,'broker_address'),f('brokerReferenceNumber','String',true,'broker_reference_number'),
      f('importerAndConsignee','String',true,'importer_and_consignee'),
      f('importerAndConsigneeAddress','String',true,'importer_and_consignee_address'),
      f('releasePort','String',true,'release_port'),f('entryNumber','String',true,'entry_number'),
      f('portUnlading','String',true,'port_unlading'),f('statementPrintDate','String',true,'statement_print_date'),
      f('scac','String',true),f('truckVesselFlight','String',true,'truck_vessel_flight'),
      f('itNumber','String',true,'it_number'),f('masterBillOfLading','String',true,'master_bill_of_lading'),
      f('houseBill1And2','String',true,'house_bill_1_and_2'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'UsCustomsReleaseExtraction',
    table: 'us_customs_release_extractions',
    category: 'Extraction: US Import',
    description: 'CBP customs release notice.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('customsBroker','String',true,'customs_broker'),f('brokerContact','String',true,'broker_contact'),
      f('importerNumber','String',true,'importer_number'),f('importerNameAndAddress','String',true,'importer_name_and_address'),
      f('bondType','String',true,'bond_type'),f('entryType','String',true,'entry_type'),
      f('portOfEntry','String',true,'port_of_entry'),f('entryNumber','String',true,'entry_number'),
      f('portOfUnlading','String',true,'port_of_unlading'),f('modeOfTransportation','String',true,'mode_of_transportation'),
      f('locationOfGoodsFirms','String',true,'location_of_goods_firms'),
      f('manufacturer','String',true),f('grossWeight','String',true,'gross_weight'),
      f('totalUnits','String',true,'total_units'),f('containers','String',true),
      f('billOfLadingInformation','String',true,'bill_of_lading_information'),
      f('signatureOfApplicantAndDate','String',true,'signature_of_applicant_and_date'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'UsDeliveryOrderExtraction',
    table: 'us_delivery_order_extractions',
    category: 'Extraction: US Import',
    description: 'Delivery order (DO) issued by freight forwarder for cargo release.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('shipperName','String',true,'shipper_name'),f('shipperAddress','String',true,'shipper_address'),
      f('consigneeName','String',true,'consignee_name'),f('consigneeAddress','String',true,'consignee_address'),
      f('billToParty','String',true,'bill_to_party'),f('deliveryOrderDate','String',true,'delivery_order_date'),
      f('doReferenceNumberDamco','String',true,'do_reference_number_damco'),
      f('itNumber','String',true,'it_number'),f('itDate','String',true,'it_date'),
      f('customerReference','String',true,'customer_reference'),
      f('importingCarrier','String',true,'importing_carrier'),f('deliveringCarrier','String',true,'delivering_carrier'),
      f('portOfLoadingOrigin','String',true,'port_of_loading_origin'),
      f('portOfDischargeDestination','String',true,'port_of_discharge_destination'),
      f('blOrAwbNumber','String',true,'bl_or_awb_number'),f('masterNumber','String',true,'master_number'),
      f('houseBillNumbers','String',true,'house_bill_numbers'),f('arrivalDate','String',true,'arrival_date'),
      f('freeTimeExpirationDate','String',true,'free_time_expiration_date'),
      f('entryNumber','String',true,'entry_number'),f('cargoDescriptionCommodity','String',true,'cargo_description_commodity'),
      f('hsCode','String',true,'hs_code'),f('containerNumber','String',true,'container_number'),
      f('totalWeightKg','String',true,'total_weight_kg'),f('pickupLocation','String',true,'pickup_location'),
      f('deliveryLocation','String',true,'delivery_location'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },

  // ── EXTRACTION: FREIGHT & LOGISTICS ───────────────────────────────────────
  {
    name: 'OceanFreightExtraction',
    table: 'ocean_freight_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'Ocean freight invoice. Child arrays: containersList, taxSummaryEntries, charges.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('issuerCompanyName','String',true,'issuer_company_name'),f('issuerAddress','String',true,'issuer_address'),
      f('issuerGstNumber','String',true,'issuer_gst_number'),f('issuerPanNumber','String',true,'issuer_pan_number'),
      f('invoiceNumber','String',true,'invoice_number'),f('invoiceDate','String',true,'invoice_date'),
      f('dueDate','String',true,'due_date'),f('paymentTerms','String',true,'payment_terms'),
      f('shipmentNumber','String',true,'shipment_number'),f('consolNumber','String',true,'consol_number'),
      f('jobNumber','String',true,'job_number'),f('irn','String',true),
      f('customerName','String',true,'customer_name'),f('customerAddress','String',true,'customer_address'),
      f('shipper','String',true),f('consignee','String',true),f('vesselName','String',true,'vessel_name'),
      f('voyageNumber','String',true,'voyage_number'),f('loadingPort','String',true,'loading_port'),
      f('dischargingPort','String',true,'discharging_port'),f('etd','String',true),f('eta','String',true),
      f('blDate','String',true,'bl_date'),f('oceanBol','String',true,'ocean_bol'),
      f('houseBol','String',true,'house_bol'),f('goodsDescription','String',true,'goods_description'),
      f('cargoWeightKg','String',true,'cargo_weight_kg'),f('cargoVolumeCbm','String',true,'cargo_volume_cbm'),
      f('containersTotalCount','String',true,'containers_total_count'),
      f('subtotalUsd','String',true,'subtotal_usd'),f('addCgst','String',true,'add_cgst'),
      f('addSgst','String',true,'add_sgst'),f('totalUsd','String',true,'total_usd'),
      f('bankBeneficiaryName','String',true,'bank_beneficiary_name'),f('bankName','String',true,'bank_name'),
      f('bankAccountNumber','String',true,'bank_account_number'),f('bankSwiftCode','String',true,'bank_swift_code'),
      f('bankIfscCode','String',true,'bank_ifsc_code'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'FreightForwarderBillExtraction',
    table: 'freight_forwarder_bill_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'FF house bill / invoice. Child arrays: containersList, taxSummaryEntries, charges.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('issuerCompanyName','String',true,'issuer_company_name'),f('issuerGstNumber','String',true,'issuer_gst_number'),
      f('issuerPanNumber','String',true,'issuer_pan_number'),f('issuerStateCode','String',true,'issuer_state_code'),
      f('invoiceNumber','String',true,'invoice_number'),f('invoiceDate','String',true,'invoice_date'),
      f('currency','String',true),f('dueDate','String',true,'due_date'),
      f('shipmentNumber','String',true,'shipment_number'),f('consolNumber','String',true,'consol_number'),
      f('jobNumber','String',true,'job_number'),f('irn','String',true),
      f('irnAckNumber','String',true,'irn_ack_number'),f('irnAckTime','String',true,'irn_ack_time'),
      f('customerName','String',true,'customer_name'),f('customerAttentionName','String',true,'customer_attention_name'),
      f('customerGstNumber','String',true,'customer_gst_number'),f('customerPanNumber','String',true,'customer_pan_number'),
      f('shipper','String',true),f('consignee','String',true),
      f('transportMode','String',true,'transport_mode'),f('shipmentType','String',true,'shipment_type'),
      f('incoTerms','String',true,'inco_terms'),f('loadingPort','String',true,'loading_port'),
      f('dischargingPort','String',true,'discharging_port'),f('etd','String',true),f('eta','String',true),
      f('vesselName','String',true,'vessel_name'),f('voyageNumber','String',true,'voyage_number'),
      f('oceanBol','String',true,'ocean_bol'),f('houseBol','String',true,'house_bol'),
      f('goodsDescription','String',true,'goods_description'),f('hsCode','String',true,'hs_code'),
      f('sbNumbers','String',true,'sb_numbers'),f('customerInvoiceNumbers','String',true,'customer_invoice_numbers'),
      f('cargoGrossWeightKg','String',true,'cargo_gross_weight_kg'),f('cargoVolumeCbm','String',true,'cargo_volume_cbm'),
      f('containersTotalCount','String',true,'containers_total_count'),
      f('subtotalInr','String',true,'subtotal_inr'),f('igstAmount','String',true,'igst_amount'),
      f('totalInr','String',true,'total_inr'),f('netPayable','String',true,'net_payable'),
      f('bankBeneficiaryName','String',true,'bank_beneficiary_name'),f('bankName','String',true,'bank_name'),
      f('bankAccountNumber','String',true,'bank_account_number'),f('bankSwiftCode','String',true,'bank_swift_code'),
      f('bankIfscCode','String',true,'bank_ifsc_code'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'CustomerBrokerBillExtraction',
    table: 'customer_broker_bill_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'US customs broker invoice. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('invoiceNumber','String',true,'invoice_number'),f('invoiceDate','String',true,'invoice_date'),
      f('customerId','String',true,'customer_id'),f('paymentTerms','String',true,'payment_terms'),
      f('dueDate','String',true,'due_date'),f('billTo','String',true,'bill_to'),
      f('billToAddress','String',true,'bill_to_address'),f('shipper','String',true),f('consignee','String',true),
      f('vesselVoyage','String',true,'vessel_voyage'),f('origin','String',true),f('destination','String',true),
      f('oceanBol','String',true,'ocean_bol'),f('houseBol','String',true,'house_bol'),
      f('bookingNumber','String',true,'booking_number'),f('containers','String',true),
      f('goodsDescription','String',true,'goods_description'),f('entryNumber','String',true,'entry_number'),
      f('subtotal','String',true),f('totalAmount','String',true,'total_amount'),
      f('bankName','String',true,'bank_name'),f('accountNumberAbaRouting','String',true,'account_number_aba_routing'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'GrnInboundExtraction',
    table: 'grn_inbound_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'US warehouse GRN / inbound receiving sheet. Child array: destinationMarks.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('logisticsProvider','String',true,'logistics_provider'),f('accountName','String',true,'account_name'),
      f('containerNumber','String',true,'container_number'),f('containerSize','String',true,'container_size'),
      f('sealNumber','String',true,'seal_number'),f('truckingCo','String',true,'trucking_co'),
      f('freightBillNumber','String',true,'freight_bill_number'),f('brokerReference','String',true,'broker_reference'),
      f('customerReference','String',true,'customer_reference'),f('location','String',true),
      f('dateReceived','String',true,'date_received'),f('floorLoaded','String',true,'floor_loaded'),
      f('palletizedCargo','String',true,'palletized_cargo'),f('numberOfPallets','String',true,'number_of_pallets'),
      f('totalPieces','String',true,'total_pieces'),f('typeOfPackaging','String',true,'type_of_packaging'),
      f('totalPartsCount','String',true,'total_parts_count'),f('dimensions','String',true),f('weight','String',true),
      f('receivedBy','String',true,'received_by'),f('numberOfEmployees','String',true,'number_of_employees'),
      f('totalReceivingTime','String',true,'total_receiving_time'),f('notes','String',true),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'PortToWhExtraction',
    table: 'port_to_wh_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'Port-to-warehouse drayage invoice. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('invoice','String',true),f('invoiceDate','String',true,'invoice_date'),
      f('dueDate','String',true,'due_date'),f('paymentTerms','String',true,'payment_terms'),
      f('vendor','String',true),f('shipmentId','String',true,'shipment_id'),
      f('orderNumber','String',true,'order_number'),f('customerReferenceNumber','String',true,'customer_reference_number'),
      f('pickupLocation','String',true,'pickup_location'),f('pickupDate','String',true,'pickup_date'),
      f('deliveryLocation','String',true,'delivery_location'),f('deliveryDate','String',true,'delivery_date'),
      f('containerType','String',true,'container_type'),f('mbl','String',true),
      f('containerNumber','String',true,'container_number'),f('weightLbs','String',true,'weight_lbs'),
      f('subtotal','String',true),f('totalCharge','String',true,'total_charge'),
      f('storageDays','String',true,'storage_days'),f('permitWeight','String',true,'permit_weight'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'WhToCustomerExtraction',
    table: 'wh_to_customer_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'Warehouse-to-customer delivery invoice. Child arrays: lineItems, otherReferences.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('invoiceNumber','String',true,'invoice_number'),f('vendor','String',true),
      f('invoiceDate','String',true,'invoice_date'),f('dueDate','String',true,'due_date'),
      f('paymentTerms','String',true,'payment_terms'),f('billTo','String',true,'bill_to'),
      f('billToAddress','String',true,'bill_to_address'),f('poNumber','String',true,'po_number'),
      f('shipper','String',true),f('shipperAddress','String',true,'shipper_address'),
      f('consignee','String',true),f('consigneeAddress','String',true,'consignee_address'),
      f('pickupDate','String',true,'pickup_date'),f('deliveryDate','String',true,'delivery_date'),
      f('departureLocation','String',true,'departure_location'),f('destinationLocation','String',true,'destination_location'),
      f('commodityDescription','String',true,'commodity_description'),f('weightLbs','String',true,'weight_lbs'),
      f('serviceType','String',true,'service_type'),f('fscPercent','String',true,'fsc_percent'),
      f('fscAmount','String',true,'fsc_amount'),f('totalAmount','String',true,'total_amount'),
      f('bankName','String',true,'bank_name'),f('accountNumber','String',true,'account_number'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'UsSalesInvoiceExtraction',
    table: 'us_sales_invoice_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'US-side sales invoice from Zetwerk US entity. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('sellerCompany','String',true,'seller_company'),f('sellerCity','String',true,'seller_city'),
      f('sellerState','String',true,'seller_state'),f('sellerCountry','String',true,'seller_country'),
      f('invoiceDocumentType','String',true,'invoice_document_type'),f('date','String',true),
      f('invoiceNo','String',true,'invoice_no'),f('soNo','String',true,'so_no'),
      f('poNo','String',true,'po_no'),f('paymentTerms','String',true,'payment_terms'),
      f('shipToCompany','String',true,'ship_to_company'),f('shipToCity','String',true,'ship_to_city'),
      f('shipToState','String',true,'ship_to_state'),f('shipToCountry','String',true,'ship_to_country'),
      f('salesSubtotal','String',true,'sales_subtotal'),f('totalDiscount','String',true,'total_discount'),
      f('netAmount','String',true,'net_amount'),f('salesTax','String',true,'sales_tax'),
      f('total','String',true),f('balanceDue','String',true,'balance_due'),
      f('bankName','String',true,'bank_name'),f('accountNumber','String',true,'account_number'),
      f('swiftCode','String',true,'swift_code'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },
  {
    name: 'UsPackingListExtraction',
    table: 'us_packing_list_extractions',
    category: 'Extraction: Freight & Logistics',
    description: 'US-side packing slip. Child array: lineItems.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('documentId','UUID',false,'document_id',{fk:'Document.id',unique:true}),
      f('packingSlipNumber','String',true,'packing_slip_number'),f('soNumber','String',true,'so_number'),
      f('documentDate','String',true,'document_date'),f('shipperName','String',true,'shipper_name'),
      f('shipToName','String',true,'ship_to_name'),f('shipToAddress','String',true,'ship_to_address'),
      f('consigneeName','String',true,'consignee_name'),f('consigneeAddress','String',true,'consignee_address'),
      f('poNumber','String',true,'po_number'),f('projectName','String',true,'project_name'),
      f('bolNumber','String',true,'bol_number'),f('countryOfOrigin','String',true,'country_of_origin'),
      f('estimatedDeliveryDate','String',true,'estimated_delivery_date'),f('carrierName','String',true,'carrier_name'),
      f('totalLines','String',true,'total_lines'),f('totalPiecesAggregate','String',true,'total_pieces_aggregate'),
      f('totalBundlesAggregate','String',true,'total_bundles_aggregate'),f('totalWeightLbs','String',true,'total_weight_lbs'),
      f('rawData','Json',true,'raw_data'),f('extractedAt','DateTime',true,'extracted_at'),
      f('reviewedBy','String',true,'reviewed_by'),f('reviewedAt','DateTime',true,'reviewed_at'),
      f('createdAt','DateTime',false,'created_at'),f('updatedAt','DateTime',false,'updated_at'),
    ],
  },

  // ── CHILD TABLES ──────────────────────────────────────────────────────────
  {
    name: 'BillOfLadingExportInvoice',
    table: 'bill_of_lading_export_invoices',
    category: 'Child Tables',
    description: 'Export invoice references on a BOL.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('billOfLadingId','UUID',false,'bill_of_lading_id',{fk:'BillOfLading.id'}),
      f('itemIndex','String',true,'item_index'),f('invoiceNumber','String',true,'invoice_number'),f('invoiceDate','String',true,'invoice_date'),
    ],
  },
  {
    name: 'BillOfLadingContainer',
    table: 'bill_of_lading_containers',
    category: 'Child Tables',
    description: 'Container list on a BOL.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('billOfLadingId','UUID',false,'bill_of_lading_id',{fk:'BillOfLading.id'}),
      f('itemIndex','String',true,'item_index'),f('number','String',true),f('type','String',true),
      f('sealNumber','String',true,'seal_number'),f('grossWeightKg','String',true,'gross_weight_kg'),
      f('netWeightKg','String',true,'net_weight_kg'),f('packages','String',true),
      f('volumeCbm','String',true,'volume_cbm'),f('mode','String',true),
    ],
  },
  {
    name: 'BillOfLadingShippingBill',
    table: 'bill_of_lading_shipping_bills',
    category: 'Child Tables',
    description: 'Shipping bill cross-references on a BOL.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('billOfLadingId','UUID',false,'bill_of_lading_id',{fk:'BillOfLading.id'}),
      f('itemIndex','String',true,'item_index'),f('shippingBillNumber','String',true,'shipping_bill_number'),f('shippingBillDate','String',true,'shipping_bill_date'),
    ],
  },
  {
    name: 'SalesInvoiceLineItem',
    table: 'sales_invoice_line_items',
    category: 'Child Tables',
    description: 'Line items on a SalesInvoiceExtraction.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('salesInvoiceId','UUID',false,'sales_invoice_id',{fk:'SalesInvoiceExtraction.id'}),
      f('hsnCode','String',true,'hsn_code'),f('productCode','String',true,'product_code'),
      f('productDescription','String',true,'product_description'),f('productSpecification','String',true,'product_specification'),
      f('productPartNumber','String',true,'product_part_number'),f('noOfPackages','String',true,'no_of_packages'),
      f('quantity','String',true),f('unit','String',true),f('rate','String',true),f('lineTotal','String',true,'line_total'),
      f('taxRate','String',true,'tax_rate'),f('taxAmountPerLine','String',true,'tax_amount_per_line'),
      f('containerNo','String',true,'container_no'),f('sealNo','String',true,'seal_no'),
    ],
  },
  {
    name: 'PackingListLineItem',
    table: 'packing_list_line_items',
    category: 'Child Tables',
    description: 'Line items on a PackingListExtraction.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('packingListId','UUID',false,'packing_list_id',{fk:'PackingListExtraction.id'}),
      f('hsnCode','String',true,'hsn_code'),f('productCode','String',true,'product_code'),
      f('productDescription','String',true,'product_description'),f('productSpecification','String',true,'product_specification'),
      f('productMarks','String',true,'product_marks'),f('qtyPerBundle','String',true,'qty_per_bundle'),
      f('noOfBundles','String',true,'no_of_bundles'),f('totalQtyInPcs','String',true,'total_qty_in_pcs'),
      f('netWeightKgs','String',true,'net_weight_kgs'),f('grossWeightKgs','String',true,'gross_weight_kgs'),
    ],
  },
  {
    name: 'EntrySummaryLineItem',
    table: 'entry_summary_line_items',
    category: 'Child Tables',
    description: 'Tariff lines on an EntrySummaryExtraction.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('entrySummaryId','UUID',false,'entry_summary_id',{fk:'EntrySummaryExtraction.id'}),
      f('lineNo','String',true,'line_no'),f('invoiceNumber','String',true,'invoice_number'),
      f('units','String',true),f('merchandiseDescription','String',true,'merchandise_description'),
      f('htsusNumber','String',true,'htsus_number'),f('chargeableWeight','String',true,'chargeable_weight'),
      f('adValorem','String',true,'ad_valorem'),f('duty','String',true),f('irc','String',true),
    ],
  },
  {
    name: 'EntrySummaryTariffLineItem',
    table: 'entry_summary_tariff_line_items',
    category: 'Child Tables',
    description: 'Tariff sub-lines extracted with the parent CBP FORM 7501.',
    fields: [
      f('id','UUID',false,'id',{pk:true}),
      f('entrySummaryId','UUID',false,'entry_summary_id',{fk:'EntrySummaryExtraction.id'}),
      f('lineNo','String',true,'line_no'),
      f('htsusNumber','String',true,'htsus_number'),f('dutiableValue','String',true,'dutiable_value'),
      f('duty','String',true),f('adCvd','String',true,'ad_cvd'),f('irc','String',true),
      f('visaNumber','String',true,'visa_number'),f('spi','String',true),
      f('mpf','String',true),f('hmf','String',true),
    ],
  },
  {
    name: 'OceanFreightContainer',
    table: 'ocean_freight_containers',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('oceanFreightId','UUID',false,'ocean_freight_id',{fk:'OceanFreightExtraction.id'}),
      f('containerDetail','String',true,'container_detail'),
    ],
  },
  {
    name: 'OceanFreightTaxSummaryEntry',
    table: 'ocean_freight_tax_summary_entries',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('oceanFreightId','UUID',false,'ocean_freight_id',{fk:'OceanFreightExtraction.id'}),
      f('summaryEntry','String',true,'summary_entry'),
    ],
  },
  {
    name: 'OceanFreightCharge',
    table: 'ocean_freight_charges',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('oceanFreightId','UUID',false,'ocean_freight_id',{fk:'OceanFreightExtraction.id'}),
      f('lineNumber','String',true,'line_number'),f('sacHsnCode','String',true,'sac_hsn_code'),
      f('description','String',true),f('currency','String',true),f('ratePerUnit','String',true,'rate_per_unit'),
      f('units','String',true),f('taxableAmountInr','String',true,'taxable_amount_inr'),
      f('amountInr','String',true,'amount_inr'),f('igstRate','String',true,'igst_rate'),
      f('igstAmount','String',true,'igst_amount'),f('cgstRate','String',true,'cgst_rate'),
      f('sgstRate','String',true,'sgst_rate'),f('detentionDetails','String',true,'detention_details'),
    ],
  },
  {
    name: 'FreightForwarderContainer',
    table: 'freight_forwarder_containers',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('freightForwarderBillId','UUID',false,'freight_forwarder_bill_id',{fk:'FreightForwarderBillExtraction.id'}),
      f('containerDetail','String',true,'container_detail'),
    ],
  },
  {
    name: 'FreightForwarderCharge',
    table: 'freight_forwarder_charges',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('freightForwarderBillId','UUID',false,'freight_forwarder_bill_id',{fk:'FreightForwarderBillExtraction.id'}),
      f('lineNumber','String',true,'line_number'),f('sacHsnCode','String',true,'sac_hsn_code'),
      f('description','String',true),f('currency','String',true),f('ratePerUnit','String',true,'rate_per_unit'),
      f('taxableAmountInr','String',true,'taxable_amount_inr'),f('amountInr','String',true,'amount_inr'),
      f('igstRate','String',true,'igst_rate'),f('igstAmount','String',true,'igst_amount'),
      f('cgstRate','String',true,'cgst_rate'),f('sgstRate','String',true,'sgst_rate'),
    ],
  },
  {
    name: 'CustomerBrokerBillLineItem',
    table: 'customer_broker_bill_line_items',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('customerBrokerBillId','UUID',false,'customer_broker_bill_id',{fk:'CustomerBrokerBillExtraction.id'}),
      f('chargeDescription','String',true,'charge_description'),f('quantity','String',true),
      f('unitPrice','String',true,'unit_price'),f('amount','String',true),
    ],
  },
  {
    name: 'GrnInboundDestinationMark',
    table: 'grn_inbound_destination_marks',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('grnInboundId','UUID',false,'grn_inbound_id',{fk:'GrnInboundExtraction.id'}),
      f('piecesPerBundle','String',true,'pieces_per_bundle'),f('bundleCount','String',true,'bundle_count'),
      f('totalPieces','String',true,'total_pieces'),f('color','String',true),f('rawLabel','String',true,'raw_label'),
    ],
  },
  {
    name: 'PortToWhLineItem',
    table: 'port_to_wh_line_items',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('portToWhId','UUID',false,'port_to_wh_id',{fk:'PortToWhExtraction.id'}),
      f('chargeDescription','String',true,'charge_description'),f('units','String',true),
      f('unitRate','String',true,'unit_rate'),f('subtotal','String',true),
    ],
  },
  {
    name: 'WhToCustomerLineItem',
    table: 'wh_to_customer_line_items',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('whToCustomerId','UUID',false,'wh_to_customer_id',{fk:'WhToCustomerExtraction.id'}),
      f('chargeDescription','String',true,'charge_description'),f('rateType','String',true,'rate_type'),
      f('ratePerUnit','String',true,'rate_per_unit'),f('quantity','String',true),f('amount','String',true),
    ],
  },
  {
    name: 'UsSalesInvoiceLineItem',
    table: 'us_sales_invoice_line_items',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('usSalesInvoiceId','UUID',false,'us_sales_invoice_id',{fk:'UsSalesInvoiceExtraction.id'}),
      f('itemId','String',true,'item_id'),f('custPartNum','String',true,'cust_part_num'),
      f('description','String',true),f('remarks','String',true),f('bolNo','String',true,'bol_no'),
      f('qty','String',true),f('unit','String',true),f('unitPrice','String',true,'unit_price'),
      f('discountPercent','String',true,'discount_percent'),f('amount','String',true),
    ],
  },
  {
    name: 'UsPackingListLineItem',
    table: 'us_packing_list_line_items',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('usPackingListId','UUID',false,'us_packing_list_id',{fk:'UsPackingListExtraction.id'}),
      f('lineNo','String',true,'line_no'),f('partNumber','String',true,'part_number'),
      f('itemDescription','String',true,'item_description'),f('quantity','String',true),
      f('bundleCount','String',true,'bundle_count'),f('piecesCount','String',true,'pieces_count'),
      f('grossWeight','String',true,'gross_weight'),f('netWeight','String',true,'net_weight'),
    ],
  },
  {
    name: 'ChaBillContainer',
    table: 'cha_bill_containers',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('chaBillId','UUID',false,'cha_bill_id',{fk:'ChaBillExtraction.id'}),
      f('containerDetail','String',true,'container_detail'),
    ],
  },
  {
    name: 'ChaBillCharge',
    table: 'cha_bill_charges',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('chaBillId','UUID',false,'cha_bill_id',{fk:'ChaBillExtraction.id'}),
      f('lineNumber','String',true,'line_number'),f('sacHsnCode','String',true,'sac_hsn_code'),
      f('description','String',true),f('currency','String',true),f('ratePerUnit','String',true,'rate_per_unit'),
      f('taxableAmountInr','String',true,'taxable_amount_inr'),f('amountInr','String',true,'amount_inr'),
      f('igstRate','String',true,'igst_rate'),f('igstAmount','String',true,'igst_amount'),
      f('cgstRate','String',true,'cgst_rate'),f('sgstRate','String',true,'sgst_rate'),
    ],
  },
  {
    name: 'ChaBillBankDetail',
    table: 'cha_bill_bank_details',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('chaBillId','UUID',false,'cha_bill_id',{fk:'ChaBillExtraction.id'}),
      f('beneficiaryName','String',true,'beneficiary_name'),f('bankName','String',true,'bank_name'),
      f('accountNumber','String',true,'account_number'),f('swiftCode','String',true,'swift_code'),
      f('ifscCode','String',true,'ifsc_code'),f('iban','String',true),f('routingNumber','String',true,'routing_number'),f('branch','String',true),
    ],
  },
  {
    name: 'ShippingBillPart1Summary',
    table: 'shipping_bill_part1_summaries',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('shippingBillId','UUID',false,'shipping_bill_id',{fk:'ShippingBillExtraction.id'}),
      f('summaryEntry','String',true,'summary_entry'),
    ],
  },
  {
    name: 'ShippingBillInvoiceRef',
    table: 'shipping_bill_invoice_refs',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('shippingBillId','UUID',false,'shipping_bill_id',{fk:'ShippingBillExtraction.id'}),
      f('sno','String',true),f('invoiceNoAndDate','String',true,'invoice_no_and_date'),
      f('poNoAndDate','String',true,'po_no_and_date'),f('adCode','String',true,'ad_code'),f('invterm','String',true),
    ],
  },
  {
    name: 'ShippingBillItemDetail',
    table: 'shipping_bill_item_details',
    category: 'Child Tables',
    fields: [
      f('id','UUID',false,'id',{pk:true}),f('shippingBillId','UUID',false,'shipping_bill_id',{fk:'ShippingBillExtraction.id'}),
      f('invsn','String',true),f('itemsn','String',true),f('hsCd','String',true,'hs_cd'),
      f('description','String',true),f('quantity','String',true),f('uqc','String',true),
      f('rate','String',true),f('valueFc','String',true,'value_fc'),f('fobInr','String',true,'fob_inr'),
      f('dutyAmt','String',true,'duty_amt'),f('igstAmount','String',true,'igst_amount'),
      f('stateOfOrigin','String',true,'state_of_origin'),f('districtOfOrigin','String',true,'district_of_origin'),
    ],
  },
];

// ─── Derived ──────────────────────────────────────────────────────────────

const CATEGORIES = Array.from(new Set(MODELS.map((m) => m.category)));

const CATEGORY_COLOR: Record<string, string> = {
  'Auth & Users':                    '#6366f1',
  'Shipments & Workflow':            '#f59e0b',
  'Documents':                       '#10b981',
  'AI & Extraction Core':            '#8b5cf6',
  'Extraction: India Export':        '#ef4444',
  'Extraction: US Import':           '#3b82f6',
  'Extraction: Freight & Logistics': '#06b6d4',
  'Child Tables':                    '#94a3b8',
};

const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  UUID:     { bg: '#f0fdf4', color: '#166534' },
  String:   { bg: '#eff6ff', color: '#1d4ed8' },
  Int:      { bg: '#fdf4ff', color: '#7e22ce' },
  BigInt:   { bg: '#fdf4ff', color: '#7e22ce' },
  Boolean:  { bg: '#fff7ed', color: '#c2410c' },
  DateTime: { bg: '#f0f9ff', color: '#0369a1' },
  Json:     { bg: '#fefce8', color: '#92400e' },
  Decimal:  { bg: '#fdf2f8', color: '#9d174d' },
  Enum:     { bg: '#ecfdf5', color: '#065f46' },
};

function TypePill({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      background: s.bg, color: s.color, fontSize: 14.5, fontWeight: 600,
      fontFamily: 'var(--app-font-sans)',
    }}>
      {type}
    </span>
  );
}

function FieldTable({ fields }: { fields: FieldDef[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
      <thead>
        <tr style={{ borderBottom: '2px solid hsl(220 14% 90% / 0.5)' }}>
          {['Field', 'Type', 'Null?', 'DB Column', 'Notes / FK'].map((h) => (
            <th key={h} style={{
              textAlign: 'left', padding: '7px 12px', fontWeight: 600,
              color: 'hsl(220 14% 50%)', fontSize: 14.5, textTransform: 'uppercase',
              letterSpacing: '0.04em', background: 'hsl(220 14% 98%)',
              position: 'sticky', top: 0, zIndex: 1,
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fields.map((field, i) => (
          <tr key={field.name} style={{
            borderBottom: '1px solid hsl(220 14% 90% / 0.4)',
            background: i % 2 === 0 ? '#fff' : 'hsl(220 14% 98%)',
          }}>
            <td style={{
              padding: '6px 12px',
              fontFamily: 'var(--app-font-sans)',
              fontWeight: field.pk ? 700 : 400,
              color: field.pk ? '#b45309' : 'hsl(220 14% 20%)',
            }}>
              {field.pk && <Hash size={11} style={{ display: 'inline', marginRight: 3, color: '#b45309', verticalAlign: 'middle' }} />}
              {field.name}
            </td>
            <td style={{ padding: '6px 12px' }}><TypePill type={field.type} /></td>
            <td style={{ padding: '6px 12px', fontSize: 14 }}>
              {field.nullable
                ? <span style={{ color: '#94a3b8' }}>yes</span>
                : <strong style={{ color: '#ef4444' }}>no</strong>}
            </td>
            <td style={{ padding: '6px 12px', fontFamily: 'var(--app-font-sans)', fontSize: 14.5, color: 'hsl(220 14% 55%)' }}>
              {field.dbCol}
            </td>
            <td style={{ padding: '6px 12px', fontSize: 14, color: 'hsl(220 14% 45%)' }}>
              {field.fk && <span style={{ color: '#7c3aed', fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}>→ {field.fk}</span>}
              {field.fk && field.notes && <span style={{ color: '#cbd5e1', margin: '0 4px' }}>·</span>}
              {field.notes}
              {field.unique && <Badge variant="outline" className="ml-1 text-[12px] py-0 h-4">unique</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SchemaReferencePage() {
  const [search, setSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(MODELS[0].name);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORIES));

  const q = search.toLowerCase().trim();

  const filteredModels = useMemo(() => {
    if (!q) return MODELS;
    return MODELS.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.table.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.fields.some((f) =>
        f.name.toLowerCase().includes(q) ||
        f.dbCol.toLowerCase().includes(q) ||
        (f.notes ?? '').toLowerCase().includes(q),
      ),
    );
  }, [q]);

  const activeModel = MODELS.find((m) => m.name === selectedModel);
  const totalFields = MODELS.reduce((acc, m) => acc + m.fields.length, 0);

  const toggleCategory = (cat: string) =>
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left Panel ── */}
      <aside style={{
        width: 272, flexShrink: 0,
        borderRight: '1px solid hsl(220 14% 90% / 0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'hsl(220 14% 98%)',
      }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid hsl(220 14% 90% / 0.5)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Database size={17} style={{ color: 'hsl(173 58% 39%)' }} />
            <span style={{ fontWeight: 700, fontSize: 14.5, color: 'hsl(220 14% 18%)' }}>Schema Reference</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 9 }}>
            <span style={{ fontSize: 14.5, color: 'hsl(220 14% 50%)' }}>
              <strong style={{ color: 'hsl(220 14% 18%)' }}>{MODELS.length}</strong> models
            </span>
            <span style={{ fontSize: 14.5, color: 'hsl(220 14% 50%)' }}>
              <strong style={{ color: 'hsl(220 14% 18%)' }}>{totalFields}</strong> fields
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'hsl(220 14% 60%)', pointerEvents: 'none' }} />
            <Input
              placeholder="Search models or fields…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              style={{ paddingLeft: 28, height: 30, fontSize: 14 }}
            />
          </div>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0 12px' }}>
          {CATEGORIES.map((cat) => {
            const catModels = filteredModels.filter((m) => m.category === cat);
            if (catModels.length === 0) return null;
            const isExpanded = expandedCategories.has(cat);
            const color = CATEGORY_COLOR[cat] ?? '#64748b';
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCategory(cat)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    width: '100%', padding: '4px 12px', border: 'none',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  {isExpanded
                    ? <ChevronDown size={11} style={{ color: 'hsl(220 14% 60%)', flexShrink: 0 }} />
                    : <ChevronRight size={11} style={{ color: 'hsl(220 14% 60%)', flexShrink: 0 }} />
                  }
                  <span style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>
                    {cat}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 14, color: 'hsl(220 14% 60%)', fontWeight: 600 }}>
                    {catModels.length}
                  </span>
                </button>

                {isExpanded && catModels.map((m) => {
                  const isActive = m.name === selectedModel;
                  return (
                    <button
                      key={m.name}
                      onClick={() => setSelectedModel(m.name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        width: '100%', padding: '4px 12px 4px 24px',
                        border: 'none', textAlign: 'left', cursor: 'pointer',
                        background: isActive ? `${color}14` : 'transparent',
                        borderLeft: isActive ? `3px solid ${color}` : '3px solid transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      <Table2 size={12} style={{ color: isActive ? color : 'hsl(220 14% 65%)', flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 14, fontWeight: isActive ? 600 : 400,
                          color: isActive ? color : 'hsl(220 14% 28%)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {m.name}
                        </div>
                        <div style={{
                          fontSize: 14, color: 'hsl(220 14% 60%)',
                          fontFamily: 'var(--app-font-sans)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {m.table}
                        </div>
                      </div>
                      <span style={{ fontSize: 14, color: 'hsl(220 14% 60%)', flexShrink: 0 }}>
                        {m.fields.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {filteredModels.length === 0 && (
            <p style={{ fontSize: 14, color: 'hsl(220 14% 60%)', textAlign: 'center', padding: '20px 12px' }}>
              No models match "{search}"
            </p>
          )}
        </nav>
      </aside>

      {/* ── Right Panel ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeModel ? (
          <>
            <div style={{
              padding: '14px 22px 12px', borderBottom: '1px solid hsl(220 14% 90% / 0.5)',
              background: '#fff', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{
                  fontSize: 17, fontWeight: 700, color: 'hsl(220 14% 12%)',
                  fontFamily: 'var(--app-font-sans)',
                }}>
                  {activeModel.name}
                </span>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 14.5, fontWeight: 600,
                  background: `${CATEGORY_COLOR[activeModel.category] ?? '#64748b'}18`,
                  color: CATEGORY_COLOR[activeModel.category] ?? '#64748b',
                }}>
                  {activeModel.category}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 14, color: 'hsl(220 14% 50%)' }}>
                  {activeModel.fields.length} fields
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code style={{
                  fontSize: 14.5, background: 'hsl(220 14% 95%)',
                  padding: '1px 7px', borderRadius: 4, color: 'hsl(220 14% 40%)',
                }}>
                  @@map("{activeModel.table}")
                </code>
                {activeModel.description && (
                  <span style={{ fontSize: 14, color: 'hsl(220 14% 52%)' }}>{activeModel.description}</span>
                )}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <FieldTable fields={activeModel.fields} />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(220 14% 55%)', fontSize: 14 }}>
            Select a model from the left panel.
          </div>
        )}
      </main>
    </div>
  );
}
