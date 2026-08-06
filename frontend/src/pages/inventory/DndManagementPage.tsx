import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import {
  DollarSign, Calendar, Scale, Bell, AlertTriangle,
  ChevronRight, CheckCircle, XCircle, MinusCircle, Circle,
  Wifi, Calculator, HelpCircle, Upload, X, FileText, Download, Settings,
  CalendarDays, Plus, Search,
} from 'lucide-react';
import { apiGet, apiPost, getAuthToken } from '@/lib/api';
import { RequireActivity } from '@/components/PermissionGate';
import { useShipments } from '@/hooks/useOperationalData';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ewms/SegmentedControl';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {};
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Tab definitions ──────────────────────────────────
type DndModuleMode = 'tariffMaster' | 'holidayCalendar';
type TariffStatus = 'Active' | 'Draft' | 'Sunsetting' | 'Expired';
type CargoMode = 'FCL' | 'Breakbulk';
type ChargeType = 'Demurrage' | 'Detention' | 'Storage';
type PricingMethodKey = 'flat' | 'tier' | 'slab';
type FreeTimeGroup = { event: string; days: number[] };
type SlabRow = { from: number; to: number; rate: number };
type LanePair = { origin: string; originName: string; dest: string; destName: string };
type CarrierMaster = { id: string; carrierName: string; scac: string; isActive?: boolean };
type TariffDraft = {
  carrier: string;
  scac: string;
  status: 'Draft' | 'Active';
  effFrom: string;
  effTo: string;
  description: string;
  lane: string;
  originCountry: string;
  cargo: CargoMode;
  containerType: string;
  weightConfig: string;
  lanePairs: LanePair[];
  chargeTypes: ChargeType[];
  freeTime: FreeTimeGroup[];
  pricingMethods: Record<PricingMethodKey, {
    enabled: boolean;
    rate?: number;
    currency?: string;
    basis?: string;
    weightUnit?: string;
    threshold?: number;
    mult?: number;
    rows?: SlabRow[];
  }>;
  exclusionDefault: { weekends: boolean; holidays: boolean };
};

type TariffRecord = {
  id: string;
  carrier: string;
  scac: string;
  lane: string;
  cargo: CargoMode | 'Container' | 'Break Bulk';
  status: TariffStatus;
  version: number;
  lanePairs: LanePair[];
  chargeTypes: ChargeType[];
  pricingMethods: PricingMethodKey[];
  freeTime: Array<{ event: string; days: number[] }>;
  exclusionDefault: { weekends: boolean; holidays: boolean };
  effFrom: string;
  effTo: string;
  linkedShipments: number;
};

type ApiData<T> = { data: T };

const MODULE_MODES = [
  { value: 'tariffMaster', label: 'D&D Tariff Master' },
  { value: 'holidayCalendar', label: 'Holiday Calendar' },
] as const;

const EVENT_OPTIONS = ['Container Discharge', 'Container Available', 'Gate Out', 'Rail Ramp Arrival'] as const;
const CURRENCY_OPTIONS = ['USD', 'EUR', 'INR'] as const;
const CONTAINER_OPTIONS = ['20GP', '40GP', '40HC', 'Reefer'] as const;
const ADD_NEW_CARRIER_VALUE = '__add_new_carrier__';

function createBlankTariffDraft(): TariffDraft {
  return {
  carrier: '',
  scac: '',
  status: 'Draft',
  effFrom: '',
  effTo: '',
  description: '',
  lane: '',
  originCountry: '',
  cargo: 'FCL',
  containerType: '',
  weightConfig: '',
  lanePairs: [{ origin: '', originName: '', dest: '', destName: '' }],
  chargeTypes: [],
  freeTime: [{ event: '', days: [] }],
  pricingMethods: {
    flat: { enabled: false, rate: 0, currency: 'USD', basis: 'Per Container', weightUnit: 'KG' },
    tier: { enabled: false, rate: 0, threshold: 0, mult: 0, currency: 'USD' },
    slab: { enabled: false, rows: [] },
  },
  exclusionDefault: { weekends: true, holidays: false },
  };
}

function tariffStatusIntent(status: TariffStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'Active') return 'success';
  if (status === 'Sunsetting') return 'warning';
  if (status === 'Expired') return 'danger';
  return 'neutral';
}

function methodName(method: PricingMethodKey) {
  if (method === 'flat') return 'Flat Daily Rate';
  if (method === 'tier') return 'Tier Multiplier';
  return 'Slab Pricing';
}

function parseFreeDays(value: string) {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isFinite(day) && day > 0)
    .sort((a, b) => a - b);
}

function normalizeTariffRecord(record: TariffRecord): TariffRecord {
  const pricingMethods = Array.isArray(record.pricingMethods)
    ? record.pricingMethods
    : Object.entries(record.pricingMethods ?? {})
      .filter(([, value]) => value && (typeof value !== 'object' || (value as { enabled?: boolean }).enabled !== false))
      .map(([key]) => key as PricingMethodKey);
  return {
    ...record,
    cargo: (record.cargo === 'Container' ? 'FCL' : record.cargo === 'Break Bulk' ? 'Breakbulk' : record.cargo) as CargoMode,
    lanePairs: (record.lanePairs ?? []).map((pair) => ({
      origin: pair.origin ?? '',
      originName: pair.originName ?? '',
      dest: pair.dest ?? '',
      destName: pair.destName ?? '',
    })),
    chargeTypes: record.chargeTypes ?? [],
    pricingMethods,
    freeTime: record.freeTime ?? [],
    exclusionDefault: record.exclusionDefault ?? { weekends: false, holidays: false },
  };
}

