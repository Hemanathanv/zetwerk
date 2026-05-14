import { useMemo, useState } from "react";
import { Bell, Moon, PlusCircle, Search, Sun, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const searchPlaceholders: Record<string, string> = {
  dashboard: "Search document IDs, file names, or statuses...",
  "document-ocr": "Search document IDs, file names, page text, or extraction data...",
  settings: "Search profile fields or settings...",
  admin: "Search users, permissions, buckets, or roles...",
};

export function TopHeader() {
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useLocation();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const sectionKey = useMemo(() => {
    if (location.startsWith("/document-ocr")) return "document-ocr";
    if (location.startsWith("/settings")) return "settings";
    if (location.startsWith("/admin/")) return "admin";
    return "dashboard";
  }, [location]);

  const placeholder = searchPlaceholders[sectionKey];
  const activeTheme = theme === "system" ? resolvedTheme : theme;

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-3"
      style={{ borderColor: "hsl(var(--border))" }}
      data-testid="top-header"
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder={placeholder}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="w-full rounded-md border bg-background py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          style={{ borderColor: "hsl(var(--border))" }}
          data-testid="input-search"
        />
      </div>

      <div className="flex items-center gap-2">
        <div
          className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
          data-testid="sync-status"
        >
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="hidden sm:inline">OCR Pipeline</span>
            <span>Live</span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4" />
          <span
            className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none text-white"
            style={{ backgroundColor: "hsl(var(--destructive))" }}
          >
            4
          </span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(activeTheme === "dark" ? "light" : "dark")}
          data-testid="button-theme-toggle"
        >
          {activeTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* <div className="mx-0.5 h-5 w-px bg-border" />

        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          data-testid="button-create-document"
          onClick={() => setLocation("/document-ocr")}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Document</span>
          <span className="sm:hidden">New</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          data-testid="button-upload-document"
          onClick={() => setLocation("/document-ocr")}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Upload Document</span>
          <span className="md:hidden">Upload</span>
        </Button> */}
      </div>
    </header>
  );
}
