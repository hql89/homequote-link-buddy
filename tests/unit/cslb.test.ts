import { describe, it, expect } from "vitest";
import {
  parseCsv,
  mapHeaders,
  normaliseClassification,
  verticalFromClassifications,
  isActiveLicense,
  parseCslbCsv,
} from "../../src/lib/cslb";

const CITIES = ["Sherman Oaks", "Encino", "Studio City", "Tarzana", "Valley Village", "Toluca Lake"];

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
  it("accepts only ACTIVE", () => {
    expect(isActiveLicense("ACTIVE")).toBe(true);
    expect(isActiveLicense(" active ")).toBe(true);
    expect(isActiveLicense("EXPIRED")).toBe(false);
    expect(isActiveLicense("SUSPENDED")).toBe(false);
    expect(isActiveLicense(null)).toBe(false);
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
