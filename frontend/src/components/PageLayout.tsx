import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  title: string;
  description: string;
  icon: LucideIcon;
  accentColor: string;
  children: ReactNode;
}

export default function PageLayout({
  title,
  description,
  icon: Icon,
  accentColor,
  children,
}: PageLayoutProps) {
  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4 shrink-0">
        <div className="flex items-center gap-4">
           <img
                src="/sidebar-left-logo.svg"
                alt="Company logo"
                className="w-14 h-14 object-contain"
              />
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              accentColor
            )}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground tracking-wide">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {/* <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded border border-border">
              BOT MODULE
            </span>
          </div> */}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  );
}
