/*
 * 全ゲーム共通 引き継ぎコード — https://nikkukyuu-code.github.io/transfer/
 *
 * All games are GitHub Pages project sites on ONE origin (nikkukyuu-code.github.io), so they
 * share one localStorage. This script packs EVERY key on the origin into one code:
 *   NK1<c|p>.<base64url payload>.<crc32 hex>
 *   c = deflate-raw compressed JSON {g:"NK", v:1, t:<ms>, d:{key: value}}, p = plain (no CompressionStream)
 *
 * ── Adding a game: add ONE entry to GAMES below ─────────────────────────────
 *   id       short id
 *   name     display name (summary / list)
 *   match(k) true if the localStorage key belongs to the game
 *   rules    { exactKey: rule } and/or rulesRe: [[RegExp, rule], ...]
 *            rule = 'max' (numbers: never lowered) | 'union' (JSON arrays: owned unlocks)
 *                 | 'or' ('1'/true flags) | 'imported' | 'current' (keep this device's)
 *                 | function (curVal, impVal, ctx) -> string | undefined (undefined = don't write)
 *            Keys without a rule use the imported value (decks/layouts/settings/COM memory).
 *   summary(d) -> [lines]  (d = that game's keys) — shown before applying
 * Keys matching no game go to the "その他" bucket and are imported as-is, so future games'
 * data is carried automatically even before they get a registry entry.
 * EXCLUDE: transient counter caches and this tool's own backups.
 * Import never deletes keys. It first saves everything to BACKUP_KEY, then writes merged values.
 */
