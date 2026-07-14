import { useState, useEffect, useCallback } from 'react';
import {
  Layers, FileText, Sparkles, ShieldCheck, Ship, ArrowRight,
  ChevronUp, ChevronDown, Trash2, Plus, X, ArrowLeft,
  CheckCircle, XCircle, Fingerprint, Settings, Users, Info,
  Copy, GripVertical,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { AdminSectionTabs } from '@/components/admin/AdminSectionTabs';
import { AdminEmptyState } from '@/components/admin/AdminEmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DOC_FIELD_CONFIG } from '@/config/docFieldConfig';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateListItem = {
  id: string; name: string; description?: string;
  corridor?: string; commodity?: string; shipmentTypes: string[];
  templateStatus: string; version: number; createdAt: string;
  gates: GateConfig[];
  _count: { shipments: number; docTypeGates: number; genTriggers: number; workflowRules: number };
};

type GateConfig = {
  id: string; gateNumber: number; gateName: string; description?: string;
  gateCheckType: string; isIdentityGate: boolean; slaHours?: number;
  sortOrder: number; roleAssignments: GateRoleAssignment[]; docTypeGates?: DocAssignment[];
  _isNew?: boolean; _localId?: string;
};

type DocAssignment = {
  id: string; gateConfigId?: string; docType: string;
  roleInGate: string; isGenerated: boolean; source: string;
  mandatoryPhoto: boolean; slaOverrideDays?: number; sortOrder: number;
  _isNew?: boolean;
};

type GenTrigger = {
  id?: string; generatedDocType: string;
  triggerConditions: TriggerCondition[];
  reviewGateId?: string; reviewerRoles: string[]; isActive: boolean;
  _isNew?: boolean;
};

type TriggerCondition = { docType: string; status: string };

type IdentityConfigState = {
  id?: string; identityGateId: string; identityDocType: string;
  identityField: string; matchingFields: string[];
};

type GateRoleEntry = { accessLevel: string; canEscalate: boolean; canOverride: boolean };

type GateRoleAssignment = {
  id?: string; gateConfigId: string; roleId: string;
  accessLevel: string; canEscalate: boolean; canOverride: boolean;
};

type Role = { id: string; name: string; color?: string; roleCategory?: string };
type DocType = { id: string; typeCode: string; shortCode: string; displayName: string; geography: string | null };

type GeneralState = {
  name: string; description: string; status: string;
  corridorFrom: string; corridorTo: string;
  commodity: string; shipmentTypes: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MONO = '"JetBrains Mono", "Fira Code", monospace';
const TEAL = 'hsl(173 58% 39%)';
const TEAL_BG = 'hsla(173,58%,39%,0.1)';

const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string }> = {
  ACTIVE:   { label: 'Active',   bg: 'rgba(22,163,74,0.12)',   text: '#16a34a' },
  DRAFT:    { label: 'Draft',    bg: 'rgba(234,179,8,0.12)',   text: '#ca8a04' },
  ARCHIVED: { label: 'Archived', bg: 'hsl(var(--muted))',      text: 'hsl(var(--muted-foreground))' },
};

const CHECK_TYPES: Record<string, string> = {
  ALL_REQUIRED: 'All Required',
  ANY_REQUIRED: 'Any Required',
  MANUAL: 'Manual',
};

const DOC_ROLE_DISPLAY: Record<string, string> = {
  GATE_CRITICAL: 'Gate Critical',
  OPTIONAL: 'Optional',
  PARALLEL: 'Parallel',
};

const DOC_SOURCE_DISPLAY: Record<string, string> = {
  USER_UPLOAD: 'User Upload',
  SYSTEM_GENERATED: 'System Generated',
  API_PULL: 'API Pull',
};

const DOC_STATUSES = ['UPLOADED', 'EXTRACTED', 'APPROVED', 'CLOSED'];

const SHIPMENT_TYPE_OPTIONS = [
  'Container FCL', 'Container LCL', 'Break Bulk', 'Ro-Ro', 'Air Freight', 'Other',
];

// ─── Role-category derivation (keeps gate access consistent with Team & Access) ─

function deriveGateAccess(roleCategory: string): GateRoleEntry {
  const cat = (roleCategory ?? '').toLowerCase();
  if (cat.includes('admin'))    return { accessLevel: 'full', canEscalate: true,  canOverride: true  };
  if (cat.includes('internal')) return { accessLevel: 'full', canEscalate: true,  canOverride: false };
  return                               { accessLevel: 'summary', canEscalate: false, canOverride: false };
}

function derivedAccessBadge(roleCategory: string): { text: string; bg: string; color: string } {
  const cat = (roleCategory ?? '').toLowerCase();
  if (cat.includes('admin'))    return { text: 'Full access · Escalate · Override', bg: 'rgba(22,163,74,0.12)',  color: '#16a34a' };
  if (cat.includes('internal')) return { text: 'Full access · Escalate',            bg: 'rgba(22,163,74,0.12)',  color: '#16a34a' };
  return                               { text: 'View only (read-only)',              bg: 'rgba(245,158,11,0.12)', color: '#d97706' };
}

function roleCatLabel(cat: string): string {
  const c = (cat ?? '').toLowerCase();
  if (c.includes('admin'))                            return 'Admin';
  if (c.includes('internal'))                         return 'Internal';
  if (c.includes('external') || c.includes('partner')) return 'External';
  if (c.includes('customer'))                         return 'Customer';
  return cat;
}

function roleCatStyle(cat: string): { bg: string; color: string } {
  const c = (cat ?? '').toLowerCase();
  if (c.includes('admin'))    return { bg: 'rgba(245,158,11,0.12)', color: '#d97706' };
  if (c.includes('internal')) return { bg: 'rgba(3,105,161,0.12)',  color: '#0284c7' };
  return                             { bg: 'rgba(22,163,74,0.12)',  color: '#16a34a' };
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.DRAFT;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 10px', borderRadius: 99,
      fontSize: 14.5, fontWeight: 600,
      background: cfg.bg, color: cfg.text,
    }}>
      {cfg.label}
    </span>
  );
}

function StatChip({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: string | number; accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: accent ? TEAL : 'hsl(var(--muted-foreground))' }}>{icon}</span>
      <span style={{
        fontSize: 14.5, fontFamily: MONO, fontWeight: 600,
        color: accent ? TEAL : 'hsl(var(--foreground))',
      }}>
        {value}
      </span>
      <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{label}</span>
    </div>
  );
}

function tmpId() {
  return '_new_' + Math.random().toString(36).slice(2, 9);
}

// ─── Default states ────────────────────────────────────────────────────────────

function defaultGeneral(): GeneralState {
  return {
    name: '', description: '', status: 'DRAFT',
    corridorFrom: 'India', corridorTo: 'US',
    commodity: '', shipmentTypes: [],
  };
}

