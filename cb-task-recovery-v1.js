/* ==========================================================================
 * cb-task-recovery-v1.js  (V185)
 * 「本地有历史任务 + 云端为空」自动兜底上云
 *
 * 背景(2026-07-27 实测):
 *   cb_tasks 云端表全表只有 1 条孤儿记录(shop_1774605291560 已删除),
 *   用户截图店铺 001【超】(shop_1774507289990)店铺任务 tab 显示 0 条,
 *   即使点了"🔄 从云端同步"按钮也提示"共 0 条任务"。
 *
 * 根因:
 *   V178 修复前的旧 bug — saveToCloud 是「DELETE 该店铺所有任务 → POST 新列表」
 *   事务式两步,DELETE 成功 + POST 失败 → 云端该店铺任务被清空(数据丢失)。
 *   本地 localStorage 是同步保存的,但用户在换浏览器/清缓存后,本地也找不回。
 *
 * V178 修复:
 *   1) saveLocal 同步保存(永远在)
 *   2) saveToCloud retryable 3 次
 *   3) 失败入 ec_pending_task_push 队列
 *   4) syncFromCloud 完成后会自动补推该店铺待同步队列
 *
 * V185 兜底(V178 之后,任务仍可能找不到的场景):
 *   场景 A: 用户**没换浏览器**,但云端空,本地有历史 → syncFromCloud
 *           返回本地数据,但不会自动 push,数据只活在本机。
 *   场景 B: 用户换浏览器 + 隐私模式,云端空,本地无 → 没救(数据真的丢了)
 *
 *   修法: 包装 window.CBTaskDB.syncFromCloud,完成后用 sbFetch
 *   二次确认云端条数;若云端 0 且本地 > 0,主动 push 上云 + toast 提示。
 *
 * 不动 minified 主代码 + V178 补丁,纯外部补丁。
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__cbTaskRecoveryLoaded) return;
  window.__cbTaskRecoveryLoaded = true;
  console.log('[V185 cb-task-recovery] loaded');

  function waitReady(cb){
    if (window.CBTaskDB && typeof window.sbFetch === 'function' &&
        typeof window.CBTaskDB.syncFromCloud === 'function') return cb();
    setTimeout(function(){ waitReady(cb); }, 100);
  }

  async function retryable(fn, times){
    var delay = 600;
    var lastErr = null;
    for (var i = 0; i < times; i++) {
      try { return await fn(i); }
      catch(e){ lastErr = e; if (i < times - 1) await new Promise(function(r){ setTimeout(r, delay); }); delay = Math.min(delay * 1.6, 4000); }
    }
    throw lastErr;
  }

  // 读本地 ec_cb_tasks_<shopId>
  function readLocal(shopId){
    try { return JSON.parse(localStorage.getItem('ec_cb_tasks_' + shopId) || '[]'); }
    catch(e){ return []; }
  }

  // 直接查云端条数(独立于 syncFromCloud 内部 merge 逻辑)
  async function cloudCountOf(shopId){
    try {
      var rows = await window.sbFetch(
        'cb_tasks?shop_id=eq.' + encodeURIComponent(shopId) + '&select=id'
      );
      return Array.isArray(rows) ? rows.length : 0;
    } catch(e){
      return -1; // 网络错误时返回 -1,不触发兜底
    }
  }

  // 主动 push 一批任务上云
  async function pushList(shopId, list){
    return retryable(function(){
      return window.sbFetch('cb_tasks', 'POST', list.map(function(r){
        return {
          id: r.id, shop_id: shopId,
          task_date: r.task_date || null,
          date_end: r.date_end || null,
          style_no: r.style_no || null,
          task_content: r.task_content || null,
          spu: r.spu || null,
          shop: r.shop || null,
          image_source: r.image_source || null,
          completion: r.completion || null,
          assignee: r.assignee || null,
          updated_at: r.updated_at || new Date().toISOString().slice(0, 10),
          remark: r.remark || null,
          task_type: r.task_type || 'daily'
        };
      }), { 'Prefer': 'resolution=ignore-duplicates' });
    }, 3);
  }

  waitReady(function(){
    var _origSync = window.CBTaskDB.syncFromCloud;

    window.CBTaskDB.syncFromCloud = async function(shopId){
      var merged = await _origSync(shopId);

      // V185 兜底:二次确认云端条数
      try {
        var local = readLocal(shopId);
        if (local.length === 0) return merged;  // 本地也空,没救

        var cn = await cloudCountOf(shopId);
        if (cn < 0) return merged;  // 网络错误,不触发
        if (cn > 0) return merged;  // 云端已有,不重复 push

        // 云端 0 条 + 本地有 → 主动 push 兜底
        console.log('[V185] 店铺 ' + shopId + ' 云端 0 条 + 本地 ' + local.length + ' 条 → 自动上云');
        await pushList(shopId, local);
        if (typeof window.showToast === 'function') {
          window.showToast('📤 发现本地 ' + local.length + ' 条历史任务,已自动上云', 'success');
        }
        // 刷新当前 tab(如果显示)
        try {
          var tab = document.getElementById('cb-tab-tasks-' + shopId);
          if (tab && tab.style.display !== 'none' && typeof window.refreshTaskContent === 'function') {
            window.refreshTaskContent(shopId);
          }
        } catch(e){}
      } catch(e) {
        console.warn('[V185] recovery err', e);
      }
      return merged;
    };

    // 暴露手动恢复入口(console 调试用 + UI 按钮可调用)
    window.__v185_recoverShop = async function(shopId){
      if (!shopId) return { ok: false, msg: 'no shopId' };
      var local = readLocal(shopId);
      if (!local.length) return { ok: false, msg: '本地无任务' };
      try {
        await pushList(shopId, local);
        return { ok: true, count: local.length };
      } catch(e) {
        return { ok: false, error: String(e) };
      }
    };

    console.log('[V185 cb-task-recovery] syncFromCloud 已增强:本地兜底上云');
  });

  // 启动时:对所有店铺主动 syncFromCloud(若云端空 + 本地有 → 自动上云)
  function tryRecoverAll(){
    if (!window.DB || typeof window.DB.getShops !== 'function') {
      setTimeout(tryRecoverAll, 500);
      return;
    }
    var shops = window.DB.getShops() || [];
    if (!shops.length) return;
    shops.forEach(function(s){
      if (window.CBTaskDB && typeof window.CBTaskDB.syncFromCloud === 'function') {
        window.CBTaskDB.syncFromCloud(s.id).catch(function(){});
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(tryRecoverAll, 2500); });
  } else {
    setTimeout(tryRecoverAll, 2500);
  }
})();