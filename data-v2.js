// ============================================================
//  数据存储层  —— Supabase 云端 + localStorage 双层缓存
//  填写 SUPABASE_URL 和 SUPABASE_ANON_KEY 后即可多人实时同步
// ============================================================

// ★ 配置区域：在 Supabase 控制台获取这两个值并填入 ★
const SUPABASE_URL  = 'https://mcxdvhdyrgqxiuptbjjo.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jeGR2aGR5cmdxeGl1cHRiampvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTAyNzMsImV4cCI6MjA4OTkyNjI3M30.vata48k1YrEyGlRivFX-9nBt0usmOGKrejQrEYaFs84';

// 是否已配置 Supabase
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);

// Supabase REST 请求封装
async function sbFetch(path, method = 'GET', body = null, extra = {}) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
  // POST/PATCH/PUT 才加 Prefer，GET 不加（避免影响返回数据）
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Prefer'] = extra['Prefer'] || 'resolution=merge-duplicates,return=minimal';
  }
  // 如果 extra 里有 Prefer 则覆盖
  if (extra['Prefer']) headers['Prefer'] = extra['Prefer'];

  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase error: ' + err);
  }
  if (method === 'GET') return res.json();
  return true;
}

// ============ Supabase Storage 附件上传 ============
// 将文件的 base64 dataURL 上传到 Supabase Storage，返回公开 URL
// bucket: 'academy-attachments'（需在 Supabase 控制台创建，设为 public）
async function sbUploadFile(dataUrl, fileName, mimeType) {
  // dataUrl 格式: data:<mime>;base64,<data>
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('无效的文件数据');

  // base64 转 Uint8Array
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // 文件路径：用时间戳+随机数防止冲突
  const ext = fileName.split('.').pop();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/academy-attachments/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: bytes,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Storage上传失败: ' + err);
  }

  // 返回公开访问 URL
  return `${SUPABASE_URL}/storage/v1/object/public/academy-attachments/${path}`;
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
  // 新增单个店铺（直接 upsert，比全量更新更可靠，返回 Promise）
  async addShop(shop) {
    const shops = this.getShops();
    shops.push(shop);
    Cache.set('shops', shops);
    if (SUPABASE_ENABLED) await _pushSingleShop(shop);
  },
  // 删除店铺（同时删云端）
  removeShop(shopId) {
    const shops = this.getShops().filter(s => s.id !== shopId);
    Cache.set('shops', shops);
    if (SUPABASE_ENABLED) _deleteShopFromCloud(shopId);
    return shops;
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
    if (!shops || shops.length === 0) return;
    // upsert（有则更新，无则插入），确保 status 字段存在
    const normalized = shops.map(s => ({
      id: s.id,
      name: s.name,
      platform: s.platform || 'SHEIN',
      region: s.region || null,
      color: s.color || '#6366f1',
      status: s.status || 'active',
    }));
    await sbFetch('shops', 'POST', normalized, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 店铺同步失败:', e.message); }
}

async function _pushSingleShop(shop) {
  const normalized = {
    id: shop.id,
    name: shop.name,
    platform: shop.platform || 'SHEIN',
    region: shop.region || null,
    color: shop.color || '#6366f1',
    status: shop.status || 'active',
  };
  // 不 try/catch，让错误向上传递
  await sbFetch('shops', 'POST', normalized, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
}

async function _deleteShopFromCloud(shopId) {
  try {
    await sbFetch('shops?id=eq.' + encodeURIComponent(shopId), 'DELETE');
  } catch(e) { console.warn('[Supabase] 删除店铺失败:', e.message); }
}

async function _pushSales(sales) {
  try {
    if (!sales || sales.length === 0) return;
    // 确保字段名与数据库列名匹配（camelCase -> snake_case）
    const normalized = sales.map(s => ({
      shop_id: s.shopId || s.shop_id,
      date: s.date,
      style_id: s.styleId || s.style_id || null,
      style_name: s.styleName || s.style_name || null,
      revenue: s.revenue || 0,
      orders: s.orders || 0,
      refund_orders: s.refundOrders || s.refund_orders || 0,
      price: s.price || 0,
    }));
    // 批量 upsert（按 date+shop_id+style_id 作为唯一键）
    const BATCH = 500;
    for (let i = 0; i < normalized.length; i += BATCH) {
      const chunk = normalized.slice(i, i + BATCH);
      await sbFetch('sales', 'POST', chunk, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 销售数据同步失败:', e.message); }
}

// ============ 从 Supabase 拉取数据到本地缓存 ============
// silent=true 时后台静默同步，不改变顶栏状态文字（避免打断用户）
async function syncFromSupabase(silent = false) {
  if (!SUPABASE_ENABLED) return false;

  try {
    if (!silent) showSyncStatus('⟳ 正在同步云端数据...');

    // 拉取店铺（无条件覆盖本地缓存，确保最新）
    const shops = await sbFetch('shops?select=*&order=id');
    Cache.set('shops', Array.isArray(shops) ? shops : []);

    // 拉取销售数据（分页，每次1000条）
    const allSales = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const chunk = await sbFetch(`sales?select=*&order=date.desc&limit=${PAGE}&offset=${offset}`);
      if (!chunk || chunk.length === 0) break;
      // 将 snake_case 字段转回 camelCase（兼容本地代码）
      const mapped = chunk.map(s => ({
        id: s.id,
        shopId: s.shop_id,
        shop_id: s.shop_id,
        date: s.date,
        styleId: s.style_id,
        style_id: s.style_id,
        styleName: s.style_name,
        style_name: s.style_name,
        revenue: s.revenue,
        orders: s.orders,
        refundOrders: s.refund_orders,
        refund_orders: s.refund_orders,
        price: s.price,
      }));
      allSales.push(...mapped);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }
    if (allSales.length > 0) {
      Cache.set('sales', allSales);
    }

    // ---- 拉取商品成本库（全局，无 shop_id） ----
    try {
      const costRows = await sbFetch('cb_product_costs?select=*&order=created_at.desc');
      if (Array.isArray(costRows)) {
        localStorage.setItem('ec_cb_product_cost_global', JSON.stringify(costRows));
      }
    } catch(e) { console.warn('[Supabase] 商品成本同步失败:', e.message); }

    // ---- 拉取跨境订单 ----
    if (!silent) showSyncStatus('⟳ 正在拉取跨境订单...');
    try {
      const orderRows = await _sbFetchAll('cb_orders', 'date.desc');
      console.log(`[Supabase] 拉取跨境订单: ${orderRows.length} 条`);
      if (orderRows.length > 0) {
        // 云端有数据：与本地合并（以 id 为唯一键，云端优先）
        const byShop = {};
        orderRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
        Object.entries(byShop).forEach(([sid, cloudList]) => {
          let localList = [];
          try { localList = JSON.parse(localStorage.getItem('ec_cb_orders_' + sid) || '[]'); } catch(e) {}
          const cloudIds = new Set(cloudList.map(r => r.id));
          const localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
          localStorage.setItem('ec_cb_orders_' + sid, JSON.stringify(merged));
          if (localOnly.length > 0) {
            console.log(`[Supabase] 补推 ${localOnly.length} 条本地独有订单到云端(shop:${sid})`);
            sbBatchUpsert('cb_orders', localOnly.map(r => ({ ...r, shop_id: sid })));
          }
        });
      }
      // 云端返回空数组时不覆盖本地数据
    } catch(e) { console.warn('[Supabase] 跨境订单同步失败:', e.message); }

    // ---- 拉取退货退款 ----
    try {
      const refundRows = await _sbFetchAll('cb_refunds', 'date.desc');
      console.log(`[Supabase] 拉取退货退款: ${refundRows.length} 条`);
      if (refundRows.length > 0) {
        const byShop = {};
        refundRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
        Object.entries(byShop).forEach(([sid, cloudList]) => {
          let localList = [];
          try { localList = JSON.parse(localStorage.getItem('ec_cb_refunds_' + sid) || '[]'); } catch(e) {}
          const cloudIds = new Set(cloudList.map(r => r.id));
          const localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
          localStorage.setItem('ec_cb_refunds_' + sid, JSON.stringify(merged));
          if (localOnly.length > 0) sbBatchUpsert('cb_refunds', localOnly.map(r => ({ ...r, shop_id: sid })));
        });
      }
    } catch(e) { console.warn('[Supabase] 退货退款同步失败:', e.message); }

    // ---- 拉取差评率 ----
    try {
      const reviewRows = await _sbFetchAll('cb_reviews', 'date.desc');
      console.log(`[Supabase] 拉取差评率: ${reviewRows.length} 条`);
      if (reviewRows.length > 0) {
        const byShop = {};
        reviewRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
        Object.entries(byShop).forEach(([sid, cloudList]) => {
          let localList = [];
          try { localList = JSON.parse(localStorage.getItem('ec_cb_reviews_' + sid) || '[]'); } catch(e) {}
          const cloudIds = new Set(cloudList.map(r => r.id));
          const localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
          localStorage.setItem('ec_cb_reviews_' + sid, JSON.stringify(merged));
          if (localOnly.length > 0) sbBatchUpsert('cb_reviews', localOnly.map(r => ({ ...r, shop_id: sid })));
        });
      }
    } catch(e) { console.warn('[Supabase] 差评率同步失败:', e.message); }

    // ---- 拉取款式差评明细 ----
    try {
      const skuReviewRows = await _sbFetchAll('cb_sku_reviews', 'date.desc');
      console.log(`[Supabase] 拉取款式差评明细: ${skuReviewRows.length} 条`);
      if (skuReviewRows.length > 0) {
        const byShop = {};
        skuReviewRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
        Object.entries(byShop).forEach(([sid, cloudList]) => {
          let localList = [];
          try { localList = JSON.parse(localStorage.getItem('ec_cb_sku_reviews_' + sid) || '[]'); } catch(e) {}
          const cloudIds = new Set(cloudList.map(r => r.id));
          const localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
          localStorage.setItem('ec_cb_sku_reviews_' + sid, JSON.stringify(merged));
          if (localOnly.length > 0) sbBatchUpsert('cb_sku_reviews', localOnly.map(r => ({ ...r, shop_id: sid })));
        });
      }
    } catch(e) { console.warn('[Supabase] 款式差评明细同步失败:', e.message); }

    // ---- 拉取每日数据 ----
    try {
      const dailyRows = await _sbFetchAll('cb_daily', 'date.desc');
      console.log(`[Supabase] 拉取每日数据: ${dailyRows.length} 条`);
      if (dailyRows.length > 0) {
        // 云端有数据：与本地合并（以 id 为唯一键，云端优先）
        const byShop = {};
        dailyRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
        Object.entries(byShop).forEach(([sid, cloudList]) => {
          // 读取本地已有数据
          let localList = [];
          try { localList = JSON.parse(localStorage.getItem('ec_cb_daily_' + sid) || '[]'); } catch(e) {}
          // 合并：以 id 为键，云端优先；本地有而云端没有的（可能是推送失败的新数据）也保留
          const cloudIds = new Set(cloudList.map(r => r.id));
          const localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly];
          // 按日期降序排列
          merged.sort((a,b) => (b.date||'').localeCompare(a.date||''));
          localStorage.setItem('ec_cb_daily_' + sid, JSON.stringify(merged));
          // 把本地独有的条目补推云端（可能之前推送失败了）
          if (localOnly.length > 0) {
            console.log(`[Supabase] 补推 ${localOnly.length} 条本地独有每日数据到云端(shop:${sid})`);
            sbBatchUpsertCBDaily(localOnly.map(r => ({ ...r, shop_id: sid })));
          }
        });
        // 处理云端有数据但本地 key 不存在的店铺（新设备首次登录）已在上面 forEach 中覆盖
      }
      // 云端无数据时保留本地数据不覆盖
    } catch(e) { console.warn('[Supabase] 每日数据同步失败:', e.message); }

    // ---- 拉取店铺商品 ----
    try {
      const prodRows = await _sbFetchAll('shop_products', 'created_at.desc');
      const byShop = {};
      prodRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
      Object.entries(byShop).forEach(([sid, list]) => {
        localStorage.setItem('ec_products_' + sid, JSON.stringify(list));
      });
    } catch(e) { console.warn('[Supabase] 店铺商品同步失败:', e.message); }

    // ---- 拉取国内数据 ----
    try {
      const domRows = await _sbFetchAll('domestic_stats', 'date.desc');
      const byShop = {};
      domRows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
      Object.entries(byShop).forEach(([sid, list]) => {
        localStorage.setItem('ec_domestic_stats_' + sid, JSON.stringify(list));
      });
    } catch(e) { console.warn('[Supabase] 国内数据同步失败:', e.message); }

    // ---- 拉取统一运费设置 ----
    try {
      const rateRows = await sbFetch('cb_shipping_rates?select=*');
      if (Array.isArray(rateRows)) {
        rateRows.forEach(r => {
          localStorage.setItem('ec_cb_shipping_rate_' + r.shop_id, String(r.rate));
        });
      }
    } catch(e) { console.warn('[Supabase] 统一运费同步失败:', e.message); }

    // ---- 拉取店铺访问申请 ----
    try {
      const reqRows = await sbFetch('shop_access_requests?select=*&order=created_at.desc');
      if (Array.isArray(reqRows)) {
        const mapped = reqRows.map(r => ({
          id: r.id,
          shopId: r.shop_id,
          shopName: r.shop_name,
          applicantId: r.applicant_id,
          applicantName: r.applicant_name,
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at,
        }));
        localStorage.setItem('shop_access_requests', JSON.stringify(mapped));
      }
    } catch(e) { console.warn('[Supabase] 店铺访问申请同步失败:', e.message); }

    if (!silent) showSyncStatus('✓ 数据已同步', 'ok');
    return true;
  } catch(e) {
    console.warn('[Supabase] 同步失败:', e.message);
    if (!silent) showSyncStatus('⚠ 云端同步失败，使用本地数据', 'warn');
    return false;
  }
}

// 分页拉取所有数据（使用 offset+limit 查询参数，兼容 Supabase max_rows 限制）
async function _sbFetchAll(table, order = 'id') {
  // Supabase 默认 max_rows 可能是 500 或 1000，使用 URL 查询参数方式更可靠
  // Range header 方式在某些情况下受服务端 max_rows 限制，实际返回条数少于请求条数时会误判为最后一页
  const PAGE = 500; // 保守取 500，确保每页不超过服务端限制
  const all = [];
  let offset = 0;
  while (true) {
    // 使用 offset + limit 查询参数分页（更可靠，不受 Range-Unit 限制）
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'count=none',
      }
    });
    if (!res.ok) {
      const err = await res.text();
      // 分页失败时抛出异常，而不是 break 返回不完整数据，防止上层用空/残缺数据覆盖本地
      throw new Error(`分页拉取 ${table} 失败(offset=${offset}): ${err}`);
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < PAGE) break; // 返回条数不足一页，说明是最后一页
    offset += PAGE;
  }
  return all;
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
        // 检测到数据变化时，只静默同步本地缓存，完全不触发任何页面刷新/动画
        // 用户需要手动点击顶栏的"同步"按钮或看板的"手动刷新"按钮来更新视图
        syncFromSupabase(true);
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

// ============ 新表：Supabase 推送函数 ============

// 商品成本库（全局，无 shop_id）
async function sbPushProductCost(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_product_costs', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 商品成本推送失败:', e.message); }
}
async function sbDeleteProductCost(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_product_costs?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 商品成本删除失败:', e.message); }
}
async function sbBatchUpsertProductCosts(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('cb_product_costs', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 商品成本批量推送失败:', e.message); }
}

// 跨境订单
async function sbPushCBOrder(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_orders', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 跨境订单推送失败:', e.message); }
}
async function sbDeleteCBOrder(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_orders?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 跨境订单删除失败:', e.message); }
}
async function sbBatchUpsertCBOrders(rows, onProgress) {
  if (!SUPABASE_ENABLED || !rows.length) return { ok: 0, fail: 0 };
  const BATCH = 200; // 减小批次，提高可靠性
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // 最多重试2次
    let success = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        await sbFetch('cb_orders', 'POST', chunk, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        ok += chunk.length;
        success = true;
        break;
      } catch(e) {
        if (retry === 2) {
          console.warn('[Supabase] 跨境订单批量推送失败(第' + Math.floor(i/BATCH+1) + '批):', e.message);
          fail += chunk.length;
        } else {
          await new Promise(r => setTimeout(r, 800 * (retry + 1))); // 退避重试
        }
      }
    }
    if (onProgress) onProgress(Math.min(i + BATCH, rows.length), rows.length, fail);
    await new Promise(r => setTimeout(r, 50)); // 小间隔，避免频率限制
  }
  return { ok, fail };
}

