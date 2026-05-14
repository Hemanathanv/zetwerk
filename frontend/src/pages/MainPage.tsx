import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import DashboardView from "@/app/DashboardView";
import OcrWorkflow from "@/app/ocrWorkflow";
import SettingsView from "@/app/SettingsView";
import AdminView from "@/app/AdminView";
import Sidebar from "@/components/Sidebar";
import { TopHeader } from "@/components/TopHeader";
import { useAuth } from "@/auth/AuthContext";

export type AppRoute =
  | "dashboard"
  | "document-ocr"
  | "settings"
  | "admin-users"
  | "admin-storage"
  | "admin-permissions";

export default function MainPage() {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user } = useAuth();
  const isAdmin = user?.systemRole === "ADMIN" || user?.systemRole === "SUPER_ADMIN";

  const activeRoute: AppRoute = location.startsWith("/document-ocr")
    ? "document-ocr"
    : location.startsWith("/admin/storage")
      ? "admin-storage"
      : location.startsWith("/admin/permissions")
        ? "admin-permissions"
        : location.startsWith("/admin/users")
          ? "admin-users"
          : location.startsWith("/settings")
            ? "settings"
            : "dashboard";

  const renderContent = () => {
    if (activeRoute === "dashboard") return <DashboardView />;
    if (activeRoute === "document-ocr") return <OcrWorkflow />;
    if (activeRoute === "settings") return <SettingsView />;
    if (!isAdmin) return <DashboardView />;
    if (activeRoute === "admin-users") return <AdminView section="users" />;
    if (activeRoute === "admin-storage") return <AdminView section="storage" />;
    return <AdminView section="permissions" />;
  };

  useEffect(() => {
    if (!isAdmin && location.startsWith("/admin/")) {
      setLocation("/dashboard");
    }
  }, [isAdmin, location, setLocation]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        activeRoute={activeRoute}
        onSelectRoute={(path) => setLocation(path)}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((open) => !open)}
        isAdmin={isAdmin}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader />
        <main className="flex-1 overflow-auto">{renderContent()}</main>
      </div>
    </div>
  );
}
