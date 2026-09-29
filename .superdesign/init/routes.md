# Routes

The API serves static files from `apps/web` (copied to the API output as `web`) and falls back to `index.html`.

| URL | File | Purpose |
| --- | --- | --- |
| `/` | `apps/web/index.html` | Lobby, nickname entry, play CTA |
| `/game.html` | `apps/web/game.html` | Real-time arena canvas and match HUD |

There is no client router. Navigation uses normal links and `location.href`.
