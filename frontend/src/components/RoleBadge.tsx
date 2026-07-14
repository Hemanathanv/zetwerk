import { useConfig } from '@/contexts/ConfigContext';

export function RoleBadge({ roleId, size = 'sm' }: { roleId: string; size?: 'sm' | 'md' }) {
  const { getRoleById } = useConfig();
  const role = getRoleById(roleId);

  if (!role) return <span className="text-[13px] text-muted-foreground">Unknown role</span>;

  const sizeClasses = size === 'sm' ? 'text-[12px] px-1.5 py-0.5' : 'text-[13px] px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses}`}
      style={{ backgroundColor: `${role.color}22`, color: role.color }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: role.color }}
      />
      {role.name}
    </span>
  );
}

export function UserAvatar({
  name,
  roleId,
  size = 'md',
}: {
  name: string;
  roleId?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { getRoleById } = useConfig();
  const role = roleId ? getRoleById(roleId) : null;
  const bgColor = role?.color || '#64748B';

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: 'w-6 h-6 text-[12px]',
    md: 'w-8 h-8 text-[13px]',
    lg: 'w-10 h-10 text-[14.5px]',
  }[size];

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
      style={{ backgroundColor: bgColor }}
      title={`${name}${role ? ` — ${role.name}` : ''}`}
    >
      {initials}
    </div>
  );
}

export function LevelBadge({ level }: { level: string }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-mono font-medium bg-muted text-muted-foreground">
      {level}
    </span>
  );
}

export function UserRoleDisplay({
  name,
  roleId,
  level,
  size = 'sm',
}: {
  name: string;
  roleId: string;
  level: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex items-center gap-2">
      <UserAvatar name={name} roleId={roleId} size={size} />
      <div className="min-w-0">
        <div className={`font-medium truncate ${size === 'sm' ? 'text-[13px]' : 'text-[14.5px]'}`}>
          {name}
        </div>
        <div className="flex items-center gap-1.5">
          <RoleBadge roleId={roleId} size="sm" />
          <LevelBadge level={level} />
        </div>
      </div>
    </div>
  );
}
