import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-[#e5e5e5] disabled:text-[#a5a5a5] disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary-border bg-primary text-primary-foreground hover:bg-[hsl(var(--vs-teal-dark))] active:bg-[hsl(var(--vs-teal-dark))]",
        destructive:
          "border border-destructive-border bg-destructive text-destructive-foreground hover:bg-red-700 active:bg-red-700",
        outline:
          "border border-input bg-transparent text-foreground hover:bg-muted active:bg-muted",
        secondary:
          "border border-[#c9c9c9] bg-white text-foreground hover:bg-[#f5f5f5] active:bg-[#f5f5f5] dark:bg-card",
        ghost: "border border-transparent bg-transparent text-foreground hover:bg-muted active:bg-muted",
        success:
          "border border-[hsl(var(--vs-success))] bg-[hsl(var(--vs-success))] text-white hover:bg-green-900 active:bg-green-900",
        danger:
          "border border-destructive-border bg-destructive text-destructive-foreground hover:bg-red-700 active:bg-red-700",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-4",
        sm: "h-7 px-4 text-sm",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
