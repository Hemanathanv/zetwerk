import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { firstAllowedLandingPath } from '@/lib/allowedNavigation';
import { useEffect } from 'react';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const { modules, activities, loaded } = usePermissions();
  const isAdmin = modules.includes('admin');
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading || !loaded) return;
    if (!isAuthenticated) { setLocation('/'); return; }
    if (!isAdmin) { setLocation(firstAllowedLandingPath(modules, activities)); }
  }, [activities, isAuthenticated, isAdmin, loading, loaded, modules, setLocation]);

  if (loading || !loaded) return null;
  if (!isAuthenticated || !isAdmin) return null;
  return <>{children}</>;
}
