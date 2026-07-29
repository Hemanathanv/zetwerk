import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border text-xs font-medium leading-none tracking-[0.02em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#eefefb] text-primary",
        secondary: "border-transparent bg-[#e5e5e5] text-[#555]",
        destructive: "border-transparent bg-[#fdf2f1] text-[#c51625]",
        outline: "border-current bg-transparent text-foreground",
        success: "border-transparent bg-[#e2fdeb] text-[#198653]",
        warning: "border-transparent bg-[#fdf3ec] text-[#d17215]",
        danger: "border-transparent bg-[#fdf2f1] text-[#c51625]",
        info: "border-transparent bg-[#dbe9fb] text-[#0c46c3]",
        active: "border-transparent bg-[#eefefb] text-[#2a9d90]",
        draft: "border-transparent bg-[#e5e5e5] text-[#353535]",
        neutral: "border-transparent bg-[#e5e5e5] text-[#555]",
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
  secondary: "bg-[#555]",
  destructive: "bg-[#c51625]",
  outline: "bg-current",
  success: "bg-[#198653]",
  warning: "bg-[#d17215]",
  danger: "bg-[#c51625]",
  info: "bg-[#0c46c3]",
  active: "bg-[#2a9d90]",
  draft: "bg-[#353535]",
  neutral: "bg-[#555]",
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
