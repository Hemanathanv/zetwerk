import { useAuth } from './AuthContext';
import { Route, Redirect } from 'wouter';
import { useLocation } from 'wouter';

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType<any>;
  [key: string]: any;
}

export function ProtectedRoute({ path, component: Component, ...rest }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const [location] = useLocation();

  if (loading) {
    // You can return a loading spinner here
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    // Redirect to login, preserving the current location for redirect back
    return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;
  }

  // Render the protected component
  return <Route path={path} component={Component} {...rest} />;
}

interface PublicRouteProps {
  path: string;
  component: React.ComponentType<any>;
  [key: string]: any;
}

export function PublicRoute({ path, component: Component, ...rest }: PublicRouteProps) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    // If user is authenticated and tries to access public routes, redirect to dashboard
    return <Redirect to="/dashboard" />;
  }

  // Render the public component
  return <Route path={path} component={Component} {...rest} />;
}