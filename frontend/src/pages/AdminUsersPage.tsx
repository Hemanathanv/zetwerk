import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  lastLoginAt: string | null;
  role: { id: string; name: string; roleCategory: string } | null;
};

type Role = {
  id: string;
  name: string;
  roleCategory: string;
};

function formatDate(dt: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  async function fetchUsers() {
    setLoadingUsers(true);
    try {
      const res = await apiGet<{ ok: boolean; data: UserRow[] }>('/api/admin/users');
      if (res.ok) setUsers(res.data);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    fetchUsers();
    apiGet<{ ok: boolean; data: Role[] }>('/api/admin/roles').then((res) => {
      if (res.ok) setRoles(res.data);
    });
  }, []);

  async function handleInvite() {
    if (!inviteEmail || !inviteFullName || !inviteRoleId) {
      setInviteError('Email, full name and role are required');
      return;
    }
    setInviteError('');
    setInviteLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/admin/users/invite', {
        email: inviteEmail,
        fullName: inviteFullName,
        roleId: inviteRoleId,
        password: invitePassword || undefined,
      });
      if (!res.ok) {
        setInviteError(res.error ?? 'Failed to invite user');
        return;
      }
      setDialogOpen(false);
      setInviteEmail('');
      setInviteFullName('');
      setInviteRoleId('');
      setInvitePassword('');
      fetchUsers();
    } catch {
      setInviteError('Network error');
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Users</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Manage organization members and their roles</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" data-testid="button-invite-user">
              <UserPlus className="w-4 h-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
              <DialogDescription>Add a new member to your organization.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">Email</Label>
                <Input
                  id="inv-email"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-name">Full Name</Label>
                <Input
                  id="inv-name"
                  placeholder="Jane Smith"
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                  data-testid="input-invite-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <select
                  id="inv-role"
                  value={inviteRoleId}
                  onChange={(e) => setInviteRoleId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-[14.5px] focus:outline-none focus:ring-2 focus:ring-ring"
                  data-testid="select-invite-role"
                >
                  <option value="">Select a role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-pw">Password <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="inv-pw"
                  type="password"
                  placeholder="Leave blank to send invite link"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  data-testid="input-invite-password"
                />
              </div>
              {inviteError && (
                <p className="text-[14.5px] text-destructive bg-destructive/10 px-3 py-2 rounded-md">{inviteError}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleInvite} disabled={inviteLoading} data-testid="button-confirm-invite">
                {inviteLoading ? 'Inviting…' : 'Send Invite'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border" style={{ borderColor: 'hsl(var(--border))' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingUsers ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-[14.5px]">Loading…</TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-[14.5px]">No users found</TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell className="text-muted-foreground text-[14.5px]">{u.email}</TableCell>
                  <TableCell>
                    {u.role ? (
                      <Badge variant="secondary" className="text-[13px]">{u.role.name}</Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.status === 'active' ? 'default' : 'outline'}
                      className="text-[13px] capitalize"
                    >
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-[14.5px]">{formatDate(u.lastLoginAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
