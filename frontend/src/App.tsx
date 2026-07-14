import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { useAdminExitRefresh } from '@/hooks/useOperationalData';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PermissionProvider } from '@/contexts/PermissionContext';
import { RequireModule } from '@/components/PermissionGate';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { Sidebar } from '@/components/Sidebar';
import { TopHeader } from '@/components/TopHeader';
import { UploadSheet } from '@/components/UploadSheet';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TrackingPage } from '@/pages/TrackingPage';
import { ShipmentsPage } from '@/pages/ShipmentsPage';
import { ShipmentDetailPage } from '@/pages/ShipmentDetailPage';
import { ShipmentDocumentsPage } from '@/pages/ShipmentDocumentsPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import SettingsShell from '@/pages/admin/SettingsShell';
import PlatformShell from '@/pages/admin/PlatformShell';
import { PlatformGuard } from '@/components/admin/PlatformGuard';
import { TasksPage } from '@/pages/TasksPage';
import { FinanceTicketQueuePage } from '@/pages/FinanceTicketQueuePage';
import { FinanceDashboardPage } from '@/pages/FinanceDashboardPage';
import { DsrReportPage } from '@/pages/DsrReportPage';
import PartnerUploadPage from '@/pages/partner/PartnerUploadPage';
import PartnerDocumentsPage from '@/pages/partner/PartnerDocumentsPage';
import ThreePlPage from '@/pages/partner/ThreePlPage';
import StockPositionPage from '@/pages/partner/StockPositionPage';
import OutwardDispatchPage from '@/pages/partner/OutwardDispatchPage';
import CustomerProjectsPage from '@/pages/portal/CustomerProjectsPage';
import CustomerTrackingPage from '@/pages/portal/CustomerTrackingPage';
import { DocumentGeneratePage } from '@/pages/DocumentGeneratePage';
import { PackingListGeneratePage } from '@/pages/PackingListGeneratePage';
import { BoeGeneratePage } from '@/pages/BoeGeneratePage';
import { RequireActivity } from '@/components/PermissionGate';
import { CreateShipmentPage } from '@/pages/CreateShipmentPage';
import { SchemaReferencePage } from '@/pages/SchemaReferencePage';
import { UploadProcessPage } from '@/pages/UploadProcessPage';
import { DocumentDetailPage } from '@/pages/DocumentDetailPage';
import { ContainerDashboardPage } from '@/pages/inventory/ContainerDashboardPage';
import { ContainerDetailPage } from '@/pages/inventory/ContainerDetailPage';
import { WarehouseInventoryPage } from '@/pages/inventory/WarehouseInventoryPage';
import { DndManagementPage } from '@/pages/inventory/DndManagementPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminRolesPage } from '@/pages/admin/AdminRolesPage';
import { AdminOrgsPage } from '@/pages/admin/AdminOrgsPage';
import { AdminTemplatesPage } from '@/pages/admin/AdminTemplatesPage';
import { AdminValidationPage } from '@/pages/admin/AdminValidationPage';
import { AdminAccountingPage } from '@/pages/admin/AdminAccountingPage';
import { AdminEscalationPage } from '@/pages/admin/AdminEscalationPage';
import { AdminInventoryPage } from '@/pages/admin/AdminInventoryPage';
import { AdminWarehousesPage } from '@/pages/admin/AdminWarehousesPage';
import { AdminProductsPage } from '@/pages/admin/AdminProductsPage';
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage';
import { AdminCompliancePage } from '@/pages/admin/AdminCompliancePage';
import { ProjectListPage } from '@/pages/ProjectListPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { EwmsShipLoader } from '@/components/EwmsShipLoader';

const queryClient = new QueryClient();

