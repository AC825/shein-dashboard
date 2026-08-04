/* ============================================================
 * cb-image-404-fix-v1.js  (V183)
 * 优化评价列表等含大量图片的页面:
 *   1. 拦截 <img>.src 写入:已失败过的 URL 直接换占位图(不重复 404 拉网络)
 *   2. 全局 error 事件:img 加载失败 → 记录 + 替换为 SVG 占位图
 *   3. 所有 img 自动加 loading="lazy" decoding="async"(避免一次性解码全部)
 *   4. MutationObserver 自动应用到 DOM 变化后新增的 img
 *
 * 性能预期:
 *   - 1320 条评价若 80% 图片 404:减少 1000+ 次无效 HTTP 请求
 *   - 主线程不再被 broken-image 解析阻塞,Vue 长任务警告消失
 *   - 首次进入页面:从 1373ms+ 降至 200-300ms(只渲染可视区图片)
 * ============================================================ */
(function(){
  if (window.__cbImg404FixV1) return;
  window.__cbImg404FixV1 = true;
  console.log('[V183] cb-image-404-fix-v1 已加载');

  // SVG 占位图(深色背景 + 灰色"无图"文字,不增加 HTTP 请求)
  var PLACEHOLDER_SMALL = 'data:image/svg+xml;utf8,' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
    '<rect width="44" height="44" fill="%231e293b"/>' +
    '<text x="22" y="26" text-anchor="middle" fill="%23475569" font-size="11" font-family="Arial">无图</text></svg>';
  var PLACEHOLDER_TINY = 'data:image/svg+xml;utf8,' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">' +
    '<rect width="30" height="30" fill="%231e293b"/>' +
    '<text x="15" y="18" text-anchor="middle" fill="%23475569" font-size="9" font-family="Arial">无图</text></svg>';

  // 1) sessionStorage 缓存失败 URL(跨页面/跨刷新复用,避免每次重新 404)
  var KEY = 'ec_img_404_v1';
  var failedSet = {};
  try {
    failedSet = JSON.parse(sessionStorage.getItem(KEY) || '{}');
  } catch(e) { failedSet = {}; }

  function markFailed(url) {
    if (!url) return;
    failedSet[url] = 1;
    try {
      // 控制大小:只保留最近 500 条
      var keys = Object.keys(failedSet);
      if (keys.length > 500) {
        var newFailed = {};
        keys.slice(-500).forEach(function(k){ newFailed[k] = 1; });
        failedSet = newFailed;
      }
      sessionStorage.setItem(KEY, JSON.stringify(failedSet));
    } catch(e){}
  }

  function isFailed(url) {
    return url && failedSet[url];
  }

  function getPlaceholder(img) {
    // 根据尺寸选占位图
    var w = parseInt(img.getAttribute('width') || img.style.width || '44', 10);
    return (w && w <= 30) ? PLACEHOLDER_TINY : PLACEHOLDER_SMALL;
  }

  // 2) 拦截 img.src 写入:已失败过的 URL 直接换占位图
  var origSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (origSrcDesc && origSrcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: origSrcDesc.enumerable,
      get: origSrcDesc.get,
      set: function(v) {
        if (v && isFailed(v)) {
          // 已失败过 → 直接置占位,不再发网络请求
          origSrcDesc.set.call(this, getPlaceholder(this));
        } else {
          origSrcDesc.set.call(this, v);
        }
      }
    });
  }

  // 3) 全局 error 事件捕获:img 加载失败时记录 + 替换
  document.addEventListener('error', function(e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.src && !t.__ecHandled404) {
      t.__ecHandled404 = true;
      markFailed(t.src);
      // 替换为占位图(避免显示破损图标 + 防止后续再次触发)
      origSrcDesc.set.call(t, getPlaceholder(t));
      t.style.background = '#1e293b';
      t.style.border = '1px solid #334155';
    }
  }, true);

  // 4) 优化单张 img:加 loading=lazy + decoding=async + 标记已处理
  function fixImg(img) {
    if (!img || img.tagName !== 'IMG' || img.__ecImgFixed) return;
    img.__ecImgFixed = true;
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
    if (!img.hasAttribute('referrerpolicy')) img.setAttribute('referrerpolicy', 'no-referrer');
  }

  // 5) MutationObserver 自动应用到新 img + src 变化
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      if (m.type === 'childList') {
        m.addedNodes.forEach(function(n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') fixImg(n);
          if (n.querySelectorAll) {
            var imgs = n.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) fixImg(imgs[i]);
          }
        });
      } else if (m.type === 'attributes' && m.target.tagName === 'IMG') {
        if (m.attributeName === 'src') {
          // src 被改了 → 解除 404 标记(可能换了好图),重新观察
          m.target.__ecHandled404 = false;
          fixImg(m.target);
        }
      }
    });
  });

  function start() {
    obs.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
    // 处理已存在的 img
    var existing = document.querySelectorAll('img');
    for (var i = 0; i < existing.length; i++) fixImg(existing[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();