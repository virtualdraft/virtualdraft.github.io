/*
 * 追加機能
 *   #/prospects   ドラフト会議2026 注目選手
 *   #/npb         NPB 12球団の所属選手（一覧・分布）
 *   #/npb/<球団>   球団別の所属選手・年齢/ポジション分布
 *   #/sim/<球団>   戦力外などのシミュレーションと指名人数の検討（各自のブラウザに保存）
 * 共通の部品（エスケープ、スコアボード等）は app.js が window.DraftUI として公開する。
 */
(function () {
  const CFG = window.DRAFT_CONFIG;
  const UI = () => window.DraftUI;
  const MAX_MAIN = CFG.rosterLimit || 70;
  const POS = ['投手', '捕手', '内野手', '外野手'];
  const store = { rosters: null, prospects: null, loading: {}, error: {} };
  const view = { prospects: { cat: 'all', pos: 'all' }, roster: { status: 'all', pos: 'all', sort: 'no' }, sim: { pos: 'all', sort: 'no' } };

  // ---------- データ読み込み ----------
  async function loadJSON(key, url) {
    if (store[key] || store.loading[key]) return;
    store.loading[key] = true;
    try {
      const res = await fetch(url + '?_=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      store[key] = await res.json();
      store.error[key] = null;
    } catch (e) {
      store.error[key] = e.message;
    } finally {
      store.loading[key] = false;
      UI().rerender();
    }
  }
  const needRosters = () => loadJSON('rosters', 'data/rosters.json');
  const needProspects = () => loadJSON('prospects', 'data/prospects.json');

  // ---------- 共通 ----------
  const baseDate = new Date((CFG.ageBaseDate || '2027-04-01') + 'T00:00:00+09:00');
  const baseLabel = CFG.ageBaseLabel || '2027年4月1日時点';
  function age(birth) {
    if (!birth) return null;
    const [y, m, d] = birth.split('-').map(Number);
    let a = baseDate.getFullYear() - y;
    const bm = baseDate.getMonth() + 1, bd = baseDate.getDate();
    if (bm < m || (bm === m && bd < d)) a--;
    return a;
  }
  const avg = list => list.length ? (list.reduce((s, x) => s + x, 0) / list.length) : 0;
  const keyOf = p => p.id || p.name.replace(/\s/g, '');

  function teamPlayers(id) {
    const t = store.rosters && store.rosters.teams[id];
    if (!t) return [];
    return t.players.map(p => ({ ...p, age: age(p.birth), key: keyOf(p) }));
  }

  function loadingBlock(key, what) {
    if (store.error[key]) return `<div class="alert">${UI().h(what)}を読み込めませんでした（${UI().h(store.error[key])}）。時間をおいて再読み込みしてください。</div>`;
    return `<div class="status"><span class="status-dot is-loading"></span>${UI().h(what)}を読み込み中…</div>`;
  }

  function teamSwitch(base, active) {
    return `<nav class="team-switch" aria-label="球団切替">${CFG.teams.map(t => `<a href="#/${base}/${t.id}" style="--team:${t.color}" class="${t.id === active ? 'is-active' : ''}">${UI().h(t.short)}</a>`).join('')}</nav>`;
  }

  function chips(group, current, options) {
    return `<div class="filter-chips" role="group">${options.map(([v, label]) => `<button type="button" class="fchip" data-f="${group}" data-v="${v}" aria-pressed="${String(v === current)}">${label}</button>`).join('')}</div>`;
  }

  function sourceNote() {
    const r = store.rosters;
    const upd = r && Object.values(r.teams)[0] ? Object.values(r.teams)[0].updated : '';
    return `<p class="cite center">出典：${UI().ext('https://npb.jp/bis/teams/', 'NPB.jp 日本野球機構「選手一覧」')}（${UI().h(upd)}）。本サイトで毎日自動取得しています。年齢は${baseLabel}。</p>`;
  }

  // ---------- ② 注目選手 ----------
  function draftedBy(p) {
    const res = UI().currentResult();
    const m = res && res.model;
    if (!m) return null;
    const key = p.name.replace(/\s/g, '');
    for (const t of m.teams) {
      const x = t.main.find(x => x.player.key === key);
      if (x) return { team: t, label: `${x.rank}位` };
      const d = t.dev.find(x => x.player.key === key);
      if (d) return { team: t, label: `育成${d.rank}位` };
    }
    return null;
  }

  function viewProspects() {
    const { h, ext } = UI();
    needProspects();
    const d = store.prospects;
    const f = view.prospects;
    let body;
    if (!d) body = loadingBlock('prospects', '注目選手');
    else {
      const list = d.players.filter(p =>
        (f.cat === 'all' || p.category === f.cat) &&
        (f.pos === 'all' || (f.pos === '投手' ? p.posGroup === '投手' || p.posGroup === '二刀流' : p.posGroup !== '投手')));
      body = `
        <div class="filters">
          ${chips('p-cat', f.cat, [['all', 'すべて'], ['高校生', '高校生'], ['大学生', '大学生'], ['社会人', '社会人']])}
          ${chips('p-pos', f.pos, [['all', '投手・野手'], ['投手', '投手'], ['野手', '野手']])}
        </div>
        <ul class="prospect-grid">${list.map(p => prospectCard(p)).join('') || '<li class="muted center">該当する選手はいません。</li>'}</ul>
        <p class="cite center">${h(d.note)}<br>識者評価：${ext(d.experts.url, h(d.experts.label))}で、3人それぞれが選んだ12人に入った人数。</p>`;
    }
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow">ドラフト会議 ${CFG.currentYear}</p><h1 class="page-title">注目選手</h1>
        <p class="muted">1位候補を中心に、実績とプレースタイルを紹介します。</p></div></div>
      ${body}
    </div>`;
  }

  function prospectCard(p) {
    const { h, ext } = UI();
    const shibou = p.shibou.status === '提出済' ? `<span class="pbadge ok">志望届 提出済（${h(p.shibou.date)}）</span>`
      : p.shibou.status === '不要' ? '<span class="pbadge">社会人（志望届不要）</span>'
        : '<span class="pbadge warn">志望届 未提出（9/28時点）</span>';
    const dr = draftedBy(p);
    const meta = [p.pos, p.hand, p.size].filter(Boolean).map(h).join('<i class="sep"></i>');
    return `<li class="prospect">
      <div class="prospect-top"><span class="pcat">${h(p.category)}</span>${shibou}</div>
      <div class="prospect-name"><h2>${h(p.name)}</h2><span class="kana">${h(p.kana)}</span></div>
      <p class="prospect-team">${h(p.team)}${p.grade ? ` ${h(p.grade)}` : ''}${p.from ? `<span class="from">（${h(p.from)}）</span>` : ''}</p>
      <p class="prospect-meta">${meta}</p>
      ${p.stats.length ? `<div class="pstats">${p.stats.map(s => `<div><span>${h(s.label)}</span><b>${h(s.value)}</b></div>`).join('')}</div>` : ''}
      <ul class="phigh">${p.highlights.map(x => `<li>${h(x)}</li>`).join('')}</ul>
      <div class="pcomment"><span class="k">寸評</span><p>${h(p.comment)}</p></div>
      <div class="prospect-foot">
        <span class="experts" aria-label="識者3人中${p.experts}人がトップ12に選出">識者評価 ${[0, 1, 2].map(i => `<i class="edot${i < p.experts ? ' on' : ''}"></i>`).join('')} <b>${p.experts}/3</b></span>
        ${dr ? `<span class="drafted" style="--team:${dr.team.color}">仮想ドラフト：${h(dr.team.short)} ${h(dr.label)}</span>` : ''}
      </div>
      <p class="psrc">出典：${p.sources.map(s => ext(s.url, h(s.label))).join('、')}</p>
    </li>`;
  }

  // ---------- ① NPB 所属選手 ----------
  function summarize(players) {
    const main = players.filter(p => p.status === '支配下'), dev = players.filter(p => p.status === '育成');
    const byPos = (list) => Object.fromEntries(POS.map(ps => [ps, list.filter(p => p.pos === ps).length]));
    return {
      main: main.length, dev: dev.length, open: MAX_MAIN - main.length,
      avgMain: avg(main.map(p => p.age).filter(x => x != null)),
      posMain: byPos(main), posDev: byPos(dev),
    };
  }

  function viewNpb() {
    const { h, scoreboard } = UI();
    needRosters();
    let body;
    if (!store.rosters) body = loadingBlock('rosters', 'NPBの選手データ');
    else {
      const rows = CFG.teams.map(t => ({ t, s: summarize(teamPlayers(t.id)) }));
      const all = summarize(CFG.teams.flatMap(t => teamPlayers(t.id)));
      const maxPos = Math.max(...rows.flatMap(r => POS.map(p => r.s.posMain[p])));
      body = `
        ${scoreboard([
          { label: '支配下（12球団）', value: all.main, unit: '名', cls: 'sb-main' },
          { label: '育成（12球団）', value: all.dev, unit: '名', cls: 'sb-dev' },
          { label: '支配下の空き枠', value: MAX_MAIN * 12 - all.main, unit: '枠' },
          { label: '支配下の平均年齢', value: all.avgMain.toFixed(1), unit: '歳' },
        ])}
        <section class="section">
          <h2 class="section-title">球団別の内訳</h2>
          <div class="hscroll" data-scroll="npb"><table class="npb-table">
            <thead><tr><th scope="col">球団</th><th scope="col">支配下（上限${MAX_MAIN}）</th><th scope="col">空き枠</th><th scope="col">育成</th><th scope="col">平均年齢</th>${POS.map(p => `<th scope="col" class="num">${p}</th>`).join('')}<th scope="col"></th></tr></thead>
            <tbody>${rows.map(({ t, s }) => `<tr>
              <th scope="row"><a href="#/npb/${t.id}" class="tname" style="--team:${t.color}">${h(t.short)}</a></th>
              <td><span class="cap"><span class="cap-bar"><i style="width:${s.main / MAX_MAIN * 100}%"></i></span><b>${s.main}</b></span></td>
              <td class="num${s.open > 0 ? ' open' : ''}">${s.open}</td>
              <td class="num c-dev"><b>${s.dev}</b></td>
              <td class="num">${s.avgMain.toFixed(1)}</td>
              ${POS.map(p => `<td class="num heat" style="--a:${(s.posMain[p] / maxPos).toFixed(2)}">${s.posMain[p]}</td>`).join('')}
              <td><a href="#/sim/${t.id}" class="linkish">シミュレーション ›</a></td>
            </tr>`).join('')}</tbody>
          </table></div>
          <p class="note center">ポジション別の人数は支配下選手のみ。色の濃さは人数の多さを表します。</p>
        </section>
        ${sourceNote()}`;
    }
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow">戦力分析</p><h1 class="page-title">NPB 12球団の所属選手</h1>
        <p class="muted">支配下・育成の人数、年齢、ポジションの分布を球団ごとに確認できます。</p></div></div>
      ${body}
    </div>`;
  }

  function ageChart(players) {
    const { h } = UI();
    const ages = players.map(p => p.age).filter(a => a != null);
    if (!ages.length) return '';
    const lo = Math.min(...ages), hi = Math.max(...ages);
    const cols = [];
    for (let a = lo; a <= hi; a++) {
      const main = players.filter(p => p.age === a && p.status === '支配下').length;
      const dev = players.filter(p => p.age === a && p.status === '育成').length;
      cols.push({ a, main, dev });
    }
    const max = Math.max(...cols.map(c => c.main + c.dev));
    const top = Math.max(2, Math.ceil(max / 2) * 2);
    const grid = [top, top / 2].map(v => `<div class="gl" style="bottom:${v / top * 100}%"><span>${v}</span></div>`).join('');
    return `<figure class="age-chart" aria-label="年齢分布（${baseLabel}）">
      <div class="legend"><span><i class="sw sw-main"></i>支配下</span><span><i class="sw sw-dev"></i>育成</span></div>
      <div class="plot">${grid}<div class="bars">${cols.map(c => {
        const tip = `${c.a}歳：支配下 ${c.main}名・育成 ${c.dev}名`;
        return `<div class="col" data-tip="${h(tip)}" aria-label="${h(tip)}" tabindex="0">
          <div class="stack">${c.dev ? `<i class="seg dev" style="height:${c.dev / top * 100}%"></i>` : ''}${c.main ? `<i class="seg main" style="height:${c.main / top * 100}%"></i>` : ''}</div>
          <span class="xl">${c.a % 2 === 0 || cols.length < 16 ? c.a : ''}</span></div>`;
      }).join('')}</div></div>
      <figcaption class="muted small">年齢（${baseLabel}）。棒にカーソルを合わせると人数を表示します。</figcaption>
    </figure>`;
  }

  function posBlock(s) {
    const max = Math.max(1, ...POS.map(p => s.posMain[p] + s.posDev[p]));
    return `<table class="pos-table">
      <thead><tr><th scope="col">ポジション</th><th scope="col" class="c-main">支配下</th><th scope="col" class="c-dev">育成</th><th scope="col">計</th></tr></thead>
      <tbody>${POS.map(p => `<tr><th scope="row">${p}</th><td>${s.posMain[p]}</td><td>${s.posDev[p]}</td>
        <td><span class="bar"><span class="bar-main" style="width:${s.posMain[p] / max * 100}%"></span><span class="bar-dev" style="width:${s.posDev[p] / max * 100}%"></span></span><b>${s.posMain[p] + s.posDev[p]}</b></td></tr>`).join('')}</tbody>
    </table>`;
  }

  function viewNpbTeam(id) {
    const { h, ext, scoreboard } = UI();
    const team = CFG.teams.find(t => t.id === id);
    needRosters();
    let body;
    if (!store.rosters) body = loadingBlock('rosters', 'NPBの選手データ');
    else {
      const players = teamPlayers(id);
      const s = summarize(players);
      const f = view.roster;
      let list = players.filter(p => (f.status === 'all' || p.status === f.status) && (f.pos === 'all' || p.pos === f.pos));
      list = sortPlayers(list, f.sort);
      const urlT = store.rosters.playerUrl;
      body = `
        ${scoreboard([
          { label: '支配下', value: s.main, unit: `/${MAX_MAIN}`, cls: 'sb-main' },
          { label: '空き枠', value: s.open, unit: '枠' },
          { label: '育成', value: s.dev, unit: '名', cls: 'sb-dev' },
          { label: '支配下の平均年齢', value: s.avgMain.toFixed(1), unit: '歳' },
        ])}
        <div class="live-cta" style="margin-top:20px"><a class="btn" href="#/sim/${id}">この球団で指名人数をシミュレーション</a></div>
        <div class="team-cols">
          <section class="section panel"><h2 class="section-title">年齢分布</h2>${ageChart(players)}</section>
          <aside class="section panel"><h2 class="section-title">ポジション別人数</h2>${posBlock(s)}</aside>
        </div>
        <section class="section">
          <div class="section-head"><h2 class="section-title">選手一覧</h2><span class="muted small">${list.length}名</span></div>
          <div class="filters">
            ${chips('r-status', f.status, [['all', 'すべて'], ['支配下', '支配下'], ['育成', '育成']])}
            ${chips('r-pos', f.pos, [['all', '全ポジション'], ...POS.map(p => [p, p])])}
            ${chips('r-sort', f.sort, [['no', '背番号順'], ['age-desc', '年齢が高い順'], ['age-asc', '年齢が低い順']])}
          </div>
          <div class="hscroll" data-scroll="roster"><table class="roster-table">
            <thead><tr><th scope="col">背番号</th><th scope="col">選手名</th><th scope="col">区分</th><th scope="col">ポジション</th><th scope="col" class="num">年齢</th><th scope="col">投打</th><th scope="col" class="num">身長/体重</th><th scope="col">備考</th></tr></thead>
            <tbody>${list.map(p => `<tr>
              <td class="num mono">${h(p.no)}</td>
              <td class="pname">${p.id ? ext(urlT.replace('{id}', p.id), h(p.name)) : h(p.name)}</td>
              <td><span class="tag ${p.status === '支配下' ? 'tag-win' : 'tag-dev'}">${p.status}</span></td>
              <td>${h(p.pos)}</td>
              <td class="num">${p.age ?? '—'}</td>
              <td>${h(p.throws)}投${h(p.bats)}打</td>
              <td class="num">${p.height || '—'}/${p.weight || '—'}</td>
              <td class="small muted">${h(p.note)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </section>
        ${sourceNote()}`;
    }
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow"><a href="#/npb">NPB 12球団の所属選手</a></p><h1 class="page-title">${h(team.name)}</h1></div></div>
      ${teamSwitch('npb', id)}
      ${body}
    </div>`;
  }

  function sortPlayers(list, sort) {
    const num = p => { const n = parseInt(p.no, 10); return isNaN(n) ? 999 : (p.no.startsWith('0') ? 1000 + n : n); };
    const statusRank = p => p.status === '支配下' ? 0 : 1;
    const arr = list.slice();
    if (sort === 'age-desc') arr.sort((a, b) => (b.age ?? 0) - (a.age ?? 0) || num(a) - num(b));
    else if (sort === 'age-asc') arr.sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || num(a) - num(b));
    else arr.sort((a, b) => statusRank(a) - statusRank(b) || num(a) - num(b));
    return arr;
  }

  // ---------- ③ シミュレーション ----------
  const ACTIONS_MAIN = [['stay', '残留'], ['release', '戦力外'], ['retire', '引退'], ['leave', '移籍・FA'], ['toDev', '育成で再契約']];
  const ACTIONS_DEV = [['stay', '残留'], ['release', '戦力外'], ['retire', '引退'], ['leave', '移籍'], ['toMain', '支配下へ昇格']];
  const ACTION_LABEL = Object.fromEntries([...ACTIONS_MAIN, ...ACTIONS_DEV]);
  const SIM_KEY = id => `vdraft:sim:v1:${id}`;

  function loadSim(id, devCount) {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SIM_KEY(id)) || 'null'); } catch (e) { /* 保存領域が使えない環境 */ }
    return Object.assign({ marks: {}, adds: 0, keep: 2, devTarget: devCount }, s || {});
  }
  function saveSim(id, s) {
    try { localStorage.setItem(SIM_KEY(id), JSON.stringify(s)); } catch (e) { /* 保存できなくても計算は継続 */ }
  }

  function simCalc(players, s) {
    const act = p => s.marks[p.key] || 'stay';
    const mainStay = players.filter(p => p.status === '支配下' && act(p) === 'stay');
    const promoted = players.filter(p => p.status === '育成' && act(p) === 'toMain');
    const toDev = players.filter(p => p.status === '支配下' && act(p) === 'toDev');
    const devStay = players.filter(p => p.status === '育成' && act(p) === 'stay');
    const outMain = players.filter(p => p.status === '支配下' && ['release', 'retire', 'leave'].includes(act(p)));
    const outDev = players.filter(p => p.status === '育成' && ['release', 'retire', 'leave'].includes(act(p)));
    const mainAfter = mainStay.length + promoted.length;
    const devAfter = devStay.length + toDev.length;
    const target = Math.max(0, MAX_MAIN - mainAfter - (s.adds || 0) - (s.keep || 0));
    const devTarget = Math.max(0, (s.devTarget || 0) - devAfter);
    const posAfter = Object.fromEntries(POS.map(ps => [ps, [...mainStay, ...promoted].filter(p => p.pos === ps).length]));
    const posNow = Object.fromEntries(POS.map(ps => [ps, players.filter(p => p.status === '支配下' && p.pos === ps).length]));
    return { mainAfter, devAfter, target, devTarget, promoted: promoted.length, toDev: toDev.length, outMain: outMain.length, outDev: outDev.length, posAfter, posNow, act };
  }

  function simResults(id, players, s) {
    const { h, scoreboard } = UI();
    const c = simCalc(players, s);
    const res = UI().currentResult();
    const vt = res && res.model && res.model.teams.find(t => t.id === id);
    const picked = vt ? `<div class="sim-compare">
        <span>仮想ドラフト${CFG.currentYear}の${h(vt.short)}の指名</span>
        <b class="c-main">本指名 ${vt.counts.main}名</b><b class="c-dev">育成 ${vt.counts.dev}名</b>
        <span class="${vt.counts.main > c.target ? 'over' : 'ok'}">${vt.counts.main > c.target ? `目安を${vt.counts.main - c.target}名超過` : `目安まであと${c.target - vt.counts.main}名`}</span>
      </div>` : '';
    return `${scoreboard([
        { label: '来季の支配下（残留＋昇格）', value: c.mainAfter, unit: `/${MAX_MAIN}`, cls: 'sb-main' },
        { label: '本指名の目安', value: c.target, unit: '名', cls: 'sb-hot' },
        { label: '来季の育成（残留＋再契約）', value: c.devAfter, unit: '名', cls: 'sb-dev' },
        { label: '育成指名の目安', value: c.devTarget, unit: '名' },
      ])}
      <p class="formula">本指名の目安 ＝ 上限${MAX_MAIN} − 来季の支配下 ${c.mainAfter} − 補強予定 ${s.adds || 0} − 空けておく枠 ${s.keep || 0} ＝ <b>${c.target}名</b>
        <br>支配下の退団 ${c.outMain}名・育成で再契約 ${c.toDev}名・育成からの昇格 ${c.promoted}名・育成の退団 ${c.outDev}名</p>
      ${picked}
      <div class="sim-pos">${POS.map(p => `<div><span>${p}</span><b>${c.posNow[p]}<i>→</i>${c.posAfter[p]}</b></div>`).join('')}</div>`;
  }

  function viewSim(id) {
    const { h } = UI();
    const team = CFG.teams.find(t => t.id === id);
    needRosters();
    let body;
    if (!store.rosters) body = loadingBlock('rosters', 'NPBの選手データ');
    else {
      const players = teamPlayers(id);
      const s = loadSim(id, players.filter(p => p.status === '育成').length);
      const f = view.sim;
      const c = simCalc(players, s);
      const rows = st => sortPlayers(players.filter(p => p.status === st && (f.pos === 'all' || p.pos === f.pos)), f.sort);
      const table = (st, actions) => `<div class="hscroll"><table class="roster-table sim-table">
        <thead><tr><th scope="col">背番号</th><th scope="col">選手名</th><th scope="col">ポジション</th><th scope="col" class="num">年齢</th><th scope="col">来季の扱い</th></tr></thead>
        <tbody>${rows(st).map(p => { const a = c.act(p); return `<tr class="act-${a}">
          <td class="num mono">${h(p.no)}</td><td class="pname">${h(p.name)}</td><td>${h(p.pos)}</td><td class="num">${p.age ?? '—'}</td>
          <td><select data-sim="mark" data-key="${h(p.key)}" aria-label="${h(p.name)}の来季の扱い">${actions.map(([v, l]) => `<option value="${v}"${v === a ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        </tr>`; }).join('')}</tbody></table></div>`;
      body = `
        <div class="sim-layout">
          <div class="sim-main">
            <section class="section panel sim-settings">
              <h2 class="section-title">条件</h2>
              <div class="sim-inputs">
                <label>補強予定（外国人・FA・トレード）<span><input type="number" min="0" max="30" value="${s.adds}" data-sim="adds">名</span></label>
                <label>開幕時に空けておく枠<span><input type="number" min="0" max="20" value="${s.keep}" data-sim="keep">枠</span></label>
                <label>来季の育成の保有目標<span><input type="number" min="0" max="80" value="${s.devTarget}" data-sim="devTarget">名</span></label>
              </div>
              <p class="note">支配下の上限は${MAX_MAIN}名です。シーズン中の昇格や補強に備えて、多くの球団は開幕時に数枠を空けています。</p>
            </section>
            <section class="section">
              <div class="section-head"><h2 class="section-title">選手ごとの来季の扱い</h2>
                <button type="button" class="linkish" data-sim="reset">すべて「残留」に戻す</button></div>
              <div class="filters">
                ${chips('s-pos', f.pos, [['all', '全ポジション'], ...POS.map(p => [p, p])])}
                ${chips('s-sort', f.sort, [['no', '背番号順'], ['age-desc', '年齢が高い順'], ['age-asc', '年齢が低い順']])}
              </div>
              <h3 class="sub-title"><i class="sw sw-main"></i> 支配下選手（${players.filter(p => p.status === '支配下').length}名）</h3>
              ${table('支配下', ACTIONS_MAIN)}
              <h3 class="sub-title"><i class="sw sw-dev"></i> 育成選手（${players.filter(p => p.status === '育成').length}名）</h3>
              ${table('育成', ACTIONS_DEV)}
            </section>
          </div>
          <aside class="sim-side"><div class="sim-sticky" id="sim-results">${simResults(id, players, s)}</div></aside>
        </div>
        <p class="cite center">検討内容はこのブラウザにのみ保存され、他の人には共有されません。選手データの出典：NPB.jp 日本野球機構「選手一覧」。</p>`;
    }
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow"><a href="#/npb/${id}">${h(team.name)}の所属選手</a></p><h1 class="page-title"><span class="nobr">指名人数</span><span class="nobr">シミュレーション</span></h1>
        <p class="muted">戦力外・引退・移籍などを自分で設定し、支配下枠と比べながらドラフトの指名人数を検討できます。</p></div></div>
      ${teamSwitch('sim', id)}
      ${body}
    </div>`;
  }

  // ---------- イベント ----------
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { page: parts[0], id: parts[1] };
  }

  function onSimChange(el) {
    const { id } = route();
    const players = teamPlayers(id);
    const s = loadSim(id, players.filter(p => p.status === '育成').length);
    const kind = el.dataset.sim;
    if (kind === 'mark') {
      if (el.value === 'stay') delete s.marks[el.dataset.key]; else s.marks[el.dataset.key] = el.value;
      el.closest('tr').className = 'act-' + el.value;
    } else if (['adds', 'keep', 'devTarget'].includes(kind)) {
      const v = Math.max(0, parseInt(el.value, 10) || 0);
      s[kind] = v;
    }
    saveSim(id, s);
    const box = document.getElementById('sim-results');
    if (box) box.innerHTML = simResults(id, players, s);
  }

  function attach(app) {
    app.addEventListener('change', e => { const el = e.target.closest('[data-sim]'); if (el) onSimChange(el); });
    app.addEventListener('input', e => { const el = e.target.closest('input[data-sim]'); if (el) onSimChange(el); });
    app.addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (b) {
        const [grp, key] = b.dataset.f.split('-');
        const target = { p: view.prospects, r: view.roster, s: view.sim }[grp];
        target[key] = b.dataset.v;
        UI().rerender();
        return;
      }
      if (e.target.closest('[data-sim="reset"]')) {
        const { id } = route();
        const players = teamPlayers(id);
        const s = loadSim(id, players.filter(p => p.status === '育成').length);
        s.marks = {};
        saveSim(id, s);
        UI().rerender();
      }
    });
    // 年齢分布のツールチップ
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; tip.style.left = x + 'px'; tip.style.top = y + 'px'; };
    app.addEventListener('mousemove', e => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
    });
    app.addEventListener('focusin', e => {
      const el = e.target.closest('[data-tip]');
      if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
    });
    app.addEventListener('focusout', () => { tip.hidden = true; });
    app.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  window.DraftFeatures = {
    attach,
    parse(parts) {
      const ids = CFG.teams.map(t => t.id);
      if (parts[0] === 'prospects') return { name: 'prospects', title: '注目選手' };
      if (parts[0] === 'npb') return parts[1] && ids.includes(parts[1])
        ? { name: 'npbTeam', id: parts[1], title: `${CFG.teams.find(t => t.id === parts[1]).short}の所属選手` }
        : { name: 'npb', title: 'NPB 12球団の所属選手' };
      if (parts[0] === 'sim') {
        const id = ids.includes(parts[1]) ? parts[1] : ids[0];
        return { name: 'sim', id, title: `指名人数シミュレーション（${CFG.teams.find(t => t.id === id).short}）` };
      }
      return null;
    },
    view(r) {
      if (r.name === 'prospects') return viewProspects();
      if (r.name === 'npb') return viewNpb();
      if (r.name === 'npbTeam') return viewNpbTeam(r.id);
      if (r.name === 'sim') return viewSim(r.id);
      return '';
    },
  };
})();
