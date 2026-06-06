# Behavioral Health CRM Discovery

## 1. Background

Behavioral health practices depend on high-trust relationships with referral sources, prospective patients, families, insurers, schools, hospitals, attorneys, therapists, and community organizations. Many small practices manage these relationships across email, spreadsheets, calendars, intake forms, phone notes, and EHR tools. That creates missed follow-ups, unclear referral attribution, incomplete insurance verification, and limited visibility into pipeline health.

This CRM is intended to centralize business relationship management while keeping clinical systems and PHI-heavy workflows separate until production privacy controls are implemented.

## 2. Business Goals

- Track referral sources and relationship strength.
- Track prospective patient inquiries from first contact through conversion or closure.
- Monitor insurance verification status.
- Manage scheduled consultations and waitlist movement.
- Track outreach and referral follow-up tasks.
- Track marketing campaigns and response rates.
- Estimate revenue pipeline from active inquiries.
- Maintain an enterprise-readiness backlog for security, compliance, deployment, and operations.
- Maintain a data-integration backlog for EHR, calendar, email, SMS, insurance, forms, website leads, contacts, and marketing tools.

## 3. Primary Users

- Practice owner or executive lead.
- Intake coordinator.
- Referral relationship manager.
- Billing or insurance verification staff.
- Marketing or community outreach staff.
- Future administrator responsible for compliance and system configuration.

## 4. Key Workflows

### Referral Source Management

Users need to record referral source type, organization, contact person, relationship stage, notes, follow-up date, and referral count.

Referral source categories include:

- Primary care physicians.
- Schools.
- Therapists.
- Attorneys.
- Hospitals.
- Community organizations.
- Online sources.
- Other sources.

### Prospective Patient Intake

Users need to record a minimum-necessary inquiry profile, service need, insurance provider, insurance status, referral source, consultation date, waitlist status, next follow-up date, and estimated revenue.

Current inquiry statuses:

- New inquiry.
- Insurance verification.
- Consult scheduled.
- Waitlist.
- Converted.
- Closed.

### Follow-Up Management

Users need a way to create and review calls, emails, referral follow-ups, consultations, outreach tasks, due dates, completion dates, and outcomes.

### Marketing And Outreach

Users need basic campaign tracking for email, phone, community events, referral visits, and newsletters. The CRM should track audience, campaign status, sent count, response count, and notes.

### Enterprise Readiness

Users need visible readiness tasks for:

- Authentication.
- Role-based access.
- Audit logs.
- HIPAA-ready hosting and BAAs.
- Encrypted database storage.
- Encrypted backups and restore testing.
- Data retention and deletion policy.
- Secure file handling.
- Duplicate detection and validation.
- Production deployment.
- Referral and revenue reporting.
- Security review before PHI.

### Data Integrations

Users need a planning list for vendor/API integrations:

- EHR and practice management.
- Calendar scheduling.
- Email outreach.
- SMS and phone.
- Insurance verification.
- Secure intake forms.
- Website lead capture.
- Contact or CRM imports.
- Marketing campaigns.

Integration records are planning metadata only in the current prototype. No CRM records are transmitted to third-party vendors.

## 5. Privacy And Compliance Discovery

The prototype must remain local-only until production controls are implemented. The system should not expose patient, guardian, referral source, phone, email, insurance, appointment, notes, or revenue-pipeline data to third-party vendors without explicit connector review and compliance controls.

Required before real PHI/PII use:

- Authentication.
- Role-based access control.
- Audit logging for read/write/export/delete/sync events.
- Encrypted database.
- Encrypted backups.
- Secure file storage.
- HIPAA-compliant hosting.
- Signed BAAs with applicable vendors.
- Minimum-necessary data mapping for every integration.
- Monitoring and incident response.

## 6. Current Prototype Capabilities

- Local HTTP UI.
- Local JSON persistence.
- Referral source CRUD creation.
- Prospective patient creation.
- Prospective patient status update.
- Activity/follow-up creation.
- Campaign creation.
- Enterprise readiness creation.
- Integration planning creation.
- Summary dashboard.
- Privacy endpoint documenting local-only behavior.

## 7. Current Gaps

- No authentication.
- No role-based access.
- No audit logs.
- No production database.
- No encryption at rest for local JSON.
- No secure file storage.
- No real vendor connectors.
- No test suite.
- No deployment environment.
- No backup/restore workflow.
- No duplicate detection.
- No advanced reporting.

## 8. Success Measures

- Intake staff can see every active inquiry and next follow-up.
- Referral manager can identify top referral sources and dormant relationships.
- Owner can estimate active pipeline revenue.
- Billing/intake staff can track insurance verification bottlenecks.
- Outreach staff can track campaigns and response rate.
- Compliance/admin owner can see production-readiness gaps.
- No third-party vendor receives CRM data unless an approved connector is explicitly implemented.
