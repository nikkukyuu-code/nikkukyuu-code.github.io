/* nk-i18n: runtime UI translation (display only; never changes saved data/keys). */
(function () {
  'use strict';
  var LS_KEY = 'nkUiLang';
  var LANGS0 = [
    ['ja', '日本語'], ['en', 'English'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['ko', '한국어'],
    ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
    ['ru', 'Русский'], ['id', 'Bahasa Indonesia'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['tr', 'Türkçe'],
    ['ar', 'العربية'], ['hi', 'हिन्दी']
  ];
  var SHORT = { ja: '日本語', en: 'EN', 'zh-Hans': '简中', 'zh-Hant': '繁中', ko: '한국어', es: 'ES', pt: 'PT', fr: 'FR', de: 'DE', it: 'IT', ru: 'RU', id: 'ID', th: 'ไทย', vi: 'VI', tr: 'TR', ar: 'عربي', hi: 'हिन्दी' };
  var LANGS = LANGS0;
  var CODES = LANGS0.map(function (l) { return l[0]; });
  var cfg = window.NK_I18N_CFG || {};
  var base = cfg.base || '';
  var ver = cfg.v || '';
  try { var cs0 = document.currentScript; var mv = cs0 && /[?&]v=([^&]+)/.exec(cs0.src); if (mv) ver = mv[1]; } catch (e) {}
  function norm(c) {
    c = String(c || '').toLowerCase();
    if (!c) return '';
    if (c.indexOf('zh') === 0) return (/hant|tw|hk|mo/.test(c)) ? 'zh-Hant' : 'zh-Hans';
    if (c.indexOf('in') === 0) return 'id';
    var p = c.split('-')[0];
    return CODES.indexOf(p) >= 0 ? p : '';
  }
  function detect() {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) { var n = norm(list[i]); if (n) return n; }
    return 'en';
  }
  var lang = '';
  try { lang = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
  if (CODES.indexOf(lang) < 0) lang = detect();
  if (cfg.langs && cfg.langs.indexOf(lang) < 0) lang = cfg.langs.indexOf('en') >= 0 && lang !== 'ja' ? 'en' : cfg.langs[0];
  if (cfg.langs) LANGS = LANGS.filter(function (l) { return cfg.langs.indexOf(l[0]) >= 0; });
  var NK = window.NKI18N = { miss: new Set(), lang: lang, langs: LANGS, dicts: {}, key: LS_KEY };
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('data-nk-lang', lang);
  // Load dictionary synchronously during parsing (en is the fallback for incomplete languages).
  if (lang !== 'ja') {
    var need = lang === 'en' ? ['en'] : ['en', lang];
    for (var i = 0; i < need.length; i++) {
      document.write('<script src="' + base + 'i18n/' + need[i] + '.js?v=' + ver + '"><\/script>');
    }
  }
  NK.add = function (code, dict) { NK.dicts[code] = dict; };

  var JP = /[\u3040-\u30fa\u30fc-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
  var cache = new Map(), compiled = null;
  function build() {
    var pats = [], frags = [];
    var srcs = [NK.dicts.en || {}, NK.dicts[lang] || {}];
    var keys = Object.keys(srcs[0]);
    Object.keys(srcs[1]).forEach(function (k) { if (!(k in srcs[0])) keys.push(k); });
    keys.forEach(function (k) {
      if (/\{\d+\}/.test(k)) {
        var parts = k.split(/\{(\d+)\}/), re = '^', idx = [];
        for (var i = 0; i < parts.length; i++) {
          if (i % 2) { re += '([\\s\\S]*?)'; idx.push(+parts[i]); } else re += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        var lit = k.replace(/\{\d+\}/g, '');
        if (lit.length >= 1) pats.push({ re: new RegExp(re + '$'), idx: idx, k: k, n: lit.length });
      } else if (k.length >= 2 && JP.test(k)) frags.push(k);
    });
    pats.sort(function (a, b) { return b.n - a.n; });
    frags.sort(function (a, b) { return b.length - a.length; });
    var fre = null;
    if (frags.length) fre = new RegExp(frags.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
    compiled = { pats: pats, fre: fre };
  }
  function look(k) {
    var d = NK.dicts[lang]; if (d && d[k] != null && d[k] !== '') return d[k] === '\u200b' ? '' : d[k];
    d = NK.dicts.en; if (d && d[k] != null && d[k] !== '') return d[k] === '\u200b' ? '' : d[k];
    return null;
  }
  function core2(s) {
    if (!compiled) build();
    var P = compiled.pats;
    for (var i = 0; i < P.length; i++) {
      var m = P[i].re.exec(s);
      if (m) { var out = look(P[i].k); if (out == null) continue;
        return out.replace(/\{(\d+)\}/g, function (_, n) { var j = P[i].idx.indexOf(+n); if (j < 0) return ''; var g = m[j + 1]; var lv = look(g); return lv != null ? lv : g; }); }
    }
    return s;
  }
  function core(s) {
    var v = look(s); if (v != null) return v;
    if (!compiled) build();
    var P = compiled.pats;
    for (var i = 0; i < P.length; i++) {
      var m = P[i].re.exec(s);
      if (m) {
        var out = look(P[i].k);
        if (out == null) continue;
        var ok = true;
        out = out.replace(/\{(\d+)\}/g, function (_, n) {
          var j = P[i].idx.indexOf(+n); if (j < 0) return '';
          var g = m[j + 1]; if (!JP.test(g)) return g;
          if (/[・　、。：]/.test(g)) { ok = false; return g; }
          return tr(g);
        });
        if (ok) return out;
      }
    }
    // Some strings carry a (number/emoji/symbol) prefix or suffix: translate the core.
    var mm = /^([^\u3040-\u30ff\u3400-\u9fffA-Za-z]*)([\s\S]*?)([^\u3040-\u30ff\u3400-\u9fffA-Za-z]*)$/.exec(s);
    if (mm && (mm[1] || mm[3]) && mm[2] && mm[2] !== s) {
      var c = look(mm[2]); if (c != null) return mm[1] + c + mm[3];
    }
    // Truncated by the game ("…"): use the full sentence it came from.
    if (/[…]$/.test(s) && s.length > 4) {
      var pre = s.slice(0, -1), full = compiled.pre || (compiled.pre = Object.keys(NK.dicts.en || {}));
      for (var q = 0; q < full.length; q++) if (full[q].length > pre.length && full[q].indexOf(pre) === 0) { var fv = look(full[q]); if (fv != null) return fv; }
    }
    // Split on separators and translate each piece.
    var parts = s.split(/(【|】|・|　|：|: |\s\/\s|（|）|\(|\)|「|」|、|。|！|？)/);
    if (parts.length > 1) {
      var allOk = true;
      for (var pi = 0; pi < parts.length; pi += 2) {
        var seg = parts[pi]; if (!seg || !JP.test(seg)) continue;
        var st = seg.trim(), tv = look(st);
        if (tv == null) { var sub = core2(st); if (sub !== st && !JP.test(sub)) tv = sub; }
        if (tv == null) { allOk = false; } else parts[pi] = seg.replace(st, tv);
      }
      var SEP = { '【': '[', '】': ']', '・': ' · ', '　': ' ', '：': ': ', '（': ' (', '）': ')', '「': '"', '」': '"', '、': ', ', '。': '. ', '！': '! ', '？': '? ' };
      if (lang === 'zh-Hans' || lang === 'zh-Hant') SEP = {};
      for (var pj = 1; pj < parts.length; pj += 2) if (SEP[parts[pj]] != null) parts[pj] = SEP[parts[pj]];
      var joined = parts.join('').replace(/ {2,}/g, ' ').replace(/\( /g, '(').trim();
      if (allOk) return joined;
      s = joined;
    }
    if (compiled.fre) {
      var r = s.replace(compiled.fre, function (f) { var t = look(f); return t == null ? f : ' ' + t + ' '; });
      return r.replace(/ {2,}/g, ' ').replace(/^ | $/g, '').replace(/ ([、。,.!?！？）)」』:：])/g, '$1').replace(/([（(「『]) /g, '$1');
    }
    return s;
  }
  function tr(s) {
    if (lang === 'ja' || s == null) return s;
    s = String(s);
    if (!JP.test(s)) return s;
    var c = cache.get(s); if (c !== undefined) return c;
    var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
    var body = s.slice(lead.length, s.length - trail.length);
    var lines = body.split('\n');
    var out = lead + lines.map(function (ln) { if (!JP.test(ln)) return ln; var a = /^\s*/.exec(ln)[0], b = /\s*$/.exec(ln)[0]; return a + core(ln.slice(a.length, ln.length - b.length)) + b; }).join('\n') + trail;
    if (JP.test(out)) NK.miss.add(s);
    if (cache.size > 5000) cache.clear();
    cache.set(s, out);
    return out;
  }
  NK.t = tr;

  // ---- DOM ----
  var ORIG = '__nkOrig', LAST = '__nkLast';
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-text'];
  var SKIPSEL = '[data-nk-noi18n],script,style,noscript,textarea' + (cfg.skip ? ',' + cfg.skip : '');
  function skip(el) { return el && el.closest && el.closest(SKIPSEL); }
  function doText(n) {
    var cur = n.nodeValue;
    if (n[LAST] !== cur) n[ORIG] = cur;
    if (n[ORIG] == null) return;
    var want = lang === 'ja' ? n[ORIG] : tr(n[ORIG]);
    if (want !== n[ORIG] && SPACED) want = spaceOut(n, want);
    if (want !== cur) { n.nodeValue = want; qfit(n.parentNode); }
    n[LAST] = want;
  }
  var SPACED = !/^(ja|zh-Hans|zh-Hant|th)$/.test(lang);
  function nbText(n, dir) {
    var x = n;
    for (var k = 0; k < 3 && x; k++) {
      var sib = dir < 0 ? x.previousSibling : x.nextSibling;
      if (sib) { var t = sib.textContent || ''; return t; }
      x = x.parentNode; if (!x || x.nodeType !== 1 || !/^(B|STRONG|EM|I|A|SPAN|SMALL|U|MARK|CODE)$/.test(x.tagName)) return '';
    }
    return '';
  }
  function spaceOut(n, w) {
    var a = nbText(n, -1), b = nbText(n, 1);
    if (a && /[A-Za-z0-9.,:;!?)\]"%]$/.test(a) && /^[A-Za-z0-9("#]/.test(w)) w = ' ' + w;
    if (b && /[A-Za-z0-9.,:;!?)\]"%]$/.test(w) && /^[A-Za-z0-9("#]/.test(b)) w = w + ' ';
    return w;
  }
  function doAttrs(el) {
    var store = el.__nkA || (el.__nkA = {});
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a), st = store[a] || (store[a] = {});
      if (st.last !== cur) st.orig = cur;
      var want = lang === 'ja' ? st.orig : tr(st.orig);
      if (want !== cur) el.setAttribute(a, want);
      st.last = want;
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      var s2 = store.value || (store.value = {});
      if (s2.last !== el.value) s2.orig = el.value;
      var w2 = lang === 'ja' ? s2.orig : tr(s2.orig);
      if (w2 !== el.value) el.value = w2;
      s2.last = w2;
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skip(root.parentNode)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skip(root)) return; doAttrs(root); }
    var tw = document.createTreeWalker(root, 5, null), n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) { if (n.closest(SKIPSEL)) continue; doAttrs(n); }
      else if (!skip(n.parentNode)) doText(n);
    }
  }
  var titleOrig = null, titleLast = null;
  function doTitle() {
    var cur = document.title;
    if (cur !== titleLast) titleOrig = cur;
    var want = lang === 'ja' ? titleOrig : tr(titleOrig);
    if (want !== cur) document.title = want;
    titleLast = want;
  }
  var mo = null, busy = false;
  function startObserver() {
    if (mo || !window.MutationObserver) return;
    mo = new MutationObserver(function (list) {
      if (busy) return;
      busy = true;
      try {
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.type === 'characterData') { if (!skip(m.target.parentNode)) doText(m.target); }
          else if (m.type === 'attributes') { if (m.attributeName === 'class' || m.attributeName === 'hidden') schedFull(); else if (!skip(m.target)) doAttrs(m.target); }
          else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
        doTitle();
      } finally { busy = false; }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(lang === 'ja' ? ['value'] : ['value', 'class', 'hidden']) });
  }
  // ---- shrink-to-fit for longer translations ----
  var fitQ = new Set(), fitT = 0;
  function qfit(el) { if (lang === 'ja' || !el || el.nodeType !== 1) return; fitQ.add(el); if (!fitT) fitT = requestAnimationFrame(runFit); }
  function runFit() {
    fitT = 0; var arr = Array.from(fitQ); fitQ.clear();
    arr.forEach(function (el) {
      fitOne(el);
      var pe = el.parentElement;
      if (pe && /^(BUTTON|A|LABEL)$/.test(pe.tagName)) fitOne(pe);
    });
  }
  function fitOne(e) {
    if (!e.isConnected || e.closest('[data-nk-noi18n]')) return;
    var cs = getComputedStyle(e); if (cs.display === 'inline' || cs.display === 'none') return;
    var cw = e.clientWidth, sw = e.scrollWidth, ch = e.clientHeight, sh = e.scrollHeight;
    var fixedH = cs.overflowY !== 'visible' || /^(BUTTON|A|LABEL)$/.test(e.tagName);
    var r = 1;
    if (cw > 0 && sw > cw + 1) r = Math.min(r, cw / sw);
    if (fixedH && ch > 0 && sh > ch + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') r = Math.min(r, Math.sqrt(ch / sh));
    var rect = e.getBoundingClientRect();
    var par = e.parentElement;
    if (par && rect.width > 0) {
      var pcs = getComputedStyle(par);
      if (pcs.overflowX !== 'visible' || par.tagName === 'BUTTON') {
        var pr = par.getBoundingClientRect(), pw = par.clientWidth;
        if (pw > 0 && (rect.left < pr.left - 1 || rect.right > pr.right + 1)) r = Math.min(r, pw / rect.width);
      }
    }
    if (rect.width > 0 && rect.right > window.innerWidth + 1 && rect.left >= 0) r = Math.min(r, (window.innerWidth - rect.left - 2) / rect.width);
    if (r < 0.995) {
      var base = parseFloat(e.getAttribute('data-nk-fs')) || parseFloat(cs.fontSize);
      if (!e.hasAttribute('data-nk-fs')) e.setAttribute('data-nk-fs', base);
      var cur = parseFloat(cs.fontSize), nf = Math.max(base * 0.55, cur * r * 0.98);
      if (nf < cur - 0.1) { e.style.fontSize = nf.toFixed(2) + 'px'; if (cs.letterSpacing !== 'normal') e.style.letterSpacing = '0'; }
    }
  }
  var fullT = 0, fullLast = 0;
  function schedFull() { if (fullT) return; var d = Math.max(60, 400 - (Date.now() - fullLast)); fullT = setTimeout(function () { fullT = 0; fullLast = Date.now(); NK.fit(); }, d); }
  NK.fit = function (sel) { document.querySelectorAll(sel || 'body *').forEach(function (e) { if (e.childNodes.length && !e.children.length) qfit(e); }); };
  // ---- canvas ----
  try {
    var CP = CanvasRenderingContext2D.prototype;
    var oFill = CP.fillText, oStroke = CP.strokeText, oMeasure = CP.measureText;
    function fit(ctx, s, t, mw) {
      if (t === s) return mw;
      var w0 = oMeasure.call(ctx, s).width, w1 = oMeasure.call(ctx, t).width;
      var lim = Math.max(w0 * 1.2, w0 + 8);
      if (w1 > lim) mw = (mw === undefined) ? lim : Math.min(mw, lim);
      return mw;
    }
    CP.fillText = function (s, x, y, mw) {
      if (lang === 'ja' || typeof s !== 'string' || !JP.test(s)) return arguments.length > 3 ? oFill.call(this, s, x, y, mw) : oFill.call(this, s, x, y);
      var t = tr(s); var m2 = fit(this, s, t, mw);
      return m2 === undefined ? oFill.call(this, t, x, y) : oFill.call(this, t, x, y, m2);
    };
    CP.strokeText = function (s, x, y, mw) {
      if (lang === 'ja' || typeof s !== 'string' || !JP.test(s)) return arguments.length > 3 ? oStroke.call(this, s, x, y, mw) : oStroke.call(this, s, x, y);
      var t = tr(s); var m2 = fit(this, s, t, mw);
      return m2 === undefined ? oStroke.call(this, t, x, y) : oStroke.call(this, t, x, y, m2);
    };
  } catch (e) {}
  // ---- dialogs ----
  ['alert', 'confirm', 'prompt'].forEach(function (f) {
    var o = window[f]; if (!o) return;
    window[f] = function (msg, def) { return arguments.length > 1 ? o.call(window, tr(msg), def) : o.call(window, tr(msg)); };
  });

  // ---- picker ----
  function nameOf(c) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === c) return LANGS[i][1]; return c; }
  function setLang(c) {
    if (CODES.indexOf(c) < 0 || c === lang) return;
    try { localStorage.setItem(LS_KEY, c); } catch (e) {}
    if (cfg.onBeforeReload) try { cfg.onBeforeReload(); } catch (e) {}
    location.reload();
  }
  NK.setLang = setLang;
  function css() {
    if (document.getElementById('nk-i18n-css')) return;
    var st = document.createElement('style'); st.id = 'nk-i18n-css';
    st.textContent =
      '.nk-lang-wrap{position:relative;display:inline-flex;vertical-align:middle;margin-right:.4em;z-index:30;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;letter-spacing:0;text-transform:none}' +
      '.nk-lang-btn{display:inline-flex;align-items:center;gap:.25em;font-size:13px;font-weight:900;line-height:1.1;padding:4px 9px;border-radius:999px;border:2px solid #fff;color:#1b1300;background:linear-gradient(180deg,#ffe95c,#ffb300);box-shadow:0 0 10px rgba(255,214,0,.9),0 2px 4px rgba(0,0,0,.45);cursor:pointer;white-space:nowrap;text-shadow:none;-webkit-text-fill-color:#1b1300;font-style:normal;animation:nkLangGlow 1.4s ease-in-out infinite alternate;pointer-events:auto;max-width:42vw;overflow:hidden;text-overflow:ellipsis}' +
      '.nk-lang-btn .nk-g{font-size:15px}.nk-lang-btn .nk-s{display:none}' +
      '@media (max-width:599px){.nk-lang-btn{font-size:12px;padding:3px 7px}.nk-lang-btn .nk-n{display:none}.nk-lang-btn .nk-s{display:inline}}' +
      (cfg.css || '') +
      '@keyframes nkLangGlow{from{box-shadow:0 0 5px rgba(255,214,0,.6),0 2px 4px rgba(0,0,0,.45)}to{box-shadow:0 0 16px rgba(255,230,60,1),0 2px 4px rgba(0,0,0,.45)}}' +
      '.nk-lang-list{position:fixed;z-index:2147483000;max-height:70vh;overflow:auto;background:#fff;color:#111;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.55);padding:6px;min-width:180px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Thai","Noto Sans Arabic","Noto Sans Devanagari",sans-serif}' +
      '.nk-lang-list button{display:block;width:100%;text-align:left;border:0;background:none;font-size:15px;padding:8px 12px;border-radius:8px;color:#111;cursor:pointer;font-weight:700;text-transform:none;letter-spacing:0}' +
      '.nk-lang-list button[aria-current=true]{background:#ffe95c}' +
      '.nk-lang-list button:hover{background:#f1f1f1}';
    (document.head || document.documentElement).appendChild(st);
  }
  function makePicker() {
    var wrap = document.createElement('span');
    wrap.className = 'nk-lang-wrap'; wrap.setAttribute('data-nk-noi18n', '');
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'nk-lang-btn'; b.setAttribute('aria-haspopup', 'listbox');
    b.setAttribute('aria-label', 'Language / 言語');
    b.innerHTML = '<span class="nk-g">🌐</span><span class="nk-n"></span><span class="nk-s"></span>';
    b.querySelector('.nk-n').textContent = nameOf(lang);
    b.querySelector('.nk-s').textContent = SHORT[lang] || lang;
    var list = null;
    function close() { if (list) { list.remove(); list = null; } }
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (list) { close(); return; }
      list = document.createElement('div'); list.className = 'nk-lang-list'; list.setAttribute('role', 'listbox'); list.setAttribute('data-nk-noi18n', '');
      LANGS.forEach(function (l) {
        var it = document.createElement('button'); it.type = 'button'; it.textContent = l[1]; it.lang = l[0];
        if (l[0] === 'ar') it.dir = 'rtl';
        if (l[0] === lang) it.setAttribute('aria-current', 'true');
        it.addEventListener('click', function (e) { e.stopPropagation(); close(); setLang(l[0]); });
        list.appendChild(it);
      });
      document.body.appendChild(list);
      var r = b.getBoundingClientRect(), lw = list.offsetWidth, lh = list.offsetHeight;
      var left = Math.min(Math.max(6, r.left), window.innerWidth - lw - 6);
      var top = r.bottom + 6; if (top + lh > window.innerHeight - 6) top = Math.max(6, window.innerHeight - lh - 6);
      list.style.left = left + 'px'; list.style.top = top + 'px';
    });
    document.addEventListener('click', close, true);
    wrap.appendChild(b);
    return wrap;
  }
  // Adding the button must not push the title onto an extra line: shrink the title a little if needed.
  function keepLines(host, h0, pk) {
    if (!h0) return;
    var run = function () {
      host.style.fontSize = '';
      var base = parseFloat(getComputedStyle(host).fontSize), f = base, n = 0;
      var lim = Math.max(h0 * 1.25, pk.getBoundingClientRect().height + 8);
      while (host.getBoundingClientRect().height > lim && f > base * 0.6 && n++ < 12) { f *= 0.94; host.style.fontSize = f + 'px'; }
    };
    run();
    if (lang !== 'ja') setTimeout(run, 50);
  }
  NK.mount = function (anchor, where) {
    css();
    var el = typeof anchor === 'string' ? document.querySelector(anchor) : anchor;
    if (!el) return null;
    var p = makePicker();
    var host = where === 'prepend' ? el : el.parentNode;
    var h0 = host.getBoundingClientRect().height;
    if (where === 'prepend') el.insertBefore(p, el.firstChild);
    else el.parentNode.insertBefore(p, el);
    keepLines(host, h0, p);
    return p;
  };
  function init() {
    if (cfg.anchors) cfg.anchors.forEach(function (a) { NK.mount(a[0], a[1]); });
    if (lang !== 'ja') { walk(document.body); doTitle(); NK.fit(); window.addEventListener('resize', function () { NK.fit(); }); }
    startObserver();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
