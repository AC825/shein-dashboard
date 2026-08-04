/* ============================================================
 * shops-pull-v1.js (V192)
 * 修复：前端 shops 只 PUSH 不 PULL —— 新设备/新会话/清缓存后
 * 本地 Cache('shops') 为空，看不到任何店铺。
 * 方案：启动后从 Supabase shops 表拉取全部店铺，按 id merge 进本地
 *（本地已有的以本地为准，只补充本地没有的），然后刷新店铺页。
 * ============================================================ */
(function () {
  'use strict';
  var DONE_KEY = '_v192_shops_pulled';
  var tries = 0;

  function log(m) { try { console.log('[shops-pull-v1] ' + m); } catch (e) {} }

  function ready() {
    return typeof window.sbFetch === 'function' && window.Cache && window.DB;
  }

  async function pullShops() {
    if (window[DONE_KEY]) return;
    window[DONE_KEY] = true;
    try {
      var cloud = await window.sbFetch('shops?select=*&limit=1000');
      if (!Array.isArray(cloud) || cloud.length === 0) { log('云端 0 家店铺，跳过'); return; }
      var local = window.Cache.get('shops', []) || [];
      var byId = {};
      local.forEach(function (s) { byId[s.id] = true; });
      var added = 0;
      cloud.forEach(function (s) {
        if (!s || !s.id || byId[s.id]) return;
        if (s.deleted_at) return;
        local.push(s);
        byId[s.id] = true;
        added++;
      });
      if (added > 0) {
        window.Cache.set('shops', local);
        log('从云端补充 ' + added + ' 家店铺（本地原有 ' + (local.length - added) + '）');
        // 若当前正在店铺页则刷新
        try {
          if (window.currentPage === 'shops' && typeof window.renderShops === 'function') window.renderShops();
        } catch (e) {}
      } else {
        log('云端 ' + cloud.length + ' 家店铺本地均已存在');
      }
    } catch (e) {
      window[DONE_KEY] = false; // 允许下次重试
      log('拉取失败: ' + (e && e.message));
    }
  }

  function boot() {
    tries++;
    if (!ready()) {
      if (tries < 100) setTimeout(boot, 300);
      return;
    }
    // 等登录后再拉（未登录时也拉，进入主界面即有数据）
    pullShops();
    // 登录动作后再补一次（确保权限过滤后仍能看到）
    var _n = window.navigate;
    if (typeof _n === 'function' && !window._v192_navWrapped) {
      window._v192_navWrapped = true;
      window.navigate = function (p) {
        var r = _n.apply(this, arguments);
        if (p === 'shops' && !window[DONE_KEY]) pullShops();
        return r;
      };
    }
  }
  boot();
})();
