// ============ 全局状态 ============
let currentPage = 'dashboard';
let currentParam = null;
let charts = {};
let bigScreenMode = false;

// ============ 货币体系 ============
// 国内平台用人民币，跨境平台用美元
const DOMESTIC_PLATFORMS = new Set(['淘宝','天猫','京东','拼多多','抖音小店','快手小店','小红书','唯品会','其他国内']);
const CROSS_BORDER_PLATFORMS = new Set(['SHEIN','Amazon','Temu','TikTok Shop','Shopee','Lazada','AliExpress','Wish','eBay','Etsy','独立站','其他跨境']);

// 判断平台货币
function getPlatformCurrency(platform) {
  return DOMESTIC_PLATFORMS.has(platform) ? 'CNY' : 'USD';
}

// 当前汇率（默认7.2，实时更新）
let USD_TO_CNY = 7.2;
let exchangeRateUpdatedAt = null;

// 获取实时汇率（免费API）
async function fetchExchangeRate() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!res.ok) throw new Error('汇率接口异常');
    const data = await res.json();
    if (data.rates && data.rates.CNY) {
      USD_TO_CNY = data.rates.CNY;
      exchangeRateUpdatedAt = new Date();
      updateExchangeRateDisplay();
      console.log('[汇率] 已更新：1 USD =', USD_TO_CNY.toFixed(4), 'CNY');
    }
  } catch(e) {
    // 备用汇率接口
    try {
      const res2 = await fetch('https://open.er-api.com/v6/latest/USD');
      const data2 = await res2.json();
      if (data2.rates && data2.rates.CNY) {
        USD_TO_CNY = data2.rates.CNY;
        exchangeRateUpdatedAt = new Date();
        updateExchangeRateDisplay();
      }
    } catch(e2) {
      console.warn('[汇率] 获取失败，使用默认值 7.2，原因：', e.message);
    }
  }
}

// 更新顶栏汇率显示
function updateExchangeRateDisplay() {
  const el = document.getElementById('exchange-rate-display');
  if (el) {
    el.textContent = `1 USD = ¥${USD_TO_CNY.toFixed(2)}`;
    el.title = exchangeRateUpdatedAt ? `更新时间：${exchangeRateUpdatedAt.toLocaleTimeString()}` : '实时汇率';
  }
}

// 格式化金额（自动识别货币）
function fmtMoneyByCurrency(amount, currency) {
  if (currency === 'USD') {
    return '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '¥' + (amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 将任意金额统一折算为人民币（用于汇总对比）
function toCNY(amount, currency) {
  if (currency === 'USD') return (amount || 0) * USD_TO_CNY;
  return amount || 0;
}

// 根据 shopId 获取该店铺的货币
function getShopCurrency(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) return 'CNY';
  return getPlatformCurrency(shop.platform);
}

// ============ 全局格式化工具函数 ============
// fmtMoney：格式化金额，默认人民币（向后兼容）
function fmtMoney(amount, currency) {
  const cur = currency || 'CNY';
  if (cur === 'USD') {
    return '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const n = amount || 0;
  if (n >= 10000) return '¥' + (n / 10000).toFixed(1) + 'w';
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// fmt：格式化数字（订单量等）
function fmt(n) {
  if (!n) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString('zh-CN');
}





// 面包屑配置
const PAGE_META = {
  dashboard:    { label: '数据看板',    icon: '' },
  styles:       { label: '款式分析',    icon: '' },
  revenue:      { label: '营业额统计',  icon: '' },
  profit:       { label: '利润计算',    icon: '' },
  alert:        { label: '预警中心',    icon: '' },
  import:       { label: '数据导入',    icon: '' },
  shops:        { label: '店铺管理',    icon: '' },
  'shop-detail':{ label: '店铺详情',    icon: '' },
  academy:      { label: '知识学院',    icon: '' },
  admin:        { label: '权限管理',    icon: '' },
  profile:      { label: '个人中心',    icon: '' },
};

// 科技感图表全局配置
const CHART_DEFAULTS = {
  color: {
    grid: 'rgba(255,255,255,0.04)',
    text: '#64748b',
    purple: '#7c3aed',
    cyan: '#06b6d4',
    green: '#10b981',
  }
};

// ============ 由 auth.js 调用的主应用初始化 ============
async function initMainApp() {
  initDemoData();
  applyDarkChartDefaults();
  initRipple();
  updateTopbarDate();
  setInterval(updateTopbarDate, 1000); // 每秒更新，时钟实时走动

  // 获取实时汇率，每小时刷新一次
  fetchExchangeRate();
  setInterval(fetchExchangeRate, 60 * 60 * 1000);

  if (SUPABASE_ENABLED) {
    renderShopNav();
    updateSidebarFooter();
    navigate('dashboard');
    await syncFromSupabase();
    renderShopNav();
    updateSidebarFooter();
    navigate(currentPage, currentParam);
    initRealtime();
    // 每2小时后台静默同步一次云端数据（不刷新页面，不打断用户操作）
    setInterval(async () => {
      await syncFromSupabase(true); // silent=true：不显示"正在同步"状态
      renderShopNav();
      updateSidebarFooter();
      // 注意：此处故意不调用 navigate()，避免用户正在填表时被重置
    }, 2 * 60 * 60 * 1000);
  } else {
    renderShopNav();
    updateSidebarFooter();
    navigate('dashboard');
    const el = document.getElementById('sync-status');
    if (el) { el.textContent = '本地模式'; el.style.color = '#475569'; }
  }
}

// 手动触发同步
async function manualSync() {
  if (!SUPABASE_ENABLED) {
    showToast('⚠ 请先配置 Supabase 连接信息', 'warn');
    return;
  }
  const ok = await syncFromSupabase();
  if (ok) {
    renderShopNav();
    updateSidebarFooter();
    navigate(currentPage, currentParam);
    showToast('✅ 已同步云端最新数据', 'success');
  }
};

// ============ 粒子背景 ============
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });

  const particles = Array.from({ length: 60 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.5 + 0.1,
    color: Math.random() > 0.5 ? '124,58,237' : '6,182,212',
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();
    });
    // 连线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(124,58,237,${0.08 * (1 - dist/100)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ============ Chart.js 暗黑主题默认值 ============
function applyDarkChartDefaults() {
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
  Chart.defaults.plugins.legend.labels.color = '#94a3b8';
  Chart.defaults.scale = Chart.defaults.scale || {};
}

// ============ 大屏模式 ============
function toggleBigScreen() {
  bigScreenMode = !bigScreenMode;
  document.body.classList.toggle('bigscreen-mode', bigScreenMode);
  const btn = document.getElementById('bigscreen-btn');
  if (btn) btn.textContent = bigScreenMode ? '⛶ 退出大屏' : '⛶ 大屏';
  showToast(bigScreenMode ? '🖥️ 已进入大屏模式' : '↩ 已退出大屏模式', 'info');
}

// ============ 顶部进度条 ============
function progressStart() {
  const fill = document.getElementById('nprogress-fill');
  fill.style.width = '0%';
  fill.style.transition = 'width 0.3s ease';
  requestAnimationFrame(() => { fill.style.width = '70%'; });
}
function progressDone() {
  const fill = document.getElementById('nprogress-fill');
  fill.style.transition = 'width 0.2s ease';
  fill.style.width = '100%';
  setTimeout(() => { fill.style.width = '0%'; fill.style.transition = 'none'; }, 350);
}

// ============ 面包屑 ============
function updateBreadcrumb(page, param) {
  const bc = document.getElementById('breadcrumb');
  const meta = PAGE_META[page] || { label: page, icon: '' };
  let crumbs = `<span class="bc-home">🛒 电商数据平台</span>`;
  crumbs += `<span class="bc-sep"> › </span>`;
  crumbs += `<span class="bc-cur">${meta.icon} ${meta.label}</span>`;
  if (page === 'shop-detail' && param) {
    const shopName = getShopName(param);
    crumbs = `<span class="bc-home" onclick="navigate('shops')" style="cursor:pointer">🏪 店铺管理</span>`;
    crumbs += `<span class="bc-sep"> › </span>`;
    crumbs += `<span class="bc-cur">${shopName}</span>`;
  }
  bc.innerHTML = crumbs;
}

// ============ 顶栏日期 ============
function updateTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const now = new Date();
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  el.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${days[now.getDay()]} ${hh}:${mm}`;
}

// ============ 侧边栏底部统计 ============
function updateSidebarFooter() {
  const shops = DB.getShops();
  const sales = DB.getSalesData();
  const el1 = document.getElementById('total-data-count');
  const el2 = document.getElementById('shop-total-count');
  const cnt = document.getElementById('shop-count-badge');
  if (el1) el1.textContent = sales.length.toLocaleString() + ' 条数据';
  if (el2) el2.textContent = shops.length + ' 家店铺';
  if (cnt) cnt.textContent = shops.length;
}

// ============ 刷新当前页面 ============
function refreshCurrentPage() {
  const btn = document.querySelector('.topbar-btn');
  if (btn) { btn.style.transform = 'rotate(360deg)'; setTimeout(() => btn.style.transform = '', 400); }
  navigate(currentPage, currentParam);
  showToast('🔄 数据已刷新', 'info');
}

// ============ 导航路由（带动画+权限检查） ============
function navigate(page, param) {
  // 权限检查（admin/profile/shop-detail 不受限）
  const freePages = ['admin', 'profile', 'shop-detail'];
  if (!freePages.includes(page) && typeof checkPagePermission === 'function') {
    if (!checkPagePermission(page)) {
      showToast('暂无权限，请联系管理员授权', 'error');
      return;
    }
  }

  progressStart();
  currentPage = page;
  currentParam = param || null;

  // 更新导航激活态
  document.querySelectorAll('.nav-item').forEach(el => {
    const isActive = el.dataset.page === page || el.dataset.page === `shop-detail-${param}`;
    el.classList.toggle('active', isActive);
  });

  // 隐藏所有页面（带退出动画）
  const activePg = document.querySelector('.page.active');
  if (activePg) {
    activePg.classList.add('page-exit');
    activePg.classList.remove('active');
    setTimeout(() => activePg.classList.remove('page-exit'), 200);
  }

  // 显示目标页面
  setTimeout(() => {
    let targetPg;
    if (page === 'shop-detail' && param) {
      targetPg = document.getElementById('page-shop-detail');
      renderShopDetail(param);
    } else {
      targetPg = document.getElementById('page-' + page);
      const renders = {
        dashboard: renderDashboard,
        styles: renderStyles,
        revenue: renderRevenue,
        profit: renderProfit,
        alert: renderAlert,
        import: renderImport,
        shops: renderShops,
        academy: renderAcademy,
        admin: renderAdmin,
        profile: renderProfile,
      };
      if (renders[page]) renders[page]();
    }
    if (targetPg) {
      targetPg.classList.add('active', 'page-enter');
      setTimeout(() => targetPg.classList.remove('page-enter'), 350);
    }
    const container = document.getElementById('page-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });

    updateBreadcrumb(page, param);
    destroyUnusedCharts(page);
    progressDone();
  }, activePg ? 150 : 0);
}

function destroyUnusedCharts(page) {
  Object.keys(charts).forEach(k => {
    if (!k.startsWith(page) && !k.startsWith('detail')) {
      try { charts[k].destroy(); } catch(e) {}
      delete charts[k];
    }
  });
}

// ============ 涟漪效果（全局） ============
function initRipple() {
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn-primary, .btn-secondary');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    r.className = 'ripple';
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.appendChild(r);
    setTimeout(() => r.remove(), 500);
  });
}

// ============ 手机端弹出菜单 ============
function showMobileMenu() {
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const name = CURRENT_USER ? (CURRENT_USER.nickname || CURRENT_USER.phone) : '用户';

  // 如果已存在则移除
  const existing = document.getElementById('mobile-menu-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'mobile-menu-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.6);
    display:flex;align-items:flex-end;
  `;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div style="width:100%;background:linear-gradient(180deg,#0d1117,#070b14);
      border-top:1px solid rgba(124,58,237,0.3);border-radius:20px 20px 0 0;
      padding:16px 0 ${window.innerHeight < 700 ? '8px' : '20px'};
      padding-bottom:calc(${window.innerHeight < 700 ? '8px' : '20px'} + env(safe-area-inset-bottom,0px))">
      <div style="text-align:center;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);
          display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;margin:0 auto 8px">
          ${name.charAt(0).toUpperCase()}
        </div>
        <div style="font-size:15px;font-weight:600;color:#e2e8f0">${name}</div>
        <div style="font-size:12px;color:#475569;margin-top:3px">${CURRENT_USER?.id === 'super_admin' ? '超级管理员' : (isAdmin ? '管理员' : '成员')}</div>
      </div>
      ${isAdmin ? `
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('admin')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
        权限管理
      </div>` : ''}
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('profile')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        个人中心
      </div>
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('shops')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        店铺管理
      </div>
      <div class="mobile-menu-item" style="color:#f87171" onclick="document.getElementById('mobile-menu-overlay').remove();doLogout()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        退出登录
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}


// ============ 数字滚动动画 ============
function animateNumber(el, target, prefix = '', suffix = '', duration = 800) {
  if (!el) return;
  const start = 0;
  const startTime = performance.now();
  const isFloat = target % 1 !== 0;
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    const current = start + (target - start) * ease;
    el.textContent = prefix + (isFloat ? current.toFixed(2) : Math.floor(current).toLocaleString()) + suffix;
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = prefix + (isFloat ? target.toFixed(2) : Math.floor(target).toLocaleString()) + suffix;
  }
  requestAnimationFrame(update);
}

// ============ 侧边栏店铺列表折叠 ============
let shopNavCollapsed = false;
function toggleShopNav() {
  shopNavCollapsed = !shopNavCollapsed;
  const collapse = document.getElementById('shop-nav-collapse');
  const arrow = document.getElementById('shop-nav-arrow');
  if (collapse) collapse.style.display = shopNavCollapsed ? 'none' : '';
  if (arrow) arrow.style.transform = shopNavCollapsed ? 'rotate(-90deg)' : '';
}

// ============ 侧边栏店铺列表 ============
function renderShopNav() {
  const shops = DB.getShops();
  const container = document.getElementById('shop-list-nav');
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  container.innerHTML = shops.map(s => {
    const isOwner = s.created_by && CURRENT_USER && s.created_by === CURRENT_USER.id;
    const hasAccessPerm = canDo('shop_access_' + s.id);
    const canView = isAdmin || isOwner || hasAccessPerm;
    if (canView) {
      return `<a class="nav-item shop-nav-item" data-page="shop-detail-${s.id}" onclick="navigate('shop-detail','${s.id}')">
        <span class="color-dot" style="background:${s.color}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</span>
      </a>`;
    } else {
      return `<div class="nav-item shop-nav-item" style="opacity:0.45;cursor:default;display:flex;align-items:center;justify-content:space-between;gap:4px">
        <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
          <span class="color-dot" style="background:${s.color};filter:grayscale(1)"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${s.name}</span>
        </div>
        <button onclick="event.stopPropagation();requestShopAccess('${s.id}','${s.name}')" style="flex-shrink:0;font-size:10px;color:#7c3aed;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:4px;padding:2px 6px;cursor:pointer;white-space:nowrap">申请</button>
      </div>`;
    }
  }).join('');
  updateSidebarFooter();
}

// ============ Toast 通知 ============
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  const icon = { success: '✅', error: '❌', info: 'ℹ️', '': '💬' };
  document.getElementById('toast-icon').textContent = icon[type] || icon[''];
  document.getElementById('toast-text').textContent = msg;
  t.className = 'toast' + (type ? ' toast-' + type : '') + ' show';
  setTimeout(() => t.classList.remove('show'), 2800);
}

function openModal(id) {
  const el = document.getElementById(id);
  el.style.display = 'flex';
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.style.display = 'none';
}
function openAddShop() { openModal('modal-add-shop'); }

// ============ 添加店铺 ============
async function addShop() {
  // 检查新建店铺操作权限
  if (!canDo('action_shop_create')) {
    showToast('⚠️ 您没有新建店铺的权限，请联系管理员授权', 'error');
    return;
  }
  const name = document.getElementById('new-shop-name').value.trim();
  if (!name) { showToast('请输入店铺名称', 'error'); return; }
  const shops = DB.getShops();
  const colors = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#a855f7','#f43f5e','#3b82f6','#e11d48'];
  const color = colors[shops.length % colors.length];
  const newShop = {
    id: 'shop_' + Date.now(),
    name,
    platform: document.getElementById('new-shop-platform').value,
    color,
    status: 'active',
    created_by: CURRENT_USER ? CURRENT_USER.id : null,  // 记录创建者
    created_at: new Date().toISOString(),
  };
  try {
    await DB.addShop(newShop);  // 等待云端写入完成
    renderShopNav();
    closeModal('modal-add-shop');
    document.getElementById('new-shop-name').value = '';
    if (currentPage === 'shops') renderShops();
    showToast(`🏪 店铺 "${name}" 添加成功，其他人30秒内可见`, 'success');
  } catch(e) {
    showToast(`⚠️ 店铺已本地保存，但云端同步失败：${e.message}`, 'error');
    renderShopNav();
    closeModal('modal-add-shop');
    document.getElementById('new-shop-name').value = '';
    if (currentPage === 'shops') renderShops();
  }
}

// ============ 删除店铺 ============
function deleteShop(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) return;

  // 权限检查
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const isOwner = shop.created_by && CURRENT_USER && shop.created_by === CURRENT_USER.id;
  const canDeleteAll = canDo('action_shop_delete_all');
  const canDeleteOwn = canDo('action_shop_delete_own');

  if (!isAdmin && !canDeleteAll && !(canDeleteOwn && isOwner)) {
    if (canDeleteOwn && !isOwner) {
      showToast('⚠️ 您只能删除自己创建的店铺', 'error');
    } else {
      showToast('⚠️ 您没有删除店铺的权限，请联系管理员授权', 'error');
    }
    return;
  }

  if (!confirm(`确定要删除店铺「${shop.name}」及其所有数据吗？此操作不可恢复。`)) return;
  DB.removeShop(shopId);  // 使用新方法，同时删云端
  let sales = DB.getSalesData().filter(d => d.shopId !== shopId);
  DB.setSalesData(sales);
  renderShopNav();
  renderShops();
  showToast('🗑️ 店铺已删除，云端已同步', 'info');
}

