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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

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
      cuisines = ""
    } = req.query || {};

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    const radiusMeters = Math.min(Math.max(Number(radiusKm) || 5, 1), 20) * 1000;
    const max = Math.min(Math.max(parseInt(maxResults, 10) || 12, 1), 20);

    const CUISINE_KEYWORDS = {
      "South Indian": "south indian OR udupi OR dosa OR idli OR vada",
      "Indian": "north indian OR punjabi OR thali OR biryani",
      "Chinese": "chinese OR indo-chinese OR hakka OR momos",
      "Pizza": "pizza OR pizzeria",
      "Street food": "street food OR chaat OR vada pav OR pav bhaji",
      "Cafe": "cafe OR coffee OR brunch",
      "Bakery / Desserts": "bakery OR desserts OR cake OR ice cream",
      "Seafood": "seafood OR fish thali",
      "Fast food": "burger OR fries OR sandwich",
      "Vegetarian": "pure veg OR vegetarian",
      "Bar / Pub": "bar OR pub OR brewery",
      "Restaurant": "restaurant"
    };

    const selected = cuisines
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    const keywords =
      selected.length > 0
        ? selected.map(c => CUISINE_KEYWORDS[c] || c)
        : ["restaurant"];

    async function fetchPlaces(keyword) {
      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.searchParams.set("location", `${latitude},${longitude}`);
      url.searchParams.set("radius", String(radiusMeters));
      url.searchParams.set("type", "restaurant");
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("key", GOOGLE_KEY);

      const r = await fetch(url.toString());
      const j = await r.json();
      if (j.status !== "OK" && j.status !== "ZERO_RESULTS") return [];
      return j.results || [];
    }

    const batches = await Promise.all(keywords.map(fetchPlaces));

    const map = new Map();
    for (const batch of batches) {
      for (const r of batch) {
        if (r.place_id && !map.has(r.place_id)) {
          map.set(r.place_id, r);
        }
      }
    }

    const places = Array.from(map.values())
      .slice(0, max)
      .map(r => ({
        id: r.place_id,
        name: r.name,
        area: r.vicinity || "",
        city: "Nearby",
        coords: r.geometry?.location
          ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng }
          : null,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        priceLevel: r.price_level,
        types: r.types || []
      }));

    return res.status(200).json({ places });

  } catch (e) {
    console.error("places api error", e);
    return res.status(500).json({ error: "Server error" });
  }
}
