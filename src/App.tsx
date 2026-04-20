import { Switch, Route, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { Sidebar } from '@/components/Sidebar';
import { TopHeader } from '@/components/TopHeader';
import { Dashboard } from '@/pages/Dashboard';
import { DashboardPage } from '@/pages/DashboardPage';
import { TrackingPage } from '@/pages/TrackingPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { SettingsPage } from '@/pages/SettingsPage';

const queryClient = new QueryClient();

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
            <Route path="/tracking" component={TrackingPage} />
            <Route path="/documents" component={DocumentsPage} />
            <Route path="/invoices" component={InvoicesPage} />
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings" component={SettingsPage} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" storageKey="logisai-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <SidebarProvider>
              <AppLayout />
            </SidebarProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
