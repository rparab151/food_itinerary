const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  try {
    const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing GOOGLE_MAPS_API_KEY on server" })
      };
    }

    const params = event.queryStringParameters || {};
    const lat = parseFloat(params.lat);
    const lng = parseFloat(params.lng);
    const radiusKm = Math.min(Math.max(parseFloat(params.radiusKm) || 5, 1), 20);
    const maxResults = Math.min(parseInt(params.maxResults || "12", 10), 20);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "lat and lng query params are required" })
      };
    }

    const radiusM = Math.round(radiusKm * 1000);

    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(radiusM));
    url.searchParams.set("type", "restaurant");
    url.searchParams.set("key", GOOGLE_KEY);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Places API error", details: text })
      };
    }
    const data = await resp.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Places API status error", status: data.status, details: data.error_message })
      };
    }

    const results = (data.results || []).slice(0, maxResults).map(r => ({
      id: r.place_id,
      name: r.name,
      area: r.vicinity || "",
      city: "",
      coords: r.geometry && r.geometry.location
        ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng }
        : null,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      types: r.types || []
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places: results })
    };
  } catch (err) {
    console.error("[netlify] /places failed", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};


