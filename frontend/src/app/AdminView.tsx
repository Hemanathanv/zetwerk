import { Database, HardDrive, ShieldCheck } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { useAuth } from "@/auth/AuthContext";
import AdminStorageView from "@/app/AdminStorageView";

type AdminSection = "users" | "storage" | "permissions";

const sectionMeta: Record<
  AdminSection,
  { title: string; description: string; icon: typeof Database; accentColor: string }
> = {
  users: {
    title: "User Management",
    description: "Review access, user roles, and onboarding status for your team.",
    icon: Database,
    accentColor: "bg-sky-500",
  },
  storage: {
    title: "Storage",
    description: "Track buckets, document volume, and object storage usage across the workspace.",
    icon: HardDrive,
    accentColor: "bg-indigo-500",
  },
  permissions: {
    title: "User Permissions",
    description: "Manage role-based access and storage permissions for protected actions.",
    icon: ShieldCheck,
    accentColor: "bg-rose-500",
  },
};

export default function AdminView({ section }: { section: AdminSection }) {
  const { user } = useAuth();
  const meta = sectionMeta[section];

  return (
    <PageLayout
      title={meta.title}
      description={meta.description}
      icon={meta.icon}
      accentColor={meta.accentColor}
    >
      {section === "storage" ? (
        <AdminStorageView />
      ) : (
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Admin workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            This section is ready for backend integration. The navigation and role gating are now in
            place for `{user?.systemRole ?? "USER"}` accounts.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Roles</p>
              <p className="mt-2 text-2xl font-semibold">3</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Protected areas</p>
              <p className="mt-2 text-2xl font-semibold">3</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Next step</p>
              <p className="mt-2 text-sm font-medium">Connect admin APIs</p>
            </div>
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Suggested backend endpoints</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>`GET /admin/users`</li>
            <li>`GET /admin/storage/buckets`</li>
            <li>`GET /admin/permissions`</li>
            <li>`PATCH /admin/users/:id/role`</li>
          </ul>
        </aside>
      </div>
      )}
    </PageLayout>
  );
}
