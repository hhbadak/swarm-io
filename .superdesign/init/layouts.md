# Shared Layouts

There is no framework layout component. The two complete page shells are below.

## `apps/web/index.html` — Lobby shell

```html
<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SWARM.IO — Grow · Hunt · Rule</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="shell"><section class="hero"><p class="eyebrow">GROW · HUNT · RULE</p><h1>SWARM<span>.IO</span></h1><p class="lead">Küçük başla. Enerjiyi topla. Arenanın zirvesine çık.</p><form id="login-form" class="login-card"><label for="nickname">Avcı adın</label><input id="nickname" maxlength="24" autocomplete="nickname" value="Nova" required><button type="submit">ARENAYA GİR</button><p id="status" role="status">Sunucu bağlantısı bekleniyor.</p></form></section><aside class="feature-panel"><div><strong>20 Hz</strong><span>Authoritative server</span></div><div><strong>WSS</strong><span>Gerçek zamanlı hareket</span></div><div><strong>FAIR</strong><span>Client skora karar vermez</span></div></aside></main><script src="/app.js" defer></script></body></html>
```

## `apps/web/game.html` — Arena shell

```html
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Arena — SWARM.IO</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/game.css">
</head>
<body class="game-page">
  <canvas id="arena"></canvas>
  <header class="hud">
    <a href="/">SWARM.IO</a>
    <div class="match-state"><span id="connection">BAĞLANIYOR</span><span id="danger">ENERJİ TOPLA · BÜYÜ · AVCILA</span></div>
    <div class="hud-score"><strong id="score">0</strong><span>ENERJİ</span></div>
  </header>
  <aside id="leaderboard" class="leaderboard"><h2>LİDERLİK</h2><ol></ol></aside>
  <div class="ability-bar"><button id="dash" type="button"><b>ATIL</b><span>SPACE</span></button></div>
  <div class="instructions">Fare/dokunma ile yön ver · WASD veya yön tuşları · SPACE ile atıl</div>
  <section id="game-over" class="game-over" hidden>
    <div class="result-card"><p>RUN OVER</p><h1 id="final-rank">#—</h1><div class="result-stats"><span><b id="final-score">0</b> SKOR</span><span><b id="final-kills">0</b> AVLAMA</span><span class="reward"><b id="final-coins">0</b> ALTIN</span></div><button id="play-again" type="button">TEKRAR OYNA</button><a href="/">ANA MENÜ</a></div>
  </section>
  <script src="/game.js" defer></script>
</body>
</html>
```
