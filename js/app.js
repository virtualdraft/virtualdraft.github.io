/*
 * 画面描画・ルーティング・自動更新
 * URL（ハッシュ）:
 *   #/                 トップ
 *   #/2026             2026年指名状況（各年度に直接アクセス可）
 *   #/2026/teams       2026年 球団一覧
 *   #/2026/giants      2026年 球団別ページ
 *   #/archive          年度別アーカイブ
 * 動作確認用: ?phase=before|live|after で開催状態を上書きできます。
 */
(function () {
  const CFG = window.DRAFT_CONFIG;
  const YEARS = Object.keys(CFG.years).map(Number).sort((a, b) => b - a);
  const app = document.getElementById('app');
  const state = { results: {}, timer: null, loadingYear: null, profiles: null, viewYear: null };

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

  // ---------- 指名選手のプロフィール（候補DBの公開分。当年のみ） ----------
  const VARIANTS = { '髙': '高', '﨑': '崎', '德': '徳', '濵': '浜', '邊': '辺', '邉': '辺', '俠': '侠', '齋': '斎', '齊': '斉', '槇': '槙', '𠮷': '吉', '栁': '柳', '冨': '富', '曻': '昇', '瀨': '瀬', '惠': '恵', '黑': '黒' };
  const nameKey = s => [...String(s || '').normalize('NFKC').replace(/[\s*+\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu, '')].map(c => VARIANTS[c] || c).join('');
  function profileOf(p) {
    if (!p || !state.profiles || state.viewYear !== CFG.currentYear) return null;
    const list = state.profiles[nameKey(p.name)];
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    // 同姓同名の候補が複数いる場合は、運営シートのセル色のポジションで見分ける（1人に決まらなければ表示しない）
    const pos = p.posGroup || p.pos;
    if (!pos) return null;
    const same = list.filter(x => x.pos === pos);
    if (same.length) return same.length === 1 ? same[0] : null;
    const second = list.filter(x => x.secondPos === pos);
    return second.length === 1 ? second[0] : null;
  }
  const profPos = pr => pr.pos ? pr.pos + (pr.secondPos ? `/${pr.secondPos}` : '') : '';
  const profLine = pr => [pr.category, pr.hand, pr.age != null ? `${pr.age}歳` : '',
    pr.height && pr.weight ? `${pr.height}cm/${pr.weight}kg` : pr.height ? `${pr.height}cm` : ''].filter(Boolean).join('・');

  function player(p, opts = {}) {
    if (!p) return '<span class="empty">—</span>';
    const pr = profileOf(p);
    const meta = pr ? [profPos(pr) || p.pos, pr.team].filter(Boolean).join('・') : [p.pos, p.school].filter(Boolean).join('・');
    const line = pr && !opts.compact ? profLine(pr) : '';
    return `<span class="pl${opts.compact ? ' pl-compact' : ''}"><span class="pl-name">${h(p.name)}</span>${meta ? `<span class="pl-meta">${h(meta)}</span>` : ''}${line ? `<span class="pl-prof">${h(line)}</span>` : ''}</span>`;
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

    // 当日のWeb会議の参加案内
    const wm = CFG.webMeeting && CFG.webMeeting.url ? CFG.webMeeting : null;
    const wmJoin = (cls = 'btn') => wm ? ext(wm.url, `${h(wm.service)}で参加する`, cls) : '';
    const copyItem = (label, value) => value ? `<span class="wm-item"><span class="k">${label}</span><span class="wm-code">${h(value)}</span>
      <button type="button" class="wm-copy" data-copy="${h(value.replace(/\s/g, ''))}" aria-label="${label}をコピー">コピー</button></span>` : '';
    const meeting = wm ? `<div class="wm">
        <h3 class="wm-title">Web会議（${h(wm.service)}）${phaseBadge}</h3>
        <div class="tile wm-tile">${wmJoin('btn')}<div class="wm-codes">${copyItem('ミーティングID', wm.meetingId)}${copyItem('パスコード', wm.passcode)}</div></div>
      </div>` : '';

    // 当日使用資料（指名選手発表スライド・運営スプレッドシート）。Web会議の下に表示
    const docLinks = [
      CFG.slidesUrl ? ext(CFG.slidesUrl, '指名選手発表スライド', 'btn ghost btn-sm') : '',
      CFG.sheetUrl ? ext(CFG.sheetUrl, '運営スプレッドシート', 'btn ghost btn-sm') : '',
    ].filter(Boolean);
    const docs = docLinks.length ? `<div class="wm" id="docs"><h3 class="wm-title">当日使用資料</h3><div class="tile wm-tile docs-tile">${docLinks.join('')}</div></div>` : '';

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
      <div class="live-cta"><a class="btn btn-lg" href="#/${y}">${ph === 'live' ? 'ライブ会議室（指名状況）に入る' : 'ドラフト結果を見る'}</a>${ph === 'live' ? wmJoin('btn btn-lg') : ''}${CFG.sheetUrl ? ext(CFG.sheetUrl, '運営スプレッドシートを開く', 'btn ghost btn-lg') : ''}</div>
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
          <a class="btn" href="#/${y}">指名状況</a>
          ${wmJoin('btn')}
          ${ext(ev.mapUrl, '会場地図（Google マップで開く）', 'btn ghost')}
        </div>
      </header>
      ${live}
      ${band(true, 'info', '', '開催情報', '', `
        <div class="tile-grid info-grid">
          <div class="tile info-tile"><span class="k">開催日</span><span class="v">${h(ev.dateLabel)}</span></div>
          <div class="tile info-tile"><span class="k">時間</span><span class="v">${h(ev.timeLabel)}</span></div>
          <div class="tile info-tile"><span class="k">会場</span><span class="v">${h(ev.venue)}</span>${ext(ev.mapUrl, '会場地図（Google マップで開く）', 'more')}</div>
        </div>
        ${meeting}
        ${docs}`)}
      ${window.DraftFeatures && window.DraftFeatures.homeProspects ? window.DraftFeatures.homeProspects() : ''}
      ${band(true, 'teams', '', '参加12球団', res ? `最終更新 ${fmtDateTime(res.fetchedAt)}${res.source === 'demo' ? '（デモデータ）' : ''}` : '', `
        ${res && res.error ? `<div class="alert">最新データを取得できませんでした。${res.model ? '前回取得分を表示しています。' : ''} ${sheetLink('運営シートを開く', 'inline-link')}</div>` : ''}
        <ul class="team-grid">${teamsList}</ul>`)}`;
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

  // ---------- 指名状況 ----------
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

  // ---------- 指名選手一覧の絞り込み（カテゴリ・ポジション・投打。グループ内は「いずれか」、グループ間は「すべて」） ----------
  const TLF_KEY = 'draft-tl-filter';
  const TLF_CAT_ORDER = ['高校生', '大学生', '社会人', '独立'];
  const TLF_POS = ['投手', '捕手', '内野手', '外野手'];
  const TLF_HAND = ['右投', '左投', '右打', '左打', '両打'];
  let tlFilter = { cat: [], pos: [], hand: [] };
  try { tlFilter = { ...tlFilter, ...JSON.parse(localStorage.getItem(TLF_KEY) || '{}') }; } catch (e) { /* 保存できない環境では毎回リセット */ }
  const tlfActive = () => tlFilter.cat.length + tlFilter.pos.length + tlFilter.hand.length > 0;

  // 選手の絞り込み用の属性（プロフィールが無い選手は、運営シートのセル色のポジションだけ）
  function pickAttrs(p) {
    const pr = profileOf(p);
    const pos = pr ? [pr.pos, pr.secondPos].filter(Boolean) : [p.posGroup || p.pos].filter(Boolean);
    const hand = pr && pr.hand ? pr.hand : '';
    return { cat: pr ? pr.category : '', pos, throw: (hand[0] || (pr && pr.throws) || ''), bat: hand.length >= 4 ? hand[2] : '' };
  }
  function pickMatches(a) {
    const f = tlFilter;
    if (f.cat.length && !f.cat.includes(a.cat)) return false;
    if (f.pos.length && !a.pos.some(x => f.pos.includes(x))) return false;
    if (f.hand.length) {
      // 投手なら投げ手（右投/左投）、野手なら打席（右打/左打/両打）で判定。兼任はどちらかに当てはまれば表示
      const pitcher = a.pos.includes('投手'), fielder = a.pos.some(x => x !== '投手');
      const ok = f.hand.some(v => v.endsWith('投') ? pitcher && a.throw === v[0] : fielder && a.bat === v[0]);
      if (!ok) return false;
    }
    return true;
  }

  function tlFilterBar(all) {
    const cats = [...new Set(all.map(a => a.cat).filter(Boolean))]
      .sort((x, y) => (TLF_CAT_ORDER.indexOf(x) + 1 || 99) - (TLF_CAT_ORDER.indexOf(y) + 1 || 99));
    const hands = TLF_HAND.filter(v => v !== '両打' || all.some(a => a.bat === '両'));
    const group = (key, label, values) => `<div class="tlf-group" role="group" aria-label="${label}"><span class="tlf-label">${label}</span>${values.map(v =>
      `<button type="button" class="tlf-chip" data-tlf="${key}" data-v="${h(v)}" aria-pressed="${tlFilter[key].includes(v)}">${h(v)}</button>`).join('')}</div>`;
    return `<div class="tl-filter">
      ${cats.length ? group('cat', 'カテゴリ', cats) : ''}
      ${group('pos', 'ポジション', TLF_POS)}
      ${group('hand', '投打', hands)}
      <p class="tlf-note">投手は投げ手（右投・左投）、野手は打席（右打・左打・両打）で絞り込みます。兼任ポジションの選手はどちらのポジションにも表示します。</p>
    </div>`;
  }

  function boardTimeline(m) {
    const y = m.year, blocks = [];
    const withProfiles = y === CFG.currentYear && !!state.profiles;
    const active = withProfiles && tlfActive();
    const all = [];
    const keep = p => { const a = pickAttrs(p); all.push(a); return !active || pickMatches(a); };
    let shown = 0;
    for (let r = 1; r <= m.maxMain; r++) {
      const items = m.teams.map(t => ({ t, x: t.main.find(x => x.rank === r) })).filter(o => o.x && keep(o.x.player));
      if (!items.length) continue;
      shown += items.length;
      blocks.push(`<li class="tl-block tl-main"><h3 class="tl-rank"><span>本指名</span>${r}位</h3><ul class="tl-items">${items.map(({ t, x }) =>
        `<li><a href="#/${y}/${t.id}">${teamChip(t)}</a>${player(x.player)}${r === 1 && t.firstContested ? '<span class="tag tag-hot">競合</span>' : ''}</li>`).join('')}</ul></li>`);
    }
    const pendingTeams = m.teams.filter(t => !t.first && t.bids.length);
    if (pendingTeams.length && !active) {
      blocks.splice(1, 0, `<li class="tl-block tl-pending"><h3 class="tl-rank"><span>1位</span>未確定</h3><ul class="tl-items">${pendingTeams.map(t => `<li>${teamChip(t)}<span class="muted">抽選・再入札待ち</span></li>`).join('')}</ul></li>`);
    }
    for (let r = 1; r <= m.maxDev; r++) {
      const items = m.teams.map(t => ({ t, x: t.dev.find(x => x.rank === r) })).filter(o => o.x && keep(o.x.player));
      if (!items.length) continue;
      shown += items.length;
      blocks.push(`<li class="tl-block tl-dev"><h3 class="tl-rank"><span>育成</span>${r}位</h3><ul class="tl-items">${items.map(({ t, x }) =>
        `<li><a href="#/${y}/${t.id}">${teamChip(t)}</a>${player(x.player)}</li>`).join('')}</ul></li>`);
    }
    const total = all.length;
    const bar = withProfiles && total ? `${tlFilterBar(all)}<p class="tlf-count" aria-live="polite"><span>${active ? `${total}名中 <b>${shown}</b>名を表示` : `${total}名`}</span>${active ? '<button type="button" class="linkish" data-tlf-clear>絞り込みを解除</button>' : ''}</p>` : '';
    const empty = active ? '<p class="muted">条件に当てはまる選手はいません。</p>' : '<p class="muted">まだ指名はありません。</p>';
    return `<div class="board-sp"><h2 class="section-title"><span class="only-pc">指名選手一覧</span><span class="only-sp">指名タイムライン</span></h2>${bar}${blocks.length ? `<ol class="timeline">${blocks.join('')}</ol>` : empty}</div>`;
  }

  function teamLinks(m) {
    return `<section class="section"><h2 class="section-title">球団別の指名結果</h2>
      <ul class="team-links">${m.teams.map(t => `<li><a href="#/${m.year}/${t.id}" style="--team:${t.color}"><i class="dot"></i>${h(t.short)}<span><b class="c-main">${t.counts.main}</b>/<b class="c-dev">${t.counts.dev}</b></span></a></li>`).join('')}</ul></section>`;
  }

  function viewBoard(year) {
    const res = state.results[year], m = res && res.model, ph = phase(year);
    const title = `${year}年 指名状況`;
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
      <div class="page-head"><div><h1 class="page-title">${year}年 球団別結果</h1></div>${yearTabs(year, '/teams')}</div>
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
    return `<ol class="picks picks-${kind}">${list.map(x => {
      const pr = profileOf(x.player), line = pr ? profLine(pr) : '';
      return `<li><span class="pick-rank">${kind === 'dev' ? '育成' : ''}${x.rank}位</span>
      <span class="pick-name">${h(x.player.name)}</span><span class="pick-pos">${h((pr && profPos(pr)) || x.player.pos || '—')}</span><span class="pick-school">${h((pr && pr.team) || x.player.school || '')}</span>${line ? `<span class="pick-prof">${h(line)}</span>` : ''}</li>`;
    }).join('')}</ol>`;
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
      <div class="page-head"><div><h1 class="page-title">${h(base ? base.name : '球団')}</h1></div>${yearTabs(year, '/' + id)}</div>
      ${switcher}
      ${body}
    </div>`;
  }

  // ---------- アーカイブ ----------
  function viewArchive() {
    return `<div class="container">
      <div class="page-head"><div><h1 class="page-title">年度別アーカイブ</h1><p class="muted">2019年からの仮想ドラフト結果。各年度の指名状況と球団別結果を閲覧できます。</p></div></div>
      <ul class="archive-grid">${YEARS.map(y => {
        const r = state.results[y] || window.DraftData.peek(y);
        const m = r && r.model;
        return `<li class="archive-card${y === CFG.currentYear ? ' is-current' : ''}">
          <span class="archive-year">${y}</span>
          <span class="archive-meta">${y === CFG.currentYear ? '今年の会議' : '結果アーカイブ'}${m ? `・支配下 ${m.totals.main} / 育成 ${m.totals.dev}` : ''}</span>
          <span class="archive-actions"><a class="btn btn-primary" href="#/${y}">指名状況</a><a class="btn btn-ghost" href="#/${y}/teams">球団別結果</a></span>
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
    const feature = window.DraftFeatures && window.DraftFeatures.parse(parts);
    if (feature) return { ...feature, feature: true };
    const year = Number(parts[0]);
    if (!YEARS.includes(year)) return { name: 'home', year: CFG.currentYear };
    if (!parts[1]) return { name: 'board', year };
    if (parts[1] === 'teams') return { name: 'teams', year };
    if (teamById(parts[1])) return { name: 'team', year, id: parts[1] };
    return { name: 'board', year };
  }

  // ---------- パンくずリスト（トップ以外のページの上部に表示） ----------
  function crumbs(route) {
    const top = ['トップ', '#/'];
    const yearBoard = y => y === CFG.currentYear ? [[`${y}年 指名状況`, `#/${y}`]] : [['アーカイブ', '#/archive'], [`${y}年 指名状況`, `#/${y}`]];
    const npbTeam = id => [['NPBデータ', '#/npb'], [`${teamById(id).short}の所属選手`, `#/npb/${id}`]];
    switch (route.name) {
      case 'board': return [top, ...yearBoard(route.year)];
      case 'teams': return [top, ...yearBoard(route.year), ['球団別結果', `#/${route.year}/teams`]];
      case 'team': return [top, ...yearBoard(route.year), ['球団別結果', `#/${route.year}/teams`], [teamById(route.id).short, null]];
      case 'archive': return [top, ['アーカイブ', null]];
      case 'rules': return [top, ['ルール', null]];
      case 'prospects': return [top, ['注目選手', '#/prospects']];
      case 'npb': return [top, ['NPBデータ', null]];
      case 'npbTeam': return [top, ...npbTeam(route.id)];
      case 'sim': return [top, ...npbTeam(route.id), ['指名人数シミュレーション', null]];
      case 'depth': return [top, ...npbTeam(route.id), [`${CFG.currentYear}年シーズン貢献度`, null]];
      default: return null;
    }
  }
  function breadcrumb(route) {
    const list = crumbs(route);
    if (!list) return '';
    const last = list.length - 1;
    const extra = state.crumbExtra && state.crumbExtra.hash === location.hash ? state.crumbExtra.label : '';
    return `<nav class="breadcrumb" aria-label="現在地"><ol>${list.map(([label, href], i) =>
      `<li>${href && i < last ? `<a href="${href}">${h(label)}</a>` : `<span${i === last && !extra ? ' aria-current="page"' : ''}>${h(label)}</span>`}</li>`).join('')}<li class="crumb-extra" data-crumb-extra${extra ? '' : ' hidden'}>${extra ? `<span aria-current="location">${h(extra)}</span>` : ''}</li></ol></nav>`;
  }
  // 注目選手ページで選手の紹介へ移動したときなど、ページ内の現在地をパンくずの末尾に足す
  function setCrumbExtra(label) {
    // 自動更新で描き直しても消えないよう、同じページにいる間は覚えておく
    state.crumbExtra = label ? { hash: location.hash, label } : null;
    const el = app.querySelector('[data-crumb-extra]');
    if (!el) return;
    el.hidden = !label;
    el.innerHTML = label ? `<span aria-current="location">${h(label)}</span>` : '';
  }

  function render(opts = {}) {
    const route = parseRoute();
    state.viewYear = route.year || null;
    const scrolls = {};
    app.querySelectorAll('[data-scroll]').forEach(el => (scrolls[el.dataset.scroll] = el.scrollLeft));
    let html, title;
    switch (route.name) {
      case 'archive': html = viewArchive(); title = '年度別アーカイブ'; break;
      case 'rules': html = viewRules(); title = 'ルール・選択手順'; break;
      case 'prospects': case 'npb': case 'npbTeam': case 'sim': case 'depth': html = window.DraftFeatures.view(route); title = route.title; break;
      case 'board': html = viewBoard(route.year); title = `${route.year}年 指名状況`; break;
      case 'teams': html = viewTeams(route.year); title = `${route.year}年 球団別結果`; break;
      case 'team': html = viewTeam(route.year, route.id); title = `${teamById(route.id).short}（${route.year}年）`; break;
      default: html = viewHome(); title = '';
    }
    app.innerHTML = breadcrumb(route) + html;
    document.title = title ? `${title}｜${CFG.eventName}` : `${CFG.eventName}｜仮想ドラフト会議`;
    app.querySelectorAll('[data-scroll]').forEach(el => { if (scrolls[el.dataset.scroll]) el.scrollLeft = scrolls[el.dataset.scroll]; });
    renderMenu(route);
    if (opts.scrollTop) window.scrollTo(0, 0);
    // 別ページから「その選手の紹介へ」移動したとき：描画が終わってからスクロールする
    if (state.pendingJump) {
      const { id, label } = state.pendingJump;
      const el = document.getElementById(id);
      if (el) {
        state.pendingJump = null;
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
          setCrumbExtra(label);
        });
      }
    }
  }
  // 注目選手ページの選手紹介へ移動（今いるページが注目選手ならその場でスクロール）
  function jumpTo(hash, id, label) {
    state.pendingJump = { id, label };
    if (location.hash === hash) render(); else location.hash = hash;
  }

  // ---------- データ取得と自動更新 ----------
  async function refresh(year) {
    state.loadingYear = year;
    // プロフィールは指名データの表示を待たせないよう別に取得し、届いたら描き直す
    if (year === CFG.currentYear) {
      window.DraftData.loadProfiles().then(prof => {
        if (!prof) return;
        const changed = JSON.stringify(prof.players) !== JSON.stringify(state.profiles);
        state.profiles = prof.players;
        if (changed && (parseRoute().year || CFG.currentYear) === year) render();
      });
    }
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
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const done = ok => { copy.textContent = ok ? 'コピーしました' : 'コピーできませんでした'; setTimeout(() => (copy.textContent = 'コピー'), 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(copy.dataset.copy).then(() => done(true), () => done(false));
      else done(false);
      return;
    }
    const chip = e.target.closest('[data-tlf]');
    if (chip || e.target.closest('[data-tlf-clear]')) {
      if (chip) {
        const list = tlFilter[chip.dataset.tlf], v = chip.dataset.v, i = list.indexOf(v);
        if (i >= 0) list.splice(i, 1); else list.push(v);
      } else tlFilter = { cat: [], pos: [], hand: [] };
      try { localStorage.setItem(TLF_KEY, JSON.stringify(tlFilter)); } catch (err) { /* 保存できなくても絞り込みは動く */ }
      render();
      return;
    }
    if (e.target.closest('[data-action="refresh"]')) {
      const y = parseRoute().year || CFG.currentYear;
      refresh(y).then(schedule);
    }
  });

  // ---------- ハンバーガーメニュー（階層つき） ----------
  // 親：トップ／指名状況（球団別結果）／注目選手（各選手）／NPBデータ（シーズン貢献度・指名数シミュレーション）／アーカイブ／ルール
  // 親（指名状況・注目選手・NPBデータ）は押すと下の階層が開く。今いるページの親は最初から開いておく
  const menuOpen = new Set();
  let menuRouteKey = null;
  function renderMenu(route) {
    const nav = document.querySelector('#site-menu .site-nav');
    if (!nav) return;
    const y = CFG.currentYear;
    const teamId = ['npbTeam', 'sim', 'depth'].includes(route.name) ? route.id : CFG.teams[0].id;
    const players = window.DraftFeatures && window.DraftFeatures.prospectList ? window.DraftFeatures.prospectList() : null;
    const link = (label, href, on, extra = '') => `<a href="${href}"${on ? ' class="is-active" aria-current="page"' : ''}${extra}>${h(label)}</a>`;
    // 階層の中の折りたたみ（球団別結果の各球団・注目選手の各選手）
    const fold = (key, label, on, items) => {
      if (on) menuOpen.add(key);
      return `<details class="menu-more" data-fold="${key}"${menuOpen.has(key) ? ' open' : ''}><summary${on ? ' class="is-active"' : ''}>${h(label)}</summary><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></details>`;
    };
    // 参考リンク（外部サイト。新しいタブで開く）。プロ志望届は「高校生：…」「大学生：…」「大学生（準硬式）：…」をまとめて階層化
    const refLinks = { other: [], shibou: [] };
    (CFG.references || []).forEach(r => {
      const m = r.label.match(/^(高校生|大学生(?:（準硬式）)?)：/);
      if (m) refLinks.shibou.push(ext(r.url, h(m[1])));
      else refLinks.other.push(ext(r.url, h(r.label)));
    });
    const inBoard = (route.name === 'board' && route.year === y) || route.name === 'teams' || route.name === 'team';
    const inNpb = ['npb', 'npbTeam', 'sim', 'depth'].includes(route.name);
    const groups = [
      { key: 'info', label: '会議情報', on: false, info: true },
      { key: 'top', parent: link('トップ', '#/', route.name === 'home') },
      { key: 'board', label: '指名状況', on: inBoard, children: [
        link(`${y}年 指名状況`, `#/${y}`, route.name === 'board' && route.year === y)],
        more: fold('teams', '球団別結果', route.name === 'teams' || route.name === 'team', [
          link('球団別結果（一覧）', `#/${y}/teams`, route.name === 'teams'),
          ...CFG.teams.map(t => link(t.short, `#/${y}/${t.id}`, route.name === 'team' && route.id === t.id && route.year === y))]) },
      { key: 'prospects', label: '注目選手', on: route.name === 'prospects', children: [
        link('注目選手（一覧）', '#/prospects', route.name === 'prospects')],
        more: players && players.length ? fold('players', `選手一覧（${players.length}人）`, false,
          players.map(p => link(p.name, '#/prospects', false, ` data-player="${h(p.id)}"`))) : '' },
      { key: 'npb', label: 'NPBデータ', on: inNpb, children: [
        link('12球団の所属選手', '#/npb', route.name === 'npb' || route.name === 'npbTeam'),
        link('シーズン貢献度', `#/depth/${teamId}`, route.name === 'depth'),
        link('指名数シミュレーション', `#/sim/${teamId}`, route.name === 'sim')] },
      { key: 'refs', label: '参考リンク', on: false, children: refLinks.other, more: refLinks.shibou.length ? fold('shibou', 'プロ志望届一覧', false, refLinks.shibou) : '' },
      { key: 'archive', parent: link('アーカイブ', '#/archive', route.name === 'archive' || (route.name === 'board' && route.year !== y)) },
      { key: 'rules', parent: link('ルール', '#/rules', route.name === 'rules') },
    ];
    // ページが変わったら、そのページの親を開く
    const rk = location.hash;
    if (rk !== menuRouteKey) { menuRouteKey = rk; groups.forEach(g => { if (g.on) menuOpen.add(g.key); }); }
    // 会議情報：下の階層に当日使うリンク（会場地図・Zoom・指名選手発表スライド・運営スプレッドシート）
    const ev = CFG.event, wm = CFG.webMeeting && CFG.webMeeting.url ? CFG.webMeeting : null;
    const infoLinks = [
      ext(ev.mapUrl, '会場地図'),
      wm ? ext(wm.url, `${h(wm.service)}リンク`) : '',
      CFG.slidesUrl ? ext(CFG.slidesUrl, '指名選手発表スライド') : '',
      CFG.sheetUrl ? ext(CFG.sheetUrl, '運営スプレッドシート') : '',
    ].filter(Boolean);
    const infoHtml = g => `<details class="menu-group menu-fold mg-${g.key}" data-fold="${g.key}"${menuOpen.has(g.key) ? ' open' : ''}>
          <summary>${h(g.label)}</summary>
          <ul class="menu-sub">${infoLinks.map(c => `<li>${c}</li>`).join('')}</ul>
        </details>`;
    const html = g => g.info ? infoHtml(g) : g.parent
      ? `<div class="menu-group mg-${g.key}">${g.parent}</div>`
      : `<details class="menu-group menu-fold mg-${g.key}" data-fold="${g.key}"${menuOpen.has(g.key) ? ' open' : ''}>
          <summary${g.on ? ' class="is-active"' : ''}>${h(g.label)}</summary>
          <ul class="menu-sub">${g.children.map(c => `<li>${c}</li>`).join('')}</ul>${g.more ? `<div class="menu-sub-more">${g.more}</div>` : ''}
        </details>`;
    // PC は3列（左：トップ・会議情報・指名状況・アーカイブ・ルール／中央：NPBデータ・参考リンク／右：注目選手）。スマホは1列で上の順
    const cols = [['top', 'info', 'board', 'archive', 'rules'], ['npb', 'refs'], ['prospects']];
    const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
    nav.innerHTML = cols.map(keys => `<div class="menu-col">${keys.filter(k => byKey[k]).map(k => html(byKey[k])).join('')}</div>`).join('');
  }


  const menuBtn = document.querySelector('[data-menu-toggle]');
  const menuPanel = document.getElementById('site-menu');
  function setMenu(open) {
    if (!menuBtn || !menuPanel) return;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuPanel.hidden = !open;
    document.body.classList.toggle('menu-open', open);
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
    // 開閉の状態を覚えておく（自動更新で描き直しても閉じないように）
    menuPanel.addEventListener('toggle', e => {
      const d = e.target.closest && e.target.closest('[data-fold]');
      if (!d || d !== e.target) return;
      if (d.open) menuOpen.add(d.dataset.fold); else menuOpen.delete(d.dataset.fold);
    }, true);
    menuPanel.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a) return;
      setMenu(false);
      const id = a.dataset.player;
      if (!id) return;
      // 注目選手の各選手：注目選手ページへ移動してから、その選手の紹介までスクロール
      e.preventDefault();
      jumpTo('#/prospects', id, a.textContent);
    });
    document.addEventListener('click', e => { if (!menuPanel.hidden && !e.target.closest('.site-header')) setMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menuPanel.hidden) { setMenu(false); menuBtn.focus(); } });
    window.addEventListener('hashchange', () => setMenu(false));
  }

  // 追加機能（js/features.js）向けの共通部品
  window.DraftUI = {
    h, ext, teamChip, player, scoreboard, fmtDateTime, setCrumbExtra, jumpTo,
    currentResult: () => state.results[CFG.currentYear],
    rerender: () => render(),
  };
  if (window.DraftFeatures) window.DraftFeatures.attach(app);

  // ヘッダーの年度リンクを現在年に
  document.querySelectorAll('[data-nav="board"]').forEach(a => (a.href = `#/${CFG.currentYear}`));
  document.querySelectorAll('[data-nav="teams"]').forEach(a => (a.href = `#/${CFG.currentYear}/teams`));
  document.querySelectorAll('[data-year]').forEach(el => (el.textContent = CFG.currentYear));
  onRoute(false);
})();
