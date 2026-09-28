/*
 * データ取得・整形
 * Googleスプレッドシート（読み取り専用）からCSVを取得し、サイト表示用のモデルに変換します。
 * シートへの書き込みは一切行いません。
 */
(function () {
  const CFG = window.DRAFT_CONFIG;
  const CACHE_PREFIX = 'vdraft:v2:';

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', i = 0, quoted = false;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim()));
  }

  // ---------- 文字列正規化 ----------
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
  function norm(s) {
    return String(s || '')
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[　\s]+/g, ' ')
      .trim();
  }
  function circledToNum(s) {
    return s.replace(/[①-⑩]/g, c => '(' + (CIRCLED.indexOf(c) + 1) + ')');
  }

  const teamIndex = new Map();
  CFG.teams.forEach(t => {
    [t.id, t.name, t.short, ...(t.aliases || [])].forEach(a => teamIndex.set(norm(a).toLowerCase(), t));
  });
  function findTeam(label) {
    const key = norm(label).toLowerCase();
    if (!key) return null;
    if (teamIndex.has(key)) return teamIndex.get(key);
    // 部分一致（例：「巨人（担当：○○）」）。1文字の略称は部分一致に使わない
    for (const t of CFG.teams) {
      const names = [t.name, t.short, ...(t.aliases || [])].filter(a => a.length >= 2);
      if (names.some(a => key.includes(norm(a).toLowerCase()))) return t;
    }
    return null;
  }

  // ---------- 選手セル ----------
  const POS_MAP = [
    [/^(投|投手|P)$/i, '投手'],
    [/^(捕|捕手|C)$/i, '捕手'],
    [/^(内|内野|内野手|IF)$/i, '内野手'],
    [/^(外|外野|外野手|OF)$/i, '外野手'],
    [/^(一|一塁|一塁手|二|二塁|二塁手|三|三塁|三塁手|遊|遊撃|遊撃手)$/, '内野手'],
    [/^(左|中|右|左翼|中堅|右翼)$/, '外野手'],
  ];
  const POSITIONS = ['投手', '捕手', '内野手', '外野手'];
  // 指名終了・不参加などの記号（選手としては扱わない）
  const END_MARK = /^(選択終了|指名終了|終了|不参加|指名なし|なし|パス)$/;
  function posGroup(s) {
    const v = norm(s).replace(/\s/g, '');
    if (!v) return '';
    for (const [re, g] of POS_MAP) if (re.test(v)) return g;
    if (/投/.test(v)) return '投手';
    if (/捕/.test(v)) return '捕手';
    if (/内野|一塁|二塁|三塁|遊撃/.test(v)) return '内野手';
    if (/外野/.test(v)) return '外野手';
    return '';
  }

  /**
   * 「山田太郎（投・○○高）」「○山田太郎(投手/○○大)」「山田太郎 投 ○○高」などを解釈する。
   * 先頭/末尾の ○◎ は抽選当選、×✕ は抽選外れとして扱う。
   */
  function parsePlayer(raw, extra) {
    let s = norm(raw);
    if (!s || /^[-－―ー—]+$/.test(s) || END_MARK.test(s)) return null;
    let mark = null;
    if (/^[○◯◎〇]|[○◯◎〇]$|\(当選\)|\(交渉権\)|\(獲得\)/.test(s)) mark = 'win';
    if (/^[×✕✖xX]\s|[×✕✖]$|^[×✕✖]|\(外れ\)|\(はずれ\)/.test(s)) mark = 'lose';
    s = s.replace(/^[○◯◎〇×✕✖]\s*/, '').replace(/\s*[○◯◎〇×✕✖]$/, '')
      .replace(/\((当選|交渉権|獲得|外れ|はずれ)\)/g, '').trim();

    let name = s, pos = '', school = '';
    const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) {
      name = m[1].trim();
      const parts = m[2].split(/[・\/／,、\s]+/).filter(Boolean);
      if (parts.length && posGroup(parts[0])) { pos = parts.shift(); }
      else if (parts.length > 1 && posGroup(parts[parts.length - 1])) { pos = parts.pop(); }
      school = parts.join(' ');
    } else {
      // 「名前/投/所属」または「名前 投 所属」。名前自体に空白を含む場合（例：西川 史礁）は分割しない
      let parts = s.split(/[\/／]/).map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) {
        const ws = s.split(/\s+/);
        const pi = ws.findIndex((w, i) => i > 0 && posGroup(w) && w.length <= 3);
        parts = pi > 0 ? [ws.slice(0, pi).join(' '), ...ws.slice(pi)] : [s];
      }
      if (parts.length > 1) {
        name = parts.shift();
        if (posGroup(parts[0])) pos = parts.shift();
        school = parts.join(' ');
      }
    }
    if (extra) {
      if (extra.pos) pos = extra.pos;
      if (extra.school) school = extra.school;
      if (extra.mark) mark = extra.mark;
    }
    return { name, pos, posGroup: posGroup(pos), school, mark, key: name.replace(/\s/g, '') };
  }

  function lotteryMark(v) {
    const s = norm(v);
    if (!s) return null;
    if (/^(○|◯|◎|〇|当選|当|獲得|交渉権|win)$/i.test(s)) return 'win';
    if (/^(×|✕|✖|x|外れ|はずれ|外|lose)$/i.test(s)) return 'lose';
    return null;
  }

  // ---------- 行ラベルの分類 ----------
  function classifyLabel(label) {
    const s = circledToNum(norm(label)).replace(/\s/g, '');
    if (!s) return null;
    if (/担当/.test(s)) return { type: 'owner' };
    if (/明言/.test(s)) return { type: 'declared' };
    if (/(人数|合計|集計|^計$|小計)/.test(s)) return null;
    let m = s.match(/^育成(?:指名)?(?:第)?(\d+)(?:位|巡目)?$/);
    if (m) return { type: 'dev', rank: +m[1] };
    m = s.match(/^(?:第)?1(?:位|巡目)(.*)$/);
    if (m) {
      const rest = m[1];
      const r = rest.match(/(\d+)/);
      if (r) return { type: 'bid', round: +r[1] };
      if (/入札/.test(rest)) return { type: 'bid', round: 1 };
      return { type: 'main', rank: 1 };
    }
    m = s.match(/^(?:第)?(\d+)(?:位|巡目)$/);
    if (m) return { type: 'main', rank: +m[1] };
    return null;
  }

  // ---------- セル色 → ポジション ----------
  // 凡例と完全一致しない色（例：捕手の #a4c2f4 に対して #9fc5e8）も、凡例の中で最も近い色が十分近ければ同じポジションとみなす
  const COLOR_TOLERANCE = 60; // RGB空間での距離の上限
  function hexToRgb(c) {
    const m = String(c || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  function posFromColor(color, posByColor) {
    if (!color) return '';
    if (posByColor[color]) return posByColor[color];
    const rgb = hexToRgb(color);
    if (!rgb) return '';
    let best = '', bestDist = Infinity;
    for (const [c, pos] of Object.entries(posByColor)) {
      const ref = hexToRgb(c);
      if (!ref) continue;
      const d = Math.hypot(rgb[0] - ref[0], rgb[1] - ref[1], rgb[2] - ref[2]);
      if (d < bestDist) { bestDist = d; best = pos; }
    }
    return bestDist <= COLOR_TOLERANCE ? best : '';
  }

  // ---------- 表形式（球団が列、項目が行） ----------
  // colors: セル背景色（HTML取得時のみ）。見出し行より上にある「投手/捕手/内野手/外野手」の凡例セルの色でポジションを判定する。
  function parseGrid(rows, colors) {
    let headerIdx = -1, teamCols = [];
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const cols = [];
      rows[r].forEach((c, ci) => { const t = findTeam(c); if (t && !cols.some(x => x.team === t)) cols.push({ ci, team: t }); });
      if (cols.length >= 6) { headerIdx = r; teamCols = cols; break; }
    }
    if (headerIdx < 0) throw new Error('球団名の見出し行が見つかりません');

    const posByColor = {};
    if (colors) {
      for (let r = 0; r < headerIdx; r++) {
        rows[r].forEach((c, ci) => {
          const g = norm(c), col = colors[r] && colors[r][ci];
          if (POSITIONS.includes(g) && col && !/^#?f{6}$|^white$/i.test(col)) posByColor[col] = g;
        });
      }
    }

    const labelCol = Math.max(0, teamCols[0].ci - 1);
    const entries = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const kind = classifyLabel(rows[r][labelCol]);
      if (!kind) continue;
      teamCols.forEach(({ ci, team }) => {
        const v = norm(rows[r][ci]);
        if (!v) return;
        if (END_MARK.test(v)) {
          if (kind.type === 'main' || kind.type === 'dev') entries.push({ team: team.id, kind: { type: 'end', of: kind.type, rank: kind.rank }, value: v });
          return;
        }
        const color = colors && colors[r] && colors[r][ci];
        entries.push({ team: team.id, kind, value: v, extra: { pos: posFromColor(color, posByColor) } });
      });
    }
    return { order: teamCols.map(x => x.team.id), entries, hasColorPos: Object.keys(posByColor).length > 0 };
  }

  // ---------- 縦持ち形式（1行1指名） ----------
  function parseLong(rows) {
    const h = rows[0].map(c => norm(c));
    const col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
    const cTeam = col('球団', 'チーム'), cKind = col('区分', '種別'), cRank = col('順位', '回'),
      cName = col('選手', '氏名', '名前'), cPos = col('ポジション', '守備', '位置'),
      cSchool = col('所属', '学校'), cLot = col('抽選', '結果');
    const entries = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const team = findTeam(row[cTeam]);
      const k = norm(row[cKind]);
      const rank = parseInt(norm(row[cRank]), 10);
      const value = row[cName] || '';
      if (!team || !norm(value)) continue;
      let kind = null;
      if (/担当/.test(k)) kind = { type: 'owner' };
      else if (/明言/.test(k)) kind = { type: 'declared' };
      else if (/入札|競合/.test(k)) kind = { type: 'bid', round: rank || 1 };
      else if (/育成/.test(k)) kind = { type: 'dev', rank };
      else if (/本指名|支配下|指名/.test(k)) kind = { type: 'main', rank };
      if (!kind || ((kind.type === 'dev' || kind.type === 'main') && !rank)) continue;
      entries.push({
        team: team.id, kind, value,
        extra: { pos: cPos >= 0 ? norm(row[cPos]) : '', school: cSchool >= 0 ? norm(row[cSchool]) : '', mark: cLot >= 0 ? lotteryMark(row[cLot]) : null },
      });
    }
    return { order: CFG.teams.map(t => t.id), entries };
  }

  // ---------- シートのHTML表示（セルの背景色を含む）を表データに変換 ----------
  function parseSheetHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table.waffle') || doc.querySelector('table');
    if (!table) throw new Error('シートを読み取れません（共有設定をご確認ください）');
    const bg = {};
    doc.querySelectorAll('style').forEach(st => {
      st.textContent.replace(/\.([\w-]+)\s*\{([^}]*)\}/g, (_, cls, body) => {
        const m = body.match(/background-color:\s*([^;]+)/);
        if (m) bg[cls] = m[1].trim().toLowerCase();
        return '';
      });
    });
    const rows = [], colors = [];
    table.querySelectorAll('tr').forEach(tr => {
      const row = [], col = [];
      tr.querySelectorAll('td').forEach(td => {
        if (td.classList.contains('freezebar-cell')) return;
        td.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
        const text = td.textContent.trim();
        const cls = [...td.classList].find(c => bg[c]);
        const span = parseInt(td.getAttribute('colspan'), 10) || 1;
        for (let i = 0; i < span; i++) { row.push(i ? '' : text); col.push(i ? '' : (cls ? bg[cls] : '')); }
      });
      if (row.length) { rows.push(row); colors.push(col); }
    });
    return { rows, colors };
  }

  // ---------- モデル構築 ----------
  // input: CSV文字列、または { rows, colors }
  function buildModel(year, input) {
    const data = typeof input === 'string' ? { rows: parseCSV(input), colors: null } : input;
    const first = data.rows.findIndex(r => r.some(c => c));
    if (first < 0) throw new Error('シートが空です');
    const head = data.rows[first];
    const isLong = head.some(c => /区分|種別/.test(c)) && head.some(c => /球団|チーム/.test(c));
    const { order, entries, hasColorPos } = isLong ? parseLong(data.rows.slice(first)) : parseGrid(data.rows, data.colors);

    const byId = Object.fromEntries(CFG.teams.map(t => [t.id, t]));
    const teams = order.map(id => ({
      ...byId[id], owner: '', declared: null, bids: [], first: null, firstFixed: null, main: [], dev: [], endMain: null, endDev: null,
    }));
    const tmap = Object.fromEntries(teams.map(t => [t.id, t]));

    entries.forEach(({ team, kind, value, extra }) => {
      const t = tmap[team];
      if (!t) return;
      if (kind.type === 'owner') { const o = norm(value); t.owner = /^[?？]+$/.test(o) ? '' : o; return; }
      if (kind.type === 'end') {
        if (kind.of === 'main' && t.endMain == null) t.endMain = kind.rank;
        if (kind.of === 'dev' && t.endDev == null) t.endDev = kind.rank;
        return;
      }
      const p = parsePlayer(value, extra);
      if (!p) return;
      if (kind.type === 'declared') t.declared = p;
      else if (kind.type === 'bid') t.bids.push({ round: kind.round, player: p });
      else if (kind.type === 'main' && kind.rank === 1) t.firstFixed = p;
      else if (kind.type === 'main') t.main.push({ rank: kind.rank, player: p });
      else if (kind.type === 'dev') t.dev.push({ rank: kind.rank, player: p });
    });

    // 1位入札の競合判定。抽選結果の印（○×）がなければ「本指名1位」の行から当選球団を判断する
    const roundNums = [...new Set(teams.flatMap(t => t.bids.map(b => b.round)))].sort((a, b) => a - b);
    const rounds = roundNums.map(round => {
      const groups = new Map();
      teams.forEach(t => t.bids.filter(b => b.round === round).forEach(b => {
        if (!groups.has(b.player.key)) groups.set(b.player.key, { player: b.player, bids: [] });
        groups.get(b.player.key).bids.push({ team: t.id, mark: b.player.mark });
      }));
      const list = [...groups.values()].map(g => {
        let winner = null, status;
        if (g.bids.length === 1) {
          const lost = g.bids[0].mark === 'lose';
          winner = lost ? null : g.bids[0].team;
          status = lost ? 'lost' : 'single';
        } else {
          const w = g.bids.find(b => b.mark === 'win') ||
            g.bids.find(b => tmap[b.team].firstFixed && tmap[b.team].firstFixed.key === g.player.key);
          winner = w ? w.team : null;
          status = w ? 'decided' : 'pending';
        }
        return { player: g.player, teams: g.bids.map(b => b.team), winner, status, contested: g.bids.length > 1 };
      }).sort((a, b) => b.teams.length - a.teams.length);
      return { round, groups: list };
    });

    // 各球団の1位（「1位」行があれば優先、なければ入札結果から）
    teams.forEach(t => {
      for (const r of rounds) {
        const g = r.groups.find(g => g.winner === t.id);
        if (g) { t.first = g.player; t.firstRound = r.round; t.firstContested = g.contested; break; }
      }
      if (t.firstFixed) {
        if (!t.first || t.first.key !== t.firstFixed.key) { t.firstContested = false; t.firstRound = null; }
        t.first = t.firstFixed;
      }
    });
    teams.forEach(t => {
      if (t.first) t.main.unshift({ rank: 1, player: t.first });
      t.main.sort((a, b) => a.rank - b.rank);
      t.dev.sort((a, b) => a.rank - b.rank);
      t.counts = { main: t.main.length, dev: t.dev.length };
      t.byPos = countPositions([...t.main, ...t.dev]);
      t.byPosMain = countPositions(t.main);
      t.byPosDev = countPositions(t.dev);
    });

    const maxMain = Math.max(1, ...teams.map(t => Math.max(t.endMain || 0, t.main.reduce((m, x) => Math.max(m, x.rank), 0))));
    const maxDev = Math.max(0, ...teams.map(t => Math.max(t.endDev || 0, t.dev.reduce((m, x) => Math.max(m, x.rank), 0))));
    const totals = {
      main: teams.reduce((s, t) => s + t.counts.main, 0),
      dev: teams.reduce((s, t) => s + t.counts.dev, 0),
    };
    const hasPositions = isLong || !!hasColorPos || teams.some(t => [...t.main, ...t.dev].some(x => x.player.posGroup));
    return { year, format: isLong ? 'long' : 'grid', teams, rounds, maxMain, maxDev, totals, hasPositions, hasDeclared: teams.some(t => t.declared) };
  }

  function countPositions(list) {
    const c = Object.fromEntries([...POSITIONS, '不明'].map(p => [p, 0]));
    list.forEach(x => { c[x.player.posGroup || '不明']++; });
    return c;
  }

  // ---------- 取得 ----------
  // 取得元の候補（上から順に試す）。
  //  html: シートのHTML表示。セルの背景色（ポジション色分け）まで読める
  //  csv : CSV。背景色は読めないため、HTMLが取れないときの予備
  function sources(year) {
    const y = (CFG.years || {})[year] || {};
    if (y.csvUrl) return [{ type: 'csv', url: y.csvUrl }];
    const id = y.spreadsheetId || CFG.spreadsheetId;
    const gid = y.gid == null ? '' : String(y.gid);
    if (!id || (!gid && !y.sheet)) return [];
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;
    const list = [];
    if (gid) list.push({ type: 'html', url: `${base}/htmlview/sheet?headers=false&gid=${encodeURIComponent(gid)}` });
    const q = gid ? 'gid=' + encodeURIComponent(gid) : 'sheet=' + encodeURIComponent(y.sheet);
    list.push({ type: 'csv', url: `${base}/gviz/tq?tqx=out:csv&headers=1&${q}` });
    return list;
  }
  function sourceUrl(year) { const s = sources(year); return s.length ? s[0].url : null; }

  async function fetchSource(src) {
    const sep = src.url.includes('?') ? '&' : '?';
    const res = await fetch(src.url + sep + '_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (src.type === 'html') return parseSheetHTML(text);
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('シートを読み取れません（共有設定をご確認ください）');
    return { rows: parseCSV(text), colors: null };
  }

  function readCache(year) {
    try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + year) || 'null'); } catch (e) { return null; }
  }
  function writeCache(year, data, fetchedAt) {
    try { localStorage.setItem(CACHE_PREFIX + year, JSON.stringify({ data, fetchedAt })); } catch (e) { /* 保存できなくても表示は継続 */ }
  }

  /**
   * 年度データを取得する。
   * 戻り値: { model, fetchedAt, source: 'sheet'|'cache'|'demo'|'none', error? }
   * 取得失敗時は前回取得分（メモリ→ブラウザ保存）を返し、error を付ける。
   */
  const memory = {};
  async function load(year) {
    const list = sources(year);
    if (!list.length) {
      if (memory[year]) return { ...memory[year], changed: false };
      const csv = window.DraftDemo.csv(year, CFG);
      return (memory[year] = { model: buildModel(year, csv), changed: true, fetchedAt: Date.now(), source: 'demo' });
    }
    let lastErr;
    for (const src of list) {
      try {
        const data = await fetchSource(src);
        const model = buildModel(year, data);
        const json = JSON.stringify(data);
        const fetchedAt = Date.now();
        const changed = !memory[year] || memory[year].json !== json;
        writeCache(year, data, fetchedAt);
        return (memory[year] = { model, json, changed, fetchedAt, source: 'sheet', via: src.type });
      } catch (err) { lastErr = err; }
    }
    const message = lastErr && lastErr.message === 'Failed to fetch' ? '通信エラー' : (lastErr ? lastErr.message : '不明なエラー');
    if (memory[year] && memory[year].model) return { ...memory[year], error: message, failedAt: Date.now() };
    const c = readCache(year);
    if (c && c.data) {
      try { return (memory[year] = { model: buildModel(year, c.data), fetchedAt: c.fetchedAt, source: 'cache', error: message, failedAt: Date.now() }); } catch (e) { /* 壊れたキャッシュは無視 */ }
    }
    return { model: null, fetchedAt: null, source: 'none', error: message, failedAt: Date.now() };
  }

  /** 画面表示を速くするため、ネットワークを待たずにブラウザ保存分を返す */
  function peek(year) {
    if (memory[year]) return memory[year];
    if (!sources(year).length) return null;
    const c = readCache(year);
    if (!c || !c.data) return null;
    try { return { model: buildModel(year, c.data), fetchedAt: c.fetchedAt, source: 'cache' }; } catch (e) { return null; }
  }

  window.DraftData = { load, peek, buildModel, parseCSV, parseSheetHTML, parsePlayer, sourceUrl, POSITIONS };
})();
