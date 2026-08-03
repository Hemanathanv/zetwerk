import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border text-xs font-medium leading-none tracking-[0.02em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[hsl(var(--primary)/0.10)] text-primary",
        secondary: "border-transparent bg-muted text-muted-foreground",
        destructive: "border-transparent bg-[hsl(var(--destructive)/0.10)] text-destructive",
        outline: "border-current bg-transparent text-foreground",
        success: "border-transparent bg-[hsl(var(--vs-success)/0.12)] text-[hsl(var(--vs-success))]",
        warning: "border-transparent bg-[hsl(var(--vs-warning)/0.14)] text-[hsl(var(--vs-warning))]",
        danger: "border-transparent bg-[hsl(var(--destructive)/0.10)] text-destructive",
        info: "border-transparent bg-[hsl(var(--vs-info)/0.12)] text-[hsl(var(--vs-info))]",
        active: "border-transparent bg-[hsl(var(--primary)/0.10)] text-primary",
        draft: "border-transparent bg-muted text-foreground",
        neutral: "border-transparent bg-muted text-muted-foreground",
      },
      badgeStyle: {
        filled: "",
        outline: "border-current bg-transparent",
      },
      size: {
        default: "min-h-7 px-2.5 py-1.5",
        sm: "min-h-6 px-2 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      badgeStyle: "filled",
      size: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  intent?: "success" | "warning" | "danger" | "info" | "active" | "draft" | "neutral"
  hasDot?: boolean
  leadingIcon?: React.ReactNode
}

const dotColorByVariant: Record<string, string> = {
  default: "bg-primary",
  secondary: "bg-muted-foreground",
  destructive: "bg-destructive",
  outline: "bg-current",
  success: "bg-[hsl(var(--vs-success))]",
  warning: "bg-[hsl(var(--vs-warning))]",
  danger: "bg-destructive",
  info: "bg-[hsl(var(--vs-info))]",
  active: "bg-primary",
  draft: "bg-foreground",
  neutral: "bg-muted-foreground",
}

function Badge({
  className,
  variant,
  intent,
  badgeStyle,
  size,
  hasDot = false,
  leadingIcon,
  children,
  ...props
}: BadgeProps) {
  const resolvedVariant = intent ?? variant ?? "default"

  return (
    <div className={cn(badgeVariants({ variant: resolvedVariant, badgeStyle, size }), className)} {...props}>
      {hasDot && <span className={cn("size-1.5 shrink-0 rounded-full", dotColorByVariant[resolvedVariant])} />}
      {leadingIcon && <span className="flex size-3 shrink-0 items-center justify-center">{leadingIcon}</span>}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
