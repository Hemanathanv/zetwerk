import { useState } from 'react';
import { useParams } from 'wouter';
import { getAuthToken } from '@/lib/api';
import { useProjectDetail } from '@/hooks/useProjectDetail';
import { ProjectHeader } from '@/components/project/ProjectHeader';
import { ProjectSummaryCards } from '@/components/project/ProjectSummaryCards';
import { ProjectAttentionPanel } from '@/components/project/ProjectAttentionPanel';
import { ProjectShipmentTable } from '@/components/project/ProjectShipmentTable';
import { ProjectFinancials } from '@/components/project/ProjectFinancials';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {};
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="h-8 w-56 bg-muted/50 rounded animate-pulse" />
      <div className="h-6 w-40 bg-muted/30 rounded animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-28 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="h-48 bg-muted/20 rounded-lg animate-pulse" />
      <div className="h-32 bg-muted/20 rounded-lg animate-pulse" />
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-6 text-center">
      <i className="ti ti-alert-circle text-[32px] text-red-400 block mb-3" />
      <p className="text-[14.5px] text-foreground font-medium mb-1">Failed to load project</p>
      <p className="text-[13px] text-muted-foreground mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="text-[13px] px-4 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

// ── Edit project modal (preserved from original) ──────────────────────────────
function EditProjectModal({
  project, onClose, onSaved,
}: {
  project: { id: string; projectName: string | null; customerName: string | null; notes: string | null; status: string };
  onClose: () => void;
  onSaved: (p: Partial<typeof project>) => void;
}) {
  const [form, setForm] = useState({
    projectName:  project.projectName  ?? '',
    customerName: project.customerName ?? '',
    notes:        project.notes        ?? '',
    status:       project.status,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
      });
      const d = await res.json();
      if (d.ok) onSaved(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 w-[420px] shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold">Edit Project</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Project Name', field: 'projectName' as const },
            { label: 'Customer Name', field: 'customerName' as const },
          ].map(({ label, field }) => (
            <div key={field}>
              <label className="text-[13px] text-muted-foreground block mb-1">{label}</label>
              <input
                value={form[field]}
                onChange={e => setForm({ ...form, [field]: e.target.value })}
                className="w-full text-[14.5px] border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          ))}
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Status</label>
            <select
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}
              className="w-full text-[14.5px] border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full text-[14.5px] border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 border rounded-lg hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[13px] px-4 py-1.5 bg-teal-600 text-white rounded-lg disabled:opacity-50 hover:bg-teal-700 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Link shipment button (preserved from original) ────────────────────────────
function LinkShipmentButton({
  projectId, existingShipmentIds,
}: {
  projectId: string;
  existingShipmentIds: string[];
}) {
  const shipments: any[] = [];
  const unlinked = (shipments as any[]).filter(
    (s: any) => !s.projectId && !existingShipmentIds.includes(s.id)
  );
  if (unlinked.length === 0) return null;
  return (
    <div className="bg-card rounded-lg p-4 border border-border/50">
      <h4 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Link Shipment</h4>
      <select
        onChange={async (e) => {
          if (!e.target.value) return;
          await fetch(`/api/projects/${projectId}/link-shipment`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ shipmentId: e.target.value }),
          });
          window.location.reload();
        }}
        className="w-full text-[14.5px] border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
        defaultValue=""
      >
        <option value="">Select a shipment to link…</option>
        {unlinked.map((s: any) => (
          <option key={s.id} value={s.id}>
            {s.shipmentNumber || 'Pending ID'} — {s.exporterName || ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const { data, loading, error, refetch } = useProjectDetail(projectId);

  // Local overrides for edit modal (optimistic updates without re-fetching)
  const [editedProject, setEditedProject] = useState<Partial<{ projectName: string | null; customerName: string | null; notes: string | null; status: string }> | null>(null);
  const [editing, setEditing] = useState(false);

  // Merge API data with any local edits
  const project = data ? { ...data.project, ...editedProject } : null;

  if (loading && !data) return <LoadingSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
  if (!project || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-[14.5px] text-muted-foreground">Project not found.</p>
        <a href="/projects" className="text-[13px] text-teal-600 hover:underline mt-2 block">← Back to Projects</a>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px]">

      {/* 1. Page header */}
      <ProjectHeader
        project={project as any}
        loading={loading}
        onRefresh={refetch}
        onEdit={() => setEditing(true)}
      />

      {/* 2. Summary cards */}
      <ProjectSummaryCards summary={data.summary} />

      <hr className="border-border/40 mb-6" />

      {/* 3. Needs attention (hidden when empty) */}
      <ProjectAttentionPanel
        attentionItems={data.attentionItems}
        project={project as any}
        shipments={data.shipments}
      />

      {/* 4. Shipments table */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <i className="ti ti-ship text-[14px]" />
            Shipments
            <span className="text-foreground font-normal normal-case text-[13px]">({data.shipments.length})</span>
          </h3>
        </div>
        <ProjectShipmentTable
          shipments={data.shipments}
          project={project as any}
        />
      </div>

      <hr className="border-border/40 mb-6" />

      {/* 5. Financial snapshot */}
      <ProjectFinancials financials={data.financials} />

      {/* Edit modal */}
      {editing && project && (
        <EditProjectModal
          project={{
            id:           project.id,
            projectName:  project.projectName ?? null,
            customerName: project.customerName ?? null,
            notes:        project.notes ?? null,
            status:       project.status,
          }}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditedProject(prev => ({ ...prev, ...updated }));
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
