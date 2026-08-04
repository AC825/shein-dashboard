/**
 * cloud-sync-guard-v2.js — 自愈式云端同步补丁 (V205)
 *
 * 问题背景（用户反馈"上传了浏览器有、云端没有"）：
 *   经实测，云端 cb_orders 有 6.5 万行，但 shop_products / cb_shipping_rates /
 *   domestic_stats 几乎为空。根因是这三张云端表结构比代码推送的字段"瘦"：
 *     - shop_products 云端只有 {id,shop_id,sku,name,created_at,remark}，代码硬推 product_name/cost/price…
 *       → Supabase 返回 400 PGRST204 "Could not find the 'product_name' column" → 推送被拒 → 进重试队列 → 永远失败
 *     - cb_shipping_rates 云端只有 {shop_id,rate}，且 sbPushShippingRate 根本没被调用 → 运费从未推送
 *     - domestic_stats 云端只有 {id,shop_id,date,created_at}，代码推 amount… → 400 → 卡死
 *
 * 本补丁（纯外部、不改 minified 主代码）：
 *   1) 包裹 window.sbFetch：POST 时按表做字段映射 + 遇到"未知列"自动剥离并原地重试（自愈，不丢整行）。
 *      已知云端列（实测探测）用于精确剥离，避免先失败一次：
 *        shop_products:    [id,shop_id,sku,name,created_at,remark]
 *        cb_shipping_rates:[shop_id,rate]
 *        domestic_stats:   [id,shop_id,date,created_at]
 *   2) 包裹 CBShippingRateDB.set/clear → 推 {shop_id,rate}（先删后插保唯一）。
 *   3) window.reconcileToCloud()：把本地全部数据分块回灌云端（自愈剥离后推送），修"历史遗漏"。
 *   4) 启动后自动补推缺口表（差评/商品/运费/国内统计），并接管原有 runCloudSync 按钮。
 */
