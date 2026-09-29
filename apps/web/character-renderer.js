(() => {
  const skins = {
    starter: { id: 'starter', name: 'Starter Core', primary: '#59e4ed', shell: '#edfaff', dark: '#071020', rarity: 'Ücretsiz' },
    neon: { id: 'neon', name: 'Neon Bloom', primary: '#df62ff', shell: '#2a174d', dark: '#100620', rarity: 'Nadir' },
    hex: { id: 'hex', name: 'Armored Hex', primary: '#4fdcff', shell: '#233958', dark: '#07131f', rarity: 'Nadir' },
    solar: { id: 'solar', name: 'Solar Crown', primary: '#ffb52e', shell: '#fff3dc', dark: '#2a1402', rarity: 'Destansı' },
    void: { id: 'void', name: 'Void Phantom', primary: '#9b63ff', shell: '#25164b', dark: '#080315', rarity: 'Destansı' },
    gold: { id: 'gold', name: 'Golden Sovereign', primary: '#ffd65a', shell: '#fff9e8', dark: '#241500', rarity: 'Efsanevi' }
  };

  function polygon(ctx, radius, sides, rotation = 0) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (Math.PI * 2 * i / sides);
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawCharacter(ctx, options) {
    const { x, y, radius, skinId = 'starter', time = 0, alpha = 1 } = options;
    const skin = skins[skinId] ?? skins.starter;
    const pulse = 1 + Math.sin(time * .002) * .018;
    const r = radius * pulse;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.shadowColor = skin.primary;
    ctx.shadowBlur = r * .72;

    if (skinId === 'void' || skinId === 'gold') {
      ctx.save();
      ctx.rotate(time * .00035);
      ctx.strokeStyle = skin.primary;
      ctx.globalAlpha *= .72;
      ctx.lineWidth = Math.max(2, r * .075);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.4, r * .9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.rotate(Math.PI / 2.7);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.32, r * .86, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    const satellites = skinId === 'neon' ? 6 : skinId === 'solar' || skinId === 'gold' ? 8 : 4;
    ctx.save();
    ctx.rotate((skinId === 'void' ? -1 : 1) * time * .00018);
    for (let i = 0; i < satellites; i++) {
      const angle = Math.PI * 2 * i / satellites;
      const distance = r * (skinId === 'gold' ? 1.18 : 1.02);
      ctx.save();
      ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = skin.shell;
      ctx.strokeStyle = skin.primary;
      ctx.lineWidth = Math.max(1.5, r * .055);
      if (skinId === 'neon') {
        ctx.beginPath(); ctx.moveTo(0, -r * .38); ctx.quadraticCurveTo(r * .34, 0, 0, r * .34); ctx.quadraticCurveTo(-r * .34, 0, 0, -r * .38); ctx.closePath();
      } else if (skinId === 'hex') polygon(ctx, r * .31, 6, Math.PI / 6);
      else if (skinId === 'solar' || skinId === 'gold') { ctx.beginPath(); ctx.moveTo(0, -r * .46); ctx.lineTo(r * .28, r * .24); ctx.lineTo(-r * .28, r * .24); ctx.closePath(); }
      else { ctx.beginPath(); ctx.roundRect(-r * .27, -r * .34, r * .54, r * .68, r * .2); }
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    ctx.fillStyle = skin.shell;
    ctx.strokeStyle = skin.primary;
    ctx.lineWidth = Math.max(2, r * .09);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (skinId === 'hex') {
      ctx.fillStyle = '#162b44'; polygon(ctx, r * .79, 10, Math.PI / 10); ctx.fill();
      ctx.strokeStyle = '#83edff'; ctx.lineWidth = Math.max(1, r * .025); ctx.stroke();
    } else {
      const face = ctx.createRadialGradient(-r * .2, -r * .28, 0, 0, 0, r * .8);
      face.addColorStop(0, skin.primary);
      face.addColorStop(.48, skin.dark);
      face.addColorStop(1, '#02050d');
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(0, 0, r * .72, 0, Math.PI * 2); ctx.fill();
    }

    ctx.shadowBlur = r * .28;
    ctx.fillStyle = '#ffffff';
    const eyeX = r * .25, eyeY = -r * .05, eyeRx = Math.max(2, r * .105), eyeRy = Math.max(3, r * .18);
    ctx.beginPath(); ctx.ellipse(-eyeX, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2); ctx.ellipse(eyeX, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  window.SwarmCharacters = { skins, drawCharacter };
})();
