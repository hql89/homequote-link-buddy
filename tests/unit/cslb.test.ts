import { describe, it, expect } from "vitest";
import {
  parseCsv,
  mapHeaders,
  normaliseClassification,
  verticalFromClassifications,
  isActiveLicense,
  isExpired,
  parseCslbCsv,
} from "../../src/lib/cslb";

const CITIES = ["Sherman Oaks", "Encino", "Studio City", "Tarzana", "Valley Village", "Toluca Lake"];

/** The header row of the real CSLB statewide export, verbatim. */
const REAL_HEADER =
  "LicenseNo,LastUpdate,BusinessName,BUS-NAME-2,FullBusinessName,MailingAddress,City,State,County,ZIPCode," +
  "country,BusinessPhone,BusinessType,IssueDate,ReissueDate,ExpirationDate,InactivationDate,ReactivationDate," +
  "PendingSuspension,PendingClassRemoval,PendingClassReplace,PrimaryStatus,SecondaryStatus,Classifications(s)," +
  "AsbestosReg,WorkersCompCoverageType";

/** Builds a row matching REAL_HEADER's column count with the fields we care about filled in. */
function realRow(o: {
  license: string; name: string; city: string; phone: string;
  status: string; classification: string; expires?: string;
}): string {
  const cols = new Array(REAL_HEADER.split(",").length).fill("");
  cols[0] = o.license;
  cols[2] = o.name;
  cols[6] = o.city;
  cols[11] = o.phone;
  cols[15] = o.expires ?? "01/31/2099";
  cols[21] = o.status;
  cols[23] = o.classification;
  return cols.join(",");
}

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('name,city\n"Smith, Roy & Sons",Encino')).toEqual([
      ["name", "city"],
      ["Smith, Roy & Sons", "Encino"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('name\n"The ""Big"" Tree Co"')).toEqual([["name"], ['The "Big" Tree Co']]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('name,addr\n"A Co","1 Main\nSte 2"')).toEqual([
      ["name", "addr"],
      ["A Co", "1 Main\nSte 2"],
    ]);
  });

  it("tolerates CRLF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("strips the BOM Excel exports prepend, which would corrupt the first header", () => {
    const [header] = parseCsv("﻿LicenseNo,City\n123,Encino");
    expect(header[0]).toBe("LicenseNo");
  });

  it("drops entirely blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("classification mapping", () => {
  it("normalises punctuation and case", () => {
    expect(normaliseClassification("c-36")).toBe("C36");
    expect(normaliseClassification(" C 20 ")).toBe("C20");
  });

  it("maps each category we actually list", () => {
    expect(verticalFromClassifications("D49")).toBe("tree-service");
    expect(verticalFromClassifications("C-27")).toBe("landscaping");
    expect(verticalFromClassifications("C36")).toBe("plumbing");
    expect(verticalFromClassifications("C-20")).toBe("hvac");
    expect(verticalFromClassifications("C10")).toBe("electrical");
  });

  it("finds the mappable code among several", () => {
    // Tree service is a C-61 limited specialty and often appears this way.
    expect(verticalFromClassifications("C61/D49")).toBe("tree-service");
    expect(verticalFromClassifications("B C36")).toBe("plumbing");
  });

  it("returns null for classifications we deliberately don't cover", () => {
    // General Building / General Engineering are far too broad to file under
    // one directory category.
    expect(verticalFromClassifications("B")).toBeNull();
    expect(verticalFromClassifications("A")).toBeNull();
    expect(verticalFromClassifications("")).toBeNull();
    expect(verticalFromClassifications(null)).toBeNull();
  });
});

describe("isActiveLicense", () => {
  it("accepts CLEAR, which is what the real export uses for good standing", () => {
    expect(isActiveLicense("CLEAR")).toBe(true);
    expect(isActiveLicense(" clear ")).toBe(true);
  });

  it("still accepts ACTIVE, used by other CSLB export formats", () => {
    expect(isActiveLicense("ACTIVE")).toBe(true);
    expect(isActiveLicense(" active ")).toBe(true);
  });

  it("rejects every suspension status seen in the real statewide export", () => {
    for (const s of [
      "Contr Bond Susp",
      "SOS Suspension",
      "Work Comp Susp",
      "Liab Ins Susp",
      "Susp - No Qualifier",
      "EMP/WK Bnd Susp",
      "BND Pay EN Susp",
      "O/L Entity Susp",
      "Out Liab Susp",
      "BOND Pay Susp",
    ]) {
      expect(isActiveLicense(s)).toBe(false);
    }
  });

  it("rejects expired and empty", () => {
    expect(isActiveLicense("EXPIRED")).toBe(false);
    expect(isActiveLicense(null)).toBe(false);
    expect(isActiveLicense("")).toBe(false);
  });
});

