/**
 * cb-orders-shard-v1.js — V230 跨境订单 **内存模式**（替代 V224 按月分片）
 *
 * V224-V229 分片方案失败原因（用户 2026-08-01 截图：002 店只显示 598/17628 条）：
 *   - 按月分片 + 按周拆分虽然能绕过 localStorage 5MB 单 key 限制，但代码复杂
 *   - 实际部署中大量订单数据丢失（002 店 17030 条消失）
 *   - V229 修复 5min skip 也没真正恢复数据
 *
 * V230 方案（用户要求"换回以前的调用方式"）：
 *   - 完全抛弃 localStorage 存订单数据
 *   - 数据放 window.__EC_CB_ORDERS = { shopId: [rows] } 内存 Map
 *   - 51,296 条订单 × 500B ≈ 26MB，浏览器内存完全够
 *   - CBOrderDB.getAll / add / update / remove / save / batchAdd 全部读写内存
 *   - localStorage 只做"上次同步时间戳"（5min skip + V228 强制全量仍保留）
 *   - 启动时清掉所有旧的 ec_cb_orders_ 分片 key（避免残留污染）
 *
 * 加载顺序：必须在 data-v3-v10.js 之后（因为要等 CBOrderDB 定义在 app-v2.js 里加载完）
 */
(function () {
  'use strict';
  if (window.__ec_memoryLoaded) return;
  window.__ec_memoryLoaded = true;
  console.log('%c[MemoryV230] loaded — 跨境订单内存模式（彻底抛弃分片，无 5MB 限制）', 'background:#16a34a;color:#fff;padding:3px 8px;border-radius:3px;font-weight:bold;');

  // 初始化内存 Map
  if (!window.__EC_CB_ORDERS || typeof window.__EC_CB_ORDERS !== 'object') {
    window.__EC_CB_ORDERS = {};
  }

  function waitForCBOrderDB(cb) {
    if (typeof window.CBOrderDB === 'object' && typeof window.CBOrderDB.getAll === 'function') {
      cb();
    } else {
      setTimeout(function () { waitForCBOrderDB(cb); }, 100);
    }
  }

  // 读某 sid 的全部订单（直接从内存读）
  function _readAll(sid) {
    const arr = window.__EC_CB_ORDERS[sid];
    return Array.isArray(arr) ? arr : [];
  }

  // 写入：直接覆盖内存（不再分片、不再受配额限制）
  function _writeSharded(sid, list) {
    if (!Array.isArray(list)) list = [];
    window.__EC_CB_ORDERS[sid] = list;
  }

  // 提供给 mergeToLocal 调用的接口（保持向后兼容）
  window.__ec_shardWrite = _writeSharded;
  window.__ec_shardRead = _readAll;

  // 暴露一个调试用的"查内存总数"
  window.__ec_getTotalOrders = function () {
    let total = 0;
    Object.keys(window.__EC_CB_ORDERS).forEach(function (sid) {
      const arr = window.__EC_CB_ORDERS[sid];
      if (Array.isArray(arr)) total += arr.length;
    });
    return total;
  };

  // monkey-patch CBOrderDB
  waitForCBOrderDB(function () {
    const DB = window.CBOrderDB;

    // getAll: 从内存读（不再读分片）
    DB.getAll = function (shopId) {
      const all = _readAll(shopId);
      // 按 date 降序排序（与原行为一致）
      return all.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    };

    // save: 写入改为内存
    DB.save = function (shopId, list) {
      _writeSharded(shopId, list || []);
    };

    // add: 单条添加
    DB.add = function (shopId, row) {
      const list = _readAll(shopId);
      list.unshift(Object.assign({}, row, { shop_id: shopId }));
      list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      _writeSharded(shopId, list);
      try { window.sbPushCBOrder(Object.assign({}, row, { shop_id: shopId })); } catch (e) {}
    };

    // update: 按 id 改字段
    DB.update = function (shopId, id, updates) {
      const list = _readAll(shopId);
      const idx = list.findIndex(function (r) { return r.id === id; });
      if (idx >= 0) {
        Object.assign(list[idx], updates);
        _writeSharded(shopId, list);
        try { window.sbPushCBOrder(Object.assign({}, list[idx], { shop_id: shopId })); } catch (e) {}
      }
    };

    // remove: 按 id 删
    DB.remove = function (shopId, id, silent) {
      const list = _readAll(shopId).filter(function (r) { return r.id !== id; });
      _writeSharded(shopId, list);
      if (!silent) { try { window.sbDeleteCBOrder(id); } catch (e) {} }
    };

    // batchAdd: 批量导入
    if (DB.batchAdd) {
      DB.batchAdd = async function (shopId, rows, onProgress) {
        const list = _readAll(shopId);
        const withShop = rows.map(function (r) { return Object.assign({}, r, { shop_id: shopId }); });
        const existIds = new Set(list.map(function (r) { return r.id; }));
        const newRows = withShop.filter(function (r) { return !existIds.has(r.id); });
        newRows.forEach(function (r) { list.unshift(r); });
        list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        _writeSharded(shopId, list);
        let result = null;
        try { result = await window.sbBatchUpsertCBOrders(withShop, onProgress); } catch (e) {}
        return result;
      };
    }

    // 启动时清掉所有旧的 ec_cb_orders_ 分片 key（避免残留污染）
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('ec_cb_orders_') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      if (toRemove.length > 0) {
        console.log('[MemoryV230] 启动清理旧分片: ' + toRemove.length + ' 个 key');
      }
    } catch (e) {}
  });
})();
