import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, Search, RefreshCw, Clock, History,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminEmptyState } from '@/components/admin/AdminEmptyState';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiGet, apiPut } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type RuleHistoryEntry = {
  field: 'isActive' | 'blockingBehavior';
  from: any;
  to: any;
  changedAt: string;
  changedById: string;
  changedByName: string;
};

type ValidationRule = {
  id: string;
  templateId: string;
  ruleCode: string;
  description?: string;
  sourceDocType: string;
  sourceField: string;
  sourceFieldLabel?: string;
  targetDocType: string;
  targetField: string;
  targetFieldLabel?: string;
  matchType: string;
  tolerance?: number | string | null;
  blockingBehavior: string;
  isActive: boolean;
  statusHistory: RuleHistoryEntry[];
  updatedAt?: string;
};

type DocType = {
  id: string;
  typeCode: string;
  shortCode: string;
  displayName: string;
  geography?: string;
};

type Template = {
  id: string;
  name: string;
  templateStatus: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MONO = 'var(--app-font-sans)';
const TEAL = 'hsl(173 58% 39%)';

const DOC_TYPE_ORDER = ['SI', 'PL', 'BL', 'BOL', 'SB', 'BOE', 'CHA', 'FF', 'OF'];

const MATCH_LABELS: Record<string, string> = {
  EXACT: 'EXACT',
  FUZZY_NAME: 'FUZZY',
  NUMERIC_EXACT: 'NUM=',
  NUMERIC_TOLERANCE: 'NUM±%',
  PATTERN: 'PATTERN',
  CONTAINS: 'CONTAINS',
  SET_MATCH: 'SET',
  MASTER_DATA: 'MASTER',
};

const MATCH_FULL: Record<string, string> = {
  EXACT: 'Exact Match — values must be identical',
  FUZZY_NAME: 'Fuzzy Name Match — case-insensitive, ignores Ltd/Pvt/Inc',
  NUMERIC_EXACT: 'Numeric Exact — values must be numerically equal',
  NUMERIC_TOLERANCE: 'Numeric Tolerance — values within tolerance % are matching',
  PATTERN: 'Pattern Match — value must match a regex/format pattern',
  CONTAINS: 'Contains — value must contain the target string',
  SET_MATCH: 'Set Match — value must be in an allowed set',
  MASTER_DATA: 'Master Data — validates against configured master data',
};

const BEHAVIOR: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  BLOCK:  { dot: '#dc2626', text: '#dc2626', bg: '#fee2e2', label: 'Block' },
  WARN:   { dot: '#d97706', text: '#92400e', bg: '#fef3c7', label: 'Warn' },
  IGNORE: { dot: '#94a3b8', text: '#475569', bg: '#f1f5f9', label: 'Ignore' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTol(val: any): string {
  if (val == null || val === '') return '';
  const n = parseFloat(String(val));
  return isNaN(n) ? '' : String(n);
}

function matchLabel(rule: ValidationRule): string {
  if (rule.matchType === 'NUMERIC_TOLERANCE' && rule.tolerance != null) {
    return `NUM±${parseTol(rule.tolerance)}%`;
  }
  return MATCH_LABELS[rule.matchType] ?? rule.matchType;
}

function orderKey(shortCode: string): number {
  const sc = shortCode.toUpperCase();
  const idx = DOC_TYPE_ORDER.findIndex((o) => sc.startsWith(o) || o === sc);
  return idx === -1 ? 999 : idx;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminValidationPage() {
  const { toast } = useToast();

  const { templates: configTemplates, docTypes: rawDocTypes } = useConfig();
  const [fallbackTemplates, setFallbackTemplates] = useState<Template[]>([]);
  const [fallbackDocTypes, setFallbackDocTypes] = useState<DocType[]>([]);
  const templates = (configTemplates.length > 0 ? configTemplates : fallbackTemplates) as Template[];
  const docTypes = (rawDocTypes.length > 0 ? rawDocTypes : fallbackDocTypes).map(d => ({ ...d, geography: d.geography ?? undefined }));

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [rules, setRules]                           = useState<ValidationRule[]>([]);
  const [loading, setLoading]                       = useState(false);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedRules, setExpandedRules]   = useState<Set<string>>(new Set());
  const [savingRules, setSavingRules]       = useState<Set<string>>(new Set());

  const [search, setSearch]               = useState('');
  const [filterMode, setFilterMode]       = useState('all');

  const [disableDialog, setDisableDialog] = useState<ValidationRule | null>(null);
  const [rerunDialog, setRerunDialog]     = useState(false);

  useEffect(() => {
    if (configTemplates.length > 0 && rawDocTypes.length > 0) return;

    let cancelled = false;
    Promise.all([
      configTemplates.length > 0
        ? Promise.resolve({ data: configTemplates })
        : apiGet<any>('/api/admin/templates').catch(() => ({ data: [] })),
      rawDocTypes.length > 0
        ? Promise.resolve({ data: rawDocTypes })
        : apiGet<any>('/api/admin/registries/doc-types').catch(() => ({ data: [] })),
    ]).then(([templateRes, docTypeRes]) => {
      if (cancelled) return;
      if (configTemplates.length === 0) setFallbackTemplates(templateRes.data ?? []);
      if (rawDocTypes.length === 0) setFallbackDocTypes(docTypeRes.data ?? []);
    });

    return () => { cancelled = true; };
  }, [configTemplates, rawDocTypes]);

  // ── Select initial template when config loads ─────────────────────────────
  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      const active = templates.find((t) => t.templateStatus === 'ACTIVE') ?? templates[0];
      if (active) setSelectedTemplateId(active.id);
    }
  }, [templates, selectedTemplateId]);

  // ── Fetch rules when template changes ─────────────────────────────────────
  const fetchRules = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const res = await apiGet<any>(`/api/admin/validation-rules?templateId=${tid}`);
      const data: ValidationRule[] = res.data ?? [];
      setRules(data);
      // Auto-expand all groups on first load
      setExpandedGroups(new Set(data.map((r) => r.sourceDocType)));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedTemplateId) fetchRules(selectedTemplateId);
  }, [selectedTemplateId, fetchRules]);

  // ── Immediate save helper ─────────────────────────────────────────────────
  async function saveRule(rule: ValidationRule, patch: Partial<ValidationRule>) {
    setSavingRules((s) => new Set(s).add(rule.id));
    const prev = { ...rule };
    setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, ...patch } : r));
    try {
      await apiPut(`/api/admin/validation-rules/${rule.id}`, patch);
      toast({ title: 'Rule updated', description: rule.ruleCode });
    } catch {
      setRules((rs) => rs.map((r) => r.id === rule.id ? prev : r));
      toast({ title: 'Failed to update', variant: 'destructive' });
    }
    setSavingRules((s) => { const n = new Set(s); n.delete(rule.id); return n; });
  }

  function handleToggleActive(rule: ValidationRule) {
    if (rule.isActive) setDisableDialog(rule);
    else saveRule(rule, { isActive: true });
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────
  async function bulkSetBehavior(behavior: string) {
    for (const rule of filteredRules.filter((r) => r.blockingBehavior !== behavior)) {
      await saveRule(rule, { blockingBehavior: behavior });
    }
  }
  async function bulkDeactivate() {
    for (const rule of filteredRules.filter((r) => r.isActive)) {
      await saveRule(rule, { isActive: false });
    }
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredRules = useMemo(() => {
    let rs = rules;
    if (search.trim()) {
      const q = search.toLowerCase();
      rs = rs.filter((r) =>
        r.ruleCode.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.sourceField.toLowerCase().includes(q) ||
        r.targetField.toLowerCase().includes(q) ||
        (r.sourceFieldLabel ?? '').toLowerCase().includes(q) ||
        (r.targetFieldLabel ?? '').toLowerCase().includes(q)
      );
    }
    if (filterMode === 'blocking') rs = rs.filter((r) => r.blockingBehavior === 'BLOCK');
    if (filterMode === 'warn')     rs = rs.filter((r) => r.blockingBehavior === 'WARN');
    if (filterMode === 'inactive') rs = rs.filter((r) => !r.isActive);
    return rs;
  }, [rules, search, filterMode]);

  // ── Grouping ──────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map: Record<string, ValidationRule[]> = {};
    for (const r of filteredRules) {
      (map[r.sourceDocType] ??= []).push(r);
    }
    return map;
  }, [filteredRules]);

  const sortedGroupKeys = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      const dtA = docTypes.find((d) => d.typeCode === a);
      const dtB = docTypes.find((d) => d.typeCode === b);
      return orderKey(dtA?.shortCode ?? a) - orderKey(dtB?.shortCode ?? b);
    });
  }, [grouped, docTypes]);

  // ── Stats (from ALL rules, not filtered) ──────────────────────────────────
  const stats = useMemo(() => ({
    total:    rules.length,
    active:   rules.filter((r) => r.isActive).length,
    blocking: rules.filter((r) => r.blockingBehavior === 'BLOCK').length,
    warning:  rules.filter((r) => r.blockingBehavior === 'WARN').length,
  }), [rules]);

  function dt(code: string) { return docTypes.find((d) => d.typeCode === code); }

  function toggleGroup(key: string) {
    setExpandedGroups((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleRule(id: string) {
    setExpandedRules((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <AdminPageHeader
        title="Validation Rules"
        description="Configure cross-validation rules, tolerances, and blocking behavior per template"
        badge={{ label: 'rules', count: rules.length }}
      />

      {/* ── Controls row ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Template selector */}
        <div style={{ minWidth: 240 }}>
          <div style={capLabel}>Viewing rules for:</div>
          <Select value={selectedTemplateId ?? ''} onValueChange={setSelectedTemplateId}>
            <SelectTrigger style={{ height: 36, fontSize: 14.5, marginTop: 4 }}>
              <SelectValue placeholder="Select template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}{' '}
                  <span style={{
                    fontSize: 14, fontWeight: 600, padding: '1px 5px', borderRadius: 99, marginLeft: 6,
                    background: t.templateStatus === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                    color: t.templateStatus === 'ACTIVE' ? '#166534' : '#854d0e',
                  }}>
                    {t.templateStatus}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stats pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatPill label="Total"    value={stats.total}    color="hsl(var(--muted-foreground))" />
          <StatPill label="Active"   value={stats.active}   color={TEAL} />
          <StatPill label="Blocking" value={stats.blocking} color="#dc2626" />
          <StatPill label="Warn"     value={stats.warning}  color="#d97706" />
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{
              position: 'absolute', left: 9, top: '50%',
              transform: 'translateY(-50%)', pointerEvents: 'none',
              color: 'hsl(var(--muted-foreground))',
            }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules…"
              style={{ paddingLeft: 30, height: 34, fontSize: 14.5, width: 200 }}
            />
          </div>
          <Select value={filterMode} onValueChange={setFilterMode}>
            <SelectTrigger style={{ height: 34, fontSize: 14.5, width: 150 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rules</SelectItem>
              <SelectItem value="blocking">Blocking only</SelectItem>
              <SelectItem value="warn">Warning only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Bulk actions bar (shown when filter is active) ────────────── */}
      {(search.trim() || filterMode !== 'all') && filteredRules.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          padding: '8px 14px', borderRadius: 8, marginBottom: 12,
          background: 'hsl(var(--muted)/0.4)', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            {filteredRules.length} filtered:
          </span>
          <button onClick={() => bulkSetBehavior('BLOCK')}
            style={{ ...pill, borderColor: '#dc2626', color: '#dc2626' }}>
            Set all → Block
          </button>
          <button onClick={() => bulkSetBehavior('WARN')}
            style={{ ...pill, borderColor: '#d97706', color: '#92400e' }}>
            Set all → Warn
          </button>
          <button onClick={bulkDeactivate} style={pill}>
            Deactivate all
          </button>
          <span style={{ width: 1, height: 18, background: 'hsl(var(--border))' }} />
          <button onClick={() => setRerunDialog(true)}
            style={{ ...pill, borderColor: TEAL, color: TEAL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={11} /> Re-run all rules
          </button>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {!selectedTemplateId ? (
        <AdminEmptyState icon="ShieldCheck" title="No template selected"
          description="Select a workflow template above to view its validation rules." />
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>
          Loading rules…
        </div>
      ) : sortedGroupKeys.length === 0 ? (
        <AdminEmptyState icon="ShieldCheck" title="No rules found"
          description={search || filterMode !== 'all'
            ? 'No rules match your current filter.'
            : 'No validation rules defined for this template.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sortedGroupKeys.map((docType) => {
            const groupRules = grouped[docType];
            const srcDt      = dt(docType);
            const isOpen     = expandedGroups.has(docType);
            const blockCnt   = groupRules.filter((r) => r.blockingBehavior === 'BLOCK').length;
            const warnCnt    = groupRules.filter((r) => r.blockingBehavior === 'WARN').length;

            return (
              <div key={docType} style={{
                borderRadius: 8, border: '1px solid hsl(var(--border))', overflow: 'hidden',
              }}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(docType)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', cursor: 'pointer', border: 'none', textAlign: 'left',
                    background: 'hsl(var(--card))',
                    borderBottom: isOpen ? '1px solid hsl(var(--border))' : 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--muted)/0.4)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'hsl(var(--card))')}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <DocBadge code={srcDt?.displayName ?? docType} geography={srcDt?.geography} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {srcDt?.displayName ?? docType}
                  </span>
                  <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                    ({groupRules.length} rule{groupRules.length !== 1 ? 's' : ''})
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                    {blockCnt > 0 && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>
                        {blockCnt} Block
                      </span>
                    )}
                    {warnCnt > 0 && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#d97706' }}>
                        {warnCnt} Warn
                      </span>
                    )}
                    {blockCnt === 0 && warnCnt === 0 && (
                      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                        All Ignore
                      </span>
                    )}
                  </div>
                </button>

                {/* Group body */}
                {isOpen && (
                  <div>
                    {/* Column headers */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 1fr 130px 110px 130px 60px',
                      padding: '5px 16px',
                      background: 'hsl(var(--muted)/0.25)',
                      borderBottom: '1px solid hsl(var(--border)/0.5)',
                    }}>
                      {['Code', 'Description / Fields', 'Target', 'Match', 'Blocking', 'Active'].map((h) => (
                        <div key={h} style={colHeader}>{h}</div>
                      ))}
                    </div>

                    {groupRules.map((rule) => {
                      const isSaving  = savingRules.has(rule.id);
                      const isExpanded = expandedRules.has(rule.id);
                      const tgtDt     = dt(rule.targetDocType);
                      const isSelf    = rule.targetDocType === rule.sourceDocType || rule.targetDocType === 'SELF';
                      const isMaster  = rule.matchType === 'MASTER_DATA';
                      const bCfg      = BEHAVIOR[rule.blockingBehavior] ?? BEHAVIOR.IGNORE;

                      return (
                        <div key={rule.id} style={{ opacity: rule.isActive ? 1 : 0.45, transition: 'opacity 0.15s' }}>
                          {/* Rule row */}
                          <div
                            onClick={() => toggleRule(rule.id)}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '100px 1fr 130px 110px 130px 60px',
                              alignItems: 'center',
                              padding: '11px 16px',
                              borderBottom: '1px solid hsl(var(--border)/0.35)',
                              cursor: 'pointer',
                              background: isExpanded ? 'hsl(var(--muted)/0.25)' : 'transparent',
                            }}
                            onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'hsl(var(--muted)/0.12)'; }}
                            onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                          >
                            {/* Code */}
                            <div>
                              <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>
                                {rule.ruleCode}
                              </span>
                            </div>

                            {/* Description + fields */}
                            <div style={{ paddingRight: 8 }}>
                              <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                                {rule.description ?? rule.ruleCode}
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                                {rule.sourceFieldLabel ?? rule.sourceField} → {rule.targetFieldLabel ?? rule.targetField}
                              </div>
                            </div>

                            {/* Target */}
                            <div>
                              {isSelf ? (
                                <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>Self-check</span>
                              ) : isMaster ? (
                                <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>Master data</span>
                              ) : (
                                <div>
                                  <DocBadge code={tgtDt?.displayName ?? rule.targetDocType} size="sm" geography={tgtDt?.geography} />
                                  <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                                    {tgtDt?.displayName ?? rule.targetDocType}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Match type */}
                            <div>
                              <span style={{
                                fontFamily: MONO, fontSize: 14, fontWeight: 700,
                                padding: '2px 7px', borderRadius: 4,
                                background: 'hsl(var(--muted)/0.6)',
                              }}>
                                {matchLabel(rule)}
                              </span>
                            </div>

                            {/* Blocking behavior — native select for inline feel */}
                            <div onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                {isSaving && (
                                  <div style={{
                                    width: 6, height: 6, borderRadius: 3,
                                    background: TEAL, flexShrink: 0,
                                  }} />
                                )}
                                <select
                                  value={rule.blockingBehavior}
                                  onChange={(e) => saveRule(rule, { blockingBehavior: e.target.value })}
                                  disabled={isSaving}
                                  style={{
                                    fontSize: 14, fontWeight: 700,
                                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                                    border: `1px solid ${bCfg.dot}`,
                                    background: bCfg.bg, color: bCfg.text,
                                  }}
                                >
                                  <option value="BLOCK">Block</option>
                                  <option value="WARN">Warn</option>
                                  <option value="IGNORE">Ignore</option>
                                </select>
                              </div>
                            </div>

                            {/* Active toggle */}
                            <div onClick={(e) => e.stopPropagation()}>
                              <Switch
                                checked={rule.isActive}
                                onCheckedChange={() => handleToggleActive(rule)}
                                disabled={isSaving}
                              />
                            </div>
                          </div>

                          {/* Expanded detail panel */}
                          {isExpanded && (
                            <div style={{
                              marginLeft: 100,
                              padding: '16px 20px',
                              background: 'hsl(var(--muted)/0.15)',
                              borderBottom: '1px solid hsl(var(--border)/0.4)',
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 24,
                            }}>
                              {/* Left — field mapping */}
                              <div>
                                <div style={capLabel}>Field Mapping</div>
                                <div style={card}>
                                  <div>
                                    <div style={subLabel}>Source</div>
                                    <div style={{ fontSize: 14.5, fontWeight: 500 }}>{rule.sourceFieldLabel ?? rule.sourceField}</div>
                                    <div style={{ fontFamily: MONO, fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                                      {rule.sourceField} · {srcDt?.displayName ?? rule.sourceDocType}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'center', fontSize: 18, color: TEAL, margin: '6px 0' }}>→</div>
                                  <div>
                                    <div style={subLabel}>Target</div>
                                    {isSelf ? (
                                      <div style={{ fontSize: 14, fontStyle: 'italic', color: 'hsl(var(--muted-foreground))' }}>
                                        Validates against itself (format/pattern check)
                                      </div>
                                    ) : isMaster ? (
                                      <div style={{ fontSize: 14, fontStyle: 'italic', color: 'hsl(var(--muted-foreground))' }}>
                                        Validates against configured master data value
                                      </div>
                                    ) : (
                                      <>
                                        <div style={{ fontSize: 14.5, fontWeight: 500 }}>{rule.targetFieldLabel ?? rule.targetField}</div>
                                        <div style={{ fontFamily: MONO, fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                                          {rule.targetField} · {tgtDt?.displayName ?? rule.targetDocType}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right — configuration */}
                              <div>
                                <div style={capLabel}>Configuration</div>
                                <div style={{ ...card, gap: 14 }}>
                                  {/* Match type */}
                                  <div>
                                    <div style={subLabel}>Match Type</div>
                                    <div style={{ fontSize: 14, marginTop: 2 }}>
                                      {MATCH_FULL[rule.matchType] ?? rule.matchType}
                                    </div>
                                  </div>

                                  {/* Tolerance editor */}
                                  {rule.matchType === 'NUMERIC_TOLERANCE' && (
                                    <ToleranceEditor
                                      tolerance={rule.tolerance}
                                      onSave={(t) => saveRule(rule, { tolerance: t })}
                                    />
                                  )}

                                  {/* Blocking behavior radios */}
                                  <div>
                                    <div style={subLabel}>Blocking Behavior</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                                      {(['BLOCK', 'WARN', 'IGNORE'] as const).map((b) => {
                                        const cfg = BEHAVIOR[b];
                                        const sel = rule.blockingBehavior === b;
                                        return (
                                          <label key={b} style={{
                                            display: 'flex', alignItems: 'flex-start', gap: 8,
                                            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                            background: sel ? cfg.bg : 'transparent',
                                            border: sel ? `1px solid ${cfg.dot}` : '1px solid transparent',
                                          }}>
                                            <input
                                              type="radio"
                                              name={`beh-${rule.id}`}
                                              value={b}
                                              checked={sel}
                                              onChange={() => saveRule(rule, { blockingBehavior: b })}
                                              style={{ marginTop: 2, accentColor: cfg.dot }}
                                            />
                                            <div>
                                              <div style={{ fontSize: 14, fontWeight: 700, color: cfg.text }}>{b}</div>
                                              <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                                                {b === 'BLOCK'  && 'Failed validation blocks the gate. Task created with SLA.'}
                                                {b === 'WARN'   && 'Failed validation creates a warning task. Gate NOT blocked.'}
                                                {b === 'IGNORE' && 'Result logged but no task or gate impact.'}
                                              </div>
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Active */}
                                  <div>
                                    <div style={subLabel}>Active</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                      <Switch
                                        checked={rule.isActive}
                                        onCheckedChange={() => handleToggleActive(rule)}
                                      />
                                      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                                        {rule.isActive ? 'Active — documents are checked' : 'Disabled — no checks run'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Change history */}
                                  {(rule.statusHistory?.length ?? 0) > 0 && (
                                    <RuleHistory entries={rule.statusHistory} />
                                  )}

                                  {/* Last updated */}
                                  {rule.updatedAt && (
                                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                                      Last updated {new Date(rule.updatedAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Re-run button at bottom */}
      {rules.length > 0 && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="outline" size="sm" onClick={() => setRerunDialog(true)}
            style={{ color: TEAL, borderColor: TEAL }}>
            <RefreshCw size={13} style={{ marginRight: 5 }} />
            Re-run all rules
          </Button>
        </div>
      )}

      {/* Disable confirm */}
      <AdminConfirmDialog
        open={!!disableDialog}
        onClose={() => setDisableDialog(null)}
        onConfirm={() => { if (disableDialog) saveRule(disableDialog, { isActive: false }); setDisableDialog(null); }}
        title={`Disable ${disableDialog?.ruleCode}?`}
        description={`${disableDialog?.description ?? disableDialog?.ruleCode} will no longer be validated. You can re-enable it at any time.`}
        confirmLabel="Disable rule"
        confirmVariant="warning"
      />

      {/* Re-run confirm */}
      <AdminConfirmDialog
        open={rerunDialog}
        onClose={() => setRerunDialog(false)}
        onConfirm={() => {
          setRerunDialog(false);
          toast({ title: 'Re-run queued — results will update shortly' });
        }}
        title="Re-validate all documents?"
        description={`This will re-run ${rules.filter((r) => r.isActive).length} active rules against all documents in active shipments. New failures may create tasks or block gates.`}
        confirmLabel="Re-run validation"
        confirmVariant="warning"
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RuleHistory({ entries }: { entries: RuleHistoryEntry[] }) {
  const [open, setOpen] = useState(false);

  function fieldLabel(f: string) {
    if (f === 'isActive')        return 'Active status';
    if (f === 'blockingBehavior') return 'Blocking behavior';
    return f;
  }

  function valLabel(field: string, val: any) {
    if (field === 'isActive')        return val ? 'Enabled' : 'Disabled';
    if (field === 'blockingBehavior') return String(val);
    return String(val);
  }

  function valColor(field: string, val: any): string {
    if (field === 'isActive')        return val ? '#16a34a' : '#dc2626';
    if (field === 'blockingBehavior') {
      if (val === 'BLOCK')  return '#dc2626';
      if (val === 'WARN')   return '#d97706';
      return '#64748b';
    }
    return 'inherit';
  }

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'none', border: 'none', cursor: 'pointer',
          color: TEAL, fontSize: 14.5, fontWeight: 600, padding: 0,
        }}
      >
        <History size={12} />
        {open ? 'Hide' : 'Show'} change history ({entries.length})
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          marginTop: 8, border: '1px solid hsl(var(--border))',
          borderRadius: 6, overflow: 'hidden', fontSize: 14.5,
        }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 80px 1fr',
            padding: '4px 10px', background: 'hsl(var(--muted)/0.4)',
            color: 'hsl(var(--muted-foreground))', fontWeight: 600,
            borderBottom: '1px solid hsl(var(--border))',
          }}>
            <span>Field</span><span>From</span><span>To</span><span>Changed</span>
          </div>
          {entries.map((e, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 80px 1fr',
              padding: '5px 10px',
              borderBottom: i < entries.length - 1 ? '1px solid hsl(var(--border)/0.5)' : 'none',
              background: i % 2 === 0 ? 'transparent' : 'hsl(var(--muted)/0.1)',
            }}>
              <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                {fieldLabel(e.field)}
              </span>
              <span style={{ color: valColor(e.field, e.from), fontWeight: 600 }}>
                {valLabel(e.field, e.from)}
              </span>
              <span style={{ color: valColor(e.field, e.to), fontWeight: 600 }}>
                {valLabel(e.field, e.to)}
              </span>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>
                <span style={{ fontWeight: 500, color: 'hsl(var(--foreground))' }}>{e.changedByName}</span>
                {' · '}
                {new Date(e.changedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                {' '}
                {new Date(e.changedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocBadge({ code, geography, size = 'md' }: {
  code: string; geography?: string; size?: 'sm' | 'md';
}) {
  const geo: Record<string, { bg: string; text: string }> = {
    INDIA:  { bg: '#dbeafe', text: '#1e40af' },
    US:     { bg: '#dcfce7', text: '#166534' },
    GLOBAL: { bg: '#f3e8ff', text: '#6b21a8' },
  };
  const cfg = geo[(geography ?? '').toUpperCase()] ?? { bg: 'hsl(var(--muted)/0.7)', text: 'hsl(var(--foreground))' };
  return (
    <span style={{
      fontFamily: MONO,
      fontSize: size === 'sm' ? 10 : 11,
      fontWeight: 700,
      padding: size === 'sm' ? '1px 5px' : '2px 7px',
      borderRadius: 4,
      background: cfg.bg,
      color: cfg.text,
      flexShrink: 0,
      display: 'inline-block',
    }}>
      {code}
    </span>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 8,
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{label}</span>
    </div>
  );
}

function ToleranceEditor({
  tolerance, onSave,
}: {
  tolerance: any;
  onSave: (val: number) => void;
}) {
  const [val, setVal]   = useState(parseTol(tolerance));
  const [ok, setOk]     = useState(false);

  function commit() {
    const n = parseFloat(val);
    if (!isNaN(n) && n !== parseFloat(parseTol(tolerance))) {
      onSave(n);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    }
  }

  return (
    <div>
      <div style={subLabel}>Tolerance</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Input
          type="number" value={val} min={0} step={0.1}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          style={{
            width: 75, height: 30, fontSize: 14.5, fontFamily: MONO,
            border: ok ? '1px solid #16a34a' : undefined,
          }}
        />
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>%</span>
        {ok && <span style={{ fontSize: 14.5, color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>}
      </div>
      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
        Values within this percentage are considered matching
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const capLabel: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'hsl(var(--muted-foreground))',
  marginBottom: 6,
};

const subLabel: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'hsl(var(--muted-foreground))',
};

const colHeader: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))',
  padding: '0 4px',
};

const card: React.CSSProperties = {
  background: 'hsl(var(--card))', borderRadius: 8,
  padding: 14, border: '1px solid hsl(var(--border))',
  display: 'flex', flexDirection: 'column', gap: 10,
};

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 10px', borderRadius: 6, fontSize: 14,
  cursor: 'pointer', border: '1px solid hsl(var(--border))',
  background: 'transparent', color: 'hsl(var(--foreground))',
  fontWeight: 500,
};
