# Healthcare Operations Project Workspace

This repository is organized as three separate TypeScript projects that share common backend modules where useful.

## Projects

| Project | Source | Guide | Default URL |
| --- | --- | --- | --- |
| Behavioral Health CRM | `src/projects/crm` | `src/projects/crm/README.md` | `http://127.0.0.1:4290/` |
| Consulting Firm OS | `src/projects/consultingFirm` | `src/projects/consultingFirm/README.md` | `http://127.0.0.1:4280/` |
| OmniVest | `src/projects/omnivest` | `src/projects/omnivest/README.md` | `http://127.0.0.1:4174/` |

Shared modules live outside those project folders:

- `src/domain` - brokerage, portfolio engine, execution coordination.
- `src/infrastructure` - persistence and security adapters.
- `src/prospecting` - prospect discovery, scoring, exporting, outreach drafts.
- `src/recruiting` - job signal and candidate matching utilities.
- `src/shared` - shared money and error helpers.

Generated data, compiled output, local runtimes, and private environment files are ignored by Git.

## CRM Planning And Privacy Docs

- `docs/crm/DISCOVERY.md`
- `docs/crm/PRD.md`
- `PRIVACY.md`

## Install

```bash
npm install
```

Optional:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Verify

```bash
npm run build
npm run lint
npm run build:emit
```

There are currently no test files, so `npm test` will report that no tests were found.

## Run CRM

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

## Run Consulting Firm OS

```bash
npm run start:consulting:foreground
```

Open:

```text
http://127.0.0.1:4280/
```

Windows background launcher:

```powershell
npm run start:consulting
npm run stop:consulting
```

## Run OmniVest

```bash
npm run start:trading
```

Open:

```text
http://127.0.0.1:4174/
```

## Publish To GitHub

```bash
git add .
git commit -m "Update separated project structure"
git push
```

## Production Notes

The CRM is not production/HIPAA-ready yet. Do not enter real PHI until authentication, role-based access, audit logs, encrypted database storage, encrypted backups, HIPAA-compliant hosting, BAAs, and monitoring are implemented.

OmniVest is a mock trading harness. Do not connect it to live trading without production brokerage integration, durable persistence, authentication, audit logging, risk controls, and compliance review.