// 退货退款
async function sbPushCBRefund(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_refunds', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 退货退款推送失败:', e.message); }
}
async function sbDeleteCBRefund(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_refunds?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 退货退款删除失败:', e.message); }
}
async function sbBatchUpsertCBRefunds(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('cb_refunds', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 退货退款批量推送失败:', e.message); }
}

// 差评率
async function sbPushCBReview(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_reviews', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 差评率推送失败:', e.message); }
}
async function sbDeleteCBReview(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_reviews?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 差评率删除失败:', e.message); }
}
async function sbBatchUpsertCBReviews(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('cb_reviews', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 差评率批量推送失败:', e.message); }
}

// 款式差评明细
async function sbUpsertCBSkuReview(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_sku_reviews', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 款式差评推送失败:', e.message); }
}
async function sbDeleteCBSkuReview(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_sku_reviews?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 款式差评删除失败:', e.message); }
}
async function sbBatchUpsertCBSkuReviews(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('cb_sku_reviews', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 款式差评批量推送失败:', e.message); }
}

// 通用批量 upsert（供同步合并时补推本地独有数据使用）
async function sbBatchUpsert(table, rows) {
  if (!SUPABASE_ENABLED || !rows || !rows.length) return;
  try {
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch(table, 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn(`[Supabase] 通用批量推送 ${table} 失败:`, e.message); }
}

// 每日数据
async function sbUpsertCBDaily(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_daily', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 每日数据推送失败:', e.message); }
}
async function sbDeleteCBDaily(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_daily?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 每日数据删除失败:', e.message); }
}
async function sbBatchUpsertCBDaily(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('cb_daily', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 每日数据批量推送失败:', e.message); }
}

// 店铺商品
async function sbPushShopProduct(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('shop_products', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 店铺商品推送失败:', e.message); }
}
async function sbDeleteShopProduct(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('shop_products?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 店铺商品删除失败:', e.message); }
}
async function sbUpdateShopProduct(id, updates) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('shop_products?id=eq.' + encodeURIComponent(id), 'PATCH', updates);
  } catch(e) { console.warn('[Supabase] 店铺商品更新失败:', e.message); }
}

