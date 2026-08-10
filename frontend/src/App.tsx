import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { useEffect } from 'react';
import { useAdminExitRefresh } from '@/hooks/useOperationalData';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PermissionProvider, usePermissions } from '@/contexts/PermissionContext';
import { RequireAnyModule, RequireModule } from '@/components/PermissionGate';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { Sidebar, SIDEBAR_WIDTH_OPEN, SIDEBAR_WIDTH_COLLAPSED } from '@/components/Sidebar';
import { TopHeader } from '@/components/TopHeader';
import { UploadSheet } from '@/components/UploadSheet';
import { DOC_GENERATION_ACTIVITY_CODES } from '@/lib/docGenerationAccess';
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
import DocumentGenerationOutwardGrnPage from '@/pages/DocumentGenerationOutwardGrnPage';
import { DocumentGeneratePage } from '@/pages/DocumentGeneratePage';
import { PackingListGeneratePage } from '@/pages/PackingListGeneratePage';
import { BoeGeneratePage } from '@/pages/BoeGeneratePage';
import { RequireAnyActivity } from '@/components/PermissionGate';
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
import { AdminInventoryPage } from '@/pages/admin/AdminInventoryPage';
import { AdminWarehousesPage } from '@/pages/admin/AdminWarehousesPage';
import { AdminProductsPage } from '@/pages/admin/AdminProductsPage';
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage';
import { AdminCompliancePage } from '@/pages/admin/AdminCompliancePage';
import { ProjectListPage } from '@/pages/ProjectListPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { EwmsShipLoader } from '@/components/EwmsShipLoader';
import { firstAllowedLandingPath } from '@/lib/allowedNavigation';
import { EwmsScrollArea } from '@/components/ewms/Media';

const queryClient = new QueryClient();
const INTENDED_PATH_KEY = 'ewms:intended-path';

function UnauthorizedPage() {
  const [, navigate] = useLocation();
  const { modules, activities, loaded } = usePermissions();
  const landingPath = loaded ? firstAllowedLandingPath(modules, activities) : '/unauthorized';

  useEffect(() => {
    if (loaded && landingPath !== '/unauthorized') {
      navigate(landingPath, { replace: true });
    }
  }, [landingPath, loaded, navigate]);

  if (loaded && landingPath !== '/unauthorized') {
    return <EwmsShipLoader fullPage />;
  }

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

function AllowedLandingRedirect() {
  const [, navigate] = useLocation();
  const { modules, activities, loaded } = usePermissions();
  const landingPath = loaded ? firstAllowedLandingPath(modules, activities) : '/unauthorized';

  useEffect(() => {
    if (loaded) {
      navigate(landingPath, { replace: true });
    }
  }, [landingPath, loaded, navigate]);

  return <EwmsShipLoader fullPage />;
}

function RememberPathAndRedirectToLogin() {
  const [location, navigate] = useLocation();

  useEffect(() => {
    const path = window.location.pathname + window.location.search + window.location.hash;
    const isPublicAuthPath = path === '/' || path.startsWith('/login') || path.startsWith('/forgot-password') || path.startsWith('/reset-password');

    // Only store intended path if we're coming from an authenticated route
    // This prevents overwriting the intended path during normal navigation
    if (!isPublicAuthPath && !window.sessionStorage.getItem(INTENDED_PATH_KEY)) {
      window.sessionStorage.setItem(INTENDED_PATH_KEY, path);
    }
    navigate('/', { replace: true });
  }, [location, navigate]);

  return <EwmsShipLoader fullPage />;
}

function AuthenticatedRootRedirect({ landingPath }: { landingPath: string }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    const intendedPath = window.sessionStorage.getItem(INTENDED_PATH_KEY);
    if (intendedPath && intendedPath !== '/' && intendedPath !== '/login') {
      window.sessionStorage.removeItem(INTENDED_PATH_KEY);
      navigate(intendedPath, { replace: true });
      return;
    }
    navigate(landingPath, { replace: true });
  }, [landingPath, navigate]);

  return <EwmsShipLoader fullPage />;
}


export function UnderBuildPage({ title = 'Currently under build' }: { title?: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh] px-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-muted-foreground">Currently under build</p>
      </div>
    </div>
  );
}

