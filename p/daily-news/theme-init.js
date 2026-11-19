(() => {
  'use strict';
  const root = document.documentElement;
  const ok = v => v === 'spring' || v === 'summer' || v === 'autumn' || v === 'winter';
  let scheme = null;
  let season = null;
  try {
    scheme = localStorage.getItem('StackColorScheme');
    season = localStorage.getItem('TachikaSeason');
  } catch {}
  try {
    root.dataset.scheme =
      scheme === 'dark' || (scheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
  } catch {
    root.dataset.scheme = scheme === 'dark' ? 'dark' : 'light';
  }
  if (!ok(season)) {
    try {
      const q = new URLSearchParams(location.search).get('season');
      if (ok(q)) season = q;
    } catch {}
  }
  if (!ok(season)) {
    const m = new Date().getMonth() + 1;
    season = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  }
  root.dataset.season = season;
})();