// ============ 申请店铺查看权限 ============
function requestShopAccess(shopId, shopName) {
  const applicant = CURRENT_USER ? (CURRENT_USER.nickname || CURRENT_USER.phone) : '未知用户';
  // 弹出确认提示
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:380px;width:90%;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">📬</div>
      <h3 style="color:#e2e8f0;margin-bottom:8px">申请查看权限</h3>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-bottom:20px">将向超级管理员发送申请，获批后即可查看<br><strong style="color:#a78bfa">「${shopName}」</strong>的数据</p>
      <div style="margin-bottom:14px">
        <textarea id="access-request-reason" placeholder="申请原因（可选，如：需要查看该店铺数据）" style="width:100%;height:72px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:8px;font-size:12px;resize:none;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="this.closest('[style*=position]').remove()" style="padding:8px 20px;border-radius:8px;background:#1e293b;border:1px solid #334155;color:#94a3b8;cursor:pointer">取消</button>
        <button onclick="submitShopAccessRequest('${shopId}','${shopName}',this)" style="padding:8px 20px;border-radius:8px;background:linear-gradient(135deg,#7c3aed,#6366f1);border:none;color:#fff;cursor:pointer;font-weight:600">确认申请</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function submitShopAccessRequest(shopId, shopName, btn) {
  const reason = document.getElementById('access-request-reason')?.value?.trim() || '';
  const applicant = CURRENT_USER ? (CURRENT_USER.nickname || CURRENT_USER.phone) : '未知用户';
  // 将申请记录写入 localStorage（管理员登录时可查看）
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  requests.push({
    id: 'req_' + Date.now(),
    shopId, shopName,
    applicantId: CURRENT_USER?.id,
    applicantName: applicant,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  btn.closest('[style*="position:fixed"]').remove();
  showToast(`✅ 申请已提交！管理员审核后通知您`, 'success');
  // 如果管理员在线，立即提示
  // (实际场景下可通知 Supabase，此处用本地模拟)
}


let dashboardTab = 'domestic'; // 'domestic' | 'cross'
let dashboardRefreshTimer = null;
let dashboardLastRefresh = null;
let dashboardCountdownTimer = null;

function renderDashboard() {
  const pg = document.getElementById('page-dashboard');

  // 骨架屏
  pg.innerHTML = `
    <div class="stat-grid">
      ${Array(4).fill('<div class="skeleton skeleton-stat"></div>').join('')}
    </div>
    <div class="chart-grid-3">
      <div class="card"><div class="skeleton skeleton-chart"></div></div>
      <div class="card"><div class="skeleton skeleton-chart"></div></div>
    </div>`;

  setTimeout(() => _renderDashboardContent(pg), 300);

  // 启动1小时自动刷新
  _startDashboardAutoRefresh();
}

function _startDashboardAutoRefresh() {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  if (dashboardCountdownTimer) clearInterval(dashboardCountdownTimer);
  dashboardLastRefresh = new Date();
  // 每1小时自动刷新
  dashboardRefreshTimer = setInterval(() => {
    if (currentPage === 'dashboard') {
      dashboardLastRefresh = new Date();
      _renderDashboardContent(document.getElementById('page-dashboard'));
      _updateDashboardRefreshInfo();
    }
  }, 60 * 60 * 1000);
  // 每分钟更新倒计时显示
  dashboardCountdownTimer = setInterval(_updateDashboardRefreshInfo, 60000);
}

function _updateDashboardRefreshInfo() {
  const el = document.getElementById('db-refresh-info');
  if (!el || !dashboardLastRefresh) return;
  const mins = Math.floor((new Date() - dashboardLastRefresh) / 60000);
  const nextMins = 60 - mins;
  el.textContent = `上次刷新：${mins < 1 ? '刚刚' : mins + '分钟前'} · ${nextMins > 0 ? nextMins + '分钟后自动刷新' : '即将刷新'}`;
}

function manualRefreshDashboard() {
  const btn = document.getElementById('db-manual-refresh-btn');
  if (btn) {
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s';
    setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
  }
  dashboardLastRefresh = new Date();
  _renderDashboardContent(document.getElementById('page-dashboard'));
  showToast('🔄 看板已刷新', 'info');
}

function switchDashboardTab(tab) {
  dashboardTab = tab;
  document.querySelectorAll('#db-tabs .db-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  _renderDashboardTabContent();
}

function _renderDashboardContent(pg) {
  const allShops = DB.getShops();
  const domesticShops = allShops.filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const crossShops = allShops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));

  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  pg.innerHTML = `
    <!-- 顶部标题行 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h1 style="font-size:20px;font-weight:700;color:#e2e8f0;margin:0">📊 数据看板</h1>
        <p style="font-size:12px;color:#64748b;margin:4px 0 0">过去30天综合数据概览</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span id="db-refresh-info" style="font-size:11px;color:#475569;"></span>
        <button id="db-manual-refresh-btn" onclick="manualRefreshDashboard()"
          style="display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:8px;border:1px solid rgba(124,58,237,0.4);background:rgba(124,58,237,0.12);color:#a78bfa;font-size:12px;cursor:pointer;transition:all .2s;"
          onmouseover="this.style.background='rgba(124,58,237,0.25)'" onmouseout="this.style.background='rgba(124,58,237,0.12)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          手动刷新
        </button>
      </div>
    </div>

    <!-- 国内/跨境切换Tab -->
    <div id="db-tabs" style="display:flex;gap:4px;margin-bottom:18px;background:rgba(15,23,42,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:4px;width:fit-content;">
      <div class="db-tab ${dashboardTab==='domestic'?'active':''}" data-tab="domestic" onclick="switchDashboardTab('domestic')"
        style="padding:7px 20px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;
               ${dashboardTab==='domestic'?'background:rgba(99,102,241,0.3);color:#a5b4fc;box-shadow:0 2px 8px rgba(99,102,241,0.2);':'color:#64748b;'}">
        🏠 国内看板
        <span style="font-size:11px;margin-left:4px;opacity:0.7">(${domesticShops.length}店)</span>
      </div>
      <div class="db-tab ${dashboardTab==='cross'?'active':''}" data-tab="cross" onclick="switchDashboardTab('cross')"
        style="padding:7px 20px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;
               ${dashboardTab==='cross'?'background:rgba(20,184,166,0.25);color:#5eead4;box-shadow:0 2px 8px rgba(20,184,166,0.15);':'color:#64748b;'}">
        🌐 跨境看板
        <span style="font-size:11px;margin-left:4px;opacity:0.7">(${crossShops.length}店)</span>
      </div>
    </div>

    <!-- Tab内容区 -->
    <div id="db-tab-content"></div>`;

  _updateDashboardRefreshInfo();
  _renderDashboardTabContent();
}

function _renderDashboardTabContent() {
  const container = document.getElementById('db-tab-content');
  if (!container) return;
  if (dashboardTab === 'domestic') {
    _renderDomesticDashboard(container);
  } else {
    _renderCrossDashboard(container);
  }
}

// ---- 国内看板 ----
function _renderDomesticDashboard(container) {
  const allShops = DB.getShops();
  const domesticShops = allShops.filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const domesticIds = new Set(domesticShops.map(s => s.id));

  const allData = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) })
    .filter(d => domesticIds.has(d.shopId));
  const prevData = aggregateSales({ startDate: getPastDate(60), endDate: getPastDate(31) })
    .filter(d => domesticIds.has(d.shopId));

  const totalRev = allData.reduce((s, d) => s + d.revenue, 0);
  const totalOrd = allData.reduce((s, d) => s + d.orders, 0);
  const prevRev = prevData.reduce((s, d) => s + d.revenue, 0);
  const prevOrd = prevData.reduce((s, d) => s + d.orders, 0);
  const revGrow = prevRev ? ((totalRev - prevRev) / prevRev * 100).toFixed(1) : 0;
  const ordGrow = prevOrd ? ((totalOrd - prevOrd) / prevOrd * 100).toFixed(1) : 0;
  const styleData = sumByStyle(allData);
  const hotStyles = styleData.filter(s => s.shopCount >= Math.max(2, domesticShops.length * 0.6)).length;

  if (domesticShops.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#475569;">
      <div style="font-size:40px;margin-bottom:12px">🏠</div>
      <div style="font-size:15px;font-weight:600;color:#64748b">暂无国内店铺</div>
      <div style="font-size:12px;color:#475569;margin-top:6px">请先在店铺管理中添加淘宝/天猫/京东等国内平台店铺</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <!-- AI分析 -->
    <div class="ai-insight" style="margin-bottom:18px">
      <div class="data-flow-line"></div>
      <div class="ai-insight-header">
        <span class="ai-badge">✦ AI 智能分析</span>
        <span class="ai-insight-title">国内店铺经营洞察</span>
      </div>
      <div class="ai-insights-list">
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>国内营业额较上月<strong style="color:${revGrow>=0?'#f87171':'#34d399'}">${revGrow>=0?'增长':'下降'} ${Math.abs(revGrow)}%</strong>，${revGrow>=5?'增势强劲，建议加大备货':revGrow>0?'小幅增长，保持稳健':revGrow>-5?'略有下滑，关注流量与转化':'下滑明显，建议排查各店铺问题'}</span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>共 <strong style="color:#a78bfa">${domesticShops.length} 家国内店铺</strong> 在线，发现 <strong style="color:#f59e0b">${hotStyles} 款</strong>跨店爆款</span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>客单价 <strong style="color:#22d3ee">¥${(totalOrd ? totalRev/totalOrd : 0).toFixed(0)}</strong>，${totalOrd && totalRev/totalOrd > 60 ? '客单价表现良好' : '建议适当提升商品单价'}</span></div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">💰</div>
        <div class="stat-label">近30天总营业额</div>
        <div class="stat-value" id="dsv-rev">¥0</div>
        <div class="stat-sub ${revGrow>=0?'stat-up':'stat-down'}">${revGrow>=0?'↑':'↓'} ${Math.abs(revGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="dsbar-rev" style="width:0%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">近30天总订单</div>
        <div class="stat-value" id="dsv-ord">0</div>
        <div class="stat-sub ${ordGrow>=0?'stat-up':'stat-down'}">${ordGrow>=0?'↑':'↓'} ${Math.abs(ordGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="dsbar-ord" style="width:0%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏠</div>
        <div class="stat-label">国内活跃店铺</div>
        <div class="stat-value" id="dsv-shops">0</div>
        <div class="stat-sub" style="color:#64748b">国内平台运营中</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="dsbar-shops" style="width:100%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔥</div>
        <div class="stat-label">跨店爆款数</div>
        <div class="stat-value" id="dsv-hot">0</div>
        <div class="stat-sub" style="color:#64748b">覆盖60%+店铺</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="dsbar-hot" style="width:0%"></div></div>
      </div>
    </div>

    <!-- 图表 -->
    <div class="chart-grid-3">
      <div class="card"><div class="card-title">📈 近30天营业额趋势（国内）</div><div class="chart-wrap"><canvas id="chart-d-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🏠 国内店铺营业额占比</div><div class="chart-wrap"><canvas id="chart-d-pie"></canvas></div></div>
    </div>
    <div class="chart-grid-3" style="margin-top:16px">
      <div class="card"><div class="card-title">📦 近30天订单量趋势</div><div class="chart-wrap"><canvas id="chart-d-orders"></canvas></div></div>
      <div class="card"><div class="card-title">🏆 各店铺营业额对比</div><div class="chart-wrap"><canvas id="chart-d-shopbar"></canvas></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title">🏆 国内店铺营业额排行</div><div id="d-shop-rank-list"></div></div>
      <div class="card"><div class="card-title">🔥 爆款TOP10（国内）</div><div id="d-style-rank-list"></div></div>
    </div>`;

  // 数字动画
  animateNumber(document.getElementById('dsv-rev'), totalRev, '¥', '', 900);
  animateNumber(document.getElementById('dsv-ord'), totalOrd, '', '', 700);
  animateNumber(document.getElementById('dsv-shops'), domesticShops.length, '', '', 500);
  animateNumber(document.getElementById('dsv-hot'), hotStyles, '', '', 600);
  setTimeout(() => {
    const b1 = document.getElementById('dsbar-rev');
    const b2 = document.getElementById('dsbar-ord');
    const b4 = document.getElementById('dsbar-hot');
    if (b1) b1.style.width = Math.min(100, totalRev/Math.max(prevRev,1)*60) + '%';
    if (b2) b2.style.width = Math.min(100, totalOrd/Math.max(prevOrd,1)*60) + '%';
    if (b4) b4.style.width = Math.min(100, hotStyles/Math.max(styleData.length,1)*100) + '%';
  }, 400);

  // 趋势图
  const byDate = sumByDate(allData);
  if (charts['d-trend']) { try { charts['d-trend'].destroy(); } catch(e) {} }
  charts['d-trend'] = new Chart(document.getElementById('chart-d-trend'), {
    type: 'line',
    data: {
      labels: byDate.map(d => d.date.slice(5)),
      datasets: [{
        label: '营业额(¥)', data: byDate.map(d => d.revenue),
        borderColor: '#6366f1',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,260);
          g.addColorStop(0, 'rgba(99,102,241,0.25)');
          g.addColorStop(1, 'rgba(99,102,241,0.01)');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 6,
        pointBackgroundColor: '#6366f1', borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(99,102,241,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff', padding: 10,
          callbacks: { label: ctx => '  营业额：¥' + ctx.raw.toLocaleString() } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '¥' + (v/1000).toFixed(0) + 'k' }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // 饼图
  const shopSum = sumByShop(allData).sort((a,b) => b.revenue - a.revenue);
  if (charts['d-pie']) { try { charts['d-pie'].destroy(); } catch(e) {} }
  charts['d-pie'] = new Chart(document.getElementById('chart-d-pie'), {
    type: 'doughnut',
    data: {
      labels: shopSum.map(s => getShopName(s.shopId)),
      datasets: [{ data: shopSum.map(s => s.revenue), backgroundColor: shopSum.map(s => getShopColor(s.shopId)), borderWidth: 2, borderColor: '#070b14', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 8 } },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(99,102,241,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff',
          callbacks: { label: ctx => '  ' + ctx.label + '：¥' + ctx.raw.toLocaleString() } }
      },
      animation: { duration: 900, animateRotate: true, animateScale: true }
    }
  });

  // 订单量趋势图（国内）
  if (charts['d-orders']) { try { charts['d-orders'].destroy(); } catch(e) {} }
  charts['d-orders'] = new Chart(document.getElementById('chart-d-orders'), {
    type: 'line',
    data: {
      labels: byDate.map(d => d.date.slice(5)),
      datasets: [{
        label: '订单量', data: byDate.map(d => d.orders),
        borderColor: '#a78bfa',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,260);
          g.addColorStop(0, 'rgba(167,139,250,0.22)');
          g.addColorStop(1, 'rgba(167,139,250,0.01)');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 6,
        pointBackgroundColor: '#a78bfa', borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(167,139,250,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff', padding: 10,
          callbacks: { label: ctx => '  订单量：' + ctx.raw.toLocaleString() + ' 单' } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // 各店铺营业额柱状对比图（国内）
  const shopBarData = shopSum.slice(0, 8);
  if (charts['d-shopbar']) { try { charts['d-shopbar'].destroy(); } catch(e) {} }
  charts['d-shopbar'] = new Chart(document.getElementById('chart-d-shopbar'), {
    type: 'bar',
    data: {
      labels: shopBarData.map(s => getShopName(s.shopId)),
      datasets: [{
        label: '营业额(¥)', data: shopBarData.map(s => s.revenue),
        backgroundColor: shopBarData.map(s => getShopColor(s.shopId) + 'cc'),
        borderColor: shopBarData.map(s => getShopColor(s.shopId)),
        borderWidth: 1, borderRadius: 5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(99,102,241,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff', padding: 10,
          callbacks: { label: ctx => '  营业额：¥' + ctx.raw.toLocaleString() } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '¥' + (v/1000).toFixed(0) + 'k' }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b', maxRotation: 30 }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // 店铺排行
  document.getElementById('d-shop-rank-list').innerHTML = `<ul class="rank-list">${
    shopSum.slice(0,8).map((s,i) => `
      <li class="rank-item" style="cursor:pointer" onclick="navigate('shop-detail','${s.shopId}')">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info"><div class="rank-name">${getShopName(s.shopId)}</div><div class="rank-detail">${fmt(s.orders)} 单</div></div>
        <span class="rank-val">${fmtMoney(s.revenue)}</span>
      </li>`).join('')
  }</ul>`;

  // 款式排行
  const styleRank = styleData.sort((a,b) => b.revenue - a.revenue);
  document.getElementById('d-style-rank-list').innerHTML = `<ul class="rank-list">${
    styleRank.slice(0,10).map((s,i) => `
      <li class="rank-item">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info"><div class="rank-name">${s.styleName}</div><div class="rank-detail">覆盖${s.shopCount}家 · ${fmt(s.orders)}单</div></div>
        <span class="rank-val">${fmtMoney(s.revenue)}</span>
      </li>`).join('')
  }</ul>`;
}

// ---- 跨境看板 ----
function _renderCrossDashboard(container) {
  const allShops = DB.getShops();
  const crossShops = allShops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));
  const crossIds = new Set(crossShops.map(s => s.id));

  const allData = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) })
    .filter(d => crossIds.has(d.shopId));
  const prevData = aggregateSales({ startDate: getPastDate(60), endDate: getPastDate(31) })
    .filter(d => crossIds.has(d.shopId));

  const totalRevRaw = allData.reduce((s, d) => s + d.revenue, 0);
  const totalOrd = allData.reduce((s, d) => s + d.orders, 0);
  const prevRevRaw = prevData.reduce((s, d) => s + d.revenue, 0);
  const prevOrd = prevData.reduce((s, d) => s + d.orders, 0);
  const revGrow = prevRevRaw ? ((totalRevRaw - prevRevRaw) / prevRevRaw * 100).toFixed(1) : 0;
  const ordGrow = prevOrd ? ((totalOrd - prevOrd) / prevOrd * 100).toFixed(1) : 0;
  const styleData = sumByStyle(allData);
  const hotStyles = styleData.filter(s => s.shopCount >= Math.max(2, crossShops.length * 0.6)).length;
  // 跨境金额折算为美元显示
  const totalRevUSD = totalRevRaw / USD_TO_CNY;
  const prevRevUSD = prevRevRaw / USD_TO_CNY;

  if (crossShops.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#475569;">
      <div style="font-size:40px;margin-bottom:12px">🌐</div>
      <div style="font-size:15px;font-weight:600;color:#64748b">暂无跨境店铺</div>
      <div style="font-size:12px;color:#475569;margin-top:6px">请先在店铺管理中添加SHEIN/Amazon/Temu等跨境平台店铺</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <!-- AI分析 -->
    <div class="ai-insight" style="margin-bottom:18px">
      <div class="data-flow-line"></div>
      <div class="ai-insight-header">
        <span class="ai-badge" style="background:rgba(20,184,166,0.2);color:#5eead4;border-color:rgba(20,184,166,0.3)">✦ AI 智能分析</span>
        <span class="ai-insight-title">跨境店铺经营洞察</span>
      </div>
      <div class="ai-insights-list">
        <div class="ai-insight-item"><div class="ai-insight-dot" style="background:#14b8a6"></div><span>跨境营业额较上月<strong style="color:${revGrow>=0?'#f87171':'#34d399'}">${revGrow>=0?'增长':'下降'} ${Math.abs(revGrow)}%</strong>，${revGrow>=5?'增势强劲，建议扩大备货规模':revGrow>0?'稳步增长，继续保持':revGrow>-5?'小幅下滑，关注平台流量变化':'下滑较多，建议检查各站点排名与广告'}</span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot" style="background:#14b8a6"></div><span>共 <strong style="color:#5eead4">${crossShops.length} 家跨境店铺</strong> 运营中，当前汇率 <strong style="color:#fbbf24">1 USD = ¥${USD_TO_CNY.toFixed(2)}</strong></span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot" style="background:#14b8a6"></div><span>客单价 <strong style="color:#22d3ee">$${(totalOrd ? totalRevUSD/totalOrd : 0).toFixed(2)}</strong>，${hotStyles > 0 ? `发现 ${hotStyles} 款跨境爆款，可同步到多店推广` : '暂未发现跨店爆款，继续积累销售数据'}</span></div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">💵</div>
        <div class="stat-label">近30天总营业额</div>
        <div class="stat-value" id="csv-rev" style="color:#5eead4">$0</div>
        <div class="stat-sub ${revGrow>=0?'stat-up':'stat-down'}">${revGrow>=0?'↑':'↓'} ${Math.abs(revGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="csbar-rev" style="width:0%;background:linear-gradient(90deg,#14b8a6,#06b6d4)"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">近30天总订单</div>
        <div class="stat-value" id="csv-ord">0</div>
        <div class="stat-sub ${ordGrow>=0?'stat-up':'stat-down'}">${ordGrow>=0?'↑':'↓'} ${Math.abs(ordGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="csbar-ord" style="width:0%;background:linear-gradient(90deg,#14b8a6,#06b6d4)"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🌐</div>
        <div class="stat-label">跨境活跃店铺</div>
        <div class="stat-value" id="csv-shops">0</div>
        <div class="stat-sub" style="color:#64748b">跨境平台运营中</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="csbar-shops" style="width:100%;background:linear-gradient(90deg,#14b8a6,#06b6d4)"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💱</div>
        <div class="stat-label">折算人民币总额</div>
        <div class="stat-value" id="csv-cny" style="font-size:18px">¥0</div>
        <div class="stat-sub" style="color:#64748b">按实时汇率换算</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="csbar-cny" style="width:0%;background:linear-gradient(90deg,#f59e0b,#f97316)"></div></div>
      </div>
    </div>

    <!-- 图表 -->
    <div class="chart-grid-3">
      <div class="card"><div class="card-title">📈 近30天营业额趋势（跨境$）</div><div class="chart-wrap"><canvas id="chart-c-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🌐 跨境店铺营业额占比</div><div class="chart-wrap"><canvas id="chart-c-pie"></canvas></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title">🏆 跨境店铺营业额排行</div><div id="c-shop-rank-list"></div></div>
      <div class="card"><div class="card-title">🔥 爆款TOP10（跨境）</div><div id="c-style-rank-list"></div></div>
    </div>`;

  // 数字动画
  animateNumber(document.getElementById('csv-rev'), totalRevUSD, '$', '', 900);
  animateNumber(document.getElementById('csv-ord'), totalOrd, '', '', 700);
  animateNumber(document.getElementById('csv-shops'), crossShops.length, '', '', 500);
  animateNumber(document.getElementById('csv-cny'), totalRevRaw, '¥', '', 800);
  setTimeout(() => {
    const b1 = document.getElementById('csbar-rev');
    const b2 = document.getElementById('csbar-ord');
    const b3 = document.getElementById('csbar-cny');
    if (b1) b1.style.width = Math.min(100, totalRevRaw/Math.max(prevRevRaw,1)*60) + '%';
    if (b2) b2.style.width = Math.min(100, totalOrd/Math.max(prevOrd,1)*60) + '%';
    if (b3) b3.style.width = Math.min(100, totalRevRaw/Math.max(prevRevRaw,1)*60) + '%';
  }, 400);

  // 趋势图（青色）
  const byDate = sumByDate(allData);
  if (charts['c-trend']) { try { charts['c-trend'].destroy(); } catch(e) {} }
  charts['c-trend'] = new Chart(document.getElementById('chart-c-trend'), {
    type: 'line',
    data: {
      labels: byDate.map(d => d.date.slice(5)),
      datasets: [{
        label: '营业额($)', data: byDate.map(d => +(d.revenue / USD_TO_CNY).toFixed(2)),
        borderColor: '#14b8a6',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,260);
          g.addColorStop(0, 'rgba(20,184,166,0.25)');
          g.addColorStop(1, 'rgba(20,184,166,0.01)');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 6,
        pointBackgroundColor: '#14b8a6', borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(20,184,166,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff', padding: 10,
          callbacks: { label: ctx => '  营业额：$' + ctx.raw.toLocaleString() } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '$' + v.toFixed(0) }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // 饼图
  const shopSum = sumByShop(allData).sort((a,b) => b.revenue - a.revenue);
  if (charts['c-pie']) { try { charts['c-pie'].destroy(); } catch(e) {} }
  charts['c-pie'] = new Chart(document.getElementById('chart-c-pie'), {
    type: 'doughnut',
    data: {
      labels: shopSum.map(s => getShopName(s.shopId)),
      datasets: [{ data: shopSum.map(s => s.revenue), backgroundColor: shopSum.map(s => getShopColor(s.shopId)), borderWidth: 2, borderColor: '#070b14', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 8 } },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(20,184,166,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff',
          callbacks: { label: ctx => '  ' + ctx.label + '：$' + (ctx.raw / USD_TO_CNY).toFixed(2) } }
      },
      animation: { duration: 900, animateRotate: true, animateScale: true }
    }
  });

  // 店铺排行
  document.getElementById('c-shop-rank-list').innerHTML = `<ul class="rank-list">${
    shopSum.slice(0,8).map((s,i) => `
      <li class="rank-item" style="cursor:pointer" onclick="navigate('shop-detail','${s.shopId}')">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info"><div class="rank-name">${getShopName(s.shopId)}</div><div class="rank-detail">${fmt(s.orders)} 单</div></div>
        <span class="rank-val" style="color:#5eead4">$${(s.revenue/USD_TO_CNY).toFixed(2)}</span>
      </li>`).join('')
  }</ul>`;

  // 款式排行
  const styleRank = styleData.sort((a,b) => b.revenue - a.revenue);
  document.getElementById('c-style-rank-list').innerHTML = `<ul class="rank-list">${
    styleRank.slice(0,10).map((s,i) => `
      <li class="rank-item">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info"><div class="rank-name">${s.styleName}</div><div class="rank-detail">覆盖${s.shopCount}家 · ${fmt(s.orders)}单</div></div>
        <span class="rank-val" style="color:#5eead4">$${(s.revenue/USD_TO_CNY).toFixed(2)}</span>
      </li>`).join('')
  }</ul>`;
}

// ============================================
//  页面：款式分析
// ============================================
function renderStyles() {
  const pg = document.getElementById('page-styles');
  const shops = DB.getShops();
  pg.innerHTML = `
    <div class="header-row">
      <h1>👗 款式分析</h1>
      <div class="btn-group">
        <select id="style-period" onchange="renderStyles()" style="border:1px solid #e5e7eb;border-radius:7px;padding:7px 12px;font-size:13px;">
          <option value="30">近30天</option>
          <option value="60">近60天</option>
          <option value="90">近90天</option>
          <option value="180">近180天</option>
        </select>
      </div>
    </div>
    <div class="tabs" id="style-tabs">
      <div class="tab active" onclick="switchStyleTab('hot')">🔥 跨店爆款</div>
      <div class="tab" onclick="switchStyleTab('rank')">📊 款式排行</div>
      <div class="tab" onclick="switchStyleTab('compare')">🔄 店铺对比</div>
    </div>
    <div id="style-tab-content"></div>`;
  switchStyleTab('hot');
}

function switchStyleTab(tab) {
  document.querySelectorAll('#style-tabs .tab').forEach((el,i) => {
    el.classList.toggle('active', ['hot','rank','compare'][i] === tab);
  });
  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const data = aggregateSales({ startDate: getPastDate(days), endDate: getPastDate(0) });
  const shops = DB.getShops();
  const styleSum = sumByStyle(data).sort((a,b) => b.revenue - a.revenue);
  const container = document.getElementById('style-tab-content');

  if (tab === 'hot') {
    // 跨店爆款：覆盖3家及以上店铺
    const hotThreshold = Math.max(3, Math.floor(shops.length * 0.4));
    const hotStyles = styleSum.filter(s => s.shopCount >= hotThreshold);
    container.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">🔥 跨店爆款（覆盖≥${hotThreshold}家店铺）</div>
        <p style="font-size:12px;color:#9ca3af;margin-bottom:14px">这些款式在多家店铺均有销售，适合在所有店铺同步推广</p>
        <div class="table-wrap"><table>
          <thead><tr><th>款式名称</th><th>覆盖店铺数</th><th>总订单</th><th>总营业额</th><th>店铺分布</th><th>建议</th></tr></thead>
          <tbody>${hotStyles.map(s => `
            <tr>
              <td><strong>${s.styleName}</strong></td>
              <td><span class="badge badge-purple">${s.shopCount}/${shops.length} 家</span></td>
              <td>${fmt(s.orders)}</td>
              <td style="color:#6366f1;font-weight:700">${fmtMoney(s.revenue)}</td>
              <td style="font-size:11px;color:#6b7280">${s.shops.slice(0,4).map(id => getShopName(id)).join('、')}${s.shops.length>4?'...':''}</td>
              <td><span class="badge badge-green">全店推广</span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">📊 爆款覆盖率图</div>
        <div class="chart-wrap"><canvas id="chart-hot-bar"></canvas></div>
      </div>`;

    if (charts['style-hot']) charts['style-hot'].destroy();
    const top10 = hotStyles.slice(0, 10);
    charts['style-hot'] = new Chart(document.getElementById('chart-hot-bar'), {
      type: 'bar',
      data: {
        labels: top10.map(s => s.styleName),
        datasets: [
          { label: '覆盖店铺数', data: top10.map(s => s.shopCount), backgroundColor: '#6366f1', yAxisID: 'y1' },
          { label: '营业额(¥)', data: top10.map(s => s.revenue), backgroundColor: 'rgba(16,185,129,0.5)', type: 'line', yAxisID: 'y2', tension: 0.4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } },
        scales: { y1: { position: 'left', title: { display: true, text: '店铺数' } }, y2: { position: 'right', title: { display: true, text: '营业额' }, ticks: { callback: v => '¥' + (v/1000).toFixed(0) + 'k' } } }
      }
    });

  } else if (tab === 'rank') {
    container.innerHTML = `
      <div class="filter-bar">
        <label>筛选店铺：</label>
        <select id="rank-shop-filter" onchange="filterStyleRank()">
          <option value="">全部店铺</option>
          ${shops.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <label>排序：</label>
        <select id="rank-sort" onchange="filterStyleRank()">
          <option value="revenue">营业额</option>
          <option value="orders">订单量</option>
          <option value="shopCount">店铺覆盖</option>
        </select>
      </div>
      <div class="card"><div class="card-title">📊 款式完整排行榜</div>
        <div class="table-wrap"><table id="style-rank-table">
          <thead><tr><th>排名</th><th>款式名称</th><th>总订单</th><th>总营业额</th><th>覆盖店铺</th><th>均价</th></tr></thead>
          <tbody id="style-rank-tbody"></tbody>
        </table></div>
      </div>`;
    filterStyleRank();

  } else if (tab === 'compare') {
    container.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">🔄 各款式在所有店铺的销售对比</div>
        <div class="filter-bar" style="margin-bottom:0;background:transparent;padding:0;box-shadow:none">
          <label>选择款式：</label>
          <select id="compare-style" onchange="renderStyleCompare()">
            ${[...new Set(DB.getSalesData().map(d => d.styleId))].map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="chart-grid">
        <div class="card"><div class="card-title">各店铺该款订单量</div><div class="chart-wrap"><canvas id="chart-compare-orders"></canvas></div></div>
        <div class="card"><div class="card-title">各店铺该款营业额</div><div class="chart-wrap"><canvas id="chart-compare-rev"></canvas></div></div>
      </div>`;
    renderStyleCompare();
  }
}

function filterStyleRank() {
  const shopFilter = document.getElementById('rank-shop-filter')?.value;
  const sort = document.getElementById('rank-sort')?.value || 'revenue';
  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const filters = { startDate: getPastDate(days), endDate: getPastDate(0) };
  if (shopFilter) filters.shopId = shopFilter;
  const data = aggregateSales(filters);
  const styleSum = sumByStyle(data).sort((a,b) => b[sort] - a[sort]);
  const tbody = document.getElementById('style-rank-tbody');
  if (!tbody) return;
  tbody.innerHTML = styleSum.map((s,i) => `
    <tr>
      <td><strong>#${i+1}</strong></td>
      <td>${s.styleName}</td>
      <td>${fmt(s.orders)}</td>
      <td style="color:#6366f1;font-weight:700">${fmtMoney(s.revenue)}</td>
      <td><span class="badge ${s.shopCount >= DB.getShops().length*0.6 ? 'badge-green':'badge-blue'}">${s.shopCount}家</span></td>
      <td>${fmtMoney(s.revenue / Math.max(s.orders, 1))}</td>
    </tr>`).join('');
}

function renderStyleCompare() {
  const styleId = document.getElementById('compare-style')?.value;
  if (!styleId) return;
  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const data = aggregateSales({ startDate: getPastDate(days), endDate: getPastDate(0), styleId });
  const shopSum = sumByShop(data).sort((a,b) => b.revenue - a.revenue);
  const shops = DB.getShops();
  const labels = shopSum.map(s => getShopName(s.shopId));
  const colors = shopSum.map(s => getShopColor(s.shopId));

  if (charts['compare-orders']) charts['compare-orders'].destroy();
  charts['compare-orders'] = new Chart(document.getElementById('chart-compare-orders'), {
    type: 'bar',
    data: { labels, datasets: [{ data: shopSum.map(s => s.orders), backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y' }
  });

  if (charts['compare-rev']) charts['compare-rev'].destroy();
  charts['compare-rev'] = new Chart(document.getElementById('chart-compare-rev'), {
    type: 'bar',
    data: { labels, datasets: [{ data: shopSum.map(s => s.revenue), backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y', scales: { x: { ticks: { callback: v => '¥' + (v/1000).toFixed(0) + 'k' } } } }
  });
}

// ============================================
//  页面：营业额统计
// ============================================
function renderRevenue() {
  const pg = document.getElementById('page-revenue');
  const shops = DB.getShops();
  const today = '2026-03-24';
  const monthStart = '2026-03-01';
  pg.innerHTML = `
    <div class="header-row"><h1>💰 营业额统计</h1></div>
    <div class="tabs" id="rev-tabs">
      <div class="tab active" onclick="switchRevTab('daily')">📅 日期查询</div>
      <div class="tab" onclick="switchRevTab('monthly')">📆 月度报表</div>
      <div class="tab" onclick="switchRevTab('trend')">📈 趋势分析</div>
    </div>
    <div id="rev-tab-content"></div>`;
  switchRevTab('daily');
}

function switchRevTab(tab) {
  document.querySelectorAll('#rev-tabs .tab').forEach((el,i) => {
    el.classList.toggle('active', ['daily','monthly','trend'][i] === tab);
  });
  const shops = DB.getShops();
  const container = document.getElementById('rev-tab-content');

  if (tab === 'daily') {
    container.innerHTML = `
      <div class="filter-bar">
        <label>开始日期：</label><input type="date" id="rev-start" value="2026-03-01" onchange="queryDailyRev()">
        <label>结束日期：</label><input type="date" id="rev-end" value="2026-03-24" onchange="queryDailyRev()">
        <label>店铺：</label>
        <select id="rev-shop" onchange="queryDailyRev()">
          <option value="">全部店铺</option>
          ${shops.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <button class="btn-primary btn-sm" onclick="queryDailyRev()">查询</button>
      </div>
      <div class="chart-grid">
        <div class="card"><div class="card-title">📈 营业额曲线</div><div class="chart-wrap"><canvas id="chart-daily-rev"></canvas></div></div>
        <div class="card"><div class="card-title">📦 订单量曲线</div><div class="chart-wrap"><canvas id="chart-daily-ord"></canvas></div></div>
      </div>
      <div class="card"><div class="card-title">📋 每日明细</div><div class="table-wrap"><table>
        <thead><tr><th>日期</th><th>营业额</th><th>订单量</th><th>日均客单价</th></tr></thead>
        <tbody id="daily-tbody"></tbody>
      </table></div></div>`;
    queryDailyRev();

  } else if (tab === 'monthly') {
    container.innerHTML = `
      <div class="filter-bar">
        <label>年份：</label>
        <select id="rev-year" onchange="queryMonthlyRev()">
          <option value="2026">2026年</option>
          <option value="2025">2025年</option>
        </select>
        <label>店铺：</label>
        <select id="rev-month-shop" onchange="queryMonthlyRev()">
          <option value="">全部店铺</option>
          ${shops.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">📊 月度营业额柱状图</div><div class="chart-wrap"><canvas id="chart-monthly-bar"></canvas></div></div>
      <div class="card"><div class="card-title">📋 月度明细</div><div class="table-wrap"><table>
        <thead><tr><th>月份</th><th>营业额</th><th>订单量</th><th>环比增长</th></tr></thead>
        <tbody id="monthly-tbody"></tbody>
      </table></div></div>`;
    queryMonthlyRev();

  } else if (tab === 'trend') {
    container.innerHTML = `
      <div class="filter-bar">
        <label>时间范围：</label>
        <select id="trend-period" onchange="queryTrendRev()">
          <option value="30">近30天</option>
          <option value="60">近60天</option>
          <option value="90">近90天</option>
          <option value="180">近180天</option>
        </select>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-title">📈 各店铺营业额趋势对比</div><div class="chart-wrap" style="height:320px"><canvas id="chart-trend-shops"></canvas></div></div>
      <div class="card"><div class="card-title">📊 月度店铺堆叠营业额</div><div class="chart-wrap"><canvas id="chart-trend-stack"></canvas></div></div>`;
    queryTrendRev();
  }
}

function queryDailyRev() {
  const start = document.getElementById('rev-start')?.value;
  const end = document.getElementById('rev-end')?.value;
  const shopId = document.getElementById('rev-shop')?.value;
  if (!start || !end) return;
  const filters = { startDate: start, endDate: end };
  if (shopId) filters.shopId = shopId;
  const data = aggregateSales(filters);
  const byDate = sumByDate(data);

  const labels = byDate.map(d => d.date.slice(5));
  const revs = byDate.map(d => d.revenue);
  const ords = byDate.map(d => d.orders);

  if (charts['rev-daily']) charts['rev-daily'].destroy();
  charts['rev-daily'] = new Chart(document.getElementById('chart-daily-rev'), {
    type: 'line',
    data: { labels, datasets: [{ label: '营业额(¥)', data: revs, borderColor: '#7c3aed', backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0,0,0,260); g.addColorStop(0,'rgba(124,58,237,0.2)'); g.addColorStop(1,'rgba(124,58,237,0.01)'); return g; }, fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2, pointBackgroundColor: '#7c3aed' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1, titleColor: '#94a3b8', bodyColor: '#fff' } }, scales: { y: { ticks: { color: '#64748b', callback: v => '¥' + (v/1000).toFixed(1) + 'k' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }, x: { ticks: { color: '#64748b' }, grid: { display: false }, border: { display: false } } }, animation: { duration: 700, easing: 'easeOutCubic' } }
  });

  if (charts['rev-ord']) charts['rev-ord'].destroy();
  charts['rev-ord'] = new Chart(document.getElementById('chart-daily-ord'), {
    type: 'bar',
    data: { labels, datasets: [{ label: '订单量', data: ords, backgroundColor: ords.map((v,i) => `rgba(6,182,212,${0.4+i/ords.length*0.4})`), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(6,182,212,0.4)', borderWidth: 1, titleColor: '#94a3b8', bodyColor: '#fff' } }, scales: { y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }, x: { ticks: { color: '#64748b' }, grid: { display: false }, border: { display: false } } }, animation: { duration: 700 } }
  });

  const tbody = document.getElementById('daily-tbody');
  if (tbody) tbody.innerHTML = byDate.reverse().map(d => `
    <tr>
      <td>${d.date}</td>
      <td style="color:#6366f1;font-weight:700">${fmtMoney(d.revenue)}</td>
      <td>${fmt(d.orders)}</td>
      <td>${fmtMoney(d.revenue / Math.max(d.orders, 1))}</td>
    </tr>`).join('');
}

function queryMonthlyRev() {
  const year = document.getElementById('rev-year')?.value || '2026';
  const shopId = document.getElementById('rev-month-shop')?.value;
  const filters = { startDate: year + '-01-01', endDate: year + '-12-31' };
  if (shopId) filters.shopId = shopId;
  const data = aggregateSales(filters);
  const byMonth = sumByMonth(data);

  const labels = byMonth.map(m => m.month.slice(0,7));
  const revs = byMonth.map(m => m.revenue);

  if (charts['rev-monthly']) charts['rev-monthly'].destroy();
  charts['rev-monthly'] = new Chart(document.getElementById('chart-monthly-bar'), {
    type: 'bar',
    data: { labels, datasets: [{ label: '月营业额(¥)', data: revs, backgroundColor: labels.map((_,i) => `hsla(${270+i*20},70%,65%,0.7)`), borderRadius: 8, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1, titleColor: '#94a3b8', bodyColor: '#fff' } }, scales: { y: { ticks: { color: '#64748b', callback: v => '¥' + (v/10000).toFixed(1) + 'w' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }, x: { ticks: { color: '#64748b' }, grid: { display: false }, border: { display: false } } }, animation: { duration: 800, easing: 'easeOutBounce' } }
  });

  const tbody = document.getElementById('monthly-tbody');
  if (tbody) tbody.innerHTML = byMonth.reverse().map((m, i, arr) => {
    const prev = arr[i + 1];
    const grow = prev && prev.revenue ? ((m.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : null;
    return `<tr>
      <td>${m.month}</td>
      <td style="color:#6366f1;font-weight:700">${fmtMoney(m.revenue)}</td>
      <td>${fmt(m.orders)}</td>
      <td>${grow !== null ? `<span class="${grow>=0?'stat-up':'stat-down'}">${grow>=0?'↑':'↓'}${Math.abs(grow)}%</span>` : '-'}</td>
    </tr>`;
  }).join('');
}

function queryTrendRev() {
  const days = parseInt(document.getElementById('trend-period')?.value || 30);
  const shops = DB.getShops();
  const allData = aggregateSales({ startDate: getPastDate(days), endDate: getPastDate(0) });

  // 按日期聚合各店铺数据
  const dateSet = [...new Set(allData.map(d => d.date))].sort();
  const shopDatasets = shops.map(shop => {
    const shopData = allData.filter(d => d.shopId === shop.id);
    const byDate = sumByDate(shopData);
    const dateMap = Object.fromEntries(byDate.map(d => [d.date, d.revenue]));
    return {
      label: shop.name,
      data: dateSet.map(d => dateMap[d] || 0),
      borderColor: shop.color,
      backgroundColor: shop.color + '20',
      fill: false,
      tension: 0.4,
      pointRadius: 1,
    };
  });

  if (charts['trend-shops']) charts['trend-shops'].destroy();
  charts['trend-shops'] = new Chart(document.getElementById('chart-trend-shops'), {
    type: 'line',
    data: { labels: dateSet.map(d => d.slice(5)), datasets: shopDatasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1, titleColor: '#94a3b8', bodyColor: '#fff' } }, scales: { y: { ticks: { color: '#64748b', callback: v => '¥' + (v/1000).toFixed(0) + 'k' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }, x: { ticks: { color: '#64748b' }, grid: { display: false }, border: { display: false } } } }
  });

  // 月度堆叠
  const byMonth = sumByMonth(allData);
  const months = [...new Set(allData.map(d => d.date.slice(0,7)))].sort();
  const stackDatasets = shops.map(shop => {
    const shopData = allData.filter(d => d.shopId === shop.id);
    const byM = sumByMonth(shopData);
    const map = Object.fromEntries(byM.map(m => [m.month, m.revenue]));
    return { label: shop.name, data: months.map(m => map[m] || 0), backgroundColor: shop.color + 'cc', stack: 'total', borderRadius: 3 };
  });

  if (charts['trend-stack']) charts['trend-stack'].destroy();
  charts['trend-stack'] = new Chart(document.getElementById('chart-trend-stack'), {
    type: 'bar',
    data: { labels: months, datasets: stackDatasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1, titleColor: '#94a3b8', bodyColor: '#fff' } }, scales: { x: { stacked: true, ticks: { color: '#64748b' }, grid: { display: false }, border: { display: false } }, y: { stacked: true, ticks: { color: '#64748b', callback: v => '¥' + (v/10000).toFixed(0) + 'w' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } } } }
  });
}

// ============================================
//  页面：所有店铺
// ============================================
function renderShops() {
  const pg = document.getElementById('page-shops');
  const shops = DB.getShops();
  const allData = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) });
  const shopSum = sumByShop(allData);
  const sumMap = Object.fromEntries(shopSum.map(s => [s.shopId, s]));
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';

  function makeShopCard(shop, canView) {
    const s = sumMap[shop.id] || {};
    const currency = getPlatformCurrency(shop.platform);
    const isDomestic = DOMESTIC_PLATFORMS.has(shop.platform);
    const currencyTag = isDomestic
      ? `<span style="font-size:10px;background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);border-radius:3px;padding:1px 5px">¥ 人民币</span>`
      : `<span style="font-size:10px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:3px;padding:1px 5px">$ 美元</span>`;
    if (!canView) {
      // 无权限 → 灰色卡片 + 申请按钮
      return `
      <div class="shop-card" style="opacity:0.4;cursor:default;filter:grayscale(0.7)">
        <div class="shop-card-header">
          <div>
            <div class="shop-name">${shop.name}</div>
            <div class="shop-meta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${shop.platform} ${currencyTag}</div>
          </div>
          <div style="width:12px;height:12px;border-radius:50%;background:#475569;margin-top:4px"></div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #1e293b;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#475569">🔒 无访问权限</span>
          <button onclick="event.stopPropagation();requestShopAccess('${shop.id}','${shop.name}')" style="font-size:12px;color:#a78bfa;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:6px;padding:4px 12px;cursor:pointer">申请权限</button>
        </div>
      </div>`;
    }
    const isOwner = shop.created_by && CURRENT_USER && shop.created_by === CURRENT_USER.id;
    const canDeleteAll = canDo('action_shop_delete_all');
    const canDeleteOwn = canDo('action_shop_delete_own');
    const showDel = isAdmin || canDeleteAll || (canDeleteOwn && isOwner);
    return `
    <div class="shop-card" onclick="navigate('shop-detail','${shop.id}')">
      <div class="shop-card-header">
        <div>
          <div class="shop-name">${shop.name}</div>
          <div class="shop-meta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${shop.platform} ${currencyTag}</div>
        </div>
        <div style="width:12px;height:12px;border-radius:50%;background:${shop.color};margin-top:4px"></div>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,(s.revenue||0)/5000)}%;background:${shop.color}"></div></div>
      <div class="shop-stats">
        <div class="shop-stat"><div class="shop-stat-val" style="color:${shop.color}">${fmtMoney(s.revenue||0, currency)}</div><div class="shop-stat-label">近30天营业额</div></div>
        <div class="shop-stat"><div class="shop-stat-val">${fmt(s.orders||0)}</div><div class="shop-stat-label">近30天订单</div></div>
        <div class="shop-stat"><div class="shop-stat-val">${s.styles||0}</div><div class="shop-stat-label">在售款式</div></div>
        <div class="shop-stat"><div class="shop-stat-val">${s.orders ? (s.refundOrders/s.orders*100).toFixed(1):'0'}%</div><div class="shop-stat-label">退款率</div></div>
      </div>
      <div style="margin-top:12px;text-align:right">
        ${showDel ? `<button class="btn-danger" onclick="event.stopPropagation();deleteShop('${shop.id}')">删除</button>` : ''}
      </div>
    </div>`;
  }

  const myShops = shops.filter(s => isAdmin || (s.created_by && CURRENT_USER && s.created_by === CURRENT_USER.id) || canDo('shop_access_' + s.id));
  const otherShops = shops.filter(s => !isAdmin && !(s.created_by && CURRENT_USER && s.created_by === CURRENT_USER.id) && !canDo('shop_access_' + s.id));

  pg.innerHTML = `
    <div class="header-row">
      <h1>🏪 店铺管理</h1>
      <button class="btn-primary" onclick="openAddShop()">➕ 添加店铺</button>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin-bottom:20px">共 ${shops.length} 家店铺${!isAdmin ? `，其中 ${myShops.length} 家为您管理` : ''}，点击卡片查看详情</p>
    ${myShops.length > 0 ? `
    <div style="font-size:13px;color:#64748b;margin-bottom:10px;font-weight:600">${isAdmin ? '全部店铺' : '我的店铺'}</div>
    <div class="shop-grid">${myShops.map(s => makeShopCard(s, true)).join('')}</div>` : ''}
    ${otherShops.length > 0 ? `
    <div style="font-size:13px;color:#475569;margin-top:20px;margin-bottom:10px;font-weight:600">其他店铺（申请后可查看）</div>
    <div class="shop-grid">${otherShops.map(s => makeShopCard(s, false)).join('')}</div>` : ''}
  `;
}

// ============================================
//  页面：单店铺详情
// ============================================
function renderShopDetail(shopId) {
  const pg = document.getElementById('page-shop-detail');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) { pg.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>店铺不存在</p></div>'; return; }

  // 权限检查：非管理员只能查看自己的店铺，或已被授权的店铺
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const isOwner = shop.created_by && CURRENT_USER && shop.created_by === CURRENT_USER.id;
  const hasAccessPerm = canDo('shop_access_' + shopId);
  if (!isAdmin && !isOwner && !hasAccessPerm) {
    pg.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <h2 style="color:#e2e8f0;margin-bottom:8px">无访问权限</h2>
        <p style="color:#64748b;font-size:14px;margin-bottom:24px">「${shop.name}」由其他成员管理，您需要申请权限后才能查看</p>
        <div style="display:flex;gap:12px">
          <button class="btn-secondary" onclick="navigate('shops')">← 返回店铺列表</button>
          <button class="btn-primary" onclick="requestShopAccess('${shop.id}','${shop.name}')">申请查看权限</button>
        </div>
      </div>`;
    return;
  }

  const currency = getPlatformCurrency(shop.platform);
  const isDomestic = DOMESTIC_PLATFORMS.has(shop.platform);
  const currencyLabel = isDomestic ? '人民币 ¥' : '美元 $';
  const currencyColor = isDomestic ? '#34d399' : '#f59e0b';

  const data30 = aggregateSales({ shopId, startDate: getPastDate(30), endDate: getPastDate(0) });
  const totalRev = data30.reduce((s,d) => s+d.revenue, 0);
  const totalOrd = data30.reduce((s,d) => s+d.orders, 0);
  const styleSum = sumByStyle(data30).sort((a,b) => b.revenue - a.revenue);
  const byDate = sumByDate(data30);

  pg.innerHTML = `
    <div class="header-row">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="width:16px;height:16px;border-radius:50%;background:${shop.color}"></div>
        <h1>${shop.name}</h1>
        <span class="badge badge-blue">${shop.platform}</span>
        <span style="font-size:11px;background:rgba(0,0,0,0.2);color:${currencyColor};border:1px solid ${currencyColor}44;border-radius:4px;padding:2px 7px">${currencyLabel}</span>
      </div>
      <button class="btn-secondary" onclick="navigate('shops')">← 返回</button>
    </div>

    ${isDomestic ? `
    <!-- 国内店铺：生意参谋模式 -->
    <div id="domestic-detail-area">
      ${renderDomesticDetail(shop)}
    </div>
    ` : `
    <!-- 跨境店铺：每日数据 + 商品管理 -->
    <div id="domestic-detail-area">
      ${renderCrossBorderDetail(shop)}
    </div>
    <!-- 跨境传统款式分析（折叠） -->
    <details style="margin-top:8px">
      <summary style="cursor:pointer;color:#64748b;font-size:13px;padding:8px 0;user-select:none">📊 款式销售数据（旧版导入数据）</summary>
    <div class="stat-grid" style="margin-top:12px">
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">近30天营业额</div><div class="stat-value" style="color:${shop.color}">${fmtMoney(totalRev, currency)}</div></div>
      <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">近30天订单数</div><div class="stat-value">${fmt(totalOrd)}</div></div>
      <div class="stat-card"><div class="stat-icon">👗</div><div class="stat-label">在售款式数</div><div class="stat-value">${styleSum.length}</div></div>
      <div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">平均客单价</div><div class="stat-value">${fmtMoney(totalOrd ? totalRev/totalOrd : 0, currency)}</div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title" style="color:${shop.color}">📈 近30天营业额趋势</div><div class="chart-wrap"><canvas id="chart-detail-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🏆 本店Top10款式</div>
        <ul class="rank-list">${styleSum.slice(0,10).map((s,i) => `
          <li class="rank-item">
            <span class="rank-num ${i<3?['top1','top2','top3'][i]:''}">${i+1}</span>
            <div class="rank-info"><div class="rank-name">${s.styleName}</div><div class="rank-detail">${fmt(s.orders)} 单</div></div>
            <span class="rank-val">${fmtMoney(s.revenue, currency)}</span>
          </li>`).join('')}</ul>
      </div>
    </div>
    </details>
    `}
  `;

  if (!isDomestic) {
    if (charts['detail-trend']) charts['detail-trend'].destroy();
    charts['detail-trend'] = new Chart(document.getElementById('chart-detail-trend'), {
      type: 'line',
      data: { labels: byDate.map(d=>d.date.slice(5)), datasets: [{ label: '营业额', data: byDate.map(d=>d.revenue), borderColor: shop.color, backgroundColor: shop.color + '15', fill: true, tension: 0.4, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '$' + (v).toFixed(0) } } } }
    });
  }
  // 重置筛选状态
  window._domesticFilter = '';
  window._domesticFilterDate = '';
}

// ============================================
//  国内店铺：生意参谋数据管理（本地存储）
// ============================================

// 获取/保存店铺商品数据
const ShopProductsDB = {
  _key: (shopId) => 'ec_products_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  add(shopId, product) {
    const list = this.getAll(shopId);
    list.unshift(product);
    this.save(shopId, list);
    return list;
  },
  update(shopId, productId, updates) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(p => p.id === productId);
    if (idx >= 0) { Object.assign(list[idx], updates); this.save(shopId, list); }
    return list;
  },
  remove(shopId, productId) {
    const list = this.getAll(shopId).filter(p => p.id !== productId);
    this.save(shopId, list);
    return list;
  }
};

// 获取/保存生意参谋日报数据
const DomesticStatsDB = {
  _key: (shopId) => 'ec_domestic_stats_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  upsert(shopId, row) {
    // 按 date + product_id 唯一
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.date === row.date && r.product_id === row.product_id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...row }; }
    else { list.unshift(row); }
    this.save(shopId, list);
    return list;
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    return list;
  }
};

// 国内店铺详情（含生意参谋表格）
function renderDomesticDetail(shop) {
  const shopId = shop.id;
  const products = ShopProductsDB.getAll(shopId);
  const stats = DomesticStatsDB.getAll(shopId);

  // 当前选中的筛选项
  const filterPid = window._domesticFilter || '';
  const filterDate = window._domesticFilterDate || '';

  // 过滤数据
  let filtered = stats.filter(r => {
    if (filterPid && r.product_id !== filterPid) return false;
    if (filterDate && !r.date.startsWith(filterDate)) return false;
    return true;
  });

  // 自动计算汇总
  const sumVisitors = filtered.reduce((s,r) => s + (r.visitors||0), 0);
  const sumPv = filtered.reduce((s,r) => s + (r.pv||0), 0);
  const sumFav = filtered.reduce((s,r) => s + (r.fav_count||0), 0);
  const sumPayAmt = filtered.reduce((s,r) => s + (r.pay_amount||0), 0);
  const sumActualAmt = filtered.reduce((s,r) => s + (r.actual_pay||0), 0);
  const sumRefundAmt = filtered.reduce((s,r) => s + (r.refund_amount||0), 0);
  const sumRefundPpl = filtered.reduce((s,r) => s + (r.refund_count||0), 0);
  // 广告汇总
  const adTypes = ['zst','ztc','ylmf'];
  const adNames = {zst:'全站推广', ztc:'直通车', ylmf:'引力魔方'};
  const adColors = {zst:'#6366f1', ztc:'#f59e0b', ylmf:'#10b981'};
  const adSum = {};
  adTypes.forEach(t => {
    adSum[t] = {
      cost: filtered.reduce((s,r) => s + (r[t+'_cost']||0), 0),
      imp: filtered.reduce((s,r) => s + (r[t+'_imp']||0), 0),
      clk: filtered.reduce((s,r) => s + (r[t+'_clk']||0), 0),
      fav: filtered.reduce((s,r) => s + (r[t+'_fav']||0), 0),
      cart: filtered.reduce((s,r) => s + (r[t+'_cart']||0), 0),
      order: filtered.reduce((s,r) => s + (r[t+'_order']||0), 0),
      order_amt: filtered.reduce((s,r) => s + (r[t+'_order_amt']||0), 0),
    };
  });
  const totalAdCost = adTypes.reduce((s,t) => s + adSum[t].cost, 0);
  const roi = totalAdCost > 0 ? (sumActualAmt / totalAdCost).toFixed(2) : '-';
  const uvVal = sumVisitors > 0 ? (sumActualAmt / sumVisitors).toFixed(2) : '-';
  const grossProfit = sumActualAmt - totalAdCost;  // 简化：毛利 = 实际支付 - 广告花费
  const grossRate = sumActualAmt > 0 ? (grossProfit / sumActualAmt * 100).toFixed(1) : '-';
  const adRatio = sumPayAmt > 0 ? (totalAdCost / sumPayAmt * 100).toFixed(1) : '-';
  const favRate = sumVisitors > 0 ? (sumFav / sumVisitors * 100).toFixed(1) : '-';

  return `
  <!-- 商品列表管理 -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="card-title" style="margin:0">商品管理</div>
      <button class="btn-secondary btn-sm" onclick="openAddProductModal('${shopId}')">+ 添加商品</button>
    </div>
    ${products.length === 0
      ? `<div style="color:#475569;font-size:13px;text-align:center;padding:16px 0">暂无商品，点击"添加商品"开始</div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:8px">
        ${products.map(p => `
          <div style="background:#1e293b;border:1px solid ${filterPid===p.id?shop.color:'#334155'};border-radius:8px;padding:8px 12px;cursor:pointer;transition:all 0.2s"
               onclick="setDomesticFilter('${shopId}','${p.id}','${filterDate}')">
            <div style="font-weight:600;color:#e2e8f0;font-size:13px">${p.name}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">ID: ${p.product_id||'-'} | 编码: ${p.sku||'-'}</div>
            <div style="display:flex;gap:6px;margin-top:5px">
              <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer;padding:0" onclick="event.stopPropagation();openEditProductModal('${shopId}','${p.id}')">编辑</button>
              <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer;padding:0" onclick="event.stopPropagation();removeProduct('${shopId}','${p.id}')">删除</button>
            </div>
          </div>`).join('')}
        ${filterPid ? `<button class="btn-secondary btn-sm" onclick="setDomesticFilter('${shopId}','','${filterDate}')" style="align-self:center">全部商品</button>` : ''}
      </div>`}
  </div>

  <!-- 汇总看板 -->
  <div class="stat-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-label">总访客数</div><div class="stat-value" style="color:${shop.color}">${fmt(sumVisitors)}</div></div>
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">实际支付金额</div><div class="stat-value" style="color:#34d399">¥${sumActualAmt.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat-card"><div class="stat-icon">📢</div><div class="stat-label">广告总花费</div><div class="stat-value" style="color:#f87171">¥${totalAdCost.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-label">总ROI</div><div class="stat-value">${roi}</div></div>
    <div class="stat-card"><div class="stat-icon">💎</div><div class="stat-label">UV价值</div><div class="stat-value">¥${uvVal}</div></div>
    <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">毛利（去广告）</div><div class="stat-value" style="color:${grossProfit>=0?'#34d399':'#f87171'}">¥${grossProfit.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat-card"><div class="stat-icon">%</div><div class="stat-label">毛利率</div><div class="stat-value">${grossRate}%</div></div>
    <div class="stat-card"><div class="stat-icon">🎯</div><div class="stat-label">广告占比</div><div class="stat-value">${adRatio}%</div></div>
  </div>

  <!-- 广告效果对比卡片 -->
  <div class="chart-grid" style="margin-bottom:16px">
    ${adTypes.map(t => {
      const d = adSum[t];
      const ctr = d.imp > 0 ? (d.clk/d.imp*100).toFixed(2) : '-';
      const addRate = d.clk > 0 ? (d.cart/d.clk*100).toFixed(2) : '-';
      const adRoi = d.cost > 0 ? (d.order_amt/d.cost).toFixed(2) : '-';
      const adUv = d.clk > 0 ? (d.order_amt/d.clk).toFixed(2) : '-';
      return `
      <div class="card">
        <div class="card-title" style="color:${adColors[t]}">📺 ${adNames[t]}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">花费</div><div style="color:#f87171;font-weight:700;font-size:14px">¥${d.cost.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">ROI</div><div style="color:${adColors[t]};font-weight:700;font-size:14px">${adRoi}</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">展现量</div><div style="color:#e2e8f0;font-weight:600">${fmt(d.imp)}</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">点击量</div><div style="color:#e2e8f0;font-weight:600">${fmt(d.clk)}</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">点击率</div><div style="color:#a78bfa;font-weight:600">${ctr}%</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">加购率</div><div style="color:#a78bfa;font-weight:600">${addRate}%</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">收藏量</div><div style="color:#e2e8f0;font-weight:600">${fmt(d.fav)}</div></div>
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">成交量</div><div style="color:#34d399;font-weight:600">${fmt(d.order)}</div></div>
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- 筛选 + 录入表格 -->
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div class="card-title" style="margin:0">生意参谋 · 数据明细</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select onchange="setDomesticFilter('${shopId}','${filterPid}',this.value)" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="" ${!filterDate?'selected':''}>全部时间</option>
          ${[...new Set([...getRecentMonths(6)])].map(m => `<option value="${m}" ${filterDate===m?'selected':''}>${m}</option>`).join('')}
        </select>
        <select onchange="setDomesticFilter('${shopId}',this.value,'${filterDate}')" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="" ${!filterPid?'selected':''}>全部商品</option>
          ${products.map(p => `<option value="${p.id}" ${filterPid===p.id?'selected':''}>${p.name}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" onclick="openAddStatModal('${shopId}')">+ 录入数据</button>
        <button class="btn-secondary btn-sm" onclick="openImportDomesticModal('${shopId}')">📤 批量导入</button>
        ${filtered.length > 0 ? `<button class="btn-secondary btn-sm" onclick="exportDomesticStats('${shopId}')">导出 CSV</button>` : ''}
      </div>
    </div>
    ${filtered.length === 0
      ? `<div style="text-align:center;color:#475569;padding:32px 0">
          <div style="font-size:32px;margin-bottom:8px">📊</div>
          <div>暂无数据，点击"录入数据"或"批量导入"开始填写</div>
        </div>`
      : `<div class="table-wrap" style="overflow-x:auto">
        <table style="min-width:1200px">
          <thead>
            <tr style="background:#1e293b">
              <th rowspan="2" style="border-bottom:1px solid #334155">日期</th>
              <th rowspan="2" style="border-bottom:1px solid #334155">商品</th>
              <th colspan="7" style="text-align:center;background:#1e293b55;border-bottom:1px solid #334155;color:#7c3aed">生意参谋核心指标</th>
              <th colspan="4" style="text-align:center;background:#6366f111;border-bottom:1px solid #334155;color:#6366f1">利润&广告汇总</th>
              <th colspan="6" style="text-align:center;background:#6366f111;border-bottom:1px solid #334155;color:#6366f1">全站推广</th>
              <th colspan="6" style="text-align:center;background:#f59e0b11;border-bottom:1px solid #334155;color:#f59e0b">直通车</th>
              <th colspan="6" style="text-align:center;background:#10b98111;border-bottom:1px solid #334155;color:#10b981">引力魔方</th>
              <th rowspan="2" style="border-bottom:1px solid #334155">备注</th>
              <th rowspan="2" style="border-bottom:1px solid #334155">操作</th>
            </tr>
            <tr style="background:#1e293b;font-size:11px;color:#64748b">
              <th>访客数</th><th>浏览量</th><th>收藏人数</th><th>收藏率</th><th>支付金额</th><th>实际支付</th><th>退款金额</th>
              <th>广告总费</th><th>总ROI</th><th>UV价值</th><th>毛利率</th>
              <th>花费</th><th>展现</th><th>点击</th><th>点击率</th><th>加购率</th><th>ROI</th>
              <th>花费</th><th>展现</th><th>点击</th><th>点击率</th><th>加购率</th><th>ROI</th>
              <th>花费</th><th>展现</th><th>点击</th><th>点击率</th><th>加购率</th><th>ROI</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => {
              const prod = products.find(p => p.id === r.product_id);
              const rFavRate = r.visitors > 0 ? (r.fav_count/r.visitors*100).toFixed(1)+'%' : '-';
              const rAdCost = (r.zst_cost||0) + (r.ztc_cost||0) + (r.ylmf_cost||0);
              const rRoi = rAdCost > 0 ? (r.actual_pay/rAdCost).toFixed(2) : '-';
              const rUv = r.visitors > 0 ? (r.actual_pay/r.visitors).toFixed(2) : '-';
              const rGrossRate = r.actual_pay > 0 ? ((r.actual_pay-rAdCost)/r.actual_pay*100).toFixed(1)+'%' : '-';
              const adRow = ['zst','ztc','ylmf'].map(t => {
                const ctr = r[t+'_imp'] > 0 ? (r[t+'_clk']/r[t+'_imp']*100).toFixed(2)+'%' : '-';
                const addR = r[t+'_clk'] > 0 ? (r[t+'_cart']/r[t+'_clk']*100).toFixed(2)+'%' : '-';
                const roi2 = r[t+'_cost'] > 0 ? (r[t+'_order_amt']/r[t+'_cost']).toFixed(2) : '-';
                return `<td>¥${(r[t+'_cost']||0).toFixed(2)}</td><td>${fmt(r[t+'_imp']||0)}</td><td>${fmt(r[t+'_clk']||0)}</td><td>${ctr}</td><td>${addR}</td><td>${roi2}</td>`;
              }).join('');
              return `<tr>
                <td style="white-space:nowrap">${r.date}</td>
                <td>${prod ? prod.name : (r.product_id||'-')}</td>
                <td>${fmt(r.visitors||0)}</td>
                <td>${fmt(r.pv||0)}</td>
                <td>${fmt(r.fav_count||0)}</td>
                <td>${rFavRate}</td>
                <td>¥${(r.pay_amount||0).toFixed(2)}</td>
                <td style="color:#34d399">¥${(r.actual_pay||0).toFixed(2)}</td>
                <td style="color:#f87171">¥${(r.refund_amount||0).toFixed(2)}</td>
                <td style="color:#f87171">¥${rAdCost.toFixed(2)}</td>
                <td style="color:${shop.color}">${rRoi}</td>
                <td>¥${rUv}</td>
                <td>${rGrossRate}</td>
                ${adRow}
                <td style="max-width:120px;color:#94a3b8;font-size:11px">${r.remark ? `<span title="${r.remark}" style="cursor:help">${r.remark.length>15?r.remark.slice(0,15)+'…':r.remark}</span>` : '<span style="color:#334155">-</span>'}</td>
                <td>
                  <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer" onclick="openEditStatModal('${shopId}','${r.id}')">编辑</button>
                  <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeStat('${shopId}','${r.id}')">删</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
  </div>

  <!-- 录入数据弹窗 -->
  <div id="modal-add-stat" class="modal" style="display:none">
    <div class="modal-content" style="max-width:900px;max-height:90vh;overflow-y:auto">
      <div class="modal-header">
        <h3 id="stat-modal-title">录入生意参谋数据</h3>
        <button onclick="closeModal('modal-add-stat')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">统计日期 *</label>
            <input type="date" id="stat-date" class="input-field" style="width:100%"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品 *</label>
            <select id="stat-product" class="input-field" style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0">
              <option value="">请选择商品</option>
              ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select></div>
        </div>
        <!-- 生意参谋 -->
        <div style="background:#1e293b;border-radius:8px;padding:14px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:#a78bfa;margin-bottom:10px">生意参谋核心指标</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">访客数</label><input type="number" id="stat-visitors" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">浏览量</label><input type="number" id="stat-pv" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">收藏人数</label><input type="number" id="stat-fav" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">支付金额</label><input type="number" id="stat-pay-amount" class="input-field" placeholder="0.00" step="0.01"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">实际支付金额</label><input type="number" id="stat-actual-pay" class="input-field" placeholder="0.00" step="0.01"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">退款金额</label><input type="number" id="stat-refund-amount" class="input-field" placeholder="0.00" step="0.01"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">退款人数</label><input type="number" id="stat-refund-count" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">搜索引导支付买家</label><input type="number" id="stat-search-buyers" class="input-field" placeholder="0"></div>
          </div>
        </div>
        <!-- 广告 3栏 -->
        ${['zst','ztc','ylmf'].map((t,i) => `
        <div style="background:#1e293b;border-radius:8px;padding:14px;margin-bottom:12px;border-left:3px solid ${adColors[t]}">
          <div style="font-size:13px;font-weight:600;color:${adColors[t]};margin-bottom:10px">${adNames[t]}</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">花费</label><input type="number" id="stat-${t}-cost" class="input-field" placeholder="0.00" step="0.01"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">展现量</label><input type="number" id="stat-${t}-imp" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">点击量</label><input type="number" id="stat-${t}-clk" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">收藏宝贝量</label><input type="number" id="stat-${t}-fav" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">加购物车量</label><input type="number" id="stat-${t}-cart" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">成交订单量</label><input type="number" id="stat-${t}-order" class="input-field" placeholder="0"></div>
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">成交金额</label><input type="number" id="stat-${t}-order-amt" class="input-field" placeholder="0.00" step="0.01"></div>
          </div>
        </div>`).join('')}
        <input type="hidden" id="stat-edit-id">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（记录当日涨跌原因，如：双11活动、广告加量、节假日等）</label>
          <input type="text" id="stat-remark" class="input-field" placeholder="可选，方便日后复盘">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
          <button class="btn-secondary" onclick="closeModal('modal-add-stat')">取消</button>
          <button class="btn-primary" onclick="saveStat('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 国内店铺批量导入弹窗 -->
  <div id="modal-domestic-import" class="modal" style="display:none">
    <div class="modal-content" style="max-width:620px">
      <div class="modal-header">
        <h3>批量导入生意参谋数据</h3>
        <button onclick="closeModal('modal-domestic-import')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px">
        <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#64748b;line-height:1.9">
          <div style="color:#a78bfa;font-weight:600;margin-bottom:8px">📋 格式说明（CSV / Excel 均支持）</div>
          <div style="margin-bottom:6px">必填列：<span style="color:#f87171;font-family:monospace">日期, 访客数, 浏览量, 支付金额, 支付订单量</span></div>
          <div style="margin-bottom:6px">可选列：<span style="color:#94a3b8;font-family:monospace">款式名称（商品名）, 实际支付金额, 退款金额, 退款人数, 收藏人数</span></div>
          <div>示例：<span style="color:#fbbf24;font-family:monospace">2026-03-01, 2500, 4800, 18600, 320, 连衣裙A款</span></div>
        </div>
        <div style="margin-bottom:14px">
          <button onclick="downloadTemplateDomesticBatch()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(124,58,237,0.4);background:rgba(124,58,237,0.1);color:#a78bfa;font-size:12px;cursor:pointer;transition:all .2s" onmouseover="this.style.background='rgba(124,58,237,0.2)'" onmouseout="this.style.background='rgba(124,58,237,0.1)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载国内生意参谋数据导入模板（CSV）
          </button>
        </div>
        <textarea id="domestic-import-text" style="width:100%;height:180px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="粘贴 CSV 或 Excel 复制的数据..."></textarea>
        <div id="domestic-import-preview" style="margin-top:10px;font-size:12px;color:#64748b"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px">
          <button class="btn-secondary" onclick="closeModal('modal-domestic-import')">取消</button>
          <button class="btn-primary" onclick="importDomesticBatch('${shopId}')">导入</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 添加/编辑商品弹窗 -->
  <div id="modal-add-product" class="modal" style="display:none">
    <div class="modal-content" style="max-width:480px">
      <div class="modal-header">
        <h3 id="product-modal-title">添加商品</h3>
        <button onclick="closeModal('modal-add-product')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px;display:grid;gap:12px">
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品名称 *</label>
          <input type="text" id="product-name" class="input-field" placeholder="请输入商品名称"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品ID（平台ID）</label>
          <input type="text" id="product-id-field" class="input-field" placeholder="如：123456789"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品编码（SKU）</label>
          <input type="text" id="product-sku" class="input-field" placeholder="如：SKU-001"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注</label>
          <input type="text" id="product-note" class="input-field" placeholder="可选"></div>
        <input type="hidden" id="product-edit-id">
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="closeModal('modal-add-product')">取消</button>
          <button class="btn-primary" onclick="saveProduct('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>
  `;
}

// 辅助：获取最近N个月的 YYYY-MM 列表
function getRecentMonths(n) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
  }
  return result;
}

// 设置筛选状态并重新渲染
function setDomesticFilter(shopId, pid, date) {
  window._domesticFilter = pid;
  window._domesticFilterDate = date;
  const pg = document.getElementById('page-shop-detail');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) return;
  // 只更新国内区域
  const domesticEl = document.getElementById('domestic-detail-area');
  if (domesticEl) {
    domesticEl.innerHTML = renderDomesticDetail(shop);
  }
}

// 商品增删改
function openAddProductModal(shopId) {
  document.getElementById('product-modal-title').textContent = '添加商品';
  document.getElementById('product-name').value = '';
  document.getElementById('product-id-field').value = '';
  document.getElementById('product-sku').value = '';
  document.getElementById('product-note').value = '';
  document.getElementById('product-edit-id').value = '';
  document.getElementById('modal-add-product').style.display = 'flex';
}
function openEditProductModal(shopId, productId) {
  const prod = ShopProductsDB.getAll(shopId).find(p => p.id === productId);
  if (!prod) return;
  document.getElementById('product-modal-title').textContent = '编辑商品';
  document.getElementById('product-name').value = prod.name || '';
  document.getElementById('product-id-field').value = prod.product_id || '';
  document.getElementById('product-sku').value = prod.sku || '';
  document.getElementById('product-note').value = prod.note || '';
  document.getElementById('product-edit-id').value = productId;
  document.getElementById('modal-add-product').style.display = 'flex';
}
function saveProduct(shopId) {
  const name = document.getElementById('product-name').value.trim();
  if (!name) { showToast('请输入商品名称', 'error'); return; }
  const editId = document.getElementById('product-edit-id').value;
  const data = {
    name,
    product_id: document.getElementById('product-id-field').value.trim(),
    sku: document.getElementById('product-sku').value.trim(),
    note: document.getElementById('product-note').value.trim(),
  };
  if (editId) {
    ShopProductsDB.update(shopId, editId, data);
  } else {
    data.id = 'prod_' + Date.now();
    ShopProductsDB.add(shopId, data);
  }
  closeModal('modal-add-product');
  setDomesticFilter(shopId, window._domesticFilter, window._domesticFilterDate);
  showToast('商品已保存', 'success');
}
function removeProduct(shopId, productId) {
  if (!confirm('确定删除该商品及关联数据吗？')) return;
  ShopProductsDB.remove(shopId, productId);
  setDomesticFilter(shopId, '', '');
  showToast('已删除', 'info');
}

// 国内店铺批量导入
function openImportDomesticModal(shopId) {
  const el = document.getElementById('domestic-import-text');
  const prev = document.getElementById('domestic-import-preview');
  if (el) el.value = '';
  if (prev) prev.textContent = '';
  document.getElementById('modal-domestic-import').style.display = 'flex';
}

function importDomesticBatch(shopId) {
  const text = document.getElementById('domestic-import-text').value.trim();
  if (!text) { showToast('请粘贴数据', 'error'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  // 跳过表头行（如果第一行是文字）
  const dataLines = lines.filter(l => /^\d{4}[-/]\d{1,2}/.test(l));
  let count = 0, errors = 0;
  dataLines.forEach(line => {
    const parts = line.split(/[,\t]/).map(s => s.trim());
    if (parts.length < 2) { errors++; return; }
    const dateRaw = parts[0];
    const date = dateRaw.replace(/\//g, '-');
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) { errors++; return; }
    const visitors   = parseFloat(parts[1]) || 0;
    const pv         = parseFloat(parts[2]) || 0;
    const payAmount  = parseFloat(parts[3]) || 0;
    const payOrders  = parseFloat(parts[4]) || 0;
    const styleName  = parts[5] || '';
    const row = {
      id: 'dstat_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      date, product_id: '',
      visitors, pv, fav_count: 0,
      pay_amount: payAmount, actual_pay: payAmount,
      refund_amount: 0, refund_count: 0, search_buyers: 0,
      zst_cost:0, zst_imp:0, zst_clk:0, zst_fav:0, zst_cart:0, zst_order:0, zst_order_amt:0,
      ztc_cost:0, ztc_imp:0, ztc_clk:0, ztc_fav:0, ztc_cart:0, ztc_order:0, ztc_order_amt:0,
      ylmf_cost:0, ylmf_imp:0, ylmf_clk:0, ylmf_fav:0, ylmf_cart:0, ylmf_order:0, ylmf_order_amt:0,
      _style: styleName,
    };
    // 同款日期+款式已存在则更新，否则追加
    DomesticStatsDB.upsert(shopId, row);
    count++;
  });
  closeModal('modal-domestic-import');
  // 刷新当前店铺详情
  const el = document.getElementById('domestic-detail-area');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (el && shop) el.innerHTML = renderDomesticDetail(shop);
  showToast(`✅ 导入 ${count} 条${errors > 0 ? '，' + errors + ' 条格式错误' : ''}`, count > 0 ? 'success' : 'error');
}

function downloadTemplateDomesticBatch() {
  const csv = '日期,访客数,浏览量,支付金额,支付订单量,款式名称\n2026-03-01,2500,4800,18600.00,320,连衣裙A款\n2026-03-02,2800,5200,21500.00,365,连衣裙A款\n2026-03-03,2200,4100,15800.00,280,牛仔裤B款';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '国内店铺生意参谋批量导入模板.csv';
  a.click();
  showToast('⬇️ 国内店铺模板已下载', 'success');
}

// 生意参谋数据录入
function openAddStatModal(shopId) {
  document.getElementById('stat-modal-title').textContent = '录入生意参谋数据';
  document.getElementById('stat-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('stat-edit-id').value = '';
  const rmk = document.getElementById('stat-remark'); if (rmk) rmk.value = '';
  // 清空所有输入
  ['visitors','pv','fav','pay-amount','actual-pay','refund-amount','refund-count','search-buyers'].forEach(k => {
    const el = document.getElementById('stat-' + k);
    if (el) el.value = '';
  });
  ['zst','ztc','ylmf'].forEach(t => {
    ['cost','imp','clk','fav','cart','order','order-amt'].forEach(k => {
      const el = document.getElementById(`stat-${t}-${k}`);
      if (el) el.value = '';
    });
  });
  document.getElementById('modal-add-stat').style.display = 'flex';
}
function openEditStatModal(shopId, statId) {
  const r = DomesticStatsDB.getAll(shopId).find(s => s.id === statId);
  if (!r) return;
  document.getElementById('stat-modal-title').textContent = '编辑数据';
  document.getElementById('stat-date').value = r.date || '';
  document.getElementById('stat-product').value = r.product_id || '';
  document.getElementById('stat-edit-id').value = statId;
  const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setV('stat-visitors', r.visitors); setV('stat-pv', r.pv); setV('stat-fav', r.fav_count);
  setV('stat-pay-amount', r.pay_amount); setV('stat-actual-pay', r.actual_pay);
  setV('stat-refund-amount', r.refund_amount); setV('stat-refund-count', r.refund_count);
  setV('stat-search-buyers', r.search_buyers);
  const rmkEl = document.getElementById('stat-remark'); if (rmkEl) rmkEl.value = r.remark || '';
  ['zst','ztc','ylmf'].forEach(t => {
    setV(`stat-${t}-cost`, r[t+'_cost']); setV(`stat-${t}-imp`, r[t+'_imp']);
    setV(`stat-${t}-clk`, r[t+'_clk']); setV(`stat-${t}-fav`, r[t+'_fav']);
    setV(`stat-${t}-cart`, r[t+'_cart']); setV(`stat-${t}-order`, r[t+'_order']);
    setV(`stat-${t}-order-amt`, r[t+'_order_amt']);
  });
  document.getElementById('modal-add-stat').style.display = 'flex';
}
function saveStat(shopId) {
  const date = document.getElementById('stat-date').value;
  const product_id = document.getElementById('stat-product').value;
  if (!date) { showToast('请选择日期', 'error'); return; }
  const editId = document.getElementById('stat-edit-id').value;
  const getN = (id) => parseFloat(document.getElementById(id)?.value || '0') || 0;
  const remarkEl = document.getElementById('stat-remark');
  const row = {
    id: editId || ('stat_' + Date.now()),
    date, product_id,
    visitors: getN('stat-visitors'), pv: getN('stat-pv'),
    fav_count: getN('stat-fav'), pay_amount: getN('stat-pay-amount'),
    actual_pay: getN('stat-actual-pay'), refund_amount: getN('stat-refund-amount'),
    refund_count: getN('stat-refund-count'), search_buyers: getN('stat-search-buyers'),
    remark: remarkEl ? remarkEl.value.trim() : '',
  };
  ['zst','ztc','ylmf'].forEach(t => {
    row[t+'_cost'] = getN(`stat-${t}-cost`); row[t+'_imp'] = getN(`stat-${t}-imp`);
    row[t+'_clk'] = getN(`stat-${t}-clk`); row[t+'_fav'] = getN(`stat-${t}-fav`);
    row[t+'_cart'] = getN(`stat-${t}-cart`); row[t+'_order'] = getN(`stat-${t}-order`);
    row[t+'_order_amt'] = getN(`stat-${t}-order-amt`);
  });
  DomesticStatsDB.upsert(shopId, row);
  closeModal('modal-add-stat');
  setDomesticFilter(shopId, window._domesticFilter, window._domesticFilterDate);
  showToast('数据已保存', 'success');
}
function removeStat(shopId, statId) {
  if (!confirm('确定删除这条数据吗？')) return;
  DomesticStatsDB.remove(shopId, statId);
  setDomesticFilter(shopId, window._domesticFilter, window._domesticFilterDate);
  showToast('已删除', 'info');
}
function exportDomesticStats(shopId) {
  const stats = DomesticStatsDB.getAll(shopId);
  const products = ShopProductsDB.getAll(shopId);
  if (!stats.length) return;
  const headers = ['日期','商品','访客数','浏览量','收藏人数','收藏率','支付金额','实际支付','退款金额','退款人数','广告总费','总ROI','UV价值','毛利率',
    '全站花费','全站展现','全站点击','全站点击率','全站加购率','全站ROI',
    '直通车花费','直通车展现','直通车点击','直通车点击率','直通车加购率','直通车ROI',
    '引力魔方花费','引力魔方展现','引力魔方点击','引力魔方点击率','引力魔方加购率','引力魔方ROI'];
  const rows = stats.map(r => {
    const prod = products.find(p => p.id === r.product_id);
    const rAdCost = (r.zst_cost||0)+(r.ztc_cost||0)+(r.ylmf_cost||0);
    const row = [r.date, prod?prod.name:'', r.visitors||0, r.pv||0, r.fav_count||0,
      r.visitors>0?(r.fav_count/r.visitors*100).toFixed(1)+'%':'-',
      r.pay_amount||0, r.actual_pay||0, r.refund_amount||0, r.refund_count||0,
      rAdCost.toFixed(2),
      rAdCost>0?(r.actual_pay/rAdCost).toFixed(2):'-',
      r.visitors>0?(r.actual_pay/r.visitors).toFixed(2):'-',
      r.actual_pay>0?((r.actual_pay-rAdCost)/r.actual_pay*100).toFixed(1)+'%':'-'];
    ['zst','ztc','ylmf'].forEach(t => {
      const ctr = r[t+'_imp']>0?(r[t+'_clk']/r[t+'_imp']*100).toFixed(2)+'%':'-';
      const addR = r[t+'_clk']>0?(r[t+'_cart']/r[t+'_clk']*100).toFixed(2)+'%':'-';
      const roi2 = r[t+'_cost']>0?(r[t+'_order_amt']/r[t+'_cost']).toFixed(2):'-';
      row.push(r[t+'_cost']||0, r[t+'_imp']||0, r[t+'_clk']||0, ctr, addR, roi2);
    });
    return row;
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `生意参谋_${shopId}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ============================================
//  跨境店铺：每日数据管理
// ============================================

const CrossBorderDailyDB = {
  _key: (shopId) => 'ec_cb_daily_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  upsert(shopId, row) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.date === row.date);
    if (idx >= 0) { list[idx] = { ...list[idx], ...row }; }
    else { list.unshift(row); list.sort((a,b) => b.date.localeCompare(a.date)); }
    this.save(shopId, list);
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
  }
};

// 渲染跨境店铺每日数据区域
function renderCrossBorderDetail(shop) {
  const shopId = shop.id;
  const currency = getPlatformCurrency(shop.platform);
  const currSymbol = currency === 'USD' ? '$' : '¥';
  const filterMonth = window._cbFilterMonth || '';
  let rows = CrossBorderDailyDB.getAll(shopId);
  if (filterMonth) rows = rows.filter(r => r.date.startsWith(filterMonth));

  // 汇总
  const sumVisitors = rows.reduce((s,r) => s+(r.visitors||0), 0);
  const sumBuyers = rows.reduce((s,r) => s+(r.buyers||0), 0);
  const sumQty = rows.reduce((s,r) => s+(r.qty||0), 0);
  const sumAmt = rows.reduce((s,r) => s+(r.amount||0), 0);
  const avgConv = sumVisitors > 0 ? (sumBuyers/sumVisitors*100).toFixed(2) : '-';

  return `
  <!-- 商品管理（跨境也支持） -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="card-title" style="margin:0">商品管理</div>
      <button class="btn-secondary btn-sm" onclick="openAddProductModal('${shopId}')">+ 添加商品</button>
    </div>
    ${(() => {
      const products = ShopProductsDB.getAll(shopId);
      return products.length === 0
        ? `<div style="color:#475569;font-size:13px;text-align:center;padding:16px 0">暂无商品，点击"添加商品"开始</div>`
        : `<div style="display:flex;flex-wrap:wrap;gap:8px">
          ${products.map(p => `
            <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 12px">
              <div style="font-weight:600;color:#e2e8f0;font-size:13px">${p.name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">货号: ${p.sku||'-'}</div>
              <div style="display:flex;gap:6px;margin-top:5px">
                <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer;padding:0" onclick="openEditProductModal('${shopId}','${p.id}')">编辑</button>
                <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer;padding:0" onclick="removeProduct('${shopId}','${p.id}')">删除</button>
              </div>
            </div>`).join('')}
        </div>`;
    })()}
  </div>

  <!-- 汇总卡片 -->
  <div class="stat-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-label">总访客量</div><div class="stat-value" style="color:${shop.color}">${fmt(sumVisitors)}</div></div>
    <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-label">支付人数</div><div class="stat-value">${fmt(sumBuyers)}</div></div>
    <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">支付件数</div><div class="stat-value">${fmt(sumQty)}</div></div>
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">支付金额</div><div class="stat-value" style="color:#f59e0b">${currSymbol}${sumAmt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">成交转化率</div><div class="stat-value">${avgConv}%</div></div>
    <div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">客均价</div><div class="stat-value">${sumBuyers>0?currSymbol+(sumAmt/sumBuyers).toFixed(2):'-'}</div></div>
  </div>

  <!-- 每日数据表 -->
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div class="card-title" style="margin:0">每日运营数据</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select onchange="setCBFilter('${shopId}',this.value)" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="" ${!filterMonth?'selected':''}>全部时间</option>
          ${getRecentMonths(6).map(m => `<option value="${m}" ${filterMonth===m?'selected':''}>${m.replace('-','年')}月</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" onclick="openAddCBDailyModal('${shopId}')">+ 录入每日数据</button>
        <button class="btn-secondary btn-sm" onclick="openImportCBModal('${shopId}')">📤 批量导入</button>
        ${rows.length > 0 ? `<button class="btn-secondary btn-sm" onclick="exportCBDaily('${shopId}')">导出 CSV</button>` : ''}
      </div>
    </div>

    ${rows.length === 0
      ? `<div style="text-align:center;color:#475569;padding:32px 0">
          <div style="font-size:32px;margin-bottom:8px">📅</div>
          <div>暂无数据，点击"录入每日数据"或"批量导入"</div>
        </div>`
      : `<div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>访客量</th><th>支付人数</th><th>支付件数</th><th>支付金额</th><th>转化率</th><th>客均价</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const conv = r.visitors > 0 ? (r.buyers/r.visitors*100).toFixed(2)+'%' : '-';
              const avgP = r.buyers > 0 ? currSymbol+(r.amount/r.buyers).toFixed(2) : '-';
              return `<tr>
                <td style="white-space:nowrap;font-weight:600">${r.date}</td>
                <td>${fmt(r.visitors||0)}</td>
                <td>${fmt(r.buyers||0)}</td>
                <td>${fmt(r.qty||0)}</td>
                <td style="color:#f59e0b;font-weight:700">${currSymbol}${(r.amount||0).toFixed(2)}</td>
                <td>${conv}</td>
                <td>${avgP}</td>
                <td style="max-width:140px;color:#94a3b8;font-size:11px">${r.remark ? `<span title="${r.remark}" style="cursor:help">${r.remark.length>20?r.remark.slice(0,20)+'…':r.remark}</span>` : '<span style="color:#334155">-</span>'}</td>
                <td>
                  <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer" onclick="openEditCBDailyModal('${shopId}','${r.id}')">编辑</button>
                  <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeCBDaily('${shopId}','${r.id}')">删</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
  </div>

  <!-- 录入每日数据弹窗 -->
  <div id="modal-cb-daily" class="modal" style="display:none">
    <div class="modal-content" style="max-width:440px">
      <div class="modal-header">
        <h3 id="cb-daily-modal-title">录入每日数据</h3>
        <button onclick="closeModal('modal-cb-daily')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px;display:grid;gap:12px">
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">日期 *</label>
          <input type="date" id="cb-daily-date" class="input-field"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">访客量</label>
          <input type="number" id="cb-daily-visitors" class="input-field" placeholder="0"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付人数</label>
          <input type="number" id="cb-daily-buyers" class="input-field" placeholder="0"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付件数</label>
          <input type="number" id="cb-daily-qty" class="input-field" placeholder="0"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付金额（${currSymbol}）</label>
          <input type="number" id="cb-daily-amount" class="input-field" placeholder="0.00" step="0.01"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（如：大促活动 / 广告投放 / 节日涨跌原因）</label>
          <input type="text" id="cb-daily-remark" class="input-field" placeholder="可选，记录当日涨跌原因"></div>
        <input type="hidden" id="cb-daily-edit-id">
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="closeModal('modal-cb-daily')">取消</button>
          <button class="btn-primary" onclick="saveCBDaily('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入弹窗 -->
  <div id="modal-cb-import" class="modal" style="display:none">
    <div class="modal-content" style="max-width:600px">
      <div class="modal-header">
        <h3>批量导入每日数据</h3>
        <button onclick="closeModal('modal-cb-import')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px">
        <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#64748b;line-height:1.8">
          <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明</div>
          每行一条记录，格式：<span style="color:#34d399;font-family:monospace">日期, 访客量, 支付人数, 支付件数, 支付金额</span><br>
          示例：<span style="color:#fbbf24;font-family:monospace">2026-03-01, 1200, 85, 120, 1580.50</span><br>
          也可直接粘贴 CSV 或 Excel 复制的内容，自动识别日期列
        </div>
        <div style="margin-bottom:14px">
          <button onclick="downloadTemplateCBDaily()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer;transition:all .2s" onmouseover="this.style.background='rgba(16,185,129,0.2)'" onmouseout="this.style.background='rgba(16,185,129,0.1)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载每日数据导入模板（CSV）
          </button>
        </div>
        <textarea id="cb-import-text" style="width:100%;height:180px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical" placeholder="粘贴数据..."></textarea>
        <div id="cb-import-preview" style="margin-top:10px;font-size:12px;color:#64748b"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px">
          <button class="btn-secondary" onclick="closeModal('modal-cb-import')">取消</button>
          <button class="btn-primary" onclick="importCBDaily('${shopId}')">导入</button>
        </div>
      </div>
    </div>
  </div>
  `;
}

function setCBFilter(shopId, month) {
  window._cbFilterMonth = month;
  const domesticEl = document.getElementById('domestic-detail-area');
  if (domesticEl) {
    const shop = DB.getShops().find(s => s.id === shopId);
    if (shop) domesticEl.innerHTML = renderCrossBorderDetail(shop);
  }
}

function openAddCBDailyModal(shopId) {
  document.getElementById('cb-daily-modal-title').textContent = '录入每日数据';
  document.getElementById('cb-daily-date').value = new Date().toISOString().slice(0,10);
  ['visitors','buyers','qty','amount'].forEach(k => { const el = document.getElementById('cb-daily-'+k); if(el) el.value = ''; });
  const rm = document.getElementById('cb-daily-remark'); if(rm) rm.value = '';
  document.getElementById('cb-daily-edit-id').value = '';
  document.getElementById('modal-cb-daily').style.display = 'flex';
}
function openEditCBDailyModal(shopId, rowId) {
  const r = CrossBorderDailyDB.getAll(shopId).find(x => x.id === rowId);
  if (!r) return;
  document.getElementById('cb-daily-modal-title').textContent = '编辑每日数据';
  document.getElementById('cb-daily-date').value = r.date || '';
  document.getElementById('cb-daily-visitors').value = r.visitors || '';
  document.getElementById('cb-daily-buyers').value = r.buyers || '';
  document.getElementById('cb-daily-qty').value = r.qty || '';
  document.getElementById('cb-daily-amount').value = r.amount || '';
  const rm = document.getElementById('cb-daily-remark'); if(rm) rm.value = r.remark || '';
  document.getElementById('cb-daily-edit-id').value = rowId;
  document.getElementById('modal-cb-daily').style.display = 'flex';
}
function saveCBDaily(shopId) {
  const date = document.getElementById('cb-daily-date').value;
  if (!date) { showToast('请选择日期','error'); return; }
  const editId = document.getElementById('cb-daily-edit-id').value;
  const remarkEl = document.getElementById('cb-daily-remark');
  const row = {
    id: editId || ('cbd_'+Date.now()),
    date,
    visitors: parseFloat(document.getElementById('cb-daily-visitors').value) || 0,
    buyers: parseFloat(document.getElementById('cb-daily-buyers').value) || 0,
    qty: parseFloat(document.getElementById('cb-daily-qty').value) || 0,
    amount: parseFloat(document.getElementById('cb-daily-amount').value) || 0,
    remark: remarkEl ? remarkEl.value.trim() : '',
  };
  CrossBorderDailyDB.upsert(shopId, row);
  closeModal('modal-cb-daily');
  setCBFilter(shopId, window._cbFilterMonth);
  showToast('已保存','success');
}
function removeCBDaily(shopId, rowId) {
  if (!confirm('确定删除这条数据？')) return;
  CrossBorderDailyDB.remove(shopId, rowId);
  setCBFilter(shopId, window._cbFilterMonth);
  showToast('已删除','info');
}
function openImportCBModal(shopId) {
  document.getElementById('cb-import-text').value = '';
  document.getElementById('cb-import-preview').textContent = '';
  document.getElementById('modal-cb-import').style.display = 'flex';
}
function importCBDaily(shopId) {
  const text = document.getElementById('cb-import-text').value.trim();
  if (!text) { showToast('请粘贴数据','error'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let count = 0, errors = 0;
  lines.forEach(line => {
    // 支持逗号、制表符分隔
    const parts = line.split(/[\t,，]+/).map(s => s.trim().replace(/^["']|["']$/g,''));
    if (parts.length < 2) return;
    // 找日期列（含-或/）
    const dateStr = parts.find(p => /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(p));
    if (!dateStr) { errors++; return; }
    const normalized = dateStr.replace(/\//g,'-').replace(/(\d{4})-(\d{1})-/,'$1-0$2-').replace(/-(\d{1})$/,'-0$1');
    const rest = parts.filter(p => p !== dateStr);
    const nums = rest.map(v => parseFloat(v.replace(/[^\d.]/g,'')) || 0);
    const row = {
      id: 'cbd_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      date: normalized,
      visitors: nums[0] || 0,
      buyers: nums[1] || 0,
      qty: nums[2] || 0,
      amount: nums[3] || 0,
    };
    CrossBorderDailyDB.upsert(shopId, row);
    count++;
  });
  closeModal('modal-cb-import');
  setCBFilter(shopId, window._cbFilterMonth);
  showToast(`✅ 导入 ${count} 条${errors>0?'，'+errors+'条格式错误':''}`, count>0?'success':'error');
}
function exportCBDaily(shopId) {
  const rows = CrossBorderDailyDB.getAll(shopId);
  if (!rows.length) return;
  const headers = ['日期','访客量','支付人数','支付件数','支付金额','转化率','客均价'];
  const data = rows.map(r => {
    const conv = r.visitors>0?(r.buyers/r.visitors*100).toFixed(2)+'%':'-';
    const avg = r.buyers>0?(r.amount/r.buyers).toFixed(2):'-';
    return [r.date, r.visitors||0, r.buyers||0, r.qty||0, r.amount||0, conv, avg];
  });
  const csv = [headers,...data].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`跨境每日_${shopId}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ============================================
//  页面：数据导入
// ============================================
function renderImport() {
  const pg = document.getElementById('page-import');
  const shops = DB.getShops();
  pg.innerHTML = `
    <div class="page-header"><h1>📁 数据导入</h1><p>支持 CSV / Excel 文件导入，系统自动识别字段并合并数据</p></div>
    <div class="import-grid">
      <!-- 导入区域 -->
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📤 上传数据文件</div>
          <div class="import-zone" id="drop-zone" onclick="document.getElementById('file-input').click()" 
               ondragover="event.preventDefault();this.classList.add('dragover')" 
               ondragleave="this.classList.remove('dragover')"
               ondrop="handleDrop(event)">
            <div class="import-icon">📂</div>
            <div class="import-title">点击或拖拽文件到此处</div>
            <div class="import-sub">支持 .csv / .xlsx / .xls 格式</div>
          </div>
          <input type="file" id="file-input" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleFileSelect(event)">
        </div>

        <div class="card">
          <div class="card-title">⚙️ 导入设置</div>
          <div class="form-group">
            <label>目标店铺</label>
            <select id="import-target-shop" onchange="updateImportFormatTips()">
              ${shops.map(s => `<option value="${s.id}" data-platform="${s.platform}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>数据模式</label>
            <select id="import-mode">
              <option value="append">追加（保留原有数据）</option>
              <option value="replace">替换（覆盖该店铺数据）</option>
            </select>
          </div>
          <div id="import-preview" style="display:none">
            <div class="card-title" style="margin-top:16px">📋 预览（前5行）</div>
            <div class="table-wrap" id="preview-table"></div>
            <div style="margin-top:12px;display:flex;gap:10px">
              <button class="btn-primary" onclick="confirmImport()">✅ 确认导入</button>
              <button class="btn-secondary" onclick="cancelImport()">取消</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 格式说明 -->
      <div>
        <div class="card" style="margin-bottom:16px" id="import-format-card">
          <div class="card-title">📋 文件格式说明</div>
          <div id="import-format-tips">
            <p style="font-size:13px;color:#6b7280;margin-bottom:12px">请先选择目标店铺，系统将显示对应格式说明</p>
          </div>
          <!-- 模板下载区（固定展示全部类型） -->
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1e293b">
            <div style="font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:10px;display:flex;align-items:center;gap:6px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              下载导入模板
            </div>
            <!-- 国内平台模板 -->
            <div style="margin-bottom:10px">
              <div style="font-size:11px;color:#7c3aed;font-weight:600;margin-bottom:6px;padding:3px 8px;background:rgba(124,58,237,0.1);border-radius:4px;display:inline-block">🏪 国内平台（淘宝/天猫/京东/拼多多/抖音等）</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <button onclick="downloadTemplateDomesticBatch()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(124,58,237,0.3);background:rgba(124,58,237,0.08);color:#a78bfa;font-size:12px;cursor:pointer;text-align:left;transition:all .2s" onmouseover="this.style.background='rgba(124,58,237,0.18)'" onmouseout="this.style.background='rgba(124,58,237,0.08)'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <div>
                    <div style="font-weight:600">生意参谋每日数据模板</div>
                    <div style="font-size:10px;color:#64748b;margin-top:1px">日期 / 访客数 / 浏览量 / 支付金额 / 订单量 / 款式名称</div>
                  </div>
                </button>
                <button onclick="downloadTemplateDomestic()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(124,58,237,0.3);background:rgba(124,58,237,0.08);color:#a78bfa;font-size:12px;cursor:pointer;text-align:left;transition:all .2s" onmouseover="this.style.background='rgba(124,58,237,0.18)'" onmouseout="this.style.background='rgba(124,58,237,0.08)'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <div>
                    <div style="font-weight:600">国内款式销售数据模板</div>
                    <div style="font-size:10px;color:#64748b;margin-top:1px">日期 / 款式名称 / 订单量 / 营业额(¥) / 退款单 / 单价</div>
                  </div>
                </button>
              </div>
            </div>
            <!-- 跨境平台模板 -->
            <div>
              <div style="font-size:11px;color:#06b6d4;font-weight:600;margin-bottom:6px;padding:3px 8px;background:rgba(6,182,212,0.1);border-radius:4px;display:inline-block">🌏 跨境平台（SHEIN/Amazon/Temu/TikTok/Shopee等）</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <button onclick="downloadTemplateCBDaily()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(6,182,212,0.3);background:rgba(6,182,212,0.08);color:#34d399;font-size:12px;cursor:pointer;text-align:left;transition:all .2s" onmouseover="this.style.background='rgba(6,182,212,0.18)'" onmouseout="this.style.background='rgba(6,182,212,0.08)'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <div>
                    <div style="font-weight:600">跨境店铺每日数据模板</div>
                    <div style="font-size:10px;color:#64748b;margin-top:1px">日期 / 访客量 / 支付人数 / 支付件数 / 支付金额($)</div>
                  </div>
                </button>
                <button onclick="downloadTemplateCrossBorder()" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(6,182,212,0.3);background:rgba(6,182,212,0.08);color:#34d399;font-size:12px;cursor:pointer;text-align:left;transition:all .2s" onmouseover="this.style.background='rgba(6,182,212,0.18)'" onmouseout="this.style.background='rgba(6,182,212,0.08)'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <div>
                    <div style="font-weight:600">跨境款式销售数据模板</div>
                    <div style="font-size:10px;color:#64748b;margin-top:1px">日期 / 款式名称 / 订单量 / 营业额($) / 退款单 / 单价</div>
                  </div>
                </button>
              </div>
            </div>
            <!-- 动态模板（根据所选店铺显示推荐） -->
            <div id="import-template-btns" style="margin-top:10px"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">📊 导入历史</div>
          <div id="import-history">
            <div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:24px">📭</div><p>暂无导入记录</p></div>
          </div>
        </div>
      </div>
    </div>`;
  loadImportHistory();
  updateImportFormatTips();
}

let pendingImportData = null;

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = e => parseCSV(e.target.result, file.name);
    reader.readAsText(file, 'UTF-8');
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = e => parseExcel(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  } else {
    showToast('⚠️ 不支持的文件格式，请使用 CSV 或 Excel', 'error');
  }
}

function parseCSV(text, filename) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  }).filter(r => Object.values(r).some(v => v));
  showPreview(rows, filename);
}

function parseExcel(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  showPreview(rows, filename);
}

function normalizeRow(row) {
  const map = { '日期': 'date', '款式名称': 'styleName', '款式': 'styleName', '订单量': 'orders', '订单': 'orders', '营业额': 'revenue', '退款单': 'refundOrders', '单价': 'price' };
  const out = {};
  Object.keys(row).forEach(k => { out[map[k] || k] = row[k]; });
  return {
    date: out.date || '',
    styleId: out.styleName || out.style || '',
    styleName: out.styleName || out.style || '',
    orders: parseInt(out.orders) || 0,
    revenue: parseFloat(out.revenue) || 0,
    refundOrders: parseInt(out.refundOrders) || 0,
    price: parseFloat(out.price) || 0,
  };
}

function showPreview(rows, filename) {
  pendingImportData = { rows, filename };
  const preview = document.getElementById('import-preview');
  const tableDiv = document.getElementById('preview-table');
  preview.style.display = 'block';
  const sample = rows.slice(0, 5);
  const keys = Object.keys(sample[0] || {});
  tableDiv.innerHTML = `<table>
    <thead><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
    <tbody>${sample.map(r => `<tr>${keys.map(k => `<td>${r[k]}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
  showToast(`📋 已读取 ${rows.length} 行数据，请确认后导入`, 'info');
}

function confirmImport() {
  if (!pendingImportData) return;
  const shopId = document.getElementById('import-target-shop').value;
  const mode = document.getElementById('import-mode').value;
  const { rows, filename } = pendingImportData;

  const normalized = rows.map(r => ({ ...normalizeRow(r), shopId })).filter(r => r.date && r.styleName);

  let existing = DB.getSalesData();
  if (mode === 'replace') existing = existing.filter(d => d.shopId !== shopId);
  existing.push(...normalized);
  DB.setSalesData(existing);

  // 记录导入历史
  const history = DB.get('import_history', []);
  history.unshift({ filename, shopId, count: normalized.length, time: new Date().toLocaleString(), mode });
  DB.set('import_history', history.slice(0, 20));

  pendingImportData = null;
  document.getElementById('import-preview').style.display = 'none';
  showToast(`✅ 成功导入 ${normalized.length} 条数据到 ${getShopName(shopId)}`, 'success');
  loadImportHistory();
}

function cancelImport() {
  pendingImportData = null;
  document.getElementById('import-preview').style.display = 'none';
}

function loadImportHistory() {
  const history = DB.get('import_history', []);
  const el = document.getElementById('import-history');
  if (!el) return;
  if (!history.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:24px">📭</div><p>暂无导入记录</p></div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>文件名</th><th>店铺</th><th>条数</th><th>时间</th></tr></thead>
    <tbody>${history.map(h => `<tr>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${h.filename}</td>
      <td>${getShopName(h.shopId)}</td>
      <td><span class="badge badge-green">${h.count}</span></td>
      <td style="font-size:11px;color:#9ca3af">${h.time}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// 跨境店铺每日数据模板（店铺详情页批量导入弹窗用）
function downloadTemplateCBDaily() {
  const csv = '日期,访客量,支付人数,支付件数,支付金额\n2026-03-01,1200,85,120,1580.50\n2026-03-02,1350,92,135,1820.00\n2026-03-03,980,70,98,1260.50';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '跨境店铺每日数据导入模板.csv';
  a.click();
  showToast('⬇️ 每日数据模板已下载', 'success');
}

// 根据所选店铺类型，动态更新格式说明和模板下载按钮
function updateImportFormatTips() {
  const sel = document.getElementById('import-target-shop');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const platform = opt ? opt.getAttribute('data-platform') : '';
  const isDomestic = DOMESTIC_PLATFORMS.has(platform);
  const tipsEl = document.getElementById('import-format-tips');
  const btnsEl = document.getElementById('import-template-btns');
  if (!tipsEl || !btnsEl) return;

  if (isDomestic) {
    tipsEl.innerHTML = `
      <p style="font-size:13px;color:#6b7280;margin-bottom:10px">国内店铺（${platform}）款式销售数据，CSV/Excel 需包含以下列：</p>
      <table style="font-size:12px">
        <thead><tr><th>列名</th><th>说明</th><th>必填</th></tr></thead>
        <tbody>
          <tr><td>日期</td><td>格式 YYYY-MM-DD</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>款式名称</td><td>商品款式名</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>订单量</td><td>当日订单数</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>营业额</td><td>当日营业额（¥）</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>退款单</td><td>退款订单数</td><td><span class="badge badge-yellow">选填</span></td></tr>
          <tr><td>单价</td><td>商品单价（¥）</td><td><span class="badge badge-yellow">选填</span></td></tr>
        </tbody>
      </table>`;
    btnsEl.innerHTML = `<button class="btn-primary" onclick="downloadTemplateDomestic()">⬇️ 下载国内店铺模板（CSV）</button>`;
  } else {
    tipsEl.innerHTML = `
      <p style="font-size:13px;color:#6b7280;margin-bottom:10px">跨境店铺（${platform || '跨境'}）款式销售数据，CSV/Excel 需包含以下列：</p>
      <table style="font-size:12px">
        <thead><tr><th>列名</th><th>说明</th><th>必填</th></tr></thead>
        <tbody>
          <tr><td>日期</td><td>格式 YYYY-MM-DD</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>款式名称</td><td>商品款式名</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>订单量</td><td>当日订单数</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>营业额</td><td>当日营业额（$，美元）</td><td><span class="badge badge-red">必填</span></td></tr>
          <tr><td>退款单</td><td>退款订单数</td><td><span class="badge badge-yellow">选填</span></td></tr>
          <tr><td>单价</td><td>商品单价（$）</td><td><span class="badge badge-yellow">选填</span></td></tr>
        </tbody>
      </table>`;
    btnsEl.innerHTML = `<button class="btn-primary" onclick="downloadTemplateCrossBorder()">⬇️ 下载跨境店铺模板（CSV）</button>`;
  }
}

function downloadTemplateDomestic() {
  const csv = '日期,款式名称,订单量,营业额,退款单,单价\n2026-03-01,连衣裙A款,25,1250.00,2,50.00\n2026-03-01,牛仔裤B款,18,900.00,1,50.00\n2026-03-02,卫衣C款,30,1500.00,3,50.00';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '国内店铺数据导入模板.csv';
  a.click();
  showToast('⬇️ 国内店铺模板已下载', 'success');
}

function downloadTemplateCrossBorder() {
  const csv = '日期,款式名称,订单量,营业额,退款单,单价\n2026-03-01,Dress Style A,25,62.50,2,2.50\n2026-03-01,Jeans Style B,18,45.00,1,2.50\n2026-03-02,Hoodie Style C,30,75.00,3,2.50';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '跨境店铺数据导入模板.csv';
  a.click();
  showToast('⬇️ 跨境店铺模板已下载', 'success');
}

function downloadTemplate() {

  const csv = '日期,款式名称,订单量,营业额,退款单,单价\n2026-03-01,连衣裙A款,25,1250.00,2,50.00\n2026-03-01,牛仔裤B款,18,900.00,1,50.00\n2026-03-02,卫衣C款,30,1500.00,3,50.00';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'SHEIN数据导入模板.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('⬇️ 模板已下载', 'success');
}

// ============================================
//  页面：利润计算器
// ============================================
function renderProfit() {
  const pg = document.getElementById('page-profit');
  const shops = DB.getShops();
  pg.innerHTML = `
    <div class="page-header"><h1>📐 利润计算器</h1><p>计算每款商品的实际利润，帮助优化定价策略</p></div>

    <div class="calc-grid">
      <!-- 计算器 -->
      <div class="card">
        <div class="card-title">✦ 单款利润计算</div>
        <div class="form-group">
          <label>商品售价（¥）</label>
          <input type="number" id="calc-price" placeholder="50.00" oninput="calcProfit()" step="0.01">
        </div>
        <div class="form-group">
          <label>商品成本（¥）</label>
          <input type="number" id="calc-cost" placeholder="20.00" oninput="calcProfit()" step="0.01">
        </div>
        <div class="form-group">
          <label>平台佣金率（%）</label>
          <input type="number" id="calc-commission" placeholder="10" value="10" oninput="calcProfit()" step="0.1">
        </div>
        <div class="form-group">
          <label>运费（¥）</label>
          <input type="number" id="calc-shipping" placeholder="3.00" value="3" oninput="calcProfit()" step="0.01">
        </div>
        <div class="form-group">
          <label>退款率（%）</label>
          <input type="number" id="calc-refund" placeholder="5" value="5" oninput="calcProfit()" step="0.1">
        </div>
        <div class="form-group">
          <label>预计月销量（件）</label>
          <input type="number" id="calc-qty" placeholder="100" oninput="calcProfit()">
        </div>
        <button class="btn-primary" onclick="calcProfit()" style="width:100%;margin-top:8px">✦ 计算利润</button>
      </div>

      <!-- 结果 -->
      <div>
        <div class="calc-result card" style="margin-bottom:16px">
          <div class="calc-result-label">单件净利润</div>
          <div class="calc-result-val" id="calc-net">¥0.00</div>
          <div style="color:#64748b;font-size:12px;margin-top:6px" id="calc-margin">利润率：0%</div>
        </div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📊 利润拆解</div>
          <div id="calc-breakdown" style="font-size:13px;color:#94a3b8">
            <p style="text-align:center;padding:20px;color:#475569">请输入商品信息后计算</p>
          </div>
        </div>
        <div class="card">
          <div class="card-title">📈 月利润预测</div>
          <div id="calc-monthly" style="font-size:13px;color:#94a3b8">
            <p style="text-align:center;padding:20px;color:#475569">请填写月销量后预测</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量分析 -->
    <div class="card" style="margin-top:20px">
      <div class="card-title">📋 店铺商品利润概览（基于近30天数据）</div>
      <div class="filter-bar">
        <label>店铺：</label>
        <select id="profit-shop-filter" onchange="renderProfitTable()">
          <option value="">全部店铺</option>
          ${shops.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <label>成本率假设：</label>
        <select id="profit-cost-rate" onchange="renderProfitTable()">
          <option value="0.4">40%（标准）</option>
          <option value="0.3">30%（低成本）</option>
          <option value="0.5">50%（高成本）</option>
        </select>
      </div>
      <div class="table-wrap">
        <table id="profit-table">
          <thead><tr><th>款式名称</th><th>总营业额</th><th>预计成本</th><th>佣金(10%)</th><th>预计净利润</th><th>利润率</th><th>评级</th></tr></thead>
          <tbody id="profit-tbody"></tbody>
        </table>
      </div>
    </div>`;

  calcProfit();
  renderProfitTable();
}

function calcProfit() {
  const price = parseFloat(document.getElementById('calc-price')?.value) || 0;
  const cost = parseFloat(document.getElementById('calc-cost')?.value) || 0;
  const commission = parseFloat(document.getElementById('calc-commission')?.value) || 10;
  const shipping = parseFloat(document.getElementById('calc-shipping')?.value) || 0;
  const refundRate = parseFloat(document.getElementById('calc-refund')?.value) || 0;
  const qty = parseInt(document.getElementById('calc-qty')?.value) || 0;

  if (!price) return;

  const commissionAmt = price * commission / 100;
  const refundCost = price * refundRate / 100;
  const netProfit = price - cost - commissionAmt - shipping - refundCost;
  const margin = price > 0 ? (netProfit / price * 100).toFixed(1) : 0;
  const monthlyProfit = qty > 0 ? netProfit * qty : 0;

  const el = document.getElementById('calc-net');
  const elM = document.getElementById('calc-margin');
  if (el) { el.textContent = '¥' + netProfit.toFixed(2); el.style.color = netProfit >= 0 ? '#34d399' : '#f87171'; }
  if (elM) { elM.textContent = `利润率：${margin}%`; elM.style.color = margin >= 20 ? '#34d399' : margin >= 10 ? '#fbbf24' : '#f87171'; }

  const breakdown = document.getElementById('calc-breakdown');
  if (breakdown) {
    const items = [
      { label: '💰 售价', val: price, color: '#22d3ee' },
      { label: '  - 商品成本', val: -cost, color: '#f87171' },
      { label: `  - 平台佣金(${commission}%)`, val: -commissionAmt, color: '#f87171' },
      { label: '  - 运费', val: -shipping, color: '#f87171' },
      { label: `  - 退款损耗(${refundRate}%)`, val: -refundCost, color: '#f87171' },
      { label: '= 净利润', val: netProfit, color: netProfit >= 0 ? '#34d399' : '#f87171', bold: true },
    ];
    breakdown.innerHTML = items.map(it => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="${it.bold?'font-weight:700;color:#fff':'color:#94a3b8'}">${it.label}</span>
        <span style="color:${it.color};font-weight:600">¥${Math.abs(it.val).toFixed(2)}</span>
      </div>`).join('');
  }

  const monthly = document.getElementById('calc-monthly');
  if (monthly && qty > 0) {
    monthly.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="color:#94a3b8">月销量</span><span style="color:#fff;font-weight:600">${qty.toLocaleString()} 件</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="color:#94a3b8">月营业额</span><span style="color:#22d3ee;font-weight:700">¥${(price*qty).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0">
        <span style="color:#94a3b8">月净利润</span>
        <span style="color:${monthlyProfit>=0?'#34d399':'#f87171'};font-weight:700;font-size:18px">¥${monthlyProfit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,',')}</span>
      </div>`;
  }
}

function renderProfitTable() {
  const shopId = document.getElementById('profit-shop-filter')?.value;
  const costRate = parseFloat(document.getElementById('profit-cost-rate')?.value) || 0.4;
  const data = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0), shopId: shopId || undefined });
  const styleSum = sumByStyle(data).sort((a,b) => b.revenue - a.revenue);
  const tbody = document.getElementById('profit-tbody');
  if (!tbody) return;
  tbody.innerHTML = styleSum.slice(0, 20).map(s => {
    const cost = s.revenue * costRate;
    const commission = s.revenue * 0.1;
    const netProfit = s.revenue - cost - commission;
    const margin = (netProfit / s.revenue * 100).toFixed(1);
    const grade = margin >= 30 ? '<span class="badge badge-green">优质</span>' : margin >= 15 ? '<span class="badge badge-blue">良好</span>' : margin >= 0 ? '<span class="badge badge-yellow">一般</span>' : '<span class="badge badge-red">亏损</span>';
    return `<tr>
      <td><strong>${s.styleName}</strong></td>
      <td style="color:#22d3ee;font-weight:600">${fmtMoney(s.revenue)}</td>
      <td style="color:#f87171">${fmtMoney(cost)}</td>
      <td style="color:#f87171">${fmtMoney(commission)}</td>
      <td style="color:${netProfit>=0?'#34d399':'#f87171'};font-weight:700">${fmtMoney(netProfit)}</td>
      <td style="color:${margin>=20?'#34d399':margin>=10?'#fbbf24':'#f87171'}">${margin}%</td>
      <td>${grade}</td>
    </tr>`;
  }).join('');
}

// ============================================
//  页面：预警中心
// ============================================
function renderAlert() {
  const pg = document.getElementById('page-alert');
  const shops = DB.getShops();
  const data30 = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) });
  const data7 = aggregateSales({ startDate: getPastDate(7), endDate: getPastDate(0) });
  const dataPrev7 = aggregateSales({ startDate: getPastDate(14), endDate: getPastDate(8) });

  // 计算各种预警
  const alerts = [];
  const shopSum30 = sumByShop(data30);
  const shopSum7 = sumByShop(data7);
  const shopSumPrev7 = sumByShop(dataPrev7);

  // 检查每个店铺
  shops.forEach(shop => {
    const s7 = shopSum7.find(s => s.shopId === shop.id) || { revenue: 0, orders: 0 };
    const sp7 = shopSumPrev7.find(s => s.shopId === shop.id) || { revenue: 0, orders: 0 };
    const s30 = shopSum30.find(s => s.shopId === shop.id) || { revenue: 0, orders: 0 };

    // 营业额大幅下滑预警
    if (sp7.revenue > 0) {
      const drop = ((s7.revenue - sp7.revenue) / sp7.revenue * 100);
      if (drop < -20) {
        alerts.push({ level: 'danger', shop: shop.name, icon: '📉', msg: `营业额周环比下滑 ${Math.abs(drop.toFixed(1))}%，需关注`, type: '营收预警', shopId: shop.id });
      } else if (drop < -10) {
        alerts.push({ level: 'warn', shop: shop.name, icon: '⚠️', msg: `营业额周环比下滑 ${Math.abs(drop.toFixed(1))}%，请留意`, type: '营收提醒', shopId: shop.id });
      }
    }

    // 零销售预警
    if (s7.orders === 0 && s30.orders > 0) {
      alerts.push({ level: 'danger', shop: shop.name, icon: '🔴', msg: '近7天无订单，请检查店铺状态', type: '停滞预警', shopId: shop.id });
    }

    // 退款率高预警
    if (s30.orders > 10 && s30.refundOrders / s30.orders > 0.1) {
      alerts.push({ level: 'warn', shop: shop.name, icon: '↩️', msg: `退款率 ${(s30.refundOrders/s30.orders*100).toFixed(1)}% 偏高，建议核查商品质量`, type: '退款预警', shopId: shop.id });
    }
  });

  // 跨店爆款机会预警
  const styleSum = sumByStyle(data30);
  const hotThreshold = Math.max(3, Math.floor(shops.length * 0.4));
  const hotStyles = styleSum.filter(s => s.shopCount >= hotThreshold && s.shopCount < shops.length * 0.8);
  if (hotStyles.length > 0) {
    alerts.push({ level: 'ok', shop: '全局', icon: '🔥', msg: `发现 ${hotStyles.length} 款潜力爆款，可在更多店铺推广：${hotStyles.slice(0,3).map(s=>s.styleName).join('、')}`, type: '机会提示' });
  }

  if (alerts.length === 0) {
    alerts.push({ level: 'ok', shop: '全局', icon: '✅', msg: '所有店铺运营正常，未发现异常指标', type: '状态良好' });
  }

  // 更新侧边栏预警数量
  const dangerCount = alerts.filter(a => a.level === 'danger').length;
  const warnCount = alerts.filter(a => a.level === 'warn').length;
  const nb = document.getElementById('nb-alert');
  if (nb) { const total = dangerCount + warnCount; nb.textContent = total; nb.style.display = total > 0 ? 'block' : 'none'; }

  pg.innerHTML = `
    <div class="page-header"><h1>🔔 预警中心</h1><p>实时监控各店铺经营状态，及时发现异常并提示</p></div>

    <!-- 预警统计 -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">🔴</div>
        <div class="stat-label">严重预警</div>
        <div class="stat-value" style="color:#f87171">${alerts.filter(a=>a.level==='danger').length}</div>
        <div class="stat-sub" style="color:#64748b">需立即处理</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⚠️</div>
        <div class="stat-label">一般提醒</div>
        <div class="stat-value" style="color:#fbbf24">${alerts.filter(a=>a.level==='warn').length}</div>
        <div class="stat-sub" style="color:#64748b">需关注</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💡</div>
        <div class="stat-label">机会提示</div>
        <div class="stat-value" style="color:#22d3ee">${alerts.filter(a=>a.level==='ok').length}</div>
        <div class="stat-sub" style="color:#64748b">可优化项</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏪</div>
        <div class="stat-label">监控店铺</div>
        <div class="stat-value" style="color:#a78bfa">${shops.length}</div>
        <div class="stat-sub" style="color:#64748b">全量监控</div>
      </div>
    </div>

    <!-- 预警列表 -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">📋 预警明细</div>
      ${alerts.map(a => `
        <div class="alert-card" style="
          background:${a.level==='danger'?'rgba(239,68,68,0.07)':a.level==='warn'?'rgba(245,158,11,0.07)':'rgba(16,185,129,0.06)'};
          border:1px solid ${a.level==='danger'?'rgba(239,68,68,0.2)':a.level==='warn'?'rgba(245,158,11,0.2)':'rgba(16,185,129,0.15)'};
          border-radius:10px;padding:14px 16px;margin-bottom:10px;
          display:flex;align-items:center;gap:14px;
          animation:cardIn 0.3s ease;
        ">
          <span style="font-size:22px">${a.icon}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="alert-tag ${a.level==='danger'?'alert-danger':a.level==='warn'?'alert-warn':'alert-ok'}">${a.type}</span>
              <span style="font-size:13px;font-weight:600;color:#e2e8f0">${a.shop}</span>
            </div>
            <div style="font-size:13px;color:#94a3b8">${a.msg}</div>
          </div>
          ${a.shopId ? `<button class="btn-secondary btn-sm" onclick="navigate('shop-detail','${a.shopId}')">查看详情</button>` : ''}
        </div>`).join('')}
    </div>

    <!-- 各店铺健康度 -->
    <div class="card">
      <div class="card-title">🏥 店铺健康度评分（近30天）</div>
      ${shops.map(shop => {
        const s = shopSum30.find(x => x.shopId === shop.id) || { revenue: 0, orders: 0, refundOrders: 0 };
        const s7 = shopSum7.find(x => x.shopId === shop.id) || { revenue: 0 };
        const sp7 = shopSumPrev7.find(x => x.shopId === shop.id) || { revenue: 1 };
        const trend = sp7.revenue > 0 ? s7.revenue / sp7.revenue : 1;
        const refundRate = s.orders > 0 ? s.refundOrders / s.orders : 0;
        const score = Math.min(100, Math.max(0,
          (s.orders > 0 ? 40 : 0) +
          (trend >= 1 ? 30 : trend >= 0.8 ? 20 : 5) +
          (refundRate < 0.05 ? 30 : refundRate < 0.1 ? 20 : 10)
        ));
        const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
        return `
          <div class="goal-card">
            <div style="width:10px;height:10px;border-radius:50%;background:${shop.color};flex-shrink:0;box-shadow:0 0 6px ${shop.color}"></div>
            <div class="goal-info">
              <div class="goal-label" style="cursor:pointer" onclick="navigate('shop-detail','${shop.id}')">${shop.name}</div>
              <div class="goal-progress-wrap">
                <div class="goal-bar"><div class="goal-bar-fill" style="width:${score}%;background:linear-gradient(90deg,${color},${color}88)"></div></div>
                <span class="goal-pct" style="color:${color}">${score}</span>
              </div>
            </div>
            <div style="text-align:right;min-width:80px">
              <div style="font-size:12px;color:#94a3b8">30天营收</div>
              <div style="font-size:13px;font-weight:700;color:${shop.color}">${fmtMoney(s.revenue)}</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ============================================
//  页面：知识学院
// ============================================
let academyArticles = []; // 内存缓存

async function renderAcademy() {
  const pg = document.getElementById('page-academy');
  pg.innerHTML = `
    <div class="header-row">
      <div>
        <h1 style="display:flex;align-items:center;gap:10px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#acg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <defs><linearGradient id="acg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs>
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          共享知识学院
        </h1>
        <p style="color:#64748b;font-size:13px;margin-top:4px">团队共享经验，共同成长进步</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-secondary" onclick="openAcademySearch()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          搜索
        </button>
        <button class="btn-primary" onclick="openModal_addArticle()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:-2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          分享知识
        </button>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="tabs" id="academy-tabs" style="margin-bottom:20px">
      <div class="tab active" onclick="filterAcademy('全部')">全部</div>
      <div class="tab" onclick="filterAcademy('运营经验')">运营经验</div>
      <div class="tab" onclick="filterAcademy('选品技巧')">选品技巧</div>
      <div class="tab" onclick="filterAcademy('物流仓储')">物流仓储</div>
      <div class="tab" onclick="filterAcademy('广告投放')">广告投放</div>
      <div class="tab" onclick="filterAcademy('数据分析')">数据分析</div>
      <div class="tab" onclick="filterAcademy('其他')">其他</div>
    </div>

    <div id="academy-list">
      <div class="skeleton-list">
        ${Array(3).fill('<div class="card" style="margin-bottom:12px;height:120px"><div class="skeleton" style="height:100%"></div></div>').join('')}
      </div>
    </div>`;

  await loadAcademyArticles();
}

async function loadAcademyArticles() {
  try {
    let articles;
    if (SUPABASE_ENABLED) {
      articles = await sbFetch('academy?select=*,users(nickname,phone)&order=created_at.desc');
      // 扁平化 author 信息
      articles = articles.map(a => ({
        ...a,
        author_name: a.author_name || (a.users ? (a.users.nickname || a.users.phone) : '匿名'),
        users: undefined
      }));
    } else {
      articles = Cache.get('academy_articles', getDemoAcademyArticles());
    }
    academyArticles = articles;
    renderAcademyList(articles);
  } catch(e) {
    document.getElementById('academy-list').innerHTML = `<div class="empty-state"><p style="color:#f87171">加载失败：${e.message}</p></div>`;
  }
}

function getDemoAcademyArticles() {
  return [
    { id: 1, title: 'SHEIN爆款选品核心逻辑', category: '选品技巧', author_name: '管理员', content: '爆款选品要关注以下几个核心指标：\n1. 趋势性：Google Trends 上升趋势\n2. 竞争度：平台搜索量高但竞品少\n3. 利润空间：成本率控制在40%以内\n4. 评价质量：同类商品差评中发现优化点\n\n实操中建议每周复盘Top10款式的共同特征，建立选品数据库。', likes: 12, created_at: '2026-03-20T10:00:00' },
    { id: 2, title: '如何降低退款率：实战经验', category: '运营经验', author_name: '团队成员', content: '退款率偏高的主要原因：\n• 商品描述与实物不符（占40%退款原因）\n• 尺码问题（跨境服装最常见）\n• 物流时间过长导致买家取消\n\n解决方案：\n1. 上传真实详细的产品图\n2. 提供精准的尺码对照表\n3. 选择稳定的物流渠道', likes: 8, created_at: '2026-03-22T14:30:00' },
  ];
}

function renderAcademyList(articles) {
  const container = document.getElementById('academy-list');
  if (!articles || articles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="margin-bottom:12px"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <p style="color:#475569">暂无文章，成为第一个分享知识的人吧！</p>
        <button class="btn-primary" style="margin-top:12px" onclick="openModal_addArticle()">立即分享</button>
      </div>`;
    return;
  }

  const iconMap = { 'image':'🖼️', 'pdf':'📄', 'xlsx':'📊', 'xls':'📊', 'docx':'📝', 'doc':'📝', 'pptx':'📑', 'ppt':'📑', 'zip':'🗜️', 'csv':'📋', 'txt':'📃' };

  container.innerHTML = articles.map(a => {
    const isOwner = CURRENT_USER && (CURRENT_USER.id === a.author_id || CURRENT_USER.role === 'admin');
    const date = a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN') : '';
    const preview = a.content ? a.content.slice(0, 120).replace(/\n/g, ' ') + (a.content.length > 120 ? '...' : '') : '';
    const catColors = { '运营经验':'#7c3aed','选品技巧':'#06b6d4','物流仓储':'#10b981','广告投放':'#f59e0b','数据分析':'#6366f1','其他':'#64748b' };
    const catColor = catColors[a.category] || '#64748b';

    // 附件解析
    let attachHtml = '';
    if (a.attachments) {
      try {
        const atts = JSON.parse(a.attachments);
        if (atts.length) {
          attachHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">` +
            atts.map(att => {
              const ext = att.name.split('.').pop().toLowerCase();
              const icon = att.type && att.type.startsWith('image') ? '🖼️' : (iconMap[ext] || '📎');
              const size = att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : Math.round(att.size/1024)+'KB';
              const downloadAttr = att.data ? `onclick="downloadAttachment('${att.name}','${att.data}')"` : '';
              return `<span ${downloadAttr} style="display:flex;align-items:center;gap:4px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:5px;padding:3px 8px;font-size:11px;cursor:${att.data?'pointer':'default'};color:#a5b4fc" title="${att.name}">
                ${icon} <span style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${att.name}</span> <span style="color:#475569">${size}</span>
              </span>`;
            }).join('') + `</div>`;
        }
      } catch(e) {}
    }

    // 角色标签
    const roleHtml = a.role_name ? `<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${(a.role_color||'#7c3aed')}22;color:${a.role_color||'#a78bfa'};border:1px solid ${(a.role_color||'#7c3aed')}44;margin-right:4px">👤 ${a.role_name}</span>` : '';

    return `
    <div class="academy-card" id="ac-${a.id}">
      <div class="academy-card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span class="badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;font-size:11px">${a.category || '其他'}</span>
            ${roleHtml}
            <h3 class="academy-title">${a.title}</h3>
          </div>
          <p class="academy-preview">${preview}</p>
          ${attachHtml}
        </div>
      </div>
      <div class="academy-card-footer">
        <div style="display:flex;align-items:center;gap:14px">
          <span style="font-size:12px;color:#475569;display:flex;align-items:center;gap:4px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${a.author_name || '匿名'}
          </span>
          <span style="font-size:12px;color:#334155">${date}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="academy-expand-btn" onclick="toggleArticle(${a.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            展开阅读
          </button>
          ${isOwner ? `<button class="btn-danger btn-sm" onclick="deleteArticle(${a.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            删除
          </button>` : ''}
        </div>
      </div>
      <div class="academy-full-content" id="ac-content-${a.id}" style="display:none">
        <div class="academy-divider"></div>
        <div class="academy-content-text">${(a.content || '').replace(/\n/g,'<br>')}</div>
      </div>
    </div>`;
  }).join('');
}

function filterAcademy(category) {
  document.querySelectorAll('#academy-tabs .tab').forEach((el, i) => {
    const cats = ['全部','运营经验','选品技巧','物流仓储','广告投放','数据分析','其他'];
    el.classList.toggle('active', cats[i] === category);
  });
  const filtered = category === '全部' ? academyArticles : academyArticles.filter(a => a.category === category);
  renderAcademyList(filtered);
}

// ============ 知识学院 - 搜索弹窗 ============
function openAcademySearch() {
  // 如果已存在就先移除
  const old = document.getElementById('academy-search-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'academy-search-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:80px';
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;width:94%;max-width:680px;max-height:75vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <!-- 搜索头部 -->
      <div style="padding:20px 20px 16px;border-bottom:1px solid #1e293b">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1;display:flex;align-items:center;gap:10px;background:#0f172a;border:1.5px solid #334155;border-radius:10px;padding:0 14px;transition:border-color 0.2s" id="search-input-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="academy-search-input" type="text" placeholder="搜索标题、内容、作者、分类…" autocomplete="off"
              style="flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-size:15px;padding:12px 0"
              oninput="doAcademySearch(this.value)"
              onkeydown="if(event.key==='Escape')closeAcademySearch()">
            <button id="search-clear-btn" onclick="clearAcademySearch()" style="display:none;background:none;border:none;cursor:pointer;color:#475569;padding:0;line-height:1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <button onclick="closeAcademySearch()" style="flex-shrink:0;background:rgba(71,85,105,0.3);border:1px solid #334155;border-radius:8px;color:#94a3b8;padding:8px 14px;cursor:pointer;font-size:13px">关闭</button>
        </div>
        <!-- 快速分类筛选 -->
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap" id="search-cat-btns">
          ${['全部','运营经验','选品技巧','物流仓储','广告投放','数据分析','其他'].map((c,i) => `
            <button onclick="setSearchCat('${c}')" data-cat="${c}" style="font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid ${i===0?'#7c3aed':'#334155'};background:${i===0?'rgba(124,58,237,0.15)':'transparent'};color:${i===0?'#a78bfa':'#64748b'};transition:all 0.15s">${c}</button>
          `).join('')}
        </div>
      </div>
      <!-- 搜索结果区 -->
      <div id="academy-search-results" style="flex:1;overflow-y:auto;padding:16px 20px">
        <div style="text-align:center;color:#475569;padding:40px 0;font-size:14px">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="display:block;margin:0 auto 12px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          输入关键词，搜索全员 ${academyArticles.length} 篇知识储备
        </div>
      </div>
      <!-- 底部提示 -->
      <div style="padding:10px 20px;border-top:1px solid #1e293b;display:flex;align-items:center;gap:16px">
        <span style="font-size:11px;color:#334155">↑↓ 浏览</span>
        <span style="font-size:11px;color:#334155">Enter 展开</span>
        <span style="font-size:11px;color:#334155">Esc 关闭</span>
        <span id="search-count" style="font-size:11px;color:#475569;margin-left:auto"></span>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  // 点击蒙层关闭
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAcademySearch(); });
  // 自动聚焦
  setTimeout(() => {
    const inp = document.getElementById('academy-search-input');
    if (inp) { inp.focus(); inp.addEventListener('focus', () => { document.getElementById('search-input-wrap').style.borderColor = '#7c3aed'; }); }
  }, 50);
}

function closeAcademySearch() {
  const el = document.getElementById('academy-search-overlay');
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.15s'; setTimeout(() => el.remove(), 150); }
}

let _searchCat = '全部';
function setSearchCat(cat) {
  _searchCat = cat;
  document.querySelectorAll('#search-cat-btns button').forEach(btn => {
    const active = btn.dataset.cat === cat;
    btn.style.borderColor = active ? '#7c3aed' : '#334155';
    btn.style.background = active ? 'rgba(124,58,237,0.15)' : 'transparent';
    btn.style.color = active ? '#a78bfa' : '#64748b';
  });
  const kw = (document.getElementById('academy-search-input')?.value || '').trim();
  doAcademySearch(kw);
}

function clearAcademySearch() {
  const inp = document.getElementById('academy-search-input');
  if (inp) { inp.value = ''; inp.focus(); }
  document.getElementById('search-clear-btn').style.display = 'none';
  _searchCat = '全部';
  setSearchCat('全部');
  document.getElementById('academy-search-results').innerHTML = `
    <div style="text-align:center;color:#475569;padding:40px 0;font-size:14px">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="display:block;margin:0 auto 12px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      输入关键词，搜索全员 ${academyArticles.length} 篇知识储备
    </div>`;
  document.getElementById('search-count').textContent = '';
}

function doAcademySearch(kw) {
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';

  const container = document.getElementById('academy-search-results');
  if (!kw.trim() && _searchCat === '全部') {
    container.innerHTML = `
      <div style="text-align:center;color:#475569;padding:40px 0;font-size:14px">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="display:block;margin:0 auto 12px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        输入关键词，搜索全员 ${academyArticles.length} 篇知识储备
      </div>`;
    document.getElementById('search-count').textContent = '';
    return;
  }

  const q = kw.trim().toLowerCase();
  let results = academyArticles;

  // 分类过滤
  if (_searchCat !== '全部') {
    results = results.filter(a => a.category === _searchCat);
  }

  // 关键词过滤（搜索标题、内容、作者名、分类、角色名）
  if (q) {
    results = results.filter(a => {
      return (a.title || '').toLowerCase().includes(q)
        || (a.content || '').toLowerCase().includes(q)
        || (a.author_name || '').toLowerCase().includes(q)
        || (a.category || '').toLowerCase().includes(q)
        || (a.role_name || '').toLowerCase().includes(q);
    });
  }

  document.getElementById('search-count').textContent = `共 ${results.length} 条结果`;

  if (results.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;color:#475569;padding:40px 0">
        <div style="font-size:32px;margin-bottom:10px">🔍</div>
        <div style="font-size:14px">没有找到「${kw || _searchCat}」相关的知识</div>
        <div style="font-size:12px;color:#334155;margin-top:6px">试试其他关键词，或换个分类</div>
      </div>`;
    return;
  }

  const catColors = { '运营经验':'#7c3aed','选品技巧':'#06b6d4','物流仓储':'#10b981','广告投放':'#f59e0b','数据分析':'#6366f1','其他':'#64748b' };

  // 高亮命中词
  function hl(text, keyword) {
    if (!keyword || !text) return text || '';
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:rgba(124,58,237,0.35);color:#c4b5fd;border-radius:2px;padding:0 2px">$1</mark>');
  }

  container.innerHTML = results.map(a => {
    const catColor = catColors[a.category] || '#64748b';
    const date = a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN') : '';
    // 智能摘要：优先找包含关键词的段落
    let snippet = '';
    if (q && a.content) {
      const idx = a.content.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(a.content.length, idx + 90);
        snippet = (start > 0 ? '…' : '') + a.content.slice(start, end).replace(/\n/g, ' ') + (end < a.content.length ? '…' : '');
      } else {
        snippet = a.content.slice(0, 100).replace(/\n/g, ' ') + (a.content.length > 100 ? '…' : '');
      }
    } else {
      snippet = (a.content || '').slice(0, 100).replace(/\n/g, ' ') + ((a.content||'').length > 100 ? '…' : '');
    }

    const titleHl = hl(a.title || '（无标题）', q);
    const snippetHl = hl(snippet, q);
    const authorHl = hl(a.author_name || '匿名', q);

    return `
    <div onclick="jumpToArticle(${a.id})" style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color 0.15s,background 0.15s"
      onmouseenter="this.style.borderColor='#334155';this.style.background='#172033'"
      onmouseleave="this.style.borderColor='#1e293b';this.style.background='#0f172a'">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:${catColor}22;color:${catColor};border:1px solid ${catColor}44">${a.category || '其他'}</span>
            ${a.role_name ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:${(a.role_color||'#7c3aed')}22;color:${a.role_color||'#a78bfa'};border:1px solid ${(a.role_color||'#7c3aed')}44">👤 ${a.role_name}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:5px;line-height:1.4">${titleHl}</div>
          <div style="font-size:12px;color:#64748b;line-height:1.6">${snippetHl}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
            <span style="font-size:11px;color:#475569">👤 ${authorHl}</span>
            <span style="font-size:11px;color:#334155">${date}</span>
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="2" style="flex-shrink:0;margin-top:4px"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function jumpToArticle(articleId) {
  closeAcademySearch();
  // 跳转到知识学院页并展开对应文章
  if (currentPage !== 'academy') {
    navigate('academy');
  }
  setTimeout(() => {
    const card = document.getElementById('ac-' + articleId);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.transition = 'box-shadow 0.3s';
      card.style.boxShadow = '0 0 0 2px #7c3aed';
      setTimeout(() => { card.style.boxShadow = ''; }, 2000);
      // 自动展开文章
      const content = document.getElementById('ac-content-' + articleId);
      if (content && content.style.display === 'none') toggleArticle(articleId);
    }
  }, currentPage !== 'academy' ? 600 : 100);
}

function toggleArticle(id) {
  const el = document.getElementById('ac-content-' + id);
  const btn = el.previousElementSibling.querySelector('.academy-expand-btn');
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.innerHTML = isOpen
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg> 展开阅读'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg> 收起';
}

function downloadAttachment(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ============ 知识学院 - 角色管理 ============
let academyRoles = []; // 角色列表缓存
let articlePendingFiles = []; // 待上传文件列表

function loadAcademyRoles() {
  academyRoles = Cache.get('academy_roles', []);
}

function saveAcademyRoles() {
  Cache.set('academy_roles', academyRoles);
}

function openModal_addArticle() {
  loadAcademyRoles();
  // 刷新角色下拉
  const sel = document.getElementById('article-role');
  if (sel) {
    const myRoles = academyRoles.filter(r => r.owner_id === (CURRENT_USER && CURRENT_USER.id));
    sel.innerHTML = '<option value="">-- 选择发布身份 --</option>' +
      myRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  }
  articlePendingFiles = [];
  const fl = document.getElementById('article-file-list');
  if (fl) fl.innerHTML = '';
  openModal('modal-add-article');
}

function openCreateRoleModal() {
  document.getElementById('new-role-name').value = '';
  document.getElementById('new-role-desc').value = '';
  document.getElementById('new-role-color').value = '#7c3aed';
  document.querySelectorAll('.role-color-opt').forEach((el, i) => {
    el.style.border = i === 0 ? '3px solid ' + el.style.background + ';outline:2px solid white' : '3px solid transparent';
  });
  openModal('modal-create-role');
}

function selectRoleColor(el, color) {
  document.querySelectorAll('.role-color-opt').forEach(e => {
    e.style.border = '3px solid transparent';
    e.style.outline = '';
  });
  el.style.border = '3px solid ' + color;
  el.style.outline = '2px solid white';
  document.getElementById('new-role-color').value = color;
}

function submitCreateRole() {
  const name = document.getElementById('new-role-name').value.trim();
  if (!name) { showToast('请输入角色名称', 'error'); return; }
  if (!CURRENT_USER) { showToast('请先登录', 'error'); return; }
  const color = document.getElementById('new-role-color').value || '#7c3aed';
  const desc = document.getElementById('new-role-desc').value.trim();
  loadAcademyRoles();
  const role = { id: 'role_' + Date.now(), name, desc, color, owner_id: CURRENT_USER.id, created_at: new Date().toISOString() };
  academyRoles.push(role);
  saveAcademyRoles();
  closeModal('modal-create-role');
  showToast(`角色「${name}」创建成功`, 'success');
  // 刷新发布弹窗里的角色下拉
  const sel = document.getElementById('article-role');
  if (sel) {
    const myRoles = academyRoles.filter(r => r.owner_id === CURRENT_USER.id);
    sel.innerHTML = '<option value="">-- 选择发布身份 --</option>' +
      myRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    sel.value = role.id;
  }
}

// ============ 知识学院 - 文件处理 ============
const ALLOWED_FILE_TYPES = ['image/','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats','application/msword','application/zip','text/','application/vnd.ms-powerpoint'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function handleArticleFileDrop(e) {
  e.preventDefault();
  document.getElementById('article-file-drop').style.borderColor = '#334155';
  const files = Array.from(e.dataTransfer.files);
  addArticleFiles(files);
}

function handleArticleFileSelect(input) {
  addArticleFiles(Array.from(input.files));
  input.value = '';
}

function addArticleFiles(files) {
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) { showToast(`文件「${f.name}」超过10MB限制，已跳过`, 'error'); continue; }
    if (articlePendingFiles.find(x => x.name === f.name && x.size === f.size)) continue;
    articlePendingFiles.push(f);
  }
  renderArticleFileList();
}

function renderArticleFileList() {
  const container = document.getElementById('article-file-list');
  if (!container) return;
  const iconMap = { 'image':' 🖼️', 'pdf':'📄', 'excel':'📊', 'xlsx':'📊', 'xls':'📊', 'word':'📝', 'docx':'📝', 'doc':'📝', 'ppt':'📑', 'pptx':'📑', 'zip':'🗜️', 'csv':'📋', 'txt':'📃' };
  container.innerHTML = articlePendingFiles.map((f, i) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const icon = f.type.startsWith('image') ? '🖼️' : (iconMap[ext] || '📎');
    const size = f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+'MB' : Math.round(f.size/1024)+'KB';
    return `<div style="display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:6px;padding:5px 10px;font-size:12px;max-width:200px">
      <span>${icon}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#c4b5fd" title="${f.name}">${f.name}</span>
      <span style="color:#475569;white-space:nowrap">${size}</span>
      <span onclick="removeArticleFile(${i})" style="cursor:pointer;color:#f87171;flex-shrink:0">✕</span>
    </div>`;
  }).join('');
}

function removeArticleFile(i) {
  articlePendingFiles.splice(i, 1);
  renderArticleFileList();
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function submitArticle() {
  const title = document.getElementById('article-title').value.trim();
  const content = document.getElementById('article-content').value.trim();
  const category = document.getElementById('article-category').value;
  const roleId = document.getElementById('article-role') ? document.getElementById('article-role').value : '';

  if (!title) { showToast('请输入文章标题', 'error'); return; }
  if (!content) { showToast('请输入文章内容', 'error'); return; }
  if (!CURRENT_USER) { showToast('请先登录', 'error'); return; }

  loadAcademyRoles();
  const role = academyRoles.find(r => r.id === roleId);
  const authorName = role ? `[${role.name}] ${CURRENT_USER.nickname || CURRENT_USER.phone}` : (CURRENT_USER.nickname || CURRENT_USER.phone);

  // 处理文件附件（转base64存储，适合小文件；大文件生产环境应用对象存储）
  let attachments = [];
  if (articlePendingFiles.length > 0) {
    showToast('正在处理附件...', 'info');
    for (const f of articlePendingFiles) {
      try {
        const b64 = await fileToBase64(f);
        attachments.push({ name: f.name, type: f.type, size: f.size, data: b64 });
      } catch(e) { showToast(`附件「${f.name}」处理失败，已跳过`, 'error'); }
    }
  }

  const article = {
    title, content, category,
    author_id: CURRENT_USER.id,
    author_name: authorName,
    role_id: roleId || null,
    role_name: role ? role.name : null,
    role_color: role ? role.color : null,
    attachments: attachments.length ? JSON.stringify(attachments) : null,
    likes: 0,
    created_at: new Date().toISOString(),
  };

  try {
    if (SUPABASE_ENABLED) {
      // Supabase存储时不含大体积base64（附件存本地缓存）
      const articleForDB = { ...article };
      if (attachments.length) {
        // 将附件信息单独存本地，避免Supabase请求过大
        const localKey = 'article_attach_' + CURRENT_USER.id + '_' + Date.now();
        Cache.set(localKey, attachments);
        articleForDB.attachments = JSON.stringify(attachments.map(a => ({ name: a.name, type: a.type, size: a.size, localKey })));
      }
      await sbFetch('academy', 'POST', articleForDB);
    } else {
      const list = Cache.get('academy_articles', []);
      article.id = Date.now();
      list.unshift(article);
      Cache.set('academy_articles', list);
    }
    closeModal('modal-add-article');
    document.getElementById('article-title').value = '';
    document.getElementById('article-content').value = '';
    articlePendingFiles = [];
    const fl = document.getElementById('article-file-list');
    if (fl) fl.innerHTML = '';
    showToast('文章发布成功！', 'success');
    await loadAcademyArticles();
  } catch(e) {
    showToast('发布失败：' + e.message, 'error');
  }
}

async function deleteArticle(id) {
  if (!confirm('确定要删除这篇文章吗？')) return;
  // 权限校验：只能删自己的
  const article = academyArticles.find(a => a.id === id || a.id === String(id));
  if (article && CURRENT_USER && article.author_id !== CURRENT_USER.id && CURRENT_USER.role !== 'admin') {
    showToast('⚠️ 只能删除自己发布的文章', 'error'); return;
  }
  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('academy?id=eq.' + id, 'DELETE');
    } else {
      const list = Cache.get('academy_articles', []).filter(a => a.id !== id);
      Cache.set('academy_articles', list);
    }
    showToast('文章已删除', 'info');
    await loadAcademyArticles();
  } catch(e) {
    showToast('删除失败：' + e.message, 'error');
  }
}

// ============================================
//  页面：权限管理（仅管理员）
// ============================================
async function renderAdmin() {
  const pg = document.getElementById('page-admin');
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') {
    pg.innerHTML = `<div class="empty-state"><p style="color:#f87171">仅管理员可访问</p></div>`;
    return;
  }

  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const pendingReqs = requests.filter(r => r.status === 'pending');

  pg.innerHTML = `
    <div class="page-header">
      <h1 style="display:flex;align-items:center;gap:10px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#ag1)" stroke-width="2"><defs><linearGradient id="ag1" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        权限管理
      </h1>
      <p style="color:#64748b;font-size:13px;margin-top:4px">管理成员账号及页面访问权限</p>
    </div>

    ${pendingReqs.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.05)">
      <div class="card-title" style="color:#f59e0b;display:flex;align-items:center;gap:8px">
        <span>📬 店铺权限申请</span>
        <span style="background:#f59e0b;color:#000;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${pendingReqs.length}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        ${pendingReqs.map(req => `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;color:#e2e8f0;font-weight:600">${req.applicantName} 申请查看 <span style="color:#a78bfa">「${req.shopName}」</span></div>
            ${req.reason ? `<div style="font-size:12px;color:#64748b;margin-top:3px">原因：${req.reason}</div>` : ''}
            <div style="font-size:11px;color:#475569;margin-top:3px">${new Date(req.createdAt).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button onclick="approveShopRequest('${req.id}','${req.applicantId}','${req.shopId}')" style="padding:5px 14px;border-radius:6px;background:linear-gradient(135deg,#059669,#10b981);border:none;color:#fff;font-size:12px;cursor:pointer;font-weight:600">✓ 批准</button>
            <button onclick="rejectShopRequest('${req.id}')" style="padding:5px 14px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-size:12px;cursor:pointer">✗ 拒绝</button>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div id="admin-user-list">
      <div class="card"><div class="skeleton" style="height:200px"></div></div>
    </div>`;

  await loadAdminUsers();
}

// 批准店铺访问申请（目前修改该用户对应店铺的 created_by 字段，让其成为共同管理人）
// 实际上更合理的做法是给该用户添加 shop_access_XXX 的权限条目
async function approveShopRequest(reqId, applicantId, shopId) {
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const req = requests.find(r => r.id === reqId);
  if (!req) return;
  // 将申请状态改为已批准
  req.status = 'approved';
  localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  // 给用户添加 shop_access_<shopId> 权限
  const permKey = 'shop_access_' + shopId;
  await grantPermission(applicantId, permKey);
  showToast('✅ 已批准申请', 'success');
  renderAdmin();
}

function rejectShopRequest(reqId) {
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const req = requests.find(r => r.id === reqId);
  if (req) { req.status = 'rejected'; localStorage.setItem('shop_access_requests', JSON.stringify(requests)); }
  showToast('已拒绝申请', 'info');
  renderAdmin();
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-user-list');
  try {
    // 使用 auth.js 提供的聚合方法，同时获取本地+Supabase 用户
    const users = await getAllUsersForAdmin();
    const allPerms = await getAllPermsForAdmin();

    if (!users || users.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="margin-bottom:10px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <p style="color:#475569">暂无注册成员</p>
          <p style="font-size:12px;color:#334155;margin-top:6px">成员注册后会在此显示，可在这里管理权限</p>
        </div>`;
      return;
    }

    container.innerHTML = users.map(u => {
      const userPerms = allPerms.filter(p => p.user_id === u.id).map(p => p.page);
      // 同步本地缓存
      const localPerm = typeof LocalPerms !== 'undefined' ? LocalPerms.get(u.id) : [];
      const effectivePerms = [...new Set([...userPerms, ...localPerm])];

      const isAdmin = u.role === 'admin';
      const isSelf = CURRENT_USER && u.id === CURRENT_USER.id;
      const regDate = u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-';
      const hasAnyPerm = effectivePerms.length > 0;
      return `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap">
          <div class="sidebar-user-avatar" style="width:40px;height:40px;font-size:16px;flex-shrink:0">${(u.nickname||u.phone).charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:120px">
            <div style="font-weight:600;color:#e2e8f0;font-size:15px">
              ${u.nickname || '未设置昵称'}
              ${isSelf ? '<span style="font-size:11px;color:#7c3aed;margin-left:6px">(你)</span>' : ''}
            </div>
            <div style="font-size:12px;color:#475569;margin-top:3px">
              手机号：${u.phone} &nbsp;|&nbsp; 注册时间：${regDate}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="badge ${isAdmin ? 'badge-purple' : 'badge-blue'}">${isAdmin ? '管理员' : '成员'}</span>
            <span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status === 'active' ? '正常' : '已禁用'}</span>
            ${!hasAnyPerm && !isAdmin ? '<span class="badge" style="background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.3)">待授权</span>' : ''}
            ${!isSelf && !isAdmin ? `
              <button class="btn-secondary btn-sm" onclick="toggleUserStatus('${u.id}','${u.status || 'active'}')">
                ${u.status === 'disabled' ? '启用账号' : '禁用账号'}
              </button>
            ` : ''}
          </div>
        </div>

        ${!isAdmin ? `
        <div>
          <!-- 页面访问权限 -->
          <div style="font-size:12px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            页面访问权限：
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            ${ALL_PAGES.map(page => {
              const hasPerm = effectivePerms.includes(page);
              return `<label class="perm-toggle" title="${hasPerm ? '点击收回'+PAGE_NAMES[page]+'权限' : '点击开放'+PAGE_NAMES[page]+'权限'}">
                <input type="checkbox" ${hasPerm ? 'checked' : ''} onchange="handlePermChange('${u.id}','${page}',this)">
                <span class="perm-label ${hasPerm ? 'perm-on' : 'perm-off'}">${PAGE_NAMES[page]}</span>
              </label>`;
            }).join('')}
          </div>
          <!-- 细粒度操作权限 -->
          <div style="font-size:12px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 1 21 12a10 10 0 0 1-2.93 7.07A10 10 0 0 1 12 21a10 10 0 0 1-7.07-2.93A10 10 0 0 1 3 12a10 10 0 0 1 2.93-7.07A10 10 0 0 1 12 3a10 10 0 0 1 7.07 2.93z"/></svg>
            细粒度操作权限：
          </div>
          ${Object.entries(ACTION_GROUPS).map(([group, actions]) => `
            <div style="margin-bottom:10px">
              <div style="font-size:11px;color:#475569;margin-bottom:5px;padding-left:2px">${group}</div>
              <div style="display:flex;flex-wrap:wrap;gap:7px">
                ${actions.map(action => {
                  const hasPerm = effectivePerms.includes(action);
                  return `<label class="perm-toggle" title="${ACTION_NAMES[action]}">
                    <input type="checkbox" ${hasPerm ? 'checked' : ''} onchange="handlePermChange('${u.id}','${action}',this)">
                    <span class="perm-label ${hasPerm ? 'perm-on' : 'perm-off'}" style="font-size:11px">${ACTION_NAMES[action]}</span>
                  </label>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
          <div style="margin-top:10px;display:flex;gap:8px">
            <button class="btn-secondary btn-sm" onclick="grantAllPerms('${u.id}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-1px"><polyline points="20 6 9 17 4 12"/></svg>
              全部开放
            </button>
            <button class="btn-secondary btn-sm" onclick="revokeAllPerms('${u.id}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-1px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              全部收回
            </button>
          </div>
        </div>
        ` : '<div style="font-size:12px;color:#a78bfa;padding:4px 0">超级管理员，拥有全部权限</div>'}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><p style="color:#f87171">加载失败：${e.message}</p></div>`;
  }
}

// 权限 checkbox 变化处理（带即时视觉反馈）
function handlePermChange(userId, page, checkbox) {
  const label = checkbox.nextElementSibling;
  if (checkbox.checked) {
    label.className = 'perm-label perm-on';
  } else {
    label.className = 'perm-label perm-off';
  }
  togglePermission(userId, page, checkbox.checked);
}

// grantAllPerms / revokeAllPerms / toggleUserStatus 已移入 auth.js，此处保留空函数做兼容

// ============================================
//  页面：个人中心
// ============================================
function renderProfile() {
  const pg = document.getElementById('page-profile');
  if (!CURRENT_USER) return;
  const perms = CURRENT_USER.permissions || [];
  const isAdmin = CURRENT_USER.role === 'admin';

  pg.innerHTML = `
    <div class="page-header">
      <h1>个人中心</h1>
    </div>
    <div style="max-width:480px">
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">账号信息</div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
          <div class="sidebar-user-avatar" style="width:56px;height:56px;font-size:22px;border-radius:50%">${(CURRENT_USER.nickname||CURRENT_USER.phone).charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-size:18px;font-weight:700;color:#e2e8f0">${CURRENT_USER.nickname || '未设置昵称'}</div>
            <div style="font-size:13px;color:#475569;margin-top:3px">${CURRENT_USER.phone}</div>
            <span class="badge ${isAdmin ? 'badge-purple' : 'badge-blue'}" style="margin-top:6px;display:inline-block">${isAdmin ? '管理员' : '成员'}</span>
          </div>
        </div>
        <div class="form-group">
          <label>修改昵称</label>
          <input type="text" id="profile-nickname" value="${CURRENT_USER.nickname || ''}" placeholder="输入新昵称">
        </div>
        <div class="form-group">
          <label>新密码（留空不修改）</label>
          <input type="password" id="profile-newpass" placeholder="至少6位新密码">
        </div>
        <button class="btn-primary" onclick="saveProfile()">保存修改</button>
      </div>

      <div class="card">
        <div class="card-title">我的权限</div>
        ${isAdmin
          ? '<p style="color:#a78bfa;font-size:13px">管理员拥有全部页面权限</p>'
          : perms.length === 0
            ? '<p style="color:#f87171;font-size:13px">暂无任何页面权限，请联系管理员授权</p>'
            : `<div style="display:flex;flex-wrap:wrap;gap:8px">${perms.map(p => `<span class="badge badge-green" style="font-size:12px">${PAGE_NAMES[p]||p}</span>`).join('')}</div>`
        }
      </div>
    </div>`;
}

async function saveProfile() {
  const nickname = document.getElementById('profile-nickname').value.trim();
  const newPass = document.getElementById('profile-newpass').value;

  if (!nickname && !newPass) { showToast('没有要修改的内容', 'info'); return; }
  if (newPass && newPass.length < 6) { showToast('新密码至少6位', 'error'); return; }

  const updates = {};
  if (nickname) updates.nickname = nickname;
  if (newPass) updates.password_hash = hashPassword(newPass);

  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('users?id=eq.' + CURRENT_USER.id, 'PATCH', updates);
    }
    Object.assign(CURRENT_USER, updates);
    document.getElementById('user-name').textContent = CURRENT_USER.nickname || CURRENT_USER.phone;
    document.getElementById('user-avatar').textContent = (CURRENT_USER.nickname || CURRENT_USER.phone).charAt(0).toUpperCase();
    showToast('个人信息已更新', 'success');
    document.getElementById('profile-newpass').value = '';
  } catch(e) {
    showToast('保存失败：' + e.message, 'error');
  }
}

