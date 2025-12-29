// api/places.js
// Vercel serverless function to fetch nearby places from Google Places API (Nearby Search).
// Adds:
// - Server-side in-memory cache (best-effort; helps on warm lambdas)
// - "open now" support (opennow=true)
// - Meal-aware keyword support (breakfast/lunch/snack/dinner)
// - Cuisine-aware keyword expansion (including grouped Indian cuisines)
// - Basic filtering signals returned (rating, userRatingsTotal, openNow)
//
// Requires env var: GOOGLE_MAPS_API_KEY
//
// Query params:
// - lat, lng (required): discovery center
// - radiusKm (optional, default 5, clamp 1..20)
// - maxResults (optional, default 18, clamp 1..20)
// - cuisines (optional): comma-separated UI cuisines
// - pureVeg (optional): "1" or "0" (best effort; affects keyword)
// - discoveryMode (optional): "balanced" | "famous" (affects rankby/keyword only lightly)
// - meal (optional): "breakfast" | "lunch" | "snack" | "dinner" (affects keyword)
// - openNow (optional): "1" (adds opennow=true)

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _cache = globalThis.__placesCache || (globalThis.__placesCache = new Map());

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

function normListCSV(s) {
  if (!s) return [];
  return String(s)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

// Expand grouped cuisines:
// - If Maharashtrian is selected, include its sub-cuisines in keyword to improve discovery.
function expandCuisines(selected) {
  const set = new Set(selected);

  // Group: Maharashtrian (umbrella) -> sub-tags
  const mahaSubs = ["Malvani", "Khandeshi", "Kolhapuri", "Varhadi", "Puneri"];
  if (set.has("Maharashtrian")) mahaSubs.forEach(x => set.add(x));

  // If a sub cuisine is selected but Maharashtrian isn’t, still ok.
  return Array.from(set);
}

function keywordForMeal(meal) {
  switch (meal) {
    case "breakfast":
      return "breakfast";
    case "lunch":
      return "lunch";
    case "snack":
      return "snacks";
    case "dinner":
      return "dinner";
    default:
      return "";
  }
}

// Map UI cuisine to useful keyword tokens.
// (Nearby Search doesn’t accept strict cuisine filters; keyword is the best lever.)
function cuisineToKeywordTokens(c) {
  const v = c.toLowerCase();
  if (v === "south indian") return ["south indian", "udupi", "dosa", "idli"];
  if (v === "north indian") return ["north indian"];
  if (v === "indian") return ["indian"];
  if (v === "chinese") return ["chinese"];
  if (v === "pizza") return ["pizza"];
  if (v === "seafood") return ["seafood"];
  if (v === "street food") return ["street food", "chaat"];
  if (v === "fast food") return ["fast food"];
  if (v === "cafe") return ["cafe"];
  if (v === "bakery / desserts") return ["bakery", "dessert"];
  if (v === "bar / pub") return ["bar", "pub"];
  if (v === "vegetarian") return ["vegetarian", "pure veg"];

  // Maharashtrian umbrella + sub tags
  if (v === "maharashtrian") return ["maharashtrian"];
  if (v === "malvani") return ["malvani", "konkan", "seafood"];
  if (v === "khandeshi") return ["khandeshi"];
  if (v === "kolhapuri") return ["kolhapuri", "tambda pandhra"];
  if (v === "varhadi") return ["varhadi"];
  if (v === "puneri") return ["puneri"];

  // Fallback – don’t overconstrain
  return [c];
}

function buildKeyword({ cuisines, pureVeg, meal }) {
  const tokens = [];

  const mealTok = keywordForMeal(meal);
  if (mealTok) tokens.push(mealTok);

  const expanded = expandCuisines(cuisines);
  for (const c of expanded) {
    cuisineToKeywordTokens(c).forEach(t => tokens.push(t));
  }

  if (pureVeg === "1") tokens.push("pure veg", "vegetarian");

  // De-dupe while preserving order
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }

  // Keep it short-ish; very long keywords can degrade results
  return out.slice(0, 8).join(" ");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  }

  try {
    const {
      lat,
      lng,
      radiusKm = "5",
      maxResults = "18",
      cuisines = "",
      pureVeg = "0",
      discoveryMode = "balanced",
      meal = "",
      openNow = "0",
    } = req.query || {};

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "lat and lng query params are required" });
    }

    const radius = clampNum(radiusKm, 1, 20, 5);
    const max = Math.min(parseInt(maxResults || "18", 10), 20);
    const radiusMeters = Math.round(radius * 1000);

    const cuisineList = normListCSV(cuisines);
    const keyword = buildKeyword({ cuisines: cuisineList, pureVeg, meal });

    // Cache key (include all params that influence results)
    const cacheKey = JSON.stringify({
      latitude: latitude.toFixed(5),
      longitude: longitude.toFixed(5),
      radiusMeters,
      max,
      cuisines: cuisineList.sort(),
      pureVeg: pureVeg === "1" ? "1" : "0",
      discoveryMode,
      meal,
      openNow: openNow === "1" ? "1" : "0",
      keyword,
    });

    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${latitude},${longitude}`);
    url.searchParams.set("radius", String(radiusMeters));
    url.searchParams.set("type", "restaurant");
    url.searchParams.set("key", GOOGLE_KEY);

    if (keyword) url.searchParams.set("keyword", keyword);
    if (openNow === "1") url.searchParams.set("opennow", "true");

    // “famous” mode: keep same call but allow Google to bias popular results via keyword;
    // (We still rank on frontend using rating/reviews.)
    // Note: Nearby Search supports rankby=prominence with radius; that’s default.

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Places API error", details: text });
    }

    const data = await response.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(502).json({
        error: "Places API status error",
        status: data.status,
        details: data.error_message,
      });
    }

    const results = (data.results || [])
      .slice(0, max)
      .map((r) => ({
        id: r.place_id,
        name: r.name,
        area: r.vicinity || "",
        city: "",
        coords: r.geometry?.location ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        priceLevel: r.price_level,
        types: r.types || [],
        openNow: r.opening_hours?.open_now, // present when Google has it
      }));

    const payload = {
      places: results,
      meta: {
        keyword,
        radiusKm: radius,
        meal: meal || null,
        openNow: openNow === "1",
        pureVeg: pureVeg === "1",
        cuisines: cuisineList,
        discoveryMode,
      },
    };

    cacheSet(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[api/places] handler failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
