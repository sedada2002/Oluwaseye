# Consulting Firm OS

## Purpose

Local operating system for the AI/IT consulting business. It presents consulting offers, agent blueprints, prospecting workflows, outreach drafts, and recruiting intelligence.

## Source

- `src/projects/consultingFirm/server.ts`
- Shared consulting assets: `src/consultingFirm/`
- Shared prospecting engine: `src/prospecting/`
- Shared recruiting engine: `src/recruiting/`

## Run

```bash
npm run start:consulting:foreground
```

Windows background launcher:

```powershell
npm run start:consulting
npm run stop:consulting
```

Open:

```text
http://127.0.0.1:4280/
http://127.0.0.1:4280/prospects
http://127.0.0.1:4280/recruiting
```

## API

- `GET /api/health`
- `GET /api/consulting/assets`
- `GET /api/prospects/store`
- `POST /api/prospects/run`
- `GET /api/recruiting/jobs`
- `POST /api/recruiting/jobs/run`

## Data

Generated prospecting and recruiting output is written under:

```text
output/prospecting/
output/recruiting/
```

## Live Data

For live prospecting, set:

```bash
GOOGLE_PLACES_API_KEY=your-key
```

Without that key, the prospecting pipeline uses seed data.
