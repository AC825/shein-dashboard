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

// ============ 通用日期标准化工具 ============
/**
 * 将各种日期格式统一转为 YYYY-MM-DD，兼容 Excel 单位数月份/日期
 * 支持：2026-3-26 / 2026/3/26 / 2026.3.26 / 2026-03-26 等
 * @param {string} raw
 * @returns {string|null} YYYY-MM-DD 或 null（无效）
 */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 匹配 YYYY[-/.]M[-/.]D（月和日可以是单位数）
  const m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (!m) return null;
  const [,y, mo, d] = m;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

// ============ 通用 Excel/CSV 文件解析工具 ============
/**
 * 读取文件并以 CSV 文本形式返回（支持 .csv/.txt/.xlsx/.xls/.ods 等）
 * @param {File} file
 * @returns {Promise<string>} CSV 格式的文本（表头+数据行，逗号分隔）
 */
function readFileAsCSVText(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods') || name.endsWith('.xlsm');
    if (isExcel) {
      if (typeof XLSX === 'undefined') { reject(new Error('Excel解析库未加载，请刷新页面重试')); return; }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // 转成 CSV 格式文本，header:1 表示第一行是标题
          const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
          resolve(csv);
        } catch(err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    } else {
      // CSV / TXT
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'UTF-8');
    }
  });
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
  dashboard:       { label: '数据看板',    icon: '' },
  styles:          { label: '款式分析',    icon: '' },
  revenue:         { label: '营业额统计',  icon: '' },
  profit:          { label: '利润计算',    icon: '' },
  alert:           { label: '预警中心',    icon: '' },
  import:          { label: '数据导入',    icon: '' },
  shops:           { label: '店铺管理',    icon: '' },
  'shop-detail':   { label: '店铺详情',    icon: '' },
  academy:         { label: '知识学院',    icon: '' },
  square:          { label: '知识广场',    icon: '' },
  admin:           { label: '权限管理',    icon: '' },
  profile:         { label: '个人中心',    icon: '' },
  'cost-cross':    { label: '跨境产品成本', icon: '' },
  'cost-domestic': { label: '国内产品成本', icon: '' },
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

    // 登录后自动从云端同步数据，显示进度提示
    const syncEl = document.getElementById('sync-status');
    if (syncEl) { syncEl.textContent = '⟳ 正在从云端加载数据...'; syncEl.style.color = '#f59e0b'; }
    const syncOk = await syncFromSupabase();
    if (syncOk) {
      renderShopNav();
      updateSidebarFooter();
      if (syncEl) { syncEl.textContent = '✓ 数据已同步'; syncEl.style.color = '#10b981'; }
      setTimeout(() => {
        if (syncEl) { syncEl.textContent = ''; }
      }, 4000);
    }
    navigate(currentPage, currentParam);
    initRealtime();
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

  // 手机端减少粒子数量（节省 CPU），桌面端 40 个
  const isMobile = window.innerWidth < 768;
  const COUNT = isMobile ? 20 : 40;
  const LINK_DIST = isMobile ? 80 : 100;
  const LINK_DIST_SQ = LINK_DIST * LINK_DIST; // 用平方距离，避免每帧 sqrt

  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.5 + 0.1,
    color: Math.random() > 0.5 ? '124,58,237' : '6,182,212',
  }));

  let animId = null;
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
    // 连线：用平方距离避免 sqrt，减少计算量
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distSq = dx*dx + dy*dy;
        if (distSq < LINK_DIST_SQ) {
          const alpha = 0.08 * (1 - Math.sqrt(distSq) / LINK_DIST);
          ctx.beginPath();
          ctx.strokeStyle = `rgba(124,58,237,${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    animId = requestAnimationFrame(draw);
  }

  // 页面隐藏时暂停动画（切换标签页/锁屏时节省 CPU）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
    } else {
      if (!animId) draw();
    }
  });

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
        square: renderSquare,
        admin: renderAdmin,
        profile: renderProfile,
        'cost-cross': renderCostCross,
        'cost-domestic': renderCostDomestic,
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

  // 获取所有店铺列表
  const allShops = (typeof DB !== 'undefined' ? DB.getShops() : []);
  const shopsByGroup = {
    domestic: allShops.filter(s => s.platform && DOMESTIC_PLATFORMS.has(s.platform)),
    cross: allShops.filter(s => s.platform && CROSS_BORDER_PLATFORMS.has(s.platform)),
    other: allShops.filter(s => !s.platform || (!DOMESTIC_PLATFORMS.has(s.platform) && !CROSS_BORDER_PLATFORMS.has(s.platform))),
  };

  function shopItemsHtml(list) {
    if (!list.length) return '';
    return list.map(s => {
      const color = s.color || '#7c3aed';
      const letter = (s.name||'?').charAt(0).toUpperCase();
      return `<div class="mobile-menu-item mobile-shop-item"
        onclick="document.getElementById('mobile-menu-overlay').remove();navigate('shop-detail','${s.id}')"
        style="padding:10px 20px;gap:10px">
        <span style="width:28px;height:28px;border-radius:8px;background:${color};
          display:inline-flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${letter}</span>
        <span style="flex:1;font-size:13px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name||'未命名店铺'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }).join('');
  }

  const shopListHtml = allShops.length === 0
    ? `<div style="padding:10px 20px;font-size:12px;color:#475569">暂无店铺，请先添加</div>`
    : `
      ${shopsByGroup.domestic.length ? `
        <div style="padding:6px 20px 4px;font-size:11px;color:#475569;letter-spacing:0.5px">🏠 国内店铺</div>
        ${shopItemsHtml(shopsByGroup.domestic)}` : ''}
      ${shopsByGroup.cross.length ? `
        <div style="padding:6px 20px 4px;font-size:11px;color:#475569;letter-spacing:0.5px">🌐 跨境店铺</div>
        ${shopItemsHtml(shopsByGroup.cross)}` : ''}
      ${shopsByGroup.other.length ? `
        <div style="padding:6px 20px 4px;font-size:11px;color:#475569;letter-spacing:0.5px">🏢 其他店铺</div>
        ${shopItemsHtml(shopsByGroup.other)}` : ''}
    `;

  const overlay = document.createElement('div');
  overlay.id = 'mobile-menu-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.6);
    display:flex;align-items:flex-end;
  `;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const pb = window.innerHeight < 700 ? '8px' : '20px';
  overlay.innerHTML = `
    <div style="width:100%;background:linear-gradient(180deg,#0d1117,#070b14);
      border-top:1px solid rgba(124,58,237,0.3);border-radius:20px 20px 0 0;
      max-height:80vh;overflow-y:auto;
      padding-bottom:calc(${pb} + env(safe-area-inset-bottom,0px))">
      <!-- 用户信息头部 -->
      <div style="text-align:center;padding:16px 0 14px;border-bottom:1px solid rgba(255,255,255,0.06);position:sticky;top:0;background:#0d1117;z-index:1">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);
          display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;margin:0 auto 8px">
          ${name.charAt(0).toUpperCase()}
        </div>
        <div style="font-size:15px;font-weight:600;color:#e2e8f0">${name}</div>
        <div style="font-size:12px;color:#475569;margin-top:3px">${CURRENT_USER?.id === 'super_admin' ? '超级管理员' : (isAdmin ? '管理员' : '成员')}</div>
      </div>

      <!-- 我的店铺 -->
      <div style="padding:10px 20px 4px;font-size:12px;font-weight:600;color:#94a3b8;display:flex;align-items:center;justify-content:space-between;">
        <span>我的店铺</span>
        <span onclick="document.getElementById('mobile-menu-overlay').remove();navigate('shops')"
          style="font-size:11px;color:#7c3aed;cursor:pointer">管理店铺 &rsaquo;</span>
      </div>
      ${shopListHtml}

      <!-- 分割线 -->
      <div style="margin:8px 16px;height:1px;background:rgba(255,255,255,0.06)"></div>

      <!-- 成本管理 -->
      <div style="padding:4px 20px 4px;font-size:12px;font-weight:600;color:#94a3b8">成本管理</div>
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('cost-cross')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        跨境产品成本
      </div>
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('cost-domestic')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        国内产品成本
      </div>

      <!-- 分割线 -->
      <div style="margin:8px 16px;height:1px;background:rgba(255,255,255,0.06)"></div>

      <!-- 其他功能 -->
      ${isAdmin ? `
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('admin')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
        权限管理
      </div>` : ''}
      <div class="mobile-menu-item" onclick="document.getElementById('mobile-menu-overlay').remove();navigate('profile')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        个人中心
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

  function makeNavItem(s) {
    // 所有登录成员都可查看所有店铺（只读）
    return `<a class="nav-item shop-nav-item" data-page="shop-detail-${s.id}" onclick="navigate('shop-detail','${s.id}')">
      <span class="color-dot" style="background:${s.color}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</span>
    </a>`;
  }

  const domesticNav = shops.filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const crossNav    = shops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));
  const otherNav    = shops.filter(s => !DOMESTIC_PLATFORMS.has(s.platform) && !CROSS_BORDER_PLATFORMS.has(s.platform));

  let html = '';
  if (domesticNav.length > 0) {
    html += `<div style="font-size:10px;color:#34d399;font-weight:700;letter-spacing:0.08em;padding:6px 14px 2px 14px;opacity:0.8">🏠 国内</div>`;
    html += domesticNav.map(makeNavItem).join('');
  }
  if (crossNav.length > 0) {
    html += `<div style="font-size:10px;color:#f59e0b;font-weight:700;letter-spacing:0.08em;padding:8px 14px 2px 14px;opacity:0.8">🌐 跨境</div>`;
    html += crossNav.map(makeNavItem).join('');
  }
  if (otherNav.length > 0) {
    html += `<div style="font-size:10px;color:#a78bfa;font-weight:700;letter-spacing:0.08em;padding:8px 14px 2px 14px;opacity:0.8">🏢 其他</div>`;
    html += otherNav.map(makeNavItem).join('');
  }
  container.innerHTML = html;
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

// ============ 重命名店铺 ============
function renameShop(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) return;
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const isCreator = CURRENT_USER && (shop.created_by === CURRENT_USER.id || !shop.created_by);
  if (!isAdmin && !isCreator) { showToast('⚠️ 只有管理员或店铺创建者可以重命名', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:380px;width:90%">
      <h3 style="color:#e2e8f0;margin:0 0 16px;font-size:16px">✏️ 重命名店铺</h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 12px">当前名称：<strong style="color:#a78bfa">${shop.name}</strong></p>
      <input id="rename-shop-input" type="text" value="${shop.name}" placeholder="输入新名称..."
        style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #6366f1;border-radius:8px;color:#e2e8f0;padding:10px 12px;font-size:14px;outline:none;margin-bottom:16px"
        onkeydown="if(event.key==='Enter')document.getElementById('rename-shop-confirm').click()">
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="this.closest('[style*=position]').remove()" style="padding:8px 20px;border-radius:8px;background:#1e293b;border:1px solid #334155;color:#94a3b8;cursor:pointer">取消</button>
        <button id="rename-shop-confirm" onclick="confirmRenameShop('${shopId}',this)" style="padding:8px 20px;border-radius:8px;background:linear-gradient(135deg,#7c3aed,#6366f1);border:none;color:#fff;cursor:pointer;font-weight:600">确认重命名</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // 聚焦并选中文字
  setTimeout(() => {
    const inp = document.getElementById('rename-shop-input');
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

async function confirmRenameShop(shopId, btn) {
  const inp = document.getElementById('rename-shop-input');
  const newName = inp ? inp.value.trim() : '';
  if (!newName) { showToast('⚠️ 店铺名称不能为空', 'error'); return; }
  const shops = DB.getShops();
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  const oldName = shop.name;
  if (newName === oldName) { btn.closest('[style*=position]').remove(); return; }

  btn.textContent = '保存中...'; btn.disabled = true;
  shop.name = newName;
  // 通过 DB.setShops 同步本地缓存（会同时触发全量云端推送）
  // 但为精确起见，只 PATCH 云端这一条记录
  DB.getShops().forEach(s => { if (s.id === shopId) s.name = newName; });
  if (typeof Cache !== 'undefined') Cache.set('shops', shops);
  if (SUPABASE_ENABLED) {
    try {
      await sbFetch('shops?id=eq.' + encodeURIComponent(shopId), 'PATCH', { name: newName });
    } catch(e) { console.warn('[Supabase] 店铺重命名云端更新失败:', e.message); }
  }
  btn.closest('[style*=position]').remove();
  renderShopNav();
  renderShops();
  showToast(`✅ 已将「${oldName}」重命名为「${newName}」`, 'success');
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
  const newReq = {
    id: 'req_' + Date.now(),
    shopId, shopName,
    applicantId: CURRENT_USER?.id,
    applicantName: applicant,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  // 写本地
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  requests.push(newReq);
  localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  // 推送云端
  sbPushAccessRequest(newReq);
  btn.closest('[style*="position:fixed"]').remove();
  showToast(`✅ 申请已提交！管理员审核后通知您`, 'success');
}

// ============ 编辑/删除权限检查 ============
// 检查当前用户是否有对该店铺进行编辑/删除的权限
// 管理员 + 店铺创建者 + 已被授权操作的用户 → 有权限
// 其他成员 → 无权限，弹出申请弹窗，返回 false
function checkEditPermission(shopId, shopName, actionDesc) {
  if (!CURRENT_USER) return false;
  if (CURRENT_USER.role === 'admin') return true;
  const shop = DB.getShops().find(s => s.id === shopId);
  const isOwner = shop && shop.created_by && shop.created_by === CURRENT_USER.id;
  const hasEditPerm = canDo('shop_edit_' + shopId);
  if (isOwner || hasEditPerm) return true;

  // 无权限 → 弹出申请弹窗
  requestShopEditAccess(shopId, shopName || (shop ? shop.name : shopId), actionDesc);
  return false;
}

// 弹出「申请编辑权限」弹窗
function requestShopEditAccess(shopId, shopName, actionDesc) {
  const applicant = CURRENT_USER ? (CURRENT_USER.nickname || CURRENT_USER.phone) : '未知用户';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;max-width:400px;width:90%;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">🔐</div>
      <h3 style="color:#e2e8f0;margin-bottom:8px">需要编辑权限</h3>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-bottom:6px">
        您当前只有<strong style="color:#34d399">查看权限</strong>，无法执行：<strong style="color:#f87171">${actionDesc || '编辑/删除'}</strong>
      </p>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-bottom:20px">
        申请后由管理员审批，获批即可操作 <strong style="color:#a78bfa">「${shopName}」</strong>
      </p>
      <div style="margin-bottom:14px">
        <textarea id="edit-request-reason" placeholder="申请原因（可选，如：需要录入该店铺的销售数据）" style="width:100%;height:72px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:8px;font-size:12px;resize:none;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="this.closest('[style*=position]').remove()" style="padding:8px 20px;border-radius:8px;background:#1e293b;border:1px solid #334155;color:#94a3b8;cursor:pointer">取消</button>
        <button onclick="submitShopEditRequest('${shopId}','${shopName}',this)" style="padding:8px 20px;border-radius:8px;background:linear-gradient(135deg,#7c3aed,#6366f1);border:none;color:#fff;cursor:pointer;font-weight:600">申请编辑权限</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function submitShopEditRequest(shopId, shopName, btn) {
  const reason = document.getElementById('edit-request-reason')?.value?.trim() || '';
  const applicant = CURRENT_USER ? (CURRENT_USER.nickname || CURRENT_USER.phone) : '未知用户';
  const newReq = {
    id: 'req_edit_' + Date.now(),
    shopId: 'edit_' + shopId,  // 用 edit_ 前缀区分查看申请和编辑申请
    shopName: shopName + '（编辑权限）',
    applicantId: CURRENT_USER?.id,
    applicantName: applicant,
    reason: reason || '申请编辑该店铺数据的权限',
    status: 'pending',
    createdAt: new Date().toISOString(),
    _editShopId: shopId,  // 真实 shopId，审批时用
  };
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  requests.push(newReq);
  localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  sbPushAccessRequest(newReq);
  btn.closest('[style*="position:fixed"]').remove();
  showToast(`✅ 申请已提交！管理员审核后您将获得编辑权限`, 'success');
}


let dashboardTab = 'domestic'; // 'domestic' | 'cross'
let dashboardRefreshTimer = null;
let dashboardLastRefresh = null;
let dashboardCountdownTimer = null;
let dashboardDays = 30; // 全局日期范围（天），默认近30天

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
  // 已移除自动刷新，改为纯手动刷新模式
  dashboardLastRefresh = new Date();
  _updateDashboardRefreshInfo();
}

function _updateDashboardRefreshInfo() {
  const el = document.getElementById('db-refresh-info');
  if (!el) return;
  if (!dashboardLastRefresh) { el.textContent = ''; return; }
  const mins = Math.floor((new Date() - dashboardLastRefresh) / 60000);
  el.textContent = `上次刷新：${mins < 1 ? '刚刚' : mins + '分钟前'}`;
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
  // 更新所有 Tab 的内联样式（active / inactive 两种状态）
  document.querySelectorAll('#db-tabs .db-tab').forEach(el => {
    const isActive = el.dataset.tab === tab;
    const isDomestic = el.dataset.tab === 'domestic';
    if (isActive) {
      if (isDomestic) {
        el.style.background = 'rgba(99,102,241,0.3)';
        el.style.color = '#a5b4fc';
        el.style.boxShadow = '0 2px 8px rgba(99,102,241,0.2)';
      } else {
        el.style.background = 'rgba(20,184,166,0.25)';
        el.style.color = '#5eead4';
        el.style.boxShadow = '0 2px 8px rgba(20,184,166,0.15)';
      }
    } else {
      el.style.background = 'transparent';
      el.style.color = '#64748b';
      el.style.boxShadow = 'none';
    }
    el.classList.toggle('active', isActive);
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
        <p style="font-size:12px;color:#64748b;margin:4px 0 0">过去${dashboardDays}天综合数据概览</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span id="db-refresh-info" style="font-size:11px;color:#475569;"></span>
        <!-- 日期范围选择器 -->
        <select id="db-days-select" onchange="dashboardDays=parseInt(this.value);_renderDashboardTabContent()" style="background:#1e293b;border:1px solid rgba(124,58,237,0.3);color:#a78bfa;padding:5px 10px;border-radius:7px;font-size:12px;cursor:pointer">
          <option value="7" ${dashboardDays===7?'selected':''}>近7天</option>
          <option value="14" ${dashboardDays===14?'selected':''}>近14天</option>
          <option value="30" ${dashboardDays===30?'selected':''}>近30天</option>
          <option value="60" ${dashboardDays===60?'selected':''}>近60天</option>
          <option value="90" ${dashboardDays===90?'selected':''}>近90天</option>
        </select>
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

  // ✅ 国内数据存在 DomesticStatsDB（ec_domestic_stats_xxx），不在 aggregateSales 里
  const days = dashboardDays || 30;
  const today = getPastDate(0);
  const dStart = getPastDate(days);
  const dPrevStart = getPastDate(days * 2);
  const dPrevEnd = getPastDate(days + 1);

  let totalRev = 0, totalOrd = 0;
  let prevRev = 0, prevOrd = 0;
  const shopSumMap = {}; // shopId -> { rev, orders }
  const dateSumMap = {}; // date  -> { rev, orders }

  domesticShops.forEach(shop => {
    const rows = DomesticStatsDB.getAll(shop.id);
    rows.forEach(r => {
      const d = r.date;
      if (!d) return;
      const rev = r.pay_amount || 0;
      // 国内生意参谋没有独立"订单量"字段，用支付人数替代（如无则 0）
      const ord = r.pay_buyers || r.pay_count || 0;
      if (d >= dStart && d <= today) {
        totalRev += rev;
        totalOrd += ord;
        if (!shopSumMap[shop.id]) shopSumMap[shop.id] = { rev: 0, orders: 0 };
        shopSumMap[shop.id].rev += rev;
        shopSumMap[shop.id].orders += ord;
        if (!dateSumMap[d]) dateSumMap[d] = { rev: 0, orders: 0 };
        dateSumMap[d].rev += rev;
        dateSumMap[d].orders += ord;
      } else if (d >= dPrevStart && d <= dPrevEnd) {
        prevRev += rev;
        prevOrd += ord;
      }
    });
  });

  const revGrow = prevRev ? ((totalRev - prevRev) / prevRev * 100).toFixed(1) : 0;
  const ordGrow = prevOrd ? ((totalOrd - prevOrd) / prevOrd * 100).toFixed(1) : 0;
  const hotStyles = 0; // 生意参谋数据不含款式维度，设为0
  const styleData = [];

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
        <div class="stat-label">近${days}天总营业额</div>
        <div class="stat-value" id="dsv-rev">¥0</div>
        <div class="stat-sub ${revGrow>=0?'stat-up':'stat-down'}">${revGrow>=0?'↑':'↓'} ${Math.abs(revGrow)}% 较上期</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="dsbar-rev" style="width:0%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">近${days}天总订单</div>
        <div class="stat-value" id="dsv-ord">0</div>
        <div class="stat-sub ${ordGrow>=0?'stat-up':'stat-down'}">${ordGrow>=0?'↑':'↓'} ${Math.abs(ordGrow)}% 较上期</div>
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
      <div class="card"><div class="card-title">📈 近${days}天营业额趋势（国内）</div><div class="chart-wrap"><canvas id="chart-d-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🏠 国内店铺营业额占比</div><div class="chart-wrap"><canvas id="chart-d-pie"></canvas></div></div>
    </div>
    <div class="chart-grid-3" style="margin-top:16px">
      <div class="card"><div class="card-title">📦 近${days}天订单量趋势</div><div class="chart-wrap"><canvas id="chart-d-orders"></canvas></div></div>
      <div class="card"><div class="card-title">🏆 各店铺营业额对比</div><div class="chart-wrap"><canvas id="chart-d-shopbar"></canvas></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title">🏆 国内店铺营业额排行</div><div id="d-shop-rank-list"></div></div>
      <div class="card"><div class="card-title">🔥 爆款TOP10（国内）</div><div id="d-style-rank-list"></div></div>
    </div>`;

  // ---- 数字动画 ----
  animateNumber(document.getElementById('dsv-rev'), totalRev, '¥', '', 900);
  animateNumber(document.getElementById('dsv-ord'), totalOrd, '', '', 700);
  animateNumber(document.getElementById('dsv-shops'), domesticShops.length, '', '', 500);
  animateNumber(document.getElementById('dsv-hot'), hotStyles, '', '', 600);
  setTimeout(() => {
    const b1 = document.getElementById('dsbar-rev');
    const b2 = document.getElementById('dsbar-ord');
    const b4 = document.getElementById('dsbar-hot');
    if (b1) b1.style.width = Math.min(100, prevRev ? totalRev/prevRev*60 : 80) + '%';
    if (b2) b2.style.width = Math.min(100, prevOrd ? totalOrd/prevOrd*60 : 80) + '%';
    if (b4) b4.style.width = '0%';
  }, 400);

  // ---- 趋势图 ----
  const sortedDates = Object.keys(dateSumMap).sort();
  if (charts['d-trend']) { try { charts['d-trend'].destroy(); } catch(e) {} }
  charts['d-trend'] = new Chart(document.getElementById('chart-d-trend'), {
    type: 'line',
    data: {
      labels: sortedDates.map(d => d.slice(5)),
      datasets: [{
        label: '营业额(¥)', data: sortedDates.map(d => +dateSumMap[d].rev.toFixed(2)),
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

  // ---- 饼图 ----
  const shopRankArr = Object.keys(shopSumMap).map(id => ({
    shopId: id,
    rev: shopSumMap[id].rev,
    orders: shopSumMap[id].orders
  })).sort((a, b) => b.rev - a.rev);

  if (charts['d-pie']) { try { charts['d-pie'].destroy(); } catch(e) {} }
  charts['d-pie'] = new Chart(document.getElementById('chart-d-pie'), {
    type: 'doughnut',
    data: {
      labels: shopRankArr.map(s => getShopName(s.shopId)),
      datasets: [{ data: shopRankArr.map(s => +s.rev.toFixed(2)), backgroundColor: shopRankArr.map(s => getShopColor(s.shopId)), borderWidth: 2, borderColor: '#070b14', hoverOffset: 8 }]
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

  // ---- 订单量趋势图 ----
  if (charts['d-orders']) { try { charts['d-orders'].destroy(); } catch(e) {} }
  charts['d-orders'] = new Chart(document.getElementById('chart-d-orders'), {
    type: 'line',
    data: {
      labels: sortedDates.map(d => d.slice(5)),
      datasets: [{
        label: '支付人数', data: sortedDates.map(d => dateSumMap[d].orders),
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
          callbacks: { label: ctx => '  支付人数：' + ctx.raw.toLocaleString() + ' 人' } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // ---- 各店铺营业额柱状对比图 ----
  const shopBarData = shopRankArr.slice(0, 8);
  if (charts['d-shopbar']) { try { charts['d-shopbar'].destroy(); } catch(e) {} }
  charts['d-shopbar'] = new Chart(document.getElementById('chart-d-shopbar'), {
    type: 'bar',
    data: {
      labels: shopBarData.map(s => getShopName(s.shopId)),
      datasets: [{
        label: '营业额(¥)', data: shopBarData.map(s => +s.rev.toFixed(2)),
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

  // ---- 店铺排行 ----
  document.getElementById('d-shop-rank-list').innerHTML = shopRankArr.length === 0
    ? '<div style="text-align:center;color:#475569;padding:20px">近30天暂无销售数据</div>'
    : `<ul class="rank-list">${
      shopRankArr.slice(0, 8).map((s, i) => `
        <li class="rank-item" style="cursor:pointer" onclick="navigate('shop-detail','${s.shopId}')">
          <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
          <div class="rank-info"><div class="rank-name">${getShopName(s.shopId)}</div><div class="rank-detail">${fmt(s.orders)} 人付款</div></div>
          <span class="rank-val">${fmtMoney(s.rev)}</span>
        </li>`).join('')
    }</ul>`;

  // ---- 款式排行（生意参谋无款式数据，显示提示）----
  document.getElementById('d-style-rank-list').innerHTML =
    '<div style="text-align:center;color:#475569;padding:20px;font-size:13px">生意参谋数据不含款式维度<br>款式分析请在「款式分析」页面查看</div>';
}

// ---- 跨境看板 ----
function _renderCrossDashboard(container) {
  const allShops = DB.getShops();
  const crossShops = allShops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));

  // ✅ 跨境数据存在 CrossBorderDailyDB，不在 aggregateSales 里
  // 从各店铺的每日数据拼出当前周期和前一周期两段
  const days = dashboardDays || 30;
  const today = getPastDate(0);
  const dStart = getPastDate(days);
  const dPrevStart = getPastDate(days * 2);
  const dPrevEnd = getPastDate(days + 1);

  // 汇总当前周期
  let totalRevUSD = 0, totalOrd = 0;
  // 汇总前一周期（用于对比）
  let prevRevUSD = 0, prevOrd = 0;
  // 按店铺汇总（用于排行/饼图）
  const shopSumMap = {}; // shopId -> { revUSD, orders }
  // 按日期汇总（用于趋势图）
  const dateSumMap = {}; // date -> { revUSD, orders }

  crossShops.forEach(shop => {
    const rows = CrossBorderDailyDB.getAll(shop.id);
    rows.forEach(r => {
      const d = r.date;
      const amt = r.amount || 0;
      const ord = r.qty || r.buyers || 0; // qty=支付件数，buyers=支付人数，优先件数
      if (d >= dStart && d <= today) {
        totalRevUSD += amt;
        totalOrd += ord;
        if (!shopSumMap[shop.id]) shopSumMap[shop.id] = { revUSD: 0, orders: 0 };
        shopSumMap[shop.id].revUSD += amt;
        shopSumMap[shop.id].orders += ord;
        if (!dateSumMap[d]) dateSumMap[d] = { revUSD: 0, orders: 0 };
        dateSumMap[d].revUSD += amt;
        dateSumMap[d].orders += ord;
      } else if (d >= dPrevStart && d <= dPrevEnd) {
        prevRevUSD += amt;
        prevOrd += ord;
      }
    });
  });

  const revGrow = prevRevUSD ? ((totalRevUSD - prevRevUSD) / prevRevUSD * 100).toFixed(1) : 0;
  const ordGrow = prevOrd ? ((totalOrd - prevOrd) / prevOrd * 100).toFixed(1) : 0;
  const totalRevCNY = totalRevUSD * USD_TO_CNY;
  const hotStyles = 0; // 跨境每日数据不含款式信息，此处设为0

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
        <div class="stat-label">近${days}天总营业额</div>
        <div class="stat-value" id="csv-rev" style="color:#5eead4">$0</div>
        <div class="stat-sub ${revGrow>=0?'stat-up':'stat-down'}">${revGrow>=0?'↑':'↓'} ${Math.abs(revGrow)}% 较上期</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="csbar-rev" style="width:0%;background:linear-gradient(90deg,#14b8a6,#06b6d4)"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">近${days}天总订单</div>
        <div class="stat-value" id="csv-ord">0</div>
        <div class="stat-sub ${ordGrow>=0?'stat-up':'stat-down'}">${ordGrow>=0?'↑':'↓'} ${Math.abs(ordGrow)}% 较上期</div>
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
      <div class="card"><div class="card-title">📈 近${days}天营业额趋势（跨境$）</div><div class="chart-wrap"><canvas id="chart-c-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🌐 跨境店铺营业额占比</div><div class="chart-wrap"><canvas id="chart-c-pie"></canvas></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title">🏆 跨境店铺营业额排行</div><div id="c-shop-rank-list"></div></div>
      <div class="card"><div class="card-title">🔥 爆款TOP10（跨境）</div><div id="c-style-rank-list"></div></div>
    </div>`;

  // ---- 数字动画（全部使用新变量）----
  animateNumber(document.getElementById('csv-rev'), totalRevUSD, '$', '', 900);
  animateNumber(document.getElementById('csv-ord'), totalOrd, '', '', 700);
  animateNumber(document.getElementById('csv-shops'), crossShops.length, '', '', 500);
  animateNumber(document.getElementById('csv-cny'), totalRevUSD * USD_TO_CNY, '¥', '', 800);
  setTimeout(() => {
    const b1 = document.getElementById('csbar-rev');
    const b2 = document.getElementById('csbar-ord');
    const b3 = document.getElementById('csbar-cny');
    if (b1) b1.style.width = Math.min(100, prevRevUSD ? totalRevUSD/prevRevUSD*60 : 80) + '%';
    if (b2) b2.style.width = Math.min(100, prevOrd ? totalOrd/prevOrd*60 : 80) + '%';
    if (b3) b3.style.width = Math.min(100, prevRevUSD ? totalRevUSD/prevRevUSD*60 : 80) + '%';
  }, 400);

  // ---- 趋势图（从 dateSumMap 取数据）----
  const sortedDates = Object.keys(dateSumMap).sort();
  if (charts['c-trend']) { try { charts['c-trend'].destroy(); } catch(e) {} }
  charts['c-trend'] = new Chart(document.getElementById('chart-c-trend'), {
    type: 'line',
    data: {
      labels: sortedDates.map(d => d.slice(5)),
      datasets: [{
        label: '营业额($)', data: sortedDates.map(d => +dateSumMap[d].revUSD.toFixed(2)),
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

  // ---- 饼图（从 shopSumMap 取数据）----
  const shopRankArr = Object.keys(shopSumMap).map(id => ({
    shopId: id,
    revUSD: shopSumMap[id].revUSD,
    orders: shopSumMap[id].orders
  })).sort((a, b) => b.revUSD - a.revUSD);

  if (charts['c-pie']) { try { charts['c-pie'].destroy(); } catch(e) {} }
  charts['c-pie'] = new Chart(document.getElementById('chart-c-pie'), {
    type: 'doughnut',
    data: {
      labels: shopRankArr.map(s => getShopName(s.shopId)),
      datasets: [{ data: shopRankArr.map(s => +s.revUSD.toFixed(2)), backgroundColor: shopRankArr.map(s => getShopColor(s.shopId)), borderWidth: 2, borderColor: '#070b14', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 8 } },
        tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(20,184,166,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff',
          callbacks: { label: ctx => '  ' + ctx.label + '：$' + ctx.raw.toLocaleString() } }
      },
      animation: { duration: 900, animateRotate: true, animateScale: true }
    }
  });

  // ---- 店铺排行（从 shopRankArr 取数据）----
  document.getElementById('c-shop-rank-list').innerHTML = shopRankArr.length === 0
    ? '<div style="text-align:center;color:#475569;padding:20px">近30天暂无销售数据</div>'
    : `<ul class="rank-list">${
      shopRankArr.slice(0, 8).map((s, i) => `
        <li class="rank-item" style="cursor:pointer" onclick="navigate('shop-detail','${s.shopId}')">
          <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
          <div class="rank-info"><div class="rank-name">${getShopName(s.shopId)}</div><div class="rank-detail">${fmt(s.orders)} 单</div></div>
          <span class="rank-val" style="color:#5eead4">$${s.revUSD.toFixed(2)}</span>
        </li>`).join('')
    }</ul>`;

  // ---- 爆款排行（从跨境订单数据汇总 SKU 销量）----
  const skuMap = {}; // sku -> { totalSale, orderCount, profit, shopSet }
  // 预建成本智能查找函数（双边提取基础部分匹配）
  const findCostDash = _buildCostFinder();
  crossShops.forEach(shop => {
    const rawOrders = CBOrderDB.getAll(shop.id);
    const globalShipping = CBShippingRateDB.get(shop.id);
    rawOrders.forEach(o => {
      if ((o.sale_amount||0) === 0) return; // 跳过作废订单
      const sku = (o.sku||'').trim();
      if (!sku) return;
      const matched = findCostDash(o.sku) || null;
      const cost = matched ? (matched.cost||0) : 0;
      const shipping = globalShipping !== null ? globalShipping : (matched ? (matched.shipping||0) : 0);
      const profit = (o.sale_amount||0) - cost - shipping;
      if (!skuMap[sku]) skuMap[sku] = { sku, name: matched?.name||sku, totalSale: 0, orderCount: 0, profit: 0, shopSet: new Set() };
      skuMap[sku].totalSale += (o.sale_amount||0);
      skuMap[sku].orderCount += 1;
      skuMap[sku].profit += profit;
      skuMap[sku].shopSet.add(shop.id);
    });
  });
  const skuRank = Object.values(skuMap).sort((a,b) => b.totalSale - a.totalSale).slice(0, 10);
  const skuListEl = document.getElementById('c-style-rank-list');
  if (skuRank.length === 0) {
    skuListEl.innerHTML = '<div style="text-align:center;color:#475569;padding:20px;font-size:13px">暂无订单数据<br>在跨境店铺「订单列表」录入订单后即可查看</div>';
  } else {
    skuListEl.innerHTML = `<ul class="rank-list">${skuRank.map((s,i) => `
      <li class="rank-item">
        <span class="rank-no" style="color:${i<3?'#14b8a6':'#475569'}">${i+1}</span>
        <span class="rank-name" title="${s.name}">${s.name.length>16?s.name.slice(0,16)+'…':s.name}</span>
        <span style="font-size:11px;color:#475569;margin-right:6px">${s.orderCount}单·${s.shopSet.size}店</span>
        <span class="rank-val" style="color:#5eead4">$${s.totalSale.toFixed(2)}</span>
      </li>`).join('')}</ul>`;
  }
}

// ============================================
//  页面：款式分析
// ============================================
let _styleMode = 'domestic'; // 'domestic' | 'cross'

function renderStyles() {
  const pg = document.getElementById('page-styles');
  const allShops = DB.getShops();
  const domesticShops = allShops.filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const crossShops = allShops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));

  pg.innerHTML = `
    <div class="header-row">
      <h1>👗 款式分析</h1>
      <div class="btn-group" style="display:flex;align-items:center;gap:8px">
        <select id="style-period" onchange="_refreshStylePage()" style="border:1px solid #e5e7eb;border-radius:7px;padding:7px 12px;font-size:13px;">
          <option value="30">近30天</option>
          <option value="60">近60天</option>
          <option value="90">近90天</option>
          <option value="180">近180天</option>
        </select>
      </div>
    </div>

    <!-- 国内/跨境模式切换 -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <button id="style-mode-domestic" onclick="_setStyleMode('domestic')"
        style="padding:8px 20px;border-radius:20px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${_styleMode==='domestic'?'linear-gradient(135deg,#6366f1,#8b5cf6)':'rgba(255,255,255,0.06)'};
               color:${_styleMode==='domestic'?'#fff':'#94a3b8'};transition:all .2s">
        🏠 国内款式分析 ${domesticShops.length>0?`<span style="margin-left:4px;opacity:0.8;font-size:11px">(${domesticShops.length}家)</span>`:''}
      </button>
      <button id="style-mode-cross" onclick="_setStyleMode('cross')"
        style="padding:8px 20px;border-radius:20px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${_styleMode==='cross'?'linear-gradient(135deg,#0ea5e9,#06b6d4)':'rgba(255,255,255,0.06)'};
               color:${_styleMode==='cross'?'#fff':'#94a3b8'};transition:all .2s">
        🌏 跨境SKU分析 ${crossShops.length>0?`<span style="margin-left:4px;opacity:0.8;font-size:11px">(${crossShops.length}家)</span>`:''}
      </button>
    </div>

    <div id="style-mode-content"></div>`;

  _refreshStylePage();
}

function _setStyleMode(mode) {
  _styleMode = mode;
  // 更新按钮样式
  const btnD = document.getElementById('style-mode-domestic');
  const btnC = document.getElementById('style-mode-cross');
  if (btnD) {
    btnD.style.background = mode==='domestic' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,0.06)';
    btnD.style.color = mode==='domestic' ? '#fff' : '#94a3b8';
  }
  if (btnC) {
    btnC.style.background = mode==='cross' ? 'linear-gradient(135deg,#0ea5e9,#06b6d4)' : 'rgba(255,255,255,0.06)';
    btnC.style.color = mode==='cross' ? '#fff' : '#94a3b8';
  }
  _refreshStylePage();
}

function _refreshStylePage() {
  const container = document.getElementById('style-mode-content');
  if (!container) return;
  if (_styleMode === 'domestic') {
    _renderDomesticStyleContent(container);
  } else {
    _renderCrossStyleContent(container);
  }
}

// ---- 国内款式分析 ----
function _renderDomesticStyleContent(container) {
  const domesticShops = DB.getShops().filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  if (domesticShops.length === 0) {
    container.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#64748b">
      <div style="font-size:40px;margin-bottom:12px">🏠</div>
      <div style="font-size:16px;font-weight:600;color:#94a3b8;margin-bottom:8px">暂无国内店铺</div>
      <div style="font-size:13px;color:#475569">请先在店铺管理中添加国内平台店铺</div>
    </div></div>`;
    return;
  }
  // 检查是否有生意参谋销售数据
  const hasSalesData = DB.getSalesData().filter(d => {
    const shop = DB.getShops().find(s => s.id === (d.shopId||d.shop_id));
    return shop && DOMESTIC_PLATFORMS.has(shop.platform);
  }).length > 0;

  container.innerHTML = `
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
  // 只取国内销售数据（排除跨境的 _cb_daily / _cb_order 占位）
  const allData = aggregateSales({ startDate: getPastDate(days), endDate: getPastDate(0) });
  const data = allData.filter(d => d._source !== 'cross' && d.styleId !== '_cb_daily' && d.styleId !== '_cb_order');
  const shops = DB.getShops().filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const styleSum = sumByStyle(data).sort((a,b) => b.revenue - a.revenue);
  const container = document.getElementById('style-tab-content');

  if (!container) return;

  if (styleSum.length === 0) {
    container.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#64748b">
      <div style="font-size:36px;margin-bottom:12px">📭</div>
      <div style="font-size:15px;font-weight:600;color:#94a3b8;margin-bottom:8px">暂无款式销售数据</div>
      <div style="font-size:12px;color:#475569">请先在各国内店铺中录入生意参谋数据</div>
    </div></div>`;
    return;
  }

  if (tab === 'hot') {
    // 跨店爆款：覆盖2家及以上店铺（国内）
    const hotThreshold = Math.max(2, Math.floor(shops.length * 0.3));
    const hotStyles = styleSum.filter(s => s.shopCount >= hotThreshold);
    container.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">🔥 跨店爆款（覆盖≥${hotThreshold}家国内店铺）</div>
        <p style="font-size:12px;color:#9ca3af;margin-bottom:14px">这些款式在多家国内店铺均有销售，适合在所有店铺同步推广</p>
        ${hotStyles.length === 0 ? `<div style="text-align:center;padding:20px;color:#64748b;font-size:13px">当前周期内暂无覆盖${hotThreshold}家以上店铺的款式</div>` :
        `<div class="table-wrap"><table>
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
        </table></div>`}
      </div>
      ${hotStyles.length > 0 ? `<div class="card">
        <div class="card-title">📊 爆款覆盖率图（Top10）</div>
        <div class="chart-wrap"><canvas id="chart-hot-bar"></canvas></div>
      </div>` : ''}`;

    if (hotStyles.length > 0) {
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
    }

  } else if (tab === 'rank') {
    container.innerHTML = `
      <div class="filter-bar">
        <label>筛选店铺：</label>
        <select id="rank-shop-filter" onchange="filterStyleRank()">
          <option value="">全部国内店铺</option>
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
    const styleOptions = [...new Set(data.map(d => d.styleId))];
    container.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">🔄 各款式在所有国内店铺的销售对比</div>
        <div class="filter-bar" style="margin-bottom:0;background:transparent;padding:0;box-shadow:none">
          <label>选择款式：</label>
          <select id="compare-style" onchange="renderStyleCompare()">
            ${styleOptions.length === 0
              ? '<option value="">暂无款式数据</option>'
              : styleOptions.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="chart-grid">
        <div class="card"><div class="card-title">各店铺该款订单量</div><div class="chart-wrap"><canvas id="chart-compare-orders"></canvas></div></div>
        <div class="card"><div class="card-title">各店铺该款营业额</div><div class="chart-wrap"><canvas id="chart-compare-rev"></canvas></div></div>
      </div>`;
    if (styleOptions.length > 0) renderStyleCompare();
  }
}

function filterStyleRank() {
  const shopFilter = document.getElementById('rank-shop-filter')?.value;
  const sort = document.getElementById('rank-sort')?.value || 'revenue';
  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const filters = { startDate: getPastDate(days), endDate: getPastDate(0) };
  if (shopFilter) filters.shopId = shopFilter;
  const allData = aggregateSales(filters);
  const data = allData.filter(d => d._source !== 'cross' && d.styleId !== '_cb_daily' && d.styleId !== '_cb_order');
  const styleSum = sumByStyle(data).sort((a,b) => b[sort] - a[sort]);
  const tbody = document.getElementById('style-rank-tbody');
  if (!tbody) return;
  tbody.innerHTML = styleSum.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px">暂无数据</td></tr>`
    : styleSum.map((s,i) => `
    <tr>
      <td><strong>#${i+1}</strong></td>
      <td>${s.styleName}</td>
      <td>${fmt(s.orders)}</td>
      <td style="color:#6366f1;font-weight:700">${fmtMoney(s.revenue)}</td>
      <td><span class="badge ${s.shopCount >= DB.getShops().filter(x=>DOMESTIC_PLATFORMS.has(x.platform)).length*0.6 ? 'badge-green':'badge-blue'}">${s.shopCount}家</span></td>
      <td>${fmtMoney(s.revenue / Math.max(s.orders, 1))}</td>
    </tr>`).join('');
}

function renderStyleCompare() {
  const styleId = document.getElementById('compare-style')?.value;
  if (!styleId) return;
  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const allData = aggregateSales({ startDate: getPastDate(days), endDate: getPastDate(0), styleId });
  const data = allData.filter(d => d._source !== 'cross');
  const shopSum = sumByShop(data).sort((a,b) => b.revenue - a.revenue);
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

// ---- 跨境SKU分析 ----
function _renderCrossStyleContent(container) {
  const crossShops = DB.getShops().filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));
  if (crossShops.length === 0) {
    container.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#64748b">
      <div style="font-size:40px;margin-bottom:12px">🌏</div>
      <div style="font-size:16px;font-weight:600;color:#94a3b8;margin-bottom:8px">暂无跨境店铺</div>
      <div style="font-size:13px;color:#475569">请先在店铺管理中添加跨境平台店铺</div>
    </div></div>`;
    return;
  }

  const days = parseInt(document.getElementById('style-period')?.value || 30);
  const cutoff = getPastDate(days);
  const today = getPastDate(0);

  // 从CBOrderDB聚合所有跨境SKU数据
  const skuMap = {};
  crossShops.forEach(shop => {
    const orders = CBOrderDB.getAll(shop.id).filter(o =>
      (o.sale_amount||0) > 0 && (o.date||'') >= cutoff && (o.date||'') <= today
    );
    orders.forEach(o => {
      const sku = (o.sku || '').trim() || '未知SKU';
      const productName = (o.product_name || o.sku || '').trim();
      if (!skuMap[sku]) skuMap[sku] = { sku, productName, orders: 0, revenue: 0, shopSet: new Set(), dateSet: new Set() };
      skuMap[sku].orders++;
      skuMap[sku].revenue += o.sale_amount || 0;
      skuMap[sku].shopSet.add(shop.id);
      skuMap[sku].dateSet.add(o.date);
    });
  });

  const skuList = Object.values(skuMap).map(s => ({
    ...s,
    shopCount: s.shopSet.size,
    shops: Array.from(s.shopSet),
    activeDays: s.dateSet.size,
    avgOrderValue: s.revenue / Math.max(s.orders, 1)
  })).sort((a,b) => b.revenue - a.revenue);

  // 关联成本库获取成本信息
  const costFinder = _buildCostFinder ? _buildCostFinder() : null;

  // 跨境看板总计
  const totalRevenue = skuList.reduce((s,x) => s+x.revenue, 0);
  const totalOrders = skuList.reduce((s,x) => s+x.orders, 0);
  const uniqueSkus = skuList.length;

  container.innerHTML = `
    <!-- 跨境SKU汇总卡片 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">总销售额</div>
        <div style="font-size:22px;font-weight:700;color:#0ea5e9">$${totalRevenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div style="font-size:11px;color:#475569;margin-top:4px">近${days}天</div>
      </div>
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">总订单数</div>
        <div style="font-size:22px;font-weight:700;color:#6366f1">${fmt(totalOrders)}</div>
        <div style="font-size:11px;color:#475569;margin-top:4px">有效订单</div>
      </div>
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">在售SKU数</div>
        <div style="font-size:22px;font-weight:700;color:#10b981">${uniqueSkus}</div>
        <div style="font-size:11px;color:#475569;margin-top:4px">有订单款</div>
      </div>
      <div class="card" style="padding:16px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">客单价</div>
        <div style="font-size:22px;font-weight:700;color:#f59e0b">$${totalOrders>0?(totalRevenue/totalOrders).toFixed(2):'0.00'}</div>
        <div style="font-size:11px;color:#475569;margin-top:4px">均值</div>
      </div>
    </div>

    <div class="tabs" id="cross-style-tabs" style="margin-bottom:0">
      <div class="tab active" onclick="switchCrossStyleTab('rank')">📊 SKU销售排行</div>
      <div class="tab" onclick="switchCrossStyleTab('trend')">📈 销售趋势</div>
      <div class="tab" onclick="switchCrossStyleTab('shop')">🏪 店铺对比</div>
    </div>
    <div id="cross-style-tab-content"></div>`;

  // 存一下数据供子Tab用
  window._crossSkuList = skuList;
  window._crossSkuShops = crossShops;
  window._crossSkuDays = days;
  switchCrossStyleTab('rank');
}

function switchCrossStyleTab(tab) {
  document.querySelectorAll('#cross-style-tabs .tab').forEach((el,i) => {
    el.classList.toggle('active', ['rank','trend','shop'][i] === tab);
  });
  const skuList = window._crossSkuList || [];
  const crossShops = window._crossSkuShops || [];
  const days = window._crossSkuDays || 30;
  const container = document.getElementById('cross-style-tab-content');
  if (!container) return;

  if (tab === 'rank') {
    container.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <label style="font-size:13px;color:#94a3b8">筛选店铺：</label>
        <select id="cross-rank-shop" onchange="_renderCrossSkuTable()" style="border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:12px;background:#1e293b;color:#e2e8f0">
          <option value="">全部跨境店铺</option>
          ${crossShops.map(s => `<option value="${s.id}">${s.name}（${s.platform}）</option>`).join('')}
        </select>
        <label style="font-size:13px;color:#94a3b8">排序：</label>
        <select id="cross-rank-sort" onchange="_renderCrossSkuTable()" style="border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:12px;background:#1e293b;color:#e2e8f0">
          <option value="revenue">销售额</option>
          <option value="orders">订单量</option>
          <option value="avgOrderValue">客单价</option>
          <option value="activeDays">活跃天数</option>
        </select>
        <label style="font-size:13px;color:#94a3b8">搜索：</label>
        <input id="cross-rank-search" type="text" placeholder="搜索货号/商品名..." oninput="_renderCrossSkuTable()"
          style="border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:12px;background:#1e293b;color:#e2e8f0;width:160px">
      </div>
      <div class="card">
        <div class="card-title">📦 跨境SKU销售排行</div>
        <div id="cross-sku-rank-wrap">
          <div class="table-wrap"><table>
            <thead><tr><th>排名</th><th>货号/SKU</th><th>商品名</th><th>总订单</th><th>总销售额</th><th>客单价</th><th>活跃天数</th><th>覆盖店铺</th></tr></thead>
            <tbody id="cross-sku-rank-tbody"></tbody>
          </table></div>
        </div>
      </div>`;
    _renderCrossSkuTable();

  } else if (tab === 'trend') {
    // 按日期聚合所有跨境订单
    const cutoff = getPastDate(days);
    const today = getPastDate(0);
    const dateMap = {};
    crossShops.forEach(shop => {
      CBOrderDB.getAll(shop.id).filter(o => (o.sale_amount||0)>0 && (o.date||'')>=cutoff && (o.date||'')<=today).forEach(o => {
        if (!dateMap[o.date]) dateMap[o.date] = { date: o.date, revenue: 0, orders: 0 };
        dateMap[o.date].revenue += o.sale_amount||0;
        dateMap[o.date].orders++;
      });
    });
    const dateList = Object.values(dateMap).sort((a,b) => a.date.localeCompare(b.date));

    container.innerHTML = `
      <div class="chart-grid" style="margin-top:12px">
        <div class="card">
          <div class="card-title">📈 每日销售额趋势（$）</div>
          <div class="chart-wrap"><canvas id="chart-cross-trend-rev"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">📦 每日订单数趋势</div>
          <div class="chart-wrap"><canvas id="chart-cross-trend-ord"></canvas></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="card-title">🏪 各跨境店铺销售额对比（近${days}天）</div>
        <div class="chart-wrap"><canvas id="chart-cross-shop-bar"></canvas></div>
      </div>`;

    const labels = dateList.map(d => d.date.slice(5));
    setTimeout(() => {
      if (charts['cross-trend-rev']) charts['cross-trend-rev'].destroy();
      charts['cross-trend-rev'] = new Chart(document.getElementById('chart-cross-trend-rev'), {
        type: 'line',
        data: { labels, datasets: [{ label: '销售额($)', data: dateList.map(d => d.revenue), borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.1)', fill: true, tension: 0.4, pointRadius: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => '$'+v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.04)' } }, x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { display: false } } }
        }
      });
      if (charts['cross-trend-ord']) charts['cross-trend-ord'].destroy();
      charts['cross-trend-ord'] = new Chart(document.getElementById('chart-cross-trend-ord'), {
        type: 'bar',
        data: { labels, datasets: [{ label: '订单数', data: dateList.map(d => d.orders), backgroundColor: 'rgba(99,102,241,0.6)', borderRadius: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { grid: { color: 'rgba(255,255,255,0.04)' } }, x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { display: false } } }
        }
      });
      // 各店铺柱状图
      const shopRevMap = {};
      crossShops.forEach(shop => {
        const rev = CBOrderDB.getAll(shop.id).filter(o => (o.sale_amount||0)>0 && (o.date||'')>=cutoff && (o.date||'')<=today)
          .reduce((s,o) => s+(o.sale_amount||0), 0);
        shopRevMap[shop.id] = rev;
      });
      const sortedShops = [...crossShops].sort((a,b) => (shopRevMap[b.id]||0) - (shopRevMap[a.id]||0));
      if (charts['cross-shop-bar']) charts['cross-shop-bar'].destroy();
      charts['cross-shop-bar'] = new Chart(document.getElementById('chart-cross-shop-bar'), {
        type: 'bar',
        data: {
          labels: sortedShops.map(s => s.name),
          datasets: [{ label: '销售额($)', data: sortedShops.map(s => shopRevMap[s.id]||0), backgroundColor: sortedShops.map(s => s.color||'#0ea5e9'), borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => '$'+v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.04)' } }, x: { ticks: { color: '#94a3b8' }, grid: { display: false } } }
        }
      });
    }, 50);

  } else if (tab === 'shop') {
    // 各店铺的Top SKU对比
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px">
        ${crossShops.map(shop => {
          const cutoff = getPastDate(days);
          const today = getPastDate(0);
          const orders = CBOrderDB.getAll(shop.id).filter(o => (o.sale_amount||0)>0 && (o.date||'')>=cutoff && (o.date||'')<=today);
          const skuM = {};
          orders.forEach(o => {
            const sku = (o.sku||'').trim()||'未知SKU';
            if (!skuM[sku]) skuM[sku] = { sku, name: o.product_name||sku, orders:0, revenue:0 };
            skuM[sku].orders++; skuM[sku].revenue += o.sale_amount||0;
          });
          const shopSkus = Object.values(skuM).sort((a,b) => b.revenue-a.revenue).slice(0, 8);
          const shopTotal = shopSkus.reduce((s,x)=>s+x.revenue,0);
          return `<div class="card">
            <div class="card-title" style="display:flex;align-items:center;gap:8px">
              <div style="width:10px;height:10px;border-radius:50%;background:${shop.color||'#0ea5e9'}"></div>
              ${shop.name}
              <span class="badge badge-blue" style="font-size:10px">${shop.platform}</span>
            </div>
            ${shopSkus.length === 0
              ? `<div style="text-align:center;padding:20px;color:#64748b;font-size:12px">暂无订单数据</div>`
              : `<div style="font-size:12px;color:#64748b;margin-bottom:8px">近${days}天共 ${orders.length} 单 · 总额 $${shopTotal.toFixed(2)}</div>
                 <table style="width:100%;font-size:12px">
                   <thead><tr><th style="text-align:left;padding:4px 0;color:#64748b">货号</th><th style="text-align:right;padding:4px 0;color:#64748b">订单</th><th style="text-align:right;padding:4px 0;color:#64748b">销售额</th></tr></thead>
                   <tbody>${shopSkus.map((s,i) => `<tr>
                     <td style="padding:5px 0"><span style="color:#${['f59e0b','6366f1','10b981','0ea5e9','ec4899','8b5cf6','14b8a6','f97316'][i]||'94a3b8'};font-weight:700">#${i+1}</span> <span style="color:#cbd5e1">${s.sku.length>16?s.sku.slice(0,16)+'…':s.sku}</span></td>
                     <td style="text-align:right;color:#94a3b8">${s.orders}</td>
                     <td style="text-align:right;color:#f59e0b;font-weight:600">$${s.revenue.toFixed(2)}</td>
                   </tr>`).join('')}</tbody>
                 </table>`}
          </div>`;
        }).join('')}
      </div>`;
  }
}

function _renderCrossSkuTable() {
  const shopFilter = document.getElementById('cross-rank-shop')?.value || '';
  const sort = document.getElementById('cross-rank-sort')?.value || 'revenue';
  const search = (document.getElementById('cross-rank-search')?.value || '').toLowerCase().trim();
  const days = window._crossSkuDays || 30;
  const cutoff = getPastDate(days);
  const today = getPastDate(0);
  const crossShops = window._crossSkuShops || [];

  // 重新聚合（支持按店铺筛选）
  const skuMap = {};
  crossShops.forEach(shop => {
    if (shopFilter && shop.id !== shopFilter) return;
    CBOrderDB.getAll(shop.id).filter(o => (o.sale_amount||0)>0 && (o.date||'')>=cutoff && (o.date||'')<=today).forEach(o => {
      const sku = (o.sku||'').trim()||'未知SKU';
      const productName = (o.product_name||o.sku||'').trim();
      if (!skuMap[sku]) skuMap[sku] = { sku, productName, orders:0, revenue:0, shopSet:new Set(), dateSet:new Set() };
      skuMap[sku].orders++;
      skuMap[sku].revenue += o.sale_amount||0;
      skuMap[sku].shopSet.add(shop.id);
      skuMap[sku].dateSet.add(o.date);
    });
  });

  let list = Object.values(skuMap).map(s => ({
    ...s, shopCount: s.shopSet.size, shops: Array.from(s.shopSet),
    activeDays: s.dateSet.size, avgOrderValue: s.revenue / Math.max(s.orders,1)
  }));

  // 搜索过滤
  if (search) list = list.filter(s => s.sku.toLowerCase().includes(search) || s.productName.toLowerCase().includes(search));
  // 排序
  list.sort((a,b) => b[sort] - a[sort]);

  const tbody = document.getElementById('cross-sku-rank-tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length === 0
    ? `<tr><td colspan="8" style="text-align:center;color:#64748b;padding:20px">暂无订单数据</td></tr>`
    : list.map((s,i) => `<tr>
        <td><strong style="color:${i<3?['#f59e0b','#94a3b8','#cd7c2f'][i]:'#64748b'}">#${i+1}</strong></td>
        <td style="font-family:monospace;font-size:12px;color:#0ea5e9">${s.sku}</td>
        <td style="font-size:12px;color:#94a3b8;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.productName}">${s.productName||'-'}</td>
        <td>${fmt(s.orders)}</td>
        <td style="color:#10b981;font-weight:700">$${s.revenue.toFixed(2)}</td>
        <td style="color:#f59e0b">$${s.avgOrderValue.toFixed(2)}</td>
        <td>${s.activeDays}天</td>
        <td><span class="badge ${s.shopCount>=2?'badge-green':'badge-blue'}">${s.shopCount}家</span></td>
      </tr>`).join('');
}

// ============================================
//  页面：营业额统计
// ============================================
function renderRevenue() {
  const pg = document.getElementById('page-revenue');
  const shops = DB.getShops();
  const today = new Date().toISOString().slice(0,10);
  const monthStart = today.slice(0,7) + '-01';
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
    const todayStr = new Date().toISOString().slice(0,10);
    const monthStartStr = todayStr.slice(0,7) + '-01';
    container.innerHTML = `
      <div class="filter-bar">
        <label>开始日期：</label><input type="date" id="rev-start" value="${monthStartStr}" onchange="queryDailyRev()">
        <label>结束日期：</label><input type="date" id="rev-end" value="${todayStr}" onchange="queryDailyRev()">
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

  // 国内店铺：用旧版 sales 数据
  const allData = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) });
  const shopSum = sumByShop(allData);
  const sumMap = Object.fromEntries(shopSum.map(s => [s.shopId, s]));

  // 跨境店铺：从 CBOrderDB（订单列表）和 CrossBorderDailyDB（每日数据）补充近30天数据
  const cutoff = getPastDate(30); // 格式 YYYY-MM-DD
  shops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform)).forEach(shop => {
    // 优先使用每日数据（有的话）
    const dailyAll = CrossBorderDailyDB.getAll(shop.id);
    const dailyRecent = dailyAll.filter(d => (d.date||'') >= cutoff);
    // 使用订单数据作为补充
    const ordersAll = CBOrderDB.getAll(shop.id);
    const ordersRecent = ordersAll.filter(o => (o.date||'') >= cutoff && (o.sale_amount||0) > 0);

    let revenue = 0, orderCount = 0, refundOrders = 0;
    if (dailyRecent.length > 0) {
      // 每日数据有值：用每日数据（visitors/buyers/items/amount字段）
      revenue = dailyRecent.reduce((s, d) => s + (parseFloat(d.amount) || parseFloat(d.payment_amount) || 0), 0);
      orderCount = dailyRecent.reduce((s, d) => s + (parseInt(d.buyers) || parseInt(d.payment_buyers) || parseInt(d.payment_count) || 0), 0);
    }
    // 如果每日数据没有revenue，fallback到订单数据
    if (revenue === 0 && ordersRecent.length > 0) {
      revenue = ordersRecent.reduce((s, o) => s + (o.sale_amount||0), 0);
      orderCount = ordersRecent.length;
    }
    // 退款率：退款金额/销售额（从CBRefundDB获取）
    const refunds = CBRefundDB ? CBRefundDB.getAll(shop.id).filter(r => (r.date||'') >= cutoff) : [];
    const refundAmt = refunds.reduce((s, r) => s + (r.refund_amount||0), 0);
    // refundOrders 存退款率(0-100)，供卡片显示
    refundOrders = revenue > 0 ? (refundAmt / revenue * 100) : 0;
    // 在售款式数（商品数）
    const products = ShopProductsDB ? ShopProductsDB.getAll(shop.id) : [];

    sumMap[shop.id] = { shopId: shop.id, revenue, orders: orderCount, refundOrders, styles: products.length, isCross: true };
  });

  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';

  function makeShopCard(shop, canView) {
    const s = sumMap[shop.id] || {};
    const currency = getPlatformCurrency(shop.platform);
    const isDomestic = DOMESTIC_PLATFORMS.has(shop.platform);
    const currencyTag = isDomestic
      ? `<span style="font-size:10px;background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);border-radius:3px;padding:1px 5px">¥ 人民币</span>`
      : `<span style="font-size:10px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:3px;padding:1px 5px">$ 美元</span>`;
    if (!canView) {
      // 正常渲染卡片（所有人都可查看），此分支实际不会触发
      // 保留结构仅供兼容
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
        <div class="shop-stat"><div class="shop-stat-val">${s.isCross ? (s.refundOrders||0).toFixed(1) : (s.orders ? (s.refundOrders/s.orders*100).toFixed(1):'0')}%</div><div class="shop-stat-label">退款率</div></div>
      </div>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
        ${(isAdmin || (shop.created_by || '') === (CURRENT_USER?.id || '') || !shop.created_by) ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();renameShop('${shop.id}')" style="font-size:12px;padding:4px 10px">✏️ 重命名</button>` : ''}
        ${showDel ? `<button class="btn-danger" onclick="event.stopPropagation();deleteShop('${shop.id}')">删除</button>` : ''}
      </div>
    </div>`;
  }

  // 所有成员默认可查看所有店铺（只读），无需申请权限
  function canViewShop(s) {
    return true;
  }

  // 按平台类型分组
  const domesticShops = shops.filter(s => DOMESTIC_PLATFORMS.has(s.platform));
  const crossShops    = shops.filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));
  const otherShops2   = shops.filter(s => !DOMESTIC_PLATFORMS.has(s.platform) && !CROSS_BORDER_PLATFORMS.has(s.platform));

  // 生成一个分组区块的 HTML
  function renderShopGroup(groupShops, groupId, title, iconSvg, accentColor, bgColor) {
    if (groupShops.length === 0) return '';
    const visibleCount = groupShops.filter(canViewShop).length;
    return `
    <div class="shop-group-card" id="sg-${groupId}" style="margin-bottom:24px;border-radius:16px;overflow:hidden;border:1px solid ${accentColor}33;background:${bgColor};">
      <!-- 分组标题行，点击折叠 -->
      <div onclick="toggleShopGroup('${groupId}')" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;user-select:none;border-bottom:1px solid ${accentColor}22;background:${accentColor}0a;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="color:${accentColor};display:flex;align-items:center;">${iconSvg.replace('width="18"','width="22"').replace('height="18"','height="22"')}</span>
          <span style="font-size:18px;font-weight:800;color:#f1f5f9;letter-spacing:0.02em;">${title}</span>
          <span style="background:${accentColor}28;color:${accentColor};border:1px solid ${accentColor}55;border-radius:20px;padding:3px 12px;font-size:13px;font-weight:700;">${visibleCount} / ${groupShops.length} 家</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;color:#64748b;font-size:12px;">
          <span id="sg-tip-${groupId}">点击收起</span>
          <svg id="sg-arrow-${groupId}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2.5" style="transition:transform 0.25s;flex-shrink:0;opacity:0.7"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <!-- 分组内卡片区 -->
      <div id="sg-body-${groupId}" style="padding:16px 14px 14px 14px;">
        <div class="shop-grid">
          ${groupShops.map(s => makeShopCard(s, canViewShop(s))).join('')}
        </div>
      </div>
    </div>`;
  }

  const iconDomestic = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const iconCross    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const iconOther    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`;

  pg.innerHTML = `
    <div class="header-row">
      <h1>🏪 店铺管理</h1>
      <button class="btn-primary" onclick="openAddShop()">➕ 添加店铺</button>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin-bottom:20px">共 ${shops.length} 家店铺（国内 ${domesticShops.length} 家 · 跨境 ${crossShops.length} 家），点击分组标题可折叠，点击卡片查看详情</p>

    ${renderShopGroup(domesticShops, 'domestic', '🏠 国内店铺', iconDomestic, '#34d399', 'rgba(16,185,129,0.04)')}
    ${renderShopGroup(crossShops,    'cross',    '🌐 跨境店铺', iconCross,    '#f59e0b', 'rgba(245,158,11,0.04)')}
    ${renderShopGroup(otherShops2,   'other',    '🏢 其他店铺', iconOther,    '#a78bfa', 'rgba(124,58,237,0.04)')}

    ${shops.length === 0 ? `
    <div style="text-align:center;padding:60px 20px;color:#475569">
      <div style="font-size:40px;margin-bottom:12px">🏪</div>
      <div style="font-size:15px;font-weight:600;color:#64748b">暂无店铺</div>
      <div style="font-size:13px;margin-top:8px">点击右上角「添加店铺」开始</div>
    </div>` : ''}
  `;
}

// 折叠/展开店铺分组
function toggleShopGroup(groupId) {
  const body  = document.getElementById('sg-body-' + groupId);
  const arrow = document.getElementById('sg-arrow-' + groupId);
  const tip   = document.getElementById('sg-tip-' + groupId);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display  = collapsed ? 'block' : 'none';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
  if (tip)   tip.textContent = collapsed ? '点击收起' : '点击展开';
}

// ============================================
//  页面：单店铺详情
// ============================================
function renderShopDetail(shopId) {
  const pg = document.getElementById('page-shop-detail');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) { pg.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>店铺不存在</p></div>'; return; }

  // 所有成员默认有查看权限，无需权限检查
  // 编辑/删除操作由各功能函数内部权限校验控制

  const currency = getPlatformCurrency(shop.platform);
  const isDomestic = DOMESTIC_PLATFORMS.has(shop.platform);
  const currencyLabel = isDomestic ? '人民币 ¥' : '美元 $';
  const currencyColor = isDomestic ? '#34d399' : '#f59e0b';


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
    `}
  `;

  // 重置筛选状态
  window._domesticFilter = '';
  window._domesticFilterDate = '';
  window._domesticTab = 'overview';
  // 跨境店铺：初始化订单分页
  if (!isDomestic) {
    setTimeout(() => initOrderPager(shopId), 0);
  }
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
    list.unshift({ ...product, shop_id: shopId });
    this.save(shopId, list);
    sbPushShopProduct({ ...product, shop_id: shopId }); // 推送云端
    return list;
  },
  update(shopId, productId, updates) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(p => p.id === productId);
    if (idx >= 0) {
      Object.assign(list[idx], updates);
      this.save(shopId, list);
      sbUpdateShopProduct(productId, updates); // 推送云端
    }
    return list;
  },
  remove(shopId, productId) {
    const list = this.getAll(shopId).filter(p => p.id !== productId);
    this.save(shopId, list);
    sbDeleteShopProduct(productId); // 删除云端
    return list;
  }
};

// 国内店铺订单数据库（本地存储）
const DomOrderDB = {
  _key: (shopId) => 'ec_dom_orders_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  add(shopId, row) {
    const list = this.getAll(shopId);
    const newRow = { ...row, shop_id: shopId };
    list.unshift(newRow);
    this.save(shopId, list);
    return newRow;
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    return list;
  },
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
    const newRow = { ...row, shop_id: shopId };
    if (idx >= 0) { list[idx] = { ...list[idx], ...newRow }; }
    else { list.unshift(newRow); }
    this.save(shopId, list);
    sbUpsertDomesticStats(newRow); // 推送云端
    return list;
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    sbDeleteDomesticStats(id); // 删除云端
    return list;
  },
  // 批量导入
  batchUpsert(shopId, rows) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    withShop.forEach(row => {
      const idx = list.findIndex(r => r.date === row.date && r.product_id === row.product_id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...row }; }
      else { list.unshift(row); }
    });
    this.save(shopId, list);
    sbBatchUpsertDomesticStats(withShop); // 批量推送云端
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
  // 支付转化率（支付人数/访客数）
  const sumPayBuyers = filtered.reduce((s,r) => s + (r.pay_buyers||r.pay_count||0), 0);
  const payRate = sumVisitors > 0 ? (sumPayBuyers / sumVisitors * 100).toFixed(2) : '-';

  // 按日期汇总（用于趋势图）
  const dateSales = {};
  filtered.forEach(r => {
    if (!r.date) return;
    if (!dateSales[r.date]) dateSales[r.date] = { rev: 0, visitors: 0 };
    dateSales[r.date].rev += r.pay_amount || 0;
    dateSales[r.date].visitors += r.visitors || 0;
  });
  const trendDates = Object.keys(dateSales).sort();

  const activeTab = window._domesticTab || 'overview';

  return `
  <!-- Tab 导航 -->
  <div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap">
    ${[
      { id:'overview', label:'📊 总览' },
      { id:'products', label:'📦 商品管理' },
      { id:'orders',   label:'🧾 订单管理' },
      { id:'bizdata',  label:'📈 生意参谋' },
      { id:'ads',      label:'📢 广告数据' },
    ].map(t => `<button onclick="switchDomesticTab('${shopId}','${t.id}')"
      style="padding:6px 16px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${activeTab===t.id?'rgba(124,58,237,0.5)':'#1e293b'};background:${activeTab===t.id?'rgba(124,58,237,0.2)':'#1e293b'};color:${activeTab===t.id?'#a78bfa':'#64748b'};transition:all .15s">${t.label}</button>`).join('')}
  </div>

  <!-- ========= Tab: 总览 ========= -->
  <div id="dom-tab-overview-${shopId}" style="display:${activeTab==='overview'?'block':'none'}">
    <!-- 核心指标卡片 -->
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-label">总访客数</div><div class="stat-value" style="color:${shop.color||'#a78bfa'}">${fmt(sumVisitors)}</div></div>
      <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-label">支付人数（订单量）</div><div class="stat-value" style="color:#22d3ee">${fmt(sumPayBuyers)}</div></div>
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">实际支付金额</div><div class="stat-value" style="color:#34d399">¥${sumActualAmt.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="stat-card"><div class="stat-icon">📢</div><div class="stat-label">广告总花费</div><div class="stat-value" style="color:#f87171">¥${totalAdCost.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-label">综合ROI</div><div class="stat-value" style="color:${parseFloat(roi)>=3?'#34d399':parseFloat(roi)>=1?'#fbbf24':'#f87171'}">${roi}</div></div>
      <div class="stat-card"><div class="stat-icon">💎</div><div class="stat-label">UV价值</div><div class="stat-value">¥${uvVal}</div></div>
      <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-label">支付转化率</div><div class="stat-value" style="color:#06b6d4">${payRate}%</div></div>
      <div class="stat-card"><div class="stat-icon">❤️</div><div class="stat-label">收藏率</div><div class="stat-value" style="color:#f472b6">${favRate}%</div></div>
      <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">毛利（去广告）</div><div class="stat-value" style="color:${grossProfit>=0?'#34d399':'#f87171'}">¥${grossProfit.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="stat-card"><div class="stat-icon">%</div><div class="stat-label">毛利率</div><div class="stat-value" style="color:${parseFloat(grossRate)>=30?'#34d399':parseFloat(grossRate)>=10?'#fbbf24':'#f87171'}">${grossRate}%</div></div>
    </div>
    <!-- 销售趋势图 -->
    ${trendDates.length > 0 ? `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📈 销售额趋势（已选时段）</div>
      <div class="chart-wrap" style="height:220px"><canvas id="chart-dom-trend-${shopId}"></canvas></div>
    </div>` : `<div style="text-align:center;color:#475569;padding:24px 0;background:#0f172a;border-radius:10px;margin-bottom:16px">
      <div style="font-size:28px;margin-bottom:8px">📊</div>
      <div style="font-size:13px">暂无生意参谋数据，请先在「生意参谋」Tab 录入数据</div>
    </div>`}
    <!-- 广告效果对比（紧凑版） -->
    ${totalAdCost > 0 ? `
    <div class="card">
      <div class="card-title">📢 广告投放汇总</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        ${adTypes.map(t => {
          const d = adSum[t];
          const adRoi2 = d.cost > 0 ? (d.order_amt/d.cost).toFixed(2) : '-';
          const ctr2 = d.imp > 0 ? (d.clk/d.imp*100).toFixed(2) : '-';
          return `<div style="background:#1e293b;border-radius:8px;padding:12px;border-top:2px solid ${adColors[t]}">
            <div style="font-size:13px;font-weight:600;color:${adColors[t]};margin-bottom:8px">${adNames[t]}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div style="background:#0f172a;border-radius:5px;padding:6px"><div style="color:#64748b">花费</div><div style="color:#f87171;font-weight:700">¥${d.cost.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
              <div style="background:#0f172a;border-radius:5px;padding:6px"><div style="color:#64748b">ROI</div><div style="color:${adColors[t]};font-weight:700">${adRoi2}</div></div>
              <div style="background:#0f172a;border-radius:5px;padding:6px"><div style="color:#64748b">展现</div><div style="color:#e2e8f0">${fmt(d.imp)}</div></div>
              <div style="background:#0f172a;border-radius:5px;padding:6px"><div style="color:#64748b">点击率</div><div style="color:#a78bfa">${ctr2}%</div></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  </div>

  <!-- ========= Tab: 商品管理 ========= -->
  <div id="dom-tab-products-${shopId}" style="display:${activeTab==='products'?'block':'none'}">
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
          <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;min-width:160px">
            <div style="font-weight:600;color:#e2e8f0;font-size:13px">${p.name}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">ID: ${p.product_id||'-'} | 编码: ${p.sku||'-'}</div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn-secondary btn-sm" onclick="openEditProductModal('${shopId}','${p.id}')">编辑</button>
              <button style="font-size:11px;color:#f87171;background:transparent;border:1px solid rgba(248,113,113,0.3);border-radius:5px;padding:2px 8px;cursor:pointer" onclick="removeProduct('${shopId}','${p.id}')">删除</button>
            </div>
          </div>`).join('')}
      </div>`}
  </div>
  </div><!-- END Tab:products -->

  <!-- ========= Tab: 订单管理 ========= -->
  <div id="dom-tab-orders-${shopId}" style="display:${activeTab==='orders'?'block':'none'}">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="card-title" style="margin:0">🧾 订单管理</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" onclick="openAddDomOrderModal('${shopId}')">+ 新增订单</button>
      </div>
    </div>
    ${(() => {
      const orders = DomOrderDB.getAll(shopId);
      const totalAmt = orders.reduce((s,o) => s+(o.amount||0), 0);
      const totalQty = orders.reduce((s,o) => s+(o.qty||1), 0);
      if (orders.length === 0) return `<div style="text-align:center;color:#475569;padding:32px 0"><div style="font-size:32px;margin-bottom:8px">🧾</div><div>暂无订单，点击\"新增订单\"开始录入</div></div>`;
      return `
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-icon">🧾</div><div class="stat-label">总订单数</div><div class="stat-value" style="color:${shop.color||'#a78bfa'}">${fmt(orders.length)}</div></div>
        <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">总件数</div><div class="stat-value">${fmt(totalQty)}</div></div>
        <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">总金额</div><div class="stat-value" style="color:#34d399">¥${totalAmt.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
        <div class="stat-card"><div class="stat-icon">💎</div><div class="stat-label">客单价</div><div class="stat-value">¥${orders.length>0?(totalAmt/orders.length).toFixed(2):'-'}</div></div>
      </div>
      <div class="table-wrap" style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>日期</th><th>商品</th><th>款式/规格</th><th>数量</th><th>金额(¥)</th><th>备注</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${orders.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(o => {
              const prod = products.find(p => p.id === o.product_id);
              return `<tr>
                <td style="white-space:nowrap">${o.date||'-'}</td>
                <td>${prod ? prod.name : (o.product_name||'-')}</td>
                <td style="color:#94a3b8">${o.spec||'-'}</td>
                <td>${fmt(o.qty||1)}</td>
                <td style="color:#34d399">¥${(o.amount||0).toFixed(2)}</td>
                <td style="max-width:120px;color:#64748b;font-size:11px">${o.remark ? `<span title="${o.remark}">${o.remark.length>15?o.remark.slice(0,15)+'…':o.remark}</span>` : '-'}</td>
                <td>
                  <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeDomOrder('${shopId}','${o.id}')">删除</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    })()}
  </div>
  </div><!-- END Tab:orders -->

  <!-- 国内订单录入弹窗 -->
  <div id="modal-dom-order-${shopId}" class="modal" style="display:none">
    <div class="modal-content" style="max-width:480px">
      <div class="modal-header">
        <h3>新增订单</h3>
        <button onclick="closeModal('modal-dom-order-${shopId}')" class="close-btn">✕</button>
      </div>
      <div style="padding:16px;display:grid;gap:12px">
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">订单日期 *</label>
          <input type="date" id="dom-order-date-${shopId}" class="input-field" value="${new Date().toISOString().slice(0,10)}"></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品</label>
          <select id="dom-order-product-${shopId}" class="input-field" style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0">
            <option value="">请选择商品（可选）</option>
            ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select></div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">款式/规格</label>
          <input type="text" id="dom-order-spec-${shopId}" class="input-field" placeholder="如：红色 L码"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">数量</label>
            <input type="number" id="dom-order-qty-${shopId}" class="input-field" value="1" min="1"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">金额(¥) *</label>
            <input type="number" id="dom-order-amount-${shopId}" class="input-field" placeholder="0.00" step="0.01"></div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注</label>
          <input type="text" id="dom-order-remark-${shopId}" class="input-field" placeholder="可选"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="closeModal('modal-dom-order-${shopId}')">取消</button>
          <button class="btn-primary" onclick="saveDomOrder('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ========= Tab: 生意参谋 ========= -->
  <div id="dom-tab-bizdata-${shopId}" style="display:${activeTab==='bizdata'?'block':'none'}">

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
              <th colspan="8" style="text-align:center;background:#1e293b55;border-bottom:1px solid #334155;color:#7c3aed">生意参谋核心指标</th>
              <th colspan="4" style="text-align:center;background:#6366f111;border-bottom:1px solid #334155;color:#6366f1">利润&广告汇总</th>
              <th colspan="6" style="text-align:center;background:#6366f111;border-bottom:1px solid #334155;color:#6366f1">全站推广</th>
              <th colspan="6" style="text-align:center;background:#f59e0b11;border-bottom:1px solid #334155;color:#f59e0b">直通车</th>
              <th colspan="6" style="text-align:center;background:#10b98111;border-bottom:1px solid #334155;color:#10b981">引力魔方</th>
              <th rowspan="2" style="border-bottom:1px solid #334155">备注</th>
              <th rowspan="2" style="border-bottom:1px solid #334155">操作</th>
            </tr>
            <tr style="background:#1e293b;font-size:11px;color:#64748b">
              <th>访客数</th><th>浏览量</th><th>收藏人数</th><th>收藏率</th><th>支付人数</th><th>支付金额</th><th>实际支付</th><th>退款金额</th>
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
                <td>${fmt(r.pay_buyers||0)}</td>
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
  </div><!-- END Tab:bizdata -->

  <!-- ========= Tab: 广告数据 ========= -->
  <div id="dom-tab-ads-${shopId}" style="display:${activeTab==='ads'?'block':'none'}">
  <!-- 广告效果对比卡片 -->
  <div class="chart-grid" style="margin-bottom:16px">
    ${adTypes.map(t => {
      const d = adSum[t];
      const ctr = d.imp > 0 ? (d.clk/d.imp*100).toFixed(2) : '-';
      const addRate = d.clk > 0 ? (d.cart/d.clk*100).toFixed(2) : '-';
      const adRoi = d.cost > 0 ? (d.order_amt/d.cost).toFixed(2) : '-';
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
          <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="color:#64748b">成交金额</div><div style="color:#fbbf24;font-weight:600">¥${d.order_amt.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${totalAdCost === 0 ? `<div style="text-align:center;color:#475569;padding:32px 0">
    <div style="font-size:32px;margin-bottom:8px">📢</div>
    <div>暂无广告数据，请在「生意参谋」Tab 录入数据时填写广告字段</div>
  </div>` : ''}
  </div><!-- END Tab:ads -->

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
            <div><label style="font-size:11px;color:#64748b;display:block;margin-bottom:3px">支付人数</label><input type="number" id="stat-pay-buyers" class="input-field" placeholder="0"></div>
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

// 切换国内店铺 Tab
function switchDomesticTab(shopId, tabId) {
  window._domesticTab = tabId;
  const tabs = ['overview','products','orders','bizdata','ads'];
  tabs.forEach(t => {
    const el = document.getElementById('dom-tab-' + t + '-' + shopId);
    if (el) el.style.display = t === tabId ? 'block' : 'none';
  });
  // 更新按钮高亮
  document.querySelectorAll(`[onclick^="switchDomesticTab('${shopId}']`).forEach(btn => {
    const isActive = btn.getAttribute('onclick').includes(`'${tabId}'`);
    btn.style.background = isActive ? 'rgba(124,58,237,0.2)' : '#1e293b';
    btn.style.color = isActive ? '#a78bfa' : '#64748b';
    btn.style.borderColor = isActive ? 'rgba(124,58,237,0.5)' : '#1e293b';
  });
  // 总览 Tab：渲染趋势图
  if (tabId === 'overview') {
    setTimeout(() => _renderDomesticTrendChart(shopId), 100);
  }
}

// 渲染国内店铺总览趋势图
function _renderDomesticTrendChart(shopId) {
  const canvas = document.getElementById('chart-dom-trend-' + shopId);
  if (!canvas) return;
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) return;
  const filterPid = window._domesticFilter || '';
  const filterDate = window._domesticFilterDate || '';
  let filtered = DomesticStatsDB.getAll(shopId).filter(r => {
    if (filterPid && r.product_id !== filterPid) return false;
    if (filterDate && !r.date.startsWith(filterDate)) return false;
    return true;
  });
  const dateSales = {};
  filtered.forEach(r => {
    if (!r.date) return;
    if (!dateSales[r.date]) dateSales[r.date] = { rev: 0, visitors: 0 };
    dateSales[r.date].rev += r.pay_amount || 0;
    dateSales[r.date].visitors += r.visitors || 0;
  });
  const dates = Object.keys(dateSales).sort();
  if (charts['dom-trend-' + shopId]) { try { charts['dom-trend-' + shopId].destroy(); } catch(e) {} }
  charts['dom-trend-' + shopId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates.map(d => d.slice(5)),
      datasets: [{
        label: '支付金额(¥)',
        data: dates.map(d => +dateSales[d].rev.toFixed(2)),
        borderColor: shop.color || '#a78bfa',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,200);
          g.addColorStop(0, (shop.color||'#a78bfa')+'44');
          g.addColorStop(1, (shop.color||'#a78bfa')+'00');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 6,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(7,11,20,0.9)', titleColor: '#94a3b8', bodyColor: '#fff', callbacks: { label: ctx => '  ¥' + ctx.raw.toLocaleString() } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '¥' + v.toFixed(0) }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 700, easing: 'easeOutCubic' }
    }
  });
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
  if (!checkEditPermission(shopId, null, '添加商品')) return;
  document.getElementById('product-modal-title').textContent = '添加商品';
  document.getElementById('product-name').value = '';
  document.getElementById('product-id-field').value = '';
  document.getElementById('product-sku').value = '';
  document.getElementById('product-note').value = '';
  document.getElementById('product-edit-id').value = '';
  document.getElementById('modal-add-product').style.display = 'flex';
}
function openEditProductModal(shopId, productId) {
  if (!checkEditPermission(shopId, null, '编辑商品')) return;
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
  if (!checkEditPermission(shopId, null, '删除商品')) return;
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
  let errors = 0;
  const newRows = [];
  dataLines.forEach(line => {
    const parts = line.split(/[,\t]/).map(s => s.trim());
    if (parts.length < 2) { errors++; return; }
    const date = normalizeDate(parts[0]);
    if (!date) { errors++; return; }
    const visitors   = parseFloat(parts[1]) || 0;
    const pv         = parseFloat(parts[2]) || 0;
    const payAmount  = parseFloat(parts[3]) || 0;
    const payOrders  = parseFloat(parts[4]) || 0;
    const styleName  = parts[5] || '';
    newRows.push({
      id: 'dstat_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      date, product_id: '',
      visitors, pv, fav_count: 0,
      pay_amount: payAmount, actual_pay: payAmount,
      refund_amount: 0, refund_count: 0, search_buyers: 0,
      zst_cost:0, zst_imp:0, zst_clk:0, zst_fav:0, zst_cart:0, zst_order:0, zst_order_amt:0,
      ztc_cost:0, ztc_imp:0, ztc_clk:0, ztc_fav:0, ztc_cart:0, ztc_order:0, ztc_order_amt:0,
      ylmf_cost:0, ylmf_imp:0, ylmf_clk:0, ylmf_fav:0, ylmf_cart:0, ylmf_order:0, ylmf_order_amt:0,
      _style: styleName,
    });
  });
  const count = newRows.length;
  if (count > 0) DomesticStatsDB.batchUpsert(shopId, newRows); // 批量本地+云端
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
  ['visitors','pv','fav','pay-buyers','pay-amount','actual-pay','refund-amount','refund-count','search-buyers'].forEach(k => {
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
  setV('stat-pay-buyers', r.pay_buyers); setV('stat-pay-amount', r.pay_amount); setV('stat-actual-pay', r.actual_pay);
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
  if (!checkEditPermission(shopId, null, '录入/编辑生意参谋数据')) return;
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
    fav_count: getN('stat-fav'), pay_buyers: getN('stat-pay-buyers'),
    pay_amount: getN('stat-pay-amount'),
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
  if (!checkEditPermission(shopId, null, '删除生意参谋数据')) return;
  if (!confirm('确定删除这条数据吗？')) return;
  DomesticStatsDB.remove(shopId, statId);
  setDomesticFilter(shopId, window._domesticFilter, window._domesticFilterDate);
  showToast('已删除', 'info');
}

// ============ 国内订单管理 ============
function openAddDomOrderModal(shopId) {
  if (!checkEditPermission(shopId, null, '新增订单')) return;
  const el = id => document.getElementById(id + '-' + shopId);
  if (!el('dom-order-date')) return;
  el('dom-order-date').value = new Date().toISOString().slice(0,10);
  el('dom-order-product').value = '';
  el('dom-order-spec').value = '';
  el('dom-order-qty').value = '1';
  el('dom-order-amount').value = '';
  el('dom-order-remark').value = '';
  document.getElementById('modal-dom-order-' + shopId).style.display = 'flex';
}
function saveDomOrder(shopId) {
  if (!checkEditPermission(shopId, null, '新增订单')) return;
  const el = id => document.getElementById(id + '-' + shopId);
  const date = el('dom-order-date')?.value;
  const amount = parseFloat(el('dom-order-amount')?.value || '0');
  if (!date) { showToast('请选择日期', 'error'); return; }
  if (!amount || amount <= 0) { showToast('请填写金额', 'error'); return; }
  const product_id = el('dom-order-product')?.value || '';
  const product_name = product_id ? '' : '';
  const row = {
    id: 'dorder_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    date, product_id, product_name,
    spec: el('dom-order-spec')?.value?.trim() || '',
    qty: parseInt(el('dom-order-qty')?.value || '1') || 1,
    amount,
    remark: el('dom-order-remark')?.value?.trim() || '',
  };
  DomOrderDB.add(shopId, row);
  closeModal('modal-dom-order-' + shopId);
  // 刷新页面
  const domesticEl = document.getElementById('domestic-detail-area');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (domesticEl && shop) domesticEl.innerHTML = renderDomesticDetail(shop);
  showToast('✅ 订单已添加', 'success');
}
function removeDomOrder(shopId, orderId) {
  if (!checkEditPermission(shopId, null, '删除订单')) return;
  if (!confirm('确定删除这条订单吗？')) return;
  DomOrderDB.remove(shopId, orderId);
  const domesticEl = document.getElementById('domestic-detail-area');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (domesticEl && shop) domesticEl.innerHTML = renderDomesticDetail(shop);
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
//  跨境店铺：统一运费设置（按店铺，全局生效）
// ============================================
const CBShippingRateDB = {
  _key: (shopId) => 'ec_cb_shipping_rate_' + shopId,
  get(shopId) {
    const v = localStorage.getItem(this._key(shopId));
    return v !== null ? parseFloat(v) : null; // null 表示未设置
  },
  set(shopId, rate) {
    if (rate === null || rate === '' || isNaN(parseFloat(rate))) {
      localStorage.removeItem(this._key(shopId));
      sbDeleteShippingRate(shopId); // 同步云端删除
    } else {
      localStorage.setItem(this._key(shopId), String(parseFloat(rate)));
      sbSetShippingRate(shopId, parseFloat(rate)); // 同步云端写入
    }
  },
  clear(shopId) {
    localStorage.removeItem(this._key(shopId));
    sbDeleteShippingRate(shopId); // 同步云端删除
  }
};

// ============================================
//  跨境店铺：商品成本库（货号 → 成本 + 运费）
// ============================================

const CBProductCostDB = {
  _key: 'ec_cb_product_cost_global',  // 全平台共用一张成本库
  getAll() {
    try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch(e) { return []; }
  },
  save(list) { localStorage.setItem(this._key, JSON.stringify(list)); },
  add(row) {
    const list = this.getAll();
    list.push(row);
    this.save(list);
    sbPushProductCost(row); // 推送云端
  },
  update(id, updates) {
    const list = this.getAll();
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      Object.assign(list[idx], updates);
      this.save(list);
      sbPushProductCost(list[idx]); // 推送云端
    }
  },
  remove(id) {
    this.save(this.getAll().filter(r => r.id !== id));
    sbDeleteProductCost(id); // 删除云端
  },
  // 批量导入：一次性推送云端
  batchAdd(rows) {
    const list = this.getAll();
    rows.forEach(r => list.push(r));
    this.save(list);
    sbBatchUpsertProductCosts(rows); // 批量推送云端
  },
  // 根据货号查找商品（智能模糊匹配）—— 全局匹配，无需 shopId
  // 匹配策略：
  //   1) 精确匹配（normalize后完全相等）
  //   2) 基础前缀匹配：取订单SKU第一个"-"或空格前的部分，与成本库货号精确匹配
  //   3) 最长前缀包含匹配（兜底）
  findBySku(sku) {
    if (!sku) return null;
    const all = this.getAll();
    if (!all.length) return null;

    // 提取双方基础部分（取第一个"-"或空格前的字母数字主体，转小写）
    const inputFull = _normalizeSkuForMatch(sku);       // 完整normalize
    const inputBase = _extractSkuBase(sku);              // 订单SKU基础部分

    // 1. 双方完整normalize完全相等
    const exact = all.find(p => _normalizeSkuForMatch(p.sku||'') === inputFull);
    if (exact) return exact;

    // 2. 双方都提取基础部分后相等（核心逻辑）
    //    订单: QW2111-Gary  → base: qw2111
    //    成本: QW2111-红色  → base: qw2111
    //    两者 base 相等 → 匹配
    if (inputBase.length >= 3) {
      const baseMatch = all.find(p => _extractSkuBase(p.sku||'') === inputBase);
      if (baseMatch) return baseMatch;
    }

    // 3. 订单base与成本库完整normalize相等
    //    订单: QW2111-Gary  → base: qw2111
    //    成本: QW2111（无后缀）→ full: qw2111
    if (inputBase.length >= 3) {
      const baseVsFull = all.find(p => _normalizeSkuForMatch(p.sku||'') === inputBase);
      if (baseVsFull) return baseVsFull;
    }

    // 4. 兜底：成本库base是订单base的前缀（处理成本库货号更短的情况）
    let bestMatch = null, bestLen = 0;
    for (const p of all) {
      const costBase = _extractSkuBase(p.sku||'');
      if (!costBase || costBase.length < 3) continue;
      if (inputBase.startsWith(costBase) && costBase.length > bestLen) {
        bestMatch = p; bestLen = costBase.length;
      }
    }
    return bestMatch;
  }
};

// 货号标准化：去特殊符号、空格、转小写，仅保留字母数字
function _normalizeSkuForMatch(sku) {
  if (!sku) return '';
  // 去掉所有非字母数字字符（连字符、下划线、空格、点、斜杠等），转小写
  return sku.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 提取货号基础部分：取第一个 "-" 或空格之前的字母数字主体，用于模糊匹配
// 例：QW2111-Gary → qw2111，ATC50222-Dark blue → atc50222，TC08664-LIGHT BLUE → tc08664
function _extractSkuBase(sku) {
  if (!sku) return '';
  // 取第一个 "-" 或空格前的部分
  const base = sku.trim().split(/[-\s]/)[0];
  return base.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 构建成本查找函数（闭包），支持双边提取基础部分的智能匹配
// 用法：const findCost = _buildCostFinder(); const prod = findCost(orderSku);
function _buildCostFinder() {
  const prods = CBProductCostDB.getAll();
  if (!prods.length) return () => null;
  // 预建三种 key 的 Map：
  //   1. full normalize  →  prod
  //   2. base（提取后）  →  prod（同一个 base 只存第一个，先录入优先）
  const fullMap = {};
  const baseMap = {};
  for (const p of prods) {
    if (!p.sku) continue;
    const full = _normalizeSkuForMatch(p.sku);
    const base = _extractSkuBase(p.sku);
    if (full && !fullMap[full]) fullMap[full] = p;
    if (base && !baseMap[base])  baseMap[base] = p;
  }
  return function(orderSku) {
    if (!orderSku) return null;
    const full = _normalizeSkuForMatch(orderSku);
    const base = _extractSkuBase(orderSku);
    // 1. 完整精确匹配
    if (fullMap[full]) return fullMap[full];
    // 2. 双边基础部分相等（核心）
    if (base && baseMap[base]) return baseMap[base];
    // 3. 兜底：成本库base是订单base前缀（前缀最长优先）
    if (base && base.length >= 3) {
      let best = null, bestLen = 0;
      for (const [k, v] of Object.entries(baseMap)) {
        if (base.startsWith(k) && k.length >= 3 && k.length > bestLen) {
          best = v; bestLen = k.length;
        }
      }
      if (best) return best;
    }
    return null;
  };
}

// ============================================
//  跨境店铺：订单列表（含成本）
// ============================================

const CBOrderDB = {
  _key: (shopId) => 'ec_cb_orders_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  add(shopId, row) {
    const list = this.getAll(shopId);
    list.unshift({ ...row, shop_id: shopId });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbPushCBOrder({ ...row, shop_id: shopId }); // 推送云端
  },
  update(shopId, id, updates) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      Object.assign(list[idx], updates);
      this.save(shopId, list);
      sbPushCBOrder({ ...list[idx], shop_id: shopId }); // 推送云端
    }
  },
  remove(shopId, id, silent = false) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    if (!silent) sbDeleteCBOrder(id); // 非静默模式立即删除云端；批量时由外部统一 syncToSupabase
  },
  // 批量导入（返回Promise，支持进度回调）
  async batchAdd(shopId, rows, onProgress) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    // 先去重（同ID不重复加）
    const existIds = new Set(list.map(r => r.id));
    const newRows = withShop.filter(r => !existIds.has(r.id));
    newRows.forEach(r => list.unshift(r));
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    // 异步推送云端（传入进度回调）
    const result = await sbBatchUpsertCBOrders(withShop, onProgress);
    return result;
  }
};

// ============================================
//  跨境店铺：退货退款记录
//  字段：id, date, sku, order_id(可选), qty(退货件数), refund_amount(退款金额), reason(退货原因), status(已退款/处理中/拒绝), remark
// ============================================
const CBRefundDB = {
  _key: (shopId) => 'ec_cb_refunds_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  add(shopId, row) {
    const list = this.getAll(shopId);
    list.unshift({ ...row, shop_id: shopId });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbPushCBRefund({ ...row, shop_id: shopId }); // 推送云端
  },
  update(shopId, id, updates) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      Object.assign(list[idx], updates);
      this.save(shopId, list);
      sbPushCBRefund({ ...list[idx], shop_id: shopId }); // 推送云端
    }
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    sbDeleteCBRefund(id); // 删除云端
  },
  // 批量导入
  batchAdd(shopId, rows) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    withShop.forEach(r => list.unshift(r));
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbBatchUpsertCBRefunds(withShop); // 批量推送云端
  },
  // 统计：退货率（退货件数/总订单销售额的件数关系，用退款金额/总销售额）
  getStats(shopId) {
    const refunds = this.getAll(shopId);
    const totalRefundAmt = refunds.reduce((s,r) => s+(r.refund_amount||0), 0);
    const totalRefundQty = refunds.reduce((s,r) => s+(r.qty||0), 0);
    const orders = CBOrderDB.getAll(shopId);
    // 作废订单（sale_amount=0）不计入销售额分母
    const validOrders = orders.filter(o => (o.sale_amount||0) > 0);
    const totalOrderAmt = validOrders.reduce((s,o) => s+(o.sale_amount||0), 0);
    const refundRate = totalOrderAmt > 0 ? (totalRefundAmt / totalOrderAmt * 100) : 0;
    const statusMap = {};
    refunds.forEach(r => { statusMap[r.status||'未知'] = (statusMap[r.status||'未知']||0) + 1; });
    return { totalRefundAmt, totalRefundQty, totalOrderAmt, refundRate, count: refunds.length, statusMap };
  }
};

// ============================================
//  跨境店铺：差评率记录
//  字段：id, date(时间段/日期), total_reviews(总评价数), negative_reviews(差评数),
//        negative_rate(差评率，自动=negative/total*100), platform(来源平台/渠道，可选), remark
// ============================================
const CBReviewDB = {
  _key: (shopId) => 'ec_cb_reviews_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  upsert(shopId, record) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.id === record.id);
    const row = { ...record, shop_id: shopId };
    if (idx >= 0) list[idx] = row; else list.unshift(row);
    this.save(shopId, list);
    sbPushCBReview(row); // 推送云端
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    sbDeleteCBReview(id); // 删除云端
  },
  // 批量导入
  batchUpsert(shopId, rows) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    withShop.forEach(row => {
      const idx = list.findIndex(r => r.id === row.id);
      if (idx >= 0) list[idx] = row; else list.unshift(row);
    });
    this.save(shopId, list);
    sbBatchUpsertCBReviews(withShop); // 批量推送云端
  },
  // 统计：最新差评率/总评价/总差评数/差评率均值
  getStats(shopId) {
    const reviews = this.getAll(shopId);
    const totalReviews = reviews.reduce((s,r) => s+(r.total_reviews||0), 0);
    const totalNeg = reviews.reduce((s,r) => s+(r.negative_reviews||0), 0);
    const overallRate = totalReviews > 0 ? (totalNeg / totalReviews * 100) : 0;
    // 最新一条（按date降序）
    const sorted = [...reviews].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const latest = sorted[0] || null;
    const latestRate = latest ? (latest.negative_rate != null ? latest.negative_rate : (latest.total_reviews > 0 ? latest.negative_reviews/latest.total_reviews*100 : 0)) : null;
    return { totalReviews, totalNeg, overallRate, count: reviews.length, latest, latestRate };
  }
};

// ============================================================
//  跨境店铺：款式差评明细（CBSkuReviewDB）
//  字段：id, shop_id, date(日期), sku(货号), negative_content(差评内容),
//        reviewer(买家ID/名称，可选), rating(评分1-5，可选),
//        platform(平台，可选), status(待处理/已回复/已解决), remark(备注)
// ============================================================
const CBSkuReviewDB = {
  _key: (shopId) => 'ec_cb_sku_reviews_' + shopId,
  getAll(shopId) {
    try { return JSON.parse(localStorage.getItem(this._key(shopId)) || '[]'); } catch(e) { return []; }
  },
  save(shopId, list) { localStorage.setItem(this._key(shopId), JSON.stringify(list)); },
  add(shopId, row) {
    const list = this.getAll(shopId);
    list.unshift({ ...row, shop_id: shopId });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbUpsertCBSkuReview({ ...row, shop_id: shopId });
  },
  update(shopId, row) {
    const list = this.getAll(shopId);
    const idx = list.findIndex(r => r.id === row.id);
    if (idx >= 0) list[idx] = { ...row, shop_id: shopId };
    else list.unshift({ ...row, shop_id: shopId });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbUpsertCBSkuReview({ ...row, shop_id: shopId });
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    sbDeleteCBSkuReview(id);
  },
  batchAdd(shopId, rows) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    withShop.forEach(r => { const idx = list.findIndex(x => x.id === r.id); if (idx>=0) list[idx]=r; else list.unshift(r); });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbBatchUpsertCBSkuReviews(withShop);
  },
  getStats(shopId) {
    const list = this.getAll(shopId);
    const bySkuMap = {};
    list.forEach(r => {
      if (!bySkuMap[r.sku]) bySkuMap[r.sku] = { sku: r.sku, count: 0 };
      bySkuMap[r.sku].count++;
    });
    const bySku = Object.values(bySkuMap).sort((a,b) => b.count - a.count);
    return { total: list.length, bySku };
  }
};

function openCBShippingModal(shopId) {
  // 弹窗里的 input 值已在渲染时由 value 属性设好，直接打开即可
  openModal('modal-cb-shipping-'+shopId);
  // 聚焦输入框
  setTimeout(() => {
    const inp = document.getElementById('cb-shipping-input-'+shopId);
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function saveCBShippingRate(shopId) {
  const inp = document.getElementById('cb-shipping-input-'+shopId);
  const val = inp ? inp.value.trim() : '';
  if (val === '') {
    CBShippingRateDB.clear(shopId);
    showToast('已清除统一运费，恢复按货号匹配', 'info');
  } else {
    const rate = parseFloat(val);
    if (isNaN(rate) || rate < 0) { showToast('请输入有效的运费金额', 'error'); return; }
    CBShippingRateDB.set(shopId, rate);
    showToast(`✅ 统一运费已设为 ${rate.toFixed(2)}，所有订单即时生效`, 'success');
  }
  closeModal('modal-cb-shipping-'+shopId);
  refreshCBArea(shopId);
}

function clearCBShippingRate(shopId) {
  CBShippingRateDB.clear(shopId);
  closeModal('modal-cb-shipping-'+shopId);
  showToast('已清除统一运费，恢复按货号匹配运费', 'info');
  refreshCBArea(shopId);
}

function openAddCBOrderModal(shopId) {
  if (!checkEditPermission(shopId, null, '录入订单')) return;
  const el = id => document.getElementById(id + '-' + shopId);
  if (!el('cb-order-date')) return;
  document.getElementById('cb-order-modal-title-'+shopId).textContent = '录入订单';
  el('cb-order-date').value = new Date().toISOString().slice(0,10);
  ['sku','sale','remark'].forEach(k => { const e = el('cb-order-'+k); if(e) e.value=''; });
  el('cb-order-edit-id').value = '';
  // 清空成本提示和利润预览
  const matchTip = document.getElementById('cb-order-match-tip-'+shopId);
  if (matchTip) matchTip.innerHTML = '';
  const prev = el('cb-order-profit-preview');
  if (prev) { prev.textContent = '-'; prev.style.color = '#34d399'; }
  openModal('modal-cb-order-'+shopId);
}

function openEditCBOrderModal(shopId, orderId) {
  const order = CBOrderDB.getAll(shopId).find(o => o.id === orderId);
  if (!order) return;
  const el = id => document.getElementById(id + '-' + shopId);
  document.getElementById('cb-order-modal-title-'+shopId).textContent = '编辑订单';
  el('cb-order-date').value = order.date||'';
  el('cb-order-sku').value = order.sku||'';
  el('cb-order-sale').value = order.sale_amount||'';
  el('cb-order-remark').value = order.remark||'';
  el('cb-order-edit-id').value = orderId;
  _updateCBOrderMatchAndProfit(shopId);
  openModal('modal-cb-order-'+shopId);
}

// 货号匹配 + 利润预览（货号输入时实时触发）
function _updateCBOrderMatchAndProfit(shopId) {
  const el = id => document.getElementById(id + '-' + shopId);
  const sku = el('cb-order-sku')?.value?.trim() || '';
  const sale = parseFloat(el('cb-order-sale')?.value) || 0;
  const matchTip = document.getElementById('cb-order-match-tip-'+shopId);
  const shop = DB.getShops().find(s=>s.id===shopId);
  const sym = getPlatformCurrency(shop?.platform||'') === 'USD' ? '$' : '¥';

  let cost = 0, shipping = 0;
  if (sku) {
    const matched = CBProductCostDB.findBySku(sku);
    if (matched) {
      cost = matched.cost || 0;
      shipping = matched.shipping || 0;
      if (matchTip) matchTip.innerHTML = `<span style="color:#34d399">✓ 已匹配：${matched.name||sku}（成本 ${sym}${cost.toFixed(2)} + 运费 ${sym}${shipping.toFixed(2)}）</span>`;
    } else {
      if (matchTip) matchTip.innerHTML = `<span style="color:#f87171">⚠ 未找到货号"${sku}"，请先在"跨境产品成本"页添加该货号</span>`;
    }
  } else {
    if (matchTip) matchTip.innerHTML = '';
  }

  const profit = sale - cost - shipping;
  const prev = el('cb-order-profit-preview');
  if (prev) {
    prev.textContent = sku && sale > 0
      ? `${sym}${profit.toFixed(2)}（销售额 ${sym}${sale.toFixed(2)} - 成本 ${sym}${cost.toFixed(2)} - 运费 ${sym}${shipping.toFixed(2)}）`
      : '-';
    prev.style.color = profit >= 0 ? '#34d399' : '#f87171';
  }
}

function saveCBOrder(shopId) {
  if (!checkEditPermission(shopId, null, '保存订单')) return;
  const el = id => document.getElementById(id + '-' + shopId);
  const date = el('cb-order-date')?.value?.trim();
  if (!date) { showToast('请选择日期', 'error'); return; }
  const sku = el('cb-order-sku')?.value?.trim() || '';
  if (!sku) { showToast('请输入货号', 'error'); return; }
  const saleAmt = parseFloat(el('cb-order-sale')?.value) || 0;
  if (!saleAmt) { showToast('请输入销售额', 'error'); return; }
  const editId = el('cb-order-edit-id')?.value;
  const data = {
    date,
    sku,
    sale_amount: saleAmt,
    remark: el('cb-order-remark')?.value?.trim() || '',
  };
  if (editId) {
    CBOrderDB.update(shopId, editId, data);
  } else {
    data.id = 'cbo_' + Date.now();
    CBOrderDB.add(shopId, data);
  }
  closeModal('modal-cb-order-'+shopId);
  showToast('订单已保存', 'success');
  renderShopDetail(shopId);
}

// ============================================================
//  订单列表：筛选 / 排序 / 分页（数据驱动，每页100条）
// ============================================================

// 当前快捷筛选状态（per shopId）
const _orderQuickFilter = {};
// 当前分页状态（per shopId）
const _orderPager = {}; // { page, filteredData, totalRaw }
// 每页显示条数（per shopId，默认100）
const _orderPageSize = {};

function getOrderPageSize(shopId) {
  return _orderPageSize[shopId] || 100;
}
function setOrderPageSize(shopId, size) {
  _orderPageSize[shopId] = parseInt(size) || 100;
  applyOrderFilter(shopId); // 重新从第1页开始渲染
}

function setOrderQuickFilter(shopId, mode) {
  _orderQuickFilter[shopId] = mode;
  // 高亮激活按钮
  ['all','valid','zero','cancel','profit'].forEach(k => {
    const btn = document.getElementById('ofq-' + (k === 'profit' ? 'profit' : k) + '-' + shopId);
    if (!btn) return;
    const isActive = (k === mode) || (k === 'profit' && mode === 'negprofit');
    btn.style.background = isActive ? 'rgba(167,139,250,0.18)' : (k === 'zero' ? 'rgba(248,113,113,0.08)' : '#1e293b');
    btn.style.borderColor = isActive ? '#a78bfa' : (k === 'zero' ? 'rgba(248,113,113,0.4)' : '#334155');
    btn.style.color = isActive ? '#a78bfa' : (k === 'zero' ? '#f87171' : k === 'cancel' ? '#475569' : k === 'profit' ? '#fbbf24' : '#94a3b8');
  });
  applyOrderFilter(shopId);
}

// 数据驱动的订单筛选+排序，结果存入 _orderPager，再渲染第1页
function applyOrderFilter(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!document.getElementById('order-tbody-' + shopId)) return;

  const search    = (document.getElementById('of-search-' + shopId)?.value || '').toLowerCase().trim();
  const dateStart = document.getElementById('of-date-start-' + shopId)?.value || '';
  const dateEnd   = document.getElementById('of-date-end-'   + shopId)?.value || '';
  const sortVal   = document.getElementById('of-sort-' + shopId)?.value || 'date-desc';
  const quickMode = _orderQuickFilter[shopId] || 'all';

  // 预建 SKU → 成本智能查找函数（双边提取基础部分匹配）
  const findCost = _buildCostFinder();

  // 从数据层读取订单（含成本匹配，使用预建Map）
  const rawOrders = CBOrderDB.getAll(shopId);
  const globalShipping = CBShippingRateDB.get(shopId);
  const allOrders = rawOrders.map(o => {
    const matched = findCost(o.sku) || null;
    const cancelled = (o.sale_amount||0) === 0;
    // 整条作废：成本、运费、利润全部为 0，不参与任何计算
    const cost     = cancelled ? 0 : (matched ? (matched.cost||0) : 0);
    const shipping = cancelled ? 0 : (globalShipping !== null ? globalShipping : (matched ? (matched.shipping||0) : 0));
    const profit   = cancelled ? 0 : (o.sale_amount||0) - cost - shipping;
    const zeroCost = !cancelled && cost === 0;
    return { ...o, cost, shipping, profit, cancelled, zeroCost, matched_name: matched?.name||'' };
  });

  // 筛选
  let filtered = allOrders.filter(o => {
    if (search && !((o.sku||'').toLowerCase().includes(search)) && !((o.matched_name||'').toLowerCase().includes(search))) return false;
    if (dateStart && (o.date||'') < dateStart) return false;
    if (dateEnd   && (o.date||'') > dateEnd)   return false;
    if (quickMode === 'valid'     && o.cancelled)                    return false;
    if (quickMode === 'zero'      && !o.zeroCost)                    return false;
    if (quickMode === 'cancel'    && !o.cancelled)                   return false;
    if (quickMode === 'negprofit' && (o.cancelled || o.profit >= 0)) return false;
    return true;
  });

  // 排序
  filtered.sort((a, b) => {
    switch(sortVal) {
      case 'date-asc':    return (a.date||'').localeCompare(b.date||'');
      case 'date-desc':   return (b.date||'').localeCompare(a.date||'');
      case 'sale-desc':   return (b.sale_amount||0) - (a.sale_amount||0);
      case 'sale-asc':    return (a.sale_amount||0) - (b.sale_amount||0);
      case 'profit-desc': return b.profit - a.profit;
      case 'profit-asc':  return a.profit - b.profit;
      case 'cost-asc':    return a.cost - b.cost;
      default:            return (b.date||'').localeCompare(a.date||'');
    }
  });

  // 存入分页状态，重置到第1页
  _orderPager[shopId] = { page: 1, filteredData: filtered, totalRaw: allOrders.length };

  // 更新汇总统计（基于筛选后全部数据，不受分页影响）
  const currency = shop ? getPlatformCurrency(shop.platform) : 'USD';
  const currSymbol = currency === 'USD' ? '$' : '¥';
  const validFiltered = filtered.filter(o => !o.cancelled);
  const sumSale   = validFiltered.reduce((s,o) => s + (o.sale_amount||0), 0);
  const sumCost   = validFiltered.reduce((s,o) => s + o.cost, 0);
  const sumShip   = validFiltered.reduce((s,o) => s + o.shipping, 0);
  const sumProfit = validFiltered.reduce((s,o) => s + o.profit, 0);
  const margin    = sumSale > 0 ? (sumProfit/sumSale*100).toFixed(1) + '%' : '-';

  const el = id => document.getElementById(id + '-' + shopId);
  if (el('of-count'))  el('of-count').textContent  = `显示 ${filtered.length} / ${allOrders.length} 条`;
  if (el('os-sale'))   el('os-sale').textContent   = currSymbol + sumSale.toFixed(2);
  if (el('os-cost'))   el('os-cost').textContent   = currSymbol + sumCost.toFixed(2);
  if (el('os-ship'))   el('os-ship').textContent   = currSymbol + sumShip.toFixed(2);
  if (el('os-profit')) el('os-profit').textContent = currSymbol + sumProfit.toFixed(2);
  if (el('os-margin')) el('os-margin').textContent = margin;
  if (el('os-cnt'))    el('os-cnt').textContent    = validFiltered.length + ' 单（筛选）';

  renderOrderPage(shopId, 1);
}

// 渲染指定页的订单行
function renderOrderPage(shopId, page) {
  const pagerState = _orderPager[shopId];
  if (!pagerState) return;
  const { filteredData } = pagerState;

  const total = filteredData.length;
  const pageSize = getOrderPageSize(shopId);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  _orderPager[shopId].page = page;

  const start = (page - 1) * pageSize;
  const end   = Math.min(start + pageSize, total);
  const pageData = filteredData.slice(start, end);

  const tbody = document.getElementById('order-tbody-' + shopId);
  if (!tbody) return;

  const shop = DB.getShops().find(s => s.id === shopId);
  const currency = shop ? getPlatformCurrency(shop.platform) : 'USD';
  const currSymbol = currency === 'USD' ? '$' : '¥';

  // 批量构建 HTML（性能优化）
  const html = pageData.map(o => {
    const profit = o.profit;
    const profitColor = o.cancelled ? '#475569' : profit >= 0 ? '#34d399' : '#f87171';
    const margin = (!o.cancelled && (o.sale_amount||0) > 0) ? (profit / (o.sale_amount||1) * 100).toFixed(1) + '%' : '-';
    const rowStyle = o.cancelled ? 'opacity:0.5;' : '';
    const cancelTag = o.cancelled ? `<span style="font-size:10px;background:rgba(100,116,139,0.2);color:#64748b;border-radius:3px;padding:1px 4px;margin-left:3px">作废</span>` : '';
    const zeroCostTag = o.zeroCost ? `<span style="font-size:10px;background:rgba(248,113,113,0.15);color:#f87171;border-radius:3px;padding:1px 4px;margin-left:3px" title="成本未录入">⚠0</span>` : '';
    const marginColor = margin !== '-' && parseFloat(margin) >= 20 ? '#34d399' : margin !== '-' && parseFloat(margin) >= 0 ? '#fbbf24' : '#f87171';
    return `<tr class="order-row-${shopId}" style="${rowStyle}">
      <td style="width:32px"><input type="checkbox" class="order-chk-${shopId}" data-id="${o.id}" onchange="onOrderCheckChange('${shopId}')" style="cursor:pointer;accent-color:#a78bfa"></td>
      <td style="white-space:nowrap;font-weight:600">${o.date||'-'}</td>
      <td style="font-family:monospace;color:#a78bfa">${o.sku||'-'}${zeroCostTag}</td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8" title="${o.matched_name||''}">${o.matched_name || '<span style="color:#334155">未匹配</span>'}</td>
      <td style="color:#f59e0b;font-weight:700">${o.cancelled ? '-' : (currSymbol+(o.sale_amount||0).toFixed(2))}</td>
      <td style="color:#f87171">${o.cost>0 ? currSymbol+o.cost.toFixed(2) : '<span style="color:#475569">-</span>'}</td>
      <td style="color:#fb923c">${o.shipping>0 ? currSymbol+o.shipping.toFixed(2) : '<span style="color:#475569">-</span>'}</td>
      <td style="color:${profitColor};font-weight:700">${o.cancelled ? cancelTag : (currSymbol+profit.toFixed(2))}</td>
      <td style="color:${marginColor}">${margin}</td>
      <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px" title="${o.remark||''}">${o.remark||'<span style="color:#334155">-</span>'}</td>
      <td>
        <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer;padding:2px 4px" onclick="openEditCBOrderModal('${shopId}','${o.id}')">编辑</button>
        <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer;padding:2px 4px" onclick="removeCBOrder('${shopId}','${o.id}')">删</button>
      </td>
    </tr>`;
  }).join('');
  tbody.innerHTML = html;

  // 渲染分页控件
  renderOrderPagerUI(shopId, page, totalPages, total);
}

// 渲染分页控件 UI
function renderOrderPagerUI(shopId, page, totalPages, total) {
  const pagerEl = document.getElementById('order-pager-' + shopId);
  if (!pagerEl) return;

  const pageSize = getOrderPageSize(shopId);
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  // 生成页码按钮（最多显示7个，含省略号）
  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages = [1];
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page-1); i <= Math.min(totalPages-1, page+1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const btnStyle = (isActive) => `padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid ${isActive?'#7c3aed':'#334155'};background:${isActive?'rgba(124,58,237,0.25)':'#1e293b'};color:${isActive?'#a78bfa':'#94a3b8'}`;
  const arrowStyle = (disabled) => `padding:4px 10px;border-radius:6px;font-size:12px;cursor:${disabled?'not-allowed':'pointer'};border:1px solid #1e293b;background:#0f172a;color:${disabled?'#334155':'#64748b'}`;

  const pageSizeOptions = [50, 100, 500, 1000];

  pagerEl.innerHTML = `
    <span style="font-size:11px;color:#475569;margin-right:4px">${total > 0 ? start+'-'+end : 0} / ${total}条</span>
    ${totalPages > 1 ? `
    <button onclick="renderOrderPage('${shopId}',${page-1})" ${page<=1?'disabled':''} style="${arrowStyle(page<=1)}">‹ 上页</button>
    ${pages.map(p => p === '...'
      ? `<span style="color:#475569;padding:0 4px">…</span>`
      : `<button onclick="renderOrderPage('${shopId}',${p})" style="${btnStyle(p===page)}">${p}</button>`
    ).join('')}
    <button onclick="renderOrderPage('${shopId}',${page+1})" ${page>=totalPages?'disabled':''} style="${arrowStyle(page>=totalPages)}">下页 ›</button>
    <span style="font-size:11px;color:#334155;margin-left:2px">共${totalPages}页</span>
    ` : ''}
    <select onchange="setOrderPageSize('${shopId}',this.value)"
      style="margin-left:8px;padding:3px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer">
      ${pageSizeOptions.map(n => `<option value="${n}" ${n===pageSize?'selected':''}>${n}条/页</option>`).join('')}
    </select>
  `;
}

// 初始化订单分页（在 renderCrossBorderDetail 渲染后调用）
function initOrderPager(shopId) {
  if (!document.getElementById('order-tbody-' + shopId)) return;
  applyOrderFilter(shopId);
}

function resetOrderFilter(shopId) {
  const el = id => document.getElementById(id + '-' + shopId);
  if (el('of-search'))    el('of-search').value    = '';
  if (el('of-date-start')) el('of-date-start').value = '';
  if (el('of-date-end'))   el('of-date-end').value   = '';
  if (el('of-sort'))       el('of-sort').value       = 'date-desc';
  setOrderQuickFilter(shopId, 'all');
}

// ---- 多选（分页适配：只选当前页可见行）----
function toggleOrderSelectAll(shopId, checked) {
  document.querySelectorAll('.order-chk-' + shopId).forEach(chk => {
    chk.checked = checked;
  });
  onOrderCheckChange(shopId);
}

function onOrderCheckChange(shopId) {
  const checked = document.querySelectorAll('.order-chk-' + shopId + ':checked');
  const bar     = document.getElementById('order-bulk-bar-' + shopId);
  const cnt     = document.getElementById('order-bulk-count-' + shopId);
  if (bar) bar.style.display = checked.length > 0 ? 'flex' : 'none';
  if (cnt) cnt.textContent   = `已选 ${checked.length} 条`;
}

function clearOrderSelection(shopId) {
  document.querySelectorAll('.order-chk-' + shopId).forEach(c => c.checked = false);
  const all = document.getElementById('order-check-all-' + shopId);
  if (all) all.checked = false;
  onOrderCheckChange(shopId);
}

function bulkDeleteCBOrders(shopId) {
  if (!checkEditPermission(shopId, null, '批量删除订单')) return;
  const checked = Array.from(document.querySelectorAll('.order-chk-' + shopId + ':checked'));
  if (!checked.length) return;
  if (!confirm(`确定删除选中的 ${checked.length} 条订单？此操作不可恢复！`)) return;
  const ids = [];
  checked.forEach(chk => {
    const orderId = chk.getAttribute('data-id');
    ids.push(orderId);
    CBOrderDB.remove(shopId, orderId, true); // true = 静默模式，不各自删云端
  });
  // 批量删除云端（逐条异步，不等待）
  ids.forEach(id => sbDeleteCBOrder(id));
  showToast(`✅ 已删除 ${checked.length} 条订单`, 'success');
  renderShopDetail(shopId);
}

function removeCBOrder(shopId, orderId) {
  if (!checkEditPermission(shopId, null, '删除订单')) return;
  if (!confirm('确定删除该订单？')) return;
  CBOrderDB.remove(shopId, orderId);
  showToast('已删除', 'info');
  renderShopDetail(shopId);
}

function openImportCBOrderModal(shopId) {
  const el = document.getElementById('cb-order-import-text-'+shopId);
  if (el) el.value = '';
  const prev = document.getElementById('cb-order-import-preview-'+shopId);
  if (prev) prev.textContent = '';
  openModal('modal-cb-order-import-'+shopId);
}

async function importCBOrders(shopId) {
  const textEl = document.getElementById('cb-order-import-text-'+shopId);
  const prevEl = document.getElementById('cb-order-import-preview-'+shopId);
  const importBtn = document.getElementById('cb-order-import-btn-'+shopId);
  if (!textEl) return;

  const lines = textEl.value.trim().split('\n').map(l=>l.trim()).filter(l=>l);
  const dataLines = lines.filter(l => /^\d{4}[-/]/.test(l));

  if (dataLines.length === 0) {
    if (prevEl) prevEl.textContent = '❌ 未找到有效数据行（需以日期开头，如：2026-03-01,ABC-001,25.00）';
    showToast('❌ 未找到有效数据行，请检查格式（首列需为日期，如 2026-03-01）', 'error');
    return;
  }

  // 显示进度
  if (prevEl) prevEl.textContent = `⏳ 正在解析 ${dataLines.length} 条数据...`;
  if (importBtn) { importBtn.disabled = true; importBtn.textContent = '导入中...'; }

  // 异步解析，让 UI 有机会更新
  await new Promise(r => setTimeout(r, 0));

  let errors = 0;
  const newRows = [];
  const ts = Date.now();
  dataLines.forEach((line, idx) => {
    const parts = line.split(/[,\t]/).map(s=>s.trim());
    if (parts.length < 2) { errors++; return; }
    const date = normalizeDate(parts[0]);
    if (!date) { errors++; return; }
    const sku = parts[1] || '';
    if (!sku) { errors++; return; }
    newRows.push({
      id: 'cbo_' + ts + '_' + idx,
      date,
      sku,
      sale_amount: parseFloat(parts[2]) || 0,
      remark: parts[3] || '',
    });
  });

  const count = newRows.length;
  if (count === 0) {
    if (prevEl) prevEl.textContent = `❌ 没有解析到有效数据，${errors} 条格式错误`;
    if (importBtn) { importBtn.disabled = false; importBtn.textContent = '导入'; }
    return;
  }

  if (prevEl) prevEl.textContent = `⏳ 已解析 ${count} 条，正在写入本地...`;
  await new Promise(r => setTimeout(r, 0));

  // 云端上传进度回调
  const onUploadProgress = (uploaded, total, failed) => {
    const pct = Math.round(uploaded / total * 100);
    if (prevEl) {
      prevEl.innerHTML = `⬆ 正在同步云端 ${uploaded}/${total} 条（${pct}%）${failed > 0 ? ` <span style="color:#f87171">${failed}条失败</span>` : ''}`;
    }
  };

  // 批量导入（本地 + 云端，支持进度）
  const result = await CBOrderDB.batchAdd(shopId, newRows, count > 500 ? onUploadProgress : null);

  const failMsg = (result && result.fail > 0) ? `，⚠ ${result.fail} 条云端同步失败（本地已保存）` : '';
  if (prevEl) prevEl.textContent = `✅ 成功导入 ${count} 条${errors>0?`，${errors} 条格式错误已跳过`:''}${failMsg}`;
  if (importBtn) { importBtn.disabled = false; importBtn.textContent = '导入'; }

  if (!result || result.fail === 0) {
    closeModal('modal-cb-order-import-'+shopId);
  }
  showToast(`✅ 已导入 ${count} 条订单${errors>0?`（${errors}条跳过）`:''}${result && result.fail > 0 ? '，部分云端同步失败' : ''}`, result && result.fail > 0 ? 'warn' : 'success');
  renderShopDetail(shopId);
}

function downloadCBOrderTemplate() {
  const csv = '日期,货号(SKU),销售额,备注\n2026-03-01,ABC-001,25.00,促销单\n2026-03-02,ABC-002,18.00,\n2026-03-03,ABC-001,22.50,赠品活动\n';
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '跨境订单导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
}

function handleCBOFileDrop(e, shopId) {
  e.preventDefault();
  const dropEl = document.getElementById('cbo-file-drop-'+shopId);
  if (dropEl) dropEl.style.borderColor = '#334155';
  const file = e.dataTransfer.files[0];
  if (file) readCBOFile(file, shopId);
}

function handleCBOFileSelect(input, shopId) {
  const file = input.files[0];
  if (file) readCBOFile(file, shopId);
  input.value = '';
}

function readCBOFile(file, shopId) {
  if (!file.name.match(/\.(csv|txt|xlsx|xls|ods|xlsm)$/i)) { showToast('请上传 CSV/Excel 文件', 'error'); return; }
  readFileAsCSVText(file).then(text => {
    const ta = document.getElementById('cb-order-import-text-'+shopId);
    if (ta) ta.value = text;
    showToast(`已读取"${file.name}"，点击"导入"开始处理`, 'success');
  }).catch(err => showToast('文件读取失败：' + err.message, 'error'));
}

// 重新匹配当前店铺所有订单的商品成本
async function rematchCBOrderCosts(shopId) {
  const orders = CBOrderDB.getAll(shopId);
  if (!orders.length) { showToast('暂无订单数据', 'info'); return; }
  const costAll = CBProductCostDB.getAll();
  if (!costAll.length) { showToast('商品成本库为空，请先录入商品成本', 'warning'); return; }

  let matched = 0, unmatched = 0;
  const updated = orders.map(o => {
    const prod = CBProductCostDB.findBySku(o.sku);
    if (prod) {
      matched++;
      return {
        ...o,
        product_name: prod.name || o.product_name || '',
        cost: prod.cost != null ? prod.cost : (o.cost || 0),
        // 运费：统一运费优先，其次商品成本库运费，再保留原值
        shipping: CBShippingRateDB.get(shopId) !== null
          ? CBShippingRateDB.get(shopId)
          : (prod.shipping != null ? prod.shipping : (o.shipping || 0)),
      };
    } else {
      unmatched++;
      return o;
    }
  });

  // 保存到本地并推送云端
  CBOrderDB.save(shopId, updated);
  showToast(`重新匹配完成：${matched} 条已匹配，${unmatched} 条未找到货号`, matched > 0 ? 'success' : 'warning');

  // 异步推送云端
  try {
    await sbBatchUpsertCBOrders(updated, null);
  } catch(e) { /* 忽略云端失败，本地已更新 */ }

  // 刷新当前视图
  renderCBShopDetail(shopId);
}

function exportCBOrders(shopId, selectedOnly) {
  let rawOrders = CBOrderDB.getAll(shopId);
  if (!rawOrders.length) { showToast('暂无订单数据', 'info'); return; }
  // 如果 selectedOnly=true，只导出选中的行
  if (selectedOnly) {
    const checked = document.querySelectorAll('.order-chk-' + shopId + ':checked');
    if (!checked.length) { showToast('请先选择要导出的订单', 'info'); return; }
    const selIds = new Set([...checked].map(c => c.getAttribute('data-id')));
    rawOrders = rawOrders.filter(o => selIds.has(o.id));
  }
  // 预建 SKU → 成本智能查找函数（双边提取基础部分匹配）
  const findCostExport = _buildCostFinder();
  const header = '日期,货号,商品名称,销售额,产品成本,运费,净利润,利润率,备注';
  const rows = rawOrders.map(o => {
    const matched = findCostExport(o.sku) || null;
    const cost = matched ? (matched.cost||0) : 0;
    const shipping = matched ? (matched.shipping||0) : 0;
    const profit = (o.sale_amount||0) - cost - shipping;
    const margin = o.sale_amount>0?(profit/o.sale_amount*100).toFixed(1)+'%':'-';
    return [o.date, o.sku||'', matched?.name||'', o.sale_amount, cost, shipping, profit.toFixed(2), margin, o.remark||''].join(',');
  });
  const csv = [header,...rows].join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const suffix = selectedOnly ? `_选中${rawOrders.length}条` : '';
  a.download = `跨境订单_${shopId}${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast(`✅ 已导出 ${rawOrders.length} 条订单`, 'success');
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
    const newRow = { ...row, shop_id: shopId };
    if (idx >= 0) { list[idx] = { ...list[idx], ...newRow }; }
    else { list.unshift(newRow); list.sort((a,b) => b.date.localeCompare(a.date)); }
    this.save(shopId, list);
    sbUpsertCBDaily(newRow); // 推送云端
  },
  remove(shopId, id) {
    const list = this.getAll(shopId).filter(r => r.id !== id);
    this.save(shopId, list);
    sbDeleteCBDaily(id); // 删除云端
  },
  // 批量导入
  batchUpsert(shopId, rows) {
    const list = this.getAll(shopId);
    const withShop = rows.map(r => ({ ...r, shop_id: shopId }));
    withShop.forEach(row => {
      const idx = list.findIndex(r => r.date === row.date);
      if (idx >= 0) { list[idx] = { ...list[idx], ...row }; }
      else { list.unshift(row); }
    });
    list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    this.save(shopId, list);
    sbBatchUpsertCBDaily(withShop); // 批量推送云端
  }
};

// 渲染跨境店铺每日数据区域
function renderCrossBorderDetail(shop) {
  const shopId = shop.id;
  const currency = getPlatformCurrency(shop.platform);
  const currSymbol = currency === 'USD' ? '$' : '¥';

  // ---- 读取数据 ----
  const filterMonth = window._cbFilterMonth || '';
  let rows = CrossBorderDailyDB.getAll(shopId);
  if (filterMonth) rows = rows.filter(r => r.date.startsWith(filterMonth));
  const sumVisitors = rows.reduce((s,r) => s+(r.visitors||0), 0);
  const sumBuyers = rows.reduce((s,r) => s+(r.buyers||0), 0);
  const sumQty = rows.reduce((s,r) => s+(r.qty||0), 0);
  const sumAmt = rows.reduce((s,r) => s+(r.amount||0), 0);
  const avgConv = sumVisitors > 0 ? (sumBuyers/sumVisitors*100).toFixed(2) : '-';

  const rawOrders = CBOrderDB.getAll(shopId);
  const globalShipping = CBShippingRateDB.get(shopId); // null=未设置，数字=统一运费
  // 预建 SKU → 成本智能查找函数（双边提取基础部分匹配）
  const findCostDetail = _buildCostFinder();
  const orders = rawOrders.map(o => {
    const matched = findCostDetail(o.sku) || null;
    const shipping = globalShipping !== null ? globalShipping : (matched ? (matched.shipping||0) : 0);
    return { ...o, cost: matched?(matched.cost||0):0, shipping, matched_name: matched?.name||'' };
  });
  // sale_amount=0 的订单视为"作废/未发货"，不计入利润汇总
  const validOrders = orders.filter(o => (o.sale_amount||0) > 0);
  const cancelledOrders = orders.filter(o => (o.sale_amount||0) === 0);
  const totalOrderAmt = validOrders.reduce((s,o) => s+(o.sale_amount||0), 0);
  const totalCost = validOrders.reduce((s,o) => s+(o.cost||0), 0);
  const totalShipping = validOrders.reduce((s,o) => s+(o.shipping||0), 0);
  const totalProfit = totalOrderAmt - totalCost - totalShipping;

  // 退货退款
  const refunds = CBRefundDB.getAll(shopId);
  const refundStats = CBRefundDB.getStats(shopId);
  const REFUND_REASONS = ['质量问题','尺码不符','描述不符','破损/丢件','买家不想要','其他'];
  const REFUND_STATUS = ['处理中','已退款','已拒绝'];

  // 差评率
  const reviews = CBReviewDB.getAll(shopId);
  const reviewStats = CBReviewDB.getStats(shopId);

  // 当前激活Tab
  const activeTab = window['_cbTab_'+shopId] || 'orders';

  const tabStyle = (t) => `display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;border:none;background:${activeTab===t?'rgba(124,58,237,0.18)':'transparent'};color:${activeTab===t?'#a78bfa':'#64748b'}`;

  return `
  <!-- ========= Tab 导航 ========= -->
  <div style="display:flex;gap:4px;margin-bottom:16px;background:#0f172a;border-radius:10px;padding:4px;border:1px solid #1e293b">
    <button style="${tabStyle('orders')}" onclick="setCBTab('${shopId}','orders')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      订单列表 ${orders.length>0?`<span style="background:rgba(124,58,237,0.3);color:#a78bfa;font-size:10px;padding:1px 5px;border-radius:10px">${orders.length}</span>`:''}
    </button>
    <button style="${tabStyle('refunds')}" onclick="setCBTab('${shopId}','refunds')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
      退货退款 ${refunds.length>0?`<span style="background:rgba(248,113,113,0.2);color:#f87171;font-size:10px;padding:1px 5px;border-radius:10px">${refunds.length}</span>`:''}
    </button>
    <button style="${tabStyle('daily')}" onclick="setCBTab('${shopId}','daily')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      每日数据 ${rows.length>0?`<span style="background:rgba(52,211,153,0.15);color:#34d399;font-size:10px;padding:1px 5px;border-radius:10px">${rows.length}</span>`:''}
    </button>
    <button style="${tabStyle('reviews')}" onclick="setCBTab('${shopId}','reviews')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      差评率 ${reviews.length>0?`<span style="background:rgba(251,191,36,0.2);color:#fbbf24;font-size:10px;padding:1px 5px;border-radius:10px">${reviews.length}</span>`:''}
    </button>
  </div>

  <!-- ========= Tab: 订单列表 ========= -->
  <div id="cb-tab-orders-${shopId}" style="display:${activeTab==='orders'?'block':'none'}">
    <div class="card" style="margin-bottom:16px">
      <!-- 顶部操作栏 -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">订单列表</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openCBShippingModal('${shopId}')" title="设置所有订单统一运费"
            style="border-color:rgba(251,191,36,0.4);color:#fbbf24">
            🚚 运费设置${globalShipping!==null?` · $${globalShipping.toFixed(2)}`:''}
          </button>
          <button class="btn-secondary btn-sm" onclick="openAddCBOrderModal('${shopId}')">+ 录入</button>
          <button class="btn-secondary btn-sm" onclick="openImportCBOrderModal('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </button>
          ${orders.length>0?`<button class="btn-secondary btn-sm" onclick="exportCBOrders('${shopId}')">导出</button>`:''}
          ${orders.length>0?`
          <button class="btn-secondary btn-sm" onclick="rematchCBOrderCosts('${shopId}')"
            title="用最新的商品成本库重新匹配所有订单的货号成本"
            style="border-color:rgba(139,92,246,0.4);color:#a78bfa">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            重新匹配成本
          </button>`:''}
        </div>
      </div>

      <!-- 统一运费提示 -->
      ${globalShipping!==null?`
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;font-size:12px">
        <span style="color:#fbbf24">🚚 当前使用<b>统一运费</b>：<b style="font-size:14px">${currSymbol}${globalShipping.toFixed(2)}</b> / 单</span>
        <button onclick="clearCBShippingRate('${shopId}')" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:11px;padding:2px 6px">清除</button>
      </div>`:''}

      <!-- ★ 筛选栏 ★ -->
      <div id="order-filter-bar-${shopId}" style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <!-- 第一行：搜索框 + 快捷筛选按钮 -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <!-- 搜索货号/商品名 -->
          <div style="position:relative;flex:1;min-width:160px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="position:absolute;left:9px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="of-search-${shopId}" type="text" placeholder="搜索货号 / 商品名称..."
              oninput="applyOrderFilter('${shopId}')"
              style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:7px;color:#e2e8f0;font-size:12px;padding:6px 10px 6px 28px;box-sizing:border-box;outline:none;">
          </div>
          <!-- 快捷筛选按钮组 -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button id="ofq-all-${shopId}"     onclick="setOrderQuickFilter('${shopId}','all')"      style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;cursor:pointer;white-space:nowrap">全部</button>
            <button id="ofq-valid-${shopId}"   onclick="setOrderQuickFilter('${shopId}','valid')"    style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;cursor:pointer;white-space:nowrap">有效订单</button>
            <button id="ofq-zero-${shopId}"    onclick="setOrderQuickFilter('${shopId}','zero')"     style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#f87171;cursor:pointer;white-space:nowrap">⚠ 成本为0</button>
            <button id="ofq-cancel-${shopId}"  onclick="setOrderQuickFilter('${shopId}','cancel')"   style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#475569;cursor:pointer;white-space:nowrap">作废订单</button>
            <button id="ofq-profit-${shopId}"  onclick="setOrderQuickFilter('${shopId}','negprofit')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(248,113,113,0.3);background:#1e293b;color:#fbbf24;cursor:pointer;white-space:nowrap">利润为负</button>
          </div>
        </div>
        <!-- 第二行：日期范围 + 排序 -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;color:#475569;white-space:nowrap">日期：</span>
          <input id="of-date-start-${shopId}" type="date" onchange="applyOrderFilter('${shopId}')"
            style="background:#1e293b;border:1px solid #334155;border-radius:6px;color:#94a3b8;font-size:11px;padding:4px 8px;outline:none;">
          <span style="color:#475569;font-size:11px">—</span>
          <input id="of-date-end-${shopId}" type="date" onchange="applyOrderFilter('${shopId}')"
            style="background:#1e293b;border:1px solid #334155;border-radius:6px;color:#94a3b8;font-size:11px;padding:4px 8px;outline:none;">
          <span style="font-size:11px;color:#475569;margin-left:8px;white-space:nowrap">排序：</span>
          <select id="of-sort-${shopId}" onchange="applyOrderFilter('${shopId}')"
            style="background:#1e293b;border:1px solid #334155;border-radius:6px;color:#94a3b8;font-size:11px;padding:4px 8px;outline:none;">
            <option value="date-desc">日期 ↓</option>
            <option value="date-asc">日期 ↑</option>
            <option value="sale-desc">销售额 ↓</option>
            <option value="sale-asc">销售额 ↑</option>
            <option value="profit-desc">利润 ↓</option>
            <option value="profit-asc">利润 ↑</option>
            <option value="cost-asc">成本 ↑（找成本0）</option>
          </select>
          <button onclick="resetOrderFilter('${shopId}')" style="font-size:11px;color:#64748b;background:transparent;border:none;cursor:pointer;padding:4px 6px;white-space:nowrap">↺ 重置</button>
          <!-- 筛选结果计数 -->
          <span id="of-count-${shopId}" style="font-size:11px;color:#475569;margin-left:auto"></span>
        </div>
      </div>

      <!-- 快捷统计（基于筛选结果） -->
      <div id="order-stats-${shopId}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:14px">
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">总销售额</div>
          <div id="os-sale-${shopId}" style="font-size:15px;font-weight:700;color:#f59e0b">${currSymbol}${totalOrderAmt.toFixed(2)}</div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">总成本</div>
          <div id="os-cost-${shopId}" style="font-size:15px;font-weight:700;color:#f87171">${currSymbol}${totalCost.toFixed(2)}</div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">物流成本</div>
          <div id="os-ship-${shopId}" style="font-size:15px;font-weight:700;color:#fb923c">${currSymbol}${totalShipping.toFixed(2)}</div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">净利润</div>
          <div id="os-profit-${shopId}" style="font-size:15px;font-weight:700;color:${totalProfit>=0?'#34d399':'#f87171'}">${currSymbol}${totalProfit.toFixed(2)}</div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">利润率</div>
          <div id="os-margin-${shopId}" style="font-size:15px;font-weight:700;color:${totalOrderAmt>0&&totalProfit/totalOrderAmt>=0.2?'#34d399':totalOrderAmt>0&&totalProfit/totalOrderAmt>=0?'#fbbf24':'#f87171'}">${totalOrderAmt>0?(totalProfit/totalOrderAmt*100).toFixed(1)+'%':'-'}</div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">订单数</div>
          <div id="os-cnt-${shopId}" style="font-size:15px;font-weight:700;color:#94a3b8">${validOrders.length} 单${cancelledOrders.length>0?`<span style="font-size:11px;color:#475569;font-weight:400;margin-left:4px">(${cancelledOrders.length}作废)</span>`:''}</div>
        </div>
      </div>

      <!-- 多选操作栏（有选中时才显示） -->
      <div id="order-bulk-bar-${shopId}" style="display:none;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:8px;padding:8px 14px;margin-bottom:10px;display:none;align-items:center;gap:12px;flex-wrap:wrap">
        <span id="order-bulk-count-${shopId}" style="font-size:13px;color:#a78bfa;font-weight:600"></span>
        <button onclick="bulkDeleteCBOrders('${shopId}')" style="font-size:12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171;border-radius:6px;padding:4px 14px;cursor:pointer">批量删除</button>
        <button onclick="clearOrderSelection('${shopId}')" style="font-size:12px;background:transparent;border:1px solid #334155;color:#64748b;border-radius:6px;padding:4px 12px;cursor:pointer">取消选择</button>
        <div style="margin-left:auto">
          <button onclick="exportCBOrders('${shopId}',true)" style="font-size:12px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);color:#34d399;border-radius:6px;padding:4px 14px;cursor:pointer;display:flex;align-items:center;gap:5px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出选中
          </button>
        </div>
      </div>

      <!-- 订单表格 -->
      ${orders.length === 0
        ? `<div style="text-align:center;color:#475569;padding:24px 0;font-size:13px">
             <div style="font-size:28px;margin-bottom:8px">📋</div>
             暂无订单记录，点击"录入"或"批量导入"开始
           </div>`
        : `<div class="table-wrap">
            <table id="order-table-${shopId}">
              <thead><tr>
                <th style="width:32px"><input type="checkbox" id="order-check-all-${shopId}" onchange="toggleOrderSelectAll('${shopId}',this.checked)" style="cursor:pointer;accent-color:#a78bfa"></th>
                <th>日期</th><th>货号</th><th>商品名称</th>
                <th>销售额(${currSymbol})</th><th>产品成本(${currSymbol})</th><th>运费(${currSymbol})</th>
                <th>净利润(${currSymbol})</th><th>利润率</th><th>备注</th><th>操作</th>
              </tr></thead>
              <tbody id="order-tbody-${shopId}"></tbody>
            </table>
          </div>
          <div id="order-pager-${shopId}" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 0 4px;flex-wrap:wrap"></div>
          `}
    </div>
  </div>


  <!-- ========= Tab: 退货退款 ========= -->
  <div id="cb-tab-refunds-${shopId}" style="display:${activeTab==='refunds'?'block':'none'}">
    <!-- 退货统计卡片 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:16px">
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #f87171">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">退款总额</div>
        <div style="font-size:16px;font-weight:700;color:#f87171">${currSymbol}${refundStats.totalRefundAmt.toFixed(2)}</div>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #fb923c">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">退货件数</div>
        <div style="font-size:16px;font-weight:700;color:#fb923c">${refundStats.totalRefundQty} 件</div>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #fbbf24">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">退款率</div>
        <div style="font-size:16px;font-weight:700;color:${refundStats.refundRate<=5?'#34d399':refundStats.refundRate<=15?'#fbbf24':'#f87171'}">${refundStats.refundRate.toFixed(1)}%</div>
        <div style="font-size:10px;color:#475569;margin-top:2px">退款额/销售额</div>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #94a3b8">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">退单笔数</div>
        <div style="font-size:16px;font-weight:700;color:#94a3b8">${refundStats.count} 笔</div>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #34d399">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">已退款</div>
        <div style="font-size:16px;font-weight:700;color:#34d399">${refundStats.statusMap['已退款']||0} 笔</div>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #a78bfa">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">处理中</div>
        <div style="font-size:16px;font-weight:700;color:#a78bfa">${refundStats.statusMap['处理中']||0} 笔</div>
      </div>
    </div>

    <!-- 退货原因分析（有数据才显示） -->
    ${refunds.length > 0 ? (() => {
      const reasonMap = {};
      refunds.forEach(r => { reasonMap[r.reason||'其他'] = (reasonMap[r.reason||'其他']||0) + 1; });
      const total = refunds.length;
      const sorted = Object.entries(reasonMap).sort((a,b) => b[1]-a[1]);
      return `<div class="card" style="margin-top:12px">
        <div class="card-title">退货原因分析</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          ${sorted.map(([reason, cnt]) => {
            const pct = (cnt/total*100).toFixed(0);
            return `<div style="display:flex;align-items:center;gap:10px">
              <div style="width:80px;font-size:12px;color:#94a3b8;flex-shrink:0">${reason}</div>
              <div style="flex:1;background:#1e293b;border-radius:4px;height:8px;overflow:hidden">
                <div style="width:${pct}%;background:linear-gradient(90deg,#f87171,#fb923c);height:100%;border-radius:4px;transition:width .5s"></div>
              </div>
              <div style="width:50px;text-align:right;font-size:12px;color:#e2e8f0;font-weight:600">${cnt} 次</div>
              <div style="width:35px;text-align:right;font-size:11px;color:#64748b">${pct}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    })() : ''}

    ${(() => {
      // 款式尺码偏差明细：统计各SKU偏大/偏小件数
      const SIZE_SMALL_KEYS = ['尺码偏小','尺码偏小退回','size too small','too small'];
      const SIZE_LARGE_KEYS = ['尺码偏大','尺码偏大退回','size too large','too large','too big'];
      // 筛选出所有尺码退货记录
      const sizeRefunds = refunds.filter(r => {
        const reason = (r.reason||'').toLowerCase();
        return SIZE_SMALL_KEYS.some(k=>reason.includes(k.toLowerCase())) || SIZE_LARGE_KEYS.some(k=>reason.includes(k.toLowerCase()));
      });
      if (sizeRefunds.length === 0) return '';
      // 按SKU聚合
      const skuMap = {}; // { sku: { small: qty, large: qty, totalAmt: amt } }
      sizeRefunds.forEach(r => {
        const sku = r.sku || '未知货号';
        if (!skuMap[sku]) skuMap[sku] = { small: 0, large: 0, totalAmt: 0 };
        const reason = (r.reason||'').toLowerCase();
        const qty = Number(r.qty) || 1;
        const amt = Number(r.refund_amount) || Number(r.amount) || 0;
        if (SIZE_SMALL_KEYS.some(k=>reason.includes(k.toLowerCase()))) skuMap[sku].small += qty;
        else if (SIZE_LARGE_KEYS.some(k=>reason.includes(k.toLowerCase()))) skuMap[sku].large += qty;
        skuMap[sku].totalAmt += amt;
      });
      // 按总件数排序
      const skuRows = Object.entries(skuMap).sort((a,b) => (b[1].small+b[1].large) - (a[1].small+a[1].large));
      const totalSmall = skuRows.reduce((s,[,v])=>s+v.small,0);
      const totalLarge = skuRows.reduce((s,[,v])=>s+v.large,0);
      const maxTotal = Math.max(...skuRows.map(([,v])=>v.small+v.large), 1);
      return `<div class="card" style="margin-top:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
          <div class="card-title" style="margin:0">款式尺码偏差明细</div>
          <div style="display:flex;gap:12px">
            <span style="font-size:12px;background:#1e3a5f;color:#60a5fa;padding:3px 10px;border-radius:12px;font-weight:600">
              偏小合计：${totalSmall} 件
            </span>
            <span style="font-size:12px;background:#3b1f2b;color:#f87171;padding:3px 10px;border-radius:12px;font-weight:600">
              偏大合计：${totalLarge} 件
            </span>
          </div>
        </div>
        <div class="table-wrap" style="max-height:320px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#0f172a;position:sticky;top:0;z-index:1">
                <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">货号(SKU)</th>
                <th style="padding:8px 12px;text-align:center;color:#60a5fa;font-weight:600;border-bottom:1px solid #334155">
                  <span style="display:inline-flex;align-items:center;gap:4px">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                    偏小（件）
                  </span>
                </th>
                <th style="padding:8px 12px;text-align:center;color:#f87171;font-weight:600;border-bottom:1px solid #334155">
                  <span style="display:inline-flex;align-items:center;gap:4px">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                    偏大（件）
                  </span>
                </th>
                <th style="padding:8px 12px;text-align:center;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155">合计</th>
                <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155;min-width:160px">占比分布</th>
                <th style="padding:8px 12px;text-align:center;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155">尺码倾向</th>
              </tr>
            </thead>
            <tbody>
              ${skuRows.map(([sku, v], idx) => {
                const total = v.small + v.large;
                const smallPct = total > 0 ? (v.small/total*100).toFixed(0) : 0;
                const largePct = total > 0 ? (v.large/total*100).toFixed(0) : 0;
                const barWidth = (total/maxTotal*100).toFixed(0);
                let tendency = '-'; let tendencyColor = '#94a3b8';
                if (v.small > v.large * 1.5) { tendency = '明显偏小'; tendencyColor = '#60a5fa'; }
                else if (v.large > v.small * 1.5) { tendency = '明显偏大'; tendencyColor = '#f87171'; }
                else if (v.small > 0 && v.large > 0) { tendency = '两者相当'; tendencyColor = '#fbbf24'; }
                else if (v.small > 0) { tendency = '偏小'; tendencyColor = '#93c5fd'; }
                else if (v.large > 0) { tendency = '偏大'; tendencyColor = '#fca5a5'; }
                const rowBg = idx%2===0 ? '#0f172a' : '#111827';
                return `<tr style="background:${rowBg};transition:background .15s" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='${rowBg}'">
                  <td style="padding:9px 12px;color:#e2e8f0;font-family:monospace;font-size:12px;font-weight:600">${sku}</td>
                  <td style="padding:9px 12px;text-align:center">
                    ${v.small > 0 ? `<span style="background:#1e3a5f;color:#60a5fa;padding:2px 10px;border-radius:10px;font-weight:700;font-size:13px">${v.small}</span>` : `<span style="color:#334155;font-size:12px">-</span>`}
                  </td>
                  <td style="padding:9px 12px;text-align:center">
                    ${v.large > 0 ? `<span style="background:#3b1f2b;color:#f87171;padding:2px 10px;border-radius:10px;font-weight:700;font-size:13px">${v.large}</span>` : `<span style="color:#334155;font-size:12px">-</span>`}
                  </td>
                  <td style="padding:9px 12px;text-align:center;color:#94a3b8;font-weight:600">${total}</td>
                  <td style="padding:9px 12px">
                    <div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:#1e293b;width:${barWidth}%;min-width:20px;max-width:100%">
                      ${v.small>0?`<div style="width:${smallPct}%;background:#3b82f6;transition:width .4s" title="偏小 ${v.small}件 (${smallPct}%)"></div>`:''}
                      ${v.large>0?`<div style="width:${largePct}%;background:#f87171;transition:width .4s" title="偏大 ${v.large}件 (${largePct}%)"></div>`:''}
                    </div>
                    <div style="display:flex;gap:8px;margin-top:3px;font-size:10px;color:#64748b">
                      ${v.small>0?`<span style="color:#60a5fa">↑小${smallPct}%</span>`:''}
                      ${v.large>0?`<span style="color:#f87171">↓大${largePct}%</span>`:''}
                    </div>
                  </td>
                  <td style="padding:9px 12px;text-align:center">
                    <span style="font-size:11px;color:${tendencyColor};font-weight:600">${tendency}</span>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#0f172a;border-top:2px solid #334155">
                <td style="padding:9px 12px;color:#64748b;font-weight:600;font-size:12px">合计 (${skuRows.length} 款)</td>
                <td style="padding:9px 12px;text-align:center">
                  <span style="color:#60a5fa;font-weight:700;font-size:13px">${totalSmall}</span>
                </td>
                <td style="padding:9px 12px;text-align:center">
                  <span style="color:#f87171;font-weight:700;font-size:13px">${totalLarge}</span>
                </td>
                <td style="padding:9px 12px;text-align:center;color:#e2e8f0;font-weight:700">${totalSmall+totalLarge}</td>
                <td colspan="2" style="padding:9px 12px;font-size:11px;color:#64748b">
                  偏小占 ${totalSmall+totalLarge>0?(totalSmall/(totalSmall+totalLarge)*100).toFixed(1):0}%
                  &nbsp;·&nbsp;
                  偏大占 ${totalSmall+totalLarge>0?(totalLarge/(totalSmall+totalLarge)*100).toFixed(1):0}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#475569;padding:0 4px">
          💡 数据来源：退货记录中原因含"尺码偏小"或"尺码偏大"的记录，退货件数默认按每条记录 1 件计算
        </div>
      </div>`;
    })()}

    <div class="card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">退货退款记录</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openAddCBRefundModal('${shopId}')">+ 录入退货</button>
          <button class="btn-secondary btn-sm" onclick="openImportCBRefundModal('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </button>
          ${refunds.length>0?`<button class="btn-secondary btn-sm" onclick="exportCBRefunds('${shopId}')">导出</button>`:''}
        </div>
      </div>
      <!-- 筛选栏 -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#0f172a;border-radius:8px;margin-bottom:12px">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">开始日期</label>
        <input type="date" id="rf-start-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyRefundFilter('${shopId}')">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">结束日期</label>
        <input type="date" id="rf-end-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyRefundFilter('${shopId}')">
        <input type="text" id="rf-sku-${shopId}" placeholder="货号筛选..." style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px;width:110px" oninput="applyRefundFilter('${shopId}')">
        <select id="rf-status-${shopId}" onchange="applyRefundFilter('${shopId}')" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="">全部状态</option>
          <option value="处理中">处理中</option>
          <option value="已退款">已退款</option>
          <option value="已拒绝">已拒绝</option>
        </select>
        <button onclick="resetRefundFilter('${shopId}')" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:12px;cursor:pointer">重置</button>
      </div>
      <!-- 表格区（数据驱动渲染） -->
      <div id="refund-table-area-${shopId}"></div>
    </div>
  </div>

  <!-- ========= Tab: 每日数据 ========= -->
  <div id="cb-tab-daily-${shopId}" style="display:${activeTab==='daily'?'block':'none'}">
    <!-- 汇总卡片 -->
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-label">总访客量</div><div class="stat-value" style="color:${shop.color}">${fmt(sumVisitors)}</div></div>
      <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-label">支付人数</div><div class="stat-value">${fmt(sumBuyers)}</div></div>
      <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">支付件数</div><div class="stat-value">${fmt(sumQty)}</div></div>
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">支付金额</div><div class="stat-value" style="color:#f59e0b">${currSymbol}${sumAmt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">成交转化率</div><div class="stat-value">${avgConv !== '-' ? avgConv+'%' : '-'}</div></div>
      <div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">客均价</div><div class="stat-value">${sumBuyers>0?currSymbol+(sumAmt/sumBuyers).toFixed(2):'-'}</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div class="card-title" style="margin:0">每日运营数据</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openAddCBDailyModal('${shopId}')">+ 录入</button>
          <button class="btn-secondary btn-sm" onclick="openImportCBModal('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </button>
          ${rows.length > 0 ? `<button class="btn-secondary btn-sm" onclick="exportCBDaily('${shopId}')">导出</button>` : ''}
        </div>
      </div>
      <!-- 筛选栏 -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#0f172a;border-radius:8px;margin-bottom:12px">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">开始日期</label>
        <input type="date" id="df-start-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyDailyFilter('${shopId}')">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">结束日期</label>
        <input type="date" id="df-end-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyDailyFilter('${shopId}')">
        <select onchange="applyDailyFilterByMonth('${shopId}',this.value)" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="">快速选月份</option>
          ${getRecentMonths(6).map(m => `<option value="${m}">${m.replace('-','年')}月</option>`).join('')}
        </select>
        <button onclick="resetDailyFilter('${shopId}')" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:12px;cursor:pointer">重置</button>
      </div>
      <!-- 表格区（数据驱动渲染） -->
      <div id="daily-table-area-${shopId}"></div>
    </div>
  </div>

  <!-- ========= 弹窗们 ========= -->

  <!-- 录入订单弹窗 -->
  <div id="modal-cb-order-${shopId}" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:420px;width:95%">
      <div class="modal-header">
        <h3 id="cb-order-modal-title-${shopId}">录入订单</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-order-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="display:grid;gap:12px">
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">订单日期 *</label>
          <input type="date" id="cb-order-date-${shopId}" class="input-field" value="${new Date().toISOString().slice(0,10)}"></div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">货号(SKU) *</label>
          <input type="text" id="cb-order-sku-${shopId}" class="input-field" placeholder="输入货号，自动匹配成本"
            oninput="_updateCBOrderMatchAndProfit('${shopId}')" onchange="_updateCBOrderMatchAndProfit('${shopId}')">
          <div id="cb-order-match-tip-${shopId}" style="margin-top:5px;font-size:11px;min-height:16px"></div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">销售额(${currSymbol}) *</label>
          <input type="number" id="cb-order-sale-${shopId}" class="input-field" placeholder="0.00" step="0.01" min="0"
            oninput="_updateCBOrderMatchAndProfit('${shopId}')"></div>
        <div style="background:#1e293b;border-radius:6px;padding:10px 12px;font-size:12px">
          <div style="color:#64748b;margin-bottom:4px">预估净利润</div>
          <div id="cb-order-profit-preview-${shopId}" style="color:#34d399;font-weight:700;font-size:13px">-</div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
          <input type="text" id="cb-order-remark-${shopId}" class="input-field" placeholder="可选"></div>
        <input type="hidden" id="cb-order-edit-id-${shopId}">
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-cb-order-${shopId}')">取消</button>
          <button class="btn-primary" onclick="saveCBOrder('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入订单弹窗 -->
  <div id="modal-cb-order-import-${shopId}" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:600px;width:95%">
      <div class="modal-header">
        <h3>批量导入订单数据</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-order-import-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#64748b;line-height:1.9">
        <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明</div>
        <div>列顺序：<span style="color:#f87171;font-family:monospace">日期, 货号(SKU), 销售额, 备注（备注可不填）</span></div>
        <div style="color:#34d399;margin-top:2px">成本与运费自动从"跨境产品成本"的商品成本库匹配</div>
        <div style="color:#fbbf24;font-family:monospace;margin-top:4px">示例：2026-03-01, ABC-001, 25.00, 促销单</div>
        <div style="margin-top:8px">
          <button onclick="downloadCBOrderTemplate()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载订单导入模板（CSV）
          </button>
        </div>
      </div>
      <div id="cbo-file-drop-${shopId}" onclick="document.getElementById('cbo-file-input-${shopId}').click()"
        style="border:2px dashed #334155;border-radius:10px;padding:14px;text-align:center;cursor:pointer;margin-bottom:10px;transition:border-color .2s"
        ondragover="event.preventDefault();this.style.borderColor='#7c3aed'"
        ondragleave="this.style.borderColor='#334155'"
        ondrop="handleCBOFileDrop(event,'${shopId}')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:5px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div style="color:#64748b;font-size:13px">点击或拖拽上传文件</div>
        <div style="color:#475569;font-size:11px;margin-top:3px">支持 CSV / Excel（.xlsx .xls .ods）/ TXT，或直接粘贴</div>
      </div>
      <input type="file" id="cbo-file-input-${shopId}" accept=".csv,.txt,.xlsx,.xls,.ods,.xlsm" style="display:none" onchange="handleCBOFileSelect(this,'${shopId}')">
      <div style="color:#64748b;font-size:12px;margin-bottom:6px">或手动粘贴数据：</div>
      <textarea id="cb-order-import-text-${shopId}" style="width:100%;height:130px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="日期,货号,销售额,备注&#10;2026-03-01,ABC-001,25.00,促销单"></textarea>
      <div id="cb-order-import-preview-${shopId}" style="margin-top:8px;font-size:12px;color:#64748b"></div>
      <div class="modal-btns">
        <button class="btn-secondary" onclick="closeModal('modal-cb-order-import-${shopId}')">取消</button>
        <button id="cb-order-import-btn-${shopId}" class="btn-primary" onclick="importCBOrders('${shopId}')">导入</button>
      </div>
    </div>
  </div>

  <!-- 统一运费设置弹窗 -->
  <div id="modal-cb-shipping-${shopId}" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:380px;width:95%">
      <div class="modal-header">
        <h3>🚚 统一运费设置</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-shipping-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="padding:0 0 8px">
        <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#94a3b8;line-height:1.8">
          <div>设置后，此店铺 <b style="color:#fbbf24">所有订单</b> 的运费将统一使用该费率</div>
          <div>留空或清除则自动从商品成本库匹配各货号运费</div>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px">统一运费（${currSymbol} / 单）</label>
          <input id="cb-shipping-input-${shopId}" type="number" min="0" step="0.01" placeholder="如：3.50"
            value="${globalShipping!==null?globalShipping:''}"
            style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px 14px;font-size:16px;box-sizing:border-box;text-align:center;font-weight:700">
        </div>
        <div class="modal-btns" style="gap:8px">
          <button class="btn-secondary" onclick="clearCBShippingRate('${shopId}')">清除（恢复按货号）</button>
          <button class="btn-primary" onclick="saveCBShippingRate('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 录入退货退款弹窗 -->
  <div id="modal-cb-refund-${shopId}" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:460px;width:95%">
      <div class="modal-header">
        <h3 id="cb-refund-modal-title-${shopId}">录入退货退款</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-refund-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="display:grid;gap:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">退货日期 *</label>
            <input type="date" id="cb-refund-date-${shopId}" class="input-field" value="${new Date().toISOString().slice(0,10)}"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">货号(SKU)</label>
            <input type="text" id="cb-refund-sku-${shopId}" class="input-field" placeholder="可选"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">退货件数</label>
            <input type="number" id="cb-refund-qty-${shopId}" class="input-field" placeholder="0" min="0"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">退款金额(${currSymbol}) *</label>
            <input type="number" id="cb-refund-amount-${shopId}" class="input-field" placeholder="0.00" step="0.01" min="0"></div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">退货原因</label>
          <select id="cb-refund-reason-${shopId}" class="input-field">
            <option value="">请选择...</option>
            ${REFUND_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">处理状态</label>
          <div style="display:flex;gap:8px">
            ${REFUND_STATUS.map(s => `
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:#e2e8f0">
                <input type="radio" name="cb-refund-status-${shopId}" value="${s}" ${s==='处理中'?'checked':''} style="accent-color:#7c3aed"> ${s}
              </label>`).join('')}
          </div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
          <input type="text" id="cb-refund-remark-${shopId}" class="input-field" placeholder="如：订单号 / 平台工单号 / 处理说明"></div>
        <input type="hidden" id="cb-refund-edit-id-${shopId}">
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-cb-refund-${shopId}')">取消</button>
          <button class="btn-primary" onclick="saveCBRefund('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入退货弹窗 -->
  <div id="modal-cb-refund-import-${shopId}" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:600px;width:95%">
      <div class="modal-header">
        <h3>批量导入退货退款</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-refund-import-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#64748b;line-height:1.9">
        <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明</div>
        <div>列顺序：<span style="color:#f87171;font-family:monospace">日期, 货号, 退货件数, 退款金额, 退货原因, 状态, 备注</span></div>
        <div style="color:#475569">其中"货号/退货原因/状态/备注"可以留空，前4列（日期/货号/件数/金额）必填</div>
        <div style="color:#fbbf24;font-family:monospace;margin-top:4px">示例：2026-03-01, ABC-001, 2, 50.00, 质量问题, 已退款, 平台工单123</div>
        <div style="margin-top:8px">
          <button onclick="downloadCBRefundTemplate()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载退货导入模板（CSV）
          </button>
        </div>
      </div>
      <div id="cbr-file-drop-${shopId}" onclick="document.getElementById('cbr-file-input-${shopId}').click()"
        style="border:2px dashed #334155;border-radius:10px;padding:14px;text-align:center;cursor:pointer;margin-bottom:10px;transition:border-color .2s"
        ondragover="event.preventDefault();this.style.borderColor='#f87171'"
        ondragleave="this.style.borderColor='#334155'"
        ondrop="handleCBRFileDrop(event,'${shopId}')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:5px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div style="color:#64748b;font-size:13px">点击或拖拽上传文件</div>
        <div style="color:#475569;font-size:11px;margin-top:3px">支持 CSV / Excel（.xlsx .xls .ods）/ TXT，或直接粘贴</div>
      </div>
      <input type="file" id="cbr-file-input-${shopId}" accept=".csv,.txt,.xlsx,.xls,.ods,.xlsm" style="display:none" onchange="handleCBRFileSelect(this,'${shopId}')">
      <div style="color:#64748b;font-size:12px;margin-bottom:6px">或手动粘贴数据：</div>
      <textarea id="cb-refund-import-text-${shopId}" style="width:100%;height:130px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="日期,货号,退货件数,退款金额,退货原因,状态,备注&#10;2026-03-01,ABC-001,2,50.00,质量问题,已退款,工单001"></textarea>
      <div id="cb-refund-import-preview-${shopId}" style="margin-top:8px;font-size:12px;color:#64748b"></div>
      <div class="modal-btns">
        <button class="btn-secondary" onclick="closeModal('modal-cb-refund-import-${shopId}')">取消</button>
        <button class="btn-primary" onclick="importCBRefunds('${shopId}')">导入</button>
      </div>
    </div>
  </div>

  <!-- 录入每日数据弹窗 -->
  <div id="modal-cb-daily" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:440px;width:95%">
      <div class="modal-header">
        <h3 id="cb-daily-modal-title">录入每日数据</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-daily')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="display:grid;gap:12px">
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">日期 *</label>
          <input type="date" id="cb-daily-date" class="input-field"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">访客量</label>
            <input type="number" id="cb-daily-visitors" class="input-field" placeholder="0"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付人数</label>
            <input type="number" id="cb-daily-buyers" class="input-field" placeholder="0"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付件数</label>
            <input type="number" id="cb-daily-qty" class="input-field" placeholder="0"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">支付金额（${currSymbol}）</label>
            <input type="number" id="cb-daily-amount" class="input-field" placeholder="0.00" step="0.01"></div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
          <input type="text" id="cb-daily-remark" class="input-field" placeholder="如：大促 / 广告 / 涨跌原因"></div>
        <input type="hidden" id="cb-daily-edit-id">
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-cb-daily')">取消</button>
          <button class="btn-primary" onclick="saveCBDaily('${shopId}')">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入每日数据弹窗 -->
  <div id="modal-cb-import" class="modal-overlay" style="display:none">
    <div class="modal" style="max-width:600px;width:95%">
      <div class="modal-header">
        <h3>批量导入每日数据</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-import')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#64748b;line-height:1.8">
        <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明</div>
        列顺序：<span style="color:#34d399;font-family:monospace">日期, 访客量, 支付人数, 支付件数, 支付金额</span><br>
        示例：<span style="color:#fbbf24;font-family:monospace">2026-03-01, 1200, 85, 120, 1580.50</span>
        <div style="margin-top:8px">
          <button onclick="downloadTemplateCBDaily()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载每日数据导入模板（CSV）
          </button>
        </div>
      </div>
      <textarea id="cb-import-text" style="width:100%;height:160px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="粘贴数据..."></textarea>
      <div id="cb-import-preview" style="margin-top:10px;font-size:12px;color:#64748b"></div>
      <div class="modal-btns">
        <button class="btn-secondary" onclick="closeModal('modal-cb-import')">取消</button>
        <button class="btn-primary" onclick="importCBDaily('${shopId}')">导入</button>
      </div>
    </div>
  </div>

  <!-- ========= Tab: 差评率 ========= -->
  <div id="cb-tab-reviews-${shopId}" style="display:${activeTab==='reviews'?'block':'none'}">
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">差评率管理</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openAddCBReviewModal('${shopId}')">+ 录入</button>
          <button class="btn-secondary btn-sm" onclick="openImportCBReviewModal('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </button>
          ${reviews.length>0?`
          <button class="btn-secondary btn-sm" onclick="exportCBReviews('${shopId}')">导出全部</button>
          `:''}
        </div>
      </div>

      <!-- 统计卡片 -->
      ${(() => {
        const rateVal = reviewStats.overallRate;
        const latestRate = reviewStats.latestRate;
        const rateColor = rateVal <= 2 ? '#34d399' : rateVal <= 5 ? '#fbbf24' : '#f87171';
        const latestColor = latestRate == null ? '#64748b' : latestRate <= 2 ? '#34d399' : latestRate <= 5 ? '#fbbf24' : '#f87171';
        const rateLabel = rateVal <= 2 ? '优秀' : rateVal <= 5 ? '注意' : '偏高';
        const rateBg = rateVal <= 2 ? 'rgba(52,211,153,0.08)' : rateVal <= 5 ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)';
        return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">
          <div style="background:${rateBg};border:1px solid ${rateColor}33;border-radius:10px;padding:12px 14px;text-align:center">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">综合差评率</div>
            <div style="font-size:22px;font-weight:800;color:${rateColor}">${reviewStats.count>0?rateVal.toFixed(2)+'%':'-'}</div>
            ${reviewStats.count>0?`<div style="font-size:10px;color:${rateColor};margin-top:2px;opacity:.8">${rateLabel}</div>`:''}
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:12px 14px;text-align:center">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">最新差评率</div>
            <div style="font-size:22px;font-weight:800;color:${latestColor}">${latestRate!=null?latestRate.toFixed(2)+'%':'-'}</div>
            ${reviewStats.latest?`<div style="font-size:10px;color:#64748b;margin-top:2px">${reviewStats.latest.date}</div>`:''}
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:12px 14px;text-align:center">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">总评价数</div>
            <div style="font-size:22px;font-weight:800;color:#a78bfa">${reviewStats.totalReviews>0?reviewStats.totalReviews.toLocaleString():'-'}</div>
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:12px 14px;text-align:center">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">差评总数</div>
            <div style="font-size:22px;font-weight:800;color:#f87171">${reviewStats.totalNeg>0?reviewStats.totalNeg.toLocaleString():'-'}</div>
          </div>
          <div style="background:#1e293b;border-radius:10px;padding:12px 14px;text-align:center">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">记录条数</div>
            <div style="font-size:22px;font-weight:800;color:#38bdf8">${reviewStats.count}</div>
          </div>
        </div>`;
      })()}

      <!-- 差评率趋势折线图 -->
      ${reviews.length >= 2 ? (() => {
        const sorted = [...reviews].sort((a,b) => (a.date||'').localeCompare(b.date||''));
        const chartId = 'cb-review-chart-' + shopId;
        const pts = sorted.map(r => ({
          date: r.date,
          rate: r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews/r.total_reviews*100 : 0)
        }));
        const maxRate = Math.max(...pts.map(p => p.rate), 5);
        const W = 600, H = 120, PL = 40, PR = 10, PT = 10, PB = 30;
        const iw = W - PL - PR, ih = H - PT - PB;
        const xStep = pts.length > 1 ? iw / (pts.length - 1) : iw;
        const toX = i => PL + i * xStep;
        const toY = v => PT + ih - (v / maxRate) * ih;
        const polyline = pts.map((p,i) => `${toX(i).toFixed(1)},${toY(p.rate).toFixed(1)}`).join(' ');
        const area = pts.map((p,i) => `${toX(i).toFixed(1)},${toY(p.rate).toFixed(1)}`).join(' ') + ` ${toX(pts.length-1).toFixed(1)},${(PT+ih).toFixed(1)} ${toX(0).toFixed(1)},${(PT+ih).toFixed(1)}`;
        // y轴刻度
        const yTicks = [0, maxRate*0.25, maxRate*0.5, maxRate*0.75, maxRate].map(v => ({v, y: toY(v)}));
        return `
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:#64748b;margin-bottom:8px;font-weight:600">差评率趋势</div>
          <div style="background:#0f172a;border-radius:10px;padding:12px;overflow-x:auto">
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:320px;height:${H}px">
              <!-- 网格 -->
              ${yTicks.map(t => `<line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W-PR}" y2="${t.y.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`).join('')}
              <!-- y轴刻度 -->
              ${yTicks.map(t => `<text x="${PL-4}" y="${(t.y+4).toFixed(1)}" text-anchor="end" font-size="9" fill="#475569">${t.v.toFixed(1)}%</text>`).join('')}
              <!-- 面积 -->
              <polygon points="${area}" fill="rgba(251,191,36,0.08)"/>
              <!-- 折线 -->
              <polyline points="${polyline}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              <!-- 数据点 -->
              ${pts.map((p,i) => `
                <circle cx="${toX(i).toFixed(1)}" cy="${toY(p.rate).toFixed(1)}" r="3.5"
                  fill="${p.rate<=2?'#34d399':p.rate<=5?'#fbbf24':'#f87171'}" stroke="#0f172a" stroke-width="1.5"/>
                <text x="${toX(i).toFixed(1)}" y="${(toY(p.rate)-7).toFixed(1)}" text-anchor="middle" font-size="9" fill="${p.rate<=2?'#34d399':p.rate<=5?'#fbbf24':'#f87171'}">${p.rate.toFixed(1)}%</text>
              `).join('')}
              <!-- x轴日期 -->
              ${pts.map((p,i) => (pts.length <= 10 || i % Math.ceil(pts.length/8) === 0) ? `<text x="${toX(i).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9" fill="#475569">${(p.date||'').slice(5)}</text>` : '').join('')}
              <!-- 2%警戒线 -->
              <line x1="${PL}" y1="${toY(2).toFixed(1)}" x2="${W-PR}" y2="${toY(2).toFixed(1)}" stroke="rgba(52,211,153,0.4)" stroke-width="1" stroke-dasharray="4,3"/>
              <text x="${W-PR+2}" y="${(toY(2)+4).toFixed(1)}" font-size="8" fill="#34d399">2%</text>
              <!-- 5%警戒线 -->
              <line x1="${PL}" y1="${toY(5).toFixed(1)}" x2="${W-PR}" y2="${toY(5).toFixed(1)}" stroke="rgba(251,191,36,0.4)" stroke-width="1" stroke-dasharray="4,3"/>
              <text x="${W-PR+2}" y="${(toY(5)+4).toFixed(1)}" font-size="8" fill="#fbbf24">5%</text>
            </svg>
          </div>
        </div>`;
      })() : ''}

      <!-- 数据表格 -->
      <!-- 筛选栏 -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#0f172a;border-radius:8px;margin-bottom:12px">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">开始日期</label>
        <input type="date" id="rvf-start-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyReviewFilter('${shopId}')">
        <label style="font-size:12px;color:#64748b;white-space:nowrap">结束日期</label>
        <input type="date" id="rvf-end-${shopId}" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px" oninput="applyReviewFilter('${shopId}')">
        <select onchange="applyReviewFilterByMonth('${shopId}',this.value)" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:6px;font-size:12px">
          <option value="">快速选月份</option>
          ${getRecentMonths(6).map(m => `<option value="${m}">${m.replace('-','年')}月</option>`).join('')}
        </select>
        <button onclick="resetReviewFilter('${shopId}')" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:12px;cursor:pointer">重置</button>
      </div>
      <!-- 表格区（数据驱动渲染） -->
      <div id="review-table-area-${shopId}"></div>
    </div>
  </div>

  <!-- ========= 款式差评明细 Sub-Section（在差评率Tab下方独立卡片）========= -->
  <div id="cb-tab-reviews-${shopId}" style="display:${activeTab==='reviews'?'block':'none'}">
  ${(() => {
    const skuReviews = CBSkuReviewDB.getAll(shopId);
    const skuStats = CBSkuReviewDB.getStats(shopId);
    const STATUS_LIST = ['待处理','已回复','已解决'];
    const RATING_LIST = [1,2,3,4,5];
    const statusColor = s => s==='已解决'?'#34d399':s==='已回复'?'#60a5fa':'#f87171';
    const statusBg   = s => s==='已解决'?'rgba(52,211,153,0.12)':s==='已回复'?'rgba(96,165,250,0.12)':'rgba(248,113,113,0.12)';
    const ratingStars = n => '★'.repeat(n||0) + '☆'.repeat(5-(n||0));

    return `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div>
          <div class="card-title" style="margin:0">款式差评明细</div>
          <div style="font-size:11px;color:#64748b;margin-top:3px">按货号记录每条差评内容，追踪问题款式</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openAddSkuReviewModal('${shopId}')">+ 新增差评</button>
          <button class="btn-secondary btn-sm" onclick="openImportSkuReviewModal('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </button>
          ${skuReviews.length>0?`<button class="btn-secondary btn-sm" onclick="exportSkuReviews('${shopId}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出CSV
          </button>`:''}
        </div>
      </div>

      ${skuStats.total > 0 ? `
      <!-- 差评货号排行 Top5 -->
      <div style="margin-bottom:14px;padding:12px;background:#0f172a;border-radius:10px;border:1px solid #1e293b">
        <div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:10px">🔥 差评集中货号 Top 5</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${skuStats.bySku.slice(0,5).map((s,i) => {
            const pct = skuStats.total > 0 ? (s.count/skuStats.total*100) : 0;
            const color = i===0?'#f87171':i===1?'#fb923c':i===2?'#fbbf24':'#94a3b8';
            return `<div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:${color};font-weight:700;width:16px">${i+1}</span>
              <span style="font-size:12px;color:#e2e8f0;font-family:monospace;min-width:80px">${s.sku}</span>
              <div style="flex:1;background:#1e293b;border-radius:4px;height:6px;overflow:hidden">
                <div style="height:100%;background:${color};width:${pct.toFixed(0)}%;border-radius:4px"></div>
              </div>
              <span style="font-size:11px;color:${color};min-width:36px;text-align:right">${s.count}条</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}

      <!-- 搜索+筛选栏 -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
        <input id="skur-search-${shopId}" type="text" placeholder="搜索货号/差评内容…" oninput="filterSkuReviews('${shopId}')"
          style="padding:6px 10px;border-radius:7px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;width:180px"/>
        <select id="skur-status-${shopId}" onchange="filterSkuReviews('${shopId}')"
          style="padding:6px 10px;border-radius:7px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px">
          <option value="">全部状态</option>
          ${STATUS_LIST.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
        <select id="skur-sku-${shopId}" onchange="filterSkuReviews('${shopId}')"
          style="padding:6px 10px;border-radius:7px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px">
          <option value="">全部货号</option>
          ${[...new Set(skuReviews.map(r=>r.sku).filter(Boolean))].sort().map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
        <span id="skur-count-${shopId}" style="font-size:11px;color:#475569;margin-left:4px">${skuReviews.length} 条</span>
      </div>

      ${skuReviews.length === 0 ? `
        <div style="text-align:center;padding:40px 20px;color:#475569">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:.4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style="font-size:13px;margin-bottom:6px">暂无款式差评记录</div>
          <div style="font-size:12px;opacity:.7">点击「新增差评」逐条录入，或「批量导入」上传CSV</div>
        </div>
      ` : `
        <div style="overflow-x:auto">
          <table id="skur-table-${shopId}" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#1e293b">
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155;white-space:nowrap">日期</th>
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155;white-space:nowrap">货号</th>
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">差评内容</th>
                <th style="padding:8px 10px;text-align:center;color:#64748b;font-weight:600;border-bottom:1px solid #334155;white-space:nowrap">评分</th>
                <th style="padding:8px 10px;text-align:center;color:#64748b;font-weight:600;border-bottom:1px solid #334155;white-space:nowrap">状态</th>
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">备注</th>
                <th style="padding:8px 10px;text-align:center;color:#64748b;font-weight:600;border-bottom:1px solid #334155;white-space:nowrap">操作</th>
              </tr>
            </thead>
            <tbody id="skur-tbody-${shopId}">
              ${[...skuReviews].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map((r,idx)=>`
                <tr class="skur-row" data-sku="${(r.sku||'').toLowerCase()}" data-content="${(r.negative_content||'').toLowerCase()}" data-status="${r.status||''}"
                  style="border-bottom:1px solid #1e293b;${idx%2===1?'background:rgba(255,255,255,0.015)':''}">
                  <td style="padding:8px 10px;color:#e2e8f0;white-space:nowrap;font-weight:600">${r.date||'-'}</td>
                  <td style="padding:8px 10px;font-family:monospace;color:#a78bfa;white-space:nowrap">${r.sku||'-'}</td>
                  <td style="padding:8px 10px;color:#e2e8f0;max-width:240px">
                    <div style="line-height:1.5;word-break:break-all">${r.negative_content||'-'}</div>
                    ${r.reviewer?`<div style="font-size:10px;color:#475569;margin-top:2px">买家：${r.reviewer}</div>`:''}
                  </td>
                  <td style="padding:8px 10px;text-align:center;color:#fbbf24;font-size:13px;white-space:nowrap" title="${r.rating?r.rating+'星':''}">${r.rating?ratingStars(r.rating):'-'}</td>
                  <td style="padding:8px 10px;text-align:center">
                    <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${statusBg(r.status||'待处理')};color:${statusColor(r.status||'待处理')}">${r.status||'待处理'}</span>
                  </td>
                  <td style="padding:8px 10px;color:#64748b;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.remark||''}">${r.remark||'-'}</td>
                  <td style="padding:8px 10px;text-align:center;white-space:nowrap">
                    <button class="btn-secondary btn-sm" onclick="openEditSkuReviewModal('${shopId}','${r.id}')" style="margin-right:4px">编辑</button>
                    <button style="padding:3px 8px;border-radius:5px;border:1px solid rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);color:#f87171;font-size:11px;cursor:pointer" onclick="removeSkuReview('${shopId}','${r.id}')">删</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <!-- 款式差评录入/编辑弹窗 -->
    <div id="modal-sku-review-${shopId}" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-sku-review-${shopId}')">
      <div class="modal-box" style="max-width:480px;width:92%">
        <div class="modal-header">
          <h3 id="sku-review-modal-title-${shopId}">新增款式差评</h3>
          <button class="modal-close" onclick="closeModal('modal-sku-review-${shopId}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="display:grid;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">日期 <span style="color:#f87171">*</span></label>
              <input id="skur-date-${shopId}" type="date" class="input-field" style="width:100%;box-sizing:border-box"/>
            </div>
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">货号（SKU）<span style="color:#f87171">*</span></label>
              <input id="skur-sku-inp-${shopId}" type="text" class="input-field" placeholder="如：ABC123" style="width:100%;box-sizing:border-box"
                list="skur-sku-datalist-${shopId}"/>
              <datalist id="skur-sku-datalist-${shopId}">
                ${[...new Set(skuReviews.map(r=>r.sku).filter(Boolean))].sort().map(s=>`<option value="${s}">`).join('')}
              </datalist>
            </div>
          </div>
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">差评内容 <span style="color:#f87171">*</span></label>
            <textarea id="skur-content-${shopId}" class="input-field" rows="3" placeholder="请填写买家的具体差评内容…"
              style="width:100%;box-sizing:border-box;resize:vertical;min-height:80px"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">评分（可选）</label>
              <select id="skur-rating-${shopId}" class="input-field" style="width:100%;box-sizing:border-box">
                <option value="">不填</option>
                ${RATING_LIST.map(n=>`<option value="${n}">${n}星</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">处理状态</label>
              <select id="skur-status-inp-${shopId}" class="input-field" style="width:100%;box-sizing:border-box">
                ${STATUS_LIST.map(s=>`<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">买家ID（可选）</label>
              <input id="skur-reviewer-${shopId}" type="text" class="input-field" placeholder="买家ID/昵称" style="width:100%;box-sizing:border-box"/>
            </div>
          </div>
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
            <input id="skur-remark-${shopId}" type="text" class="input-field" placeholder="如：已联系买家/已改进工艺" style="width:100%;box-sizing:border-box"/>
          </div>
          <input type="hidden" id="skur-edit-id-${shopId}"/>
        </div>
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-sku-review-${shopId}')">取消</button>
          <button class="btn-primary" onclick="saveSkuReview('${shopId}')">保存</button>
        </div>
      </div>
    </div>

    <!-- 款式差评批量导入弹窗 -->
    <div id="modal-sku-review-import-${shopId}" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-sku-review-import-${shopId}')">
      <div class="modal-box" style="max-width:560px;width:92%">
        <div class="modal-header">
          <h3>批量导入款式差评</h3>
          <button class="modal-close" onclick="closeModal('modal-sku-review-import-${shopId}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#64748b;line-height:1.8">
          <div style="color:#f87171;font-weight:600;margin-bottom:6px">📋 格式说明</div>
          列顺序：<span style="color:#34d399;font-family:monospace">日期, 货号, 差评内容, 评分(1-5可选), 买家ID(可选), 状态(可选), 备注(可选)</span><br>
          示例：<span style="color:#fbbf24;font-family:monospace">2026-03-15, ABC123, 质量太差掉色了, 1, buyer001, 待处理</span><br>
          <div style="margin-top:8px">
            <button onclick="downloadSkuReviewTemplate('${shopId}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#f87171;font-size:12px;cursor:pointer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              下载导入模板（CSV）
            </button>
          </div>
        </div>
        <div id="skur-drop-${shopId}" ondragover="event.preventDefault()" ondrop="handleSkuReviewFileDrop(event,'${shopId}')"
          style="border:2px dashed #334155;border-radius:8px;padding:16px;text-align:center;margin-bottom:10px;cursor:pointer"
          onclick="document.getElementById('skur-file-${shopId}').click()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="font-size:12px;color:#64748b">点击或拖拽上传 CSV / TXT 文件</div>
          <input type="file" id="skur-file-${shopId}" accept=".csv,.txt" style="display:none" onchange="handleSkuReviewFileSelect(event,'${shopId}')"/>
        </div>
        <div style="text-align:center;font-size:12px;color:#475569;margin-bottom:8px">— 或粘贴数据 —</div>
        <textarea id="skur-import-text-${shopId}" style="width:100%;height:130px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box"
          placeholder="粘贴数据，每行一条，逗号或Tab分隔..."></textarea>
        <div id="skur-import-preview-${shopId}" style="margin-top:8px;font-size:12px;color:#64748b"></div>
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-sku-review-import-${shopId}')">取消</button>
          <button class="btn-primary" onclick="importSkuReviews('${shopId}')">导入</button>
        </div>
      </div>
    </div>
    `;
  })()}
  </div>

  <!-- 差评率录入/编辑弹窗 -->
  <div id="modal-cb-review-${shopId}" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-cb-review-${shopId}')">
    <div class="modal-box" style="max-width:420px;width:90%">
      <div class="modal-header">
        <h3 id="cb-review-modal-title-${shopId}">录入差评率</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-review-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="display:grid;gap:12px">
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">时间段/日期 <span style="color:#f87171">*</span></label>
          <input id="cb-review-date-${shopId}" type="text" placeholder="如：2026-03 或 2026-03-01" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"/>
          <div style="font-size:11px;color:#475569;margin-top:3px">可填写月份（如2026-03）或具体日期</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">总评价数 <span style="color:#f87171">*</span></label>
            <input id="cb-review-total-${shopId}" type="number" min="0" placeholder="如：1200" oninput="calcCBReviewRate('${shopId}')" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"/>
          </div>
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">差评数 <span style="color:#f87171">*</span></label>
            <input id="cb-review-neg-${shopId}" type="number" min="0" placeholder="如：24" oninput="calcCBReviewRate('${shopId}')" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"/>
          </div>
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">差评率（自动计算）</label>
          <div id="cb-review-rate-preview-${shopId}" style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 12px;font-size:16px;font-weight:700;color:#fbbf24;min-height:34px">-</div>
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
          <input id="cb-review-remark-${shopId}" type="text" placeholder="如：来源SHEIN后台，Q1汇总" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"/>
        </div>
        <input type="hidden" id="cb-review-edit-id-${shopId}"/>
      </div>
      <div class="modal-btns">
        <button class="btn-secondary" onclick="closeModal('modal-cb-review-${shopId}')">取消</button>
        <button class="btn-primary" onclick="saveCBReview('${shopId}')">保存</button>
      </div>
    </div>
  </div>

  <!-- 差评率批量导入弹窗 -->
  <div id="modal-cb-review-import-${shopId}" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-cb-review-import-${shopId}')">
    <div class="modal-box" style="max-width:520px;width:90%">
      <div class="modal-header">
        <h3>批量导入差评率数据</h3>
        <button class="modal-close" onclick="closeModal('modal-cb-review-import-${shopId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#64748b;line-height:1.8">
        <div style="color:#fbbf24;font-weight:600;margin-bottom:6px">📋 格式说明</div>
        列顺序：<span style="color:#34d399;font-family:monospace">时间段, 总评价数, 差评数, 备注(可选)</span><br>
        示例：<span style="color:#fbbf24;font-family:monospace">2026-03, 1200, 24, 来源SHEIN后台</span><br>
        差评率会根据「差评数/总评价数」自动计算
        <div style="margin-top:8px">
          <button onclick="downloadCBReviewTemplate('${shopId}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(251,191,36,0.4);background:rgba(251,191,36,0.08);color:#fbbf24;font-size:12px;cursor:pointer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载差评率导入模板（CSV）
          </button>
        </div>
      </div>
      <!-- 文件拖拽区 -->
      <div id="cb-review-drop-${shopId}" ondragover="event.preventDefault()" ondrop="handleCBReviewFileDrop(event,'${shopId}')"
        style="border:2px dashed #334155;border-radius:8px;padding:16px;text-align:center;margin-bottom:10px;transition:border-color .2s;cursor:pointer"
        onclick="document.getElementById('cb-review-file-${shopId}').click()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div style="font-size:12px;color:#64748b">点击或拖拽上传文件（CSV / Excel / TXT）</div>
        <input type="file" id="cb-review-file-${shopId}" accept=".csv,.xlsx,.xls,.ods,.xlsm,.txt" style="display:none" onchange="handleCBReviewFileSelect(event,'${shopId}')"/>
      </div>
      <div style="text-align:center;font-size:12px;color:#475569;margin-bottom:8px">— 或粘贴数据 —</div>
      <textarea id="cb-review-import-text-${shopId}" style="width:100%;height:140px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="粘贴数据，每行一条，逗号或Tab分隔..."></textarea>
      <div id="cb-review-import-preview-${shopId}" style="margin-top:8px;font-size:12px;color:#64748b"></div>
      <div class="modal-btns">
        <button class="btn-secondary" onclick="closeModal('modal-cb-review-import-${shopId}')">取消</button>
        <button class="btn-primary" onclick="importCBReviews('${shopId}')">导入</button>
      </div>
    </div>
  </div>
  `;
}

// ============================================
//  差评率：操作函数
// ============================================

function openAddCBReviewModal(shopId) {
  if (!checkEditPermission(shopId, null, '录入差评率')) return;
  document.getElementById('cb-review-modal-title-'+shopId).textContent = '录入差评率';
  document.getElementById('cb-review-date-'+shopId).value = new Date().toISOString().slice(0,7); // 默认当月
  document.getElementById('cb-review-total-'+shopId).value = '';
  document.getElementById('cb-review-neg-'+shopId).value = '';
  document.getElementById('cb-review-remark-'+shopId).value = '';
  document.getElementById('cb-review-edit-id-'+shopId).value = '';
  const prev = document.getElementById('cb-review-rate-preview-'+shopId);
  if (prev) { prev.textContent = '-'; prev.style.color = '#fbbf24'; }
  openModal('modal-cb-review-'+shopId);
}

function openEditCBReviewModal(shopId, reviewId) {
  const rec = CBReviewDB.getAll(shopId).find(r => r.id === reviewId);
  if (!rec) return;
  document.getElementById('cb-review-modal-title-'+shopId).textContent = '编辑差评率';
  document.getElementById('cb-review-date-'+shopId).value = rec.date || '';
  document.getElementById('cb-review-total-'+shopId).value = rec.total_reviews || '';
  document.getElementById('cb-review-neg-'+shopId).value = rec.negative_reviews || '';
  document.getElementById('cb-review-remark-'+shopId).value = rec.remark || '';
  document.getElementById('cb-review-edit-id-'+shopId).value = reviewId;
  calcCBReviewRate(shopId);
  openModal('modal-cb-review-'+shopId);
}

// 实时计算差评率预览
function calcCBReviewRate(shopId) {
  const total = parseFloat(document.getElementById('cb-review-total-'+shopId)?.value) || 0;
  const neg = parseFloat(document.getElementById('cb-review-neg-'+shopId)?.value) || 0;
  const prev = document.getElementById('cb-review-rate-preview-'+shopId);
  if (!prev) return;
  if (total > 0) {
    const rate = neg / total * 100;
    const color = rate <= 2 ? '#34d399' : rate <= 5 ? '#fbbf24' : '#f87171';
    prev.textContent = rate.toFixed(2) + '%';
    prev.style.color = color;
  } else {
    prev.textContent = '-';
    prev.style.color = '#fbbf24';
  }
}

function saveCBReview(shopId) {
  const date = document.getElementById('cb-review-date-'+shopId)?.value?.trim();
  if (!date) { showToast('请填写时间段/日期', 'error'); return; }
  const total = parseInt(document.getElementById('cb-review-total-'+shopId)?.value) || 0;
  if (total <= 0) { showToast('请填写总评价数', 'error'); return; }
  const neg = parseInt(document.getElementById('cb-review-neg-'+shopId)?.value) || 0;
  if (neg < 0 || neg > total) { showToast('差评数不能大于总评价数', 'error'); return; }
  const remark = document.getElementById('cb-review-remark-'+shopId)?.value?.trim() || '';
  const editId = document.getElementById('cb-review-edit-id-'+shopId)?.value;
  const rate = total > 0 ? neg / total * 100 : 0;
  const record = {
    id: editId || ('rv_' + Date.now()),
    date, total_reviews: total, negative_reviews: neg,
    negative_rate: parseFloat(rate.toFixed(4)),
    remark,
    created_at: editId ? undefined : new Date().toISOString()
  };
  if (!editId) record.created_at = new Date().toISOString();
  CBReviewDB.upsert(shopId, record);
  closeModal('modal-cb-review-'+shopId);
  showToast('差评率数据已保存', 'success');
  window['_cbTab_'+shopId] = 'reviews';
  renderReviewTable(shopId);
}

function removeCBReview(shopId, reviewId) {
  if (!checkEditPermission(shopId, null, '删除差评率记录')) return;
  if (!confirm('确认删除该条差评率记录？')) return;
  CBReviewDB.remove(shopId, reviewId);
  showToast('已删除', 'info');
  if (_reviewSel[shopId]) _reviewSel[shopId].delete(reviewId);
  renderReviewTable(shopId);
}

function openImportCBReviewModal(shopId) {
  const ta = document.getElementById('cb-review-import-text-'+shopId);
  if (ta) ta.value = '';
  const prev = document.getElementById('cb-review-import-preview-'+shopId);
  if (prev) prev.textContent = '';
  openModal('modal-cb-review-import-'+shopId);
}

function importCBReviews(shopId) {
  const ta = document.getElementById('cb-review-import-text-'+shopId);
  const raw = ta ? ta.value.trim() : '';
  if (!raw) { showToast('请粘贴或上传数据', 'error'); return; }
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !/^(时间段|日期|date)/i.test(l));
  let errors = 0;
  const newRows = [];
  lines.forEach((line, i) => {
    const cols = line.split(/[,\t，]/).map(c => c.trim());
    const dateRaw = cols[0]; if (!dateRaw) { errors++; return; }
    const date = normalizeDate(dateRaw) || dateRaw; // 尝试标准化，失败则用原值
    const total = parseInt(cols[1]); if (isNaN(total) || total <= 0) { errors++; return; }
    const neg = parseInt(cols[2]); if (isNaN(neg) || neg < 0) { errors++; return; }
    const remark = cols[3] || '';
    const rate = total > 0 ? neg / total * 100 : 0;
    newRows.push({
      id: 'rv_' + Date.now() + '_' + i,
      date, total_reviews: total, negative_reviews: neg,
      negative_rate: parseFloat(rate.toFixed(4)),
      remark, created_at: new Date().toISOString()
    });
  });
  const count = newRows.length;
  if (count === 0) {
    showToast(`❌ 未解析到有效差评率数据（${errors}条格式错误），请检查格式：时间段,总评价数,差评数`, 'error');
    return;
  }
  CBReviewDB.batchUpsert(shopId, newRows); // 批量本地+云端
  closeModal('modal-cb-review-import-'+shopId);
  showToast(`✅ 已导入 ${count} 条差评率数据${errors>0?' ('+errors+' 条格式错误已跳过)':''}`, 'success');
  window['_cbTab_'+shopId] = 'reviews';
  renderReviewTable(shopId);
}

function handleCBReviewFileDrop(e, shopId) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.name.match(/\.(csv|txt|xlsx|xls|ods|xlsm)$/i)) { showToast('请上传 CSV/Excel 文件', 'error'); return; }
  readFileAsCSVText(file).then(text => {
    const ta = document.getElementById('cb-review-import-text-'+shopId);
    if (ta) { ta.value = text; }
    const prev = document.getElementById('cb-review-import-preview-'+shopId);
    if (prev) prev.textContent = `📄 已读取：${file.name}`;
  }).catch(err => showToast('文件读取失败：' + err.message, 'error'));
}

function handleCBReviewFileSelect(e, shopId) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if (!file.name.match(/\.(csv|txt|xlsx|xls|ods|xlsm)$/i)) { showToast('请上传 CSV/Excel 文件', 'error'); return; }
  readFileAsCSVText(file).then(text => {
    const ta = document.getElementById('cb-review-import-text-'+shopId);
    if (ta) { ta.value = text; }
    const prev = document.getElementById('cb-review-import-preview-'+shopId);
    if (prev) prev.textContent = `📄 已读取：${file.name}`;
  }).catch(err => showToast('文件读取失败：' + err.message, 'error'));
}

function downloadCBReviewTemplate(shopId) {
  const BOM = '\uFEFF';
  const header = '时间段,总评价数,差评数,备注\n';
  const sample = '2026-03,1200,24,来源SHEIN后台\n2026-02,980,18,\n';
  const blob = new Blob([BOM + header + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = '差评率导入模板.csv';
  a.click(); URL.revokeObjectURL(url);
}

function exportCBReviews(shopId, selectedOnly) {
  let reviews = CBReviewDB.getAll(shopId);
  if (selectedOnly) {
    const sel = _reviewSel[shopId];
    if (!sel || sel.size === 0) { showToast('请先选择要导出的记录', 'info'); return; }
    reviews = reviews.filter(r => sel.has(r.id));
  }
  if (!reviews.length) { showToast('暂无数据', 'error'); return; }
  const BOM = '\uFEFF';
  const header = '时间段,总评价数,差评数,差评率(%),备注\n';
  const rows = [...reviews].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r => {
    const rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews>0?r.negative_reviews/r.total_reviews*100:0);
    return [r.date, r.total_reviews, r.negative_reviews, rate.toFixed(2), r.remark||''].join(',');
  }).join('\n');
  const suffix = selectedOnly ? '_选中' : '';
  const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `差评率${suffix}_${shopId}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ============================================================
//  款式差评明细：操作函数
// ============================================================

function openAddSkuReviewModal(shopId) {
  document.getElementById('sku-review-modal-title-'+shopId).textContent = '新增款式差评';
  document.getElementById('skur-date-'+shopId).value = new Date().toISOString().slice(0,10);
  document.getElementById('skur-sku-inp-'+shopId).value = '';
  document.getElementById('skur-content-'+shopId).value = '';
  document.getElementById('skur-rating-'+shopId).value = '';
  document.getElementById('skur-status-inp-'+shopId).value = '待处理';
  document.getElementById('skur-reviewer-'+shopId).value = '';
  document.getElementById('skur-remark-'+shopId).value = '';
  document.getElementById('skur-edit-id-'+shopId).value = '';
  openModal('modal-sku-review-'+shopId);
}

function openEditSkuReviewModal(shopId, reviewId) {
  const rec = CBSkuReviewDB.getAll(shopId).find(r => r.id === reviewId);
  if (!rec) return;
  document.getElementById('sku-review-modal-title-'+shopId).textContent = '编辑款式差评';
  document.getElementById('skur-date-'+shopId).value = rec.date || '';
  document.getElementById('skur-sku-inp-'+shopId).value = rec.sku || '';
  document.getElementById('skur-content-'+shopId).value = rec.negative_content || '';
  document.getElementById('skur-rating-'+shopId).value = rec.rating || '';
  document.getElementById('skur-status-inp-'+shopId).value = rec.status || '待处理';
  document.getElementById('skur-reviewer-'+shopId).value = rec.reviewer || '';
  document.getElementById('skur-remark-'+shopId).value = rec.remark || '';
  document.getElementById('skur-edit-id-'+shopId).value = reviewId;
  openModal('modal-sku-review-'+shopId);
}

function saveSkuReview(shopId) {
  const date = document.getElementById('skur-date-'+shopId).value;
  if (!date) { showToast('请选择日期', 'error'); return; }
  const sku = document.getElementById('skur-sku-inp-'+shopId).value.trim();
  if (!sku) { showToast('请填写货号', 'error'); return; }
  const content = document.getElementById('skur-content-'+shopId).value.trim();
  if (!content) { showToast('请填写差评内容', 'error'); return; }
  const editId = document.getElementById('skur-edit-id-'+shopId).value;
  const row = {
    id: editId || ('skur_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)),
    date,
    sku,
    negative_content: content,
    rating: parseInt(document.getElementById('skur-rating-'+shopId).value) || null,
    status: document.getElementById('skur-status-inp-'+shopId).value || '待处理',
    reviewer: document.getElementById('skur-reviewer-'+shopId).value.trim() || '',
    remark: document.getElementById('skur-remark-'+shopId).value.trim() || '',
  };
  if (editId) CBSkuReviewDB.update(shopId, row);
  else CBSkuReviewDB.add(shopId, row);
  closeModal('modal-sku-review-'+shopId);
  showToast(editId ? '已更新差评记录' : '已添加差评记录', 'success');
  refreshCBArea(shopId);
}

function removeSkuReview(shopId, reviewId) {
  if (!confirm('确定删除这条差评记录？')) return;
  CBSkuReviewDB.remove(shopId, reviewId);
  showToast('已删除', 'info');
  refreshCBArea(shopId);
}

// 客户端实时筛选款式差评（不重渲染HTML，直接控制行显示）
function filterSkuReviews(shopId) {
  const search = (document.getElementById('skur-search-'+shopId)?.value || '').toLowerCase().trim();
  const statusF = document.getElementById('skur-status-'+shopId)?.value || '';
  const skuF   = document.getElementById('skur-sku-'+shopId)?.value || '';
  const rows = document.querySelectorAll('#skur-tbody-'+shopId+' tr.skur-row');
  let visible = 0;
  rows.forEach(tr => {
    const sku     = tr.getAttribute('data-sku') || '';
    const content = tr.getAttribute('data-content') || '';
    const status  = tr.getAttribute('data-status') || '';
    const show = (!search || sku.includes(search) || content.includes(search))
              && (!statusF || status === statusF)
              && (!skuF   || sku === skuF.toLowerCase());
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const cnt = document.getElementById('skur-count-'+shopId);
  if (cnt) cnt.textContent = `${visible} / ${rows.length} 条`;
}

// 批量导入
function openImportSkuReviewModal(shopId) {
  const ta = document.getElementById('skur-import-text-'+shopId);
  if (ta) ta.value = '';
  const prev = document.getElementById('skur-import-preview-'+shopId);
  if (prev) prev.textContent = '';
  openModal('modal-sku-review-import-'+shopId);
}

function importSkuReviews(shopId) {
  const ta = document.getElementById('skur-import-text-'+shopId);
  const raw = ta ? ta.value.trim() : '';
  if (!raw) { showToast('请粘贴或上传数据', 'error'); return; }
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !/^(日期|date|sku|货号)/i.test(l));
  let errors = 0;
  const ts = Date.now();
  const newRows = lines.map((line, idx) => {
    const parts = line.split(/[,\t]/).map(s => s.trim().replace(/^"|"$/g,''));
    if (parts.length < 3) { errors++; return null; }
    const date = normalizeDate(parts[0]);
    if (!date) { errors++; return null; }
    const sku = parts[1] || '';
    if (!sku) { errors++; return null; }
    const content = parts[2] || '';
    if (!content) { errors++; return null; }
    const rating = parseInt(parts[3]) || null;
    const reviewer = parts[4] || '';
    const status = parts[5] && ['待处理','已回复','已解决'].includes(parts[5].trim()) ? parts[5].trim() : '待处理';
    const remark = parts[6] || '';
    return { id: 'skur_' + ts + '_' + idx, date, sku, negative_content: content, rating, reviewer, status, remark };
  }).filter(Boolean);

  const prev = document.getElementById('skur-import-preview-'+shopId);
  if (newRows.length === 0) {
    if (prev) prev.textContent = `❌ 没有有效数据，${errors} 条格式错误（需至少：日期,货号,差评内容）`;
    return;
  }
  CBSkuReviewDB.batchAdd(shopId, newRows);
  if (prev) prev.textContent = `✅ 成功导入 ${newRows.length} 条${errors>0?`，${errors} 条跳过`:''}`;
  closeModal('modal-sku-review-import-'+shopId);
  showToast(`✅ 已导入 ${newRows.length} 条款式差评`, 'success');
  refreshCBArea(shopId);
}

function handleSkuReviewFileDrop(e, shopId) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  _readSkuReviewFile(file, shopId);
}

function handleSkuReviewFileSelect(e, shopId) {
  const file = e.target.files[0];
  if (!file) return;
  _readSkuReviewFile(file, shopId);
}

function _readSkuReviewFile(file, shopId) {
  const reader = new FileReader();
  reader.onload = ev => {
    const ta = document.getElementById('skur-import-text-'+shopId);
    if (ta) ta.value = ev.target.result;
    const prev = document.getElementById('skur-import-preview-'+shopId);
    if (prev) prev.textContent = `📄 已读取：${file.name}`;
  };
  reader.onerror = () => showToast('文件读取失败', 'error');
  reader.readAsText(file, 'utf-8');
}

function downloadSkuReviewTemplate(shopId) {
  const BOM = '\uFEFF';
  const header = '日期,货号,差评内容,评分(1-5),买家ID,状态,备注\n';
  const sample = [
    '2026-03-15,ABC123,面料太薄不值这个价,2,buyer001,待处理,已联系工厂确认',
    '2026-03-18,DEF456,尺码偏小穿不下,1,buyer002,已回复,建议买大一码',
    '2026-03-20,ABC123,颜色和图片差别很大,2,,待处理,',
  ].join('\n');
  const blob = new Blob([BOM + header + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = '款式差评导入模板.csv';
  a.click(); URL.revokeObjectURL(url);
}

function exportSkuReviews(shopId) {
  const reviews = CBSkuReviewDB.getAll(shopId);
  if (!reviews.length) { showToast('暂无差评数据', 'error'); return; }
  const BOM = '\uFEFF';
  const header = '日期,货号,差评内容,评分,买家ID,状态,备注\n';
  const rows = [...reviews].sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(r =>
    [r.date, r.sku, `"${(r.negative_content||'').replace(/"/g,'""')}"`, r.rating||'', r.reviewer||'', r.status||'', r.remark||''].join(',')
  ).join('\n');
  const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `款式差评_${shopId}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// Tab 切换
function setCBTab(shopId, tab) {
  window['_cbTab_'+shopId] = tab;
  refreshCBArea(shopId);
}

// 统一刷新跨境区域（渲染HTML + 初始化所有Tab数据）
function refreshCBArea(shopId) {
  const area = document.getElementById('domestic-detail-area');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!area || !shop) return;
  area.innerHTML = renderCrossBorderDetail(shop);
  // 初始化订单分页（渲染第一页）
  setTimeout(() => {
    initOrderPager(shopId);
    renderRefundTable(shopId);
    renderDailyTable(shopId);
    renderReviewTable(shopId);
  }, 0);
}

// 快捷选月份（每日数据）
function applyDailyFilterByMonth(shopId, month) {
  if (!month) return;
  const startDate = month + '-01';
  const endDate = month + '-31';
  if (!_dailyFilter[shopId]) _dailyFilter[shopId] = {};
  _dailyFilter[shopId].startDate = startDate;
  _dailyFilter[shopId].endDate = endDate;
  const s = document.getElementById('df-start-'+shopId);
  const e = document.getElementById('df-end-'+shopId);
  if (s) s.value = startDate;
  if (e) e.value = endDate;
  _dailySel[shopId] = new Set();
  renderDailyTable(shopId);
}
// 快捷选月份（差评率）
function applyReviewFilterByMonth(shopId, month) {
  if (!month) return;
  const startDate = month + '-01';
  const endDate = month + '-31';
  if (!_reviewFilter[shopId]) _reviewFilter[shopId] = {};
  _reviewFilter[shopId].startDate = startDate;
  _reviewFilter[shopId].endDate = endDate;
  const s = document.getElementById('rvf-start-'+shopId);
  const e = document.getElementById('rvf-end-'+shopId);
  if (s) s.value = startDate;
  if (e) e.value = endDate;
  _reviewSel[shopId] = new Set();
  renderReviewTable(shopId);
}


// ============================================
//  退货退款：操作函数
// ============================================

function openAddCBRefundModal(shopId) {
  if (!checkEditPermission(shopId, null, '录入退货退款')) return;
  const pfx = 'cb-refund-';
  const el = id => document.getElementById(pfx+id+'-'+shopId);
  document.getElementById('cb-refund-modal-title-'+shopId).textContent = '录入退货退款';
  el('date').value = new Date().toISOString().slice(0,10);
  ['sku','qty','amount','remark'].forEach(k => { const e = el(k); if(e) e.value=''; });
  el('edit-id').value = '';
  // 重置原因选择
  const reasonEl = el('reason'); if(reasonEl) reasonEl.value = '';
  // 重置状态为"处理中"
  const radios = document.querySelectorAll(`[name="cb-refund-status-${shopId}"]`);
  radios.forEach(r => { r.checked = r.value === '处理中'; });
  openModal('modal-cb-refund-'+shopId);
}

function openEditCBRefundModal(shopId, refundId) {
  if (!checkEditPermission(shopId, null, '编辑退货退款记录')) return;
  const rec = CBRefundDB.getAll(shopId).find(r => r.id === refundId);
  if (!rec) return;
  const pfx = 'cb-refund-';
  const el = id => document.getElementById(pfx+id+'-'+shopId);
  document.getElementById('cb-refund-modal-title-'+shopId).textContent = '编辑退货退款';
  el('date').value = rec.date || '';
  el('sku').value = rec.sku || '';
  el('qty').value = rec.qty || '';
  el('amount').value = rec.refund_amount || '';
  el('reason').value = rec.reason || '';
  el('remark').value = rec.remark || '';
  el('edit-id').value = rec.id;
  const radios = document.querySelectorAll(`[name="cb-refund-status-${shopId}"]`);
  radios.forEach(r => { r.checked = r.value === (rec.status||'处理中'); });
  openModal('modal-cb-refund-'+shopId);
}

function saveCBRefund(shopId) {
  const pfx = 'cb-refund-';
  const el = id => document.getElementById(pfx+id+'-'+shopId);
  const date = el('date')?.value?.trim();
  if (!date) { showToast('请填写退货日期', 'error'); return; }
  const amountVal = parseFloat(el('amount')?.value) || 0;
  if (amountVal <= 0) { showToast('请填写退款金额', 'error'); return; }
  const statusRadio = document.querySelector(`[name="cb-refund-status-${shopId}"]:checked`);
  const editId = el('edit-id')?.value?.trim();
  const data = {
    date,
    sku: el('sku')?.value?.trim() || '',
    qty: parseInt(el('qty')?.value) || 0,
    refund_amount: amountVal,
    reason: el('reason')?.value || '',
    status: statusRadio ? statusRadio.value : '处理中',
    remark: el('remark')?.value?.trim() || '',
  };
  if (editId) {
    CBRefundDB.update(shopId, editId, data);
  } else {
    data.id = 'cbr_' + Date.now();
    CBRefundDB.add(shopId, data);
  }
  closeModal('modal-cb-refund-'+shopId);
  showToast('退货记录已保存', 'success');
  window['_cbTab_'+shopId] = 'refunds';
  renderRefundTable(shopId);
}

function removeCBRefund(shopId, refundId) {
  if (!checkEditPermission(shopId, null, '删除退货记录')) return;
  if (!confirm('确定删除该退货记录？')) return;
  CBRefundDB.remove(shopId, refundId);
  showToast('已删除', 'info');
  if (_refundSel[shopId]) _refundSel[shopId].delete(refundId);
  renderRefundTable(shopId);
  // 刷新统计卡片
  const statsArea = document.getElementById('refund-stats-'+shopId);
  if (!statsArea) refreshCBArea(shopId);
}

function openImportCBRefundModal(shopId) {
  const ta = document.getElementById('cb-refund-import-text-'+shopId);
  if (ta) ta.value = '';
  const prev = document.getElementById('cb-refund-import-preview-'+shopId);
  if (prev) prev.textContent = '';
  openModal('modal-cb-refund-import-'+shopId);
}

function importCBRefunds(shopId) {
  const ta = document.getElementById('cb-refund-import-text-'+shopId);
  if (!ta || !ta.value.trim()) { showToast('请粘贴或上传退货数据', 'error'); return; }
  const lines = ta.value.trim().split('\n');
  let errors = 0, skipped = 0;
  const newRows = [];
  lines.forEach((line, idx) => {
    const parts = line.split(',').map(s => s.trim());
    if (idx === 0 && isNaN(parseFloat(parts[3]))) { skipped++; return; } // 跳过标题行
    if (parts.length < 2) { errors++; return; }
    const date = normalizeDate(parts[0]);
    if (!date) { errors++; return; }
    const amount = parseFloat(parts[3]) || 0;
    newRows.push({
      id: 'cbr_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      date,
      sku: parts[1] || '',
      qty: parseInt(parts[2]) || 0,
      refund_amount: amount,
      reason: parts[4] || '',
      status: parts[5] || '处理中',
      remark: parts[6] || '',
    });
  });
  const count = newRows.length;
  if (count === 0) {
    showToast(`❌ 未解析到有效退货数据（${errors}条格式错误），请检查格式：日期,货号,退货件数,退款金额,退货原因,...`, 'error');
    return;
  }
  CBRefundDB.batchAdd(shopId, newRows); // 批量本地+云端
  closeModal('modal-cb-refund-import-'+shopId);
  showToast(`✅ 已导入 ${count} 条退货记录${errors>0?' ('+errors+' 条格式错误已跳过)':''}`, 'success');
  window['_cbTab_'+shopId] = 'refunds';
  renderRefundTable(shopId);
}

function handleCBRFileDrop(e, shopId) {
  e.preventDefault();
  const dropEl = document.getElementById('cbr-file-drop-'+shopId);
  if (dropEl) dropEl.style.borderColor = '#334155';
  const file = e.dataTransfer.files[0];
  if (file) readCBRFile(file, shopId);
}

function handleCBRFileSelect(input, shopId) {
  const file = input.files[0];
  if (file) readCBRFile(file, shopId);
  input.value = '';
}

function readCBRFile(file, shopId) {
  if (!file.name.match(/\.(csv|txt|xlsx|xls|ods|xlsm)$/i)) { showToast('请上传 CSV/Excel 文件', 'error'); return; }
  readFileAsCSVText(file).then(text => {
    const ta = document.getElementById('cb-refund-import-text-'+shopId);
    if (ta) ta.value = text;
    showToast(`已读取"${file.name}"，点击"导入"开始处理`, 'success');
  }).catch(err => showToast('文件读取失败：' + err.message, 'error'));
}

function downloadCBRefundTemplate() {
  const csv = '日期,货号(SKU),退货件数,退款金额,退货原因,状态,备注\n2026-03-01,ABC-001,2,50.00,质量问题,已退款,平台工单001\n2026-03-02,ABC-002,1,25.00,尺码不符,处理中,\n';
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '退货退款导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
}

function exportCBRefunds(shopId, selectedOnly) {
  let refunds = CBRefundDB.getAll(shopId);
  if (!refunds.length) { showToast('暂无退货数据', 'info'); return; }
  if (selectedOnly) {
    const sel = _refundSel[shopId];
    if (!sel || sel.size === 0) { showToast('请先选择要导出的记录', 'info'); return; }
    refunds = refunds.filter(r => sel.has(r.id));
  }
  const header = '日期,货号,退货件数,退款金额,退货原因,状态,备注';
  const rows = refunds.map(r => [r.date, r.sku||'', r.qty||0, r.refund_amount||0, r.reason||'', r.status||'', r.remark||''].join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const shop = DB.getShops().find(s => s.id === shopId);
  const suffix = selectedOnly ? `_选中${refunds.length}条` : '';
  a.download = `${shop?.name||'店铺'}_退货退款${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast(`✅ 已导出 ${refunds.length} 条退货记录`, 'success');
}

function setCBFilter(shopId, month) {
  window._cbFilterMonth = month;
  refreshCBArea(shopId);
}

// ============================================================
//  退货退款 / 每日数据 / 差评率  筛选+分页状态（per shopId）
// ============================================================
const _refundFilter  = {}; // { startDate, endDate, sku, status }
const _refundSel     = {}; // Set<id>
const _dailyFilter   = {}; // { startDate, endDate }
const _dailySel      = {}; // Set<id>
const _reviewFilter  = {}; // { startDate, endDate }
const _reviewSel     = {}; // Set<id>

// ---------- 退货退款筛选 ----------
function applyRefundFilter(shopId) {
  const f = _refundFilter[shopId] || {};
  const startDate = (document.getElementById('rf-start-'+shopId)||{}).value || f.startDate || '';
  const endDate   = (document.getElementById('rf-end-'+shopId)||{}).value   || f.endDate   || '';
  const sku       = ((document.getElementById('rf-sku-'+shopId)||{}).value || f.sku || '').trim().toLowerCase();
  const status    = (document.getElementById('rf-status-'+shopId)||{}).value || f.status || '';
  _refundFilter[shopId] = { startDate, endDate, sku, status };
  _refundSel[shopId] = new Set();
  renderRefundTable(shopId);
}
function _getFilteredRefunds(shopId) {
  const f = _refundFilter[shopId] || {};
  let data = CBRefundDB.getAll(shopId);
  if (f.startDate) data = data.filter(r => (r.date||'') >= f.startDate);
  if (f.endDate)   data = data.filter(r => (r.date||'') <= f.endDate);
  if (f.sku)       data = data.filter(r => (r.sku||'').toLowerCase().includes(f.sku));
  if (f.status)    data = data.filter(r => (r.status||'') === f.status);
  return data;
}
function renderRefundTable(shopId) {
  const container = document.getElementById('refund-table-area-'+shopId);
  if (!container) return;
  const shop = DB.getShops().find(s=>s.id===shopId) || {};
  const currency = getPlatformCurrency(shop.platform);
  const currSymbol = currency==='USD'?'$':'¥';
  const data = _getFilteredRefunds(shopId);
  const sel = _refundSel[shopId] || new Set();
  const allChecked = data.length > 0 && data.every(r => sel.has(r.id));

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#475569;padding:32px 0;font-size:13px">
      <div style="font-size:32px;margin-bottom:8px">↩️</div>
      <div>${Object.values(_refundFilter[shopId]||{}).some(v=>v) ? '没有符合筛选条件的记录' : '暂无退货退款记录'}</div>
      <div style="font-size:12px;margin-top:6px;color:#334155">点击"录入退货"手动添加，或"批量导入"上传 CSV 文件</div>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:#94a3b8">
        <input type="checkbox" id="refund-chk-all-${shopId}" ${allChecked?'checked':''} onchange="toggleRefundSelectAll('${shopId}',this.checked)"
          style="accent-color:#7c3aed;width:14px;height:14px"> 全选当页
      </label>
      <span style="font-size:11px;color:#475569">已选 <b id="refund-sel-count-${shopId}" style="color:#a78bfa">${sel.size}</b> 条</span>
      ${sel.size>0 ? `<button onclick="batchDeleteRefunds('${shopId}')" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#f87171;font-size:12px;cursor:pointer">🗑 批量删除(${sel.size})</button>` : ''}
      <span style="font-size:11px;color:#64748b;margin-left:auto">共 ${data.length} 条</span>
      ${sel.size>0
        ? `<button onclick="exportCBRefunds('${shopId}',true)" style="padding:3px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.10);color:#34d399;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出选中(${sel.size})</button>`
        : `<button onclick="exportCBRefunds('${shopId}')" style="padding:3px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.10);color:#34d399;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出全部</button>`}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="width:32px"></th>
          <th>日期</th><th>货号</th><th>退货件数</th>
          <th>退款金额(${currSymbol})</th><th>退货原因</th>
          <th>状态</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${data.map(r => {
            const statusColor = r.status==='已退款'?'#34d399':r.status==='已拒绝'?'#f87171':'#fbbf24';
            return `<tr>
              <td><input type="checkbox" ${sel.has(r.id)?'checked':''} onchange="toggleRefundSelect('${shopId}','${r.id}',this.checked)" style="accent-color:#7c3aed;width:14px;height:14px"></td>
              <td style="white-space:nowrap;font-weight:600">${r.date||'-'}</td>
              <td style="font-family:monospace;color:#a78bfa">${r.sku||'-'}</td>
              <td style="color:#fb923c">${r.qty||0} 件</td>
              <td style="color:#f87171;font-weight:700">${(r.refund_amount||0).toFixed(2)}</td>
              <td style="font-size:12px;color:#94a3b8">${r.reason||'-'}</td>
              <td><span style="display:inline-block;background:${statusColor}22;color:${statusColor};border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600">${r.status||'处理中'}</span></td>
              <td style="max-width:100px;font-size:11px;color:#94a3b8">${r.remark?`<span title="${r.remark}">${r.remark.length>12?r.remark.slice(0,12)+'…':r.remark}</span>`:'-'}</td>
              <td>
                <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer" onclick="openEditCBRefundModal('${shopId}','${r.id}')">编辑</button>
                <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeCBRefund('${shopId}','${r.id}')">删</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}
function toggleRefundSelect(shopId, id, checked) {
  if (!_refundSel[shopId]) _refundSel[shopId] = new Set();
  if (checked) _refundSel[shopId].add(id); else _refundSel[shopId].delete(id);
  renderRefundTable(shopId);
}
function toggleRefundSelectAll(shopId, checked) {
  const data = _getFilteredRefunds(shopId);
  _refundSel[shopId] = new Set(checked ? data.map(r=>r.id) : []);
  renderRefundTable(shopId);
}
function batchDeleteRefunds(shopId) {
  if (!checkEditPermission(shopId, null, '批量删除退货记录')) return;
  const sel = _refundSel[shopId];
  if (!sel || sel.size === 0) return;
  if (!confirm(`确定批量删除选中的 ${sel.size} 条退货记录？`)) return;
  sel.forEach(id => CBRefundDB.remove(shopId, id));
  _refundSel[shopId] = new Set();
  refreshCBArea(shopId);
  showToast(`已删除 ${sel.size} 条`, 'info');
}
function resetRefundFilter(shopId) {
  _refundFilter[shopId] = {};
  _refundSel[shopId] = new Set();
  ['rf-start-'+shopId,'rf-end-'+shopId,'rf-sku-'+shopId,'rf-status-'+shopId].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderRefundTable(shopId);
}

// ---------- 每日数据筛选 ----------
function applyDailyFilter(shopId) {
  const f = _dailyFilter[shopId] || {};
  const startDate = (document.getElementById('df-start-'+shopId)||{}).value || f.startDate || '';
  const endDate   = (document.getElementById('df-end-'+shopId)||{}).value   || f.endDate   || '';
  _dailyFilter[shopId] = { startDate, endDate };
  _dailySel[shopId] = new Set();
  renderDailyTable(shopId);
}
function _getFilteredDaily(shopId) {
  const f = _dailyFilter[shopId] || {};
  let data = CrossBorderDailyDB.getAll(shopId);
  if (f.startDate) data = data.filter(r => (r.date||'') >= f.startDate);
  if (f.endDate)   data = data.filter(r => (r.date||'') <= f.endDate);
  return data;
}
function renderDailyTable(shopId) {
  const container = document.getElementById('daily-table-area-'+shopId);
  if (!container) return;
  const shop = DB.getShops().find(s=>s.id===shopId) || {};
  const currency = getPlatformCurrency(shop.platform);
  const currSymbol = currency==='USD'?'$':'¥';
  const data = _getFilteredDaily(shopId);
  const sel = _dailySel[shopId] || new Set();
  const allChecked = data.length > 0 && data.every(r => sel.has(r.id));

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#475569;padding:32px 0">
      <div style="font-size:32px;margin-bottom:8px">📅</div>
      <div>${Object.values(_dailyFilter[shopId]||{}).some(v=>v) ? '没有符合筛选条件的记录' : '暂无数据，点击"录入"或"批量导入"'}</div>
    </div>`;
    return;
  }
  const fmt = n => n >= 10000 ? (n/10000).toFixed(1)+'w' : n.toLocaleString();
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:#94a3b8">
        <input type="checkbox" ${allChecked?'checked':''} onchange="toggleDailySelectAll('${shopId}',this.checked)"
          style="accent-color:#7c3aed;width:14px;height:14px"> 全选当页
      </label>
      <span style="font-size:11px;color:#475569">已选 <b style="color:#a78bfa">${sel.size}</b> 条</span>
      ${sel.size>0 ? `<button onclick="batchDeleteDaily('${shopId}')" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#f87171;font-size:12px;cursor:pointer">🗑 批量删除(${sel.size})</button>` : ''}
      <span style="font-size:11px;color:#64748b;margin-left:auto">共 ${data.length} 条</span>
      ${sel.size>0
        ? `<button onclick="exportCBDaily('${shopId}',true)" style="padding:3px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.10);color:#34d399;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出选中(${sel.size})</button>`
        : `<button onclick="exportCBDaily('${shopId}')" style="padding:3px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.10);color:#34d399;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出全部</button>`}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="width:32px"></th>
          <th>日期</th><th>访客量</th><th>支付人数</th><th>支付件数</th><th>支付金额</th><th>转化率</th><th>客均价</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${data.map(r => {
            const conv = r.visitors > 0 ? (r.buyers/r.visitors*100).toFixed(2)+'%' : '-';
            const avgP = r.buyers > 0 ? currSymbol+(r.amount/r.buyers).toFixed(2) : '-';
            return `<tr>
              <td><input type="checkbox" ${sel.has(r.id)?'checked':''} onchange="toggleDailySelect('${shopId}','${r.id}',this.checked)" style="accent-color:#7c3aed;width:14px;height:14px"></td>
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
    </div>`;
}
function toggleDailySelect(shopId, id, checked) {
  if (!_dailySel[shopId]) _dailySel[shopId] = new Set();
  if (checked) _dailySel[shopId].add(id); else _dailySel[shopId].delete(id);
  renderDailyTable(shopId);
}
function toggleDailySelectAll(shopId, checked) {
  const data = _getFilteredDaily(shopId);
  _dailySel[shopId] = new Set(checked ? data.map(r=>r.id) : []);
  renderDailyTable(shopId);
}
function batchDeleteDaily(shopId) {
  if (!checkEditPermission(shopId, null, '批量删除每日数据')) return;
  const sel = _dailySel[shopId];
  if (!sel || sel.size === 0) return;
  if (!confirm(`确定批量删除选中的 ${sel.size} 条每日数据？`)) return;
  sel.forEach(id => CrossBorderDailyDB.remove(shopId, id));
  _dailySel[shopId] = new Set();
  refreshCBArea(shopId);
  showToast(`已删除 ${sel.size} 条`, 'info');
}
function resetDailyFilter(shopId) {
  _dailyFilter[shopId] = {};
  _dailySel[shopId] = new Set();
  ['df-start-'+shopId,'df-end-'+shopId].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderDailyTable(shopId);
}

// ---------- 差评率筛选 ----------
function applyReviewFilter(shopId) {
  const f = _reviewFilter[shopId] || {};
  const startDate = (document.getElementById('rvf-start-'+shopId)||{}).value || f.startDate || '';
  const endDate   = (document.getElementById('rvf-end-'+shopId)||{}).value   || f.endDate   || '';
  _reviewFilter[shopId] = { startDate, endDate };
  _reviewSel[shopId] = new Set();
  renderReviewTable(shopId);
}
function _getFilteredReviews(shopId) {
  const f = _reviewFilter[shopId] || {};
  let data = CBReviewDB.getAll(shopId);
  if (f.startDate) data = data.filter(r => (r.date||'') >= f.startDate);
  if (f.endDate)   data = data.filter(r => (r.date||'') <= f.endDate);
  return data;
}
function renderReviewTable(shopId) {
  const container = document.getElementById('review-table-area-'+shopId);
  if (!container) return;
  const data = _getFilteredReviews(shopId).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const sel = _reviewSel[shopId] || new Set();
  const allChecked = data.length > 0 && data.every(r => sel.has(r.id));

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#475569">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:.4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <div style="font-size:13px;margin-bottom:8px">${Object.values(_reviewFilter[shopId]||{}).some(v=>v) ? '没有符合筛选条件的记录' : '暂无差评率数据'}</div>
      <div style="font-size:12px;opacity:.7">点击「录入」手动添加，或「批量导入」上传表格</div>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:#94a3b8">
        <input type="checkbox" ${allChecked?'checked':''} onchange="toggleReviewSelectAll('${shopId}',this.checked)"
          style="accent-color:#7c3aed;width:14px;height:14px"> 全选当页
      </label>
      <span style="font-size:11px;color:#475569">已选 <b style="color:#a78bfa">${sel.size}</b> 条</span>
      ${sel.size>0 ? `<button onclick="batchDeleteReviews('${shopId}')" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#f87171;font-size:12px;cursor:pointer">🗑 批量删除(${sel.size})</button>` : ''}
      ${sel.size>0 ? `<button onclick="exportCBReviews('${shopId}',true)" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(52,211,153,0.4);background:rgba(52,211,153,0.08);color:#34d399;font-size:12px;cursor:pointer">↓ 导出选中(${sel.size})</button>` : ''}
      <span style="font-size:11px;color:#64748b;margin-left:auto">共 ${data.length} 条</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#1e293b">
            <th style="padding:8px 10px;width:32px"></th>
            <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">时间段/日期</th>
            <th style="padding:8px 10px;text-align:right;color:#64748b;font-weight:600;border-bottom:1px solid #334155">总评价数</th>
            <th style="padding:8px 10px;text-align:right;color:#64748b;font-weight:600;border-bottom:1px solid #334155">差评数</th>
            <th style="padding:8px 10px;text-align:right;color:#64748b;font-weight:600;border-bottom:1px solid #334155">差评率</th>
            <th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">备注</th>
            <th style="padding:8px 10px;text-align:center;color:#64748b;font-weight:600;border-bottom:1px solid #334155">操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((r,idx) => {
            const rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews/r.total_reviews*100 : 0);
            const rateColor = rate <= 2 ? '#34d399' : rate <= 5 ? '#fbbf24' : '#f87171';
            const rateBg = rate <= 2 ? 'rgba(52,211,153,0.12)' : rate <= 5 ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.12)';
            return `<tr style="border-bottom:1px solid #1e293b;${idx%2===1?'background:rgba(255,255,255,0.015)':''}">
              <td style="padding:8px 10px;text-align:center"><input type="checkbox" ${sel.has(r.id)?'checked':''} onchange="toggleReviewSelect('${shopId}','${r.id}',this.checked)" style="accent-color:#7c3aed;width:14px;height:14px"></td>
              <td style="padding:8px 10px;color:#e2e8f0">${r.date||'-'}</td>
              <td style="padding:8px 10px;text-align:right;color:#a78bfa">${(r.total_reviews||0).toLocaleString()}</td>
              <td style="padding:8px 10px;text-align:right;color:#f87171">${(r.negative_reviews||0).toLocaleString()}</td>
              <td style="padding:8px 10px;text-align:right">
                <span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${rateBg};color:${rateColor};font-weight:700">${rate.toFixed(2)}%</span>
              </td>
              <td style="padding:8px 10px;color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.remark||'-'}</td>
              <td style="padding:8px 10px;text-align:center;white-space:nowrap">
                <button class="btn-secondary btn-sm" onclick="openEditCBReviewModal('${shopId}','${r.id}')" style="margin-right:4px">编辑</button>
                <button style="padding:3px 8px;border-radius:5px;border:1px solid rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);color:#f87171;font-size:11px;cursor:pointer" onclick="removeCBReview('${shopId}','${r.id}')">删除</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}
function toggleReviewSelect(shopId, id, checked) {
  if (!_reviewSel[shopId]) _reviewSel[shopId] = new Set();
  if (checked) _reviewSel[shopId].add(id); else _reviewSel[shopId].delete(id);
  renderReviewTable(shopId);
}
function toggleReviewSelectAll(shopId, checked) {
  const data = _getFilteredReviews(shopId);
  _reviewSel[shopId] = new Set(checked ? data.map(r=>r.id) : []);
  renderReviewTable(shopId);
}
function batchDeleteReviews(shopId) {
  if (!checkEditPermission(shopId, null, '批量删除差评率记录')) return;
  const sel = _reviewSel[shopId];
  if (!sel || sel.size === 0) return;
  if (!confirm(`确定批量删除选中的 ${sel.size} 条差评率记录？`)) return;
  sel.forEach(id => CBReviewDB.remove(shopId, id));
  _reviewSel[shopId] = new Set();
  refreshCBArea(shopId);
  showToast(`已删除 ${sel.size} 条`, 'info');
}
function resetReviewFilter(shopId) {
  _reviewFilter[shopId] = {};
  _reviewSel[shopId] = new Set();
  ['rvf-start-'+shopId,'rvf-end-'+shopId].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderReviewTable(shopId);
}

function openAddCBDailyModal(shopId) {
  if (!checkEditPermission(shopId, null, '录入每日数据')) return;
  document.getElementById('cb-daily-modal-title').textContent = '录入每日数据';
  document.getElementById('cb-daily-date').value = new Date().toISOString().slice(0,10);
  ['visitors','buyers','qty','amount'].forEach(k => { const el = document.getElementById('cb-daily-'+k); if(el) el.value = ''; });
  const rm = document.getElementById('cb-daily-remark'); if(rm) rm.value = '';
  document.getElementById('cb-daily-edit-id').value = '';
  openModal('modal-cb-daily');
}
function openEditCBDailyModal(shopId, rowId) {
  if (!checkEditPermission(shopId, null, '编辑每日数据')) return;
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
  openModal('modal-cb-daily');
}
function saveCBDaily(shopId) {
  if (!checkEditPermission(shopId, null, '保存每日数据')) return;
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
  renderDailyTable(shopId);
  showToast('已保存','success');
}
function removeCBDaily(shopId, rowId) {
  if (!checkEditPermission(shopId, null, '删除每日数据')) return;
  if (!confirm('确定删除这条数据？')) return;
  CrossBorderDailyDB.remove(shopId, rowId);
  if (_dailySel[shopId]) _dailySel[shopId].delete(rowId);
  renderDailyTable(shopId);
  showToast('已删除','info');
}
function openImportCBModal(shopId) {
  document.getElementById('cb-import-text').value = '';
  document.getElementById('cb-import-preview').textContent = '';
  openModal('modal-cb-import');
}
function importCBDaily(shopId) {
  const text = document.getElementById('cb-import-text').value.trim();
  if (!text) { showToast('请粘贴数据','error'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let errors = 0;
  const newRows = [];
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
    newRows.push({
      id: 'cbd_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      date: normalized,
      visitors: nums[0] || 0,
      buyers: nums[1] || 0,
      qty: nums[2] || 0,
      amount: nums[3] || 0,
    });
  });
  const count = newRows.length;
  if (count === 0) {
    showToast(`❌ 未解析到有效每日数据（${errors}条格式错误），请检查格式：日期,访客量,支付人数,支付件数,支付金额`, 'error');
    return;
  }
  CrossBorderDailyDB.batchUpsert(shopId, newRows); // 批量本地+云端
  closeModal('modal-cb-import');
  renderDailyTable(shopId);
  showToast(`✅ 导入 ${count} 条${errors>0?'，'+errors+'条格式错误':''}`, count>0?'success':'error');
}
function exportCBDaily(shopId, selectedOnly) {
  let rows = CrossBorderDailyDB.getAll(shopId);
  if (!rows.length) { showToast('暂无每日数据', 'info'); return; }
  if (selectedOnly) {
    const sel = _dailySel[shopId];
    if (!sel || sel.size === 0) { showToast('请先选择要导出的记录', 'info'); return; }
    rows = rows.filter(r => sel.has(r.id));
  }
  const headers = ['日期','访客量','支付人数','支付件数','支付金额','转化率','客均价'];
  const data = rows.map(r => {
    const conv = r.visitors>0?(r.buyers/r.visitors*100).toFixed(2)+'%':'-';
    const avg = r.buyers>0?(r.amount/r.buyers).toFixed(2):'-';
    return [r.date, r.visitors||0, r.buyers||0, r.qty||0, r.amount||0, conv, avg];
  });
  const csv = [headers,...data].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url;
  const suffix = selectedOnly ? `_选中${rows.length}条` : '';
  a.download=`跨境每日_${shopId}${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`✅ 已导出 ${rows.length} 条每日数据`, 'success');
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
            <div class="import-sub">支持 .csv / .xlsx / .xls / .ods 格式</div>
          </div>
          <input type="file" id="file-input" accept=".csv,.xlsx,.xls,.ods,.xlsm,.txt" style="display:none" onchange="handleFileSelect(event)">
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
  const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods') || name.endsWith('.xlsm');
  const isCSV = name.endsWith('.csv') || name.endsWith('.txt');
  if (!isExcel && !isCSV) {
    showToast('⚠️ 不支持的文件格式，请使用 CSV 或 Excel（.xlsx/.xls/.ods）', 'error');
    return;
  }
  readFileAsCSVText(file).then(csv => parseCSV(csv, file.name)).catch(err => showToast('文件读取失败：' + err.message, 'error'));
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
let academyArticlesLoadedAt = 0; // 上次加载时间戳（ms）
let academyView = 'roles'; // 当前视图：'roles'角色广场 | 'role-detail'角色空间 | 'my'我的知识
let academyCurrentRole = null; // 当前浏览的角色对象

async function renderAcademy() {
  const pg = document.getElementById('page-academy');
  loadAcademyRoles();

  if (academyView === 'role-detail' && academyCurrentRole) {
    await renderAcademyRoleDetail(pg);
  } else if (academyView === 'my') {
    await renderAcademyMy(pg);
  } else {
    await renderAcademyRoles(pg);
  }
}

// ============ 知识学院 - 角色广场（首页）============
async function renderAcademyRoles(pg) {
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
        <p style="color:#64748b;font-size:13px;margin-top:4px">选择角色进入知识空间，或查看我的知识</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-secondary" onclick="switchAcademyView('my')" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          我的知识
        </button>
        <button class="btn-secondary" onclick="openAcademySearch()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          全局搜索
        </button>
        <button class="btn-primary" onclick="openCreateRoleModal()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          创建角色
        </button>
      </div>
    </div>

    <div id="academy-roles-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:8px">
      <div class="skeleton-list" style="grid-column:1/-1">
        ${Array(3).fill('<div class="card" style="height:120px"><div class="skeleton" style="height:100%"></div></div>').join('')}
      </div>
    </div>`;

  // 渲染角色卡片
  const grid = document.getElementById('academy-roles-grid');
  const myId = CURRENT_USER && CURRENT_USER.id;
  if (academyRoles.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="margin-bottom:12px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p style="color:#475569;margin-bottom:12px">还没有角色，创建第一个角色开始分享知识吧！</p>
        <button class="btn-primary" onclick="openCreateRoleModal()">创建角色</button>
      </div>`;
    return;
  }

  // 加载所有文章（统计每个角色的文章数）
  await loadAcademyArticles(false);
  const articleCountByRole = {};
  academyArticles.forEach(a => {
    if (a.role_id) {
      articleCountByRole[a.role_id] = (articleCountByRole[a.role_id] || 0) + 1;
    }
  });

  grid.innerHTML = academyRoles.map(role => {
    const isOwner = role.owner_id === myId;
    const count = articleCountByRole[role.id] || 0;
    const color = role.color || '#7c3aed';
    return `
    <div class="card" onclick="enterRoleSpace('${role.id}')" style="cursor:pointer;border:1px solid ${color}33;position:relative;transition:transform 0.15s,border-color 0.15s" onmouseenter="this.style.transform='translateY(-2px)';this.style.borderColor='${color}88'" onmouseleave="this.style.transform='';this.style.borderColor='${color}33'">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <div style="width:44px;height:44px;border-radius:12px;background:${color}22;border:2px solid ${color}44;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        ${isOwner ? `<button onclick="event.stopPropagation();deleteRole('${role.id}')" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:3px 8px;cursor:pointer;color:#f87171;font-size:11px">删除</button>` : ''}
      </div>
      <div style="font-size:15px;font-weight:700;color:#e2e8f0;margin-bottom:4px">${role.name}</div>
      ${role.desc ? `<div style="font-size:12px;color:#64748b;margin-bottom:8px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${role.desc}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <span style="font-size:12px;color:${color};background:${color}15;padding:2px 8px;border-radius:20px">${count} 篇知识</span>
        <span style="font-size:11px;color:#475569">${isOwner ? '我创建的' : ''}</span>
      </div>
    </div>`;
  }).join('');
}

// ============ 知识学院 - 角色空间（角色详情页）============
async function renderAcademyRoleDetail(pg) {
  const role = academyCurrentRole;
  const color = role.color || '#7c3aed';
  pg.innerHTML = `
    <div class="header-row" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <button onclick="switchAcademyView('roles')" style="background:rgba(71,85,105,0.2);border:1px solid #334155;border-radius:8px;padding:7px 12px;cursor:pointer;color:#94a3b8;display:flex;align-items:center;gap:6px;font-size:13px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          返回
        </button>
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:10px;background:${color}22;border:2px solid ${color}44;display:flex;align-items:center;justify-content:center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <h1 style="font-size:18px;color:#e2e8f0;margin:0">${role.name} 的知识空间</h1>
              ${role.desc ? `<p style="color:#64748b;font-size:12px;margin:2px 0 0">${role.desc}</p>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-secondary" onclick="openAcademySearch()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          搜索
        </button>
        <button class="btn-primary" onclick="openModal_addArticle('${role.id}')" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          在此发布知识
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

  await loadAcademyArticles(false, role.id);
}

// ============ 知识学院 - 我的知识页 ============
async function renderAcademyMy(pg) {
  pg.innerHTML = `
    <div class="header-row" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <button onclick="switchAcademyView('roles')" style="background:rgba(71,85,105,0.2);border:1px solid #334155;border-radius:8px;padding:7px 12px;cursor:pointer;color:#94a3b8;display:flex;align-items:center;gap:6px;font-size:13px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          返回
        </button>
        <div>
          <h1 style="font-size:18px;color:#e2e8f0;margin:0;display:flex;align-items:center;gap:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            我发布的知识
          </h1>
          <p style="color:#64748b;font-size:12px;margin:2px 0 0">我所有发布的知识内容</p>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn-primary" onclick="openModal_addArticle()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          发布知识
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

  const myId = CURRENT_USER && CURRENT_USER.id;
  await loadAcademyArticles(false, null, myId);
}

function switchAcademyView(view, roleId) {
  academyView = view;
  if (view === 'role-detail' && roleId) {
    academyCurrentRole = academyRoles.find(r => r.id === roleId) || null;
  } else if (view !== 'role-detail') {
    academyCurrentRole = null;
  }
  renderAcademy();
}

function enterRoleSpace(roleId) {
  switchAcademyView('role-detail', roleId);
}

function deleteRole(roleId) {
  const role = academyRoles.find(r => r.id === roleId);
  if (!role) return;
  if (!confirm(`确定要删除角色「${role.name}」吗？该角色下的知识内容不会被删除。`)) return;
  academyRoles = academyRoles.filter(r => r.id !== roleId);
  saveAcademyRoles();
  showToast('角色已删除', 'info');
  renderAcademy();
}

// 从文章 content 中解析附件数据
// 格式: <正文>\n\n<!--ATTACHMENTS_DATA:<base64编码的JSON>-->
function parseContentAttachments(rawContent) {
  const SEP = '\n\n<!--ATTACHMENTS_DATA:';
  const END = '-->';
  const idx = rawContent.lastIndexOf(SEP);
  if (idx === -1) return { content: rawContent, attachments: null };
  const endIdx = rawContent.indexOf(END, idx + SEP.length);
  if (endIdx === -1) return { content: rawContent, attachments: null };
  const b64 = rawContent.slice(idx + SEP.length, endIdx);
  const pureContent = rawContent.slice(0, idx);
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const atts = JSON.parse(json);
    return { content: pureContent, attachments: Array.isArray(atts) ? atts : null };
  } catch(e) {
    return { content: pureContent, attachments: null };
  }
}

async function loadAcademyArticles(renderAll, filterRoleId, filterAuthorId) {
  const now = Date.now();
  const cacheValid = academyArticles.length > 0 && (now - academyArticlesLoadedAt) < ACADEMY_CACHE_TTL;

  // 有缓存先立即渲染，不等网络
  if (academyArticles.length > 0) {
    _applyAcademyArticles(renderAll, filterRoleId, filterAuthorId);
  }

  // 缓存有效（5分钟内），不重新拉取
  if (cacheValid) return;

  try {
    let articles;
    if (SUPABASE_ENABLED) {
      articles = await sbFetch('academy?select=*,users(nickname,phone)&order=created_at.desc');
      // 扁平化 author 信息，并从 content 末尾解析附件数据
      articles = articles.map(a => {
        const parsed = parseContentAttachments(a.content || '');
        return {
          ...a,
          author_name: a.author_name || (a.users ? (a.users.nickname || a.users.phone) : '匿名'),
          users: undefined,
          content: parsed.content,                                       // 去掉附件数据的纯正文
          attachments: parsed.attachments ? JSON.stringify(parsed.attachments) : (a.attachments || null),
        };
      });

    } else {
      articles = Cache.get('academy_articles', getDemoAcademyArticles());
    }
    academyArticles = articles;
    academyArticlesLoadedAt = Date.now(); // 记录加载时间
    _applyAcademyArticles(renderAll, filterRoleId, filterAuthorId);
  } catch(e) {
    // 已有缓存时静默失败，没有缓存才显示错误
    if (academyArticles.length === 0) {
      const el = document.getElementById('academy-list');
      if (el) el.innerHTML = `<div class="empty-state"><p style="color:#f87171">加载失败：${e.message}</p></div>`;
    }
  }
}

// 内部：用当前 academyArticles 按条件渲染列表
function _applyAcademyArticles(renderAll, filterRoleId, filterAuthorId) {
  const articles = academyArticles;
  if (renderAll === false) {
    if (filterRoleId !== undefined || filterAuthorId !== undefined) {
      let filtered = articles;
      if (filterRoleId) filtered = filtered.filter(a => a.role_id === filterRoleId);
      if (filterAuthorId) filtered = filtered.filter(a => a.author_id === filterAuthorId);
      renderAcademyList(filtered);
    }
  } else {
    renderAcademyList(articles);
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

    // 附件解析（支持localKey从本地Cache读取）
    let attachHtml = '';
    if (a.attachments) {
      try {
        const atts = JSON.parse(a.attachments);
        if (atts.length) {
          // 若附件有localKey，从本地Cache读取实际base64数据
          const resolvedAtts = atts.map(att => {
            if (!att.data && att.localKey) {
              const cached = Cache.get(att.localKey, null);
              if (cached && Array.isArray(cached)) {
                const found = cached.find(x => x.name === att.name);
                if (found && found.data) return { ...att, data: found.data };
              }
            }
            return att;
          });
          attachHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">` +
            resolvedAtts.map((att, attIdx) => {
              const ext = att.name.split('.').pop().toLowerCase();
              const icon = att.type && att.type.startsWith('image') ? '🖼️' : (iconMap[ext] || '📎');
              const size = att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : Math.round(att.size/1024)+'KB';
              const canDownload = !!att.data;
              // 卡片里附件点击 → 打开详情弹窗（详情弹窗里再下载）
              return `<span onclick="event.stopPropagation();openArticleDetail(${a.id})" style="display:flex;align-items:center;gap:4px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;color:#a5b4fc" title="${att.name}（点击查看详情并下载）">
                ${icon} <span style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${att.name}</span> <span style="color:#475569">${size}</span>${canDownload?'':'<span style="color:#475569;font-size:10px" title="附件存储在上传者本地">🔒</span>'}
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
            <h3 class="academy-title" onclick="openArticleDetail(${a.id})" style="cursor:pointer;text-decoration:none;transition:color 0.15s" onmouseenter="this.style.color='#a78bfa'" onmouseleave="this.style.color=''">${a.title}</h3>
          </div>
          <p class="academy-preview" style="cursor:pointer" onclick="openArticleDetail(${a.id})">${preview}</p>
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
          <button class="academy-expand-btn" onclick="openArticleDetail(${a.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            查看详情
          </button>
          ${isOwner ? `
          <button onclick="openEditArticleModal(${a.id},'academy')" style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:7px;padding:5px 10px;cursor:pointer;color:#a78bfa;font-size:12px;display:flex;align-items:center;gap:4px">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            编辑
          </button>
          <button class="btn-danger btn-sm" onclick="deleteArticle(${a.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            删除
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterAcademy(category) {
  document.querySelectorAll('#academy-tabs .tab').forEach((el, i) => {
    const cats = ['全部','运营经验','选品技巧','物流仓储','广告投放','数据分析','其他'];
    el.classList.toggle('active', cats[i] === category);
  });
  let base = academyArticles;
  if (academyView === 'role-detail' && academyCurrentRole) {
    base = academyArticles.filter(a => a.role_id === academyCurrentRole.id);
  } else if (academyView === 'my' && CURRENT_USER) {
    base = academyArticles.filter(a => a.author_id === CURRENT_USER.id);
  }
  const filtered = category === '全部' ? base : base.filter(a => a.category === category);
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
  // 直接打开文章详情弹窗
  setTimeout(() => {
    openArticleDetail(articleId);
  }, 150);
}

function toggleArticle(id) {
  // 兼容旧调用，转为打开详情弹窗
  openArticleDetail(id);
}

// ============ 知识学院 - 文章详情弹窗 ============
function openArticleDetail(id) {
  const a = academyArticles.find(x => x.id == id || x.id === String(id));
  if (!a) return;

  const old = document.getElementById('article-detail-overlay');
  if (old) old.remove();

  const catColors = { '运营经验':'#7c3aed','选品技巧':'#06b6d4','物流仓储':'#10b981','广告投放':'#f59e0b','数据分析':'#6366f1','其他':'#64748b' };
  const catColor = catColors[a.category] || '#64748b';
  const date = a.created_at ? new Date(a.created_at).toLocaleString('zh-CN') : '';
  const isOwner = CURRENT_USER && (CURRENT_USER.id === a.author_id || CURRENT_USER.role === 'admin');
  const roleHtml = a.role_name ? `<span style="font-size:12px;padding:3px 10px;border-radius:5px;background:${(a.role_color||'#7c3aed')}22;color:${a.role_color||'#a78bfa'};border:1px solid ${(a.role_color||'#7c3aed')}44">👤 ${a.role_name}</span>` : '';
  const iconMap = { 'image':'🖼️', 'pdf':'📄', 'xlsx':'📊', 'xls':'📊', 'docx':'📝', 'doc':'📝', 'pptx':'📑', 'ppt':'📑', 'zip':'🗜️', 'csv':'📋', 'txt':'📃' };

  // 解析附件
  let attachHtml = '';
  // 用全局临时存储附件数据，避免 base64 内联到 HTML attribute 里被截断
  window._articleDetailAtts = [];
  if (a.attachments) {
    try {
      const atts = JSON.parse(a.attachments);
      if (atts.length) {
        const resolvedAtts = atts.map(att => {
          // 优先级：1. 已有 url（云端）2. 已有 data（base64）3. 从 localKey Cache 读取
          if (att.url) return att; // 云端附件，可直接下载
          if (!att.data && att.localKey) {
            const cached = Cache.get(att.localKey, null);
            if (cached && Array.isArray(cached)) {
              const found = cached.find(x => x.name === att.name);
              if (found && found.data) return { ...att, data: found.data };
            }
          }
          return att;
        });
        // 存到全局临时变量，HTML里只传索引
        window._articleDetailAtts = resolvedAtts;
        attachHtml = `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #1e293b">
          <div style="font-size:13px;color:#64748b;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            附件（${resolvedAtts.length} 个）
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${resolvedAtts.map((att, attIdx) => {
              const ext = att.name.split('.').pop().toLowerCase();
              const icon = att.type && att.type.startsWith('image') ? '🖼️' : (iconMap[ext] || '📎');
              const size = att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : Math.round(att.size/1024)+'KB';
              // url 或 data 都视为可下载
              const canDownload = !!(att.url || att.data);
              return `<div ${canDownload ? `onclick="downloadAttachmentByIndex(${attIdx})"` : ''} 
                style="display:flex;align-items:center;gap:8px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:8px 12px;cursor:${canDownload?'pointer':'default'};transition:background 0.15s" 
                ${canDownload ? 'onmouseenter="this.style.background=\'rgba(99,102,241,0.22)\'" onmouseleave="this.style.background=\'rgba(99,102,241,0.12)\'"' : ''}
                title="${att.name}${canDownload?' — 点击下载':''}">
                <span style="font-size:18px">${icon}</span>
                <div>
                  <div style="font-size:13px;color:#c4b5fd;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${att.name}</div>
                  <div style="font-size:11px;color:#475569">${size}${canDownload ? (att.url ? ' · ☁️ 点击下载' : ' · 点击下载') : ' · 暂无文件'}</div>
                </div>
                ${canDownload ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" style="margin-left:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }
    } catch(e) {}
  }

  const overlay = document.createElement('div');
  overlay.id = 'article-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = function(e) { if(e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;width:94%;max-width:720px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.6);overflow:hidden">
      <!-- 标题栏 -->
      <div style="padding:20px 24px 16px;border-bottom:1px solid #263044;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <span style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;font-size:11px;padding:2px 8px;border-radius:4px">${a.category || '其他'}</span>
            ${roleHtml}
          </div>
          <h2 style="font-size:18px;font-weight:700;color:#f1f5f9;line-height:1.4;margin:0">${a.title}</h2>
          <div style="display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap">
            <span style="font-size:12px;color:#475569;display:flex;align-items:center;gap:4px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${a.author_name || '匿名'}
            </span>
            <span style="font-size:12px;color:#334155">${date}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          ${isOwner ? `
          <button onclick="openEditArticleModal(${a.id},'academy')" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);border-radius:7px;padding:6px 12px;cursor:pointer;color:#a78bfa;font-size:12px;display:flex;align-items:center;gap:5px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>编辑
          </button>
          <button onclick="overlay.remove();deleteArticle(${a.id})" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:7px;padding:6px 12px;cursor:pointer;color:#f87171;font-size:12px;display:flex;align-items:center;gap:5px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>删除
          </button>` : ''}
          <button onclick="this.closest('#article-detail-overlay').remove()" style="background:rgba(71,85,105,0.3);border:1px solid #334155;border-radius:7px;padding:6px 12px;cursor:pointer;color:#94a3b8;font-size:12px">关闭</button>
        </div>
      </div>
      <!-- 正文 -->
      <div style="flex:1;overflow-y:auto;padding:24px">
        <div style="color:#cbd5e1;font-size:14px;line-height:1.9;white-space:pre-wrap">${(a.content || '').replace(/\n/g,'\n')}</div>
        ${attachHtml}
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function downloadAttachmentByIndex(idx) {
  const atts = window._articleDetailAtts;
  if (!atts || !atts[idx]) { showToast('附件数据不存在', 'error'); return; }
  const att = atts[idx];
  // 优先用云端 URL 下载（所有人可用）
  if (att.url) {
    const a = document.createElement('a');
    a.href = att.url;
    a.download = att.name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  // 降级：用 base64
  if (!att.data) { showToast('附件暂无法下载（附件数据不在本设备）', 'error'); return; }
  downloadAttachment(att.name, att.data);
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

function openModal_addArticle(presetRoleId) {
  loadAcademyRoles();
  // 刷新角色下拉
  const sel = document.getElementById('article-role');
  if (sel) {
    const myRoles = academyRoles.filter(r => r.owner_id === (CURRENT_USER && CURRENT_USER.id));
    sel.innerHTML = '<option value="">-- 选择发布身份（可选）--</option>' +
      myRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    // 如果在角色空间内发布，自动选中该角色
    if (presetRoleId) {
      sel.value = presetRoleId;
      sel.style.background = 'rgba(124,58,237,0.15)';
    } else {
      sel.style.background = '';
    }
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
// 允许的文件类型：所有图片 + 常见文档类型
const ALLOWED_FILE_TYPES = ['image/', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats', 'application/msword', 'application/zip', 'text/', 'application/vnd.ms-powerpoint', 'application/octet-stream'];
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
    // 支持所有图片格式（PNG/JPG/WEBP/GIF等）以及常见文档
    const isAllowed = f.type.startsWith('image/') || ALLOWED_FILE_TYPES.some(t => f.type.startsWith(t)) || /\.(png|jpg|jpeg|webp|gif|bmp|pdf|xlsx?|docx?|pptx?|csv|txt|zip)$/i.test(f.name);
    if (!isAllowed) { showToast(`文件「${f.name}」类型不支持，已跳过`, 'error'); continue; }
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

  // 处理文件附件
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

  // 附件序列化：追加到 content 末尾（用特殊分隔符，兼容现有数据库结构）
  // 格式: \n\n<!--ATTACHMENTS_DATA:base64(JSON)-->
  const ATTACH_SEP = '\n\n<!--ATTACHMENTS_DATA:';
  const ATTACH_END = '-->';
  let contentWithAttach = content;
  if (attachments.length > 0) {
    const attJson = JSON.stringify(attachments.map(a => ({ name: a.name, type: a.type, size: a.size, data: a.data })));
    contentWithAttach = content + ATTACH_SEP + btoa(unescape(encodeURIComponent(attJson))) + ATTACH_END;
  }

  const article = {
    title,
    content: contentWithAttach,
    category,
    author_id: CURRENT_USER.id,
    author_name: authorName,
    role_id: roleId || null,
    role_name: role ? role.name : null,
    role_color: role ? role.color : null,
    attachments: attachments.length ? JSON.stringify(attachments.map(a => ({ name: a.name, type: a.type, size: a.size, data: a.data }))) : null,
    likes: 0,
    created_at: new Date().toISOString(),
  };

  try {
    if (SUPABASE_ENABLED) {
      // 写入 Supabase（只用现有字段，附件数据已嵌入 content）
      // 只写入 Supabase 表中存在的字段（role_color 不在表中，不提交，渲染时从本地角色列表动态匹配）
      const articleForDB = {
        title: article.title,
        content: contentWithAttach,   // 含附件数据
        category: article.category,
        author_id: article.author_id,
        author_name: article.author_name,
        role_id: article.role_id || null,
        role_name: article.role_name || null,
        likes: article.likes,
        created_at: article.created_at,
      };
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
    showToast('知识发布成功！', 'success');
    // 清除缓存，确保下次重新拉取
    squareArticlesLoadedAt = 0;
    academyArticlesLoadedAt = 0;
    // 根据当前视图重新加载
    const target = window._articleSubmitTarget || 'academy';
    window._articleSubmitTarget = null;
    if (target === 'square') {
      await loadSquareArticles();
    } else if (academyView === 'role-detail' && academyCurrentRole) {
      await loadAcademyArticles(false, academyCurrentRole.id);
    } else if (academyView === 'my' && CURRENT_USER) {
      await loadAcademyArticles(false, null, CURRENT_USER.id);
    } else {
      renderAcademy();
    }
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
    // 清除缓存时间戳，下次重新拉取
    squareArticlesLoadedAt = 0;
    academyArticlesLoadedAt = 0;
    // 关闭详情弹窗（如果打开了）
    const detailOverlay = document.getElementById('article-detail-overlay');
    if (detailOverlay) detailOverlay.remove();
    // 根据视图刷新
    if (academyView === 'role-detail' && academyCurrentRole) {
      await loadAcademyArticles(false, academyCurrentRole.id);
    } else if (academyView === 'my' && CURRENT_USER) {
      await loadAcademyArticles(false, null, CURRENT_USER.id);
    } else {
      renderAcademy();
    }
  } catch(e) {
    showToast('删除失败：' + e.message, 'error');
  }
}

// ============================================
//  页面：知识广场（所有人知识汇总，实时同步）
// ============================================
let squareArticles = [];     // 广场文章列表缓存
let squareFilterCat = '全部'; // 广场当前分类筛选
let squareArticlesLoadedAt = 0; // 上次加载时间戳（ms）
const ACADEMY_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存有效期

async function renderSquare() {
  const pg = document.getElementById('page-square');
  pg.innerHTML = `
    <div class="header-row">
      <div>
        <h1 style="display:flex;align-items:center;gap:10px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#sqg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <defs><linearGradient id="sqg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#06b6d4"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          知识广场
        </h1>
        <p style="color:#64748b;font-size:13px;margin-top:4px">所有成员分享的知识，实时同步</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-secondary" onclick="openAcademySearch()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          全局搜索
        </button>
        <button class="btn-secondary" onclick="refreshSquare()" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          刷新
        </button>
      </div>
    </div>
    <!-- 分类筛选 -->
    <div class="tabs" id="square-tabs" style="margin-bottom:20px">
      <div class="tab active" onclick="filterSquare('全部')">全部</div>
      <div class="tab" onclick="filterSquare('运营经验')">运营经验</div>
      <div class="tab" onclick="filterSquare('选品技巧')">选品技巧</div>
      <div class="tab" onclick="filterSquare('物流仓储')">物流仓储</div>
      <div class="tab" onclick="filterSquare('广告投放')">广告投放</div>
      <div class="tab" onclick="filterSquare('数据分析')">数据分析</div>
      <div class="tab" onclick="filterSquare('其他')">其他</div>
    </div>
    <div id="square-list">
      <div class="skeleton-list">
        ${Array(5).fill('<div class="card" style="margin-bottom:12px;height:120px"><div class="skeleton" style="height:100%"></div></div>').join('')}
      </div>
    </div>`;

  // 有缓存数据先立即渲染，不等网络
  if (squareArticles.length > 0) {
    filterSquare(squareFilterCat, true);
  }

  // 5分钟内有效缓存则不重新拉取（手动刷新除外）
  const now = Date.now();
  if (squareArticles.length > 0 && (now - squareArticlesLoadedAt) < ACADEMY_CACHE_TTL) {
    return; // 缓存有效，直接用缓存，不发请求
  }

  // 后台静默拉取最新数据（不阻塞页面显示）
  loadSquareArticles();
}

async function loadSquareArticles() {
  try {
    let articles;
    if (SUPABASE_ENABLED) {
      articles = await sbFetch('academy?select=*&order=created_at.desc');
      articles = articles.map(a => {
        const parsed = parseContentAttachments(a.content || '');
        return {
          ...a,
          content: parsed.content,
          attachments: parsed.attachments ? JSON.stringify(parsed.attachments) : (a.attachments || null),
        };
      });
    } else {
      articles = Cache.get('academy_articles', []);
    }
    squareArticles = articles;
    squareArticlesLoadedAt = Date.now(); // 记录加载时间
    filterSquare(squareFilterCat, true);
  } catch(e) {
    const el = document.getElementById('square-list');
    if (el) el.innerHTML = `<div class="empty-state"><p style="color:#f87171">加载失败：${e.message}</p></div>`;
  }
}

async function refreshSquare() {
  const el = document.getElementById('square-list');
  if (el) el.innerHTML = `<div class="skeleton-list">${Array(5).fill('<div class="card" style="margin-bottom:12px;height:120px"><div class="skeleton" style="height:100%"></div></div>').join('')}</div>`;
  await loadSquareArticles();
  showToast('广场已刷新', 'success');
}

function filterSquare(category, skipTabUpdate) {
  squareFilterCat = category;
  if (!skipTabUpdate) {
    document.querySelectorAll('#square-tabs .tab').forEach((el, i) => {
      const cats = ['全部','运营经验','选品技巧','物流仓储','广告投放','数据分析','其他'];
      el.classList.toggle('active', cats[i] === category);
    });
  }
  const filtered = category === '全部' ? squareArticles : squareArticles.filter(a => a.category === category);
  renderSquareList(filtered);
}

function renderSquareList(articles) {
  const container = document.getElementById('square-list');
  if (!container) return;
  if (!articles || articles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5" style="margin-bottom:12px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <p style="color:#475569">广场暂无知识，快来第一个分享吧！</p>
        <button class="btn-primary" style="margin-top:12px" onclick="openModal_addArticleSquare()">立即分享</button>
      </div>`;
    return;
  }

  const catColors = { '运营经验':'#7c3aed','选品技巧':'#06b6d4','物流仓储':'#10b981','广告投放':'#f59e0b','数据分析':'#6366f1','其他':'#64748b' };

  container.innerHTML = articles.map(a => {
    const isOwner = CURRENT_USER && (CURRENT_USER.id === a.author_id || CURRENT_USER.role === 'admin');
    const date = a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN') : '';
    const preview = a.content ? a.content.slice(0, 150).replace(/\n/g, ' ') + (a.content.length > 150 ? '...' : '') : '';
    const catColor = catColors[a.category] || '#64748b';
    const roleHtml = a.role_name ? `<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${(a.role_color||'#7c3aed')}22;color:${a.role_color||'#a78bfa'};border:1px solid ${(a.role_color||'#7c3aed')}44;margin-right:4px">👤 ${a.role_name}</span>` : '';

    return `
    <div class="academy-card" id="sq-${a.id}">
      <div class="academy-card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span class="badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;font-size:11px">${a.category || '其他'}</span>
            ${roleHtml}
            <h3 class="academy-title" onclick="openSquareDetail(${a.id})" style="cursor:pointer;transition:color 0.15s" onmouseenter="this.style.color='#06b6d4'" onmouseleave="this.style.color=''">${a.title}</h3>
          </div>
          <p class="academy-preview" style="cursor:pointer" onclick="openSquareDetail(${a.id})">${preview}</p>
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
          <button class="academy-expand-btn" onclick="openSquareDetail(${a.id})" style="border-color:rgba(6,182,212,0.3);color:#06b6d4">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            查看全文
          </button>
          ${isOwner ? `
          <button onclick="openEditArticleModal(${a.id},'square')" style="background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:7px;padding:5px 10px;cursor:pointer;color:#06b6d4;font-size:12px;display:flex;align-items:center;gap:4px">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            编辑
          </button>
          <button class="btn-danger btn-sm" onclick="deleteSquareArticle(${a.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            删除
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function openModal_addArticleSquare() {
  // 复用知识学院的发布弹窗，但发布后刷新广场
  window._articleSubmitTarget = 'square';
  openModal('modal-add-article');
}

function openSquareDetail(id) {
  // 用 squareArticles 来查找，然后调用通用的详情弹窗
  const old = academyArticles;
  // 临时合并，让详情弹窗能找到
  const merged = [...squareArticles];
  const savedAcademy = academyArticles;
  academyArticles = merged;
  openArticleDetail(id);
  academyArticles = savedAcademy;
}

async function deleteSquareArticle(id) {
  if (!confirm('确定要删除这篇文章吗？')) return;
  const article = squareArticles.find(a => a.id === id || a.id === String(id));
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
    squareArticlesLoadedAt = 0;
    academyArticlesLoadedAt = 0;
    const detailOverlay = document.getElementById('article-detail-overlay');
    if (detailOverlay) detailOverlay.remove();
    await loadSquareArticles();
  } catch(e) {
    showToast('删除失败：' + e.message, 'error');
  }
}

// ============ 编辑文章弹窗 ============
function openEditArticleModal(id, source) {
  // source: 'academy' 或 'square'
  const list = source === 'square' ? squareArticles : academyArticles;
  const a = list.find(x => x.id == id || x.id === String(id));
  if (!a) { showToast('找不到文章', 'error'); return; }

  const old = document.getElementById('edit-article-overlay');
  if (old) old.remove();

  const cats = ['运营经验','选品技巧','物流仓储','广告投放','数据分析','其他'];
  const catOptions = cats.map(c => `<option value="${c}" ${a.category===c?'selected':''}>${c}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'edit-article-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = function(e) { if(e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;width:94%;max-width:700px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.6);overflow:hidden">
      <div style="padding:20px 24px 16px;border-bottom:1px solid #263044;display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0;color:#e2e8f0;display:flex;align-items:center;gap:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑知识
        </h3>
        <button onclick="document.getElementById('edit-article-overlay').remove()" style="background:rgba(71,85,105,0.3);border:1px solid #334155;border-radius:7px;padding:6px 12px;cursor:pointer;color:#94a3b8;font-size:12px">取消</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px 24px">
        <div style="margin-bottom:14px">
          <label style="font-size:13px;color:#94a3b8;display:block;margin-bottom:6px">标题</label>
          <input id="edit-article-title" type="text" value="${(a.title||'').replace(/"/g,'&quot;')}" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:14px;box-sizing:border-box" placeholder="文章标题">
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:13px;color:#94a3b8;display:block;margin-bottom:6px">分类</label>
          <select id="edit-article-category" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:14px">
            ${catOptions}
          </select>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:13px;color:#94a3b8;display:block;margin-bottom:6px">正文内容</label>
          <textarea id="edit-article-content" rows="14" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:14px;resize:vertical;box-sizing:border-box;line-height:1.7" placeholder="在这里写下你的知识分享...">${(a.content||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #263044;display:flex;justify-content:flex-end;gap:10px">
        <button onclick="document.getElementById('edit-article-overlay').remove()" class="btn-secondary">取消</button>
        <button onclick="saveEditArticle(${id},'${source}')" class="btn-primary" style="background:linear-gradient(135deg,#06b6d4,#7c3aed)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          保存并同步
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveEditArticle(id, source) {
  const title = document.getElementById('edit-article-title').value.trim();
  const content = document.getElementById('edit-article-content').value.trim();
  const category = document.getElementById('edit-article-category').value;

  if (!title) { showToast('请输入标题', 'error'); return; }
  if (!content) { showToast('请输入内容', 'error'); return; }

  // 找到原文章（保留附件数据）
  const list = source === 'square' ? squareArticles : academyArticles;
  const a = list.find(x => x.id == id || x.id === String(id));
  if (!a) { showToast('找不到文章', 'error'); return; }

  // 保留原附件：把附件数据重新嵌入 content
  let contentWithAttach = content;
  if (a.attachments) {
    try {
      const atts = JSON.parse(a.attachments);
      if (atts.length > 0) {
        const attJson = JSON.stringify(atts);
        const ATTACH_SEP = '\n\n<!--ATTACHMENTS_DATA:';
        const ATTACH_END = '-->';
        contentWithAttach = content + ATTACH_SEP + btoa(unescape(encodeURIComponent(attJson))) + ATTACH_END;
      }
    } catch(e) {}
  }

  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('academy?id=eq.' + id, 'PATCH', {
        title,
        content: contentWithAttach,
        category,
      });
    } else {
      const cached = Cache.get('academy_articles', []);
      const idx = cached.findIndex(x => x.id == id);
      if (idx !== -1) {
        cached[idx] = { ...cached[idx], title, content: contentWithAttach, category };
        Cache.set('academy_articles', cached);
      }
    }
    document.getElementById('edit-article-overlay').remove();
    showToast('✅ 已保存并同步', 'success');
    // 刷新对应页面
    if (source === 'square') {
      await loadSquareArticles();
    } else {
      if (academyView === 'role-detail' && academyCurrentRole) {
        await loadAcademyArticles(false, academyCurrentRole.id);
      } else if (academyView === 'my' && CURRENT_USER) {
        await loadAcademyArticles(false, null, CURRENT_USER.id);
      } else {
        renderAcademy();
      }
    }
  } catch(e) {
    showToast('保存失败：' + e.message, 'error');
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
  const pendingShopReqs = requests.filter(r => r.status === 'pending' && r.shopId !== '__pwd_reset__' && !r.shopId.startsWith('edit_'));
  const pendingEditReqs = requests.filter(r => r.status === 'pending' && r.shopId.startsWith('edit_'));
  const pendingPwdReqs  = requests.filter(r => r.status === 'pending' && r.shopId === '__pwd_reset__');

  pg.innerHTML = `
    <div class="page-header">
      <h1 style="display:flex;align-items:center;gap:10px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#ag1)" stroke-width="2"><defs><linearGradient id="ag1" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        权限管理
      </h1>
      <p style="color:#64748b;font-size:13px;margin-top:4px">管理成员账号及页面访问权限</p>
    </div>

    ${pendingPwdReqs.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.05)">
      <div class="card-title" style="color:#f87171;display:flex;align-items:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>密码重置申请</span>
        <span style="background:#ef4444;color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${pendingPwdReqs.length}</span>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">审核通过后，用户将使用其提交的新密码登录</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${pendingPwdReqs.map(req => `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;color:#e2e8f0;font-weight:600">
              <span style="color:#f87171">🔑</span> ${req.applicantName} 申请重置密码
            </div>
            <div style="font-size:11px;color:#475569;margin-top:3px">${new Date(req.createdAt).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button onclick="approvePasswordReset('${req.id}','${req.applicantId}','${req.reason}')" style="padding:5px 14px;border-radius:6px;background:linear-gradient(135deg,#059669,#10b981);border:none;color:#fff;font-size:12px;cursor:pointer;font-weight:600">✓ 批准</button>
            <button onclick="rejectPasswordReset('${req.id}')" style="padding:5px 14px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-size:12px;cursor:pointer">✗ 拒绝</button>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    ${pendingEditReqs.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border:1px solid rgba(249,115,22,0.4);background:rgba(249,115,22,0.05)">
      <div class="card-title" style="color:#fb923c;display:flex;align-items:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span>编辑权限申请</span>
        <span style="background:#fb923c;color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${pendingEditReqs.length}</span>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">批准后该成员可以编辑/删除对应店铺的数据</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${pendingEditReqs.map(req => {
          const realShopId = (req.shopId||'').replace(/^edit_/, '');
          const realShop = DB.getShops().find(s => s.id === realShopId);
          const dispName = realShop ? realShop.name : req.shopName.replace('（编辑权限）','');
          return `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;color:#e2e8f0;font-weight:600">${req.applicantName} 申请编辑 <span style="color:#fb923c">「${dispName}」</span> 的数据</div>
            ${req.reason ? `<div style="font-size:12px;color:#64748b;margin-top:3px">原因：${req.reason}</div>` : ''}
            <div style="font-size:11px;color:#475569;margin-top:3px">${new Date(req.createdAt).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button onclick="approveShopRequest('${req.id}','${req.applicantId}','${req.shopId}')" style="padding:5px 14px;border-radius:6px;background:linear-gradient(135deg,#059669,#10b981);border:none;color:#fff;font-size:12px;cursor:pointer;font-weight:600">✓ 批准</button>
            <button onclick="rejectShopRequest('${req.id}')" style="padding:5px 14px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-size:12px;cursor:pointer">✗ 拒绝</button>
          </div>
        </div>`;}).join('')}
      </div>
    </div>` : ''}

    ${pendingShopReqs.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.05)">
      <div class="card-title" style="color:#f59e0b;display:flex;align-items:center;gap:8px">
        <span>📬 店铺权限申请</span>
        <span style="background:#f59e0b;color:#000;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${pendingShopReqs.length}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        ${pendingShopReqs.map(req => `
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

// 批准店铺访问申请或编辑权限申请
async function approveShopRequest(reqId, applicantId, shopId) {
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const req = requests.find(r => r.id === reqId);
  if (!req) return;
  // 将申请状态改为已批准
  req.status = 'approved';
  localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  sbUpdateAccessRequestStatus(reqId, 'approved'); // 同步云端

  if (shopId.startsWith('edit_')) {
    // 编辑权限申请：授予 shop_edit_<realShopId> 权限
    const realShopId = shopId.replace(/^edit_/, '');
    const permKey = 'shop_edit_' + realShopId;
    await grantPermission(applicantId, permKey);
    showToast('✅ 已批准编辑权限申请', 'success');
  } else {
    // 查看权限申请：授予 shop_access_<shopId> 权限（兼容旧逻辑，现在查看权限已默认开放，此处保留）
    const permKey = 'shop_access_' + shopId;
    await grantPermission(applicantId, permKey);
    showToast('✅ 已批准申请', 'success');
  }
  renderAdmin();
}

function rejectShopRequest(reqId) {
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const req = requests.find(r => r.id === reqId);
  if (req) {
    req.status = 'rejected';
    localStorage.setItem('shop_access_requests', JSON.stringify(requests));
    sbUpdateAccessRequestStatus(reqId, 'rejected'); // 同步云端
  }
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
            ${!isSelf ? `
              <button class="btn-secondary btn-sm" onclick="${isAdmin ? `revokeAdmin('${u.id}')` : `grantAdmin('${u.id}')`}" title="${isAdmin ? '取消管理员身份' : '设为管理员（可审批申请/管理成员）'}" style="${isAdmin ? 'border-color:rgba(248,113,113,0.4);color:#f87171' : 'border-color:rgba(124,58,237,0.4);color:#a78bfa'}">
                ${isAdmin ? '取消管理员' : '设为管理员'}
              </button>
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

// ============ 设置/取消 管理员权限 ============
async function grantAdmin(userId) {
  if (!confirm('确定将该成员设为管理员？管理员可以审批店铺申请、管理成员权限。')) return;
  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('users?id=eq.' + encodeURIComponent(userId), 'PATCH', { role: 'admin' });
    }
    // 更新本地缓存
    const users = Cache.get('all_users', []);
    const u = users.find(x => x.id === userId);
    if (u) { u.role = 'admin'; Cache.set('all_users', users); }
    showToast('✅ 已设为管理员', 'success');
    renderAdmin();
  } catch(e) {
    showToast('操作失败：' + e.message, 'error');
  }
}

async function revokeAdmin(userId) {
  if (!confirm('确定取消该成员的管理员身份？取消后将变为普通成员。')) return;
  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('users?id=eq.' + encodeURIComponent(userId), 'PATCH', { role: 'member' });
    }
    // 更新本地缓存
    const users = Cache.get('all_users', []);
    const u = users.find(x => x.id === userId);
    if (u) { u.role = 'member'; Cache.set('all_users', users); }
    showToast('✅ 已取消管理员身份', 'success');
    renderAdmin();
  } catch(e) {
    showToast('操作失败：' + e.message, 'error');
  }
}


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

// ============================================
//  页面：跨境产品成本
// ============================================
function renderCostCross() {
  const pg = document.getElementById('page-cost-cross');
  const crossShops = DB.getShops().filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));

  // 订单汇总：成本从商品成本库实时匹配，运费优先使用店铺统一运费
  let allOrders = [];
  // 预建 SKU → 成本智能查找函数（双边提取基础部分匹配）
  const findCostCross = _buildCostFinder();
  crossShops.forEach(shop => {
    const globalShipping = CBShippingRateDB.get(shop.id); // null=按货号，数字=统一运费
    CBOrderDB.getAll(shop.id).forEach(o => {
      const cancelled = (o.sale_amount||0) === 0;
      const matched = findCostCross(o.sku) || null;
      // 整条作废：成本、运费全部为 0
      const cost     = cancelled ? 0 : (matched ? (matched.cost||0) : (o.cost||0));
      const shipping = cancelled ? 0 : (globalShipping !== null ? globalShipping : (matched ? (matched.shipping||0) : (o.shipping||0)));
      allOrders.push({ ...o, cost, shipping, cancelled, shopId: shop.id, shopName: shop.name, shopColor: shop.color, matched_name: matched?.name||'' });
    });
  });
  allOrders.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // sale_amount=0 的订单视为"作废/未发货"，不计入汇总
  const validAllOrders = allOrders.filter(o => (o.sale_amount||0) > 0);
  const cancelledAllCount = allOrders.length - validAllOrders.length;

  const totalSale = validAllOrders.reduce((s,o) => s+(o.sale_amount||0), 0);
  const totalCost = validAllOrders.reduce((s,o) => s+(o.cost||0), 0);
  const totalShip = validAllOrders.reduce((s,o) => s+(o.shipping||0), 0);
  const totalProfit = totalSale - totalCost - totalShip;

  // 各店铺订单数统计（用于提示）
  const shopOrderCounts = {};
  crossShops.forEach(shop => {
    shopOrderCounts[shop.id] = CBOrderDB.getAll(shop.id).length;
  });
  const totalOrderCount = Object.values(shopOrderCounts).reduce((s,c) => s+c, 0);
  const emptyShops = crossShops.filter(s => shopOrderCounts[s.id] === 0);

  // 退货退款汇总
  let totalRefundAmt = 0, totalRefundQty = 0, totalRefundCnt = 0;
  crossShops.forEach(shop => {
    const rs = CBRefundDB.getStats(shop.id);
    totalRefundAmt += rs.totalRefundAmt;
    totalRefundQty += rs.totalRefundQty;
    totalRefundCnt += rs.count;
  });
  const globalRefundRate = totalSale > 0 ? (totalRefundAmt / totalSale * 100) : 0;

  pg.innerHTML = `
    <div class="page-header">
      <h1>💰 跨境产品成本</h1>
      <p>维护商品货号成本，录入订单时自动匹配成本并计算利润</p>
    </div>
    ${crossShops.length === 0 ? `
    <div style="text-align:center;padding:40px 20px;color:#475569">
      <div style="font-size:32px;margin-bottom:12px">🏪</div>
      <div style="font-size:15px;margin-bottom:8px">暂无跨境店铺</div>
      <button class="btn-primary" onclick="navigate('shops')">去添加店铺</button>
    </div>` : ''}
    ${crossShops.length > 0 && emptyShops.length > 0 ? `
    <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:#fbbf24;display:flex;align-items:flex-start;gap:10px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>
        <div style="font-weight:600;margin-bottom:2px">以下 ${emptyShops.length} 个店铺尚未录入订单数据，汇总中暂不包含这些店铺：</div>
        <div style="color:#e2e8f0;font-size:12px">${emptyShops.map(s=>`<span style="color:${s.color||'#a78bfa'}">${s.name}</span>`).join('、')}</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:4px">请进入各店铺详情 → "订单列表" 标签录入订单后，此页面汇总数据会自动更新</div>
      </div>
    </div>` : ''}
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">总销售额</div><div class="stat-value" style="color:#f59e0b">$${totalSale.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">总产品成本</div><div class="stat-value" style="color:#f87171">$${totalCost.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-icon">🚚</div><div class="stat-label">总物流成本</div><div class="stat-value" style="color:#fb923c">$${totalShip.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">总净利润</div><div class="stat-value" style="color:${totalProfit>=0?'#34d399':'#f87171'}">$${totalProfit.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-icon">%</div><div class="stat-label">综合利润率</div><div class="stat-value" style="color:${totalSale>0&&totalProfit/totalSale>=0.2?'#34d399':totalSale>0&&totalProfit/totalSale>=0?'#fbbf24':'#f87171'}">${totalSale>0?(totalProfit/totalSale*100).toFixed(1)+'%':'-'}</div></div>
      <div class="stat-card"><div class="stat-icon">🛒</div><div class="stat-label">总订单数</div><div class="stat-value">${validAllOrders.length} 单${cancelledAllCount>0?`<span style="font-size:11px;color:#475569;font-weight:400;margin-left:4px">(${cancelledAllCount}作废)</span>`:''}</div></div>
      <div class="stat-card" style="border-left:3px solid #f87171"><div class="stat-icon">↩️</div><div class="stat-label">退款总额</div><div class="stat-value" style="color:#f87171">$${totalRefundAmt.toFixed(2)}</div></div>
      <div class="stat-card" style="border-left:3px solid ${globalRefundRate<=5?'#34d399':globalRefundRate<=15?'#fbbf24':'#f87171'}"><div class="stat-icon">📉</div><div class="stat-label">综合退款率</div><div class="stat-value" style="color:${globalRefundRate<=5?'#34d399':globalRefundRate<=15?'#fbbf24':'#f87171'}">${globalRefundRate.toFixed(1)}%</div></div>
    </div>

    <!-- ===== 商品成本管理（全平台共用） ===== -->
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="card-title" style="margin:0">📦 跨境商品成本库</span>
          <span style="font-size:12px;color:#64748b">全平台通用 · 所有跨境店铺共用此成本库</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" onclick="openAddCBProductCostModal()">+ 添加货号</button>
          <button class="btn-secondary btn-sm" onclick="openImportCBProductCostModal()">📤 批量导入</button>
        </div>
      </div>
      ${(() => {
        const prods = CBProductCostDB.getAll();
        return prods.length === 0
          ? `<div style="text-align:center;color:#475569;padding:20px 0;font-size:13px">暂无商品成本记录，点击"添加货号"维护产品成本</div>`
          : `<div class="table-wrap"><table>
              <thead><tr><th style="width:60px">图片</th><th>货号(SKU)</th><th>商品名称</th><th>产品成本($)</th><th>运费($)</th><th>总成本($)</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>
                ${prods.map(p => `<tr>
                  <td style="text-align:center;padding:6px">
                    ${p.image
                      ? `<img src="${p.image}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #334155;cursor:pointer" onclick="showCBPCImagePreview('${p.id}')" title="点击查看大图">`
                      : `<div onclick="openEditCBProductCostModal('${p.id}')" title="点击上传图片" style="width:44px;height:44px;border-radius:6px;border:1px dashed #475569;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#475569;font-size:18px;margin:0 auto">＋</div>`}
                  </td>
                  <td style="font-family:monospace;color:#a78bfa;font-weight:700">${p.sku||'-'}</td>
                  <td style="max-width:150px">${p.name||'-'}</td>
                  <td style="color:#f87171">${(p.cost||0).toFixed(2)}</td>
                  <td style="color:#fb923c">${(p.shipping||0).toFixed(2)}</td>
                  <td style="color:#fbbf24;font-weight:700">${((p.cost||0)+(p.shipping||0)).toFixed(2)}</td>
                  <td style="font-size:11px;color:#64748b">${p.note||'-'}</td>
                  <td style="white-space:nowrap">
                    <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer" onclick="openEditCBProductCostModal('${p.id}')">编辑</button>
                    <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeCBProductCost('${p.id}')">删</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>`;
      })()}
    </div>

    <!-- 添加/编辑商品成本弹窗（全局唯一，优化版） -->
    <div id="modal-cbpc-global" class="modal" style="display:none">
      <div class="modal-content" style="max-width:520px">
        <div class="modal-header">
          <h3 id="cbpc-modal-title-global">添加货号成本</h3>
          <button onclick="closeModal('modal-cbpc-global')" class="close-btn">✕</button>
        </div>
        <div style="padding:16px;display:grid;gap:12px">
          <!-- 货号 + 实时重复提示 -->
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">货号(SKU) <span style="color:#f87171">*</span></label>
            <input type="text" id="cbpc-sku-global" class="input-field" placeholder="如：ABC-001（支持大写）" autofocus
              oninput="this.value=this.value.toUpperCase();_cbpcCheckDupeSku(this.value)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cbpc-name-global').focus();}">
            <div id="cbpc-sku-tip-global" style="font-size:11px;margin-top:3px;min-height:14px"></div>
          </div>
          <!-- 商品名称 -->
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品名称（可选）</label>
            <input type="text" id="cbpc-name-global" class="input-field" placeholder="款式描述，便于查找"
              onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cbpc-cost-global').focus();}">
          </div>
          <!-- 成本 + 运费（并排，视觉强调） -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">产品成本($) <span style="color:#f87171">*</span></label>
              <input type="number" id="cbpc-cost-global" class="input-field" placeholder="0.00" step="0.01" min="0"
                style="font-size:16px;font-weight:700;color:#f87171"
                onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cbpc-ship-global').focus();}">
            </div>
            <div>
              <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">运费($) <span style="color:#f87171">*</span></label>
              <input type="number" id="cbpc-ship-global" class="input-field" placeholder="0.00" step="0.01" min="0"
                style="font-size:16px;font-weight:700;color:#fb923c"
                onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cbpc-note-global').focus();}">
            </div>
          </div>
          <!-- 总成本实时预览 -->
          <div id="cbpc-total-preview-global" style="background:#1e293b;border-radius:6px;padding:8px 12px;font-size:12px;color:#64748b;display:none">
            总成本：<span id="cbpc-total-val-global" style="color:#fbbf24;font-weight:700;font-size:14px">$0.00</span>
          </div>
          <!-- 备注 -->
          <div>
            <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注（可选）</label>
            <input type="text" id="cbpc-note-global" class="input-field" placeholder="爆款 / 新品 / 季节款等"
              onkeydown="if(event.key==='Enter'){event.preventDefault();saveCBProductCost(false);}">
          </div>
          <!-- 图片（折叠式，减少视觉干扰） -->
          <details style="background:#0f172a;border-radius:8px;border:1px solid #1e293b">
            <summary style="padding:8px 12px;font-size:12px;color:#64748b;cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              商品图片（可选，点击展开上传）
            </summary>
            <div style="padding:10px">
              <div id="cbpc-img-zone-global"
                onclick="document.getElementById('cbpc-img-input-global').click()"
                ondragover="event.preventDefault();this.style.borderColor='#a78bfa'"
                ondragleave="this.style.borderColor='#475569'"
                ondrop="handleCBPCImageDrop(event,'global')"
                style="border:2px dashed #475569;border-radius:10px;min-height:80px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;transition:border-color .2s">
                <div id="cbpc-img-placeholder-global" style="display:flex;flex-direction:column;align-items:center;gap:5px;color:#475569;font-size:12px;pointer-events:none">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span>点击或拖拽图片</span>
                </div>
                <img id="cbpc-img-preview-global" src="" style="display:none;width:100%;height:80px;object-fit:contain;border-radius:8px" alt="商品图">
                <button id="cbpc-img-remove-global" onclick="removeCBPCImagePreview(event,'global')" style="display:none;position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#f87171;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1;padding:0">✕</button>
              </div>
              <input type="file" id="cbpc-img-input-global" accept="image/*" style="display:none" onchange="handleCBPCImageSelect(event,'global')">
              <input type="hidden" id="cbpc-img-data-global">
            </div>
          </details>
          <input type="hidden" id="cbpc-edit-id-global">
          <!-- 操作按钮：保存并继续 + 保存关闭 -->
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn-secondary" onclick="closeModal('modal-cbpc-global')">取消</button>
            <button class="btn-secondary" id="cbpc-btn-continue-global" onclick="saveCBProductCost(true)" style="display:none;color:#06b6d4;border-color:rgba(6,182,212,0.4)">保存并继续添加</button>
            <button class="btn-primary" onclick="saveCBProductCost(false)">保存</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量导入商品成本弹窗（全局唯一） -->
    <div id="modal-cbpc-import-global" class="modal-overlay" style="display:none">
      <div class="modal" style="max-width:560px;width:95%">
        <div class="modal-header">
          <h3>批量导入商品成本</h3>
          <button class="modal-close" onclick="closeModal('modal-cbpc-import-global')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#64748b;line-height:1.9">
          <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明</div>
          <div>列顺序：<span style="color:#f87171;font-family:monospace">货号, 商品名称, 产品成本($), 运费($), 备注</span></div>
          <div style="color:#475569">其中"备注"列可以留空，其余前4列必填</div>
          <div style="color:#fbbf24;font-family:monospace;margin-top:4px">示例：ABC-001, 连衣裙A款, 8.50, 3.00, 爆款</div>
          <div style="margin-top:8px">
            <button onclick="downloadCBProductCostTemplate()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              下载导入模板（CSV）
            </button>
          </div>
        </div>
        <!-- CSV文件上传区域 -->
        <div id="cbpc-file-drop" onclick="document.getElementById('cbpc-file-input').click()"
          style="border:2px dashed #334155;border-radius:10px;padding:14px;text-align:center;cursor:pointer;margin-bottom:10px;transition:border-color .2s"
          ondragover="event.preventDefault();this.style.borderColor='#7c3aed'"
          ondragleave="this.style.borderColor='#334155'"
          ondrop="handleCBPCFileDrop(event)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:5px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="color:#64748b;font-size:13px">点击或拖拽上传文件</div>
          <div style="color:#475569;font-size:11px;margin-top:3px">支持 CSV / Excel（.xlsx .xls .ods）/ TXT，或直接粘贴</div>
        </div>
        <input type="file" id="cbpc-file-input" accept=".csv,.txt,.xlsx,.xls,.ods,.xlsm" style="display:none" onchange="handleCBPCFileSelect(this)">
        <div style="color:#64748b;font-size:12px;margin-bottom:6px">或手动粘贴数据（一行一条）：</div>
        <textarea id="cbpc-import-text-global" style="width:100%;height:120px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="货号,商品名称,成本,运费,备注（备注可不填）&#10;ABC-001,连衣裙A款,8.50,3.00,爆款&#10;ABC-002,T恤B款,6.00,2.50,"></textarea>
        <div id="cbpc-import-preview-global" style="margin-top:8px;font-size:12px;color:#64748b"></div>
        <div class="modal-btns">
          <button class="btn-secondary" onclick="closeModal('modal-cbpc-import-global')">取消</button>
          <button class="btn-primary" onclick="importCBProductCost()">导入</button>
        </div>
      </div>
    </div>

    <!-- ===== 各店铺订单概览 ===== -->
    ${crossShops.length > 0 ? `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">各店铺订单概览</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>店铺</th><th>平台</th><th>订单数</th><th>销售额($)</th><th>产品成本($)</th><th>物流费($)</th><th>净利润($)</th><th>利润率</th></tr></thead>
          <tbody>
            ${crossShops.map(shop => {
              const gsr = CBShippingRateDB.get(shop.id);
              const ords = CBOrderDB.getAll(shop.id).map(o => {
                const m = CBProductCostDB.findBySku(o.sku);
                const shipping = gsr !== null ? gsr : (m?(m.shipping||0):(o.shipping||0));
                return { ...o, cost: m?(m.cost||0):(o.cost||0), shipping };

              });
              const s2 = ords.reduce((s,o)=>s+(o.sale_amount||0),0);
              const c2 = ords.reduce((s,o)=>s+(o.cost||0),0);
              const sh = ords.reduce((s,o)=>s+(o.shipping||0),0);
              const pr = s2-c2-sh;
              const mg = s2>0?(pr/s2*100).toFixed(1)+'%':'-';
              return `<tr>
                <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${shop.color};display:inline-block"></span>${shop.name}</span></td>
                <td><span class="badge badge-blue">${shop.platform}</span></td>
                <td>${ords.length}</td>
                <td style="color:#f59e0b;font-weight:700">${s2.toFixed(2)}</td>
                <td style="color:#f87171">${c2.toFixed(2)}</td>
                <td style="color:#fb923c">${sh.toFixed(2)}</td>
                <td style="color:${pr>=0?'#34d399':'#f87171'};font-weight:700">${pr.toFixed(2)}</td>
                <td style="color:${parseFloat(mg)>=20?'#34d399':parseFloat(mg)>=0?'#fbbf24':'#f87171'}">${mg}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- ===== 所有订单明细 ===== -->
    <div class="card">
      <div class="card-title">订单明细（所有跨境店铺）</div>
      ${allOrders.length === 0
        ? `<div style="text-align:center;color:#475569;padding:32px 0"><div style="font-size:28px;margin-bottom:8px">📋</div><div>暂无订单数据</div><div style="font-size:12px;margin-top:8px">请进入各跨境店铺详情页录入订单</div></div>`
        : `<div class="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>店铺</th><th>商品</th><th>商品名称</th><th>销售额($)</th><th>产品成本($)</th><th>物流费($)</th><th>净利润($)</th><th>利润率</th></tr></thead>
              <tbody>
                ${allOrders.slice(0,100).map(o => {
                  const pr = (o.sale_amount||0)-(o.cost||0)-(o.shipping||0);
                  const mg = o.sale_amount>0?(pr/o.sale_amount*100).toFixed(1)+'%':'-';
                  const prodInfo = CBProductCostDB.findBySku(o.sku);
                  const hasMatch = !!prodInfo;
                  const imgHtml = prodInfo?.image
                    ? `<img src="${prodInfo.image}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:6px;border:1px solid #334155" onclick="showCBPCImagePreview('${prodInfo.id}','${o.shopId}')" title="点击查看大图" style="cursor:pointer">`
                    : '';
                  return `<tr>
                    <td style="white-space:nowrap">${o.date||'-'}</td>
                    <td><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:${o.shopColor};display:inline-block"></span>${o.shopName}</span></td>
                    <td style="white-space:nowrap">${imgHtml}<span style="font-family:monospace;color:${hasMatch?'#a78bfa':'#f87171'};font-weight:600" title="${hasMatch?'已匹配成本':'未找到匹配货号，请先在商品成本库添加'}">${o.sku||'-'}${!o.sku?'':hasMatch?' ✓':' ⚠'}</span></td>
                    <td style="font-size:12px">${o.matched_name||o.product_name||'-'}</td>
                    <td style="color:#f59e0b;font-weight:700">${(o.sale_amount||0).toFixed(2)}</td>
                    <td style="color:#f87171">${(o.cost||0).toFixed(2)}</td>
                    <td style="color:#fb923c">${(o.shipping||0).toFixed(2)}</td>
                    <td style="color:${pr>=0?'#34d399':'#f87171'};font-weight:700">${pr.toFixed(2)}</td>
                    <td style="color:${parseFloat(mg)>=20?'#34d399':parseFloat(mg)>=0?'#fbbf24':'#f87171'}">${mg}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
            ${allOrders.length>100?`<div style="text-align:center;color:#475569;padding:12px;font-size:12px">仅显示最近 100 条，共 ${allOrders.length} 条</div>`:''}
          </div>`}
    </div>
  `;
}

// ============================================
//  页面：国内产品成本
// ============================================
function renderCostDomestic() {
  const pg = document.getElementById('page-cost-domestic');
  const domesticShops = DB.getShops().filter(s => DOMESTIC_PLATFORMS.has(s.platform));

  pg.innerHTML = `
    <div class="page-header">
      <h1>🏪 国内产品成本</h1>
      <p>为每个商品维护成本信息（采购成本 / 包装费 / 其他成本），结合营业额自动计算利润</p>
    </div>

    ${domesticShops.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🏪</div><p>暂无国内店铺</p><button class="btn-primary" onclick="openAddShop()">添加店铺</button></div>`
      : domesticShops.map(shop => {
          const products = ShopProductsDB.getAll(shop.id);
          const totalCostAmt = products.reduce((s,p) => s+(p.cost||0)+(p.pack_cost||0)+(p.other_cost||0), 0);
          return `
          <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="width:10px;height:10px;border-radius:50%;background:${shop.color};display:inline-block"></span>
                <span style="font-size:15px;font-weight:700;color:#e2e8f0">${shop.name}</span>
                <span class="badge badge-blue">${shop.platform}</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-size:12px;color:#64748b">${products.length} 个商品 · 综合成本 ¥${totalCostAmt.toFixed(2)}</span>
                <button class="btn-secondary btn-sm" onclick="openAddDomesticCostModal('${shop.id}')">+ 添加商品</button>
                <button class="btn-secondary btn-sm" onclick="openImportDomesticCostModal('${shop.id}')">📤 导入模板</button>
              </div>
            </div>
            ${products.length === 0
              ? `<div style="text-align:center;color:#475569;padding:20px 0;font-size:13px">暂无商品成本，点击"添加商品"或"导入模板"开始</div>`
              : `<div class="table-wrap">
                  <table>
                    <thead><tr><th>商品名称</th><th>商品ID</th><th>SKU</th><th>采购成本(¥)</th><th>包装费(¥)</th><th>其他成本(¥)</th><th>综合成本(¥)</th><th>备注</th><th>操作</th></tr></thead>
                    <tbody>
                      ${products.map(p => {
                        const tot = (p.cost||0)+(p.pack_cost||0)+(p.other_cost||0);
                        return `<tr>
                          <td style="font-weight:600">${p.name}</td>
                          <td style="font-size:11px;color:#64748b">${p.product_id||'-'}</td>
                          <td style="font-size:11px;color:#64748b">${p.sku||'-'}</td>
                          <td style="color:#f87171">¥${(p.cost||0).toFixed(2)}</td>
                          <td style="color:#fb923c">¥${(p.pack_cost||0).toFixed(2)}</td>
                          <td style="color:#fbbf24">¥${(p.other_cost||0).toFixed(2)}</td>
                          <td style="color:#f87171;font-weight:700">¥${tot.toFixed(2)}</td>
                          <td style="font-size:11px;color:#94a3b8">${p.note||'-'}</td>
                          <td>
                            <button style="font-size:11px;color:#94a3b8;background:transparent;border:none;cursor:pointer" onclick="openEditDomesticCostModal('${shop.id}','${p.id}')">编辑</button>
                            <button style="font-size:11px;color:#f87171;background:transparent;border:none;cursor:pointer" onclick="removeDomesticCostProduct('${shop.id}','${p.id}')">删</button>
                          </td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>`}
            <!-- 添加/编辑弹窗 -->
            <div id="modal-dc-${shop.id}" class="modal" style="display:none">
              <div class="modal-content" style="max-width:480px">
                <div class="modal-header">
                  <h3 id="dc-modal-title-${shop.id}">添加商品成本</h3>
                  <button onclick="closeModal('modal-dc-${shop.id}')" class="close-btn">✕</button>
                </div>
                <div style="padding:16px;display:grid;gap:10px">
                  <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品名称 *</label>
                    <input type="text" id="dc-name-${shop.id}" class="input-field" placeholder="如：连衣裙A款"></div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">商品ID</label>
                      <input type="text" id="dc-pid-${shop.id}" class="input-field" placeholder="平台商品ID"></div>
                    <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">SKU</label>
                      <input type="text" id="dc-sku-${shop.id}" class="input-field" placeholder="货号"></div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                    <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">采购成本(¥)</label>
                      <input type="number" id="dc-cost-${shop.id}" class="input-field" placeholder="0.00" step="0.01"></div>
                    <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">包装费(¥)</label>
                      <input type="number" id="dc-pack-${shop.id}" class="input-field" placeholder="0.00" step="0.01"></div>
                    <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">其他成本(¥)</label>
                      <input type="number" id="dc-other-${shop.id}" class="input-field" placeholder="0.00" step="0.01"></div>
                  </div>
                  <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">备注</label>
                    <input type="text" id="dc-note-${shop.id}" class="input-field" placeholder="可选"></div>
                  <input type="hidden" id="dc-edit-id-${shop.id}">
                  <div style="display:flex;justify-content:flex-end;gap:10px">
                    <button class="btn-secondary" onclick="closeModal('modal-dc-${shop.id}')">取消</button>
                    <button class="btn-primary" onclick="saveDomesticCostProduct('${shop.id}')">保存</button>
                  </div>
                </div>
              </div>
            </div>
            <!-- 导入弹窗 -->
            <div id="modal-dc-import-${shop.id}" class="modal" style="display:none">
              <div class="modal-content" style="max-width:560px">
                <div class="modal-header">
                  <h3>导入商品成本</h3>
                  <button onclick="closeModal('modal-dc-import-${shop.id}')" class="close-btn">✕</button>
                </div>
                <div style="padding:16px">
                  <div style="background:#1e293b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#64748b;line-height:1.9">
                    <div style="color:#a78bfa;font-weight:600;margin-bottom:6px">📋 格式说明（CSV / 粘贴均支持）</div>
                    <div>列顺序：<span style="color:#f87171;font-family:monospace">商品名称, 商品ID, SKU, 采购成本, 包装费, 其他成本, 备注</span></div>
                    <div>示例：<span style="color:#fbbf24;font-family:monospace">连衣裙A款, 123456, SKU-001, 15.00, 2.00, 0.50, 主推款</span></div>
                  </div>
                  <div style="margin-bottom:12px">
                    <button onclick="downloadDomesticCostTemplate()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.1);color:#34d399;font-size:12px;cursor:pointer">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      下载国内商品成本模板（CSV）
                    </button>
                  </div>
                  <!-- 文件拖拽上传区 -->
                  <div onclick="document.getElementById('dc-file-input-${shop.id}').click()"
                    ondragover="event.preventDefault();this.style.borderColor='#7c3aed'"
                    ondragleave="this.style.borderColor='#334155'"
                    ondrop="(function(e){e.preventDefault();const f=e.dataTransfer.files[0];if(f){readFileAsCSVText(f).then(t=>{document.getElementById('dc-import-text-${shop.id}').value=t;showToast('已读取"'+f.name+'"，点击导入处理','success');}).catch(err=>showToast('读取失败:'+err.message,'error'));}})(event)"
                    style="border:2px dashed #334155;border-radius:10px;padding:12px;text-align:center;cursor:pointer;margin-bottom:10px;transition:border-color .2s">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" style="margin-bottom:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <div style="color:#64748b;font-size:12px">点击或拖拽上传文件（CSV / Excel / TXT）</div>
                    <input type="file" id="dc-file-input-${shop.id}" accept=".csv,.txt,.xlsx,.xls,.ods,.xlsm" style="display:none"
                      onchange="(function(e){const f=e.target.files[0];if(f){readFileAsCSVText(f).then(t=>{document.getElementById('dc-import-text-${shop.id}').value=t;showToast('已读取"'+f.name+'"，点击导入处理','success');}).catch(err=>showToast('读取失败:'+err.message,'error'));}e.target.value=''})(event)">
                  </div>
                  <textarea id="dc-import-text-${shop.id}" style="width:100%;height:140px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;padding:10px;font-family:monospace;font-size:12px;resize:vertical" placeholder="粘贴数据..."></textarea>
                  <div id="dc-import-preview-${shop.id}" style="margin-top:8px;font-size:12px;color:#64748b"></div>
                  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px">
                    <button class="btn-secondary" onclick="closeModal('modal-dc-import-${shop.id}')">取消</button>
                    <button class="btn-primary" onclick="importDomesticCostProducts('${shop.id}')">导入</button>
                  </div>
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
  `;
}

// ---- 国内商品成本 CRUD 函数 ----
function openAddDomesticCostModal(shopId) {
  const el = id => document.getElementById(id+'-'+shopId);
  document.getElementById('dc-modal-title-'+shopId).textContent = '添加商品成本';
  ['name','pid','sku','cost','pack','other','note'].forEach(k=>{ const e=el('dc-'+k); if(e) e.value=''; });
  if (el('dc-edit-id')) el('dc-edit-id').value = '';
  document.getElementById('modal-dc-'+shopId).style.display = 'flex';
}

function openEditDomesticCostModal(shopId, productId) {
  const prod = ShopProductsDB.getAll(shopId).find(p => p.id === productId);
  if (!prod) return;
  const el = id => document.getElementById(id+'-'+shopId);
  document.getElementById('dc-modal-title-'+shopId).textContent = '编辑商品成本';
  if (el('dc-name'))  el('dc-name').value  = prod.name||'';
  if (el('dc-pid'))   el('dc-pid').value   = prod.product_id||'';
  if (el('dc-sku'))   el('dc-sku').value   = prod.sku||'';
  if (el('dc-cost'))  el('dc-cost').value  = prod.cost||'';
  if (el('dc-pack'))  el('dc-pack').value  = prod.pack_cost||'';
  if (el('dc-other')) el('dc-other').value = prod.other_cost||'';
  if (el('dc-note'))  el('dc-note').value  = prod.note||'';
  if (el('dc-edit-id')) el('dc-edit-id').value = productId;
  document.getElementById('modal-dc-'+shopId).style.display = 'flex';
}

function saveDomesticCostProduct(shopId) {
  const el = id => document.getElementById(id+'-'+shopId);
  const name = el('dc-name')?.value?.trim();
  if (!name) { showToast('请输入商品名称', 'error'); return; }
  const editId = el('dc-edit-id')?.value;
  const data = {
    name,
    product_id: el('dc-pid')?.value?.trim()||'',
    sku: el('dc-sku')?.value?.trim()||'',
    cost: parseFloat(el('dc-cost')?.value)||0,
    pack_cost: parseFloat(el('dc-pack')?.value)||0,
    other_cost: parseFloat(el('dc-other')?.value)||0,
    note: el('dc-note')?.value?.trim()||'',
  };
  if (editId) {
    ShopProductsDB.update(shopId, editId, data);
  } else {
    data.id = 'prod_' + Date.now();
    ShopProductsDB.add(shopId, data);
  }
  closeModal('modal-dc-'+shopId);
  showToast('已保存', 'success');
  renderCostDomestic();
}

function removeDomesticCostProduct(shopId, productId) {
  if (!confirm('确定删除该商品成本信息？')) return;
  ShopProductsDB.remove(shopId, productId);
  showToast('已删除', 'info');
  renderCostDomestic();
}

function openImportDomesticCostModal(shopId) {
  const el = document.getElementById('dc-import-text-'+shopId);
  if (el) el.value = '';
  const prev = document.getElementById('dc-import-preview-'+shopId);
  if (prev) prev.textContent = '';
  document.getElementById('modal-dc-import-'+shopId).style.display = 'flex';
}

function importDomesticCostProducts(shopId) {
  const textEl = document.getElementById('dc-import-text-'+shopId);
  const prevEl = document.getElementById('dc-import-preview-'+shopId);
  if (!textEl) return;
  const lines = textEl.value.trim().split('\n').map(l=>l.trim()).filter(l=>l && !/^(商品名|name)/i.test(l));
  let count = 0, errors = 0;
  lines.forEach(line => {
    const parts = line.split(/[,\t]/).map(s=>s.trim());
    if (!parts[0]) { errors++; return; }
    ShopProductsDB.add(shopId, {
      id: 'prod_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      name: parts[0], product_id: parts[1]||'', sku: parts[2]||'',
      cost: parseFloat(parts[3])||0, pack_cost: parseFloat(parts[4])||0, other_cost: parseFloat(parts[5])||0,
      note: parts[6]||'',
    });
    count++;
  });
  if (prevEl) prevEl.textContent = `✅ 成功导入 ${count} 个商品${errors>0?`，${errors} 条已跳过`:''}`;
  if (count > 0) {
    closeModal('modal-dc-import-'+shopId);
    showToast(`✅ 已导入 ${count} 个商品`, 'success');
    renderCostDomestic();
  }
}

function downloadDomesticCostTemplate() {
  const csv = '商品名称,商品ID,SKU,采购成本(¥),包装费(¥),其他成本(¥),备注\n连衣裙A款,123456,SKU-001,15.00,2.00,0.50,主推款\nT恤B款,789012,SKU-002,8.00,1.00,0,\n';
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '国内商品成本导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
}

// ============================================
//  跨境商品成本 CRUD（CBProductCostDB）
// ============================================

// 图片上传辅助函数
function handleCBPCImageSelect(event, shopId) {
  const file = event.target.files[0];
  if (!file) return;
  _loadCBPCImageFile(file, shopId);
}

function handleCBPCImageDrop(event, shopId) {
  event.preventDefault();
  const zone = document.getElementById('cbpc-img-zone-'+shopId);
  if (zone) zone.style.borderColor = '#475569';
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('请上传图片文件', 'error'); return; }
  _loadCBPCImageFile(file, shopId);
}

function _loadCBPCImageFile(file, shopId) {
  if (file.size > 2 * 1024 * 1024) { showToast('图片不能超过 2MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    // 压缩到最大 400px 宽/高，节省 localStorage 空间
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 400;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      _setCBPCImagePreview(shopId, dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function _setCBPCImagePreview(shopId, dataUrl) {
  const preview = document.getElementById('cbpc-img-preview-'+shopId);
  const placeholder = document.getElementById('cbpc-img-placeholder-'+shopId);
  const removeBtn = document.getElementById('cbpc-img-remove-'+shopId);
  const dataInput = document.getElementById('cbpc-img-data-'+shopId);
  if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
  if (placeholder) placeholder.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'block';
  if (dataInput) dataInput.value = dataUrl;
}

function removeCBPCImagePreview(event, shopId) {
  event.stopPropagation();
  const preview = document.getElementById('cbpc-img-preview-'+shopId);
  const placeholder = document.getElementById('cbpc-img-placeholder-'+shopId);
  const removeBtn = document.getElementById('cbpc-img-remove-'+shopId);
  const dataInput = document.getElementById('cbpc-img-data-'+shopId);
  const fileInput = document.getElementById('cbpc-img-input-'+shopId);
  if (preview) { preview.src=''; preview.style.display='none'; }
  if (placeholder) placeholder.style.display='flex';
  if (removeBtn) removeBtn.style.display='none';
  if (dataInput) dataInput.value='';
  if (fileInput) fileInput.value='';
}

// 查看大图
function showCBPCImagePreview(productId) {
  const prod = CBProductCostDB.getAll().find(p => p.id === productId);
  if (!prod || !prod.image) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.onclick = () => document.body.removeChild(overlay);
  const img = document.createElement('img');
  img.src = prod.image;
  img.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.7)';
  const info = document.createElement('div');
  info.style.cssText = 'position:absolute;bottom:32px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#e2e8f0;padding:8px 18px;border-radius:20px;font-size:13px;white-space:nowrap';
  info.textContent = (prod.sku||'') + (prod.name ? ' · '+prod.name : '');
  overlay.appendChild(img);
  overlay.appendChild(info);
  document.body.appendChild(overlay);
}

function openAddCBProductCostModal() {
  const el = id => document.getElementById(id+'-global');
  if (!el('cbpc-sku')) return;
  document.getElementById('cbpc-modal-title-global').textContent = '➕ 添加货号成本';
  ['sku','name','note'].forEach(k => { const e = el('cbpc-'+k); if(e) e.value=''; });
  ['cost','ship'].forEach(k => { const e = el('cbpc-'+k); if(e) e.value=''; });
  el('cbpc-edit-id').value = '';
  // 重置图片
  const preview = el('cbpc-img-preview'); if(preview){preview.src='';preview.style.display='none';}
  const placeholder = el('cbpc-img-placeholder'); if(placeholder) placeholder.style.display='flex';
  const removeBtn = el('cbpc-img-remove'); if(removeBtn) removeBtn.style.display='none';
  const dataInput = el('cbpc-img-data'); if(dataInput) dataInput.value='';
  const fileInput = el('cbpc-img-input'); if(fileInput) fileInput.value='';
  // 重置提示
  const skuTip = el('cbpc-sku-tip'); if(skuTip) skuTip.textContent = '';
  const totalPrev = el('cbpc-total-preview'); if(totalPrev) totalPrev.style.display='none';
  // 显示"保存并继续"按钮
  const contBtn = document.getElementById('cbpc-btn-continue-global'); if(contBtn) contBtn.style.display='inline-block';
  const modal = document.getElementById('modal-cbpc-global');
  modal.style.display = 'flex';
  setTimeout(() => {
    const mc = modal.querySelector('.modal-content');
    if (mc) mc.scrollTop = 0;
    const skuInput = document.getElementById('cbpc-sku-global');
    if (skuInput) skuInput.focus();
  }, 50);
  // 绑定实时总成本预览
  _cbpcBindTotalPreview();
}

function openEditCBProductCostModal(productId) {
  const prod = CBProductCostDB.getAll().find(p => p.id === productId);
  if (!prod) return;
  const el = id => document.getElementById(id+'-global');
  document.getElementById('cbpc-modal-title-global').textContent = '✏️ 编辑货号成本';
  el('cbpc-sku').value = prod.sku||'';
  el('cbpc-name').value = prod.name||'';
  el('cbpc-cost').value = prod.cost||'';
  el('cbpc-ship').value = prod.shipping||'';
  el('cbpc-note').value = prod.note||'';
  el('cbpc-edit-id').value = productId;
  // 图片回显
  const dataInput = el('cbpc-img-data');
  if (dataInput) dataInput.value = prod.image||'';
  if (prod.image) {
    _setCBPCImagePreview('global', prod.image);
  } else {
    const preview = el('cbpc-img-preview'); if(preview){preview.src='';preview.style.display='none';}
    const placeholder = el('cbpc-img-placeholder'); if(placeholder) placeholder.style.display='flex';
    const removeBtn = el('cbpc-img-remove'); if(removeBtn) removeBtn.style.display='none';
  }
  // 编辑时隐藏"保存并继续"按钮
  const contBtn = document.getElementById('cbpc-btn-continue-global'); if(contBtn) contBtn.style.display='none';
  // 显示总成本预览
  const sku_tip = el('cbpc-sku-tip'); if(sku_tip) sku_tip.textContent = '';
  document.getElementById('modal-cbpc-global').style.display = 'flex';
  _cbpcBindTotalPreview();
  setTimeout(() => { _cbpcUpdateTotalPreview(); }, 50);
}

// 实时检测货号重复
function _cbpcCheckDupeSku(sku) {
  const tip = document.getElementById('cbpc-sku-tip-global');
  if (!tip) return;
  const editId = document.getElementById('cbpc-edit-id-global')?.value || '';
  if (!sku) { tip.textContent = ''; return; }
  const existing = CBProductCostDB.getAll().find(p => p.sku === sku && p.id !== editId);
  if (existing) {
    tip.innerHTML = `<span style="color:#f87171">⚠ 货号已存在：${existing.name||sku}（成本 $${(existing.cost||0).toFixed(2)} + 运费 $${(existing.shipping||0).toFixed(2)}）</span>`;
  } else {
    tip.innerHTML = `<span style="color:#34d399">✓ 货号可用</span>`;
  }
}

// 实时总成本预览
function _cbpcUpdateTotalPreview() {
  const cost = parseFloat(document.getElementById('cbpc-cost-global')?.value) || 0;
  const ship = parseFloat(document.getElementById('cbpc-ship-global')?.value) || 0;
  const prevDiv = document.getElementById('cbpc-total-preview-global');
  const prevVal = document.getElementById('cbpc-total-val-global');
  if (!prevDiv || !prevVal) return;
  if (cost > 0 || ship > 0) {
    prevDiv.style.display = 'block';
    prevVal.textContent = '$' + (cost + ship).toFixed(2);
  } else {
    prevDiv.style.display = 'none';
  }
}

function _cbpcBindTotalPreview() {
  ['cbpc-cost-global','cbpc-ship-global'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = _cbpcUpdateTotalPreview;
  });
}

function saveCBProductCost(continueAdding = false) {
  const el = id => document.getElementById(id+'-global');
  const sku = el('cbpc-sku')?.value?.trim();
  if (!sku) { showToast('请输入货号', 'error'); return; }
  const editId = el('cbpc-edit-id')?.value;
  const imageData = el('cbpc-img-data')?.value || '';
  const data = {
    sku,
    name: el('cbpc-name')?.value?.trim()||'',
    cost: parseFloat(el('cbpc-cost')?.value)||0,
    shipping: parseFloat(el('cbpc-ship')?.value)||0,
    note: el('cbpc-note')?.value?.trim()||'',
    image: imageData,
  };
  if (editId) {
    CBProductCostDB.update(editId, data);
  } else {
    // 检查货号是否重复
    if (CBProductCostDB.findBySku(sku)) {
      showToast('该货号已存在，请直接编辑', 'error'); return;
    }
    data.id = 'cbpc_' + Date.now();
    CBProductCostDB.add(data);
  }
  if (continueAdding) {
    // 清空表单继续添加，不关闭弹窗
    ['sku','name','note'].forEach(k => { const e = document.getElementById('cbpc-'+k+'-global'); if(e) e.value=''; });
    ['cost','ship'].forEach(k => { const e = document.getElementById('cbpc-'+k+'-global'); if(e) e.value=''; });
    document.getElementById('cbpc-edit-id-global').value = '';
    const tip = document.getElementById('cbpc-sku-tip-global'); if(tip) tip.textContent='';
    const prev = document.getElementById('cbpc-total-preview-global'); if(prev) prev.style.display='none';
    // 重置图片
    const dataInp = document.getElementById('cbpc-img-data-global'); if(dataInp) dataInp.value='';
    const imgPrev = document.getElementById('cbpc-img-preview-global'); if(imgPrev){imgPrev.src='';imgPrev.style.display='none';}
    const imgPlhd = document.getElementById('cbpc-img-placeholder-global'); if(imgPlhd) imgPlhd.style.display='flex';
    const imgRm = document.getElementById('cbpc-img-remove-global'); if(imgRm) imgRm.style.display='none';
    showToast('✅ 已保存，请继续添加下一条', 'success');
    setTimeout(() => { const s = document.getElementById('cbpc-sku-global'); if(s) s.focus(); }, 50);
  } else {
    closeModal('modal-cbpc-global');
    showToast('已保存', 'success');
  }
  renderCostCross();
}

function removeCBProductCost(productId) {
  if (!confirm('确定删除该货号成本？\n（已录入的订单中使用此货号的成本将变为0）')) return;
  CBProductCostDB.remove(productId);
  showToast('已删除', 'info');
  renderCostCross();
}

function openImportCBProductCostModal() {
  const el = document.getElementById('cbpc-import-text-global');
  if (el) el.value = '';
  const prev = document.getElementById('cbpc-import-preview-global');
  if (prev) prev.textContent = '';
  openModal('modal-cbpc-import-global');
}

function handleCBPCFileDrop(e) {
  e.preventDefault();
  document.getElementById('cbpc-file-drop').style.borderColor = '#334155';
  const file = e.dataTransfer.files[0];
  if (file) readCBPCFile(file);
}

function handleCBPCFileSelect(input) {
  const file = input.files[0];
  if (file) readCBPCFile(file);
  input.value = '';
}

function readCBPCFile(file) {
  if (!file.name.match(/\.(csv|txt|xlsx|xls|ods|xlsm)$/i)) { showToast('请上传 CSV/Excel 文件', 'error'); return; }
  readFileAsCSVText(file).then(text => {
    const ta = document.getElementById('cbpc-import-text-global');
    if (ta) ta.value = text;
    showToast(`已读取"${file.name}"，点击"导入"开始处理`, 'success');
  }).catch(err => showToast('文件读取失败：' + err.message, 'error'));
}

function importCBProductCost() {
  const textEl = document.getElementById('cbpc-import-text-global');
  const prevEl = document.getElementById('cbpc-import-preview-global');
  if (!textEl) return;
  const lines = textEl.value.trim().split('\n').map(l=>l.trim()).filter(l=>l && !/^货号/.test(l));
  let errors = 0, dupes = 0;
  const newRows = [];
  lines.forEach(line => {
    const parts = line.split(/[,\t]/).map(s=>s.trim());
    if (!parts[0]) { errors++; return; }
    const sku = parts[0];
    if (CBProductCostDB.findBySku(sku)) { dupes++; return; }
    newRows.push({
      id: 'cbpc_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      sku,
      name: parts[1]||'',
      cost: parseFloat(parts[2])||0,
      shipping: parseFloat(parts[3])||0,
      note: parts[4]||'',
      image: '',
    });
  });
  if (newRows.length > 0) CBProductCostDB.batchAdd(newRows); // 批量本地+云端
  const count = newRows.length;
  let msg = `✅ 已导入 ${count} 个货号`;
  if (dupes > 0) msg += `，${dupes} 个已存在跳过`;
  if (errors > 0) msg += `，${errors} 条格式错误`;
  if (prevEl) prevEl.textContent = msg;
  if (count > 0) {
    closeModal('modal-cbpc-import-global');
    showToast(msg, 'success');
    renderCostCross();
  }
}

function downloadCBProductCostTemplate() {
  const csv = '货号(SKU),商品名称,产品成本($),运费($),备注\nABC-001,连衣裙A款,8.50,3.00,爆款\nABC-002,T恤B款,6.00,2.50,\nABC-003,牛仔裤,12.00,4.00,新品\n';
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '跨境商品成本导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
}



