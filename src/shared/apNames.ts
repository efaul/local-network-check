/**
 * Resolves a BSSID to a user-configured friendly name (config `apNames`),
 * so the dashboard can show "Living Room Mesh" instead of a MAC address
 * wherever an AP is displayed. Matching is case-insensitive since BSSIDs
 * arrive lowercased from the probe but config might not be.
 */
export function resolveApName(apNames: Readonly<Record<string, string>>, bssid: string | null): string | null {
  if (bssid === null) return null;
  return apNames[bssid.toLowerCase()] ?? null;
}
