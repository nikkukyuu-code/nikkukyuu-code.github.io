"""Inject / update the shared page auto-update snippet (nk-autoupdate)."""
import re, sys, json, pathlib
TPL = r'''<!--nk-autoupdate--><script>
/* 自動更新: 新しい版が公開されたら、安全なとき（タイトル画面など・試合中でない）だけ自動で読み込み直す。記録(localStorage)には触れない。 */
(function () {
  var PAGE_LABEL = '__LABEL__';
  var URL = '__URL__', KEY = 'nkReloadFor:__KEY__', EVERY = __EVERY__;
  function safe() { try { return !!(__SAFE__); } catch (e) { return false; } }
  var busy = false;
  function check() {
    if (busy || document.visibilityState === 'hidden' || !safe()) return;
    busy = true;
    fetch(URL + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      busy = false;
      var v = d && d.label;
      if (!v || v === PAGE_LABEL || !safe()) return;
      try { if (sessionStorage.getItem(KEY) === v) return; sessionStorage.setItem(KEY, v); } catch (e) { return; }
      var q = location.search.replace(/^\?/, '').split('&').filter(function (s) { return s && s.indexOf('r=') !== 0; }); q.push('r=' + String(v).replace(/[^0-9]/g, '')); location.replace(location.pathname + '?' + q.join('&') + location.hash);
    }).catch(function () { busy = false; });
  }
  window.__nkCheckUpdate = check;
  function start() { setTimeout(check, 1500); if (EVERY > 0) setInterval(check, EVERY * 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
})();
</script><!--/nk-autoupdate-->'''
BLOCK = re.compile(r'<!--nk-autoupdate-->.*?<!--/nk-autoupdate-->', re.S)
def inject(path, label, url, key, safe='true', every=60):
    p = pathlib.Path(path); t = p.read_text()
    s = TPL.replace('__LABEL__', label).replace('__URL__', url).replace('__KEY__', key).replace('__EVERY__', str(every)).replace('__SAFE__', safe)
    if BLOCK.search(t): t = BLOCK.sub(lambda m: s, t)
    else:
        m = re.search(r'<meta charset="UTF-8"\s*/?>\n', t, re.I)
        assert m, path
        t = t[:m.end()] + s + '\n' + t[m.end():]
    p.write_text(t)
def set_label(path, label):
    p = pathlib.Path(path); t = p.read_text()
    t2 = re.sub(r"(<!--nk-autoupdate-->.*?var PAGE_LABEL = ')[^']*(')", lambda m: m.group(1) + label + m.group(2), t, flags=re.S)
    p.write_text(t2)
def write_json(path, label, ms):
    pathlib.Path(path).write_text(json.dumps({'label': label, 'build': ms}, ensure_ascii=False) + '\n')
