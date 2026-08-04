/**
 * cb-cache-v2.js — 跨境店铺详情页 HTML 缓存加速 (V190 修复)
 * 原理：renderCrossBorderDetail 每次重生成 91KB HTML 模板（含 4 个全表渲染），
 *       实际数据未变时直接返回缓存的 innerHTML。
 *
 * V190 修复（关键）：
 *   1) cb-cache 命中后**仍触发 setTimeout 0 跑四个 init 函数**：
 *      initOrderPager / renderRefundTable / renderDailyTable / renderReviewTable
 *      原代码模式：`t.innerHTML=renderCrossBorderDetail(n),setTimeout(()=>{...init functions...})`
 *      cb-cache 命中时整个 setTimeout 链被跳过 → 表格 div 全空（用户截图空白）！
 *   2) fingerprint 缓存：cbFpCache[shopId]，write 后清。每次切店省掉 5 张表遍历。
 *   3) cb-cache 命中时**额外**调用 _ov5_refreshOverview 刷新总览。
 *
 * 触发清缓存：CBOrderDB.add/update/remove/batchAdd、CBRefundDB.*、CBReviewDB.*、
 *            CrossBorderDailyDB.add/update/remove/batchAdd、CBSkuReviewDB.* 写入后。
 * 版本：V190（基于 V170）
 */
