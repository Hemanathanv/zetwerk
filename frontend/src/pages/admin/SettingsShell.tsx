import { useState, useEffect, useRef } from 'react';
import {
  CheckSquare, Users, GitBranch, Shield, DollarSign, Activity,
  BookOpen, MessageCircle, ChevronsLeft, ChevronsRight, ClipboardCheck, Navigation,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import SetupChecklist from './settings/SetupChecklist';
import TeamAccessSection from './settings/TeamAccessSection';
import ValidationGuided from './settings/ValidationGuided';
import FinanceGuided from './settings/FinanceGuided';
import SystemGuided from './settings/SystemGuided';
import { AdminValidationPage } from './AdminValidationPage';
import { AdminAccountingPage } from './AdminAccountingPage';
import { AdminAuditPage } from './AdminAuditPage';
import { AdminCompliancePage } from './AdminCompliancePage';
import { AdminWarehousesPage } from './AdminWarehousesPage';
import { SafeCubeSettingsCard } from '../settings/SafeCubeSettingsCard';
import { useToast } from '@/hooks/use-toast';

const T = {
  bg:          'hsl(var(--background))',
  surface:     'hsl(var(--card))',
  border:      'hsl(var(--border))',
  borderMid:   'hsl(var(--border))',
  teal:        '#0D9488',
  tealDark:    '#0F766E',
  tealLight:   '#CCFBF1',
  tealBg:      'rgba(13,148,136,0.10)',
  green:       '#10B981',
  greenBg:     'rgba(16,185,129,0.10)',
  amber:       '#D97706',
  amberBg:     'rgba(217,119,6,0.10)',
  amberBorder: 'rgba(217,119,6,0.30)',
  blue:        '#0EA5E9',
  blueBg:      'rgba(14,165,233,0.10)',
  blueBorder:  'rgba(14,165,233,0.30)',
  slate900:    'hsl(var(--foreground))',
  slate700:    'hsl(var(--foreground))',
  slate500:    'hsl(var(--muted-foreground))',
  slate400:    'hsl(var(--muted-foreground))',
  slate200:    'hsl(var(--border))',
};

const CIRC = 2 * Math.PI * 36;

function ProgressRing({ pct, attentionCount }: { pct: number; attentionCount: number }) {
  const dash = (pct / 100) * CIRC;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 20px' }}>
      <div style={{ position: 'relative', width: 92, height: 92 }}>
        <svg
          width="92" height="92" viewBox="0 0 100 100"
          role="progressbar" aria-valuenow={pct} aria-valuemax={100}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle cx="50" cy="50" r="36" fill="none" stroke={T.slate200} strokeWidth="10" />
          <circle
            cx="50" cy="50" r="36"
            fill="none" stroke={T.teal} strokeWidth="10"
            strokeDasharray={`${dash} ${CIRC}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: "'Jura', sans-serif",
            fontSize: 20, fontWeight: 700,
            color: T.slate900, lineHeight: 1,
          }}>
            {pct}%
          </span>
          <span style={{ fontSize: 14.5, color: T.slate500, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>
            Ready
          </span>
        </div>
      </div>
      {attentionCount > 0 && (
        <div style={{
          marginTop: 8, fontSize: 14.5, color: T.amber,
          fontWeight: 600, textAlign: 'center',
          fontFamily: "'Instrument Sans', sans-serif",
        }}>
          {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
        </div>
      )}
      {attentionCount === 0 && pct === 100 && (
        <div style={{ marginTop: 8, fontSize: 14.5, color: T.green, fontWeight: 600, textAlign: 'center' }}>
          All systems go 🟢
        </div>
      )}
    </div>
  );
}

const sections = [
  { id: 'overview',    label: 'Setup Checklist',      icon: CheckSquare },
  { id: 'team',        label: 'Team & Access',         icon: Users },
  { id: 'workflow',    label: 'Workflow & Documents',  icon: GitBranch },
  { id: 'validation',  label: 'Validation Rules',      icon: Shield },
  { id: 'finance',     label: 'Finance & Cost',        icon: DollarSign },
  { id: 'compliance',  label: 'Compliance Checks',     icon: ClipboardCheck },
  { id: 'warehouses',  label: 'Warehouses',            icon: Warehouse },
  { id: 'tracking',    label: 'Vessel Tracking',        icon: Navigation },
  { id: 'system',      label: 'Audit & System',        icon: Activity },
];

function SettingsPanel({
  title, description, guidedContent, advancedContent, showAdvanced,
}: {
  title: string; description: string;
  guidedContent: React.ReactNode; advancedContent: React.ReactNode;
  showAdvanced: boolean;
}) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: T.slate900, fontFamily: "'BricolageGrotesque', sans-serif", margin: 0 }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, color: T.slate500, marginTop: 4, fontFamily: "'Instrument Sans', sans-serif" }}>
          {description}
        </p>
      </div>
      {showAdvanced && (
        <div style={{
          background: T.amberBg, border: `1px solid ${T.amberBorder}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 16,
          fontSize: 14, color: T.amber, fontFamily: "'Instrument Sans', sans-serif",
        }}>
          Advanced configuration mode — changes here directly affect system behavior.
        </div>
      )}
      {showAdvanced ? advancedContent : guidedContent}
    </div>
  );
}

