import type { LeadInsert } from "@/types";
import { verticalFromServiceType } from "@/lib/constants";
import type { VerticalKey } from "@/lib/constants";

const URGENCY_SCORES: Record<string, number> = {
  emergency: 40,
  urgent: 25,
  soon: 10,
  flexible: 0,
};

const SERVICE_TYPE_SCORES: Record<VerticalKey, Record<string, number>> = {
  tree_service: {
    // Highest intent: emergencies and large removals. Keys must match
    // VERTICALS.tree_service.serviceTypes in lib/constants.ts.
    "Emergency Tree Removal": 20,
    "Hillside Brush Clearing": 20,
    "Stump Grinding & Root Removal": 15,
    "Precision Trimming & Pruning": 10,
    "Palm Tree Skinning": 10,
    "Arborist Consultation": 5,
    "Other": 0,
  },
};

function scoreUrgency(urgency: string): number {
  return URGENCY_SCORES[urgency] ?? 0;
}

function scoreServiceType(serviceType: string, vertical?: string): number {
  const vKey = vertical as VerticalKey || verticalFromServiceType(serviceType);
  const scores = SERVICE_TYPE_SCORES[vKey] ?? SERVICE_TYPE_SCORES.tree_service;
  return scores[serviceType] ?? 0;
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
    scoreServiceType(lead.service_type || "", lead.vertical) +
    scoreDataCompleteness(lead) +
    scoreSourceQuality(lead)
  );
}
