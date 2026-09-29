# Shared UI Components

SWARM.IO currently uses framework-free HTML, CSS, and JavaScript. There is no shared component directory or imported component library yet. The reusable primitives are CSS classes defined in `apps/web/styles.css`:

- `.login-card`: player entry form card.
- `.feature-panel`: three-column feature/status card.
- `.hud`: shared in-match top status bar.
- `.leaderboard`: in-match ranking card.
- `.result-card`: post-match result dialog.
- `.ability-bar`: dash action control.

The actual implementations are included in full in `layouts.md` and `theme.md` because the markup is currently embedded directly in the page files.
