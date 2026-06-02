# Behavioral Health CRM

Local-first CRM prototype for a behavioral health practice. It tracks referral sources, prospective patients, insurance verification, consultations, waitlist status, follow-ups, marketing campaigns, enterprise readiness tasks, and data integrations.

This is not production/HIPAA-ready yet. Use demo data until authentication, audit logging, encrypted database storage, backups, and HIPAA-compliant hosting/vendor agreements are implemented.

## Features

- Referral source tracking for physicians, schools, therapists, attorneys, hospitals, and community organizations.
- Prospective patient intake pipeline with insurance status, consultation status, waitlist, follow-up date, and estimated revenue.
- Follow-up task tracking for calls, emails, referral follow-ups, consultations, and outreach.
- Marketing campaign tracking for email, phone, community events, referral visits, and newsletters.
- Enterprise readiness backlog for security, compliance, data, deployment, reporting, and workflow work.
- Data integration backlog for EHR, calendar, email, SMS/phone, insurance verification, intake forms, website leads, contacts/CRM, and marketing APIs.
- Local JSON persistence for prototype use.

## Tech Stack

- Node.js 20+
- TypeScript
- Native Node HTTP server
- Zod validation
- Local JSON store

## Source Code

Important files:

- `src/behavioralHealthCrm/server.ts` - CRM API, local persistence, seeded records, and embedded browser UI.
- `scripts/Start-BehavioralHealthCrm.ps1` - optional Windows background launcher.
- `scripts/Stop-BehavioralHealthCrm.ps1` - optional Windows stop helper.
- `output/crm/behavioral-health-crm.json` - generated local CRM data file after first run.

## Install From GitHub

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
```

Optional environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Publish This Code To GitHub

From this project folder:

```bash
git init
git add .
git commit -m "Initial behavioral health CRM"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

If the repository already exists locally, skip `git init` and only add the remote if one is not already configured:

```bash
git remote -v
git remote add origin <your-github-repo-url>
```

## Build

```bash
npm run build
```

To emit runnable JavaScript into `dist/`:

```bash
npm run build:emit
```

## Start And Activate The UI

Start the CRM in the foreground:

```bash
npm run start:crm
```

Open:

```text
http://127.0.0.1:4290/
```

Health check:

```text
http://127.0.0.1:4290/api/health
```

CRM data API:

```text
http://127.0.0.1:4290/api/crm
```

### Windows Background Launcher

For a long-running Windows background process:

```powershell
npm run start:crm:windows
```

Stop it:

```powershell
npm run stop:crm
```

The Windows launcher may require permission to create a detached local process.

## Change The Port

Default port is `4290`.

Foreground:

```bash
BEHAVIORAL_HEALTH_CRM_PORT=4300 npm run start:crm
```

Windows PowerShell:

```powershell
$env:BEHAVIORAL_HEALTH_CRM_PORT = "4300"
npm run start:crm
```

Or pass a port directly after building:

```bash
npm run build:emit
node dist/behavioralHealthCrm/server.js --port=4300
```

## API Endpoints

- `GET /` - browser UI.
- `GET /api/health` - service health.
- `GET /api/crm` - full CRM state and summary.
- `POST /api/referral-sources` - create referral source.
- `POST /api/prospective-patients` - create prospective patient inquiry.
- `PATCH /api/prospective-patients/:id/status` - update inquiry and insurance status.
- `POST /api/activities` - create follow-up/activity.
- `POST /api/campaigns` - create campaign.
- `POST /api/enterprise-controls` - create enterprise readiness item.
- `POST /api/integrations` - create data integration item.

## Local Data

The prototype writes data to:

```text
output/crm/behavioral-health-crm.json
```

That file is intentionally ignored by Git so private local data is not committed.

## Production Readiness Checklist

Before entering real patient data or PHI, implement:

- Authentication and MFA.
- Role-based access control.
- Audit logs for reads, writes, exports, deletes, and syncs.
- PostgreSQL or another production database.
- Encryption at rest and in transit.
- Encrypted backups and tested restore process.
- HIPAA-compliant hosting and signed BAAs with vendors.
- Secure file storage for intake forms, insurance cards, and referral documents.
- Data retention, deletion, and legal hold policies.
- Monitoring, uptime checks, alerting, and incident response.
- Security/legal review before production launch.

## Suggested Data Integrations

The app includes editable integration records for:

- EHR/practice management: SimplePractice, TherapyNotes, Jane, IntakeQ, Tebra, Athena.
- Calendar: Google Calendar, Microsoft Outlook, or EHR scheduling.
- Email: Google Workspace, Microsoft 365, SendGrid.
- SMS/phone: Twilio, RingCentral, Dialpad.
- Insurance verification: Availity, Eligible, Waystar, Change Healthcare, payer APIs.
- Forms/intake: IntakeQ, Jotform HIPAA, Formstack, custom portal.
- Website leads: contact form webhook or custom endpoint.
- Contacts/CRM import: CSV, Google Contacts, HubSpot, Salesforce, spreadsheets.
- Marketing: Mailchimp, Constant Contact, Microsoft 365 campaigns.

Use only HIPAA-appropriate vendors and configurations when PHI may be involved.

## Verification

```bash
npm run build
npm run lint
```

There are currently no test files, so `npm test` will report that no tests were found.
