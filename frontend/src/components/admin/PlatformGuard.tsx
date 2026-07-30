import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { firstAllowedLandingPath } from '@/lib/allowedNavigation';
import { useEffect } from 'react';

export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const { modules, activities, loaded } = usePermissions();
  const isSuperAdmin = (user?.role as any)?.systemCode === 'super_admin';
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading || !loaded) return;
    if (!isAuthenticated) { setLocation('/'); return; }
    if (!isSuperAdmin) { setLocation(firstAllowedLandingPath(modules, activities)); }
  }, [activities, isAuthenticated, isSuperAdmin, loaded, loading, modules, setLocation]);

  if (loading || !loaded) return null;
  if (!isAuthenticated || !isSuperAdmin) return null;
  return <>{children}</>;
}
