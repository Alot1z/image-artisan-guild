// Region helper — picks a Region from a lat/lon and returns the engine IDs
// the Inquisitor should auto-suggest when EXIF reveals a place of origin.
//
// We intentionally keep the rules coarse (continent-level) so the auto-hint
// is helpful without being annoying: the user can always untick a suggestion.

import type { Region } from "@/lib/engines";
import type { GeoPoint } from "@/lib/exif";

/** Pick a region from a lat/lon. We use country-level soft-edges so cities
 *  near national borders still get the more specialized engine hint. */
export function regionFromGeo(point: GeoPoint): Region {
  const { lat, lon } = point;

  // East Asia bounding boxes (rough)
  if (lat >= 18 && lat <= 53 && lon >= 95 && lon <= 145) {
    // Russia Far East (Vladivostok, Khabarovsk) — Russian engines still dominate
    if (lon >= 130 && lat < 50) return "russia";
    // Korea / Japan / Taiwan / Hong Kong regions
    if (lon <= 145 && lat <= 50 && lon >= 120) return "east-asia";
    // Mainland China + Mongolia
    if (lon <= 122) return "east-asia";
    return "east-asia";
  }

  // South & SE Asia route to global (no major regional RIS engines there yet).
  if (lat >= -10 && lat <= 35 && lon >= 65 && lon <= 145) return "global";

  // Russia & CIS
  if (lat >= 41 && lat <= 75 && lon >= 27 && lon <= 180) return "russia";

  // Middle East & North Africa
  if (lat >= 0 && lat <= 42 && lon >= -18 && lon <= 60) {
    // North Africa shares more with EU engines; Arabian peninsula with global.
    return "mena";
  }

  // Europe
  if (lat >= 35 && lat <= 71 && lon >= -12 && lon <= 40) return "europe";

  // Americas
  if (lat >= -55 && lat <= 72 && lon >= -170 && lon <= -30) return "americas";

  return "global";
}

/** Returns the engine IDs the Inventor should pre-tick when EXIF contains
 *  GPS coordinates pointing to the given region. Only engines whose region
 *  matches (or that explicitly target that area with their default locale). */
export function suggestedEngineIds(point: GeoPoint | null): string[] {
  if (!point) return [];
  const region = regionFromGeo(point);
  switch (region) {
    case "east-asia":
      return ["baidu", "sogou", "naver", "qihoo", "saucenao", "ascii2d", "trace"];
    case "russia":
      return ["yandex", "yandex-rvc", "mailru", "findclone", "search4faces"];
    case "europe":
      return ["ecosia"];
    case "americas":
      return [];
    case "mena":
      return [];
    case "global":
      return [];
    default:
      return [];
  }
}

/** "Reverse-decode" a lat/lon into a coarse country label, for the UI. */
export function commonNameForGeo(point: GeoPoint): string {
  const { lat, lon } = point;
  // Imprecise but useful — pinned to well-known regions.
  if (lat >= 30 && lat <= 38 && lon >= 118 && lon <= 122) return "China (coast)";
  if (lat >= 33 && lat <= 43 && lon >= 73 && lon <= 96) return "Xinjiang";
  if (lat >= 35 && lat <= 46 && lon >= 125 && lon <= 130) return "Korea";
  if (lat >= 30 && lat <= 46 && lon >= 130 && lon <= 146) return "Japan";
  if (lat >= 21 && lat <= 26 && lon >= 119 && lon <= 122) return "Taiwan";
  if (lat >= 55 && lat <= 70 && lon >= 60 && lon <= 110) return "Russia (Siberia)";
  if (lat >= 41 && lat <= 55 && lon >= 27 && lon <= 50) return "Russia (European)";
  if (lat >= 35 && lat <= 71 && lon >= -10 && lon <= 30) return "Europe";
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -65) return "United States";
  if (lat >= -35 && lat <= 5 && lon >= -75 && lon <= -35) return "South America";
  if (lat >= 5 && lat <= 35 && lon >= -10 && lon <= 50) return "Africa";
  return "Unknown";
}
