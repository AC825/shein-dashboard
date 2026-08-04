/**
 * 个人中心 - 会员体系升级
 *
 * 等级规则（基于活跃天数）：
 *   Lv.1 猪猪    0 天
 *   Lv.2 铁粉    7 天
 *   Lv.3 铜牌    30 天
 *   Lv.4 银牌    90 天
 *   Lv.5 金牌    180 天
 *   Lv.6 钻石    365 天
 *   Lv.7 星耀    730 天
 *   Lv.8 王者    1095 天
 */
(function() {
  'use strict';

  function _id(s) { return document.getElementById(s); }

  // ===== 等级配置（倍增式：每天×2 递增）=====
  var VIP_LEVELS = [
    { level: 1, name: '初识',  icon: '🌱', days: 1,    color: '#94a3b8', bg: 'linear-gradient(135deg, #475569, #64748b)' },
    { level: 2, name: '常客',  icon: '🔰', days: 2,    color: '#f97316', bg: 'linear-gradient(135deg, #ea580c, #f97316)' },
    { level: 3, name: '铜粉',  icon: '🥉', days: 4,    color: '#d97706', bg: 'linear-gradient(135deg, #b45309, #d97706)' },
    { level: 4, name: '银粉',  icon: '🥈', days: 8,    color: '#a3e635', bg: 'linear-gradient(135deg, #65a30d, #a3e635)' },
    { level: 5, name: '金粉',  icon: '🥇', days: 16,   color: '#facc15', bg: 'linear-gradient(135deg, #ca8a04, #facc15)' },
    { level: 6, name: '钻石',  icon: '💎', days: 32,   color: '#38bdf8', bg: 'linear-gradient(135deg, #0284c7, #38bdf8)' },
    { level: 7, name: '星耀',  icon: '⭐', days: 64,   color: '#d946ef', bg: 'linear-gradient(135deg, #a21caf, #d946ef)' },
    { level: 8, name: '王者',  icon: '👑', days: 128,  color: '#f59e0b', bg: 'linear-gradient(135deg, #b45309, #f59e0b)' },
    { level: 9, name: '传奇',  icon: '🏆', days: 256,  color: '#ec4899', bg: 'linear-gradient(135deg, #be185d, #ec4899)' },
    { level: 10, name: '神话', icon: '🌟', days: 365, color: '#fbbf24', bg: 'linear-gradient(135deg, #dc2626, #fbbf24, #06b6d4)' },
  ];

  function getLevel(activeDays) {
    var lv = VIP_LEVELS[0];
    for (var i = VIP_LEVELS.length - 1; i >= 0; i--) {
      if (activeDays >= VIP_LEVELS[i].days) { lv = VIP_LEVELS[i]; break; }
    }
    return lv;
  }

  function getNextLevel(activeDays) {
    for (var i = 0; i < VIP_LEVELS.length; i++) {
      if (VIP_LEVELS[i].days > activeDays) return VIP_LEVELS[i];
    }
    return null;
  }

  // ===== 活跃天数计算 =====
  // 每天第一次打开页面时记录一次；store 格式: { dates: ["2026-07-20","2026-07-21"], count: 2 }
  function getActiveDays() {
    try {
      var raw = localStorage.getItem('ec_vip_active_days');
      if (raw) {
        var data = JSON.parse(raw);
        return Array.isArray(data) ? data : (data && data.dates ? data.dates : []);
      }
    } catch(e) {}
    return [];
  }

  function saveActiveDates(dates) {
    try {
      localStorage.setItem('ec_vip_active_days', JSON.stringify({ dates: dates, count: dates.length }));
    } catch(e) {}
  }

  function markTodayActive() {
    var dates = getActiveDays();
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (dates.indexOf(todayStr) < 0) {
      dates.push(todayStr);
      saveActiveDates(dates);
      if (window.CloudProfile) window.CloudProfile.save();
    }
  }

  // 只在页面初始化时标记今天（避免重复）
  markTodayActive();

  // ===== 渲染会员卡片 =====
  function renderMembershipCard() {
    var pg = _id('page-profile');
    if (!pg) return;
    // 避免重复
    if (document.getElementById('vip-membership-card')) return;

    // 等待原始渲染完成
    var card = pg.querySelector('.card');
    if (!card) { setTimeout(renderMembershipCard, 100); return; }

    var dates = getActiveDays();
    var activeDays = dates.length;
    var user = null;
    try { if (typeof CURRENT_USER !== 'undefined') user = CURRENT_USER; } catch(e) {}
    var isAdmin = user && user.role === 'admin';

    var vip = getLevel(activeDays);
    var next = getNextLevel(activeDays);
    var progress = 0;
    var progressMax = 1;
    if (next) {
      progressMax = next.days - vip.days;
      progress = activeDays - vip.days;
    } else {
      progress = 100;
      progressMax = 100;
    }
    var pct = Math.min(100, Math.round(progress / progressMax * 100));

    // 获取一些统计数据
    var totalShops = 0, totalOrders = 0, totalDays = 0;
    try {
      if (typeof DB !== 'undefined' && DB.getShops) {
        var allShops = DB.getShops() || [];
        totalShops = allShops.length;
        if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
          allShops.forEach(function(s) {
            var orders = CBOrderDB.getAll(s.id) || [];
            totalOrders += orders.filter(function(o) { return (o.sale_amount || 0) > 0; }).length;
            var daily = [];
            try { if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) daily = CrossBorderDailyDB.getAll(s.id) || []; } catch(e) {}
            totalDays = Math.max(totalDays, daily.length);
          });
        }
      }
    } catch(e) {}

    // 构建会员卡片 HTML
    var cardHtml = [
      '<div id="vip-membership-card" style="margin-bottom:16px">',
      // 顶部会员背景卡片
      '<div style="position:relative;overflow:hidden;border-radius:16px;padding:28px 24px 20px;' + vip.bg + '">',
      // 装饰气泡
      '<div style="position:absolute;top:-30px;right:-30px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>',
      '<div style="position:absolute;bottom:-40px;left:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>',
      // 会员头像 + 等级
      '<div style="display:flex;align-items:center;gap:16px;position:relative;z-index:1">',
        '<div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 4px 15px rgba(0,0,0,0.2)">' + (user ? ((user.nickname || user.phone || 'U').charAt(0).toUpperCase()) : 'U') + '</div>',
        '<div style="flex:1">',
          '<div style="display:flex;align-items:center;gap:8px">',
            '<span style="font-size:22px;font-weight:800;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.15)">' + (user ? (user.nickname || user.phone || '用户') : '用户') + '</span>',
            '<div style="background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:#fff">' + vip.icon + ' ' + vip.name + '</div>',
          '</div>',
          '<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px">' + activeDays + ' 天活跃 · Lv.' + vip.level + '</div>',
        '</div>',
        // 特权标识
        '<div style="text-align:center">',
          '<div style="font-size:36px">' + (isAdmin ? '👑' : vip.icon) + '</div>',
          '<div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:2px">' + (isAdmin ? '管理员' : '会员') + '</div>',
        '</div>',
      '</div>',
      // 进度条
      (next ? '<div style="margin-top:16px;position:relative;z-index:1">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.8);margin-bottom:6px">' +
          '<span>Lv.' + vip.level + ' ' + vip.name + ' ' + vip.icon + '</span>' +
          '<span>距离 Lv.' + next.level + ' ' + next.name + ' ' + next.icon + ' 还有 ' + (next.days - activeDays) + ' 天</span>' +
        '</div>' +
        '<div style="width:100%;height:8px;border-radius:4px;background:rgba(255,255,255,0.15)">' +
          '<div style="height:100%;border-radius:4px;width:' + pct + '%;background:linear-gradient(90deg,rgba(255,255,255,0.5),rgba(255,255,255,0.9));transition:width 0.6s ease"></div>' +
        '</div>' +
      '</div>' : '') +
      '</div>',

      // 数据统计卡片（白底高对比，SHEIN 白蓝风格）
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px">',
        '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;border-left:4px solid #1890ff;box-shadow:0 2px 8px rgba(0,0,0,0.04)">',
          '<div style="font-size:18px;margin-bottom:4px">📅</div>',
          '<div style="font-size:12px;color:#64748b;font-weight:500">活跃天数</div>',
          '<div style="font-size:28px;font-weight:800;color:#1890ff;line-height:1;margin-top:6px">' + activeDays + '</div>',
        '</div>',
        '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;border-left:4px solid #52c41a;box-shadow:0 2px 8px rgba(0,0,0,0.04)">',
          '<div style="font-size:18px;margin-bottom:4px">🏪</div>',
          '<div style="font-size:12px;color:#64748b;font-weight:500">管理店铺</div>',
          '<div style="font-size:28px;font-weight:800;color:#52c41a;line-height:1;margin-top:6px">' + totalShops + '</div>',
        '</div>',
        '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;border-left:4px solid #eb2f96;box-shadow:0 2px 8px rgba(0,0,0,0.04)">',
          '<div style="font-size:18px;margin-bottom:4px">📦</div>',
          '<div style="font-size:12px;color:#64748b;font-weight:500">累计订单</div>',
          '<div style="font-size:28px;font-weight:800;color:#eb2f96;line-height:1;margin-top:6px">' + totalOrders + '</div>',
        '</div>',
      '</div>',

      // ☁️ 云端同步区块
      '<div style="margin-top:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">',
        '<div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:10px">☁️ 云端同步（所有数据自动备份到云端）</div>',
        '<div style="display:flex;gap:10px;flex-wrap:wrap">',
          '<button onclick="if(window.runCloudSync)window.runCloudSync()" style="flex:1;min-width:120px;background:#1890ff;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">📤 全部推云端</button>',
          '<button onclick="if(window.restoreAllFromCloud)window.restoreAllFromCloud()" style="flex:1;min-width:120px;background:#52c41a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">📥 从云端恢复</button>',
        '</div>',
      '</div>',

      // 全部等级预览
      '<div style="margin-top:14px;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px">',
        '<div style="font-size:12px;color:#94a3b8;margin-bottom:10px;font-weight:600">🏆 全部等级</div>',
        '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">',
          VIP_LEVELS.map(function(l) {
            var isCurrent = l.level === vip.level;
            var isUnlocked = activeDays >= l.days;
            var opacity = isUnlocked ? 1 : 0.3;
            var border = isCurrent ? '2px solid ' + l.color : '1px solid #334155';
            return '<div style="flex-shrink:0;text-align:center;padding:8px 14px;border-radius:10px;border:' + border + ';background:' + (isUnlocked ? 'rgba(255,255,255,0.05)' : '#0f172a') + ';opacity:' + opacity + '">' +
              '<div style="font-size:22px">' + l.icon + '</div>' +
              '<div style="font-size:10px;font-weight:700;color:' + (isUnlocked ? l.color : '#64748b') + ';margin-top:2px">' + l.name + '</div>' +
              '<div style="font-size:9px;color:#475569">Lv.' + l.level + '</div>' +
            '</div>';
          }).join(''),
        '</div>',
      '</div>',
    '</div>'
    ].join('');

    // 插入到第一个 card 之前
    pg.insertAdjacentHTML('afterbegin', cardHtml);

    // 如果已有原始卡片，把原始卡片移到 VIP 卡片后面
    var firstCard = pg.querySelector('.card');
    if (firstCard && firstCard.parentNode === pg) {
      // 让原始卡片保持在会员卡片之后
      var vipCardEl = document.getElementById('vip-membership-card');
      if (vipCardEl) {
        pg.insertBefore(firstCard, vipCardEl.nextSibling);
      }
    }

    console.log('[VIP] ✅ 会员卡片已渲染');
  }

  // ===== 扫描 =====
  function scanProfile() {
    var pg = _id('page-profile');
    if (!pg) return;
    // 检测页面是否可见
    if (pg.style.display === 'none') return;
    if (pg.innerHTML.trim() === '') return;
    renderMembershipCard();
  }

  // ===== 初始化 =====
  function init() {
    var timer = null;
    var obs = new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(scanProfile, 200);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    scanProfile();
    console.log('[VIP] ✅ 会员体系模块已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // V137 暴露给主题系统使用（不破坏原 IIFE）
  try {
    window._vipLevels = VIP_LEVELS;
    window._getVipLevel = getLevel;
    window._getVipActiveDays = getActiveDays;
    window._vipMarkTodayActive = markTodayActive;
  } catch(e) { console.warn('[VIP] 暴露全局失败', e); }
})();