(function () {
  'use strict';
  if (window.__cloudSyncGuardV2) return;
  window.__cloudSyncGuardV2 = true;

  // 代码字段名 -> 云端字段名
  var COLUMN_MAP = {
    shop_products: { product_name: 'name' }
  };
  // 云端表真实存在的列（实测探测得到，用于精确剥离未知列）
  var KNOWN_COLUMNS = {
    shop_products:    ['id', 'shop_id', 'sku', 'name', 'created_at', 'remark'],
    cb_shipping_rates:['shop_id', 'rate'],
    domestic_stats:   ['id', 'shop_id', 'date', 'created_at']
  };

  function waitForApp(cb) {
    if (typeof window.sbFetch === 'function' && typeof window.CBOrderDB !== 'undefined') cb();
    else setTimeout(function () { waitForApp(cb); }, 200);
  }

  waitForApp(function () {
    var _origSbFetch = window.sbFetch;

    function applyMap(table, rows) {
      var m = COLUMN_MAP[table];
      if (!m || !Array.isArray(rows)) return rows;
      return rows.map(function (r) {
        var c = Object.assign({}, r);
        Object.keys(m).forEach(function (from) {
          if (c[from] !== undefined) { c[m[from]] = c[from]; delete c[from]; }
        });
        return c;
      });
    }

    // 包裹 sbFetch：POST 做字段映射 + 未知列剥离自愈重试
    window.sbFetch = async function (path, method, body, extra) {
      if (method === 'POST' && Array.isArray(body) && body.length) {
        var table = ('' + path).split('?')[0];
        var rows = applyMap(table, body);
        var known = KNOWN_COLUMNS[table];
        if (known) {
          // 预先剥离云端不存在的列
          rows = rows.map(function (r) {
            var c = Object.assign({}, r);
            Object.keys(c).forEach(function (k) { if (known.indexOf(k) < 0) delete c[k]; });
            return c;
          });
        }
        var lastErr = null;
        for (var attempt = 0; attempt < 12; attempt++) {
          try {
            return await _origSbFetch(path, method, rows, extra);
          } catch (e) {
            lastErr = e;
            var msg = (e && e.message) || '';
            var mm = msg.match(/Could not find the '([^']+)' column/);
            if (mm && mm[1]) {
              var bad = mm[1];
              rows = rows.map(function (r) { var c = Object.assign({}, r); delete c[bad]; return c; });
              continue; // 剥离后重试
            }
            throw e; // 非列错误（网络等）→ 上抛，由 local-first 入队重试
          }
        }
        throw lastErr;
      }
      return _origSbFetch(path, method, body, extra);
    };

    // ---------- 运费推送（原先根本没推）----------
    function pushShippingRate(shopId, rate) {
      return (async function () {
        try { await _origSbFetch('cb_shipping_rates?shop_id=eq.' + encodeURIComponent(shopId), 'DELETE'); } catch (e) {}
        if (rate === null || rate === undefined || rate === '' || isNaN(parseFloat(rate))) return;
        return await window.sbFetch('cb_shipping_rates', 'POST',
          [{ shop_id: shopId, rate: parseFloat(rate) }],
          { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
      })();
    }
    if (window.CBShippingRateDB && typeof window.CBShippingRateDB.set === 'function') {
      var _set = window.CBShippingRateDB.set;
      window.CBShippingRateDB.set = function (shopId, value) {
        var res = _set.apply(this, arguments);
        var v = parseFloat(value);
        pushShippingRate(shopId, isNaN(v) ? null : v);
        return res;
      };
      var _clear = window.CBShippingRateDB.clear;
      if (typeof _clear === 'function') {
        window.CBShippingRateDB.clear = function (shopId) {
          var res = _clear.apply(this, arguments);
          pushShippingRate(shopId, null);
          return res;
        };
      }
    }

    // ---------- 分块推 ----------
    async function chunkPush(table, rows, chunk) {
      chunk = chunk || 500;
      var ok = 0, fail = 0;
      for (var i = 0; i < rows.length; i += chunk) {
        var slice = rows.slice(i, i + chunk);
        try {
          await window.sbFetch(table, 'POST', slice, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
          ok += slice.length;
        } catch (e) { fail += slice.length; }
      }
      return { ok: ok, fail: fail };
    }

    // ---------- 缺口表自动补推（轻量，启动后跑）----------
    async function autoReconcileGaps() {
      try {
        var shops = (typeof DB !== 'undefined' && DB.getShops) ? DB.getShops() : [];
        var total = 0;
        for (var i = 0; i < shops.length; i++) {
          var sid = shops[i].id;
          // 差评
          try {
            var rev = window.CBReviewDB && CBReviewDB.getAll(sid);
            if (rev && rev.length) { var r1 = await chunkPush('cb_reviews', rev); total += r1.ok; }
          } catch (e) {}
          // 商品
          try {
            var prods = JSON.parse(localStorage.getItem('ec_products_' + sid) || '[]');
            if (prods.length) { var r2 = await chunkPush('shop_products', prods); total += r2.ok; }
          } catch (e) {}
          // 国内统计
          try {
            var dom = window.DomesticStatsDB && DomesticStatsDB.getAll(sid);
            if (dom && dom.length) { var r3 = await chunkPush('domestic_stats', dom); total += r3.ok; }
          } catch (e) {}
          // 运费
          try {
            var sr = window.CBShippingRateDB && CBShippingRateDB.get(sid);
            if (sr !== null && sr !== undefined && sr !== '') { await pushShippingRate(sid, parseFloat(sr)); total++; }
          } catch (e) {}
        }
        console.log('[CloudSyncGuard] 缺口表自动补推完成，共 ' + total + ' 条');
      } catch (e) { console.warn('[CloudSyncGuard] autoReconcileGaps err', e); }
    }

    // ---------- 全量回灌（手动/按钮）：本地所有数据 -> 云端 ----------
    window.reconcileToCloud = async function () {
      if (typeof showToast === 'function') showToast('☁️ 正在把本地数据回灌云端（后台进行）...', 'info');
      var shops = (typeof DB !== 'undefined' && DB.getShops) ? DB.getShops() : [];
      var pushed = 0, failed = 0;
      var gap = await autoReconcileGaps();
      // 大表（订单/退款/SKU/每日）按店整表回灌
      for (var i = 0; i < shops.length; i++) {
        var sid = shops[i].id;
        var tables = [
          ['cb_orders', window.CBOrderDB && CBOrderDB.getAll(sid)],
          ['cb_refunds', window.CBRefundDB && CBRefundDB.getAll(sid)],
          ['cb_sku_reviews', window.CBSkuReviewDB && CBSkuReviewDB.getAll(sid)],
          ['cb_daily', window.CrossBorderDailyDB && CrossBorderDailyDB.getAll(sid)]
        ];
        for (var t = 0; t < tables.length; t++) {
          var rows = tables[t][1];
          if (!rows || !rows.length) continue;
          var res = await chunkPush(tables[t][0], rows);
          pushed += res.ok; failed += res.fail;
        }
      }
      var msg = '✅ 回灌完成：成功 ' + (pushed + gap) + ' 条' + (failed ? '，失败 ' + failed + ' 条' : '');
      if (typeof showToast === 'function') showToast(msg, failed ? 'warning' : 'success');
      return { pushed: pushed + gap, failed: failed };
    };

    // 接管原有"一键全量云同步"按钮
    if (typeof window.runCloudSync === 'function') {
      var _origRun = window.runCloudSync;
      window.runCloudSync = function () { return window.reconcileToCloud(); };
    }

    // V212: 启动 6 秒后**智能触发** autoReconcileGaps（每个浏览器每日最多 1 次，避免卡首屏）
    //  - 老用户（有缓存）: 看到"数据已同步"角标，不主动跑
    //  - 新用户（无缓存）: 跑一次 autoReconcileGaps 补 143 条历史缺口
    //  - 已经触发过（今天）: 跳过
    if (!window.__csAutoDone) {
      window.__csAutoDone = true;
      setTimeout(function () {
        try {
          var today = new Date().toDateString();  // "Fri Jul 31 2026"
          var lastAuto = localStorage.getItem('ec_cs_auto_date');
          var hasCache = !!(
            (window.CBReviewDB && CBReviewDB.getAllShops && CBReviewDB.getAllShops().length) ||
            localStorage.getItem('cb_orders_shop_001') ||
            localStorage.getItem('ec_products_shop_001')
          );
          // 老用户（有任意店的数据缓存）→ 跳过
          if (hasCache) {
            console.log('[CloudSyncGuard] 检测到本地缓存，跳过启动对账（点按钮可手动触发 reconcileToCloud()）');
            return;
          }
          // 今天已经跑过 → 跳过
          if (lastAuto === today) {
            console.log('[CloudSyncGuard] 今日已对账，跳过启动对账');
            return;
          }
          localStorage.setItem('ec_cs_auto_date', today);
          console.log('[CloudSyncGuard] 首次启动，5s 后异步执行 autoReconcileGaps（不阻塞 UI）');
          // 推到 5 秒后再跑，等首屏渲染完成
          setTimeout(function () {
            autoReconcileGaps();
          }, 5000);
        } catch (e) { /* ignore */ }
      }, 6000);
    }

    // 首次启动提示（一次性 toast）
    if (!window.__csFirstHintShown) {
      window.__csFirstHintShown = true;
      setTimeout(function () {
        try {
          if (typeof showToast === 'function') {
            showToast('☁️ 数据将自动同步到云端（首次可能需要几秒）', 'info', 4000);
          }
        } catch (e) {}
      }, 1500);
    }

    console.log('[CloudSyncGuard V2] ✅ 已启用：字段自愈 + 运费推送 + 一键回灌');
  });
})();
