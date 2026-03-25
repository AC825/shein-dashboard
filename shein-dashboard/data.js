// ============================================================
//  数据存储层  —— Supabase 云端 + localStorage 双层缓存
//  填写 SUPABASE_URL 和 SUPABASE_ANON_KEY 后即可多人实时同步
// ============================================================

// ★ 配置区域：在 Supabase 控制台获取这两个值并填入 ★
const SUPABASE_URL  = 'https://mcxdvhdyrgqxiuptbjjo.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_YkX9oxAmJswTMIDCrAQdZA_n-QFlE-O';

// 是否已配置 Supabase
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);

// Supabase REST 请求封装
async function sbFetch(path, method = 'GET', body = null, extra = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase error: ' + err);
  }
  if (method === 'GET') return res.json();
  return true;
}

// ============ 本地缓存层（localStorage） ============
const Cache = {
  get(key, def) {
    try { return JSON.parse(localStorage.getItem('shein_' + key)) || def; }
    catch(e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('shein_' + key, JSON.stringify(val)); } catch(e) {}
  },
};

// ============ DB 对外接口（同步，读缓存） ============
// 页面渲染全部读本地缓存（保持同步调用，无需改页面逻辑）
// 写入时同时写缓存 + 异步推送到 Supabase
const DB = {
  // ---------- 读（从本地缓存，同步） ----------
  getShops()     { return Cache.get('shops', []); },
  getSalesData() { return Cache.get('sales', []); },
  getStyleData() { return Cache.get('styles', []); },
  getAllSales()   { return Cache.get('sales', []); },

  // ---------- 写（同时更新缓存 + 推送云端） ----------
  setShops(shops) {
    Cache.set('shops', shops);
    if (SUPABASE_ENABLED) _pushShops(shops);
  },
  setSalesData(sales) {
    Cache.set('sales', sales);
    if (SUPABASE_ENABLED) _pushSales(sales);
  },
  setStyleData(styles) {
    Cache.set('styles', styles);
    // 款式数据从 sales 聚合，一般不单独存
  },

  // 兼容旧调用
  get(key, def) { return Cache.get(key, def); },
  set(key, val) { Cache.set(key, val); },
};

// ============ Supabase 推送函数 ============
async function _pushShops(shops) {
  try {
    // 先清空再写入（简单粗暴，数据量小）
    await sbFetch('shops', 'DELETE', null, { 'Prefer': 'return=minimal' });
    if (shops.length > 0) await sbFetch('shops', 'POST', shops);
  } catch(e) { console.warn('[Supabase] 店铺同步失败:', e.message); }
}

async function _pushSales(sales) {
  try {
    // 批量 upsert（按 date+shopId+styleId 作为唯一键）
    const BATCH = 500;
    for (let i = 0; i < sales.length; i += BATCH) {
      const chunk = sales.slice(i, i + BATCH);
      await sbFetch('sales', 'POST', chunk, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 销售数据同步失败:', e.message); }
}

// ============ 从 Supabase 拉取数据到本地缓存 ============
async function syncFromSupabase() {
  if (!SUPABASE_ENABLED) return false;

  try {
    showSyncStatus('⟳ 正在同步云端数据...');

    // 拉取店铺
    const shops = await sbFetch('shops?select=*&order=id');
    if (shops && shops.length > 0) {
      Cache.set('shops', shops);
    }

    // 拉取销售数据（分页，每次1000条）
    const allSales = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const chunk = await sbFetch(`sales?select=*&order=date.desc&limit=${PAGE}&offset=${offset}`);
      if (!chunk || chunk.length === 0) break;
      allSales.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }
    if (allSales.length > 0) {
      Cache.set('sales', allSales);
    }

    showSyncStatus('✓ 数据已同步', 'ok');
    return true;
  } catch(e) {
    console.warn('[Supabase] 同步失败:', e.message);
    showSyncStatus('⚠ 云端同步失败，使用本地数据', 'warn');
    return false;
  }
}

// ============ 实时监听（Supabase Realtime） ============
let realtimeChannel = null;
function initRealtime() {
  if (!SUPABASE_ENABLED) return;
  if (typeof window.RealtimeClient === 'undefined') return; // SDK 未加载

  try {
    const realtime = new window.RealtimeClient(SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1', {
      params: { apikey: SUPABASE_KEY }
    });
    realtime.connect();

    realtimeChannel = realtime.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        // 有人写入新数据时，自动重新同步
        syncFromSupabase().then(() => {
          navigate(currentPage, currentParam); // 刷新当前页面
          showToast('🔄 数据已更新（其他人同步了新数据）', 'info');
        });
      })
      .subscribe();
  } catch(e) {
    console.warn('[Realtime] 初始化失败:', e.message);
  }
}

// ============ 状态提示（顶栏同步指示器） ============
function showSyncStatus(msg, type) {
  let el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'ok' ? '#34d399' : type === 'warn' ? '#fbbf24' : '#94a3b8';
  if (type === 'ok') setTimeout(() => { if(el) el.textContent = '✓ 已同步'; }, 3000);
}