function defaultIdentity(): IdentityConfigState {
  return { identityGateId: '', identityDocType: '', identityField: '', matchingFields: [] };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AdminTemplatesPage() {
  const { toast } = useToast();

  // List
  const [templates, setTemplates]       = useState<TemplateListItem[]>([]);
  const [listLoading, setListLoading]   = useState(true);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId]  = useState('');

  // Editor mode
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editorLoading, setEditorLoading]         = useState(false);
  const [activeTab, setActiveTab]                 = useState('general');
  const [saving, setSaving]                       = useState(false);

  // Editor state
  const [general, setGeneral]           = useState<GeneralState>(defaultGeneral());
  const [gates, setGates]               = useState<GateConfig[]>([]);
  const [deletedGateIds, setDeletedGateIds] = useState<string[]>([]);
  const [docAssignments, setDocAssignments] = useState<DocAssignment[]>([]);
  const [deletedDocIds, setDeletedDocIds]   = useState<string[]>([]);
  const [genTriggers, setGenTriggers]   = useState<GenTrigger[]>([]);
  const [deletedTriggerIds, setDeletedTriggerIds] = useState<string[]>([]);
  const [identityConfig, setIdentityConfig] = useState<IdentityConfigState>(defaultIdentity());
  const [includedRoleIds, setIncludedRoleIds] = useState<Set<string>>(new Set());

  // Supporting data
  const { roles, docTypes, refreshTemplates } = useConfig();

  // Dialogs
  const [deleteGateDialog, setDeleteGateDialog]   = useState<GateConfig | null>(null);
  const [activateDialog, setActivateDialog]       = useState(false);

  // ── List fetch ─────────────────────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await apiGet<any>('/api/admin/templates');
      setTemplates(res.data ?? []);
    } catch { /* silent */ }
    setListLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ── Editor fetch ────────────────────────────────────────────────────────────
  const loadEditor = useCallback(async (id: string) => {
    if (id === 'new') {
      setGeneral(defaultGeneral());
      setGates([]); setDocAssignments([]); setGenTriggers([]);
      setIdentityConfig(defaultIdentity()); setIncludedRoleIds(new Set());
      setDeletedGateIds([]); setDeletedDocIds([]); setDeletedTriggerIds([]);
      return;
    }
    setEditorLoading(true);
    try {
      const tRes = await apiGet<any>(`/api/admin/templates/${id}`);
      const t = tRes.data;
      const [from, to] = (t.corridor ?? 'India → US').split('→').map((s: string) => s.trim());
      setGeneral({
        name: t.name, description: t.description ?? '',
        status: t.templateStatus ?? 'DRAFT',
        corridorFrom: from ?? 'India', corridorTo: to ?? 'US',
        commodity: t.commodity ?? '',
        shipmentTypes: t.shipmentTypes ?? [],
      });
      setGates(t.gates ?? []);
      setDocAssignments(t.docTypeGates ?? []);
      setGenTriggers((t.genTriggers ?? []).map((g: any) => ({
        ...g,
        triggerConditions: Array.isArray(g.triggerConditions)
          ? g.triggerConditions
          : [],
      })));
      setIdentityConfig(t.identityConfig ?? defaultIdentity());
      // Derive included roles from any existing non-none gate assignment
      const included = new Set<string>();
      for (const gate of (t.gates ?? [])) {
        for (const ra of (gate.roleAssignments ?? [])) {
          if (ra.accessLevel && ra.accessLevel !== 'none') included.add(ra.roleId);
        }
      }
      setIncludedRoleIds(included);
      setDeletedGateIds([]); setDeletedDocIds([]); setDeletedTriggerIds([]);
    } catch { /* silent */ }
    setEditorLoading(false);
  }, []);

  useEffect(() => {
    if (editingTemplateId) loadEditor(editingTemplateId);
  }, [editingTemplateId, loadEditor]);

  // ── Gate helpers ────────────────────────────────────────────────────────────
  function addGate() {
    const maxNum = gates.reduce((m, g) => Math.max(m, g.gateNumber), 0);
    const localId = tmpId();
    setGates((prev) => [...prev, {
      id: localId, gateNumber: maxNum + 1, gateName: '',
      description: '', gateCheckType: 'ALL_REQUIRED',
      isIdentityGate: false, slaHours: undefined, sortOrder: maxNum + 1,
      roleAssignments: [], _isNew: true, _localId: localId,
    }]);
  }

  function updateGate(idx: number, patch: Partial<GateConfig>) {
    setGates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Enforce single identity gate
      if (patch.isIdentityGate) {
        next.forEach((g, i) => { if (i !== idx) next[i] = { ...g, isIdentityGate: false }; });
      }
      return next;
    });
  }

  function moveGate(idx: number, dir: -1 | 1) {
    const next = [...gates];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    next.forEach((g, i) => {
      next[i] = { ...g, gateNumber: i + 1, sortOrder: i + 1 };
    });
    setGates(next);
  }

  function confirmDeleteGate(gate: GateConfig) { setDeleteGateDialog(gate); }
  function doDeleteGate() {
    if (!deleteGateDialog) return;
    const id = deleteGateDialog.id;
    if (!deleteGateDialog._isNew && id && !id.startsWith('_new_')) {
      setDeletedGateIds((prev) => [...prev, id]);
    }
    setGates((prev) => prev.filter((g) => g.id !== id));
    setDocAssignments((prev) => prev.filter((d) => d.gateConfigId !== id));
    setDeleteGateDialog(null);
  }

  // ── Doc assignment helpers ────────────────────────────────────────────────
  function addDocAssignment(gateConfigId: string | undefined, docType: string) {
    if (!docType) return;
    const alreadyAssigned = docAssignments.some((d) => d.docType === docType);
    if (alreadyAssigned) { toast({ title: `${docType} already assigned`, variant: 'destructive' }); return; }
    const maxSort = docAssignments.filter((d) => d.gateConfigId === gateConfigId).reduce((m, d) => Math.max(m, d.sortOrder), 0);
    setDocAssignments((prev) => [...prev, {
      id: tmpId(), gateConfigId, docType,
      roleInGate: gateConfigId ? 'GATE_CRITICAL' : 'PARALLEL',
      isGenerated: false, source: 'USER_UPLOAD',
      mandatoryPhoto: false, sortOrder: maxSort + 1, _isNew: true,
    }]);
  }

  function updateDoc(id: string, patch: Partial<DocAssignment>) {
    setDocAssignments((prev) => prev.map((d) => d.id === id ? { ...d, ...patch } : d));
  }

  function removeDoc(id: string, isNew: boolean) {
    if (!isNew && !id.startsWith('_new_')) setDeletedDocIds((p) => [...p, id]);
    const removedDoc = docAssignments.find((d) => d.id === id);
    if (removedDoc) {
      const trigger = genTriggers.find((t) => t.generatedDocType === removedDoc.docType);
      if (trigger?.id) setDeletedTriggerIds((p) => [...p, trigger.id!]);
    }
    setDocAssignments((prev) => prev.filter((d) => d.id !== id));
    setGenTriggers((prev) => prev.filter((t) => t.generatedDocType !== removedDoc?.docType));
  }

  // ── Gen trigger helpers ─────────────────────────────────────────────────────
  function getTrigger(docType: string): GenTrigger | undefined {
    return genTriggers.find((t) => t.generatedDocType === docType);
  }

  function ensureTrigger(docType: string) {
    if (!getTrigger(docType)) {
      setGenTriggers((prev) => [...prev, {
        generatedDocType: docType, triggerConditions: [],
        reviewGateId: '', reviewerRoles: [], isActive: true, _isNew: true,
      }]);
    }
  }

  function updateTrigger(docType: string, patch: Partial<GenTrigger>) {
    setGenTriggers((prev) => prev.map((t) => t.generatedDocType === docType ? { ...t, ...patch } : t));
  }

  // ── Role inclusion helpers ────────────────────────────────────────────────
  function toggleRoleInclusion(roleId: string, include: boolean) {
    setIncludedRoleIds((prev) => {
      const next = new Set(prev);
      if (include) next.add(roleId); else next.delete(roleId);
      return next;
    });
  }

  function applyRolePreset(preset: string) {
    if (preset === 'ops_default') {
      setIncludedRoleIds(new Set(
        roles
          .filter((r) => { const c = (r.roleCategory ?? '').toLowerCase(); return c.includes('admin') || c.includes('internal'); })
          .map((r) => r.id)
      ));
    } else if (preset === 'all') {
      setIncludedRoleIds(new Set(roles.map((r) => r.id)));
    } else if (preset === 'clear') {
      setIncludedRoleIds(new Set());
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!general.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    if (general.status === 'ACTIVE' && passCount < validationChecks.length) {
      const remaining = validationChecks.length - passCount;
      toast({
        title: 'Fix validation issues first',
        description: `${remaining} check${remaining !== 1 ? 's' : ''} must pass before this template can be Active. See the Validation tab.`,
        variant: 'destructive',
      });
      setActiveTab('validation');
      return;
    }
    setSaving(true);
    try {
      const isNew = editingTemplateId === 'new';
      const corridor = `${general.corridorFrom} → ${general.corridorTo}`;
      const generalPayload = {
        name: general.name.trim(), description: general.description || null,
        templateStatus: general.status, corridor, commodity: general.commodity || null,
        shipmentTypes: general.shipmentTypes,
        shipmentType: general.shipmentTypes[0] ?? 'Container FCL',
        isActive: general.status === 'ACTIVE',
      };
      let tid: string;
      if (isNew) {
        const res = await apiPost<any>('/api/admin/templates', generalPayload);
        tid = res.data.id;
      } else {
        tid = editingTemplateId!;
        await apiPut(`/api/admin/templates/${tid}`, generalPayload);
      }

      // Delete removed triggers
      for (const trid of deletedTriggerIds) {
        await apiDelete(`/api/admin/templates/${tid}/triggers/${trid}`).catch(() => {});
      }

      // Delete removed gates
      for (const gid of deletedGateIds) {
        await apiDelete(`/api/admin/templates/${tid}/gates/${gid}`).catch(() => {});
      }

      // Save gates — build localId → real id map
      const gateIdMap: Record<string, string> = {};
      for (const gate of gates) {
        const gatePayload = {
          gateNumber: gate.gateNumber, gateName: gate.gateName || `Gate ${gate.gateNumber}`,
          description: gate.description || null, gateCheckType: gate.gateCheckType,
          isIdentityGate: gate.isIdentityGate,
          slaHours: gate.slaHours ?? null, sortOrder: gate.sortOrder,
        };
        if (gate._isNew || gate.id.startsWith('_new_')) {
          const res = await apiPost<any>(`/api/admin/templates/${tid}/gates`, gatePayload);
          gateIdMap[gate.id] = res.data.id;
        } else {
          await apiPut(`/api/admin/templates/${tid}/gates/${gate.id}`, gatePayload);
          gateIdMap[gate.id] = gate.id;
        }
      }

      // Delete removed doc assignments
      for (const did of deletedDocIds) {
        if (!did.startsWith('_new_')) {
          await apiDelete(`/api/admin/templates/${tid}/doc-assignments/${did}`).catch(() => {});
        }
      }

      // Save doc assignments
      for (const da of docAssignments) {
        const realGateId = da.gateConfigId ? (gateIdMap[da.gateConfigId] ?? da.gateConfigId) : undefined;
        const daPayload = {
          docType: da.docType, gateConfigId: realGateId ?? null,
          roleInGate: da.roleInGate, isGenerated: da.isGenerated,
          source: da.source, mandatoryPhoto: da.mandatoryPhoto,
          slaOverrideDays: da.slaOverrideDays ?? null, sortOrder: da.sortOrder,
        };
        if (da._isNew || da.id.startsWith('_new_')) {
          await apiPost(`/api/admin/templates/${tid}/doc-assignments`, daPayload).catch(() => {});
        } else {
          await apiPut(`/api/admin/templates/${tid}/doc-assignments/${da.id}`, daPayload).catch(() => {});
        }
      }

      // Save generation triggers
      for (const tr of genTriggers) {
        const realReviewGate = tr.reviewGateId ? (gateIdMap[tr.reviewGateId] ?? tr.reviewGateId) : null;
        const trPayload = {
          generatedDocType: tr.generatedDocType,
          triggerConditions: tr.triggerConditions,
          reviewGateId: realReviewGate || null,
          reviewerRoles: tr.reviewerRoles,
          isActive: tr.isActive,
        };
        if (tr._isNew || !tr.id) {
          await apiPost(`/api/admin/templates/${tid}/triggers`, trPayload).catch(() => {});
        } else {
          await apiPut(`/api/admin/templates/${tid}/triggers/${tr.id}`, trPayload).catch(() => {});
        }
      }

      // Save identity config
      if (identityConfig.identityGateId && identityConfig.identityDocType) {
        const realGateId = gateIdMap[identityConfig.identityGateId] ?? identityConfig.identityGateId;
        await apiPut(`/api/admin/templates/${tid}/identity`, {
          identityGateId: realGateId,
          identityDocType: identityConfig.identityDocType,
          identityField: identityConfig.identityField,
          matchingFields: identityConfig.matchingFields,
        }).catch(() => {});
      }

      // Save gate-role assignments — derived from included roles × all real gates
      const realGateIds = gates
        .map((g) => gateIdMap[g.id] ?? g.id)
        .filter((id) => !id.startsWith('_new_'));
      if (realGateIds.length > 0) {
        const assignments: any[] = [];
        for (const role of roles) {
          const entry = includedRoleIds.has(role.id)
            ? deriveGateAccess(role.roleCategory ?? '')
            : { accessLevel: 'none', canEscalate: false, canOverride: false };
          for (const gateId of realGateIds) {
            assignments.push({
              gateConfigId: gateId, roleId: role.id,
              accessLevel: entry.accessLevel,
              canEscalate: entry.canEscalate,
              canOverride: entry.canOverride,
            });
          }
        }
        await apiPut(`/api/admin/templates/${tid}/gate-roles`, { assignments }).catch(() => {});
      }

      setDeletedTriggerIds([]);
      toast({ title: 'Template saved' });
      await fetchTemplates();
      refreshTemplates();
      if (isNew) {
        setEditingTemplateId(tid);
        await loadEditor(tid);
      } else {
        await loadEditor(tid);
      }
    } catch (e) {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  }

  // ── Clone ──────────────────────────────────────────────────────────────────
  async function handleClone() {
    if (!cloneSourceId) return;
    try {
      const res = await apiGet<any>(`/api/admin/templates/${cloneSourceId}`);
      const src = res.data;
      const [from, to] = (src.corridor ?? 'India → US').split('→').map((s: string) => s.trim());
      setGeneral({
        name: `${src.name} (Copy)`,
        description: src.description ?? '',
        status: 'DRAFT',
        corridorFrom: from ?? 'India',
        corridorTo: to ?? 'US',
        commodity: src.commodity ?? '',
        shipmentTypes: src.shipmentTypes ?? [],
      });
      // Build old gate ID → new local ID map so all references stay consistent
      const gateOldToNew: Record<string, string> = {};
      const clonedGates = (src.gates ?? []).map((g: any, i: number) => {
        const newId = tmpId();
        gateOldToNew[g.id] = newId;
        return { ...g, id: newId, _isNew: true, _localId: newId, gateNumber: i + 1, sortOrder: i + 1, roleAssignments: [] };
      });
      setGates(clonedGates);
      setDocAssignments((src.docTypeGates ?? []).map((d: any) => ({
        ...d, id: tmpId(), _isNew: true,
        gateConfigId: d.gateConfigId ? (gateOldToNew[d.gateConfigId] ?? d.gateConfigId) : d.gateConfigId,
      })));
      setGenTriggers((src.genTriggers ?? []).map((t: any) => ({
        ...t, id: undefined, _isNew: true,
        reviewGateId: t.reviewGateId ? (gateOldToNew[t.reviewGateId] ?? t.reviewGateId) : t.reviewGateId,
      })));
      const srcIdentity = src.identityConfig ?? defaultIdentity();
      setIdentityConfig({
        ...srcIdentity,
        id: undefined,
        identityGateId: srcIdentity.identityGateId
          ? (gateOldToNew[srcIdentity.identityGateId] ?? srcIdentity.identityGateId)
          : srcIdentity.identityGateId,
      });
      setIncludedRoleIds(new Set());
      setDeletedGateIds([]); setDeletedDocIds([]); setDeletedTriggerIds([]);
      setCloneModalOpen(false);
      setCloneSourceId('');
      setEditingTemplateId('new');
      setActiveTab('general');
    } catch {
      toast({ title: 'Clone failed', variant: 'destructive' });
    }
  }

  // ── Validation checks ───────────────────────────────────────────────────────
  const validationChecks = [
    {
      label: 'At least one gate defined',
      hint: 'A template needs at least one gate to create a workflow.',
      fixLabel: 'Add a gate',
      pass: gates.length > 0,
      tab: 'gates',
    },
    {
      label: 'Every gate has a name',
      hint: `${gates.filter((g) => !g.gateName?.trim()).length} gate(s) are still unnamed — give each gate a descriptive name so teams know what it represents.`,
      fixLabel: 'Name your gates',
      pass: gates.every((g) => g.gateName?.trim()),
      tab: 'gates',
    },
    {
      label: 'Exactly one identity gate',
      hint: gates.filter((g) => g.isIdentityGate).length === 0
        ? 'Mark one gate as the identity gate — this is where shipment identity is confirmed.'
        : 'Only one gate can be the identity gate. Un-mark the extras.',
      fixLabel: 'Fix identity gate',
      pass: gates.filter((g) => g.isIdentityGate).length === 1,
      tab: 'gates',
    },
    {
      label: 'Identity document assigned to identity gate',
      hint: 'Select which document type and gate confirm shipment identity.',
      fixLabel: 'Configure identity',
      pass: !!identityConfig.identityDocType && !!identityConfig.identityGateId,
      tab: 'identity',
    },
    {
      label: 'Every non-manual gate has a gate-critical document',
      hint: 'Gates with automatic checks need at least one gate-critical document that must be approved before the gate can close.',
      fixLabel: 'Assign critical docs',
      pass: gates.filter((g) => g.gateCheckType !== 'MANUAL').every((g) =>
        docAssignments.some((d) => d.gateConfigId === g.id && d.roleInGate === 'GATE_CRITICAL')
      ),
      tab: 'documents',
    },
    {
      label: 'Every generated doc has valid trigger conditions',
      hint: 'Generated documents need at least one trigger condition so the system knows when to produce them.',
      fixLabel: 'Set trigger conditions',
      pass: genTriggers
        .filter((t) => docAssignments.some((d) => d.isGenerated && d.docType === t.generatedDocType))
        .every((t) => t.triggerConditions.length > 0),
      tab: 'documents',
    },
    {
      label: 'Every generated doc has at least one reviewer role',
      hint: 'Assign at least one role to review each generated document before it can be approved.',
      fixLabel: 'Assign reviewers',
      pass: genTriggers
        .filter((t) => docAssignments.some((d) => d.isGenerated && d.docType === t.generatedDocType))
        .every((t) => t.reviewerRoles.length > 0),
      tab: 'documents',
    },
    {
      label: 'No document type assigned to multiple gates',
      hint: 'Each document type can only belong to one gate. Remove the duplicate assignment.',
      fixLabel: 'Fix duplicate docs',
      pass: (() => {
        const codes = docAssignments.map((d) => d.docType);
        return codes.length === new Set(codes).size;
      })(),
      tab: 'documents',
    },
    {
      label: 'At least one internal or admin role included',
      hint: 'Include at least one admin or internal role so someone has full access to manage gates.',
      fixLabel: 'Add a role',
      pass: roles.some((r) => {
        const cat = (r.roleCategory ?? '').toLowerCase();
        return includedRoleIds.has(r.id) && (cat.includes('admin') || cat.includes('internal'));
      }),
      tab: 'gate-roles',
    },
    {
      label: 'Identity field specified',
      hint: 'Choose which field on the identity document uniquely identifies the shipment.',
      fixLabel: 'Set identity field',
      pass: !!identityConfig.identityField,
      tab: 'identity',
    },
  ];

  const passCount = validationChecks.filter((c) => c.pass).length;

  // ── Active shipment count ─────────────────────────────────────────────────
  const activeShipmentCount = editingTemplateId && editingTemplateId !== 'new'
    ? (templates.find((t) => t.id === editingTemplateId)?._count.shipments ?? 0)
    : 0;

  // ── Render helpers ─────────────────────────────────────────────────────────
  const templateForEditor = templates.find((t) => t.id === editingTemplateId);
  const assignedDocTypes = new Set(docAssignments.map((d) => d.docType));
  const unassignedDocTypes = docTypes.filter((dt) => !assignedDocTypes.has(dt.typeCode));

  // ────────────────────────────────────────────────────────────────────────────
  // LIST MODE
  // ────────────────────────────────────────────────────────────────────────────
  if (!editingTemplateId) {
    return (
      <div>
        <AdminPageHeader
          title="Workflow Templates"
          description="Define gates, document assignments, generation triggers, and identity configuration per corridor"
          badge={{ label: 'templates', count: templates.length }}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloneModalOpen(true)}
                disabled={templates.length === 0}
              >
                <Copy size={13} style={{ marginRight: 4 }} />
                Clone Existing
              </Button>
              <Button
                size="sm"
                onClick={() => { setEditingTemplateId('new'); setActiveTab('general'); }}
                style={{ background: TEAL, color: '#fff' }}
              >
                <Plus size={13} style={{ marginRight: 4 }} />
                Create Template
              </Button>
            </div>
          }
        />

        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <AdminEmptyState
            icon="GitBranch"
            title="No workflow templates"
            description="Create your first template to define the shipment process."
            actionLabel="Create Template"
          />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
            gap: 16,
          }}>
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                onClick={() => { setEditingTemplateId(tmpl.id); setActiveTab('general'); }}
                style={{
                  background: 'hsl(var(--card))',
                  borderRadius: 12, padding: 20,
                  border: '1px solid hsl(var(--border))',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'hsl(var(--foreground))' }}>
                    {tmpl.name}
                  </span>
                  <StatusBadge status={tmpl.templateStatus} />
                </div>

                {/* Body */}
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tmpl.corridor && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 500 }}>
                      <span>{tmpl.corridor.split('→')[0]?.trim()}</span>
                      <ArrowRight size={13} color={TEAL} />
                      <span>{tmpl.corridor.split('→')[1]?.trim()}</span>
                    </div>
                  )}
                  {tmpl.commodity && (
                    <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                      {tmpl.commodity}
                    </div>
                  )}
                  {tmpl.shipmentTypes.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {tmpl.shipmentTypes.map((st) => (
                        <span key={st} style={{
                          fontSize: 14.5, padding: '2px 8px', borderRadius: 99,
                          background: 'hsl(var(--muted) / 0.5)',
                          color: 'hsl(var(--muted-foreground))',
                          fontWeight: 500,
                        }}>
                          {st}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Metrics */}
                <div style={{
                  marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap',
                  paddingTop: 12, borderTop: '1px solid hsl(var(--border) / 0.5)',
                }}>
                  <StatChip icon={<Layers size={12} />} label="gates" value={tmpl.gates.length} />
                  <StatChip icon={<FileText size={12} />} label="docs" value={tmpl._count.docTypeGates} />
                  <StatChip icon={<Sparkles size={12} />} label="triggers" value={tmpl._count.genTriggers} />
                  <StatChip icon={<ShieldCheck size={12} />} label="rules" value={tmpl._count.workflowRules} />
                  <StatChip
                    icon={<Ship size={12} />} label="active"
                    value={tmpl._count.shipments}
                    accent={tmpl._count.shipments > 0}
                  />
                </div>

                {/* Footer */}
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12, borderTop: '1px solid hsl(var(--border) / 0.5)',
                }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 14.5, fontFamily: MONO, color: 'hsl(var(--muted-foreground))' }}>
                      v{tmpl.version}
                    </span>
                    <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                      {new Date(tmpl.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTemplateId(tmpl.id); setActiveTab('general');
                      }}
                      style={smallBtnStyle}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Clone modal */}
        <AdminModal
          open={cloneModalOpen}
          onClose={() => setCloneModalOpen(false)}
          title="Clone Template"
          size="sm"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid hsl(var(--border))' }}>
              <Button variant="outline" size="sm" onClick={() => setCloneModalOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!cloneSourceId} onClick={handleClone}
                style={{ background: TEAL, color: '#fff' }}>
                Clone
              </Button>
            </div>
          }
        >
          <div style={{ padding: '20px 20px 0' }}>
            <Label style={labelStyle}>Select source template</Label>
            <Select value={cloneSourceId} onValueChange={setCloneSourceId}>
              <SelectTrigger style={{ marginTop: 6 }}>
                <SelectValue placeholder="Choose template to clone…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 10, marginBottom: 20 }}>
              A copy will be created in Draft status. You can rename and modify it in the editor.
            </p>
          </div>
        </AdminModal>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // EDITOR MODE
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Sticky top bar */}
      <div style={{
        position: 'sticky', top: -32, zIndex: 10,
        background: 'hsl(var(--background))',
        borderBottom: '1px solid hsl(var(--border))',
        margin: '-32px -32px 0 -32px',
        padding: '12px 32px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button
          onClick={() => setEditingTemplateId(null)}
          style={{ ...linkBtnStyle, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
        >
          <ArrowLeft size={14} />
          Back to templates
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {general.name || (editingTemplateId === 'new' ? 'New Template' : '…')}
          </span>
          <StatusBadge status={general.status} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={() => {
            if (editingTemplateId === 'new') setEditingTemplateId(null);
            else loadEditor(editingTemplateId!);
          }}>
            Discard changes
          </Button>
          {(() => {
            const blocked = general.status === 'ACTIVE' && passCount < validationChecks.length;
            return (
              <Button
                size="sm"
                disabled={saving}
                onClick={handleSave}
                title={blocked ? `${validationChecks.length - passCount} validation issue${validationChecks.length - passCount !== 1 ? 's' : ''} must be fixed before saving as Active` : undefined}
                style={{ background: blocked ? '#f59e0b' : TEAL, color: '#fff' }}
              >
                {saving ? 'Saving…' : blocked ? `Fix ${validationChecks.length - passCount} issue${validationChecks.length - passCount !== 1 ? 's' : ''} first` : 'Save template'}
              </Button>
            );
          })()}
        </div>
      </div>

      {/* Active shipment banner */}
      {activeShipmentCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 8, marginTop: 16,
          background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: 14.5,
        }}>
          <Info size={14} />
          This template has {activeShipmentCount} active shipment{activeShipmentCount !== 1 ? 's' : ''}.
          Changes apply to NEW shipments only.
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ marginTop: 20 }}>
        <AdminSectionTabs
          tabs={[
            { label: 'General', value: 'general' },
            { label: 'Gates', value: 'gates', count: gates.length },
            { label: 'Documents', value: 'documents', count: docAssignments.length },
            { label: 'Identity', value: 'identity' },
            { label: 'Gate Roles', value: 'gate-roles' },
            { label: `Validation ${passCount}/${validationChecks.length}`, value: 'validation' },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {editorLoading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>
          Loading template…
        </div>
      )}

      {!editorLoading && (
        <>
          {/* ── TAB: GENERAL ──────────────────────────────────────────────── */}
          {activeTab === 'general' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, paddingBottom: 32 }}>
              <div>
                <AdminFormSection title="Template Info">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <Label style={labelStyle}>Template Name *</Label>
                      <Input
                        value={general.name}
                        onChange={(e) => setGeneral((g) => ({ ...g, name: e.target.value }))}
                        placeholder="e.g., India to US Steel Export"
                        style={{ height: 36, fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <Label style={labelStyle}>Description</Label>
                      <Textarea
                        value={general.description}
                        onChange={(e) => setGeneral((g) => ({ ...g, description: e.target.value }))}
                        placeholder="Brief description of this workflow…"
                        rows={3}
                        style={{ fontSize: 14.5, resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <Label style={labelStyle}>Status</Label>
                      <Select value={general.status} onValueChange={(v) => {
                        if (v === 'ACTIVE') { setActivateDialog(true); return; }
                        setGeneral((g) => ({ ...g, status: v }));
                      }}>
                        <SelectTrigger style={{ marginTop: 6 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DRAFT">Draft</SelectItem>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="ARCHIVED">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </AdminFormSection>
              </div>
              <div>
                <AdminFormSection title="Corridor & Commodity">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <Label style={labelStyle}>Corridor</Label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <Input
                          value={general.corridorFrom}
                          onChange={(e) => setGeneral((g) => ({ ...g, corridorFrom: e.target.value }))}
                          placeholder="India"
                          style={{ height: 36, fontSize: 14 }}
                        />
                        <ArrowRight size={16} color={TEAL} style={{ flexShrink: 0 }} />
                        <Input
                          value={general.corridorTo}
                          onChange={(e) => setGeneral((g) => ({ ...g, corridorTo: e.target.value }))}
                          placeholder="US"
                          style={{ height: 36, fontSize: 14 }}
                        />
                      </div>
                    </div>
                    <div>
                      <Label style={labelStyle}>Commodity / Category</Label>
                      <Input
                        value={general.commodity}
                        onChange={(e) => setGeneral((g) => ({ ...g, commodity: e.target.value }))}
                        placeholder="e.g., Steel — Section 232"
                        style={{ height: 36, fontSize: 14, marginTop: 6 }}
                      />
                    </div>
                    <div>
                      <Label style={labelStyle}>Shipment Types</Label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {general.shipmentTypes.map((st) => (
                          <span key={st} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 10px', borderRadius: 99, fontSize: 14, fontWeight: 500,
                            background: TEAL_BG, color: TEAL,
                          }}>
                            {st}
                            <button onClick={() => setGeneral((g) => ({
                              ...g, shipmentTypes: g.shipmentTypes.filter((s) => s !== st),
                            }))} style={{ cursor: 'pointer', color: 'inherit' }}>
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <Select
                        value=""
                        onValueChange={(v) => {
                          if (!general.shipmentTypes.includes(v)) {
                            setGeneral((g) => ({ ...g, shipmentTypes: [...g.shipmentTypes, v] }));
                          }
                        }}
                      >
                        <SelectTrigger style={{ marginTop: 8, height: 34, fontSize: 14.5 }}>
                          <SelectValue placeholder="Add shipment type…" />
                        </SelectTrigger>
                        <SelectContent>
                          {SHIPMENT_TYPE_OPTIONS.filter((o) => !general.shipmentTypes.includes(o)).map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </AdminFormSection>
              </div>
            </div>
          )}

          {/* ── TAB: GATES ────────────────────────────────────────────────── */}
          {activeTab === 'gates' && (
            <div style={{ paddingBottom: 32 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {gates.length === 0 && (
                  <div style={{
                    textAlign: 'center', padding: '24px 16px', borderRadius: 8,
                    border: '1px dashed hsl(var(--border))',
                    color: 'hsl(var(--muted-foreground))', fontSize: 14.5,
                  }}>
                    No gates yet. Add gates to define the workflow progression.
                  </div>
                )}
                {gates.map((gate, idx) => (
                  <div key={gate.id} style={{
                    borderRadius: 10, border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--card))', overflow: 'hidden',
                  }}>
                    {/* Gate header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      background: 'hsl(var(--muted) / 0.3)',
                    }}>
                      <GripVertical size={15} color="hsl(var(--muted-foreground))" />
                      <div style={{
                        width: 28, height: 28, borderRadius: 14,
                        background: gate.isIdentityGate ? TEAL : 'hsl(var(--muted))',
                        color: gate.isIdentityGate ? '#fff' : 'hsl(var(--muted-foreground))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, fontFamily: MONO, flexShrink: 0,
                      }}>
                        {gate.gateNumber}
                      </div>
                      <input
                        value={gate.gateName}
                        onChange={(e) => updateGate(idx, { gateName: e.target.value })}
                        placeholder={`Gate ${gate.gateNumber} name…`}
                        style={{
                          flex: 1, background: 'transparent', border: 'none',
                          fontSize: 14, fontWeight: 600, outline: 'none',
                          color: 'hsl(var(--foreground))',
                        }}
                      />
                      {gate.isIdentityGate && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Fingerprint size={14} color={TEAL} />
                          <span style={{ fontSize: 14.5, color: TEAL, fontWeight: 600 }}>Identity gate</span>
                        </div>
                      )}
                      {/* Move buttons */}
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          onClick={() => moveGate(idx, -1)} disabled={idx === 0}
                          style={{ ...iconBtnStyle, opacity: idx === 0 ? 0.3 : 1 }}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          onClick={() => moveGate(idx, 1)} disabled={idx === gates.length - 1}
                          style={{ ...iconBtnStyle, opacity: idx === gates.length - 1 ? 0.3 : 1 }}
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          onClick={() => confirmDeleteGate(gate)}
                          style={{ ...iconBtnStyle, color: '#dc2626' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Gate body */}
                    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Textarea
                        value={gate.description ?? ''}
                        onChange={(e) => updateGate(idx, { description: e.target.value })}
                        placeholder="Gate description…"
                        rows={2}
                        style={{ fontSize: 14, resize: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <Label style={{ ...labelStyle, fontSize: 14 }}>Check Type</Label>
                          <Select
                            value={gate.gateCheckType}
                            onValueChange={(v) => updateGate(idx, { gateCheckType: v })}
                          >
                            <SelectTrigger style={{ marginTop: 4, height: 32, fontSize: 14 }}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(CHECK_TYPES).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                            {gate.gateCheckType === 'ALL_REQUIRED' && 'All gate-critical docs must close'}
                            {gate.gateCheckType === 'ANY_REQUIRED' && 'At least one doc closes the gate'}
                            {gate.gateCheckType === 'MANUAL' && 'Ops manager passes manually'}
                          </div>
                        </div>
                        <div style={{ width: 100 }}>
                          <Label style={{ ...labelStyle, fontSize: 14 }}>SLA (hours)</Label>
                          <Input
                            type="number"
                            value={gate.slaHours ?? ''}
                            onChange={(e) => updateGate(idx, { slaHours: e.target.value ? parseInt(e.target.value) : undefined })}
                            placeholder="—"
                            style={{ height: 32, fontSize: 14, marginTop: 4 }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                          <Label style={{ ...labelStyle, fontSize: 14 }}>Identity Gate</Label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <Switch
                              checked={gate.isIdentityGate}
                              onCheckedChange={(v) => updateGate(idx, { isIdentityGate: v })}
                            />
                            {gate.isIdentityGate && (
                              <span style={{ fontSize: 14.5, color: TEAL }}>Assigns shipment number</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add gate button */}
                <button
                  onClick={addGate}
                  style={{
                    width: '100%', padding: '12px 0',
                    border: '2px dashed hsl(var(--border))',
                    borderRadius: 10, cursor: 'pointer',
                    background: 'transparent', color: 'hsl(var(--muted-foreground))',
                    fontSize: 14.5, fontWeight: 500,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Plus size={14} /> Add gate
                </button>

                {/* Parallel track note */}
                <div style={{
                  padding: 14, borderRadius: 8, background: 'hsl(var(--muted) / 0.3)',
                  display: 'flex', gap: 10,
                }}>
                  <Info size={14} color="hsl(var(--muted-foreground))" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 2 }}>Parallel Track</div>
                    <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                      Documents in this track never block gate progression. They arrive on their own timeline.
                    </div>
                  </div>
                </div>
              </div>

              {/* Delete gate confirm */}
              <AdminConfirmDialog
                open={!!deleteGateDialog}
                onClose={() => setDeleteGateDialog(null)}
                onConfirm={doDeleteGate}
                title={`Delete gate: ${deleteGateDialog?.gateName || `Gate ${deleteGateDialog?.gateNumber}`}?`}
                description={`Documents assigned to this gate will be unassigned. This cannot be undone.${
                  docAssignments.filter((d) => d.gateConfigId === deleteGateDialog?.id).length > 0
                    ? ` ${docAssignments.filter((d) => d.gateConfigId === deleteGateDialog?.id).length} document(s) will be unassigned.`
                    : ''
                }`}
                confirmLabel="Delete gate"
                confirmVariant="danger"
              />
            </div>
          )}

          {/* ── TAB: DOCUMENTS ────────────────────────────────────────────── */}
          {activeTab === 'documents' && (
            <div style={{ paddingBottom: 32 }}>
              {/* Groups: each gate + parallel */}
              {[...gates, { id: undefined, gateName: 'Parallel Track', gateNumber: 0 } as any].map((gate) => {
                const gateId = gate.id as string | undefined;
                const groupDocs = docAssignments.filter((d) =>
                  gateId ? d.gateConfigId === gateId : !d.gateConfigId
                );
                return (
                  <GateDocGroup
                    key={gateId ?? '__parallel'}
                    gate={gate}
                    docs={groupDocs}
                    docTypes={docTypes}
                    gates={gates}
                    roles={roles}
                    genTriggers={genTriggers}
                    onAddDoc={(dt) => { addDocAssignment(gateId, dt); }}
                    onUpdateDoc={updateDoc}
                    onRemoveDoc={removeDoc}
                    onEnsureTrigger={ensureTrigger}
                    onUpdateTrigger={updateTrigger}
                  />
                );
              })}

              {/* Unassigned */}
              {unassignedDocTypes.length > 0 && (() => {
                const geoGroups: { key: string; label: string; accent: string; items: typeof unassignedDocTypes }[] = [
                  { key: 'IN',  label: 'India',   accent: '#f97316', items: unassignedDocTypes.filter(dt => dt.geography === 'INDIA' || dt.geography === 'BOTH') },
                  { key: 'US',  label: 'US',      accent: '#3b82f6', items: unassignedDocTypes.filter(dt => dt.geography === 'US') },
                  { key: 'GEN', label: 'General', accent: '#6b7280', items: unassignedDocTypes.filter(dt => !dt.geography || (dt.geography !== 'INDIA' && dt.geography !== 'BOTH' && dt.geography !== 'US')) },
                ].filter(g => g.items.length > 0);

                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{
                      fontSize: 14.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                      color: 'hsl(var(--muted-foreground))', marginBottom: 10,
                    }}>
                      Unassigned document types ({unassignedDocTypes.length})
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${geoGroups.length}, 1fr)`, gap: 10, alignItems: 'start' }}>
                      {geoGroups.map(group => (
                        <div key={group.key} style={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8, overflow: 'hidden',
                        }}>
                          <div style={{
                            padding: '6px 10px',
                            borderBottom: '1px solid hsl(var(--border))',
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: `${group.accent}0f`,
                          }}>
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: group.accent, flexShrink: 0,
                            }} />
                            <span style={{
                              fontSize: 14, fontWeight: 800, letterSpacing: '0.08em',
                              textTransform: 'uppercase', color: group.accent,
                            }}>{group.label}</span>
                            <span style={{
                              marginLeft: 'auto', fontSize: 14,
                              color: 'hsl(var(--muted-foreground))',
                            }}>{group.items.length}</span>
                          </div>
                          {group.items.map((dt, i) => (
                            <div key={dt.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '5px 10px',
                              borderBottom: i < group.items.length - 1
                                ? '1px solid hsl(var(--border) / 0.5)' : 'none',
                            }}>
                              <span style={{
                                fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {dt.displayName}
                              </span>
                              <Select
                                value=""
                                onValueChange={(gid) => addDocAssignment(gid === '__parallel' ? undefined : gid, dt.typeCode)}
                              >
                                <SelectTrigger style={{ height: 24, fontSize: 14.5, width: 110, flexShrink: 0 }}>
                                  <SelectValue placeholder="Assign →" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__parallel">Parallel Track</SelectItem>
                                  {gates.map((g) => (
                                    <SelectItem key={g.id} value={g.id}>
                                      Gate {g.gateNumber} — {g.gateName || '(unnamed)'}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── TAB: IDENTITY ─────────────────────────────────────────────── */}
          {activeTab === 'identity' && (
            <div style={{ maxWidth: 640, paddingBottom: 32 }}>
              <div style={{
                background: 'hsl(var(--card))', borderRadius: 12,
                padding: 24, border: '1px solid hsl(var(--border))',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  Shipment Identity Assignment
                </div>
                <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 24 }}>
                  Configure which document provides the shipment number and how pre-identity documents are matched.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <Label style={labelStyle}>Identity Gate</Label>
                    <Select
                      value={identityConfig.identityGateId ?? ''}
                      onValueChange={(v) => setIdentityConfig((c) => ({ ...c, identityGateId: v }))}
                    >
                      <SelectTrigger style={{ marginTop: 6 }}>
                        <SelectValue placeholder="Select gate…" />
                      </SelectTrigger>
                      <SelectContent>
                        {gates.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            Gate {g.gateNumber} — {g.gateName || '(unnamed)'}
                            {g.isIdentityGate ? ' ⊛' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                      The gate where the identity document is expected
                    </div>
                  </div>

                  <div>
                    <Label style={labelStyle}>Identity Document Type</Label>
                    <Select
                      value={identityConfig.identityDocType ?? ''}
                      onValueChange={(v) => setIdentityConfig((c) => ({ ...c, identityDocType: v, identityField: '', matchingFields: [] }))}
                    >
                      <SelectTrigger style={{ marginTop: 6 }}>
                        <SelectValue placeholder="Select document type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {docAssignments
                          .filter((d) => !identityConfig.identityGateId || d.gateConfigId === identityConfig.identityGateId)
                          .map((d) => {
                            const dt = docTypes.find((t) => t.typeCode === d.docType);
                            return (
                              <SelectItem key={d.id} value={d.docType}>
                                {dt?.displayName ?? d.docType}
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                      The document whose field becomes the shipment number
                    </div>
                  </div>

                  <div>
                    <Label style={labelStyle}>Identity Field</Label>
                    {(() => {
                      const cfg = identityConfig.identityDocType ? DOC_FIELD_CONFIG[identityConfig.identityDocType] : null;
                      const sections = cfg?.sections ?? [];
                      return (
                        <Select
                          value={identityConfig.identityField ?? ''}
                          onValueChange={(v) => setIdentityConfig((c) => ({ ...c, identityField: v }))}
                          disabled={!identityConfig.identityDocType}
                        >
                          <SelectTrigger style={{ marginTop: 6, fontFamily: MONO }}>
                            <SelectValue placeholder={identityConfig.identityDocType ? 'Select field…' : 'Select a document type first'} />
                          </SelectTrigger>
                          <SelectContent>
                            {sections.length === 0 && (
                              <SelectItem value="__none" disabled>No fields defined for this type</SelectItem>
                            )}
                            {sections.map((sec, si) => (
                              <SelectGroup key={si}>
                                <SelectLabel>{sec.sectionLabel}</SelectLabel>
                                {sec.fields.map((f) => (
                                  <SelectItem key={f.key} value={f.key}>
                                    <span style={{ fontFamily: MONO, fontSize: 14 }}>{f.key}</span>
                                    <span style={{ color: 'hsl(var(--muted-foreground))', marginLeft: 8, fontSize: 14.5 }}>{f.label}</span>
                                  </SelectItem>
                                ))}
                                {si < sections.length - 1 && <SelectSeparator />}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                      The extracted field that becomes the shipment number
                    </div>
                  </div>

                  <div>
                    <Label style={labelStyle}>Matching Fields</Label>
                    {(() => {
                      const cfg = identityConfig.identityDocType ? DOC_FIELD_CONFIG[identityConfig.identityDocType] : null;
                      const allFields = cfg?.sections.flatMap(s => s.fields) ?? [];
                      const added = new Set(identityConfig.matchingFields ?? []);
                      const available = allFields.filter(f => !added.has(f.key));
                      return (
                        <>
                          {/* Added chips */}
                          {(identityConfig.matchingFields ?? []).length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                              {(identityConfig.matchingFields ?? []).map((f) => (
                                <span key={f} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '3px 10px', borderRadius: 99, fontSize: 14,
                                  background: 'hsl(173 58% 39% / 0.12)',
                                  border: '1px solid hsl(173 58% 39% / 0.3)',
                                  color: 'hsl(173 58% 39%)', fontFamily: MONO,
                                }}>
                                  {f}
                                  <button onClick={() => setIdentityConfig((c) => ({
                                    ...c, matchingFields: c.matchingFields.filter((mf) => mf !== f),
                                  }))} style={{ cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>
                                    <X size={11} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Add from dropdown */}
                          <Select
                            value=""
                            onValueChange={(v) => setIdentityConfig((c) => ({
                              ...c, matchingFields: [...(c.matchingFields ?? []), v],
                            }))}
                            disabled={!identityConfig.identityDocType || available.length === 0}
                          >
                            <SelectTrigger style={{ marginTop: 8, fontFamily: MONO }}>
                              <SelectValue placeholder={
                                !identityConfig.identityDocType ? 'Select a document type first'
                                : available.length === 0 ? 'All fields added'
                                : '+ Add matching field…'
                              } />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  <span style={{ fontFamily: MONO, fontSize: 14 }}>{f.key}</span>
                                  <span style={{ color: 'hsl(var(--muted-foreground))', marginLeft: 8, fontSize: 14.5 }}>{f.label}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      );
                    })()}
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                      Fields used to match pre-identity documents to this shipment
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {identityConfig.identityDocType && identityConfig.identityField && (
                  <div style={{
                    marginTop: 24, padding: '12px 16px', borderRadius: 8,
                    background: 'hsl(var(--muted) / 0.4)',
                    fontSize: 14, color: 'hsl(var(--muted-foreground))', lineHeight: 1.7,
                  }}>
                    <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: 4 }}>Preview</div>
                    {(() => {
                      const dt = docTypes.find((t) => t.typeCode === identityConfig.identityDocType);
                      const gateConfig = gates.find((g) => g.id === identityConfig.identityGateId);
                      return (
                        <div>
                          When a <strong>{dt?.displayName ?? identityConfig.identityDocType}</strong> is
                          approved at <strong>{gateConfig ? `Gate ${gateConfig.gateNumber} — ${gateConfig.gateName}` : '(gate)'}</strong>,
                          the system will:
                          <ol style={{ paddingLeft: 18, marginTop: 4 }}>
                            <li>Use field '<code style={{ fontFamily: MONO }}>{identityConfig.identityField}</code>' as the shipment number</li>
                            {identityConfig.matchingFields.length > 0 && (
                              <li>Match pending shipments using: {identityConfig.matchingFields.map((f) => (
                                <code key={f} style={{ fontFamily: MONO, marginRight: 4 }}>{f}</code>
                              ))}</li>
                            )}
                            <li>Merge matched documents into the identified shipment</li>
                          </ol>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: GATE ROLES ───────────────────────────────────────────── */}
          {activeTab === 'gate-roles' && (
            <div style={{ paddingBottom: 32 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
                    Which roles participate in this template?
                  </div>
                  <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', maxWidth: 480, lineHeight: 1.5 }}>
                    Toggle roles on to include them in shipments using this template. Their gate access level is
                    determined automatically by their role category — no separate configuration needed.
                    To change a role's category, go to <strong>Team &amp; Access → Roles</strong>.
                  </div>
                </div>
                {/* Quick presets */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {[
                    { key: 'ops_default', label: 'Ops default' },
                    { key: 'all',         label: 'All roles'   },
                    { key: 'clear',       label: 'Clear'       },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => applyRolePreset(key)}
                      style={{
                        padding: '5px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                        cursor: 'pointer', border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--card))', color: 'hsl(var(--foreground))',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Role rows */}
              <div style={{
                border: '1px solid hsl(var(--border))',
                borderRadius: 10, overflow: 'hidden',
                background: 'hsl(var(--card))',
              }}>
                {roles.length === 0 && (
                  <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                    No roles defined yet. Add roles in Team &amp; Access first.
                  </div>
                )}
                {roles.map((role, ri) => {
                  const included = includedRoleIds.has(role.id);
                  const badge    = derivedAccessBadge(role.roleCategory ?? '');
                  const catLbl   = roleCatLabel(role.roleCategory ?? '');
                  const catSty   = roleCatStyle(role.roleCategory ?? '');
                  return (
                    <div
                      key={role.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '16px 20px',
                        borderBottom: ri < roles.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                        background: included ? 'hsl(var(--muted) / 0.1)' : 'transparent',
                        opacity: included ? 1 : 0.55,
                        transition: 'opacity 0.15s, background 0.15s',
                      }}
                    >
                      {/* Colour dot */}
                      {role.color ? (
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: role.color, flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'hsl(var(--muted))', flexShrink: 0 }} />
                      )}

                      {/* Role name */}
                      <span style={{ fontWeight: 600, fontSize: 14.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {role.name}
                      </span>

                      {/* Category pill */}
                      {catLbl && (
                        <span style={{
                          fontSize: 14, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                          background: catSty.bg, color: catSty.color,
                          textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
                        }}>
                          {catLbl}
                        </span>
                      )}

                      {/* Derived access badge (read-only) */}
                      <span style={{
                        fontSize: 14.5, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                        background: included ? badge.bg : 'hsl(var(--muted))',
                        color: included ? badge.color : 'hsl(var(--muted-foreground))',
                        flexShrink: 0, transition: 'background 0.15s, color 0.15s',
                      }}>
                        {included ? badge.text : 'No access'}
                      </span>

                      {/* Include toggle */}
                      <Switch
                        checked={included}
                        onCheckedChange={(v) => toggleRoleInclusion(role.id, v)}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div style={{
                marginTop: 16, padding: '10px 14px', borderRadius: 8,
                background: 'hsl(var(--muted) / 0.3)',
                display: 'flex', gap: 20, flexWrap: 'wrap',
              }}>
                {[
                  { bg: 'rgba(22,163,74,0.12)',  color: '#16a34a', label: 'Full access · Escalate · Override', desc: 'Admin roles' },
                  { bg: 'rgba(22,163,74,0.12)',  color: '#16a34a', label: 'Full access · Escalate',            desc: 'Internal roles' },
                  { bg: 'rgba(245,158,11,0.12)', color: '#d97706', label: 'View only (read-only)',              desc: 'External / Partner / Customer roles' },
                ].map(({ bg, color, label, desc }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 14, fontWeight: 600, background: bg, color }}>{label}</span>
                    <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB: VALIDATION ───────────────────────────────────────────── */}
          {activeTab === 'validation' && (() => {
            const failing = validationChecks.filter((c) => !c.pass);
            const passing = validationChecks.filter((c) => c.pass);
            const allPass = failing.length === 0;
            const pct     = Math.round((passCount / validationChecks.length) * 100);

            return (
              <div style={{ maxWidth: 600, paddingBottom: 32 }}>

                {/* ── Score header ── */}
                <div style={{
                  padding: '18px 20px',
                  borderRadius: 12,
                  marginBottom: 24,
                  background: allPass ? 'rgba(22,163,74,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${allPass ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.25)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: allPass ? '#16a34a' : '#d97706', lineHeight: 1 }}>
                        {passCount} <span style={{ fontSize: 14, fontWeight: 500, color: allPass ? '#16a34a' : '#d97706' }}>of {validationChecks.length}</span>
                      </div>
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--foreground))', marginTop: 3, fontWeight: 500 }}>
                        {allPass ? 'All checks passed — this template is ready' : `${failing.length} issue${failing.length !== 1 ? 's' : ''} left to resolve`}
                      </div>
                    </div>
                    {allPass && (
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'rgba(22,163,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <CheckCircle size={22} color="#16a34a" />
                      </div>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 99, background: 'hsl(var(--muted))', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 99,
                      width: `${pct}%`,
                      background: allPass ? '#16a34a' : '#f59e0b',
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>

                {/* ── Failing checks — action cards ── */}
                {failing.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{
                      fontSize: 14.5, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))',
                      marginBottom: 10,
                    }}>
                      Needs attention
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {failing.map((check, i) => (
                        <div key={i} style={{
                          padding: '14px 16px',
                          borderRadius: 10,
                          border: '1px solid rgba(239,68,68,0.25)',
                          background: 'hsl(var(--card))',
                          display: 'flex', alignItems: 'flex-start', gap: 12,
                        }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, marginTop: 1,
                          }}>
                            <XCircle size={15} color="#dc2626" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#dc2626', marginBottom: 3 }}>
                              {check.label}
                            </div>
                            <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5, marginBottom: 10 }}>
                              {check.hint}
                            </div>
                            <button
                              onClick={() => setActiveTab(check.tab)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '5px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                                cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)',
                                background: 'rgba(239,68,68,0.08)', color: '#dc2626',
                              }}
                            >
                              {check.fixLabel} →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Passing checks — compact list ── */}
                {passing.length > 0 && (
                  <div>
                    <div style={{
                      fontSize: 14.5, fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))',
                      marginBottom: 10,
                    }}>
                      Completed
                    </div>
                    <div style={{
                      border: '1px solid rgba(22,163,74,0.25)',
                      borderRadius: 10, overflow: 'hidden',
                      background: 'rgba(22,163,74,0.06)',
                    }}>
                      {passing.map((check, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 14px',
                          borderBottom: i < passing.length - 1 ? '1px solid rgba(22,163,74,0.12)' : 'none',
                        }}>
                          <CheckCircle size={14} color="#16a34a" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: 14, color: '#16a34a', fontWeight: 500 }}>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Activate CTA (draft + all pass) ── */}
                {general.status === 'DRAFT' && allPass && (
                  <div style={{
                    marginTop: 24, padding: '16px 20px',
                    borderRadius: 10, background: 'rgba(22,163,74,0.08)',
                    border: '1px solid rgba(22,163,74,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  }}>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16a34a', marginBottom: 2 }}>
                        Ready to activate
                      </div>
                      <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                        This template will be available for new shipments once activated.
                      </div>
                    </div>
                    <Button
                      onClick={() => setActivateDialog(true)}
                      style={{ background: TEAL, color: '#fff', flexShrink: 0 }}
                    >
                      Activate Template
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Activate confirm */}
      <AdminConfirmDialog
        open={activateDialog}
        onClose={() => setActivateDialog(false)}
        onConfirm={() => {
          setGeneral((g) => ({ ...g, status: 'ACTIVE' }));
          setActivateDialog(false);
          toast({ title: 'Status set to Active — save to apply' });
        }}
        title="Activate template?"
        description="It will be available for new shipments once saved."
        confirmLabel="Activate"
        confirmVariant="warning"
      />
    </div>
  );
}

// ─── GateDocGroup sub-component ──────────────────────────────────────────────

function GateDocGroup({
  gate, docs, docTypes, gates, roles, genTriggers,
  onAddDoc, onUpdateDoc, onRemoveDoc, onEnsureTrigger, onUpdateTrigger,
}: {
  gate: GateConfig | { id: undefined; gateName: string; gateNumber: number };
  docs: DocAssignment[];
  docTypes: DocType[];
  gates: GateConfig[];
  roles: Role[];
  genTriggers: GenTrigger[];
  onAddDoc: (docType: string) => void;
  onUpdateDoc: (id: string, patch: Partial<DocAssignment>) => void;
  onRemoveDoc: (id: string, isNew: boolean) => void;
  onEnsureTrigger: (docType: string) => void;
  onUpdateTrigger: (docType: string, patch: Partial<GenTrigger>) => void;
}) {
  const [addDocType, setAddDocType] = useState('');
  const isParallel = !gate.id;
  const assignedCodes = new Set(docs.map((d) => d.docType));
  const MONO = '"JetBrains Mono", "Fira Code", monospace';
  const TEAL = 'hsl(173 58% 39%)';

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Group header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      }}>
        {gate.id && (
          <span style={{
            width: 22, height: 22, borderRadius: 11,
            background: 'hsl(173 58% 39% / 0.15)', color: TEAL,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14.5, fontWeight: 700, fontFamily: MONO,
          }}>
            {gate.gateNumber}
          </span>
        )}
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
          {gate.gateName || `Gate ${gate.gateNumber}`}
        </span>
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          ({docs.length} document{docs.length !== 1 ? 's' : ''})
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <Select value={addDocType} onValueChange={(v) => { onAddDoc(v); setAddDocType(''); }}>
            <SelectTrigger style={{ height: 28, fontSize: 14, width: 160 }}>
              <SelectValue placeholder="+ Add document" />
            </SelectTrigger>
            <SelectContent>
              {docTypes
                .filter((dt) => !assignedCodes.has(dt.typeCode))
                .map((dt) => (
                  <SelectItem key={dt.id} value={dt.typeCode}>
                    {dt.displayName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Doc rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {docs.length === 0 && (
          <div style={{
            padding: '8px 12px', fontSize: 14,
            color: 'hsl(var(--muted-foreground))',
            border: '1px dashed hsl(var(--border))', borderRadius: 6,
          }}>
            No documents assigned to this {isParallel ? 'track' : 'gate'}.
          </div>
        )}
        {docs.map((doc) => {
          const dt = docTypes.find((t) => t.typeCode === doc.docType);
          const trigger = genTriggers.find((t) => t.generatedDocType === doc.docType);

          return (
            <div key={doc.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px', borderRadius: 8,
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}>
                {/* Doc type badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 180, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: MONO, fontSize: 14.5,
                    padding: '2px 6px', borderRadius: 4,
                    background: 'hsl(var(--muted) / 0.5)',
                  }}>
                    {dt?.displayName ?? doc.docType}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'hsl(var(--foreground))' }}>
                    {dt?.displayName ?? doc.docType}
                  </span>
                </div>

                {/* Role in gate */}
                {!isParallel && (
                  <Select
                    value={doc.roleInGate}
                    onValueChange={(v) => onUpdateDoc(doc.id, { roleInGate: v })}
                  >
                    <SelectTrigger style={{ height: 28, fontSize: 14, width: 130 }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GATE_CRITICAL">Gate Critical</SelectItem>
                      <SelectItem value="OPTIONAL">Optional</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {/* Source */}
                <Select
                  value={doc.source}
                  onValueChange={(v) => {
                    onUpdateDoc(doc.id, { source: v, isGenerated: v === 'SYSTEM_GENERATED' });
                    if (v === 'SYSTEM_GENERATED') onEnsureTrigger(doc.docType);
                  }}
                >
                  <SelectTrigger style={{ height: 28, fontSize: 14, width: 150 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER_UPLOAD">User Upload</SelectItem>
                    <SelectItem value="SYSTEM_GENERATED">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        ✨ System Generated
                      </span>
                    </SelectItem>
                    <SelectItem value="API_PULL">API Pull</SelectItem>
                  </SelectContent>
                </Select>

                {/* Photo */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={doc.mandatoryPhoto}
                    onChange={(e) => onUpdateDoc(doc.id, { mandatoryPhoto: e.target.checked })}
                    style={{ width: 12, height: 12 }}
                  />
                  Photo
                </label>

                {/* SLA override */}
                <Input
                  type="number"
                  value={doc.slaOverrideDays ?? ''}
                  onChange={(e) => onUpdateDoc(doc.id, { slaOverrideDays: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="—"
                  style={{ width: 60, height: 28, fontSize: 14 }}
                />
                <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>days</span>

                {/* Remove */}
                <button
                  onClick={() => onRemoveDoc(doc.id, doc._isNew ?? false)}
                  style={{ marginLeft: 'auto', color: 'hsl(var(--muted-foreground))', cursor: 'pointer', padding: 4, background: 'none', border: 'none', flexShrink: 0 }}
                >
                  <X size={13} />
                </button>
              </div>

              {/* Trigger config */}
              {doc.source === 'SYSTEM_GENERATED' && trigger && (
                <div style={{
                  marginTop: 4, marginLeft: 24, padding: 14,
                  borderLeft: '3px solid #d97706', borderRadius: '0 8px 8px 0',
                  background: 'rgba(245,158,11,0.07)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  borderLeftWidth: 3,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#d97706', marginBottom: 10 }}>
                    Generation trigger for {dt?.displayName ?? doc.docType}
                  </div>

                  {/* Conditions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {trigger.triggerConditions.map((cond, ci) => (
                      <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>When</span>
                        <Select
                          value={cond.docType}
                          onValueChange={(v) => {
                            const conds = [...trigger.triggerConditions];
                            conds[ci] = { ...conds[ci], docType: v };
                            onUpdateTrigger(doc.docType, { triggerConditions: conds });
                          }}
                        >
                          <SelectTrigger style={{ height: 28, fontSize: 14, flex: 1 }}>
                            <SelectValue placeholder="Doc type…" />
                          </SelectTrigger>
                          <SelectContent>
                            {docTypes.map((dt2) => (
                              <SelectItem key={dt2.id} value={dt2.typeCode}>
                                {dt2.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>reaches</span>
                        <Select
                          value={cond.status}
                          onValueChange={(v) => {
                            const conds = [...trigger.triggerConditions];
                            conds[ci] = { ...conds[ci], status: v };
                            onUpdateTrigger(doc.docType, { triggerConditions: conds });
                          }}
                        >
                          <SelectTrigger style={{ height: 28, fontSize: 14, width: 110 }}>
                            <SelectValue placeholder="Status…" />
                          </SelectTrigger>
                          <SelectContent>
                            {DOC_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          onClick={() => onUpdateTrigger(doc.docType, {
                            triggerConditions: trigger.triggerConditions.filter((_, j) => j !== ci),
                          })}
                          style={{ color: 'hsl(var(--muted-foreground))', cursor: 'pointer', padding: 2, background: 'none', border: 'none' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => onUpdateTrigger(doc.docType, {
                        triggerConditions: [...trigger.triggerConditions, { docType: '', status: 'APPROVED' }],
                      })}
                      style={{ fontSize: 14, color: '#d97706', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
                    >
                      + Add condition
                    </button>
                  </div>

                  {/* Review gate */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Review gate:</span>
                      <Select
                        value={trigger.reviewGateId ?? ''}
                        onValueChange={(v) => onUpdateTrigger(doc.docType, { reviewGateId: v })}
                      >
                        <SelectTrigger style={{ height: 28, fontSize: 14, width: 200 }}>
                          <SelectValue placeholder="Select gate…" />
                        </SelectTrigger>
                        <SelectContent>
                          {gates.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              Gate {g.gateNumber} — {g.gateName || '(unnamed)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Active:</span>
                      <Switch
                        checked={trigger.isActive}
                        onCheckedChange={(v) => onUpdateTrigger(doc.docType, { isActive: v })}
                      />
                    </div>
                  </div>

                  {/* Reviewer roles */}
                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Reviewer roles:</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {roles.map((r) => (
                        <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 14 }}>
                          <input
                            type="checkbox"
                            checked={trigger.reviewerRoles.includes(r.id)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...trigger.reviewerRoles, r.id]
                                : trigger.reviewerRoles.filter((x) => x !== r.id);
                              onUpdateTrigger(doc.docType, { reviewerRoles: next });
                            }}
                            style={{ width: 12, height: 12 }}
                          />
                          {r.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared micro-styles ───────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))',
  display: 'block',
};

const smallBtnStyle: React.CSSProperties = {
  fontSize: 14, padding: '4px 10px', borderRadius: 6,
  border: '1px solid hsl(var(--border))',
  cursor: 'pointer', background: 'transparent',
  color: 'hsl(var(--foreground))',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
  color: 'hsl(var(--muted-foreground))',
  background: 'transparent', border: '1px solid hsl(var(--border))',
};

const linkBtnStyle: React.CSSProperties = {
  fontSize: 14, color: 'hsl(173 58% 39%)',
  cursor: 'pointer', background: 'transparent',
  border: 'none', padding: 0, fontWeight: 500,
};
