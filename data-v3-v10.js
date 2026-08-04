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

// ============ 个人设置云存档（会员等级 / 主题 / 切换次数） ============
// 把纯本地的个人设置聚合并存入 Supabase users 表的 profile_json 列，
// 解决"清缓存后会员等级 / 主题丢失"的问题；登录后自动从云端恢复。
const CloudProfile = {
  _uid() {
    try {
      if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.id) return CURRENT_USER.id;
    } catch (e) {}
    return null;
  },
  // 收集本地个人设置
  collect() {
    const p = {};
    try {
      const raw = localStorage.getItem('ec_vip_active_days');
      if (raw) {
        const d = JSON.parse(raw);
        p.active_days = (d && d.dates) ? d.dates : (Array.isArray(d) ? d : []);
      }
    } catch (e) {}
    const uid = this._uid();
    if (uid) {
      try {
        const t = localStorage.getItem('ec_current_theme_' + uid);
        if (t !== null) p.current_theme = parseInt(t, 10) || 0;
      } catch (e) {}
      try {
        const sw = localStorage.getItem('ec_theme_switches_used_' + uid);
        if (sw !== null) p.theme_switches_used = parseInt(sw, 10) || 0;
      } catch (e) {}
    }
    return p;
  },
  // 保存到云端
  async save() {
    const uid = this._uid();
    if (!SUPABASE_ENABLED || !uid) return;
    try {
      const p = this.collect();
      await sbFetch('users?id=eq.' + encodeURIComponent(uid), 'PATCH', { profile_json: JSON.stringify(p) });
      console.log('[云存档] ✅ 个人设置已同步云端', p);
    } catch (e) { console.warn('[云存档] 保存失败', e.message); }
  },
  // 从云端恢复（登录后调用，写入本地）
  async restore() {
    const uid = this._uid();
    if (!SUPABASE_ENABLED || !uid) return null;
    try {
      const rows = await sbFetch('users?select=profile_json&id=eq.' + encodeURIComponent(uid), 'GET');
      if (!rows || !rows[0] || !rows[0].profile_json) return null;
      const p = (typeof rows[0].profile_json === 'string') ? JSON.parse(rows[0].profile_json) : rows[0].profile_json;
      if (p.active_days && Array.isArray(p.active_days)) {
        localStorage.setItem('ec_vip_active_days', JSON.stringify({ dates: p.active_days, count: p.active_days.length }));
      }
      if (p.current_theme !== undefined && p.current_theme !== null) {
        localStorage.setItem('ec_current_theme_' + uid, String(p.current_theme));
      }
      if (p.theme_switches_used !== undefined && p.theme_switches_used !== null) {
        localStorage.setItem('ec_theme_switches_used_' + uid, String(p.theme_switches_used));
      }
      console.log('[云存档] ✅ 已从云端恢复个人设置', p);
      return p;
    } catch (e) { console.warn('[云存档] 恢复失败', e.message); return null; }
  }
};
window.CloudProfile = CloudProfile;

// ============ 一键全量云同步（把所有本地数据推送到云端） ============
async function runCloudSync() {
  if (!SUPABASE_ENABLED) { if (window.showToast) showToast('未配置云端，无法同步'); return 0; }
  if (window.showToast) showToast('☁️ 正在把全部数据推送到云端...');
  const shops = (typeof DB !== 'undefined' && DB.getShops) ? (DB.getShops() || []) : [];
  let count = 0;
  const pushShopTable = async (keyPrefix, upsertFn) => {
    for (const s of shops) {
      const raw = localStorage.getItem(keyPrefix + s.id);
      if (!raw) continue;
      let rows = [];
      try { rows = JSON.parse(raw); } catch (e) { continue; }
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const payload = rows.map(r => Object.assign({}, r, { shop_id: s.id }));
      try { await upsertFn(payload); count += payload.length; } catch (e) { console.warn('[全量同步] 失败', keyPrefix, e.message); }
    }
  };
  await pushShopTable('ec_cb_orders_', rows => sbBatchUpsert('cb_orders', rows));
  await pushShopTable('ec_cb_refunds_', rows => sbBatchUpsert('cb_refunds', rows));
  await pushShopTable('ec_cb_reviews_', rows => sbBatchUpsert('cb_reviews', rows));
  await pushShopTable('ec_cb_sku_reviews_', rows => sbBatchUpsert('cb_sku_reviews', rows));
  await pushShopTable('ec_cb_daily_', rows => sbBatchUpsertCBDaily(rows));
  await pushShopTable('ec_products_', rows => sbBatchUpsert('shop_products', rows)); // 商品本地 key 为 ec_products_<sid>
  await pushShopTable('ec_domestic_stats_', rows => sbBatchUpsertDomesticStats(rows));
  // 统一运费
  for (const s of shops) {
    const v = localStorage.getItem('ec_cb_shipping_rate_' + s.id);
    if (v !== null) { try { await sbSetShippingRate(s.id, parseFloat(v)); } catch (e) {} }
  }
  // 商品成本（全局）
  const costRaw = localStorage.getItem('ec_cb_product_cost_global');
  if (costRaw) { try { const c = JSON.parse(costRaw); if (Array.isArray(c) && c.length) await sbBatchUpsertProductCosts(c); } catch (e) {} }
  // 任务
  if (window.CBTaskDB && CBTaskDB.getAll && CBTaskDB.save) {
    for (const s of shops) {
      try { const t = CBTaskDB.getAll(s.id); if (Array.isArray(t) && t.length) CBTaskDB.save(s.id, t); } catch (e) {}
    }
  }
  // 个人设置（profile_json 列）独立容错：列未创建时跳过，不影响业务数据
  try { await CloudProfile.save(); } catch (e) { console.warn('[云存档] 个人设置跳过:', e.message); }
  if (window.showToast) showToast('✅ 已同步 ' + shops.length + ' 个店铺、' + count + ' 条业务数据到云端');
  return count;
}
async function restoreAllFromCloud() {
  if (!SUPABASE_ENABLED) { if (window.showToast) showToast('未配置云端'); return; }
  if (window.showToast) showToast('☁️ 正在从云端恢复全部数据...');
  try {
    if (typeof syncFromSupabase === 'function') await syncFromSupabase(true);
    // 个人设置（profile_json 列）独立容错：即使列还没创建也不影响业务数据恢复
    try { await CloudProfile.restore(); } catch (e) { console.warn('[云存档] 个人设置恢复跳过:', e.message); }
    if (window.showToast) showToast('✅ 已从云端恢复全部业务数据，即将刷新');
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 1200);
  } catch (e) {
    if (window.showToast) showToast('恢复失败：' + e.message);
  }
}
window.runCloudSync = runCloudSync;
window.restoreAllFromCloud = restoreAllFromCloud;

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
  // 默认只返回未软删除的店铺
  getShops()     { return Cache.get('shops', []).filter(s => !s.deleted_at); },
  // 读取所有店铺（含已软删除），用于管理/恢复等高级场景
  getAllShops()  { return Cache.get('shops', []); },
  getSalesData() { return Cache.get('sales', []); },
  getStyleData() { return Cache.get('styles', []); },
  getAllSales()   { return Cache.get('sales', []); },

  // ---------- 写（同时更新缓存 + 推送云端） ----------
  setShops(shops) {
    Cache.set('shops', shops);
    if (SUPABASE_ENABLED) _pushShops(shops);
  },
  // 新增单个店铺（直接 upsert，比全量更新更可靠，返回 Promise）
  // 如果同 ID 店铺之前被软删除，则恢复并更新数据
  async addShop(shop) {
    const allShops = Cache.get('shops', []);
    const idx = allShops.findIndex(s => s.id === shop.id);
    if (idx >= 0) {
      // 同 ID 已存在：恢复并更新
      allShops[idx] = { ...shop, deleted_at: null };
    } else {
      allShops.push(shop);
    }
    Cache.set('shops', allShops);
    if (SUPABASE_ENABLED) await _pushSingleShop({ ...shop, deleted_at: null });
  },
  // 删除店铺（软删除：本地标记 deleted_at，云端 PATCH deleted_at）
  removeShop(shopId) {
    const now = new Date().toISOString();
    const allShops = Cache.get('shops', []);
    const shops = allShops.map(s => s.id === shopId ? { ...s, deleted_at: now } : s);
    Cache.set('shops', shops);
    if (SUPABASE_ENABLED) _markShopDeletedInCloud(shopId, now);
    return shops.filter(s => !s.deleted_at);
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
  save(shops) { return this.setShops(shops); },
};

