// Vercel serverless function to fetch nearby restaurants from Google Places Nearby Search API
// with:
// 1) Pure Veg only mode (best-effort filter)
// 2) Popularity weighting (rating × log(1+reviews) + distance bonus)
// 3) In-memory caching (best-effort on Vercel serverless)
// 4) "Try something nearby & famous" discovery mode
//
// Env required:
//   GOOGLE_MAPS_API_KEY (server key)
//
// Query params:
//   lat, lng            (required)
//   radiusKm            (optional, default 5, 1–20)
//   maxResults          (optional, default 12, 1–20)
//   cuisines            (optional, comma-separated)
//   pureVeg             (optional, "1"|"true" enables pure veg preference + filter)
//   discoveryMode       (optional) "balanced" (default) | "famous"
//
// Notes:
// - Nearby Search does not guarantee "pure veg" classification, so pureVeg is best-effort.
// - Cache is process-memory; may reset between invocations.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _cache = globalThis.__placesCache || (globalThis.__placesCache = new Map());

function nowMs() { return Date.now(); }

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function parseBool(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function deg2rad(d) { return d * Math.PI / 180; }
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = deg2rad(bLat - aLat);
  const dLng = deg2rad(bLng - aLng);
  const lat1 = deg2rad(aLat);
  const lat2 = deg2rad(bLat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function popularityScore({ rating, userRatingsTotal, distanceKm, mode }) {
  const r = typeof rating === "number" ? rating : 0;
  const n = typeof userRatingsTotal === "number" ? userRatingsTotal : 0;

  // Popularity term: rating × log(1+reviews)
  const pop = r * Math.log1p(n);

  // Distance bonus: closer is better. (cap to avoid huge swings)
  const d = typeof distanceKm === "number" ? distanceKm : 999;
  const distBonus = Math.max(0, 6 - Math.min(6, d)); // 0..6

  // Famous mode weights popularity harder; balanced considers distance more.
  if (mode === "famous") return pop * 1.35 + distBonus * 0.6;
  return pop * 1.0 + distBonus * 1.1;
}

// Cuisine groups (Indian-focused expansion)
const CUISINE_GROUPS = {
  "South Indian": ["South Indian", "Udupi", "Udipi", "Andhra", "Tamil", "Kerala"],
  "North Indian": ["North Indian", "Punjabi", "Mughlai", "Tandoor", "Dhaba"],
  "Maharashtrian": ["Maharashtrian", "Malvani", "Kolhapuri", "Puneri", "Varhadi", "Khandeshi"],
  "Street food": ["Street food", "Chaat", "Snacks", "Vada pav", "Misal", "Bhel"],
  "Seafood": ["Seafood", "Coastal", "Fish", "Surmai", "Prawn"],
  "Vegetarian": ["Vegetarian", "Pure Veg"],
};

// Best-effort pure veg signals
function isPureVegCandidate(place) {
  const name = String(place.name || "").toLowerCase();
  const types = Array.isArray(place.types) ? place.types.map(t => String(t).toLowerCase()) : [];
  const vicinity = String(place.vicinity || "").toLowerCase();

  const vegHints = ["pure veg", "veg only", "vegetarian", "shuddh", "udupi", "udipi"];
  const hasHint =
    vegHints.some(h => name.includes(h) || vicinity.includes(h));

  // Sometimes Google returns "vegetarian_restaurant"
  const typeHint = types.includes("vegetarian_restaurant");
  return hasHint || typeHint;
}

async function fetchNearby({ key, lat, lng, radiusMeters, keyword }) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("type", "restaurant");
  if (keyword) url.searchParams.set("keyword", keyword);
  url.searchParams.set("key", key);

  const resp = await fetch(url.toString());
  const text = await resp.text();
  if (!resp.ok) return { ok: false, status: resp.status, text };

  try {
    const json = JSON.parse(text);
    return { ok: true, json };
  } catch {
    return { ok: false, status: 502, text };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY" });

  try {
    const {
      lat, lng,
      radiusKm = "5",
      maxResults = "12",
      cuisines = "",
      pureVeg = "0",
      discoveryMode = "balanced",
    } = req.query || {};

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const radius = clamp(parseFloat(radiusKm) || 5, 1, 20);
    const max = clamp(parseInt(maxResults, 10) || 12, 1, 20);
    const radiusMeters = Math.round(radius * 1000);

    const isPureVeg = parseBool(pureVeg);
    const mode = (String(discoveryMode || "balanced").toLowerCase() === "famous") ? "famous" : "balanced";

    const rawCuisines = String(cuisines || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // Expand cuisines into keyword list (Indian cuisine groups)
    const keywordSet = new Set();
    for (const c of rawCuisines) {
      if (CUISINE_GROUPS[c]) CUISINE_GROUPS[c].forEach(k => keywordSet.add(k));
      else keywordSet.add(c);
    }

    // Discovery mode "famous" can broaden if no cuisines selected
    // (or even if selected, it will still use keywords but ranking favors popularity)
    const keywords = Array.from(keywordSet);

    // Cache key includes all effective inputs
    const cacheKey = JSON.stringify({
      lat: latitude.toFixed(5),
      lng: longitude.toFixed(5),
      radius,
      max,
      keywords,
      isPureVeg,
      mode,
    });

    const cached = _cache.get(cacheKey);
    if (cached && (nowMs() - cached.ts) < CACHE_TTL_MS) {
      return res.status(200).json(cached.data);
    }

    // Build the list of Nearby queries to run.
    // Keep API calls bounded: max 8 keyword calls, plus 1 broad call if needed.
    let queries = [];
    if (keywords.length) {
      // Use keyword-specific queries (more relevant)
      queries = keywords.slice(0, 8).map(k => {
        // Pure veg: nudge keyword for veg cuisines
        const kw = isPureVeg ? `${k} pure veg restaurant` : `${k} restaurant`;
        return { keyword: kw };
      });
    } else {
      // No cuisines: run a broad query. In famous mode, add an extra "popular" nudge.
      queries = [{ keyword: isPureVeg ? "pure veg restaurant" : undefined }];
      if (mode === "famous") {
        queries.push({ keyword: isPureVeg ? "famous pure veg restaurant" : "famous restaurant" });
      }
    }

    // Fetch all and merge
    const fetched = await Promise.all(
      queries.map(q => fetchNearby({
        key: GOOGLE_KEY,
        lat: latitude,
        lng: longitude,
        radiusMeters,
        keyword: q.keyword
      }))
    );

    let merged = [];
    for (const r of fetched) {
      if (!r || !r.ok) continue;
      const data = r.json;

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        // Ignore an individual query failure; continue
        continue;
      }
      if (Array.isArray(data.results)) merged.push(...data.results);
    }

    // Dedupe by place_id
    const byId = new Map();
    for (const p of merged) {
      const id = p.place_id;
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, p);
    }

    // Convert, compute distance, compute score
    let places = Array.from(byId.values()).map(p => {
      const coords = p.geometry?.location
        ? { lat: p.geometry.location.lat, lng: p.geometry.location.lng }
        : null;

      const distanceKm = coords
        ? haversineKm(latitude, longitude, coords.lat, coords.lng)
        : null;

      return {
        id: p.place_id,
        name: p.name,
        area: p.vicinity || "",
        city: "",
        coords,
        rating: p.rating,
        userRatingsTotal: p.user_ratings_total,
        priceLevel: p.price_level,
        types: p.types || [],
        distanceKm,
        _score: popularityScore({
          rating: p.rating,
          userRatingsTotal: p.user_ratings_total,
          distanceKm,
          mode
        }),
      };
    });

    // Pure veg filter (best-effort)
    if (isPureVeg) {
      places = places.filter(isPureVegCandidate);
      // If pure-veg filter becomes too strict, relax slightly by allowing top-rated veg-ish results
      // (Still best-effort; keep it strict by default)
    }

    // Sort by score desc, then distance asc as tie-breaker
    places.sort((a, b) => {
      const ds = (b._score || 0) - (a._score || 0);
      if (Math.abs(ds) > 1e-9) return ds;
      const da = (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
      return da;
    });

    // Cap results
    const out = places.slice(0, max).map(p => {
      const { _score, ...rest } = p;
      return rest;
    });

    const payload = { places: out };

    _cache.set(cacheKey, { ts: nowMs(), data: payload });

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[api/places] error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
