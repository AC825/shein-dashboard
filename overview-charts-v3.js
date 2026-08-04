/**
 * 全局总览图表版 v2
 * 支持店铺多选：统计选中店铺的综合数据
 * 依赖：Chart.js、app-v3-v3.js 中的 DB/getVisibleShops/CrossBorderDailyDB/CBOrderDB
 * 加载顺序：必须在 app-v3-v3.js 之后
 */
(function() {
  'use strict';

  var _chartInstances = {};

  function destroyAllCharts() {
    Object.keys(_chartInstances).forEach(function(key) {
      if (_chartInstances[key]) {
        try { _chartInstances[key].destroy(); } catch(e) {}
        _chartInstances[key] = null;
      }
    });
    _chartInstances = {};
  }

  // ===== 工具函数 =====
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtCurrency(n, currency) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    var symbol = currency === 'CNY' ? '¥' : '$';
    return symbol + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function getDaysAgo(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // 美国时区「现在」（统一口径：跨境日期以 America/New_York 为准）
  function usNowDate() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var o = {};
      parts.forEach(function(p) { o[p.type] = p.value; });
      return new Date(o.year + '-' + o.month + '-' + o.day + 'T00:00:00');
    } catch(e) { return new Date(); }
  }
  function normDateStr(s) {
    if (!s) return '';
    var m = String(s).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  }
  // 锚点策略（与掉量分析 / 店铺总览一致）：取所选店铺中「最后有数据的那天」；无数据时退回美国昨天
  function getLastDataDate(shopIds) {
    var latest = '';
    (shopIds || []).forEach(function(sid) {
      try {
        if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) {
          (CrossBorderDailyDB.getAll(sid) || []).forEach(function(d) {
            var nd = normDateStr(d && d.date);
            if (nd && nd > latest) latest = nd;
          });
        }
        if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
          (CBOrderDB.getAll(sid) || []).forEach(function(o) {
            var nd = normDateStr(o && o.date);
            if (nd && nd > latest) latest = nd;
          });
        }
      } catch(e) {}
    });
    return latest || null;
  }
  function getRangeDates(days, anchorStr) {
    // 锚点 = 最后数据日（最新且完整的一天）；无则美国昨天
    var anchor = anchorStr ? new Date(anchorStr + 'T00:00:00') : new Date(usNowDate().getTime() - 86400000);
    var from, to;
    if (days === 0) { // 今天 = 锚点本身
      from = anchor; to = anchor;
    } else if (days === -1) { // 昨天 = 锚点前一天
      from = new Date(anchor.getTime() - 86400000);
      to = from;
    } else {
      to = anchor;
      from = new Date(to.getTime() - (days - 1) * 86400000);
    }
    return {
      from: from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-' + pad(from.getDate()),
      to: to.getFullYear() + '-' + pad(to.getMonth() + 1) + '-' + pad(to.getDate()),
      label: days === -1 ? '昨天' : days === 0 ? '今天' : '近' + days + '天'
    };
  }

  // ===== 合并某店铺每日数据+订单数据（复用 ov6 思路） =====
  function mergeShopDailyData(shopId, from, to) {
    var daily = [], orders = [];
    if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) {
      daily = CrossBorderDailyDB.getAll(shopId) || [];
    }
    if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
      orders = CBOrderDB.getAll(shopId).filter(function(o) { return (o.sale_amount || 0) > 0; }) || [];
    }

    // 注意：每日运营数据实际存储字段为 visitors / buyers / qty / amount
    // （录入表单 saveCBDaily 写入的是 buyers，不是 payer_count），故需做兼容映射
    var map = {};
    daily.forEach(function(d) {
      if (!d.date || d.date < from || d.date > to) return;
      map[d.date] = {
        date: d.date,
        visitors: parseInt(d.visitors) || 0,
        payer_count: parseInt(d.payer_count || d.buyers || d.payment_buyers) || 0,
        item_count: parseInt(d.item_count || d.qty) || 0,
        pay_amount: parseFloat(d.pay_amount || d.amount) || 0,
        _hasDaily: true
      };
    });
    orders.forEach(function(o) {
      if (!o.date || o.date < from || o.date > to) return;
      if (!map[o.date]) {
        map[o.date] = { date: o.date, visitors: 0, payer_count: 0, item_count: 0, pay_amount: 0, _hasDaily: false };
      }
      if (map[o.date]._hasDaily) return; // 有每日数据时以每日数据为准，避免重复叠加
      map[o.date].pay_amount += parseFloat(o.sale_amount) || 0;
      map[o.date].item_count += 1;
      if (map[o.date].payer_count === 0) map[o.date].payer_count = 1;
    });

    var result = [];
    Object.keys(map).forEach(function(d) { result.push(map[d]); });
    return result.sort(function(a, b) { return a.date.localeCompare(b.date); });
  }

  // 单维度趋势小图：每个指标独立坐标轴，避免量级悬殊互相压平
  function _drawTrend(canvasId, label, dataArr, color, dates) {
    var ctx = document.getElementById(canvasId);
    if (!ctx || !dates.length) return;
    _chartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates.map(function(d) { return d.slice(5); }),
        datasets: [{
          label: label, data: dataArr, borderColor: color,
          backgroundColor: color + '22', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 6, font: { size: 11 } } },
          title: { display: true, text: label, font: { size: 12, weight: '600' }, padding: { bottom: 4 } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 10 } },
          y: { beginAtZero: true, ticks: { font: { size: 9 } } }
        }
      }
    });
  }

  // ===== 主渲染函数 =====
  window.renderOverview = function() {
    var container = document.getElementById('page-overview');
    if (!container) return;
    destroyAllCharts();

    var allShops = [];
    if (typeof getVisibleShops === 'function') {
      allShops = getVisibleShops() || [];
    } else if (typeof DB !== 'undefined' && DB.getShops) {
      allShops = DB.getShops() || [];
    }
    var defaultDays = 30;
    var savedSelection = JSON.parse(localStorage.getItem('ov2_selected_shops') || '[]');

    container.innerHTML =
      '<div class="page-header" style="margin-bottom:20px">' +
        '<h2 style="margin:0;font-size:18px;font-weight:600">📊 全局数据总览</h2>' +
        '<p style="margin:6px 0 0;color:#64748b;font-size:13px">选中店铺的综合数据分析 · 曲线/饼图/柱状图</p>' +
      '</div>' +
      // 店铺选择器
      '<div class="ov2-section" style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;margin-bottom:16px">' +
        '<div style="font-size:13px;font-weight:600;color:#333;margin-bottom:10px">🏪 选择要统计的店铺</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px" id="ov2-shop-selector">' +
          (allShops.length === 0 ? '<span style="color:#999;font-size:13px">暂无可见店铺</span>' : '') +
        '</div>' +
        '<div style="margin-top:10px;display:flex;gap:8px">' +
          '<button class="ov2-btn" id="ov2-select-all">全选</button>' +
          '<button class="ov2-btn" id="ov2-clear-all">清空</button>' +
        '</div>' +
      '</div>' +
      // 周期选择器
      '<div class="ov2-section" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="font-size:13px;color:#64748b;font-weight:500">分析周期：</span>' +
          '<button class="ov2-qbtn" data-days="-1">昨天</button>' +
          '<button class="ov2-qbtn" data-days="0">今天</button>' +
          '<button class="ov2-qbtn" data-days="7">7天</button>' +
          '<button class="ov2-qbtn ov2-active" data-days="14">14天</button>' +
          '<button class="ov2-qbtn" data-days="30">30天</button>' +
          '<button class="ov2-qbtn" data-days="60">60天</button>' +
          '<button class="ov2-qbtn" data-days="90">90天</button>' +
        '</div>' +
        '<span style="font-size:12px;color:#94a3b8" id="ov2-stats-period">数据范围：近 14 天</span>' +
      '</div>' +
      // 汇总指标卡
      '<div class="ov2-cards-row" id="ov2-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px"></div>' +
      // 图表区
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div class="ov2-section" style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px">' +
          '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">📈 综合趋势（按维度分开展示）</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div style="position:relative;height:190px"><canvas id="ov2-chart-pay"></canvas></div>' +
            '<div style="position:relative;height:190px"><canvas id="ov2-chart-visitors"></canvas></div>' +
            '<div style="position:relative;height:190px"><canvas id="ov2-chart-payers"></canvas></div>' +
            '<div style="position:relative;height:190px"><canvas id="ov2-chart-items"></canvas></div>' +
          '</div>' +
        '</div>' +
        '<div class="ov2-section" style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px">' +
          '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">🥧 支付金额占比</div>' +
          '<div style="position:relative;height:320px"><canvas id="ov2-chart-pie"></canvas></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div class="ov2-section" style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px">' +
          '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">📊 店铺对比柱状图</div>' +
          '<div style="position:relative;height:320px"><canvas id="ov2-chart-bar"></canvas></div>' +
        '</div>' +
        '<div class="ov2-section" style="background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;overflow:auto;max-height:354px">' +
          '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">📋 汇总明细</div>' +
          '<div id="ov2-detail-table-wrap"></div>' +
        '</div>' +
      '</div>' +
      '<div id="ov2-loading" style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">⏳ 正在加载数据...</div>';

    // 样式补充
    var style = document.createElement('style');
    style.textContent = '.ov2-qbtn{padding:5px 14px;border:1px solid #d9d9d9;border-radius:14px;background:#fff;color:#333;font-size:12px;cursor:pointer}.ov2-qbtn.ov2-active{background:#1890ff;color:#fff;border-color:#1890ff}.ov2-btn{padding:5px 12px;border:1px solid #d9d9d9;border-radius:4px;background:#f5f5f5;color:#333;font-size:12px;cursor:pointer}.ov2-shop-tag{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #e8e8e8;border-radius:6px;background:#fff;font-size:12px;cursor:pointer}.ov2-shop-tag input{margin:0}.ov2-shop-tag.ov2-checked{border-color:#1890ff;background:#e6f7ff;color:#1890ff}.ov2-card{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:14px;border-top:3px solid #1890ff}.ov2-card__label{font-size:12px;color:#888;margin-bottom:6px}.ov2-card__value{font-size:20px;font-weight:700;color:#333}';
    document.head.appendChild(style);

    // 绑定店铺选择器
    var shopSel = container.querySelector('#ov2-shop-selector');
    allShops.forEach(function(shop) {
      var tag = document.createElement('label');
      tag.className = 'ov2-shop-tag';
      var checked = savedSelection.length === 0 || savedSelection.indexOf(shop.id) >= 0;
      if (checked) tag.classList.add('ov2-checked');
      tag.innerHTML = '<input type="checkbox" ' + (checked ? 'checked' : '') + ' data-id="' + shop.id + '" style="cursor:pointer">' +
        '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (shop.color || '#1890ff') + '"></span>' +
        '<span>' + shop.name + '</span>';
      tag.querySelector('input').addEventListener('change', function() {
        tag.classList.toggle('ov2-checked', this.checked);
        saveSelection();
        renderCharts(getCurrentDays());
      });
      shopSel.appendChild(tag);
    });

    container.querySelector('#ov2-select-all').addEventListener('click', function() {
      shopSel.querySelectorAll('input').forEach(function(cb) { cb.checked = true; cb.parentNode.classList.add('ov2-checked'); });
      saveSelection();
      renderCharts(getCurrentDays());
    });
    container.querySelector('#ov2-clear-all').addEventListener('click', function() {
      shopSel.querySelectorAll('input').forEach(function(cb) { cb.checked = false; cb.parentNode.classList.remove('ov2-checked'); });
      saveSelection();
      renderCharts(getCurrentDays());
    });

    function saveSelection() {
      var selected = [];
      shopSel.querySelectorAll('input:checked').forEach(function(cb) { selected.push(cb.getAttribute('data-id')); });
      try { localStorage.setItem('ov2_selected_shops', JSON.stringify(selected)); } catch(e) {}
    }

    function getSelectedShopIds() {
      var ids = [];
      shopSel.querySelectorAll('input:checked').forEach(function(cb) { ids.push(cb.getAttribute('data-id')); });
      return ids;
    }

    function getCurrentDays() {
      var active = container.querySelector('.ov2-qbtn.ov2-active');
      return active ? parseInt(active.getAttribute('data-days')) : 14;
    }

    // 绑定周期按钮
    var qbtns = container.querySelectorAll('.ov2-qbtn');
    qbtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        qbtns.forEach(function(b) { b.classList.remove('ov2-active'); });
        this.classList.add('ov2-active');
        var days = parseInt(this.getAttribute('data-days'));
        var label = days === -1 ? '昨天' : days === 0 ? '今天' : '近 ' + days + ' 天';
        container.querySelector('#ov2-stats-period').textContent = '数据范围：' + label;
        renderCharts(days);
      });
    });

    // 首次渲染
    setTimeout(function() { renderCharts(getCurrentDays()); }, 50);

    function renderCharts(days) {
      var loadingEl = container.querySelector('#ov2-loading');
      loadingEl.style.display = 'block';
      setTimeout(function() {
        try {
          _renderChartContent(days, getSelectedShopIds(), allShops);
          loadingEl.style.display = 'none';
        } catch(e) {
          loadingEl.textContent = '❌ 加载失败：' + (e.message || '未知错误');
          console.error('Overview v2 error:', e);
        }
      }, 50);
    }
  };

  // ===== 核心渲染 =====
  function _renderChartContent(days, selectedIds, allShops) {
    destroyAllCharts();
    var selectedShops = allShops.filter(function(s) { return selectedIds.indexOf(s.id) >= 0; });
    var container = document.getElementById('page-overview');

    if (selectedShops.length === 0) {
      container.querySelector('#ov2-summary-cards').innerHTML =
        '<div class="ov2-card"><div class="ov2-card__label">提示</div><div class="ov2-card__value" style="font-size:14px;color:#999">请至少选择一个店铺</div></div>';
      return;
    }

    var range = getRangeDates(days, getLastDataDate(selectedIds));
    // 在周期标签上显示实际日期范围，让统计口径一目了然
    try {
      var periodEl = container.querySelector('#ov2-stats-period');
      if (periodEl) periodEl.textContent = '数据范围：' + range.label + '（' + range.from.substring(5) + '~' + range.to.substring(5) + '）';
    } catch(e) {}
    var colors = ['#1890ff','#52c41a','#fa8c16','#722ed1','#13c2c2','#ff4d4f','#faad14','#eb2f96','#2f54eb','#a0d911'];

    // 1. 收集每个店铺的合并数据
    var shopSeries = {};
    var allDatesSet = {};
    var totals = { visitors: 0, payer_count: 0, item_count: 0, pay_amount: 0, order_count: 0 };
    var shopTotals = [];

    selectedShops.forEach(function(shop, idx) {
      var data = mergeShopDailyData(shop.id, range.from, range.to);
      shopSeries[shop.id] = { shop: shop, data: data };

      var shopTotal = { shopId: shop.id, name: shop.name, color: shop.color || colors[idx % colors.length], visitors: 0, payer_count: 0, item_count: 0, pay_amount: 0, order_count: 0 };
      data.forEach(function(d) {
        allDatesSet[d.date] = true;
        shopTotal.visitors += d.visitors;
        shopTotal.payer_count += d.payer_count;
        shopTotal.item_count += d.item_count;
        shopTotal.pay_amount += d.pay_amount;
        shopTotal.order_count += d.item_count; // 每个订单 item_count 作为订单数
        totals.visitors += d.visitors;
        totals.payer_count += d.payer_count;
        totals.item_count += d.item_count;
        totals.pay_amount += d.pay_amount;
        totals.order_count += d.item_count;
      });
      shopTotals.push(shopTotal);
    });

    var sortedDates = Object.keys(allDatesSet).sort();

    // 2. 汇总指标卡
    var cardsHtml = '';
    var metrics = [
      { label: '选中店铺', value: selectedShops.length + ' 家', color: '#1890ff' },
      { label: '总访客', value: fmtNum(totals.visitors), color: '#52c41a' },
      { label: '总支付人数', value: fmtNum(totals.payer_count), color: '#722ed1' },
      { label: '总订单量', value: fmtNum(totals.order_count), color: '#fa8c16' },
      { label: '总支付金额', value: fmtCurrency(totals.pay_amount, 'USD'), color: '#ff4d4f' }
    ];
    metrics.forEach(function(m) {
      cardsHtml +=
        '<div class="ov2-card" style="border-top-color:' + m.color + '">' +
          '<div class="ov2-card__label">' + m.label + '</div>' +
          '<div class="ov2-card__value" style="color:' + m.color + '">' + m.value + '</div>' +
        '</div>';
    });
    container.querySelector('#ov2-summary-cards').innerHTML = cardsHtml;

    // 3. 综合趋势：每个维度独立小图（独立坐标轴，避免量级悬殊互相压平）
    var aggVisitors = sortedDates.map(function(d) {
      var sum = 0;
      selectedShops.forEach(function(s) { (shopSeries[s.id].data || []).forEach(function(r) { if (r.date === d) sum += r.visitors; }); });
      return sum;
    });
    var aggPayers = sortedDates.map(function(d) {
      var sum = 0;
      selectedShops.forEach(function(s) { (shopSeries[s.id].data || []).forEach(function(r) { if (r.date === d) sum += r.payer_count; }); });
      return sum;
    });
    var aggItems = sortedDates.map(function(d) {
      var sum = 0;
      selectedShops.forEach(function(s) { (shopSeries[s.id].data || []).forEach(function(r) { if (r.date === d) sum += r.item_count; }); });
      return sum;
    });
    var aggPay = sortedDates.map(function(d) {
      var sum = 0;
      selectedShops.forEach(function(s) { (shopSeries[s.id].data || []).forEach(function(r) { if (r.date === d) sum += r.pay_amount; }); });
      return sum;
    });

    _drawTrend('ov2-chart-pay', '支付金额($)', aggPay, '#ff4d4f', sortedDates);
    _drawTrend('ov2-chart-visitors', '访客量', aggVisitors, '#1890ff', sortedDates);
    _drawTrend('ov2-chart-payers', '支付人数', aggPayers, '#52c41a', sortedDates);
    _drawTrend('ov2-chart-items', '订单量(件)', aggItems, '#fa8c16', sortedDates);

    // 4. 饼图：各店铺支付金额占比
    var pieCtx = document.getElementById('ov2-chart-pie');
    if (pieCtx) {
      var pieData = shopTotals.filter(function(s) { return s.pay_amount > 0; });
      if (pieData.length > 0) {
        _chartInstances.pie = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: pieData.map(function(s) { return s.name; }),
            datasets: [{
              data: pieData.map(function(s) { return s.pay_amount; }),
              backgroundColor: pieData.map(function(s, i) { return s.color || colors[i % colors.length]; }),
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                    var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                    return ctx.label + ': $' + Number(ctx.parsed).toFixed(2) + ' (' + pct + '%)';
                  }
                }
              }
            }
          }
        });
      }
    }

    // 5. 柱状图：店铺对比（访客量 / 支付金额 分轴，避免量级悬殊）
    var barCtx = document.getElementById('ov2-chart-bar');
    if (barCtx) {
      _chartInstances.bar = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: shopTotals.map(function(s) { return s.name.length > 8 ? s.name.slice(0, 8) + '...' : s.name; }),
          datasets: [
            { label: '访客量', data: shopTotals.map(function(s) { return s.visitors; }), backgroundColor: colors[0] + 'cc', borderRadius: 4, yAxisID: 'y' },
            { label: '支付金额($)', data: shopTotals.map(function(s) { return s.pay_amount; }), backgroundColor: colors[1] + 'cc', borderRadius: 4, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { beginAtZero: true, position: 'left', title: { display: true, text: '访客量' }, ticks: { font: { size: 10 } } },
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '金额($)' }, ticks: { font: { size: 10 }, callback: function(v) { return '$' + v; } } }
          }
        }
      });
    }

    // 6. 明细表
    var tableWrap = container.querySelector('#ov2-detail-table-wrap');
    if (tableWrap) {
      var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
          '<th style="padding:8px 10px;text-align:left;font-weight:600">店铺</th>' +
          '<th style="padding:8px 10px;text-align:right;font-weight:600">访客</th>' +
          '<th style="padding:8px 10px;text-align:right;font-weight:600">支付人数</th>' +
          '<th style="padding:8px 10px;text-align:right;font-weight:600">订单量</th>' +
          '<th style="padding:8px 10px;text-align:right;font-weight:600">支付金额</th>' +
        '</tr></thead><tbody>';
      shopTotals.forEach(function(s) {
        html += '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:8px 10px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + s.color + ';margin-right:6px"></span>' + s.name + '</td>' +
          '<td style="padding:8px 10px;text-align:right">' + fmtNum(s.visitors) + '</td>' +
          '<td style="padding:8px 10px;text-align:right">' + fmtNum(s.payer_count) + '</td>' +
          '<td style="padding:8px 10px;text-align:right">' + fmtNum(s.order_count) + '</td>' +
          '<td style="padding:8px 10px;text-align:right;font-weight:600;color:#fa8c16">' + fmtCurrency(s.pay_amount, 'USD') + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      tableWrap.innerHTML = html;
    }
  }

  // 监听 #page-overview 是否被激活（兼容 navigate 被其他脚本覆盖的情况）
  function observeOverviewActivation() {
    var page = document.getElementById('page-overview');
    if (!page) return;
    function tryRender() {
      if (page.classList && page.classList.contains('active')) {
        try { renderOverview(); } catch(e) { console.error('[ov2] renderOverview error:', e); }
      }
    }
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          if (m.type === 'attributes' && m.attributeName === 'class') tryRender();
        });
      }).observe(page, { attributes: true, attributeFilter: ['class'] });
    }
    // 兜底：页面加载完成后再尝试一次
    if (document.readyState === 'complete') tryRender();
    else window.addEventListener('load', tryRender);
    // 立即尝试一次（如果已经 active）
    tryRender();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeOverviewActivation);
  } else {
    observeOverviewActivation();
  }

})();