function UnauthorizedPage() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="text-center space-y-2 px-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">
          You don't have permission to access this page.
          Contact your administrator if you believe this is an error.
        </p>
      </div>
    </div>
  );
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
            <Route path="/unauthorized" component={UnauthorizedPage} />
            <Route path="/dashboard">
              <RequireModule module="dashboard" fallback={<Redirect to="/unauthorized" />}>
                <DashboardPage />
              </RequireModule>
            </Route>
            <Route path="/shipments/new">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <CreateShipmentPage />
              </RequireModule>
            </Route>
            <Route path="/shipments/:id/documents">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <ShipmentDocumentsPage />
              </RequireModule>
            </Route>
            <Route path="/shipments/:id">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <ShipmentDetailPage />
              </RequireModule>
            </Route>
            <Route path="/shipments">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <ShipmentsPage />
              </RequireModule>
            </Route>
            <Route path="/tracking">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <ShipmentDetailPage />
              </RequireModule>
            </Route>
            <Route path="/inventory/containers/:id">
              <RequireModule module="inventory" fallback={<Redirect to="/dashboard" />}>
                <ContainerDetailPage />
              </RequireModule>
            </Route>
            <Route path="/inventory/containers">
              <RequireModule module="inventory" fallback={<Redirect to="/dashboard" />}>
                <ContainerDashboardPage />
              </RequireModule>
            </Route>
            <Route path="/inventory/warehouse">
              <RequireModule module="warehouse" fallback={<Redirect to="/dashboard" />}>
                <WarehouseInventoryPage />
              </RequireModule>
            </Route>
            <Route path="/inventory/dnd">
              <RequireModule module="dnd" fallback={<Redirect to="/dashboard" />}>
                <DndManagementPage />
              </RequireModule>
            </Route>
            <Route path="/inventory">
              <Redirect to="/inventory/containers" />
            </Route>
            <Route path="/projects/:id">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <ProjectDetailPage />
              </RequireModule>
            </Route>
            <Route path="/projects">
              <RequireModule module="shipments" fallback={<Redirect to="/dashboard" />}>
                <ProjectListPage />
              </RequireModule>
            </Route>
            <Route path="/documents/generate/packing-list">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <RequireActivity code="DOC-003" fallback={<Redirect to="/unauthorized" />}>
                  <PackingListGeneratePage />
                </RequireActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/boe">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <RequireActivity code="DOC-003" fallback={<Redirect to="/unauthorized" />}>
                  <BoeGeneratePage />
                </RequireActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/:type">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentGeneratePage />
              </RequireModule>
            </Route>
            <Route path="/documents/generate">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentGeneratePage />
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id/approve">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentDetailPage />
              </RequireModule>
            </Route>
            <Route path="/documents/upload/generated/:id/details">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <UploadProcessPage />
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id/details">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <UploadProcessPage />
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentDetailPage />
              </RequireModule>
            </Route>
            <Route path="/documents/upload">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <UploadProcessPage />
              </RequireModule>
            </Route>
            <Route path="/documents/:id">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentDetailPage />
              </RequireModule>
            </Route>
            <Route path="/documents">
              <RequireModule module="documents" fallback={<Redirect to="/dashboard" />}>
                <DocumentsPage />
              </RequireModule>
            </Route>
            <Route path="/tasks">
              <RequireModule module="tasks" fallback={<Redirect to="/dashboard" />}>
                <TasksPage />
              </RequireModule>
            </Route>
            <Route path="/accounting">
              <RequireModule module="accounting" fallback={<Redirect to="/dashboard" />}>
                <FinanceTicketQueuePage />
              </RequireModule>
            </Route>
            <Route path="/finance">
              <RequireModule module="accounting" fallback={<Redirect to="/dashboard" />}>
                <FinanceDashboardPage />
              </RequireModule>
            </Route>
            <Route path="/reports/dsr">
              <RequireModule module="reports" fallback={<Redirect to="/dashboard" />}>
                <DsrReportPage />
              </RequireModule>
            </Route>
            <Route path="/partner/documents">
              <PartnerDocumentsPage />
            </Route>
            <Route path="/partner/warehouse/stock">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <StockPositionPage />
              </RequireModule>
            </Route>
            <Route path="/partner/warehouse/outward">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <OutwardDispatchPage />
              </RequireModule>
            </Route>
            <Route path="/partner/warehouse">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <ThreePlPage />
              </RequireModule>
            </Route>
            <Route path="/partner">
              <PartnerUploadPage />
            </Route>
            <Route path="/portal/tracking/:id">
              <CustomerTrackingPage />
            </Route>
            <Route path="/portal">
              <CustomerProjectsPage />
            </Route>
            <Route path="/invoices" component={InvoicesPage} />
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings" component={SettingsShell} />
            <Route path="/platform"><PlatformGuard><PlatformShell /></PlatformGuard></Route>
            <Route path="/user-settings" component={SettingsPage} />
            <Route path="/schema" component={SchemaReferencePage} />
          </Switch>
        </main>
      </div>
      <UploadSheet />
    </div>
  );
}

function AdminArea() {
  return (
    <AdminGuard>
      <AdminLayout>
        <Switch>
          <Route path="/admin/users" component={AdminUsersPage} />
          <Route path="/admin/roles" component={AdminRolesPage} />
          <Route path="/admin/organisations" component={AdminOrgsPage} />
          <Route path="/admin/templates/:id" component={AdminTemplatesPage} />
          <Route path="/admin/templates" component={AdminTemplatesPage} />
          <Route path="/admin/validation-rules" component={AdminValidationPage} />
          <Route path="/admin/accounting" component={AdminAccountingPage} />
          <Route path="/admin/escalation" component={AdminEscalationPage} />
          <Route path="/admin/inventory" component={AdminInventoryPage} />
          <Route path="/admin/warehouses" component={AdminWarehousesPage} />
          <Route path="/admin/products" component={AdminProductsPage} />
          <Route path="/admin/audit" component={AdminAuditPage} />
          <Route path="/admin/compliance" component={AdminCompliancePage} />
          <Route path="/admin">
            <Redirect to="/settings" />
          </Route>
        </Switch>
      </AdminLayout>
    </AdminGuard>
  );
}

function AdminExitWatcher() {
  useAdminExitRefresh();
  return null;
}

function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <UploadProvider>
        <AdminExitWatcher />
        <Switch>
          <Route path="/admin/:rest*" component={AdminArea} />
          <Route path="/admin" component={AdminArea} />
          <Route component={AppLayout} />
        </Switch>
      </UploadProvider>
    </SidebarProvider>
  );
}

function AppRoutes() {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) return <EwmsShipLoader fullPage />;

  const landingPath = (() => {
    if (!isAuthenticated) return '/';
    const mods = (user as any)?.modules as string[] | undefined ?? [];
    if (mods.includes('portal')) return '/portal';
    if (mods.includes('partner')) return '/partner';
    if (user?.role?.category === 'org_external') return '/partner';
    return '/dashboard';
  })();

  return (
    <Switch>
      <Route path="/">
        {isAuthenticated
          ? <Redirect to={landingPath} />
          : <LoginPage />
        }
      </Route>
      <Route>
        {isAuthenticated ? <AuthenticatedApp /> : <Redirect to="/" />}
      </Route>
    </Switch>
  );
}

function AppWithPermissions() {
  const { rbacPermissions, token } = useAuth();
  return (
    <PermissionProvider initialPermissions={rbacPermissions} authToken={token}>
      <ConfigProvider>
        <AppRoutes />
      </ConfigProvider>
    </PermissionProvider>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" storageKey="logisai-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthProvider>
              <AppWithPermissions />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