function UnderBuildPanel({ title }: { title: string }) {
  return (
    <div style={{
      minHeight: 360,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      background: T.surface,
      textAlign: 'center',
      padding: 24,
    }}>
      <div>
        <h3 style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          color: T.slate900,
          fontFamily: "'BricolageGrotesque', sans-serif",
        }}>
          {title}
        </h3>
        <p style={{
          margin: '8px 0 0',
          fontSize: 14.5,
          color: T.slate500,
          fontFamily: "'Instrument Sans', sans-serif",
        }}>
          Currently under build
        </p>
      </div>
    </div>
  );
}

function FinanceAdvanced() {
  return <AdminAccountingPage />;
}

function SystemAdvanced() {
  return (
    <div>
      <AdminAuditPage />
    </div>
  );
}

export default function SettingsShell({ defaultSection }: { defaultSection?: string }) {
  const [activeSection, setActiveSection] = useState(defaultSection || 'overview');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState(0);
  const [attentionCount, setAttentionCount] = useState(0);
  const [savedAt] = useState<Date>(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const orgName = (user as any)?.org?.name as string | undefined;

  const activeLabel = sections.find(s => s.id === activeSection)?.label ?? 'Settings';

  return (
    <div
      style={{
        display: 'flex',
        minHeight: 0,
        flex: 1,
        background: T.bg,
        fontFamily: "'Instrument Sans', sans-serif",
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside style={{
        width: sidebarCollapsed ? 52 : 280,
        minWidth: sidebarCollapsed ? 52 : 280,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'visible',
      }}>
        {/* Toggle button — floats on right edge */}
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute', top: 80, right: -14, zIndex: 20,
            width: 28, height: 28, borderRadius: '50%',
            background: T.teal, border: `2px solid ${T.surface}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            flexShrink: 0,
          }}
        >
          {sidebarCollapsed
            ? <ChevronsRight size={13} style={{ color: '#fff' }} />
            : <ChevronsLeft size={13} style={{ color: '#fff' }} />
          }
        </button>

        {/* Org chip — hidden when collapsed */}
        {!sidebarCollapsed && (
          <div style={{
            margin: '10px 12px 0',
            background: T.bg,
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: `1px solid ${T.border}`,
          }}>
            <span style={{ fontSize: 14, color: T.slate700, fontWeight: 500, truncate: true } as React.CSSProperties}>
              {orgName ?? 'Organisation'}
            </span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.teal, flexShrink: 0 }} />
          </div>
        )}
        {sidebarCollapsed && <div style={{ height: 10 }} />}

        {/* Nav items */}
        <nav style={{ flex: 1, padding: sidebarCollapsed ? '16px 0 0' : '16px 8px 0' }}>
          {sections.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => { setActiveSection(s.id); }}
                title={sidebarCollapsed ? s.label : undefined}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  gap: 10,
                  padding: sidebarCollapsed ? '10px 0' : '9px 12px',
                  borderRadius: sidebarCollapsed ? 0 : 8,
                  border: 'none',
                  background: active
                    ? (sidebarCollapsed ? T.teal : T.tealBg)
                    : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  position: 'relative',
                  marginBottom: sidebarCollapsed ? 4 : 2,
                  borderLeft: sidebarCollapsed ? 'none' : (active ? `4px solid ${T.teal}` : '4px solid transparent'),
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <s.icon
                  size={17}
                  style={{ flexShrink: 0, color: active ? (sidebarCollapsed ? '#fff' : T.teal) : 'hsl(var(--foreground) / 0.6)' }}
                />
                {!sidebarCollapsed && (
                  <span style={{
                    fontSize: 14.5, fontWeight: active ? 600 : 400,
                    color: active ? T.tealDark : T.slate700,
                    flex: 1,
                    fontFamily: "'Instrument Sans', sans-serif",
                    whiteSpace: 'nowrap',
                  }}>
                    {s.label}
                  </span>
                )}
                {!sidebarCollapsed && s.id === 'overview' && attentionCount > 0 && (
                  <span style={{
                    background: T.amber, color: '#fff',
                    borderRadius: 99, fontSize: 14, fontWeight: 700,
                    padding: '1px 6px', flexShrink: 0,
                    fontFamily: "'Jura', sans-serif",
                  }}>
                    {attentionCount}
                  </span>
                )}
                {sidebarCollapsed && s.id === 'overview' && attentionCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 8, height: 8, borderRadius: '50%',
                    background: T.amber,
                  }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* Help links — hidden when collapsed */}
        {!sidebarCollapsed && (
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
            <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.slate400, fontSize: 14, textDecoration: 'none', marginBottom: 8 }}>
              <BookOpen size={13} /> Documentation
            </a>
            <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.slate400, fontSize: 14, textDecoration: 'none' }}>
              <MessageCircle size={13} /> Contact Support
            </a>
          </div>
        )}

        {/* Progress ring — hidden when collapsed */}
        {!sidebarCollapsed && (
          <div style={{ borderTop: `1px solid ${T.border}` }}>
            <ProgressRing pct={progress} attentionCount={attentionCount} />
          </div>
        )}
      </aside>

      {/* ── Right panel ────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Top bar */}
        <header style={{
          height: 78,
          minHeight: 78,
          background: T.surface,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontSize: 14.5, fontWeight: 700, color: T.slate400,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: "'Instrument Sans', sans-serif",
            }}>
              Organisation Settings
            </div>
            <div style={{
              fontSize: 26, fontWeight: 700, color: T.slate900,
              fontFamily: "'BricolageGrotesque', sans-serif",
              lineHeight: 1.1, marginTop: 2,
            }}>
              {orgName ?? 'Your Organisation'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {activeSection !== 'overview' && activeSection !== 'team' && activeSection !== 'warehouses' && (
              <button
                onClick={() => setShowAdvanced(a => !a)}
                style={{
                  padding: '8px 16px', fontSize: 14.5, fontWeight: 500,
                  background: showAdvanced ? T.tealBg : T.bg,
                  border: `1px solid ${showAdvanced ? T.teal : T.border}`,
                  color: showAdvanced ? T.teal : T.slate700,
                  borderRadius: 8, cursor: 'pointer',
                  fontFamily: "'Instrument Sans', sans-serif",
                  transition: 'all 0.15s',
                }}
              >
                {showAdvanced ? '← Simplified' : 'Advanced Config'}
              </button>
            )}
            <button
              onClick={() => toast({ title: 'Organisation settings saved' })}
              style={{
                padding: '8px 20px', fontSize: 14.5, fontWeight: 600,
                background: T.teal, color: '#fff', border: 'none',
                borderRadius: 8, cursor: 'pointer', opacity: 1,
                fontFamily: "'Instrument Sans', sans-serif",
              }}
              title="Save organisation settings"
            >
              Save Changes
            </button>
          </div>
        </header>

        {/* Content area */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px 32px 0', background: T.bg, minHeight: 0 }}>
          {activeSection === 'overview' && (
            <SetupChecklist
              onNavigate={setActiveSection}
              onProgress={(pct, count) => { setProgress(pct); setAttentionCount(count); }}
            />
          )}
          {activeSection === 'team' && (
            <TeamAccessSection />
          )}
          {activeSection === 'workflow' && (
            <SettingsPanel
              title="Workflow & Documents"
              description="Configure how shipments flow and which documents are required."
              guidedContent={<UnderBuildPanel title="Workflow & Documents" />}
              advancedContent={<UnderBuildPanel title="Workflow & Documents" />}
              showAdvanced={showAdvanced}
            />
          )}
          {activeSection === 'validation' && (
            <SettingsPanel
              title="Validation Rules"
              description="Business checks that run automatically when documents are approved."
              guidedContent={<ValidationGuided />}
              advancedContent={<AdminValidationPage />}
              showAdvanced={showAdvanced}
            />
          )}
          {activeSection === 'finance' && (
            <SettingsPanel
              title="Finance & Cost Rules"
              description="Control when finance tickets are created and how costs are tracked."
              guidedContent={<FinanceGuided />}
              advancedContent={<FinanceAdvanced />}
              showAdvanced={showAdvanced}
            />
          )}
          {activeSection === 'compliance' && (
            <AdminCompliancePage />
          )}
          {activeSection === 'warehouses' && (
            <AdminWarehousesPage />
          )}
          {activeSection === 'tracking' && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: T.slate900, fontFamily: "'BricolageGrotesque', sans-serif", margin: 0 }}>
                  Vessel Tracking
                </h2>
                <p style={{ fontSize: 14, color: T.slate500, marginTop: 4, fontFamily: "'Instrument Sans', sans-serif" }}>
                  Connect SafeCube to surface live AIS position, ETA, and schedule status on all shipments.
                </p>
              </div>
              <div className="bg-card border rounded-lg p-5" style={{ borderColor: T.border }}>
                <SafeCubeSettingsCard />
              </div>
            </div>
          )}
          {activeSection === 'system' && (
            <SettingsPanel
              title="Audit & System"
              description="System health, audit trail, escalation SLA timers, and integration status."
              guidedContent={<SystemGuided />}
              advancedContent={<SystemAdvanced />}
              showAdvanced={showAdvanced}
            />
          )}
          <div style={{ height: 40 }} />
        </main>

        {/* Footer */}
        <footer style={{
          height: 66,
          minHeight: 66,
          background: T.surface,
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14.5, color: T.slate400, fontFamily: "'Instrument Sans', sans-serif" }}>
            Auto-saving · Last saved just now
          </span>
          <span style={{ fontSize: 14.5, color: T.slate400, fontFamily: "'Instrument Sans', sans-serif" }}>
            EWMS v2.0 · {orgName ?? 'Org'}
          </span>
        </footer>
      </div>
    </div>
  );
}
