/**
 * 跨境店铺总览系统 v6-charts
 * 图表版：关键指标卡 + 趋势曲线 + 饼图 + 柱状图 + 明细表
 * 在 app-v6.html 中引用 ov6-v6.js
 */

(function() {
  'use strict';

  // ===== 工具函数 =====
  function _ov5_id(s) { return document.getElementById(s); }
  function _ov5_q(s) { return document.querySelector(s); }
  function _ov5_pad(n) { return String(n).padStart(2, '0'); }
  // 美国时区（跨境数据日期锚点）：默认美国东部，可改为 'America/Los_Angeles' 等
  var _OV5_US_TZ = 'America/New_York';
  function _ov5_usNowDate() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: _OV5_US_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var y = '', m = '', d = '';
    parts.forEach(function(p) { if (p.type === 'year') y = p.value; else if (p.type === 'month') m = p.value; else if (p.type === 'day') d = p.value; });
    return new Date(y + '-' + m + '-' + d + 'T00:00:00');
  }
  function _ov5_fmtYMD(dt) { return dt.getFullYear() + '-' + _ov5_pad(dt.getMonth() + 1) + '-' + _ov5_pad(dt.getDate()); }
  function _ov5_fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    n = Number(n);
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
  }
  function _ov5_escape(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== 状态管理 =====
  var _ov5_shopId = null;
  var _ov5_initDone = false;
  var _ov5_tabInjected = {};
  var _ov5_dateRange = {};
  var _ov5_charts = {}; // 缓存店铺图表实例
  var _ov5_autoSwitched = {}; // 记录是否已经自动切到全部
  var _ov5_retryCount = {}; // 数据加载重试计数（按店铺）

  // ===== 日期范围 =====
  function _ov5_formatRangeLabel(dr) {
    if (!dr) return '';
    var lbl = dr.label || '';
    // 「全部」这类开放窗口（1900~2099）不显示具体日期范围
    if (dr.from && dr.from.indexOf('1900') === 0) return lbl;
    if (dr.from && dr.to) {
      var f = dr.from.substring(5);
      var t = dr.to.substring(5);
      if (f === t) return lbl + '（' + f + '）';
      return lbl + '（' + f + '~' + t + '）';
    }
    return lbl;
  }

  function _ov5_getDateRange(shopId) {
    if (_ov5_dateRange[shopId]) return _ov5_dateRange[shopId];
    // 默认也按「最后数据日」锚定（与掉量分析一致），无数据时退回美国昨天
    var lastDate = _ov5_getLastDataDate(shopId);
    var anchor;
    if (lastDate) {
      anchor = new Date(lastDate + 'T00:00:00');
    } else {
      anchor = new Date(_ov5_usNowDate().getTime() - 86400000);
    }
    var to = anchor;
    var from = new Date(to.getTime() - 6 * 86400000);
    return {
      from: _ov5_fmtYMD(from),
      to: _ov5_fmtYMD(to),
      label: '近7天',
      anchor: lastDate || _ov5_fmtYMD(anchor)
    };
  }

  // ===== 初始化 =====
  function _ov5_initWhenReady() {
    if (_ov5_initDone) return;
    if (typeof CBOrderDB === 'undefined' || typeof shops === 'undefined') {
      setTimeout(_ov5_initWhenReady, 300);
      return;
    }
    _ov5_initDone = true;
    _ov5_initOverview();
  }

  function _ov5_initOverview() {
    if (_ov5_initDone !== true) return;
    
    document.addEventListener('click', function(e) {
      var navItem = e.target.closest('.nav-item[data-id], .nav-item.shop-link');
      if (navItem) {
        var sid = navItem.getAttribute('data-id') || navItem.getAttribute('data-shop-id');
        if (sid) {
          _ov5_shopId = sid;
          setTimeout(function() { _ov5_ensureTab(sid); }, 600);
        }
      }
    });

    // 全局总览入口由用户控制（overview-charts-v2.js 渲染）

    console.log('[OV6] Initialized ✓');
  }

  // ===== 确保总览Tab存在 =====
  function _ov5_ensureTab(shopId) {
    if (!shopId) return;
    if (_ov5_tabInjected[shopId]) return;

    var existingContent = _ov5_id('cross-border-overview-' + shopId);
    if (existingContent) {
      _ov5_tabInjected[shopId] = true;
      _ov5_shopId = shopId;
      var ovDiv = _ov5_id('cb-tab-overview-' + shopId);
      if (ovDiv && !ovDiv.querySelector('.ov6-section')) {
        ovDiv.innerHTML = '';
        ovDiv.appendChild(_ov5_buildOverviewContent(shopId));
      }
      setTimeout(function() { _ov5_loadData(shopId); }, 200);
      return;
    }

    var area = _ov5_id('shop-detail-' + shopId);
    if (!area) {
      var ordersEl = _ov5_q('[id^="cb-tab-orders-"]');
      if (ordersEl && ordersEl.parentNode) {
        area = ordersEl.parentNode;
        var m = ordersEl.id.match(/cb-tab-orders-(.+)/);
        if (m && m[1]) shopId = m[1];
      } else {
        return;
      }
    }

    _ov5_tabInjected[shopId] = true;
    console.log('[OV6] Creating overview tab for:', shopId);

    _ov5_addButton(shopId, area);

    var ovDiv = document.createElement('div');
    ovDiv.id = 'cb-tab-overview-' + shopId;
    ovDiv.style.display = 'none';
    ovDiv.appendChild(_ov5_buildOverviewContent(shopId));

    var firstTab = area.querySelector('[id^="cb-tab-orders-"]');
    if (firstTab && firstTab.parentNode) {
      firstTab.parentNode.insertBefore(ovDiv, firstTab);
    } else {
      area.appendChild(ovDiv);
    }

    _ov5_showOnlyTab(shopId, 'overview');
    setTimeout(function() { _ov5_loadData(shopId); }, 200);
  }

  // ===== 显示指定Tab =====
  function _ov5_showOnlyTab(shopId, activeTab) {
    var allIds = ['overview', 'optimize', 'orders', 'refunds', 'daily', 'reviews'];
    allIds.forEach(function(tid) {
      var el = _ov5_id('cb-tab-' + tid + '-' + shopId);
      if (el) el.style.display = (tid === activeTab) ? 'block' : 'none';
    });
    _ov5_updateHighlight(shopId, activeTab);
    window['_cbTab_' + shopId] = activeTab;

    if (activeTab === 'overview') {
      setTimeout(function() { _ov5_loadData(shopId); }, 50);
    } else if (activeTab === 'optimize') {
      // V128: 切到店铺优化 Tab 时，触发优化分析渲染
      setTimeout(function() {
        try {
          if (typeof window.renderOptimizeTab === 'function') {
            window.renderOptimizeTab(shopId);
          } else if (typeof window.renderOptimize === 'function') {
            window.renderOptimize(shopId);
          }
        } catch (e) { console.error('[OV6] renderOptimizeTab failed:', e); }
      }, 80);
    }
  }

  // ===== 添加总览按钮 =====
  function _ov5_addButton(shopId, area) {
    var tabNav = _ov5_findTabNav(area);
    if (!tabNav) return;
    if (tabNav.querySelector('.cb-overview-tab-btn')) return;

    var firstBtn = tabNav.querySelector('button[onclick*="setCBTab"]') || tabNav.querySelector('button');
    if (!firstBtn) return;

    var ovBtn = document.createElement('button');
    ovBtn.className = 'cb-overview-tab-btn';
    ovBtn.style.cssText = firstBtn.style.cssText;
    ovBtn.innerHTML = '📊 总览';
    ovBtn.onclick = function() { _ov5_showOnlyTab(shopId, 'overview'); };

    tabNav.insertBefore(ovBtn, firstBtn);

    tabNav.addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var onclick = btn.getAttribute('onclick') || '';
      var sm = onclick.match(/setCBTab\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
      if (sm) {
        _ov5_showOnlyTab(sm[1], sm[2]);
      }
    });
  }

  function _ov5_findTabNav(area) {
    var selectors = ['.tab-nav', '.cb-tab-nav', '.detail-tabs'];
    for (var i = 0; i < selectors.length; i++) {
      var el = area.querySelector(selectors[i]);
      if (el) return el;
    }
    var btns = area.querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) {
      if ((btns[j].getAttribute('onclick') || '').indexOf('setCBTab') >= 0) {
        return btns[j].parentNode;
      }
    }
    return null;
  }

  function _ov5_updateHighlight(shopId, activeTab) {
    var area = _ov5_id('shop-detail-' + shopId) || (_ov5_id('cb-tab-overview-' + shopId) || {}).parentNode;
    if (!area) return;
    var btns = area.querySelectorAll('button');
    btns.forEach(function(btn) {
      var oc = btn.getAttribute('onclick') || '';
      if (oc.indexOf(activeTab) >= 0 || (activeTab === 'overview' && btn.onclick && btn.onclick.toString().indexOf('overview') >= 0)) {
        btn.style.fontWeight = '700';
        btn.style.borderBottom = '2px solid #1890ff';
      } else {
        btn.style.fontWeight = '';
        btn.style.borderBottom = '';
      }
    });
  }

  // ===== 销毁店铺旧图表 =====
  function _ov5_destroyCharts(shopId) {
    var list = _ov5_charts[shopId];
    if (!list) return;
    list.forEach(function(chart) {
      if (chart && typeof chart.destroy === 'function') {
        try { chart.destroy(); } catch(e) {}
      }
    });
    _ov5_charts[shopId] = [];
  }

  // ===== 构建总览内容 =====
  function _ov5_buildOverviewContent(shopId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'ov6-wrapper';
    wrapper.style.cssText = 'padding:12px;';

    // 标题栏
    var title = document.createElement('div');
    title.style.cssText = 'background:#e6f7ff;border-left:4px solid #1890ff;padding:10px 14px;margin-bottom:14px;border-radius:8px;font-size:13px;color:#0958d9;font-weight:600;display:flex;align-items:center;justify-content:space-between';
    title.innerHTML = '<span>📊 店铺数据总览</span><button onclick="_ov5_forceLoad(\'' + shopId + '\')" style="background:#1890ff;color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:12px;cursor:pointer">🔄 刷新</button>';
    wrapper.appendChild(title);

    // 关键指标卡（4张紧凑卡片）
    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px';
    var metrics = [
      { label: '成交金额 💰', id: 'ov-gmv-' + shopId, color: '#1890ff', icon: '💰' },
      { label: '支付金额 📈', id: 'ov-netgmv-' + shopId, color: '#52c41a', icon: '📈' },
      { label: '订单量 📦', id: 'ov-salesqty-' + shopId, color: '#fa8c16', icon: '📦' },
      { label: '访客量 👥', id: 'ov-visitors-' + shopId, color: '#722ed1', icon: '👥' }
    ];
    metrics.forEach(function(m) {
      cards.appendChild(_ov5_createCard(m, shopId));
    });
    wrapper.appendChild(cards);

    // 周期选择器
    var ctrlSection = document.createElement('div');
    ctrlSection.className = 'ov6-section';
    ctrlSection.style.cssText = 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px';

    var dateLabel = document.createElement('span');
    dateLabel.id = 'ov-date-range-' + shopId;
    dateLabel.style.cssText = 'font-size:12px;color:#1890ff;background:#e6f7ff;padding:4px 10px;border-radius:4px';
    dateLabel.textContent = _ov5_formatRangeLabel(_ov5_getDateRange(shopId)) || '近7天';
    ctrlSection.appendChild(dateLabel);

    var btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    var periods = [
      { key: 'yesterday', label: '昨天' },
      { key: 'today', label: '今天' },
      { key: '7', label: '近7天', active: true },
      { key: '30', label: '近30天' },
      { key: '90', label: '近90天' },
      { key: 'all', label: '全部' }
    ];
    periods.forEach(function(p) {
      var btn = document.createElement('button');
      btn.style.cssText = 'padding:5px 12px;border:1px solid #d9d9d9;border-radius:14px;background:' + (p.active ? '#1890ff' : '#fff') + ';color:' + (p.active ? '#fff' : '#333') + ';font-size:12px;cursor:pointer';
      btn.textContent = p.label;
      btn.onclick = function() {
        Array.from(btnGroup.children).forEach(function(b) {
          b.style.background = '#fff';
          b.style.color = '#333';
        });
        btn.style.background = '#1890ff';
        btn.style.color = '#fff';
        _ov5_setPeriod(shopId, p.key);
      };
      btnGroup.appendChild(btn);
    });
    ctrlSection.appendChild(btnGroup);
    wrapper.appendChild(ctrlSection);

    // 趋势曲线图（全宽）
    var trendSection = document.createElement('div');
    trendSection.className = 'ov6-section';
    trendSection.style.cssText = 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;margin-bottom:14px';
    trendSection.innerHTML = '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">📈 每日趋势曲线</div><div style="position:relative;height:260px"><canvas id="ov-chart-trend-' + shopId + '"></canvas></div>';
    wrapper.appendChild(trendSection);

    // 饼图 + 柱状图（双列）
    var chartRow = document.createElement('div');
    chartRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px';

    var pieSection = document.createElement('div');
    pieSection.className = 'ov6-section';
    pieSection.style.cssText = 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px';
    pieSection.innerHTML = '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">🥧 SKU 金额占比 TOP10</div><div style="position:relative;height:260px"><canvas id="ov-chart-pie-' + shopId + '"></canvas></div>';
    chartRow.appendChild(pieSection);

    var barSection = document.createElement('div');
    barSection.className = 'ov6-section';
    barSection.style.cssText = 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px';
    barSection.innerHTML = '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">📊 每日订单量对比</div><div style="position:relative;height:260px"><canvas id="ov-chart-bar-' + shopId + '"></canvas></div>';
    chartRow.appendChild(barSection);

    wrapper.appendChild(chartRow);


    // V128: 智能优化建议快捷入口（详细分析在「店铺优化」Tab 中）
    wrapper.appendChild(_ov5_buildQuickSuggest(shopId));

    return wrapper;
  }

  // ===== 智能建议快捷入口（详细分析在"店铺优化"Tab 中） =====
  function _ov5_buildQuickSuggest(shopId) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'background:linear-gradient(135deg,#e6f7ff 0%,#f9f0ff 100%);border:1px solid #d6e4ff;border-radius:8px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px';
    wrap.innerHTML = '' +
      '<div>' +
        '<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:3px">💡 智能优化建议</div>' +
        '<div style="font-size:12px;color:#64748b">差评率 / 退款率 / 转化率 / 客单价 / 连带率等多维分析 · 基于近 30 天数据</div>' +
      '</div>' +
      '<button onclick="setCBTab(\'' + shopId + '\',\'optimize\')" style="background:linear-gradient(135deg,#1890ff 0%,#722ed1 100%);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:500">查看完整智能优化方案 →</button>';
    return wrap;
  }

  function _ov5_createCard(m, shopId) {
    var card = document.createElement('div');
    card.className = 'ov6-card';
    card.style.cssText = 'background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:12px;min-width:120px;box-shadow:0 1px 3px rgba(0,0,0,0.04);border-top:3px solid ' + m.color;
    card.innerHTML = '<div style="font-size:11px;color:#888;margin-bottom:6px">' + m.label + '</div><div id="' + m.id + '" style="font-size:22px;font-weight:700;color:' + m.color + '">-</div>';
    return card;
  }

  // ===== 合并每日数据 + 订单数据 =====
  function _ov5_normalizeDate(d) {
    if (!d) return '';
    var s = String(d).trim().replace(/[\sT].+$/, '').replace(/\//g, '-');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return '';
    return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  }

  // 补齐空白日：把 from~to 范围内无数据的天补成 0，让趋势曲线横轴显示完整窗口
  function _ov5_padEmptyDates(data, from, to) {
    if (!from || !to || !Array.isArray(data)) return data || [];
    // 防护：窗口过大（如「全部」= 1900~2099）时不补齐，直接返回原数据，避免生成上万个点卡死页面
    var spanDays = (new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000;
    if (!(spanDays >= 0) || spanDays > 366) return data || [];
    var map = {};
    (data || []).forEach(function(d) {
      if (d && d.date) map[d.date] = d;
    });
    var fromDate = new Date(from + 'T00:00:00');
    var toDate = new Date(to + 'T23:59:59');
    var out = [];
    for (var d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      var ds = _ov5_fmtYMD(d);
      if (map[ds]) {
        out.push(map[ds]);
      } else {
        out.push({
          date: ds,
          visitors: 0,
          payer_count: 0,
          item_count: 0,
          pay_amount: 0,
          _empty: true
        });
      }
    }
    return out;
  }

  function _ov5_mergeDailyData(dailyData, orders, fromDate, toDate) {
    var map = {};

    // 1. 先加入每日数据（兼容 buyers/qty/amount 和 payer_count/item_count/pay_amount）
    dailyData.forEach(function(d) {
      if (!d.date) return;
      var date = _ov5_normalizeDate(d.date);
      if (!date) return;
      map[date] = {
        date: date,
        visitors: parseInt(d.visitors) || 0,
        payer_count: parseInt(d.payer_count || d.buyers || d.payment_buyers) || 0,
        item_count: parseInt(d.item_count || d.qty || d.payment_count) || 0,
        pay_amount: parseFloat(d.pay_amount || d.amount || d.payment_amount) || 0,
        _hasDaily: true
      };
    });

    // 2. 用订单数据补全/叠加（仅当该日期没有每日数据时才补充）
    orders.forEach(function(o) {
      if (!o.date) return;
      var date = _ov5_normalizeDate(o.date);
      if (!date) return;
      if (!map[date]) {
        map[date] = { date: date, visitors: 0, payer_count: 0, item_count: 0, pay_amount: 0, _hasDaily: false };
      }
      if (map[date]._hasDaily) return; // 有每日数据时以每日数据为准，避免重复叠加
      map[date].pay_amount += (parseFloat(o.sale_amount) || 0);
      map[date].item_count += 1;
      if (map[date].payer_count === 0) map[date].payer_count = 1;
    });

    // 3. 按日期范围过滤并排序
    var result = [];
    Object.keys(map).forEach(function(date) {
      var d = new Date(date + 'T00:00:00');
      if (d >= fromDate && d <= toDate) {
        result.push(map[date]);
      }
    });
    return result.sort(function(a, b) { return a.date.localeCompare(b.date); });
  }

  // ===== 数据加载 =====
  function _ov5_loadData(shopId) {
    console.log('[OV6] Loading data for:', shopId);
    try {
      var sym = '$';
      try {
        if (typeof DB !== 'undefined' && DB.getShops) {
          var s = DB.getShops().find(function(x) { return x.id === shopId; });
          if (s && typeof getPlatformCurrency === 'function' && getPlatformCurrency(s.platform || '') !== 'USD') sym = '¥';
        }
      } catch(e) {}

      // 读取订单数据
      var allOrders = [];
      if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
        allOrders = CBOrderDB.getAll(shopId) || [];
      }
      var validOrders = allOrders.filter(function(o) { return (o.sale_amount || 0) > 0; });
      var totalSales = allOrders.reduce(function(s, o) { return s + (o.sale_amount || 0); }, 0);

      // 读取每日数据
      var dailyData = [];
      if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) {
        dailyData = CrossBorderDailyDB.getAll(shopId) || [];
      }

      // 当前日期范围
      var dr = _ov5_getDateRange(shopId);
      var fromDate = new Date(dr.from + 'T00:00:00');
      var toDate = new Date(dr.to + 'T23:59:59');

      // 合并每日数据 + 订单数据（有订单就能画出趋势图）
      var merged = _ov5_mergeDailyData(dailyData, validOrders, fromDate, toDate);

      // 兜底：如果合并结果为空但有订单数据，直接从订单生成趋势数据（仍需符合日期范围）
      if (merged.length === 0 && validOrders.length > 0) {
        console.log('[OV6] merged为空，尝试从' + validOrders.length + '条订单直接生成趋势数据');
        var orderMap = {};
        validOrders.forEach(function(o) {
          if (!o.date) return;
          var date = _ov5_normalizeDate(o.date);
          if (!date) return;
          var d = new Date(date + 'T00:00:00');
          if (d < fromDate || d > toDate) return;
          if (!orderMap[date]) {
            orderMap[date] = { date: date, visitors: 0, payer_count: 0, item_count: 0, pay_amount: 0 };
          }
          orderMap[date].pay_amount += (parseFloat(o.sale_amount) || 0);
          orderMap[date].item_count += 1;
          if (orderMap[date].payer_count === 0) orderMap[date].payer_count = 1;
        });
        merged = Object.values(orderMap).sort(function(a, b) { return a.date.localeCompare(b.date); });
        console.log('[OV6] 订单生成趋势数据:', merged.length, '天');
      }

      // 自动兜底：按优先级链式回退
      // 今天/昨天 → 近7天 → 全部
      if (merged.length === 0 && !_ov5_autoSwitched[shopId] && dr.label !== '全部') {
        var targetPeriod = null;
        if (dr.label === '今天' || dr.label === '昨天') {
          targetPeriod = '7';
        } else {
          targetPeriod = 'all';
        }
        _ov5_autoSwitched[shopId] = true;
        console.log('[OV6] ' + dr.label + '无数据，自动切换至' + (targetPeriod === 'all' ? '全部' : '近7天') + ':', shopId);
        _ov5_setPeriod(shopId, targetPeriod);
        return;
      }

      // 计算汇总指标
      var totalVisitors = 0, totalPayers = 0, totalItems = 0, totalPayAmt = 0;
      merged.forEach(function(d) {
        totalVisitors += d.visitors || 0;
        totalPayers += d.payer_count || 0;
        totalItems += d.item_count || 0;
        totalPayAmt += d.pay_amount || 0;
      });

      _ov5_setText('ov-gmv-' + shopId, sym + _ov5_fmtNum(totalSales));
      _ov5_setText('ov-salesqty-' + shopId, validOrders.length);
      _ov5_setText('ov-visitors-' + shopId, _ov5_fmtNum(totalVisitors));
      _ov5_setText('ov-netgmv-' + shopId, sym + _ov5_fmtNum(totalPayAmt > 0 ? totalPayAmt : totalSales));

      _ov5_renderTable(shopId, merged);
      _ov5_renderCharts(shopId, merged, validOrders, sym);

      console.log('[OV6] Data loaded:', shopId, 'orders:', allOrders.length, 'daily:', dailyData.length, 'merged:', merged.length);

      // 数据为空时自动重试（等待同步完成）
      var rc = _ov5_retryCount[shopId] || 0;
      if (allOrders.length === 0 && merged.length === 0 && rc < 3) {
        rc++;
        _ov5_retryCount[shopId] = rc;
        console.log('[OV6] 数据为空，第 ' + rc + ' 次重试...');
        setTimeout(function() { _ov5_loadData(shopId); }, 2000 * rc);
      } else if (allOrders.length > 0 || merged.length > 0) {
        _ov5_retryCount[shopId] = 0;
      }
    } catch(e) {
      console.error('[OV6] Load error:', e.message, e.stack);
    }
  }

  function _ov5_renderTable(shopId, data) {
    var container = _ov5_id('ov-suggestions-' + shopId);
    if (!container) return;
    if (!data.length) {
      container.innerHTML = '<div style="color:#999;text-align:center;padding:20px">暂无数据，无法生成优化建议</div>';
      return;
    }

    // 计算关键指标
    var totalVisitors = 0, totalPayers = 0, totalItems = 0, totalPayAmt = 0;
    var days = data.length;
    data.forEach(function(d) {
      totalVisitors += d.visitors || 0;
      totalPayers += d.payer_count || 0;
      totalItems += d.item_count || 0;
      totalPayAmt += d.pay_amount || 0;
    });

    var avgConversion = totalVisitors > 0 ? (totalPayers / totalVisitors * 100) : 0;
    var avgOrderValue = totalPayers > 0 ? (totalPayAmt / totalPayers) : 0;
    var itemsPerBuyer = totalPayers > 0 ? (totalItems / totalPayers) : 0;

    // 趋势判断：近3天 vs 前3天（或总天数的前半 vs 后半）
    var sorted = data.slice().sort(function(a, b) { return a.date.localeCompare(b.date); });
    var mid = Math.floor(sorted.length / 2);
    var firstHalf = sorted.slice(0, mid);
    var secondHalf = sorted.slice(mid);
    var firstPay = firstHalf.reduce(function(s, d) { return s + (d.pay_amount || 0); }, 0) / Math.max(firstHalf.length, 1);
    var secondPay = secondHalf.reduce(function(s, d) { return s + (d.pay_amount || 0); }, 0) / Math.max(secondHalf.length, 1);
    var trendUp = secondPay > firstPay * 1.05;
    var trendDown = secondPay < firstPay * 0.95;

    // 读取退款/差评数据（用于建议）
    var refundRate = 0, reviewRate = 0;
    try {
      if (typeof CBRefundDB !== 'undefined' && CBRefundDB.getAll) {
        var refunds = CBRefundDB.getAll(shopId) || [];
        var refundAmt = refunds.reduce(function(s, r) { return s + (parseFloat(r.refund_amount) || 0); }, 0);
        refundRate = totalPayAmt > 0 ? (refundAmt / totalPayAmt * 100) : 0;
      }
    } catch(e) {}
    try {
      if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) {
        var reviews = CBReviewDB.getAll(shopId) || [];
        if (reviews.length > 0) {
          var avgReview = reviews.reduce(function(s, r) {
            var rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews / r.total_reviews * 100 : 0);
            return s + rate;
          }, 0) / reviews.length;
          reviewRate = avgReview;
        }
      }
    } catch(e) {}

    // 生成建议
    var suggestions = [];

    // 1. 销量趋势
    if (trendUp) {
      suggestions.push({ icon: '📈', title: '销量趋势向好', desc: '近期日均销售额较上半周期有所增长，建议保持当前运营节奏，并趁势加大热销款库存与广告投放。', type: 'good' });
    } else if (trendDown) {
      suggestions.push({ icon: '📉', title: '销量出现下滑', desc: '近期日均销售额较上半周期下降，建议排查是否因缺货、竞品降价或广告预算减少导致，及时调整投放策略。', type: 'warn' });
    } else {
      suggestions.push({ icon: '➡️', title: '销量趋于平稳', desc: '近期销售额波动不大，可通过限时折扣、满减活动或新品上架刺激增长。', type: 'neutral' });
    }

    // 2. 转化率
    if (avgConversion < 1) {
      suggestions.push({ icon: '🔍', title: '转化率偏低（' + avgConversion.toFixed(2) + '%）', desc: '访客多但成交少，建议优化主图、标题、价格竞争力，并检查详情页是否能清晰传达卖点与信任背书。', type: 'warn' });
    } else if (avgConversion < 3) {
      suggestions.push({ icon: '⚖️', title: '转化率有提升空间（' + avgConversion.toFixed(2) + '%）', desc: '可尝试 A/B 测试主图、设置新客优惠券、优化评价展示，进一步提升下单转化。', type: 'neutral' });
    } else {
      suggestions.push({ icon: '✅', title: '转化率表现优秀（' + avgConversion.toFixed(2) + '%）', desc: '流量承接能力较强，建议适当增加广告预算扩大访客规模，同时关注库存深度。', type: 'good' });
    }

    // 3. 客单价
    if (avgOrderValue < 20) {
      suggestions.push({ icon: '🛒', title: '客单价较低（$' + avgOrderValue.toFixed(2) + '）', desc: '可通过组合套装、满额包邮、加购优惠等方式提升客单价与利润空间。', type: 'warn' });
    } else if (avgOrderValue < 50) {
      suggestions.push({ icon: '💰', title: '客单价中等（$' + avgOrderValue.toFixed(2) + '）', desc: '可针对热销款推出搭配套餐，或设置阶梯满减，进一步挖掘客户购买力。', type: 'neutral' });
    } else {
      suggestions.push({ icon: '💎', title: '客单价较高（$' + avgOrderValue.toFixed(2) + '）', desc: '高客单价说明产品溢价能力较好，建议重点维护老客户复购与 VIP 专属服务。', type: 'good' });
    }

    // 4. 人均购买件数
    if (itemsPerBuyer < 1.2) {
      suggestions.push({ icon: '🔗', title: '连带率偏低（' + itemsPerBuyer.toFixed(2) + '件/人）', desc: '买家单次购买件数少，可在详情页与购物车页增加「经常一起买」的关联推荐。', type: 'warn' });
    } else {
      suggestions.push({ icon: '🎁', title: '连带率良好（' + itemsPerBuyer.toFixed(2) + '件/人）', desc: '可继续通过多件折扣、组合销售提升客单与利润。', type: 'good' });
    }

    // 5. 退款率
    if (refundRate > 5) {
      suggestions.push({ icon: '🚨', title: '退款率偏高（' + refundRate.toFixed(2) + '%）', desc: '退款金额占销售额比例较高，需重点排查产品质量、尺码描述、物流时效与售后响应速度。', type: 'warn' });
    } else if (refundRate > 2) {
      suggestions.push({ icon: '📦', title: '退款率需关注（' + refundRate.toFixed(2) + '%）', desc: '建议定期分析退货原因，优化商品描述与质检流程，降低售后成本。', type: 'neutral' });
    }

    // 6. 差评率
    var reviewTrend = 0, reviewPeak = null, reviewTotal = 0, reviewAvg = 0;
    var reviewRecent = [];
    try {
      if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) {
        var rvs = CBReviewDB.getAll(shopId) || [];
        if (rvs.length > 0) {
          var sortedRvs = rvs.slice().sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
          reviewTotal = sortedRvs.length;
          reviewAvg = reviewTotal > 0 ? sortedRvs.reduce(function(s, r) {
            var rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews / r.total_reviews * 100 : 0);
            return s + rate;
          }, 0) / reviewTotal : 0;
          // 找到差评率高峰日（不是条数，是 rate%）
          reviewPeak = sortedRvs.reduce(function(b, r) {
            var rRate = r.negative_rate != null ? r.negative_rate : 0;
            var bRate = b ? (b.negative_rate != null ? b.negative_rate : 0) : -1;
            return (!b || rRate > bRate) ? r : b;
          }, null);
          // 趋势：最近一期 vs 早期
          if (sortedRvs.length >= 2) {
            var half = Math.floor(sortedRvs.length / 2);
            var firstAvg = sortedRvs.slice(0, half).reduce(function(s, r) {
              return s + (r.negative_rate != null ? r.negative_rate : 0);
            }, 0) / Math.max(half, 1);
            var secondAvg = sortedRvs.slice(half).reduce(function(s, r) {
              return s + (r.negative_rate != null ? r.negative_rate : 0);
            }, 0) / Math.max(sortedRvs.length - half, 1);
            reviewTrend = secondAvg - firstAvg;
          }
          // 最近 3 条
          reviewRecent = sortedRvs.slice(-3);
        }
      }
    } catch(e) {}

    if (reviewRate > 5) {
      suggestions.push({ icon: '⚠️', title: '差评率偏高（' + reviewRate.toFixed(2) + '%）', desc: '差评率超过 5% 警戒线，必须立即排查差评集中原因（质量/尺码/物流），并针对性改进。', type: 'warn' });
    } else if (reviewRate > 2) {
      suggestions.push({ icon: '✍️', title: '差评率需关注（' + reviewRate.toFixed(2) + '%）', desc: '差评率在 2%~5% 之间，建议增加发货前质检、优化尺码表、及时处理客户咨询。', type: 'neutral' });
    } else if (reviewRate > 0) {
      suggestions.push({ icon: '🌟', title: '差评率控制良好（' + reviewRate.toFixed(2) + '%）', desc: '继续保持产品品质与服务体验，积极邀评提升好评数量。', type: 'good' });
    }

    // 6.5 差评趋势变化（基于环比）
    if (Math.abs(reviewTrend) > 0.5) {
      if (reviewTrend > 0.5) {
        suggestions.push({ icon: '📈', title: '差评率环比上升 ' + reviewTrend.toFixed(2) + '%', desc: '近期差评率有恶化趋势，建议逐日分析近 7 天的差评内容，定位是某个款式出问题还是整体品控下降。', type: 'warn' });
      } else {
        suggestions.push({ icon: '📉', title: '差评率环比下降 ' + Math.abs(reviewTrend).toFixed(2) + '%', desc: '近期差评率明显改善，建议保持当前的产品/服务标准，可作为最佳实践推广到其他店铺。', type: 'good' });
      }
    }

    // 6.6 差评率高峰日（不是条数）
    if (reviewPeak && (reviewPeak.negative_rate != null ? reviewPeak.negative_rate : 0) > 0) {
      var peakRate = reviewPeak.negative_rate || 0;
      suggestions.push({ icon: '🔍', title: '差评率高峰日：' + (reviewPeak.date || '某天') + '（' + peakRate.toFixed(2) + '%）', desc: '该日差评率最高（' + peakRate.toFixed(2) + '%），建议逐条查看该日的评价内容，识别是产品质量、尺码偏差还是物流问题，并采取针对性改进。', type: 'warn' });
    }

    // 6.7 累计差评记录数（不是条数）
    if (reviewTotal >= 5) {
      var recentCount = reviewRecent.reduce(function(s, r) { return s + (r.negative_reviews || 0); }, 0);
      var recentRate = reviewRecent.length > 0 ? reviewRecent.reduce(function(s, r) {
        return s + (r.negative_rate != null ? r.negative_rate : 0);
      }, 0) / reviewRecent.length : 0;
      suggestions.push({ icon: '📝', title: '已录入 ' + reviewTotal + ' 条差评记录（近 3 条平均差评率 ' + recentRate.toFixed(2) + '%）', desc: '建议按问题分类汇总：①质量 ②尺码 ③物流 ④客服态度，找出占比最高的 TOP 1 类别作为下月改进重点。', type: 'neutral' });
    }

    // 7. 通用增长建议
    suggestions.push({ icon: '🚀', title: '提升销量的通用动作', desc: '1) 保持每日上新或优化老链接；2) 针对高转化时段加大广告；3) 维护老客户，设置复购优惠券；4) 监控竞品价格与活动，及时调整。', type: 'neutral' });

    // 8. 跨境平台优化方案（根据当前数据情况触发不同类别）
    var totalSales2 = 0;
    try {
      if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
        totalSales2 = (CBOrderDB.getAll(shopId) || []).filter(function(o) { return (o.sale_amount || 0) > 0; }).length;
      }
    } catch(e) {}

    // 8.1 上架产品不足检测（订单少时重点提示）
    if (totalSales2 < 10) {
      suggestions.push({ icon: '🏪', title: '⚠️ 上架产品可能不足（仅 ' + totalSales2 + ' 单成交）', desc: '订单量极低时，优先排查「上架产品数量是否够多」。跨境平台的推荐算法依赖产品基数，建议：①检查当前在线产品数是否达类目平均 ②每周保持 10-20 款上新频率 ③下架效果差的链接，释放店铺权重给新产品。', type: 'warn' });
      // 同时给出上架类建议
      suggestions.push({ icon: '📸', title: '图片与上架优化', desc: '①A/B 图测试：每款上架前做 2-3 版主图 A/B 测试，选点击率最高的主图投放 ②制作产品视频：15-30 秒展示使用场景和细节，点击率平均提升 40% ③优化标题：嵌入热词 + 属性词 + 场景词，参考平台搜索下拉词与竞品标题结构', type: 'neutral' });
      suggestions.push({ icon: '🎨', title: '款多量足策略', desc: '①同款不同场景上架（同一款式在不同场景/背景拍摄，分多个链接发布）②同场景不同款式上架（同一拍摄背景下换款式拍摄，用同一套风格串联店铺）③做新图全新上架（完全脱离旧图，重新拍摄做链接）④做新图复色放在爆款下面（爆款链接下补充配色变体图，拉长停留时间）', type: 'neutral' });
      suggestions.push({ icon: '🆕', title: '持续上新计划', desc: '①开新款：每周至少开发 3-5 款新样式，保持店铺活性 ②处理产品驳回：被驳回时按平台反馈原因（版权/图片/描述等）逐条修改后重新提交 ③补全复色：已有爆款的各种颜色变体补全，最大化 SKU 曝光', type: 'neutral' });
    } else {
      // 有成交量时细化建议
      suggestions.push({ icon: '📸', title: '图片与转化优化', desc: '①A/B 图测试：已上架的爆款定期做主图跟换测试，测点击率变化 ②产品视频：核心爆款至少配一个视频（展示场景/使用/对比）③优化标题：定期替换排名下滑链接的标题，跟住最新搜索趋势', type: 'neutral' });
      if (refundRate > 5 || reviewRate > 3) {
        suggestions.push({ icon: '🎨', title: '产品与评价优化', desc: '①同款不同场景上架：高退货率的款式换场景重拍后重新上架 ②做新图全新上架：差评集中反映「与图不符」的产品彻底换图后重新上架 ③补全复色：为低差评率的爆款补充更多颜色变体，分散差评集中风险', type: 'neutral' });
      } else {
        suggestions.push({ icon: '🎨', title: '扩展产品矩阵', desc: '①同款不同场景上架 + 同场景不同款式上架 = 统一风格打造店铺品牌感 ②做新图复色放在爆款下面：用新品图在爆款底部做关联导流 ③开新款 + 补全复色：不断扩大 SKU 覆盖的搜索关键词', type: 'neutral' });
      }
      suggestions.push({ icon: '🔄', title: '库存与价格管理', desc: '①本季节降价清货上一个季节的产品：换季产品以快 30% 的速度降价清仓，释放库存空间 ②产品驳回的处理：被驳回后 24 小时内修改并重新提交，避免链接下沉 ③跨平台优化：参考 Amazon/SHEIN/Temu 各平台的搜索规则变化调整标题和关键词', type: 'neutral' });
    }

    // 8.2 季节性清货建议
    var month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) {
      suggestions.push({ icon: '🧹', title: '春季清货建议', desc: '目前是春季末尾/夏季开头，建议：①冬款产品逐步降价清仓（每周降价 10-15%）②春装爆款加大广告追加最后一波流量 ③提前准备夏季新款上架节奏', type: 'neutral' });
    } else if (month >= 6 && month <= 8) {
      suggestions.push({ icon: '🧹', title: '夏季清货建议', desc: '目前是夏季末尾/秋季开头，建议：①春季爆款尾货清理 ②夏季产品开始做清仓促销 ③准备秋季新款图拍摄和上架', type: 'neutral' });
    } else if (month >= 9 && month <= 11) {
      suggestions.push({ icon: '🧹', title: '秋季清货建议', desc: '目前是秋季末尾/冬季开头，建议：①夏季库存 7 折清仓 ②秋装主推 ③冬款提前备货和上架', type: 'neutral' });
    } else {
      suggestions.push({ icon: '🧹', title: '冬季清货建议', desc: '目前是冬季，建议：①秋款库存快速清仓 ②冬装主打款保持更新 ③为春节后春款做拍照和上架计划', type: 'neutral' });
    }

    // 8.3 跨境平台综合优化（无论是否数据差都通用）
    suggestions.push({ icon: '🌍', title: '跨境平台综合优化方案', desc: '①SHEIN：利用平台竞价广告获取精准流量，关注「爆款潜力分」与「新品孵化扶持」②Amazon：优化 Listing 的搜索关键词覆盖，参加 Vine 计划获取首批评价 ③Temu：关注前台价和核价，多发新款抢占全托管流量 ④TikTok Shop：配合达人短视频和直播带货选品 ⑤Shopee/Lazada：关注站点大促节点，提前提报活动', type: 'neutral' });

    // 渲染
    var html = '<div style="display:grid;gap:10px">';
    suggestions.forEach(function(s) {
      var bg = s.type === 'good' ? '#f6ffed' : (s.type === 'warn' ? '#fff2f0' : '#f6ffed');
      var border = s.type === 'good' ? '#b7eb8f' : (s.type === 'warn' ? '#ffccc7' : '#d9d9d9');
      var titleColor = s.type === 'good' ? '#389e0d' : (s.type === 'warn' ? '#cf1322' : '#595959');
      html += '<div style="background:' + bg + ';border-left:4px solid ' + border + ';border-radius:6px;padding:12px 14px">';
      html += '<div style="font-weight:600;color:' + titleColor + ';margin-bottom:6px;font-size:14px">' + s.icon + ' ' + _ov5_escape(s.title) + '</div>';
      html += '<div style="color:#595959;line-height:1.6">' + _ov5_escape(s.desc) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  function _ov5_renderCharts(shopId, dailyData, orders, sym) {
    _ov5_destroyCharts(shopId);
    if (!_ov5_charts[shopId]) _ov5_charts[shopId] = [];

    var colors = ['#1890ff','#52c41a','#fa8c16','#722ed1','#13c2c2','#ff4d4f','#faad14','#eb2f96','#2f54eb','#a0d911'];

    // 1. 趋势曲线图
    var trendCanvas = _ov5_id('ov-chart-trend-' + shopId);
    if (trendCanvas && window.Chart) {
      if (dailyData.length === 0) {
        // 清空画布并显示无数据提示
        trendCanvas.parentElement.innerHTML = '<div style="padding:80px 20px;text-align:center;color:#999;font-size:13px">📭 该时段无数据<br>请录入订单或导入每日数据</div>';
      } else {
        // 补齐 from~to 之间的空白日，让横轴显示完整窗口
        var dr3 = _ov5_getDateRange(shopId);
        var paddedData = _ov5_padEmptyDates(dailyData, dr3.from, dr3.to);
        var labels = paddedData.map(function(d) { return (d.date || '').substring(5); });
        var payAmt = paddedData.map(function(d) { return parseFloat(d.pay_amount) || 0; });
        var visitors = paddedData.map(function(d) { return parseInt(d.visitors) || 0; });
        var payers = paddedData.map(function(d) { return parseInt(d.payer_count) || 0; });
        var items = paddedData.map(function(d) { return parseInt(d.item_count) || 0; });

        var ctx = trendCanvas.getContext('2d');
        _ov5_charts[shopId].push(new window.Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              { label: '支付金额(' + sym + ')', data: payAmt, borderColor: colors[0], backgroundColor: colors[0] + '15', fill: true, tension: 0.3, yAxisID: 'y' },
              { label: '访客量', data: visitors, borderColor: colors[3], backgroundColor: 'transparent', borderDash: [5,5], tension: 0.3, yAxisID: 'y3' },
              { label: '支付人数', data: payers, borderColor: colors[1], backgroundColor: 'transparent', borderDash: [3,3], tension: 0.3, yAxisID: 'y2' },
              { label: '支付件数', data: items, borderColor: colors[2], backgroundColor: 'transparent', borderDash: [2,2], tension: 0.3, yAxisID: 'y1' }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } }
            },
            scales: {
              y: { type: 'linear', position: 'left', title: { display: true, text: '金额(' + sym + ')' } },
              y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '件数' } },
              y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
              y3: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
              x: { grid: { display: false } }
            }
          }
        }));
      }
    }

    // 2. SKU 金额占比饼图（TOP10）
    var pieCanvas = _ov5_id('ov-chart-pie-' + shopId);
    if (pieCanvas && window.Chart && orders.length > 0) {
      var skuAmount = {};
      orders.forEach(function(o) {
        var sku = o.sku || '未知';
        skuAmount[sku] = (skuAmount[sku] || 0) + (o.sale_amount || 0);
      });
      var topSkus = Object.keys(skuAmount)
        .map(function(sku) { return { sku: sku, amount: skuAmount[sku] }; })
        .sort(function(a, b) { return b.amount - a.amount; })
        .slice(0, 10);

      if (topSkus.length > 0) {
        var ctx2 = pieCanvas.getContext('2d');
        _ov5_charts[shopId].push(new window.Chart(ctx2, {
          type: 'doughnut',
          data: {
            labels: topSkus.map(function(x) { return x.sku; }),
            datasets: [{
              data: topSkus.map(function(x) { return x.amount; }),
              backgroundColor: colors,
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 10 } } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                    var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                    return ctx.label + ': ' + sym + Number(ctx.parsed).toFixed(2) + ' (' + pct + '%)';
                  }
                }
              }
            }
          }
        }));
      }
    }

    // 3. 每日订单量柱状图（按日期从订单数据聚合，并受当前周期过滤）
    var barCanvas = _ov5_id('ov-chart-bar-' + shopId);
    if (barCanvas && window.Chart && orders.length > 0) {
      var dr2 = _ov5_getDateRange(shopId);
      var fromDate2 = new Date(dr2.from + 'T00:00:00');
      var toDate2 = new Date(dr2.to + 'T23:59:59');
      var orderByDate = {};
      orders.forEach(function(o) {
        if (!o.date) return;
        var date = _ov5_normalizeDate(o.date);
        if (!date) return;
        var d = new Date(date + 'T00:00:00');
        if (d < fromDate2 || d > toDate2) return;
        orderByDate[date] = (orderByDate[date] || 0) + 1;
      });
      // 补齐空白日，让横轴显示完整窗口
      var paddedBar = _ov5_padEmptyDates(
        Object.keys(orderByDate).sort().map(function(d) { return { date: d, item_count: orderByDate[d] }; }),
        dr2.from, dr2.to
      );
      var sortedDates = paddedBar.map(function(d) { return d.date; });
      if (sortedDates.length > 0) {
        var ctx3 = barCanvas.getContext('2d');
        _ov5_charts[shopId].push(new window.Chart(ctx3, {
          type: 'bar',
          data: {
            labels: sortedDates.map(function(d) { return d.substring(5); }),
            datasets: [{
              label: '订单量',
              data: paddedBar.map(function(d) { return d.item_count || 0; }),
              backgroundColor: colors[0],
              borderRadius: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              y: { beginAtZero: true, ticks: { font: { size: 10 } } }
            }
          }
        }));
      }
    }

  }

  function _ov5_setText(id, val) {
    var el = _ov5_id(id);
    if (el) el.textContent = val;
  }

  // ===== 全局函数 =====
  window._ov5_forceLoad = function(shopId) {
    _ov5_ensureTab(shopId);
    _ov5_loadData(shopId);
  };

  // 锚点策略：以「最后有数据的那天」为锚（最新且完整的一天），与掉量分析模块 (drop-analysis-v1.js) 保持一致。
  // 这样未录数据的"未完工当天"会被自然排除。无任何数据时退回美国昨天。
  function _ov5_getLastDataDate(shopId) {
    var latest = '';
    try {
      if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) {
        (CrossBorderDailyDB.getAll(shopId) || []).forEach(function(d) {
          if (d && d.date) {
            var nd = _ov5_normalizeDate(d.date);
            if (nd && nd > latest) latest = nd;
          }
        });
      }
      if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
        (CBOrderDB.getAll(shopId) || []).forEach(function(o) {
          if (o && o.date) {
            var nd = _ov5_normalizeDate(o.date);
            if (nd && nd > latest) latest = nd;
          }
        });
      }
    } catch(e) {}
    return latest || null;
  }

  window._ov5_setPeriod = function(shopId, period) {
    var lastDate = _ov5_getLastDataDate(shopId);
    var anchor;
    if (lastDate) {
      anchor = new Date(lastDate + 'T00:00:00');
    } else {
      // 无数据时退回美国昨天
      anchor = new Date(_ov5_usNowDate().getTime() - 86400000);
    }

    var from, to, label;
    if (period === 'yesterday') {
      // 昨天 = 锚点前一天
      var prev = new Date(anchor.getTime() - 86400000);
      from = _ov5_fmtYMD(prev);
      to = from;
      label = '昨天';
    } else if (period === 'today') {
      // 今天 = 锚点本身（最新且完整的一天）
      from = _ov5_fmtYMD(anchor);
      to = from;
      label = '今天';
    } else if (period === 'all') {
      from = '1900-01-01';
      to = '2099-12-31';
      label = '全部';
    } else {
      var days = parseInt(period) || 7;
      // 近N天：结束于锚点（最后数据日），向前推 N-1 天
      to = anchor;
      from = new Date(to.getTime() - (days - 1) * 86400000);
      label = '近' + days + '天';
    }

    _ov5_dateRange[shopId] = { from: _ov5_fmtYMD(from), to: _ov5_fmtYMD(to), label: label, anchor: lastDate || _ov5_fmtYMD(anchor) };

    var lbl = _ov5_id('ov-date-range-' + shopId);
    if (lbl) lbl.textContent = _ov5_formatRangeLabel(_ov5_dateRange[shopId]);

    _ov5_loadData(shopId);
  };

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ov5_initWhenReady);
  } else {
    _ov5_initWhenReady();
  }

  // 暴露关键函数
  window._ov5_showOnlyTab = _ov5_showOnlyTab;
  window._ov5_ensureTab = _ov5_ensureTab;
  window._ov5_refreshOverview = function(shopId) {
    if (!shopId) return;
    _ov5_shopId = shopId;
    var existingContent = _ov5_id('cross-border-overview-' + shopId);
    if (existingContent) {
      var ovDiv = _ov5_id('cb-tab-overview-' + shopId);
      if (ovDiv && !ovDiv.querySelector('.ov6-section')) {
        ovDiv.innerHTML = '';
        ovDiv.appendChild(_ov5_buildOverviewContent(shopId));
      }
      _ov5_loadData(shopId);
      return;
    }
    _ov5_tabInjected[shopId] = true;
    _ov5_addButton(shopId, _ov5_id('shop-detail-' + shopId) || document);
    _ov5_loadData(shopId);
  };

  console.log('[OV6] Script loaded successfully ✓');
})();

/* Global aliases for backward compatibility */
window.showOnlyTab = function(shopId, activeTab) { return window._ov5_showOnlyTab(shopId, activeTab); };
window.ensureOverviewTab = function(shopId) { return window._ov5_ensureTab(shopId); };
console.log('[OV6-v6] Loaded ✓');
