import { useState } from 'react';
import { Search, Bell, Sun, Moon, LogOut, Upload } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useUpload } from '@/contexts/UploadContext';

export function TopHeader() {
  const [searchValue, setSearchValue] = useState('');
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { openUpload } = useUpload();
  const [, navigate] = useLocation();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b bg-background"
      style={{ borderColor: 'hsl(var(--border))' }}
      data-testid="top-header"
    >
      {/* Search */}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          placeholder="Search Shipment ID, BOL, Booking No, Invoice..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          style={{ borderColor: 'hsl(var(--border))' }}
          data-testid="input-search"
        />
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">

        {/* Upload button */}
        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs font-semibold px-3"
          onClick={openUpload}
          data-testid="global-upload-button"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Upload</span>
        </Button>

        {/* Shipsy sync */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400"
          data-testid="shipsy-sync-status"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="hidden sm:inline">Shipsy Sync </span>Live
        </div>

        {/* Notification bell */}
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/notifications')}
          data-testid="button-notifications"
        >
          <Bell className="w-4 h-4" />
        </Button>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="button-theme-toggle"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        {/* User info + logout */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l" style={{ borderColor: 'hsl(var(--border))' }}>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-foreground leading-tight">{user.fullName}</p>
              {user.role && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 mt-0.5">
                  {user.role.name}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleLogout}
              data-testid="button-logout-header"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
