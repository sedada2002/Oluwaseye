# OmniVest

## Purpose

Mock stock-trading and portfolio-rebalance harness. It demonstrates portfolio allocation math, cash-buffer protection, slippage checks, mock order execution, and order ledger state transitions.

## Source

- `src/projects/omnivest/server.ts`
- Shared domain modules: `src/domain/`
- Shared infrastructure modules: `src/infrastructure/`
- Shared money helpers: `src/shared/`

## Run

```bash
npm run start:trading
```

Windows launcher:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-OmniVest.ps1 -NoBrowser
```

Open:

```text
http://127.0.0.1:4174/
```

## API

- `GET /api/health`
- `GET /api/mock/portfolio`
- `POST /api/rebalance`
- `POST /api/execute`

## Notes

This app uses in-memory mock brokerage, quotes, locks, and order ledger state. Connect real brokerage, Redis, PostgreSQL, authentication, audit logging, and risk controls before any live trading use.
