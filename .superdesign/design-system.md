# SWARM.IO Responsive Game Design System

## Product and experience

SWARM.IO is a fast top-down multiplayer grow-and-hunt arena game. One responsive browser client serves desktop web and mobile/PWA layouts. Players enter a nickname, choose a cosmetic character, play, earn gold, and collect purely cosmetic skins and effects. Purchases never affect speed, hitbox, growth, score, or combat.

Primary surfaces:

1. Lobby: profile/currency bar, large character preview, nickname, play CTA, compact collection/store entry points.
2. Collection/store: character categories, live preview, owned/equipped state, gold/gem prices, explicit “Sadece kozmetik” trust note.
3. Arena: full-bleed Canvas, compact HUD, leaderboard, mobile touch control and dash action.
4. Results: rank, score, kills, earned gold, replay and collection/store shortcuts.

## Brand direction

Use a Neural Noir-inspired glass interface while preserving SWARM.IO's existing cyan/violet identity. The style source contributes dark depth, dot/grid texture, translucent panels, wide-tracked labels, radial glow, and premium spacing. Do not import its serif typography or bronze palette.

- Background: `#030611`, `#050819`, `#090d25` with a subtle 32px energy grid/dot field.
- Surface: `rgba(8,13,36,.82)` and `rgba(13,18,48,.88)` with `backdrop-filter: blur(14px)`.
- Border: `#29325e`; active cyan border `rgba(89,228,237,.7)`; premium gold border `rgba(245,201,108,.55)`.
- Primary cyan: `#59e4ed`; CTA blue: `#478aff`; violet: `#b69cff`; magenta danger: `#ff6eb4`; reward gold: `#f5c96c`.
- Text: `#f6f8ff`; secondary `#b7bfdc`; muted `#8f9aba`.
- Glow: cyan `0 0 40px rgba(89,228,237,.22)`; violet `0 0 56px rgba(182,156,255,.18)`; gold `0 0 48px rgba(245,201,108,.24)`.

## Typography

Use only `Inter, system-ui, sans-serif`.

- Display/brand: 800–900 weight, tight tracking, slightly italic only for the main SWARM.IO wordmark.
- Section headings: 700–900, compact, never serif.
- Utility labels: 10–12px, uppercase, `letter-spacing: .14em` to `.22em`.
- Body: 13–16px, normal tracking, high contrast.

## Shape and components

- Main glass panels: 20–28px radius.
- Compact cards: 14–18px radius.
- Buttons: 14–18px radius, bold uppercase label, minimum 48px touch height.
- Primary action: blue-to-cyan restrained gradient; hover adds cyan border/glow, not a new hue.
- Currency chips: circular gold or crystal icon plus numeric balance.
- Cosmetic cards: square preview, name, rarity, price/owned/equipped state. Selected card gets cyan or gold outline.
- Avoid loot-box roulette, casino visual language, fake countdowns, fake discounts, or power/stat indicators.

## Character visual language

The Starter is a charming top-down energy robot, never a biological cell. It has a circular cyan face/core, white segmented shell, four symmetric pods at north/east/south/west, two small glowing eyes, and a thin outer energy ring. There is no tail and no elongated body.

Every skin remains perfectly radial and uses the same gameplay hitbox. Growth scales width and height uniformly. At larger sizes armor plates separate outward slightly and the energy ring becomes stronger. Eyes scale more slowly so the face remains friendly. Cosmetic trails must be detached fading particles, never a solid tail.

Catalog direction:

- Starter Core: free and owned by everyone.
- Neon Bloom: violet petals, 200 gold so a new player can make one first-session purchase.
- Armored Hex: cyan hex plates, 450 gold.
- Solar Crown: gold/orange rays, 900 gold.
- Void Phantom: violet orbit rings, 220 gems.
- Golden Sovereign: white/gold crown and orbit rings, 350 gems.

## Responsive layout

The visual design, catalog, copy, character artwork, and component styling are identical on web and mobile. Only layout and control placement adapt.

Desktop (`> 900px`): lobby/store uses a 3-column composition — left navigation, central character preview, right profile/purchase panel. Arena leaderboard floats on the right.

Tablet (`600–900px`): navigation becomes a compact top row; preview remains primary; catalog uses 3 columns.

Mobile (`< 600px`): single-column layout; compact fixed top bar; character preview first; play CTA full width; store categories horizontally scroll; catalog uses 2 columns; purchase action remains reachable near the bottom. Arena uses a left virtual joystick zone, right dash button, a smaller collapsible leaderboard, and safe-area padding.

No mobile page is a separate visual product. Desktop and mobile must use the same tokens and content hierarchy.

## Motion

- Standard transition: `180–260ms cubic-bezier(.4,0,.2,1)`.
- Character idle: gentle 2–3% breathing glow, not body distortion.
- Growth: smooth radial interpolation over roughly 300ms.
- Equip/purchase: one short ring pulse and particle sparkle.
- Reduce or disable nonessential motion under `prefers-reduced-motion`.

## Accessibility and gameplay constraints

- Minimum 4.5:1 contrast for text; focus-visible outlines in cyan.
- Minimum 44×44px interactive touch target.
- Never rely on hue alone for owned/equipped/locked states; always include text/icon state.
- Store overlays must never open during active movement input unless the match is paused/finished.
- Cosmetic rendering cannot change collision radius or gameplay attributes.
