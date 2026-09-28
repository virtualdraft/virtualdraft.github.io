/*
 * デモデータ生成
 * データ取得元が未設定の年度のみ使用します。選手名・所属はすべて架空です。
 * 実シートと同じ「表形式CSV」を生成し、本番と同じ整形処理を通して表示します。
 */
(function () {
  const SURNAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '清水', '森', '池田', '橋本', '石川', '前田', '藤田', '岡田', '後藤', '長谷川', '村上', '近藤', '坂本', '遠藤', '青木', '西村', '福田', '太田', '三浦', '藤原', '岡本', '松田', '中島'];
  const GIVEN = ['大翔', '蓮', '悠真', '湊', '陽翔', '颯太', '樹', '律', '奏太', '悠人', '陸', '朝陽', '航', '瑛太', '海斗', '蒼', '翔太', '拓海', '大和', '健太', '隼人', '慶', '優斗', '亮', '誠也', '一輝', '光', '晴', '匠', '康介'];
  const SCHOOLS = ['桜ヶ丘高', '青葉学院高', '港南工高', '北陵高', '白鷺高', '明和学園高', '城北大', '東都学院大', '関西産業大', '九州国際大', '北洋大', '中部工大', '湘南大', '社会人・東央製鉄', '社会人・西海ガス', '独立・北信リーグ'];
  const POS = ['投', '投', '投', '投', '捕', '内', '内', '外', '外'];

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function makePlayers(rand, n) {
    const used = new Set(), list = [];
    while (list.length < n) {
      const name = SURNAMES[Math.floor(rand() * SURNAMES.length)] + ' ' + GIVEN[Math.floor(rand() * GIVEN.length)];
      if (used.has(name)) continue;
      used.add(name);
      list.push({ name, pos: POS[Math.floor(rand() * POS.length)], school: SCHOOLS[Math.floor(rand() * SCHOOLS.length)] });
    }
    return list;
  }
  const cell = p => `${p.name}（${p.pos}・${p.school}）`;

  function simulate(year, cfg, stage) {
    const rand = rng(year * 7919);
    const teams = cfg.teams.map(t => t.id);
    const pool = makePlayers(rand, 200);
    const taken = new Set();
    const grid = {};
    teams.forEach(id => (grid[id] = {}));
    const owners = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    teams.forEach((id, i) => (grid[id]['担当者'] = `参加者${owners[(i + year) % 12]}`));

    // 明言（半数程度）
    const stars = pool.slice(0, 10);
    const declared = {};
    teams.forEach(id => { if (rand() < 0.5) declared[id] = stars[Math.floor(rand() * 5)]; });
    teams.forEach(id => { if (declared[id]) grid[id]['明言'] = cell(declared[id]); });
    if (stage === 'before') return grid;

    // 1位入札
    let remaining = teams.slice();
    const maxRounds = stage === 'live' ? 2 : 5;
    for (let round = 1; round <= maxRounds && remaining.length; round++) {
      const bids = {};
      remaining.forEach(id => {
        let p = round === 1 && declared[id] ? declared[id] : null;
        if (!p) {
          const cands = pool.slice(0, 18).filter(x => !taken.has(x.name));
          p = cands[Math.floor(Math.pow(rand(), 1.8) * cands.length)];
        }
        (bids[p.name] = bids[p.name] || { p, teams: [] }).teams.push(id);
      });
      const label = `1位${'①②③④⑤'[round - 1]}`;
      const next = [];
      const pendingLast = stage === 'live' && round === maxRounds;
      Object.values(bids).forEach(({ p, teams: ts }) => {
        if (ts.length === 1) { grid[ts[0]][label] = cell(p); taken.add(p.name); return; }
        if (pendingLast) { ts.forEach(id => (grid[id][label] = cell(p))); return; }
        const w = ts[Math.floor(rand() * ts.length)];
        taken.add(p.name);
        ts.forEach(id => {
          grid[id][label] = (id === w ? '○' : '×') + cell(p);
          if (id !== w) next.push(id);
        });
      });
      remaining = next;
    }

    // 2位以降（本指名）と育成
    const free = pool.filter(p => !taken.has(p.name));
    const lastMain = stage === 'live' ? 4 : 5 + Math.floor(rand() * 3);
    const quota = Object.fromEntries(teams.map(id => [id, stage === 'live' ? lastMain : 4 + Math.floor(rand() * 4)]));
    for (let rank = 2; rank <= lastMain + 3; rank++) {
      const order = rank % 2 ? teams.slice().reverse() : teams;
      order.forEach(id => { if (rank <= quota[id] && free.length) grid[id][`${rank}位`] = cell(free.shift()); });
    }
    if (stage !== 'live') {
      teams.forEach(id => {
        const n = Math.floor(rand() * 5);
        for (let r = 1; r <= n && free.length; r++) grid[id][`育成${r}位`] = cell(free.shift());
      });
    }
    return grid;
  }

  function csv(year, cfg) {
    const phase = window.DraftPhase ? window.DraftPhase(year) : 'after';
    const grid = simulate(year, cfg, phase);
    const labels = ['担当者', '明言', '1位①', '1位②', '1位③', '1位④', '1位⑤'];
    for (let r = 2; r <= 10; r++) labels.push(`${r}位`);
    for (let r = 1; r <= 6; r++) labels.push(`育成${r}位`);
    const teams = cfg.teams;
    const q = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [['球団', ...teams.map(t => t.short)].map(q).join(',')];
    labels.forEach(l => lines.push([l, ...teams.map(t => grid[t.id][l] || '')].map(q).join(',')));
    lines.push(['人数', ...teams.map(() => '')].join(','));
    return lines.join('\n');
  }

  window.DraftDemo = { csv };
})();
