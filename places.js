// Vercel serverless function to fetch nearby places from Google Places API.
//
// This function proxies requests from the frontend to the Google Places Nearby
// Search API. It accepts query parameters:
//   - lat: latitude of the home/base location (required)
//   - lng: longitude of the home/base location (required)
//   - radiusKm: radius in kilometers to search within (optional, default 5, clamped between 1–20)
//   - maxResults: maximum number of places to return (optional, default 12, max 20)
//
// The function expects a `GOOGLE_MAPS_API_KEY` environment variable to be
// configured in your Vercel project. See README for details.

export default async function handler(req, res) {
  // Enable CORS for all origins so the static frontend can call this endpoint.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
  }
  try {
    const { lat, lng, radiusKm = "5", maxResults = "12" } = req.query || {};
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res
        .status(400)
        .json({ error: "lat and lng query params are required" });
    }
    // Clamp radius between 1 and 20 km.
    const radius = Math.min(Math.max(parseFloat(radiusKm) || 5, 1), 20);
    // Clamp max results between 1 and 20.
    const max = Math.min(parseInt(maxResults || "12", 10), 20);
    // Convert to meters for the Places API.
    const radiusMeters = Math.round(radius * 1000);

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    );
    url.searchParams.set("location", `${latitude},${longitude}`);
    url.searchParams.set("radius", String(radiusMeters));
    url.searchParams.set("type", "restaurant");
    url.searchParams.set("key", GOOGLE_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Places API error", details: text });
    }
    const data = await response.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res
        .status(502)
        .json({
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
        city: "", // not provided directly; frontend can treat as "Nearby"
        coords:
          r.geometry && r.geometry.location
            ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng }
            : null,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        priceLevel: r.price_level,
        types: r.types || [],
      }));
    return res.status(200).json({ places: results });
  } catch (err) {
    console.error("[api/places] handler failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}