// 国内数据（生意参谋日报）
async function sbUpsertDomesticStats(row) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('domestic_stats', 'POST', row, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 国内数据推送失败:', e.message); }
}
async function sbDeleteDomesticStats(id) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('domestic_stats?id=eq.' + encodeURIComponent(id), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 国内数据删除失败:', e.message); }
}
async function sbBatchUpsertDomesticStats(rows) {
  if (!SUPABASE_ENABLED || !rows.length) return;
  try {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await sbFetch('domestic_stats', 'POST', rows.slice(i, i+BATCH), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    }
  } catch(e) { console.warn('[Supabase] 国内数据批量推送失败:', e.message); }
}

// 统一运费设置
async function sbSetShippingRate(shopId, rate) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('cb_shipping_rates', 'POST',
      { shop_id: shopId, rate, updated_at: new Date().toISOString() },
      { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    );
  } catch(e) { console.warn('[Supabase] 统一运费推送失败:', e.message); }
}
async function sbDeleteShippingRate(shopId) {
  if (!SUPABASE_ENABLED) return;
  try { await sbFetch('cb_shipping_rates?shop_id=eq.' + encodeURIComponent(shopId), 'DELETE'); }
  catch(e) { console.warn('[Supabase] 统一运费删除失败:', e.message); }
}

