# SWARM.IO Cloudflare deployment

This package serves `apps/web` and runs the persistent account API plus the realtime arena in a SQLite-backed Durable Object.

```powershell
npm install
npm run check
npm run dev
npm run deploy
```

The deployment uses the Cloudflare free plan and does not require an external SQL server. Web payments remain disabled. Native store purchase verification is intentionally kept closed until Apple/Google verification secrets are configured.
