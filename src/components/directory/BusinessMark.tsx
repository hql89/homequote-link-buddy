import { useActiveVerticals } from "@/hooks/useVerticals";
import { getVerticalIcon } from "@/lib/verticalIcons";
import { markColor, markInitials } from "@/lib/businessMark";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4", text: "text-xs" },
  md: { box: "h-10 w-10", icon: "h-5 w-5", text: "text-sm" },
  lg: { box: "h-16 w-16", icon: "h-8 w-8", text: "text-xl" },
} as const;

interface BusinessMarkProps {
  businessName: string;
  verticalSlug: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Generated stand-in for a listing with no photo — every CSLB-ingested
 * business today. A trade icon on a colour derived from the name, not a
 * photograph and not pretending to be one. Deterministic: the same business
 * renders identically everywhere.
 *
 * Reads verticals via the existing 5-minute-cached useActiveVerticals() query
 * rather than taking icon data as a prop — react-query dedupes the request
 * across every card on a page, so this stays a one-line drop-in at each call
 * site instead of threading a lookup through three separate pages.
 */
export function BusinessMark({ businessName, verticalSlug, size = "md", className }: BusinessMarkProps) {
  const { data: verticals } = useActiveVerticals();
  const dims = SIZES[size];

  const vertical = verticalSlug ? verticals?.find((v) => v.slug === verticalSlug) : undefined;

  // Icon once the vertical is known; initials otherwise (including the brief
  // window before useActiveVerticals resolves) — same fixed box either way,
  // so there is no layout shift when the icon arrives.
  const Icon = vertical ? getVerticalIcon(vertical.icon_name) : null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
        dims.box,
        dims.text,
        className,
      )}
      style={{ backgroundColor: markColor(businessName) }}
      role="img"
      aria-label={businessName}
    >
      {Icon ? <Icon className={dims.icon} aria-hidden="true" /> : markInitials(businessName)}
    </div>
  );
}
