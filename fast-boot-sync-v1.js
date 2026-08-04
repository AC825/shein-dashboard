/**
 * fast-boot-sync-v1.js — UI 立即响应 + 云端同步后台异步 (V213)
 *
 * 问题（用户 2026-07-31 截图反馈）：
 *   切到「店铺成本 / 运费分析」页面时，顶栏「总耗时 1分11秒 (cb_product_costs 9999条)」
 *   整个页面空白等 60+ 秒才能用。
 *
 * 根因（实测）：
 *   - 实际 cb_product_costs 只有 763 行（"9999" 是显示占位）
 *   - 真正拖垮首屏的是 cb_orders：65,234 行孤儿数据
 *   - _sbFetchAll 3 路并发分页拉完 65K = 235.5 秒
 *   - syncFromSupabase 用 Promise.allSettled 并行所有表，最长表（cb_orders）= 整体等待时间
 *   - 即使用户只看 cb_product_costs 页面，也会被 cb_orders 阻塞
 *
 * 用户期望「3-5 秒见数据」：
 *   - 实际上 3-5 秒命中的就是本地缓存（localStorage），不是 Supabase
 *   - 真正网络拉 65K 做不到 3-5 秒（物理限制）
 *   - 但用户感知的是「页面响应时间」，所以应该让 UI 立即用缓存渲染，云端同步放后台
 *
 * 本补丁策略（纯外部 monkey-patch，不改 minified 主代码）：
 *   1) 首次 syncFromSupabase 调用（来自 initMainApp）：
 *      - 立即返回 resolved promise（让 initMainApp 走完 .then 流程）
 *      - UI 用 localStorage 缓存立即渲染店铺列表/侧边栏
 *      - 5 秒后 setTimeout 异步跑真正的 syncFromSupabase
 *      - 跑完后只刷新需要刷新的部分（店铺导航 / 侧边栏 / 当前页）
 *   2) 后续 syncFromSupabase 调用（用户点刷新/导入后）→ 走原始同步，阻塞直到完成
 *   3) local-first-sync-v1.js 已经处理了写入队列和重试，本补丁只解决读取阻塞
 *
 * 加载顺序：必须在 cloud-sync-guard-v2.js 之后、data-v3-v10.js 之后（要等 syncFromSupabase 定义）
 *            实际在所有 defer 脚本之后即可，由 app-v30.html 控制顺序
 */
