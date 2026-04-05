# Wix ↔ HubSpot Integration App

A self-hosted Wix CLI app that bi-directionally syncs contacts between Wix and HubSpot, captures form submissions with UTM attribution, and provides a dashboard UI for field mapping configuration.

---

## Testing the App

| Detail | Value |
|---|---|
| GitHub repo | https://github.com/lebomdlongwa/wix-hubspot |
| Backend (live) | https://beautiful-comfort-production-f20a.up.railway.app |
| **Wix login email** | **lebo.wixhubspot@gmail.com** |
| **Wix password** | **WixHubSpot123** |
| **HubSpot login email** | **lebo.wixhubspot@gmail.com** |
| **HubSpot password** | **WixHubSpot123** |
| **HubSpot account** | **Zonke Tech Group** |
| **Gmail (for 2FA code)** | **lebo.wixhubspot@gmail.com** |
| **Gmail password** | **wixhubspot** |

### Step-by-step: Opening the Dashboard

1. Go to [manage.wix.com](https://manage.wix.com) and log in with `lebo.wixhubspot@gmail.com` / `WixHubSpot123`
2. In the left sidebar, click **Custom Apps**
3. Select **My New App-2**
4. On the app home page, click the **Test App** dropdown
5. Select **Test on dev site**
6. In the popup that appears, scroll to the bottom and click the blue **"test from here"** link
7. Select the **Wix-HubSpot-1** site and click **Test App** — the HubSpot Integration dashboard will open

### Step-by-step: Connecting HubSpot

8. Click the blue **Connect HubSpot** button
9. In the new tab that opens, click **Send to your HubSpot account**
10. Enter `lebo.wixhubspot@gmail.com` and `WixHubSpot123` as the HubSpot credentials
11. A 6-digit verification code will be sent to `lebo.wixhubspot@gmail.com` — log into Gmail (password: `wixhubspot`) to retrieve it
12. Select the **Zonke Tech Group** HubSpot account
13. Click **Close This Tab** once the success page appears — you are now connected

### Step-by-step: Testing sync

14. Add field mappings: **Email → BOTH**, **First Name → BOTH**, **Last Name → BOTH** → click **Save Mappings**
15. Create a contact in Wix (Customers & Leads → Contacts → New Contact) → verify it appears in HubSpot within seconds
16. Create a contact in HubSpot (CRM → Contacts → Create contact) → verify it appears in Wix within seconds
17. Submit the Wix form with an email → verify a HubSpot contact is created with UTM attribution data

---

## API Plan

### Feature 1 — OAuth Connect/Disconnect

| API | Why |
|---|---|
| **HubSpot OAuth 2.0** (`GET /oauth/authorize`, `POST /oauth/v1/token`) | Industry-standard OAuth flow. No API keys are stored in or exposed to the frontend — the authorization code is exchanged server-side for access + refresh tokens. |
| **HubSpot Token Info API** (`GET /oauth/v1/access-tokens/:token`) | Used immediately after token exchange to retrieve the portal ID and portal name, so we can display the connected portal in the dashboard UI. |
| **HubSpot CRM Properties API** (`POST /crm/v3/properties/contacts`) | Called once on connect to auto-create custom contact properties (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `wix_sync_source`, `wix_form_submitted_at`) so they are available in HubSpot before any sync runs. |
| **Wix `@wix/essentials` SDK** | Used in the frontend to retrieve the Wix `instanceId` from the authenticated session — this is the unique identifier that ties a Wix site to its HubSpot tokens. |

### Feature 2 — Bi-directional Contact Sync

| API | Why |
|---|---|
| **Wix Contacts v4 Webhooks** (`contact_created`, `contact_updated`) | Event-driven — no polling needed. Wix pushes a signed JWT payload to our backend the moment a contact changes, giving real-time sync with zero latency overhead. |
| **HubSpot Webhooks API** (`contact.creation`, `contact.propertyChange`) | Same reasoning as above — HubSpot pushes changes to our backend instantly rather than requiring periodic polling, which would be slower and wasteful of API quota. |
| **HubSpot CRM Contacts API** (`PATCH /crm/v3/objects/contacts/:id?idProperty=email`) | PATCH with `idProperty=email` performs an upsert — creates the contact if it doesn't exist, updates it if it does. Chosen over POST because it avoids 409 duplicate errors and is idempotent. |
| **Wix Contacts v4 API** (`GET`, `POST`, `PATCH /contacts/v4/contacts`) | GET is used to fetch the current revision before PATCH (Wix v4 requires the revision field for optimistic concurrency). POST creates new contacts. PATCH updates existing ones. |
| **HubSpot CRM Properties API** (`GET /crm/v3/properties/contacts`) | Fetched when the field mapping UI loads so users can select from all available HubSpot properties — including custom ones — without us hardcoding a list. |

### Feature 3 — Wix Form → HubSpot Lead Capture

| API | Why |
|---|---|
| **Wix Forms v2 Webhook** (`wix.forms.v2.submission_created`) | Fires on every form submission. The payload contains all form field values, allowing us to extract email, name, and hidden UTM fields in a single event — no polling or follow-up API call needed. |
| **HubSpot CRM Contacts API** (`PATCH /crm/v3/objects/contacts/:email?idProperty=email`) | PATCH by email upserts the contact — existing leads are enriched with UTM data rather than creating duplicates. |
| **HubSpot CRM Properties API** | `hs_lead_source` (native HubSpot property) is set based on `utm_medium` to populate HubSpot's built-in lead source reports. Custom UTM properties are set for full attribution tracking. |

---

## Architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│   Wix CLI Frontend      │        │   Self-Hosted Express Backend │
│   (React Dashboard)     │◄──────►│   (Railway)                  │
│   - Connect HubSpot     │  HTTP  │   - OAuth flow               │
│   - Field mapping UI    │        │   - Webhook handlers          │
│   - Manual sync button  │        │   - Sync logic               │
└─────────────────────────┘        │   - PostgreSQL (tokens/logs) │
                                   │   - Redis (dedup cache)      │
         ▲                         └──────────────────────────────┘
         │ Webhooks                          ▲
         ▼                                   │ Webhooks + API
┌─────────────────┐               ┌──────────────────────┐
│   Wix Platform  │               │   HubSpot CRM        │
│   - Contacts    │               │   - Contacts         │
│   - Forms       │               │   - Properties       │
└─────────────────┘               └──────────────────────┘
```

**Why self-hosted?** The self-hosted approach was chosen to demonstrate Node.js proficiency, custom deployment, and full control over sync logic, loop prevention, and token management. Wix Secrets Manager is only available inside Wix's Velo environment — for a self-hosted backend, PostgreSQL on a private Railway instance serves as the equivalent secure token store (tokens are never accessible from the public internet without database credentials).

---

## Features

- **OAuth 2.0** — Connect/disconnect HubSpot from the Wix dashboard. Tokens stored server-side, never exposed to the browser.
- **Bi-directional contact sync** — Wix → HubSpot and HubSpot → Wix, triggered by webhooks in real time.
- **Field mapping UI** — Configure which Wix fields map to which HubSpot properties, with sync direction and optional value transforms.
- **Value transforms** — Apply `trim`, `lowercase`, or `uppercase` to field values during sync.
- **Form submission capture** — Wix form submissions create/update HubSpot contacts with UTM attribution, page URL, referrer, and lead source.
- **Loop prevention** — Three-layer system prevents infinite sync loops.
- **Manual sync** — Bulk sync all Wix contacts to HubSpot on demand.
- **Sync log** — View history of all sync events with status, direction, and error details.
- **Idempotency** — Duplicate webhook deliveries are safely ignored.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Wix CLI (React 18 + TypeScript + @wix/design-system) |
| Backend | Node.js 20 + Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Railway) |
| Cache | Redis (loop dedup) |
| HubSpot client | Axios with auto token refresh interceptor |

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- Docker Desktop
- ngrok (for webhook testing)
- A Wix developer account and app
- A HubSpot developer account and app

### 1. Clone and install dependencies

```bash
git clone git@github.com:lebomdlongwa/wix-hubspot.git
cd wix-hubspot

cd backend && npm install
cd ../frontend && npm install
```

### 2. Start local services

```bash
cd ..
docker-compose up -d   # starts PostgreSQL on :5432 and Redis on :6379
```

### 3. Configure environment variables

Create `backend/.env`:

```env
PORT=3001

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wix_hubspot
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wix_hubspot_test

REDIS_URL=redis://localhost:6379

WIX_APP_ID=<your-wix-app-id>
WIX_ACCOUNT_ID=<your-wix-account-id>
WIX_SITE_ID=<your-wix-site-id>
WIX_APP_SECRET=<your-wix-app-secret>
WIX_PUBLIC_KEY=<your-wix-public-key>
WIX_API_KEY=<your-wix-api-key>

HUBSPOT_CLIENT_ID=<your-hubspot-client-id>
HUBSPOT_CLIENT_SECRET=<your-hubspot-client-secret>
HUBSPOT_REDIRECT_URI=https://<your-ngrok-url>/oauth/hubspot/callback
```

Create `frontend/.env`:

```env
VITE_BACKEND_URL=https://<your-ngrok-url>
```

### 4. Run database migrations

```bash
cd backend
npx prisma migrate dev
```

### 5. Start the backend

```bash
npm run dev
```

### 6. Expose via ngrok

```bash
ngrok http 3001
```

Copy the HTTPS URL and update `HUBSPOT_REDIRECT_URI` and `VITE_BACKEND_URL`.

### 7. Start the Wix frontend

```bash
cd ../frontend
npx wix dev
```

---

## HubSpot App Configuration

1. Go to [developers.hubspot.com](https://developers.hubspot.com) → your app → **Auth**
2. Set redirect URL to: `https://<your-backend-url>/oauth/hubspot/callback`
3. Required scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `oauth`
4. Under **Webhooks** → add subscriptions:
   - `contact.creation` → `https://<your-backend-url>/webhooks/hubspot/contacts`
   - `contact.propertyChange` → `https://<your-backend-url>/webhooks/hubspot/contacts`

## Wix App Configuration

1. Go to [dev.wix.com](https://dev.wix.com) → your app → **Webhooks**
2. Subscribe to:
   - `wix.contacts.v4.contact_created`
   - `wix.contacts.v4.contact_updated`
   - `wix.forms.v2.submission_created`
3. Set webhook delivery URL to: `https://<your-backend-url>`

---

## Production Deployment (Railway)

The backend is deployed on Railway with automatic deploys on push to `main`.

To apply database migrations after deployment:

```bash
DATABASE_URL="<railway-public-postgres-url>" npx prisma migrate deploy
```

---

## How It Works

### Contact Sync

| Event | Flow |
|---|---|
| Contact created/updated in Wix | Wix webhook → backend verifies JWT → applies field mappings → upserts HubSpot contact |
| Contact created/updated in HubSpot | HubSpot webhook → backend verifies HMAC signature → applies field mappings → creates/updates Wix contact |

### Loop Prevention (3 layers)

| Layer | Mechanism |
|---|---|
| 1 | **Correlation ID** — `wix_sync_source=wix_sync_<timestamp>` written to HubSpot on every Wix→HS sync. HubSpot webhook skipped if this tag is fresh (within 5 min). |
| 2 | **Redis dedup** — `SETEX dedup:<direction>:<instanceId>:<contactId> 300 1` — duplicate events within 5 min are dropped. |
| 3 | **DB timestamp** — if `lastSyncedBy=WIX` within 10 seconds, incoming HubSpot webhook is skipped. |

### Conflict Resolution

**Rule: the originating system wins.**

- A Wix-originated change is pushed to HubSpot. The HubSpot return webhook is suppressed by the correlation ID — Wix's value is preserved.
- A HubSpot-originated change is pushed to Wix. The Wix return webhook is suppressed by the DB timestamp check — HubSpot's value is preserved.

In a true simultaneous conflict, the first webhook to arrive wins (last-write-wins at the network level). Both systems reach consistency within one sync cycle.

### Form Submissions

Wix form submissions are captured via the `wix.forms.v2.submission_created` webhook:

1. Email, first name, last name extracted from submission fields
2. UTM parameters extracted from hidden form fields
3. HubSpot contact created or updated by email (upsert — no duplicates)
4. `hs_lead_source` set based on `utm_medium` (e.g. `cpc` → `PAID_SEARCH`, `email` → `EMAIL_MARKETING`)
5. `wix_sync_source=FORM` set to tag the contact origin
6. Submission logged to `FormSubmissionLog` with full attribution data

**UTM hidden field setup:** Add hidden form fields named `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `page_url`, and `referrer` to your Wix form. Populate them via Wix page code reading `wixLocation.query`.

---

## Security

- **OAuth 2.0 only** — no API keys in or exposed to the frontend
- **Token storage** — HubSpot access and refresh tokens stored in private PostgreSQL on Railway, never returned to the browser
- **Token refresh** — automatic via Axios interceptor; 401 responses trigger a token refresh and retry
- **Least privilege scopes** — only `crm.objects.contacts.read`, `crm.objects.contacts.write`, and `oauth`
- **Safe logging** — tokens fully redacted in all logs; emails masked as `j***@domain.com`
- **Webhook verification** — Wix webhooks verified via JWT; HubSpot webhooks verified via HMAC-SHA256 (`X-HubSpot-Signature-v3`)

---

## Field Mapping Transforms

| Transform | Effect |
|---|---|
| None | Value copied as-is |
| Trim whitespace | Leading and trailing spaces removed |
| Lowercase | Value converted to lowercase |
| Uppercase | Value converted to uppercase |

**Known limitation:** When a contact is created in Wix and synced to HubSpot with a transform (e.g. lowercase), the transformed value appears in HubSpot but Wix retains its original value. This is because the loop prevention (correlation ID) correctly blocks the return webhook to avoid an infinite sync loop. Contacts originating from HubSpot have the transform applied in both systems, as the sync completes in both directions before the loop is blocked.

---

## Running Tests

```bash
cd backend
npm test
```

Tests cover: OAuth flow, token refresh, field mapping CRUD, Wix→HubSpot sync, HubSpot→Wix sync, loop prevention, form submission capture, manual sync, and rate limiting.

---

## Project Structure

```
wix-hubspot/
├── docker-compose.yml              # PostgreSQL + Redis for local dev
├── frontend/                       # Wix CLI app (React dashboard)
│   └── src/dashboard/pages/
│       └── page.tsx                # Connect, field mapping UI, manual sync
└── backend/                        # Self-hosted Express backend
    ├── prisma/
    │   ├── schema.prisma           # DB models
    │   └── migrations/             # Migration history
    └── src/
        ├── routes/
        │   ├── oauth/              # HubSpot OAuth init + callback + status
        │   ├── mappings/           # Field mapping GET + POST
        │   ├── webhooks/           # Wix contacts, Wix forms, HubSpot contacts
        │   └── sync/               # Manual sync + sync log
        └── services/
            ├── sync.service.ts     # Core sync orchestration + conflict resolution
            ├── dedup.service.ts    # Redis-based loop prevention
            ├── token.service.ts    # OAuth token CRUD + refresh
            ├── hubspot.service.ts  # HubSpot API client + property management
            ├── wix.service.ts      # Wix API client + field transforms
            └── utm.service.ts      # UTM extraction + lead source inference
```
