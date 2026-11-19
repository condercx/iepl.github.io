"""Same-day Chinese publisher reports with article-specific photos and excerpts."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from http.client import HTTPException
import json
import re
import sys
import unicodedata
from urllib.parse import quote, urljoin

from news_images import UNSUITABLE, page as _get, photo_url, snapshot
from PIL.Image import DecompressionBombError

BJ = timezone(timedelta(hours=8))
PAPER = {'中国政库': '国内', '中南海': '国内', '人事风向': '国内', '全球速报': '国际',
         '澎湃世界观': '国际', '外交学人': '国际'}
CNS = 'https://www.chinanews.com.cn'
ERRORS = (OSError, HTTPException, ValueError, KeyError, TypeError, IndexError, DecompressionBombError)


def _text(s):
    return ' '.join(unescape(re.sub('<[^>]*>', '', s)).split())


def _field(pattern, html):
    m = re.search(pattern, html, re.I | re.S)
    return _text(m[1]) if m else ''


def _date(s, now):
    try:
        if not isinstance(s, str) or not re.match(r'^\d{4}-\d\d-\d\d[T ]\d\d:\d\d', s):
            return None
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BJ)
        if dt <= now and dt.astimezone(BJ).date() == now.date():
            return dt.isoformat(timespec='seconds')
    except (ValueError, TypeError):
        pass
    return None


def _run(jobs):
    def run(job):
        func, *args = job
        try:
            return func(*args)
        except ERRORS as exc:
            print(f'{func.__name__}: {type(exc).__name__}', file=sys.stderr)
            return []
    with ThreadPoolExecutor(max_workers=6) as pool:
        return [r for batch in pool.map(run, jobs) for r in batch]


def _paper(section, now):
    if section:
        html = _get(f'https://m.thepaper.cn/list_{section}')
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if not match:
            raise ValueError('missing section data')
        items = json.loads(match[1])['props']['pageProps']['data']['list']
    else:
        items = json.loads(_get('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar'))['data']['hotNews']
    rows = []
    for pos, item in enumerate(items, 1):
        region = PAPER.get((item.get('nodeInfo') or {}).get('name'))
        pub = _date(item.get('publishTime'), now)
        ident = str(item.get('contId', ''))
        likes = str(item.get('praiseTimes', ''))
        if not (region and pub and re.fullmatch('[0-9]+', ident) and item.get('name')):
            continue
        if item.get('trackArticleType') not in (None, '文章') or item.get('isOutForward') == '1':
            continue
        rows.append(dict(region=region, title=_text(item['name']), source='澎湃新闻', card=item.get('pic'),
                         url=f'https://m.thepaper.cn/newsDetail_forward_{ident}', published=pub,
                         rank=None if section else pos,
                         likes=int(likes) if re.fullmatch('[0-9]{1,10}', likes) else 0))
    return rows[:8]


def _guancha(now):
    html = _get('https://www.guancha.cn/')
    pattern = (r'<a href="(/(GuoJi·ZhanLue|ZhengZhi)/' + now.strftime('%Y_%m_%d') +
               r'_\d+\.shtml)#comment"[^>]*data-sensor="评论数"[^>]*>\s*评论\s*(\d+)\s*</a>')
    return [dict(source='观察者网', url='https://www.guancha.cn' + quote(path), rank=None,
                 region='国内' if section == 'ZhengZhi' else '国际', comments=int(count))
            for path, section, count in re.findall(pattern, html)[:14]]


def _cns(now):
    html = _get(CNS + '/scroll-news/news1.html')
    pattern = (r'<div class="dd_bt"><a href="(/(gn|gj)/' + now.strftime('%Y/%m-%d') +
               r'/\d+\.shtml)"[^>]*>([^<]+)</a>')
    return [dict(source='中国新闻网', url=CNS+path, rank=None, title=_text(title),
                 region='国际' if section == 'gj' else '国内')
            for path, section, title in re.findall(pattern, html)[:16]]


def _cctv(section, now):
    payload = _get('https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/' + section + '_1.jsonp')
    match = re.fullmatch(section + r'\((.*)\);?\s*', payload.strip(), re.S)
    if not match:
        raise ValueError('unexpected CCTV callback')
    rows = []
    for item in json.loads(match[1])['data']['list']:
        pub = _date(item.get('focus_date'), now)
        url = item.get('url', '')
        if (pub and item.get('title') and re.fullmatch(r'https://news\.cctv\.com/' + now.strftime('%Y/%m/%d') +
                                                       r'/ARTI[a-zA-Z0-9]+\.shtml', url)):
            rows.append(dict(region='国内' if section == 'china' else '国际', title=_text(item['title']),
                             source='央视网', url=url, published=pub, brief=_text(item.get('brief') or ''),
                             card=item.get('image'), rank=None))
    return rows[:16]


class _Article(HTMLParser):
    """Collect paragraphs and images only inside the publisher's article body."""
    def __init__(self):
        super().__init__()
        self.stack = []
        self.photos = []
        self.paragraphs = []
        self.words = []
        self.has_player = False
        self.has_body = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = (a.get('class') or '').split()
        body = (a.get('id') == 'content_area' or 'left_zw' in classes or
                {'content', 'all-txt'} <= set(classes) or any(c.startswith('cententWrap__') for c in classes))
        active = body or bool(self.stack and self.stack[-1][1])
        self.has_body |= body
        if active and (tag in ('video', 'iframe', 'object') or any(re.search(r'video|player', c, re.I) for c in classes)):
            self.has_player = True
        if tag in ('script', 'style', 'video', 'iframe', 'object', 'aside', 'nav', 'footer', 'figcaption') or any(
                re.search(r'video|player|recommend|related|banner|advert|qrcode|image_desc|pic-desc', c, re.I) for c in classes):
            active = False
        if active and tag == 'img' and not a.get('data-ai') and not UNSUITABLE.search(' '.join(classes) + (a.get('alt') or '')):
            src = a.get('data-src') or a.get('src')
            if src and len(self.photos) < 12:
                self.photos.append(src)
        if tag not in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):
            self.stack.append((tag, active))
        if tag == 'p':
            self.words = []

    def handle_data(self, data):
        if self.stack and self.stack[-1][1] and any(tag == 'p' and active for tag,active in self.stack):
            self.words.append(data)

    def handle_endtag(self, tag):
        if tag == 'p' and self.words:
            self.paragraphs.append(' '.join(''.join(self.words).split()))
            self.words = []
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def _summary(title, texts):
    def key(s):
        return ''.join(c for c in unicodedata.normalize('NFKC', s).lower() if c.isalnum())
    headline = key(title)
    for s in texts:
        s = s.strip()
        if len(s) > 240:
            end = s.rfind('。', 24, 240)
            s = s[:end+1] if end >= 24 else s[:239].rstrip() + '…'
        k = key(s)
        if headline and k not in headline and len(k.replace(headline, '')) >= 16:
            return s
    return ''


