/**
 * cloud-first-import-v5.js
 * 修复：1) 使用 sbFetch 替代未定义的 _sbFrom；2) 价格取"商品预计收入"；3) 商品名称清洗为基础货号
 * v5: 卖家SKU 作为主 SKU（货号备用）；商品名称 = 货号 + 颜色（去掉码数和符号）
 */
(function () {
  'use strict';

  function waitForApp(callback) {
    if (typeof window.CBOrderDB !== 'undefined' && typeof window.Cache !== 'undefined') {
      callback();
    } else {
      setTimeout(function () { waitForApp(callback); }, 200);
    }
  }

  waitForApp(function () {

    // ========== 辅助：把本地数据推到云端 ==========
    async function pushOrdersToCloud(shopId, orders) {
      if (!SUPABASE_ENABLED) return false;
      try {
        if (typeof sbBatchUpsertCBOrders === 'function') {
          const result = await sbBatchUpsertCBOrders(orders);
          console.log('[CloudFirst] 订单批量推送:', result);
          return result.fail === 0;
        }
        // fallback：直接 sbFetch 批量 upsert
        await sbFetch('cb_orders', 'POST', orders, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        return true;
      } catch (e) {
        console.error('推订单异常', e);
        return false;
      }
    }

    async function pushRefundsToCloud(shopId, refunds) {
      if (!SUPABASE_ENABLED) return false;
      try {
        await sbFetch('cb_refunds', 'POST', refunds, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        return true;
      } catch (e) { console.error('推退货异常', e); return false; }
    }

    async function pushDailyToCloud(shopId, daily) {
      if (!SUPABASE_ENABLED) return false;
      try {
        await sbFetch('cb_daily', 'POST', daily, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        return true;
      } catch (e) { console.error('推每日数据异常', e); return false; }
    }

    async function pushReviewsToCloud(shopId, reviews) {
      if (!SUPABASE_ENABLED) return false;
      try {
        await sbFetch('cb_reviews', 'POST', reviews, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        return true;
      } catch (e) { console.error('推差评异常', e); return false; }
    }

    // 清洗商品名称：去掉尺码、颜色、连字符、括号等，只保留基础货号
    function cleanProductName(name) {
      if (!name) return '';
      return String(name)
        .replace(/\s+/g, ' ')
        .replace(/[\-\/\\_，,;；|]+/g, ' ')
        .replace(/\([^)]*\)/g, '')
        .replace(/[（][^）]*[）]/g, '')
        .replace(/\b(S|M|L|XL|XXL|XS|XXS|XXXL|One Size|Free Size)\b/gi, '')
        .replace(/\b(Black|White|Red|Blue|Green|Yellow|Pink|Gray|Grey|Purple|Orange|Brown|Beige|Navy|Army|Camo|Print|Floral)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    }

    // 包裹原始函数
    const _origImportCBOrders = window.importCBOrders;
    const _origImportCBRefunds = window.importCBRefunds;
    const _origImportCBDailies = window.importCBDailies;
    const _origImportCBReviews = window.importCBReviews;

    // ---------- 订单导入（含SHEIN格式智能识别）----------
    if (typeof _origImportCBOrders === 'function') {
      window.importCBOrders = async function (shopId) {
        var textEl = document.getElementById('cb-order-import-text-' + shopId);
        var prevEl = document.getElementById('cb-order-import-preview-' + shopId);
        if (textEl) {
          var raw = textEl.value;
          // 检测 SHEIN 导出格式（含合并标题行"订单基础信息"）
          // 仅做提示，不再重写文本——原始 importCBOrders 的 detectImportFormat
          // + parseCSVLineProper 已能正确处理合并单元格假表头与商品名内逗号，
          // 避免旧版 split(/[\t,]+/) 因引号逗号导致整列错位（V143 修复）
          if (/订单类型.*订单号.*商品名称.*货号.*卖家SKU/.test(raw) || /订单基础信息/.test(raw)) {
            if (prevEl) prevEl.innerHTML = '<span style="color:#1890ff">🔍 检测到SHEIN格式，使用内置解析器自动识别列...</span>';
            if (typeof showToast === 'function') showToast('🔍 检测到SHEIN格式，自动识别列并导入', 'info');
          }
        }
        await _origImportCBOrders(shopId);
      };
      console.log('[CloudFirst] importCBOrders 已包裹 v4（SHEIN转换 + 云端标准化）');
    }

    // ---------- 退货退款导入 ----------
    if (typeof _origImportCBRefunds === 'function') {
      window.importCBRefunds = async function (shopId) {
        await _origImportCBRefunds(shopId);
        const localKey = 'cb_refunds_' + shopId;
        const localData = Cache.get(localKey) || [];
        if (!localData.length) return;
        showToast('☁️ 正在同步到云端...', 'info');
        const ok = await pushRefundsToCloud(shopId, localData);
        if (ok) {
          showToast('✅ 已同步到云端！', 'success');
        } else {
          console.warn('[CloudFirst] 退货云端同步失败，已保留本地数据');
        }
      };
    }

    // ---------- 每日数据导入 ----------
    if (typeof _origImportCBDailies === 'function') {
      window.importCBDailies = async function (shopId) {
        await _origImportCBDailies(shopId);
        const localKey = 'cb_daily_' + shopId;
        const localData = Cache.get(localKey) || [];
        if (!localData.length) return;
        showToast('☁️ 正在同步到云端...', 'info');
        const ok = await pushDailyToCloud(shopId, localData);
        if (ok) {
          showToast('✅ 已同步到云端！', 'success');
        } else {
          console.warn('[CloudFirst] 每日数据云端同步失败，已保留本地数据');
        }
      };
    }

    // ---------- 差评率导入 ----------
    if (typeof _origImportCBReviews === 'function') {
      window.importCBReviews = async function (shopId) {
        await _origImportCBReviews(shopId);
        const localKey = 'cb_reviews_' + shopId;
        const localData = Cache.get(localKey) || [];
        if (!localData.length) return;
        showToast('☁️ 正在同步到云端...', 'info');
        const ok = await pushReviewsToCloud(shopId, localData);
        if (ok) {
          showToast('✅ 已同步到云端！', 'success');
        } else {
          console.warn('[CloudFirst] 差评云端同步失败，已保留本地数据');
        }
      };
    }

    // ========== 顶栏状态灯 ==========
    setTimeout(function () {
      var statusEl = document.getElementById('cloud-sync-status');
      if (!statusEl) return;
      if (!SUPABASE_ENABLED) {
        statusEl.innerHTML = '⚠️ 未连云端';
        statusEl.style.color = '#f59e0b';
        statusEl.title = '数据仅存在浏览器，清缓存会丢！';
        return;
      }
      sbFetch('shops?select=id&limit=1', 'GET').then(function (res) {
        if (res && res.length >= 0) {
          statusEl.innerHTML = '✅ 云端正常';
          statusEl.style.color = '#10b981';
          statusEl.title = '云端连接正常';
        } else {
          statusEl.innerHTML = '❌ 云端断开';
          statusEl.style.color = '#ef4444';
          statusEl.title = '无法连接云端，上传会失败！';
        }
      }).catch(function (e) {
        statusEl.innerHTML = '❌ 云端断开';
        statusEl.style.color = '#ef4444';
        statusEl.title = '无法连接云端，上传会失败！';
      });
    }, 2000);

    console.log('[CloudFirst] 全部导入函数已包裹 v4，使用 sbFetch 推送');
  });
})();