(function () {
  'use strict';

  function waitForApp(cb) {
    if (typeof window.renderCrossBorderDetail === 'function' &&
        typeof window.CBOrderDB !== 'undefined' &&
        typeof window.Cache !== 'undefined') {
      cb();
    } else {
      setTimeout(function () { waitForApp(cb); }, 200);
    }
  }

  waitForApp(function () {

    // 1) 缓存容器
    window._cbHtmlCache = {};        // shopId -> html string
    window._cbDataVersion = {};      // shopId -> "{ordersN|refundsN|reviewsN|dailyN|skusN}"
    window._cbFpCache = {};          // V190: shopId -> cached fp (write 后清)
    window._cbCacheStats = { hits: 0, miss: 0, clears: 0 };

    // V190: cb-cache 命中后跑的初始化函数（与原 minified 代码对齐）
    function _v190_runInitOnCacheHit(shopId) {
      try {
        if (typeof window.initOrderPager === 'function') {
          window.initOrderPager(shopId);
        }
        if (typeof window.renderRefundTable === 'function') {
          window.renderRefundTable(shopId);
        }
        if (typeof window.renderDailyTable === 'function') {
          window.renderDailyTable(shopId);
        }
        if (typeof window.renderReviewTable === 'function') {
          window.renderReviewTable(shopId);
        }
        // V190: 总览 tab 的 ov5 刷新（如果当前在 overview tab 且函数存在）
        if (window['_cbTab_' + shopId] === 'overview' &&
            typeof window._ov5_refreshOverview === 'function') {
          window._ov5_refreshOverview(shopId);
        }
      } catch (e) {
        console.warn('[V190] init after cache hit failed:', e);
      }
    }

    // 2) 包裹 renderCrossBorderDetail
    const _orig = window.renderCrossBorderDetail;

    window.renderCrossBorderDetail = function (shopOrId) {
      var shopId = (typeof shopOrId === 'object' && shopOrId) ? shopOrId.id : shopOrId;
      if (!shopId) return _orig.apply(this, arguments);

      // V190: fp 缓存（write 已清掉 cbFpCache，所以这里安全）
      var fp = window._cbFpCache[shopId];
      if (!fp) {
        try {
          var orders = window.CBOrderDB.getAll(shopId) || [];
          var refunds = window.CBRefundDB.getAll(shopId) || [];
          var reviews = window.CBReviewDB.getAll(shopId) || [];
          var daily = (window.CrossBorderDailyDB && window.CrossBorderDailyDB.getAll) ? window.CrossBorderDailyDB.getAll(shopId) || [] : [];
          var skus = (window.CBSkuReviewDB && window.CBSkuReviewDB.getAll) ? window.CBSkuReviewDB.getAll(shopId) || [] : [];

          fp = orders.length + ':' + orders.reduce(function (s, x) { return s + (x.sale_amount || 0); }, 0).toFixed(2) +
               '|' + refunds.length + ':' + refunds.reduce(function (s, x) { return s + (x.refund_amount || 0); }, 0).toFixed(2) +
               '|' + reviews.length + ':' + reviews.reduce(function (s, x) { return s + (x.negative_rate || 0); }, 0).toFixed(2) +
               '|' + daily.length + ':' + daily.reduce(function (s, x) { return s + (x.amount || 0); }, 0).toFixed(2) +
               '|' + skus.length;
          window._cbFpCache[shopId] = fp;
        } catch (e) {
          return _orig.apply(this, arguments);
        }
      }

      // 命中缓存：直接复用上次生成的 HTML
      // V191 修复: 不写 page.innerHTML — 调用方会负责写入 domestic-detail-area.innerHTML
      //   之前的 page.innerHTML = cachedHTML 把整个 page-shop-detail（包括 header-row / tasks tab 容器）
      //   都替换为 cachedHTML，破坏页面结构。
      if (window._cbHtmlCache[shopId] && window._cbDataVersion[shopId] === fp) {
        window._cbCacheStats.hits++;
        // V194: 同步立即 inject V182 3 按钮 (不等 setTimeout 30ms)
        //   原因: cb-cache 命中是同步的, 调用方拿到 HTML 后同步写入 domestic-detail-area.innerHTML
        //         setTimeout 30ms 太慢, 用户切店立即看到 3 按钮缺失
        //   修法: scanShops 内部自带 MutationObserver 重试(下一帧) + 多次重试
        var _v194_injectNow = function() {
          try { if (window.scanShopsForV182) window.scanShopsForV182(); } catch(e){}
        };
        _v194_injectNow();
        requestAnimationFrame(function() {
          _v194_injectNow();
          // 再保险: 50ms / 200ms 多次重试
          setTimeout(_v194_injectNow, 50);
          setTimeout(_v194_injectNow, 200);
          setTimeout(_v194_injectNow, 600);
        });
        // V191 兼容: 触发 V182 tabs + 任务 tab 重新注入(因为 caller 写入的 cachedHTML 不含它们)
        setTimeout(function () {
          try {
            if (window.scanShopsForV182) window.scanShopsForV182();
            if (typeof window._v184_restoreV182TabContent === 'function') window._v184_restoreV182TabContent();
            // shop-tasks-v1.js 暴露的 injectTaskContent
            if (typeof window._v191_injectTaskTab === 'function') window._v191_injectTaskTab(shopId);
            // V210: cb-cache 命中时也注入 3 个分析按钮 (掉量/好评差评/提升), 防止 _v191_injectTaskTab 完成后 3 按钮被新 render 冲掉
            if (typeof window.__v193_injectShopTabs === 'function') window.__v193_injectShopTabs(shopId);
          } catch(e) { console.warn('[V191] post-cache restore err:', e); }
        }, 30);
        // V190 关键修复: 跑 setTimeout 0 初始化（与原代码保持一致）
        setTimeout(function () { _v190_runInitOnCacheHit(shopId); }, 0);
        return window._cbHtmlCache[shopId];
      }

      // 首次 / 数据变了 → 走原始重渲染
      window._cbCacheStats.miss++;
      var html = _orig.apply(this, arguments);

      // 缓存返回的 HTML（一般 < 100KB，内存占用可接受）
      if (html && html.length > 1000) {
        window._cbHtmlCache[shopId] = html;
        window._cbDataVersion[shopId] = fp;
      }
      return html;
    };

    // 3) 在写方法后清缓存
    function clearCacheFor(shopId) {
      if (!shopId) return;
      delete window._cbHtmlCache[shopId];
      delete window._cbDataVersion[shopId];
      delete window._cbFpCache[shopId];  // V190: fp 也清掉
      window._cbCacheStats.clears++;
    }

    function patchWriteAPI(dao, names) {
      if (!dao) return;
      names.forEach(function (name) {
        var orig = dao[name];
        if (typeof orig !== 'function') return;
        dao[name] = function () {
          var res = orig.apply(this, arguments);
          // 推断 shopId：通常第一个参数是 shopId
          var sid = arguments[0];
          if (typeof sid === 'object' && sid) sid = sid.id;
          clearCacheFor(sid);
          return res;
        };
      });
    }

    patchWriteAPI(window.CBOrderDB, ['add', 'update', 'remove', 'batchAdd']);
    patchWriteAPI(window.CBRefundDB, ['add', 'update', 'remove', 'batchAdd']);
    patchWriteAPI(window.CBReviewDB, ['upsert', 'remove', 'batchUpsert']);
    if (window.CrossBorderDailyDB) {
      patchWriteAPI(window.CrossBorderDailyDB, ['add', 'update', 'remove', 'batchAdd']);
    }
    if (window.CBSkuReviewDB) {
      patchWriteAPI(window.CBSkuReviewDB, ['add', 'update', 'remove', 'batchAdd']);
    }

    // 4) 调试入口
    window._cbCacheDebug = function () {
      var keys = Object.keys(window._cbHtmlCache);
      var totalSize = keys.reduce(function (s, k) { return s + (window._cbHtmlCache[k] || '').length; }, 0);
      return {
        cachedShops: keys,
        stats: window._cbCacheStats,
        totalCachedKB: (totalSize / 1024).toFixed(1),
        fpCachedShops: Object.keys(window._cbFpCache)
      };
    };

    console.log('[CBCache-V190] ✅ 跨境店铺 HTML 缓存已启用 (含 setTimeout 0 初始化兜底)');
  });
})();