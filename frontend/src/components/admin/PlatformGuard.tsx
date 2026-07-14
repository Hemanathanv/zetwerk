import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const isSuperAdmin = user?.role?.systemCode === 'super_admin';
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) { setLocation('/'); return; }
    if (!isSuperAdmin) { setLocation('/dashboard'); }
  }, [isAuthenticated, isSuperAdmin, loading, setLocation]);

  if (loading) return null;
  if (!isAuthenticated || !isSuperAdmin) return null;
  return <>{children}</>;
}
