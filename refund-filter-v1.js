/**
 * 退货退款 Tab 时间筛选 + 趋势图增强
 * 功能：在退货退款 Tab 顶部增加 1天/3天/7天/30天/全部 快速筛选，
 *       根据筛选周期重新渲染退货统计、原因分析、尺码偏差明细，并增加退款趋势图。
 */
(function() {
  'use strict';

  var SIZE_SMALL_KEYS = ['尺码偏小','尺码偏小退回','size too small','too small'];
  var SIZE_LARGE_KEYS = ['尺码偏大','尺码偏大退回','size too large','too large','too big'];

  function _id(s) { return document.getElementById(s); }
  function _normalizeDate(d) {
    if (!d) return '';
    var s = String(d).trim().replace(/[\sT].+$/, '').replace(/\//g, '-');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return '';
    return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  }
  function _todayStr() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  }
  function _dateOffset(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function _escape(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function getAllRefunds(shopId) {
    if (typeof CBRefundDB !== 'undefined' && CBRefundDB.getAll) {
      return CBRefundDB.getAll(shopId) || [];
    }
    try {
      return JSON.parse(localStorage.getItem('ec_cb_refunds_' + shopId) || '[]');
    } catch(e) { return []; }
  }

  function filterRefundsByDays(refunds, days) {
    if (days === 'all' || days === 0 || days === '') return refunds;
    var cutoff = _dateOffset(days);
    return refunds.filter(function(r) {
      var d = _normalizeDate(r.date);
      return d && d >= cutoff;
    });
  }

  function calcStats(refunds, shopId) {
    var totalAmt = 0, totalQty = 0, count = 0;
    var statusMap = { '已退款': 0, '处理中': 0, '已拒绝': 0 };
    refunds.forEach(function(r) {
      var amt = parseFloat(r.refund_amount || r.amount || 0);
      var qty = parseInt(r.qty) || 1;
      totalAmt += amt;
      totalQty += qty;
      count++;
      var st = r.status || '处理中';
      if (!statusMap[st]) statusMap[st] = 0;
      statusMap[st]++;
    });

    // 退款率：退款额 / 销售额（基于当前店铺全部订单）
    var totalSales = 0;
    try {
      if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
        var orders = CBOrderDB.getAll(shopId) || [];
        totalSales = orders.reduce(function(s, o) { return s + (o.sale_amount || 0); }, 0);
      }
    } catch(e) {}
    var refundRate = totalSales > 0 ? (totalAmt / totalSales * 100) : 0;

    return { totalAmt: totalAmt, totalQty: totalQty, count: count, statusMap: statusMap, refundRate: refundRate };
  }

  function renderReasonAnalysis(refunds) {
    if (!refunds.length) return '<div style="color:#64748b;text-align:center;padding:20px;font-size:13px">该时段无退货数据</div>';
    var reasonMap = {};
    refunds.forEach(function(r) {
      var reason = r.reason || '其他';
      reasonMap[reason] = (reasonMap[reason] || 0) + 1;
    });
    var total = refunds.length;
    var sorted = Object.entries(reasonMap).sort(function(a,b) { return b[1] - a[1]; });
    var html = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">';
    sorted.forEach(function(item) {
      var reason = item[0], cnt = item[1];
      var pct = total > 0 ? (cnt / total * 100).toFixed(0) : 0;
      html += '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:80px;font-size:12px;color:#94a3b8;flex-shrink:0">' + _escape(reason) + '</div>' +
        '<div style="flex:1;background:#1e293b;border-radius:4px;height:8px;overflow:hidden">' +
          '<div style="width:' + pct + '%;background:linear-gradient(90deg,#f87171,#fb923c);height:100%;border-radius:4px;transition:width .5s"></div>' +
        '</div>' +
        '<div style="width:50px;text-align:right;font-size:12px;color:#e2e8f0;font-weight:600">' + cnt + ' 次</div>' +
        '<div style="width:35px;text-align:right;font-size:11px;color:#64748b">' + pct + '%</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderSizeDeviation(refunds) {
    var sizeRefunds = refunds.filter(function(r) {
      var reason = (r.reason || '').toLowerCase();
      return SIZE_SMALL_KEYS.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; }) ||
             SIZE_LARGE_KEYS.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; });
    });
    if (sizeRefunds.length === 0) return '';

    var skuMap = {};
    sizeRefunds.forEach(function(r) {
      var sku = r.sku || '未知货号';
      if (!skuMap[sku]) skuMap[sku] = { small: 0, large: 0, totalAmt: 0 };
      var reason = (r.reason || '').toLowerCase();
      var qty = Number(r.qty) || 1;
      var amt = Number(r.refund_amount) || Number(r.amount) || 0;
      if (SIZE_SMALL_KEYS.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; })) skuMap[sku].small += qty;
      else if (SIZE_LARGE_KEYS.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; })) skuMap[sku].large += qty;
      skuMap[sku].totalAmt += amt;
    });

    var skuRows = Object.entries(skuMap).sort(function(a, b) {
      return (b[1].small + b[1].large) - (a[1].small + a[1].large);
    });
    var totalSmall = skuRows.reduce(function(s, item) { return s + item[1].small; }, 0);
    var totalLarge = skuRows.reduce(function(s, item) { return s + item[1].large; }, 0);
    var maxTotal = Math.max.apply(null, skuRows.map(function(item) { return item[1].small + item[1].large; }).concat([1]));

    var html = '<div class="card" style="margin-top:12px;background:#1e293b;border-radius:10px;padding:14px" id="rf-size-deviation">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">' +
        '<div class="card-title" style="margin:0;color:#e2e8f0;font-weight:600;font-size:14px">款式尺码偏差明细</div>' +
        '<div style="display:flex;gap:12px">' +
          '<span style="font-size:12px;background:#1e3a5f;color:#60a5fa;padding:3px 10px;border-radius:12px;font-weight:600">偏小合计：' + totalSmall + ' 件</span>' +
          '<span style="font-size:12px;background:#3b1f2b;color:#f87171;padding:3px 10px;border-radius:12px;font-weight:600">偏大合计：' + totalLarge + ' 件</span>' +
        '</div>' +
      '</div>' +
      '<div style="max-height:320px;overflow-y:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead>' +
            '<tr style="background:#0f172a;position:sticky;top:0;z-index:1">' +
              '<th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #334155">货号(SKU)</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#60a5fa;font-weight:600;border-bottom:1px solid #334155">偏小（件）</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#f87171;font-weight:600;border-bottom:1px solid #334155">偏大（件）</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155">合计</th>' +
              '<th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155;min-width:160px">占比分布</th>' +
              '<th style="padding:8px 12px;text-align:center;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155">尺码倾向</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>';

    skuRows.forEach(function(item, idx) {
      var sku = item[0], v = item[1];
      var total = v.small + v.large;
      var smallPct = total > 0 ? (v.small / total * 100).toFixed(0) : 0;
      var largePct = total > 0 ? (v.large / total * 100).toFixed(0) : 0;
      var barWidth = (total / maxTotal * 100).toFixed(0);
      var tendency = '-', tendencyColor = '#94a3b8';
      if (v.small > v.large * 1.5) { tendency = '明显偏小'; tendencyColor = '#60a5fa'; }
      else if (v.large > v.small * 1.5) { tendency = '明显偏大'; tendencyColor = '#f87171'; }
      else if (v.small > 0 && v.large > 0) { tendency = '两者相当'; tendencyColor = '#fbbf24'; }
      else if (v.small > 0) { tendency = '偏小'; tendencyColor = '#93c5fd'; }
      else if (v.large > 0) { tendency = '偏大'; tendencyColor = '#fca5a5'; }
      var rowBg = idx % 2 === 0 ? '#0f172a' : '#111827';
      html += '<tr style="background:' + rowBg + '">' +
        '<td style="padding:9px 12px;color:#e2e8f0;font-family:monospace;font-size:12px;font-weight:600">' + _escape(sku) + '</td>' +
        '<td style="padding:9px 12px;text-align:center">' + (v.small > 0 ? '<span style="background:#1e3a5f;color:#60a5fa;padding:2px 10px;border-radius:10px;font-weight:700;font-size:13px">' + v.small + '</span>' : '<span style="color:#334155;font-size:12px">-</span>') + '</td>' +
        '<td style="padding:9px 12px;text-align:center">' + (v.large > 0 ? '<span style="background:#3b1f2b;color:#f87171;padding:2px 10px;border-radius:10px;font-weight:700;font-size:13px">' + v.large + '</span>' : '<span style="color:#334155;font-size:12px">-</span>') + '</td>' +
        '<td style="padding:9px 12px;text-align:center;color:#94a3b8;font-weight:600">' + total + '</td>' +
        '<td style="padding:9px 12px">' +
          '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:#1e293b;width:' + barWidth + '%;min-width:20px;max-width:100%">' +
            (v.small > 0 ? '<div style="width:' + smallPct + '%;background:#3b82f6"></div>' : '') +
            (v.large > 0 ? '<div style="width:' + largePct + '%;background:#f87171"></div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:3px;font-size:10px;color:#64748b">' +
            (v.small > 0 ? '<span style="color:#60a5fa">↑小' + smallPct + '%</span>' : '') +
            (v.large > 0 ? '<span style="color:#f87171">↓大' + largePct + '%</span>' : '') +
          '</div>' +
        '</td>' +
        '<td style="padding:9px 12px;text-align:center"><span style="font-size:11px;color:' + tendencyColor + ';font-weight:600">' + tendency + '</span></td>' +
      '</tr>';
    });

    html += '</tbody>' +
      '<tfoot>' +
        '<tr style="background:#0f172a;border-top:2px solid #334155">' +
          '<td style="padding:9px 12px;color:#64748b;font-weight:600;font-size:12px">合计 (' + skuRows.length + ' 款)</td>' +
          '<td style="padding:9px 12px;text-align:center"><span style="color:#60a5fa;font-weight:700;font-size:13px">' + totalSmall + '</span></td>' +
          '<td style="padding:9px 12px;text-align:center"><span style="color:#f87171;font-weight:700;font-size:13px">' + totalLarge + '</span></td>' +
          '<td style="padding:9px 12px;text-align:center;color:#e2e8f0;font-weight:700">' + (totalSmall + totalLarge) + '</td>' +
          '<td colspan="2" style="padding:9px 12px;font-size:11px;color:#64748b">' +
            '偏小占 ' + (totalSmall + totalLarge > 0 ? (totalSmall / (totalSmall + totalLarge) * 100).toFixed(1) : 0) + '%' +
            '&nbsp;·&nbsp;' +
            '偏大占 ' + (totalSmall + totalLarge > 0 ? (totalLarge / (totalSmall + totalLarge) * 100).toFixed(1) : 0) + '%' +
          '</td>' +
        '</tr>' +
      '</tfoot>' +
    '</table></div>' +
    '<div style="margin-top:8px;font-size:11px;color:#475569;padding:0 4px">💡 数据来源：退货记录中原因含"尺码偏小"或"尺码偏大"的记录</div>' +
    '</div>';
    return html;
  }

  function renderTrendChart(refunds, shopId) {
    if (!refunds.length || typeof Chart === 'undefined') return '';

    var dateMap = {};
    refunds.forEach(function(r) {
      var d = _normalizeDate(r.date);
      if (!d) return;
      if (!dateMap[d]) dateMap[d] = { amt: 0, qty: 0, count: 0 };
      dateMap[d].amt += parseFloat(r.refund_amount || r.amount || 0);
      dateMap[d].qty += parseInt(r.qty) || 1;
      dateMap[d].count += 1;
    });
    var sortedDates = Object.keys(dateMap).sort();
    if (sortedDates.length < 2) return '';

    var chartId = 'rf-trend-chart-' + shopId;
    var html = '<div class="card" style="margin-top:12px;background:#1e293b;border-radius:10px;padding:14px">' +
      '<div class="card-title" style="color:#e2e8f0;font-weight:600;font-size:14px;margin-bottom:10px">📈 退款趋势</div>' +
      '<div style="position:relative;height:220px">' +
        '<canvas id="' + chartId + '"></canvas>' +
      '</div>' +
    '</div>';

    // 渲染后初始化图表
    setTimeout(function() {
      var canvas = _id(chartId);
      if (!canvas) return;
      var existing = canvas._rfChart;
      if (existing && typeof existing.destroy === 'function') existing.destroy();
      var ctx = canvas.getContext('2d');
      canvas._rfChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: sortedDates.map(function(d) { return d.substring(5); }),
          datasets: [
            { label: '退款金额($)', data: sortedDates.map(function(d) { return dateMap[d].amt; }), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
            { label: '退货件数', data: sortedDates.map(function(d) { return dateMap[d].qty; }), borderColor: '#fb923c', backgroundColor: 'transparent', borderDash: [4,4], tension: 0.3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, color: '#e2e8f0' } } },
          scales: {
            y: { type: 'linear', position: 'left', grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
            y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    }, 100);

    return html;
  }

  function renderTopCards(stats, currSymbol) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:16px">' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #f87171">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">退款总额</div>' +
        '<div style="font-size:16px;font-weight:700;color:#f87171">' + currSymbol + stats.totalAmt.toFixed(2) + '</div>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #fb923c">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">退货件数</div>' +
        '<div style="font-size:16px;font-weight:700;color:#fb923c">' + stats.totalQty + ' 件</div>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #fbbf24">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">退款率</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + (stats.refundRate <= 5 ? '#34d399' : stats.refundRate <= 15 ? '#fbbf24' : '#f87171') + '">' + stats.refundRate.toFixed(1) + '%</div>' +
        '<div style="font-size:10px;color:#475569;margin-top:2px">退款额/销售额</div>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #94a3b8">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">退单笔数</div>' +
        '<div style="font-size:16px;font-weight:700;color:#94a3b8">' + stats.count + ' 笔</div>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #34d399">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">已退款</div>' +
        '<div style="font-size:16px;font-weight:700;color:#34d399">' + (stats.statusMap['已退款'] || 0) + ' 笔</div>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:8px;padding:12px 14px;border-left:3px solid #a78bfa">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">处理中</div>' +
        '<div style="font-size:16px;font-weight:700;color:#a78bfa">' + (stats.statusMap['处理中'] || 0) + ' 笔</div>' +
      '</div>' +
    '</div>';
  }

  function getCurrencySymbol(shopId) {
    try {
      if (typeof DB !== 'undefined' && DB.getShops) {
        var s = DB.getShops().find(function(x) { return x.id === shopId; });
        if (s && typeof getPlatformCurrency === 'function' && getPlatformCurrency(s.platform || '') !== 'USD') return '¥';
      }
    } catch(e) {}
    return '$';
  }

  function refreshRefundAnalysis(shopId, days) {
    var tab = _id('cb-tab-refunds-' + shopId);
    if (!tab) return;

    var allRefunds = getAllRefunds(shopId);
    var filtered = filterRefundsByDays(allRefunds, days);
    var stats = calcStats(filtered, shopId);
    var currSymbol = getCurrencySymbol(shopId);

    var content = tab.querySelector('#rf-filtered-content-' + shopId);
    if (!content) {
      content = document.createElement('div');
      content.id = 'rf-filtered-content-' + shopId;
      tab.insertBefore(content, tab.children[1] || null);
    }

    content.innerHTML = renderTopCards(stats, currSymbol) +
      '<div class="card" style="margin-top:12px;background:#1e293b;border-radius:10px;padding:14px">' +
        '<div class="card-title" style="color:#e2e8f0;font-weight:600;font-size:14px;margin-bottom:10px">退货原因分析</div>' +
        renderReasonAnalysis(filtered) +
      '</div>' +
      renderSizeDeviation(filtered) +
      renderTrendChart(filtered, shopId);
  }

  function injectRefundFilter(tab) {
    var shopId = tab.id.replace('cb-tab-refunds-', '');
    if (tab.dataset.rfFilterInjected) return;
    tab.dataset.rfFilterInjected = '1';

    var existing = _id('rf-filter-bar-' + shopId);
    if (existing) return;

    var bar = document.createElement('div');
    bar.id = 'rf-filter-bar-' + shopId;
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;background:#0f172a;border-radius:8px;margin-bottom:12px';
    bar.innerHTML = '<span style="font-size:12px;color:#64748b">时间筛选：</span>' +
      '<button class="rf-filter-btn" data-days="1" style="padding:5px 12px;border-radius:14px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;cursor:pointer">1天</button>' +
      '<button class="rf-filter-btn" data-days="3" style="padding:5px 12px;border-radius:14px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;cursor:pointer">3天</button>' +
      '<button class="rf-filter-btn" data-days="7" style="padding:5px 12px;border-radius:14px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;cursor:pointer">7天</button>' +
      '<button class="rf-filter-btn" data-days="30" style="padding:5px 12px;border-radius:14px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;cursor:pointer">30天</button>' +
      '<button class="rf-filter-btn" data-days="all" style="padding:5px 12px;border-radius:14px;border:1px solid #1890ff;background:#1890ff;color:#fff;font-size:12px;cursor:pointer">全部</button>' +
      '<span id="rf-filter-label-' + shopId + '" style="font-size:12px;color:#94a3b8;margin-left:auto">当前：全部</span>';

    tab.insertBefore(bar, tab.firstChild);

    // 隐藏原始的统计卡片和原因分析/尺码偏差（因为我们用自己的）
    var hideOriginal = function() {
      var children = Array.from(tab.children);
      children.forEach(function(child) {
        if (child.id === 'rf-filter-bar-' + shopId || child.id === 'rf-filtered-content-' + shopId) return;
        // 如果子元素包含"退款总额"卡片或"退货原因分析"或"款式尺码偏差明细"，则隐藏
        if (child.textContent.indexOf('退款总额') >= 0 && child.textContent.indexOf('退货件数') >= 0) {
          child.style.display = 'none';
        }
        if (child.querySelector && (child.querySelector('.card-title'))) {
          var title = child.querySelector('.card-title');
          if (title && (title.textContent.indexOf('退货原因分析') >= 0 || title.textContent.indexOf('款式尺码偏差明细') >= 0)) {
            child.style.display = 'none';
          }
        }
      });
    };

    var btns = bar.querySelectorAll('.rf-filter-btn');
    btns.forEach(function(btn) {
      btn.onclick = function() {
        var days = btn.getAttribute('data-days');
        var daysNum = days === 'all' ? 'all' : parseInt(days);
        btns.forEach(function(b) {
          b.style.background = '#1e293b';
          b.style.color = '#e2e8f0';
          b.style.borderColor = '#334155';
        });
        btn.style.background = '#1890ff';
        btn.style.color = '#fff';
        btn.style.borderColor = '#1890ff';
        var label = _id('rf-filter-label-' + shopId);
        if (label) label.textContent = '当前：' + (days === 'all' ? '全部' : '近' + days + '天');
        refreshRefundAnalysis(shopId, daysNum);
      };
    });

    refreshRefundAnalysis(shopId, 'all');
    hideOriginal();
  }

  function scanRefundTabs() {
    document.querySelectorAll('[id^="cb-tab-refunds-"]').forEach(function(tab) {
      injectRefundFilter(tab);
    });
  }

  function init() {
    if (typeof CBRefundDB === 'undefined') {
      setTimeout(init, 300);
      return;
    }
    scanRefundTabs();
    var observer = new MutationObserver(function() {
      scanRefundTabs();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
