import { Droplets, Wind, TreePine, Zap, Wrench, type LucideIcon } from "lucide-react";

/**
 * Maps `verticals.icon_name` (admin-editable, free text — see Verticals.tsx)
 * to the actual component. Extracted from Index.tsx so BusinessMark can use
 * the same mapping rather than maintaining a second one that drifts.
 */
const ICON_MAP: Record<string, LucideIcon> = { Droplets, Wind, TreePine, Zap, Wrench };

/** Falls back to Wrench for an unset or unrecognised icon name. */
export function getVerticalIcon(iconName: string | null | undefined): LucideIcon {
  return (iconName && ICON_MAP[iconName]) || Wrench;
}
