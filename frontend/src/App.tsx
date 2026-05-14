import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute, PublicRoute } from "@/auth/ProtectedRoute";
import NotFound from "@/pages/not-found";
import MainPage from "@/pages/MainPage";
import { LoginPage } from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <PublicRoute path="/login" component={LoginPage} />
      <PublicRoute path="/forgot-password" component={ForgotPasswordPage} />
      <PublicRoute path="/reset-password" component={ResetPasswordPage} />

      {/* Protected Routes */}
      <ProtectedRoute path="/" component={() => <Redirect to="/dashboard" />} />
      <ProtectedRoute path="/dashboard" component={MainPage} />
      <ProtectedRoute path="/document-ocr" component={MainPage} />
      <ProtectedRoute path="/document-ocr/:documentId" component={MainPage} />
      <ProtectedRoute path="/settings" component={MainPage} />
      <ProtectedRoute path="/admin/users" component={MainPage} />
      <ProtectedRoute path="/admin/storage" component={MainPage} />
      <ProtectedRoute path="/admin/permissions" component={MainPage} />

      {/* 404 Not Found */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;



