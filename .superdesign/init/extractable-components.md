# Extractable Components

The current vanilla implementation has no source-level reusable components. The following markup patterns can become reusable responsive components during the redesign.

## GameHud
- Source: `apps/web/game.html`
- Category: layout
- Description: Top arena bar with brand, connection state, and energy score.
- Extractable props: connectionState, score
- Hardcoded: SWARM.IO wordmark, energy label, CSS classes

## LeaderboardPanel
- Source: `apps/web/game.html`
- Category: layout
- Description: Floating top-five arena ranking panel.
- Extractable props: players, currentPlayerId
- Hardcoded: heading and row structure

## LobbyShell
- Source: `apps/web/index.html`
- Category: layout
- Description: Responsive lobby with hero, login form, and feature panel.
- Extractable props: nickname, status
- Hardcoded: SWARM.IO wordmark, tagline, CTA label

## ResultCard
- Source: `apps/web/game.html`
- Category: basic
- Description: Post-match rank, score, kills, and coin reward dialog.
- Extractable props: rank, score, kills, coins
- Hardcoded: result labels and navigation actions
