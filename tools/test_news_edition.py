import unittest
from datetime import datetime, timedelta
from update_news import BEIJING, edition

NOW = datetime(2025, 7, 1, 16, tzinfo=BEIJING)


def sample():
    # Distinct event titles in both sections; these never enter a published file.
    titles = ['城市发布汛期预警', '铁路调整暑运班次', '科考队完成采样', '博物馆开设新展', '山村修通公路', '代表团举行磋商', '旱灾影响咖啡收成', '火山喷发导致疏散', '海洋公约今日生效', '国际电影节开幕', '议会通过能源法案', '探测器完成着陆']
    return [dict(title=t, region='国内' if i < 5 else '国际', url=f'https://example.org/{i}',
                 source='测试来源', rank=12-i, published=(NOW-timedelta(minutes=i)).isoformat(), summary=t)
            for i, t in enumerate(titles)]


class EditionTest(unittest.TestCase):
    def test_quota_and_combined_order(self):
        stories = edition(sample(), NOW)['stories']
        self.assertEqual([sum(s['region']==r for s in stories) for r in ('国内','国际')], [4,6])
        self.assertEqual([s['rank'] for s in stories], [1,2,3,4,5,6,8,9,10,11])

    def test_duplicate_reporting_adds_heat_not_an_extra_slot(self):
        rows = sample()
        extra = dict(rows[0], source='独立来源', url='https://example.net/1')
        first = edition(rows+[extra, extra], NOW)['stories'][0]
        self.assertEqual(first['title'],rows[0]['title'])
        self.assertEqual(len(first['sources']),2)

    def test_other_publishers_likes_influence_score_but_not_displayed_primary_metrics(self):
        rows = sample()
        duplicate = dict(rows[0], source='第二来源', url='https://second.example/1', likes=99, summary='')
        first = edition(rows+[duplicate], NOW)['stories'][0]
        self.assertEqual(first['source'],rows[0]['source'])
        self.assertEqual(first['likes'],0)
        self.assertGreater(first['score'], 100 + 90 / rows[0]['rank'])

    def test_midnight_and_invalid_stories_do_not_fill(self):
        for ts in ('2025-06-30T15:59:59Z','2025-07-01T18:00:00+08:00','2025-07-01T07:00:00'):
            with self.subTest(ts=ts):
                with self.assertRaises(ValueError):
                    edition([dict(r,published=ts) if r['region']=='国内' else r for r in sample()],NOW)
        with self.assertRaises(ValueError):
            edition([dict(r,url='javascript:alert(1)') for r in sample()],NOW)

    def test_equal_heat_tiebreak_is_latest(self):
        stories = edition([dict(r,rank=None) for r in sample()], NOW)['stories']
        self.assertEqual(stories[0]['published'], NOW.isoformat())
        self.assertEqual(stories[0]['score'],0)

if __name__ == '__main__':
    unittest.main()
