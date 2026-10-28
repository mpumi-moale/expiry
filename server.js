// Frontend-only Vercel entry point while the backend is under development.
// The former SQLite/JWT/Twilio server is preserved in server.backend.js and is
// intentionally not loaded here: Vercel has no durable local SQLite storage.

const path = require('path');
const express = require('express');

const app = express();
const publicDir = path.join(__dirname, 'public');

// Serve the current UI from the Express function so `/` does not need the
// database-backed application to initialize.
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir));

// Keep the UI usable while making it clear that its API is not enabled yet.
app.all('/api/*', (_req, res) => {
  res.status(503).json({ error: 'The backend is temporarily disabled while the frontend is being developed.' });
});

app.use((_req, res) => {
  res.status(404).send('Not found');
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal server error');
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => {
    console.log('Expiry Tracker frontend on port ' + (process.env.PORT || 3000));
  });
}

module.exports = app;
