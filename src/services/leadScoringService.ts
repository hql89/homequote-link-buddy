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
  plumbing: {
    "Sewer Line": 20,
    "Repiping": 20,
    "Water Heater": 15,
    "Leak Detection": 15,
    "Emergency Plumbing": 15,
    "Drain Cleaning": 5,
    "Fixture Installation": 5,
    "General Plumbing": 5,
    "Other": 0,
  },
  hvac: {
    "AC Installation": 20,
    "Furnace Installation": 20,
    "Heat Pump": 15,
    "AC Repair": 15,
    "Furnace Repair": 15,
    "Emergency HVAC": 15,
    "Duct Cleaning": 5,
    "Thermostat Installation": 5,
    "Other": 0,
  },
  landscaping: {
    "Landscape Design": 20,
    "Hardscaping": 20,
    "Sprinkler Systems": 15,
    "Fence Installation": 15,
    "Tree Trimming": 10,
    "Lawn Care": 5,
    "Garden Maintenance": 5,
    "Other": 0,
  },
  electrical: {
    "Panel Upgrade": 20,
    "EV Charger Install": 20,
    "Emergency Electrical": 15,
    "Lighting Installation": 10,
    "Outlet & Switch Install": 5,
    "Ceiling Fan Install": 5,
    "General Electrical": 5,
    "Other": 0,
  },
};

function scoreUrgency(urgency: string): number {
  return URGENCY_SCORES[urgency] ?? 0;
}

function scoreServiceType(serviceType: string, vertical?: string): number {
  const vKey = vertical as VerticalKey || verticalFromServiceType(serviceType);
  const scores = SERVICE_TYPE_SCORES[vKey] ?? SERVICE_TYPE_SCORES.plumbing;
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
