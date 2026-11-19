(() => {
  'use strict';

  const root = document.documentElement;
  const SEASON_KEY = 'TachikaSeason';
  const SCHEME_KEY = 'StackColorScheme';
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASON_LABELS = {
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬'
  };
  const SEASON_NAMES = {
    spring: '春 · 绯桃',
    summer: '夏 · 竹青',
    autumn: '秋 · 丹枫',
    winter: '冬 · 霁青'
  };

  const seasonBtn = document.getElementById('news-season-toggle');
  const schemeBtn = document.getElementById('news-scheme-toggle');
  const filterBtns = Array.from(document.querySelectorAll('.news-filter-btn[data-filter]'));
  const sectionsEl = document.getElementById('sections');
  const progressEl = document.getElementById('news-progress');
  const backTopBtn = document.getElementById('site-backtop');

  const darkQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  let switchTimer = null;

  function isValidSeason(value) {
    return SEASONS.includes(value);
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  }

  function pulseThemeTransition() {
    root.classList.add('is-theme-switching');
    if (switchTimer) window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => {
      root.classList.remove('is-theme-switching');
      switchTimer = null;
    }, 450);
  }

  function resolveSeason() {
    const cur = root.dataset.season;
    if (isValidSeason(cur)) return cur;
    const saved = readStorage(SEASON_KEY);
    if (isValidSeason(saved)) return saved;
    const m = new Date().getMonth() + 1;
    if (m === 12 || m <= 2) return 'winter';
    if (m <= 5) return 'spring';
    if (m <= 8) return 'summer';
    return 'autumn';
  }

  function syncSeasonUI(season) {
    if (!seasonBtn) return;
    const labelEl = seasonBtn.querySelector('.news-season-label');
    if (labelEl) labelEl.textContent = SEASON_LABELS[season] || '春';
    const desc = `切换季节主题（当前：${SEASON_NAMES[season] || season}）`;
    seasonBtn.setAttribute('aria-label', desc);
    seasonBtn.setAttribute('title', desc);
  }

  function applySeason(season, persist, animate) {
    if (!isValidSeason(season)) return;
    if (animate) pulseThemeTransition();
    root.dataset.season = season;
    if (persist) writeStorage(SEASON_KEY, season);
    syncSeasonUI(season);
    try {
      window.dispatchEvent(new CustomEvent('tachika:seasonchange', { detail: { season } }));
    } catch {}
  }

  function resolveScheme(pref) {
    if (pref === 'dark') return 'dark';
    if (pref === 'light') return 'light';
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }

  function syncSchemeUI(scheme) {
    if (!schemeBtn) return;
    const isDark = scheme === 'dark';
    const labelEl = schemeBtn.querySelector('.news-scheme-label');
    if (labelEl) labelEl.textContent = isDark ? '暗色' : '亮色';
    const desc = isDark ? '切换为亮色模式（当前：暗色）' : '切换为暗色模式（当前：亮色）';
    schemeBtn.setAttribute('aria-label', desc);
    schemeBtn.setAttribute('title', desc);
    schemeBtn.setAttribute('aria-pressed', String(isDark));
  }

  function applyScheme(scheme, persist, animate) {
    const resolved = scheme === 'dark' ? 'dark' : 'light';
    if (animate) pulseThemeTransition();
    root.dataset.scheme = resolved;
    if (persist) writeStorage(SCHEME_KEY, resolved);
    syncSchemeUI(resolved);
    try {
      window.dispatchEvent(new CustomEvent('onColorSchemeChange', { detail: resolved }));
    } catch {}
  }

  /* 1. 四季与明暗初始化及交互 */
  const initialSeason = resolveSeason();
  root.dataset.season = initialSeason;
  syncSeasonUI(initialSeason);

  const initialScheme = resolveScheme(readStorage(SCHEME_KEY));
  root.dataset.scheme = initialScheme;
  syncSchemeUI(initialScheme);

  if (seasonBtn) {
    seasonBtn.addEventListener('click', () => {
      const cur = resolveSeason();
      const idx = SEASONS.indexOf(cur);
      const next = SEASONS[(idx + 1) % SEASONS.length];
      applySeason(next, true, true);
    });
  }

  if (schemeBtn) {
    schemeBtn.addEventListener('click', () => {
      const cur = root.dataset.scheme === 'dark' ? 'dark' : 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      applyScheme(next, true, true);
    });
  }

  window.addEventListener('storage', event => {
    if (event.key === SEASON_KEY && isValidSeason(event.newValue)) {
      applySeason(event.newValue, false, false);
    } else if (event.key === SCHEME_KEY) {
      applyScheme(resolveScheme(event.newValue), false, false);
    }
  });

  if (darkQuery) {
    const onMediaChange = () => {
      const authoritative = resolveScheme(readStorage(SCHEME_KEY));
      const commit = () => applyScheme(authoritative, false, false);
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(commit);
      } else {
        Promise.resolve().then(commit);
      }
    };
    if (typeof darkQuery.addEventListener === 'function') {
      darkQuery.addEventListener('change', onMediaChange);
    } else if (typeof darkQuery.addListener === 'function') {
      darkQuery.addListener(onMediaChange);
    }
  }

  /* 2. 国内 / 国际筛选 + MutationObserver 动态头条 .is-lead */
  let currentFilter = 'all';

  function matchesFilter(card, filter) {
    if (filter === 'domestic') return card.classList.contains('is-domestic');
    if (filter === 'intl') return card.classList.contains('is-intl');
    return true;
  }

  function syncLeadCard() {
    if (!sectionsEl) return;
    const cards = Array.from(sectionsEl.querySelectorAll('.story-card'));
    let leadAssigned = false;
    let domesticCount = 0;
    let intlCount = 0;

    for (const card of cards) {
      if (card.classList.contains('is-domestic')) domesticCount += 1;
      if (card.classList.contains('is-intl')) intlCount += 1;
      const shouldBeLead = !leadAssigned && matchesFilter(card, currentFilter);
      card.classList.toggle('is-lead', shouldBeLead);
      if (shouldBeLead) leadAssigned = true;
    }

    if (cards.length > 0) {
      const countMap = {
        all: cards.length,
        domestic: domesticCount,
        intl: intlCount
      };
      for (const [key, value] of Object.entries(countMap)) {
        const badge = document.querySelector(`.news-filter-count[data-count="${key}"]`);
        if (badge) badge.textContent = String(value);
      }
    }
  }

  function applyFilter(filter) {
    if (filter !== 'all' && filter !== 'domestic' && filter !== 'intl') return;
    currentFilter = filter;
    root.dataset.newsFilter = filter;
    for (const btn of filterBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
    }
    syncLeadCard();
    scheduleScrollSync();
  }

  root.dataset.newsFilter = currentFilter;
  for (const btn of filterBtns) {
    btn.addEventListener('click', () => {
      applyFilter(btn.dataset.filter || 'all');
    });
  }

  if (sectionsEl && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      syncLeadCard();
      scheduleScrollSync();
    });
    observer.observe(sectionsEl, { childList: true });
  }
  syncLeadCard();

  /* 3. 滚动阅读进度条（<progress>.value）与返回顶部按钮（.is-visible） */
  let rafId = 0;

  function updateScrollUI() {
    rafId = 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    if (progressEl) {
      progressEl.value = maxScroll > 0
        ? Math.min(100, Math.max(0, (scrollY / maxScroll) * 100))
        : 0;
    }

    if (backTopBtn) {
      backTopBtn.classList.toggle('is-visible', scrollY > 260);
    }
  }

  function scheduleScrollSync() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(updateScrollUI);
  }

  window.addEventListener('scroll', scheduleScrollSync, { passive: true });
  window.addEventListener('resize', scheduleScrollSync, { passive: true });
  scheduleScrollSync();

  if (backTopBtn) {
    backTopBtn.addEventListener('click', () => {
      const reduced = reducedMotionQuery && reducedMotionQuery.matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }
})();
