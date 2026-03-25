// ============ 全局状态 ============
let currentPage = 'dashboard';
let currentParam = null;
let charts = {};
let bigScreenMode = false;

// 面包屑配置
const PAGE_META = {
  dashboard:    { label: '数据看板',    icon: '' },
  styles:       { label: '款式分析',    icon: '' },
  revenue:      { label: '营业额统计',  icon: '' },
  profit:       { label: '利润计算',    icon: '' },
  alert:        { label: '预警中心',    icon: '' },
  import:       { label: '数据导入',    icon: '' },
  shops:        { label: '所有店铺',    icon: '' },
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
  setInterval(updateTopbarDate, 60000);

  if (SUPABASE_ENABLED) {
    renderShopNav();
    updateSidebarFooter();
    navigate('dashboard');
    await syncFromSupabase();
    renderShopNav();
    updateSidebarFooter();
    navigate(currentPage, currentParam);
    initRealtime();
    setInterval(async () => {
      await syncFromSupabase();
      renderShopNav();
      updateSidebarFooter();
    }, 5 * 60 * 1000);
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
  let crumbs = `<span class="bc-home">🛍️ SHEIN数据中台</span>`;
  crumbs += `<span class="bc-sep"> › </span>`;
  crumbs += `<span class="bc-cur">${meta.icon} ${meta.label}</span>`;
  if (page === 'shop-detail' && param) {
    const shopName = getShopName(param);
    crumbs = `<span class="bc-home" onclick="navigate('shops')" style="cursor:pointer">🏪 所有店铺</span>`;
    crumbs += `<span class="bc-sep"> › </span>`;
    crumbs += `<span class="bc-cur">${shopName}</span>`;
  }
  bc.innerHTML = crumbs;
}

// ============ 顶栏日期 ============
function updateTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const now = new Date(2026, 2, 24);
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  el.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${days[now.getDay()]}`;
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

// ============ 侧边栏店铺列表 ============
function renderShopNav() {
  const shops = DB.getShops();
  const container = document.getElementById('shop-list-nav');
  container.innerHTML = shops.map(s => `
    <a class="nav-item shop-nav-item" data-page="shop-detail-${s.id}" onclick="navigate('shop-detail','${s.id}')">
      <span class="color-dot" style="background:${s.color}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</span>
    </a>`).join('');
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
function addShop() {
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
  };
  DB.addShop(newShop);  // 使用新方法，直接单条 upsert 到云端
  renderShopNav();
  closeModal('modal-add-shop');
  showToast(`🏪 店铺 "${name}" 添加成功，云端已同步`, 'success');
  document.getElementById('new-shop-name').value = '';
  if (currentPage === 'shops') renderShops();
}

// ============ 删除店铺 ============
function deleteShop(shopId) {
  if (!confirm('确定要删除该店铺及其所有数据吗？此操作不可恢复。')) return;
  DB.removeShop(shopId);  // 使用新方法，同时删云端
  let sales = DB.getSalesData().filter(d => d.shopId !== shopId);
  DB.setSalesData(sales);
  renderShopNav();
  renderShops();
  showToast('🗑️ 店铺已删除，云端已同步', 'info');
}

// ============================================
//  页面：数据看板 Dashboard
// ============================================
function renderDashboard() {
  const pg = document.getElementById('page-dashboard');

  // 先显示骨架屏
  pg.innerHTML = `
    <div class="page-header"><h1>📊 数据看板</h1><p>过去30天综合数据概览</p></div>
    <div class="stat-grid">
      ${Array(4).fill('<div class="skeleton skeleton-stat"></div>').join('')}
    </div>
    <div class="chart-grid-3">
      <div class="card"><div class="skeleton skeleton-chart"></div></div>
      <div class="card"><div class="skeleton skeleton-chart"></div></div>
    </div>`;

  // 稍作延迟后渲染真实内容（模拟加载感）
  setTimeout(() => _renderDashboardContent(pg), 300);
}

function _renderDashboardContent(pg) {
  const allData = aggregateSales({ startDate: getPastDate(30), endDate: getPastDate(0) });
  const prevData = aggregateSales({ startDate: getPastDate(60), endDate: getPastDate(31) });

  const totalRev = allData.reduce((s, d) => s + d.revenue, 0);
  const totalOrd = allData.reduce((s, d) => s + d.orders, 0);
  const prevRev = prevData.reduce((s, d) => s + d.revenue, 0);
  const prevOrd = prevData.reduce((s, d) => s + d.orders, 0);
  const revGrow = prevRev ? ((totalRev - prevRev) / prevRev * 100).toFixed(1) : 0;
  const ordGrow = prevOrd ? ((totalOrd - prevOrd) / prevOrd * 100).toFixed(1) : 0;
  const shops = DB.getShops();
  const styleData = sumByStyle(allData);
  const hotStyles = styleData.filter(s => s.shopCount >= shops.length * 0.6).length;

  pg.innerHTML = `
    <div class="page-header"><h1>📊 数据看板</h1><p>过去30天综合数据概览（含全部 ${shops.length} 个店铺）</p></div>

    <!-- AI 分析卡片 -->
    <div class="ai-insight" style="margin-bottom:20px">
      <div class="data-flow-line"></div>
      <div class="ai-insight-header">
        <span class="ai-badge">✦ AI 智能分析</span>
        <span class="ai-insight-title">本月经营洞察</span>
      </div>
      <div class="ai-insights-list">
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>营业额较上月<strong style="color:${revGrow>=0?'#f87171':'#34d399'}">${revGrow>=0?'增长':'下降'} ${Math.abs(revGrow)}%</strong>，${revGrow>=5?'增势强劲，建议加大爆款备货':revGrow>0?'小幅增长，保持稳健运营':revGrow>-5?'略有下滑，关注库存和定价策略':'下滑明显，建议排查各店铺流量问题'}</span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>共发现 <strong style="color:#a78bfa">${hotStyles} 款跨店爆款</strong>，覆盖率超60%的款式适合在所有店铺同步推广</span></div>
        <div class="ai-insight-item"><div class="ai-insight-dot"></div><span>客单价<strong style="color:#22d3ee"> ¥${(totalOrd ? totalRev/totalOrd : 0).toFixed(0)} </strong>，${totalOrd && totalRev/totalOrd > 60 ? '客单价表现良好，继续维持高价值产品组合' : '建议适当提升商品单价或增加高价品比例'}</span></div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">💰</div>
        <div class="stat-label">近30天总营业额</div>
        <div class="stat-value" id="sv-rev">¥0</div>
        <div class="stat-sub ${revGrow>=0?'stat-up':'stat-down'}">${revGrow>=0?'↑':'↓'} ${Math.abs(revGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="sbar-rev" style="width:0%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-label">近30天总订单</div>
        <div class="stat-value" id="sv-ord">0</div>
        <div class="stat-sub ${ordGrow>=0?'stat-up':'stat-down'}">${ordGrow>=0?'↑':'↓'} ${Math.abs(ordGrow)}% 较上月</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="sbar-ord" style="width:0%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏪</div>
        <div class="stat-label">活跃店铺数</div>
        <div class="stat-value" id="sv-shops">0</div>
        <div class="stat-sub" style="color:#64748b">全部在线运营</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="sbar-shops" style="width:100%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔥</div>
        <div class="stat-label">跨店爆款数</div>
        <div class="stat-value" id="sv-hot">0</div>
        <div class="stat-sub" style="color:#64748b">覆盖60%+店铺</div>
        <div class="stat-bar"><div class="stat-bar-fill" id="sbar-hot" style="width:0%"></div></div>
      </div>
    </div>
    <div class="chart-grid-3">
      <div class="card"><div class="card-title">📈 近30天营业额趋势</div><div class="chart-wrap"><canvas id="chart-rev-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🏪 店铺营业额占比</div><div class="chart-wrap"><canvas id="chart-shop-pie"></canvas></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title">🏆 店铺营业额排行（近30天）</div><div id="shop-rank-list"></div></div>
      <div class="card"><div class="card-title">🔥 爆款TOP10（近30天）</div><div id="style-rank-list"></div></div>
    </div>`;

  // 数字滚动 + 进度条
  animateNumber(document.getElementById('sv-rev'), totalRev, '¥', '', 900);
  animateNumber(document.getElementById('sv-ord'), totalOrd, '', '', 700);
  animateNumber(document.getElementById('sv-shops'), shops.length, '', '', 500);
  animateNumber(document.getElementById('sv-hot'), hotStyles, '', '', 600);
  setTimeout(() => {
    const maxRev = totalRev;
    const b1 = document.getElementById('sbar-rev');
    const b2 = document.getElementById('sbar-ord');
    const b4 = document.getElementById('sbar-hot');
    if (b1) b1.style.width = Math.min(100, totalRev/Math.max(prevRev,1)*60) + '%';
    if (b2) b2.style.width = Math.min(100, totalOrd/Math.max(prevOrd,1)*60) + '%';
    if (b4) b4.style.width = Math.min(100, hotStyles/Math.max(styleData.length,1)*100) + '%';
  }, 400);

  // 趋势图（科技感配色）
  const byDate = sumByDate(allData);
  if (charts['dashboard-trend']) { try { charts['dashboard-trend'].destroy(); } catch(e) {} }
  charts['dashboard-trend'] = new Chart(document.getElementById('chart-rev-trend'), {
    type: 'line',
    data: {
      labels: byDate.map(d => d.date.slice(5)),
      datasets: [{
        label: '营业额(¥)', data: byDate.map(d => d.revenue),
        borderColor: '#7c3aed',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,260);
          g.addColorStop(0, 'rgba(124,58,237,0.25)');
          g.addColorStop(1, 'rgba(124,58,237,0.01)');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 6,
        pointBackgroundColor: '#7c3aed', pointBorderColor: '#a78bfa', pointBorderWidth: 1,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff', padding: 10,
          callbacks: { label: ctx => '  营业额：¥' + ctx.raw.toLocaleString() }
        }
      },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '¥' + (v/1000).toFixed(0) + 'k' }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: '#64748b' }, border: { display: false } }
      },
      animation: { duration: 900, easing: 'easeOutCubic' }
    }
  });

  // 饼图（科技感）
  const shopSum = sumByShop(allData).sort((a,b) => b.revenue - a.revenue);
  if (charts['dashboard-pie']) { try { charts['dashboard-pie'].destroy(); } catch(e) {} }
  charts['dashboard-pie'] = new Chart(document.getElementById('chart-shop-pie'), {
    type: 'doughnut',
    data: {
      labels: shopSum.map(s => getShopName(s.shopId)),
      datasets: [{ data: shopSum.map(s => s.revenue), backgroundColor: shopSum.map(s => getShopColor(s.shopId)), borderWidth: 2, borderColor: '#070b14', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 8 } },
        tooltip: {
          backgroundColor: 'rgba(7,11,20,0.9)', borderColor: 'rgba(124,58,237,0.4)', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#fff',
          callbacks: { label: ctx => '  ' + ctx.label + '：¥' + ctx.raw.toLocaleString() }
        }
      },
      animation: { duration: 900, animateRotate: true, animateScale: true }
    }
  });

  // 店铺排行
  document.getElementById('shop-rank-list').innerHTML = `<ul class="rank-list">${
    shopSum.slice(0,8).map((s,i) => `
      <li class="rank-item" style="cursor:pointer" onclick="navigate('shop-detail','${s.shopId}')">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info">
          <div class="rank-name">${getShopName(s.shopId)}</div>
          <div class="rank-detail">${fmt(s.orders)} 单</div>
        </div>
        <span class="rank-val">${fmtMoney(s.revenue)}</span>
      </li>`).join('')
  }</ul>`;

  // 款式排行
  const styleRank = styleData.sort((a,b) => b.revenue - a.revenue);
  document.getElementById('style-rank-list').innerHTML = `<ul class="rank-list">${
    styleRank.slice(0,10).map((s,i) => `
      <li class="rank-item">
        <span class="rank-num ${i===0?'top1':i===1?'top2':i===2?'top3':''}">${i+1}</span>
        <div class="rank-info">
          <div class="rank-name">${s.styleName}</div>
          <div class="rank-detail">覆盖${s.shopCount}家店铺 · ${fmt(s.orders)}单</div>
        </div>
        <span class="rank-val">${fmtMoney(s.revenue)}</span>
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

  pg.innerHTML = `
    <div class="header-row">
      <h1>🏪 店铺管理</h1>
      <button class="btn-primary" onclick="openAddShop()">➕ 添加店铺</button>
    </div>
    <p style="color:#9ca3af;font-size:13px;margin-bottom:20px">共 ${shops.length} 家店铺，点击卡片查看详情</p>
    <div class="shop-grid">
      ${shops.map(shop => {
        const s = sumMap[shop.id] || {};
        return `
        <div class="shop-card" onclick="navigate('shop-detail','${shop.id}')">
          <div class="shop-card-header">
            <div>
              <div class="shop-name">${shop.name}</div>
              <div class="shop-meta">${shop.platform} · ${shop.id}</div>
            </div>
            <div style="width:12px;height:12px;border-radius:50%;background:${shop.color};margin-top:4px"></div>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,(s.revenue||0)/5000)}%;background:${shop.color}"></div></div>
          <div class="shop-stats">
            <div class="shop-stat"><div class="shop-stat-val" style="color:${shop.color}">${fmtMoney(s.revenue||0)}</div><div class="shop-stat-label">近30天营业额</div></div>
            <div class="shop-stat"><div class="shop-stat-val">${fmt(s.orders||0)}</div><div class="shop-stat-label">近30天订单</div></div>
            <div class="shop-stat"><div class="shop-stat-val">${s.styles||0}</div><div class="shop-stat-label">在售款式</div></div>
            <div class="shop-stat"><div class="shop-stat-val">${s.orders ? (s.refundOrders/s.orders*100).toFixed(1):'0'}%</div><div class="shop-stat-label">退款率</div></div>
          </div>
          <div style="margin-top:12px;text-align:right">
            <button class="btn-danger" onclick="event.stopPropagation();deleteShop('${shop.id}')">删除</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ============================================
//  页面：单店铺详情
// ============================================
function renderShopDetail(shopId) {
  const pg = document.getElementById('page-shop-detail');
  const shop = DB.getShops().find(s => s.id === shopId);
  if (!shop) { pg.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>店铺不存在</p></div>'; return; }

  const data30 = aggregateSales({ shopId, startDate: getPastDate(30), endDate: getPastDate(0) });
  const totalRev = data30.reduce((s,d) => s+d.revenue, 0);
  const totalOrd = data30.reduce((s,d) => s+d.orders, 0);
  const styleSum = sumByStyle(data30).sort((a,b) => b.revenue - a.revenue);
  const byDate = sumByDate(data30);

  pg.innerHTML = `
    <div class="header-row">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:16px;height:16px;border-radius:50%;background:${shop.color}"></div>
        <h1>${shop.name}</h1>
        <span class="badge badge-blue">${shop.platform}</span>
      </div>
      <button class="btn-secondary" onclick="navigate('shops')">← 返回</button>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">近30天营业额</div><div class="stat-value" style="color:${shop.color}">${fmtMoney(totalRev)}</div></div>
      <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">近30天订单数</div><div class="stat-value">${fmt(totalOrd)}</div></div>
      <div class="stat-card"><div class="stat-icon">👗</div><div class="stat-label">在售款式数</div><div class="stat-value">${styleSum.length}</div></div>
      <div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">平均客单价</div><div class="stat-value">${fmtMoney(totalOrd ? totalRev/totalOrd : 0)}</div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-title" style="color:${shop.color}">📈 近30天营业额趋势</div><div class="chart-wrap"><canvas id="chart-detail-trend"></canvas></div></div>
      <div class="card"><div class="card-title">🏆 本店Top10款式</div>
        <ul class="rank-list">${styleSum.slice(0,10).map((s,i) => `
          <li class="rank-item">
            <span class="rank-num ${i<3?['top1','top2','top3'][i]:''}">${i+1}</span>
            <div class="rank-info"><div class="rank-name">${s.styleName}</div><div class="rank-detail">${fmt(s.orders)} 单</div></div>
            <span class="rank-val">${fmtMoney(s.revenue)}</span>
          </li>`).join('')}</ul>
      </div>
    </div>
    <div class="card">
      <div class="card-title">📋 款式明细表</div>
      <div class="filter-bar" style="background:transparent;padding:0;box-shadow:none;margin-bottom:12px">
        <label>月份查询：</label>
        <select id="detail-month" onchange="filterDetailMonth('${shopId}')">
          <option value="">近30天</option>
          <option value="2026-03">2026年3月</option>
          <option value="2026-02">2026年2月</option>
          <option value="2026-01">2026年1月</option>
          <option value="2025-12">2025年12月</option>
          <option value="2025-11">2025年11月</option>
        </select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>款式名称</th><th>订单量</th><th>营业额</th><th>退款单</th><th>均价</th><th>占比</th></tr></thead>
        <tbody id="detail-style-tbody">${styleSum.map(s => `
          <tr>
            <td><strong>${s.styleName}</strong></td>
            <td>${fmt(s.orders)}</td>
            <td style="color:${shop.color};font-weight:700">${fmtMoney(s.revenue)}</td>
            <td>${s.orders > 0 ? Math.floor(s.orders*0.05) : 0}</td>
            <td>${fmtMoney(s.revenue / Math.max(s.orders,1))}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <div class="progress-bar" style="width:80px"><div class="progress-fill" style="width:${(s.revenue/Math.max(totalRev,1)*100).toFixed(0)}%;background:${shop.color}"></div></div>
                <span style="font-size:11px;color:#9ca3af">${(s.revenue/Math.max(totalRev,1)*100).toFixed(1)}%</span>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  if (charts['detail-trend']) charts['detail-trend'].destroy();
  charts['detail-trend'] = new Chart(document.getElementById('chart-detail-trend'), {
    type: 'line',
    data: { labels: byDate.map(d=>d.date.slice(5)), datasets: [{ label: '营业额', data: byDate.map(d=>d.revenue), borderColor: shop.color, backgroundColor: shop.color + '15', fill: true, tension: 0.4, pointRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '¥' + (v/1000).toFixed(1) + 'k' } } } }
  });
}

function filterDetailMonth(shopId) {
  // 简化：重新渲染即可
  renderShopDetail(shopId);
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
            <select id="import-target-shop">
              ${shops.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
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
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📋 文件格式说明</div>
          <p style="font-size:13px;color:#6b7280;margin-bottom:12px">CSV/Excel 文件需包含以下列（列名可用中英文）：</p>
          <table style="font-size:12px">
            <thead><tr><th>列名（中文）</th><th>列名（英文）</th><th>说明</th><th>必填</th></tr></thead>
            <tbody>
              <tr><td>日期</td><td>date</td><td>格式 YYYY-MM-DD</td><td><span class="badge badge-red">必填</span></td></tr>
              <tr><td>款式名称</td><td>styleName</td><td>商品款式名</td><td><span class="badge badge-red">必填</span></td></tr>
              <tr><td>订单量</td><td>orders</td><td>当日订单数</td><td><span class="badge badge-red">必填</span></td></tr>
              <tr><td>营业额</td><td>revenue</td><td>当日营业额（¥）</td><td><span class="badge badge-red">必填</span></td></tr>
              <tr><td>退款单</td><td>refundOrders</td><td>退款订单数</td><td><span class="badge badge-yellow">选填</span></td></tr>
              <tr><td>单价</td><td>price</td><td>商品单价</td><td><span class="badge badge-yellow">选填</span></td></tr>
            </tbody>
          </table>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📥 下载模板</div>
          <p style="font-size:13px;color:#6b7280;margin-bottom:12px">下载标准模板，按格式填入数据后导入：</p>
          <button class="btn-primary" onclick="downloadTemplate()">⬇️ 下载 CSV 模板</button>
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
      <button class="btn-primary" onclick="openModal('modal-add-article')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:-2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        分享知识
      </button>
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
        <button class="btn-primary" style="margin-top:12px" onclick="openModal('modal-add-article')">立即分享</button>
      </div>`;
    return;
  }

  container.innerHTML = articles.map(a => {
    const isOwner = CURRENT_USER && (CURRENT_USER.id === a.author_id || CURRENT_USER.role === 'admin');
    const date = a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN') : '';
    const preview = a.content ? a.content.slice(0, 120).replace(/\n/g, ' ') + (a.content.length > 120 ? '...' : '') : '';
    const catColors = { '运营经验':'#7c3aed','选品技巧':'#06b6d4','物流仓储':'#10b981','广告投放':'#f59e0b','数据分析':'#6366f1','其他':'#64748b' };
    const catColor = catColors[a.category] || '#64748b';
    return `
    <div class="academy-card" id="ac-${a.id}">
      <div class="academy-card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span class="badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;font-size:11px">${a.category || '其他'}</span>
            <h3 class="academy-title">${a.title}</h3>
          </div>
          <p class="academy-preview">${preview}</p>
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

async function submitArticle() {
  const title = document.getElementById('article-title').value.trim();
  const content = document.getElementById('article-content').value.trim();
  const category = document.getElementById('article-category').value;

  if (!title) { showToast('请输入文章标题', 'error'); return; }
  if (!content) { showToast('请输入文章内容', 'error'); return; }
  if (!CURRENT_USER) { showToast('请先登录', 'error'); return; }

  const article = {
    title, content, category,
    author_id: CURRENT_USER.id,
    author_name: CURRENT_USER.nickname || CURRENT_USER.phone,
    likes: 0,
    created_at: new Date().toISOString(),
  };

  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('academy', 'POST', article);
    } else {
      const list = Cache.get('academy_articles', []);
      article.id = Date.now();
      list.unshift(article);
      Cache.set('academy_articles', list);
    }
    closeModal('modal-add-article');
    document.getElementById('article-title').value = '';
    document.getElementById('article-content').value = '';
    showToast('文章发布成功！', 'success');
    await loadAcademyArticles();
  } catch(e) {
    showToast('发布失败：' + e.message, 'error');
  }
}

async function deleteArticle(id) {
  if (!confirm('确定要删除这篇文章吗？')) return;
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

  pg.innerHTML = `
    <div class="page-header">
      <h1 style="display:flex;align-items:center;gap:10px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#ag1)" stroke-width="2"><defs><linearGradient id="ag1" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        权限管理
      </h1>
      <p style="color:#64748b;font-size:13px;margin-top:4px">管理成员账号及页面访问权限</p>
    </div>
    <div id="admin-user-list">
      <div class="card"><div class="skeleton" style="height:200px"></div></div>
    </div>`;

  await loadAdminUsers();
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
          <div style="font-size:12px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            页面访问权限：
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${ALL_PAGES.map(page => {
              const hasPerm = effectivePerms.includes(page);
              return `<label class="perm-toggle" title="${hasPerm ? '点击收回'+PAGE_NAMES[page]+'权限' : '点击开放'+PAGE_NAMES[page]+'权限'}">
                <input type="checkbox" ${hasPerm ? 'checked' : ''} onchange="handlePermChange('${u.id}','${page}',this)">
                <span class="perm-label ${hasPerm ? 'perm-on' : 'perm-off'}">${PAGE_NAMES[page]}</span>
              </label>`;
            }).join('')}
          </div>
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