describe("isExpired", () => {
  const now = new Date(2026, 6, 26); // 2026-07-26

  it("treats a past MM/DD/YYYY date as expired", () => {
    expect(isExpired("01/31/2025", now)).toBe(true);
  });

  it("treats a future date as not expired", () => {
    expect(isExpired("01/31/2027", now)).toBe(false);
  });

  it("treats an unparseable or missing date as not expired, so a format change cannot silently drop every row", () => {
    expect(isExpired("", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired("2027-01-31", now)).toBe(false);
  });
});

describe("mapHeaders", () => {
  it("matches known aliases regardless of spacing or case", () => {
    const idx = mapHeaders(["License No", "Business DBA", "City", "Telephone", "Classifications", "Primary Status"]);
    expect(idx.license_number).toBe(0);
    expect(idx.business_name).toBe(1);
    expect(idx.city).toBe(2);
    expect(idx.phone).toBe(3);
    expect(idx.classification).toBe(4);
    expect(idx.status).toBe(5);
  });

  it("ignores columns it doesn't recognise", () => {
    expect(mapHeaders(["Bond Amount", "County Code"])).toEqual({});
  });

  // Regression: the real header is "Classifications(s)". headerKey() strips the
  // parentheses, yielding "classificationss" — which was missing from the alias
  // list, so classification silently resolved to nothing for every single row
  // and the whole statewide file filtered down to zero candidates.
  it("maps the real statewide export header row", () => {
    const idx = mapHeaders(REAL_HEADER.split(","));
    expect(idx.license_number).toBe(0);   // LicenseNo
    expect(idx.business_name).toBe(2);    // BusinessName
    expect(idx.city).toBe(6);             // City
    expect(idx.phone).toBe(11);           // BusinessPhone
    expect(idx.status).toBe(21);          // PrimaryStatus
    expect(idx.classification).toBe(23);  // Classifications(s)
    expect(idx.expires).toBe(15);         // ExpirationDate
  });

  it("does not mistake BUS-NAME-2 or FullBusinessName for the business name", () => {
    const idx = mapHeaders(REAL_HEADER.split(","));
    expect(idx.business_name).not.toBe(3);
    expect(idx.business_name).not.toBe(4);
  });
});

describe("parseCslbCsv", () => {
  const HEADER = "LicenseNo,BusinessDBA,City,Telephone,Classifications,PrimaryStatus";

  it("accepts a well-formed active in-area row", () => {
    const csv = `${HEADER}\n900001,Valley Tree Co,Encino,(818) 555-0142,C61/D49,ACTIVE`;
    const { candidates, totalRows } = parseCslbCsv(csv, CITIES);
    expect(totalRows).toBe(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      license_number: "900001",
      business_name: "Valley Tree Co",
      city: "Encino",
      phone: "+18185550142",
      vertical_slug: "tree-service",
    });
  });

  it("normalises the phone to E.164 and rejects unusable ones", () => {
    const csv =
      `${HEADER}\n` +
      `900002,Good Phone Co,Tarzana,818-555-0143,C36,ACTIVE\n` +
      `900003,Bad Phone Co,Tarzana,555-01,C36,ACTIVE`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].phone).toBe("+18185550143");
    // A listing whose whole value is click-to-call is useless without a number.
    expect(rejected["no usable phone number"]).toBe(1);
  });

  it("filters out cities outside the coverage area", () => {
    const csv = `${HEADER}\n900004,Far Away Co,Bakersfield,8185550144,C36,ACTIVE`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(rejected["outside coverage area"]).toBe(1);
  });

  it("filters out non-active licences", () => {
    const csv = `${HEADER}\n900005,Lapsed Co,Encino,8185550145,C36,EXPIRED`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(rejected["licence not active"]).toBe(1);
  });

  it("filters out classifications we don't list", () => {
    const csv = `${HEADER}\n900006,General Builder,Encino,8185550146,B,ACTIVE`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(rejected["classification not in our categories"]).toBe(1);
  });

  it("de-duplicates repeated licence numbers within one file", () => {
    const csv =
      `${HEADER}\n` +
      `900007,Dupe Co,Encino,8185550147,C36,ACTIVE\n` +
      `900007,Dupe Co Again,Encino,8185550147,C36,ACTIVE`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(1);
    expect(rejected["duplicate within file"]).toBe(1);
  });

  it("matches city case-insensitively but stores our canonical spelling", () => {
    const csv = `${HEADER}\n900008,Case Co,sherman oaks,8185550148,C20,ACTIVE`;
    const { candidates } = parseCslbCsv(csv, CITIES);
    expect(candidates[0].city).toBe("Sherman Oaks");
  });

  it("keeps the original row for audit but drops empty columns", () => {
    const csv = `${HEADER},BondAmount\n900009,Audit Co,Encino,8185550149,C36,ACTIVE,`;
    const { candidates } = parseCslbCsv(csv, CITIES);
    expect(candidates[0].raw.BusinessDBA).toBe("Audit Co");
    expect(candidates[0].raw.BondAmount).toBeUndefined();
  });

  it("returns nothing for an empty or header-only file", () => {
    expect(parseCslbCsv("", CITIES).candidates).toHaveLength(0);
    expect(parseCslbCsv(HEADER, CITIES).candidates).toHaveLength(0);
  });
});

