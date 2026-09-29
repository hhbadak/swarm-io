# Page Dependency Trees

## `/` — Lobby

Entry: `apps/web/index.html`

Dependencies:
- `apps/web/styles.css`
- `apps/web/app.js`

## `/game.html` — Arena

Entry: `apps/web/game.html`

Dependencies:
- `apps/web/styles.css`
- `apps/web/game.css`
- `apps/web/game.js`

Both pages are standalone vanilla HTML pages. They import no local JavaScript modules.
