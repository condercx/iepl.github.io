"""Build one complete Beijing-day edition; never replace a good file with a partial one."""
import argparse
import json
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from math import log2
from pathlib import Path
from urllib.parse import urlsplit

BEIJING = timezone(timedelta(hours=8))
OUTPUT = Path(__file__).resolve().parents[1] / 'p/daily-news/edition.json'
QUOTAS = {'国内': 4, '国际': 6}


def title_key(title):
    return ''.join(c for c in unicodedata.normalize('NFKC', title).lower() if c.isalnum())


def edition(rows, now):
    now = now.astimezone(BEIJING)
    groups = []
    for row in rows:
        try:
            dt = datetime.fromisoformat(row['published'].replace('Z', '+00:00'))
            url = urlsplit(row['url'])
            if (dt.tzinfo is None or dt > now or dt.astimezone(BEIJING).date() != now.date()
                    or row['region'] not in QUOTAS or url.scheme != 'https' or not url.hostname
                    or url.username or url.password or not row['source'].strip()):
                continue
            key = title_key(row['title'])
            if len(key) < 4:
                continue
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
        rank = row.get('rank')
        row = {**row, 'rank': rank if type(rank) is int and rank > 0 else None,
               'published': dt.astimezone(BEIJING).isoformat(timespec='seconds')}
        event = row.get('event')
        for group in groups:
            first, initial = group[0]
            if (row['url'] == first['url'] or (event and event == first.get('event')) or key == initial
                    or (min(len(key), len(initial)) >= 10 and SequenceMatcher(None, key, initial).ratio() >= .78)):
                group.append((row, key))
                break
        else:
            groups.append([(row, key)])
    stories = []
    for group in groups:
        items = [r for r, _ in group]
        eligible = [r for r in items if isinstance(r.get('image'), str)
                    and r['image'].startswith('data:image/jpeg;base64,/9j/')
                    and len(r['image']) <= len('data:image/jpeg;base64,') + 163840
                    and isinstance(r.get('image_source'), str) and r['image_source'].startswith('https://')
                    and isinstance(r.get('summary'), str)
                    and len(title_key(r['summary']).replace(title_key(r['title']), '')) >= 16]
        if not eligible:
            continue
        best = max(eligible, key=lambda r: r['published'])
        sources = sorted({r['source'] for r in items})
        rank = min((r['rank'] for r in items if r['rank']), default=None)
        # Each extra publisher outweighs any single placement. Recency is only a tie-break.
        likes = max((r['likes'] for r in items if type(r.get('likes')) is int and r['likes'] >= 0), default=0)
        comments = max((r['comments'] for r in items if type(r.get('comments')) is int and r['comments'] >= 0), default=0)
        score = round(100 * (len(sources) - 1) + (90 / rank if rank else 0) + min(9, log2(1 + likes + comments)), 2)
        stories.append({k: best.get(k) for k in ('region','title','url','source','published','summary','image','image_source')} |
                       {'sources': sources, 'rank': best['rank'], 'likes': best.get('likes', 0), 'comments': best.get('comments', 0), 'score': score})
    stories.sort(key=lambda s: (-s['score'], -datetime.fromisoformat(s['published']).timestamp(), s['url']))
    counts = dict.fromkeys(QUOTAS, 0)
    selected = []
    for story in stories:
        region = story['region']
        if counts[region] < QUOTAS[region]:
            selected.append(story)
            counts[region] += 1
    if counts != QUOTAS:
        raise ValueError(f'Incomplete edition {now.date()}: {counts}; existing snapshot unchanged')
    return {'date': now.date().isoformat(), 'updated': now.isoformat(timespec='seconds'), 'stories': selected}


def main():
    from news_sources import collect
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    dest = parser.parse_args().output
    now = datetime.now(BEIJING)
    result = edition(collect(now), now)
    if dest.exists():
        old = json.loads(dest.read_text(encoding='utf-8'))
        if old.get('date') == result['date'] and old.get('stories') == result['stories']:
            print('Same edition; no write')
            return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=dest.parent, delete=False) as f:
        json.dump(result, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')
    os.replace(f.name, dest)
    print(f"Published snapshot for {result['date']}: {len(result['stories'])} stories")


if __name__ == '__main__':
    main()
