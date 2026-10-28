# Expiry Tracker

Register, log in, add products by name and expiry date (or photograph the label), and get an SMS every 30 days after adding a product until it expires.

## Run it

```
npm install
cp .env.example .env     # set JWT_SECRET, TZ, and Twilio keys
npm start                # http://localhost:3000
```

Without Twilio keys, texts are printed to the console (dry run). Phone numbers must be international format (+15551234567).

## Frontend-only Vercel preview

The Vercel entry point (`server.js`) currently serves the frontend without
starting the database-backed API. This lets the UI deploy while the backend is
being developed. API calls return HTTP 503 until the backend is restored.

The former backend is preserved in `server.backend.js`. Before re-enabling it
on Vercel, move data from local SQLite to a persistent managed database and
configure `JWT_SECRET` in the Vercel project environment.

## How it works

- `server.js`: frontend-only Express entry point for Vercel while the UI is being developed.
- `server.backend.js`: preserved Express API, SQLite (`data.db`), bcrypt + JWT login, daily cron (default 9:00 in `TZ`), photo scan endpoint.
- `dates.js`: reminder schedule (added date + 30, 60, 90… days, up to the expiry date) and date extraction from OCR text.
- `public/index.html`: the web app (installable on a phone home screen via the browser menu).
- Photo scan runs Tesseract OCR on the server (first scan downloads language data). Set `DATE_ORDER=MDY` for US-style labels.

## Test reminders quickly

With `NODE_ENV` unset, `POST /api/dev/run-reminders` (with your login token) runs the job on demand. To force one, edit an item's `added` date in `data.db` to 30 days ago.

## Before going live

- Restore the backend only after replacing SQLite with persistent database storage on Vercel, or deploy the original backend to a host with a persistent volume.
- Configure `JWT_SECRET` (16+ characters) in the deployment environment.
- Twilio US numbers need A2P 10DLC registration; add STOP/opt-in handling and have users confirm their number.
- Add password reset and phone verification (Twilio Verify) when you outgrow the MVP.
- Set `NODE_ENV=production` to disable the dev endpoint.
