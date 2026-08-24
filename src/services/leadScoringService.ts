import type { LeadInsert } from "@/types";

const URGENCY_SCORES: Record<string, number> = {
  emergency: 40,
  urgent: 25,
  soon: 10,
  flexible: 0,
};

// Highest intent: emergencies and large removals. Tree-service specific —
// there's no tuned point table yet for the other live verticals (plumbing,
// HVAC, landscaping, electrical). A service type not found here gets
// NEUTRAL_SERVICE_TYPE_SCORE below rather than silently landing on 0, which
// already means something specific in this table: "recognized and known
// low-intent" (e.g. "Other"). Conflating "not yet scored" with "known
// low-intent" is what happened before this table stopped being looked up
// through a vertical guess — see git history for the previous version.
const TREE_SERVICE_TYPE_SCORES: Record<string, number> = {
  "Emergency Tree Removal": 20,
  "Hillside Brush Clearing": 20,
  "Stump Grinding & Root Removal": 15,
  "Precision Trimming & Pruning": 10,
  "Palm Tree Skinning": 10,
  "Arborist Consultation": 5,
  "Other": 0,
};

/** The table's own midpoint — a neutral placeholder, not a guess at a real value. */
const NEUTRAL_SERVICE_TYPE_SCORE = 10;

function scoreUrgency(urgency: string): number {
  return URGENCY_SCORES[urgency] ?? 0;
}

function scoreServiceType(serviceType: string): number {
  return TREE_SERVICE_TYPE_SCORES[serviceType] ?? NEUTRAL_SERVICE_TYPE_SCORE;
}

function scoreDataCompleteness(lead: Partial<LeadInsert>): number {
  let score = 0;
  if (lead.email) score += 10;
  const descLen = (lead.description ?? "").length;
  if (descLen >= 50) score += 10;
  else if (descLen >= 20) score += 5;
  return score;
}

function scoreSourceQuality(lead: Partial<LeadInsert>): number {
  if (lead.gclid) return 5; // paid search
  if (!lead.utm_source) return 10; // direct / organic
  return 0;
}

export function scoreLead(lead: Partial<LeadInsert>): number {
  return (
    scoreUrgency(lead.urgency || "") +
    scoreServiceType(lead.service_type || "") +
    scoreDataCompleteness(lead) +
    scoreSourceQuality(lead)
  );
}
