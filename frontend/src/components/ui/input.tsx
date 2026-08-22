import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"

const inputClassName =
  "flex h-8 w-full rounded-lg border border-input bg-background px-4 py-1.5 text-sm font-normal leading-[1.4] text-foreground shadow-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-input focus-visible:border-primary focus-visible:outline-none focus-visible:ring-0 aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 read-only:bg-background"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const isPassword = type === "password"

    const field = (
      <input
        type={isPassword ? (visible ? "text" : "password") : type}
        className={cn(inputClassName, isPassword && "pr-10", className)}
        ref={ref}
        {...props}
      />
    )

    if (!isPassword) return field

    return (
      <div className="relative w-full">
        {field}
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
