/**
 * 掉量分析 + 好评/差评区分 模块 (V159 → V177 → V179)
 * --------------------------------------------------
 * V177: 掉量原因推断增加「断货」识别 — 本期销量=0 + 上期销量≥5 单 + 无差评/退货 → 「⚠️ 疑似断货」
 *      场景:用户案例"S 码每天 5-6 单,今天突然一单没有" → 高度疑似断货,优先级最高
 * V179: 断货阈值改为「自适应」— 不再用固定≥5单,改用「前7天里有≥3天持续出单(prevActiveDays≥3)」
 *      这样平时只卖 2-3 单/天 的款今天 0 单也能命中,偶发脉冲款(前7天仅1-2天有单)不误报
 * 功能：
 *  1) 掉量分析：按款式(SKU)做"本期 vs 上期"单量对比，找出掉量 TOP，
 *     并关联同期的退货退款、差评，推断掉量原因。
 *     - 日环比：最新一天 vs 前一天
 *     - 周环比：近 7 天 vs 前 7 天
 *  2) 好评/差评区分：基于 cb_sku_reviews.type(good/bad/neutral) 拆分统计，
 *     店铺级给"好评率"，款式级给每 SKU 的好评/差评/中性分布。
 *
 * 数据来源（均为全局对象，已在 app-v3-v6.js 定义）：
 *   CBOrderDB.getAll(shopId)     -> {id,sku,date,sale_amount,...}
 *   CBRefundDB.getAll(shopId)    -> {id,sku,date,qty,refund_amount,...}
 *   CBSkuReviewDB.getAll(shopId) -> {id,sku,date,type,rating,...}
 *   CrossBorderDailyDB.getAll(shopId) -> 每日大盘(可选)
 */
