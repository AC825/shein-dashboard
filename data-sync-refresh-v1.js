/**
 * data-sync-refresh-v1.js — V220：同步完成后 UI 自动重渲染
 *
 * 问题：data-v3-v10.js 的 mergeToLocal 只写 localStorage，不调任何 UI 刷新函数。
 *      首屏渲染时 localStorage 是空的 → UI 全是 0/空；
 *      后台同步 5 秒后把数据写到 localStorage，但 UI 不会自动重渲染 → 用户看到「数据丢失」。
 *
 * 修复：data-v3-v10.js 在 syncFromSupabase 末尾派发 'ec-data-synced' 事件；
 *      本文件监听该事件，强制重渲染当前店铺页面（清 cb-cache + 重新 navigate）。
 *
 * 版本：V220
 */
(function () {
  'use strict';

  function waitForApp(cb) {
    if (typeof window.renderCrossBorderDetail === 'function' &&
        typeof window.navigate === 'function' &&
        window.CURRENT_USER !== undefined) {
      cb();
    } else {
      setTimeout(function () { waitForApp(cb); }, 200);
    }
  }

  // 记录最近一次进入的店铺 id（navigate hook 不一定暴露 sid，我们用 renderCrossBorderDetail 拦截来跟踪）
  function installCurrentShopTracker() {
    if (window.__v220_currentShopId !== undefined) return;
    window.__v220_currentShopId = null;
    var _orig = window.renderCrossBorderDetail;
    if (typeof _orig !== 'function') return;
    window.renderCrossBorderDetail = function (shopOrId) {
      try {
        var sid = (typeof shopOrId === 'object' && shopOrId) ? shopOrId.id : shopOrId;
        if (sid) window.__v220_currentShopId = sid;
      } catch (e) {}
      return _orig.apply(this, arguments);
    };
  }

  function reRenderCurrentShop() {
    // V223: 只清缓存，不触发渲染！
    //   原因：V213 fast-boot-sync-v1 的 refreshAfterSync 已经在 sync 完成时按 currentPage
    //        调了对应 render 函数（renderShopDetail / renderDashboard / ...），且 V223 已让
    //        refreshAfterSync 先清 cb-cache → 走真实渲染拿到新数据。
    //   如果 V220 也调 renderShopDetail(sid)，会与 V213 竞争：V213 用 currentPage（sync 完成
    //   那一刻的页面），V220 用 __v220_currentShopId（最后进入的店）——若同步期间切过店，两者
    //   渲染不同页面 → 页面在两个页面间反复写 → 「店铺列表来回乱跳」+ 订单数据错乱。
    //   所以 V220 退化为「只清缓存兜底」：V213 已用清过的 cache 真实渲染，V220 再清一次幂等无害。
    try {
      if (window._cbHtmlCache) window._cbHtmlCache = {};
      if (window._cbDataVersion) window._cbDataVersion = {};
      if (window._cbFpCache) window._cbFpCache = {};
    } catch (e) {}
    var sid = window.__v220_currentShopId;
    if (!sid) {
      console.log('[V220] ec-data-synced 触发，已清全部跨境缓存（V213 将按 currentPage 真实渲染）');
    } else {
      console.log('[V220] ec-data-synced 触发，已清全部跨境缓存（店铺 ' + sid + ' 由 V213 refreshAfterSync 负责渲染）');
    }
  }

  // 评价明细「显示全部」按钮：cb-cache 命中时按钮是动态注入的，onclick 绑定在 cb-cache-v2 的
  //  setTimeout 30ms 里被覆盖。V220 兼容：在重渲染后再补一次绑定。
  function rebindShowAllSku() {
    try {
      var btn = document.querySelector('[onclick*="showAllSku"], [onclick*="__v204_showAllSku"]');
      if (btn && typeof window.__v204_showAllSku === 'function') {
        // 按钮已存在 onclick，这里只需确保全局函数可用（V204 已暴露）
        console.log('[V220] 评价明细「显示全部」按钮已就绪');
      }
    } catch (e) {}
  }

  function onDataSynced(e) {
    console.log('[V220] 收到 ec-data-synced 事件:', (e && e.detail) || {});
    rebindShowAllSku();
    reRenderCurrentShop();
  }

  waitForApp(function () {
    installCurrentShopTracker();
    // 监听事件
    window.addEventListener('ec-data-synced', onDataSynced);
    window.__v220_loaded = true;
    console.log('[V220] 同步后 UI 重渲染已启用（监听 ec-data-synced 事件）');
  });
})();
