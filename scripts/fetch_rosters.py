#!/usr/bin/env python3
"""NPB公式サイトの球団別「選手一覧」から所属選手を取得し、data/rosters.json に保存する。

- GitHub Actions から1日1〜2回実行する想定（.github/workflows/rosters.yml）。
- 標準ライブラリのみで動作。NPBへの負荷を抑えるため、球団ごとに間隔を空けて取得する。
- 退団・移籍済みの選手（一覧上で rosterRetire の行）と監督は含めない。
- 1球団でも取得・解析に失敗した場合は既存ファイルを上書きせずに終了する。
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# サイト側の球団ID → NPB のURLコード
TEAMS = {
    'giants': 'g', 'tigers': 't', 'baystars': 'db', 'carp': 'c', 'swallows': 's', 'dragons': 'd',
    'hawks': 'h', 'fighters': 'f', 'marines': 'm', 'eagles': 'e', 'buffaloes': 'b', 'lions': 'l',
}
BASE = 'https://npb.jp'
URL = BASE + '/bis/teams/rst_{code}.html'
OUT = Path(__file__).resolve().parent.parent / 'data' / 'rosters.json'
POSITIONS = ('投手', '捕手', '内野手', '外野手')
JST = timezone(timedelta(hours=9))


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'virtualdraft-site-roster-fetch/1.0 (+https://virtualdraft.github.io/)'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode('utf-8', errors='replace')


def text(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))
    return re.sub(r'[\s　]+', ' ', s).strip()


def parse(page):
    updated = re.search(r'class="rosterUpdate">(.*?)<', page)
    players = []
    # 「■ 支配下選手」「■ 育成選手」で区切る
    sections = re.split(r'<h3>\s*■\s*', page)
    for sec in sections[1:]:
        title = text(sec[:40])
        status = '育成' if title.startswith('育成') else '支配下' if title.startswith('支配下') else None
        if not status:
            continue
        pos = None
        for m in re.finditer(r'<tr class="(rosterMainHead|rosterPlayer|rosterRetire)"[^>]*>(.*?)</tr>', sec, re.S):
            kind, row = m.group(1), m.group(2)
            if kind == 'rosterMainHead':
                h = re.search(r'class="rosterPos"[^>]*>(.*?)</th>', row, re.S)
                pos = text(h.group(1)) if h else None
                continue
            if kind == 'rosterRetire' or pos not in POSITIONS:
                continue  # 退団・移籍済み、監督など
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
            if len(cells) < 8:
                continue
            link = re.search(r'href="(/bis/players/\d+\.html)"', cells[1])
            name = text(cells[1])
            birth = text(cells[2]).replace('.', '-')
            players.append({
                'no': text(cells[0]),
                'name': name,
                'pos': pos,
                'status': status,
                'birth': birth if re.fullmatch(r'\d{4}-\d{2}-\d{2}', birth) else '',
                'height': int(text(cells[3])) if text(cells[3]).isdigit() else None,
                'weight': int(text(cells[4])) if text(cells[4]).isdigit() else None,
                'throws': text(cells[5]),
                'bats': text(cells[6]),
                'note': text(cells[7]),
                'id': re.search(r'(\d+)', link.group(1)).group(1) if link else '',
            })
    return (text(updated.group(1)) if updated else ''), players


def main():
    result = {
        'source': 'NPB.jp 日本野球機構「選手一覧」',
        'playerUrl': BASE + '/bis/players/{id}.html',
        'fetchedAt': datetime.now(JST).isoformat(timespec='seconds'),
        'teams': {},
    }
    for i, (team, code) in enumerate(TEAMS.items()):
        if i:
            time.sleep(2)
        url = URL.format(code=code)
        try:
            updated, players = parse(fetch(url))
        except Exception as e:  # noqa: BLE001
            print(f'NG {team}: {e}', file=sys.stderr)
            return 1
        main_n = sum(p['status'] == '支配下' for p in players)
        if main_n < 40 or main_n > 80:
            print(f'NG {team}: 支配下 {main_n}名は想定外のため中止', file=sys.stderr)
            return 1
        result['teams'][team] = {'url': url, 'updated': updated, 'players': players}
        print(f'OK {team}: 支配下 {main_n} / 育成 {len(players) - main_n}  ({updated})')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    old = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
    new_body = json.dumps(result['teams'], ensure_ascii=False, sort_keys=True)
    if old:
        try:
            if json.dumps(json.loads(old).get('teams'), ensure_ascii=False, sort_keys=True) == new_body:
                print('変更なし')
                return 0
        except ValueError:
            pass
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'保存: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
