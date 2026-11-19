"""No-key, Chinese-language publisher feeds. Never infer popularity from arrival order."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import unescape
from http.client import HTTPException
import json
import re
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen

BJ = timezone(timedelta(hours=8))
PAPER = {'中国政库': '国内', '中南海': '国内', '人事风向': '国内', '全球速报': '国际',
         '澎湃世界观': '国际', '外交学人': '国际'}
CNS = 'https://www.chinanews.com.cn'
MEDIA = r'https://poss-videocloud\.cns\.com\.cn/oss/\d{4}/\d{2}/\d{2}/chinanews/[\w/-]+\.mp4'


def _get(url):
    with urlopen(url, timeout=8) as response:
        data = response.read(3_000_001)
        if len(data) > 3_000_000:
            raise ValueError('oversize publisher response')
        return data.decode('utf-8-sig')


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
        if dt.tzinfo is None:  # All three publishers display Beijing time.
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
        except (OSError, HTTPException, ValueError, KeyError, TypeError, IndexError) as exc:
            print(f'{func.__name__}: {exc}', file=sys.stderr)
            return []
    with ThreadPoolExecutor(max_workers=4) as pool:
        return [r for batch in pool.map(run, jobs) for r in batch]


def _paper(section, now):
    if section:
        html = _get(f'https://m.thepaper.cn/list_{section}')
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if not match:
            raise ValueError('missing section data')
        items = json.loads(match[1])['props']['pageProps']['data']['list']
    else:
        data = json.loads(_get('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar'))
        items = data['data']['hotNews']
    rows = []
    for pos, item in enumerate(items, 1):
        region = PAPER.get((item.get('nodeInfo') or {}).get('name'))
        pub = _date(item.get('publishTime'), now)
        ident = str(item.get('contId', ''))
        likes = str(item.get('praiseTimes', ''))
        if not (region and pub and re.fullmatch('[0-9]+', ident) and item.get('name')):
            continue
        rows.append(dict(region=region, title=_text(item['name']), source='澎湃新闻',
                         url=f'https://m.thepaper.cn/newsDetail_forward_{ident}', published=pub,
                         summary='', rank=None if section else pos,
                         likes=int(likes) if re.fullmatch('[0-9]{1,10}', likes) else 0))
    return rows


def _guancha_article(region, url, comments, now):
    html = _get(url)
    pub = _date(_field(r'<div class="time fix">\s*<span>(.*?)</span>', html), now)
    title = _field(r'<h3>\s*(.*?)</h3>', html)
    if not pub or not title:
        return []
    summary = _field(r'<meta name="Description" content="([^"]*)"', html)
    return [dict(region=region, title=title, url=url, source='观察者网', published=pub,
                 summary=summary, rank=None, comments=comments)]


def _guancha(now):
    html = _get('https://www.guancha.cn/')
    jobs = {}
    # The article's own section slug (not its position on the mixed homepage).
    pattern = (r'<a href="(/(GuoJi·ZhanLue|ZhengZhi)/' + now.strftime('%Y_%m_%d') +
               r'_\d+\.shtml)#comment"[^>]*data-sensor="评论数"[^>]*>\s*评论\s*(\d+)\s*</a>')
    for path, section, count in re.findall(pattern, html):
        if int(count):
            url = 'https://www.guancha.cn' + quote(path)
            jobs[url] = (_guancha_article, '国内' if section == 'ZhengZhi' else '国际', url, int(count), now)
    return _run(list(jobs.values())[:60])


def _verified_media(html, paper=False):
    if paper:
        pattern = (r'<video\s+class="cont_video"[^>]*?\bsrc="(https://cloudvideo\.thepaper\.cn/video/'
                   r'[a-fA-F0-9]{32}/(?:hd|sd)/[A-Za-z0-9_-]+\.mp4)"')
    else:
        pattern = r'<source\s+src="(' + MEDIA + r')"\s+type="video/mp4"'
    src = _field(pattern, html)
    if src:
        try:
            with urlopen(Request(src, headers={'Range': 'bytes=0-15'}), timeout=5) as media:
                if (media.geturl() == src and media.headers.get_content_type() == 'video/mp4'
                        and media.read(12)[4:8] == b'ftyp'):
                    return src
        except (OSError, HTTPException):
            pass
    return None


def _cns_video(url, title, region, now):
    html = _get(url)
    stamp = re.search(r'发布时间：\s*(\d{4})年(\d{2})月(\d{2})日\s+(\d\d:\d\d)', html)
    pub = _date('{}-{}-{} {}'.format(*stamp.groups()), now) if stamp else None
    if not pub:
        return []
    video = _verified_media(html)
    if not video:
        return []
    summary = _field(r'<p>\s*　+([^<]{12,})</p>', html)
    return [dict(region=region, title=title, source='中国新闻网', url=url, published=pub,
                 summary=summary[:300], rank=None, video=video)]


def _cns(now):
    html = _get(CNS + '/scroll-news/news1.html')
    jobs = {}
    for path, section, title in re.findall(
            r'<div class="dd_bt"><a href="(/(gn|gj)/shipin/(?:[a-z-]+/)?' + now.strftime('%Y/%m-%d') +
            r'/news\d+\.shtml)">([^<]+)</a>', html):
        jobs[path] = (_cns_video, CNS + path, _text(title), '国际' if section == 'gj' else '国内', now)
    return _run(list(jobs.values())[:12])


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
                                                       r'/[a-zA-Z0-9]+\.shtml', url)):
            rows.append(dict(region='国内' if section == 'china' else '国际', title=_text(item['title']),
                             source='央视网', url=url, published=pub, summary=_text(item.get('brief') or ''), rank=None))
    return rows


def collect(now):
    """Return same-Beijing-day reports. Unranked feeds supply coverage, never ranks."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('now must be timezone-aware')
    now = now.astimezone(BJ)
    jobs = [(_guancha, now), (_cns, now), (_cctv, 'world', now), (_cctv, 'china', now)]
    jobs += [(_paper, section, now) for section in (None, 25462, 25488, 25429, 122903, 25481)]
    unique = {}
    for row in _run(jobs):
        # Rankings precede list pages; preserve the real position on overlap.
        unique.setdefault(row['url'], row)
    return list(unique.values())


def enrich(stories):
    """Fill metadata in-place for selected Paper reports, without changing their order."""
    def describe(row):
        html = _get(row['url'])
        if not row.get('summary'):
            row['summary'] = _field(r'<meta name="description" content="([^"]*)"', html)[:300]
        if not row.get('video'):
            row['video'] = _verified_media(html, paper=True)
        return []
    jobs = [(describe, r) for r in stories[:10] if r.get('source') == '澎湃新闻'
            and re.fullmatch(r'https://m\.thepaper\.cn/newsDetail_forward_[0-9]+', r.get('url', ''))]
    _run(jobs)
    return stories
