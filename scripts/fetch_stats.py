#!/usr/bin/env python3
"""NPB公式サイトの球団別「個人守備成績」「個人投手成績」（一軍・ファーム）を取得し、
デプス表用の data/stats.json に保存する。

- GitHub Actions から所属選手データ（fetch_rosters.py）と同じタイミングで実行する。
- 標準ライブラリのみで動作。NPBへの負荷を抑えるため、ページごとに間隔を空けて取得する。
- 1ページでも取得・解析に失敗した場合は既存ファイルを上書きせずに終了する。
"""
import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

TEAMS = {
    'giants': 'g', 'tigers': 't', 'baystars': 'db', 'carp': 'c', 'swallows': 's', 'dragons': 'd',
    'hawks': 'h', 'fighters': 'f', 'marines': 'm', 'eagles': 'e', 'buffaloes': 'b', 'lions': 'l',
}
JST = timezone(timedelta(hours=9))
YEAR = datetime.now(JST).year
URL = 'https://npb.jp/bis/{year}/stats/{kind}{level}_{code}.html'  # kind: idf=守備 / idp=投手、level: 1=一軍 / 2=ファーム
OUT = Path(__file__).resolve().parent.parent / 'data' / 'stats.json'
FIELD_POS = {'投手': 'P', '捕手': 'C', '一塁手': '1B', '二塁手': '2B', '三塁手': '3B', '遊撃手': 'SS', '外野手': 'OF'}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'virtualdraft-site-stats-fetch/1.0 (+https://virtualdraft.github.io/)'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode('utf-8', errors='replace')


def cell(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()


# 同じ字の異体字をそろえる（互換漢字、例：「海」U+FA45→U+6D77 は NFKC で統一される）
VARIANTS = str.maketrans({'髙': '高', '﨑': '崎', '德': '徳', '濵': '浜', '邊': '辺', '邉': '辺', '俠': '侠', '齋': '斎',
                          '齊': '斉', '槇': '槙', '𠮷': '吉', '栁': '柳', '冨': '富', '曻': '昇', '瀨': '瀬', '惠': '恵', '黑': '黒'})


def key(name):
    """所属選手データと突き合わせるための名前キー（空白・左投の印 *・異体字セレクタを除き、字体をそろえる）"""
    n = unicodedata.normalize('NFKC', name)
    return re.sub(r'[\s*+\U000E0100-\U000E01EF︀-️]', '', n).translate(VARIANTS)


def tables(page):
    out = []
    for m in re.finditer(r'(?:<h5>(.*?)</h5>\s*)?<table[^>]*>(.*?)</table>', page, re.S):
        rows = [[cell(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
                for r in re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(2), re.S)]
        out.append((cell(m.group(1) or ''), [r for r in rows if r]))
    return out


def innings(s):
    """投球回 '7.1' は 7と1/3回"""
    m = re.fullmatch(r'(\d+)(?:\.(\d))?', s.strip())
    if not m:
        return 0.0
    return int(m.group(1)) + (int(m.group(2) or 0) / 3)


def num(s):
    return int(s) if re.fullmatch(r'\d+', s.strip()) else 0


def updated_label(page):
    m = re.search(r'(\d{4}年\d{1,2}月\d{1,2}日)\s*現在', page)
    return m.group(1) if m else ''


def parse_field(page):
    res = {}
    for title, rows in tables(page):
        pos = FIELD_POS.get(title)
        if not pos or not rows:
            continue
        head = rows[0]
        gi = head.index('試合') if '試合' in head else 1
        for r in rows[1:]:
            if len(r) > gi and r[0]:
                res.setdefault(pos, {})[key(r[0])] = num(r[gi])
    return res


def parse_pitch(page):
    res = {}
    for _, rows in tables(page):
        if not rows or '登板' not in rows[0]:
            continue
        head = rows[0]
        col = lambda n: head.index(n) if n in head else None  # noqa: E731
        g, sv, hld, ip = col('登板'), col('セーブ'), col('ホールド'), col('投球回')
        for r in rows[1:]:
            if not r or not r[0]:
                continue
            res[key(r[0])] = {
                'g': num(r[g]) if g is not None else 0,
                'sv': num(r[sv]) if sv is not None else 0,
                'hld': num(r[hld]) if hld is not None else 0,
                'ip': round(innings(r[ip]), 2) if ip is not None else 0,
            }
    return res


def main():
    result = {'source': 'NPB.jp 日本野球機構「個人守備成績」「個人投手成績」', 'year': YEAR,
              'fetchedAt': datetime.now(JST).isoformat(timespec='seconds'), 'teams': {}}
    first = True
    for team, code in TEAMS.items():
        t = {}
        for kind, level in (('idf', 1), ('idf', 2), ('idp', 1), ('idp', 2)):
            if not first:
                time.sleep(1.5)
            first = False
            url = URL.format(year=YEAR, kind=kind, level=level, code=code)
            try:
                page = fetch(url)
            except Exception as e:  # noqa: BLE001
                print(f'NG {team} {kind}{level}: {e}', file=sys.stderr)
                return 1
            data = parse_field(page) if kind == 'idf' else parse_pitch(page)
            if not data:
                print(f'NG {team} {kind}{level}: 表を読み取れません', file=sys.stderr)
                return 1
            t[f'{"field" if kind == "idf" else "pitch"}{level}'] = data
            if kind == 'idf' and level == 1:
                t['updated'] = updated_label(page)
        result['teams'][team] = t
        print(f"OK {team}: 守備 一軍{sum(len(v) for v in t['field1'].values())}件 ファーム{sum(len(v) for v in t['field2'].values())}件 / "
              f"投手 一軍{len(t['pitch1'])}人 ファーム{len(t['pitch2'])}人 ({t.get('updated', '')})")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    new_body = json.dumps(result['teams'], ensure_ascii=False, sort_keys=True)
    if OUT.exists():
        try:
            if json.dumps(json.loads(OUT.read_text(encoding='utf-8')).get('teams'), ensure_ascii=False, sort_keys=True) == new_body:
                print('変更なし')
                return 0
        except ValueError:
            pass
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'保存: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
