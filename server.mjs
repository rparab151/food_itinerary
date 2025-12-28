import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_KEY) {
  console.warn("[backend] GOOGLE_MAPS_API_KEY is not set. /api/places will return an error.");
}

app.use(cors());
app.use(express.json());

// Simple health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// GET /api/places?lat=..&lng=..&radiusKm=..&maxResults=..
app.get("/api/places", async (req, res) => {
  try {
    if (!GOOGLE_KEY) {
      return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY on server" });
    }

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = Math.min(Math.max(parseFloat(req.query.radiusKm) || 5, 1), 20);
    const maxResults = Math.min(parseInt(req.query.maxResults || "12", 10), 20);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng query params are required" });
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
      return res.status(502).json({ error: "Places API error", details: text });
    }
    const data = await resp.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(502).json({ error: "Places API status error", status: data.status, details: data.error_message });
    }

    const results = (data.results || []).slice(0, maxResults).map((r) => ({
      id: r.place_id,
      name: r.name,
      area: r.vicinity || "",
      city: "",
      coords: r.geometry && r.geometry.location ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null,
      rating: r.rating,
      userRatingsTotal: r.user_ratings_total,
      priceLevel: r.price_level,
      types: r.types || [],
    }));

    res.json({ places: results });
  } catch (err) {
    console.error("[backend] /api/places failed", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`[backend] Server listening on http://localhost:${PORT}`);
});