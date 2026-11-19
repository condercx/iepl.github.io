(() => {
  'use strict';
  const remote = 'https://raw.githubusercontent.com/kanatachika/iepl.github.io/news-data/p/daily-news/edition.json';
  const dateLine = document.querySelector('#date');
  const status = document.querySelector('#status');
  const sections = document.querySelector('#sections');
  const day = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'});
  const clock = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const limits = {国内: 4, 国际: 6};

  function https(value) {
    try {
      if (typeof value !== 'string') return null;
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null;
    } catch { return null; }
  }
  function player(value) {
    const u = https(value);
    if (!u) return null;
    const bv = u.searchParams.get('bvid');
    if (u.hostname === 'player.bilibili.com' && u.pathname === '/player.html' && /^BV[A-Za-z0-9]{10}$/.test(bv)) {
      return `https://player.bilibili.com/player.html?bvid=${bv}&page=1&danmaku=0&autoplay=0`;
    }
    if (['www.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname) && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(u.pathname)) {
      return `https://www.youtube-nocookie.com${u.pathname}?autoplay=0`;
    }
    return null;
  }
  function valid(data) {
    if (!data || !Array.isArray(data.stories)) return false;
    if (data.date === null && data.updated === null) return !data.stories.length;
    if (!/^\d{4}-\d\d-\d\d$/.test(data.date) || !Number.isFinite(Date.parse(data.updated)) || day.format(new Date(data.updated)) !== data.date) return false;
    const counts = {国内: 0, 国际: 0};
    return data.stories.length === 10 && data.stories.every((s, i, rows) => s && Object.hasOwn(limits, s.region) && ++counts[s.region] <= limits[s.region] &&
      ['title','source'].every(k => typeof s[k] === 'string' && s[k].trim()) && (s.summary == null || typeof s.summary === 'string') && https(s.url) &&
      Number.isFinite(s.score) && (!i || rows[i - 1].score >= s.score) && Number.isFinite(Date.parse(s.published)) && day.format(new Date(s.published)) === data.date);
  }
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function story(s, i) {
    const row = el('li');
    const num = el('span', String(i + 1).padStart(2, '0'), 'number');
    num.setAttribute('aria-hidden', 'true');
    const body = el('div');
    const meta = el('div', undefined, 'byline');
    const link = el('a', `${s.source} · 原文 ↗`);
    link.href = https(s.url).href;
    const time = el('time', `${clock.format(new Date(s.published))} 发布`);
    time.dateTime = s.published;
    meta.append(link, time);
    const sources = [...new Set([s.source, ...(Array.isArray(s.sources) ? s.sources.filter(v => typeof v === 'string' && v.trim()) : [])])];
    if (sources.length > 1) meta.append(el('span', `共同报道：${sources.join('、')}`));
    if (Number.isSafeInteger(s.rank) && s.rank > 0) meta.append(el('span', `来源榜单第 ${s.rank} 名`));
    if (Number.isSafeInteger(s.likes) && s.likes > 0) meta.append(el('span', `来源点赞 ${s.likes}`));
    if (Number.isSafeInteger(s.comments) && s.comments > 0) meta.append(el('span', `来源评论 ${s.comments}`));
    body.append(el('span', s.region, 'region'), el('h3', s.title));
    if (s.summary?.trim()) body.append(el('p', s.summary, 'summary'));
    body.append(meta);
    const media = https(s.video);
    const article = https(s.url);
    const providers = [
      [['www.chinanews.com.cn', 'www.chinanews.com'], /^\//, 'poss-videocloud.cns.com.cn', /^\/oss\/\d{4}\/\d{2}\/\d{2}\/chinanews\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.mp4$/],
      [['m.thepaper.cn'], /^\/newsDetail_forward_\d+$/, 'cloudvideo.thepaper.cn', /^\/video\/[a-fA-F0-9]{32}\/(?:hd|sd)\/[A-Za-z0-9_-]+\.mp4$/]
    ];
    if (media && !media.search && !media.hash && providers.some(([hosts, path, cdn, file]) =>
      hosts.includes(article.hostname) && path.test(article.pathname) && media.hostname === cdn && file.test(media.pathname))) {
      const video = el('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'none';
      video.setAttribute('aria-label', `${s.title} · 原文视频`);
      video.src = media.href;
      body.append(video);
    }
    const src = player(s.video);
    if (src) {
      const button = el('button', '加载原文视频');
      button.type = 'button';
      button.addEventListener('click', () => {
        const f = el('iframe');
        f.title = `${s.title} · 原文视频`;
        f.allowFullscreen = true;
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.src = src;
        button.replaceWith(f);
        f.focus();
      }, {once: true});
      body.append(button);
    }
    row.append(num, body);
    return row;
  }
  function show(data) {
    sections.replaceChildren();
    if (!data.date) return;
    dateLine.textContent = `${data.date}  /  北京时间 ${clock.format(new Date(data.updated))} 更新`;
    const head = el('div', undefined, 'section-head');
    head.append(el('h2', '本期热度排序'), el('span', '国内 4 · 国际 6', 'count'));
    const list = el('ol');
    list.append(...data.stories.map(story));
    sections.append(head, list);
  }
  let best = null;
  let pending = 2;
  let remoteFailed = false;
  function report() {
    let text;
    if (!best) text = pending ? '正在读取本期报道…' : '读取失败：本站和更新源都未能提供有效期次，请稍后刷新。';
    else if (!best.date) text = '暂无已发布期次，尚无可展示的报道。';
    else {
      const today = day.format(new Date());
      text = best.date !== today ? `往期存档：以下为 ${best.date} 的报道，并非北京时间今日（${today}）的榜单。` : '本期为北京时间今日收录。';
      if (!best.stories.length) text += ' 本期暂无报道。';
    }
    if (best && pending) text += ' 正在核对最新期次…';
    if (best && remoteFailed) text += ' 更新源暂不可用，当前显示本站快照。';
    status.textContent = text;
  }
  async function load(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, {cache: 'no-cache', credentials: 'omit', signal: controller.signal});
      if (!res.ok) throw Error('unavailable');
      const data = await res.json();
      if (!valid(data)) throw Error('invalid edition');
      if (!best || (data.date && (!best.date || Date.parse(data.updated) > Date.parse(best.updated)))) {
        best = data;
        show(data);
      }
    } catch { if (url === remote) remoteFailed = true; }
    finally { clearTimeout(timer); pending--; report(); }
  }
  load('./edition.json');
  load(remote);
})();
