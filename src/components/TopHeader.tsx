import { useState } from 'react';
import { Search, Bell, PlusCircle, Upload, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function TopHeader() {
  const [searchValue, setSearchValue] = useState('');
  const { theme, setTheme } = useTheme();

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
          data-testid="button-notifications"
        >
          <Bell className="w-4 h-4" />
          <span
            className="absolute top-1 right-1 text-white text-[9px] font-bold w-3.5 h-3.5 flex items-center justify-center rounded-full leading-none"
            style={{ backgroundColor: 'hsl(var(--destructive))' }}
          >
            4
          </span>
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

        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Create Invoice */}
        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs"
          data-testid="button-create-invoice"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Create Invoice</span>
          <span className="sm:hidden">New</span>
        </Button>

        {/* Upload Document */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          data-testid="button-upload-document"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Upload Document</span>
          <span className="md:hidden">Upload</span>
        </Button>
      </div>
    </header>
  );
}
