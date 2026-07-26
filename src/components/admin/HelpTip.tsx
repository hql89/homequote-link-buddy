import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Hover/focus help for an admin control.
 *
 * `TooltipProvider` is mounted once at the app root (see App.tsx), so this can
 * be dropped anywhere without extra wiring.
 *
 * Use this for the "why would I touch this?" detail that would clutter the page
 * if it were always visible. When the explanation is essential to using the
 * control at all — what a button will actually do, what a number means — put it
 * in visible text instead; help that only appears on hover is invisible on
 * touch devices and to anyone who doesn't think to look for it.
 */
export function HelpTip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Tooltips do not open on tap, so the label has to carry the text for
          // touch and screen-reader users.
          aria-label={typeof children === "string" ? children : "More information"}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Standard heading for an admin page: title, one-line description of what the
 * page is for, and optionally what the admin is expected to do here.
 */
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold font-serif text-primary">{title}</h1>
        {children}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** Muted explanatory line under a label or control. */
export function FieldHint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1 text-xs text-muted-foreground", className)}>{children}</p>;
}
