# Behavioral Health CRM

## Purpose

CRM for a behavioral health practice. Tracks referral sources, prospective patient inquiries, insurance verification, consultations, waitlist status, follow-ups, marketing campaigns, enterprise readiness, and data integrations.

## Source

- `src/projects/crm/server.ts`

## Run

```bash
npm run start:crm
```

Open:

```text
http://127.0.0.1:4290/
```

Windows background launcher:

```powershell
npm run start:crm:windows
npm run stop:crm
```

## Local Data

Generated data is stored in:

```text
output/crm/behavioral-health-crm.json
```

## API

- `GET /api/health`
- `GET /api/crm`
- `POST /api/referral-sources`
- `POST /api/prospective-patients`
- `PATCH /api/prospective-patients/:id/status`
- `POST /api/activities`
- `POST /api/campaigns`
- `POST /api/enterprise-controls`
- `POST /api/integrations`

## Production Notes

Do not enter real PHI until authentication, RBAC, audit logs, encrypted database storage, encrypted backups, HIPAA-compliant hosting, BAAs, and production monitoring are implemented.