function AppLayout() {
  const { isOpen } = useSidebar();
  const sidebarWidth = isOpen ? SIDEBAR_WIDTH_OPEN : SIDEBAR_WIDTH_COLLAPSED;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <TopHeader />
        <EwmsScrollArea as="main" className="flex-1">
          <Switch>
            <Route path="/unauthorized" component={UnauthorizedPage} />
            <Route path="/dashboard">
              <RequireModule module="dashboard" fallback={<Redirect to="/unauthorized" />}>
                <DashboardPage />
              </RequireModule>
            </Route>
            <Route path="/shipments/new">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.create', 'SHP-002']} fallback={<Redirect to="/unauthorized" />}>
                  <CreateShipmentPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/shipments/:id/documents">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.view', 'documents.view_extracted']} fallback={<Redirect to="/unauthorized" />}>
                  <ShipmentDocumentsPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/shipments/:id">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.view', 'SHP-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ShipmentDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/shipments">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.view', 'SHP-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ShipmentsPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/tracking">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.view', 'SHP-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ShipmentDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/inventory/containers/:id">
              <RequireModule module="inventory" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.view_container', 'inventory.view_timeline', 'GATE-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ContainerDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/inventory/containers">
              <RequireModule module="inventory" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.view_container', 'inventory.view_timeline', 'GATE-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ContainerDashboardPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/inventory/warehouse">
              <RequireModule module="warehouse" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.warehouse_inventory_stock_position', 'inventory.view_warehouse']} fallback={<Redirect to="/unauthorized" />}>
                  <WarehouseInventoryPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/inventory/dnd">
              <RequireModule module="dnd" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.view_dnd_charges', 'dnd.tariff.view', 'dnd.holiday_calendar.upload']} fallback={<Redirect to="/unauthorized" />}>
                  <DndManagementPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/inventory">
              <AllowedLandingRedirect />
            </Route>
            <Route path="/projects/:id">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.view', 'SHP-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ProjectDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/projects">
              <RequireModule module="shipments" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['shipments.view', 'SHP-001']} fallback={<Redirect to="/unauthorized" />}>
                  <ProjectListPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/packing-list">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={DOC_GENERATION_ACTIVITY_CODES} fallback={<Redirect to="/unauthorized" />}>
                  <PackingListGeneratePage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/boe">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={DOC_GENERATION_ACTIVITY_CODES} fallback={<Redirect to="/unauthorized" />}>
                  <BoeGeneratePage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/outward-grn">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={[...DOC_GENERATION_ACTIVITY_CODES, 'inventory.create_outward_grn_new_dispatch', 'inventory.update_milestone']} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentGenerationOutwardGrnPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate/outward-pl">
              <Redirect to="/documents/generate/outward-grn" />
            </Route>
            <Route path="/documents/generate/us-packing-list">
              <Redirect to="/documents/generate/outward-grn" />
            </Route>
            <Route path="/documents/generate/:type">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={DOC_GENERATION_ACTIVITY_CODES} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentGeneratePage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/generate">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={DOC_GENERATION_ACTIVITY_CODES} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentGeneratePage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id/approve">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields']} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload/generated/:id/details">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields', 'documents.reprocess_ocr']} fallback={<Redirect to="/unauthorized" />}>
                  <UploadProcessPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id/details">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields', 'documents.reprocess_ocr']} fallback={<Redirect to="/unauthorized" />}>
                  <UploadProcessPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload/queue">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields', 'documents.reprocess_ocr']} fallback={<Redirect to="/unauthorized" />}>
                  <UploadProcessPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload/:id">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.view', 'documents.view_extracted']} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/upload">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields', 'documents.reprocess_ocr']} fallback={<Redirect to="/unauthorized" />}>
                  <UploadProcessPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents/:id">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.view', 'documents.view_extracted']} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentDetailPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/documents">
              <RequireModule module="documents" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.view', 'documents.view_extracted']} fallback={<Redirect to="/unauthorized" />}>
                  <DocumentsPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/tasks">
              <RequireModule module="tasks" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['tasks.view', 'TSK-001']} fallback={<Redirect to="/unauthorized" />}>
                  <TasksPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/accounting">
              <RequireModule module="accounting" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['accounting.view_queue', 'ACC-001']} fallback={<Redirect to="/unauthorized" />}>
                  <FinanceTicketQueuePage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/finance">
              <RequireModule module="accounting" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['accounting.view_ap_aging', 'accounting.view_queue']} fallback={<Redirect to="/unauthorized" />}>
                  <FinanceDashboardPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/reports/dsr">
              <RequireModule module="reports" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['reports.generate_dsr']} fallback={<Redirect to="/unauthorized" />}>
                  <DsrReportPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/reports">
              <RequireModule module="reports" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['reports.view_dashboard']} fallback={<Redirect to="/unauthorized" />}>
                  <UnderBuildPage title="Reports" />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/partner/documents">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.view', 'documents.view_extracted']} fallback={<Redirect to="/unauthorized" />}>
                  <PartnerDocumentsPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/partner/warehouse/stock">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.view_container']} fallback={<Redirect to="/unauthorized" />}>
                  <StockPositionPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/partner/warehouse/outward">
              <Redirect to="/documents/generate/outward-grn" />
            </Route>
            <Route path="/partner/warehouse">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['inventory.view_container', 'inventory.view_timeline']} fallback={<Redirect to="/unauthorized" />}>
                  <ThreePlPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/partner">
              <RequireModule module="partner" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['documents.upload']} fallback={<Redirect to="/unauthorized" />}>
                  <PartnerUploadPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/portal/tracking/:id">
              <AllowedLandingRedirect />
            </Route>
            <Route path="/portal">
              <AllowedLandingRedirect />
            </Route>
            <Route path="/invoices">
              <RequireModule module="accounting" fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['accounting.view_queue', 'ACC-001']} fallback={<Redirect to="/unauthorized" />}>
                  <InvoicesPage />
                </RequireAnyActivity>
              </RequireModule>
            </Route>
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings">
              <RequireAnyModule modules={['settings', 'admin']} fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['admin.manage', 'users.manage', 'roles.view']} fallback={<Redirect to="/unauthorized" />}>
                  <SettingsShell />
                </RequireAnyActivity>
              </RequireAnyModule>
            </Route>
            <Route path="/platform"><PlatformGuard><PlatformShell /></PlatformGuard></Route>
            <Route path="/user-settings" component={SettingsPage} />
            <Route path="/schema">
              <RequireAnyModule modules={['settings', 'admin']} fallback={<Redirect to="/unauthorized" />}>
                <RequireAnyActivity codes={['admin.configure_doctypes', 'roles.view']} fallback={<Redirect to="/unauthorized" />}>
                  <SchemaReferencePage />
                </RequireAnyActivity>
              </RequireAnyModule>
            </Route>
            <Route>
              <AllowedLandingRedirect />
            </Route>
          </Switch>
        </EwmsScrollArea>
      </div>
      <UploadSheet />
    </div>
  );
}

