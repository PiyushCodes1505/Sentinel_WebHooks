# Sentinel Webhooks

Sentinel Webhooks is a developer-facing webhook delivery platform built around one reliability problem: a destination can fail after an event has been created, so the sender needs durable state, asynchronous delivery, retries, signatures, and an audit trail.

## What you can do

- Create a webhook endpoint and generate a signing secret.
- Send JSON events and get a fast `202 Accepted` response.
- Process delivery asynchronously.
- Retry temporary failures with exponential backoff and jitter.
- Inspect every delivery attempt, status, HTTP response, error and latency.
- Dead-letter exhausted or non-retryable events.
- Replay dead-lettered events from the dashboard.
- Protect outbound webhooks with HMAC-SHA256 signatures.
- Use inbound `Idempotency-Key` and stable outbound event IDs.
- Simulate 200, 400, 429, 500, slow and timeout receivers from the built-in test receiver.
- View delivery metrics and system health.

## Architecture

```text
Browser
   |
   v
Next.js App Router
   |
   +------ PostgreSQL (source of truth)
   |
   +------ Vercel Queues (production async delivery)
                |
                v
        Queue consumer function
                |
                v
          Destination URL
                |
                +--> 2xx -> delivered
                +--> retryable -> delayed retry
                +--> non-retryable -> dead
```

The queue message contains only an `eventId`. PostgreSQL stores the payload and delivery state.

## Delivery semantics

Sentinel uses **at-least-once delivery**. A timeout or worker interruption can leave the sender unsure whether the receiver processed the request, so a later retry may deliver the same event again. Every retry keeps the same event ID so a receiver can deduplicate it.

Sentinel does not claim exactly-once delivery.

## Local development

Requirements: Node.js 22+.

PostgreSQL is easiest with Docker, but Docker is optional if you already have PostgreSQL locally.

```bash
docker compose up -d postgres
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

During local development the app uses a small in-process queue adapter so the complete product works with ordinary `next dev`. On Vercel production it switches automatically to Vercel Queues. The deployment uses Vercel's push-mode queue consumer, so no always-on worker process is required.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `MAX_ATTEMPTS` | Maximum delivery attempts | `5` |
| `BASE_RETRY_DELAY_SECONDS` | Initial retry delay | `1` |
| `MAX_RETRY_DELAY_SECONDS` | Retry delay cap | `300` |
| `DELIVERY_TIMEOUT_MS` | Outbound HTTP timeout | `5000` |
| `STALE_LOCK_SECONDS` | Time before a stuck worker claim can be recovered | `120` |
| `ALLOW_LOCAL_DESTINATIONS` | Development-only local destination support | `true` |
| `RECOVERY_SECRET` | Protects manual recovery in production | required |
| `DEMO_RECEIVER_SECRET` | Secret used for the seeded demo endpoint | generated default |
| `DEMO_RECEIVER_URL` | Optional seeded receiver URL | local or current Vercel deployment |

## Local demo

1. Open the dashboard.
2. The database seeds a `Demo Test Receiver` endpoint automatically.
3. Send an event.
4. Open the event timeline and watch the delivery attempt.
5. Go to **Test Receiver**.
6. Switch the receiver to `500 — Server error`.
7. Send another event and watch retries appear.
8. After the maximum attempts, open **Dead Letters**.
9. Switch the receiver back to success and press **Replay**.

## Production deployment

### Vercel + Neon

The application is designed for a Vercel deployment with a hosted PostgreSQL database such as Neon. Vercel Queues provides the production background delivery path, so a separate always-on worker is not required.

Deployment steps:

1. Upload the contents of this folder to the root of a GitHub repository.
2. Import that repository into Vercel.
3. Leave Root Directory as `./` and let Vercel auto-detect Next.js.
4. Create a Neon PostgreSQL database.
5. Add the pooled `DATABASE_URL` to Vercel environment variables.
6. Add a strong `RECOVERY_SECRET`.
7. Deploy.
8. The first database initialization automatically creates the schema and a demo receiver using the deployed Vercel URL.

The queue consumer is configured in `vercel.json`. A queue trigger makes that route private to Vercel's queue infrastructure. Vercel Queues supports at-least-once delivery and delayed messages; this project uses the queue's delivery count together with its own database state machine to implement bounded webhook retries.

## API

```text
POST   /api/endpoints
GET    /api/endpoints
GET    /api/endpoints/:id
PATCH  /api/endpoints/:id
DELETE /api/endpoints/:id

POST   /api/events
GET    /api/events
GET    /api/events/:id
GET    /api/events/:id/attempts

GET    /api/dead-letters
POST   /api/dead-letters/:id/replay

GET    /api/metrics
GET    /api/health
POST   /api/recovery
```

## Reliability details

### Retries

Default retry behavior:

- `2xx`: delivered
- `408`: retry
- `429`: retry and honor `Retry-After` where possible
- `500`, `502`, `503`, `504`: retry
- timeouts/network errors: retry
- `400`, `401`, `403`, `422`: dead
- redirects: dead; redirects are not followed

Backoff is configurable and includes jitter to avoid a synchronized retry storm.

### Idempotency

Inbound event creation supports `Idempotency-Key`, so a client retry can safely return the existing event instead of creating another one.

Outbound delivery keeps one stable event ID across all retries. A destination should use that ID to deduplicate repeated deliveries.

### HMAC

Each outgoing request includes:

- `X-Sentinel-Event-Id`
- `X-Sentinel-Event-Type`
- `X-Sentinel-Timestamp`
- `X-Sentinel-Signature`

The signature is an HMAC-SHA256 over `timestamp + "." + rawBody` using the endpoint secret.

HMAC authenticates the sender and detects payload tampering; it does not encrypt the payload. HTTPS provides confidentiality.

### Worker recovery

A worker claim has a timeout. If a process is interrupted after claiming an event, a later queue delivery can recover the stale claim and continue. A protected manual recovery endpoint is available for events that were persisted in PostgreSQL but were not published to the queue. The dashboard exposes this recovery action.

## Security

Outbound destination URLs are validated before delivery. In production, loopback, private, link-local and other reserved network ranges are blocked, credentials in URLs are rejected, non-standard ports are rejected, redirects are not followed, and requests have a hard timeout.

The application is intentionally portfolio-sized and does not attempt to replace a hardened enterprise egress proxy or a full multi-tenant authentication system.

## Project structure

```text
sentinel-webhooks/
├── app/
│   ├── api/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
├── scripts/
├── tests/
├── Dockerfile
├── docker-compose.yml
├── next.config.ts
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

## Limitations

This is a portfolio-scale reliability system. It does not claim global multi-region failover, exactly-once delivery, unlimited throughput, or enterprise-grade identity/access management.
