# Privacy And PII Handling

## Current CRM Behavior

The Behavioral Health CRM prototype is local-first:

- CRM records are stored in `output/crm/behavioral-health-crm.json`.
- The CRM server does not send CRM records to third-party vendors.
- Browser requests go to local `/api/...` endpoints served by the same local app.
- Integration records are planning metadata only; they do not call external APIs.
- Seed records are fictional and use non-routable `example.invalid` email addresses.

## Third-Party Vendor Rule

Do not add connector code that sends patient, guardian, referral source, phone, email, insurance, appointment, notes, or revenue-pipeline data to a third party unless all of the following are true:

- Authentication and role-based access are implemented.
- Audit logging records who triggered the export/sync.
- Data is encrypted in transit and at rest.
- A signed BAA exists when PHI may be involved.
- The connector has an explicit minimum-necessary data mapping.
- The connector is documented in `src/projects/crm/README.md`.
- The connector can be disabled by configuration.

## Source Control Rule

Do not commit:

- Real patient, guardian, or referral source data.
- Real phone numbers, emails, insurance IDs, or appointment details.
- API keys, access tokens, secrets, passwords, or private certificates.
- Generated runtime data under `output/`.
- Local runtime/cache folders such as `.tools/`, `.cache/`, `node_modules/`, or `dist/`.

## GitHub Metadata Note

Git commit author names and emails are visible on GitHub unless the account is configured to use a GitHub no-reply email address. This is separate from source-code PII.