function AdminArea() {
  return (
    <RequireModule module="admin" fallback={<Redirect to="/unauthorized" />}>
      <RequireAnyActivity codes={['admin.manage', 'roles.view', 'users.manage']} fallback={<Redirect to="/unauthorized" />}>
        <AdminGuard>
          <AdminLayout>
            <Switch>
              <Route path="/admin/users">
                <AdminUsersPage />
              </Route>
              <Route path="/admin/roles" component={AdminRolesPage} />
              <Route path="/admin/organisations" component={AdminOrgsPage} />
              <Route path="/admin/templates/:id" component={AdminTemplatesPage} />
              <Route path="/admin/templates" component={AdminTemplatesPage} />
              <Route path="/admin/validation-rules" component={AdminValidationPage} />
              <Route path="/admin/accounting" component={AdminAccountingPage} />
              <Route path="/admin/escalation"><Redirect to="/admin/roles" /></Route>
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
      </RequireAnyActivity>
    </RequireModule>
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
  const { modules, activities, loaded: permissionsLoaded } = usePermissions();

  if (loading || (isAuthenticated && !permissionsLoaded)) return <EwmsShipLoader fullPage />;

  const landingPath = (() => {
    if (!isAuthenticated) return '/';
    return firstAllowedLandingPath(modules, activities);
  })();

  return (
    <Switch>
      <Route path="/">
        {isAuthenticated
          ? <AuthenticatedRootRedirect landingPath={landingPath} />
          : <LoginPage />
        }
      </Route>
      <Route>
        {isAuthenticated ? <AuthenticatedApp /> : <RememberPathAndRedirectToLogin />}
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
