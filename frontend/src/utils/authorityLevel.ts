export const LEVEL_NUM: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

export function levelNum(level: string | null | undefined): number {
  return LEVEL_NUM[level ?? ''] ?? 0;
}

export function getAuthorityLabel(level: number): string {
  const map: Record<number, string> = { 0: 'Viewer', 1: 'Prepare', 2: 'Approve', 3: 'Override', 4: 'Admin' };
  return map[level] ?? 'Viewer';
}

export function getAuthorityDescription(level: number): string {
  const map: Record<number, string> = {
    0: 'Read-only access to assigned areas',
    1: 'Can upload documents, view OCR status, correct basic fields',
    2: 'Can approve extractions, review tickets, escalate tasks',
    3: 'Can override validation failures, revoke approvals, resolve blockers',
    4: 'Full system access including settings and user management',
  };
  return map[level] ?? '';
}

export function getAuthorityColor(level: number): string {
  const map: Record<number, string> = {
    0: 'bg-muted text-muted-foreground',
    1: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    2: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    3: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    4: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return map[level] ?? 'bg-muted text-muted-foreground';
}

export function getScopeLabel(category: string): string {
  if (!category) return 'Restricted';
  const n = category.toLowerCase();
  if (n.includes('internal')) return 'All shipments';
  if (n.includes('external') || n.includes('partner')) return 'Tagged shipments only';
  if (n.includes('customer') || n.includes('buyer')) return 'Own projects only';
  return 'Restricted';
}

export function isPartnerCategory(category: string): boolean {
  if (!category) return false;
  const n = category.toLowerCase();
  return n.includes('external') || n.includes('partner');
}

export function isCustomerCategory(category: string): boolean {
  if (!category) return false;
  const n = category.toLowerCase();
  return n.includes('customer') || n.includes('buyer');
}

export function isInternalCategory(category: string): boolean {
  if (!category) return true;
  return category.toLowerCase().includes('internal');
}
