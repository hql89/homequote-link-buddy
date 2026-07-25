/**
 * Maps San Fernando Valley ZIP codes to city names matching SFV_CITIES.
 *
 * This previously held Santa Clarita Valley ZIPs (91350–91390), left over from
 * before the SFV pivot. Because `cityFromZip` returns null on a miss and the
 * caller only autofills on a hit, every Valley homeowner typing a real ZIP got
 * no city autofill and the failure was completely silent.
 */
export const ZIP_TO_CITY: Record<string, string> = {
  // Sherman Oaks
  "91403": "Sherman Oaks",
  "91423": "Sherman Oaks",
  "91413": "Sherman Oaks",
  "91495": "Sherman Oaks",
  // Encino
  "91316": "Encino",
  "91426": "Encino",
  "91436": "Encino",
  // Studio City
  "91604": "Studio City",
  "91614": "Studio City",
  // Tarzana
  "91356": "Tarzana",
  "91357": "Tarzana",
  // Valley Village
  "91607": "Valley Village",
  "91617": "Valley Village",
  // Toluca Lake
  "91602": "Toluca Lake",
  "91610": "Toluca Lake",
};

export function cityFromZip(zip: string): string | null {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  return ZIP_TO_CITY[clean] || null;
}
