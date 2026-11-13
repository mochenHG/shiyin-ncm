// The spring sleeps once it settles. Ambient movement stays in compositor CSS animations.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const zone = document.getElementById('dropzone');
  const art = document.querySelector('.art-parallax');
  setTimeout(() => document.body.classList.add('entered'), 1500);
  let targetX = 0, targetY = 0, x = 0, y = 0, vx = 0, vy = 0, frame = 0, lastTime = 0;
  function tick(now) {
    const dt = Math.min((now - (lastTime || now - 16.67)) / 1000, .033);
    lastTime = now;
    vx += ((targetX - x) * 145 - vx * 16) * dt;
    vy += ((targetY - y) * 145 - vy * 16) * dt;
    x += vx * dt; y += vy * dt;
    art.style.setProperty('--tilt-x', (-y * 6).toFixed(3) + 'deg');
    art.style.setProperty('--tilt-y', (x * 10).toFixed(3) + 'deg');
    if (Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(vx) + Math.abs(vy) > .003) frame = requestAnimationFrame(tick);
    else { frame = 0; lastTime = 0; }
  }
  function moveTo(nextX, nextY) {
    if (reduced.matches || document.hidden) return;
    targetX = nextX; targetY = nextY;
    if (!frame) frame = requestAnimationFrame(tick);
  }
  zone.addEventListener('pointermove', event => {
    const rect = zone.getBoundingClientRect();
    moveTo((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
  });
  zone.addEventListener('pointerleave', () => moveTo(0, 0));
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button:not(:disabled)');
    const glyph = button?.querySelector('svg');
    if (glyph && !reduced.matches) glyph.animate([{ scale:1 }, { scale:.76, offset:.23 }, { scale:1.16, offset:.67 }, { scale:1 }], { duration:460, easing:'cubic-bezier(.22,.8,.3,1)' });
  });
  let themeTimer;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    document.documentElement.classList.add('theme-changing');
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => document.documentElement.classList.remove('theme-changing'), 500);
  });
  function resetSpring() {
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
    targetX = targetY = x = y = vx = vy = 0;
    art.style.setProperty('--tilt-x', '0deg'); art.style.setProperty('--tilt-y', '0deg');
  }
  reduced.addEventListener('change', () => { if (reduced.matches) resetSpring(); });
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('motion-paused', document.hidden);
    if (document.hidden) resetSpring();
  });
})();
