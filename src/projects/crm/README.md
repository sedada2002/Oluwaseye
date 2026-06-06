# Behavioral Health CRM

## Purpose

CRM for a behavioral health practice. Tracks referral sources, prospective patient inquiries, insurance verification, consultations, waitlist status, follow-ups, marketing campaigns, false declines, fraud alerts, disputes, enterprise readiness, and data integrations.

## Source

- `src/projects/crm/server.ts`

## Planning Docs

- `docs/crm/DISCOVERY.md`
- `docs/crm/PRD.md`
- `PRIVACY.md`

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
- `GET /api/privacy`
- `GET /api/crm`
- `POST /api/referral-sources`
- `POST /api/prospective-patients`
- `PATCH /api/prospective-patients/:id/status`
- `POST /api/activities`
- `POST /api/campaigns`
- `POST /api/revenue-cases`
- `PATCH /api/revenue-cases/:id/status`
- `POST /api/enterprise-controls`
- `POST /api/integrations`

## Production Notes

Do not enter real PHI until authentication, RBAC, audit logs, encrypted database storage, encrypted backups, HIPAA-compliant hosting, BAAs, and production monitoring are implemented.

## PII And Vendor Data Policy

- The CRM prototype stores records locally in `output/crm/behavioral-health-crm.json`.
- The CRM server does not transmit CRM records to third-party vendors.
- Data integration records are planning metadata only. Creating or marking an integration as `Live` does not call a vendor API.
- Seed records are fictional placeholders and use non-routable `example.invalid` email addresses.
- Any future EHR, email, SMS, calendar, form, insurance, or marketing connector must pass an explicit privacy review before it can send patient, guardian, referral, phone, email, insurance, or appointment data outside the local app.
- PHI/PII export must require authentication, role-based access, audit logging, encryption, a signed BAA where applicable, and a minimum-necessary data mapping.
