// Vercel serverless function to fetch nearby places from Google Places API
// with grouped cuisine expansion for Indian cuisines.
//
// Env required:
//   GOOGLE_MAPS_API_KEY (server key)
//
// Query params:
//   lat, lng           (required)
//   radiusKm           (optional, default 5, 1–20)
//   maxResults         (optional, default 12, max 20)
//   cuisines           (optional, comma-separated)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );

  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY" });
  }

  try {
    const {
      lat,
      lng,
      radiusKm = "5",
      maxResults = "12",
      cuisines = "",
    } = req.query || {};

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const radius = Math.min(Math.max(parseFloat(radiusKm) || 5, 1), 20);
    const max = Math.min(Math.max(parseInt(maxResults, 10) || 12, 1), 20);
    const radiusMeters = Math.round(radius * 1000);

    // ---------- Cuisine groups ----------
    const CUISINE_GROUPS = {
      "South Indian": ["South Indian", "Udupi", "Udipi", "Andhra", "Tamil"],
      "North Indian": ["North Indian", "Punjabi", "Mughlai"],
      "Maharashtrian": [
        "Maharashtrian",
        "Malvani",
        "Kolhapuri",
        "Puneri",
        "Varhadi",
        "Khandeshi",
      ],
      "Street food": ["Street food", "Chaat", "Snacks"],
      "Seafood": ["Seafood", "Coastal", "Fish"],
      "Vegetarian": ["Vegetarian", "Pure Veg"],
    };

    const rawCuisines = String(cuisines)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Expand cuisines into keyword list
    const keywordSet = new Set();

    for (const c of rawCuisines) {
      if (CUISINE_GROUPS[c]) {
        CUISINE_GROUPS[c].forEach((k) => keywordSet.add(k));
      } else {
        keywordSet.add(c);
      }
    }

    const keywords = Array.from(keywordSet);

    // ---------- Google Places fetch ----------
    async function fetchNearby(keyword) {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
      );
      url.searchParams.set("location", `${latitude},${longitude}`);
      url.searchParams.set("radius", String(radiusMeters));
      url.searchParams.set("type", "restaurant");
      if (keyword) url.searchParams.set("keyword", keyword);
      url.searchParams.set("key", GOOGLE_KEY);

      const response = await fetch(url.toString());
      const text = await response.text();

      if (!response.ok) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    // ---------- Run searches ----------
    let merged = [];

    if (keywords.length) {
      const searches = keywords.map((k) =>
        fetchNearby(`${k} restaurant`)
      );
      const results = await Promise.all(searches);

      for (const data of results) {
        if (!data) continue;
        if (data.status === "OK" && Array.isArray(data.results)) {
          merged.push(...data.results);
        }
      }
    } else {
      const data = await fetchNearby();
      if (!data) {
        return res.status(502).json({ error: "Places API error" });
      }
      if (data.status === "OK" && Array.isArray(data.results)) {
        merged = data.results;
      }
    }

    // ---------- Deduplicate ----------
    const seen = new Set();
    const deduped = [];
    for (const r of merged) {
      if (!r.place_id || seen.has(r.place_id)) continue;
      seen.add(r.place_id);
      deduped.push(r);
      if (deduped.length >= max) break;
    }

    const places = deduped.map((r) => ({
      id: r.place_id,
      name: r.name,
      area: r.vicinity || "",
      city: "",
      coords:
        r.geometry?.location
          ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng }
          : null,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      types: r.types || [],
    }));

    return res.status(200).json({ places });
  } catch (err) {
    console.error("[api/places] error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