// ============ 初始化示例数据 ============
function initDemoData() {
  // 如果已配置 Supabase，跳过本地演示数据（使用云端数据）
  if (SUPABASE_ENABLED) return;

  if (DB.getShops().length > 0) return; // 已有数据，不重复初始化

  const shops = [
    { id: 'shop_001', name: 'SHEIN旗舰店A', platform: 'SHEIN', color: '#6366f1' },
    { id: 'shop_002', name: 'SHEIN官方店B', platform: 'SHEIN', color: '#f59e0b' },
    { id: 'shop_003', name: 'SHEIN精选店C', platform: 'SHEIN', color: '#10b981' },
    { id: 'shop_004', name: 'SHEIN女装店D', platform: 'SHEIN', color: '#ef4444' },
    { id: 'shop_005', name: 'SHEIN新品店E', platform: 'SHEIN', color: '#8b5cf6' },
    { id: 'shop_006', name: 'SHEIN欧美店F', platform: 'SHEIN', color: '#06b6d4' },
    { id: 'shop_007', name: 'SHEIN东南亚G', platform: 'SHEIN', color: '#f97316' },
    { id: 'shop_008', name: 'SHEIN中东店H', platform: 'SHEIN', color: '#84cc16' },
    { id: 'shop_009', name: 'SHEIN日本店I', platform: 'SHEIN', color: '#ec4899' },
    { id: 'shop_010', name: 'SHEIN韩国店J', platform: 'SHEIN', color: '#14b8a6' },
    { id: 'shop_011', name: 'SHEIN法国店K', platform: 'SHEIN', color: '#a855f7' },
    { id: 'shop_012', name: 'SHEIN美国店L', platform: 'SHEIN', color: '#f43f5e' },
  ];
  DB.setShops(shops);

  // 生成最近6个月的销售数据
  const styles = ['连衣裙A款', '牛仔裤B款', '卫衣C款', 'T恤D款', '半身裙E款',
    '外套F款', '衬衫G款', '短裤H款', '针织衫I款', '运动套装J款',
    '睡裙K款', '泳衣L款', '皮衣M款', '风衣N款', '背心裙O款'];

  const sales = [];
  const now = new Date(2026, 2, 24);
  for (let d = 0; d < 180; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().slice(0, 10);
    shops.forEach(shop => {
      styles.forEach(style => {
        const base = Math.random();
        if (base < 0.3) return;
        const orders = Math.floor(Math.random() * 80 + 5);
        const price = parseFloat((Math.random() * 60 + 15).toFixed(2));
        const refund = Math.floor(Math.random() * orders * 0.08);
        sales.push({
          date: dateStr,
          shop_id: shop.id,    // Supabase 风格下划线字段名
          shopId: shop.id,     // 兼容原有代码
          style_id: style,
          styleId: style,
          style_name: style,
          styleName: style,
          orders,
          refund_orders: refund,
          refundOrders: refund,
          revenue: parseFloat((orders * price).toFixed(2)),
          price,
        });
      });
    });
  }
  DB.setSalesData(sales);
}

// ============ 工具函数 ============
function fmt(num) {
  if (num >= 10000) return (num / 10000).toFixed(1) + 'w';
  return num.toLocaleString();
}
function fmtMoney(num) {
  return '¥' + parseFloat(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtDate(d) {
  return d instanceof Date ? d.toISOString().slice(0,10) : d;
}
function getPastDate(n) {
  const d = new Date(2026, 2, 24);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function getShopColor(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  return shop ? shop.color : '#6366f1';
}
function getShopName(shopId) {
  const shop = DB.getShops().find(s => s.id === shopId);
  return shop ? shop.name : shopId;
}

// 聚合销售数据（兼容 shopId / shop_id 两种字段名）
function aggregateSales(filters = {}) {
  let data = DB.getSalesData().map(d => ({
    ...d,
    shopId:      d.shopId      || d.shop_id,
    styleId:     d.styleId     || d.style_id,
    styleName:   d.styleName   || d.style_name,
    refundOrders:d.refundOrders|| d.refund_orders || 0,
  }));
  if (filters.shopId) data = data.filter(d => d.shopId === filters.shopId);
  if (filters.startDate) data = data.filter(d => d.date >= filters.startDate);
  if (filters.endDate) data = data.filter(d => d.date <= filters.endDate);
  if (filters.styleId) data = data.filter(d => d.styleId === filters.styleId);
  return data;
}

// 按店铺汇总
function sumByShop(data) {
  const map = {};
  data.forEach(d => {
    if (!map[d.shopId]) map[d.shopId] = { shopId: d.shopId, orders: 0, revenue: 0, refundOrders: 0, styleSet: new Set() };
    map[d.shopId].orders += d.orders;
    map[d.shopId].revenue += d.revenue;
    map[d.shopId].refundOrders += (d.refundOrders || 0);
    map[d.shopId].styleSet.add(d.styleId);
  });
  return Object.values(map).map(s => ({ ...s, styles: s.styleSet.size }));
}

// 按款式汇总
function sumByStyle(data) {
  const map = {};
  data.forEach(d => {
    if (!map[d.styleId]) map[d.styleId] = { styleId: d.styleId, styleName: d.styleName, orders: 0, revenue: 0, shopSet: new Set() };
    map[d.styleId].orders += d.orders;
    map[d.styleId].revenue += d.revenue;
    map[d.styleId].shopSet.add(d.shopId);
  });
  return Object.values(map).map(s => ({ ...s, shopCount: s.shopSet.size, shops: Array.from(s.shopSet) }));
}

// 按日期汇总
function sumByDate(data) {
  const map = {};
  data.forEach(d => {
    if (!map[d.date]) map[d.date] = { date: d.date, orders: 0, revenue: 0 };
    map[d.date].orders += d.orders;
    map[d.date].revenue += d.revenue;
  });
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

// 按月份汇总
function sumByMonth(data) {
  const map = {};
  data.forEach(d => {
    const m = d.date.slice(0, 7);
    if (!map[m]) map[m] = { month: m, orders: 0, revenue: 0 };
    map[m].orders += d.orders;
    map[m].revenue += d.revenue;
  });
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}
