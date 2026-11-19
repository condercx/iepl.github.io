(() => {
  'use strict';
  const cacheKey = 'daily-news:last-photo-edition:v1';
  const dateLine = document.querySelector('#date');
  const status = document.querySelector('#feedback');
  const sections = document.querySelector('#sections');
  const day = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'});
  const clock = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const limits = {国内: 4, 国际: 6};
  try {
    const s = localStorage.getItem('StackColorScheme');
    document.documentElement.dataset.scheme = s === 'dark' || (s !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  } catch {}

  function https(value) {
    try {
      if (typeof value !== 'string') return false;
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port;
    } catch { return false; }
  }
  function sameDay(timestamp, date) {
    return typeof timestamp === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) && Number.isFinite(Date.parse(timestamp)) && day.format(new Date(timestamp)) === date;
  }
  const words = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function substantive(title, summary) {
    if (typeof title !== 'string' || typeof summary !== 'string') return false;
    const t = words(title), s = words(summary);
    return t.length > 0 && !t.includes(s) && [...s.replaceAll(t, '')].length >= 16;
  }
  function jpeg(value) {
    const prefix = 'data:image/jpeg;base64,';
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > prefix.length + 4 * (120 * 1024 / 3)) return false;
    const payload = value.slice(prefix.length);
    if (!payload.startsWith('/9j/') || payload.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
    return atob(payload.slice(-8)).endsWith('\xff\xd9');
  }
  function valid(data) {
    if (!data || !Array.isArray(data.stories)) return false;
    if (data.date === null && data.updated === null) return !data.stories.length;
    if (!/^\d{4}-\d\d-\d\d$/.test(data.date) || !sameDay(data.updated, data.date)) return false;
    const counts = {国内: 0, 国际: 0};
    return data.stories.length === 10 && data.stories.every((s, i, rows) => s && Object.hasOwn(limits, s.region) && ++counts[s.region] <= limits[s.region] &&
      typeof s.source === 'string' && s.source.trim() && substantive(s.title, s.summary) && https(s.url) && https(s.image_source) && jpeg(s.image) &&
      Number.isFinite(s.score) && (!i || rows[i - 1].score >= s.score) && sameDay(s.published, data.date));
  }
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  async function story(s, i) {
    const img = el('img');
    img.alt = s.image_alt && typeof s.image_alt === 'string' ? s.image_alt : `${s.source}报道配图：${s.title}`;
    img.src = s.image;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight || Math.max(img.naturalWidth, img.naturalHeight) > 640) throw Error('invalid photo dimensions');
    img.width = img.naturalWidth;
    img.height = img.naturalHeight;
    const figure = el('figure');
    const caption = el('figcaption');
    const credit = el('a', `图片来源：${s.source} ↗`);
    credit.href = s.image_source;
    caption.append(credit);
    figure.append(img, caption);
    const row = el('li');
    const num = el('span', String(i + 1).padStart(2, '0'), 'number');
    num.setAttribute('aria-hidden', 'true');
    const body = el('div');
    const meta = el('div', undefined, 'byline');
    const link = el('a', `${s.source} · 原文 ↗`);
    link.href = s.url;
    const time = el('time', `${clock.format(new Date(s.published))} 发布`);
    time.dateTime = s.published;
    meta.append(link, time);
    const sources = [...new Set([s.source, ...(Array.isArray(s.sources) ? s.sources.filter(v => typeof v === 'string' && v.trim()) : [])])];
    if (sources.length > 1) meta.append(el('span', `共同报道：${sources.join('、')}`));
    if (Number.isSafeInteger(s.rank) && s.rank > 0) meta.append(el('span', `来源榜单第 ${s.rank} 名`));
    if (Number.isSafeInteger(s.likes) && s.likes > 0) meta.append(el('span', `来源点赞 ${s.likes}`));
    if (Number.isSafeInteger(s.comments) && s.comments > 0) meta.append(el('span', `来源评论 ${s.comments}`));
    body.append(el('span', s.region, 'region'), el('h3', s.title), figure, el('p', s.summary, 'summary'), meta);
    row.append(num, body);
    return row;
  }
  let best = null;
  const refresh = document.querySelector('#refresh');
  const checked = document.querySelector('#checked');
  const stamp = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium'});

  async function display(data) {
    if (!valid(data)) throw Error('invalid edition');
    if (!data.date || (best && Date.parse(data.updated) <= Date.parse(best.updated))) return false;
    const rows = await Promise.all(data.stories.map(story));
    const head = el('div', undefined, 'section-head');
    head.append(el('h2', '本期热度排序'), el('span', '国内 4 · 国际 6', 'count'));
    const list = el('ol');
    list.append(...rows);
    sections.replaceChildren(head, list);
    dateLine.textContent = `本期生成（北京时间）：${stamp.format(new Date(data.updated))}`;
    best = data;
    return true;
  }
  async function check(manual) {
    if (refresh.disabled) return;
    refresh.disabled = true;
    refresh.textContent = manual ? '刷新中…' : '读取中…';
    status.textContent = '正在核对本站已发布的期次…';
    if (!manual) {
      try { await display(JSON.parse(localStorage.getItem(cacheKey))); } catch {}
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let feedback;
    try {
      const res = await fetch('./edition.json', {cache: 'no-store', credentials: 'omit', signal: controller.signal});
      if (!res.ok) throw Error('unavailable');
      const data = await res.json();
      if (await display(data)) {
        feedback = '已载入新版榜单。';
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
      } else {
        feedback = best ? '没有新一期。' : '暂无已发布的完整图文期次。';
      }
    } catch {
      feedback = best ? '检查失败，保留上次载入的完整榜单。' : '检查失败，暂无可用的完整榜单，请稍后再试。';
    } finally {
      clearTimeout(timer);
      const now = new Date();
      checked.textContent = `最近检查（北京时间）：${stamp.format(now)}`;
      const today = day.format(now);
      const note = !best ? '' : best.date === today ? '本期为北京时间今日收录。' : `往期存档：以下为 ${best.date} 的报道，并非北京时间今日（${today}）的榜单。`;
      status.textContent = feedback + note;
      refresh.disabled = false;
      refresh.textContent = '刷新榜单';
    }
  }
  refresh.hidden = false;
  refresh.addEventListener('click', () => check(true));
  check(false);
})();
