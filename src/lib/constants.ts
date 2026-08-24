export const SITE_URL = "https://homequotelink.com";

/**
 * Master brand. Deliberately regional and neutral: the site is a directory of
 * independent Valley businesses, not a business itself. The old
 * "Sherman Oaks Home Pros" name scoped us to one neighbourhood (contractors in
 * Tarzana or Encino won't join a directory named after a city they don't
 * serve), and the "HomeQuoteLink" wordmark read as a lead broker — the exact
 * thing a defensive contractor screens out. The domain is unchanged; brand and
 * domain do not have to match.
 */
export const SITE_NAME = "Valley Home Pros";
export const SITE_REGION = "San Fernando Valley";

/**
 * The Valley matching hotline. This is OUR number and it belongs only on pages
 * we own — the homepage, city/category indexes, and our own SEO guides. It must
 * never appear on a business's own listing page, where it would compete for a
 * call meant for them. See the Header `variant` prop.
 */
export const SITE_PHONE = "(310) 861-3314";
export const SITE_PHONE_E164 = "+13108613314";

/** Nests a local page title under the master brand: "Encino Tree Service | Valley Home Pros". */
export function pageTitle(local: string): string {
  return `${local} | ${SITE_NAME}`;
}
export const OG_IMAGE = "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eeda3ab0-0240-43cf-bfec-33f9c0132fc2/id-preview-1ad2cd53--2be06244-1b45-4531-bf8f-a430691ac172.lovable.app-1772304743071.png";

export const SFV_CITIES = [
  "Sherman Oaks",
  "Encino",
  "Studio City",
  "Tarzana",
  "Valley Village",
  "Toluca Lake",
  "Other / Outside SFV",
] as const;

/**
 * Real cities only — drops the "Other / Outside SFV" catch-all, which is a
 * lead-form option and not somewhere a directory page can exist for.
 */
export const SFV_DIRECTORY_CITIES = SFV_CITIES.filter((c) => !c.startsWith("Other"));

export const URGENCY_LEVELS = [
  { value: "emergency", label: "Emergency — Need help now" },
  { value: "urgent", label: "Urgent — Within 24 hours" },
  { value: "soon", label: "Soon — This week" },
  { value: "flexible", label: "Flexible — Just getting quotes" },
] as const;

export const LEAD_STATUSES = [
  "new",
  "duplicate",
  "pending_review",
  "routed",
  "accepted",
  "rejected",
  "sold",
  "refunded",
  "archived",
  "spam",
] as const;

export const CONTACT_METHODS = [
  { value: "call", label: "Phone Call" },
  { value: "text", label: "Text Message" },
  { value: "email", label: "Email" },
] as const;
