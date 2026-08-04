/**
 * 店铺优化建议模块 v2（2026-07-22 店铺内嵌 Tab 模式）
 *
 * 用途：作为每个跨境店铺详情页内"总览"Tab 之后的"店铺优化"Tab 内容。
 * 之前是左侧独立菜单项，V128 改造为店铺内嵌（用户要求："总览后面的就是店铺的优化方案"）。
 *
 * 调用方式：
 *   - 店铺详情页模板里包含 <div id="cb-tab-optimize-${shopId}"></div> 容器
 *   - 切到 optimize Tab 时调用 window.renderOptimizeTab(shopId)
 *
 * 数据源：cb_daily / cb_reviews / cb_refunds / cb_orders
 */
(function() {
  'use strict';

  // ============= 工具 =============
  function _id(s) { return document.getElementById(s); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _today() { return new Date().toISOString().slice(0, 10); }
  function addDays(date, days) {
    var d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function getPastDate(days) { return addDays(_today(), -days); }

  // ============= 数据层（多源兜底） =============
  function getReviews(shopId) {
    try { if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) return CBReviewDB.getAll(shopId) || []; } catch(e) {}
    try { var raw = localStorage.getItem('cb_reviews_' + shopId); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }
  function getDailies(shopId) {
    try { if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) return CrossBorderDailyDB.getAll(shopId) || []; } catch(e) {}
    try { var raw = localStorage.getItem('cb_daily_' + shopId); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }
  function getRefunds(shopId) {
    try { if (typeof CBRefundDB !== 'undefined' && CBRefundDB.getAll) return CBRefundDB.getAll(shopId) || []; } catch(e) {}
    try { var raw = localStorage.getItem('cb_refunds_' + shopId); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }
  function getOrders(shopId) {
    try { if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) return CBOrderDB.getAll(shopId) || []; } catch(e) {}
    try { var raw = localStorage.getItem('cb_orders_' + shopId); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }
  function getSkuReviews(shopId) {
    try { if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) return CBSkuReviewDB.getAll(shopId) || []; } catch(e) {}
    try { var raw = localStorage.getItem('cb_sku_reviews_' + shopId); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }

  // V163: 评价每日聚合数据
  // 关键：真实差评率 (%) 优先用 cb_reviews.negative_rate（你从 SHEIN 后台录的全量比例），
  //       而 cb_sku_reviews 只是「款式评价明细」抽样（只录有问题的款），不能当全量评价样本。
  // 好评/差评条数仍用 cb_sku_reviews.type（真实发生笔数）。
  // 返回 { byDate: {date: {good, bad, neutral, total, rate, rateSource}}, peak, source, rateSource }
  function getReviewDailyData(shopId) {
    var skuList = getSkuReviews(shopId);
    var reviews = getReviews(shopId);
    var byDate = {};
    var hasSku = skuList.length > 0;
    var hasReviews = reviews.length > 0;

    // 1. 先把 cb_reviews 真实差评率填入 byDate
    reviews.forEach(function(r) {
      if (!r.date) return;
      if (!byDate[r.date]) byDate[r.date] = { good: 0, bad: 0, neutral: 0, rate: 0, rateSource: 'reviews' };
      // negative_rate 字段就是真实差评率（百分比数字）
      if (r.negative_rate != null && !isNaN(parseFloat(r.negative_rate))) {
        byDate[r.date].rate = parseFloat(r.negative_rate);
      }
    });

    // 2. 再把 cb_sku_reviews 的好评/差评条数累加上去（如果该日期 byDate 还没建，先建）
    skuList.forEach(function(r) {
      if (!r.date) return;
      if (!byDate[r.date]) byDate[r.date] = { good: 0, bad: 0, neutral: 0, rate: 0, rateSource: null };
      var t = (r.type || '').toLowerCase();
      if (t === 'good') byDate[r.date].good++;
      else if (t === 'bad') byDate[r.date].bad++;
      else if (t === 'neutral') byDate[r.date].neutral++;
    });

    // 3. 计算 total / positiveRate；对没有 cb_reviews 的日期，rate 用 cb_sku_reviews 的"采样率"打 ★标记
    var dates = Object.keys(byDate);
    dates.forEach(function(d) {
      var o = byDate[d];
      o.total = o.good + o.bad + o.neutral;
      o.positiveRate = o.total > 0 ? (o.good / o.total * 100) : 0;
      // 缺真实率时，用采样率兜底
      if (!o.rateSource) {
        if (o.total > 0) {
          o.rate = o.bad / o.total * 100;
          o.rateSource = 'sample';
        }
      }
    });

    var source = hasSku ? 'sku' : (hasReviews ? 'reviews' : null);
    var rateSource = (function() {
      var realCount = dates.filter(function(d) { return byDate[d].rateSource === 'reviews'; }).length;
      var sampleCount = dates.filter(function(d) { return byDate[d].rateSource === 'sample'; }).length;
      if (realCount > 0 && sampleCount === 0) return 'reviews';
      if (realCount === 0 && sampleCount > 0) return 'sample';
      if (realCount > 0 && sampleCount > 0) return 'mixed';
      return null;
    })();

    // 找差评率高峰日：只看真实率（reviews），避免被采样率误导
    var peak = null;
    dates.forEach(function(d) {
      var o = byDate[d];
      if (o.rateSource !== 'reviews') return;
      if (!peak || o.rate > peak.rate) peak = { date: d, rate: o.rate, good: o.good, bad: o.bad, total: o.total, rateSource: o.rateSource };
    });

    return { byDate: byDate, dates: dates.sort(), peak: peak, source: source, rateSource: rateSource };
  }

  // ============= 图表存储 =============
  var _optCharts = {};
  function destroyCharts() {
    Object.keys(_optCharts).forEach(function(k) {
      try { _optCharts[k].destroy(); } catch(e) {}
    });
    _optCharts = {};
  }

  // ============= 渲染主函数（店铺内嵌 Tab 模式） =============
  function renderOptimizeTab(shopId) {
    destroyCharts();
    var root = _id('cb-tab-optimize-' + shopId);
    if (!root) {
      console.warn('[Optimize] 找不到 cb-tab-optimize-' + shopId + ' 容器');
      return;
    }
    if (!shopId) {
      root.innerHTML = '<div style="padding:40px 20px;text-align:center;color:#94a3b8;background:#fff;border-radius:10px;margin:20px">⚠️ 请先选择店铺</div>';
      return;
    }

    // V161: 移除切 Tab 时的云端全量同步。
    // 数据已在 app 启动时通过 syncFromSupabase 同步到浏览器 localStorage，
    // 切 Tab 应直接读本地缓存（见 app-v3-v6.js 内存缓存层），绝不再去云端拉 64K 订单，
    // 否则 localStorage.setItem 同步写 30MB 会阻塞主线程 → 白屏。
    // 需要强制刷新云端数据时，点顶栏「同步」按钮即可。

    var shop = (typeof DB !== 'undefined' && DB.getShops ? DB.getShops().find(function(s) { return s.id === shopId; }) : null);
    var shopName = shop ? shop.name : shopId;
    var currency = shop ? (shop.currency || 'USD') : 'USD';
    var symbol = currency === 'CNY' ? '¥' : (currency === 'THB' ? '฿' : '$');

    root.innerHTML = '' +
      // 顶部标题（去掉独立店铺下拉，已在店铺详情页中）
      '<div style="background:linear-gradient(135deg, #1890ff 0%, #722ed1 100%);border-radius:10px;padding:14px 18px;margin-bottom:12px;color:#fff;box-shadow:0 4px 12px rgba(24,144,255,0.18)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:700;margin-bottom:2px">📊 ' + _esc(shopName) + ' · 店铺优化建议</div>' +
            '<div style="font-size:11px;opacity:0.92">智能分析差评率、好评数、退款率等关键指标，给出可执行改进方向</div>' +
          '</div>' +
          '<button onclick="window.renderOptimizeTab(\'' + _esc(shopId) + '\')" style="padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.15);color:#fff;font-size:12px;cursor:pointer;font-weight:500">🔄 重新分析</button>' +
        '</div>' +
      '</div>' +

      // 关键指标卡（4 个）
      _renderMetricCards(shopId, symbol) +

      // 左右两块图表
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
        _renderChartCard('📉 差评率趋势', '近 30 天每日差评率 + 差评条数，含 2% / 5% 警戒线', 'opt-canvas-review-' + shopId, '说明：优先用「款式评价明细」的 type 字段（good/bad），未录入时回退到「差评率」Tab。') +
        _renderChartCard('⭐ 好评数趋势', '总评数 vs 好评数堆叠柱状图（基于款式评价 type 拆分）', 'opt-canvas-positive-' + shopId, '说明：优先用「款式评价明细」cb_sku_reviews.type（good=好评/bad=差评），按日聚合。') +
      '</div>' +

      // 智能建议
      _renderSuggestions(shopId, symbol);

    // 延迟 100ms 画图（确保 DOM 完全可见，chart.js 能正确测量尺寸）
    setTimeout(function() {
      try { drawReviewChart(shopId); } catch(e) { console.error('[Optimize] 差评率图绘制失败:', e); }
      try { drawPositiveChart(shopId); } catch(e) { console.error('[Optimize] 好评数图绘制失败:', e); }
    }, 100);
  }

  function _renderChartCard(title, subtitle, canvasId, hint) {
    return '<div style="background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">' +
      '<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:3px">' + title + '</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">' + subtitle + '</div>' +
      '<div style="position:relative;height:240px"><canvas id="' + canvasId + '"></canvas></div>' +
      '<div style="font-size:10px;color:#cbd5e1;margin-top:5px;line-height:1.4">' + hint + '</div>' +
    '</div>';
  }

  function _renderMetricCards(shopId, symbol) {
    var dailies = getDailies(shopId);
    var refunds = getRefunds(shopId);
    var orders = getOrders(shopId);

    // 近 30 天
    var from = getPastDate(30);
    var recentDaily = dailies.filter(function(d) { return (d.date || '') >= from; });
    var totalPayAmt = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.pay_amount) || 0); }, 0);
    var totalVisitors = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.visitors) || 0); }, 0);
    var totalPayers = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.payer_count) || 0); }, 0);

    // V163: 评价数据 — 率用 cb_reviews 真实值，条数用 cb_sku_reviews
    var rd = getReviewDailyData(shopId);
    var recentDates = rd.dates.filter(function(d) { return d >= from; });
    var totalReviews = 0, totalPositive = 0, totalNegative = 0;
    var realRateSum = 0, realRateCount = 0;
    recentDates.forEach(function(d) {
      var o = rd.byDate[d];
      totalReviews += o.total; totalPositive += o.good; totalNegative += o.bad;
      if (o.rateSource === 'reviews' && o.rate > 0) { realRateSum += o.rate; realRateCount++; }
    });
    // 近 30 天差评率高峰日（只看真实率，避免被采样率误导）
    var recentPeak = null;
    recentDates.forEach(function(d) {
      var o = rd.byDate[d];
      if (o.rateSource !== 'reviews') return;
      if (!recentPeak || o.rate > recentPeak.rate) recentPeak = { date: d, rate: o.rate, good: o.good, bad: o.bad };
    });
    // V163: 差评率：优先用真实率（差评率录入）；没数据再用采样率兜底（在卡片/图上标 ★采样）
    var negativeRate = realRateCount > 0 ? (realRateSum / realRateCount) : (totalReviews > 0 ? (totalNegative / totalReviews * 100) : 0);
    var rateSourceTag = realRateCount > 0 ? '差评率录入' : (totalReviews > 0 ? '★采样' : '暂无');
    var positiveRate = totalReviews > 0 ? (totalPositive / totalReviews * 100) : 0; // 好评率 = 采样（款式明细）

    // 退款率
    var refundAmt = refunds.reduce(function(s, r) { return s + (parseFloat(r.refund_amount) || 0); }, 0);
    var refundRate = totalPayAmt > 0 ? (refundAmt / totalPayAmt * 100) : 0;

    var conv = totalVisitors > 0 ? (totalPayers / totalVisitors * 100) : 0;
    var orderCount = orders.filter(function(o) { return (o.sale_amount || 0) > 0; }).length;

    // 4 张主卡片：评价核心指标（用户期望的展示）
    var mainCards = '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:10px">' +
      _card('总评数', totalReviews > 0 ? totalReviews.toLocaleString() : '0', '#1890ff', totalReviews > 0 ? '款式评价明细' : '⚠️ 暂无数据') +
      _card('差评率', negativeRate.toFixed(2) + '%', negativeRate > 5 ? '#ef4444' : (negativeRate > 2 ? '#fa8c16' : '#52c41a'), rateSourceTag) +
      _card('好评率', positiveRate.toFixed(2) + '%', positiveRate >= 80 ? '#52c41a' : (positiveRate >= 50 ? '#fa8c16' : '#ef4444'), totalPositive > 0 ? '好评 ' + totalPositive + ' 条' : '⚠️ 暂无') +
      _card('好评数', totalPositive > 0 ? totalPositive.toLocaleString() : '0', '#52c41a', totalPositive > 0 ? '占比 ' + positiveRate.toFixed(1) + '%' : '⚠️ 暂无') +
    '</div>';

    // 4 张辅助卡片：业务指标（不抢眼但有参考价值）
    var auxCards = '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:12px">' +
      _card('近30天销售额', symbol + totalPayAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }), '#722ed1', totalPayAmt > 0 ? '💰 累计' : '⚠️ 无数据') +
      _card('退款率', refundRate.toFixed(2) + '%', refundRate > 5 ? '#ef4444' : (refundRate > 2 ? '#fa8c16' : '#52c41a'), refundAmt > 0 ? symbol + refundAmt.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '⚠️ 暂无') +
      _card('转化率', conv.toFixed(2) + '%', conv >= 3 ? '#52c41a' : (conv >= 1 ? '#fa8c16' : '#ef4444'), totalVisitors + ' 访客') +
      _card('订单量', orderCount > 0 ? orderCount.toLocaleString() : '0', '#fa8c16', '近 30 天') +
    '</div>';

    return mainCards + auxCards;
  }

  function _card(label, value, color, sub) {
    return '<div style="background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:12px 14px;border-top:3px solid ' + color + '">' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:5px;font-weight:500">' + label + '</div>' +
      '<div style="font-size:20px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
      '<div style="font-size:10px;color:#94a3b8;margin-top:3px">' + sub + '</div>' +
    '</div>';
  }

  // ============= 差评率趋势图 =============
  function drawReviewChart(shopId) {
    var canvas = _id('opt-canvas-review-' + shopId);
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      console.warn('[Optimize] Chart.js 未加载');
      return;
    }
    var rd = getReviewDailyData(shopId);
    var from = getPastDate(30);
    var dates = rd.dates.filter(function(d) { return d >= from; });

    if (dates.length === 0) {
      _drawEmptyChart(canvas, '近 30 天无评价数据', '请到「差评率」Tab 或「评价明细」录入数据');
      return;
    }

    var labels = dates.map(function(d) { return d.substring(5); });
    var rates = dates.map(function(d) {
      var o = rd.byDate[d];
      // V163: sample 数据降饱和（80% → 灰），真实率才是红
      return parseFloat(o.rate.toFixed(2));
    });
    var bads = dates.map(function(d) { return rd.byDate[d].bad; });
    // V163: 给每个点染不同颜色：真实率=红，采样=灰，无数据=空
    var pointColors = dates.map(function(d) {
      var o = rd.byDate[d];
      if (o.rateSource === 'reviews') return o.rate > 5 ? '#ff4d4f' : (o.rate > 2 ? '#fa8c16' : '#52c41a');
      if (o.rateSource === 'sample') return '#cbd5e1';
      return '#cbd5e1';
    });
    var pointSizes = dates.map(function(d) {
      return rd.byDate[d].rateSource === 'reviews' ? 5 : 3;
    });
    var rateSourceLabel = rd.rateSource === 'reviews' ? '差评率录入' : (rd.rateSource === 'sample' ? '款式评价(采样★)' : (rd.rateSource === 'mixed' ? '混合(★采样)' : '暂无'));

    _optCharts.review = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: '差评率(%)', data: rates, borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.06)', fill: true, tension: 0.25, pointRadius: pointSizes, pointBackgroundColor: pointColors, pointBorderColor: '#fff', pointBorderWidth: 1.5, borderWidth: 2, segment: { borderDash: function(ctx) { return rd.byDate[dates[ctx.p1DataIndex]] && rd.byDate[dates[ctx.p1DataIndex]].rateSource === 'sample' ? [4,3] : undefined; } }, datalabels: { display: false } },
          { label: '差评条数', data: bads, borderColor: '#fa8c16', backgroundColor: 'transparent', tension: 0.25, pointRadius: 2, pointBackgroundColor: '#fa8c16', borderWidth: 1.5, yAxisID: 'y1', datalabels: { display: false } },
          { label: '2% 警戒', data: rates.map(function() { return 2; }), borderColor: '#fa8c16', borderDash: [8, 4], pointRadius: 0, fill: false, borderWidth: 1.2, datalabels: { display: false } },
          { label: '5% 高危', data: rates.map(function() { return 5; }), borderColor: '#ff4d4f', borderDash: [4, 3], pointRadius: 0, fill: false, borderWidth: 1.2, datalabels: { display: false } }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 8, bottom: 4, left: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'center', maxHeight: 36, labels: { usePointStyle: true, padding: 14, boxWidth: 22, boxHeight: 0, font: { size: 12, weight: '500' }, color: '#475569' } },
          title: { display: true, text: '差评率口径：' + rateSourceLabel + ' ｜ 🔴 真实(差评率录入) ⬜ 灰虚线 = 采样(非全量)', position: 'top', align: 'end', font: { size: 10, weight: 'normal' }, color: '#64748b', padding: { bottom: 8 } },
          datalabels: { display: false },
          tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10, callbacks: { label: function(ctx) {
            if (ctx.dataset.label === '差评条数') return '差评条数: ' + ctx.parsed.y;
            if (ctx.dataset.label === '差评率(%)') {
              var idx = ctx.dataIndex;
              var src = rd.byDate[dates[idx]] ? rd.byDate[dates[idx]].rateSource : '';
              return '差评率: ' + ctx.parsed.y + '%' + (src === 'sample' ? ' (★采样,非全量)' : (src === 'reviews' ? ' (真实)' : ''));
            }
            return ctx.dataset.label + ': ' + ctx.parsed.y;
          } } }
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: '差评率 %' }, min: 0, suggestedMax: 18, ticks: { stepSize: 2, callback: function(v) { return v + '%'; }, font: { size: 10 }, color: '#64748b' }, grid: { color: 'rgba(148,163,184,0.15)' } },
          y1: { beginAtZero: true, position: 'right', title: { display: true, text: '差评条数' }, grid: { display: false }, ticks: { stepSize: 1, font: { size: 10 }, color: '#64748b' } },
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
        }
      }
    });
  }

  // ============= 好评数趋势图 =============
  function drawPositiveChart(shopId) {
    var canvas = _id('opt-canvas-positive-' + shopId);
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      console.warn('[Optimize] Chart.js 未加载');
      return;
    }
    var rd = getReviewDailyData(shopId);
    var from = getPastDate(30);
    var dates = rd.dates.filter(function(d) { return d >= from; });

    if (dates.length === 0) {
      _drawEmptyChart(canvas, '近 30 天无评价数据', '请到「差评率」Tab 或「评价明细」录入数据');
      return;
    }

    var labels = dates.map(function(d) { return d.substring(5); });
    var posData = dates.map(function(d) { return rd.byDate[d].good; });
    var negData = dates.map(function(d) { return rd.byDate[d].bad; });
    var totalData = dates.map(function(d) { return rd.byDate[d].total; });
    var totalPositive = posData.reduce(function(s, n) { return s + n; }, 0);
    var totalNegative = negData.reduce(function(s, n) { return s + n; }, 0);
    var totalAll = totalData.reduce(function(s, n) { return s + n; }, 0);
    var dayCount = posData.filter(function(n) { return n > 0; }).length || 1;
    var avgPositive = totalPositive / dayCount;
    var dataSourceLabel = rd.source === 'sku' ? '款式评价明细(type)' : '差评率录入';

    _optCharts.positive = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '好评数', data: posData, backgroundColor: 'rgba(82,196,26,0.78)', borderColor: '#52c41a', borderWidth: 1, borderRadius: 4, stack: 'rev', datalabels: { display: false } },
          { label: '差评数', data: negData, backgroundColor: 'rgba(255,77,79,0.72)', borderColor: '#ff4d4f', borderWidth: 1, borderRadius: 4, stack: 'rev', datalabels: { display: false } }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 8, bottom: 4, left: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'center', maxHeight: 36, labels: { usePointStyle: true, padding: 14, boxWidth: 14, font: { size: 12, weight: '500' }, color: '#475569' } },
          title: { display: true, text: '总好评 ' + totalPositive + ' 条 ｜ 总差评 ' + totalNegative + ' 条 ｜ 日均好评 ' + avgPositive.toFixed(0) + ' 条 ｜ 条数来源：' + dataSourceLabel, position: 'top', align: 'end', font: { size: 10, weight: 'normal' }, color: '#52c41a', padding: { bottom: 8 } },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)', titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10,
            callbacks: {
              footer: function(items) {
                var idx = items[0].dataIndex;
                var t = totalData[idx] || 0;
                var p = posData[idx] || 0;
                var b = negData[idx] || 0;
                return '总评 ' + t + ' 条 / 好评率 ' + (t > 0 ? ((p / t) * 100).toFixed(1) : '0') + '% / 差评率(采样) ' + (t > 0 ? ((b / t) * 100).toFixed(1) : '0') + '%';
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 }, color: '#64748b' }, grid: { color: 'rgba(148,163,184,0.15)' } }
        }
      }
    });
  }

  // ============= 空态图 =============
  function _drawEmptyChart(canvas, title, sub) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width = canvas.parentNode.clientWidth;
    var h = canvas.height = canvas.parentNode.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, w / 2, h / 2 - 12);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(sub, w / 2, h / 2 + 12);
  }

  // ============= 智能建议列表 =============
  function _renderSuggestions(shopId, symbol) {
    var dailies = getDailies(shopId);
    var reviews = getReviews(shopId);
    var refunds = getRefunds(shopId);
    var orders = getOrders(shopId);

    var from = getPastDate(30);
    var recentDaily = dailies.filter(function(d) { return (d.date || '') >= from; });
    var totalPayAmt = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.pay_amount) || 0); }, 0);
    var totalVisitors = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.visitors) || 0); }, 0);
    var totalPayers = recentDaily.reduce(function(s, d) { return s + (parseFloat(d.payer_count) || 0); }, 0);

    var refundAmt = refunds.reduce(function(s, r) { return s + (parseFloat(r.refund_amount) || 0); }, 0);
    var refundRate = totalPayAmt > 0 ? (refundAmt / totalPayAmt * 100) : 0;
    var orderCount = orders.filter(function(o) { return (o.sale_amount || 0) > 0; }).length;

    // V163: 用 getReviewDailyData 区分真实率（差评率录入）vs 采样率（款式评价明细）
    var rd = getReviewDailyData(shopId);
    var recentDates = rd.dates.filter(function(d) { return d >= from; });
    var recentTotal = { good: 0, bad: 0, neutral: 0 };
    var realRateSum = 0, realRateCount = 0;
    recentDates.forEach(function(d) {
      var o = rd.byDate[d];
      recentTotal.good += o.good; recentTotal.bad += o.bad; recentTotal.neutral += o.neutral;
      if (o.rateSource === 'reviews' && o.rate > 0) { realRateSum += o.rate; realRateCount++; }
    });
    var totalSum = recentTotal.good + recentTotal.bad + recentTotal.neutral;
    var sampleRate = totalSum > 0 ? (recentTotal.bad / totalSum * 100) : 0;  // 采样率（款式明细）
    // 差评率：优先用真实率（差评率录入）
    var reviewRate = realRateCount > 0 ? (realRateSum / realRateCount) : sampleRate;
    var rateSourceTag = realRateCount > 0 ? '差评率录入' : (totalSum > 0 ? '★采样' : '暂无');
    var positiveRate = totalSum > 0 ? (recentTotal.good / totalSum * 100) : 0;
    // 差评高峰日：只在有真实率(rateSource==='reviews')的日期里找
    var reviewPeak = null;
    recentDates.forEach(function(d) {
      var o = rd.byDate[d];
      if (o.rateSource !== 'reviews') return;
      var cand = { date: d, rate: o.rate, bad: o.bad, good: o.good, rateSource: o.rateSource };
      if (!reviewPeak || cand.rate > reviewPeak.rate) reviewPeak = cand;
    });
    // 趋势：基于真实率前后半段对比
    var reviewTrend = 0;
    if (realRateCount >= 2) {
      var realDates = recentDates.filter(function(d) { return rd.byDate[d].rateSource === 'reviews'; }).sort();
      var half = Math.floor(realDates.length / 2);
      var firstSum = 0, secondSum = 0;
      for (var fi = 0; fi < half; fi++) { firstSum += rd.byDate[realDates[fi]].rate; }
      for (var si = half; si < realDates.length; si++) { secondSum += rd.byDate[realDates[si]].rate; }
      reviewTrend = half > 0 ? (secondSum / (realDates.length - half) - firstSum / half) : 0;
    }

    var avgConversion = totalVisitors > 0 ? (totalPayers / totalVisitors * 100) : 0;
    var avgOrderValue = totalPayers > 0 ? (totalPayAmt / totalPayers) : 0;
    var itemsPerBuyer = totalPayers > 0 ? (recentDaily.reduce(function(s, d) { return s + (parseFloat(d.item_count) || 0); }, 0) / totalPayers) : 0;

    var suggestions = [];

    // 1. 差评率
    if (reviewRate > 5) {
      suggestions.push({ icon: '⚠️', type: 'warn', title: '差评率偏高（' + reviewRate.toFixed(2) + '%）', desc: '差评率超过 5% 高危线，必须立即排查差评集中原因（质量/尺码/物流），并针对性改进。' });
    } else if (reviewRate > 2) {
      suggestions.push({ icon: '✍️', type: 'neutral', title: '差评率需关注（' + reviewRate.toFixed(2) + '%）', desc: '差评率在 2%~5% 之间，建议增加发货前质检、优化尺码表、及时处理客户咨询。' });
    } else if (reviewRate > 0) {
      suggestions.push({ icon: '🌟', type: 'good', title: '差评率控制良好（' + reviewRate.toFixed(2) + '%）', desc: '继续保持产品品质与服务体验，积极邀评提升好评数量。' });
    }

    // 2. 差评趋势变化
    if (Math.abs(reviewTrend) > 0.5) {
      if (reviewTrend > 0.5) {
        suggestions.push({ icon: '📈', type: 'warn', title: '差评率环比上升 ' + reviewTrend.toFixed(2) + '%', desc: '近期差评率有恶化趋势，建议逐日分析近 7 天的差评内容，定位是某个款式出问题还是整体品控下降。' });
      } else {
        suggestions.push({ icon: '📉', type: 'good', title: '差评率环比下降 ' + Math.abs(reviewTrend).toFixed(2) + '%', desc: '近期差评率明显改善，建议保持当前的产品/服务标准，可作为最佳实践推广到其他店铺。' });
      }
    }

    // 3. 差评率高峰日
    if (reviewPeak && reviewPeak.bad >= 0) {
      suggestions.push({ icon: '🔍', type: 'warn', title: '差评率高峰日：' + (reviewPeak.date || '某天') + '（差评率 ' + reviewPeak.rate.toFixed(2) + '%，数据源：' + rateSourceTag + '）', desc: '该日差评率集中偏高，建议逐条查看该日的评价内容（到差评率 Tab 的「款式评价明细」），识别是产品质量、尺码偏差还是物流问题，并采取针对性改进。' });
    }

    // 4. 退款率
    if (refundRate > 5) {
      suggestions.push({ icon: '🚨', type: 'warn', title: '退款率偏高（' + refundRate.toFixed(2) + '%）', desc: '退款金额占销售额比例较高，需重点排查产品质量、尺码描述、物流时效与售后响应速度。' });
    } else if (refundRate > 2) {
      suggestions.push({ icon: '📦', type: 'neutral', title: '退款率需关注（' + refundRate.toFixed(2) + '%）', desc: '建议定期分析退货原因，优化商品描述与质检流程，降低售后成本。' });
    }

    // 5. 转化率
    if (avgConversion < 1) {
      suggestions.push({ icon: '🔍', type: 'warn', title: '转化率偏低（' + avgConversion.toFixed(2) + '%）', desc: '访客多但成交少，建议优化主图、标题、价格竞争力，并检查详情页是否能清晰传达卖点与信任背书。' });
    } else if (avgConversion < 3) {
      suggestions.push({ icon: '⚖️', type: 'neutral', title: '转化率有提升空间（' + avgConversion.toFixed(2) + '%）', desc: '可尝试 A/B 测试主图、设置新客优惠券、优化评价展示，进一步提升下单转化。' });
    } else if (avgConversion > 0) {
      suggestions.push({ icon: '✅', type: 'good', title: '转化率表现优秀（' + avgConversion.toFixed(2) + '%）', desc: '流量承接能力较强，建议适当增加广告预算扩大访客规模，同时关注库存深度。' });
    }

    // 6. 客单价
    if (avgOrderValue > 0 && avgOrderValue < 20) {
      suggestions.push({ icon: '🛒', type: 'warn', title: '客单价较低（' + symbol + avgOrderValue.toFixed(2) + '）', desc: '可通过组合套装、满额包邮、加购优惠等方式提升客单价与利润空间。' });
    } else if (avgOrderValue >= 20 && avgOrderValue < 50) {
      suggestions.push({ icon: '💰', type: 'neutral', title: '客单价中等（' + symbol + avgOrderValue.toFixed(2) + '）', desc: '可针对热销款推出搭配套餐，或设置阶梯满减，进一步挖掘客户购买力。' });
    } else if (avgOrderValue >= 50) {
      suggestions.push({ icon: '💎', type: 'good', title: '客单价较高（' + symbol + avgOrderValue.toFixed(2) + '）', desc: '高客单价说明产品溢价能力较好，建议重点维护老客户复购与 VIP 专属服务。' });
    }

    // 7. 连带率
    if (itemsPerBuyer > 0 && itemsPerBuyer < 1.2) {
      suggestions.push({ icon: '🔗', type: 'warn', title: '连带率偏低（' + itemsPerBuyer.toFixed(2) + '件/人）', desc: '买家单次购买件数少，可在详情页与购物车页增加「经常一起买」的关联推荐。' });
    } else if (itemsPerBuyer >= 1.2) {
      suggestions.push({ icon: '🎁', type: 'good', title: '连带率良好（' + itemsPerBuyer.toFixed(2) + '件/人）', desc: '可继续通过多件折扣、组合销售提升客单与利润。' });
    }

    // 8. 订单量
    if (orderCount < 10) {
      suggestions.push({ icon: '🏪', type: 'warn', title: '订单量偏少（仅 ' + orderCount + ' 单）', desc: '订单量极低时，优先排查「上架产品数量是否够多」。跨境平台的推荐算法依赖产品基数，建议：①检查当前在线产品数是否达类目平均 ②每周保持 10-20 款上新频率 ③下架效果差的链接，释放店铺权重给新产品。' });
      suggestions.push({ icon: '📸', type: 'neutral', title: '图片与上架优化', desc: '①A/B 图测试：每款上架前做 2-3 版主图 A/B 测试，选点击率最高的主图投放 ②制作产品视频：15-30 秒展示使用场景和细节，点击率平均提升 40% ③优化标题：嵌入热词 + 属性词 + 场景词，参考平台搜索下拉词与竞品标题结构' });
      suggestions.push({ icon: '🎨', type: 'neutral', title: '款多量足策略', desc: '①同款不同场景上架（同一款式在不同场景/背景拍摄，分多个链接发布）②同场景不同款式上架（同一拍摄背景下换款式拍摄，用同一套风格串联店铺）③做新图全新上架（完全脱离旧图，重新拍摄做链接）④做新图复色放在爆款下面（爆款链接下补充配色变体图，拉长停留时间）' });
    } else {
      suggestions.push({ icon: '📸', type: 'neutral', title: '图片与转化优化', desc: '①A/B 图测试：已上架的爆款定期做主图跟换测试，测点击率变化 ②产品视频：核心爆款至少配一个视频（展示场景/使用/对比）③优化标题：定期替换排名下滑链接的标题，跟住最新搜索趋势' });
    }

    // 9. 通用
    suggestions.push({ icon: '🚀', type: 'neutral', title: '提升销量的通用动作', desc: '1) 保持每日上新或优化老链接；2) 针对高转化时段加大广告；3) 维护老客户，设置复购优惠券；4) 监控竞品价格与活动，及时调整。' });

    var typeColor = {
      good: { bg: '#f0fdf4', border: '#bbf7d0', icon: '#16a34a' },
      warn: { bg: '#fef2f2', border: '#fecaca', icon: '#dc2626' },
      neutral: { bg: '#f8fafc', border: '#e2e8f0', icon: '#64748b' }
    };

    var cards = suggestions.map(function(s) {
      var cs = typeColor[s.type] || typeColor.neutral;
      return '<div style="background:' + cs.bg + ';border:1px solid ' + cs.border + ';border-radius:8px;padding:11px 13px;display:flex;gap:10px;align-items:flex-start">' +
        '<div style="font-size:18px;flex-shrink:0;line-height:1.3">' + s.icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:2px">' + _esc(s.title) + '</div>' +
          '<div style="font-size:12px;color:#475569;line-height:1.55;white-space:pre-wrap">' + _esc(s.desc) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div style="background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div style="font-size:14px;font-weight:600;color:#0f172a">💡 智能优化建议</div>' +
        '<div style="font-size:11px;color:#94a3b8">共 ' + suggestions.length + ' 条 · 基于差评率/好评数/退款率/转化率/客单价综合分析</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + cards + '</div>' +
    '</div>';
  }

  // ============= 暴露到 window =============
  // V128: 店铺内嵌 Tab 模式，renderOptimizeTab 替代旧的 renderOptimize（独立页面）
  window.renderOptimizeTab = renderOptimizeTab;
  // 兼容老引用：有些代码可能还引用了 renderOptimize
  window.renderOptimize = function(shopId) { return renderOptimizeTab(shopId); };
  console.log('[Optimize] ✅ 店铺优化建议 v2（店铺内嵌 Tab 模式）已加载');
})();
