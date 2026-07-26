/**
 * CSLB (California Contractors State License Board) import helpers.
 *
 * The statewide licence file is far too large to hand to an edge function, so
 * parsing and filtering happen here in the browser and only matching candidate
 * rows are uploaded. The edge function re-validates whatever it receives.
 *
 * Record layout reference:
 * https://www.cslb.ca.gov/Resources/FormsAndApplications/Public_Sales_Record_Layout.pdf
 */

/**
 * CSLB classification code → our `verticals.slug`.
 *
 * Deliberately narrow. General Building (B) and General Engineering (A) cover
 * far too much to file under a single directory category, so they're excluded
 * rather than guessed at.
 */
export const CLASSIFICATION_TO_VERTICAL: Record<string, string> = {
  D49: "tree-service",   // Tree Service (a C-61 limited specialty)
  C27: "landscaping",    // Landscaping
  C36: "plumbing",       // Plumbing
  C20: "hvac",           // Warm-Air Heating, Ventilating & Air-Conditioning
  C10: "electrical",     // Electrical
};

/** Strips punctuation/whitespace so "C-36", "c36" and " C36 " all match. */
export function normaliseClassification(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A CSLB row can carry several classifications ("C36 C20", "C-61/D-49").
 * Returns the first that maps to one of our categories.
 */
export function verticalFromClassifications(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const token of String(raw).split(/[\s,/|;]+/)) {
    const code = normaliseClassification(token);
    if (code && CLASSIFICATION_TO_VERTICAL[code]) return CLASSIFICATION_TO_VERTICAL[code];
  }
  return null;
}

/** CSLB uses a variety of status strings; only currently-active licences qualify. */
export function isActiveLicense(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toUpperCase() === "ACTIVE";
}

/**
 * Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas and
 * newlines, and doubled quotes. Written rather than pulled in as a dependency
 * because it's the only CSV this project reads.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM, which Excel exports include and which would otherwise
  // corrupt the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }

  // Trailing field/row when the file doesn't end in a newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Header aliases, since CSLB exports vary between the portal and the sales file. */
const HEADER_ALIASES: Record<string, string[]> = {
  license_number: ["licensenumber", "licenseno", "license", "licno", "lic"],
  business_name: ["businessname", "dba", "businessdba", "name", "businessnamedba"],
  city: ["city", "mailingcity", "businesscity"],
  state: ["state", "mailingstate"],
  phone: ["telephone", "phone", "businessphone", "phonenumber"],
  classification: ["classification", "classifications", "class", "classcodes", "licensetype"],
  status: ["primarystatus", "licensestatus", "status"],
  expires: ["expirationdate", "expiration", "expiresdate", "expdate"],
};

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Maps a CSV header row to our field names; unknown columns are ignored. */
export function mapHeaders(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = headerKey(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (index[field] === undefined && aliases.includes(key)) index[field] = i;
    }
  });
  return index;
}

export interface CslbCandidate {
  license_number: string;
  business_name: string;
  city: string;
  phone: string;
  classification: string;
  vertical_slug: string;
  raw: Record<string, string>;
}

export interface CslbParseResult {
  candidates: CslbCandidate[];
  /** Counts by reason, so the UI can explain what was dropped and why. */
  rejected: Record<string, number>;
  totalRows: number;
  /** First few unique status values found — for diagnosing status filter mismatches. */
  statusSample: string[];
  /** Column headers detected from the file — for diagnosing mapping issues. */
  detectedHeaders: string[];
}

function bump(counts: Record<string, number>, reason: string) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

/** US phone digits → E.164, or null when it can't be trusted. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Parses a CSLB export into ingest candidates.
 *
 * Filters applied here (all re-checked server-side):
 *  - city must be one of the configured directory cities
 *  - licence must be ACTIVE
 *  - classification must map to one of our categories
 *  - a usable phone is required: a listing whose entire value is click-to-call
 *    is worthless without one
 */
export function parseCslbCsv(text: string, allowedCities: string[]): CslbParseResult {
  const rows = parseCsv(text);
  const rejected: Record<string, number> = {};
  const detectedHeaders = rows[0] ?? [];
  if (rows.length < 2) return { candidates: [], rejected, totalRows: 0, statusSample: [], detectedHeaders };

  const idx = mapHeaders(rows[0]);
  const cityLookup = new Map(allowedCities.map((c) => [c.trim().toLowerCase(), c]));
  const seen = new Set<string>();
  const candidates: CslbCandidate[] = [];
  const statusValues = new Set<string>();

  const get = (row: string[], field: string): string =>
    idx[field] === undefined ? "" : (row[idx[field]] ?? "").trim();

  for (const row of rows.slice(1)) {
    const city = cityLookup.get(get(row, "city").toLowerCase());
    if (!city) { bump(rejected, "outside coverage area"); continue; }

    const statusRaw = get(row, "status");
    if (statusValues.size < 20) statusValues.add(statusRaw || "(empty)");
    if (!isActiveLicense(statusRaw)) { bump(rejected, "licence not active"); continue; }

    const classification = get(row, "classification");
    const vertical = verticalFromClassifications(classification);
    if (!vertical) { bump(rejected, "classification not in our categories"); continue; }

    const phone = toE164(get(row, "phone"));
    if (!phone) { bump(rejected, "no usable phone number"); continue; }

    const name = get(row, "business_name");
    if (!name) { bump(rejected, "no business name"); continue; }

    const license = get(row, "license_number");
    if (!license) { bump(rejected, "no licence number"); continue; }
    if (seen.has(license)) { bump(rejected, "duplicate within file"); continue; }
    seen.add(license);

    // Keep the original row for audit, minus empty columns.
    const raw: Record<string, string> = {};
    rows[0].forEach((h, i) => {
      const v = (row[i] ?? "").trim();
      if (v) raw[h.trim()] = v;
    });

    candidates.push({
      license_number: license,
      business_name: name,
      city,
      phone,
      classification,
      vertical_slug: vertical,
      raw,
    });
  }

  return { candidates, rejected, totalRows: rows.length - 1, statusSample: [...statusValues], detectedHeaders };
}
