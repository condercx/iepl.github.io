"""Fetch only publisher-owned assets; keep normalized pixels, never publisher metadata."""
import base64
from io import BytesIO
import re
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

from PIL import Image, ImageOps

PAGE_HOSTS = {'cache.thepaper.cn', 'm.thepaper.cn', 'news.cctv.com', 'www.chinanews.com.cn', 'www.guancha.cn'}
# Restrict paths as well as hosts: the same CDN also serves account photos,
# app promotions, player posters and the site's default share image.
PHOTO_PATHS = {
    '澎湃新闻': r'https://imgpai\.thepaper\.cn/newpai/image/(?:\d{8}/)?[\w.-]+\.(?:jpe?g|png|webp)(?:\?x-oss-process=image/resize,w_\d{2,4})?',
    '央视网': r'https://p[1-5]\.img\.cctvpic\.com/photoworkspace/\d{4}/\d\d/\d\d/\d+\.(?:jpe?g|png)',
    '中国新闻网': r'https://i[12]\.chinanews\.com\.cn/simg/(?:cmshd|ypt)/[\w./-]+\.(?:jpe?g|png)',
    '观察者网': r'https://i\.guancha\.cn/news/(?:\d{4}/\d\d/\d\d|external|vcg)/[\w.-]+\.(?:jpe?g|png)(?:/newscontent)?',
}
UNSUITABLE = re.compile(r'logo|default|qrcode|qr[-_]?code|erweima|favicon|placeholder|video|poster|banner|advert|二维码|扫一扫|广告|视频截图|视频封面|AI生成', re.I)
MAX_INPUT = 4 * 1024 * 1024
MAX_OUTPUT = 120 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read(url, limit, image=False):
    # Never follow even a first-party redirect to an unrelated article/asset.
    with build_opener(_NoRedirect()).open(url, timeout=7) as response:
        if response.geturl() != url or (image and response.headers.get_content_type() not in
                                         {'image/jpeg', 'image/png', 'image/webp'}):
            raise ValueError('unexpected publisher response')
        if int(response.headers.get('Content-Length') or 0) > limit:
            raise ValueError('oversize publisher response')
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('oversize publisher response')
        return data


def page(url):
    u = urlsplit(url)
    if u.scheme != 'https' or u.netloc not in PAGE_HOSTS or u.query or u.fragment:
        raise ValueError('unapproved publisher page')
    return _read(url, 3_000_000).decode('utf-8-sig')


def photo_url(source, url):
    return isinstance(url, str) and len(url) < 500 and '..' not in url and not UNSUITABLE.search(url) and re.fullmatch(PHOTO_PATHS[source], url, re.ASCII | re.I)


def normalize(raw):
    if len(raw) > MAX_INPUT:
        raise ValueError('oversize photo')
    with Image.open(BytesIO(raw), formats=('JPEG', 'PNG', 'WEBP')) as original:
        w, h = original.size
        if min(w, h) < 100 or max(w, h) > 8192 or w*h > 12_000_000 or max(w,h) > 4*min(w,h) or getattr(original, 'n_frames', 1) != 1:
            raise ValueError('ineligible photo dimensions')
        original.load()  # Identify by bytes and decode every scanline before use.
        img = ImageOps.exif_transpose(original).convert('RGB')
        img.thumbnail((640, 640), Image.Resampling.LANCZOS)
        img.info.clear()
        for quality in (82, 68, 50, 36):
            dest = BytesIO()
            img.save(dest, 'JPEG', quality=quality, optimize=True)
            if dest.tell() <= MAX_OUTPUT:
                return 'data:image/jpeg;base64,' + base64.b64encode(dest.getvalue()).decode('ascii')
    raise ValueError('oversize normalized photo')


def snapshot(source, url):
    if not photo_url(source, url):
        raise ValueError('unapproved publisher photo')
    return normalize(_read(url, MAX_INPUT, image=True))
