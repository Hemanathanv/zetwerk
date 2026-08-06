import { useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { adminApi } from "@/auth/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminUserRow = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  lastLoginAt: string | null;
  role: { id: string; name: string; roleCategory: string } | null;
};

type AdminRole = {
  id: string;
  name: string;
  roleCategory: string;
};

const FALLBACK_ROLES: AdminRole[] = [
  { id: "role-viewer", name: "Viewer", roleCategory: "viewer" },
  { id: "role-finance-ap-india", name: "Finance AP India", roleCategory: "finance" },
  { id: "role-us-logistics", name: "US logistics", roleCategory: "logistics" },
  { id: "role-india-logistics", name: "India logistics", roleCategory: "logistics" },
  { id: "role-ops-manager", name: "Ops manager", roleCategory: "operations" },
  { id: "role-org-admin", name: "Org admin", roleCategory: "admin" },
];

const FALLBACK_USERS: AdminUserRow[] = [
  {
    id: "user-spr-admin",
    fullName: "SPR Admin",
    email: "admin@sprconsultech.com",
    role: FALLBACK_ROLES[5],
    status: "active",
    lastLoginAt: "2026-06-03T11:30:00+05:30",
  },
  {
    id: "user-ops-manager",
    fullName: "Operations Manager",
    email: "ops@zetwerk.com",
    role: FALLBACK_ROLES[4],
    status: "active",
    lastLoginAt: "2026-06-03T10:45:00+05:30",
  },
  {
    id: "user-finance",
    fullName: "Finance AP India",
    email: "finance@zetwerk.com",
    role: FALLBACK_ROLES[1],
    status: "active",
    lastLoginAt: "2026-06-02T17:20:00+05:30",
  },
];

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminUserManagementView() {
  const [users, setUsers] = useState<AdminUserRow[]>(FALLBACK_USERS);
  const [roles, setRoles] = useState<AdminRole[]>(FALLBACK_ROLES);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  async function fetchUsers() {
    setLoadingUsers(users.length === 0);
    try {
      const response = await adminApi.listUsers();
      if (response.data.ok && response.data.data.length > 0) {
        setUsers(response.data.data);
      }
    } catch (error) {
      console.warn("[AdminUserManagementView] Using fallback users:", error);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    fetchUsers();
    adminApi
      .listRoles()
      .then((response) => {
        if (response.data.ok && response.data.data.length > 0) {
          setRoles(response.data.data);
        }
      })
      .catch((error) => {
        console.warn("[AdminUserManagementView] Using fallback roles:", error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite() {
    if (!inviteEmail || !inviteFullName || !inviteRoleId) {
      setInviteError("Email, full name, and role are required.");
      return;
    }

    setInviteError("");
    setInviteLoading(true);
    try {
      const response = await adminApi.inviteUser({
        email: inviteEmail,
        fullName: inviteFullName,
        roleId: inviteRoleId,
        password: invitePassword || undefined,
      });
      if (!response.data.ok) {
        setInviteError(response.data.error ?? "Failed to invite user.");
        return;
      }

      setDialogOpen(false);
      setInviteEmail("");
      setInviteFullName("");
      setInviteRoleId("");
      setInvitePassword("");
      await fetchUsers();
    } catch {
      setInviteError("Network error.");
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Users</h3>
            <p className="text-sm text-muted-foreground">Manage organization members and their assigned roles.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <UserPlus className="h-4 w-4" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Invite User</DialogTitle>
                <DialogDescription>Add a team member and assign their starting role.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-invite-email">Email</Label>
                  <Input id="admin-invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-invite-name">Full Name</Label>
                  <Input id="admin-invite-name" value={inviteFullName} onChange={(event) => setInviteFullName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-invite-role">Role</Label>
                  <select
                    id="admin-invite-role"
                    value={inviteRoleId}
                    onChange={(event) => setInviteRoleId(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select a role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-invite-password">Password optional</Label>
                  <Input
                    id="admin-invite-password"
                    type="password"
                    value={invitePassword}
                    onChange={(event) => setInvitePassword(event.target.value)}
                  />
                </div>
                {inviteError && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{inviteError}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={inviteLoading}>
                  {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send Invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading users...
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.fullName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    {user.role ? <Badge variant="secondary">{user.role.name}</Badge> : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === "active" ? "default" : "outline"} className="capitalize">
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(user.lastLoginAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
