import base64
from io import BytesIO
import json
import os
from collections import Counter
from urllib.request import Request

from PIL import Image
import news_images as ni
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import news_sources as ns


class SourceTests(unittest.TestCase):
    now = datetime(2026, 11, 19, 8, 0, tzinfo=ns.BJ)

    def test_beijing_day_uses_article_time(self):
        self.assertIsNone(ns._date('2026-11-18 23:59:59', self.now))
        self.assertIsNone(ns._date('2026-11-19 08:00:01', self.now))
        self.assertIsNone(ns._date('2026-11-19', self.now))
        self.assertIsNotNone(ns._date('2026-11-18T16:00:00+00:00', self.now))
        with self.assertRaises(ValueError):
            ns.collect(self.now.replace(tzinfo=None))

    def test_rank_retains_position_before_filtering(self):
        item = dict(nodeInfo={'name': '全球速报'}, name='国际报道', contId='123',
                    publishTime='2026-11-19 06:30:00', praiseTimes='7')
        items = [dict(item, publishTime='2026-11-18 20:00:00'), item]
        with patch.object(ns, '_get', return_value=json.dumps({'data': {'hotNews': items}})):
            row, = ns._paper(None, self.now)
            self.assertEqual((row['rank'], row['region'], row['likes']), (2, '国际', 7))
        page = json.dumps({'props': {'pageProps': {'data': {'list': items}}}})
        with patch.object(ns, '_get', return_value=f'<script id="__NEXT_DATA__">{page}</script>'):
            row, = ns._paper(25429, self.now)
            self.assertIsNone(row['rank'])

    def test_remote_iframe_and_foreign_media_are_not_fetched(self):
        src = 'https://p1.img.cctvpic.com/photoworkspace/2026/11/19/12345.jpg'
        with patch.object(ni, '_read') as fetch:
            for bad in (src.replace('https:', 'http:'), src + '?id=reader', src.replace('.com/', '.com.evil/'),
                        src.replace('12345', 'qrcode'), src.replace('12345', 'logo'), src.replace('12345', 'video'),
                        src.replace('/photoworkspace/', '/photoAlbum/'), src.replace('https://', 'https://user@')):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    ni.snapshot('央视网', bad)
            fetch.assert_not_called()
        self.assertIsNone(ni._NoRedirect().redirect_request(Request(src), None, 302, '', {}, 'https://example.org'))

    def test_scoped_report_uses_publisher_photo_and_text(self):
        src = 'https://i.guancha.cn/news/external/story.jpg'
        s = '这个报道介绍了本次活动的研究成果以及项目未来的发展计划。'
        row = dict(url='https://www.guancha.cn/story', source='观察者网', region='国际', rank=None)
        body = (f'<h3>现场报道</h3><div class="time fix"><span>2026-11-19 07:00:00</span></div>'
                f'<header><img src="{src}outside"></header><div class="content all-txt"><p>{s}</p>'
                f'<video poster="{src}"></video><img alt="二维码" src="{src}qr"><img src="{src}"></div>')
        pixels = BytesIO()
        Image.new('RGB', (900, 600), 'orange').save(pixels, 'PNG')
        with patch.object(ns, '_get', return_value=body), patch.object(ni, '_read', return_value=pixels.getvalue()) as fetch:
            report, = ns._report(row, self.now)
        fetch.assert_called_once_with(src, ni.MAX_INPUT, image=True)
        self.assertEqual((report['image_source'], report['summary']), (src, s))
        raw = base64.b64decode(report['image'].removeprefix('data:image/jpeg;base64,'), validate=True)
        self.assertLessEqual(len(raw), 120*1024)
        with Image.open(BytesIO(raw)) as photo:
            photo.load()
            self.assertEqual((photo.format, max(photo.size)), ('JPEG', 640))
        nested = body.replace(f'<img src="{src}">', '').replace('<video ', '<div class="video-player"><video ').replace('</video>', '</video></div>')
        with patch.object(ns, '_get', return_value=nested), patch.object(ni, '_read') as fetch:
            self.assertEqual(ns._report(dict(row, card=src), self.now), [])
            fetch.assert_not_called()

    def test_no_broken_or_oversize_photos(self):
        for raw in (b'\xff\xd8bogus', b'x' * (ni.MAX_INPUT + 1)):
            with self.assertRaises((ValueError, OSError)):
                ni.normalize(raw)
        dense = BytesIO()
        Image.new('L', (8200, 200)).save(dense, 'PNG')
        with self.assertRaises(ValueError):
            ni.normalize(dense.getvalue())

    def test_summary_is_not_a_punctuated_or_repeated_headline(self):
        title = '国家有关部门近日发布了最新的市场发展状况统计报告'
        self.assertFalse(ns._summary(title, [title + '。', title * 2, title[:-1]]))

    def test_collect_does_not_return_text_only_reports(self):
        item = dict(url='https://news.cctv.com/2026/11/19/ARTI999.shtml', title='国际消息',
                    focus_date='2026-11-19 06:00:00', brief='这是同一篇报道的正文摘要，不代表存在可以展示的报道照片。')
        def publisher(url):
            if url.endswith('world_1.jsonp'):
                return 'world(' + json.dumps({'data': {'list': [item]}}) + ');'
            return ''
        with patch.object(ns, '_get', side_effect=publisher):
            self.assertEqual(ns.collect(self.now), [])

    @unittest.skipUnless(os.getenv('LIVE_NEWS') == '1', 'requires live publishers')
    def test_live_image_eligible_quotas(self):
        rows = ns.collect(datetime.now(ns.BJ))
        counts = Counter(r['region'] for r in rows)
        self.assertGreaterEqual(counts['国内'], 4, counts)
        self.assertGreaterEqual(counts['国际'], 6, counts)
        for row in rows:
            self.assertTrue(ni.photo_url(row['source'], row['image_source']))
            self.assertEqual(ns._summary(row['title'], [row['summary']]), row['summary'])
            self.assertTrue(row['image'].startswith('data:image/jpeg;base64,'))
            raw = base64.b64decode(row['image'].split(',')[1], validate=True)
            self.assertLessEqual(len(raw), ni.MAX_OUTPUT)
            with Image.open(BytesIO(raw)) as photo:
                photo.load()
                self.assertEqual(photo.format, 'JPEG')
                self.assertLessEqual(max(photo.size), 640)

    def test_rolling_order_never_becomes_rank(self):
        item = dict(url='https://news.cctv.com/2026/11/19/ARTI999.shtml', title='国际消息',
                    focus_date='2026-11-19 06:00:00', brief='内容')
        body = json.dumps({'data': {'list': [item, dict(item, focus_date='2026-11-18 23:00:00')]}})
        with patch.object(ns, '_get', return_value=f'world({body});'):
            row, = ns._cctv('world', self.now)
            self.assertEqual((row['region'], row['rank']), ('国际', None))


if __name__ == '__main__':
    unittest.main()