// 店铺访问申请
async function sbPushAccessRequest(req) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('shop_access_requests', 'POST', {
      id: req.id,
      shop_id: req.shopId,
      shop_name: req.shopName || '',
      applicant_id: req.applicantId || '',
      applicant_name: req.applicantName || '',
      reason: req.reason || '',
      status: req.status || 'pending',
      created_at: req.createdAt || new Date().toISOString(),
    }, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 访问申请推送失败:', e.message); }
}
async function sbUpdateAccessRequestStatus(reqId, status) {
  if (!SUPABASE_ENABLED) return;
  try {
    await sbFetch('shop_access_requests?id=eq.' + encodeURIComponent(reqId), 'PATCH', { status });
  } catch(e) { console.warn('[Supabase] 访问申请状态更新失败:', e.message); }
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
// 同时包含跨境店铺数据（CBOrderDB 订单 + CrossBorderDailyDB 每日数据）
function aggregateSales(filters = {}) {
  // --- 1. 国内销售数据（原有） ---
  let data = DB.getSalesData().map(d => ({
    ...d,
    shopId:      d.shopId      || d.shop_id,
    styleId:     d.styleId     || d.style_id,
    styleName:   d.styleName   || d.style_name,
    refundOrders:d.refundOrders|| d.refund_orders || 0,
  }));

  // --- 2. 跨境每日数据（CrossBorderDailyDB，优先） ---
  // 如果没有跨境数据库则跳过
  try {
    if (typeof CrossBorderDailyDB !== 'undefined' && typeof CROSS_BORDER_PLATFORMS !== 'undefined') {
      const crossShops = DB.getShops().filter(s => CROSS_BORDER_PLATFORMS.has(s.platform));
      crossShops.forEach(shop => {
        // 如果指定了国内店铺，跳过
        if (filters.shopId && filters.shopId !== shop.id) return;
        // 优先取每日数据
        let dailyRows = CrossBorderDailyDB.getAll(shop.id);
        if (filters.startDate) dailyRows = dailyRows.filter(r => (r.date||'') >= filters.startDate);
        if (filters.endDate)   dailyRows = dailyRows.filter(r => (r.date||'') <= filters.endDate);
        if (dailyRows.length > 0) {
          dailyRows.forEach(r => {
            const amount = parseFloat(r.amount) || parseFloat(r.payment_amount) || 0;
            const orders = parseInt(r.buyers) || parseInt(r.payment_buyers) || parseInt(r.payment_count) || 0;
            if (!r.date || amount === 0) return;
            data.push({ shopId: shop.id, styleId: '_cb_daily', styleName: '跨境每日汇总', date: r.date, revenue: amount, orders, refundOrders: 0, _source: 'cross' });
          });
        } else {
          // 没有每日数据则 fallback 到订单列表
          let orderRows = CBOrderDB.getAll(shop.id).filter(o => (o.sale_amount||0) > 0);
          if (filters.startDate) orderRows = orderRows.filter(o => (o.date||'') >= filters.startDate);
          if (filters.endDate)   orderRows = orderRows.filter(o => (o.date||'') <= filters.endDate);
          orderRows.forEach(o => {
            if (!o.date) return;
            data.push({ shopId: shop.id, styleId: o.sku || '_cb_order', styleName: o.product_name || '跨境订单', date: o.date, revenue: o.sale_amount || 0, orders: 1, refundOrders: 0, _source: 'cross' });
          });
        }
      });
    }
  } catch(e) { /* 跨境数据未初始化时静默跳过 */ }

  // --- 3. filters 过滤 ---
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