// ============ Supabase 推送函数 ============
async function _pushShops(shops) {
  try {
    if (!shops || shops.length === 0) return;
    // upsert（有则更新，无则插入），确保 status 字段存在；过滤已软删除的店铺
    const normalized = shops.filter(s => !s.deleted_at).map(s => ({
      id: s.id,
      name: s.name,
      platform: s.platform || 'SHEIN',
      region: s.region || null,
      currency: s.currency || ((typeof DOMESTIC_PLATFORMS !== 'undefined' && DOMESTIC_PLATFORMS.has(s.platform)) ? 'CNY' : 'USD'),
      color: s.color || '#6366f1',
      status: s.status || 'active',
      created_by: s.created_by || null,
    }));
    if (normalized.length === 0) return;
    await sbFetch('shops', 'POST', normalized, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  } catch(e) { console.warn('[Supabase] 店铺同步失败:', e.message); }
}

async function _pushSingleShop(shop) {
  const normalized = {
    id: shop.id,
    name: shop.name,
    platform: shop.platform || 'SHEIN',
    region: shop.region || null,
    currency: shop.currency || ((typeof DOMESTIC_PLATFORMS !== 'undefined' && DOMESTIC_PLATFORMS.has(shop.platform)) ? 'CNY' : 'USD'),
    color: shop.color || '#6366f1',
    status: shop.status || 'active',
    created_by: shop.created_by || null,
    deleted_at: null, // 新增/恢复时取消软删除标记
  };
  // 不 try/catch，让错误向上传递
  await sbFetch('shops', 'POST', normalized, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
}

async function _markShopDeletedInCloud(shopId, deletedAt) {
  try {
    await sbFetch('shops?id=eq.' + encodeURIComponent(shopId), 'PATCH', { deleted_at: deletedAt || new Date().toISOString() });
  } catch(e) { console.warn('[Supabase] 标记店铺删除失败:', e.message); }
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

// V219: 取当前用户有权限访问的店铺 ID 列表（子账号按权限过滤同步）
//   admin 账号（A001/role==='admin' 或 permissions 为空）→ 返回 null（不过滤）
//   子账号 → 从 permissions 数组提取 shop_view_<id> / shop_edit_<id> 中的 shopId
function _getAllowedShopIds() {
  try {
    const u = (typeof window !== 'undefined' && window.CURRENT_USER) || null;
    if (!u) return null;
    // admin / A001 / 无 perms 都视为看全部店
    if (u.role === 'admin' || u.id === 'A001') return null;
    const perms = Array.isArray(u.permissions) ? u.permissions : [];
    if (perms.length === 0) return null;
    const ids = [];
    perms.forEach(p => {
      const m = String(p).match(/^shop_(?:view|edit)_(.+)$/);
      if (m) ids.push(m[1]);
    });
    return ids.length > 0 ? ids : null;
  } catch(e) { return null; }
}

// V219: 给 filter 字符串追加 shop_id 限制（PostgREST: shop_id=in.(id1,id2,...)）
function _appendShopFilter(filter, allowedIds) {
  if (!allowedIds || allowedIds.length === 0) return filter;
  const inList = '(' + allowedIds.map(id => '"' + String(id).replace(/"/g,'') + '"').join(',') + ')';
  const newF = 'shop_id=in.' + inList;
  return filter ? (filter + '&' + newF) : newF;
}

async function syncFromSupabase(silent = false) {
  if (!SUPABASE_ENABLED) return false;

  // V216: 允许 URL 带 ?fullsync=1 强制全量（用于修正历史订单后手动刷新）
  if (typeof location !== 'undefined' && location.search.indexOf('fullsync=1') >= 0) {
    window.__forceFullSync = true;
  }
  // V228: 首次登录 / 清缓存后，由 startApp 设置一次 __needFullSyncOnce → 本次同步强制全量
  // （避免干净环境下掉进"30天软水印"陷阱，导致所有店铺只看到最近30天数据）
  if (window.__needFullSyncOnce) {
    window.__forceFullSync = true;
    window.__needFullSyncOnce = false;
    console.log('%c[ec-v228] 本次强制全量同步（首次登录/清缓存后）', 'background:#dc2626;color:#fff;padding:3px 8px;border-radius:3px;font-weight:bold;');
  }
  // V229: 强制全量（__forceFullSync）→ 绕过 5min 跳过保护；否则 5min 内已同步过会直接 return
  // （用户截图 "已同步但 0 条订单" 根因：login 后 __needFullSyncOnce 触发，但 5min skip 抢先 return）
  if (window.__forceFullSync) {
    try { localStorage.removeItem('ec_last_sync_time'); } catch(e) {}
  }
  // V217: 启动时打印醒目的诊断信息（让用户能在控制台一眼看出是否走增量）
  try {
    const _localKeys = Object.keys(localStorage).filter(k => k.indexOf('ec_cb_orders_') === 0).length;
    const _localRefundKeys = Object.keys(localStorage).filter(k => k.indexOf('ec_cb_refunds_') === 0).length;
    const _wmOrders = _getMaxField('ec_cb_orders_', 'created_at');
    const _wmRefunds = _getMaxField('ec_cb_refunds_', 'created_at');
    console.log(
      '%c[ec-v217] 同步启动 diagnostic',
      'background:#1e3a8a;color:#fff;padding:3px 8px;border-radius:3px;font-weight:bold;',
      JSON.stringify({
        ec_version: '20260731v217',
        forceFull: !!window.__forceFullSync,
        cached_orders_keys: _localKeys,
        cached_refunds_keys: _localRefundKeys,
        watermark_orders: _wmOrders || '(无 → 将回退近30天)',
        watermark_refunds: _wmRefunds || '(无 → 将回退近30天)'
      }, null, 2)
    );
  } catch(e) {}

  // 缓存优化：如果5分钟以内同步过，直接跳过（不卡页面加载）
  const lastSync = localStorage.getItem('ec_last_sync_time');
  if (lastSync && Date.now() - parseInt(lastSync) < 5 * 60 * 1000) {
    console.log('[Supabase] 跳过同步（上次同步时间在5分钟内）');
    return true;
  }

  try {
    if (!silent) showSyncStatus('⟳ 正在同步云端数据...');
    // 不再提前设置同步时间，改为同步成功后设置
    // localStorage.setItem('ec_last_sync_time', String(Date.now()));

    // ===== 通用合并工具函数 =====
    function mergeToLocal(rows, storageKeyFn, upsertFn, tableName) {
      if (!rows || rows.length === 0) return;
      const byShop = {};
      rows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
      Object.entries(byShop).forEach(([sid, cloudList]) => {
        const _isOrders = (tableName === 'cb_orders');
        // 把变量声明提到外层（V224 bug 修复：if/else 块内 const 在块外不可见）
        let localList = [];
        let localOnly = [];
        if (_isOrders && typeof window.__ec_shardWrite === 'function') {
          // V230: cb_orders 改走内存 Map（window.__EC_CB_ORDERS），完全不再写 localStorage 分片
          //      — 之前 V224 按月分片在 002 店丢失了 17030/17628 条订单，彻底抛弃
          try { localList = window.__ec_shardRead(sid) || []; } catch (e) { localList = []; }
          const cloudIds = new Set(cloudList.map(r => r.id));
          localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
          const merged = [...cloudList, ...localOnly].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          try {
            window.__ec_shardWrite(sid, merged);
            if (merged.length) console.log(`[Supabase][V230] ${tableName} 店铺 ${sid} 内存写入 ${merged.length} 条 (云端 ${cloudList.length} + 本地独有 ${localOnly.length})`);
          } catch (e) {
            console.warn(`[Supabase] 内存写入失败 ${tableName}:shop:${sid}:`, e.message);
          }
        } else {
          try { localList = JSON.parse(localStorage.getItem(storageKeyFn(sid)) || '[]'); } catch (e) { localList = []; }
          // V232: 修复「本地无 id 字段」数据被云端覆盖丢的 bug。
          //   - cb_daily / cb_refunds / cb_reviews / cb_sku_reviews 这几张表，本地 row 是 upsert 时直接 push 的，没 id 字段
          //   - cb_orders 现在改走内存（上方分支），不影响
          //   - 用「有 id 时按 id 去重；无 id 时按 date 去重（与各表 upsert 行为一致）」兼容所有表
          const _useDateKey = (tableName === 'cb_daily' || tableName === 'cb_refunds' || tableName === 'cb_reviews' || tableName === 'cb_sku_reviews');
          let merged;
          if (_useDateKey) {
            // 按 date 去重：cloud 优先（云端有 id，可被外部直接引用），同 date 用 cloud 行覆盖 local 行
            const cloudDates = new Set(cloudList.map(r => r.date).filter(Boolean));
            localOnly = localList.filter(r => r.date && !cloudDates.has(r.date));
            merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
            if (localOnly.length > 0) {
              console.log(`[Supabase][V232] ${tableName} 店铺 ${sid} 保留本地独有 ${localOnly.length} 条 (按 date 去重) → 共 ${merged.length} 条`);
            }
          } else {
            // 通用逻辑（按 id 去重）
            const cloudIds = new Set(cloudList.map(r => r.id));
            localOnly = localList.filter(r => r.id && !cloudIds.has(r.id));
            merged = [...cloudList, ...localOnly].sort((a,b) => (b.date||'').localeCompare(a.date||''));
          }
          // 始终保存 merged 数据（云端为主）
          try {
            localStorage.setItem(storageKeyFn(sid), JSON.stringify(merged));
          } catch (e) {
            // V216: localStorage 配额超限（单店数据过大）时不再抛出，避免整次同步失败陷入死循环
            console.warn(`[Supabase] 写入本地缓存失败(可能超配额): ${tableName}:shop:${sid}`, e.message);
          }
        }
        // V221: 清掉该店的跨境 HTML 缓存，确保下次 render 重新计算 fingerprint
        // （避免命中同步前的空缓存 → UI 一直显示 0 条）。mergeToLocal 直接写 localStorage，
        // 不经过 CBOrderDB.add，所以 cb-cache 的 patchWriteAPI 清缓存钩子不会被触发，必须这里手动清。
        try {
          if (window._cbHtmlCache) delete window._cbHtmlCache[sid];
          if (window._cbDataVersion) delete window._cbDataVersion[sid];
          if (window._cbFpCache) delete window._cbFpCache[sid];
        } catch (e2) {}
        // 补推本地独有数据：只在前 100 条以内才同步推回云端（避免大批量数据无限挂起）
        if (localOnly.length > 0 && upsertFn && localOnly.length <= 100) {
          console.log(`[Supabase] 补推 ${localOnly.length} 条本地独有数据到云端(${tableName}:shop:${sid})`);
          // 不 await，让后台异步执行
          Promise.resolve().then(() => {
            try { upsertFn(localOnly.map(r => ({ ...r, shop_id: sid }))); } catch(e) {}
          });
        } else if (localOnly.length > 100) {
          console.warn(`[Supabase] ${tableName} 店铺 ${sid} 本地独有 ${localOnly.length} 条，超过 100 条暂不自动补推（避免大批量请求挂起）`);
        }
      });
    }

    function storeByShop(rows, storageKeyFn) {
      if (!rows || rows.length === 0) return;
      const byShop = {};
      rows.forEach(r => { (byShop[r.shop_id] = byShop[r.shop_id]||[]).push(r); });
      Object.entries(byShop).forEach(([sid, list]) => {
        localStorage.setItem(storageKeyFn(sid), JSON.stringify(list));
      });
    }

    // ===== 并行拉取所有数据（Promise.allSettled 互不阻塞）=====
    const taskDefs = [
      { name: 'shops', critical: true, fn: async () => {
        const cloudShops = await sbFetch('shops?select=*&order=id');
        const localShops = Cache.get('shops', []);
        const activeCloudShops = Array.isArray(cloudShops) ? cloudShops.filter(s => !s.deleted_at) : [];
        if (activeCloudShops.length > 0) {
          const cloudIds = new Set(activeCloudShops.map(s => s.id));
          const extraLocal = localShops.filter(s => !s.deleted_at && !cloudIds.has(s.id));
          // 补齐 currency 字段：云端拉回的 shop 可能没有 currency（旧列缺失），按平台推断填入
          // 本地独有的店铺也按 platform 补 currency
          const isDomestic = (p) => typeof DOMESTIC_PLATFORMS !== 'undefined' && DOMESTIC_PLATFORMS.has(p);
          const allMerged = [...activeCloudShops, ...extraLocal].map(function(s) {
            if (!s) return s;
            if (!s.currency) s.currency = isDomestic(s.platform) ? 'CNY' : 'USD';
            return s;
          });
          Cache.set('shops', allMerged);
          console.log(`[Supabase] 店铺同步：云端 ${activeCloudShops.length} 家 + 本地独有 ${extraLocal.length} 家`);
        } else {
          console.log(`[Supabase] 店铺云端无数据（${activeCloudShops.length}），保留本地 ${localShops.length} 家店铺`);
        }
      }},

      { name: 'sales', critical: false, fn: async () => {
        const allSales = [];
        let offset = 0;
        const PAGE = 1000;
        while (true) {
          const chunk = await sbFetch(`sales?select=*&order=date.desc&limit=${PAGE}&offset=${offset}`);
          if (!chunk || chunk.length === 0) break;
          const mapped = chunk.map(s => ({
            id: s.id, shopId: s.shop_id, shop_id: s.shop_id,
            date: s.date, styleId: s.style_id, style_id: s.style_id,
            styleName: s.style_name, style_name: s.style_name,
            revenue: s.revenue, orders: s.orders,
            refundOrders: s.refund_orders, refund_orders: s.refund_orders, price: s.price,
          }));
          allSales.push(...mapped);
          if (chunk.length < PAGE) break;
          offset += PAGE;
        }
        if (allSales.length > 0) Cache.set('sales', allSales);
      }},

      { name: 'cb_product_costs', critical: false, fn: async () => {
        const costRows = await sbFetch('cb_product_costs?select=*&order=created_at.desc');
        if (Array.isArray(costRows)) localStorage.setItem('ec_cb_product_cost_global', JSON.stringify(costRows));
      }},

      { name: 'cb_orders', critical: true, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        // V216: 增量同步 —— 只在首次/强制/7天未全量时拉全表，否则只拉比本地缓存更新的订单
        const forceFull = window.__forceFullSync ||
          (() => {
            // V218: 必须 key 存在且超过 7 天才视为过期；key 不存在(老用户首次跑 V216+)不触发全量
            const v = parseInt(localStorage.getItem('ec_last_full_sync_orders') || '0');
            return v > 0 && (Date.now() - v > 7 * 24 * 3600 * 1000);
          })();
        const wm = forceFull ? null : _getMaxField('ec_cb_orders_', 'created_at');
        // V219: 子账号（permissions 非空）→ 跳过水印逻辑，直接按权限全量拉自己有权访问的店
        // V217: 三档水印策略 —— 强制全量 / 拿得到本地水印 / 拿不到水印(无 created_at 字段)→ 拉近 30 天兜底
        const _allowedIds = _getAllowedShopIds();
        let filter, syncMode;
        if (_allowedIds) {
          filter = _appendShopFilter('', _allowedIds);
          syncMode = '子账号权限' + _allowedIds.length + '店';
        } else if (forceFull) {
          filter = '';
          syncMode = '全量';
          localStorage.setItem('ec_last_full_sync_orders', String(Date.now()));
        } else if (wm) {
          filter = 'created_at=gte.' + encodeURIComponent(wm);
          syncMode = '增量';
        } else {
          // V228: 干净环境（无本地水印）→ 直接全量，绝不再只拉30天（否则会"所有店铺都很少"）
          filter = '';
          syncMode = '全量(干净环境)';
        }
        const _fc = syncMode.indexOf('子账号')>=0 ? '#7c3aed' : syncMode==='全量' ? '#dc2626' : syncMode==='增量' ? '#16a34a' : '#d97706';
        console.log('%c[Supabase] cb_orders ' + syncMode + ' 同步, 过滤=' + (filter||'(无)'), 'color:' + _fc + ';font-weight:bold;');
        const deleted = (typeof _getDeletedCBOrderIds === 'function') ? _getDeletedCBOrderIds() : new Set();
        // V235: 改用 id 排序
        //   - 之前 created_at.desc 触发 Supabase 500 statement timeout（cb_orders 55,870 条 + 缺 created_at 索引）
        //   - 用户 2026-08-01 截图：001 店 0 行订单，因为 V234 第一批就 timeout → 988 行误判 0<1000 提前 return
        //   - id 列有主键索引，且 id 是字符串时间戳（cbo_<ts>_<rand>），天然有序，足够新→旧排序
        // V237: 实时进度反馈（顶栏"已拉 X 条"）
        const _wrapProgress = (label) => (n) => {
          try { showSyncStatus(`${label} ${n} 条...`, 'info'); } catch(e) {}
          try { onProgress(n); } catch(e) {}
        };
        let rows = await _sbFetchAll('cb_orders', 'id', _wrapProgress('cb_orders 已拉'), filter);
        // 倒序：模拟"按 date desc"行为（CBOrderDB.getAll 本身也按 date 倒序）
        rows.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
        // 过滤本地已删除、但因云端删除失败而残留的记录，确保删除永不回归
        const surviving = deleted.size ? rows.filter(r => !deleted.has(r.id)) : rows;
        if (surviving.length !== rows.length) {
          console.log(`[Supabase] 过滤 ${rows.length - surviving.length} 条已删除订单（云端残留，已重新发起删除）`);
          rows.filter(r => deleted.has(r.id)).forEach(r => { try { sbDeleteCBOrder(r.id); } catch(e){} });
        }
        console.log(`[Supabase] 拉取跨境订单: ${surviving.length} 条`);
        mergeToLocal(surviving, sid => 'ec_cb_orders_' + sid, rows => sbBatchUpsert('cb_orders', rows), 'cb_orders');
        localStorage.setItem('ec_last_full_sync_orders', String(Date.now()));
      }},

      { name: 'cb_refunds', critical: false, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        // V216: 增量同步 —— 同 cb_orders
        const forceFull = window.__forceFullSync ||
          (() => {
            // V218: 必须 key 存在且超过 7 天才视为过期；key 不存在(老用户首次跑 V216+)不触发全量
            const v = parseInt(localStorage.getItem('ec_last_full_sync_refunds') || '0');
            return v > 0 && (Date.now() - v > 7 * 24 * 3600 * 1000);
          })();
        const wm = forceFull ? null : _getMaxField('ec_cb_refunds_', 'created_at');
        // V219: 子账号（permissions 非空）→ 跳过水印逻辑，直接按权限全量拉自己有权访问的店
        // V217: 三档水印策略（与 cb_orders 一致）
        const _allowedIds2 = _getAllowedShopIds();
        let filter, syncMode;
        if (_allowedIds2) {
          filter = _appendShopFilter('', _allowedIds2);
          syncMode = '子账号权限' + _allowedIds2.length + '店';
        } else if (forceFull) {
          filter = '';
          syncMode = '全量';
          localStorage.setItem('ec_last_full_sync_refunds', String(Date.now()));
        } else if (wm) {
          filter = 'created_at=gte.' + encodeURIComponent(wm);
          syncMode = '增量';
        } else {
          // V228: 干净环境（无本地水印）→ 直接全量，绝不再只拉30天
          filter = '';
          syncMode = '全量(干净环境)';
        }
        const _fc = syncMode.indexOf('子账号')>=0 ? '#7c3aed' : syncMode==='全量' ? '#dc2626' : syncMode==='增量' ? '#16a34a' : '#d97706';
        console.log('%c[Supabase] cb_refunds ' + syncMode + ' 同步, 过滤=' + (filter||'(无)'), 'color:' + _fc + ';font-weight:bold;');
        // V224c: 修 V218 之前的 bug —— cb_refunds task 漏了 _sbFetchAll，rows 未定义导致 sync 失败
        const rows = await _sbFetchAll('cb_refunds', 'date.desc', onProgress, filter);
        console.log(`[Supabase] 拉取退货退款: ${rows.length} 条`);
        mergeToLocal(rows, sid => 'ec_cb_refunds_' + sid, rows => sbBatchUpsert('cb_refunds', rows), 'cb_refunds');
        localStorage.setItem('ec_last_full_sync_refunds', String(Date.now()));
      }},

      { name: 'cb_reviews', critical: false, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        const rows = await _sbFetchAll('cb_reviews', 'date.desc', onProgress);
        console.log(`[Supabase] 拉取差评率: ${rows.length} 条`);
        mergeToLocal(rows, sid => 'ec_cb_reviews_' + sid, rows => sbBatchUpsert('cb_reviews', rows), 'cb_reviews');
      }},

      { name: 'cb_sku_reviews', critical: false, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        const rows = await _sbFetchAll('cb_sku_reviews', 'date.desc', onProgress);
        console.log(`[Supabase] 拉取款式差评明细: ${rows.length} 条`);
        mergeToLocal(rows, sid => 'ec_cb_sku_reviews_' + sid, rows => sbBatchUpsert('cb_sku_reviews', rows), 'cb_sku_reviews');
      }},

      { name: 'cb_daily', critical: true, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        const rows = await _sbFetchAll('cb_daily', 'date.desc', onProgress);
        console.log(`[Supabase] 拉取每日数据: ${rows.length} 条`);
        mergeToLocal(rows, sid => 'ec_cb_daily_' + sid, rows => sbBatchUpsertCBDaily(rows), 'cb_daily');
      }},

      { name: 'shop_products', critical: false, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        const rows = await _sbFetchAll('shop_products', 'created_at.desc', onProgress);
        storeByShop(rows, sid => 'ec_products_' + sid);
      }},

      { name: 'domestic_stats', critical: false, fn: async (opts) => {
        const onProgress = (opts && opts.onProgress) || function() {};
        const rows = await _sbFetchAll('domestic_stats', 'date.desc', onProgress);
        storeByShop(rows, sid => 'ec_domestic_stats_' + sid);
      }},

      { name: 'cb_shipping_rates', critical: false, fn: async () => {
        const rateRows = await sbFetch('cb_shipping_rates?select=*');
        if (Array.isArray(rateRows)) {
          rateRows.forEach(r => localStorage.setItem('ec_cb_shipping_rate_' + r.shop_id, String(r.rate)));
        }
      }},

      { name: 'shop_access_requests', critical: false, fn: async () => {
        const reqRows = await sbFetch('shop_access_requests?select=*&order=created_at.desc');
        if (Array.isArray(reqRows)) {
          const mapped = reqRows.map(r => ({
            id: r.id, shopId: r.shop_id, shopName: r.shop_name,
            applicantId: r.applicant_id, applicantName: r.applicant_name,
            reason: r.reason, status: r.status, createdAt: r.created_at,
          }));
          localStorage.setItem('shop_access_requests', JSON.stringify(mapped));
        }
      }},
    ];

    // ===== 进度反馈：按数据量加权（避免 cb_orders 等大表长时间没进度） =====
    // 给每个任务预估权重，cb_orders 是大表占大比例
    const taskWeights = {
      shops: 2, sales: 5, cb_product_costs: 1, cb_orders: 30,
      cb_refunds: 8, cb_reviews: 2, cb_sku_reviews: 5, cb_daily: 5,
      shop_products: 5, domestic_stats: 5, cb_shipping_rates: 1,
      shop_access_requests: 1
    };
    const totalWeight = Object.values(taskWeights).reduce(function(s, v) { return s + v; }, 0);
    const progressByTask = {};
    const updateProgress = function(name, currentCount) {
      if (progressByTask[name] === undefined) progressByTask[name] = 0;
      if (currentCount !== undefined) progressByTask[name] = currentCount;
      let totalScore = 0;
      Object.keys(taskWeights).forEach(function(k) {
        // 子任务：按累计拉取量估算（最多完成 10 倍任务权重，认为 100% 完成该子任务）
        const cnt = progressByTask[k] || 0;
        const w = taskWeights[k] || 1;
        // 经验：拉够 10000 条数据视为子任务完成
        const subPct = Math.min(1, cnt / 10000);
        totalScore += w * (k === name && currentCount === undefined ? 1 : subPct);
      });
      // 对于已标记完成的任务（currentCount === undefined），score 强制 1
      // 但 _init_progress 没用这里就靠每个 task 完成时设置 100%
      // V153: 取消 99% 封顶，让进度自然到 100%；当所有 task 完成时由调用方替换为 "✓ 数据已同步"
      const pct = Math.min(100, Math.round(totalScore / totalWeight * 100));
      try {
        localStorage.setItem('ec_sync_progress', JSON.stringify({
          pct: pct,
          name: name,
          count: currentCount || progressByTask[name] || 0,
          ts: Date.now()
        }));
        if (!silent) showSyncStatus('⟳ 同步中 ' + pct + '%（' + name + (currentCount ? ' ' + currentCount + ' 条' : '') + '）');
      } catch(e) {}
    };
    // 初始化所有任务为 0
    Object.keys(taskWeights).forEach(function(k) { progressByTask[k] = 0; });

    const wrappedTasks = taskDefs.map(function(t) {
      const onProgress = function(cnt) { updateProgress(t.name, cnt); };
      return {
        name: t.name,
        critical: t.critical,
        fn: async function() {
          try {
            // 把 onProgress 注入到 fn 中（如果 task.fn 支持）
            const r = await t.fn({ onProgress: onProgress });
            updateProgress(t.name, 99999); // 标记完成
            return r;
          } catch(e) {
            updateProgress(t.name, 99999); // 即使失败也标记完成（避免永远卡 92%）
            throw e;
          }
        }
      };
    });
    const results = await Promise.allSettled(wrappedTasks.map(t => t.fn()));

    // 记录失败的同步任务
    const failed = results.filter(r => r.status === 'rejected');
    const criticalFailed = results.filter((r, i) => r.status === 'rejected' && taskDefs[i].critical);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn(`[Supabase] 同步任务失败 [${taskDefs[i].name}]:`, r.reason && r.reason.message ? r.reason.message : r.reason);
      }
    });
    if (criticalFailed.length > 0) {
      console.warn(`[Supabase] ${failed.length} 个同步任务失败（其中关键任务 ${criticalFailed.length} 个）`);
      if (!silent) showSyncStatus('⚠ 部分同步失败（' + criticalFailed.length + '项），数据可能不完整', 'warn');
    } else if (failed.length > 0) {
      console.warn(`[Supabase] ${failed.length} 个非关键同步任务失败，已忽略`);
      if (!silent) showSyncStatus('✓ 数据已同步', 'ok');
      // 非关键任务失败（如成本、差评等不影响核心功能）仍可记录同步时间
      localStorage.setItem('ec_last_sync_time', String(Date.now()));
    } else {
      if (!silent) showSyncStatus('✓ 数据已同步', 'ok');
      // 全部同步成功后才记录同步时间
      localStorage.setItem('ec_last_sync_time', String(Date.now()));
    }
    // V161: 同步是直写 localStorage（绕过 DB 对象），失效内存缓存让下次读取拉到最新数据
    try { if (typeof window.__invalidateAllDBCache === 'function') window.__invalidateAllDBCache(); } catch(e) {}
    // 同步完成：清理进度信息，触发看板刷新
    try {
      localStorage.removeItem('ec_sync_progress');
      // 触发数据看板自动重新渲染（如果当前正在数据看板页面）
      if (typeof window._renderCrossDashboard === 'function' && document.getElementById('db-tab-content')) {
        setTimeout(function() {
          if (typeof window.renderDashboard === 'function') window.renderDashboard();
          else if (typeof window._renderDashboardContent === 'function') {
            var pg = document.getElementById('page-dashboard');
            if (pg) window._renderDashboardContent(pg);
          }
        }, 100);
      }
    } catch(e) {}
    // V220: 派发 ec-data-synced 事件，让 data-sync-refresh-v1.js 监听后重渲染当前店铺页面
    //   原因：mergeToLocal 只写 localStorage 不调 UI refresh，首屏渲染时 localStorage 可能是空的，
    //         后台同步写完数据后必须通知 UI 重新拉数据渲染
    setTimeout(function() {
      try {
        if (typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('ec-data-synced', {detail: {ts: Date.now(), source: 'syncFromSupabase'}}));
        } else if (typeof window.Event === 'function') {
          var ev = document.createEvent('Event');
          ev.initEvent('ec-data-synced', true, true);
          window.dispatchEvent(ev);
        }
      } catch(e) { console.warn('[V220] dispatch ec-data-synced failed:', e); }
    }, 200);
    return failed.length === 0;
  } catch(e) {
    console.warn('[Supabase] 同步失败:', e.message);
    if (!silent) showSyncStatus('⚠ 云端同步失败，使用本地数据', 'warn');
    return false;
  }
}