(function () {
  'use strict';
  var GID = 'NK', VER = '1';
  var BACKUP_KEY = 'nk-transfer-preimport';
  var EXCLUDE = [/_visitLast/, /_battleLast/, /^hub_visitLast_/, /preimport/];

  /* ---------- helpers ---------- */
  function num(s) { var n = Number(s); return s != null && s !== '' && Number.isFinite(n) ? n : null; }
  function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (_) { return d; } }
  function maxNumStr(a, b) { var x = num(a), y = num(b); if (x == null) return b; if (y == null) return a; return String(Math.max(x, y)); }
  function unionArr(a, b) {
    var out = [];
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function (v) {
      var key = JSON.stringify(v);
      if (!out.some(function (o) { return JSON.stringify(o) === key; })) out.push(v);
    });
    return out;
  }
  function maxHeat(a, b) {
    var out = {};
    [a, b].forEach(function (m) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      Object.keys(m).forEach(function (k) { var n = Number(m[k]); if (Number.isFinite(n) && n > 0) out[k] = Math.max(out[k] || 0, n); });
    });
    return out;
  }
  function truthy(s) { if (s == null) return false; var v = json(s, s); return v === true || v === 1 || v === '1' || v === 'true' || v === 'done'; }
  function formatMs(ms) {
    var t = Math.max(0, Math.round(ms)), h = Math.floor(t / 3600000), m = Math.floor(t % 3600000 / 60000), s = Math.floor(t % 60000 / 1000);
    return h + '時間' + String(m).padStart(2, '0') + '分' + String(s).padStart(2, '0') + '秒' + String(t % 1000).padStart(3, '0');
  }
  var RULES = {
    max: function (a, b) { return maxNumStr(a, b); },
    union: function (a, b) { return JSON.stringify(unionArr(json(a, []), json(b, []))); },
    or: function (a, b) { return truthy(a) ? a : b; },
    imported: function (a, b) { return b; },
    current: function (a) { return a; },
  };

  /* ---------- game registry ---------- */
  function spaceMeta(a, b) {
    var x = json(a, {}), y = json(b, {});
    if (!x || typeof x !== 'object') return b;
    if (!y || typeof y !== 'object') return a;
    return JSON.stringify(Object.assign({}, x, y, {
      pt: Math.max(Math.floor(Number(x.pt) || 0), Math.floor(Number(y.pt) || 0)),
      owned: unionArr(x.owned, y.owned),
      deck: Array.isArray(y.deck) && y.deck.length ? y.deck : x.deck,
    }));
  }
  function houseComMemory(a, b) {
    var x = json(a, {}), y = json(b, {});
    // Only fair-play memory (fair>=2) carries trap positions; older data may be peeked → dropped.
    var fx = Number(x.fair) >= 2, fy = Number(y.fair) >= 2;
    return JSON.stringify(Object.assign({}, x, y, {
      fair: 2,
      matches: Math.max(Number(x.matches) || 0, Number(y.matches) || 0),
      trapHeat: maxHeat(fx ? x.trapHeat : {}, fy ? y.trapHeat : {}),
      safeHeat: maxHeat(x.safeHeat, y.safeHeat),
      chestHeat: maxHeat(x.chestHeat, y.chestHeat),
      pathHeat: maxHeat(x.pathHeat, y.pathHeat),
      level: Math.max(Number(x.level) || 1, Number(y.level) || 1),
    }));
  }
  function houseComRecord(a, b) {
    // {tier: {w, l}} COM-only win/loss: per tier keep the record with more matches (never decreases).
    var x = json(a, {}), y = json(b, {}), out = {};
    [x, y].forEach(function (o) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return;
      Object.keys(o).forEach(function (k) {
        var v = o[k] || {}, w = Math.max(0, Math.floor(Number(v.w) || 0)), l = Math.max(0, Math.floor(Number(v.l) || 0)), c = out[k];
        if (!c || w + l > c.w + c.l || (w + l === c.w + c.l && w > c.w)) out[k] = { w: w, l: l };
      });
    });
    return JSON.stringify(out);
  }
  function houseTut(a, b) {
    var n = function (s) {
      if (s === '1' || s === 'done' || s === 'skip') return { done: true, seen: {} };
      var d = json(s, null);
      if (d === true || d === 1) return { done: true, seen: {} };
      return d && typeof d === 'object' ? { done: !!d.done, seen: d.seen && typeof d.seen === 'object' ? d.seen : {} } : { done: false, seen: {} };
    };
    var x = n(a), y = n(b), seen = Object.assign({}, x.seen, y.seen);
    return JSON.stringify({ done: x.done || y.done, seen: seen });
  }
  var SHOGI_SEALED = ['shogi-serious-rank-v6', 'shogi-serious-rank-v6-bak', 'shogi-serious-rank-v1', 'shogi-serious-rank-v2', 'shogi-serious-rank-salt'];
  function shogiRankList(s) { var a = json(s, []); return Array.isArray(a) ? a.filter(function (e) { return e && typeof e.ms === 'number'; }) : []; }
  function shogiDiff(d) { return ['beginner', 'intermediate', 'advanced', 'serious'].indexOf(d) >= 0 ? d : 'serious'; }
  function shogiRanks(a, b, ctx) {
    // Rankings: this device's own entries move to the imported player id; keep the best (min ms) per player & difficulty.
    var curId = ctx.cur['shogi-player-id'] || null;
    var impId = ctx.imp['shogi-player-id'] || curId;
    var impName = String(ctx.imp['shogi-player-name'] || '').trim();
    var mine = shogiRankList(a).map(function (e) {
      if (e.playerId && e.playerId !== curId) return e;
      var o = Object.assign({}, e, { playerId: impId });
      if (impName) o.name = impName;
      return o;
    });
    var best = {};
    mine.concat(shogiRankList(b)).forEach(function (e) {
      var k = (e.playerId || '') + '|' + shogiDiff(e.difficulty), p = best[k];
      if (!p || e.ms < p.ms || (e.ms === p.ms && e.at < p.at)) best[k] = e;
    });
    var list = Object.keys(best).map(function (k) { return best[k]; }).sort(function (p, q) { return p.ms - q.ms || p.at - q.at; });
    return JSON.stringify(list.slice(0, 400));
  }
  function shogiSealed(a, b, ctx) {
    // AES-sealed legacy store is keyed by this device's salt: take it only if this device has none.
    return ctx.cur['shogi-serious-rank-salt'] == null ? b : undefined;
  }
  function shogiBest(d) {
    var out = {};
    shogiRankList(d['shogi-rank-plain-v2']).forEach(function (e) { var k = shogiDiff(e.difficulty); if (out[k] == null || e.ms < out[k]) out[k] = e.ms; });
    return out;
  }

  var GAMES = [
    {
      id: 'space', name: 'スペーストリックバトル',
      match: function (k) { return /^shootingOnline/.test(k) || /^shooting-online/.test(k) || /^sto[-_]/.test(k); },
      rules: {
        shootingOnline_meta: spaceMeta, // {pt: max, owned: union, deck: imported}
        shootingOnline_meta_bak: spaceMeta,
        shootingOnline_newUnits: 'union',
        shootingOnline_tutorialDone: 'or',
      },
      summary: function (d) {
        var m = json(d.shootingOnline_meta || d.shootingOnline_meta_bak || '{}', {});
        return ['PT ' + (Math.floor(Number(m.pt) || 0)).toLocaleString('ja-JP') + '・持っているキャラ ' + (Array.isArray(m.owned) ? m.owned.length : 0) + '体' + (Array.isArray(m.deck) ? '・デッキ ' + m.deck.length + '枠' : '')];
      },
    },
    {
      id: 'house', name: 'トリックハウスバトル',
      match: function (k) { return k.indexOf('househouse-') === 0 || k.indexOf('househouse_') === 0 || k === 'ht_mute'; },
      rules: {
        'househouse-points-v1': 'max',
        'househouse-points-v1-bak': 'max',
        'househouse-houses-owned-v1': 'union',
        'househouse-house-selected-v1': 'imported',
        'househouse-com-memory-v1': houseComMemory, // COMが覚えた場所（人と同じ条件で得た情報のみ）
        'househouse-com-memory-v1_legacy_bak': 'current',
        'househouse-player-trap-heat-v1_legacy_bak': 'current',
        'househouse-player-trap-heat-v1': function () { return undefined; }, // retired (peeked data)
        'househouse-ingame-tut-v1': houseTut,
        'househouse-com-record-v1': houseComRecord, // COM対戦の勝敗（敵Lvのもと）
        'househouse-com-record-v1-bak': houseComRecord,
        ht_mute: 'imported',
      },
      summary: function (d) {
        var owned = json(d['househouse-houses-owned-v1'] || '[]', []);
        var m = json(d['househouse-com-memory-v1'] || '{}', {});
        var places = 0; ['trapHeat', 'safeHeat', 'chestHeat'].forEach(function (f) { if (m[f] && typeof m[f] === 'object') places += Object.keys(m[f]).length; });
        return ['ポイント ' + (num(d['househouse-points-v1']) || 0).toLocaleString('ja-JP') + '・持っている家 ' + (Array.isArray(owned) ? owned.length : 0) + '軒',
          'COM対戦 ' + (Number(m.matches) || 0) + '回・COMが覚えた場所 ' + places + 'マス'].concat((function () {
            var r = json(d['househouse-com-record-v1'] || '{}', {}).com;
            return r && (r.w || r.l) ? ['COM戦の成績 ' + (Number(r.w) || 0) + '勝' + (Number(r.l) || 0) + '敗'] : [];
          })());
      },
    },
    {
      id: 'shogi', name: '7GET将棋',
      match: function (k) { return k.indexOf('shogi-') === 0 || k.indexOf('shogi_') === 0; },
      rules: (function () {
        var r = { 'shogi-rank-plain-v2': shogiRanks, 'shogi-player-id': 'imported', 'shogi-player-name': 'imported', 'shogi-pref-v1': 'imported' };
        SHOGI_SEALED.forEach(function (k) { r[k] = shogiSealed; });
        return r;
      })(),
      summary: function (d) {
        var labels = { beginner: '初級', intermediate: '中級', advanced: '上級', serious: '真剣' }, b = shogiBest(d), out = [];
        var name = String(d['shogi-player-name'] || '').trim();
        Object.keys(labels).forEach(function (k) { if (b[k] != null) out.push(labels[k] + ' ' + formatMs(b[k])); });
        return ['ニックネーム ' + (name || '（未設定）'), out.length ? 'ベスト：' + out.join('／') : 'ランキング記録なし'];
      },
    },
  ];
  var OTHER = { id: 'other', name: 'その他（新しいゲームなど）', match: function () { return true; }, rules: {}, summary: function (d) { return [Object.keys(d).length + '項目'] ; } };

  function gameOf(k) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].match(k)) return GAMES[i]; return OTHER; }
  function excluded(k) { return k === BACKUP_KEY || EXCLUDE.some(function (re) { return re.test(k); }); }
  function ruleFor(g, k) {
    if (g.rules && Object.prototype.hasOwnProperty.call(g.rules, k)) return g.rules[k];
    if (g.rulesRe) for (var i = 0; i < g.rulesRe.length; i++) if (g.rulesRe[i][0].test(k)) return g.rulesRe[i][1];
    return 'imported';
  }
  function collect() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k != null && !excluded(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  }
  function group(d) {
    var g = {};
    Object.keys(d).forEach(function (k) { var gm = gameOf(k); (g[gm.id] = g[gm.id] || { game: gm, d: {} }).d[k] = d[k]; });
    return GAMES.concat([OTHER]).map(function (gm) { return g[gm.id]; }).filter(Boolean);
  }
  function merge(cur, imp) {
    var out = {}, ctx = { cur: cur, imp: imp };
    Object.keys(imp).forEach(function (k) {
      if (excluded(k)) return;
      var a = cur[k], b = imp[k];
      var rule = ruleFor(gameOf(k), k);
      var fn = typeof rule === 'function' ? rule : RULES[rule] || RULES.imported;
      if (a == null && typeof rule !== 'function') { out[k] = b; return; }
      var v;
      try { v = fn(a == null ? null : a, b, ctx); } catch (_) { v = b; }
      if (typeof v === 'string') out[k] = v;
    });
    return out;
  }

  /* ---------- code format ---------- */
  function crc32(str) {
    var c, crc = 0xffffffff;
    for (var i = 0; i < str.length; i++) {
      c = (crc ^ str.charCodeAt(i)) & 0xff;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function streamBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function encode(data) {
    var js = JSON.stringify({ g: GID, v: 1, t: Date.now(), d: data });
    var bytes = new TextEncoder().encode(js), mode = 'p';
    if (typeof CompressionStream !== 'undefined') {
      try { bytes = await streamBytes(bytes, new CompressionStream('deflate-raw')); mode = 'c'; } catch (e) { bytes = new TextEncoder().encode(js); mode = 'p'; }
    }
    var head = GID + VER + mode, payload = bytesToB64url(bytes);
    return head + '.' + payload + '.' + crc32(head + '.' + payload);
  }
  async function decode(code) {
    code = String(code || '').replace(/\s+/g, '');
    var parts = code.split('.');
    if (parts.length !== 3) throw new Error('コードの形式が正しくありません（途中で切れていないか確認してください）');
    var head = parts[0], payload = parts[1], sum = parts[2];
    if (head.slice(0, 2) !== GID) throw new Error('このサイトの引き継ぎコードではありません');
    var mode = head.slice(3);
    if (head.charAt(2) !== VER || (mode !== 'c' && mode !== 'p')) throw new Error('対応していないバージョンのコードです');
    if (crc32(head + '.' + payload) !== sum.toLowerCase()) throw new Error('コードが壊れています（コピー漏れ・打ち間違いの可能性）');
    var bytes = b64urlToBytes(payload);
    if (mode === 'c') {
      if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮コードに対応していません。ブラウザを更新してください');
      bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
    }
    var obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || obj.g !== GID || !obj.d || typeof obj.d !== 'object') throw new Error('このサイトの引き継ぎコードではありません');
    Object.keys(obj.d).forEach(function (k) { if (typeof obj.d[k] !== 'string') delete obj.d[k]; });
    return obj;
  }
  function apply(imp) {
    var cur = collect();
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), d: cur }));
    var next = merge(cur, imp);
    Object.keys(next).forEach(function (k) { localStorage.setItem(k, next[k]); });
    return next;
  }

  /* ---------- page UI ---------- */
  function $(id) { return document.getElementById(id); }
  function setMsg(el, t, err) { el.textContent = t; el.classList.toggle('err', !!err); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function summaryHtml(groups, curGroups) {
    var curMap = {}; (curGroups || []).forEach(function (g) { curMap[g.game.id] = g; });
    return groups.map(function (g) {
      var lines = []; try { lines = g.game.summary(g.d) || []; } catch (_) {}
      var c = curMap[g.game.id], cl = [];
      if (c) try { cl = c.game.summary(c.d) || []; } catch (_) {}
      return '<div class="sum-game"><b>' + esc(g.game.name) + '</b>（' + Object.keys(g.d).length + '項目）<br>' +
        '<span class="sum-k">コード：</span>' + esc(lines.join('・')) +
        (curGroups ? '<br><span class="sum-k">この端末：</span>' + esc(c ? cl.join('・') : 'データなし') : '') + '</div>';
    }).join('');
  }
  var backHref = null;
  function showResult(ok, detailHtml) {
    var old = document.getElementById('tx-result'); if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'tx-result';
    ov.className = 'tx-result ' + (ok ? 'ok' : 'ng');
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="tx-result-card">' +
      '<div class="tx-result-icon" aria-hidden="true">' + (ok ? '✅' : '❌') + '</div>' +
      '<h2 class="tx-result-title">' + (ok ? '引き継ぎ成功しました！' : '引き継ぎできませんでした') + '</h2>' +
      '<div class="tx-result-body">' + detailHtml + '</div>' +
      '<div class="tx-result-btns">' +
      (ok && backHref ? '<a class="tx-rbtn primary" href="' + esc(backHref) + '">ゲームに戻る</a>' : '') +
      (ok ? '<a class="tx-rbtn' + (backHref ? '' : ' primary') + '" href="/">トップページへ</a>' : '') +
      '<button type="button" class="tx-rbtn" data-close>' + (ok ? '閉じる' : '閉じて入力し直す') + '</button>' +
      '</div></div>';
    ov.querySelector('[data-close]').addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
    try { (ov.querySelector('.tx-rbtn.primary') || ov.querySelector('[data-close]')).focus(); } catch (_) {}
  }
  function restoredHtml(impData) {
    var ids = {}; group(impData).forEach(function (g) { ids[g.game.id] = true; });
    var now = group(collect()).filter(function (g) { return ids[g.game.id]; });
    return '<ul class="tx-result-list">' + now.map(function (g) {
      var lines = []; try { lines = g.game.summary(g.d) || []; } catch (_) {}
      return '<li><b>' + esc(g.game.name) + '</b><span>' + esc(lines.join('・')) + '</span></li>';
    }).join('') + '</ul><p class="tx-result-note">今の端末にあった記録はバックアップ済みです。ゲームを開くと反映されています。</p>';
  }
  function listHere() {
    var gs = group(collect());
    $('here').innerHTML = gs.length ? summaryHtml(gs) : '<p class="muted">この端末（このブラウザ）にはまだ記録がありません。</p>';
  }
  function initPage() {
    var from = new URLSearchParams(location.search).get('from') || '';
    if (/^\/[A-Za-z0-9_\-\/.]*$/.test(from) && from.indexOf('//') < 0) {
      backHref = from;
      document.querySelectorAll('[data-back]').forEach(function (a) { a.href = from; a.hidden = false; });
    }
    listHere();
    document.querySelectorAll('[data-go]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var imp = btn.getAttribute('data-go') === 'import';
        var sec = $(imp ? 'sec-import' : 'sec-export');
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
        var target = $(imp ? 'in' : 'btn-export');
        setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); } }, 350);
      });
    });
    var pending = null;
    function readFragment() {
      var h = location.hash || '';
      if (h.indexOf('#code=') !== 0) return;
      var code = h.slice(6);
      try { code = decodeURIComponent(code); } catch (_) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { location.hash = ''; }
      $('in').value = code;
      $('sec-import').scrollIntoView({ block: 'start' });
      $('btn-check').click();
    }
    setTimeout(readFragment, 0);
    window.addEventListener('hashchange', readFragment);
    $('btn-export').addEventListener('click', async function () {
      try {
        var d = collect();
        var code = await encode(d);
        var out = $('out'); out.hidden = false; out.value = code; $('btn-copy').disabled = false;
        setMsg($('outmsg'), group(d).length + 'ゲーム・' + Object.keys(d).length + '項目・' + code.length.toLocaleString('ja-JP') + '文字。全部コピーして、メモ帳などに保存してください。');
        try { out.focus({ preventScroll: true }); out.select(); } catch (_) {}
      } catch (e) { setMsg($('outmsg'), '発行できませんでした：' + (e && e.message || e), true); }
    });
    $('btn-copy').addEventListener('click', async function () {
      var out = $('out');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(out.value);
        else { out.focus(); out.select(); document.execCommand('copy'); }
        setMsg($('outmsg'), 'コピーしました（' + out.value.length.toLocaleString('ja-JP') + '文字）');
      } catch (e) {
        try { out.focus(); out.select(); document.execCommand('copy'); setMsg($('outmsg'), 'コピーしました'); }
        catch (_) { setMsg($('outmsg'), '自動コピーできませんでした。枠内を長押しして全選択→コピーしてください', true); }
      }
    });
    var reset = function () { pending = null; $('sum').hidden = true; $('applyrow').hidden = true; };
    $('in').addEventListener('input', reset);
    $('btn-cancel').addEventListener('click', function () { reset(); setMsg($('inmsg'), ''); });
    $('btn-check').addEventListener('click', async function () {
      reset();
      try {
        var obj = await decode($('in').value);
        pending = obj;
        var when = new Date(obj.t || 0);
        $('sum').innerHTML = '<p>コード発行日時：' + esc(isNaN(when) ? '不明' : when.toLocaleString('ja-JP')) + '・' + Object.keys(obj.d).length + '項目</p>' +
          summaryHtml(group(obj.d), group(collect())) +
          '<p class="muted">※今の記録は自動でバックアップされます。ポイント・PTなどの数値は大きい方、持っている家やキャラは両方、ベストタイムは速い方を残します。デッキ・設定・COMの記憶はコードの内容になります。</p>';
        $('sum').hidden = false; $('applyrow').hidden = false;
        setMsg($('inmsg'), '内容を確認して「この内容で引き継ぐ」を押してください');
      } catch (e) {
        var m = (e && e.message) || 'コードを読み込めませんでした';
        setMsg($('inmsg'), m, true);
        showResult(false, '<p class="tx-result-err">' + esc(m) + '</p><p class="tx-result-note">記録は何も変わっていません。発行したコードを最初から最後まで全部コピーして、もう一度貼り付けてください。</p>');
      }
    });
    $('btn-apply').addEventListener('click', function () {
      if (!pending) return;
      try {
        var imp = pending.d;
        var n = Object.keys(apply(imp)).length;
        reset(); $('in').value = '';
        setMsg($('inmsg'), '引き継ぎました（' + n + '項目）。ゲームを開くと反映されています。');
        listHere();
        showResult(true, restoredHtml(imp));
      } catch (e) {
        var m = '引き継げませんでした：' + (e && e.message || e);
        setMsg($('inmsg'), m, true);
        showResult(false, '<p class="tx-result-err">' + esc(m) + '</p><p class="tx-result-note">ブラウザの保存容量が足りないか、プライベートモードの可能性があります。</p>');
      }
    });
  }

  window.NikkukyuuTransfer = { GAMES: GAMES, collect: collect, group: group, merge: merge, encode: encode, decode: decode, apply: apply, BACKUP_KEY: BACKUP_KEY };
  if (document.getElementById('transfer-app')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage); else initPage();
  }
})();
