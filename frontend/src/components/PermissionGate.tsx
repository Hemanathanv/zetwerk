import React from 'react';
import { usePermissions } from '@/contexts/PermissionContext';

export function RequireActivity({
  code,
  children,
  fallback = null,
}: {
  code: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { activities, loaded } = usePermissions();
  if (!loaded) return null;
  if (!activities.includes(code)) return <>{fallback}</>;
  return <>{children}</>;
}

export function RequireDocUpload({
  docType,
  children,
  fallback = null,
}: {
  docType: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { docTypes, loaded } = usePermissions();
  if (!loaded) return null;
  const allowed = docTypes.upload ?? [];
  if (!allowed.includes('*') && !allowed.includes(docType)) return <>{fallback}</>;
  return <>{children}</>;
}

export function RequireDocApproval({
  docType,
  children,
  fallback = null,
}: {
  docType: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { docTypes, loaded } = usePermissions();
  if (!loaded) return null;
  const allowed = docTypes.approve_extraction ?? [];
  if (!allowed.includes('*') && !allowed.includes(docType)) return <>{fallback}</>;
  return <>{children}</>;
}

export function RequireGateAccess({
  gateNumber,
  minLevel = 'summary',
  children,
  fallback = null,
}: {
  gateNumber: number;
  minLevel?: 'full' | 'summary';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { gates, loaded } = usePermissions();
  if (!loaded) return null;
  const gate = gates.find(g => g.gateNumber === gateNumber);
  if (!gate || gate.accessLevel === 'none') return <>{fallback}</>;
  if (minLevel === 'full' && gate.accessLevel !== 'full') return <>{fallback}</>;
  return <>{children}</>;
}

export function RequireModule({
  module,
  children,
  fallback = null,
}: {
  module: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { modules, loaded } = usePermissions();
  if (!loaded) return null;
  if (!modules.includes(module)) return <>{fallback}</>;
  return <>{children}</>;
}

export function RequireAnyActivity({
  codes,
  children,
  fallback = null,
}: {
  codes: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { activities, loaded } = usePermissions();
  if (!loaded) return null;
  if (!codes.some(c => activities.includes(c))) return <>{fallback}</>;
  return <>{children}</>;
}