function TariffMasterConsole() {
  const [tariffs, setTariffs] = useState<TariffRecord[]>([]);
  const [carriers, setCarriers] = useState<CarrierMaster[]>([]);
  const [tariffsLoading, setTariffsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TariffStatus>('all');
  const [draft, setDraft] = useState(createBlankTariffDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);

  const filteredTariffs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tariffs.filter((tariff) => {
      const matchesStatus = statusFilter === 'all' || tariff.status === statusFilter;
      const matchesQuery = !q || [
        tariff.id,
        tariff.carrier,
        tariff.scac,
        tariff.lane,
        tariff.cargo,
        tariff.lanePairs.map((pair) => `${pair.origin} ${pair.originName} ${pair.dest} ${pair.destName}`).join(' '),
      ].join(' ').toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [query, statusFilter, tariffs]);

  const stats = useMemo(() => ({
    total: tariffs.length,
    active: tariffs.filter((tariff) => tariff.status === 'Active').length,
    sunsetting: tariffs.filter((tariff) => tariff.status === 'Sunsetting').length,
    draft: tariffs.filter((tariff) => tariff.status === 'Draft').length,
  }), [tariffs]);

  async function loadTariffs() {
    setTariffsLoading(true);
    try {
      const response = await apiGet<ApiData<TariffRecord[]>>('/dnd/tariffs');
      setTariffs((response.data ?? []).map(normalizeTariffRecord));
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'Could not load D&D tariffs');
      setTariffs([]);
    } finally {
      setTariffsLoading(false);
    }
  }

  async function loadCarriers() {
    try {
      const response = await apiGet<ApiData<CarrierMaster[]>>('/dnd/carriers');
      setCarriers(response.data ?? []);
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'Could not load D&D carrier master');
      setCarriers([]);
    }
  }

  useEffect(() => {
    void loadTariffs();
    void loadCarriers();
  }, []);

  async function publishTariff() {
    const enabledMethods = Object.values(draft.pricingMethods).filter((method) => method.enabled);
    const validFreeTime = draft.freeTime.some((group) => group.event && group.days.length > 0);
    const validLanePairs = draft.lanePairs
      .filter((pair) => pair.origin.trim() && pair.dest.trim())
      .map((pair) => ({
        origin: pair.origin.trim().toUpperCase(),
        originName: pair.originName.trim(),
        dest: pair.dest.trim().toUpperCase(),
        destName: pair.destName.trim(),
      }));
    const usaScope = isUsaScope(draft);
    if (!draft.carrier || validLanePairs.length === 0 || draft.chargeTypes.length === 0 || enabledMethods.length === 0 || !validFreeTime) {
      setPublishNote('Complete carrier, port pair, charge type, free time, and at least one pricing method before publishing.');
      return;
    }

    try {
      const response = await apiPost<ApiData<TariffRecord & { sunsetTariffId?: string | null }>>('/dnd/tariffs/publish', {
        carrier: draft.carrier,
        scac: draft.scac,
        status: draft.status,
        description: draft.description,
        lane: draft.lane,
        originCountry: draft.originCountry,
        cargo: draft.cargo,
        containerType: draft.cargo === 'FCL' ? draft.containerType : null,
        weightConfig: draft.cargo === 'Breakbulk' ? draft.weightConfig : null,
        lanePairs: validLanePairs,
        chargeTypes: draft.chargeTypes,
        pricingMethods: draft.pricingMethods,
        freeTime: draft.freeTime,
        exclusionDefault: { weekends: draft.exclusionDefault.weekends, holidays: usaScope && draft.exclusionDefault.holidays },
        effFrom: draft.effFrom,
        effTo: draft.effTo,
      });
      setPublishNote(response.data.sunsetTariffId
        ? `${response.data.sunsetTariffId} moved to Sunsetting. ${response.data.id} v${response.data.version} is now Active.`
        : `${response.data.id} published as a new Active tariff.`);
      setCreateOpen(false);
      await loadTariffs();
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'Could not publish D&D tariff');
    }
  }

  async function forceExpireTariff(tariff: TariffRecord) {
    if (!confirm(`Force expire ${tariff.id} v${tariff.version}?`)) return;
    try {
      const response = await apiPost<ApiData<TariffRecord>>(`/dnd/tariffs/${tariff.id}/force-expire`, {});
      setTariffs((items) => items.map((item) => (item.id === tariff.id ? normalizeTariffRecord(response.data) : item)));
      setPublishNote(`${tariff.id} moved to Expired.`);
    } catch (error) {
      setPublishNote(error instanceof Error ? error.message : 'Could not force-expire tariff');
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          ['Total Tariffs', stats.total, 'neutral'],
          ['Active', stats.active, 'success'],
          ['Sunsetting', stats.sunsetting, 'warning'],
          ['Draft', stats.draft, 'neutral'],
        ].map(([label, value, intent]) => (
          <div key={label} className="ewms-surface ewms-card-default">
            <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
            <div className={`mt-2 font-mono text-2xl font-semibold ${intent === 'success' ? 'text-emerald-600' : intent === 'warning' ? 'text-amber-600' : 'text-foreground'}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5">
        <section className="ewms-surface ewms-card-default">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div>
              <h2 className="m-0 text-[16px] font-semibold">Published Tariffs</h2>
              <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                {tariffsLoading ? 'Loading tariff master from backend...' : 'Carrier, lane, cargo, charge-type, and version lifecycle.'}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tariffs..." className="h-9 w-[220px] pl-8" />
              </div>
              <SegmentedControl
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
                options={['all', 'Active', 'Sunsetting', 'Draft'].map((value) => ({ value, label: value }))}
              />
              <RequireActivity code="dnd.tariff.create">
                <Button
                  type="button"
                  onClick={() => {
                    setDraft(createBlankTariffDraft());
                    setPublishNote(null);
                    setCreateOpen(true);
                  }}
                  className="gap-2"
                >
                  <Plus className="size-4" /> Create Tariff
                </Button>
              </RequireActivity>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Tariff</th>
                  <th className="px-3 py-2 text-left font-semibold">Lane / Pair</th>
                  <th className="px-3 py-2 text-left font-semibold">Cargo</th>
                  <th className="px-3 py-2 text-left font-semibold">Pricing</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Shipments</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTariffs.map((tariff) => (
                  <tr key={tariff.id} className="border-t border-border">
                    <td className="px-3 py-3">
                      <div className="font-mono font-semibold">{tariff.id} v{tariff.version}</div>
                      <div className="text-[12px] text-muted-foreground">{tariff.carrier} · {tariff.scac}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{tariff.lane}</div>
                      <div className="font-mono text-[12px] text-muted-foreground">
                        {tariff.lanePairs.map((pair) => `${pair.origin}${pair.originName ? ` - ${pair.originName}` : ''} -> ${pair.dest}${pair.destName ? ` - ${pair.destName}` : ''}`).join(', ')}
                      </div>
                    </td>
                    <td className="px-3 py-3">{tariff.cargo}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {tariff.pricingMethods.map((method) => <Badge key={method} intent="neutral" size="sm">{methodName(method)}</Badge>)}
                      </div>
                    </td>
                    <td className="px-3 py-3"><Badge intent={tariffStatusIntent(tariff.status)} size="sm" hasDot>{tariff.status}</Badge></td>
                    <td className="px-3 py-3 text-right font-mono">{tariff.linkedShipments}</td>
                    <td className="px-3 py-3 text-right">
                      {tariff.status !== 'Expired' && (
                        <RequireActivity code="dnd.tariff.force_expire">
                        <Button type="button" variant="outline" size="sm" onClick={() => forceExpireTariff(tariff)}>
                          Force Expire
                        </Button>
                        </RequireActivity>
                      )}
                    </td>
                  </tr>
                ))}
                {!tariffsLoading && filteredTariffs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                      No D&D tariffs found. Publish a tariff to create the first Active version.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <TariffCreateDialog
        open={createOpen}
        draft={draft}
        carriers={carriers}
        publishNote={publishNote}
        onOpenChange={setCreateOpen}
        onDraftChange={setDraft}
        onCarriersChange={setCarriers}
        onPublish={publishTariff}
      />
    </div>
  );
}

function isUsaScope(draft: TariffDraft) {
  return draft.lanePairs.some((pair) => /USLAX|USNYC|USA|US[A-Z]{3}/i.test(pair.dest)) || /USA|US[A-Z]{3}/i.test(draft.lane);
}

function enabledPricingMethods(draft: TariffDraft) {
  return (Object.entries(draft.pricingMethods) as Array<[PricingMethodKey, TariffDraft['pricingMethods'][PricingMethodKey]]>)
    .filter(([, value]) => value.enabled)
    .map(([key]) => key);
}

function slabWarnings(rows: SlabRow[]) {
  const warnings: string[] = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (rows[i].to >= rows[i + 1].from) warnings.push(`Overlap: row ${i + 1} To ${rows[i].to} meets row ${i + 2} From ${rows[i + 1].from}`);
    else if (rows[i + 1].from - rows[i].to > 1) warnings.push(`Gap: uncovered range between day ${rows[i].to} and ${rows[i + 1].from}`);
  }
  return warnings;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{children}</div>;
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">{desc}</p>
    </div>
  );
}

function TariffCreateDialog({
  open,
  draft,
  carriers,
  publishNote,
  onOpenChange,
  onDraftChange,
  onCarriersChange,
  onPublish,
}: {
  open: boolean;
  draft: TariffDraft;
  carriers: CarrierMaster[];
  publishNote: string | null;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: TariffDraft) => void;
  onCarriersChange: (carriers: CarrierMaster[]) => void;
  onPublish: () => void;
}) {
  const usaScope = isUsaScope(draft);
  const methods = enabledPricingMethods(draft);
  const warnings = slabWarnings(draft.pricingMethods.slab.rows ?? []);
  const [newCarrierOpen, setNewCarrierOpen] = useState(false);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [newScac, setNewScac] = useState('');
  const [carrierNote, setCarrierNote] = useState<string | null>(null);
  const carrierNames = useMemo(
    () => Array.from(new Set(carriers.map((carrier) => carrier.carrierName).filter(Boolean))).sort(),
    [carriers],
  );
  const scacOptions = useMemo(
    () => carriers
      .filter((carrier) => carrier.carrierName === draft.carrier)
      .map((carrier) => carrier.scac)
      .filter(Boolean),
    [carriers, draft.carrier],
  );

  function selectCarrier(carrier: string) {
    if (carrier === ADD_NEW_CARRIER_VALUE) {
      setNewCarrierName('');
      setNewScac('');
      setCarrierNote(null);
      setNewCarrierOpen(true);
      return;
    }
    const firstScac = carriers.find((item) => item.carrierName === carrier)?.scac ?? '';
    onDraftChange({ ...draft, carrier, scac: firstScac });
  }

  async function saveNewCarrier() {
    const carrierName = newCarrierName.trim().toUpperCase();
    const scac = newScac.trim().toUpperCase();
    if (!carrierName || !scac) {
      setCarrierNote('Enter carrier name and SCAC code.');
      return;
    }
    try {
      const response = await apiPost<ApiData<CarrierMaster>>('/dnd/carriers', { carrierName, scac });
      const saved = response.data;
      const nextCarriers = [
        ...carriers.filter((carrier) => !(carrier.carrierName === saved.carrierName && carrier.scac === saved.scac)),
        saved,
      ].sort((a, b) => `${a.carrierName}-${a.scac}`.localeCompare(`${b.carrierName}-${b.scac}`));
      onCarriersChange(nextCarriers);
      onDraftChange({ ...draft, carrier: saved.carrierName, scac: saved.scac });
      setNewCarrierOpen(false);
    } catch (error) {
      setCarrierNote(error instanceof Error ? error.message : 'Could not save carrier.');
    }
  }

  function updatePricing(method: PricingMethodKey, patch: Partial<TariffDraft['pricingMethods'][PricingMethodKey]>) {
    onDraftChange({ ...draft, pricingMethods: { ...draft.pricingMethods, [method]: { ...draft.pricingMethods[method], ...patch } } });
  }

  function togglePricing(method: PricingMethodKey) {
    const enabledCount = methods.length;
    const isEnabled = draft.pricingMethods[method].enabled;
    if (isEnabled && enabledCount === 1) return;
    updatePricing(method, { enabled: !isEnabled });
  }

  function toggleCharge(charge: ChargeType) {
    const next = draft.chargeTypes.includes(charge)
      ? draft.chargeTypes.filter((item) => item !== charge)
      : [...draft.chargeTypes, charge];
    onDraftChange({ ...draft, chargeTypes: next });
  }

  function updateLanePair(index: number, patch: Partial<LanePair>) {
    onDraftChange({ ...draft, lanePairs: draft.lanePairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)) });
  }

  function addLanePair() {
    onDraftChange({ ...draft, lanePairs: [...draft.lanePairs, { origin: '', originName: '', dest: '', destName: '' }] });
  }

  function removeLanePair(index: number) {
    if (draft.lanePairs.length <= 1) return;
    onDraftChange({ ...draft, lanePairs: draft.lanePairs.filter((_, i) => i !== index) });
  }

  function updateFreeEvent(index: number, event: string) {
    const duplicateIndex = draft.freeTime.findIndex((group, i) => i !== index && group.event === event);
    if (duplicateIndex >= 0) {
      const merged = draft.freeTime.map((group, i) => (
        i === duplicateIndex
          ? { ...group, days: Array.from(new Set([...group.days, ...draft.freeTime[index].days])).sort((a, b) => a - b) }
          : group
      )).filter((_, i) => i !== index);
      onDraftChange({ ...draft, freeTime: merged });
      return;
    }
    onDraftChange({ ...draft, freeTime: draft.freeTime.map((group, i) => (i === index ? { ...group, event } : group)) });
  }

  function addFreeTimeGroup() {
    const used = new Set(draft.freeTime.map((group) => group.event));
    const event = EVENT_OPTIONS.find((option) => !used.has(option)) ?? EVENT_OPTIONS[0];
    onDraftChange({ ...draft, freeTime: [...draft.freeTime, { event, days: [] }] });
  }

  function removeFreeTimeGroup(index: number) {
    if (draft.freeTime.length <= 1) return;
    onDraftChange({ ...draft, freeTime: draft.freeTime.filter((_, i) => i !== index) });
  }

  function addDay(index: number, value: string) {
    const day = Number(value);
    if (!Number.isFinite(day) || day < 1 || draft.freeTime[index].days.includes(day)) return;
    onDraftChange({
      ...draft,
      freeTime: draft.freeTime.map((group, i) => (
        i === index ? { ...group, days: [...group.days, day].sort((a, b) => a - b) } : group
      )),
    });
  }

  function removeDay(groupIndex: number, day: number) {
    onDraftChange({
      ...draft,
      freeTime: draft.freeTime.map((group, i) => (
        i === groupIndex ? { ...group, days: group.days.filter((item) => item !== day) } : group
      )),
    });
  }

  function updateSlab(index: number, patch: Partial<SlabRow>) {
    updatePricing('slab', { rows: (draft.pricingMethods.slab.rows ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  function addSlabRow() {
    const rows = draft.pricingMethods.slab.rows ?? [];
    if (rows.length === 0) {
      updatePricing('slab', { rows: [{ from: 0, to: 0, rate: 0 }] });
      return;
    }
    const last = rows[rows.length - 1];
    updatePricing('slab', { rows: [...rows, { from: last.to + 1, to: last.to + 1, rate: 0 }] });
  }

  function deleteSlabRow(index: number) {
    updatePricing('slab', { rows: (draft.pricingMethods.slab.rows ?? []).filter((_, i) => i !== index) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-48px)] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Create Tariff</DialogTitle>
          <DialogDescription>Carrier + Port Pair(s) + Cargo + Charge Type form the uniqueness key checked at Publish.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Carrier Information" desc="Base identity of the carrier this tariff template applies to." />
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <FieldLabel>Carrier Name *</FieldLabel>
                <Select value={draft.carrier} onValueChange={selectCarrier}>
                  <SelectTrigger><SelectValue placeholder="Select carrier" /></SelectTrigger>
                  <SelectContent>
                    <RequireActivity code="dnd.tariff.create">
                      <SelectItem value={ADD_NEW_CARRIER_VALUE}>+ Add new carrier</SelectItem>
                    </RequireActivity>
                    {carrierNames.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel>SCAC Code</FieldLabel>
                {scacOptions.length > 0 ? (
                  <Select value={draft.scac || scacOptions[0]} onValueChange={(scac) => onDraftChange({ ...draft, scac })}>
                    <SelectTrigger><SelectValue placeholder="Select SCAC" /></SelectTrigger>
                    <SelectContent>
                      {scacOptions.map((scac) => <SelectItem key={scac} value={scac}>{scac}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={draft.scac} onChange={(event) => onDraftChange({ ...draft, scac: event.target.value.toUpperCase() })} />
                )}
              </div>
              <div>
                <FieldLabel>Status</FieldLabel>
                <SegmentedControl value={draft.status} onValueChange={(status) => onDraftChange({ ...draft, status: status as TariffDraft['status'] })} options={[{ value: 'Draft', label: 'Draft' }, { value: 'Active', label: 'Active' }]} />
              </div>
              <div><FieldLabel>Effective From *</FieldLabel><Input type="date" value={draft.effFrom} onChange={(event) => onDraftChange({ ...draft, effFrom: event.target.value })} /></div>
              <div><FieldLabel>Effective To *</FieldLabel><Input type="date" value={draft.effTo} onChange={(event) => onDraftChange({ ...draft, effTo: event.target.value })} /></div>
              <div><FieldLabel>Description</FieldLabel><Input value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} placeholder="Internal notes for this tariff" /></div>
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Applicability" desc="Add every Origin-Destination pair that shares this exact pricing structure." />
            <div className="grid gap-3 md:grid-cols-3">
              <div><FieldLabel>Trade Lane</FieldLabel><Input value={draft.lane} onChange={(event) => onDraftChange({ ...draft, lane: event.target.value })} /></div>
              <div><FieldLabel>Origin Country</FieldLabel><Input value={draft.originCountry} onChange={(event) => onDraftChange({ ...draft, originCountry: event.target.value })} /></div>
              <div>
                <FieldLabel>Cargo Type *</FieldLabel>
                <SegmentedControl value={draft.cargo} onValueChange={(cargo) => onDraftChange({ ...draft, cargo: cargo as CargoMode })} options={[{ value: 'FCL', label: 'FCL' }, { value: 'Breakbulk', label: 'Breakbulk' }]} />
              </div>
              {draft.cargo === 'FCL' ? (
                <div>
                  <FieldLabel>Container Type</FieldLabel>
                  <Select value={draft.containerType} onValueChange={(containerType) => onDraftChange({ ...draft, containerType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTAINER_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="md:col-span-3"><FieldLabel>Weight-Based Configuration</FieldLabel><Input value={draft.weightConfig} onChange={(event) => onDraftChange({ ...draft, weightConfig: event.target.value })} placeholder="e.g. per metric ton threshold" /></div>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <FieldLabel>Origin Port - Destination Port Pair(s) *</FieldLabel>
              {draft.lanePairs.map((pair, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[120px_minmax(160px,1fr)_120px_minmax(160px,1fr)_auto]">
                  <Input value={pair.origin} onChange={(event) => updateLanePair(index, { origin: event.target.value.toUpperCase() })} placeholder="Origin code" />
                  <Input value={pair.originName} onChange={(event) => updateLanePair(index, { originName: event.target.value })} placeholder="Origin port name" />
                  <Input value={pair.dest} onChange={(event) => updateLanePair(index, { dest: event.target.value.toUpperCase() })} placeholder="Dest code" />
                  <Input value={pair.destName} onChange={(event) => updateLanePair(index, { destName: event.target.value })} placeholder="Destination port name" />
                  <Button type="button" variant="outline" size="icon" onClick={() => removeLanePair(index)} disabled={draft.lanePairs.length <= 1} aria-label="Remove port pair">
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLanePair} className="gap-2"><Plus className="size-4" /> Add Port Pair</Button>
            </div>

            <div className="mt-4">
              <FieldLabel>Charge Type *</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {(['Demurrage', 'Detention'] as ChargeType[]).map((charge) => (
                  <Button key={charge} type="button" variant={draft.chargeTypes.includes(charge) ? 'default' : 'outline'} size="sm" onClick={() => toggleCharge(charge)}>{charge}</Button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Free Time Configuration" desc="Each Start Event can carry multiple free-day values. Duplicate day values within the same event are blocked." />
            <div className="space-y-3">
              {draft.freeTime.map((group, index) => (
                <div key={`${group.event}-${index}`} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
                    <Select value={group.event} onValueChange={(event) => updateFreeEvent(index, event)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{EVENT_OPTIONS.map((event) => <SelectItem key={event} value={event}>{event}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="flex flex-wrap items-center gap-2">
                      {group.days.length === 0 ? <span className="text-[12px] text-muted-foreground">No free-day values yet</span> : group.days.map((day) => (
                        <Badge key={day} intent="neutral" size="sm">{day}d <button type="button" onClick={() => removeDay(index, day)} className="ml-1 text-muted-foreground">x</button></Badge>
                      ))}
                    </div>
                    <Button type="button" variant="outline" size="icon" onClick={() => removeFreeTimeGroup(index)} disabled={draft.freeTime.length <= 1} aria-label="Remove start event"><X className="size-4" /></Button>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[120px_auto]">
                    <Input type="number" min={1} placeholder="e.g. 10" onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        addDay(index, event.currentTarget.value);
                        event.currentTarget.value = '';
                      }
                    }} />
                    <Button type="button" variant="outline" size="sm" onClick={(event) => {
                      const input = event.currentTarget.previousElementSibling as HTMLInputElement | null;
                      addDay(index, input?.value ?? '');
                      if (input) input.value = '';
                    }}>Add Day</Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addFreeTimeGroup} className="gap-2"><Plus className="size-4" /> Add Start Event</Button>
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Pricing Configuration" desc="Flat, Tier and Slab are not mutually exclusive; configure any combination." />
            <div className="grid gap-2 md:grid-cols-3">
              {(['flat', 'tier', 'slab'] as PricingMethodKey[]).map((method) => (
                <Button key={method} type="button" variant={draft.pricingMethods[method].enabled ? 'default' : 'outline'} onClick={() => togglePricing(method)} className="h-auto justify-start gap-2 py-3">
                  <Calculator className="size-4" /> <span className="text-left">{methodName(method)}</span>
                </Button>
              ))}
            </div>

            {draft.pricingMethods.flat.enabled && (
              <div className="mt-3 rounded-md border border-border p-3">
                <h4 className="m-0 mb-3 text-[13px] font-semibold">Flat Daily Rate</h4>
                <div className="grid gap-3 md:grid-cols-4">
                  <div><FieldLabel>Daily Rate</FieldLabel><Input type="number" value={draft.pricingMethods.flat.rate ?? 0} onChange={(event) => updatePricing('flat', { rate: Number(event.target.value) || 0 })} /></div>
                  <div>
                    <FieldLabel>Currency</FieldLabel>
                    <Select value={draft.pricingMethods.flat.currency} onValueChange={(currency) => updatePricing('flat', { currency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCY_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div>
                    <FieldLabel>Charge Basis</FieldLabel>
                    <Select value={draft.pricingMethods.flat.basis} onValueChange={(basis) => updatePricing('flat', { basis })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Per Container">Per Container</SelectItem><SelectItem value="Per Weight">Per Weight</SelectItem></SelectContent></Select>
                  </div>
                  {draft.pricingMethods.flat.basis === 'Per Weight' && (
                    <div>
                      <FieldLabel>Weight Unit</FieldLabel>
                      <Select value={draft.pricingMethods.flat.weightUnit} onValueChange={(weightUnit) => updatePricing('flat', { weightUnit })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['KG', 'MT', 'LB'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {draft.pricingMethods.tier.enabled && (
              <div className="mt-3 rounded-md border border-border p-3">
                <h4 className="m-0 mb-3 text-[13px] font-semibold">Tier Multiplier</h4>
                <div className="grid gap-3 md:grid-cols-4">
                  <div><FieldLabel>Daily Rate</FieldLabel><Input type="number" value={draft.pricingMethods.tier.rate ?? 0} onChange={(event) => updatePricing('tier', { rate: Number(event.target.value) || 0 })} /></div>
                  <div><FieldLabel>Tier Threshold (days)</FieldLabel><Input type="number" value={draft.pricingMethods.tier.threshold ?? 0} onChange={(event) => updatePricing('tier', { threshold: Number(event.target.value) || 0 })} /></div>
                  <div><FieldLabel>Tier Multiplier</FieldLabel><Input type="number" step="0.1" value={draft.pricingMethods.tier.mult ?? 0} onChange={(event) => updatePricing('tier', { mult: Number(event.target.value) || 0 })} /></div>
                  <div>
                    <FieldLabel>Currency</FieldLabel>
                    <Select value={draft.pricingMethods.tier.currency} onValueChange={(currency) => updatePricing('tier', { currency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCY_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
                <div className="mt-3 rounded-md bg-muted/40 p-3 text-[13px]">
                  1-{draft.pricingMethods.tier.threshold} Days: {draft.pricingMethods.tier.currency} {(draft.pricingMethods.tier.rate ?? 0).toFixed(2)}/day; {(draft.pricingMethods.tier.threshold ?? 0) + 1}+ Days: {draft.pricingMethods.tier.currency} {((draft.pricingMethods.tier.rate ?? 0) * (draft.pricingMethods.tier.mult ?? 0)).toFixed(2)}/day.
                </div>
              </div>
            )}

            {draft.pricingMethods.slab.enabled && (
              <div className="mt-3 rounded-md border border-border p-3">
                <h4 className="m-0 mb-3 text-[13px] font-semibold">Slab Pricing</h4>
                {warnings.length > 0 && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800">{warnings.join(' | ')}</div>}
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.04em] text-muted-foreground"><tr><th className="px-2 py-2 text-left">From</th><th className="px-2 py-2 text-left">To</th><th className="px-2 py-2 text-left">Rate</th><th className="w-12 px-2 py-2" /></tr></thead>
                    <tbody>{(draft.pricingMethods.slab.rows ?? []).map((row, index) => (
                      <tr key={index} className="border-t border-border">
                        <td className="p-2"><Input type="number" value={row.from} onChange={(event) => updateSlab(index, { from: Number(event.target.value) || 0 })} /></td>
                        <td className="p-2"><Input type="number" value={row.to} onChange={(event) => updateSlab(index, { to: Number(event.target.value) || 0 })} /></td>
                        <td className="p-2"><Input type="number" value={row.rate} onChange={(event) => updateSlab(index, { rate: Number(event.target.value) || 0 })} /></td>
                        <td className="p-2"><Button type="button" variant="outline" size="icon" onClick={() => deleteSlabRow(index)} aria-label="Delete slab row"><X className="size-4" /></Button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addSlabRow} className="mt-3 gap-2"><Plus className="size-4" /> Add Row</Button>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Calculation Rules" desc="Defines the default chargeable-day basis Operations sees on this shipment type." />
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={draft.exclusionDefault.weekends} onCheckedChange={(checked) => onDraftChange({ ...draft, exclusionDefault: { ...draft.exclusionDefault, weekends: checked === true } })} /> Weekends</label>
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={usaScope && draft.exclusionDefault.holidays} disabled={!usaScope} onCheckedChange={(checked) => onDraftChange({ ...draft, exclusionDefault: { ...draft.exclusionDefault, holidays: checked === true } })} /> Public Holidays</label>
              <div className="rounded-md bg-muted/40 p-3 text-[12px] text-muted-foreground">Public-holiday exclusion is enabled only when a Destination Port resolves to a USA port with an uploaded calendar.</div>
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <SectionTitle title="Review & Publish" desc="Publishing runs the uniqueness-key check automatically." />
            <div className="grid gap-2 text-[13px] md:grid-cols-2">
              <div><span className="text-muted-foreground">Carrier / Lane</span><div className="font-medium">{draft.carrier} / {draft.lane}</div></div>
              <div><span className="text-muted-foreground">Cargo / Charge Type</span><div className="font-medium">{draft.cargo} / {draft.chargeTypes.join(' + ') || '-'}</div></div>
              <div><span className="text-muted-foreground">Pricing Method(s)</span><div className="font-medium">{methods.map(methodName).join(', ')}</div></div>
              <div><span className="text-muted-foreground">Free-Time Groups</span><div className="font-medium">{draft.freeTime.map((group) => `${group.event}: ${group.days.join(', ') || '-'}d`).join(' | ')}</div></div>
              <div><span className="text-muted-foreground">Exclusion Default</span><div className="font-medium">Weekends: {draft.exclusionDefault.weekends ? 'Checked' : 'Unchecked'}; Holidays: {usaScope && draft.exclusionDefault.holidays ? 'Checked' : 'Unchecked'}</div></div>
              <div><span className="text-muted-foreground">Effective</span><div className="font-medium">{draft.effFrom} to {draft.effTo}</div></div>
            </div>
            {publishNote && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-[13px]">{publishNote}</div>}
          </section>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <RequireActivity code="dnd.tariff.create">
            <Button type="button" onClick={onPublish} className="gap-2"><CheckCircle className="size-4" /> Publish Tariff</Button>
          </RequireActivity>
        </DialogFooter>
      </DialogContent>
      <Dialog open={newCarrierOpen} onOpenChange={setNewCarrierOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Carrier</DialogTitle>
            <DialogDescription>Add a carrier and SCAC mapping to the D&D carrier master.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <FieldLabel>Carrier Name *</FieldLabel>
              <Input value={newCarrierName} onChange={(event) => setNewCarrierName(event.target.value.toUpperCase())} placeholder="Carrier name" />
            </div>
            <div>
              <FieldLabel>SCAC Code *</FieldLabel>
              <Input value={newScac} onChange={(event) => setNewScac(event.target.value.toUpperCase())} placeholder="SCAC code" />
            </div>
            {carrierNote && <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-[13px] text-destructive">{carrierNote}</div>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewCarrierOpen(false)}>Cancel</Button>
            <RequireActivity code="dnd.tariff.create">
              <Button type="button" onClick={saveNewCarrier}>Save Carrier</Button>
            </RequireActivity>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

type HolidayUploadRow = {
  row: number;
  port: string;
  date: string;
  name: string;
  result: 'Accepted' | 'Rejected';
  reason: string;
};

function parseHolidayCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index !== -1) ?? -1;
  const portIndex = indexOf('port code', 'port', 'port_code');
  const dateIndex = indexOf('holiday date', 'date', 'holiday_date');
  const nameIndex = indexOf('holiday name', 'name', 'holiday_name');
  const typeIndex = indexOf('type', 'holiday type', 'holiday_type');
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((col) => col.trim().replace(/^"|"$/g, ''));
    return {
      port: portIndex >= 0 ? cols[portIndex] : '',
      date: dateIndex >= 0 ? cols[dateIndex] : '',
      name: nameIndex >= 0 ? cols[nameIndex] : '',
      type: typeIndex >= 0 ? cols[typeIndex] : '',
    };
  });
}

function HolidayCalendarConsole() {
  const [rows, setRows] = useState<HolidayUploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function downloadTemplate() {
    const csv = 'Port Code,Holiday Date,Holiday Name,Year,Type\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'holiday_calendar_template.csv';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function uploadHolidayRows(nextRows: Array<{ port?: string; date?: string; name?: string; type?: string }>) {
    if (!nextRows.length) {
      setUploadError('The CSV file has no holiday rows.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const response = await apiPost<ApiData<{ accepted: number; rejected: number; rows: HolidayUploadRow[] }>>('/dnd/holidays/upload', {
        rows: nextRows,
      });
      setRows(response.data.rows ?? []);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload holiday calendar');
    } finally {
      setUploading(false);
    }
  }

  async function handleHolidayFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    await uploadHolidayRows(parseHolidayCsv(text));
  }

  const accepted = rows.filter((row) => row.result === 'Accepted').length;
  const rejected = rows.filter((row) => row.result === 'Rejected').length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="ewms-surface ewms-card-default">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[16px] font-semibold">US Holiday Calendar Upload</h2>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">Used when tariff calculation excludes holidays for USA port scope.</p>
          </div>
          <Badge intent="neutral" size="sm" leadingIcon={<CalendarDays className="size-3" />}>USA ports only</Badge>
        </div>

        <div className="rounded-md border-2 border-dashed border-border bg-muted/30 p-8 text-center">
          <Calendar className="mx-auto size-8 text-muted-foreground/50" />
          <div className="mt-3 text-[14.5px] font-semibold">Upload holiday calendar CSV</div>
          <div className="mt-1 text-[13px] text-muted-foreground">Columns: Port Code, Holiday Date, Holiday Name, Year, Type</div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleHolidayFileChange}
            />
            <RequireActivity code="dnd.holiday_calendar.upload">
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
                <Download className="size-4" /> Download Template
              </Button>
            </RequireActivity>
            <RequireActivity code="dnd.holiday_calendar.upload">
              <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
                <Upload className="size-4" /> {uploading ? 'Uploading...' : 'Upload'}
              </Button>
            </RequireActivity>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-[13px] text-destructive">
            {uploadError}
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge intent="success" size="sm">{accepted} accepted</Badge>
              <Badge intent="danger" size="sm">{rejected} rejected</Badge>
              <span className="text-[13px] text-muted-foreground">Review rejected rows before uploading corrections.</span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Row</th>
                    <th className="px-3 py-2 text-left font-semibold">Port</th>
                    <th className="px-3 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Holiday</th>
                    <th className="px-3 py-2 text-left font-semibold">Result</th>
                    <th className="px-3 py-2 text-left font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.row} className="border-t border-border">
                      <td className="px-3 py-3 font-mono">{row.row}</td>
                      <td className="px-3 py-3 font-mono">{row.port}</td>
                      <td className="px-3 py-3 font-mono">{row.date}</td>
                      <td className="px-3 py-3">{row.name}</td>
                      <td className="px-3 py-3"><Badge intent={row.result === 'Accepted' ? 'success' : 'danger'} size="sm" hasDot>{row.result}</Badge></td>
                      <td className="px-3 py-3 text-muted-foreground">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <aside className="ewms-surface ewms-card-default">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <h2 className="m-0 text-[16px] font-semibold">Validation Rules</h2>
        </div>
        <div className="space-y-3 text-[13px] text-muted-foreground">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="font-semibold text-foreground">Scope</div>
            <div>Holiday calendars apply only to USA destination or USA port pairs.</div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="font-semibold text-foreground">Duplicate Guard</div>
            <div>Reject duplicate Port + Year + Date rows so charge calculations remain deterministic.</div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="font-semibold text-foreground">Tariff Behavior</div>
            <div>If holiday exclusion is unchecked, D&D uses calendar-day basis even when a holiday calendar exists.</div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Return record modal ──────────────────────────────
function RecordReturnModal({
  charge,
  onClose,
  onSaved,
}: {
  charge: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnDate, setReturnDate] = useState('');
  const [returnDepot, setReturnDepot] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!returnDate || !returnDepot) return;
    setSaving(true);
    await fetch(`/api/dnd/${charge.id}/return`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ returnDate, returnDepot }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 w-96">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold">Record Container Return</h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close return modal">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground mb-4 font-mono">{charge.containerNumber}</p>
        <div className="space-y-3">
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Return Date</label>
            <Input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Return Depot</label>
            <Input
              value={returnDepot}
              onChange={(e) => setReturnDepot(e.target.value)}
              placeholder="Depot name"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !returnDate || !returnDepot}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── D&D Charge row ───────────────────────────────────
function DndChargeRow({
  charge,
  onRecordReturn,
}: {
  charge: any;
  onRecordReturn: (c: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = charge.rateSnapshot as any;
  const isAccruing = charge.status === 'ACCRUING';

  return (
    <div
      className={`bg-card rounded-lg overflow-hidden ${
        isAccruing
          ? 'border-l-4 border-l-red-500'
          : charge.status === 'CLOSED'
          ? 'border-l-4 border-l-teal-500'
          : ''
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="w-[120px] shrink-0">
          <Link
            href={charge.containerTrackingId ? `/inventory/containers/${charge.containerTrackingId}` : `/inventory`}
            onClick={e => e.stopPropagation()}
            className="text-[14.5px] font-mono font-semibold hover:text-teal-600 transition-colors"
          >
            {charge.containerNumber}
          </Link>
          <div className="text-[12px] text-muted-foreground">
            {charge.shipment?.id ? (
              <Link
                href={`/shipments/${charge.shipment.id}`}
                onClick={e => e.stopPropagation()}
                className="hover:text-teal-600 transition-colors"
              >
                {charge.shipment.shipmentNumber || 'Pending ID'}
              </Link>
            ) : (charge.shipment?.shipmentNumber || 'Pending ID')}
          </div>
        </div>

        <div className="w-[130px] shrink-0 hidden sm:block">
          <div className="text-[13px]">{charge.portName}</div>
          {charge.terminalName && (
            <div className="text-[12px] text-muted-foreground">{charge.terminalName}</div>
          )}
        </div>

        <div className="w-[150px] shrink-0">
          <div className="text-[13px] font-mono">LFD: {fmtDate(charge.lfd)}</div>
          <div className="text-[13px] text-muted-foreground flex items-center gap-1 mt-0.5">
            {charge.lfdSource === 'tracking_api' ? (
              <><Wifi className="w-2.5 h-2.5 text-teal-500" /> From tracking API</>
            ) : charge.lfdSource === 'calculated' ? (
              <><Calculator className="w-2.5 h-2.5 text-amber-500" /> Calculated from rate</>
            ) : (
              <><HelpCircle className="w-2.5 h-2.5 text-muted-foreground" /> Unknown source</>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {isAccruing ? (
            <div className="text-[14.5px] font-mono text-red-600 font-medium">
              {charge.currency} {Number(charge.totalCharge).toLocaleString()}
              <span className="text-[12px] text-red-400 ml-1">
                ({charge.demurrageDays}d dem + {charge.detentionDays}d det)
              </span>
            </div>
          ) : charge.status === 'CLOSED' ? (
            <div className="text-[14.5px] font-mono text-muted-foreground">
              {charge.currency} {Number(charge.totalCharge).toLocaleString()}
              <span className="text-[12px] ml-1">(closed)</span>
            </div>
          ) : (
            <div className="text-[13px] text-muted-foreground">
              Free: {charge.freeDays} days · Rate: {charge.currency}{' '}
              {Number(charge.demurrageRate).toLocaleString()}/day
            </div>
          )}
        </div>

        <div className="w-[80px] shrink-0 text-right">
          <Badge
            intent={isAccruing ? 'danger' : charge.status === 'MONITORING' ? 'neutral' : 'success'}
            size="sm"
          >
            {charge.status}
          </Badge>
          {charge.ticketId && (
            <a href="/accounting" className="text-[13px] text-teal-600 hover:underline block mt-1">
              Ticket →
            </a>
          )}
        </div>

        <ChevronRight
          className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <div className="grid grid-cols-2 gap-4 mt-3 text-[13px]">
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">Dates</div>
              <div>Discharged: <span className="font-mono">{fmtDate(charge.dischargeDate)}</span></div>
              <div>LFD: <span className="font-mono">{fmtDate(charge.lfd)}</span></div>
              {charge.gateOutDate && (
                <div>Gate out: <span className="font-mono">{fmtDate(charge.gateOutDate)}</span></div>
              )}
              {charge.returnDate && (
                <div>Returned: <span className="font-mono">{fmtDate(charge.returnDate)}</span></div>
              )}
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">Breakdown</div>
              <div>
                Demurrage: {charge.demurrageDays}d × {charge.currency}{' '}
                {Number(charge.demurrageRate).toLocaleString()} ={' '}
                <span className="font-mono font-medium">
                  {charge.currency} {Number(charge.demurrageTotal).toLocaleString()}
                </span>
              </div>
              {(charge.detentionDays > 0 || charge.gateOutDate) && (
                <div>
                  Detention: {charge.detentionDays}d × {charge.currency}{' '}
                  {Number(charge.detentionRate).toLocaleString()} ={' '}
                  <span className="font-mono font-medium">
                    {charge.currency} {Number(charge.detentionTotal).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="font-medium mt-1">
                Total:{' '}
                <span className="font-mono">
                  {charge.currency} {Number(charge.totalCharge).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {snapshot ? (
            <div className="mt-3 bg-muted/30 rounded-lg p-3 text-[12px] text-muted-foreground">
              <div className="font-medium text-foreground mb-1">Rate Source (G-S24)</div>
              <div>
                {snapshot.portName}
                {snapshot.terminalName ? ` / ${snapshot.terminalName}` : ''}
                {snapshot.shippingLine ? ` / ${snapshot.shippingLine}` : ''}
              </div>
              <div>
                Effective: {fmtDate(snapshot.effectiveDate)} · Snapshot:{' '}
                {fmtDate(snapshot.snapshotTakenAt)}
              </div>
              <div className="italic mt-1">
                Rate frozen at discharge date. Admin rate changes do not affect this container.
              </div>
            </div>
          ) : (
            <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                No rate snapshot — charges are estimated.{' '}
                <a href="/settings" className="underline hover:no-underline inline-flex items-center gap-0.5">
                  Configure rates <Settings className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}

          {!charge.returnDate && charge.status !== 'CLOSED' && (
            <RequireActivity code="SHP-002">
              <button
                onClick={() => onRecordReturn(charge)}
                className="text-[13px] text-teal-600 hover:underline mt-3 block"
              >
                Record container return
              </button>
            </RequireActivity>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 1: D&D Charges ───────────────────────────────
function DndChargesTab({
  charges,
  onRefresh,
}: {
  charges: any[];
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'monitoring' | 'accruing' | 'closed'>('all');
  const [returnCharge, setReturnCharge] = useState<any | null>(null);

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? charges
        : charges.filter((c) => c.status.toLowerCase() === filter),
    [charges, filter]
  );

  const filterOptions: Array<typeof filter> = ['all', 'monitoring', 'accruing', 'closed'];

  function handleCsvExport() {
    const rows = [
      ['Container', 'Shipment', 'Port', 'Status', 'LFD', 'Discharge Date', 'Gate Out', 'Free Days', 'Demurrage Days', 'Detention Days', 'Currency', 'Demurrage Rate', 'Detention Rate', 'Total Charge'],
      ...filtered.map(c => [
        c.containerNumber,
        c.shipment?.shipmentNumber || '',
        c.portName || '',
        c.status,
        c.lfd ? new Date(c.lfd).toISOString().split('T')[0] : '',
        c.dischargeDate ? new Date(c.dischargeDate).toISOString().split('T')[0] : '',
        c.gateOutDate ? new Date(c.gateOutDate).toISOString().split('T')[0] : '',
        c.freeDays ?? '',
        c.demurrageDays ?? '',
        c.detentionDays ?? '',
        c.currency || 'USD',
        c.demurrageRate ?? '',
        c.detentionRate ?? '',
        Number(c.totalCharge ?? 0).toFixed(2),
      ]),
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dnd-charges-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <SegmentedControl
          value={filter}
          onValueChange={(value) => setFilter(value as any)}
          options={filterOptions.map((f) => ({
            value: f,
            label: `${f} (${f === 'all' ? charges.length : charges.filter((c) => c.status.toLowerCase() === f).length})`,
          }))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCsvExport}
          className="ml-auto gap-2"
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.map((charge) => (
          <DndChargeRow key={charge.id} charge={charge} onRecordReturn={setReturnCharge} />
        ))}
        {filtered.length === 0 && (
          <div className="bg-card rounded-lg p-8 text-center">
            <DollarSign className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-[14.5px] text-muted-foreground mt-3">No D&D charges in this category</p>
          </div>
        )}
      </div>

      {returnCharge && (
        <RecordReturnModal
          charge={returnCharge}
          onClose={() => setReturnCharge(null)}
          onSaved={() => { setReturnCharge(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Calendar item ────────────────────────────────────
function CalendarItem({ charge, isPast }: { charge: any; isPast: boolean }) {
  const daysUntil = Math.ceil((new Date(charge.lfd).getTime() - Date.now()) / 86400000);
  return (
    <a
      href={charge.containerTrackingId ? `/inventory/containers/${charge.containerTrackingId}` : `/inventory`}
      className={`bg-card rounded-lg p-3 flex items-center gap-4 hover:shadow-sm transition-shadow block ${
        isPast ? 'border-l-4 border-l-red-500' : ''
      }`}
    >
      <div
        className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 ${
          isPast
            ? 'bg-red-100 text-red-700'
            : daysUntil <= 3
            ? 'bg-amber-100 text-amber-700'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <span className="text-[13px] font-bold">
          {new Date(charge.lfd).toLocaleDateString('en-IN', { day: '2-digit' })}
        </span>
        <span className="text-[13px]">
          {new Date(charge.lfd).toLocaleDateString('en-IN', { month: 'short' })}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-mono font-medium">{charge.containerNumber}</div>
        <div className="text-[12px] text-muted-foreground">
          {charge.portName} · {charge.shipment?.shipmentNumber || ''}
        </div>
      </div>
      <div className="text-right shrink-0">
        {isPast ? (
          <span className="text-[13px] font-mono text-red-600">
            {charge.currency} {Number(charge.totalCharge).toLocaleString()}
          </span>
        ) : (
          <span
            className={`text-[13px] font-medium ${
              daysUntil <= 3 ? 'text-amber-600' : 'text-muted-foreground'
            }`}
          >
            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
          </span>
        )}
      </div>
    </a>
  );
}

// ─── Tab 2: LFD Calendar ──────────────────────────────
function LfdCalendarTab({ charges }: { charges: any[] }) {
  const now = new Date();
  const next30 = new Date(now.getTime() + 30 * 86400000);

  const upcoming = useMemo(
    () =>
      charges
        .filter((c) => c.status === 'MONITORING' && new Date(c.lfd) >= now && new Date(c.lfd) <= next30)
        .sort((a, b) => new Date(a.lfd).getTime() - new Date(b.lfd).getTime()),
    [charges]
  );

  const pastLfd = useMemo(
    () =>
      charges
        .filter((c) => c.status === 'ACCRUING')
        .sort((a, b) => new Date(a.lfd).getTime() - new Date(b.lfd).getTime()),
    [charges]
  );

  const weekGroups = useMemo(() => {
    const thisWeekEnd = new Date(now.getTime() + (7 - now.getDay()) * 86400000);
    const nextWeekEnd = new Date(thisWeekEnd.getTime() + 7 * 86400000);
    return [
      { label: 'This week', items: upcoming.filter((c) => new Date(c.lfd) <= thisWeekEnd) },
      { label: 'Next week', items: upcoming.filter((c) => new Date(c.lfd) > thisWeekEnd && new Date(c.lfd) <= nextWeekEnd) },
      { label: 'Later', items: upcoming.filter((c) => new Date(c.lfd) > nextWeekEnd) },
    ].filter((g) => g.items.length > 0);
  }, [upcoming]);

  // Exposure summary: total estimated exposure for all monitored containers
  const exposureSummary = useMemo(() => {
    const byCurrency: Record<string, number> = {};
    for (const c of charges.filter(ch => ch.status !== 'CLOSED')) {
      const cur = c.currency || 'USD';
      const rate = Number(c.demurrageRate || 0);
      if (c.status === 'ACCRUING') {
        byCurrency[cur] = (byCurrency[cur] || 0) + Number(c.totalCharge || 0);
      } else if (c.lfd) {
        // Estimate max exposure if LFD passes (rate × 30 days cap)
        byCurrency[cur] = (byCurrency[cur] || 0) + rate * 30;
      }
    }
    return byCurrency;
  }, [charges]);

  return (
    <div>
      {/* Exposure summary bar */}
      {charges.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-5 p-3 bg-muted/30 rounded-lg border border-border">
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" /> Exposure Summary
          </div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span>
              <span className="font-mono font-semibold text-red-600">{pastLfd.length}</span>{' '}
              <span className="text-muted-foreground">past LFD (accruing)</span>
            </span>
            <span>
              <span className="font-mono font-semibold text-amber-600">
                {upcoming.filter(c => {
                  const d = Math.ceil((new Date(c.lfd).getTime() - now.getTime()) / 86400000);
                  return d <= 7;
                }).length}
              </span>{' '}
              <span className="text-muted-foreground">LFD within 7 days</span>
            </span>
            {Object.entries(exposureSummary).map(([cur, amt]) => (
              <span key={cur}>
                <span className="text-muted-foreground">Est. exposure:</span>{' '}
                <span className="font-mono font-semibold">{cur} {Math.round(amt).toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {pastLfd.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[14.5px] font-semibold text-red-600 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Past LFD — D&D Accruing ({pastLfd.length})
          </h3>
          <div className="space-y-1.5">
            {pastLfd.map((c) => <CalendarItem key={c.id} charge={c} isPast />)}
          </div>
        </div>
      )}

      {weekGroups.map((group) => (
        <div key={group.label} className="mb-6">
          <h3 className="text-[14.5px] font-semibold text-muted-foreground mb-2">
            {group.label} ({group.items.length})
          </h3>
          <div className="space-y-1.5">
            {group.items.map((c) => <CalendarItem key={c.id} charge={c} isPast={false} />)}
          </div>
        </div>
      ))}

      {upcoming.length === 0 && pastLfd.length === 0 && (
        <div className="bg-card rounded-lg p-8 text-center">
          <Calendar className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">No upcoming LFDs in the next 30 days</p>
        </div>
      )}
    </div>
  );
}

// ─── Data source badge ────────────────────────────────
function DataSourceBadge({ label, available }: { label: string; available: boolean }) {
  return (
    <Badge
      intent={available ? 'success' : 'neutral'}
      size="sm"
      leadingIcon={available ? <CheckCircle className="size-3" /> : <Circle className="size-3" />}
    >
      {label}
    </Badge>
  );
}

// ─── MSD Upload Modal ─────────────────────────────────
function MsdUploadModal({ shipmentId, onClose }: { shipmentId: string; onClose: () => void }) {
  const [items, setItems] = useState([{ productCode: '', quantity: '', weight: '', value: '' }]);
  const [csvMode, setCsvMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const addRow = () => setItems([...items, { productCode: '', quantity: '', weight: '', value: '' }]);
  const removeRow = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string) => {
    const updated = [...items];
    (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      const parsed = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        return { productCode: cols[0] || '', quantity: cols[1] || '', weight: cols[2] || '', value: cols[3] || '' };
      }).filter((r) => r.productCode);
      setItems(parsed);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    const validItems = items.filter((i) => i.productCode);
    if (!validItems.length) return;
    setSaving(true);
    await fetch(`/api/reconciliation/${shipmentId}/msd`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items: validItems, source: csvMode ? 'csv_upload' : 'manual' }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold">Upload MSD Data (Client ERP)</h3>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setCsvMode(false)} className={`text-[13px] px-3 py-1.5 rounded ${!csvMode ? 'bg-teal-600 text-white' : 'bg-muted'}`}>Manual entry</button>
          <button onClick={() => setCsvMode(true)} className={`text-[13px] px-3 py-1.5 rounded ${csvMode ? 'bg-teal-600 text-white' : 'bg-muted'}`}>CSV upload</button>
        </div>

        {csvMode ? (
          <div>
            <p className="text-[13px] text-muted-foreground mb-2">
              CSV columns: productCode, quantity, weight, value
            </p>
            <input type="file" accept=".csv" onChange={handleCsvUpload} className="text-[14.5px]" />
            {items.length > 1 && (
              <p className="text-[13px] text-teal-600 mt-2">{items.length} items loaded from CSV</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 text-[12px] text-muted-foreground px-1">
              <span>Product code</span><span>Qty</span><span>Weight (kg)</span><span>Value (USD)</span>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={item.productCode} onChange={(e) => updateRow(i, 'productCode', e.target.value)} placeholder="Code" className="text-[13px] border rounded px-2 py-1.5 flex-1 font-mono" />
                <input value={item.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <input value={item.weight} onChange={(e) => updateRow(i, 'weight', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <input value={item.value} onChange={(e) => updateRow(i, 'value', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-3 h-3" /></button>
              </div>
            ))}
            <button onClick={addRow} className="text-[13px] text-teal-600 hover:underline">+ Add row</button>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 border rounded-lg">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="text-[13px] px-4 py-1.5 bg-teal-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save MSD Data'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 3: 3-Way Reconciliation ─────────────────────
function ReconciliationTab() {
  const { shipments: allShipments } = useShipments();
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [reconData, setReconData] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loadingRecon, setLoadingRecon] = useState(false);

  const loadRecon = (id: string) => {
    setLoadingRecon(true);
    fetch(`/api/reconciliation/${id}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setReconData(d.data); setLoadingRecon(false); })
      .catch(() => setLoadingRecon(false));
  };

  const handleShipmentChange = (id: string | null) => {
    setSelectedShipmentId(id);
    setReconData(null);
    if (id) loadRecon(id);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={selectedShipmentId || ''}
          onChange={(e) => handleShipmentChange(e.target.value || null)}
          className="text-[14.5px] border rounded-lg px-3 py-1.5 flex-1 max-w-xs bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="">Select shipment…</option>
          {allShipments
            .filter((s: any) => s.status !== 'CANCELLED')
            .map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.shipmentNumber || 'Pending ID'} — {s.exporterName || ''}
              </option>
            ))}
        </select>

        {selectedShipmentId && (
          <button
            onClick={() => setShowUpload(true)}
            className="text-[13px] px-3 py-1.5 border rounded-lg hover:bg-muted flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> Upload MSD Data
          </button>
        )}
      </div>

      {reconData && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <DataSourceBadge label="MSD (Client ERP)" available={reconData.hasMsd} />
          <DataSourceBadge label="EWMS (Packing List)" available={reconData.hasEwms} />
          <DataSourceBadge label="3PL (GRN)" available={reconData.hasTpl} />
        </div>
      )}

      {reconData?.summary && (
        <div className="flex gap-2 mb-4 flex-wrap text-[13px]">
          <span className="px-2 py-1 rounded bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
            {reconData.summary.match} match
          </span>
          <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {reconData.summary.tolerance} within tolerance
          </span>
          <span className="px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {reconData.summary.mismatch} mismatch
          </span>
          <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
            {reconData.summary.partial} partial data
          </span>
        </div>
      )}

      {loadingRecon ? (
        <div className="text-center py-8 text-[14.5px] text-muted-foreground">Loading reconciliation data…</div>
      ) : reconData?.comparison?.length > 0 ? (
        <div className="bg-card rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2.5 px-3 font-medium">Product</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-blue-50/50 dark:bg-blue-950/10">MSD (ERP)</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-teal-50/50 dark:bg-teal-950/10">EWMS (PL)</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-purple-50/50 dark:bg-purple-950/10">3PL (GRN)</th>
                  <th className="text-center py-2.5 px-3 font-medium">Status</th>
                </tr>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1.5 px-3 font-normal">Code</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-blue-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-blue-50/30">Wt (kg)</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-teal-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-teal-50/30">Wt (kg)</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-purple-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-purple-50/30">Wt (kg)</th>
                  <th className="text-center py-1.5 px-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {reconData.comparison.map((row: any) => (
                  <tr
                    key={row.productCode}
                    className={`border-b border-muted/20 ${
                      row.qtyStatus === 'mismatch'
                        ? 'bg-red-50/30 dark:bg-red-950/10'
                        : row.qtyStatus === 'tolerance'
                        ? 'bg-amber-50/30 dark:bg-amber-950/10'
                        : ''
                    }`}
                  >
                    <td className="py-2 px-3">
                      <span className="font-mono font-medium">{row.productCode}</span>
                      <div className="text-[13px] text-muted-foreground truncate max-w-[120px]">{row.description}</div>
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-blue-50/20 dark:bg-blue-950/10">
                      {row.msd?.qty != null ? row.msd.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-blue-50/20 dark:bg-blue-950/10">
                      {row.msd?.weight != null ? row.msd.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-teal-50/20 dark:bg-teal-950/10">
                      {row.ewms?.qty != null ? row.ewms.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-teal-50/20 dark:bg-teal-950/10">
                      {row.ewms?.weight != null ? row.ewms.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-purple-50/20 dark:bg-purple-950/10">
                      {row.tpl?.qty != null ? row.tpl.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-purple-50/20 dark:bg-purple-950/10">
                      {row.tpl?.weight != null ? row.tpl.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-center py-2 px-2">
                      {row.qtyStatus === 'match' && <CheckCircle className="w-4 h-4 text-teal-500 mx-auto" />}
                      {row.qtyStatus === 'tolerance' && <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />}
                      {row.qtyStatus === 'mismatch' && <XCircle className="w-4 h-4 text-red-500 mx-auto" />}
                      {row.qtyStatus === 'partial' && <MinusCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !selectedShipmentId ? (
        <div className="bg-card rounded-lg p-8 text-center">
          <Scale className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">Select a shipment to view 3-way reconciliation</p>
        </div>
      ) : reconData ? (
        <div className="bg-card rounded-lg p-8 text-center">
          <Scale className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">No reconciliation data yet for this shipment</p>
          <p className="text-[13px] text-muted-foreground mt-1">Upload MSD data to begin comparison</p>
        </div>
      ) : null}

      {showUpload && selectedShipmentId && (
        <MsdUploadModal
          shipmentId={selectedShipmentId}
          onClose={() => {
            setShowUpload(false);
            if (selectedShipmentId) loadRecon(selectedShipmentId);
          }}
        />
      )}
    </div>
  );
}

// ─── Tab 4: Alert History ─────────────────────────────
function AlertHistoryTab({ alerts }: { alerts: any }) {
  const notifications = alerts?.notifications || [];
  const audits = alerts?.audits || [];

  const combined = useMemo(() => {
    const all = [
      ...notifications.map((n: any) => ({ type: 'notification', data: n, time: n.createdAt })),
      ...audits.map((a: any) => ({ type: 'audit', data: a, time: a.timestamp })),
    ];
    return all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [notifications, audits]);

  if (combined.length === 0) {
    return (
      <div className="bg-card rounded-lg p-8 text-center">
        <Bell className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No D&D alerts have been triggered</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {combined.map((item, idx) => (
        <div key={idx} className="bg-card rounded-lg p-3 flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            {item.type === 'notification' ? (
              item.data.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              ) : item.data.type === 'escalation' ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <Bell className="w-4 h-4 text-blue-500" />
              )
            ) : (
              <FileText className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">
              {item.type === 'notification'
                ? item.data.title
                : `${item.data.action}: ${item.data.entityType}`}
            </div>
            {item.data.message && (
              <div className="text-[12px] text-muted-foreground mt-0.5">{item.data.message}</div>
            )}
            <div className="text-[13px] text-muted-foreground mt-1">
              {new Date(item.time).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}{' '}
              {new Date(item.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────
export function DndManagementPage() {
  const [moduleMode, setModuleMode] = useState<DndModuleMode>('tariffMaster');

  return (
    <div className="ewms-page-shell">
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>
              {moduleMode === 'tariffMaster' ? 'D&D Tariff Master' : 'Holiday Calendar'}
            </h1>
          </div>
          <SegmentedControl
            value={moduleMode}
            onValueChange={(value) => setModuleMode(value as DndModuleMode)}
            options={MODULE_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
          />
        </div>
        {moduleMode === 'holidayCalendar' && (
          <div className="mt-1 text-[13px] text-muted-foreground">
            <span>Upload and validate USA port holidays for tariff calculations.</span>
          </div>
        )}
      </div>

      {moduleMode === 'holidayCalendar' ? (
        <HolidayCalendarConsole />
      ) : (
        <TariffMasterConsole />
      )}

    </div>
  );
}