(function () {
  'use strict';

  // ============================================================
  // 工具
  // ============================================================
  function _safeGetAll(DBName, shopId) {
    try {
      if (typeof window[DBName] !== 'undefined' && window[DBName].getAll) {
        return window[DBName].getAll(shopId) || [];
      }
    } catch (e) {}
    return [];
  }

  // SKU 归一化：截掉颜色/尺码/特殊字符，取基础货号
  // 例："*****QQ1011-XL" -> "QQ1011"；"QZ8118-DARK BLUE-XS/" -> "QZ8118"
  function normalizeSku(raw) {
    if (!raw) return '未知';
    var s = String(raw).trim().toUpperCase();
    s = s.replace(/^[^A-Z0-9]+/, '');      // 去前缀垃圾（如 *****）
    s = s.replace(/[^A-Z0-9]+$/, '');      // 去后缀垃圾（如 /）
    if (!s) return '未知';
    var parts = s.split(/[-_\/]/);
    for (var i = 0; i < parts.length; i++) {
      if (/\d/.test(parts[i])) return parts[i]; // 取含数字的首段作为货号
    }
    return parts[0];
  }

  function _fmtInt(n) {
    n = parseInt(n) || 0;
    return n.toLocaleString('en-US');
  }
  function _fmtMoney(n) {
    n = parseFloat(n) || 0;
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function _pct(n) {
    if (!isFinite(n)) return '0%';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  // 取订单数据里出现过的所有日期，返回排序后的唯一数组
  function _allOrderDates(orders) {
    var set = {};
    orders.forEach(function (o) { if (o.date) set[o.date] = 1; });
    return Object.keys(set).sort();
  }

  // ============================================================
  // 1) 掉量分析
  // ============================================================
  // mode: 'day' | 'week'
  // 返回 { mode, label, curLabel, prevLabel, range:{curFrom,curTo,prevFrom,prevTo}, rows:[...] }
  function computeDropRanking(shopId, mode) {
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
      curTo = dates[dates.length - 1];          // 最新一天（≈今天）
      curFrom = curTo;
      // 前一天 = 比 curTo 小的最大日期
      prevTo = dates.length >= 2 ? dates[dates.length - 2] : curTo;
      prevFrom = prevTo;
    } else {
      curTo = dates[dates.length - 1];
      // 近 7 天
      var idx7 = Math.max(0, dates.length - 7);
      curFrom = dates[idx7];
      // 前 7 天
      prevTo = dates[Math.max(0, idx7 - 1)];
      var idxPrev = Math.max(0, idx7 - 7);
      prevFrom = dates[idxPrev];
    }

    function inRange(d, from, to) { return d && d >= from && d <= to; }

    // 归一化后的本期/上期单量 + 金额
    var curMap = {}, prevMap = {};
    // V179: 上期按天聚合，用于「自适应断货」判断（前 7 天里有几天持续出单）
    var prevByDay = {};
    orders.forEach(function (o) {
      var sku = normalizeSku(o.sku);
      var amt = parseFloat(o.sale_amount) || 0;
      if (inRange(o.date, curFrom, curTo)) {
        if (!curMap[sku]) curMap[sku] = { count: 0, amount: 0 };
        curMap[sku].count++; curMap[sku].amount += amt;
      } else if (inRange(o.date, prevFrom, prevTo)) {
        if (!prevMap[sku]) prevMap[sku] = { count: 0, amount: 0 };
        prevMap[sku].count++; prevMap[sku].amount += amt;
        // 记录该 SKU 在前 7 天里「哪几天有出单」
        if (!prevByDay[sku]) prevByDay[sku] = {};
        prevByDay[sku][o.date] = (prevByDay[sku][o.date] || 0) + 1;
      }
    });

    // 本期退货（按归一化 SKU）
    var refundMap = {};
    refunds.forEach(function (r) {
      if (inRange(r.date, curFrom, curTo)) {
        var sku = normalizeSku(r.sku);
        if (!refundMap[sku]) refundMap[sku] = { qty: 0, amount: 0 };
        refundMap[sku].qty += parseInt(r.qty) || 1;
        refundMap[sku].amount += parseFloat(r.refund_amount || r.amount) || 0;
      }
    });

    // 本期差评（type==='bad'）
    var negMap = {};
    skuReviews.forEach(function (r) {
      if (inRange(r.date, curFrom, curTo) && (r.type === 'bad')) {
        var sku = normalizeSku(r.sku);
        negMap[sku] = (negMap[sku] || 0) + 1;
      }
    });

    // 汇总所有出现过的 SKU（本期或上期）
    var allSkus = {};
    Object.keys(curMap).forEach(function (k) { allSkus[k] = 1; });
    Object.keys(prevMap).forEach(function (k) { allSkus[k] = 1; });

    var rows = [];
    Object.keys(allSkus).forEach(function (sku) {
      var c = curMap[sku] || { count: 0, amount: 0 };
      var p = prevMap[sku] || { count: 0, amount: 0 };
      var delta = c.count - p.count;
      var dropPct = p.count > 0 ? (delta / p.count * 100) : (c.count > 0 ? 100 : 0);
      var refund = refundMap[sku] || { qty: 0, amount: 0 };
      var neg = negMap[sku] || 0;
      // 掉量原因推断 (V177 增加「断货」识别，V179 改为自适应阈值)
      var reasons = [];
      var isStockout = false;
      // V179 自适应断货:不再用固定 "上期≥5单" 阈值,而是看该 SKU 自身历史出单习惯
      //   - 本期销量 = 0(突然一单没有)
      //   - 前 7 天里有 ≥3 天持续出单(prevActiveDays≥3,哪怕每天只 1-2 单也算活跃款)
      //   - 无差评、无退货
      // 这样 "平时每天 2-3 单,今天 0 单" 也能命中,而偶发脉冲款(前7天只 1-2 天有单)不会误报
      var prevActiveDays = prevByDay[sku] ? Object.keys(prevByDay[sku]).length : 0;
      if (c.count === 0 && prevActiveDays >= 3 && neg === 0 && refund.qty === 0) {
        isStockout = true;
        reasons.push('⚠️ 疑似断货(近7天' + prevActiveDays + '天有单,今日归零)');
      }
      if (neg > 0) reasons.push('差评 ' + neg + ' 条');
      if (refund.qty > 0) reasons.push('退货 ' + refund.qty + ' 单');
      var reason = reasons.length ? reasons.join(' · ') : '自然波动/流量下降';
      rows.push({
        sku: sku,
        curCount: c.count, curAmount: c.amount,
        prevCount: p.count, prevAmount: p.amount,
        delta: delta, dropPct: dropPct,
        refundQty: refund.qty, refundAmount: refund.amount,
        negCount: neg, reason: reason,
        isStockout: isStockout   // V177: UI 可用此字段做高亮
      });
    });

    // 只保留"掉量"（delta<0）并按掉量幅度排序（降幅大的在前）
    rows = rows.filter(function (r) { return r.delta < 0; });
    rows.sort(function (a, b) {
      // 先按降幅，再按掉量绝对值
      if (b.dropPct !== a.dropPct) return b.dropPct - a.dropPct;
      return (a.prevCount - a.curCount) - (b.prevCount - b.curCount);
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

  // ============================================================
  // 2) 好评 / 差评区分
  // ============================================================
  // 返回 { shop:{good,bad,neutral,unknown,total,positiveRate,negativeRate},
  //        perSku:[{sku,good,bad,neutral,total,positiveRate,negativeRate}] }
  function getReviewTypeStats(shopId) {
    var skuReviews = _safeGetAll('CBSkuReviewDB', shopId);
    var shop = { good: 0, bad: 0, neutral: 0, unknown: 0 };
    var bySku = {};

    function ensure(sku) {
      if (!bySku[sku]) bySku[sku] = { sku: sku, good: 0, bad: 0, neutral: 0, unknown: 0 };
      return bySku[sku];
    }

    skuReviews.forEach(function (r) {
      var sku = normalizeSku(r.sku);
      var t = (r.type || '').toLowerCase();
      var bucket = (t === 'good') ? 'good' : (t === 'bad') ? 'bad'
        : (t === 'neutral') ? 'neutral' : 'unknown';
      shop[bucket]++;
      ensure(sku)[bucket]++;
    });

    var perSku = Object.keys(bySku).map(function (k) {
      var s = bySku[k];
      var eff = s.good + s.bad;
      return {
        sku: k,
        good: s.good, bad: s.bad, neutral: s.neutral, unknown: s.unknown,
        total: s.good + s.bad + s.neutral + s.unknown,
        positiveRate: eff > 0 ? (s.good / eff * 100) : 0,
        negativeRate: eff > 0 ? (s.bad / eff * 100) : 0
      };
    });
    // 差评多的排前面
    perSku.sort(function (a, b) { return b.bad - a.bad || b.total - a.total; });

    var effShop = shop.good + shop.bad;
    return {
      shop: {
        good: shop.good, bad: shop.bad, neutral: shop.neutral, unknown: shop.unknown,
        total: shop.good + shop.bad + shop.neutral + shop.unknown,
        positiveRate: effShop > 0 ? (shop.good / effShop * 100) : 0,
        negativeRate: effShop > 0 ? (shop.bad / effShop * 100) : 0
      },
      perSku: perSku
    };
  }

  // ============================================================
  // 3) 概览 UI 注入（店铺分析页）
  // ============================================================
  var _state = {}; // shopId -> {dropMode:'day'|'week', reviewFilter:'all'|'good'|'bad'|'neutral'}

  function _sectionStyle(extra) {
    return 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;margin-bottom:14px;' + (extra || '');
  }

  function renderOverview(shopId) {
    if (!shopId) return;
    var ovDiv = document.getElementById('cb-tab-overview-' + shopId);
    if (!ovDiv) return;

    // 清掉旧的（防止重复）
    var old = ovDiv.querySelector('.da-section');
    while (old) { old.parentNode.removeChild(old); old = ovDiv.querySelector('.da-section'); }

    if (!_state[shopId]) _state[shopId] = { dropMode: 'day', reviewFilter: 'all' };

    ovDiv.appendChild(_buildDropSection(shopId));
    ovDiv.appendChild(_buildReviewSection(shopId));
  }

  function _buildDropSection(shopId) {
    var state = _state[shopId];
    var wrap = document.createElement('div');
    wrap.className = 'da-section';
    wrap.style.cssText = _sectionStyle();

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:#333;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px';
    title.innerHTML = '<span>📉 掉量分析 <span style="font-size:11px;color:#fa541c;font-weight:400">（关联退货/差评找原因）</span></span>';
    wrap.appendChild(title);

    // 切换 日/周
    var toggle = document.createElement('div');
    toggle.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
    [['day', '日环比'], ['week', '周环比']].forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p[1];
      b.style.cssText = 'padding:5px 14px;border:1px solid #d9d9d9;border-radius:14px;background:'
        + (state.dropMode === p[0] ? '#fa541c' : '#fff') + ';color:'
        + (state.dropMode === p[0] ? '#fff' : '#333') + ';font-size:12px;cursor:pointer';
      b.onclick = function () {
        _state[shopId].dropMode = p[0];
        var fresh = _buildDropSection(shopId);
        wrap.parentNode.replaceChild(fresh, wrap);
      };
      toggle.appendChild(b);
    });
    wrap.appendChild(toggle);

    var data = computeDropRanking(shopId, state.dropMode);
    if (data.empty) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:#999;padding:10px 0';
      empty.textContent = '暂无订单数据，无法计算掉量。';
      wrap.appendChild(empty);
      return wrap;
    }

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px';
    sub.textContent = data.label + '　本期：' + data.curLabel + '　上期：' + data.prevLabel;
    wrap.appendChild(sub);

    if (data.rows.length === 0) {
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:12px;color:#52c41a;padding:10px 0';
      ok.textContent = '✅ 本期无掉量款式（各款式单量均持平或上涨）。';
      wrap.appendChild(ok);
      return wrap;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    var thead = '<thead><tr style="background:#fff7e6;color:#d4380d;text-align:center">'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">款式(SKU)</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">本期单量</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">上期单量</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">变化</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">降幅</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">退货</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba">差评</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #ffe7ba;text-align:left">推测原因</th>'
      + '</tr></thead>';
    var tbody = '<tbody>';
    data.rows.forEach(function (r) {
      var deltaColor = r.delta < 0 ? '#cf1322' : '#389e0d';
      var deltaTxt = (r.delta > 0 ? '+' : '') + r.delta;
      var dropColor = r.dropPct < 0 ? '#cf1322' : '#389e0d';
      var reasonColor = r.negCount > 0 || r.refundQty > 0 ? '#d4380d' : '#8c8c8c';
      tbody += '<tr style="text-align:center">'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;font-weight:600">' + _esc(r.sku) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5">' + _fmtInt(r.curCount) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:#8c8c8c">' + _fmtInt(r.prevCount) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:' + deltaColor + ';font-weight:600">' + deltaTxt + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:' + dropColor + '">' + _pct(r.dropPct) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5">' + (r.refundQty > 0 ? ('<span style="color:#d4380d">' + r.refundQty + '</span>') : '0') + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5">' + (r.negCount > 0 ? ('<span style="color:#cf1322">' + r.negCount + '</span>') : '0') + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;text-align:left;color:' + reasonColor + '">' + _esc(r.reason) + '</td>'
        + '</tr>';
    });
    tbody += '</tbody>';
    table.innerHTML = thead + tbody;
    wrap.appendChild(table);
    return wrap;
  }

  function _buildReviewSection(shopId) {
    var state = _state[shopId];
    var wrap = document.createElement('div');
    wrap.className = 'da-section';
    wrap.style.cssText = _sectionStyle();

    var stats = getReviewTypeStats(shopId);
    var s = stats.shop;

    var title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:#333;margin-bottom:10px';
    title.innerHTML = '⭐ 好评 / 差评区分';
    wrap.appendChild(title);

    // 店铺级汇总卡
    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:12px';
    var cardData = [
      { label: '好评', val: _fmtInt(s.good), color: '#52c41a' },
      { label: '差评', val: _fmtInt(s.bad), color: '#cf1322' },
      { label: '中性', val: _fmtInt(s.neutral), color: '#8c8c8c' },
      { label: '好评率', val: s.positiveRate.toFixed(1) + '%', color: '#389e0d' },
      { label: '差评率', val: s.negativeRate.toFixed(1) + '%', color: '#d4380d' }
    ];
    cardData.forEach(function (c) {
      var d = document.createElement('div');
      d.style.cssText = 'background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:10px;text-align:center';
      d.innerHTML = '<div style="font-size:20px;font-weight:700;color:' + c.color + '">' + c.val + '</div>'
        + '<div style="font-size:11px;color:#888;margin-top:2px">' + c.label + '</div>';
      cards.appendChild(d);
    });
    wrap.appendChild(cards);

    // 筛选
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap';
    [['all', '全部'], ['good', '好评'], ['bad', '差评'], ['neutral', '中性']].forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p[1];
      var active = state.reviewFilter === p[0];
      b.style.cssText = 'padding:4px 12px;border:1px solid #d9d9d9;border-radius:14px;background:'
        + (active ? '#1890ff' : '#fff') + ';color:' + (active ? '#fff' : '#333') + ';font-size:12px;cursor:pointer';
      b.onclick = function () {
        _state[shopId].reviewFilter = p[0];
        var fresh = _buildReviewSection(shopId);
        wrap.parentNode.replaceChild(fresh, wrap);
      };
      filterBar.appendChild(b);
    });
    wrap.appendChild(filterBar);

    // 款式级表格
    var rows = stats.perSku.filter(function (r) {
      if (state.reviewFilter === 'all') return true;
      if (state.reviewFilter === 'good') return r.good > 0;
      if (state.reviewFilter === 'bad') return r.bad > 0;
      if (state.reviewFilter === 'neutral') return r.neutral > 0;
      return true;
    }).slice(0, 30);

    if (rows.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:#999;padding:8px 0';
      empty.textContent = '暂无款式评价记录。';
      wrap.appendChild(empty);
      return wrap;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    var thead = '<thead><tr style="background:#e6f7ff;color:#0958d9;text-align:center">'
      + '<th style="padding:6px 4px;border-bottom:1px solid #bae0ff">款式(SKU)</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #bae0ff">好评</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #bae0ff">差评</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #bae0ff">中性</th>'
      + '<th style="padding:6px 4px;border-bottom:1px solid #bae0ff">好评率</th>'
      + '</tr></thead>';
    var tbody = '<tbody>';
    rows.forEach(function (r) {
      var rateColor = r.negativeRate >= 30 ? '#cf1322' : (r.negativeRate >= 10 ? '#d4380d' : '#389e0d');
      tbody += '<tr style="text-align:center">'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;font-weight:600">' + _esc(r.sku) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:#52c41a;font-weight:600">' + _fmtInt(r.good) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:#cf1322;font-weight:600">' + _fmtInt(r.bad) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:#8c8c8c">' + _fmtInt(r.neutral) + '</td>'
        + '<td style="padding:6px 4px;border-bottom:1px solid #f5f5f5;color:' + rateColor + '">' + r.positiveRate.toFixed(1) + '%</td>'
        + '</tr>';
    });
    tbody += '</tbody>';
    table.innerHTML = thead + tbody;
    wrap.appendChild(table);
    return wrap;
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  // 4) Hook：包裹 window._ov5_refreshOverview
  // ============================================================
  function _installHook() {
    if (window.__dropAnalysisHooked) return;
    window.__dropAnalysisHooked = true;
    var orig = window._ov5_refreshOverview;
    window._ov5_refreshOverview = function (shopId) {
      if (typeof orig === 'function') {
        try { orig.apply(this, arguments); } catch (e) { console.error('[DropAnalysis] orig overview error', e); }
      }
      setTimeout(function () {
        try { renderOverview(shopId); } catch (e) { console.error('[DropAnalysis] render error', e); }
      }, 450);
    };
    console.log('[DropAnalysis] ✅ 已挂载到 _ov5_refreshOverview');
  }

  // 暴露 API
  window.DropAnalysis = {
    normalizeSku: normalizeSku,
    computeDropRanking: computeDropRanking,
    getReviewTypeStats: getReviewTypeStats,
    renderOverview: renderOverview
  };

  // 安装 hook（延迟到 DOM 与 ov6 脚本都就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_installHook, 300); });
  } else {
    setTimeout(_installHook, 300);
  }

  console.log('[DropAnalysis] V159 loaded ✓');
})();
