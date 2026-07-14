type StatusBadgeProps = {
  status: string;
  size?: 'sm' | 'md';
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const base = size === 'sm'
    ? 'inline-flex items-center px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap'
    : 'inline-flex items-center px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap';

  const colorMap: Record<string, string> = {
    'Completed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Delivered': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Customs Cleared': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Closed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'In Transit': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'In Review': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'TBP': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Confirming': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Exception': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Delay': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Missing': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Pending': 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    'Not Received': 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    'Yet to receive': 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    'Document Review': 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
  };

  const classes = colorMap[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400';

  return (
    <span className={`${base} ${classes}`} data-testid={`status-badge-${status}`}>
      {status}
    </span>
  );
}
