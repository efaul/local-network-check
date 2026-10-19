# local-net-check dashboard

React + TypeScript + Vite frontend for the local-net-check central server.
Hash-routed (`#/backbone`, `#/rooms`, `#/rooms/:location`), matching the
server's API 1:1 — see `../src/shared/contract.d.ts` for the wire contract
(duplicated in `src/types.ts` so this stays a self-contained build).

## Develop

```bash
npm install
npm run dev
```

The dev server proxies `/api/*` to `http://localhost:8787` by default
(override with `VITE_BACKEND`). Run the central server
(`npm run server` from the repo root) alongside it.

## Build

```bash
npm run build
```

Outputs straight into `../public`, which the central server serves as
static files.
