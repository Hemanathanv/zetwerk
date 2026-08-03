import { ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

type ProfileTriggerProps = {
  name: string;
  role?: string;
  imageUrl?: string;
  collapsed?: boolean;
  className?: string;
};

export function ProfileTrigger({ name, role, imageUrl, collapsed = false, className }: ProfileTriggerProps) {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
  return (
    <button
      type="button"
      className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sidebar-foreground hover:bg-sidebar-accent', className)}
      aria-label="Open profile menu"
    >
      <Avatar className="size-8">
        <AvatarImage src={imageUrl} alt="" />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            {role && <span className="block truncate text-xs text-sidebar-foreground/70">{role}</span>}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </>
      )}
    </button>
  );
}
