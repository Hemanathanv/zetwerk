import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { adminApi } from "@/auth/api";
import { Badge } from "@/components/ui/badge";

type AdminRole = {
  id: string;
  name: string;
  roleCategory: string;
};

const fallbackRoles: AdminRole[] = [
  {
    id: "admin",
    name: "Admin",
    roleCategory: "admin",
  },
  {
    id: "user",
    name: "User",
    roleCategory: "user",
  },
];

function permissionsForRole(role: AdminRole) {
  if (role.roleCategory === "admin") {
    return ["User Management", "Storage", "User Permissions", "Documents", "Reports"];
  }
  return ["Documents", "Reports"];
}

const protectedActions = [
  { label: "Invite users", owner: "Org admin", status: "Restricted" },
  { label: "Delete storage object", owner: "Org admin", status: "Restricted" },
  { label: "Retry OCR extraction", owner: "Operations", status: "Allowed" },
  { label: "Download documents", owner: "Role based", status: "Allowed" },
];

export default function AdminUserPermissionsView() {
  const [roles, setRoles] = useState<AdminRole[]>(fallbackRoles);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminApi
      .listRoles()
      .then((response) => {
        if (active && response.data.ok && response.data.data.length > 0) {
          setRoles(response.data.data);
        }
      })
      .catch((error) => {
        console.warn("[AdminUserPermissionsView] Using fallback roles:", error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const roleMatrix = useMemo(
    () =>
      roles.map((role) => ({
        role: role.name,
        category: role.roleCategory,
        permissions: permissionsForRole(role),
      })),
    [roles],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Role Permissions</h3>
          <p className="text-sm text-muted-foreground">Review module access for Keycloak roles.</p>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading Keycloak roles...
            </div>
          ) : roleMatrix.map((role) => (
            <div key={role.role} className="grid gap-3 px-5 py-4 md:grid-cols-[220px_1fr]">
              <div>
                <p className="font-medium text-foreground">{role.role}</p>
                <p className="text-sm capitalize text-muted-foreground">{role.category}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {role.permissions.map((permission) => (
                  <Badge key={permission} variant="secondary" className="gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Access Rules</h3>
          </div>
          <div className="mt-4 space-y-3">
            {protectedActions.map((action) => (
              <div key={action.label} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{action.label}</p>
                  <Badge variant={action.status === "Restricted" ? "outline" : "secondary"}>{action.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{action.owner}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Backend Contract</h3>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Roles are synced from Keycloak. Admin roles receive access to user management, storage,
            and permission controls.
          </p>
        </section>
      </aside>
    </div>
  );
}
