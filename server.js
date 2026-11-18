// JalanJava AI proxy: keeps the Anthropic key on the server, never in the browser bundle.
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
// Only allow the local dev app by default. Add your deployed site URL via ALLOWED_ORIGIN.
const allowed = [process.env.ALLOWED_ORIGIN, 'http://localhost:3000'].filter(Boolean);
app.use(cors({ origin: allowed }));
app.use(express.json({ limit: '100kb' }));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

// Very simple rate limit: max 30 requests per minute per IP (protects your credits if hosted).
const hits = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many requests, slow down.' });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
});

app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    res.status(response.status).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: 'Proxy error' });
  }
});

app.listen(3001, () => console.log('JalanJava proxy running on http://localhost:3001'));
