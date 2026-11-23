require('dotenv').config();
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === 'production';

// ── Security headers (helmet) ───────────────────────────────
// Sets: X-DNS-Prefetch-Control, X-Frame-Options, HSTS, X-Content-Type-Options,
//       X-XSS-Protection, Content-Security-Policy, etc.
app.use(helmet({
  // Allow inline scripts/styles Vite injects into the SPA shell
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:'],
      connectSrc:     ["'self'", 'https://*.supabase.co'],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));

// Disable X-Powered-By so attackers can't fingerprint the framework
app.disable('x-powered-by');

// ── CORS ────────────────────────────────────────────────────
// In production restrict to the app's own origin.
// CLIENT_ORIGIN must be set when deploying; falls back to same-origin.
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map(o => o.trim())
  : false;   // false = same-origin only

app.use(cors({
  origin: allowedOrigins || false,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));

// ── Body size cap ───────────────────────────────────────────
// Prevents request-body DoS; 32 kB is ample for all our payloads.
app.use(express.json({ limit: '32kb' }));

// ── Rate limiting ───────────────────────────────────────────
// Global: 200 req / 15 min per IP — covers all routes.
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests, please try again later.' },
});
app.use('/api/', globalLimiter);

// Stricter limiter for AI endpoints (Gemini calls are expensive).
const aiLimiter = rateLimit({
  windowMs:        60 * 1000,   // 1 min
  max:             15,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'AI rate limit reached. Please wait a moment.' },
});
app.use('/api/ai/', aiLimiter);

// ── Health check (unauthenticated — used by Cloud Run) ──────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API routes ──────────────────────────────────────────────
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/equipment',       require('./routes/equipment'));
app.use('/api/bookings',        require('./routes/bookings'));
app.use('/api/access-requests', require('./routes/accessRequests'));
app.use('/api/approvals',       require('./routes/approvals'));
app.use('/api/activity',        require('./routes/activity'));
app.use('/api/ai',              require('./routes/ai'));

// ── Serve React build (production / Cloud Run) ───────────────
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Global error handler ────────────────────────────────────
// Must be last and have 4 parameters.
// In production, 500-level errors never leak internal details.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const isClientError = status < 500;

  // Always log the full error server-side for debugging
  if (!isClientError) console.error('[error]', err);

  const message = isClientError
    ? err.message
    : isProd
      ? 'An internal error occurred.'
      : err.message;

  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`LabShare server listening on port ${PORT}`);
});