(function () {
  'use strict';
  if (window.__ec_fastBootLoaded) return;
  window.__ec_fastBootLoaded = true;
  console.log('[FastBoot V213] loaded — 初始同步改为 5s 后后台异步, UI 立即响应');

  function waitForApp(cb) {
    if (typeof window.syncFromSupabase === 'function' &&
        typeof window.renderShopNav === 'function' &&
        typeof window.updateSidebarFooter === 'function') {
      cb();
    } else {
      setTimeout(function () { waitForApp(cb); }, 150);
    }
  }

  waitForApp(function () {
    var _origSync = window.syncFromSupabase;
    var firstSyncHandled = false;   // 首次是否已经走完 deferred 流程
    var bgSyncInFlight = false;     // 后台同步是否正在跑
    var bgSyncDone = false;         // 本次会话是否已成功跑过 1 次后台同步

    // 检测本地缓存：决定是否需要立刻跑后台同步，还是可以再延后
    function hasLocalCache() {
      try {
        // 有店铺 OR 有 cb_product_costs OR 有任意店订单
        if (window.DB && typeof window.DB.getShops === 'function') {
          var shops = window.DB.getShops();
          if (shops && shops.length) return true;
        }
        if (localStorage.getItem('ec_cb_product_cost_global')) return true;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf('cb_orders_') === 0 || k.indexOf('cb_refunds_') === 0)) return true;
        }
      } catch (e) {}
      return false;
    }

    function refreshAfterSync() {
      // V222: sync 完成后清掉所有跨境缓存，确保下面 render 走真实渲染（不再命中 sync 前的旧缓存）
      try {
        if (window._cbHtmlCache) window._cbHtmlCache = {};
        if (window._cbDataVersion) window._cbDataVersion = {};
        if (window._cbFpCache) window._cbFpCache = {};
      } catch (e) {}
      try {
        if (typeof window.renderShopNav === 'function') window.renderShopNav();
        if (typeof window.updateSidebarFooter === 'function') window.updateSidebarFooter();
      } catch (e) { console.warn('[FastBoot] 刷新店铺导航失败:', e); }

      // 按当前页面刷新对应的渲染函数
      try {
        var page = window.currentPage;
        if (page === 'dashboard' && typeof window.renderDashboard === 'function') {
          window.renderDashboard();
        } else if (page === 'cost-cross' && typeof window.renderCostCross === 'function') {
          window.renderCostCross();
        } else if (page === 'cost-domestic' && typeof window.renderCostDomestic === 'function') {
          window.renderCostDomestic();
        } else if (page === 'shops' && typeof window.renderShops === 'function') {
          window.renderShops();
        } else if (page === 'shop-detail' && window.currentParam &&
                   typeof window.renderShopDetail === 'function') {
          window.renderShopDetail(window.currentParam);
        }
      } catch (e) { console.warn('[FastBoot] 刷新当前页失败:', e); }
    }

    function runBackgroundSync(reason) {
      if (bgSyncInFlight) {
        console.log('[FastBoot] 后台同步已在跑, 跳过本次触发(' + reason + ')');
        return;
      }
      bgSyncInFlight = true;
      console.log('[FastBoot] 启动后台云同步 (' + reason + ')...');
      var t0 = Date.now();

      // 顶栏小提示：让用户知道后台同步在跑
      try {
        var el = document.getElementById('sync-status');
        if (el) {
          el.textContent = '⏳ 后台同步中...';
          el.style.color = '#f59e0b';
        }
      } catch (e) {}

      _origSync.call(window, true).then(function (ok) {
        var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log('[FastBoot] 后台同步完成, 耗时 ' + elapsed + 's, ok=' + ok);
        bgSyncInFlight = false;
        bgSyncDone = true;
        if (ok) refreshAfterSync();
        try {
          if (typeof window.showToast === 'function') {
            window.showToast('✅ 数据已同步 (' + elapsed + 's)', 'success', 2500);
          }
        } catch (e) {}
        try {
          var el = document.getElementById('sync-status');
          if (el) {
            el.textContent = '✓ 数据已同步';
            el.style.color = '#10b981';
            setTimeout(function () { if (el) el.textContent = ''; }, 4000);
          }
        } catch (e) {}
      }).catch(function (e) {
        var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.warn('[FastBoot] 后台同步失败 (' + elapsed + 's):', e && e.message);
        bgSyncInFlight = false;
        try {
          if (typeof window.showToast === 'function') {
            window.showToast('⚠️ 后台同步失败: ' + (e && e.message || '未知错误'), 'warning', 3500);
          }
        } catch (e2) {}
        try {
          var el = document.getElementById('sync-status');
          if (el) { el.textContent = '⚠ 同步失败'; el.style.color = '#ef4444'; }
        } catch (e2) {}
      });
    }

    // 包裹 syncFromSupabase：首次调用立即返回，5s 后台跑
    window.syncFromSupabase = function (silent) {
      if (!firstSyncHandled) {
        firstSyncHandled = true;
        // 5s 后跑后台同步（等首屏渲染完成）
        setTimeout(function () { runBackgroundSync('首次同步'); }, 5000);
        console.log('[FastBoot] 首次 syncFromSupabase 已推迟 5s 后后台执行, UI 立即用本地缓存');
        // 立即返回 resolved, 让 initMainApp 走完 .then 渲染 UI
        return Promise.resolve(true);
      }
      // 第二次起：用户主动刷新 → 走原始同步（阻塞直到完成）
      return _origSync.call(this, silent);
    };

    // 暴露一个手动重跑后台同步的入口（给高级用户/调试用）
    window.__ec_forceBackgroundSync = function () { runBackgroundSync('手动触发'); };

    // 顶栏小提示：告知用户初始用的是缓存
    setTimeout(function () {
      try {
        if (typeof window.showToast === 'function' && hasLocalCache()) {
          window.showToast('⚡ 已用本地缓存快速启动, 5 秒后后台同步云端数据', 'info', 3500);
        }
      } catch (e) {}
    }, 800);

    console.log('[FastBoot V213] ✅ 包裹完成: 首次同步 5s 后后台执行, UI 立即用本地缓存');
  });
})();
