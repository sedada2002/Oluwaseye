# Behavioral Health CRM Product Requirements Document

## 1. Product Summary

The Behavioral Health CRM is a local-first relationship management application for a behavioral health practice. It centralizes referral source tracking, prospective patient pipeline tracking, insurance verification status, consultations, waitlist movement, follow-ups, marketing campaigns, enterprise readiness, and integration planning.

The current product must not send CRM data to third-party vendors. Vendor integration records are planning records only until production privacy and compliance controls are implemented.

## 2. Objectives

- Provide a usable CRM dashboard for practice relationship management.
- Reduce missed inquiry and referral follow-ups.
- Improve visibility into insurance verification and consultation pipeline.
- Track marketing and community outreach response.
- Track enterprise readiness tasks required before production use.
- Track future API integrations without sending data externally.
- Keep source code and seed data free of personal identifiers.

## 3. Non-Goals

- No production PHI processing in the current version.
- No real EHR, insurance, email, SMS, calendar, form, marketing, or CRM sync in the current version.
- No automated marketing send.
- No clinical documentation.
- No billing claims submission.
- No live trading or unrelated financial workflow changes.

## 4. User Roles

### Practice Owner

Needs pipeline visibility, referral source performance, revenue estimate, and readiness status.

### Intake Coordinator

Needs to create inquiries, update status, manage follow-ups, and track consultations/waitlist.

### Referral Relationship Manager

Needs to create referral sources, log follow-ups, and manage outreach.

### Billing Or Insurance Staff

Needs to track insurance verification status and next action.

### Compliance/Admin Owner

Needs to track production-readiness controls, vendor readiness, and integration risk.

## 5. Functional Requirements

### FR-1 Dashboard Summary

The system must show:

- Referral source count.
- Active lead count.
- Pending insurance count.
- Scheduled consultation count.
- Waitlist count.
- Open follow-up count.
- Enterprise readiness gap count.
- Live integration count.
- Estimated pipeline revenue.

### FR-2 Referral Sources

The system must allow users to create and list referral source records with:

- Name.
- Type.
- Organization.
- Contact name.
- Email.
- Phone.
- Relationship stage.
- Notes.
- Referral count.
- Last contact date.

### FR-3 Prospective Patient Inquiries

The system must allow users to create and list prospective inquiry records with:

- Display name or initials.
- Guardian/contact name.
- Phone.
- Email.
- Referral source.
- Service need.
- Insurance provider.
- Insurance status.
- Inquiry status.
- Consultation date.
- Estimated monthly revenue.
- Next follow-up date.
- Notes.

### FR-4 Status Updates

The system must allow users to update:

- Inquiry status.
- Insurance status.
- Next follow-up date.

### FR-5 Follow-Ups And Activities

The system must allow users to create and list:

- Calls.
- Emails.
- Referral follow-ups.
- Consultations.
- Community outreach.
- Tasks.

Each activity must include related record type, related record ID, type, due date, completion date, summary, and outcome.

### FR-6 Marketing Campaigns

The system must allow users to create and list campaigns with:

- Name.
- Channel.
- Audience.
- Status.
- Sent count.
- Response count.
- Start date.
- Notes.

### FR-7 Enterprise Readiness

The system must allow users to create and list readiness controls with:

- Title.
- Category.
- Status.
- Owner.
- Priority.
- Notes.

Seeded categories must include security, compliance, data, operations, deployment, workflow, and reporting.

### FR-8 Data Integrations

The system must allow users to create and list integration planning records with:

- Name.
- Category.
- Status.
- Vendor options.
- API need.
- Privacy/HIPAA notes.
- Next step.

The current system must not call vendor APIs from integration records.

### FR-9 Privacy Endpoint

The system must expose `GET /api/privacy` describing local-only CRM behavior, vendor policy, production gate, and seed-data policy.

## 6. Non-Functional Requirements

### NFR-1 Privacy

The source code must not contain real patient, guardian, referral source, owner, staff, phone, email, insurance, or appointment details.

### NFR-2 Local-Only Prototype

CRM data must stay in local storage unless an explicitly reviewed connector is implemented.

### NFR-3 Validation

Incoming create/update requests must be validated before persistence.

### NFR-4 Maintainability

CRM, Consulting Firm OS, and OmniVest must remain separated into project folders with separate README files.

### NFR-5 Git Hygiene

Runtime data, build output, cache folders, dependencies, logs, and private environment files must not be committed.

## 7. Data Model

Current prototype entities:

- `ReferralSource`.
- `ProspectivePatient`.
- `Activity`.
- `Campaign`.
- `EnterpriseControl`.
- `DataIntegration`.

Current storage:

```text
output/crm/behavioral-health-crm.json
```

Future production storage:

- PostgreSQL.
- Encrypted backups.
- Migration system.
- Audit-log table.
- Optional secure object storage for documents.

## 8. API Requirements

- `GET /`
- `GET /api/health`
- `GET /api/privacy`
- `GET /api/crm`
- `POST /api/referral-sources`
- `POST /api/prospective-patients`
- `PATCH /api/prospective-patients/:id/status`
- `POST /api/activities`
- `POST /api/campaigns`
- `POST /api/enterprise-controls`
- `POST /api/integrations`

All API responses must return JSON except the UI route.

## 9. Security And Compliance Requirements Before Production

Required before real PHI/PII use:

- Authentication.
- MFA option.
- Role-based access.
- Audit logs for reads, writes, exports, deletes, and syncs.
- Encrypted database.
- Encrypted backups and restore testing.
- HTTPS-only deployment.
- HIPAA-compliant hosting.
- Vendor BAAs.
- Secure file storage.
- Data retention and deletion policy.
- Security review.
- Incident response plan.

## 10. Integration Requirements Before Vendor Sync

Every future connector must define:

- Vendor name.
- Vendor BAA status.
- Authentication method.
- Data fields sent.
- Data fields received.
- Minimum-necessary justification.
- Audit event type.
- Error handling.
- Disable/kill switch.
- Test plan.

## 11. Release Plan

### Phase 1: Local Prototype

- Current local UI.
- JSON persistence.
- Seeded synthetic records.
- Local-only privacy behavior.
- README, Discovery, and PRD.

### Phase 2: Production Foundation

- Auth.
- RBAC.
- Postgres.
- Audit logs.
- Encryption.
- Backups.
- Deployment.

### Phase 3: Operational Workflows

- Duplicate detection.
- Advanced reporting.
- Intake form workflow.
- Waitlist management improvements.
- Export controls.

### Phase 4: Approved Integrations

- Calendar connector.
- EHR connector.
- Insurance verification connector.
- Email/SMS connector.
- Website lead connector.

## 12. Acceptance Criteria

- CRM UI loads at `http://127.0.0.1:4290/`.
- `GET /api/health` returns service `behavioral-health-crm`.
- `GET /api/privacy` returns local-only and vendor-policy language.
- Users can create referral sources, inquiries, activities, campaigns, readiness controls, and integrations.
- Users can update inquiry status.
- Seed data is synthetic and does not contain real personal identifiers.
- `npm run build` passes.
- `npm run lint` passes.
- `npm run privacy:scan` passes.
- GitHub CI runs build, lint, privacy scan, and emitted build.
