// Token Launch Radar dashboard. Reads window.RADAR from ../data.js (written by main.ts beside this
// folder) and renders two hash-routed views: the ranked board (#/board?filters) and one protocol's
// detail page (#/p/<slug>) with the model's arithmetic and the farm plan. No network, no framework.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { return n == null ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function years(listed) {
    if (!listed) return null;
    var ms = new Date(D.as_of + 'T00:00:00Z') - new Date(listed + 'T00:00:00Z');
    return ms / (365.25 * 864e5);
  }
  function sinceText(r) {
    var y = years(r.listed);
    return r.listed ? r.listed + ' · ' + y.toFixed(1) + 'y' : 'not recorded';
  }

  // Header stats and the model panel, with the medians this run actually used.
  document.getElementById('asof').textContent = D.as_of;
  document.getElementById('st-total').textContent = D.total;
  document.getElementById('st-pre').textContent = D.tokenless;
  document.getElementById('st-watch').textContent = D.watchlist;
  (function modelPanel() {
    var top = D.multiples.slice(0, 7);
    var medRows = top.map(function (m) {
      return '<tr><td>' + esc(m.category) + ' (' + m.peers + ' tokenized)</td><td>× ' + m.multiple.toFixed(2) + '</td></tr>';
    }).join('');
    document.getElementById('model-panel').innerHTML =
      '<div><h2>How the radar scores</h2>' +
      '<p>Protocols whose token already trades (' + (D.total - D.tokenless) + ' of ' + D.total + ') are the yardstick, ' +
      'never the board: for each category the radar takes the <b>median market cap ÷ TVL</b> of that category\u2019s ' +
      'tokenized protocols in this snapshot. A pre-token protocol is then priced off its own category, adjusted for ' +
      'its <b>7-day TVL growth</b> and for <b>how long it has been tracked with no token</b>. One formula scores all ' +
      D.tokenless + ' rows; no name is hand-picked. Categories with fewer than 3 tokenized peers use the global median.</p>' +
      '<p class="formula">implied value = TVL × category multiple × growth factor × age factor</p></div>' +
      '<div class="meds"><h3>Category multiples used</h3><table>' + medRows +
      '<tr><td>Global median (fallback)</td><td>× ' + D.global_multiple.toFixed(2) + '</td></tr></table>' +
      '<p class="more">Plus ' + (D.multiples.length - top.length) + ' more categories in the data, each with its own median.</p></div>';
  })();

  // Filter controls, populated from the data itself.
  var catSel = document.getElementById('f-cat');
  var chainSel = document.getElementById('f-chain');
  (function fillSelects() {
    var cats = {}, chains = {};
    rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    catSel.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    chainSel.innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
  })();

  var els = {
    q: document.getElementById('f-q'), min: document.getElementById('f-min'),
    sort: document.getElementById('f-sort'), watch: document.getElementById('f-watch'),
    tbody: document.getElementById('rows'), count: document.getElementById('rowcount'),
    board: document.getElementById('board-view'), detail: document.getElementById('detail-view'),
  };

  function boardHash(st) {
    var p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.cat) p.set('cat', st.cat);
    if (st.chain) p.set('chain', st.chain);
    if (st.min > 0) p.set('min', st.min);
    if (st.watch) p.set('watch', '1');
    if (st.sort !== 'implied') p.set('sort', st.sort);
    var s = p.toString();
    return '#/board' + (s ? '?' + s : '');
  }
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('p/') === 0) return { view: 'detail', slug: decodeURIComponent(h.slice(2)) };
    var qs = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    var p = new URLSearchParams(qs);
    return {
      view: 'board',
      q: p.get('q') || '', cat: p.get('cat') || '', chain: p.get('chain') || '',
      min: Number(p.get('min') || 0), watch: p.get('watch') === '1',
      sort: p.get('sort') || 'implied',
    };
  }

  function applyFilters(st) {
    var q = st.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.min > 0 && r.tvl < st.min) return false;
      if (st.watch && !r.watch) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl - a.tvl; },
      change: function (a, b) { return (b.chg == null ? -1e9 : b.chg) - (a.chg == null ? -1e9 : a.chg); },
      tokenless: function (a, b) { return (a.listed || '9999') < (b.listed || '9999') ? -1 : 1; },
    };
    out.sort(by[st.sort] || by.implied);
    return out;
  }

  function renderBoard(st) {
    els.detail.hidden = true;
    els.board.hidden = false;
    els.q.value = st.q; catSel.value = st.cat; chainSel.value = st.chain;
    els.min.value = String(st.min); els.sort.value = st.sort; els.watch.checked = st.watch;
    var list = applyFilters(st);
    els.tbody.innerHTML = list.map(function (r) {
      var chgCls = r.chg == null ? 'dim' : (r.chg >= 0 ? 'pos' : 'neg');
      var chains = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.watch ? ' class="watch' + (r.rank <= 10 ? ' top' : '') + '"' : (r.rank <= 10 ? ' class="top"' : '')) + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td class="dim">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="dim">' + esc(chains) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
        '<td class="num ' + chgCls + '">' + fmtPct(r.chg) + '</td>' +
        '<td class="dim">' + esc(sinceText(r)) + '</td>' +
        '<td class="num val">' + fmtUsd(r.implied) + '</td>' +
        '<td class="num dim">× ' + (r.implied / r.tvl).toFixed(2) + '</td></tr>';
    }).join('');
    els.count.textContent = 'Showing ' + list.length + ' of ' + rows.length +
      ' pre-token protocols. Click a row for its value breakdown and farm plan.';
  }

  function multipleNote(r) {
    var label = r.category || 'Uncategorised';
    var entry = null;
    D.multiples.forEach(function (m) { if (m.category === label) entry = m; });
    if (entry && entry.peers >= 3) return 'median of ' + entry.peers + ' tokenized ' + label + ' protocols';
    return 'global median: ' + label + ' has fewer than 3 tokenized peers';
  }
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { location.hash = '#/board'; return; }
    els.board.hidden = true;
    els.detail.hidden = false;
    var y = years(r.listed);
    var growthNote = r.chg == null ? 'no 7-day change reported: neutral'
      : 'TVL ' + fmtPct(r.chg) + ' in 7 days, clamped to −50%…+200%';
    var ageNote = r.listed == null ? 'no listing day in the record: neutral'
      : 'tracked since ' + r.listed + ': ' + y.toFixed(1) + ' years with no token, capped at 5';
    var term = function (label, value, note) {
      return '<div class="term"><span>' + label + '</span><b>' + value + '</b><small>' + note + '</small></div>';
    };
    els.detail.innerHTML =
      '<a class="back" href="#/board">&larr; All protocols</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      (r.watch ? '<span class="badge">WATCHLIST</span>' : '') +
      '<span class="cat">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + rows.length + '</span></div>' +
      '<div class="kv">' +
      '<div class="cell"><span>TVL</span><b>' + fmtUsd(r.tvl) + '</b></div>' +
      '<div class="cell"><span>7d change</span><b>' + fmtPct(r.chg) + '</b></div>' +
      '<div class="cell"><span>Tokenless since</span><b>' + esc(r.listed || 'not recorded') + '</b></div>' +
      '<div class="cell"><span>Chains</span><b>' + r.chains.length + '</b></div>' +
      '<div class="cell"><span>Implied value</span><b>' + fmtUsd(r.implied) + '</b></div>' +
      '</div>' +
      '<p class="dim">Chains: ' + esc(r.chains.join(', ')) + '</p>' +
      '<h3>How this implied value is derived</h3>' +
      '<div class="fx">' +
      term('TVL', fmtUsd(r.tvl), 'from the snapshot') +
      '<div class="op">×</div>' +
      term('Category multiple', '× ' + r.mult.toFixed(2), esc(multipleNote(r))) +
      '<div class="op">×</div>' +
      term('Growth factor', r.gf.toFixed(2), esc(growthNote)) +
      '<div class="op">×</div>' +
      term('Age factor', r.af.toFixed(2), esc(ageNote)) +
      '<div class="op">=</div>' +
      '<div class="term total"><span>Implied value</span><b>' + fmtUsd(r.implied) + '</b><small>× ' +
      (r.implied / r.tvl).toFixed(2) + ' of TVL</small></div>' +
      '</div>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    window.scrollTo(0, 0);
  }

  function route() {
    var st = parseHash();
    if (st.view === 'detail') renderDetail(st.slug);
    else renderBoard(st);
  }
  function pushControls() {
    var st = {
      q: els.q.value, cat: catSel.value, chain: chainSel.value,
      min: Number(els.min.value), watch: els.watch.checked, sort: els.sort.value,
    };
    history.replaceState(null, '', boardHash(st));
    renderBoard(Object.assign({ view: 'board' }, st));
  }
  ['input', 'change'].forEach(function (ev) {
    [els.q, catSel, chainSel, els.min, els.sort, els.watch].forEach(function (el) {
      el.addEventListener(ev, pushControls);
    });
  });
  els.tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', route);
  route();
})();
