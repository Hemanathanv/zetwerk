import { User, Link2, Bell, Shield } from 'lucide-react';

const integrations = [
  { name: 'Shipsy',            status: 'Connected', desc: 'Real-time vessel and container tracking',      color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { name: 'Zetwerk ERP',       status: 'Connected', desc: 'Sales invoice import and order sync',          color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { name: 'MSD',               status: 'Connected', desc: 'GRN creation and inventory updates',           color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { name: 'Bolloré Logistics', status: 'Connected', desc: 'Freight forwarder document exchange',          color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { name: 'Rajan Logistics',   status: 'Connected', desc: 'CHA agent document uploads',                  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { name: 'US Customs Portal', status: 'Pending',   desc: 'BOE and customs release integration',          color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20' },
];

const notifPrefs = [
  { label: 'Exception alerts',              desc: 'Get notified when a shipment hits an exception',    enabled: true },
  { label: 'Document upload confirmations', desc: 'Confirm when documents are uploaded successfully',  enabled: true },
  { label: 'OCR completion',                desc: 'Notify when AI extraction is ready for review',     enabled: true },
  { label: 'Customs status changes',        desc: 'Receive updates on US customs clearance status',    enabled: true },
  { label: 'ETA changes',                   desc: 'Alert when vessel ETA is updated by carrier',       enabled: false },
  { label: 'Weekly summary report',         desc: 'Email digest of shipment performance every Monday', enabled: false },
];

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your profile, integrations, and notification preferences</p>
      </div>

      {/* User profile */}
      <Section icon={<User className="w-4 h-4" />} title="User Profile">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: 'hsl(var(--primary))' }}>
            HV
          </div>
          <div>
            <p className="font-semibold">Hemanathan</p>
            <p className="text-xs text-muted-foreground">hemanathan@zetwerk.com · Manager</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Full Name',     value: 'Hemanathan V.' },
            { label: 'Email',         value: 'hemanathan@zetwerk.com' },
            { label: 'Role',          value: 'Manager — Logistics Ops' },
            { label: 'Organization',  value: 'Zetwerk Manufacturing Ltd.' },
          ].map(f => (
            <div key={f.label}>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{f.label}</label>
              <input
                defaultValue={f.value}
                readOnly
                className="w-full text-sm border rounded-md px-3 py-2 bg-muted/30 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                style={{ borderColor: 'hsl(var(--border))' }}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Integrations */}
      <Section icon={<Link2 className="w-4 h-4" />} title="Integrations">
        <div className="space-y-2">
          {integrations.map(int => (
            <div key={int.name} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'hsl(var(--border))' }}>
              <div>
                <p className="text-sm font-medium">{int.name}</p>
                <p className="text-xs text-muted-foreground">{int.desc}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${int.bg} ${int.color}`}>
                {int.status}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Notification prefs */}
      <Section icon={<Bell className="w-4 h-4" />} title="Notification Preferences">
        <div className="space-y-1">
          {notifPrefs.map(pref => (
            <div key={pref.label} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="mr-4">
                <p className="text-sm font-medium">{pref.label}</p>
                <p className="text-xs text-muted-foreground">{pref.desc}</p>
              </div>
              <div
                className={`relative w-9 h-5 rounded-full cursor-pointer transition-colors flex-shrink-0 ${pref.enabled ? 'bg-primary' : 'bg-muted'}`}
                data-testid={`toggle-${pref.label.toLowerCase().replace(/ /g, '-')}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${pref.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* System info */}
      <Section icon={<Shield className="w-4 h-4" />} title="System">
        <div className="space-y-2 text-xs">
          {[
            ['App Version',       'Zetwerk Logistics v2.4.1'],
            ['API Environment',   'Production'],
            ['Last Sync',         'Apr 17, 14:02 IST'],
            ['Session Started',   'Apr 17, 09:00 IST'],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'hsl(var(--border))' }}>
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{val}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
