import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { Sidebar } from '@/components/Sidebar';
import { TopHeader } from '@/components/TopHeader';
import { UploadSheet } from '@/components/UploadSheet';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ShipmentsPage } from '@/pages/ShipmentsPage';
import { ShipmentDetailPage } from '@/pages/ShipmentDetailPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { DocumentDetailPage } from '@/pages/DocumentDetailPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { TasksPage } from '@/pages/TasksPage';
import { AccountingPage } from '@/pages/AccountingPage';
import { DocumentGeneratePage } from '@/pages/DocumentGeneratePage';
import { CreateShipmentPage } from '@/pages/CreateShipmentPage';
import { UploadProcessPage } from '@/pages/UploadProcessPage';
import AdminView from '@/app/AdminView';
import SettingsView from '@/app/SettingsView';

const queryClient = new QueryClient();

function AdminUsersRoute() {
  return <AdminView section="users" />;
}

function AdminStorageRoute() {
  return <AdminView section="storage" />;
}

function AdminPermissionsRoute() {
  return <AdminView section="permissions" />;
}

function AppLayout() {
  const { isOpen } = useSidebar();
  const sidebarWidth = isOpen ? 240 : 60;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <TopHeader />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/dashboard" component={DashboardPage} />
            <Route path="/shipments/new" component={CreateShipmentPage} />
            <Route path="/shipments/:id" component={ShipmentDetailPage} />
            <Route path="/shipments" component={ShipmentsPage} />
            <Route path="/tracking" component={ShipmentDetailPage} />
            <Route path="/documents/generate/:type" component={DocumentGeneratePage} />
            <Route path="/documents/upload/:id/approve" component={DocumentDetailPage} />
            <Route path="/documents/upload/:id" component={DocumentDetailPage} />
            <Route path="/documents/upload" component={UploadProcessPage} />
            <Route path="/documents/:id" component={DocumentsPage} />
            <Route path="/documents" component={DocumentsPage} />
            <Route path="/invoices" component={InvoicesPage} />
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings" component={SettingsView} />
            <Route path="/tasks" component={TasksPage} />
            <Route path="/accounting" component={AccountingPage} />
            <Route path="/inventory" component={ShipmentsPage} />
            <Route path="/reports" component={DashboardPage} />
            <Route path="/projects/:id" component={DashboardPage} />
            <Route path="/projects" component={DashboardPage} />
            <Route path="/admin/users" component={AdminUsersRoute} />
            <Route path="/admin/storage" component={AdminStorageRoute} />
            <Route path="/admin/permissions" component={AdminPermissionsRoute} />
            <Route>
              <Redirect to="/dashboard" />
            </Route>
          </Switch>
        </main>
      </div>
      {/* Global upload sheet — available from any page */}
      <UploadSheet />
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <UploadProvider>
        <AppLayout />
      </UploadProvider>
    </SidebarProvider>
  );
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
      <Route path="/">
        {isAuthenticated ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
      <Route>
        {isAuthenticated ? <AuthenticatedApp /> : <Redirect to="/" />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" storageKey="logisai-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