// V216: 扫描本地缓存，返回某表各店铺已缓存数据里某个时间字段的最大值（增量同步水印）
//   prefix 形如 'ec_cb_orders_'；field 形如 'created_at'
function _getMaxField(prefix, field) {
  let max = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(prefix) !== 0) continue;
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const v = r && r[field];
        if (v && (max === null || v > max)) max = v;
      }
    }
  } catch (e) {}
  return max;
}

// 分页拉取所有数据（使用 offset+limit 查询参数，兼容 Supabase max_rows 限制）
// V216: 新增可选 filter（如 'created_at=gte.2026-07-01T00:00:00Z'），用于增量同步只拉新数据
async function _sbFetchAll(table, order = 'id', onProgress = null, filter = '') {
  // V244: 每批从 1000 → 5000（data-api 上限），56 批 → 12 批；cb_orders 55K 行从 ~2 分钟降到 ~25 秒
  const PAGE = 5000;
  // V244: 从腾讯云内网拉自己更稳，恢复 2 路并发
  const CONCURRENCY = 2;
  // V244: 8s → 15s（5000 行单批 CloudBase NoSQL 可能要 5-10s offset 扫描）
  const FETCH_TIMEOUT_MS = 15000;
  // V244: 连续失败 5 批立即放弃（更宽容）
  const MAX_CONSECUTIVE_FAILS = 5;
  const all = [];
  let currentOrder = order;
  let orderTried = false; // 是否已经尝试过用 id 排序兜底
  const _filterSuffix = filter ? ('&' + filter) : '';

  // V153: 先 HEAD 预查总数（仅查一行 + content-range），更准确的总数 + 更准的进度
  let totalEstimated = 0;
  try {
    const headRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=id&limit=1' + _filterSuffix, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'count=exact'
      }
    });
    if (headRes.ok) {
      const range = headRes.headers.get('content-range');
      if (range && range.includes('/')) {
        totalEstimated = parseInt(range.split('/')[1]) || 0;
      }
    }
  } catch (e) { /* 预查失败不影响主流程 */ }

  // V153: 并发分页（限制最大 100 个分页 = 10 万条，避免极端情况卡死）
  // V233: 并发数从 3 降为 2（3 路并发在 CloudBase → Supabase 网络不稳时部分失败概率高，导致大量数据丢失）
  // V237: 加连续失败计数器（连续 MAX_CONSECUTIVE_FAILS 批失败 → 立即停，保留已有数据）
  let pageIdx = 0;
  let lastErr = null;
  let consecutiveFails = 0;
  while (pageIdx * PAGE < (totalEstimated || 1e9)) {
    // 构造本批次 [pageIdx, pageIdx+CONCURRENCY) 的请求
    const batchPromises = [];
    for (let p = 0; p < CONCURRENCY; p++) {
      const offset = (pageIdx + p) * PAGE;
      const url = SUPABASE_URL + '/rest/v1/' + table + '?select=*&order=' + encodeURIComponent(currentOrder) + '&limit=' + PAGE + '&offset=' + offset + _filterSuffix;
      // V234: 用 AbortController 设超时，避免某页卡住整个 sync
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      batchPromises.push(
        fetch(url, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Accept': 'application/json',
          },
          signal: controller.signal
        }).then(async function(res) {
          clearTimeout(timeoutId);
          if (!res.ok) {
            const text = await res.text();
            const status = res.status;
            const err = new Error('[' + status + '] ' + text);
            err.status = status;
            throw err;
          }
          return res.json();
        }).catch(function(e) {
          clearTimeout(timeoutId);
          if (e.name === 'AbortError') {
            return { __fetch_error: new Error('timeout after ' + FETCH_TIMEOUT_MS + 'ms') };
          }
          return { __fetch_error: e };
        })
      );
    }
    const batchResults = await Promise.all(batchPromises);

    // 检查本批次的错误：表不存在直接返回；排序错误则降级到 id 排序重试整批
    let tableMissing = false;
    let orderError = false;
    let anyRealError = false;
    for (const r of batchResults) {
      if (r && r.__fetch_error) {
        const e = r.__fetch_error;
        if (e.status === 404) { tableMissing = true; break; }
        if ((e.status === 400 || e.status === 406) && !orderTried && currentOrder !== 'id') {
          orderError = true; break;
        }
        anyRealError = true;
        lastErr = e.message;
      }
    }
    if (tableMissing) {
      console.warn('[Sync] 表 ' + table + ' 不存在（404），跳过该表');
      return [];
    }
    if (orderError && !orderTried) {
      console.warn('[Sync] ' + table + ' 按 ' + order + ' 排序失败，尝试按 id 排序');
      currentOrder = 'id';
      orderTried = true;
      // 清空已收集的（因为顺序不同），重新跑
      all.length = 0;
      pageIdx = 0;
      totalEstimated = 0; // 重新预查
      continue;
    }
    if (anyRealError) {
      // 网络/限流错误：本批次若有部分成功也继续，没有则失败
      const successChunks = batchResults.filter(r => Array.isArray(r));
      if (successChunks.length === 0) {
        // V237: 连续失败计数（网络/限流 = 服务器卡，本批 0 条成功）
        consecutiveFails++;
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          console.warn(`[Sync] ${table} 连续 ${MAX_CONSECUTIVE_FAILS} 批失败，立即停止，保留已拉 ${all.length} 条数据。最后错误: ${lastErr}`);
          if (typeof showSyncStatus === 'function') showSyncStatus(`云端拉取失败（已保留 ${all.length} 条本地数据）`, 'warn');
          return all;
        }
        if (all.length > 0) {
          console.warn('[Sync] ' + table + ' 分页失败但已获取 ' + all.length + ' 条:', lastErr);
          return all;
        }
        throw new Error('分页拉取 ' + table + ' 失败: ' + lastErr);
      }
      // V237: 本批部分成功，重置失败计数
      consecutiveFails = 0;
      // V233: 部分成功时，先合并成功的；**对失败的 offset 单页串行重试**（最多 3 次）
      // 之前逻辑：pageIdx += CONCURRENCY 直接跳到下一个 offset，失败页数据永久丢失（用户 002 店只拉到 601/17628 条）
      for (const c of successChunks) all.push(...c);
      for (let p = 0; p < CONCURRENCY; p++) {
        const failed = batchResults[p];
        if (failed && failed.__fetch_error) {
          const offset = (pageIdx + p) * PAGE;
          let retried = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const retryUrl = SUPABASE_URL + '/rest/v1/' + table + '?select=*&order=' + encodeURIComponent(currentOrder) + '&limit=' + PAGE + '&offset=' + offset + _filterSuffix;
              const r = await fetch(retryUrl, {
                method: 'GET',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': 'Bearer ' + SUPABASE_KEY,
                  'Accept': 'application/json',
                }
              });
              if (r.ok) {
                retried = await r.json();
                if (Array.isArray(retried) && retried.length) {
                  console.log(`[Sync] ${table} offset ${offset} 重试第 ${attempt} 次成功，补回 ${retried.length} 条`);
                  all.push(...retried);
                }
                break;
              }
            } catch (e) {
              if (attempt < 3) await new Promise(res => setTimeout(res, 1000 * attempt));
              else console.warn(`[Sync] ${table} offset ${offset} 重试 3 次仍失败:`, failed.__fetch_error.message || lastErr);
            }
          }
        }
      }
    } else {
      for (const chunk of batchResults) all.push(...chunk);
      // V237: 整批成功，重置连续失败计数
      consecutiveFails = 0;
    }

    if (onProgress) {
      try { onProgress(all.length); } catch(e) {}
    }

    // V233: 移除"整批提前 return"的判断。改为：已拉总数 >= 预查总数 时才 return
    // 之前 totalFetched < PAGE * CONCURRENCY 时直接 return，会让"部分分页失败"的批次后没继续拉剩余页
    if (totalEstimated > 0 && all.length >= totalEstimated) {
      console.log(`[Sync] ${table} 已拉取 ${all.length}/${totalEstimated} 条，结束`);
      return all;
    }
    // V235: HEAD 失败时，"本批 0 条"才停，避免某页 0 条就被卡死
    //   - V234 bug: 988 行 `totalFetched < PAGE * CONCURRENCY` → 第一批 fetch 拿到 500 错误时 totalFetched=0
    //     → 提前 return → 整个 cb_orders 同步失败，内存 Map 空
    const totalFetched = batchResults.reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0);
    if (totalEstimated === 0) {
      // 没有任何预查总数时，靠"完全拉不到"判断停止（pageIdx>0 防止 pageIdx=0 首空也停）
      if (totalFetched === 0 && pageIdx > 0) return all;
    }

    pageIdx += CONCURRENCY;
    if (all.length >= 100000) {
      console.warn('[Sync] ' + table + ' 超过 10 万条安全上限，停止继续拉取');
      return all;
    }
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
  if (type === 'ok' || type === 'info') {
    setTimeout(() => { if(el && el.textContent === msg) el.textContent = '✓ 已同步'; }, 5000);
  }
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
// 已删除订单的本地记录：即使云端删除失败（如项目暂停/网络异常），
// 下次同步时也据此过滤，确保被删订单永不回归本地。
const CB_DELETED_ORDERS_KEY = 'ec_cb_orders_deleted_v2';
function _getDeletedCBOrderIds() {
  try { return new Set(JSON.parse(localStorage.getItem(CB_DELETED_ORDERS_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _markCBOrderDeleted(id) {
  try {
    const s = _getDeletedCBOrderIds();
    s.add(id);
    localStorage.setItem(CB_DELETED_ORDERS_KEY, JSON.stringify([...s]));
  } catch(e) {}
}
window._markCBOrderDeleted = _markCBOrderDeleted;
window._getDeletedCBOrderIds = _getDeletedCBOrderIds;
async function sbBatchUpsertCBOrders(rows, onProgress) {
  if (!SUPABASE_ENABLED || !rows.length) return { ok: 0, fail: 0 };
  const BATCH = 10; // 进一步减小批次到10条，彻底避免 Supabase 400/请求过大（内联兜底已同步）
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    // 标准化为 cb_orders 表允许的字段，避免 product_name/cost/spec 等未知列导致失败
    const chunk = rows.slice(i, i + BATCH).map(row => ({
      id: row.id,
      shop_id: row.shop_id,
      date: row.date,
      sku: row.sku || '',
      sale_amount: row.sale_amount || 0,
      remark: ((row.product_name || '') + (row.spec ? ' ' + row.spec : '') + (row.remark || '')).trim()
    }));
    // 最多重试2次
    let success = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        await sbFetch('cb_orders', 'POST', chunk, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
        ok += chunk.length;
        success = true;
        break;
      } catch(e) {
        const msg = (e.message || '').toLowerCase();
        // 如果是重复键冲突，说明云端已存在该记录，视为成功
        if (msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('23505')) {
          console.log('[Supabase] 云端已存在，跳过:', chunk.length, '条');
          ok += chunk.length;
          success = true;
          break;
        }
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

// ============ 初始化示例数据 + V244 自动清理旧测试店 ============
function initDemoData() {
  // V244: 如果 Supabase 已启用，自动清理 localStorage 中残留的旧测试/demo 店铺
  if (SUPABASE_ENABLED) {
    const TEST_PATTERNS = ['SHEIN官方店','SHEIN旗舰店','SHEIN精选店','SHEIN女装店',
      'SHEIN新品店','SHEIN欧美店','SHEIN东南亚','SHEIN中东店','SHEIN日本','SHEIN韩国',
      'SHEIN法国','SHEIN美国','test_shop'];
    function isTestShop(s) { return s && s.name && TEST_PATTERNS.some(p => s.name.includes(p)); }

    const raw = localStorage.getItem('shein_shops_v2');
    if (raw) {
      try {
        const shops = JSON.parse(raw);
        if (Array.isArray(shops)) {
          const cleaned = shops.filter(s => !isTestShop(s));
          if (cleaned.length < shops.length) {
            localStorage.setItem('shein_shops_v2', JSON.stringify(cleaned));
            console.log('[V244] 自动清理旧测试店: ' + (shops.length - cleaned.length) + ' 条');
          }
        }
      } catch(e) {}
    }

    // V244: 清理 localStorage 中的兜底账号（_fromBackup=true / id starts with 'backup_'）
    // 原因：之前用过 V239 兜底账号登录的，"总账号" 这种 backup 账号被写进 localStorage，
    //       在 admin 页面和 CloudBase 真账号（AC/小张/191）手机号重名导致显示重复
    try {
      const raw = localStorage.getItem('shein_local_users');
      if (raw) {
        const users = JSON.parse(raw);
        if (Array.isArray(users)) {
          const filtered = users.filter(u => !(u && (u._fromBackup === true || (u.id && u.id.indexOf('backup_') === 0))));
          if (filtered.length < users.length) {
            localStorage.setItem('shein_local_users', JSON.stringify(filtered));
            console.log('[V244] 自动清理兜底账号: ' + (users.length - filtered.length) + ' 个');
          }
        }
      }
    } catch(e) {}
    return;
  }

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
  const d = new Date();
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

// ===== 暴露到 window（解决跨脚本访问） =====
window.DB = DB;
window.Cache = Cache;
window.SUPABASE = (typeof SUPABASE !== 'undefined') ? SUPABASE : null;
window.PAGE = (typeof PAGE !== 'undefined') ? PAGE : null;
window.BATCH = (typeof BATCH !== 'undefined') ? BATCH : null;

// ============ V237: 跨境订单 Excel 导入（兜底方案） ============
// 背景：cb_orders 55,870 条在 Supabase，但 PostgREST 在 CloudBase CDN 后端频繁 60s+ 不响应
//   - 即便 V235/V237 改了 8s 超时+连续失败停，仍可能拉到 0 条
// 方案：让用户从 SHEIN 官方导出的「导出订单-*.xlsx」（典型 70-500 行）直接导入
//   - 用户切到目标店铺 → 点 "📥 Excel导入" → 选 xlsx → 入当前店铺内存 → 推云端
//   - 文件按 SHEIN 列名（订单号/订单创建时间/商品价格/卖家SKU/...）识别
//   - 同一店铺多次上传会按订单号+SKU+日期去重
window._importCBOrdersFromExcel = async function(file, targetShopId) {
  if (!file) return { ok: 0, fail: 0, msg: '未选择文件' };
  if (!targetShopId) {
    // 默认用当前选中店铺
    targetShopId = (typeof window !== 'undefined' && window.currentShopId) || null;
  }
  if (!targetShopId) {
    alert('请先切换到目标店铺，再上传订单 Excel');
    return { ok: 0, fail: 0, msg: '未选择店铺' };
  }
  if (typeof XLSX === 'undefined') {
    alert('SheetJS 未加载，无法解析 Excel');
    return { ok: 0, fail: 0, msg: 'XLSX 未加载' };
  }
  showSyncStatus('解析 Excel 中...', 'info');
  let rows;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  } catch (e) {
    console.error('[Excel导入] 解析失败:', e);
    showSyncStatus('Excel 解析失败: ' + e.message, 'error');
    return { ok: 0, fail: 0, msg: '解析失败: ' + e.message };
  }
  if (!rows || !rows.length) {
    showSyncStatus('Excel 无数据', 'warn');
    return { ok: 0, fail: 0, msg: 'Excel 无数据' };
  }
  console.log(`[Excel导入] 解析到 ${rows.length} 行, 表头字段:`, Object.keys(rows[0] || {}).slice(0, 15));
  // 字段映射（SHEIN 官方导出订单 Excel 列名）
  const headerMap = {
    '订单号': 'order_no',
    '订单创建时间': 'created_at',
    '商品名称': 'product_name',
    '货号': 'sku_base',
    '规格': 'spec',
    '卖家SKU': 'sku',
    '商品价格': 'sale_amount',
    '商品销售件数': 'qty',
    '预计商品收入': 'expected_income',
    '订单状态': 'status',
    '商品销售件数': 'qty',
    '运单号': 'tracking_no',
    '签收时间': 'sign_at',
  };
  // 标准化为 cb_orders 表字段
  const parsed = [];
  for (const r of rows) {
    const norm = { shop_id: targetShopId };
    Object.keys(r).forEach(k => {
      const mapped = headerMap[k] || k;
      norm[mapped] = r[k];
    });
    // 必须字段兜底
    if (!norm.id) {
      // 构造稳定 id：cbo_<shop>_<order_no>_<sku>_<seq>
      const seq = parsed.filter(x => x.order_no === norm.order_no && x.sku === norm.sku).length + 1;
      norm.id = `cbo_${targetShopId}_${norm.order_no || ''}_${norm.sku || ''}_${seq}`;
    }
    if (!norm.date && norm.created_at) {
      // created_at 可能是 Date 对象 / "2026-07-15 09:41" / Excel 序列号
      const d = norm.created_at;
      if (d instanceof Date && !isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        norm.date = `${y}-${mo}-${dy}`;
      } else if (typeof d === 'string') {
        const m = d.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (m) norm.date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      } else if (typeof d === 'number' && d > 20000) {
        const dt = new Date((d - 25569) * 86400 * 1000);
        norm.date = dt.toISOString().slice(0, 10);
      }
    }
    if (!norm.date) norm.date = new Date().toISOString().slice(0, 10);
    if (typeof norm.sale_amount === 'string') {
      norm.sale_amount = parseFloat(norm.sale_amount.replace(/[^\d.-]/g, '')) || 0;
    }
    parsed.push(norm);
  }
  console.log(`[Excel导入] 标准化完成: ${parsed.length} 条，目标店铺=${targetShopId}`);
  // 写入内存（去重）
  if (!window.__EC_CB_ORDERS) window.__EC_CB_ORDERS = {};
  const existing = window.__EC_CB_ORDERS[targetShopId] || [];
  const existIds = new Set(existing.map(r => r.id));
  let added = 0, skipped = 0;
  const newRows = [];
  for (const r of parsed) {
    if (existIds.has(r.id)) { skipped++; continue; }
    newRows.push(r);
    existIds.add(r.id);
    added++;
  }
  const merged = [...newRows, ...existing].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  window.__EC_CB_ORDERS[targetShopId] = merged;
  console.log(`[Excel导入] 入内存: 新增 ${added} 条, 跳过 ${skipped} 条 (已存在), 合计 ${merged.length} 条`);
  // 推云端
  let pushResult = null;
  try {
    if (added > 0) {
      showSyncStatus(`上传 ${added} 条到云端...`, 'info');
      pushResult = await sbBatchUpsertCBOrders(newRows, function(p) {
        try { showSyncStatus(`上传 ${p}/${added}...`, 'info'); } catch(e) {}
      });
    }
  } catch (e) {
    console.warn('[Excel导入] 推云端失败（数据已保存到本地）:', e.message);
  }
  showSyncStatus(`Excel导入完成: 新增 ${added} 条`, 'ok');
  // 触发重渲染：让所有调用 CBOrderDB.getAll 的地方刷新
  try { if (typeof window.refreshCurrentPage === 'function') window.refreshCurrentPage(); } catch(e) {}
  return { ok: added, fail: 0, skipped, total: merged.length, pushResult };
};
