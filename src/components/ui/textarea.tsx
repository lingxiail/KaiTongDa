import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-h-20 px-3 py-2 bg-[var(--lingxi-bg-muted)] border border-[var(--lingxi-border)] rounded-lg",
        "text-sm text-[var(--lingxi-text-primary)]",
        "placeholder:text-[var(--lingxi-text-placeholder)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--lingxi-clay-ring)] focus:border-[var(--lingxi-clay)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "transition-all resize-y",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
