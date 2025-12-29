// api/details.js
// Place Details proxy to fetch reviews + a canonical Google "overview" URL.
// This is called only for the selected picks (A & B) to control API usage.
//
// Requires env var: GOOGLE_MAPS_API_KEY
//
// Query params:
// - placeId (required)

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const _cache = globalThis.__detailsCache || (globalThis.__detailsCache = new Map());

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  }

  try {
    const { placeId } = req.query || {};
    if (!placeId) {
      return res.status(400).json({ error: "placeId is required" });
    }

    const cacheKey = String(placeId);
    const cached = cacheGet(cacheKey);
    if (cached) return res.status(200).json({ ...cached, cached: true });

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", String(placeId));
    url.searchParams.set(
      "fields",
      [
        "place_id",
        "name",
        "rating",
        "user_ratings_total",
        "url",
        "website",
        "formatted_address",
        "opening_hours",
        "reviews",
      ].join(",")
    );
    url.searchParams.set("key", GOOGLE_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Details API error", details: text });
    }

    const data = await response.json();
    if (data.status !== "OK") {
      return res.status(502).json({
        error: "Details API status error",
        status: data.status,
        details: data.error_message,
      });
    }

    const r = data.result || {};
    const payload = {
      placeId: r.place_id,
      name: r.name,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      googleUrl: r.url, // this is the “Google overview” URL
      website: r.website,
      address: r.formatted_address,
      openingHours: r.opening_hours || null,
      reviews: Array.isArray(r.reviews) ? r.reviews.slice(0, 5) : [],
    };

    cacheSet(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[api/details] handler failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
