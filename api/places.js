// api/places.js
// Vercel Serverless Function: Proxy to Google Places Nearby Search API.
//
// Query params:
//   - lat, lng (required)
//   - radiusKm (optional, default 5, clamped 1–20)
//   - maxResults (optional, default 12, clamped 1–20)
//   - type (optional, default "restaurant")
//   - keyword (optional; e.g., "south indian", "udupi", "malvani", "kolhapuri")
//   - openNow (optional: "1" to filter open-now)
//
// Env:
//   - GOOGLE_MAPS_API_KEY (use a SERVER key; do NOT use referrer-restricted key here)

export default async function handler(req, res) {
  // CORS (static frontend calls this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  }

  try {
    const q = req.query || {};
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng query params are required" });
    }

    const radiusKm = Math.min(Math.max(parseFloat(q.radiusKm ?? "5") || 5, 1), 20);
    const maxResults = Math.min(Math.max(parseInt(q.maxResults ?? "12", 10) || 12, 1), 20);
    const type = String(q.type ?? "restaurant");
    const keyword = String(q.keyword ?? "").trim();
    const openNow = String(q.openNow ?? "0") === "1";

    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(Math.round(radiusKm * 1000)));
    url.searchParams.set("type", type);
    if (keyword) url.searchParams.set("keyword", keyword);
    if (openNow) url.searchParams.set("opennow", "true");
    url.searchParams.set("key", GOOGLE_KEY);

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

    const places = (data.results || []).slice(0, maxResults).map((r) => ({
      id: r.place_id,
      name: r.name,
      area: r.vicinity || "",
      city: "", // not provided directly; frontend can show "Nearby"
      coords: r.geometry?.location ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      types: r.types || [],
      isOpenNow: r.opening_hours?.open_now,
    }));

    return res.status(200).json({ places });
  } catch (err) {
    console.error("[api/places] handler failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
