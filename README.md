# LabShare — Campus Laboratory Resource-Sharing Platform

> GenAI-powered equipment discovery, intelligent slot booking, and fair
> conflict resolution for university departments.

**Live URL:** `https://labshare-XXXX-uc.a.run.app` *(replace with your Cloud Run URL after deployment)*

---

## Problem

University lab equipment sits idle in one department while students in another
can't access it. Booking is handled by email, spreadsheets, or nothing at all.
When two students want the same oscilloscope for overlapping deadlines, there is
no principled way to decide who gets it — or to offer a fair alternative.

LabShare solves this with a single web app that spans every department:
students discover and request equipment, the system detects conflicts and ranks
competing requests algorithmically, and faculty approve or redirect with
AI-generated plain-language explanations.

---

## Features

| Feature | Detail |
|---------|--------|
| **Equipment discovery** | Browse 20+ items across 5 departments; filter by department, category, availability |
| **Ask AI** | Describe a project need in plain English; Gemini returns ranked matches with one-line reasons each |
| **Slot booking** | Select a time window; the server checks for overlaps before accepting |
| **Availability calendar** | See confirmed bookings and pending requests on a free-slot list; click any free slot to auto-fill the form |
| **Conflict detection** | Half-open interval overlap check runs server-side on every submission; returns 409 with the conflicting entries |
| **AI slot suggestions** | On conflict, ask Gemini for 3 fair alternatives before the deadline |
| **Fair allocation engine** | Competing requests ranked by weighted score (deadline urgency 50%, fairness 30%, requirement match 20%) |
| **Faculty approval queue** | List, detail drawer, approve / reject / accept-alternative with optional note; all gated by `requireRole('faculty')` |
| **Gemini explanations** | POST /api/ai/explain sends the already-ranked list to Gemini for plain-language justifications — the AI explains, the server enforces the order |
| **Activity feeds** | Students see live request status updates; faculty see recent approval history |
| **Dashboard KPIs** | Role-aware counts, next booking, upcoming deadlines, pending approvals |

---

## Architecture

```
Browser (React SPA)
       │  HTTPS
       ▼
Cloud Run container (port 8080)
  ├── Express static — serves client/dist/
  └── Express API — /api/*
        ├── Helmet, CORS, rate-limit, body-size cap
        ├── authenticate() — Supabase JWT → req.profile
        ├── requireRole()  — zero-DB, reads req.profile.role
        │
        ├── /api/equipment         GET  list + meta
        ├── /api/bookings          GET/POST/DELETE
        ├── /api/access-requests   GET/POST/PATCH
        ├── /api/approvals         GET/GET :id/PATCH :id   ← faculty only
        ├── /api/activity          GET
        ├── /api/dashboard         GET
        └── /api/ai                discover / recommend / explain
              └── Gemini (model via GEMINI_MODEL env var, default: gemini-2.5-flash)
                                   (server-side only — key never in client)

Supabase (Postgres + Auth)
  ├── profiles          id, name, role, department
  ├── equipment         id, name, category, specs (JSONB), status
  ├── access_requests   pending → approved/rejected
  └── bookings          confirmed/cancelled/completed
        └── DB trigger  prevents double-booking at the data layer
```

The server is the **only** process that calls Gemini or uses the
`SUPABASE_SERVICE_KEY`. The browser only ever holds the anon key and a JWT.

---

## Allocation Engine

`server/services/allocation.js` is a **pure, deterministic function** with no
database or network calls. All inputs are plain JS values supplied by the route layer.

### Scoring model

Each competing request receives a composite score in `[0, 1]`:

```
score = 0.50 × urgency  +  0.30 × fairness  +  0.20 × match
```

| Component | Weight | Raw value | Normalisation |
|-----------|--------|-----------|---------------|
| **Deadline urgency** | 50% | Milliseconds until deadline (clamped ≥ 0) | Min-max across the competing set; inverted so the **sooner** deadline scores **higher** |
| **Fairness** | 30% | Student's confirmed booking-hours in the last 30 days | Min-max across the set; inverted so **less usage** scores **higher** |
| **Requirement match** | 20% | Word-overlap count between `purpose` text and `equipment.description + specs` (words > 3 chars) | Min-max across the set |

**Tie-breaking:** when two scores round equal, the student with the earlier
deadline wins (secondary `sort` key — deterministic, no randomness).

**Alternatives returned for every student:**
- Up to 3 nearest free slots before their deadline (gap ≥ 1 h in next 30 days)
- Equivalent equipment in the same category

### Why these weights?

- Deadline urgency dominates (50%) because missing a submission deadline is the
  highest-stakes outcome.
- Fairness (30%) prevents power users from monopolising shared resources.
- Requirement match (20%) ensures the best-fit equipment goes to the student
  who actually needs its specific capabilities.

---

## Running locally

### Prerequisites
- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key

### 1 — Supabase setup

Open the Supabase SQL editor and run, in order:

