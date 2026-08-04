/* ==========================================================================
 * shop-detail-analysis-v1.js  (V194)
 * 给每个店铺详情页内嵌「📉 掉量分析」「⭐ 好评差评」「📈 提升分析」3 个 tab
 *
 * V194 修复(v193q 兜底切换不彻底):
 *   - v182 hook 不再调 _orig.apply('drop' / 'review-split' / 'boost')！
 *     原因: 原 setCBTab 找不到 cb-tab-drop-shopId(第一次点击时 v182 hook 才创建),
 *     原 setCBTab 不会切换 tab, 导致 v182 hook 渲染的 cb-tab-drop-shopId 显示,
 *     但用户视口仍停留在原 tab (reviews/overview) — 看不到新内容。
 *     V194 修复: v182 hook 完全自己处理 tab 切换 — 隐藏所有 cb-tab-* div +
 *     创建/显示 cb-tab-drop-shopId + scrollIntoView。
 *   - cb-tab-drop-shopId 创建位置: append 到 cb-tab-overview-shopId.parentNode
 *     (与原 tab 容器同级, 不再 append 到 domestic-detail-area 末尾)
 *   - injectShopTabs 增加 MutationObserver 兜底: 监听 domestic-detail-area 子树,
 *     任何新 button 出现立即 inject, 不等 setInterval
 *
 * V193q (前版) 修复:
 *   - 切店时 3 按钮在 nav 内"已存在跳过"会误判 — 改为强制 removeChild 同 id 旧节点 + 强制 append
 *   - 但 setInterval 5s 兜底太慢, 用户切店 2-7s 截图看不到 3 按钮
 *
 * V193l: 3 个分析按钮排在「店铺任务」tab 后面、与主tab 同一行
 *
 * V193j 之前: 独立 sub-tabs 行 (已删)
 *
 * V193i: 顶级「分析中心」页面 (保留)
 *
 * 核心逻辑:
 *   1) injectShopTabs: 把 3 个 button append 到 cb-tab-buttons-shopId 容器末尾
 *   2) setCBTab hook: 完全接管 'drop' / 'review-split' / 'boost' tabName
 *   3) 渲染逻辑: _renderShopDropTab / _renderShopReviewTab / _renderShopBoostTab
 *
 * V184 修复: cb-cache-v1.js 命中时 page.innerHTML 覆盖 V182 tab div 导致内容丢失
 *   修法: scanShops + MutationObserver 兜底重注入
 *
 * 不动 minified 主代码,纯外部补丁。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__shopDetailAnalysisLoaded) return;
  window.__shopDetailAnalysisLoaded = true;
  console.log('[V182 shop-detail-analysis] loaded');

  // ===== 工具函数 =====
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _fmtInt(n) {
    n = parseInt(n) || 0;
    return n.toLocaleString('en-US');
  }
  function _pct(n) {
    if (!isFinite(n)) return '0%';
    return (n >= 0 ? '+' : '') + (Number(n) || 0).toFixed(1) + '%';
  }

  // ===== 数据源访问器(同 DropAnalysis-computeDropRanking 私有实现,这里复制一份供 boost 复用) =====
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
    if (!s) return '未知';
    // 兼容 DropAnalysis 的归一化:去掉末尾 -颜色/-尺寸 后缀(如 SKU-Red / SKU-120)
    // 这里仅做简单截断,保持与 computeDropRanking 一致
    return s;
  }
  function _allOrderDates(orders) {
    var set = {};
    orders.forEach(function (o) { if (o && o.date) set[o.date] = 1; });
    return Object.keys(set).sort();
  }

  // ===== 计算「提升分析」:复用与 computeDropRanking 完全相同的聚合逻辑,但只保留升量(delta>0) =====
  function computeBoostRanking(shopId, mode) {
    mode = (mode === 'week') ? 'week' : 'day';
    var orders = _safeGetAll('CBOrderDB', shopId);
    var refunds = _safeGetAll('CBRefundDB', shopId);
    var skuReviews = _safeGetAll('CBSkuReviewDB', shopId);

    var dates = _allOrderDates(orders);
    if (dates.length === 0) {
      return { mode: mode, label: '', curLabel: '', prevLabel: '', rows: [], empty: true };
    }

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
      // 提升归因
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

    // 只保留「升量」(delta > 0)并按升幅排序(增幅大的在前)
    rows = rows.filter(function (r) { return r.delta > 0; });
    rows.sort(function (a, b) {
      if (b.upPct !== a.upPct) return b.upPct - a.upPct;
      return (b.curCount - b.prevCount) - (a.curCount - a.prevCount);
    });
    rows = rows.slice(0, 20);

    var label = mode === 'day'
      ? '日环比（最新一天 vs 前一天）'
      : '周环比（近 7 天 vs 前 7 天）';

    return {
      mode: mode,
      label: label,
      curLabel: curFrom === curTo ? curTo : (curFrom + ' ~ ' + curTo),
      prevLabel: prevFrom === prevTo ? prevTo : (prevFrom + ' ~ ' + prevTo),
      range: { curFrom: curFrom, curTo: curTo, prevFrom: prevFrom, prevTo: prevTo },
      rows: rows,
      empty: false
    };
  }

  // ===== 渲染：店铺内嵌 掉量分析 =====
  function _renderShopDropTab(div, shopId) {
    div.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssCss = '';
    head.style.cssText = 'font-size:14px;font-weight:600;color:#0c4a6e;margin-bottom:10px;display:flex;align-items:center;gap:8px';
    head.innerHTML = '📉 掉量分析 <span style="font-size:12px;color:#64748b;font-weight:400">(本周 vs 上周)</span>';
    div.appendChild(head);

    if (!window.DropAnalysis || !window.DropAnalysis.computeDropRanking) {
      div.innerHTML += '<div style="color:#cf1322;padding:20px">DropAnalysis 模块未加载，请刷新页面。</div>';
      return;
    }

    var data = window.DropAnalysis.computeDropRanking(shopId, 'week');
    if (data.empty) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:20px;text-align:center';
      e.textContent = '暂无订单数据，无法计算掉量。';
      div.appendChild(e);
      return;
    }

    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#fff7e6;border-radius:6px;border-left:3px solid #fa541c';
    meta.textContent = '📅 数据窗口:' + data.label + '  本期：' + data.curLabel + '  上期：' + data.prevLabel;
    div.appendChild(meta);

    if (data.rows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#52c41a;padding:20px;text-align:center;background:#f6ffed;border-radius:6px';
      ok.textContent = '✅ 本店本期无掉量款式（各款式单量均持平或上涨）。';
      div.appendChild(ok);
      return;
    }

    div.appendChild(_buildDropTable(data.rows));
  }

  function _buildDropTable(rows) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    var html = '<thead><tr style="background:#fff7e6;color:#d4380d;text-align:center;font-weight:600">'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">款式(SKU)</th>'
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

  // ===== 渲染：店铺内嵌 提升分析(V189 新页) =====
  function _renderShopBoostTab(div, shopId) {
    div.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssText = 'font-size:14px;font-weight:600;color:#0c4a6e;margin-bottom:10px;display:flex;align-items:center;gap:8px';
    head.innerHTML = '📈 提升分析 <span style="font-size:12px;color:#64748b;font-weight:400">(本周 vs 上周,有升就有掉)</span>';
    div.appendChild(head);

    var data = computeBoostRanking(shopId, 'week');
    if (data.empty) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:20px;text-align:center';
      e.textContent = '暂无订单数据，无法计算提升。';
      div.appendChild(e);
      return;
    }

    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:10px;padding:8px 12px;background:#f6ffed;border-radius:6px;border-left:3px solid #52c41a';
    meta.textContent = '📅 数据窗口:' + data.label + '  本期：' + data.curLabel + '  上期：' + data.prevLabel;
    div.appendChild(meta);

    if (data.rows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:13px;color:#fa541c;padding:20px;text-align:center;background:#fff7e6;border-radius:6px';
      ok.textContent = '⚠️ 本店本期无提升款式（各款式单量均持平或下滑）。';
      div.appendChild(ok);
      return;
    }

    div.appendChild(_buildBoostTable(data.rows));
  }

  function _buildBoostTable(rows) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    var html = '<thead><tr style="background:#f6ffed;color:#389e0d;text-align:center;font-weight:600">'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">款式(SKU)</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">本期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">上期单量</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">增长</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">增幅</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">退货</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">差评</th>'
      + '<th style="padding:8px;border-bottom:1px solid #e2e8f0">提升归因</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var deltaColor = '#389e0d';
      var deltaTxt = '+' + _fmtInt(r.delta);
      var upColor = r.upPct >= 100 ? '#237804' : '#389e0d';
      var reasonColor = r.negCount > 0 || r.refundQty > 0 ? '#d4380d' : '#237804';
      html += '<tr style="text-align:center">'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">' + _esc(r.sku) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + deltaColor + ';font-weight:600">' + _fmtInt(r.curCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#8c8c8c">' + _fmtInt(r.prevCount) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + deltaColor + ';font-weight:600">' + deltaTxt + '</td>'
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

  // ===== 渲染：店铺内嵌 好评/差评 =====
  function _renderShopReviewTab(div, shopId, filter) {
    filter = filter || 'all';
    div.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssText = 'font-size:14px;font-weight:600;color:#0c4a6e;margin-bottom:10px;display:flex;align-items:center;gap:8px';
    head.innerHTML = '⭐ 好评/差评区分 <span style="font-size:12px;color:#64748b;font-weight:400">(' + (window._v182_reviewFilter || filter) + ')</span>';
    div.appendChild(head);

    if (!window.DropAnalysis || !window.DropAnalysis.getReviewTypeStats) {
      div.innerHTML += '<div style="color:#cf1322;padding:20px">DropAnalysis 模块未加载。</div>';
      return;
    }

    var stats = window.DropAnalysis.getReviewTypeStats(shopId);
    var s = stats.shop;

    // 汇总卡
    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px';
    var cardData = [
      { label: '好评', val: _fmtInt(s.good), color: '#52c41a' },
      { label: '差评', val: _fmtInt(s.bad), color: '#cf1322' },
      { label: '中性', val: _fmtInt(s.neutral), color: '#8c8c8c' },
      { label: '好评率', val: s.positiveRate.toFixed(1) + '%', color: '#389e0d' },
      { label: '差评率', val: s.negativeRate.toFixed(1) + '%', color: '#d4380d' }
    ];
    cardData.forEach(function (c) {
      var d = document.createElement('div');
      d.style.cssText = 'background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:12px;text-align:center';
      d.innerHTML = '<div style="font-size:20px;font-weight:700;color:' + c.color + '">' + c.val + '</div>'
        + '<div style="font-size:11px;color:#888;margin-top:4px">' + c.label + '</div>';
      cards.appendChild(d);
    });
    div.appendChild(cards);

    // 筛选条
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap';
    var _self = div;
    [['all', '全部'], ['good', '好评'], ['bad', '差评'], ['neutral', '中性']].forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p[1];
      var active = filter === p[0];
      b.style.cssText = 'padding:6px 14px;border:1px solid #d9d9d9;border-radius:18px;background:'
        + (active ? '#1890ff' : '#fff') + ';color:' + (active ? '#fff' : '#333') + ';font-size:13px;cursor:pointer;font-weight:' + (active ? '600' : '400');
      b.onclick = function () {
        window._v182_reviewFilter = p[0];
        _renderShopReviewTab(_self, shopId, p[0]);
      };
      filterBar.appendChild(b);
    });
    div.appendChild(filterBar);

    // 款式级表格
    var rows = stats.perSku.filter(function (r) {
      if (filter === 'all') return true;
      if (filter === 'good') return r.good > 0;
      if (filter === 'bad') return r.bad > 0;
      if (filter === 'neutral') return r.neutral > 0;
      return true;
    }).slice(0, 50);

    if (rows.length === 0) {
      var e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:#94a3b8;padding:20px;text-align:center';
      e.textContent = '暂无款式评价记录。';
      div.appendChild(e);
      return;
    }

    div.appendChild(_buildReviewTable(rows));
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
      + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var rateColor = r.negativeRate >= 30 ? '#cf1322' : (r.negativeRate >= 10 ? '#d4380d' : '#389e0d');
      html += '<tr style="text-align:center">'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1f2937">' + _esc(r.sku) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#52c41a;font-weight:600">' + _fmtInt(r.good) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#cf1322;font-weight:600">' + _fmtInt(r.bad) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#8c8c8c">' + _fmtInt(r.neutral) + '</td>'
        + '<td style="padding:8px;border-bottom:1px solid #f1f5f9;color:' + rateColor + ';font-weight:600">' + (Number(r.positiveRate) || 0).toFixed(1) + '%</td>'
        + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
    div.appendChild(table);
    return div;
  }

  // ===== V206: 统一更新导航按钮高亮（7 内置 + 3 分析） =====
  // 原 setCBTab（app-v3-v6.js:46-58）只对 7 个内置 TAB_NAMES 按钮设 active 视觉态
  //   (background: rgba(124,58,237,0.18); color: #a78bfa)
  // 我注入的 3 个分析按钮（drop/review-split/boost）不在名单里 → 点击后没"亮起来"。
  // V206: 在 hook 入口统一刷一遍 — 7 内置按原规则、3 分析按同色规则 active/inactive。
  function styleNavButtons(shopId, activeTabName) {
    try {
      var BUILT_IN = ["overview","optimize","orders","refunds","daily","reviews","tasks"];
      BUILT_IN.forEach(function (name) {
        var btns = document.querySelectorAll('button[onclick="setCBTab(\'' + shopId + '\',\'' + name + '\')"]');
        var active = (name === activeTabName);
        btns.forEach(function (btn) {
          btn.style.background = active ? "rgba(124,58,237,0.18)" : "transparent";
          btn.style.color = active ? "#a78bfa" : "#64748b";
        });
      });
      var ANALYSIS = ['drop','review-split','boost'];
      ANALYSIS.forEach(function (name) {
        var btn = document.getElementById('cb-tabbtn-' + name + '-' + shopId);
        if (!btn) return;
        var active = (name === activeTabName);
        btn.style.background = active ? "rgba(124,58,237,0.18)" : "transparent";
        btn.style.color = active ? "#a78bfa" : "#64748b";
      });
    } catch (e) { /* 防御性 */ }
  }

  // ===== monkey-patch setCBTab =====
  // V194 关键改动: v182 hook 完全接管 'drop' / 'review-split' / 'boost',
  //   不再调 _orig.apply — 因为原 setCBTab 不知道这 3 个 tabName,
  //   会保持原 tab 状态不切换, 用户视口仍停留在 reviews/overview 看不到新内容。
  //   v194 自己隐藏所有 cb-tab-* + 创建/显示 cb-tab-drop-shopId + scrollIntoView。
  // V206: 入口处统一刷导航按钮高亮（7 内置 + 3 分析），让 3 分析按钮也"亮起来"。
  function installSetCBTabHook() {
    if (typeof window.setCBTab !== 'function') {
      setTimeout(installSetCBTabHook, 200);
      return;
    }
    if (window.__setCBTabPatchedByV182) return;
    window.__setCBTabPatchedByV182 = true;
    var _orig = window.setCBTab;
    window.setCBTab = function (shopId, tabName) {
      // V206: 入口处先刷一遍 nav 按钮高亮（无论切到内置还是 3 分析都按 tabName 重算）
      styleNavButtons(shopId, tabName);

      // V194: 3 按钮已由 renderCrossBorderDetail hook 在 HTML 源头注入, 无需每次 click 再 inject

      // V194: 完全接管 drop/review-split/boost
      if (tabName === 'drop' || tabName === 'review-split' || tabName === 'boost') {
        _v194_handleAnalysisTab(shopId, tabName);
        return;  // 不调 _orig
      }

      // 其他 tab (overview/optimize/orders/refunds/daily/reviews/tasks) 走原 setCBTab
      // V202: 切到内置 tab 前先隐藏 3 个分析容器 + tasks 容器 (否则会与原 tab 内容叠加显示)
      //   V208: 补上 'tasks' — 从店铺任务切回内置 tab 时, 店铺任务页也会残留叠加
      ['drop','review-split','boost','tasks'].forEach(function (n) {
        var el = document.getElementById('cb-tab-' + n + '-' + shopId);
        if (el) el.style.display = 'none';
      });
      _orig.apply(this, arguments);
    };
    console.log('[V206] setCBTab hooked (3 分析按钮 active 高亮 + 完全接管 + 切回内置时隐藏分析容器)');
  }

  // V194: v182 hook 自己处理 drop/review-split/boost tab 切换
  function _v194_handleAnalysisTab(shopId, tabName) {
    try {
      // 1) 隐藏所有原 tab + 新 tab 容器
      //    V202: review-trend-enhanced.js:416 已去掉 display:block!important,
      //    普通 el.style.display='none' 已能压过布局 CSS (width/padding 等)
      ['overview','optimize','orders','refunds','daily','reviews','tasks','drop','review-split','boost'].forEach(function (n) {
        var el = document.getElementById('cb-tab-' + n + '-' + shopId);
        if (el) el.style.display = 'none';
      });

      // 2) 创建/找到 cb-tab-*-shopId 容器, append 到 cb-tab-overview-shopId.parentNode (与原 tab 容器同级)
      var contentId = 'cb-tab-' + tabName + '-' + shopId;
      var content = document.getElementById(contentId);
      var overview = document.getElementById('cb-tab-overview-' + shopId);
      var parent = null;
      if (overview && overview.parentNode) {
        parent = overview.parentNode;
      } else {
        parent = document.getElementById('domestic-detail-area') ||
                 document.getElementById('page-shop-detail') ||
                 document.body;
      }
      if (!content) {
        content = document.createElement('div');
        content.id = contentId;
        content.style.cssText = 'display:block;width:100%';
        parent.appendChild(content);
      } else {
        // 已存在 — 移到 parent 末尾 (避免 cb-cache 写回 innerHTML 时位置异常)
        if (content.parentNode !== parent) {
          try { content.parentNode.removeChild(content); } catch (e) {}
          parent.appendChild(content);
        }
        content.style.display = 'block';
      }

      // 3) 渲染
      content.innerHTML = '';
      if (tabName === 'drop') {
        _renderShopDropTab(content, shopId);
      } else if (tabName === 'review-split') {
        _renderShopReviewTab(content, shopId, window._v182_reviewFilter || 'all');
      } else if (tabName === 'boost') {
        _renderShopBoostTab(content, shopId);
      }

      // 4) 滚动到内容顶部 (让用户看到)
      try { content.scrollIntoView({behavior:'instant', block:'start'}); } catch(e) {}
      console.log('[V194] handleAnalysisTab:', tabName, 'shop:', shopId);
    } catch (e) {
      console.error('[V194] _v194_handleAnalysisTab err:', e);
    }
  }

  // ===== 注入新 tab buttons 到店铺详情页 tab nav =====
  // V193l: 3 个分析按钮(掉量/好评差评/提升)作为「店铺任务」tab 之后的兄弟节点,
  //   与主tab 同行(第 8/9/10 个 tab),样式完全继承主tab。
  //   移除 V193j 时代的 subRow 独立深色行(用户反馈:应该排在主tab 后,不是下面开一行)
  //
  //   V193q: cb-cache 命中时 setInterval 5s 兜底太慢, 用户切店 2-7s 截图看不到 3 按钮
  //   V194: 同步立即 inject + MutationObserver 监听 domestic-detail-area 变化,
  //         任何新 setCBTab button 出现立即 inject, 不等 setInterval
  function injectShopTabs(shopId) {
    try {
      // 找一个现有 tab button（onclick 包含 setCBTab(shopId, ...)）
      var refBtn = document.querySelector('button[onclick*="setCBTab(\'' + shopId + '\',"]');
      if (!refBtn) return false;
      var nav = refBtn.parentNode;
      if (!nav) return false;

      // V194: 幂等 — 3 按钮已存在且父节点正确, 直接跳过 (避免重复 append 导致点击闪烁)
      var _ids = ['cb-tabbtn-drop-' + shopId, 'cb-tabbtn-rev-' + shopId, 'cb-tabbtn-boost-' + shopId];
      var _allOk = _ids.every(function (id) {
        var _el = document.getElementById(id);
        return _el && _el.parentNode === nav;
      });
      if (_allOk) return true;

      // 删除 V193j 时代可能残留的独立深色 subRow
      var oldRow = document.getElementById('cb-subtabs-row-' + shopId);
      if (oldRow && oldRow.parentNode) {
        try { oldRow.parentNode.removeChild(oldRow); } catch (e) {}
      }

      var navStyle = refBtn.getAttribute('style') || '';
      function makeBtn(id, label, icon, tabName, color) {
        var b = document.createElement('button');
        b.id = id;
        b.style.cssText = navStyle;
        b.setAttribute('onclick', "setCBTab('" + shopId + "','" + tabName + "')");
        b.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">' + icon + '</svg>' + label;
        return b;
      }
      var dropBtn = makeBtn('cb-tabbtn-drop-' + shopId, '📉 掉量分析',
        '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
        'drop', '#0958d9');
      var revBtn = makeBtn('cb-tabbtn-rev-' + shopId, '⭐ 好评差评',
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
        'review-split', '#52c41a');
      var boostBtn = makeBtn('cb-tabbtn-boost-' + shopId, '📈 提升分析',
        '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
        'boost', '#52c41a');

      // V193q: 先清理同 id 旧节点 (cb-cache 写回 innerHTML 可能残留旧 button, 否则 id 重复)
      ['drop','rev','boost'].forEach(function (t) {
        var old = document.getElementById('cb-tabbtn-' + t + '-' + shopId);
        if (old && old.parentNode) {
          try { old.parentNode.removeChild(old); } catch (e) {}
        }
      });

      // V194: 优先插在「店铺任务」按钮之后, 找不到则 append 到 nav 末尾
      //   → 确保顺序: 主tab … 店铺任务, 掉量, 好评差评, 提升
      var taskBtn = nav.querySelector('[data-task-tab="' + shopId + '"]');
      var before = (taskBtn && taskBtn.nextSibling) ? taskBtn.nextSibling : null;
      if (before) {
        nav.insertBefore(dropBtn, before);
        nav.insertBefore(revBtn, before);
        nav.insertBefore(boostBtn, before);
      } else {
        nav.appendChild(dropBtn);
        nav.appendChild(revBtn);
        nav.appendChild(boostBtn);
      }

      return true;
    } catch (e) {
      console.error('[V194] injectShopTabs 异常:', e);
      return false;
    }
  }

  // ===== V194 终极修复: 稳定插入 3 个分析按钮 =====
  // 架构事实(经 CDP 反复验证):
  //   1) renderCrossBorderDetail 只生成 6 个 setCBTab 按钮(总览/优化/订单/退款/日报/差评率), nav 无 id、无「店铺任务」
  //   2) shop-tasks-v1.js 的 injectTaskButton 在 render 之后给 nav 赋 id="cb-tab-buttons-shopId",
  //      并在 reviews 之后追加「📋 店铺任务」按钮(data-task-tab=shopId)
  //   → 最终 nav 顺序: 总览 … 差评率, 店铺任务
  //   → 用户要求 3 个分析按钮排在「店铺任务」之后 ⇒ 必须在 shop-tasks 追加店铺任务之后再插入
  //
  // 稳定锚点: 包住 window._v191_injectTaskTab(shop-tasks 每次 render / cb-cache 命中都会调它, 内部已加完店铺任务)
  //   → 原逻辑返回后, 紧接调用 injectShopTabs(shopId): 找 refBtn→nav→去重→appendChild 到 nav 末尾(= 店铺任务之后)
  //   → 同时加 body 级 MutationObserver 兜底(店铺任务按钮一出现就补注) + setCBTab hook 兜底
  function installTaskTabHook() {
    if (typeof window._v191_injectTaskTab !== 'function') {
      setTimeout(installTaskTabHook, 200);
      return;
    }
    if (window.__v194_taskHooked) return;
    window.__v194_taskHooked = true;
    var _orig = window._v191_injectTaskTab;
    window._v191_injectTaskTab = function (shopId) {
      _orig.apply(this, arguments);
      try { injectShopTabs(shopId); } catch (e) { console.warn('[V194] taskTabHook inject err', e); }
    };
    console.log('[V194] _v191_injectTaskTab hooked (店铺任务后插入 3 分析按钮)');
  }

  // V194: body 级 MutationObserver 兜底 —— 店铺任务按钮([data-task-tab])一旦出现在 DOM,
  //   立即补注 3 个分析按钮。比观察 page-shop-detail 更稳(后者在整体替换 nav 时 observer 会失效)。
  function installBodyObserver() {
    if (window.__v194_bodyObs) return;
    window.__v194_bodyObs = true;
    try {
      var _mo = new MutationObserver(function () {
        // 找所有店铺任务按钮, 对每个补注
        var tasks = document.querySelectorAll('[data-task-tab]');
        for (var i = 0; i < tasks.length; i++) {
          var sid = tasks[i].getAttribute('data-task-tab');
          if (sid && !document.getElementById('cb-tabbtn-drop-' + sid)) {
            try { injectShopTabs(sid); } catch (e) {}
          }
        }
      });
      _mo.observe(document.body, { childList: true, subtree: true });
      console.log('[V194] body MutationObserver installed (店铺任务出现即补注)');
    } catch (e) { console.warn('[V194] body observer err', e); }
  }

  // ===== 监听新店铺注入 =====
  // V188 修复: 去掉 seenShops 缓存(只检查 DOM 里是否真的存在)
  // 否则 cb-cache 命中后 HTML 被替换,V182 tabs 丢失,scanShops 跳过重注入
  function scanShops() {
    var btns = document.querySelectorAll('button[onclick^="setCBTab("]');
    var found = false;
    var seenThisScan = {};
    btns.forEach(function (b) {
      var m = b.getAttribute('onclick').match(/setCBTab\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'\"]+)['\"]\\s*\)/);
      if (m) {
        var sid = m[1];
        if (seenThisScan[sid]) return;
        seenThisScan[sid] = true;
        try {
          injectShopTabs(sid);  // 内部已经会检查 DOM 里是否已存在
          found = true;
        } catch(e){ console.warn('[V182] inject err', e); }
      }
    });
    if (found) {
      setTimeout(_v184_restoreV182TabContent, 60);
      setTimeout(_v184_restoreV182TabContent, 300);
    }
  }

  // ===== V193: 暴露 injectShopTabs + scanShops 到 window 供调试 =====
  window.__v193_injectShopTabs = injectShopTabs;
  window.__v193_scanShops = scanShops;
  console.log('[V193] __v193_injectShopTabs / __v193_scanShops 已暴露到 window');

  // ===== 启动（V200：3 分析 tab 功能恢复，但严格只显示本 tab 内容）=====
  // V200: 用户澄清 — "移除"指移除不属于本页面的内容（如点掉量分析时差评率页面残留），
  //       不是移除 掉量分析/好评差评/提升分析 三个功能本身。
  //       V200 恢复 3 个分析 tab，但确保 _v194_handleAnalysisTab 严格只显示该 tab 内容：
  //       1) 隐藏全部 10 个 tab 容器（7 个内置 + 3 个分析）→ 杜绝任何叠加残留
  //       2) 创建/复用本 tab 容器 → 渲染 → 滚动到顶部
  // V200: cb-cache 兼容桩保留（置 no-op 即可，调用方已 if(guard) 守卫）
  window.scanShopsForV182 = scanShops;
  window._v184_restoreV182TabContent = _v184_restoreV182TabContent;
  console.log('[V200] shop-detail-analysis: 3 分析 tab 恢复 + 防叠加修复');

  // V200: 恢复所有 hook（用户要求保留功能）
  installSetCBTabHook();
  installTaskTabHook();
  installBodyObserver();
  // V200: 兜底扫描（injectShopTabs 内部已幂等,只会补注缺失按钮）
  setTimeout(scanShops, 500);
  setTimeout(scanShops, 1500);
  setTimeout(scanShops, 3000);
  setInterval(scanShops, 5000);

  // ===== V184: 修复 cb-cache 命中后 V182 tab 内容丢失 =====
  // cb-cache-v1.js 命中时会直接 page.innerHTML = cachedHTML，不触发 setCBTab
  // → cb-cache 缓存的是 renderCrossBorderDetail 的原始 HTML，不含 V182 tabs
  // → 切店回来页面里 V182 tabs 不存在 → 用户感觉"切店回来数据不在了"
  // 修法：MutationObserver 监听 #page-shop-detail 的子节点变化
  //       → 先调 scanShops() 注入 V182 tab buttons（如果当前不在）
  //       → 再扫描 V182 content div,如果当前显示但 innerHTML 空,主动重渲染
  function _v184_restoreV182TabContent() {
    try {
      // 1) 先确保 V182 tabs 已注入（cb-cache 命中写回的 HTML 不含 V182 tabs）
      scanShops();
      // 2) 等一帧让 scanShops 注入完成,再 restore content
      setTimeout(function () {
        var drops = document.querySelectorAll('[id^="cb-tab-drop-"]');
        for (var i = 0; i < drops.length; i++) {
          var d = drops[i];
          if (d.style.display !== 'none' && d.offsetParent !== null && (!d.innerHTML || d.innerHTML.trim() === '')) {
            var m = d.id.match(/^cb-tab-drop-(.+)$/);
            if (m) {
              console.log('[V184] restore drop tab content for shop', m[1]);
              _renderShopDropTab(d, m[1]);
            }
          }
        }
        var revs = document.querySelectorAll('[id^="cb-tab-review-split-"]');
        for (var j = 0; j < revs.length; j++) {
          var r = revs[j];
          if (r.style.display !== 'none' && r.offsetParent !== null && (!r.innerHTML || r.innerHTML.trim() === '')) {
            var m2 = r.id.match(/^cb-tab-review-split-(.+)$/);
            if (m2) {
              console.log('[V184] restore review-split tab content for shop', m2[1]);
              _renderShopReviewTab(r, m2[1], window._v182_reviewFilter || 'all');
            }
          }
        }
        // V189: 提升分析 tab 同样需要 restore
        var boosts = document.querySelectorAll('[id^="cb-tab-boost-"]');
        for (var k = 0; k < boosts.length; k++) {
          var b = boosts[k];
          if (b.style.display !== 'none' && b.offsetParent !== null && (!b.innerHTML || b.innerHTML.trim() === '')) {
            var m3 = b.id.match(/^cb-tab-boost-(.+)$/);
            if (m3) {
              console.log('[V189] restore boost tab content for shop', m3[1]);
              _renderShopBoostTab(b, m3[1]);
            }
          }
        }
      }, 80);
    } catch (e) {
      console.warn('[V184] restore err', e);
    }
  }

  function _v184_installPageObserver() {
    var target = document.getElementById('page-shop-detail');
    if (!target) {
      setTimeout(_v184_installPageObserver, 500);
      return;
    }
    if (window.__v184_pageObsInstalled) return;
    window.__v184_pageObsInstalled = true;
    var obs = new MutationObserver(function (muts) {
      // #page-shop-detail 的直接子节点变化 → cb-cache 命中或新店铺渲染
      // 延迟 50ms 让 cb-cache 写完,再 restore
      setTimeout(_v184_restoreV182TabContent, 50);
      setTimeout(_v184_restoreV182TabContent, 400);
    });
    obs.observe(target, { childList: true });
    console.log('[V184] page-shop-detail MutationObserver installed');

    // V190: 兜底频率降低到 5 秒,避免对切店造成额外 DOM 抖动
    // V193m: 改回 1 秒兜底,确保 cb-cache 命中写回 innerHTML 后能立即补救
    setInterval(_v184_restoreV182TabContent, 1000);
    // V193m: 额外 setInterval 兜底扫描所有页面内的店铺,补救任何遗漏
    setInterval(function () {
      try { scanShops(); } catch (e) {}
    }, 1500);
  }

  // DOMContentLoaded 后启动 observer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _v184_installPageObserver);
  } else {
    setTimeout(_v184_installPageObserver, 800);
  }
})();
