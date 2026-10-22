# Cxyledge

Cylinder inventory, billing and company management.

This repository holds the app's full source as plain files. Vercel runs `npm ci` and `npm run build` on every commit to `main` (see `vercel.json`); the build also applies any new database migrations from `migrations/`. The database is Neon Postgres, connected from Vercel's Storage tab, which provides `DATABASE_URL`.

- `src/components/yard/` — the screens (Book, Customers, Bills, Stock, Analytics, Users, Settings)
- `src/lib/inventory/` — data access, billing, stock, sync and offline logic
- `migrations/` — database changes, applied in order
- `public/` — icons, service worker, privacy and terms pages