def _report(row, now):
    row = dict(row)
    html = _get(row['url'])
    source = row['source']
    if source == '观察者网':
        row['published'] = _date(_field(r'<div class="time fix">\s*<span>(.*?)</span>', html), now)
        row['title'] = _field(r'<h3>\s*(.*?)</h3>', html)
    elif source == '中国新闻网':
        date = re.search(r'(\d{4})年(\d{2})月(\d{2})日\s+(\d\d:\d\d)\s*来源', html)
        row['published'] = _date('{}-{}-{} {}'.format(*date.groups()), now) if date else None
    if not row.get('published') or not row.get('title'):
        return []
    article = _Article()
    article.feed(html)
    brief, card = row.pop('brief', ''), row.pop('card', '')
    # Do not reuse a player poster as the section thumbnail. Article news has
    # its own CCTV ARTI namespace, unlike the separate video channel (VIDE).
    if not article.has_player and article.has_body and card:
        article.photos.append(card)
    summary = _summary(row['title'], [brief, *article.paragraphs])
    if not summary:
        return []
    urls = dict.fromkeys(urljoin(row['url'], path) for path in article.photos)
    for url in [u for u in urls if photo_url(source, u)][:2]:
        try:
            return [row | dict(summary=summary, image=snapshot(source, url), image_source=url)]
        except ERRORS:
            continue
    return []


def collect(now):
    """Return only reports with a decoded, locally embeddable article photo."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('now must be timezone-aware')
    now = now.astimezone(BJ)
    jobs = [(_guancha, now), (_cns, now), (_cctv, 'world', now), (_cctv, 'china', now)]
    jobs += [(_paper, section, now) for section in (None, 25462, 25488, 25429, 122903, 25481)]
    unique = {}
    for row in _run(jobs):
        unique.setdefault(row['url'], row)
    return _run([(_report, row, now) for row in unique.values()])