```sql
-- 1. Schema (tables, RLS policies, overlap-prevention trigger)
-- Paste the contents of supabase/schema.sql

-- 2. Seed data (20 equipment items + demo accounts)
-- Create these two auth users first in Authentication > Users:
--   student@demo.edu  /  Demo1234!
--   faculty@demo.edu  /  Demo1234!
-- Then paste supabase/seed.sql
```

### 2 — Environment variables

```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  (from Supabase > Settings > API)
# Optionally set GEMINI_MODEL (default: gemini-2.5-flash)
```

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service-role key (server only, never in client) |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (server only) |
| `GEMINI_MODEL` | optional | Gemini model name (default: `gemini-2.5-flash`) |
| `PORT` | optional | HTTP port for Cloud Run (default: `8080`) |
| `CLIENT_ORIGIN` | optional | Allowed CORS origin in production |
| `VITE_SUPABASE_URL` | ✅ | Supabase URL for the browser Supabase client |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key for the browser client |

### 3 — Start the backend

```bash
cd server
npm install
npm run dev        # node --watch index.js, port 8080
```

### 4 — Start the frontend

```bash
cd client
npm install
npm run dev        # Vite dev server, port 5173
                   # /api/* requests are proxied to localhost:8080
```

Open `http://localhost:5173` and sign in with the demo accounts.

---

## Running tests

All tests use Node's built-in `node:test` runner — no extra test dependencies.

```bash
cd server
npm test
# 93 tests, 22 suites, 0 failures
```

Test files:

| File | Covers |
|------|--------|
| `tests/validate.test.js` | All 6 validation helpers (string, datetime, date, window, UUID, maxLength) |
| `tests/conflicts.test.js` | `findConflicts` — 13 cases including boundary touches, multi-conflict, bad input |
| `tests/equipment.test.js` | Keyword fallback scoring, LIKE escape, enum validation |
| `tests/allocation.test.js` | Full allocation engine — tie-breaking, hog penalty, infeasible deadlines, equivalents |
| `tests/security.test.js` | `sanitiseError` prod/dev behaviour, `MAX_LENGTHS`, approvals validation, activity shaping |

---

## Deploying to Cloud Run

```bash
# 1. Build and push
gcloud builds submit \
  --tag gcr.io/YOUR_PROJECT_ID/labshare:latest .

# 2. Create secrets (once)
echo -n "https://..." | gcloud secrets create SUPABASE_URL      --data-file=-
echo -n "..."          | gcloud secrets create SUPABASE_SERVICE_KEY --data-file=-
echo -n "..."          | gcloud secrets create GEMINI_API_KEY    --data-file=-

# 3. Deploy
gcloud run deploy labshare \
  --image gcr.io/YOUR_PROJECT_ID/labshare:latest \
  --platform managed \
  --region us-central1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,\
SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-env-vars "NODE_ENV=production,CLIENT_ORIGIN=https://labshare-XXXX-uc.a.run.app"
```

Secrets are mounted as environment variables at container start — they never
appear in image layers or deploy logs.

---

## Security highlights

- Helmet sets `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, and 7 other headers
- `X-Powered-By` disabled
- CORS restricted to `CLIENT_ORIGIN` in production
- 32 kB request-body cap
- Global rate limit: 200 req / 15 min; AI endpoints: 15 req / min
- JWT verified server-side on every protected route; role read from `profiles` table
- DB-level overlap trigger prevents double-booking even if two requests race
- 500-level errors return `"An internal error occurred."` in production — no internal details leak
- Gemini API key and service-role key are **server-only** — never sent to the browser

---

## Project structure

```
/client                   React 18 + Vite SPA
  src/
    pages/                AuthPage, DashboardPage, EquipmentPage,
                          RequestFormPage, ApprovalsPage
    components/           NavBar, AskAI, ProtectedRoute
    context/              AuthContext (session + profile)
    hooks/                useApi (auth-aware fetch)
    utils/                timeSlots (free-slot builder)
    lib/                  supabaseClient (anon client)

/server                   Express API
  routes/                 equipment, bookings, access-requests,
                          approvals, activity, dashboard, ai
  services/               supabase (service-role), gemini, allocation
  middleware/             authenticate, requireRole
  utils/                  validate, conflicts
  tests/                  5 test files, 93 tests

/supabase                 schema.sql, seed.sql
Dockerfile                Multi-stage build → lean runtime image
```

---

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Student | student@demo.edu | Demo1234! |
| Faculty | faculty@demo.edu | Demo1234! |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 8, React Router 7 |
| Backend | Node.js 20, Express 4 |
| Database & Auth | Supabase (Postgres 15, row-level security) |
| AI | Google Gemini 1.5 Flash |
| Security | Helmet, express-rate-limit |
| Deploy | Docker (multi-stage), Google Cloud Run |
| Tests | Node built-in `node:test` (zero extra deps) |

---

*Built for the GenAI Campus Lab Resource-Sharing Hackathon.*
