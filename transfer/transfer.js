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
  var EXCLUDE = [/_visitLast/, /_battleLast/, /^hub_visitLast_/, /preimport/, /^nkTransfer/];

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
  function spaceComRecord(a, b) {
    // COM勝率: per difficulty keep the record with MORE matches (never reduces)
    var x = json(a, {}), y = json(b, {});
    if (!x || typeof x !== 'object') x = {};
    if (!y || typeof y !== 'object') y = {};
    var side = function (s) { return { w: Math.max(0, Math.floor(Number(s && s.w) || 0)), l: Math.max(0, Math.floor(Number(s && s.l) || 0)) }; };
    var pick = function (p, q) { p = side(p); q = side(q); return (q.w + q.l) > (p.w + p.l) ? q : p; };
    return JSON.stringify(Object.assign({}, x, y, { v: 1, normal: pick(x.normal, y.normal), strong: pick(x.strong, y.strong) }));
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

  function nekoSave(a, b) {
    // 猫ハウスつり: counters only go up. Coins = earned - spent → keep the (earned, spent) PAIR with more coins,
    // baits likewise per bait (bought, used) pair with more left; dex / medals / stage / rod / stats = max.
    var x = json(a, {}), y = json(b, {});
    if (!x || typeof x !== 'object' || Array.isArray(x)) x = {};
    if (!y || typeof y !== 'object' || Array.isArray(y)) y = {};
    var N = function (v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; };
    var O = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    var mx = function (p, q) { var o = {}; [O(p), O(q)].forEach(function (m) { Object.keys(m).forEach(function (k) { o[k] = Math.max(o[k] || 0, N(m[k])); }); }); return o; };
    var cx = N(x.earned) - N(x.spent), cy = N(y.earned) - N(y.spent);
    var pc = cy > cx || (cy === cx && N(y.earned) > N(x.earned)) ? y : x;
    var bb = {}, bu = {};
    Object.keys(Object.assign({}, O(x.baitBought), O(y.baitBought))).forEach(function (k) {
      var lx = N(O(x.baitBought)[k]) - N(O(x.baitUsed)[k]), ly = N(O(y.baitBought)[k]) - N(O(y.baitUsed)[k]);
      var s = ly > lx || (ly === lx && N(O(y.baitBought)[k]) > N(O(x.baitBought)[k])) ? y : x;
      bb[k] = N(O(s.baitBought)[k]); bu[k] = N(O(s.baitUsed)[k]);
    });
    var dex = {};
    [O(x.dex), O(y.dex)].forEach(function (m) {
      Object.keys(m).forEach(function (k) {
        var e = O(m[k]), c = dex[k] || { n: 0, best: 0, first: 0 };
        dex[k] = { n: Math.max(c.n, N(e.n)), best: Math.max(c.best, N(e.best)), first: c.first && N(e.first) ? Math.min(c.first, N(e.first)) : (c.first || N(e.first)) };
      });
    });
    return JSON.stringify({
      v: 1, earned: N(pc.earned), spent: Math.min(N(pc.spent), N(pc.earned)), baitBought: bb, baitUsed: bu,
      rod: Math.max(1, N(x.rod), N(y.rod)), dex: dex, stageMax: Math.max(1, N(x.stageMax), N(y.stageMax)),
      stageBest: mx(x.stageBest, y.stageBest), medals: mx(x.medals, y.medals), stats: mx(x.stats, y.stats),
      updated: Math.max(N(x.updated), N(y.updated)),
    });
  }

  function shogiOnlineKey(a, b, ctx) {
    var d = ctx && ctx.imp ? ctx.imp : null;
    var hasImpId = d ? !!(d['shogi-rank-online-id'] || d['shogi-rank-online-id-bak']) : !!b;
    if (hasImpId) return b != null && b !== '' ? b : a;
    return a != null && a !== '' ? a : b;
  }
  function spaceRankKey(a, b, ctx) {
    // Ranking identity moves as a set: if the code carries an id, take the code's id/secret/nickname;
    // otherwise keep this device's (never blank out an existing ranking account).
    var d = ctx && ctx.imp ? ctx.imp : null;
    var hasImpId = d ? !!(d.shootingOnline_rankId || d.shootingOnline_rankId_bak) : !!b;
    if (hasImpId) return b != null && b !== '' ? b : a;
    return a != null && a !== '' ? a : b;
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
        shootingOnline_comRecord: spaceComRecord, // COM対戦の勝敗（難易度ごとに試合数の多い方）
        shootingOnline_comRecord_bak: spaceComRecord,
        // 世界ランキング: プレイヤーID・秘密キー・ニックネームは3つ一緒に移す（コード側の本人情報）
        shootingOnline_rankId: spaceRankKey,
        shootingOnline_rankId_bak: spaceRankKey,
        shootingOnline_rankSecret: spaceRankKey,
        shootingOnline_rankSecret_bak: spaceRankKey,
        shootingOnline_nickname: spaceRankKey,
        shootingOnline_nickname_bak: spaceRankKey,
      },
      summary: function (d) {
        var m = json(d.shootingOnline_meta || d.shootingOnline_meta_bak || '{}', {});
        var out = ['PT ' + (Math.floor(Number(m.pt) || 0)).toLocaleString('ja-JP') + '・持っているキャラ ' + (Array.isArray(m.owned) ? m.owned.length : 0) + '体' + (Array.isArray(m.deck) ? '・デッキ ' + m.deck.length + '枠' : '')];
        var r = json(d.shootingOnline_comRecord || d.shootingOnline_comRecord_bak || 'null', null);
        if (r && typeof r === 'object') {
          var line = function (lab, s) { var w = Math.floor(Number(s && s.w) || 0), l = Math.floor(Number(s && s.l) || 0); return lab + ' ' + w + '勝' + l + '敗'; };
          out.push('COM対戦 ' + line('普通', r.normal) + '・' + line('強い', r.strong));
        }
        var nick = d.shootingOnline_nickname || d.shootingOnline_nickname_bak;
        if (d.shootingOnline_rankId || d.shootingOnline_rankId_bak) out.push('ランキング名 ' + (nick || '名無し') + '（メダルも引き継ぎ）');
        return out;
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
        // オンラインランキング: ID・秘密キー・名前(-bak)はセットで移す
        ['shogi-rank-online-id', 'shogi-rank-online-id-bak', 'shogi-rank-online-secret', 'shogi-rank-online-secret-bak', 'shogi-player-name-bak'].forEach(function (k) { r[k] = shogiOnlineKey; });
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
    {
      id: 'neko', name: '猫ハウスつり',
      match: function (k) { return k.indexOf('nekotsuri-') === 0 || k.indexOf('nekotsuri_') === 0; },
      rules: {
        'nekotsuri-save-v1': nekoSave, // コイン(多い方の組)・図鑑/メダル/ステージ/竿(大きい方)
        'nekotsuri-save-v1-bak': nekoSave,
        'nekotsuri-pref-v1': 'imported',
      },
      summary: function (d) {
        var s = json(d['nekotsuri-save-v1'] || d['nekotsuri-save-v1-bak'] || '{}', {}) || {};
        var coins = Math.max(0, Math.floor((Number(s.earned) || 0) - (Number(s.spent) || 0)));
        var kinds = 0, total = 0, dx = s.dex && typeof s.dex === 'object' ? s.dex : {};
        Object.keys(dx).forEach(function (k) { var n = Number(dx[k] && dx[k].n) || 0; if (n > 0) { kinds++; total += n; } });
        return ['コイン ' + coins.toLocaleString('ja-JP') + '・図鑑 ' + kinds + '種（' + total + '匹）・ステージ ' + (Math.max(1, Number(s.stageMax) || 1)) + 'まで・メダル ' + Object.keys(s.medals && typeof s.medals === 'object' ? s.medals : {}).length + '個'];
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
  /* ---------- short 引き継ぎID (server: Worker "transfer"; localhost always uses "transfer-test") ---------- */
  var LOCALHOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var TX_API = LOCALHOST ? 'https://transfer-test.nikkukyuu.workers.dev' : 'https://transfer.nikkukyuu.workers.dev';
  var K_TXID = 'nkTransferId', K_TXPIN = 'nkTransferPin'; // NEW keys (+ _bak); never renamed
  var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function lsGet(k) { try { return localStorage.getItem(k) || localStorage.getItem(k + '_bak') || ''; } catch (_) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); localStorage.setItem(k + '_bak', v); } catch (_) {} }
  function normId(s) { return String(s || '').toUpperCase().replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function fmtId(id) { return id.slice(0, 4) + '-' + id.slice(4); }
  function normPin(s) { return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\D/g, ''); }
  function newPin() { var a = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000; return String(a).padStart(6, '0'); }
  async function txKeys(id, pin) {
    var te = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', te.encode(id + '|' + pin), 'PBKDF2', false, ['deriveBits']);
    var bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('nk-transfer-v1|' + id), iterations: 150000 }, base, 512));
    var aes = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    var auth = Array.prototype.map.call(bits.slice(32), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return { aes: aes, auth: auth };
  }
  async function txApi(path, body) {
    var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, 15000);
    try {
      var r = await fetch(TX_API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal, cache: 'no-store' });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.ok) return { ok: false, status: r.status, error: j.error, message: j.message || ('通信エラー ' + r.status) };
      return j;
    } catch (e) { return { ok: false, offline: true, message: 'サーバーに接続できません。電波の良い所でもう一度お試しください' }; }
    finally { clearTimeout(t); }
  }
  async function txSeal(id, pin, data) {
    var k = await txKeys(id, pin);
    var code = await encode(data);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k.aes, new TextEncoder().encode(code)));
    return { auth: k.auth, blob: bytesToB64url(iv) + '.' + bytesToB64url(ct) };
  }
  async function txOpen(id, pin, blob, aes) {
    var parts = String(blob).split('.');
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(parts[0]) }, aes, b64urlToBytes(parts[1]));
    return decode(new TextDecoder().decode(pt));
  }
  /** Issue (or refresh under the saved ID) → {ok, id, pin, expires_at, refreshed} */
  async function issueId() {
    var id = normId(lsGet(K_TXID)), pin = normPin(lsGet(K_TXPIN)), refreshed = true;
    for (var tries = 0; tries < 2; tries++) {
      if (!(id.length === 8 && pin.length === 6)) {
        var r = await txApi('/issue');
        if (!r.ok) return r;
        id = r.id; pin = newPin(); refreshed = false;
      }
      var s = await txSeal(id, pin, collect());
      var w = await txApi('/save', { id: id, auth: s.auth, blob: s.blob });
      if (w.ok) { lsSet(K_TXID, id); lsSet(K_TXPIN, pin); return { ok: true, id: id, pin: pin, expires_at: w.expires_at, refreshed: refreshed }; }
      if (w.status === 404 || w.status === 403) { id = ''; pin = ''; continue; } // expired / not usable → new ID
      return w;
    }
    return { ok: false, message: 'もう一度お試しください' };
  }
  async function restoreId(idIn, pinIn) {
    var id = normId(idIn), pin = normPin(pinIn);
    if (id.length !== 8 || [].some.call(id, function (c) { return ALPHA.indexOf(c) < 0; })) return { ok: false, message: 'IDは8文字です（例：AB2C-D3EF）。0・O・1・I・Lは使われていません' };
    if (pin.length !== 6) return { ok: false, message: 'PINは6けたの数字です' };
    var k = await txKeys(id, pin);
    var r = await txApi('/load', { id: id, auth: k.auth });
    if (!r.ok) return r;
    var obj;
    try { obj = await txOpen(id, pin, r.blob, k.aes); } catch (e) { return { ok: false, message: 'データを開けませんでした' }; }
    var imp = obj.d;
    apply(imp); // merge never decreases progress; current data is backed up first
    // keep using the same ID on this device so the next 発行 refreshes it
    lsSet(K_TXID, id); lsSet(K_TXPIN, pin);
    return { ok: true, imp: imp, at: r.updated_at };
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
        var target = $(imp ? 'in-id' : 'btn-issue');
        setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); } }, 350);
      });
    });
    $('btn-issue').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; window.__nkTxBusy = true;
      setMsg($('outmsg'), '発行中…');
      try {
        var r = await issueId();
        if (!r.ok) { setMsg($('outmsg'), r.message || '発行できませんでした', true); return; }
        $('id-val').textContent = fmtId(r.id); $('pin-val').textContent = r.pin;
        var exp = new Date(r.expires_at);
        $('id-exp').textContent = '有効期限：' + exp.toLocaleDateString('ja-JP') + 'まで（最後に発行してから90日）';
        $('idcard').hidden = false;
        setMsg($('outmsg'), (r.refreshed ? '同じIDのまま、今の記録に更新しました。' : '発行しました。') + 'IDとPINをメモかスクショしてください。');
      } catch (e) { setMsg($('outmsg'), '発行できませんでした：' + (e && e.message || e), true); }
      finally { btn.disabled = false; window.__nkTxBusy = false; }
    });
    $('btn-copyid').addEventListener('click', async function () {
      var t = '引き継ぎID：' + $('id-val').textContent + '\nPIN：' + $('pin-val').textContent + '\n' + location.origin + '/transfer/';
      try { await navigator.clipboard.writeText(t); setMsg($('outmsg'), 'コピーしました'); }
      catch (_) { setMsg($('outmsg'), 'コピーできませんでした。画面をスクショしてください', true); }
    });
    $('in-id').addEventListener('input', function () {
      var v = normId(this.value).slice(0, 8);
      this.value = v.length > 4 ? fmtId(v) : v;
    });
    $('in-pin').addEventListener('input', function () { this.value = normPin(this.value).slice(0, 6); });
    $('btn-restore').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; window.__nkTxBusy = true;
      setMsg($('inmsg'), '復元中…');
      try {
        var r = await restoreId($('in-id').value, $('in-pin').value);
        if (!r.ok) {
          setMsg($('inmsg'), r.message || '復元できませんでした', true);
          showResult(false, '<p class="tx-result-err">' + esc(r.message || '復元できませんでした') + '</p><p class="tx-result-note">記録は何も変わっていません。IDとPINを確かめてもう一度入力してください。</p>');
          return;
        }
        $('in-id').value = ''; $('in-pin').value = '';
        setMsg($('inmsg'), '復元しました。ゲームを開くと反映されています。');
        listHere();
        showResult(true, restoredHtml(r.imp));
      } catch (e) {
        var m = '復元できませんでした：' + (e && e.message || e);
        setMsg($('inmsg'), m, true);
        showResult(false, '<p class="tx-result-err">' + esc(m) + '</p><p class="tx-result-note">ブラウザの保存容量が足りないか、プライベートモードの可能性があります。</p>');
      } finally { btn.disabled = false; window.__nkTxBusy = false; }
    });
  }

  window.NikkukyuuTransfer = { issueId: issueId, restoreId: restoreId, TX_API: TX_API, GAMES: GAMES, collect: collect, group: group, merge: merge, encode: encode, decode: decode, apply: apply, BACKUP_KEY: BACKUP_KEY };
  if (document.getElementById('transfer-app')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage); else initPage();
  }
})();
