import { CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const roleMatrix = [
  {
    role: "Org admin",
    category: "admin",
    permissions: ["User Management", "Storage", "User Permissions", "Documents", "Reports"],
  },
  {
    role: "Ops manager",
    category: "operations",
    permissions: ["Documents", "Shipments", "Reports", "Tasks"],
  },
  {
    role: "Finance AP India",
    category: "finance",
    permissions: ["Documents", "Accounting", "Reports"],
  },
  {
    role: "Viewer",
    category: "viewer",
    permissions: ["Dashboard", "Reports"],
  },
];

const protectedActions = [
  { label: "Invite users", owner: "Org admin", status: "Restricted" },
  { label: "Delete storage object", owner: "Org admin", status: "Restricted" },
  { label: "Retry OCR extraction", owner: "Operations", status: "Allowed" },
  { label: "Download documents", owner: "Role based", status: "Allowed" },
];

export default function AdminUserPermissionsView() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Role Permissions</h3>
          <p className="text-sm text-muted-foreground">Review module access for each user role.</p>
        </div>
        <div className="divide-y divide-border">
          {roleMatrix.map((role) => (
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
        <section className="rounded-xl border border-border bg-card p-5">
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

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Backend Contract</h3>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            This view is ready for a permissions API. Until that endpoint is available, it shows the
            role matrix used by the connected frontend.
          </p>
        </section>
      </aside>
    </div>
  );
}
