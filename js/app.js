/*
 * 画面描画・ルーティング・自動更新
 * URL（ハッシュ）:
 *   #/                 トップ
 *   #/2026             2026年ドラフトボード（各年度に直接アクセス可）
 *   #/2026/teams       2026年 球団一覧
 *   #/2026/giants      2026年 球団別ページ
 *   #/archive          年度別アーカイブ
 * 動作確認用: ?phase=before|live|after で開催状態を上書きできます。
 */
(function () {
  const CFG = window.DRAFT_CONFIG;
  const YEARS = Object.keys(CFG.years).map(Number).sort((a, b) => b - a);
  const app = document.getElementById('app');
  const state = { results: {}, timer: null, loadingYear: null };

  // ---------- 開催状態 ----------
  const phaseOverride = new URLSearchParams(location.search).get('phase');
  function phase(year) {
    if (year !== CFG.currentYear) return 'after';
    if (['before', 'live', 'after'].includes(phaseOverride)) return phaseOverride;
    const now = Date.now();
    if (now < Date.parse(CFG.event.start)) return 'before';
    if (now <= Date.parse(CFG.event.end)) return 'live';
    return 'after';
  }
  window.DraftPhase = phase;

  // ---------- ユーティリティ ----------
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ext = (url, label, cls = '') => `<a class="${cls}" href="${h(url)}" target="_blank" rel="noopener noreferrer">${label}<span class="ext" aria-label="（新しいタブで開きます）">↗</span></a>`;
  const fmtTime = t => t ? new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const fmtDateTime = t => t ? new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const teamById = id => CFG.teams.find(t => t.id === id);
  const END = '<span class="end-mark">選択終了</span>';
  const ROUND_MARK = n => '①②③④⑤⑥⑦⑧⑨⑩'[n - 1] || `(${n})`;

  function sheetLink(label = '運営スプレッドシートを開く', cls = 'btn btn-ghost') {
    if (!CFG.sheetUrl) return `<span class="${cls} is-disabled" title="config.js の sheetUrl を設定してください">運営スプレッドシート（リンク未設定）</span>`;
    return ext(CFG.sheetUrl, label, cls);
  }

  function player(p, opts = {}) {
    if (!p) return '<span class="empty">—</span>';
    const meta = [p.pos, p.school].filter(Boolean).join('・');
    return `<span class="pl${opts.compact ? ' pl-compact' : ''}"><span class="pl-name">${h(p.name)}</span>${meta ? `<span class="pl-meta">${h(meta)}</span>` : ''}</span>`;
  }

  function teamChip(t, opts = {}) {
    const team = typeof t === 'string' ? teamById(t) : t;
    const cls = ['chip', opts.cls || ''].join(' ');
    return `<span class="${cls}" style="--team:${team.color}"><i class="dot"></i>${h(team.short)}</span>`;
  }

  // ---------- 共通パーツ ----------
  function yearTabs(active, suffix = '') {
    return `<nav class="year-tabs" aria-label="年度切替">${YEARS.map(y =>
      `<a href="#/${y}${suffix}" class="${y === active ? 'is-active' : ''}" ${y === active ? 'aria-current="page"' : ''}>${y}</a>`).join('')}</nav>`;
  }

  function statusBar(res, year) {
    if (!res) return `<div class="status"><span class="status-dot is-loading"></span>データを読み込み中…</div>`;
    const live = phase(year) === 'live';
    const src = res.source === 'demo'
      ? `<span class="badge badge-demo">デモデータ</span>`
      : `<span class="badge badge-sheet">スプレッドシート連携</span>`;
    let html = `<div class="status${res.error ? ' is-error' : ''}" role="status">
      <span class="status-dot ${res.error ? 'is-error' : live ? 'is-live' : ''}"></span>
      ${src}
      <span>最終更新 <time>${fmtDateTime(res.fetchedAt)}</time></span>
      ${live ? `<span class="status-sub">約${Math.round(CFG.pollIntervalLive / 1000)}秒ごとに自動更新</span>` : ''}
      <button type="button" class="linkish" data-action="refresh">今すぐ更新</button>
    </div>`;
    if (res.error) {
      html += `<div class="alert" role="alert">
        <strong>最新データを取得できませんでした</strong>（${h(res.error)}、${fmtTime(res.failedAt)}）。
        ${res.model ? `前回取得分（${fmtDateTime(res.fetchedAt)}）を表示しています。` : ''}最新の状況は運営スプレッドシートをご確認ください。
        <div class="alert-actions">${sheetLink()}</div>
      </div>`;
    }
    if (res.source === 'demo') {
      html += `<p class="note">このデータは画面確認用の<strong>デモデータ</strong>です（選手名・所属は架空）。<code>js/config.js</code> にスプレッドシートを設定すると実データに切り替わります。</p>`;
    }
    return html;
  }

  function references() {
    return `<section class="section refs" id="references">
      <div class="head"><h2 class="h2 h2-sm">参考資料</h2>
        <p class="ref-lead"><a href="#/rules">NPB ドラフト会議の選択手順・概要（抜粋）をこのサイトで読む</a></p></div>
      <ul class="ref-list">${CFG.references.map(r => `<li>${ext(r.url, `<span class="ref-label">${h(r.label)}</span><span class="ref-org">${h(r.org)}</span>`, 'ref-card')}</li>`).join('')}</ul>
    </section>`;
  }

  function legend() {
    return `<div class="legend" aria-label="凡例">
      <span><i class="sw sw-main"></i>本指名（支配下）</span>
      <span><i class="sw sw-dev"></i>育成指名</span>
      <span><i class="sw sw-hot"></i>1位競合</span>
    </div>`;
  }

  // 黒いスコアボード。items: [{ label, value, unit, cls }]
  function scoreboard(items, foot) {
    return `<div class="scoreboard" role="group" aria-label="集計">
      <div class="sb-cells" style="--cols:${items.length}">${items.map(i => `<div class="sb-cell ${i.cls || ''}"><span class="sb-label">${h(i.label)}</span><span class="sb-num">${i.value}${i.unit ? `<small>${h(i.unit)}</small>` : ''}</span></div>`).join('')}</div>
      ${foot ? `<div class="sb-foot">${foot}</div>` : ''}
    </div>`;
  }

  function noData(res) {
    return `<div class="panel empty-panel">
      <p><strong>表示できるデータがありません。</strong></p>
      <p>${res && res.error ? h(res.error) + '。' : ''}運営スプレッドシートで最新の状況をご確認ください。</p>
      <p>${sheetLink()}</p>
    </div>`;
  }

  // ---------- トップ ----------
  function viewHome() {
    const y = CFG.currentYear, ph = phase(y), res = state.results[y], m = res && res.model;
    const ev = CFG.event;
    const days = Math.ceil((Date.parse(ev.start) - Date.now()) / 86400000);
    const phaseBadge = ph === 'live' ? '<span class="phase phase-live"><i></i>LIVE 会議中</span>'
      : ph === 'before' ? `<span class="phase">開催まで あと${Math.max(days, 0)}日</span>`
        : '<span class="phase">会議終了</span>';
    const band = (alt, id, eyebrow, title, sub, body) => `
      <section class="band${alt ? ' alt' : ''}"${id ? ` id="${id}"` : ''}>
        <div class="inner">
          <div class="head">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2 class="h2">${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
          ${body}
        </div>
      </section>`;

    const decided = m ? m.teams.filter(t => t.first).length : 0;
    const live = (ph !== 'before' && m) ? band(false, 'live',
      '',
      ph === 'live' ? 'ライブ会議室' : '会議結果',
      '支配下・育成の指名数と、1位が確定した球団数です。',
      `${scoreboard([
        { label: '支配下 指名', value: m.totals.main, unit: '名', cls: 'sb-main' },
        { label: '育成 指名', value: m.totals.dev, unit: '名', cls: 'sb-dev' },
        { label: '1位 確定', value: decided, unit: `/${m.teams.length}` },
      ], `<span>${ph === 'live' ? '<i class="live-dot"></i>会議中' : '会議終了'}</span><span>最終更新 ${fmtTime(res.fetchedAt)}</span>`)}
      <div class="live-cta"><a class="btn btn-lg" href="#/${y}">${ph === 'live' ? 'ライブ会議室（ドラフトボード）に入る' : 'ドラフト結果を見る'}</a>${CFG.sheetUrl ? ext(CFG.sheetUrl, '運営スプレッドシートを開く', 'btn ghost btn-lg') : ''}</div>
      ${res.error ? `<p class="live-warn">※ 最新データの取得に失敗しています。前回取得分を表示中です。${sheetLink('運営シートで確認', 'inline-link')}</p>` : ''}`) : '';

    const teamsList = (m ? m.teams : CFG.teams).map(t => `
      <li><a class="team-card" href="#/${y}/${t.id}" style="--team:${t.color}">
        <span class="team-card-name">${h(t.name)}</span>
        <span class="team-card-owner">担当：${h(t.owner || '未定')}</span>
        ${t.declared ? `<span class="team-card-decl">明言：${h(t.declared.name)}</span>` : ''}
        ${ph !== 'before' && t.counts ? `<span class="team-card-counts"><b class="c-main">${t.counts.main}</b> 支配下 ／ <b class="c-dev">${t.counts.dev}</b> 育成</span>` : ''}
      </a></li>`).join('');

    return `
      <header class="hero">
        <div class="hero-status">${phaseBadge}</div>
        <h1>${CFG.eventName.split(' ').map(w => `<span class="nobr">${h(w)}</span>`).join(' ')}</h1>
        <p class="tag">開催日 ${h(ev.dateLabel)} ${h(ev.timeLabel)}</p>
        <p class="sub">会場 ${h(ev.venue)}</p>
        <div class="ctas">
          <a class="btn" href="#/${y}">ドラフトボード</a>
          ${ext(ev.mapUrl, '会場地図（Google マップで開く）', 'btn ghost')}
        </div>
      </header>
      ${live}
      ${band(true, 'info', '', '開催情報', '', `
        <div class="tile-grid">
          <div class="tile info-tile"><span class="k">開催日</span><span class="v">${h(ev.dateLabel)}</span></div>
          <div class="tile info-tile"><span class="k">時間</span><span class="v">${h(ev.timeLabel)}</span></div>
          <div class="tile info-tile"><span class="k">会場</span><span class="v">${h(ev.venue)}</span>${ext(ev.mapUrl, '会場地図（Google マップで開く）', 'more')}</div>
        </div>`)}
      ${band(false, 'links', '', 'リンク', '', `
        <div class="quick">
          <a class="quick-card" href="#/${y}"><span class="quick-t">ドラフトボード</span><span class="quick-d">1位競合・本指名・育成指名を一覧で</span><span class="quick-go">ドラフトボードを開く</span></a>
          ${CFG.sheetUrl ? ext(CFG.sheetUrl, '<span class="quick-t">運営スプレッドシート</span><span class="quick-d">指名入力・集計の正本（閲覧）</span><span class="quick-go">スプレッドシートを開く</span>', 'quick-card') : '<span class="quick-card is-disabled"><span class="quick-t">運営スプレッドシート</span><span class="quick-d">リンク未設定</span></span>'}
          <a class="quick-card" href="#/archive"><span class="quick-t">過去の結果</span><span class="quick-d">2019〜${y - 1}年のアーカイブ</span><span class="quick-go">アーカイブを開く</span></a>
        </div>`)}
      ${band(true, 'teams', '', '参加12球団', res ? `最終更新 ${fmtDateTime(res.fetchedAt)}${res.source === 'demo' ? '（デモデータ）' : ''}` : '', `
        ${res && res.error ? `<div class="alert">最新データを取得できませんでした。${res.model ? '前回取得分を表示しています。' : ''} ${sheetLink('運営シートを開く', 'inline-link')}</div>` : ''}
        <ul class="team-grid">${teamsList}</ul>`)}
      ${band(false, 'rules', '', '会議のルール', '', `
        <ol class="rules">${CFG.rules.map(r => `<li>${h(r)}</li>`).join('')}</ol>
        ${CFG.npb ? `<a class="npb-card" href="#/rules"><span class="quick-t">NPB ドラフト会議の選択手順・概要</span><span class="quick-d">${CFG.npb.provisional ? `2026年の詳細公表まで、${CFG.npb.year}年版を暫定的に引用しています。` : `${CFG.npb.year}年版`}</span><span class="quick-go">選択手順・概要を見る</span></a>` : ''}`)}
      <section class="band alt"><div class="inner">${references()}</div></section>`;
  }

  // ---------- ルール・選択手順 ----------
  function viewRules() {
    const n = CFG.npb;
    const quote = (items, cls = '') => `<ul class="quote-list ${cls}">${items.map(i => `<li>${h(i)}</li>`).join('')}</ul>`;
    const cite = (page, url) => `<p class="cite">出典：${h(n.sourceName)}「${page}」 ${ext(url, '原文を見る')}</p>`;
    const npb = n ? `
      <section class="section panel">
        <div class="section-head"><h2 class="section-title">NPB ドラフト会議の選択手順</h2>${n.provisional ? `<span class="badge badge-demo">${n.year}年版を暫定引用</span>` : ''}</div>
        ${n.provisional ? `<p class="note provisional">2026年の選択手順はNPBの公表後に差し替えます。それまでは${n.year}年版の内容を引用しています。</p>` : ''}
        <blockquote class="npb-quote" cite="${h(n.procedureUrl)}">
          ${n.procedure.map(b => `<h3 class="sub-title">${h(b.title)}</h3>${quote(b.items)}
            ${b.orders ? `<dl class="orders">${b.orders.map(o => `<div><dt>${h(o.label)}</dt><dd>${h(o.teams)}</dd></div>`).join('')}</dl>` : ''}`).join('')}
        </blockquote>
        ${n.procedure.filter(b => b.note).map(b => `<p class="note">※ ${h(b.note)}</p>`).join('')}
        ${cite('選択手順', n.procedureUrl)}
      </section>
      <section class="section panel">
        <div class="section-head"><h2 class="section-title">新人選手選択会議（ドラフト会議）の概要（抜粋）</h2>${n.provisional ? `<span class="badge badge-demo">${n.year}年版を暫定引用</span>` : ''}</div>
        <blockquote class="npb-quote" cite="${h(n.overviewUrl)}">${quote(n.overview)}</blockquote>
        ${cite('ドラフト会議概要', n.overviewUrl)}
        <p class="note">交渉権の扱いや契約期限など、ここに載せていない項目は原文をご覧ください。</p>
      </section>` : '';
    return `<div class="container">
      <div class="page-head"><div><h1 class="page-title">ルール・選択手順</h1><p class="muted">仮想ドラフトの進め方と、参考にしているNPBドラフト会議の選択手順です。</p></div></div>
      <section class="section" style="margin-top:0">
        <h2 class="section-title">仮想ドラフトのルール</h2>
        <ol class="rules">${CFG.rules.map(r => `<li>${h(r)}</li>`).join('')}</ol>
      </section>
      ${npb}
      ${references()}
    </div>`;
  }

  // ---------- ドラフトボード ----------
  function lotteryPanel(m) {
    if (!m.rounds.length && !m.hasDeclared) return '';
    const declared = m.hasDeclared ? `
      <div class="decl">
        <h3 class="sub-title">明言</h3>
        <ul class="decl-list">${m.teams.filter(t => t.declared).map(t => `<li>${teamChip(t)}${player(t.declared, { compact: true })}</li>`).join('')}</ul>
      </div>` : '';
    const rounds = m.rounds.map(r => {
      const contested = r.groups.filter(g => g.contested);
      const singles = r.groups.filter(g => !g.contested);
      return `<div class="round">
        <h3 class="sub-title">1位${ROUND_MARK(r.round)}${r.round === 1 ? ' 入札' : ' 再入札'}<span class="muted small">　${r.groups.reduce((s, g) => s + g.teams.length, 0)}球団入札・競合${contested.length}件</span></h3>
        ${contested.map(g => `
          <div class="lot ${g.status === 'pending' ? 'is-pending' : ''}">
            <div class="lot-player">${player(g.player)}<span class="lot-count">${g.teams.length}球団競合</span></div>
            <div class="lot-teams">${g.teams.map(id => teamChip(id, { cls: g.winner === id ? 'is-win' : g.winner ? 'is-lose' : '' })).join('')}</div>
            <div class="lot-result">${g.status === 'pending' ? '<span class="tag tag-pending">抽選待ち</span>' : `<span class="tag tag-win">交渉権</span>${teamChip(g.winner)}`}</div>
          </div>`).join('')}
        ${singles.length ? `<ul class="singles">${singles.map(g => `<li>${teamChip(g.teams[0])}${player(g.player, { compact: true })}<span class="tag ${g.status === 'lost' ? 'tag-lose' : 'tag-single'}">${g.status === 'lost' ? '外れ' : '単独'}</span></li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('');
    return `<section class="section panel lottery" aria-label="明言と1位競合">
      <h2 class="section-title">明言・1位競合状況</h2>
      ${declared}${rounds || '<p class="muted">1位入札はまだ行われていません。</p>'}
    </section>`;
  }

  function boardTable(m) {
    const y = m.year;
    const head = `<tr><th class="rank-col" scope="col">順位</th>${m.teams.map(t => `<th scope="col" style="--team:${t.color}"><a href="#/${y}/${t.id}">${h(t.short)}</a><span class="th-owner">${h(t.owner)}</span></th>`).join('')}</tr>`;
    const rows = [];
    if (m.hasDeclared) rows.push(`<tr class="row-decl"><th scope="row">明言</th>${m.teams.map(t => `<td>${t.declared ? player(t.declared, { compact: true }) : ''}</td>`).join('')}</tr>`);
    m.rounds.forEach(r => {
      rows.push(`<tr class="row-bid"><th scope="row">1位${ROUND_MARK(r.round)}</th>${m.teams.map(t => {
        const b = t.bids.find(b => b.round === r.round);
        if (!b) return '<td></td>';
        const g = r.groups.find(g => g.player.key === b.player.key);
        const st = !g.contested ? (g.status === 'lost' ? 'lose' : 'single') : g.status === 'pending' ? 'pending' : g.winner === t.id ? 'win' : 'lose';
        const label = { single: '単独', win: '当選', lose: '外れ', pending: '抽選待ち' }[st];
        return `<td class="bid bid-${st}${g.contested ? ' is-hot' : ''}">${player(b.player, { compact: true })}<span class="bid-tag">${g.contested ? `${g.teams.length}球団競合・` : ''}${label}</span></td>`;
      }).join('')}</tr>`);
    });
    rows.push(`<tr class="row-sep"><th colspan="${m.teams.length + 1}" scope="rowgroup">本指名（支配下）</th></tr>`);
    for (let r = 1; r <= m.maxMain; r++) {
      rows.push(`<tr class="row-main"><th scope="row">${r}位</th>${m.teams.map(t => {
        const x = t.main.find(x => x.rank === r);
        return `<td class="${x ? 'is-main' : ''}${x && r === 1 && t.firstContested ? ' is-hot' : ''}">${x ? player(x.player, { compact: true }) : t.endMain === r ? END : ''}</td>`;
      }).join('')}</tr>`);
    }
    if (m.maxDev) {
      rows.push(`<tr class="row-sep row-sep-dev"><th colspan="${m.teams.length + 1}" scope="rowgroup">育成指名</th></tr>`);
      for (let r = 1; r <= m.maxDev; r++) {
        rows.push(`<tr class="row-dev"><th scope="row">育成${r}位</th>${m.teams.map(t => {
          const x = t.dev.find(x => x.rank === r);
          return `<td class="${x ? 'is-dev' : ''}">${x ? player(x.player, { compact: true }) : t.endDev === r ? END : ''}</td>`;
        }).join('')}</tr>`);
      }
    }
    rows.push(`<tr class="row-total"><th scope="row">人数</th>${m.teams.map(t => `<td><b class="c-main">${t.counts.main}</b> / <b class="c-dev">${t.counts.dev}</b></td>`).join('')}</tr>`);
    return `<div class="board-pc"><div class="hscroll" data-scroll="board"><table class="board"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="muted small">人数は「支配下 / 育成」。球団名から球団別ページへ移動できます。</p></div>`;
  }

  function boardTimeline(m) {
    const y = m.year, blocks = [];
    for (let r = 1; r <= m.maxMain; r++) {
      const items = m.teams.map(t => ({ t, x: t.main.find(x => x.rank === r) })).filter(o => o.x);
      if (!items.length) continue;
      blocks.push(`<li class="tl-block tl-main"><h3 class="tl-rank"><span>本指名</span>${r}位</h3><ul class="tl-items">${items.map(({ t, x }) =>
        `<li><a href="#/${y}/${t.id}">${teamChip(t)}</a>${player(x.player)}${r === 1 && t.firstContested ? '<span class="tag tag-hot">競合</span>' : ''}</li>`).join('')}</ul></li>`);
    }
    const pendingTeams = m.teams.filter(t => !t.first && t.bids.length);
    if (pendingTeams.length) {
      blocks.splice(1, 0, `<li class="tl-block tl-pending"><h3 class="tl-rank"><span>1位</span>未確定</h3><ul class="tl-items">${pendingTeams.map(t => `<li>${teamChip(t)}<span class="muted">抽選・再入札待ち</span></li>`).join('')}</ul></li>`);
    }
    for (let r = 1; r <= m.maxDev; r++) {
      const items = m.teams.map(t => ({ t, x: t.dev.find(x => x.rank === r) })).filter(o => o.x);
      if (!items.length) continue;
      blocks.push(`<li class="tl-block tl-dev"><h3 class="tl-rank"><span>育成</span>${r}位</h3><ul class="tl-items">${items.map(({ t, x }) =>
        `<li><a href="#/${y}/${t.id}">${teamChip(t)}</a>${player(x.player)}</li>`).join('')}</ul></li>`);
    }
    return `<div class="board-sp"><h2 class="section-title">指名タイムライン</h2>${blocks.length ? `<ol class="timeline">${blocks.join('')}</ol>` : '<p class="muted">まだ指名はありません。</p>'}</div>`;
  }

  function teamLinks(m) {
    return `<section class="section"><h2 class="section-title">球団別の指名結果</h2>
      <ul class="team-links">${m.teams.map(t => `<li><a href="#/${m.year}/${t.id}" style="--team:${t.color}"><i class="dot"></i>${h(t.short)}<span><b class="c-main">${t.counts.main}</b>/<b class="c-dev">${t.counts.dev}</b></span></a></li>`).join('')}</ul></section>`;
  }

  function viewBoard(year) {
    const res = state.results[year], m = res && res.model, ph = phase(year);
    const title = `${year}年 ドラフトボード`;
    let body;
    if (!res) body = statusBar(null, year);
    else if (!m) body = statusBar(res, year) + noData(res);
    else {
      const contested = m.rounds.reduce((s, r) => s + r.groups.filter(g => g.contested).length, 0);
      body = `${statusBar(res, year)}
        ${scoreboard([
          { label: '支配下', value: m.totals.main, unit: '名', cls: 'sb-main' },
          { label: '育成', value: m.totals.dev, unit: '名', cls: 'sb-dev' },
          { label: '1位競合', value: contested, unit: '件', cls: 'sb-hot' },
          { label: '1位確定', value: m.teams.filter(t => t.first).length, unit: `/${m.teams.length}` },
        ])}
        ${lotteryPanel(m)}
        <section class="section">
          <div class="section-head"><h2 class="section-title board-pc-title">指名一覧</h2>${legend()}</div>
          ${boardTable(m)}
          ${boardTimeline(m)}
        </section>
        ${teamLinks(m)}`;
    }
    return `<div class="container">
      <div class="page-head">
        <div><p class="eyebrow">${ph === 'live' ? '<span class="phase phase-live"><i></i>LIVE</span>' : year === CFG.currentYear ? '' : 'アーカイブ'}</p><h1 class="page-title">${title}</h1></div>
        ${yearTabs(year)}
      </div>
      ${body}
      ${references()}
    </div>`;
  }

  // ---------- 球団一覧 ----------
  function viewTeams(year) {
    const res = state.results[year], m = res && res.model;
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow"><a href="#/${year}">${year}年 ドラフトボード</a></p><h1 class="page-title">${year}年 球団別結果</h1></div>${yearTabs(year, '/teams')}</div>
      ${statusBar(res, year)}
      ${m ? `<ul class="team-grid">${m.teams.map(t => `<li><a class="team-card" href="#/${year}/${t.id}" style="--team:${t.color}">
        <span class="team-card-name">${h(t.name)}</span><span class="team-card-owner">担当：${h(t.owner || '—')}</span>
        <span class="team-card-decl">1位：${t.first ? h(t.first.name) : '未確定'}</span>
        <span class="team-card-counts"><b class="c-main">${t.counts.main}</b> 支配下 / <b class="c-dev">${t.counts.dev}</b> 育成</span></a></li>`).join('')}</ul>` : res ? noData(res) : ''}
    </div>`;
  }

  // ---------- 球団別 ----------
  function posTable(t) {
    const P = [...window.DraftData.POSITIONS, '不明'];
    const max = Math.max(1, ...P.map(p => t.byPos[p]));
    return `<table class="pos-table">
      <thead><tr><th scope="col">ポジション</th><th scope="col" class="c-main">支配下</th><th scope="col" class="c-dev">育成</th><th scope="col">計</th></tr></thead>
      <tbody>${P.filter(p => p !== '不明' || t.byPos[p]).map(p => `<tr><th scope="row">${p}</th><td>${t.byPosMain[p]}</td><td>${t.byPosDev[p]}</td>
        <td><span class="bar"><span class="bar-main" style="width:${t.byPosMain[p] / max * 100}%"></span><span class="bar-dev" style="width:${t.byPosDev[p] / max * 100}%"></span></span><b>${t.byPos[p]}</b></td></tr>`).join('')}</tbody>
    </table>`;
  }

  function pickList(list, kind, label) {
    if (!list.length) return `<p class="muted">${label}はありません。</p>`;
    return `<ol class="picks picks-${kind}">${list.map(x => `<li><span class="pick-rank">${kind === 'dev' ? '育成' : ''}${x.rank}位</span>
      <span class="pick-name">${h(x.player.name)}</span><span class="pick-pos">${h(x.player.pos || '—')}</span><span class="pick-school">${h(x.player.school || '')}</span></li>`).join('')}</ol>`;
  }

  function viewTeam(year, id) {
    const res = state.results[year], m = res && res.model;
    const t = m && m.teams.find(t => t.id === id);
    const base = teamById(id);
    const switcher = `<nav class="team-switch" aria-label="球団切替">${(m ? m.teams : CFG.teams).map(x => `<a href="#/${year}/${x.id}" style="--team:${x.color}" class="${x.id === id ? 'is-active' : ''}">${h(x.short)}</a>`).join('')}</nav>`;
    let body = '';
    if (!res) body = statusBar(null, year);
    else if (!t) body = statusBar(res, year) + noData(res);
    else {
      const bidRows = t.bids.sort((a, b) => a.round - b.round).map(b => {
        const r = m.rounds.find(r => r.round === b.round), g = r.groups.find(g => g.player.key === b.player.key);
        const st = !g.contested ? (g.status === 'lost' ? '外れ' : '単独指名') : g.status === 'pending' ? '抽選待ち' : g.winner === t.id ? '抽選当選' : '抽選外れ';
        const cls = st.includes('当選') || st === '単独指名' ? 'tag-win' : st === '抽選待ち' ? 'tag-pending' : 'tag-lose';
        return `<li><span class="bid-round">1位${ROUND_MARK(b.round)}</span>${player(b.player)}
          ${g.contested ? `<span class="tag tag-hot">${g.teams.length}球団競合</span>` : ''}<span class="tag ${cls}">${st}</span>
          ${g.contested ? `<span class="bid-rivals">${g.teams.filter(x => x !== t.id).map(x => teamChip(x)).join('')}</span>` : ''}</li>`;
      }).join('');
      body = `${statusBar(res, year)}
        <section class="team-hero" style="--team:${t.color}">
          <div class="team-hero-main">
            <p class="team-league">${h(t.league)}・リーグ</p>
            <h2 class="team-hero-name">${h(t.name)}</h2>
            <p class="team-hero-owner">担当者：<b>${h(t.owner || '未定')}</b></p>
            ${t.declared ? `<p class="team-hero-decl">明言：${player(t.declared, { compact: true })}</p>` : ''}
          </div>
          <div class="team-hero-kpis">
            <div class="kpi kpi-main"><span class="kpi-label">支配下</span><span class="kpi-num">${t.counts.main}<small>名</small></span></div>
            <div class="kpi kpi-dev"><span class="kpi-label">育成</span><span class="kpi-num">${t.counts.dev}<small>名</small></span></div>
          </div>
        </section>
        <div class="team-cols">
          <div>
            ${t.bids.length ? `<section class="section panel"><h2 class="section-title">1位入札の経過</h2><ul class="bid-list">${bidRows}</ul></section>` : ''}
            <section class="section panel panel-main"><h2 class="section-title"><i class="sw sw-main"></i>本指名（支配下）</h2>${pickList(t.main, 'main', '本指名')}${t.endMain ? `<p class="end-note">${t.endMain}位で選択終了</p>` : ''}</section>
            <section class="section panel panel-dev"><h2 class="section-title"><i class="sw sw-dev"></i>育成指名</h2>${pickList(t.dev, 'dev', '育成指名')}${t.endDev ? `<p class="end-note">育成${t.endDev}位で選択終了</p>` : ''}</section>
          </div>
          <aside class="section panel"><h2 class="section-title">ポジション別人数</h2>${m.hasPositions ? posTable(t) : '<p class="muted">ポジション情報を取得できませんでした（シートのセル色を読み取れない状態です）。</p>'}</aside>
        </div>`;
    }
    return `<div class="container">
      <div class="page-head"><div><p class="eyebrow"><a href="#/${year}">${year}年 ドラフトボード</a> ／ 球団別</p><h1 class="page-title">${h(base ? base.name : '球団')}</h1></div>${yearTabs(year, '/' + id)}</div>
      ${switcher}
      ${body}
    </div>`;
  }

  // ---------- アーカイブ ----------
  function viewArchive() {
    return `<div class="container">
      <div class="page-head"><div><h1 class="page-title">年度別アーカイブ</h1><p class="muted">2019年からの仮想ドラフト結果。各年度のドラフトボードと球団別結果を閲覧できます。</p></div></div>
      <ul class="archive-grid">${YEARS.map(y => {
        const r = state.results[y] || window.DraftData.peek(y);
        const m = r && r.model;
        return `<li class="archive-card${y === CFG.currentYear ? ' is-current' : ''}">
          <span class="archive-year">${y}</span>
          <span class="archive-meta">${y === CFG.currentYear ? '今年の会議' : '結果アーカイブ'}${m ? `・支配下 ${m.totals.main} / 育成 ${m.totals.dev}` : ''}</span>
          <span class="archive-actions"><a class="btn btn-primary" href="#/${y}">ドラフトボード</a><a class="btn btn-ghost" href="#/${y}/teams">球団別結果</a></span>
        </li>`;
      }).join('')}</ul>
    </div>`;
  }

  // ---------- ルーティング ----------
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return { name: 'home', year: CFG.currentYear };
    if (parts[0] === 'archive') return { name: 'archive' };
    if (parts[0] === 'rules') return { name: 'rules' };
    const year = Number(parts[0]);
    if (!YEARS.includes(year)) return { name: 'home', year: CFG.currentYear };
    if (!parts[1]) return { name: 'board', year };
    if (parts[1] === 'teams') return { name: 'teams', year };
    if (teamById(parts[1])) return { name: 'team', year, id: parts[1] };
    return { name: 'board', year };
  }

  function render(opts = {}) {
    const route = parseRoute();
    const scrolls = {};
    app.querySelectorAll('[data-scroll]').forEach(el => (scrolls[el.dataset.scroll] = el.scrollLeft));
    let html, title;
    switch (route.name) {
      case 'archive': html = viewArchive(); title = '年度別アーカイブ'; break;
      case 'rules': html = viewRules(); title = 'ルール・選択手順'; break;
      case 'board': html = viewBoard(route.year); title = `${route.year}年 ドラフトボード`; break;
      case 'teams': html = viewTeams(route.year); title = `${route.year}年 球団別結果`; break;
      case 'team': html = viewTeam(route.year, route.id); title = `${teamById(route.id).short}（${route.year}年）`; break;
      default: html = viewHome(); title = '';
    }
    app.innerHTML = html;
    document.title = title ? `${title}｜${CFG.eventName}` : `${CFG.eventName}｜仮想ドラフト会議`;
    app.querySelectorAll('[data-scroll]').forEach(el => { if (scrolls[el.dataset.scroll]) el.scrollLeft = scrolls[el.dataset.scroll]; });
    document.querySelectorAll('.site-nav a').forEach(a => {
      const n = a.dataset.nav;
      const on = (n === 'home' && route.name === 'home') || (n === 'board' && route.name === 'board') ||
        (n === 'teams' && (route.name === 'teams' || route.name === 'team')) || (n === 'archive' && route.name === 'archive') || (n === 'rules' && route.name === 'rules');
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (opts.scrollTop) window.scrollTo(0, 0);
  }

  // ---------- データ取得と自動更新 ----------
  async function refresh(year) {
    state.loadingYear = year;
    const res = await window.DraftData.load(year);
    state.results[year] = res;
    const route = parseRoute();
    if ((route.year || CFG.currentYear) === year || route.name === 'archive') render();
  }

  function schedule() {
    clearTimeout(state.timer);
    const route = parseRoute();
    const year = route.year || CFG.currentYear;
    const interval = phase(year) === 'live' ? CFG.pollIntervalLive : CFG.pollIntervalIdle;
    if (!interval || document.hidden) return;
    state.timer = setTimeout(async () => { await refresh(year); schedule(); }, interval);
  }

  async function onRoute(scrollTop) {
    const route = parseRoute();
    const year = route.year || CFG.currentYear;
    if (!state.results[year]) {
      const cached = window.DraftData.peek(year);
      if (cached) state.results[year] = cached;
    }
    render({ scrollTop });
    const r = state.results[year];
    if (!r || r.source !== 'demo') await refresh(year);
    schedule();
  }

  window.addEventListener('hashchange', () => onRoute(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { const y = parseRoute().year || CFG.currentYear; refresh(y).then(schedule); }
    else clearTimeout(state.timer);
  });
  app.addEventListener('click', e => {
    if (e.target.closest('[data-action="refresh"]')) {
      const y = parseRoute().year || CFG.currentYear;
      refresh(y).then(schedule);
    }
  });

  // ヘッダーの年度リンクを現在年に
  document.querySelectorAll('[data-nav="board"]').forEach(a => (a.href = `#/${CFG.currentYear}`));
  document.querySelectorAll('[data-nav="teams"]').forEach(a => (a.href = `#/${CFG.currentYear}/teams`));
  document.querySelectorAll('[data-year]').forEach(el => (el.textContent = CFG.currentYear));
  onRoute(false);
})();
