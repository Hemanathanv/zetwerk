import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, Package, Radar, FileText, Receipt,
  Bell, Settings, LogOut, PanelLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/contexts/SidebarContext';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
  { icon: Radar, label: 'Tracking', href: '/tracking' },
  { icon: FileText, label: 'Document AI', href: '/documents' },
  { icon: Receipt, label: 'Invoices', href: '/invoices' },
  { icon: Bell, label: 'Notifications', href: '/notifications', badge: 3 },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

function ZetwerkLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="7" fill="hsl(18 87% 55%)" />
      <path
        d="M8 9h16l-9 14h9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { isOpen, toggle } = useSidebar();

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-30 transition-all duration-200"
      style={{
        width: isOpen ? 240 : 60,
        backgroundColor: 'hsl(var(--sidebar))',
        borderRight: '1px solid hsl(var(--sidebar-border))',
      }}
      data-testid="sidebar"
    >
      {/* Logo + collapse toggle */}
      <div
        className="flex items-center gap-2.5 px-3 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'hsl(var(--sidebar-border))', minHeight: 57 }}
      >
        <ZetwerkLogo size={32} />

        {isOpen && (
          <span className="text-base font-bold tracking-tight text-white flex-1 truncate">
            Zetwerk
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="w-7 h-7 flex-shrink-0 text-slate-400 hover:text-white hover:bg-white/10"
          data-testid="button-sidebar-toggle"
        >
          <PanelLeft className="w-4 h-4" />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href === '/' && location === '/');
          const Icon = item.icon;

          const linkContent = (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-2.5 py-2.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer relative group w-full ${
                isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              } ${!isOpen ? 'justify-center' : ''}`}
              style={isActive ? { backgroundColor: 'hsl(var(--sidebar-accent))' } : {}}
              data-testid={`nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
            >
              {isActive && isOpen && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                />
              )}
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}
              />
              {isOpen && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className="text-white text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'hsl(var(--destructive))' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
              {!isOpen && item.badge && (
                <span
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: 'hsl(var(--destructive))' }}
                />
              )}
            </Link>
          );

          if (!isOpen) {
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  {linkContent}
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {item.label}
                  {item.badge ? ` (${item.badge})` : ''}
                </TooltipContent>
              </Tooltip>
            );
          }

          return linkContent;
        })}
      </nav>

      {/* User Card */}
      <div className="px-2 pb-3 border-t pt-3 flex-shrink-0" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        {isOpen ? (
          <div
            className="flex items-center gap-3 px-2.5 py-2.5 rounded-md cursor-pointer transition-colors hover:bg-white/5"
            data-testid="user-card"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
            >
              HV
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Hemanathan</p>
              <p className="text-xs text-slate-400 truncate">Manager</p>
            </div>
            <LogOut className="w-4 h-4 text-slate-500 flex-shrink-0" />
          </div>
        ) : (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <div
                className="flex items-center justify-center py-2.5 rounded-md cursor-pointer transition-colors hover:bg-white/5"
                data-testid="user-card"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                >
                  HV
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              Hemanathan · Manager
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
