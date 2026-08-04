/* ==========================================================================
 * select-render-fix-v3.js  (V181)
 * 根治弹窗 select「大块灰色矩形、option 不可见」问题
 *
 * V173 (color-scheme:light + 白底) → 部分 Chrome 还不够
 * V178 (appearance:none + 自定义 SVG 箭头) → 完全错误！
 *   Chrome 对 appearance:none 的 select 会**当作 div 渲染**,撑满父容器
 *   → 用户截图里那个 200×300px 的大灰色矩形就是这个 div-like select
 *   → 且 popup 不再是 native select 下拉
 *
 * V181 终极方案:不强改 appearance,直接用 native select 样式 + 浅色主题
 *   - appearance: auto !important  → 让 Chrome 用 native menulist 渲染
 *   - color-scheme: light          → popup 用浅色(背景白、字黑、option 可见)
 *   - background-color: #fff !important; color: #1f2937 !important;
 *   - 兼容:date input 也用同样方案
 * ========================================================================== */
(function(){
  if (window.__selectRenderFixV3Loaded) return;
  window.__selectRenderFixV3Loaded = true;
  console.log('[V181 select-render-fix-v3] loaded — 根治 select 大灰块');

  // ===== 1. 注入 CSS:全局 select 用 native + 浅色 =====
  function injectStyle(){
    if (document.getElementById('v181-select-style')) return;
    var s = document.createElement('style');
    s.id = 'v181-select-style';
    s.textContent = ''
      // V181 关键:不用 appearance:none(会让 Chrome 把 select 当 div 渲染成大灰块)
      + 'select, [class*="modal"] select, .modal-overlay select, .modal select {'
      + '  -webkit-appearance: auto !important;'
      + '  -moz-appearance: auto !important;'
      + '  appearance: auto !important;'
      + '  color-scheme: light !important;'
      + '  background-color: #ffffff !important;'
      + '  color: #1f2937 !important;'
      + '  opacity: 1 !important;'
      + '  filter: none !important;'
      + '  backdrop-filter: none !important;'
      + '  border: 1px solid #d1d5db !important;'
      + '}'
      + 'select option, [class*="modal"] select option, .modal-overlay select option {'
      + '  background-color: #ffffff !important;'
      + '  color: #1f2937 !important;'
      + '}'
      // date input 同问题(Chrome 深色主题)→ 同样 native 浅色
      + 'input[type="date"], [class*="modal"] input[type="date"] {'
      + '  -webkit-appearance: auto !important;'
      + '  appearance: auto !important;'
      + '  color-scheme: light !important;'
      + '  background-color: #ffffff !important;'
      + '  color: #1f2937 !important;'
      + '  opacity: 1 !important;'
      + '}'
      // 弹窗内的 input/textarea 同样浅色
      + '[class*="modal"] input[type="text"], [class*="modal"] input[type="number"],'
      + '[class*="modal"] textarea {'
      + '  background-color: #ffffff !important;'
      + '  color: #1f2937 !important;'
      + '  color-scheme: light !important;'
      + '}'
      // 防止被父容器遮罩
      + '[class*="modal"] select, [class*="modal"] input, [class*="modal"] textarea {'
      + '  position: relative !important;'
      + '  z-index: 99999 !important;'
      + '}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ===== 2. JS 强制 inline style(覆盖一切 className 样式) =====
  function fixSelect(el){
    if (!el || el.tagName !== 'SELECT') return;
    try {
      // 关键:appearance 设为 auto,而非 none — Chrome 才会渲染 native select
      el.style.setProperty('-webkit-appearance', 'auto', 'important');
      el.style.setProperty('-moz-appearance', 'auto', 'important');
      el.style.setProperty('appearance', 'auto', 'important');
      el.style.setProperty('color-scheme', 'light', 'important');
      el.style.setProperty('background-color', '#ffffff', 'important');
      el.style.setProperty('color', '#1f2937', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('filter', 'none', 'important');
      el.style.setProperty('backdrop-filter', 'none', 'important');
      el.style.setProperty('position', 'relative', 'important');
      el.style.setProperty('z-index', '99999', 'important');
      // options
      for (var i = 0; i < el.options.length; i++) {
        var o = el.options[i];
        o.style.setProperty('background-color', '#ffffff', 'important');
        o.style.setProperty('color', '#1f2937', 'important');
      }
    } catch(e){}
  }

  function fixDate(el){
    if (!el || el.tagName !== 'INPUT' || el.type !== 'date') return;
    try {
      el.style.setProperty('-webkit-appearance', 'auto', 'important');
      el.style.setProperty('color-scheme', 'light', 'important');
      el.style.setProperty('background-color', '#ffffff', 'important');
      el.style.setProperty('color', '#1f2937', 'important');
      el.style.setProperty('opacity', '1', 'important');
    } catch(e){}
  }

  function fixIn(root){
    if (!root || root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === 'SELECT') fixSelect(root);
    else if (tag === 'INPUT' && root.type === 'date') fixDate(root);
    if (root.querySelectorAll) {
      var sels = root.querySelectorAll('select');
      for (var i = 0; i < sels.length; i++) fixSelect(sels[i]);
      var dates = root.querySelectorAll('input[type="date"]');
      for (var j = 0; j < dates.length; j++) fixDate(dates[j]);
    }
  }

  function fixAll(){
    var sels = document.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) fixSelect(sels[i]);
    var dates = document.querySelectorAll('input[type="date"]');
    for (var j = 0; j < dates.length; j++) fixDate(dates[j]);
  }

  // ===== 3. MutationObserver 自动 fix 新增 select =====
  var obs = null;
  function startObs(){
    if (obs) return;
    if (!document.body) { setTimeout(startObs, 200); return; }
    obs = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          fixIn(m.addedNodes[j]);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ===== 4. 初始化 =====
  injectStyle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      fixAll();
      startObs();
    });
  } else {
    fixAll();
    startObs();
  }
  setTimeout(fixAll, 100);
  setTimeout(fixAll, 500);
  setTimeout(fixAll, 1500);
  setTimeout(fixAll, 3000);
  document.addEventListener('click', function(){ setTimeout(fixAll, 50); }, true);
  document.addEventListener('focusin', function(e){
    if (e.target && (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type === 'date'))) {
      fixSelect(e.target);
      fixDate(e.target);
    }
  }, true);
})();
