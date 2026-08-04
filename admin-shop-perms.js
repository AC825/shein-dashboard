/**
 * 管理员店铺授权 UI v1
 * 在管理员权限页面添加「店铺查看权限」勾选框
 * 每个用户显示所有店铺，可单独勾选 shop_view_<shopId>
 * 加载顺序：必须在 app-v3-v3.js 之后
 */
(function() {
  'use strict';

  var origLoadAdminUsers = null;

  // 等待原始函数就绪后包装
  function waitForReady() {
    if (typeof loadAdminUsers !== 'function') {
      setTimeout(waitForReady, 200);
      return;
    }
    origLoadAdminUsers = loadAdminUsers;
    window.loadAdminUsers = enhanceLoadAdminUsers;
    console.log('[AdminShopPerms] Loaded ✓');
  }

  // 保存原始 loadAdminUsers
  var loadAdminOrig = null;
  var readyCheckDone = false;

  function checkReady() {
    if (readyCheckDone) return;
    if (typeof loadAdminUsers === 'function') {
      loadAdminOrig = loadAdminUsers;
      window.loadAdminUsers = enhancedAdminUsers;
      readyCheckDone = true;
      console.log('[AdminShopPerms] Override installed ✓');
    } else {
      setTimeout(checkReady, 200);
    }
  }

  // ===== 工具函数 =====
  function getLocalPerms(userId) {
    // 使用 auth-v6-safe.js 的 LocalPerms（全局），保持与登录权限加载一致
    if (typeof LocalPerms !== 'undefined' && LocalPerms.get) {
      return LocalPerms.get(userId) || [];
    }
    // 兜底：兼容旧 key（仅在 LocalPerms 未就绪时）
    try {
      var key = 'ec_perms_' + userId;
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch(e) { return []; }
  }

  function hasLocalPerm(userId, perm) {
    return getLocalPerms(userId).indexOf(perm) >= 0;
  }

  function toggleShopPerm(userId, shopId, type, checked) {
    var perm = type + '_' + shopId;

    // 统一使用 auth-v6-safe.js 的 togglePermission：同时写 Supabase + LocalPerms
    if (typeof togglePermission === 'function') {
      togglePermission(userId, perm, checked);
    } else {
      // 兜底：只更新本地缓存
      if (typeof LocalPerms !== 'undefined' && LocalPerms.get) {
        if (checked) LocalPerms.grant(userId, perm);
        else LocalPerms.revoke(userId, perm);
      } else {
        var key = 'ec_perms_' + userId;
        var perms = getLocalPerms(userId);
        if (checked && perms.indexOf(perm) < 0) perms.push(perm);
        else if (!checked) perms = perms.filter(function(p) { return p !== perm; });
        try { localStorage.setItem(key, JSON.stringify(perms)); } catch(e) {}
      }
      showToast(
        checked ? '✅ 已授予 ' + (type === 'shop_view' ? '查看' : '编辑') + ' 权限' : '已收回权限',
        checked ? 'success' : 'info'
      );
    }
  }

  // 获取用户已有的店铺权限
  function getUserShopPerms(userId) {
    var perms = getLocalPerms(userId);
    return {
      view: perms.filter(function(p) { return p.startsWith('shop_view_'); }).map(function(p) { return p.replace('shop_view_', ''); }),
      edit: perms.filter(function(p) { return p.startsWith('shop_edit_'); }).map(function(p) { return p.replace('shop_edit_', ''); })
    };
  }

  // ===== 从云端拉取某用户的真实权限，写回 LocalPerms（避免旧本地缓存伪造选中态）=====
  async function syncUserPermsFromCloud(userId) {
    if (typeof SUPABASE_ENABLED === 'undefined' || !SUPABASE_ENABLED) return;
    if (typeof sbFetch !== 'function') return;
    try {
      var rows = await sbFetch('permissions?user_id=eq.' + userId + '&select=page');
      var pages = (rows || []).map(function(r) { return r.page; });
      if (typeof LocalPerms !== 'undefined' && LocalPerms.set) {
        LocalPerms.set(userId, pages);
      }
    } catch(e) {
      console.warn('[AdminShopPerms] sync cloud perms failed for', userId, e);
    }
  }

  // 一次性清理旧版 ec_perms_ 本地残留（这些残留会让勾选框显示“已勾选”而云端实际没有）
  function cleanupLegacyPerms() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ec_perms_') === 0) keys.push(k);
      }
      keys.forEach(function(k) { localStorage.removeItem(k); });
      if (keys.length) console.log('[AdminShopPerms] 已清理旧版本地权限缓存:', keys.length);
    } catch(e) {}
  }

  // ===== 增强版 loadAdminUsers（以云端权限为准渲染勾选框）=====
  async function enhancedAdminUsers() {
    // 先调用原始函数渲染基础 UI
    if (loadAdminOrig) {
      await loadAdminOrig();
    }

    // 清理旧版本地残留，防止“伪选中”
    cleanupLegacyPerms();

    // 获取 admin-user-list 容器
    var container = document.getElementById('admin-user-list');
    if (!container) return;

    // 获取所有店铺
    var allShops = [];
    if (typeof DB !== 'undefined' && DB.getShops) {
      allShops = DB.getShops();
    }

    if (!allShops.length) return;

    // 获取所有用户卡片
    var userCards = Array.prototype.slice.call(container.querySelectorAll('.card'));

    for (var c = 0; c < userCards.length; c++) {
      var card = userCards[c];

      // 跳过 "暂无注册成员" 空状态
      if (card.querySelector('.empty-state')) continue;

      // 跳过管理员（已经有 "超级管理员" 提示）
      if (card.querySelector('[style*="color:#a78bfa"]') &&
          card.querySelector('[style*="color:#a78bfa"]').textContent.indexOf('超级管理员') >= 0) continue;

      // 获取用户 ID：从按钮的 onclick 参数中提取
      var userId = null;
      var btns = card.querySelectorAll('button[onclick*="handlePermChange"],[onclick*="grantAdmin"]');
      btns.forEach(function(btn) {
        var m = (btn.getAttribute('onclick') || '').match(/['"](\w+)['"]/);
        if (m && !userId) userId = m[1];
      });

      if (!userId) {
        // 尝试从现有的 checkbox onchange 提取
        var checkboxes = card.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(function(cb) {
          var m = (cb.getAttribute('onchange') || '').match(/['"](\w+)['"]/);
          if (m && !userId) userId = m[1];
        });
      }

      if (!userId) continue;

      // ★ 关键修复：先以云端真实权限为准同步到 LocalPerms，再渲染勾选框
      await syncUserPermsFromCloud(userId);

      // 获取用户当前店铺权限（此时已与云端一致）
      var shopPerms = getUserShopPerms(userId);

      // 创建店铺权限区域（与页面/操作权限一致的浅色风格）
      var shopSection = document.createElement('div');
      shopSection.style.cssText = 'margin-top:16px';
      var viewChips = allShops.map(function(shop) {
        var on = shopPerms.view.indexOf(shop.id) >= 0;
        return '<label class="perm-toggle" title="' + (on ? '收回' : '授予') + '查看「' + shop.name + '」的权限">' +
          '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="adminShopPermsToggle(\'' + userId + '\',\'' + shop.id + '\',\'shop_view\',this)">' +
          '<span class="perm-label ' + (on ? 'perm-on' : 'perm-off') + '">' +
            '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + (shop.color || '#722ed1') + ';margin-right:5px;vertical-align:middle"></span>' +
            shop.name +
          '</span></label>';
      }).join('');
      var editChips = allShops.map(function(shop) {
        var on = shopPerms.edit.indexOf(shop.id) >= 0;
        return '<label class="perm-toggle" title="' + (on ? '收回' : '授予') + '编辑「' + shop.name + '」的权限">' +
          '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="adminShopPermsToggle(\'' + userId + '\',\'' + shop.id + '\',\'shop_edit\',this)">' +
          '<span class="perm-label ' + (on ? 'perm-on' : 'perm-off') + '">' +
            '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + (shop.color || '#722ed1') + ';margin-right:5px;vertical-align:middle"></span>' +
            shop.name +
          '</span></label>';
      }).join('');
      shopSection.innerHTML =
        '<div class="perm-section" style="border-color:#ece3fb;background:#fcfbff">' +
          '<div class="perm-section-title"><span class="perm-section-bar" style="background:#722ed1"></span>店铺查看权限</div>' +
          '<div class="perm-grid" id="shop-view-perms-' + userId + '">' + viewChips + '</div>' +
        '</div>' +
        '<div class="perm-section" style="border-color:#ffe9d6;background:#fffcf9;margin-top:14px">' +
          '<div class="perm-section-title"><span class="perm-section-bar bar-orange"></span>店铺编辑权限</div>' +
          '<div class="perm-grid" id="shop-edit-perms-' + userId + '">' + editChips + '</div>' +
        '</div>';

      // 添加到用户卡片的权限区（与页面/操作权限同区，视觉统一）
      var permsBox = card.querySelector('.auc-perms');
      (permsBox || card).appendChild(shopSection);
    }
  }

  // ===== 全局切换函数 =====
  window.adminShopPermsToggle = function(userId, shopId, type, el) {
    toggleShopPerm(userId, shopId, type, el.checked);
  };

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkReady);
  } else {
    checkReady();
  }
})();
