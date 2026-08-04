/**
 * 备份功能修复 v1
 * 根因：app-v3-v3.js 的 pushAllDataToCloud 使用 Cache.get('shein_xxx')，
 *      但实际业务数据（CBOrderDB 等）存储在 ec_xxx 前缀的 localStorage 中。
 *      导致备份显示店铺12家、数据0条。
 * 修复：覆写 pushAllDataToCloud，使用正确的数据源读取本地数据。
 */
(function() {
  'use strict';

  var origPushAllDataToCloud = typeof pushAllDataToCloud === 'function' ? pushAllDataToCloud : null;
  window._backupCancelled = false;
  window._backupRunning = false;

  window.cancelBackup = function() {
    if (!window._backupRunning) {
      showToast('当前没有正在进行的备份', 'info');
      return;
    }
    window._backupCancelled = true;
    showToast('已请求取消备份，正在停止...', 'warn');
  };

  async function fixedPushAllDataToCloud() {
    if (!SUPABASE_ENABLED) {
      showToast('⚠️ 云端未配置，无法备份', 'warn');
      return;
    }
    if (!confirm('确定要把【所有本地数据】备份到云端吗？\n\n包括：\n• 所有店铺\n• 所有订单/退货/差评/每日数据\n• 产品成本/运费配置\n\n备份后，在任何设备打开都能看到这些数据。')) return;

    window._backupCancelled = false;
    window._backupRunning = true;

    var statusEl = document.getElementById('sync-status');
    if (statusEl) { statusEl.textContent = '⏳ 正在备份...'; statusEl.style.color = '#fbbf24'; }

    var totalRecords = 0;
    var errors = [];

    try {
      // 1. 备份店铺
      if (statusEl) { statusEl.textContent = '⏳ 备份店铺...'; }
      if (window._backupCancelled) throw new Error('CANCELLED');
      var shops = [];
      if (typeof DB !== 'undefined' && DB.getShops) {
        shops = DB.getShops() || [];
      } else {
        shops = JSON.parse(localStorage.getItem('ec_shops') || '[]');
      }
      if (shops.length > 0) {
        try { await sbFetch('shops', 'POST', shops, { 'Prefer': 'resolution=merge-duplicates' }); }
        catch(e) { errors.push('店铺: ' + e.message); }
      }

      // 2. 备份产品成本（全局）
      if (statusEl) { statusEl.textContent = '⏳ 备份产品成本...'; }
      if (window._backupCancelled) throw new Error('CANCELLED');
      var costs = [];
      if (typeof CBProductCostDB !== 'undefined' && CBProductCostDB.getAll) {
        costs = CBProductCostDB.getAll() || [];
      } else {
        costs = JSON.parse(localStorage.getItem('ec_cb_product_cost_global') || '[]');
      }
      if (costs.length > 0) {
        try { await sbBatchUpsertProductCosts(costs); totalRecords += costs.length; }
        catch(e) { errors.push('产品成本: ' + e.message); }
      }

      // 3. 备份运费配置
      if (statusEl) { statusEl.textContent = '⏳ 备份运费配置...'; }
      if (window._backupCancelled) throw new Error('CANCELLED');
      var shippingRates = [];
      if (typeof CBShippingRateDB !== 'undefined' && CBShippingRateDB.getAll) {
        shippingRates = CBShippingRateDB.getAll() || [];
      } else {
        shippingRates = JSON.parse(localStorage.getItem('ec_shipping_rates') || '[]');
      }
      if (shippingRates.length > 0) {
        try { await sbBatchUpsert('cb_shipping_rates', shippingRates); totalRecords += shippingRates.length; }
        catch(e) { errors.push('运费: ' + e.message); }
      }

      // 4. 按店铺备份业务数据
      for (var i = 0; i < shops.length; i++) {
        if (window._backupCancelled) throw new Error('CANCELLED');
        var shop = shops[i];
        var shopId = shop.id;
        if (statusEl) { statusEl.textContent = '⏳ 备份 ' + (shop.name || shopId) + ' (' + (i+1) + '/' + shops.length + ')...'; }

        // 跨境订单
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var orders = [];
          if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) orders = CBOrderDB.getAll(shopId) || [];
          if (orders.length === 0) orders = JSON.parse(localStorage.getItem('ec_cb_orders_' + shopId) || '[]');
          if (orders.length > 0) {
            await sbBatchUpsertCBOrders(orders);
            totalRecords += orders.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('订单[' + shopId + ']: ' + e.message); }

        // 退货退款
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var refunds = [];
          if (typeof CBRefundDB !== 'undefined' && CBRefundDB.getAll) refunds = CBRefundDB.getAll(shopId) || [];
          if (refunds.length === 0) refunds = JSON.parse(localStorage.getItem('ec_cb_refunds_' + shopId) || '[]');
          if (refunds.length > 0) {
            await sbBatchUpsertCBRefunds(refunds);
            totalRecords += refunds.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('退货[' + shopId + ']: ' + e.message); }

        // 差评率
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var reviews = [];
          if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) reviews = CBReviewDB.getAll(shopId) || [];
          if (reviews.length === 0) reviews = JSON.parse(localStorage.getItem('ec_cb_reviews_' + shopId) || '[]');
          if (reviews.length > 0) {
            await sbBatchUpsertCBReviews(reviews);
            totalRecords += reviews.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('差评[' + shopId + ']: ' + e.message); }

        // 每日数据
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var daily = [];
          if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) daily = CrossBorderDailyDB.getAll(shopId) || [];
          if (daily.length === 0) daily = JSON.parse(localStorage.getItem('ec_cb_daily_' + shopId) || '[]');
          if (daily.length > 0) {
            await sbBatchUpsertCBDaily(daily);
            totalRecords += daily.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('每日数据[' + shopId + ']: ' + e.message); }

        // SKU 差评明细
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var skuReviews = [];
          if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) skuReviews = CBSkuReviewDB.getAll(shopId) || [];
          if (skuReviews.length === 0) skuReviews = JSON.parse(localStorage.getItem('ec_cb_sku_reviews_' + shopId) || '[]');
          if (skuReviews.length > 0) {
            await sbBatchUpsertCBSkuReviews(skuReviews);
            totalRecords += skuReviews.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('SKU差评[' + shopId + ']: ' + e.message); }

        // 商品列表
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var products = [];
          if (typeof ShopProductDB !== 'undefined' && ShopProductDB.getAll) products = ShopProductDB.getAll(shopId) || [];
          if (products.length === 0) products = JSON.parse(localStorage.getItem('ec_products_' + shopId) || '[]');
          if (products.length > 0) {
            await sbBatchUpsert('shop_products', products.map(function(r) { return {...r, shop_id: shopId}; }));
            totalRecords += products.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('商品[' + shopId + ']: ' + e.message); }

        // 国内统计数据
        try {
          if (window._backupCancelled) throw new Error('CANCELLED');
          var domestic = JSON.parse(localStorage.getItem('ec_domestic_stats_' + shopId) || '[]');
          if (domestic.length > 0) {
            await sbBatchUpsertDomesticStats(domestic);
            totalRecords += domestic.length;
          }
        } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('国内统计[' + shopId + ']: ' + e.message); }
      }

      // 5. 国内销售数据
      if (window._backupCancelled) throw new Error('CANCELLED');
      try {
        var sales = [];
        if (typeof DB !== 'undefined' && DB.getSalesData) sales = DB.getSalesData() || [];
        if (sales.length === 0) sales = JSON.parse(localStorage.getItem('ec_sales') || '[]');
        if (sales.length > 0) {
          await _pushSales(sales);
          totalRecords += sales.length;
        }
      } catch(e) { if (e.message === 'CANCELLED') throw e; errors.push('销售: ' + e.message); }

      if (statusEl) { statusEl.textContent = '✅ 备份完成'; statusEl.style.color = '#10b981'; }

      var msg = '✅ 全部数据已备份到云端！（店铺' + shops.length + '家，数据' + totalRecords + '条）';
      if (errors.length > 0) {
        msg += ' 部分失败：' + errors.length + ' 项';
        console.warn('[backup] errors:', errors);
      }
      showToast(msg, errors.length > 0 ? 'warn' : 'success');

      setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 5000);
    } catch(e) {
      if (e.message === 'CANCELLED') {
        if (statusEl) { statusEl.textContent = '⏹ 备份已取消'; statusEl.style.color = '#f59e0b'; }
        showToast('⏹ 备份已取消（已备份 ' + totalRecords + ' 条）', 'warn');
        setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 5000);
      } else {
        console.error('[backup] 失败:', e);
        if (statusEl) { statusEl.textContent = '❌ 备份失败: ' + e.message; statusEl.style.color = '#ef4444'; }
        showToast('❌ 备份失败: ' + e.message, 'error');
      }
    } finally {
      window._backupRunning = false;
      window._backupCancelled = false;
    }
  }

  // 安装覆写
  function install() {
    if (typeof pushAllDataToCloud === 'function') {
      window.pushAllDataToCloud = fixedPushAllDataToCloud;
      console.log('[FixBackup] pushAllDataToCloud overridden ✓');
    } else {
      setTimeout(install, 200);
    }
  }
  install();
})();
