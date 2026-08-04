/* ==========================================================================
 * analysis-center-page-v1.js  (V193i)
 * 把店铺详情页内嵌的「📉 掉量分析」「⭐ 好评差评」「📈 提升分析」
 * 3 个子 tab 抽成顶级独立页面，挂在左侧导航「核心功能」组内。
 *
 * 与 V174 drop-analysis-page-v1.js 的区别：
 *   - V174 只有掉量/好评 2 个页面（V184 已停用）
 *   - 本次新增「📈 提升分析」（原 V189 店铺详情页内嵌）
 *   - 3 个分析子 tab 都在同一个顶级页面下，按"子 tab 切换"，单页面承载
 *
 * 数据源：
 *   - 掉量分析：复用 window.DropAnalysis.computeDropRanking（V159）
 *   - 好评差评：复用 window.DropAnalysis.getReviewTypeStats（V159）
 *   - 提升分析：复用本文件内置 computeBoostRanking（原 shop-detail-analysis-v1.js 拷贝）
 *
 * 实现：
 *   1) 渲染 page-analysis-center 顶级页面 + 3 个子 tab + 店铺选择器（含"全平台"）
 *   2) monkey-patch window.navigate：拦截 analysis-center，调用原 navigate 后渲染
 *   3) 不动 minified 主代码，纯外部补丁
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__analysisCenterLoaded) return;
  window.__analysisCenterLoaded = true;
  console.log('[V193i analysis-center-page] loaded');

  // ============================================================
  // 工具函数
  // ============================================================
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _fmtInt(n) { n = parseInt(n) || 0; return n.toLocaleString('en-US'); }
  function _fmtMoney(n) { n = parseFloat(n) || 0; if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万'; return n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function _pct(n) { if (!isFinite(n)) return '0%'; return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }

  function _getShops() {
    try { if (window.DB && window.DB.getShops) return window.DB.getShops() || []; } catch (e) {}
    return [];
  }
  function _getShopName(shopId) {
    try { if (window.DB && window.DB.getShop) { var s = window.DB.getShop(shopId); if (s) return s.name || shopId; } } catch (e) {}
    return shopId;
  }

  // 跨店铺统计卡（顶部用）
  function _computeShopHealth(shopId) {
    var drop = (window.DropAnalysis && window.DropAnalysis.computeDropRanking)
      ? window.DropAnalysis.computeDropRanking(shopId, 'week') : { rows: [] };
    var rev = (window.DropAnalysis && window.DropAnalysis.getReviewTypeStats)
      ? window.DropAnalysis.getReviewTypeStats(shopId) : { shop: { good: 0, bad: 0, neutral: 0, total: 0, positiveRate: 0, negativeRate: 0 } };
    var boost = _computeBoostRanking(shopId, 'week');

    var dropCount = drop.rows ? drop.rows.length : 0;
    var boostCount = boost.rows ? boost.rows.length : 0;
    var badRate = rev.shop.negativeRate || 0;
    var health = badRate < 10 ? 'green' : (badRate < 30 ? 'yellow' : 'red');
    var healthColor = health === 'green' ? '#52c41a' : (health === 'yellow' ? '#faad14' : '#f5222d');
    var healthLabel = health === 'green' ? '健康' : (health === 'yellow' ? '关注' : '异常');

    return {
      shopName: _getShopName(shopId),
      dropCount: dropCount,
      boostCount: boostCount,
      negCount: rev.shop.bad || 0,
      goodCount: rev.shop.good || 0,
      totalReviews: rev.shop.total || 0,
      badRate: badRate,
      goodRate: rev.shop.positiveRate || 0,
      health: health,
      healthColor: healthColor,
      healthLabel: healthLabel
    };
  }

  // ============================================================
  // 「提升分析」数据计算（拷贝自 shop-detail-analysis-v1.js computeBoostRanking）
  // ============================================================
  function _safeGetAll(dbName, shopId) {
    try {
      var db = window[dbName];
      if (!db) return [];
      if (typeof db.get === 'function') return db.get(shopId) || [];
      if (typeof db.getAll === 'function') return db.getAll(shopId) || [];
      if (typeof db[shopId] !== 'undefined') return db[shopId] || [];
      return [];
    } catch (e) { return []; }
  }
  function _normalizeSku(s) {
    if (s == null) return '未知';
    s = String(s).trim();
    return s || '未知';
  }
  function _allOrderDates(orders) {
    var set = {};
    orders.forEach(function (o) { if (o && o.date) set[o.date] = 1; });
    return Object.keys(set).sort();
  }
  function _computeBoostRanking(shopId, mode) {
    mode = (mode === 'week') ? 'week' : 'day';
    var orders = _safeGetAll('CBOrderDB', shopId);
    var refunds = _safeGetAll('CBRefundDB', shopId);
    var skuReviews = _safeGetAll('CBSkuReviewDB', shopId);

    var dates = _allOrderDates(orders);
    if (dates.length === 0) return { mode: mode, label: '', curLabel: '', prevLabel: '', rows: [], empty: true };

    var curFrom, curTo, prevFrom, prevTo;
    if (mode === 'day') {
      curTo = dates[dates.length - 1];
      curFrom = curTo;
      prevTo = dates.length >= 2 ? dates[dates.length - 2] : curTo;
      prevFrom = prevTo;
    } else {
      curTo = dates[dates.length - 1];
      var idx7 = Math.max(0, dates.length - 7);
      curFrom = dates[idx7];
      prevTo = dates[Math.max(0, idx7 - 1)];
      var idxPrev = Math.max(0, idx7 - 7);
      prevFrom = dates[idxPrev];
    }
    function inRange(d, from, to) { return d && d >= from && d <= to; }

    var curMap = {}, prevMap = {};
    orders.forEach(function (o) {
      var sku = _normalizeSku(o.sku);
      var amt = parseFloat(o.sale_amount) || 0;
      if (inRange(o.date, curFrom, curTo)) {
        if (!curMap[sku]) curMap[sku] = { count: 0, amount: 0 };
        curMap[sku].count++; curMap[sku].amount += amt;
      } else if (inRange(o.date, prevFrom, prevTo)) {
        if (!prevMap[sku]) prevMap[sku] = { count: 0, amount: 0 };
        prevMap[sku].count++; prevMap[sku].amount += amt;
      }
    });

    var refundMap = {};
    refunds.forEach(function (r) {
      if (inRange(r.date, curFrom, curTo)) {
        var sku = _normalizeSku(r.sku);
        if (!refundMap[sku]) refundMap[sku] = { qty: 0, amount: 0 };
        refundMap[sku].qty += parseInt(r.qty) || 1;
        refundMap[sku].amount += parseFloat(r.refund_amount || r.amount) || 0;
      }
    });

    var negMap = {};
    skuReviews.forEach(function (r) {
      if (inRange(r.date, curFrom, curTo) && (r.type === 'bad')) {
        var sku = _normalizeSku(r.sku);
        negMap[sku] = (negMap[sku] || 0) + 1;
      }
    });

    var allSkus = {};
    Object.keys(curMap).forEach(function (k) { allSkus[k] = 1; });
    Object.keys(prevMap).forEach(function (k) { allSkus[k] = 1; });

    var rows = [];
    Object.keys(allSkus).forEach(function (sku) {
      var c = curMap[sku] || { count: 0, amount: 0 };
      var p = prevMap[sku] || { count: 0, amount: 0 };
      var delta = c.count - p.count;
      var upPct = p.count > 0 ? (delta / p.count * 100) : (c.count > 0 ? 100 : 0);
      var refund = refundMap[sku] || { qty: 0, amount: 0 };
      var neg = negMap[sku] || 0;
      var reasons = [];
      if (neg > 0) reasons.push('同期差评 ' + neg + ' 条');
      if (refund.qty > 0) reasons.push('同期退货 ' + refund.qty + ' 单');
      var reason = reasons.length ? reasons.join(' · ') : '自然增长/爆款潜力';
      rows.push({
        sku: sku,
        curCount: c.count, curAmount: c.amount,
        prevCount: p.count, prevAmount: p.amount,
        delta: delta, upPct: upPct,
        refundQty: refund.qty, refundAmount: refund.amount,
        negCount: neg, reason: reason
      });
    });

    rows = rows.filter(function (r) { return r.delta > 0; });
    rows.sort(function (a, b) {
      if (b.upPct !== a.upPct) return b.upPct - a.upPct;
      return (b.curCount - b.prevCount) - (a.curCount - a.prevCount);
    });
    rows = rows.slice(0, 50);

    var label = mode === 'day'
      ? '日环比（最新一天 vs 前一天）'
      : '周环比（近 7 天 vs 前 7 天）';

    return {
      mode: mode,
      label: label,
      curLabel: curFrom === curTo ? curTo : (curFrom + ' ~ ' + curTo),
      prevLabel: prevFrom === prevTo ? prevTo : (prevFrom + ' ~ ' + prevTo),
      rows: rows,
      empty: false
    };
  }

  // ============================================================
  // 页面框架
  // ============================================================
  function _buildShell() {
    var page = document.getElementById('page-analysis-center');
    if (!page) return null;
    page.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'v193i-page';
    wrap.style.cssText = 'padding:18px 22px;max-width:100%';

    // 顶部标题
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px';
    titleRow.innerHTML = '<div style="font-size:20px;font-weight:700;color:#1f2937">📊 分析中心</div>'
      + '<div style="font-size:12px;color:#64748b">掉量分析 · 好评差评 · 提升分析 · 跨店可汇总</div>';
    wrap.appendChild(titleRow);

    // 店铺选择 + 子tab 行
    var ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px';

    var shops = _getShops();
    var selId = 'v193i-shop-sel';
    var labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:12px;color:#475569;font-weight:600';
    labelEl.textContent = '分析店铺：';
    ctrlRow.appendChild(labelEl);

    var sel = document.createElement('select');
    sel.id = selId;
    sel.style.cssText = 'padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;font-size:13px;color:#1f2937;min-width:200px';
    var optAll = document.createElement('option');
    optAll.value = '__ALL__';
    optAll.textContent = '🌐 全平台（汇总所有店铺）';
    sel.appendChild(optAll);
    if (shops.length === 0) {
      var optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = '（暂无店铺）';
      sel.appendChild(optNone);
    } else {
      shops.forEach(function (sh) {
        var opt = document.createElement('option');
        opt.value = sh.id;
        opt.textContent = sh.name || sh.id;
        sel.appendChild(opt);
      });
    }
    var saved = (function(){ try { return localStorage.getItem('v193i_shop') || ''; } catch(e){ return ''; } })();
    if (saved && (saved === '__ALL__' || shops.some(function(s){return s.id===saved;}))) {
      sel.value = saved;
    } else if (shops.length > 0) {
      sel.value = '__ALL__';
    }
    sel.onchange = function () {
      try { localStorage.setItem('v193i_shop', sel.value); } catch(e){}
      _refreshBadge();
      _renderActive();
    };
    ctrlRow.appendChild(sel);

    // 状态徽章
    var badge = document.createElement('div');
    badge.id = 'v193i-shop-badge';
    badge.style.cssText = 'font-size:11px;color:#475569;padding:4px 10px;border-radius:14px;background:#fff;border:1px solid #e2e8f0';
    ctrlRow.appendChild(badge);

    // 子 tab 切换（右侧）
    var tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:6px;margin-left:auto';
    var tabs = [
      { id: 'drop', label: '📉 掉量分析', color: '#fa541c' },
      { id: 'review-split', label: '⭐ 好评差评', color: '#1890ff' },
      { id: 'boost', label: '📈 提升分析', color: '#52c41a' }
    ];
    var activeTab = window._v193i_activeTab || 'drop';
    window._v193i_activeTab = activeTab;
    tabs.forEach(function (t) {
      var b = document.createElement('button');
      b.textContent = t.label;
      var active = activeTab === t.id;
      b.style.cssText = 'padding:6px 16px;border:1px solid #d9d9d9;border-radius:18px;background:'
        + (active ? t.color : '#fff') + ';color:'
        + (active ? '#fff' : '#333') + ';font-size:13px;cursor:pointer;font-weight:' + (active ? '600' : '400');
      b.onclick = function () {
        window._v193i_activeTab = t.id;
        _renderActive();
        // 刷新 tab 高亮
        Array.prototype.forEach.call(tabBar.children, function (c) {
          var a = (c._tabId === t.id);
          c.style.background = a ? t.color : '#fff';
          c.style.color = a ? '#fff' : '#333';
          c.style.fontWeight = a ? '600' : '400';
        });
      };
      b._tabId = t.id;
      tabBar.appendChild(b);
    });
    ctrlRow.appendChild(tabBar);
    wrap.appendChild(ctrlRow);

    // 内容容器
    var content = document.createElement('div');
    content.id = 'v193i-content';
    wrap.appendChild(content);

    page.appendChild(wrap);
    return { wrap: wrap, content: content, sel: sel, selected: sel.value, badge: badge };
  }

  function _refreshBadge() {
    var badge = document.getElementById('v193i-shop-badge');
    if (!badge) return;
    var sel = document.getElementById('v193i-shop-sel');
    if (!sel) return;
    var sid = sel.value;
    if (sid === '__ALL__') {
      var shops = _getShops();
      var g=0,y=0,r=0;
      shops.forEach(function(s){ var st=_computeShopHealth(s.id); if(st.health==='green')g++; else if(st.health==='yellow')y++; else r++; });
      badge.textContent = '全平台 ' + shops.length + ' 店：✅ 健康 ' + g + (y>0?(' · ⚠️ 关注 '+y):'') + (r>0?(' · ❌ 异常 '+r):'');
      badge.style.color = r>0 ? '#f5222d' : (y>0 ? '#faad14' : '#52c41a');
    } else if (sid) {
      var st = _computeShopHealth(sid);
      badge.textContent = '差评率 ' + st.badRate.toFixed(1) + '% · 差评 ' + st.negCount + ' · 掉量款 ' + st.dropCount + ' · 升量款 ' + st.boostCount;
      badge.style.color = st.healthColor;
    } else {
      badge.textContent = '请先添加店铺';
      badge.style.color = '#94a3b8';
    }
  }

  function _renderActive() {
    var shell = _buildShell();
    if (!shell) return;
    _refreshBadge();
    var content = shell.content;
    content.innerHTML = '';
    var selected = shell.sel.value;
    var activeTab = window._v193i_activeTab || 'drop';

    if (selected === '__ALL__') {
      if (activeTab === 'drop') _renderCrossDrop(content);
      else if (activeTab === 'review-split') _renderCrossReview(content);
      else if (activeTab === 'boost') _renderCrossBoost(content);
    } else if (selected) {
      if (activeTab === 'drop') _renderSingleDrop(content, selected);
      else if (activeTab === 'review-split') _renderSingleReview(content, selected);
      else if (activeTab === 'boost') _renderSingleBoost(content, selected);
    } else {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      empty.textContent = '请先在左侧添加店铺，再选择店铺进行分析。';
      content.appendChild(empty);
    }
  }

  // ============================================================
  // 1) 掉量分析
  // ============================================================
  function _renderSingleDrop(content, shopId) {
    var data = window.DropAnalysis.computeDropRanking(shopId, 'week');
    if (data.empty) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      e.textContent = '暂无订单数据，无法计算掉量。';
      content.appendChild(e);
      return;
    }
    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#fff7e6;border-radius:6px;border-left:3px solid #fa541c';
    meta.innerHTML = '<b style="color:#d4380d">' + _esc(_getShopName(shopId)) + '</b>　·　'
      + _esc(data.label) + '　本期：' + _esc(data.curLabel) + '　上期：' + _esc(data.prevLabel);
    content.appendChild(meta);

    if (data.rows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#52c41a;padding:20px;text-align:center;background:#f6ffed;border-radius:6px';
      ok.textContent = '✅ 本店本期无掉量款式（各款式单量均持平或上涨）。';
      content.appendChild(ok);
      return;
    }
    content.appendChild(_buildDropTable(data.rows));
  }

  function _renderCrossDrop(content) {
    var shops = _getShops();
    if (shops.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      e.textContent = '暂无店铺数据。';
      content.appendChild(e);
      return;
    }
    var allRows = [];
    var rangeInfo = '';
    shops.forEach(function (s) {
      var d = window.DropAnalysis.computeDropRanking(s.id, 'week');
      if (d.empty) return;
      if (!rangeInfo) rangeInfo = d.label + '　本期：' + d.curLabel + '　上期：' + d.prevLabel;
      d.rows.forEach(function (r) {
        allRows.push(Object.assign({}, r, { shopName: (s.name || s.id), shopId: s.id }));
      });
    });
    allRows.sort(function (a, b) {
      if (b.dropPct !== a.dropPct) return b.dropPct - a.dropPct;
      return (a.prevCount - a.curCount) - (b.prevCount - b.curCount);
    });
    allRows = allRows.slice(0, 80);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#fff7e6;border-radius:6px;border-left:3px solid #fa541c';
    sub.innerHTML = '<b style="color:#d4380d">🌐 全平台汇总</b>（共 ' + shops.length + ' 店）　·　'
      + (rangeInfo ? _esc(rangeInfo) : '');
    content.appendChild(sub);

    if (allRows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#52c41a;padding:20px;text-align:center;background:#f6ffed;border-radius:6px';
      ok.textContent = '✅ 全平台所有店铺本期均无掉量款式。';
      content.appendChild(ok);
      return;
    }
    content.appendChild(_buildDropTable(allRows, true));
  }

  function _buildDropTable(rows, withShop) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    var shopCol = withShop ? '<th style="padding:8px;border-bottom:1px solid #e2e8f0;background:#fff7e6">店铺</th>' : '';
    var shopTd = function (r) { return withShop ? '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#475569">' + _esc(r.shopName || '') + '</td>' : ''; };
    var html = '<thead><tr style="background:#fff7e6;color:#d4380d;text-align:center;font-weight:600">'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">款式(SKU)</th>'
      + shopCol
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">本期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">上期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">变化</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">降幅</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">退货</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">差评</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:left">推测原因</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var deltaColor = r.delta < 0 ? '#cf1322' : '#389e0d';
      var deltaTxt = (r.delta > 0 ? '+' : '') + r.delta;
      var dropColor = r.dropPct < 0 ? '#cf1322' : '#389e0d';
      var isStockout = r.isStockout === true;
      var reasonColor = isStockout ? '#d4380d' : (r.negCount > 0 || r.refundQty > 0 ? '#d4380d' : '#8c8c8c');
      var trStyle = isStockout ? 'text-align:center;background:#fff7e6' : 'text-align:center';
      html += '<tr style="' + trStyle + '">'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">' + _esc(r.sku) + '</td>'
        + shopTd(r)
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9">' + _fmtInt(r.curCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#8c8c8c">' + _fmtInt(r.prevCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + deltaColor + ';font-weight:600">' + deltaTxt + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + dropColor + ';font-weight:600">' + _pct(r.dropPct) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9">' + (r.refundQty > 0 ? ('<span style="color:#d4380d;font-weight:600">' + r.refundQty + '</span>') : '0') + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9">' + (r.negCount > 0 ? ('<span style="color:#cf1322;font-weight:600">' + r.negCount + '</span>') : '0') + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:left;color:' + reasonColor + ';font-weight:' + (isStockout ? '700' : '400') + '">' + _esc(r.reason) + '</td>'
        + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    div.appendChild(table);
    return div;
  }

  // ============================================================
  // 2) 好评/差评区分
  // ============================================================
  function _renderSingleReview(content, shopId) {
    var stats = window.DropAnalysis.getReviewTypeStats(shopId);
    var s = stats.shop;
    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#e6f7ff;border-radius:6px;border-left:3px solid #1890ff';
    meta.innerHTML = '<b style="color:#0958d9">' + _esc(_getShopName(shopId)) + '</b>　·　基于 cb_sku_reviews.type(good/bad/neutral) 拆分';
    content.appendChild(meta);

    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px';
    var cardData = [
      { label: '好评', val: _fmtInt(s.good), color: '#52c41a' },
      { label: '差评', val: _fmtInt(s.bad), color: '#cf1322' },
      { label: '中性', val: _fmtInt(s.neutral), color: '#8c8c8c' },
      { label: '好评率', val: s.positiveRate.toFixed(1) + '%', color: '#389e0d' },
      { label: '差评率', val: s.negativeRate.toFixed(1) + '%', color: '#d4380d' }
    ];
    cardData.forEach(function (c) {
      var d = document.createElement('div');
      d.style.cssText = 'background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:14px;text-align:center';
      d.innerHTML = '<div style="font-size:22px;font-weight:700;color:' + c.color + '">' + c.val + '</div>'
        + '<div style="font-size:11px;color:#888;margin-top:4px">' + c.label + '</div>';
      cards.appendChild(d);
    });
    content.appendChild(cards);

    if (!stats.perSku || stats.perSku.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:20px;text-align:center';
      e.textContent = '暂无款式评价记录。';
      content.appendChild(e);
      return;
    }
    content.appendChild(_buildReviewTable(stats.perSku.slice(0, 80)));
  }

  function _renderCrossReview(content) {
    var shops = _getShops();
    if (shops.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      e.textContent = '暂无店铺数据。';
      content.appendChild(e);
      return;
    }
    var totalGood=0,totalBad=0,totalNeutral=0,totalUnk=0;
    var bySku = {};
    shops.forEach(function (s) {
      var stats = window.DropAnalysis.getReviewTypeStats(s.id);
      var ss = stats.shop;
      totalGood += ss.good; totalBad += ss.bad; totalNeutral += ss.neutral; totalUnk += (ss.unknown||0);
      stats.perSku.forEach(function (r) {
        if (!bySku[r.sku]) bySku[r.sku] = { sku: r.sku, good: 0, bad: 0, neutral: 0, unknown: 0 };
        bySku[r.sku].good += r.good; bySku[r.sku].bad += r.bad;
        bySku[r.sku].neutral += r.neutral; bySku[r.sku].unknown += (r.unknown||0);
      });
    });
    var eff = totalGood + totalBad;
    var posRate = eff > 0 ? (totalGood / eff * 100) : 0;
    var negRate = eff > 0 ? (totalBad / eff * 100) : 0;

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#e6f7ff;border-radius:6px;border-left:3px solid #1890ff';
    sub.innerHTML = '<b style="color:#0958d9">🌐 全平台汇总</b>（共 ' + shops.length + ' 店）　·　款式级合并统计';
    content.appendChild(sub);

    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px';
    var cardData = [
      { label: '好评（全部）', val: _fmtInt(totalGood), color: '#52c41a' },
      { label: '差评（全部）', val: _fmtInt(totalBad), color: '#cf1322' },
      { label: '中性（全部）', val: _fmtInt(totalNeutral), color: '#8c8c8c' },
      { label: '好评率', val: posRate.toFixed(1) + '%', color: '#389e0d' },
      { label: '差评率', val: negRate.toFixed(1) + '%', color: '#d4380d' }
    ];
    cardData.forEach(function (c) {
      var d = document.createElement('div');
      d.style.cssText = 'background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:14px;text-align:center';
      d.innerHTML = '<div style="font-size:22px;font-weight:700;color:' + c.color + '">' + c.val + '</div>'
        + '<div style="font-size:11px;color:#888;margin-top:4px">' + c.label + '</div>';
      cards.appendChild(d);
    });
    content.appendChild(cards);

    var rows = Object.keys(bySku).map(function (k) {
      var s = bySku[k];
      var e2 = s.good + s.bad;
      return {
        sku: k,
        good: s.good, bad: s.bad, neutral: s.neutral, unknown: s.unknown,
        total: s.good + s.bad + s.neutral + s.unknown,
        positiveRate: e2 > 0 ? (s.good / e2 * 100) : 0,
        negativeRate: e2 > 0 ? (s.bad / e2 * 100) : 0
      };
    });
    rows.sort(function (a, b) { return b.bad - a.bad || b.total - a.total; });
    rows = rows.slice(0, 80);

    if (rows.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:20px;text-align:center';
      e.textContent = '全平台暂无款式评价记录。';
      content.appendChild(e);
      return;
    }
    content.appendChild(_buildReviewTable(rows));
  }

  function _buildReviewTable(rows) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    var html = '<thead><tr style="background:#e6f7ff;color:#0958d9;text-align:center;font-weight:600">'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">款式(SKU)</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">好评</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">差评</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">中性</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">好评率</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">差评率</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var rateColor = r.negativeRate >= 30 ? '#cf1322' : (r.negativeRate >= 10 ? '#d4380d' : '#389e0d');
      html += '<tr style="text-align:center">'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">' + _esc(r.sku) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#52c41a;font-weight:600">' + _fmtInt(r.good) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#cf1322;font-weight:600">' + _fmtInt(r.bad) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#8c8c8c">' + _fmtInt(r.neutral) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + rateColor + ';font-weight:600">' + (Number(r.positiveRate)||0).toFixed(1) + '%</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + rateColor + ';font-weight:600">' + (Number(r.negativeRate)||0).toFixed(1) + '%</td>'
        + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    div.appendChild(table);
    return div;
  }

  // ============================================================
  // 3) 提升分析
  // ============================================================
  function _renderSingleBoost(content, shopId) {
    var data = _computeBoostRanking(shopId, 'week');
    if (data.empty) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      e.textContent = '暂无订单数据，无法计算提升。';
      content.appendChild(e);
      return;
    }
    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#f6ffed;border-radius:6px;border-left:3px solid #52c41a';
    meta.innerHTML = '<b style="color:#389e0d">' + _esc(_getShopName(shopId)) + '</b>　·　'
      + _esc(data.label) + '　本期：' + _esc(data.curLabel) + '　上期：' + _esc(data.prevLabel);
    content.appendChild(meta);

    if (data.rows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#fa541c;padding:20px;text-align:center;background:#fff7e6;border-radius:6px';
      ok.textContent = '⚠️ 本店本期无提升款式（各款式单量均持平或下滑）。';
      content.appendChild(ok);
      return;
    }
    content.appendChild(_buildBoostTable(data.rows));
  }

  function _renderCrossBoost(content) {
    var shops = _getShops();
    if (shops.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:30px;text-align:center';
      e.textContent = '暂无店铺数据。';
      content.appendChild(e);
      return;
    }
    var allRows = [];
    var rangeInfo = '';
    shops.forEach(function (s) {
      var d = _computeBoostRanking(s.id, 'week');
      if (d.empty) return;
      if (!rangeInfo) rangeInfo = d.label + '　本期：' + d.curLabel + '　上期：' + d.prevLabel;
      d.rows.forEach(function (r) {
        allRows.push(Object.assign({}, r, { shopName: (s.name || s.id), shopId: s.id }));
      });
    });
    allRows.sort(function (a, b) {
      if (b.upPct !== a.upPct) return b.upPct - a.upPct;
      return (b.curCount - b.prevCount) - (a.curCount - a.prevCount);
    });
    allRows = allRows.slice(0, 80);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#f6ffed;border-radius:6px;border-left:3px solid #52c41a';
    sub.innerHTML = '<b style="color:#389e0d">🌐 全平台汇总</b>（共 ' + shops.length + ' 店）　·　'
      + (rangeInfo ? _esc(rangeInfo) : '');
    content.appendChild(sub);

    if (allRows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#fa541c;padding:20px;text-align:center;background:#fff7e6;border-radius:6px';
      ok.textContent = '⚠️ 全平台本期无提升款式。';
      content.appendChild(ok);
      return;
    }
    content.appendChild(_buildBoostTable(allRows, true));
  }

  function _buildBoostTable(rows, withShop) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    var shopCol = withShop ? '<th style="padding:8px;border-bottom:1px solid #e2e8f0;background:#f6ffed">店铺</th>' : '';
    var shopTd = function (r) { return withShop ? '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#475569">' + _esc(r.shopName || '') + '</td>' : ''; };
    var html = '<thead><tr style="background:#f6ffed;color:#389e0d;text-align:center;font-weight:600">'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">款式(SKU)</th>'
      + shopCol
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">本期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">上期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">增长</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">增幅</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">退货</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">差评</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:left">提升归因</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var deltaTxt = '+' + _fmtInt(r.delta);
      var upColor = r.upPct >= 100 ? '#237804' : '#389e0d';
      var reasonColor = r.negCount > 0 || r.refundQty > 0 ? '#d4380d' : '#237804';
      html += '<tr style="text-align:center">'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">' + _esc(r.sku) + '</td>'
        + shopTd(r)
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#389e0d;font-weight:600">' + _fmtInt(r.curCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#8c8c8c">' + _fmtInt(r.prevCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#389e0d;font-weight:600">' + deltaTxt + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + upColor + ';font-weight:600">' + _pct(r.upPct) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9">' + (r.refundQty > 0 ? ('<span style="color:#d4380d;font-weight:600">' + r.refundQty + '</span>') : '0') + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9">' + (r.negCount > 0 ? ('<span style="color:#cf1322;font-weight:600">' + r.negCount + '</span>') : '0') + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:left;color:' + reasonColor + '">' + _esc(r.reason) + '</td>'
        + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    div.appendChild(table);
    return div;
  }

  // ============================================================
  // 入口：渲染分析中心页
  // ============================================================
  function renderAnalysisCenter() {
    _renderActive();
  }

  window.AnalysisCenterPage = {
    render: renderAnalysisCenter,
    renderAnalysisCenter: renderAnalysisCenter,
    computeBoostRanking: _computeBoostRanking
  };

  // ============================================================
  // Hook：包裹 window.navigate（拦截 analysis-center）
  // ============================================================
  function waitForNav(cb) {
    if (typeof window.navigate === 'function' &&
        document.getElementById('page-analysis-center')) {
      cb();
    } else {
      setTimeout(function () { waitForNav(cb); }, 200);
    }
  }

  waitForNav(function () {
    if (window.__v193iNavHooked) return;
    window.__v193iNavHooked = true;
    var _origNav = window.navigate;
    window.navigate = function (page, arg) {
      var ret;
      try { ret = _origNav.apply(this, arguments); } catch (e) { console.error('[V193i] orig navigate err', e); }
      try {
        if (page === 'analysis-center') {
          setTimeout(renderAnalysisCenter, 50);
        }
      } catch (e) { console.error('[V193i] render err', e); }
      return ret;
    };
    console.log('[V193i] ✅ navigate hook 已挂载');

    window.refreshV193i = function () {
      var active = document.querySelector('.page.active');
      if (active && active.id === 'page-analysis-center') renderAnalysisCenter();
    };
  });
})();