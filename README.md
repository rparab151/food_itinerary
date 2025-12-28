# Food Itinerary Builder (Mumbai / Thane / Mumbai Region)

Single‑page web app to build a short food outing itinerary (Upscale vs Cheap) based on:

- Home address
- Max outing length (hours)
- Travel style (Cab vs Local)
- Cuisine filters

The frontend is a static `index.html` with modern UI and all logic in vanilla JS. For dynamic places search it can call a backend (Vercel Serverless Function) that proxies the Google Places Nearby Search API.

## Project structure

- `index.html` – main SPA (UI, itinerary logic, Google Maps embed, calls to the Vercel backend)
- `api/places.js` – Vercel Serverless Function that proxies Google Places Nearby Search
- `backend/` – optional local Node/Express server for local development (contains `server.mjs` and `package.json`; not needed when deploying on Vercel)

## Running locally (static only)

You can open the app as a static file or via a simple dev server:

```bash
cd mumbai-thane-food-itinerary-production

# Using any static server, for example:
npx serve .
# then open the printed http://localhost:PORT in your browser
```

In this mode the app uses a curated list of example places and still respects your home address for travel time estimation (derived from distance).

## Dynamic places via Vercel Serverless Functions

To use live nearby restaurants around the home address:

1. **Push this folder to GitHub** (root containing `index.html` and `api/places.js`).
2. **Create a new project on [Vercel](https://vercel.com)** → “Import Git Repository” → select your repo.
3. In the Vercel setup:
   - **Build command**: leave empty (static site).
   - **Output directory**: `.` (the project root).
4. In **Project Settings → Environment Variables**, add:

   - `GOOGLE_MAPS_API_KEY` – your Google Maps / Places API key (server key).

5. Deploy the project.

At runtime the frontend calls:

- `/api/places?lat=..&lng=..&radiusKm=..&maxResults=..`

The serverless function forwards the request to the Google Places Nearby Search API and returns normalized place data. When the function returns results, they are used as the primary pool; otherwise the app falls back to the curated static places so the UI never completely breaks.

## Optional: local Node backend

If you prefer to run a backend locally instead of Vercel Functions:

```bash

# install dependencies (run inside the `backend` folder)
cd backend && npm install

# create .env with your key
echo GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE > .env

# start the express server
npm start
```

Then point `BACKEND_BASE` in `index.html` to `http://127.0.0.1:4000/api` (instead of the `/api` path) and adjust the fetch URL accordingly. The server implementation in `backend/server.mjs` mirrors the Vercel function behaviour.

## Notes

- All theme switching (dark / light) is controlled via the `data-theme` attribute on `<html>` and `#app`.
- Travel time and cost are derived from approximate distance between your home and each place; they are estimates, not real‑time traffic.
- Google Maps directions, ratings, and reviews are opened via standard `https://www.google.com/maps/...` URLs so Google renders the live data.*** End Patch```} ***!

