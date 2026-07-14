import { useState, useEffect } from 'react';
import { Shield, CheckCircle2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api';

function authHeaders() {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface Rule {
  id: string; shortCode: string; name: string; severity: string;
  isActive: boolean; toleranceType?: string;
}

interface RuleGroup { label: string; rules: Rule[] }

function deriveCategory(rule: Rule): string {
  const s = `${rule.shortCode} ${rule.name}`.toLowerCase();
  if (s.includes('invoice') || s.includes('inv')) return 'Invoice checks';
  if (s.includes('weight') || s.includes('wt')) return 'Weight checks';
  if (s.includes('bol') || s.includes('bill of lading')) return 'Bill of Lading';
  if (s.includes('pack') || s.includes('packing')) return 'Packing & Marks';
  if (s.includes('cha') || s.includes('customs')) return 'Customs Documents';
  if (s.includes('amount') || s.includes('value') || s.includes('currency')) return 'Amount checks';
  return 'General checks';
}

function severityColor(sev: string) {
  const s = sev?.toLowerCase();
  if (s === 'error' || s === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (s === 'warning' || s === 'warn') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
}

export default function ValidationGuided() {
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch('/api/admin/settings/setup-status', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setTotal(d.data?.validationCount || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-card rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="bg-card border rounded-xl p-5" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-teal-600" />
          <h3 className="font-semibold text-[14.5px]">Validation Summary</h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold font-mono">{total}</span>
          <span className="text-[14.5px] text-muted-foreground">rules active across all document types</span>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-5" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <h3 className="font-semibold text-[14.5px] mb-3">How validation works</h3>
        <div className="space-y-3">
          {[
            { icon: '1', title: 'Document approved', desc: 'A user approves a document after reviewing OCR extraction.' },
            { icon: '2', title: 'Validation rules run', desc: 'System automatically checks all active rules for that document type.' },
            { icon: '3', title: 'Pass or escalate', desc: 'If all rules pass, document is marked validated. Failures trigger an escalation task.' },
          ].map(step => (
            <div key={step.icon} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center justify-center text-[13px] font-bold shrink-0">
                {step.icon}
              </div>
              <div>
                <div className="text-[14.5px] font-medium">{step.title}</div>
                <div className="text-[13px] text-muted-foreground">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-xl p-4 flex items-center gap-3" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <CheckCircle2 className="w-5 h-5 text-teal-500 shrink-0" />
        <div>
          <div className="text-[14.5px] font-medium">Rules configured</div>
          <div className="text-[13px] text-muted-foreground">
            Use Advanced configuration below to view, enable, or adjust individual validation rules.
          </div>
        </div>
      </div>
    </div>
  );
}
