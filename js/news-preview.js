(() => {
  'use strict';

  const SOURCE_CACHE_KEY = 'daily-news:last-photo-edition:v1'; // 只读，严禁写入
  const PREVIEW_CACHE_KEY = 'tachika:news-preview:v1';
  const EDITION_URL = './p/daily-news/edition.json';
  const MAX_CACHE_BYTES = 12 * 1024;
  const MAX_THUMB_CHARS = 8200;
  const FRESH_WINDOW_MS = 15 * 60 * 1000;
  const HEADLINE_COUNT = 3;

  const heroEl = document.querySelector('.daily-news-hero');
  if (!heroEl) return;

  const dateEl = heroEl.querySelector('[data-news-date]');
  const previewEl = heroEl.querySelector('[data-news-preview]');
  const leadEl = heroEl.querySelector('[data-news-lead]');
  const headlinesEl = heroEl.querySelector('[data-news-headlines]');
  if (!previewEl || !leadEl || !headlinesEl) return;

  const bjDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const bjClock = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  function isValidJpeg(value) {
    return typeof value === 'string' &&
      value.startsWith('data:image/jpeg;base64,/9j/') &&
      value.length <= 180000;
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function utf8ByteLength(text) {
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(text).length;
    }
    return text.length * 2;
  }

  function readJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function isValidPreview(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!isNonEmptyString(obj.date) || !Number.isFinite(Date.parse(obj.updated))) return false;
    const lead = obj.lead;
    if (!lead || !isNonEmptyString(lead.title) || !isNonEmptyString(lead.region) || !isNonEmptyString(lead.source)) {
      return false;
    }
    if (lead.thumb && !isValidJpeg(lead.thumb)) return false;
    if (!Array.isArray(obj.items)) return false;
    return obj.items.every(item =>
      item && isNonEmptyString(item.title) && isNonEmptyString(item.region) && isNonEmptyString(item.source)
    );
  }

  function extractFromEdition(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.stories) || !data.stories.length) {
      return null;
    }
    if (!isNonEmptyString(data.date) || !Number.isFinite(Date.parse(data.updated))) {
      return null;
    }
    const first = data.stories[0];
    if (!first || !isNonEmptyString(first.title) || !isNonEmptyString(first.region) || !isNonEmptyString(first.source)) {
      return null;
    }
    const items = [];
    for (let i = 1; i < data.stories.length && items.length < HEADLINE_COUNT; i += 1) {
      const s = data.stories[i];
      if (s && isNonEmptyString(s.title) && isNonEmptyString(s.region) && isNonEmptyString(s.source)) {
        items.push({
          title: s.title.trim(),
          region: s.region.trim(),
          source: s.source.trim()
        });
      }
    }
    return {
      date: data.date.trim(),
      updated: data.updated,
      lead: {
        title: first.title.trim(),
        region: first.region.trim(),
        source: first.source.trim(),
        thumb: isValidJpeg(first.image) ? first.image : ''
      },
      items
    };
  }

  function shrinkThumb(dataUrl) {
    if (!isValidJpeg(dataUrl)) return Promise.resolve('');
    if (dataUrl.length <= MAX_THUMB_CHARS) return Promise.resolve(dataUrl);

    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            resolve('');
            return;
          }
          const targetW = Math.min(200, w);
          const targetH = Math.max(1, Math.round((h * targetW) / w));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve('');
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          let compact = canvas.toDataURL('image/jpeg', 0.62);
          if (compact.length > MAX_THUMB_CHARS) {
            compact = canvas.toDataURL('image/jpeg', 0.44);
          }
          resolve(compact.length <= MAX_THUMB_CHARS && isValidJpeg(compact) ? compact : '');
        } catch {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = dataUrl;
    });
  }

  async function savePreviewCache(preview) {
    try {
      const compactThumb = await shrinkThumb(preview.lead.thumb);
      const payload = {
        date: preview.date,
        updated: preview.updated,
        lead: {
          title: preview.lead.title,
          region: preview.lead.region,
          source: preview.lead.source,
          thumb: compactThumb
        },
        items: preview.items.slice(0, HEADLINE_COUNT)
      };
      let serialized = JSON.stringify(payload);
      if (utf8ByteLength(serialized) > MAX_CACHE_BYTES) {
        payload.lead.thumb = '';
        serialized = JSON.stringify(payload);
      }
      if (utf8ByteLength(serialized) <= MAX_CACHE_BYTES) {
        window.localStorage.setItem(PREVIEW_CACHE_KEY, serialized);
      }
    } catch {}
  }

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatEditionStamp(preview) {
    try {
      const t = new Date(preview.updated);
      return `${preview.date} · ${bjClock.format(t)} 更新`;
    } catch {
      return preview.date;
    }
  }

  let renderedUpdatedMs = 0;
  let renderedDate = '';

  function renderPreview(preview) {
    if (!isValidPreview(preview)) return false;
    const updatedMs = Date.parse(preview.updated);
    if (renderedUpdatedMs && updatedMs <= renderedUpdatedMs) return false;

    if (dateEl) {
      dateEl.textContent = formatEditionStamp(preview);
      dateEl.setAttribute('datetime', preview.updated);
    }

    const leadFrag = document.createDocumentFragment();
    if (isValidJpeg(preview.lead.thumb)) {
      const img = makeEl('img', 'daily-news-hero__thumb');
      img.src = preview.lead.thumb;
      img.alt = `${preview.lead.source}配图：${preview.lead.title}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      leadFrag.appendChild(img);
    }
    const leadBody = makeEl('div', 'daily-news-hero__lead-body');
    const leadMeta = makeEl('div', 'daily-news-hero__lead-meta');
    leadMeta.appendChild(makeEl('span', 'daily-news-hero__tag', preview.lead.region));
    leadMeta.appendChild(makeEl('span', 'daily-news-hero__source', preview.lead.source));
    leadBody.appendChild(leadMeta);
    leadBody.appendChild(makeEl('strong', 'daily-news-hero__lead-title', preview.lead.title));
    leadFrag.appendChild(leadBody);
    leadEl.replaceChildren(leadFrag);

    const listFrag = document.createDocumentFragment();
    for (const item of preview.items.slice(0, HEADLINE_COUNT)) {
      const li = makeEl('li');
      const link = makeEl('a');
      link.href = './p/daily-news/';
      link.appendChild(makeEl('span', 'daily-news-hero__tag', item.region));
      link.appendChild(makeEl('span', 'daily-news-hero__headline-text', item.title));
      link.appendChild(makeEl('span', 'daily-news-hero__source', item.source));
      li.appendChild(link);
      listFrag.appendChild(li);
    }
    headlinesEl.replaceChildren(listFrag);

    previewEl.hidden = false;
    heroEl.classList.add('has-preview');
    renderedUpdatedMs = updatedMs;
    renderedDate = preview.date;
    return true;
  }

  function isConstrainedNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData === true) return true;
    const type = typeof conn.effectiveType === 'string' ? conn.effectiveType.toLowerCase() : '';
    return type === 'slow-2g' || type === '2g' || type === '3g';
  }

  function shouldRefreshNetwork() {
    if (isConstrainedNetwork()) return false;
    if (!renderedUpdatedMs) return true;
    const today = bjDay.format(new Date());
    if (renderedDate !== today) return true;
    return Date.now() - renderedUpdatedMs > FRESH_WINDOW_MS;
  }

  async function refreshFromEdition() {
    if (!shouldRefreshNetwork()) return;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), 6000) : 0;
    try {
      const res = await fetch(EDITION_URL, {
        cache: 'no-cache',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) return;
      const data = await res.json();
      const preview = extractFromEdition(data);
      if (!preview) return;
      if (renderPreview(preview)) {
        savePreviewCache(preview);
      }
    } catch {
      /* 静默回退静态态或缓存态 */
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  function scheduleIdleRefresh() {
    const run = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => { refreshFromEdition(); }, { timeout: 3000 });
      } else {
        window.setTimeout(() => { refreshFromEdition(); }, 1200);
      }
    };
    if (document.readyState === 'complete') {
      run();
    } else {
      window.addEventListener('load', run, { once: true });
    }
  }

  /* 1. 优先从本地派生缓存或新闻页只读缓存秒渲 */
  const cachedPreview = readJson(PREVIEW_CACHE_KEY);
  const validCached = isValidPreview(cachedPreview) ? cachedPreview : null;
  const fromSource = extractFromEdition(readJson(SOURCE_CACHE_KEY));

  let bestLocal = validCached;
  let cameFromSource = false;
  if (fromSource && (!bestLocal || Date.parse(fromSource.updated) > Date.parse(bestLocal.updated))) {
    bestLocal = fromSource;
    cameFromSource = true;
  }

  if (bestLocal) {
    renderPreview(bestLocal);
    if (cameFromSource) {
      savePreviewCache(bestLocal);
    }
  }

  /* 2. window.load 后空闲低优按需拉取 */
  scheduleIdleRefresh();
})();
