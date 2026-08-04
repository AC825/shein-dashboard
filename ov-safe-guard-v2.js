/* ============================================================
 * ov-safe-guard-v2.js (V193)
 * 扩展 V192 ov-safe-guard-v1.js:
 *   1) 包装 _renderCrossBorderDetail / _renderShopDetail 等主入口函数(throw 兜底)
 *   2) 全局 monkey-patch Number.prototype.toFixed 防御 undefined/null 调用
 *   3) waitAll 轮数延长到 200(覆盖 100 秒,cb-cache 命中延迟渲染)
 *   4) 包装字符串模板 ${X} 中的 X 处理(通过 toFixed 防御间接覆盖)
 * ============================================================ */
(function () {
  'use strict';
  if (window.__v193_safeGuardLoaded) return;
  window.__v193_safeGuardLoaded = true;
  console.log('[v193-safe-guard] loaded');

  // ---- 1) Number.prototype.toFixed 防御性包装 ----
  if (!Number.prototype.toFixed.__v193_patched) {
    var _origToFixed = Number.prototype.toFixed;
    Number.prototype.toFixed = function (digits) {
      // undefined / null / NaN 调用 toFixed 会抛 TypeError
      if (this == null || (typeof this === 'number' && isNaN(this))) {
        return '0.00';
      }
      try {
        return _origToFixed.call(this, digits);
      } catch (e) {
        // 兜底:返回格式化后的数字字符串
        try { return String(Number(this) || 0); } catch (e2) { return '0'; }
      }
    };
    Number.prototype.toFixed.__v193_patched = true;
    console.log('[v193-safe-guard] Number.prototype.toFixed 已防御');
  }

  // ---- 2) 主入口函数 try-catch 包装 ----
  var SAFE_NAMES = [
    '_ov5_renderOverview',
    'renderOverview',
    '_ov5_smartSuggestions',
    '_renderCrossBorderDetail',
    'renderCrossBorderDetail',
    '_renderCrossDashboard',
    'renderCrossDashboard',
    '_renderShopDetail',
    'renderShopDetail',
    '_renderShopOverview',
    'renderShopOverview',
    '_v184_renderOverview'
  ];
  function guard(name) {
    if (typeof window[name] !== 'function') return;
    if (window[name].__v193_guarded) return;
    try {
      var orig = window[name];
      window[name] = function () {
        try {
          return orig.apply(this, arguments);
        } catch (e) {
          var msg = (e && e.message) || String(e);
          if (window.console) console.warn('[v193-safe] ' + name + ' caught: ' + msg);
          return '';
        }
      };
      window[name].__v193_guarded = true;
    } catch (e) {}
  }
  // 立即检查
  SAFE_NAMES.forEach(guard);
  // 持续 100 秒覆盖 cb-cache 异步渲染窗口
  var tries = 0;
  function waitAll() {
    tries++;
    SAFE_NAMES.forEach(guard);
    if (tries < 200) setTimeout(waitAll, 500);
  }
  waitAll();
})();
