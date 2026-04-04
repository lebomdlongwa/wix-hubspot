# Wix ↔ HubSpot Integration App — Implementation Plan

## Context

Build a self-hosted Wix CLI app that lets Wix site owners:
1. Connect their HubSpot account via OAuth 2.0
2. Configure field mappings between Wix contacts and HubSpot properties
3. Sync contacts bi-directionally (Wix ↔ HubSpot) with loop prevention
4. Capture Wix form submissions and push them to HubSpot with UTM attribution

**Form approach:** Wix native forms → push to HubSpot (not HubSpot form embed).  
**Deployment:** Local dev with ngrok first; production deploy deferred.  
**Accounts:** Neither HubSpot nor Wix developer accounts exist yet — setup steps included.

---

## Phase 0: Account Setup (Prerequisites)

### HubSpot Developer Account
1. Go to [developers.hubspot.com](https://developers.hubspot.com) → Create a free developer account
2. Create a new **App** inside the developer portal → note `Client ID` and `Client Secret`
3. Set redirect URL to: `http://localhost:3001/oauth/hubspot/callback`
4. Required OAuth scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `oauth`
5. Under App settings → Webhooks → add subscriptions for `contact.creation` and `contact.propertyChange`; set target URL to your ngrok URL + `/webhooks/hubspot/contacts`

### Wix Developer Account
1. Go to [dev.wix.com](https://dev.wix.com) → sign up for a free developer account
2. Create a new **App** → choose "Self-Hosted" app type
3. Note the `App ID` and generate an `App Secret`
4. Under Webhooks, subscribe to: `wix.contacts.v4.contact_created`, `wix.contacts.v4.contact_updated`, `wix.forms.v2.submission_created`
5. Set webhook delivery URL to your ngrok URL

### ngrok
```bash
brew install ngrok  # or download from ngrok.com
ngrok http 3001     # exposes localhost:3001 with HTTPS URL
```

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Wix App | Wix CLI (`@wix/create-app`) | Official self-hosted app toolchain |
| Dashboard UI | React 18 + TypeScript + `@wix/design` | Wix's design system for native look |
| Backend | Node.js 20 + Express + TypeScript | Large ecosystem, easy to configure, familiar error messages |
| ORM | Prisma | Type-safe, easy migrations |
| Database | PostgreSQL (Docker) | Contact ID mapping, field configs |
| Dedup Cache | Redis (Docker) | TTL-based sync loop prevention |
| HubSpot client | `axios` + manual calls | Full control over retry/refresh logic |

---

## Project Structure

```
wix-hubspot-integration/
├── docker-compose.yml          # Postgres + Redis
├── .env.example
├── wix-app/                    # Wix CLI frontend
│   ├── wix.config.json
│   └── src/
│       └── dashboard/
│           ├── pages/
│           │   ├── index.tsx           # Connect/disconnect HubSpot
│           │   ├── field-mapping.tsx   # Field mapping table UI
│           │   └── sync-log.tsx        # Sync history viewer
│           └── components/
│               ├── ConnectButton.tsx
│               ├── FieldMappingRow.tsx
│               └── DirectionSelector.tsx
└── backend/
    ├── prisma/
    │   └── schema.prisma
    └── src/
        ├── index.ts
        ├── routes/
        │   ├── oauth/
        │   │   ├── hubspot-init.ts       # GET  /oauth/hubspot/init
        │   │   └── hubspot-callback.ts   # GET  /oauth/hubspot/callback
        │   ├── webhooks/
        │   │   ├── wix-contacts.ts       # POST /webhooks/wix/contacts
        │   │   ├── wix-forms.ts          # POST /webhooks/wix/forms
        │   │   └── hubspot-contacts.ts   # POST /webhooks/hubspot/contacts
        │   ├── mappings/
        │   │   ├── get-mappings.ts       # GET  /api/mappings/:instanceId
        │   │   └── save-mappings.ts      # POST /api/mappings/:instanceId
        │   └── sync/
        │       └── manual-sync.ts        # POST /api/sync/:instanceId
        └── services/
            ├── hubspot.service.ts        # All HubSpot API calls
            ├── wix.service.ts            # All Wix API calls
            ├── sync.service.ts           # Sync orchestration
            ├── dedup.service.ts          # Loop prevention
            ├── token.service.ts          # OAuth token storage/refresh
            └── utm.service.ts            # UTM parameter extraction
```

---

## Database Models (Prisma)

```prisma
model AppInstallation {
  id              String   @id @default(uuid())
  instanceId      String   @unique       // Wix instance ID
  hubspotPortalId String?
  connectedAt     DateTime?
  fieldMappings   FieldMapping[]
  contactMappings ContactIdMapping[]
  syncLogs        SyncLog[]
  formSubmissions FormSubmissionLog[]
}

model ContactIdMapping {
  id               String     @id @default(uuid())
  instanceId       String
  wixContactId     String
  hubspotContactId String
  lastSyncedBy     SyncSource
  lastSyncedAt     DateTime
  @@unique([instanceId, wixContactId])
  @@unique([instanceId, hubspotContactId])
}

model FieldMapping {
  id              String        @id @default(uuid())
  instanceId      String
  wixField        String
  hubspotProperty String
  direction       SyncDirection  // WIX_TO_HS | HS_TO_WIX | BOTH
  isActive        Boolean       @default(true)
  @@unique([instanceId, wixField, hubspotProperty])
}

model SyncLog {
  id           String     @id @default(uuid())
  instanceId   String
  direction    SyncSource
  wixId        String?
  hubspotId    String?
  status       SyncStatus  // SUCCESS | SKIPPED | ERROR
  skipReason   String?
  errorMessage String?
  createdAt    DateTime   @default(now())
}

model FormSubmissionLog {
  id               String   @id @default(uuid())
  instanceId       String
  wixSubmissionId  String   @unique
  hubspotContactId String?
  utmSource        String?
  utmMedium        String?
  utmCampaign      String?
  utmTerm          String?
  utmContent       String?
  rawSubmission    Json
  syncedAt         DateTime?
}

enum SyncSource    { WIX HUBSPOT FORM MANUAL }
enum SyncDirection { WIX_TO_HS HS_TO_WIX BOTH }
enum SyncStatus    { SUCCESS SKIPPED ERROR }
```

---

## Implementation Phases

### Phase 1: Scaffold + Docker (Day 1)
1. `npx @wix/create-app@latest` → select "Self-Hosted"
2. Init backend: `npm init`, install `express`, `prisma`, `ioredis`, `axios`, `zod`, `typescript`, `@types/express`
3. Write `docker-compose.yml` with Postgres 16 + Redis 7
4. `docker-compose up -d`, run `prisma migrate dev`
5. Write `.env.example` documenting all vars

### Phase 2: HubSpot OAuth Flow (Day 2)
**Goal:** Site owner connects HubSpot → tokens stored securely

- `GET /oauth/hubspot/init` — build HubSpot auth URL, redirect user
- `GET /oauth/hubspot/callback` — exchange code → tokens, store in **Wix Secrets Manager** under key `hubspot_tokens_<instanceId>` (JSON: `{ accessToken, refreshToken, expiresAt, portalId }`)
- `token.service.ts`: `storeTokens()`, `getTokens()`, `refreshTokens()` — refresh interceptor catches 401s from HubSpot and retries
- `GET /api/oauth/status/:instanceId` — returns connected/disconnected status + portal name
- Dashboard `ConnectButton.tsx`: shows "Connect HubSpot" or "Connected as [portal] — Disconnect"
- Dashboard `index.tsx`: main entry page with connection status

### Phase 3: Field Mapping UI + API (Days 3–4)
**Goal:** User configures Wix field → HubSpot property mappings

- `GET /api/mappings/:instanceId` — return saved mappings + available Wix fields + HubSpot properties (fetched from `GET /crm/v3/properties/contacts`)
- `POST /api/mappings/:instanceId` — validate (no duplicate HubSpot property unless direction differs) + upsert rows in `FieldMapping` table
- `field-mapping.tsx`: table with rows of (Wix field dropdown, HubSpot property dropdown, direction selector, delete button), "Add Row" button, "Save Mappings" button with toast feedback
- Validation: no two rows mapping the same HubSpot property with conflicting directions

### Phase 4: Wix → HubSpot Contact Sync (Day 5)
**Goal:** A Wix contact create/update pushes to HubSpot

- Subscribe to Wix webhook topics in `wix.config.json`
- `POST /webhooks/wix/contacts`:
  1. Verify Wix HMAC signature
  2. Call `dedup.service.checkAndMark(contactId, 'wix->hs', instanceId)` — set Redis key `dedup:wix-hs:<instanceId>:<contactId>` with 5-min TTL; skip if already set
  3. Call `sync.service.syncWixContactToHubSpot(instanceId, contact)`
- `sync.service.syncWixContactToHubSpot`:
  - Look up `ContactIdMapping` for existing HubSpot ID
  - Apply only `WIX_TO_HS` + `BOTH` field mappings
  - If exists: `PATCH /crm/v3/objects/contacts/:hsId` with mapped props + `wix_sync_source: "wix_sync_<timestamp>"`
  - If new: `POST /crm/v3/objects/contacts` → store new `ContactIdMapping`

### Phase 5: Loop Prevention + HubSpot → Wix Sync (Day 6)
**Goal:** Bi-directional sync without infinite loops

**Three-layer loop prevention:**
| Layer | Mechanism |
|---|---|
| 1 | **Correlation ID on record**: write `wix_sync_source=wix_sync_<timestamp>` to HubSpot; on inbound HubSpot webhook, skip if this property was set within last 5 min |
| 2 | **Redis dedup key**: `SETEX dedup:<dir>:<instanceId>:<contactId> 300 1` — NX flag drops duplicates within window |
| 3 | **DB last-sync timestamp**: if `ContactIdMapping.lastSyncedBy == HUBSPOT` and `lastSyncedAt < 10s ago`, drop |

- `POST /webhooks/hubspot/contacts`:
  1. Verify HubSpot webhook signature (`X-HubSpot-Signature-v3`)
  2. Check correlation ID — if `wix_sync_source` was set by us within 5 min → skip
  3. Redis dedup check
  4. Call `sync.service.syncHubSpotContactToWix(instanceId, hsContact)`
- `syncHubSpotContactToWix`: apply `HS_TO_WIX` + `BOTH` mappings → `PATCH /contacts/v4/contacts/:wixId`

### Phase 6: Wix Form → HubSpot Lead Capture (Day 7)
**Goal:** Form submission creates/updates HubSpot contact with UTM data

- Subscribe to `wix.forms.v2.submission_created` webhook
- `POST /webhooks/wix/forms`:
  1. Parse submission fields (email, name, custom fields)
  2. `utm.service.extractUtm(submission)` — reads UTM from hidden form fields (site owner adds hidden fields `utm_source`, etc. populated via Wix page code reading `window.location.search`)
  3. Upsert HubSpot contact by email: `POST /crm/v3/objects/contacts` with `idProperty: email`
  4. Set HubSpot properties: `hs_lead_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `hs_analytics_last_url`, referrer, timestamp
  5. Write row to `FormSubmissionLog`

**UTM hidden field setup (document in README):**
Site owners add 5 hidden Wix form fields named `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`. A Wix page code snippet reads URL params on load and populates these via `$w('#fieldId').value = ...`.

### Phase 7: Manual Sync + Sync Log UI (Day 8)
- `POST /api/sync/:instanceId`: paginate all Wix contacts → sync each via `sync.service`; write each result to `SyncLog`
- `sync-log.tsx`: table of recent `SyncLog` rows — status badge, direction, entity IDs, timestamp, error message
- "Sync Now" button on main dashboard page

### Phase 8: Hardening (Day 9)
- Axios interceptor on HubSpot client for auto token refresh on 401
- Rate limiting: use `p-limit` concurrency cap of 5 during bulk sync (HubSpot: 110 req/10s)
- Zod validation on all webhook payloads and API request bodies
- Safe logging: never log tokens, never log full PII (mask email as `j***@domain.com` in logs)

---

## Testing Strategy (Tests Written Alongside Every Phase)

Tests are written **in the same phase** as the feature — not deferred. Each phase ships code + tests together.

**Before marking any phase complete:** run the full test suite (`npm test -- --run`) and confirm ALL tests pass — both the current phase's new tests and every test from all previous phases. Do not proceed to the next phase if any test is failing.

### Test Stack
- **`vitest`** — unit and integration test runner
- **`msw` (Mock Service Worker)** — mock HubSpot and Wix HTTP APIs
- **`supertest`** — test HTTP routes without a live server
- **`ioredis-mock`** — in-memory Redis for dedup tests
- **`prisma` test DB** — separate Postgres database for tests (`TEST_DATABASE_URL`)

### Tests Per Phase

**Phase 1 (Scaffold)**
- `docker-compose.test.yml` smoke test: Postgres + Redis connections succeed

**Phase 2 (OAuth)**
- `token.service.test.ts`: storeTokens, getTokens, refreshTokens round-trip (mock Secrets Manager)
- `hubspot-callback.test.ts`: valid code → tokens stored → 302 redirect; invalid code → 400
- `oauth-status.test.ts`: connected instance returns portal name; disconnected returns status=false

**Phase 3 (Field Mapping API)**
- `get-mappings.test.ts`: returns saved rows + HubSpot property list (msw mock)
- `save-mappings.test.ts`: upsert succeeds; duplicate HubSpot property with same direction → 422 validation error
- `field-mapping.tsx` component test (React Testing Library): rows render, add row, save fires POST

**Phase 4 (Wix → HubSpot Sync)**
- `sync.service.test.ts` (Wix→HS): new contact creates HubSpot record + ContactIdMapping row
- `sync.service.test.ts` (Wix→HS): existing contact PATCHes HubSpot; field mapping filters applied
- `wix-contacts.test.ts` route: invalid HMAC → 401; valid payload → sync triggered

**Phase 5 (Loop Prevention + HS → Wix)**
- `dedup.service.test.ts`: first call returns false (not seen); second call within 5 min returns true (drop)
- `dedup.service.test.ts`: TTL expiry re-allows the event
- `sync.service.test.ts`: correlation ID present and fresh → sync skipped, SyncLog status=SKIPPED
- `sync.service.test.ts`: HubSpot → Wix contact updates correct fields per direction mapping
- `hubspot-contacts.test.ts` route: invalid signature → 401; loop detection → 200 with SKIPPED log

**Phase 6 (Form Capture)**
- `utm.service.test.ts`: extracts all 5 UTM params from submission hidden fields; missing params default to null
- `wix-forms.test.ts` route: form submission → HubSpot contact upserted (msw mock) → FormSubmissionLog row created
- `wix-forms.test.ts`: duplicate `wixSubmissionId` → idempotent (no duplicate HubSpot call)

**Phase 7 (Manual Sync)**
- `manual-sync.test.ts`: paginated Wix contacts all synced; SyncLog rows written per contact

**Phase 8 (Hardening)**
- `token.service.test.ts`: HubSpot 401 → refresh called → original request retried with new token
- Rate limit test: 20 contacts synced concurrently → max 5 in-flight at a time (spy on axios)

---

## API Reference Summary

### Wix APIs Used
| Feature | API | Method + Endpoint |
|---|---|---|
| Read contact | Contacts v4 | `GET /contacts/v4/contacts/:id` |
| Upsert contact | Contacts v4 | `POST /contacts/v4/contacts` |
| Update contact | Contacts v4 | `PATCH /contacts/v4/contacts/:id` |
| Bulk query | Contacts v4 | `POST /contacts/v4/contacts/query` |
| Form submission event | Forms v2 Webhook | `wix.forms.v2.submission_created` |
| Contact events | Contacts v4 Webhooks | `contact_created`, `contact_updated` |
| Store tokens | Secrets Manager | `wix-secrets-backend` SDK |
| App instance info | App Instance API | `GET /apps/v1/instance` |

### HubSpot APIs Used
| Feature | API | Method + Endpoint |
|---|---|---|
| OAuth init | OAuth 2.0 | `GET https://app.hubspot.com/oauth/authorize` |
| Token exchange | OAuth 2.0 | `POST /oauth/v1/token` |
| Token refresh | OAuth 2.0 | `POST /oauth/v1/token` (grant_type=refresh_token) |
| Create contact | CRM Contacts v3 | `POST /crm/v3/objects/contacts` |
| Update contact | CRM Contacts v3 | `PATCH /crm/v3/objects/contacts/:id` |
| Upsert by email | CRM Contacts v3 | `POST /crm/v3/objects/contacts` + `idProperty: email` |
| Read contact | CRM Contacts v3 | `GET /crm/v3/objects/contacts/:id` |
| Batch read/write | CRM Contacts v3 | `/batch/read`, `/batch/create`, `/batch/update` |
| List properties | CRM Properties v3 | `GET /crm/v3/properties/contacts` |
| Inbound webhooks | Webhooks API v3 | `contact.creation`, `contact.propertyChange` |

---

## Critical Files to Create

| File | Purpose |
|---|---|
| `backend/prisma/schema.prisma` | All DB models |
| `backend/src/services/sync.service.ts` | Core sync orchestration |
| `backend/src/services/dedup.service.ts` | Redis-based loop prevention |
| `backend/src/services/token.service.ts` | OAuth token CRUD via Wix Secrets |
| `backend/src/routes/oauth/hubspot-callback.ts` | OAuth exchange + storage |
| `backend/src/routes/webhooks/hubspot-contacts.ts` | Inbound HubSpot → Wix sync |
| `backend/src/routes/webhooks/wix-forms.ts` | Form capture + UTM |
| `wix-app/src/dashboard/pages/field-mapping.tsx` | Field mapping table UI |
| `docker-compose.yml` | Postgres + Redis local setup |

---

## Verification / Testing Checklist

1. **OAuth flow**: Click "Connect HubSpot" → redirected to HubSpot → authorized → dashboard shows "Connected as [Portal Name]"
2. **Field mapping**: Add 3 mappings (e.g. email BOTH, firstName WIX_TO_HS, phone BOTH) → Save → refresh page → mappings persist
3. **Wix → HubSpot sync**: Create a new Wix contact → verify contact appears in HubSpot within seconds → verify mapped fields are correct
4. **HubSpot → Wix sync**: Update a contact property in HubSpot → verify Wix contact is updated within seconds
5. **Loop prevention**: Update a contact in Wix → confirm SyncLog shows exactly 1 SUCCESS entry for Wix→HS and 1 SKIPPED entry for HS→Wix (the reflection)
6. **Form submission**: Submit a Wix form with email and UTM params in URL → verify HubSpot contact created with UTM properties set
7. **Disconnect**: Click "Disconnect" → verify tokens deleted from Secrets Manager → sync endpoints return 401
