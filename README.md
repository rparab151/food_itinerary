# Food Itinerary Builder (Mumbai / Thane / Mumbai Region)

Single‑page web app to build a short food outing itinerary (Upscale vs Cheap) based on:

- Home address
- Max outing length (hours)
- Travel style (Cab vs Local)
- Cuisine filters

The frontend is a static `index.html` with modern UI and all logic in vanilla JS. For dynamic places search it can call a backend (Netlify Function) that talks to the Google Places Nearby Search API.

## Project structure

- `index.html` – main SPA (UI, itinerary logic, Google Maps embed, Netlify backend calls)
- `netlify/functions/places.js` – Netlify Function that proxies Google Places Nearby Search
- `netlify.toml` – Netlify config pointing to the functions directory
- `backend/` – optional local Node/Express server (not needed when using Netlify Functions)

## Running locally (static only)

You can open the app as a static file or via a simple dev server:

```bash
cd mumbai-thane-food-itinerary-production

# Using any static server, for example:
npx serve .
# then open the printed http://localhost:PORT in your browser
```

In this mode the app uses a curated list of example places and still respects your home address for travel time estimation (derived from distance).

## Dynamic places via Netlify Functions

To use live nearby restaurants around the home address:

1. **Push this folder to GitHub** (root containing `index.html`, `netlify.toml`, `netlify/functions/places.js`).  
2. **Create a site on Netlify** → “Import from Git” → select the repo.
3. In the Netlify setup:
   - **Build command**: leave empty (static site).
   - **Publish directory**: `.`
4. In **Site settings → Environment variables**, add:

   - `GOOGLE_MAPS_API_KEY` – your Google Maps / Places API key (server key).

5. Redeploy the site.

At runtime the frontend calls:

- `/.netlify/functions/places?lat=..&lng=..&radiusKm=..&maxResults=..`

The function forwards the request to the Google Places Nearby Search API and returns normalized place data. When the function returns results, they are used as the primary pool; otherwise the app falls back to the curated static places so the UI never completely breaks.

## Optional: local Node backend

If you prefer to run a backend locally instead of Netlify Functions:

```bash
cd backend
npm install

# create .env with your key
echo GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE > .env

npm start
```

Then point `BACKEND_BASE` in `index.html` to `http://127.0.0.1:4000/api` (instead of the Netlify path) and adjust the fetch URL accordingly. The server implementation in `backend/server.mjs` mirrors the Netlify function behaviour.

## Notes

- All theme switching (dark / light) is controlled via the `data-theme` attribute on `<html>` and `#app`.
- Travel time and cost are derived from approximate distance between your home and each place; they are estimates, not real‑time traffic.
- Google Maps directions, ratings, and reviews are opened via standard `https://www.google.com/maps/...` URLs so Google renders the live data.*** End Patch```} ***!