/**
 * These run against the real statewide export's exact shape. The first upload of
 * the real file produced zero candidates out of 244,507 rows because of two
 * mismatches these lock down: PrimaryStatus is "CLEAR" (not "ACTIVE"), and the
 * classification column is headed "Classifications(s)".
 */
describe("parseCslbCsv — real statewide export shape", () => {
  it("accepts a CLEAR licence in a covered city", () => {
    const csv = `${REAL_HEADER}\n${realRow({
      license: "1000010", name: "VALLEY PLUMBING CO", city: "ENCINO",
      phone: "(818) 555 0142", status: "CLEAR", classification: "C36",
    })}`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(rejected).toEqual({});
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      license_number: "1000010",
      business_name: "VALLEY PLUMBING CO",
      city: "Encino",
      phone: "+18185550142",
      vertical_slug: "plumbing",
    });
  });

  it("rejects a suspended licence in a covered city", () => {
    const csv = `${REAL_HEADER}\n${realRow({
      license: "1000011", name: "SUSPENDED PLUMBING", city: "TARZANA",
      phone: "(818) 555 0143", status: "Work Comp Susp", classification: "C36",
    })}`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(rejected["licence not active"]).toBe(1);
  });

  it("rejects a CLEAR licence whose expiration date has passed", () => {
    const csv = `${REAL_HEADER}\n${realRow({
      license: "1000012", name: "LAPSED HVAC", city: "TARZANA",
      phone: "(818) 555 0144", status: "CLEAR", classification: "C20",
      expires: "01/31/2020",
    })}`;
    const { candidates, rejected } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(rejected["licence expired"]).toBe(1);
  });

  it("maps every classification we list, in the export's hyphenated form", () => {
    const rows = [
      ["1000020", "TREE CO", "D-49", "tree-service"],
      ["1000021", "LANDSCAPE CO", "C-27", "landscaping"],
      ["1000022", "PLUMBING CO", "C-36", "plumbing"],
      ["1000023", "HVAC CO", "C-20", "hvac"],
      ["1000024", "ELECTRIC CO", "C-10", "electrical"],
    ];
    const csv = [
      REAL_HEADER,
      ...rows.map(([license, name, classification]) =>
        realRow({ license, name, city: "ENCINO", phone: "(818) 555 0145", status: "CLEAR", classification }),
      ),
    ].join("\n");

    const { candidates } = parseCslbCsv(csv, CITIES);
    expect(candidates.map((c) => c.vertical_slug)).toEqual(rows.map(([, , , slug]) => slug));
  });

  it("reports the status and classification values it saw, so a zero-candidate run is diagnosable", () => {
    const csv = `${REAL_HEADER}\n${realRow({
      license: "1000030", name: "GENERAL BUILDER", city: "ENCINO",
      phone: "(818) 555 0146", status: "CLEAR", classification: "B",
    })}`;
    const { candidates, statusSample, classificationSample, detectedHeaders } = parseCslbCsv(csv, CITIES);
    expect(candidates).toHaveLength(0);
    expect(statusSample).toContain("CLEAR");
    expect(classificationSample).toContain("B");
    expect(detectedHeaders[23]).toBe("Classifications(s)");
  });
});
