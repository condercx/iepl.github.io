import json
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
        with patch.object(ns, 'urlopen') as fetch:
            for src in ('https://example.org/video.mp4',
                        'https://poss-videocloud.cns.com.cn.evil.com/oss/2026/11/19/chinanews/v.mp4'):
                self.assertIsNone(ns._verified_media(f'<iframe src="{src}"></iframe><source src="{src}" type="video/mp4">'))
            fetch.assert_not_called()

    def test_rolling_order_never_becomes_rank(self):
        item = dict(url='https://news.cctv.com/2026/11/19/ARTI999.shtml', title='国际消息',
                    focus_date='2026-11-19 06:00:00', brief='内容')
        body = json.dumps({'data': {'list': [item, dict(item, focus_date='2026-11-18 23:00:00')]}})
        with patch.object(ns, '_get', return_value=f'world({body});'):
            row, = ns._cctv('world', self.now)
            self.assertEqual((row['region'], row['rank']), ('国际', None))


if __name__ == '__main__':
    unittest.main()
