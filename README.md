# Gustie Guide Tracker (Vite + React)

Static SPA for GitHub Pages. Supabase is called from the browser with the **anon** key and RPC functions (see `supabase/migrations/002_uplimit_dashboards_anon_rpc.sql`).

## Local dev

```bash
cd web
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/`).

## Production build

```bash
npm run build
npm run preview   # optional: test production bundle locally
```

## GitHub Pages

- Repo name should be **`gustie-guide-tracker`** (or change `base` in `vite.config.ts` and `homepage` in `package.json` to match your repo).
- Replace `YOUR-GITHUB-USERNAME` in `package.json` → `homepage`.
- **Settings → Pages → Source:** GitHub Actions.
- Add repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Run SQL migration `002_uplimit_dashboards_anon_rpc.sql` in the Supabase SQL editor.

Share links and assets use the `/gustie-guide-tracker/` base path in production builds only.
