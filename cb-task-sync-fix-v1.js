/* ==========================================================================
 * cb-task-sync-fix-v1.js  (V178)
 * 修复「店铺任务换浏览器找不到 / 录入后实际未上云」问题
 *
 * 根因(2026-07-27 实测):cb_tasks 云端总共只有 1 条记录,说明
 *   1) CBTaskDB.add() 立即 toast 成功 + 关闭弹窗,但内部 saveToCloud 是
 *      async,主流程没 await。
 *   2) saveToCloud 内部「DELETE 该店铺所有任务 → POST 新列表」是事务式两步,
 *      如果 DELETE 成功但 POST 失败(网络中断/Supabase 限流),云端就被清空
 *      却没有新数据进去——比"没存"更糟(数据丢失)。
 *   3) 用户在新浏览器打开「任务 tab」时,虽然会触发 syncFromCloud,但因为
 *      本地 localStorage 是空的,如果云端也没数据,自然显示空。
 *
 * 修复:
 *   A) saveToCloud 失败重试(指数退避,最多 3 次),减少丢数据
 *   B) 加 ec_pending_push 队列:saveToCloud 失败 3 次后入队,下次 syncFromCloud
 *      自动补推
 *   C) initMainApp 后对所有店铺调 syncFromCloud(不依赖用户进 tab)
 *   D) 顶栏 lf-sync-badge 显示待同步数(V175 已有的基础设施复用)
 *
 * 入口:monkey-patch CBTaskDB.save / CBTaskDB.syncFromCloud
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__cbTaskSyncFixLoaded) return;
  window.__cbTaskSyncFixLoaded = true;
  console.log('[V178 cb-task-sync-fix] loaded');

  // ---------- 等 CBTaskDB / sbFetch 就绪 ----------
  function waitReady(cb){
    if (window.CBTaskDB && typeof window.sbFetch === 'function') return cb();
    setTimeout(function(){ waitReady(cb); }, 80);
  }

  // ---------- 1. 工具:错误重试(指数退避) ----------
  async function retryable(fn, times){
    var delay = 600;
    var lastErr = null;
    for (var i = 0; i < times; i++) {
      try { return await fn(i); }
      catch(e){ lastErr = e; if (i < times - 1) await new Promise(function(r){ setTimeout(r, delay); }); delay = Math.min(delay * 1.6, 4000); }
    }
    throw lastErr;
  }

  // ---------- 2. 待同步队列(失败后入队) ----------
  var PENDING_KEY = 'ec_pending_task_push';
  function loadPending(){
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch(e){ return {}; }
  }
  function savePending(p){
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch(e){}
  }
  function pendingCount(){
    var p = loadPending();
    var n = 0;
    Object.keys(p).forEach(function(k){ n += (p[k] && p[k].length) || 0; });
    return n;
  }
  function pushPending(shopId, list){
    var p = loadPending();
    p[shopId] = list;
    savePending(p);
    refreshBadge();
  }
  function clearPending(shopId){
    var p = loadPending();
    delete p[shopId];
    savePending(p);
    refreshBadge();
  }

  // ---------- 3. 顶栏 badge(V175 lf-sync-badge 复用) ----------
  function refreshBadge(){
    var n = pendingCount();
    var badge = document.getElementById('lf-sync-badge');
    if (badge) {
      badge.textContent = n > 0 ? ('⏳ 待同步 ' + n) : '';
      badge.style.display = n > 0 ? 'inline-block' : 'none';
      badge.style.color = '#f59e0b';
    }
    if (n > 0 && typeof window.showToast === 'function') {
      // 只在页面加载第一次提示,避免 spam
      if (!window.__taskSyncToastShown) {
        window.__taskSyncToastShown = true;
        setTimeout(function(){ window.__taskSyncToastShown = false; }, 30000);
      }
    }
  }

  // ---------- 4. monkey-patch CBTaskDB.save ----------
  //  原:save: function(shopId, list) { saveLocal(shopId, list); saveToCloud(shopId, list); },
  //  新:同步存本地 → 重试 saveToCloud → 失败入队
  waitReady(function(){
    var _origSave = window.CBTaskDB.save;
    var _origSync = window.CBTaskDB.syncFromCloud;

    window.CBTaskDB.save = async function(shopId, list){
      // 1) 先存本地(等价于原 saveLocal:localStorage.setItem('ec_cb_tasks_' + shopId, JSON.stringify(list)))
      try { localStorage.setItem('ec_cb_tasks_' + shopId, JSON.stringify(list)); } catch(e){ console.warn('[V178] saveLocal 失败', e); }

      if (!list || !list.length) { clearPending(shopId); return { ok: true, count: 0 }; }

      // 2) 重试 saveToCloud
      try {
        await retryable(function(){
          return window.sbFetch('cb_tasks', 'POST', list.map(function(r){
            return {
              id: r.id, shop_id: shopId,
              task_date: r.task_date || null,
              style_no: r.style_no || null,
              task_content: r.task_content || null,
              spu: r.spu || null,
              shop: r.shop || null,
              image_source: r.image_source || null,
              completion: r.completion || null,
              assignee: r.assignee || null,
              updated_at: r.updated_at || null,
              remark: r.remark || null,
              task_type: r.task_type || 'daily'
            };
          }), { 'Prefer': 'resolution=ignore-duplicates' });
        }, 3);
        // 成功 → 清掉该店铺的待同步
        clearPending(shopId);
        return { ok: true, count: list.length };
      } catch(e) {
        // 失败 3 次 → 入队
        console.warn('[V178] 任务上云失败,入队待重试', e);
        pushPending(shopId, list);
        return { ok: false, error: e, count: list.length };
      }
    };

    // 3) 增强 syncFromCloud:拉完云端后,如果本地有待同步队列,自动补推
    window.CBTaskDB.syncFromCloud = async function(shopId){
      var merged = await _origSync(shopId);

      // 检查是否有该店铺的待同步队列
      var p = loadPending();
      if (p[shopId] && p[shopId].length) {
        console.log('[V178] syncFromCloud 发现 ' + shopId + ' 待同步 ' + p[shopId].length + ' 条,补推云端');
        try {
          await retryable(function(){
            return window.sbFetch('cb_tasks', 'POST', p[shopId].map(function(r){
              return Object.assign({}, r, { shop_id: shopId });
            }), { 'Prefer': 'resolution=ignore-duplicates' });
          }, 3);
          clearPending(shopId);
        } catch(e) {
          console.warn('[V178] 待同步补推失败', e);
        }
      }
      return merged;
    };

    console.log('[V178 cb-task-sync-fix] CBTaskDB.save / syncFromCloud 已增强');
  });

  // ---------- 5. initMainApp 后:对所有店铺主动 syncFromCloud ----------
  //  让换浏览器/隐私模式首次访问也能拉到云端任务
  function trySyncAllShops(){
    if (!window.DB || typeof window.DB.getShops !== 'function') {
      setTimeout(trySyncAllShops, 500);
      return;
    }
    var shops = window.DB.getShops() || [];
    if (!shops.length) return;
    shops.forEach(function(s){
      if (window.CBTaskDB && typeof window.CBTaskDB.syncFromCloud === 'function') {
        // 静默同步,不刷 UI
        window.CBTaskDB.syncFromCloud(s.id).catch(function(){});
      }
    });
    refreshBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(trySyncAllShops, 1500); });
  } else {
    setTimeout(trySyncAllShops, 1500);
  }

  // 每 30 秒刷一次 badge(防止后台待同步变化)
  setInterval(refreshBadge, 30000);

})();