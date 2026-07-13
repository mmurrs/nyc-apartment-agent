import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STATIONS = JSON.parse(
  readFileSync(join(here, "..", "data", "subway-stations.json"), "utf8"),
);
const NEIGHBORHOODS = JSON.parse(
  readFileSync(join(here, "..", "data", "neighborhoods.json"), "utf8"),
);

const GBFS_INFO =
  "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_information.json";
const GBFS_STATUS = "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_status.json";

// Manhattan-ish walking speed: 1 mile in ~20 min, grid penalty baked in via 1.3x.
const WALK_MPH = 3;
const GRID_FACTOR = 1.3;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function walkMinutes(miles) {
  return Math.round(((miles * GRID_FACTOR) / WALK_MPH) * 60);
}

export function nearestSubway(lat, lng, count = 2) {
  const scored = STATIONS.map((s) => ({
    ...s,
    miles: haversineMiles(lat, lng, s.lat, s.lon),
  }));
  scored.sort((a, b) => a.miles - b.miles);
  return scored.slice(0, count).map((s) => ({
    station: s.name,
    routes: s.routes,
    walk_minutes: walkMinutes(s.miles),
  }));
}

export function findNeighborhood(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const n of NEIGHBORHOODS) {
    if (t.includes(n.name.toLowerCase())) return n;
    for (const alias of n.aliases) {
      // Short aliases (ev, les, uws...) must match as whole words or they
      // false-positive inside ordinary text.
      const re =
        alias.length <= 4
          ? new RegExp(`\\b${alias}\\b`, "i")
          : new RegExp(alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i");
      if (re.test(t)) return n;
    }
  }
  return null;
}

export function neighborhoodBySlug(slug) {
  return NEIGHBORHOODS.find((n) => n.slug === slug) ?? null;
}

export function allNeighborhoods() {
  return NEIGHBORHOODS;
}

// Citi Bike GBFS is free and public but heavyweight (~2k stations); cache it.
let bikeCache = { at: 0, stations: null };

export async function citibikeNear(lat, lng, count = 2) {
  const now = Date.now();
  if (!bikeCache.stations || now - bikeCache.at > 5 * 60 * 1000) {
    const [infoRes, statusRes] = await Promise.all([
      fetch(GBFS_INFO, { signal: AbortSignal.timeout(10000) }),
      fetch(GBFS_STATUS, { signal: AbortSignal.timeout(10000) }),
    ]);
    if (!infoRes.ok || !statusRes.ok) throw new Error("gbfs fetch failed");
    const info = await infoRes.json();
    const status = await statusRes.json();
    const byId = new Map(
      status.data.stations.map((s) => [s.station_id, s]),
    );
    bikeCache = {
      at: now,
      stations: info.data.stations.map((s) => ({
        id: s.station_id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        bikes: byId.get(s.station_id)?.num_bikes_available ?? null,
        docks: byId.get(s.station_id)?.num_docks_available ?? null,
      })),
    };
  }
  const scored = bikeCache.stations.map((s) => ({
    ...s,
    miles: haversineMiles(lat, lng, s.lat, s.lon),
  }));
  scored.sort((a, b) => a.miles - b.miles);
  return scored.slice(0, count).map((s) => ({
    station: s.name,
    bikes_available: s.bikes,
    docks_available: s.docks,
    walk_minutes: walkMinutes(s.miles),
  }));
}
