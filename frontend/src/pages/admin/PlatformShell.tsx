import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Shield, Check, X, Loader2, RefreshCw, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiPut } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
  slug: string;
  subscriptionTier: string;
  isActive: boolean;
  isMain: boolean;
  createdAt: string;
  _count: { users: number; shipments: number };
}

interface RoleTemplate {
  id: string;
  name: string;
  description?: string;
  roleCategory: string;
  color: string;
  defaultModules: string[];
  allowedLevels: string[];
  displayName?: string;
  _count: { roleActivities: number };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, React.CSSProperties> = {
    pilot:   { background: '#f3f4f6', color: '#374151' },
    starter: { background: '#dbeafe', color: '#1e40af' },
    growth:  { background: '#d1fae5', color: '#065f46' },
    enterprise: { background: '#ede9fe', color: '#5b21b6' },
  };
  const s = styles[tier] ?? styles.pilot;
  return (
    <span style={{ ...s, padding: '2px 8px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, textTransform: 'capitalize' }}>
      {tier}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 14, fontWeight: 500,
      color: active ? 'hsl(142 71% 45%)' : 'hsl(0 72% 51%)',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: active ? 'hsl(142 71% 45%)' : 'hsl(0 72% 51%)',
        flexShrink: 0,
      }} />
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

// ─── Tenants Tab ─────────────────────────────────────────────────────────────

function TenantsTab() {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ data: Tenant[] }>('/api/platform/tenants');
      if (res.ok) setTenants(res.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(tenant: Tenant) {
    if (tenant.isMain) { toast({ title: 'Cannot suspend the platform org' }); return; }
    setToggling(tenant.id);
    try {
      const res = await apiPut<{ data: Tenant }>(`/api/platform/tenants/${tenant.id}/status`, { isActive: !tenant.isActive });
      if (res.ok) {
        setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, isActive: !t.isActive } : t));
        toast({ title: `${tenant.name} ${!tenant.isActive ? 'activated' : 'suspended'}` });
      } else {
        toast({ title: (res as any).error ?? 'Failed', variant: 'destructive' });
      }
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
    setToggling(null);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'hsl(173 58% 39%)' }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>All Tenants</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            {tenants.length} organisation{tenants.length !== 1 ? 's' : ''} on this platform
          </p>
        </div>
        <button
          onClick={load}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'hsl(var(--muted)/0.4)', borderBottom: '1px solid hsl(var(--border))' }}>
              {['Organisation', 'Tier', 'Users', 'Shipments', 'Created', 'Status', ''].map((h, i) => (
                <th key={i} style={{
                  padding: '10px 14px', textAlign: 'left',
                  fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))',
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant, i) => (
              <tr
                key={tenant.id}
                style={{
                  borderBottom: i < tenants.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                  background: tenant.isMain ? 'hsla(173,58%,39%,0.04)' : 'transparent',
                }}
              >
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: tenant.isMain ? 'hsl(173 58% 39%)' : 'hsl(var(--muted))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: tenant.isMain ? '#fff' : 'hsl(var(--muted-foreground))',
                      fontSize: 14.5, fontWeight: 700,
                    }}>
                      {tenant.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {tenant.name}
                        {tenant.isMain && (
                          <span style={{ fontSize: 14, fontWeight: 600, background: 'hsl(173 58% 39%)', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>
                            PLATFORM
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{tenant.slug}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <TierBadge tier={tenant.subscriptionTier} />
                </td>
                <td style={{ padding: '12px 14px', fontSize: 14.5 }}>{tenant._count.users}</td>
                <td style={{ padding: '12px 14px', fontSize: 14.5 }}>{tenant._count.shipments}</td>
                <td style={{ padding: '12px 14px', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                  {new Date(tenant.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <StatusDot active={tenant.isActive} />
                </td>
                <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                  {!tenant.isMain && (
                    <button
                      onClick={() => handleToggle(tenant)}
                      disabled={toggling === tenant.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '5px 12px', borderRadius: 6, fontSize: 14, fontWeight: 500,
                        border: '1px solid hsl(var(--border))', cursor: 'pointer',
                        background: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
                        opacity: toggling === tenant.id ? 0.6 : 1,
                      }}
                    >
                      {toggling === tenant.id
                        ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        : tenant.isActive ? <X size={11} /> : <Check size={11} />
                      }
                      {tenant.isActive ? 'Suspend' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Provision Tab ────────────────────────────────────────────────────────────

function ProvisionTab() {
  const { toast } = useToast();
  const [orgName, setOrgName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ orgName: string; adminEmail: string } | null>(null);

  async function handleProvision() {
    if (!orgName.trim() || !adminEmail.trim() || !adminName.trim()) {
      toast({ title: 'All fields are required', variant: 'destructive' }); return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(adminEmail)) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' }); return;
    }
    setLoading(true);
    try {
      const res = await apiPost<any>('/api/platform/provision', { orgName, adminEmail, adminName });
      if (res.ok) {
        setResult({ orgName, adminEmail });
        setOrgName(''); setAdminEmail(''); setAdminName('');
        toast({ title: `${orgName} provisioned successfully` });
      } else {
        toast({ title: res.error ?? 'Provisioning failed', variant: 'destructive' });
      }
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700 }}>Provision New Tenant</h2>
      <p style={{ margin: '0 0 28px', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
        Creates a new organisation, clones all role templates into it, and sets up the first admin user.
      </p>

      {result && (
        <div style={{
          background: 'hsl(142 71% 45% / 0.1)', border: '1px solid hsl(142 71% 45% / 0.3)',
          borderRadius: 8, padding: '14px 18px', marginBottom: 24,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: 'hsl(142 71% 45%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Check size={15} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>
              {result.orgName} provisioned
            </div>
            <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              Invite sent to <strong>{result.adminEmail}</strong>. Token logged to API console.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 6 }}>
            Organisation name <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <Input
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            placeholder="e.g., Tata Steel Ltd"
            style={{ fontSize: 14.5 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 6 }}>
            First admin — full name <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <Input
            value={adminName}
            onChange={e => setAdminName(e.target.value)}
            placeholder="e.g., Rajesh Kumar"
            style={{ fontSize: 14.5 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 6 }}>
            First admin — email <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <Input
            type="email"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            placeholder="e.g., rajesh@tata.com"
            style={{ fontSize: 14.5 }}
          />
        </div>

        <div style={{
          background: 'hsl(var(--muted)/0.4)', borderRadius: 8, padding: '12px 14px',
          fontSize: 14, color: 'hsl(var(--muted-foreground))',
          border: '1px solid hsl(var(--border))',
        }}>
          <strong style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>What this does:</strong>{' '}
          Creates the org, clones all {14} role templates, and provisions an ops manager admin user.
          A one-time invite token is logged to the API console — email delivery is a future integration.
        </div>

        <Button
          onClick={handleProvision}
          disabled={loading}
          style={{ alignSelf: 'flex-start', minWidth: 160 }}
        >
          {loading
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />Provisioning…</>
            : <><Plus size={14} style={{ marginRight: 6 }} />Provision tenant</>
          }
        </Button>
      </div>
    </div>
  );
}

// ─── Role Templates Tab ───────────────────────────────────────────────────────

const CAT_LABEL: Record<string, string> = {
  INTERNAL_OPS: 'Internal Ops',
  INTERNAL_SPECIALIST: 'Internal Specialist',
  EXTERNAL_PARTNER: 'External Partner',
  CUSTOMER: 'Customer',
};

const CAT_STYLE: Record<string, React.CSSProperties> = {
  INTERNAL_OPS:        { background: '#dbeafe', color: '#1d4ed8' },
  INTERNAL_SPECIALIST: { background: '#d1fae5', color: '#065f46' },
  EXTERNAL_PARTNER:    { background: '#ede9fe', color: '#7c3aed' },
  CUSTOMER:            { background: '#dcfce7', color: '#15803d' },
};

function RoleTemplatesTab() {
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ data: RoleTemplate[] }>('/api/platform/role-templates').then(res => {
      if (res.ok) setTemplates(res.data ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'hsl(173 58% 39%)' }} />
      </div>
    );
  }

  if (!templates.length) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'hsl(var(--muted-foreground))' }}>
        <Shield size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p style={{ margin: 0, fontSize: 14 }}>No role templates found.</p>
        <p style={{ margin: '6px 0 0', fontSize: 14 }}>
          Role templates are created by the seed script. Re-run the seed to populate them.
        </p>
      </div>
    );
  }

  const grouped: Record<string, RoleTemplate[]> = {};
  templates.forEach(t => {
    const key = t.roleCategory;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Role Templates</h2>
        <p style={{ margin: '4px 0 0', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
          {templates.length} templates — cloned into every new tenant on provisioning
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {Object.entries(grouped).map(([cat, roles]) => (
          <div key={cat}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            }}>
              <span style={{
                ...(CAT_STYLE[cat] ?? { background: '#f3f4f6', color: '#374151' }),
                padding: '3px 10px', borderRadius: 8, fontSize: 14.5, fontWeight: 600,
              }}>
                {CAT_LABEL[cat] ?? cat}
              </span>
              <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                {roles.length} role{roles.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {roles.map(role => (
                <div key={role.id} style={{
                  background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                  borderRadius: 8, padding: '14px 16px',
                  borderLeft: `3px solid ${role.color}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: role.color, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0,
                    }}>
                      {role.name[0]?.toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {role.displayName ?? role.name}
                      </div>
                      {role.displayName && role.displayName !== role.name && (
                        <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{role.name}</div>
                      )}
                    </div>
                  </div>
                  {role.description && (
                    <p style={{ margin: '0 0 8px', fontSize: 14, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
                      {role.description}
                    </p>
                  )}
                  <div style={{
                    display: 'flex', gap: 12, fontSize: 14.5,
                    color: 'hsl(var(--muted-foreground))',
                    fontFamily: 'var(--app-font-sans)',
                  }}>
                    <span>{role._count.roleActivities} activities</span>
                    <span>{role.defaultModules.length} modules</span>
                    <span>{role.allowedLevels.join('/')} levels</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Nav sections ──────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'tenants',   label: 'Tenants',        icon: Building2 },
  { id: 'provision', label: 'Provision',       icon: Plus      },
  { id: 'templates', label: 'Role Templates',  icon: Shield    },
];

// ─── PlatformShell ────────────────────────────────────────────────────────────

export default function PlatformShell() {
  const [active, setActive] = useState('tenants');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'hsl(var(--background))' }}>
      {/* Left nav */}
      <nav style={{
        width: 224, flexShrink: 0, padding: '24px 12px',
        borderRight: '1px solid hsl(var(--border))',
        background: 'hsl(var(--card))',
      }}>
        {/* Header */}
        <div style={{ padding: '0 6px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'hsl(173 58% 39%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Building2 size={14} color="#fff" />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Platform Admin</span>
          </div>
          <p style={{ margin: 0, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', paddingLeft: 36 }}>
            SPR · Super admin
          </p>
        </div>

        <p style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(var(--muted-foreground))', margin: '0 0 6px 8px' }}>
          Platform
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map(s => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 10px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                  fontSize: 14.5, fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'hsla(173,58%,39%,0.12)' : 'transparent',
                  color: isActive ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted)/0.5)';
                    (e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))';
                  }
                }}
              >
                <Icon size={15} style={{ flexShrink: 0 }} />
                {s.label}
                {isActive && <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, padding: '32px 36px', overflowY: 'auto' }}>
        {active === 'tenants'   && <TenantsTab />}
        {active === 'provision' && <ProvisionTab />}
        {active === 'templates' && <RoleTemplatesTab />}
      </div>
    </div>
  );
}
