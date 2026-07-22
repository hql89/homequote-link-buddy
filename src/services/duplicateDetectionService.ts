import type { LeadInsert } from "@/types";

/**
 * STUB: Duplicate detection service.
 * Returns no duplicate found. Replace with real logic later.
 */
export function checkDuplicate(_lead: Partial<LeadInsert>): { isDuplicate: false } {
  return { isDuplicate: false };
}
