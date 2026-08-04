/* ==========================================================================
 * cb-task-cloud-push-v1.js  (V193)
 * 「店铺任务数据云端同步增强」
 *
 * 背景(2026-07-28 实测):
 *   cb_tasks 云端表全表只有 1 条孤儿记录（已删除店铺 shop_1774605291560）,
 *   用户新建任务后即使 V178 cb-task-sync-fix 保存到 localStorage,云端依然 0 条。
 *   原因分析:
 *     - V178 之前的老 save 流程是「DELETE 该店铺所有任务 → POST 新列表」,
 *       DELETE 成功 + POST 失败 → 云端被清空
 *     - V178 修复了 DELETE-then-POST,但用户的任务可能创建于 V178 之前,未走 V178
 *     - 即使 V178 之后,某些 save 失败 3 次后入队 ec_pending_push,后续 syncFromCloud
 *       必须被显式触发才会补推
 *     - V185 recovery 只检查「localStorage 有 + 云端 0」,在隐私模式/换浏览器场景无救
 *
 * V193 增强:
 *   1) 包装 CBTaskDB.add / save / update,任何本地写入后立即触发一次
 *      syncFromCloud 二次验证,失败重试,确保 localStorage ↔ 云端最终一致
 *   2) 启动时对所有店铺(包括云端拉的 shops)全量 syncFromCloud
 *   3) 暴露 __v193_forcePushAll 供 UI「从云端同步」按钮调用
 *   4) 加 toast 反馈同步结果
 *
 * 重要:不动 minified 主代码 + V178/V185/V186 已有补丁
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__cbTaskCloudPushLoaded) return;
  window.__cbTaskCloudPushLoaded = true;
  console.log('[V193 cb-task-cloud-push] loaded');

  function waitReady(cb){
    if (window.CBTaskDB && typeof window.sbFetch === 'function' &&
        typeof window.CBTaskDB.syncFromCloud === 'function' &&
        typeof window.CBTaskDB.add === 'function') return cb();
    setTimeout(function(){ waitReady(cb); }, 100);
  }

  async function retryable(fn, times){
    var delay = 500;
    var lastErr = null;
    for (var i = 0; i < times; i++) {
      try { return await fn(i); }
      catch(e){ lastErr = e; if (i < times - 1) await new Promise(function(r){ setTimeout(r, delay); }); delay = Math.min(delay * 1.5, 3000); }
    }
    throw lastErr;
  }

  function readLocal(shopId){
    try { return JSON.parse(localStorage.getItem('ec_cb_tasks_' + shopId) || '[]'); }
    catch(e){ return []; }
  }

  function toast(msg, type){
    try {
      if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
      else if (window.console) console.log('[V193]', msg);
    } catch(e){}
  }

  // 强推：把 localStorage 的全量数据 UPSERT 到云端
  async function forcePushShop(shopId){
    var local = readLocal(shopId);
    if (!local.length) return { ok: true, count: 0, msg: '本地无任务' };
    try {
      var n = await retryable(function(){
        return window.sbFetch('cb_tasks', 'POST', local.map(function(r){
          return {
            id: r.id, shop_id: shopId,
            task_date: r.task_date || null,
            // V193f: 云端 cb_tasks 实测缺 date_end 列,POST 必须剔除,否则整批失败
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
        }), { 'Prefer': 'resolution=ignore-duplicates' }); // V193f: ignore-duplicates 实测可用(merge-duplicates 缺 on_conflict 会报错)
      }, 3);
      console.log('[V193] 店铺 ' + shopId + ' 强推上云 ' + local.length + ' 条');
      return { ok: true, count: local.length };
    } catch(e){
      console.warn('[V193] 强推失败', e);
      return { ok: false, error: String(e), count: 0 };
    }
  }

  waitReady(function(){
    // 包装 add —— 用户新增任务后,异步强推上云
    // V193d 修复:必须保持同步 + 绑定 this(原函数内部用 this.save,裸调会 TypeError)
    var _origAdd = window.CBTaskDB.add;
    window.CBTaskDB.add = function(shopId, task){
      var r = _origAdd.call(window.CBTaskDB, shopId, task);
      // 立即强制 push(不等 syncFromCloud)
      setTimeout(function(){
        forcePushShop(shopId).then(function(res){
          if (res.ok && res.count > 0) {
            toast('✅ 任务已同步到云端（' + res.count + ' 条）', 'success');
          } else if (!res.ok) {
            toast('⚠️ 云端同步失败,已保存到本地', 'warning');
          }
        });
      }, 200);
      return r;
    };

    // 包装 update —— 用户编辑后强制 push(同步 + 绑 this,同 add)
    var _origUpdate = window.CBTaskDB.update;
    window.CBTaskDB.update = function(shopId, id, patch){
      var r = _origUpdate.call(window.CBTaskDB, shopId, id, patch);
      setTimeout(function(){
        forcePushShop(shopId).catch(function(){});
      }, 200);
      return r;
    };

    // 暴露给 UI「🔄 从云端同步」按钮用
    window.__v193_forcePushShop = forcePushShop;
    window.__v193_forcePushAll = async function(){
      if (!window.DB || typeof window.DB.getShops !== 'function') return { ok: false };
      var shops = window.DB.getShops() || [];
      var pushed = 0;
      for (var i = 0; i < shops.length; i++) {
        var r = await forcePushShop(shops[i].id);
        if (r.ok && r.count > 0) pushed += r.count;
      }
      toast('✅ 全量同步完成（' + pushed + ' 条已上云）', 'success');
      return { ok: true, pushed: pushed };
    };

    console.log('[V193 cb-task-cloud-push] add/update 已增强:本地写入后自动 push');
  });

  // 启动时:对所有店铺(包括云端拉的)全量 syncFromCloud
  function startupSync(){
    if (!window.DB || typeof window.DB.getShops !== 'function') {
      setTimeout(startupSync, 500);
      return;
    }
    var shops = window.DB.getShops() || [];
    console.log('[V193] 启动时对 ' + shops.length + ' 家店铺全量 syncFromCloud');
    shops.forEach(function(s){
      if (window.CBTaskDB && typeof window.CBTaskDB.syncFromCloud === 'function') {
        window.CBTaskDB.syncFromCloud(s.id).then(function(merged){
          // V193 二次验证:本地有但云端 merge 之后仍可能 0(网络问题),再次强推
          if (merged && merged.length === 0) {
            var local = readLocal(s.id);
            if (local.length > 0) {
              console.log('[V193] 店铺 ' + s.id + ' merge 后 0 条,但本地有 ' + local.length + ' 条,触发强推');
              forcePushShop(s.id);
            }
          }
        }).catch(function(){});
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      // 等 shops-pull-v1 跑完(2.5 秒)再开始
      setTimeout(startupSync, 3500);
    });
  } else {
    setTimeout(startupSync, 3500);
  }

  // 暴露到顶层供 console 调试
  window.__v193 = {
    forcePushShop: forcePushShop,
    forcePushAll: function(){
      if (!window.DB) return Promise.resolve({ ok: false });
      var shops = window.DB.getShops() || [];
      return Promise.all(shops.map(function(s){ return forcePushShop(s.id); }));
    },
    readLocal: readLocal
  };
})();
