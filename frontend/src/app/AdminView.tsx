import { Database, HardDrive, ShieldCheck } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import AdminUserManagementView from "@/app/AdminUserManagementView";
import AdminStorageView from "@/app/AdminStorageView";
import AdminUserPermissionsView from "@/app/AdminUserPermissionsView";

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
  const meta = sectionMeta[section];

  return (
    <PageLayout
      title={meta.title}
      description={meta.description}
      icon={meta.icon}
      accentColor={meta.accentColor}
    >
      {section === "users" && <AdminUserManagementView />}
      {section === "storage" && <AdminStorageView />}
      {section === "permissions" && <AdminUserPermissionsView />}
    </PageLayout>
  );
}
