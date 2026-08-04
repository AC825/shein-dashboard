/**
 * 一键导出PPT v2 - 高端商务模板
 *
 * 修复 v1 的问题：
 * 1. 模板间复用时文字重叠（executive 调用 detailed 导致封面重复）
 * 2. 文字溢出布局边界
 * 3. 排版混乱
 *
 * 5 个全新模板（替代 v1 的 3 个）：
 * 1. 📋 简洁工作周报 - 干净的白底蓝条，适合周报
 * 2. 📊 数据分析报告 - 商务深蓝配色，适合月报
 * 3. 📈 经营分析报告 - 高端深色背景，适合管理层
 * 4. 📅 月度经营复盘 - 紫色高级感，适合月度
 * 5. 🎯 季度战略复盘 - 紫蓝渐变，适合季度
 */
(function() {
  'use strict';

  // ===== 工具 =====
  function _id(s) { return document.getElementById(s); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _fmt(n) {
    if (n == null || isNaN(n)) return '0';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  var _PPT_US_TZ = 'America/New_York';
  function _usNowDatePPT() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: _PPT_US_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var y = '', m = '', d = '';
    parts.forEach(function(p) { if (p.type === 'year') y = p.value; else if (p.type === 'month') m = p.value; else if (p.type === 'day') d = p.value; });
    return new Date(y + '-' + m + '-' + d + 'T00:00:00');
  }
  function _fmtYMDPPT(dt) { return dt.getFullYear() + '-' + _pad(dt.getMonth()+1) + '-' + _pad(dt.getDate()); }
  // 默认结束于「美国昨天」(最后一个完整日)，避免把未完工的当天算入统计
  function _today() { var d = _usNowDatePPT(); d.setDate(d.getDate() - 1); return _fmtYMDPPT(d); }
  function _past(days) { var d = _usNowDatePPT(); d.setDate(d.getDate() - 1 - (days - 1)); return _fmtYMDPPT(d); }
  // 锚点策略（与总览/掉量分析一致）：取店铺中「最后有数据的那天」为统计终点；无数据退回美国昨天
  function _normDatePPT(s) {
    if (!s) return '';
    var m = String(s).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    return m ? (m[1] + '-' + _pad(m[2]) + '-' + _pad(m[3])) : '';
  }
  function _lastDataDatePPT(shopIds) {
    var latest = '';
    var ids = shopIds && shopIds.length ? shopIds : (function() { try { return (DB.getShops() || []).map(function(s) { return s.id; }); } catch(e) { return []; } })();
    ids.forEach(function(sid) {
      try {
        if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) {
          (CrossBorderDailyDB.getAll(sid) || []).forEach(function(d) { var nd = _normDatePPT(d && d.date); if (nd && nd > latest) latest = nd; });
        }
        if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) {
          (CBOrderDB.getAll(sid) || []).forEach(function(o) { var nd = _normDatePPT(o && o.date); if (nd && nd > latest) latest = nd; });
        }
      } catch(e) {}
    });
    return latest || _today();
  }
  function _anchorPast(anchorStr, days) { var d = new Date(anchorStr + 'T00:00:00'); d.setDate(d.getDate() - (days - 1)); return _fmtYMDPPT(d); }
  function _curSym(currency) { return currency === 'CNY' ? '¥' : (window.CURRENCY_SYMBOLS && window.CURRENCY_SYMBOLS[currency] ? window.CURRENCY_SYMBOLS[currency] : '$'); }

  window._pptTemplates = [
    { id: 'weekly',      name: '📋 简洁工作周报',       desc: '白底蓝条，干净专业，适合日常周报' },
    { id: 'analysis',    name: '📊 数据分析报告',       desc: '深蓝商务配色，多图多表，适合月报' },
    { id: 'executive',   name: '📈 经营分析报告',       desc: '高端深色背景，决策者视角，适合管理层' },
    { id: 'monthly',     name: '📅 月度经营复盘',       desc: '紫色高级感，多店对比，适合月度复盘' },
    { id: 'quarterly',   name: '🎯 季度战略复盘',       desc: '紫蓝渐变战略风格，季度总结与下季规划' }
  ];

  // ===== 1. 数据采集 =====
  function collectShopData(shopId, fromDate, toDate) {
    var shop = null;
    try { shop = (DB.getShops() || []).find(function(s) { return s.id === shopId; }); } catch(e) {}
    if (!shop) return null;
    var currency = (typeof getPlatformCurrency === 'function') ? getPlatformCurrency(shop) : (shop.currency || 'USD');
    var sym = _curSym(currency);
    var result = { shop: shop, currency: currency, sym: sym, fromDate: fromDate, toDate: toDate };

    var daily = [];
    try { if (typeof CrossBorderDailyDB !== 'undefined' && CrossBorderDailyDB.getAll) daily = CrossBorderDailyDB.getAll(shopId) || []; } catch(e) {}
    var filteredDaily = daily.filter(function(d) { return d.date && d.date >= fromDate && d.date <= toDate; });
    result.visitors = filteredDaily.reduce(function(s, d) { return s + (parseInt(d.visitors) || 0); }, 0);
    result.payers = filteredDaily.reduce(function(s, d) { return s + (parseInt(d.payer_count || d.buyers) || 0); }, 0);
    result.items = filteredDaily.reduce(function(s, d) { return s + (parseInt(d.item_count || d.qty) || 0); }, 0);
    result.revenue = filteredDaily.reduce(function(s, d) { return s + (parseFloat(d.pay_amount || d.amount) || 0); }, 0);
    result.days = filteredDaily.length;

    var orders = [];
    try { if (typeof CBOrderDB !== 'undefined' && CBOrderDB.getAll) orders = CBOrderDB.getAll(shopId) || []; } catch(e) {}
    var validOrders = orders.filter(function(o) { return o.date && o.date >= fromDate && o.date <= toDate && (o.sale_amount || 0) > 0; });
    result.orderCount = validOrders.length;
    if (result.days === 0 && result.orderCount > 0) {
      result.revenue = validOrders.reduce(function(s, o) { return s + (parseFloat(o.sale_amount) || 0); }, 0);
      result.items = validOrders.length;
    }

    var refunds = [];
    try { if (typeof CBRefundDB !== 'undefined' && CBRefundDB.getAll) refunds = CBRefundDB.getAll(shopId) || []; } catch(e) {}
    var validRefunds = refunds.filter(function(r) { return r.date && r.date >= fromDate && r.date <= toDate; });
    result.refundAmt = validRefunds.reduce(function(s, r) { return s + (parseFloat(r.refund_amount || r.amount) || 0); }, 0);
    result.refundQty = validRefunds.reduce(function(s, r) { return s + (parseInt(r.qty) || 1); }, 0);
    result.refundRate = result.revenue > 0 ? (result.refundAmt / result.revenue * 100) : 0;
    // 退款原因分布
    result.refundReasons = {};
    validRefunds.forEach(function(r) {
      var reason = r.reason || '未分类';
      if (!result.refundReasons[reason]) result.refundReasons[reason] = { qty: 0, amount: 0 };
      result.refundReasons[reason].qty += parseInt(r.qty) || 1;
      result.refundReasons[reason].amount += parseFloat(r.refund_amount || r.amount) || 0;
    });
    // 退款 SKU TOP10
    var refundSkuMap = {};
    validRefunds.forEach(function(r) {
      var sku = r.sku || '未知';
      if (!refundSkuMap[sku]) refundSkuMap[sku] = { qty: 0, amount: 0, count: 0 };
      refundSkuMap[sku].qty += parseInt(r.qty) || 1;
      refundSkuMap[sku].amount += parseFloat(r.refund_amount || r.amount) || 0;
      refundSkuMap[sku].count += 1;
    });
    result.refundTopSkus = Object.keys(refundSkuMap).map(function(k) { return { sku: k, qty: refundSkuMap[k].qty, amount: refundSkuMap[k].amount, count: refundSkuMap[k].count }; })
      .sort(function(a, b) { return b.amount - a.amount; }).slice(0, 10);

    var reviews = [];
    try { if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) reviews = CBReviewDB.getAll(shopId) || []; } catch(e) {}
    var validReviews = reviews.filter(function(r) { return r.date && r.date >= fromDate && r.date <= toDate; });
    result.reviewCount = validReviews.length;
    if (validReviews.length > 0) {
      result.reviewRate = validReviews.reduce(function(s, r) {
        return s + (r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews / r.total_reviews * 100 : 0));
      }, 0) / validReviews.length;
    } else { result.reviewRate = 0; }
    // 差评率趋势（每天差评率）
    result.reviewDaily = validReviews.map(function(r) {
      return { date: r.date, rate: r.negative_rate != null ? r.negative_rate : 0 };
    }).sort(function(a, b) { return a.date.localeCompare(b.date); });

    // 款式差评明细（用于尺码偏差分析）
    var skuReviews = [];
    try { if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) skuReviews = CBSkuReviewDB.getAll(shopId) || []; } catch(e) {}
    var validSkuReviews = skuReviews.filter(function(r) { return r.date && r.date >= fromDate && r.date <= toDate; });
    // 尺码偏差统计
    var sizeDeviation = { small: 0, large: 0, other: 0, bySku: {} };
    var SIZE_SMALL = ['尺码偏小','尺码偏小退回','size too small','too small'];
    var SIZE_LARGE = ['尺码偏大','尺码偏大退回','size too large','too large','too big'];
    validSkuReviews.forEach(function(r) {
      var reason = (r.reason || '').toLowerCase();
      var sku = r.sku || '未知';
      if (!sizeDeviation.bySku[sku]) sizeDeviation.bySku[sku] = { small: 0, large: 0 };
      if (SIZE_SMALL.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; })) {
        sizeDeviation.small++;
        sizeDeviation.bySku[sku].small++;
      } else if (SIZE_LARGE.some(function(k) { return reason.indexOf(k.toLowerCase()) >= 0; })) {
        sizeDeviation.large++;
        sizeDeviation.bySku[sku].large++;
      } else {
        sizeDeviation.other++;
      }
    });
    result.sizeDeviation = sizeDeviation;
    result.skuReviewCount = validSkuReviews.length;

    var skuData = {};
    validOrders.forEach(function(o) {
      var sku = o.sku || '未知';
      if (!skuData[sku]) skuData[sku] = { qty: 0, amount: 0 };
      skuData[sku].qty += 1;
      skuData[sku].amount += parseFloat(o.sale_amount) || 0;
    });
    result.topSkus = Object.keys(skuData).map(function(k) { return { sku: k, qty: skuData[k].qty, amount: skuData[k].amount }; })
      .sort(function(a, b) { return b.amount - a.amount; }).slice(0, 10);

    var daysCount = Math.max(1, result.days || Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000));
    result.avgVisitors = result.visitors / daysCount;
    result.avgPayers = result.payers / daysCount;
    result.avgRevenue = result.revenue / daysCount;
    result.conversion = result.visitors > 0 ? (result.payers / result.visitors * 100) : 0;
    result.aov = result.payers > 0 ? (result.revenue / result.payers) : 0;
    return result;
  }

  function collectMultiShopData(shopIds, fromDate, toDate) {
    var results = [];
    shopIds.forEach(function(id) {
      var d = collectShopData(id, fromDate, toDate);
      if (d) results.push(d);
    });
    var aggregated = {
      shopCount: results.length,
      totalRevenue: results.reduce(function(s, r) { return s + r.revenue; }, 0),
      totalOrders: results.reduce(function(s, r) { return s + r.orderCount; }, 0),
      totalVisitors: results.reduce(function(s, r) { return s + r.visitors; }, 0),
      totalPayers: results.reduce(function(s, r) { return s + r.payers; }, 0),
      totalItems: results.reduce(function(s, r) { return s + r.items; }, 0),
      totalRefundAmt: results.reduce(function(s, r) { return s + r.refundAmt; }, 0),
      totalRefundQty: results.reduce(function(s, r) { return s + r.refundQty; }, 0),
      avgConversion: 0, avgAov: 0, avgReviewRate: 0,
      daysCount: 0, shops: results
    };
    aggregated.avgConversion = aggregated.totalVisitors > 0 ? (aggregated.totalPayers / aggregated.totalVisitors * 100) : 0;
    aggregated.avgAov = aggregated.totalPayers > 0 ? (aggregated.totalRevenue / aggregated.totalPayers) : 0;
    var rCount = results.filter(function(r) { return r.reviewCount > 0; }).length;
    aggregated.avgReviewRate = rCount > 0 ? results.reduce(function(s, r) { return s + r.reviewRate; }, 0) / rCount : 0;
    aggregated.daysCount = results.length > 0 ? Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000) : 0;
    return aggregated;
  }

  function generateInsights(data, fromDate, toDate) {
    var items = [];
    if (data.totalRevenue > 0) {
      items.push({ title: '经营概览', content: '本周期（' + fromDate + ' ~ ' + toDate + '）共 ' + data.daysCount + ' 天，' + data.shopCount + ' 家店铺总营收 ' + data.totalRevenue.toFixed(2) + '美元，日均营收 ' + (data.daysCount > 0 ? (data.totalRevenue / data.daysCount).toFixed(2) : '0') + '美元，总订单 ' + data.totalOrders + ' 单，总访客 ' + data.totalVisitors + ' 人，总体转化率 ' + data.avgConversion.toFixed(2) + '%。' });
    }

    // 整体趋势归因分析：把周期对半拆分，对比前/后
    if (data.shops.length > 0) {
      var firstHalfDays = Math.floor(data.daysCount / 2);
      var firstHalfRev = 0, secondHalfRev = 0;
      var firstHalfOrd = 0, secondHalfOrd = 0;
      data.shops.forEach(function(s) {
        var sortedDates = Object.keys(s.dateSumMap || {}).sort();
        for (var i = 0; i < sortedDates.length; i++) {
          var dd = s.dateSumMap[sortedDates[i]];
          if (i < firstHalfDays) {
            firstHalfRev += dd.revUSD || dd.pay_amount || 0;
            firstHalfOrd += dd.item_count || 0;
          } else {
            secondHalfRev += dd.revUSD || dd.pay_amount || 0;
            secondHalfOrd += dd.item_count || 0;
          }
        }
      });
      if (firstHalfRev > 0 || secondHalfRev > 0) {
        var trend = secondHalfRev - firstHalfRev;
        var trendPct = firstHalfRev > 0 ? (trend / firstHalfRev * 100) : 0;
        var ordTrend = secondHalfOrd - firstHalfOrd;
        var ordPct = firstHalfOrd > 0 ? (ordTrend / firstHalfOrd * 100) : 0;
        if (Math.abs(trendPct) > 5) {
          if (trend > 0) {
            items.push({ title: '📈 整体上升 +' + trendPct.toFixed(1) + '%（营收 / 订单）', content: '后半段营收 +$' + trend.toFixed(2) + '，订单 +' + ordTrend + ' 单。' + (ordPct > 0 ? '订单量增速 ' + ordPct.toFixed(1) + '%，' : '订单量略降 ') + '可能原因：①新链接/活动期 ②差评/退款下降带动转化提升 ③广告投放加大带来流量增量。建议：保持当前节奏，加大备货。' });
          } else {
            // 下降：找原因
            var reasons = [];
            if (data.avgReviewRate > 3) reasons.push('差评率 ' + data.avgReviewRate.toFixed(2) + '% 偏高影响评分');
            if (data.totalRefundAmt > 0 && (data.totalRefundAmt / data.totalRevenue * 100) > 3) reasons.push('退款率 ' + (data.totalRefundAmt / data.totalRevenue * 100).toFixed(2) + '% 偏高损耗营收');
            if (data.avgConversion < 2) reasons.push('转化率 ' + data.avgConversion.toFixed(2) + '% 偏低');
            if (data.totalVisitors < firstHalfRev * 2) reasons.push('访客数减少，流量端可能下滑');
            items.push({ title: '📉 整体下降 ' + trendPct.toFixed(1) + '%（营收 / 订单）', content: '后半段营收 -$' + Math.abs(trend).toFixed(2) + '，订单 -' + Math.abs(ordTrend) + ' 单。可能原因：' + (reasons.length > 0 ? reasons.join('；') : '需要详细排查（广告、竞品、季节性因素）') + '。建议：① 排查是否有链接下架 ② 检查差评集中款式 ③ 加大广告预算对冲。' });
          }
        }
      }
    }

    if (data.totalRefundAmt > 0) {
      var refundRate = data.totalRevenue > 0 ? (data.totalRefundAmt / data.totalRevenue * 100) : 0;
      if (refundRate > 5) {
        // 找退款原因 TOP
        var refundReasonList = Object.entries(data.shops.reduce(function(acc, s) {
          Object.entries(s.refundReasons || {}).forEach(function(entry) {
            if (!acc[entry[0]]) acc[entry[0]] = { qty: 0, amount: 0 };
            acc[entry[0]].qty += entry[1].qty;
            acc[entry[0]].amount += entry[1].amount;
          });
          return acc;
        }, {})).sort(function(a, b) { return b[1].amount - a[1].amount; });
        var topReasons = refundReasonList.slice(0, 3).map(function(entry) { return entry[0] + '（' + entry[1].qty + '件/$' + entry[1].amount.toFixed(0) + '）'; }).join('、');
        items.push({ title: '🚨 退款率 ' + refundRate.toFixed(2) + '% 严重', content: '退款总额 $' + data.totalRefundAmt.toFixed(2) + ' / ' + data.totalRefundQty + '件，超出 5% 警戒线。' + (topReasons ? '退款原因 TOP3：' + topReasons + '。' : '') + '建议：①质量问题 → 重点工厂整改 ②尺码问题 → 重新修订尺码表 ③物流问题 → 更换承运商。' });
      } else if (refundRate > 2) {
        items.push({ title: '⚠️ 退款率需关注（' + refundRate.toFixed(2) + '%）', content: '退款金额 $' + data.totalRefundAmt.toFixed(2) + '，在 2-5% 区间，建议定期分析退货原因，优化商品描述与质检流程。' });
      }
    }
    if (data.avgReviewRate > 5) {
      items.push({ title: '差评预警', content: '综合差评率 ' + data.avgReviewRate.toFixed(2) + '% 超过 5% 高警线，建议立即分析差评内容（质量/尺码/物流等），针对性改进。' });
    } else if (data.avgReviewRate > 0) {
      items.push({ title: '差评率分析（' + data.avgReviewRate.toFixed(2) + '%）', content: '已录入 ' + (data.shops.reduce(function(s, sh) { return s + (sh.reviewCount || 0); }, 0)) + ' 条差评记录，差评率处于 ' + (data.avgReviewRate > 2 ? '中等偏高' : '良好') + ' 区间。' + (data.avgReviewRate > 2 ? '需关注是否有款式集中差评。' : '继续保持。') });
    }
    if (data.avgConversion < 2) {
      items.push({ title: '转化优化', content: '转化率仅 ' + data.avgConversion.toFixed(2) + '% 偏低，建议优化主图、标题、价格竞争力及评价展示。' });
    }

    // 偏大偏小分析
    var totalSizeDev = 0, totalSmall = 0, totalLarge = 0;
    data.shops.forEach(function(s) {
      if (s.sizeDeviation) {
        totalSmall += s.sizeDeviation.small || 0;
        totalLarge += s.sizeDeviation.large || 0;
      }
    });
    totalSizeDev = totalSmall + totalLarge;
    if (totalSizeDev > 0) {
      // 找偏大/偏小最多的 SKU
      var skuDevList = [];
      data.shops.forEach(function(s) {
        if (s.sizeDeviation && s.sizeDeviation.bySku) {
          Object.keys(s.sizeDeviation.bySku).forEach(function(sku) {
            var v = s.sizeDeviation.bySku[sku];
            if (v.small + v.large > 0) {
              skuDevList.push({ sku: sku, small: v.small, large: v.large, total: v.small + v.large });
            }
          });
        }
      });
      skuDevList.sort(function(a, b) { return b.total - a.total; });
      var topDev = skuDevList.slice(0, 3);
      var tendency = totalSmall > totalLarge ? '尺码偏小为主' : (totalLarge > totalSmall ? '尺码偏大为主' : '持平');
      var devDesc = '偏小 ' + totalSmall + ' 件（' + (totalSizeDev > 0 ? (totalSmall / totalSizeDev * 100).toFixed(0) : 0) + '%）、偏大 ' + totalLarge + ' 件（' + (totalSizeDev > 0 ? (totalLarge / totalSizeDev * 100).toFixed(0) : 0) + '%），以' + tendency;
      var topDesc = topDev.length > 0 ? '涉及款式：' + topDev.map(function(t) { return t.sku + '（偏' + (t.small > t.large ? '小' : '大') + t.total + '件）'; }).join('；') : '';
      items.push({ title: '📏 尺码偏差分析（' + totalSizeDev + ' 条记录）', content: devDesc + '。' + topDesc + '。建议：① 偏小为主：尺码表放大 0.5-1cm 或选大一码拍 ② 偏大为主：尺码表缩小或选小一码 ③ 款式层面做尺码优化表，重新上架。' });
    }

    var allTopSkus = [];
    data.shops.forEach(function(s) { (s.topSkus || []).forEach(function(sk) { allTopSkus.push(sk); }); });
    allTopSkus.sort(function(a, b) { return b.amount - a.amount; });
    var top3 = allTopSkus.slice(0, 3);
    if (top3.length > 0) {
      items.push({ title: '热销款式（' + allTopSkus.length + ' 个有销量）', content: '销售额 TOP3：' + top3.map(function(t) { return t.sku + '（$' + t.amount.toFixed(0) + '）'; }).join('；') + '。建议：确保库存充足、关注评论、考虑同步到其他店。' });
    }

    // 退款 SKU 集中
    var allRefundSkus = [];
    data.shops.forEach(function(s) { (s.refundTopSkus || []).forEach(function(sk) { allRefundSkus.push(sk); }); });
    allRefundSkus.sort(function(a, b) { return b.amount - a.amount; });
    var topRefundSkus = allRefundSkus.slice(0, 3);
    if (topRefundSkus.length > 0 && topRefundSkus[0].amount > 0) {
      items.push({ title: '💸 退款 TOP3 款（重点关注）', content: '退款金额最高 3 款：' + topRefundSkus.map(function(t) { return t.sku + '（' + t.count + '次/$' + t.amount.toFixed(0) + '）'; }).join('；') + '。建议：① 评估是否下架退款率过高的款式 ② 优化尺码表/产品描述降低退货 ③ 重点工厂整改质量。' });
    }

    items.push({ title: '后续建议', content: '1) 保持每日上新/优化老链接；2) 对差评/退款高的款式做专项品控；3) 维护老客户复购；4) 监控竞品价格与活动，及时调整策略。' });
    return items;
  }

  // ===== 2. 模板定义 =====

  // 通用：封面页（白底专业风）
  function _addCoverSlide(pptx, opts) {
    var s = pptx.addSlide();
    s.background = { fill: opts.bgColor || 'FFFFFF' };
    // 顶部色条
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.5, fill: { color: opts.accentColor || '1890FF' }, line: { color: opts.accentColor || '1890FF', width: 0 } });
    // 主标题
    s.addText(opts.title, { x: 0.5, y: 1.8, w: 9, h: 1.0, fontSize: 40, bold: true, color: opts.titleColor || '1F2937', align: 'center', fontFace: 'Microsoft YaHei' });
    // 副标题
    if (opts.subtitle) {
      s.addText(opts.subtitle, { x: 0.5, y: 2.9, w: 9, h: 0.5, fontSize: 16, color: opts.subtitleColor || '6B7280', align: 'center' });
    }
    // 装饰线
    s.addShape(pptx.ShapeType.rect, { x: 4.5, y: 3.6, w: 1, h: 0.05, fill: { color: opts.accentColor || '1890FF' }, line: { color: opts.accentColor || '1890FF', width: 0 } });
    // 元数据
    var meta = (opts.meta || []).filter(Boolean);
    if (meta.length > 0) {
      s.addText(meta.join('  ·  '), { x: 0.5, y: 4.0, w: 9, h: 0.4, fontSize: 12, color: '94A3B8', align: 'center' });
    }
    // 底部
    s.addText(opts.footer || '生成时间：' + _today(), { x: 0.5, y: 6.8, w: 9, h: 0.3, fontSize: 10, color: 'CBD5E1', align: 'center' });
    return s;
  }

  // 通用：内容页（白底）
  function _addContentSlide(pptx, title, accentColor) {
    var s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    // 左侧色条
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: accentColor || '1890FF' }, line: { color: accentColor || '1890FF', width: 0 } });
    // 顶部标题
    s.addText(title, { x: 0.6, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1F2937', fontFace: 'Microsoft YaHei' });
    // 标题下划线
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.95, w: 0.6, h: 0.04, fill: { color: accentColor || '1890FF' }, line: { color: accentColor || '1890FF', width: 0 } });
    return s;
  }

  // 通用：指标卡（2x2 网格）
  function _addMetricCard(pptx, s, x, y, w, h, label, value, color, sub) {
    s.addShape(pptx.ShapeType.roundRect, { x: x, y: y, w: w, h: h, fill: { color: 'F9FAFB' }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08 });
    s.addShape(pptx.ShapeType.rect, { x: x, y: y, w: 0.08, h: h, fill: { color: color }, line: { color: color, width: 0 } });
    s.addText(label, { x: x + 0.2, y: y + 0.1, w: w - 0.3, h: 0.3, fontSize: 11, color: '6B7280' });
    s.addText(value, { x: x + 0.2, y: y + 0.4, w: w - 0.3, h: 0.6, fontSize: 24, bold: true, color: color });
    if (sub) s.addText(sub, { x: x + 0.2, y: y + 1.0, w: w - 0.3, h: 0.3, fontSize: 10, color: '9CA3AF' });
  }

  // ===== 模板 1：简洁工作周报 =====
  // ===== V159: 掉量分析 + 好评差评 共享幻灯片 =====
  function _addDropAnalysisSlide(pptx, data) {
    if (typeof window.DropAnalysis === 'undefined') return;
    var all = [];
    (data.shops || []).forEach(function (sh) {
      var sid = sh.shop && sh.shop.id; if (!sid) return;
      var d = window.DropAnalysis.computeDropRanking(sid, 'week');
      if (!d || !d.rows) return;
      d.rows.forEach(function (r) {
        all.push({
          shop: (sh.shop.name || sid), sku: r.sku,
          cur: r.curCount, prev: r.prevCount, drop: r.dropPct,
          refund: r.refundQty, neg: r.negCount, reason: r.reason
        });
      });
    });
    all.sort(function (a, b) { return b.drop - a.drop; });
    var top = all.slice(0, 15);
    var s = _addContentSlide(pptx, '📉 掉量分析（周环比 · 近7天 vs 前7天）', 'FA541C');
    if (top.length === 0) {
      s.addText('本周期无掉量款式（各款式单量均持平或上涨）', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
      return;
    }
    var rows = top.map(function (r) {
      return [r.shop, r.sku, r.cur + '单', r.prev + '单', (r.drop >= 0 ? '+' : '') + r.drop.toFixed(1) + '%', r.refund + '单', r.neg + '条', r.reason];
    });
    s.addTable([['店铺', '款式(SKU)', '本期', '上期', '降幅', '退货', '差评', '推测原因']].concat(rows), {
      x: 0.4, y: 1.1, w: 9.2, fontSize: 9, colW: [1.6, 1.5, 0.8, 0.8, 0.9, 0.7, 0.7, 2.2],
      border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.32, autoPage: false, color: '444444'
    });
    s.addText('* 掉量款式已关联同期退货与差评，用于推断掉量原因（如退货/差评偏高）', { x: 0.4, y: 6.6, w: 9, h: 0.3, fontSize: 9, color: '94A3B8', italic: true });
  }

  function _addReviewSplitSlide(pptx, data) {
    if (typeof window.DropAnalysis === 'undefined') return;
    var s = _addContentSlide(pptx, '⭐ 好评 / 差评分布', '52C41A');
    var shopRows = [];
    var topBad = [];
    (data.shops || []).forEach(function (sh) {
      var sid = sh.shop && sh.shop.id; if (!sid) return;
      var st = window.DropAnalysis.getReviewTypeStats(sid);
      var shop = (sh.shop.name || sid);
      shopRows.push([shop, String(st.shop.good), String(st.shop.bad), String(st.shop.neutral), st.shop.positiveRate.toFixed(1) + '%']);
      st.perSku.forEach(function (r) { if (r.bad > 0) topBad.push({ shop: shop, sku: r.sku, good: r.good, bad: r.bad, pos: r.positiveRate }); });
    });
    s.addText('店铺级 好评 / 差评', { x: 0.5, y: 1.0, w: 5, h: 0.3, fontSize: 12, bold: true, color: '52C41A' });
    if (shopRows.length > 0) {
      s.addTable([['店铺', '好评', '差评', '中性', '好评率']].concat(shopRows),
        { x: 0.5, y: 1.35, w: 4.5, fontSize: 9, colW: [1.6, 0.8, 0.8, 0.8, 1.0], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.3, autoPage: false });
    }
    topBad.sort(function (a, b) { return b.bad - a.bad; });
    var topBadRows = topBad.slice(0, 12).map(function (r) { return [r.shop, r.sku, String(r.good), String(r.bad), r.pos.toFixed(1) + '%']; });
    s.addText('差评款式 TOP（按差评数）', { x: 5.2, y: 1.0, w: 4.5, h: 0.3, fontSize: 12, bold: true, color: 'CF1322' });
    if (topBadRows.length > 0) {
      s.addTable([['店铺', '款式', '好评', '差评', '好评率']].concat(topBadRows),
        { x: 5.2, y: 1.35, w: 4.5, fontSize: 9, colW: [1.4, 1.2, 0.6, 0.6, 0.9], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.3, autoPage: false });
    } else {
      s.addText('本周期无差评记录', { x: 5.2, y: 3, w: 4.5, h: 0.4, fontSize: 12, color: '9CA3AF' });
    }
  }

  var TEMPLATES = {};
  TEMPLATES.weekly = function(pptx, data, fromDate, toDate) {

    // P1: 封面
    _addCoverSlide(pptx, {
      title: '工作周报',
      subtitle: '店铺经营数据报告',
      accentColor: '1890FF',
      titleColor: '1F2937',
      subtitleColor: '6B7280',
      bgColor: 'FFFFFF',
      meta: ['周期 ' + fromDate + ' ~ ' + toDate, '涉及 ' + data.shopCount + ' 家店铺', '生成于 ' + _today()],
      footer: '本报告由店铺管理系统自动生成'
    });

    // P2: 核心指标
    var s = _addContentSlide(pptx, '📈 核心指标速览', '1890FF');
    var metrics = [
      { label: '总营收', value: '$' + _fmt(data.totalRevenue), sub: data.shopCount + ' 家店铺', color: '1890FF' },
      { label: '总订单', value: _fmt(data.totalOrders), sub: '订单总数', color: '10B981' },
      { label: '总访客', value: _fmt(data.totalVisitors), sub: '访客数', color: '06B6D4' },
      { label: '综合转化率', value: data.avgConversion.toFixed(2) + '%', sub: '访客→订单', color: '8B5CF6' },
      { label: '客单价', value: '$' + data.avgAov.toFixed(2), sub: '人均消费', color: 'F59E0B' },
      { label: '综合差评率', value: data.avgReviewRate.toFixed(2) + '%', sub: '差评比例', color: data.avgReviewRate > 5 ? 'EF4444' : '10B981' }
    ];
    metrics.forEach(function(m, i) {
      var row = Math.floor(i / 3);
      var col = i % 3;
      _addMetricCard(pptx, s, 0.6 + col * 3.05, 1.4 + row * 1.8, 2.9, 1.5, m.label, m.value, m.color, m.sub);
    });
    s.addText('* 指标来自 ' + data.shopCount + ' 家店铺的合并统计，周期 ' + data.daysCount + ' 天', { x: 0.6, y: 5.6, w: 9, h: 0.3, fontSize: 9, color: '94A3B8', italic: true });

    // P3: 各店铺明细
    s = _addContentSlide(pptx, '🏪 各店铺指标明细', '1890FF');
    if (data.shops.length > 0) {
      var headerRow = ['店铺名称', '营收($)', '订单', '访客', '转化率', '退款率', '差评率'];
      var rows = data.shops.map(function(shop) {
        return [(shop.shop && shop.shop.name) || shop.shop.id, _fmt(shop.revenue), _fmt(shop.orderCount), _fmt(shop.visitors), shop.conversion.toFixed(2) + '%', shop.refundRate.toFixed(1) + '%', shop.reviewRate.toFixed(2) + '%'];
      });
      s.addTable([headerRow].concat(rows), { x: 0.6, y: 1.3, w: 8.8, fontSize: 11, colW: [2.0, 1.1, 0.9, 0.9, 1.0, 1.0, 0.9], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    } else {
      s.addText('本周期暂无店铺数据', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
    }

    // P4: 热销款式
    s = _addContentSlide(pptx, '🔥 热销款式 TOP20', '1890FF');
    var allSkus = [];
    data.shops.forEach(function(sh) { (sh.topSkus || []).forEach(function(sk) { allSkus.push(sk); }); });
    allSkus.sort(function(a, b) { return b.amount - a.amount; });
    var top20 = allSkus.slice(0, 20);
    if (top20.length > 0) {
      var skuHeader = ['排名', '货号(SKU)', '销量', '销售额'];
      var skuRows = top20.map(function(t, i) { return [(i + 1).toString(), t.sku, _fmt(t.qty) + ' 单', '$' + _fmt(t.amount)]; });
      s.addTable([skuHeader].concat(skuRows), { x: 0.5, y: 1.1, w: 9, fontSize: 10, colW: [0.8, 3.5, 2.0, 2.7], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.32, autoPage: false });
    } else {
      s.addText('本周期暂无订单数据', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
    }

    // P5: 退款分析
    s = _addContentSlide(pptx, '💸 退款数据 & 原因分析', 'EF4444');
    if (data.totalRefundAmt > 0) {
      var refundSkuList = [];
      var allRefundReasons = {};
      data.shops.forEach(function(sh) {
        (sh.refundTopSkus || []).forEach(function(sk) { refundSkuList.push(sk); });
        Object.keys(sh.refundReasons || {}).forEach(function(reason) {
          if (!allRefundReasons[reason]) allRefundReasons[reason] = { qty: 0, amount: 0 };
          allRefundReasons[reason].qty += sh.refundReasons[reason].qty;
          allRefundReasons[reason].amount += sh.refundReasons[reason].amount;
        });
      });
      refundSkuList.sort(function(a, b) { return b.amount - a.amount; });
      var topRefundSkus = refundSkuList.slice(0, 10);
      var refundReasonList = Object.entries(allRefundReasons).sort(function(a, b) { return b[1].amount - a[1].amount; }).slice(0, 5);
      // 退款汇总
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.1, w: 9, h: 0.8, fill: { color: 'FEF2F2' }, line: { color: 'FECACA', width: 0.5 }, rectRadius: 0.05 });
      s.addText('退款总额：$' + data.totalRefundAmt.toFixed(2) + '  ·  ' + data.totalRefundQty + ' 件  ·  退款率：' + (data.totalRevenue > 0 ? (data.totalRefundAmt / data.totalRevenue * 100).toFixed(2) : '0') + '%', { x: 0.7, y: 1.2, w: 8.6, h: 0.6, fontSize: 14, bold: true, color: '991B1B' });

      // 退款原因表
      if (refundReasonList.length > 0) {
        s.addText('退款原因 TOP5', { x: 0.5, y: 2.1, w: 4, h: 0.3, fontSize: 12, bold: true, color: 'EF4444' });
        s.addTable([['原因', '件数', '金额']].concat(refundReasonList.map(function(entry) { return [entry[0], entry[1].qty + '件', '$' + entry[1].amount.toFixed(0)]; })), { x: 0.5, y: 2.45, w: 4.4, fontSize: 9, colW: [2.2, 1.0, 1.2], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.28, autoPage: false });
      }
      // 退款 TOP10 款式
      if (topRefundSkus.length > 0) {
        s.addText('退款 TOP10 款式', { x: 5.0, y: 2.1, w: 4.5, h: 0.3, fontSize: 12, bold: true, color: 'EF4444' });
        s.addTable([['SKU', '次数', '金额']].concat(topRefundSkus.map(function(t) { return [t.sku, t.count, '$' + t.amount.toFixed(0)]; })), { x: 5.0, y: 2.45, w: 4.5, fontSize: 9, colW: [2.2, 1.0, 1.3], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.28, autoPage: false });
      }
    } else {
      s.addText('本周期无退款数据', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
    }

    // P6: 尺码偏差分析
    s = _addContentSlide(pptx, '📏 尺码偏差分析（偏大/偏小）', '7C3AED');
    var totalSmall = 0, totalLarge = 0;
    data.shops.forEach(function(sh) {
      if (sh.sizeDeviation) { totalSmall += sh.sizeDeviation.small || 0; totalLarge += sh.sizeDeviation.large || 0; }
    });
    var totalDev = totalSmall + totalLarge;
    if (totalDev > 0) {
      // 统计概览
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.1, w: 4.3, h: 1.5, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE', width: 0.5 }, rectRadius: 0.05 });
      s.addText('尺码偏差总条数', { x: 0.7, y: 1.2, w: 4, h: 0.3, fontSize: 11, color: '6B7280' });
      s.addText(totalDev + ' 条', { x: 0.7, y: 1.5, w: 4, h: 0.6, fontSize: 28, bold: true, color: '1E3A8A' });
      s.addShape(pptx.ShapeType.rect, { x: 2.6, y: 1.2, w: 0.05, h: 1.3, fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB', width: 0 } });
      s.addText('偏小 ' + totalSmall + ' / 偏大 ' + totalLarge, { x: 0.7, y: 2.15, w: 4, h: 0.4, fontSize: 11, color: '6B7280' });
      // 偏大偏小趋势
      s.addShape(pptx.ShapeType.roundRect, { x: 5.0, y: 1.1, w: 4.5, h: 1.5, fill: { color: 'FEF3C7' }, line: { color: 'FDE68A', width: 0.5 }, rectRadius: 0.05 });
      s.addText('📊 偏差占比', { x: 5.2, y: 1.2, w: 4, h: 0.3, fontSize: 11, color: '92400E' });
      s.addText('偏小 ' + (totalDev > 0 ? (totalSmall / totalDev * 100).toFixed(0) : 0) + '%', { x: 5.2, y: 1.5, w: 2, h: 0.6, fontSize: 22, bold: true, color: totalSmall > totalLarge ? 'DC2626' : '1F2937' });
      s.addText('偏大 ' + (totalDev > 0 ? (totalLarge / totalDev * 100).toFixed(0) : 0) + '%', { x: 7.2, y: 1.5, w: 2, h: 0.6, fontSize: 22, bold: true, color: totalLarge > totalSmall ? 'DC2626' : '1F2937' });
      s.addText(totalSmall > totalLarge ? '⚠️ 尺码偏小为主，建议放大尺码表 0.5-1cm' : (totalLarge > totalSmall ? '⚠️ 尺码偏大为主，建议缩小尺码表 0.5-1cm' : '✅ 偏差均衡，尺码表标准合理'), { x: 5.2, y: 2.15, w: 4.2, h: 0.4, fontSize: 10, color: '92400E' });

      // 款式尺码偏差 TOP10
      var skuDevList = [];
      data.shops.forEach(function(sh) {
        if (sh.sizeDeviation && sh.sizeDeviation.bySku) {
          Object.keys(sh.sizeDeviation.bySku).forEach(function(sku) {
            var v = sh.sizeDeviation.bySku[sku];
            if (v.small + v.large > 0) skuDevList.push({ sku: sku, small: v.small, large: v.large, total: v.small + v.large });
          });
        }
      });
      skuDevList.sort(function(a, b) { return b.total - a.total; });
      var topDev = skuDevList.slice(0, 10);
      if (topDev.length > 0) {
        s.addTable([['款式', '偏小', '偏大', '合计', '倾向']].concat(topDev.map(function(t) {
          var tend = t.small > t.large ? '偏小' : (t.large > t.small ? '偏大' : '均衡');
          return [t.sku, t.small + '件', t.large + '件', t.total + '件', tend];
        })), { x: 0.5, y: 2.85, w: 9, fontSize: 9, colW: [3, 1.2, 1.2, 1.2, 2.4], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.28, autoPage: false });
      }
    } else {
      s.addText('本周期无尺码偏差数据', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
    }

    // P7: 差评分析
    s = _addContentSlide(pptx, '⭐ 差评率分析', 'F59E0B');
    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.1, w: 4.3, h: 1.5, fill: { color: 'FEF3C7' }, line: { color: 'FDE68A', width: 0.5 }, rectRadius: 0.05 });
    s.addText('综合差评率', { x: 0.7, y: 1.2, w: 4, h: 0.3, fontSize: 11, color: '92400E' });
    s.addText(data.avgReviewRate.toFixed(2) + '%', { x: 0.7, y: 1.5, w: 4, h: 0.7, fontSize: 32, bold: true, color: data.avgReviewRate > 5 ? 'DC2626' : (data.avgReviewRate > 2 ? 'D97706' : '16A34A') });
    var reviewStatus = data.avgReviewRate > 5 ? '⚠️ 严重超标' : (data.avgReviewRate > 2 ? '⚡ 需关注' : '✅ 健康');
    s.addText(reviewStatus, { x: 0.7, y: 2.2, w: 4, h: 0.3, fontSize: 12, color: '92400E' });
    s.addText('已录入：' + (data.shops.reduce(function(s, sh) { return s + (sh.reviewCount || 0); }, 0)) + ' 条差评记录', { x: 5.0, y: 1.3, w: 4.5, h: 0.3, fontSize: 11, color: '6B7280' });

    // 每日差评率波动
    var allReviews = [];
    data.shops.forEach(function(sh) { (sh.reviewDaily || []).forEach(function(r) { allReviews.push(r); }); });
    allReviews.sort(function(a, b) { return a.date.localeCompare(b.date); });
    var reviewPeak = allReviews.reduce(function(b, r) { return (!b || r.rate > b.rate) ? r : b; }, null);
    var reviewLow = allReviews.reduce(function(b, r) { return (!b || r.rate < b.rate) ? r : b; }, null);
    if (reviewPeak || reviewLow) {
      s.addText('📈 差评率波动（按天）', { x: 0.5, y: 2.9, w: 9, h: 0.3, fontSize: 12, bold: true, color: 'F59E0B' });
      s.addText('峰值：' + (reviewPeak ? reviewPeak.date + '（' + reviewPeak.rate.toFixed(2) + '%）' : '-') + '  |  谷值：' + (reviewLow ? reviewLow.date + '（' + reviewLow.rate.toFixed(2) + '%）' : '-'), { x: 0.5, y: 3.2, w: 9, h: 0.3, fontSize: 11, color: '4B5563' });
    }
    // 差评率建议
    var reviewTip = '';
    if (data.avgReviewRate > 5) reviewTip = '🚨 差评率严重超标！建议立即：① 排查差评内容（质量/尺码/物流/客服） ② 重点款式品控 ③ 工厂整改 ④ 必要时下架低分链接';
    else if (data.avgReviewRate > 2) reviewTip = '⚠️ 差评率偏高，需关注：① 持续监控 ② 逐日分析差评关键词 ③ 主动联系差评用户了解原因';
    else if (data.avgReviewRate > 0) reviewTip = '✅ 差评率健康：继续保持产品/服务质量，主动邀评提升整体评价';
    else reviewTip = '📝 暂无差评数据，建议主动邀评并关注用户反馈';
    s.addText(reviewTip, { x: 0.5, y: 3.7, w: 9, h: 1.2, fontSize: 11, color: '4B5563', lineSpacing: 16 });

    // P8: 趋势归因 + 建议
    s = _addContentSlide(pptx, '💡 整体趋势归因 & 优化建议', '1890FF');
    var insights = generateInsights(data, fromDate, toDate);
    insights.forEach(function(it, i) {
      var y = 1.1 + i * 0.72;
      if (y + 0.65 > 7.0) return;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: y, w: 9, h: 0.65, fill: { color: 'F9FAFB' }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05 });
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: y, w: 0.1, h: 0.65, fill: { color: '1890FF' }, line: { color: '1890FF', width: 0 } });
      s.addText('▸ ' + it.title, { x: 0.75, y: y + 0.05, w: 8.6, h: 0.25, fontSize: 11, bold: true, color: '1F2937' });
      s.addText(it.content, { x: 0.75, y: y + 0.3, w: 8.6, h: 0.35, fontSize: 9, color: '4B5563', lineSpacing: 12 });
    });
    // V159: 掉量分析 + 好评差评
    _addDropAnalysisSlide(pptx, data);
    _addReviewSplitSlide(pptx, data);
  };

  // ===== 模板 2：数据分析报告（深蓝商务） =====
  TEMPLATES.analysis = function(pptx, data, fromDate, toDate) {

    // P1: 封面（深蓝渐变）
    var s = pptx.addSlide();
    s.background = { fill: '0F1B3D' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 6.8, w: 10, h: 0.7, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('数据分析报告', { x: 0.5, y: 1.5, w: 9, h: 1.2, fontSize: 54, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Microsoft YaHei' });
    s.addText('Data Analytics Report', { x: 0.5, y: 2.7, w: 9, h: 0.5, fontSize: 18, color: '93C5FD', align: 'center' });
    s.addShape(pptx.ShapeType.rect, { x: 4.5, y: 3.5, w: 1, h: 0.05, fill: { color: '60A5FA' }, line: { color: '60A5FA', width: 0 } });
    s.addText('周期：' + fromDate + ' ~ ' + toDate, { x: 0.5, y: 4.0, w: 9, h: 0.4, fontSize: 14, color: 'CBD5E1', align: 'center' });
    s.addText(data.shopCount + ' 家店铺  ·  ' + data.daysCount + ' 天数据  ·  生成于 ' + _today(), { x: 0.5, y: 4.5, w: 9, h: 0.4, fontSize: 12, color: '94A3B8', align: 'center' });

    // P2: 目录
    s = pptx.addSlide();
    s.background = { fill: 'F8FAFC' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('CONTENTS', { x: 0.6, y: 0.5, w: 9, h: 0.5, fontSize: 14, color: '6B7280', charSpacing: 4 });
    s.addText('目  录', { x: 0.6, y: 0.9, w: 9, h: 0.8, fontSize: 36, bold: true, color: '1E3A8A' });
    var toc = ['01  核心指标速览', '02  店铺表现分析', '03  平台对比', '04  热销款式 TOP10', '05  退款与差评', '06  优化建议'];
    toc.forEach(function(item, i) {
      var y = 2.2 + i * 0.65;
      s.addText(item, { x: 0.6, y: y, w: 8, h: 0.4, fontSize: 18, color: '1F2937' });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.45, w: 7, h: 0.02, fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB', width: 0 } });
    });

    // P3: 核心指标（深色风）
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('核心指标速览', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    s.addText('Key Performance Indicators', { x: 0.6, y: 1.0, w: 9, h: 0.3, fontSize: 11, color: '6B7280' });
    var metrics = [
      { label: '总营收', value: '$' + _fmt(data.totalRevenue), color: '1E3A8A' },
      { label: '总订单', value: _fmt(data.totalOrders), color: '0891B2' },
      { label: '总访客', value: _fmt(data.totalVisitors), color: '7C3AED' },
      { label: '综合转化率', value: data.avgConversion.toFixed(2) + '%', color: '059669' },
      { label: '客单价', value: '$' + data.avgAov.toFixed(2), color: 'D97706' },
      { label: '综合差评率', value: data.avgReviewRate.toFixed(2) + '%', color: data.avgReviewRate > 5 ? 'DC2626' : '059669' }
    ];
    metrics.forEach(function(m, i) {
      var row = Math.floor(i / 3);
      var col = i % 3;
      var x = 0.6 + col * 3.05, y = 1.7 + row * 2.5;
      s.addShape(pptx.ShapeType.roundRect, { x: x, y: y, w: 2.9, h: 2.2, fill: { color: 'F8FAFC' }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.1 });
      s.addText(m.label, { x: x + 0.2, y: y + 0.3, w: 2.5, h: 0.3, fontSize: 12, color: '6B7280' });
      s.addText(m.value, { x: x + 0.2, y: y + 0.7, w: 2.5, h: 0.8, fontSize: 28, bold: true, color: m.color });
    });

    // P4: 店铺明细
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('各店铺表现分析', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    if (data.shops.length > 0) {
      var headerRow = ['店铺', '营收($)', '订单', '访客', '转化率', '退款率', '差评率'];
      var rows = data.shops.map(function(shop) { return [(shop.shop && shop.shop.name) || shop.shop.id, _fmt(shop.revenue), _fmt(shop.orderCount), _fmt(shop.visitors), shop.conversion.toFixed(2) + '%', shop.refundRate.toFixed(1) + '%', shop.reviewRate.toFixed(2) + '%']; });
      s.addTable([headerRow].concat(rows), { x: 0.6, y: 1.4, w: 8.8, fontSize: 10, colW: [1.6, 1.1, 0.9, 0.9, 1.0, 1.0, 0.9], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }

    // P5: 平台对比
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('平台对比分析', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    var platMap = {};
    data.shops.forEach(function(s) { var p = (s.shop && s.shop.platform) || '其他'; if (!platMap[p]) platMap[p] = { rev: 0, orders: 0 }; platMap[p].rev += s.revenue; platMap[p].orders += s.orderCount; });
    var platArr = Object.keys(platMap).map(function(k) { return { name: k, rev: platMap[k].rev, orders: platMap[k].orders }; }).sort(function(a, b) { return b.rev - a.rev; });
    if (platArr.length > 0) {
      s.addTable([['平台', '营收($)', '订单量', '占比']].concat(platArr.map(function(p) { return [p.name, _fmt(p.rev), _fmt(p.orders), (p.rev / data.totalRevenue * 100).toFixed(1) + '%']; })), { x: 0.6, y: 1.4, w: 8.8, fontSize: 11, colW: [2.5, 2, 2, 2.3], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }

    // P6: 热销 TOP10
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('热销款式 TOP10', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    var allSkus2 = [];
    data.shops.forEach(function(sh) { (sh.topSkus || []).forEach(function(sk) { allSkus2.push(sk); }); });
    allSkus2.sort(function(a, b) { return b.amount - a.amount; });
    var top10b = allSkus2.slice(0, 10);
    if (top10b.length > 0) {
      s.addTable([['排名', '货号(SKU)', '销量', '销售额']].concat(top10b.map(function(t, i) { return [(i + 1).toString(), t.sku, _fmt(t.qty) + ' 单', '$' + _fmt(t.amount)]; })), { x: 0.6, y: 1.4, w: 8.8, fontSize: 11, colW: [1.0, 3.5, 2.0, 2.3], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }

    // P7: 退款与差评
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('退款与差评分析', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    var refundRows = data.shops.filter(function(s) { return s.refundQty > 0 || s.reviewCount > 0; }).map(function(s) { return [(s.shop && s.shop.name) || s.shop.id, '$' + s.refundAmt.toFixed(2), s.refundQty + '件', s.refundRate.toFixed(1) + '%', s.reviewRate.toFixed(2) + '%']; });
    if (refundRows.length > 0) {
      s.addTable([['店铺', '退款金额', '退款件数', '退款率', '差评率']].concat(refundRows), { x: 0.6, y: 1.4, w: 8.8, fontSize: 11, colW: [2.5, 1.5, 1.5, 1.5, 1.8], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    } else {
      s.addText('本周期无退款/差评数据', { x: 1, y: 3, w: 8, h: 0.5, fontSize: 14, color: '9CA3AF', align: 'center' });
    }

    // P8: 优化建议
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.3, h: 7.5, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
    s.addText('优化建议', { x: 0.6, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: '1E3A8A' });
    var insights = generateInsights(data, fromDate, toDate);
    insights.forEach(function(it, i) {
      var y = 1.3 + i * 1.1;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: y, w: 8.8, h: 0.95, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE', width: 0.5 }, rectRadius: 0.05 });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y, w: 0.1, h: 0.95, fill: { color: '1E3A8A' }, line: { color: '1E3A8A', width: 0 } });
      s.addText('▸ ' + it.title, { x: 0.85, y: y + 0.08, w: 8.4, h: 0.3, fontSize: 12, bold: true, color: '1E3A8A' });
      s.addText(it.content, { x: 0.85, y: y + 0.4, w: 8.4, h: 0.5, fontSize: 10, color: '374151', lineSpacing: 14 });
    });
    // V159: 掉量分析 + 好评差评
    _addDropAnalysisSlide(pptx, data);
    _addReviewSplitSlide(pptx, data);
  };

  // ===== 模板 3：经营分析报告（高端深色） =====
  TEMPLATES.executive = function(pptx, data, fromDate, toDate) {

    // P1: 封面（深色高端）
    var s = pptx.addSlide();
    s.background = { fill: '0B1226' };
    // 装饰线
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.35, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    // 顶部 logo 占位
    s.addText('EXEC.', { x: 0.6, y: 0.5, w: 2, h: 0.5, fontSize: 18, bold: true, color: 'F59E0B', charSpacing: 3 });
    s.addText('EXECUTIVE BRIEFING', { x: 0.6, y: 1.0, w: 4, h: 0.3, fontSize: 10, color: '94A3B8', charSpacing: 4 });
    s.addText('经营分析报告', { x: 0.6, y: 2.5, w: 9, h: 1.2, fontSize: 60, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
    s.addText('EXECUTIVE ANALYSIS', { x: 0.6, y: 3.7, w: 9, h: 0.5, fontSize: 18, color: 'F59E0B', charSpacing: 6 });
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.5, w: 0.8, h: 0.05, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    // 元信息
    s.addText('报告周期：' + fromDate + ' ~ ' + toDate, { x: 0.6, y: 5.0, w: 5, h: 0.3, fontSize: 13, color: 'CBD5E1' });
    s.addText('覆盖店铺：' + data.shopCount + ' 家', { x: 0.6, y: 5.4, w: 5, h: 0.3, fontSize: 13, color: 'CBD5E1' });
    s.addText('生成时间：' + _today(), { x: 0.6, y: 5.8, w: 5, h: 0.3, fontSize: 13, color: 'CBD5E1' });
    s.addText('CLASSIFIED · INTERNAL', { x: 7, y: 5.0, w: 2.5, h: 0.3, fontSize: 10, color: '94A3B8', align: 'right', charSpacing: 3 });
    s.addText('管理层专阅', { x: 7, y: 5.4, w: 2.5, h: 0.3, fontSize: 12, color: 'F59E0B', align: 'right' });

    // P2: 关键数据
    s = pptx.addSlide();
    s.background = { fill: '0B1226' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addText('KEY METRICS  ·  关键数据', { x: 0.6, y: 0.5, w: 9, h: 0.4, fontSize: 12, color: '94A3B8', charSpacing: 4 });
    s.addText('本期经营概览', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' });
    // 2x3 大指标
    var bigMetrics = [
      { label: '总营收', value: '$' + _fmt(data.totalRevenue), color: 'F59E0B' },
      { label: '总订单', value: _fmt(data.totalOrders), color: '10B981' },
      { label: '总访客', value: _fmt(data.totalVisitors), color: '06B6D4' },
      { label: '综合转化率', value: data.avgConversion.toFixed(2) + '%', color: '8B5CF6' },
      { label: '客单价', value: '$' + data.avgAov.toFixed(2), color: 'EC4899' },
      { label: '差评率', value: data.avgReviewRate.toFixed(2) + '%', color: data.avgReviewRate > 5 ? 'EF4444' : '10B981' }
    ];
    bigMetrics.forEach(function(m, i) {
      var row = Math.floor(i / 3);
      var col = i % 3;
      var x = 0.5 + col * 3.05, y = 2.0 + row * 2.3;
      s.addShape(pptx.ShapeType.roundRect, { x: x, y: y, w: 2.9, h: 2.0, fill: { color: '111B30' }, line: { color: '1F2937', width: 0.5 }, rectRadius: 0.05 });
      s.addText(m.label, { x: x + 0.2, y: y + 0.3, w: 2.5, h: 0.3, fontSize: 11, color: '94A3B8' });
      s.addText(m.value, { x: x + 0.2, y: y + 0.7, w: 2.5, h: 0.9, fontSize: 28, bold: true, color: m.color });
    });
    s.addText('* 包含 ' + data.shopCount + ' 家店铺 / ' + data.daysCount + ' 天数据', { x: 0.6, y: 6.8, w: 9, h: 0.3, fontSize: 9, color: '64748B', italic: true });

    // P3: 店铺分析（深色）
    s = pptx.addSlide();
    s.background = { fill: '0B1226' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addText('SHOPS ANALYSIS  ·  店铺分析', { x: 0.6, y: 0.5, w: 9, h: 0.4, fontSize: 12, color: '94A3B8', charSpacing: 4 });
    s.addText('各店铺关键表现', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' });
    if (data.shops.length > 0) {
      var headerRow = ['店铺', '营收($)', '订单', '访客', '转化', '退款率', '差评率'];
      var rows = data.shops.map(function(shop) { return [(shop.shop && shop.shop.name) || shop.shop.id, _fmt(shop.revenue), _fmt(shop.orderCount), _fmt(shop.visitors), shop.conversion.toFixed(2) + '%', shop.refundRate.toFixed(1) + '%', shop.reviewRate.toFixed(2) + '%']; });
      s.addTable([headerRow].concat(rows), { x: 0.6, y: 1.7, w: 8.8, fontSize: 11, colW: [1.6, 1.1, 0.9, 0.9, 1.0, 1.0, 0.9], border: { type: 'solid', color: '1F2937', pt: 0.5 }, rowH: 0.45, autoPage: false, color: 'FFFFFF', fill: { color: '111B30' } });
    }

    // P4: 建议（深色）
    s = pptx.addSlide();
    s.background = { fill: '0B1226' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addText('RECOMMENDATIONS  ·  行动建议', { x: 0.6, y: 0.5, w: 9, h: 0.4, fontSize: 12, color: '94A3B8', charSpacing: 4 });
    s.addText('管理层决策依据', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' });
    var insights = generateInsights(data, fromDate, toDate);
    insights.forEach(function(it, i) {
      var y = 1.7 + i * 1.0;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: y, w: 8.8, h: 0.85, fill: { color: '111B30' }, line: { color: '1F2937', width: 0.5 }, rectRadius: 0.05 });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y, w: 0.1, h: 0.85, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
      s.addText('▸ ' + it.title, { x: 0.85, y: y + 0.08, w: 8.4, h: 0.3, fontSize: 12, bold: true, color: 'F59E0B' });
      s.addText(it.content, { x: 0.85, y: y + 0.4, w: 8.4, h: 0.45, fontSize: 10, color: 'CBD5E1', lineSpacing: 14 });
    });

    // P5: 结语
    s = pptx.addSlide();
    s.background = { fill: '0B1226' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.15, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addText('THANK YOU', { x: 0.5, y: 3.0, w: 9, h: 1.0, fontSize: 60, bold: true, color: 'FFFFFF', align: 'center', charSpacing: 8 });
    s.addText('— 本报告由店铺管理系统自动生成 —', { x: 0.5, y: 4.5, w: 9, h: 0.4, fontSize: 14, color: '94A3B8', align: 'center' });
    s.addText(_today(), { x: 0.5, y: 5.0, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
  };

  // ===== 模板 4：月度经营复盘（紫色高级） =====
  TEMPLATES.monthly = function(pptx, data, fromDate, toDate) {
    // P1: 封面
    var s = pptx.addSlide();
    s.background = { fill: 'FAF5FF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 4, h: 7.5, fill: { color: '6D28D9' }, line: { color: '6D28D9', width: 0 } });
    s.addText('MONTHLY', { x: 0.5, y: 2.5, w: 3, h: 0.5, fontSize: 16, color: 'FCD34D', charSpacing: 6 });
    s.addText('REVIEW', { x: 0.5, y: 2.9, w: 3, h: 0.5, fontSize: 16, color: 'FCD34D', charSpacing: 6 });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.6, w: 0.6, h: 0.05, fill: { color: 'FCD34D' }, line: { color: 'FCD34D', width: 0 } });
    s.addText('月度经营', { x: 0.5, y: 3.8, w: 3, h: 0.5, fontSize: 30, bold: true, color: 'FFFFFF' });
    s.addText('复盘', { x: 0.5, y: 4.3, w: 3, h: 0.5, fontSize: 30, bold: true, color: 'FFFFFF' });
    s.addText(fromDate + ' ~ ' + toDate, { x: 0.5, y: 5.4, w: 3, h: 0.4, fontSize: 11, color: 'E9D5FF' });
    s.addText(data.shopCount + ' 家店铺  ·  ' + data.daysCount + ' 天', { x: 0.5, y: 5.7, w: 3, h: 0.4, fontSize: 11, color: 'E9D5FF' });
    s.addText('生成：' + _today(), { x: 0.5, y: 6.0, w: 3, h: 0.4, fontSize: 10, color: 'C4B5FD' });
    // 右侧大标题
    s.addText('从数据到决策', { x: 4.5, y: 2.8, w: 5, h: 1, fontSize: 36, bold: true, color: '4C1D95' });
    s.addText('From Data to Decision', { x: 4.5, y: 3.8, w: 5, h: 0.5, fontSize: 14, color: '7C3AED' });
    s.addShape(pptx.ShapeType.rect, { x: 4.5, y: 4.5, w: 1, h: 0.05, fill: { color: '7C3AED' }, line: { color: '7C3AED', width: 0 } });
    s.addText('Monthly Operating Review', { x: 4.5, y: 4.7, w: 5, h: 0.3, fontSize: 10, color: '6B7280', charSpacing: 3 });

    // P2-P5: 复用 analysis 模板（白色风）
    // 指标
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.4, fill: { color: '6D28D9' }, line: { color: '6D28D9', width: 0 } });
    s.addText('📅 月度核心指标', { x: 0.5, y: 0.05, w: 9, h: 0.3, fontSize: 12, color: 'FFFFFF', bold: true });
    s.addText('Monthly KPI', { x: 0.6, y: 0.7, w: 9, h: 0.6, fontSize: 24, bold: true, color: '4C1D95' });
    var metrics = [
      { label: '月度总营收', value: '$' + _fmt(data.totalRevenue), color: '6D28D9' },
      { label: '总订单数', value: _fmt(data.totalOrders), color: 'C026D3' },
      { label: '总访客数', value: _fmt(data.totalVisitors), color: 'DB2777' },
      { label: '综合转化率', value: data.avgConversion.toFixed(2) + '%', color: '7C3AED' },
      { label: '客单价', value: '$' + data.avgAov.toFixed(2), color: 'A21CAF' },
      { label: '综合差评率', value: data.avgReviewRate.toFixed(2) + '%', color: data.avgReviewRate > 5 ? 'DC2626' : '16A34A' }
    ];
    metrics.forEach(function(m, i) {
      var row = Math.floor(i / 3);
      var col = i % 3;
      _addMetricCard(pptx, s, 0.6 + col * 3.05, 1.7 + row * 1.8, 2.9, 1.5, m.label, m.value, m.color);
    });

    // 店铺分析
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.4, fill: { color: '6D28D9' }, line: { color: '6D28D9', width: 0 } });
    s.addText('🏪 店铺表现 & 平台对比', { x: 0.5, y: 0.05, w: 9, h: 0.3, fontSize: 12, color: 'FFFFFF', bold: true });
    s.addText('店铺表现 & 平台对比', { x: 0.6, y: 0.7, w: 9, h: 0.5, fontSize: 22, bold: true, color: '4C1D95' });
    if (data.shops.length > 0) {
      var headerRow = ['店铺', '营收($)', '订单', '访客', '转化率', '退款率', '差评率'];
      var rows = data.shops.map(function(shop) { return [(shop.shop && shop.shop.name) || shop.shop.id, _fmt(shop.revenue), _fmt(shop.orderCount), _fmt(shop.visitors), shop.conversion.toFixed(2) + '%', shop.refundRate.toFixed(1) + '%', shop.reviewRate.toFixed(2) + '%']; });
      s.addTable([headerRow].concat(rows), { x: 0.6, y: 1.4, w: 8.8, fontSize: 10, colW: [1.6, 1.1, 0.9, 0.9, 1.0, 1.0, 0.9], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }
    // 平台对比
    var platMap = {};
    data.shops.forEach(function(sh) { var p = (sh.shop && sh.shop.platform) || '其他'; if (!platMap[p]) platMap[p] = { rev: 0, orders: 0 }; platMap[p].rev += sh.revenue; platMap[p].orders += sh.orderCount; });
    var platArr = Object.keys(platMap).map(function(k) { return { name: k, rev: platMap[k].rev, orders: platMap[k].orders }; }).sort(function(a, b) { return b.rev - a.rev; });
    if (platArr.length > 0) {
      s.addText('📊 平台对比', { x: 0.6, y: 4.0, w: 9, h: 0.4, fontSize: 14, bold: true, color: '4C1D95' });
      s.addTable([['平台', '营收($)', '订单', '占比']].concat(platArr.map(function(p) { return [p.name, _fmt(p.rev), _fmt(p.orders), (p.rev / data.totalRevenue * 100).toFixed(1) + '%']; })), { x: 0.6, y: 4.4, w: 8.8, fontSize: 10, colW: [2.5, 2, 2, 2.3], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }

    // 建议
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.4, fill: { color: '6D28D9' }, line: { color: '6D28D9', width: 0 } });
    s.addText('💡 月度复盘 & 行动建议', { x: 0.5, y: 0.05, w: 9, h: 0.3, fontSize: 12, color: 'FFFFFF', bold: true });
    s.addText('月度复盘 & 行动建议', { x: 0.6, y: 0.7, w: 9, h: 0.5, fontSize: 22, bold: true, color: '4C1D95' });
    var insights = generateInsights(data, fromDate, toDate);
    insights.forEach(function(it, i) {
      var y = 1.4 + i * 1.1;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: y, w: 8.8, h: 0.95, fill: { color: 'FAF5FF' }, line: { color: 'E9D5FF', width: 0.5 }, rectRadius: 0.05 });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y, w: 0.1, h: 0.95, fill: { color: '6D28D9' }, line: { color: '6D28D9', width: 0 } });
      s.addText('▸ ' + it.title, { x: 0.85, y: y + 0.08, w: 8.4, h: 0.3, fontSize: 12, bold: true, color: '4C1D95' });
      s.addText(it.content, { x: 0.85, y: y + 0.4, w: 8.4, h: 0.5, fontSize: 10, color: '374151', lineSpacing: 14 });
    });
  };

  // ===== 模板 5：季度战略复盘（紫蓝渐变） =====
  TEMPLATES.quarterly = function(pptx, data, fromDate, toDate) {
    // P1: 封面
    var s = pptx.addSlide();
    s.background = { fill: '1E1B4B' };
    // 装饰渐变
    s.addShape(pptx.ShapeType.ellipse, { x: 7, y: -2, w: 6, h: 6, fill: { color: '7C3AED', transparency: 50 }, line: { type: 'none' } });
    s.addShape(pptx.ShapeType.ellipse, { x: -2, y: 4, w: 5, h: 5, fill: { color: '3B82F6', transparency: 50 }, line: { type: 'none' } });
    s.addText('QUARTERLY', { x: 0.6, y: 1.5, w: 9, h: 0.5, fontSize: 18, color: 'F59E0B', charSpacing: 8 });
    s.addText('战略复盘', { x: 0.6, y: 2.5, w: 9, h: 1.5, fontSize: 72, bold: true, color: 'FFFFFF', fontFace: 'Microsoft YaHei' });
    s.addText('STRATEGIC REVIEW', { x: 0.6, y: 4.0, w: 9, h: 0.5, fontSize: 16, color: 'C4B5FD', charSpacing: 6 });
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.8, w: 0.8, h: 0.05, fill: { color: 'F59E0B' }, line: { color: 'F59E0B', width: 0 } });
    s.addText('覆盖：' + data.shopCount + ' 家店铺 / 周期：' + fromDate + ' ~ ' + toDate, { x: 0.6, y: 5.5, w: 9, h: 0.4, fontSize: 13, color: 'C4B5FD' });
    s.addText('生成：' + _today(), { x: 0.6, y: 6.0, w: 9, h: 0.4, fontSize: 12, color: 'A5B4FC' });

    // P2: 核心指标
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.6, fill: { fill: '4F46E5' }, line: { color: '4F46E5', width: 0 } });
    s.addText('🎯 季度战略目标回顾', { x: 0.5, y: 0.15, w: 9, h: 0.3, fontSize: 14, color: 'FFFFFF', bold: true, charSpacing: 2 });
    s.addText('战略核心指标', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 24, bold: true, color: '1E1B4B' });
    var metrics = [
      { label: '季度总营收', value: '$' + _fmt(data.totalRevenue), color: '4F46E5' },
      { label: '总订单数', value: _fmt(data.totalOrders), color: '0EA5E9' },
      { label: '总访客数', value: _fmt(data.totalVisitors), color: '8B5CF6' },
      { label: '综合转化率', value: data.avgConversion.toFixed(2) + '%', color: 'EC4899' },
      { label: '客单价', value: '$' + data.avgAov.toFixed(2), color: 'F59E0B' },
      { label: '综合差评率', value: data.avgReviewRate.toFixed(2) + '%', color: data.avgReviewRate > 5 ? 'EF4444' : '10B981' }
    ];
    metrics.forEach(function(m, i) {
      var row = Math.floor(i / 3);
      var col = i % 3;
      _addMetricCard(pptx, s, 0.6 + col * 3.05, 1.8 + row * 1.8, 2.9, 1.5, m.label, m.value, m.color);
    });

    // 平台 + 店铺
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.6, fill: { fill: '4F46E5' }, line: { color: '4F46E5', width: 0 } });
    s.addText('🌍 平台对比 & 店铺分析', { x: 0.5, y: 0.15, w: 9, h: 0.3, fontSize: 14, color: 'FFFFFF', bold: true, charSpacing: 2 });
    s.addText('平台 & 店铺分析', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 22, bold: true, color: '1E1B4B' });
    // 平台
    var platMap = {};
    data.shops.forEach(function(sh) { var p = (sh.shop && sh.shop.platform) || '其他'; if (!platMap[p]) platMap[p] = { rev: 0, orders: 0 }; platMap[p].rev += sh.revenue; platMap[p].orders += sh.orderCount; });
    var platArr = Object.keys(platMap).map(function(k) { return { name: k, rev: platMap[k].rev, orders: platMap[k].orders }; }).sort(function(a, b) { return b.rev - a.rev; });
    s.addText('📊 平台分布', { x: 0.6, y: 1.6, w: 9, h: 0.3, fontSize: 14, bold: true, color: '4F46E5' });
    if (platArr.length > 0) {
      s.addTable([['平台', '营收($)', '订单', '占比']].concat(platArr.map(function(p) { return [p.name, _fmt(p.rev), _fmt(p.orders), (p.rev / data.totalRevenue * 100).toFixed(1) + '%']; })), { x: 0.6, y: 1.95, w: 8.8, fontSize: 10, colW: [2.5, 2, 2, 2.3], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.4, autoPage: false });
    }
    // 店铺
    s.addText('🏪 店铺排行', { x: 0.6, y: 4.2, w: 9, h: 0.3, fontSize: 14, bold: true, color: '4F46E5' });
    if (data.shops.length > 0) {
      var headerRow = ['店铺', '营收($)', '订单', '访客', '转化', '退款率', '差评率'];
      var rows = data.shops.map(function(shop) { return [(shop.shop && shop.shop.name) || shop.shop.id, _fmt(shop.revenue), _fmt(shop.orderCount), _fmt(shop.visitors), shop.conversion.toFixed(2) + '%', shop.refundRate.toFixed(1) + '%', shop.reviewRate.toFixed(2) + '%']; });
      s.addTable([headerRow].concat(rows), { x: 0.6, y: 4.55, w: 8.8, fontSize: 9, colW: [1.5, 1.1, 0.8, 0.8, 0.9, 0.9, 0.9], border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, rowH: 0.35, autoPage: false });
    }

    // 战略建议
    s = pptx.addSlide();
    s.background = { fill: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.6, fill: { fill: '4F46E5' }, line: { color: '4F46E5', width: 0 } });
    s.addText('💡 战略建议 & 下季规划', { x: 0.5, y: 0.15, w: 9, h: 0.3, fontSize: 14, color: 'FFFFFF', bold: true, charSpacing: 2 });
    s.addText('战略建议 & 下季规划', { x: 0.6, y: 0.9, w: 9, h: 0.5, fontSize: 22, bold: true, color: '1E1B4B' });
    var insights = generateInsights(data, fromDate, toDate);
    insights.forEach(function(it, i) {
      var y = 1.6 + i * 1.1;
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: y, w: 8.8, h: 0.95, fill: { color: 'EEF2FF' }, line: { color: 'C7D2FE', width: 0.5 }, rectRadius: 0.05 });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y, w: 0.1, h: 0.95, fill: { color: '4F46E5' }, line: { color: '4F46E5', width: 0 } });
      s.addText('▸ ' + it.title, { x: 0.85, y: y + 0.08, w: 8.4, h: 0.3, fontSize: 12, bold: true, color: '1E1B4B' });
      s.addText(it.content, { x: 0.85, y: y + 0.4, w: 8.4, h: 0.5, fontSize: 10, color: '374151', lineSpacing: 14 });
    });
  };

  // ===== 4. 导出主函数 =====
  window.exportToPPT = function(shopIds, fromDate, toDate, templateId) {
    var PptxGenJS = window.PptxGenJS;
    if (!PptxGenJS) { showToast('⚠️ PPT生成库未加载', 'error'); return; }
    if (!shopIds || shopIds.length === 0) { showToast('请选择至少一个店铺', 'error'); return; }
    if (!fromDate || !toDate) { showToast('请选择起止日期', 'error'); return; }

    // V163: 显示加载进度弹层（数据收集 + 生成 PPT 可能要 5-15 秒）
    var _loadingModal = _showPPTLoading(shopIds.length);
    var _progTick = 0;
    var _progInterval = setInterval(function() {
      _progTick += 1;
      var stage = _progTick < 3 ? '数据收集中...' : (_progTick < 6 ? '整理分析中...' : '生成 PPT 文件中...');
      var pct = Math.min(95, Math.round(_progTick * 12));
      _updatePPTLoading(pct, stage);
    }, 500);

    // V163: 用 setTimeout 让 UI 喘口气，再同步跑重活
    setTimeout(function() {
      try {
        var data = collectMultiShopData(shopIds, fromDate, toDate);
        if (!data || data.shopCount === 0) {
          clearInterval(_progInterval);
          _closePPTLoading();
          showToast('⚠️ 所选店铺无数据', 'error');
          return;
        }
        _updatePPTLoading(40, '正在生成 PPT（' + data.shopCount + ' 家店铺）...');

        var pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'CUSTOM', w: 10, h: 7.5 });
        pptx.layout = 'CUSTOM';
        pptx.title = '工作汇报 - ' + fromDate + ' ~ ' + toDate;
        pptx.author = '店铺管理系统';

        var tmpl = TEMPLATES[templateId] || TEMPLATES.weekly;
        tmpl(pptx, data, fromDate, toDate);
        _updatePPTLoading(80, '正在写入文件...');

        var name = '工作汇报_' + fromDate + '_' + toDate + '_' + (templateId || 'weekly') + '.pptx';
        pptx.write({ outputType: 'blob' }).then(function(blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(function() { try { URL.revokeObjectURL(url); } catch(e) {} if (a.parentNode) a.parentNode.removeChild(a); }, 3000);
          clearInterval(_progInterval);
          _closePPTLoading();
          showToast('✅ PPT 已导出：' + name, 'success');
        }).catch(function(e) {
          clearInterval(_progInterval);
          _closePPTLoading();
          showToast('⚠️ PPT 导出失败：' + (e.message || '未知错误'), 'error');
        });
      } catch(e) {
        clearInterval(_progInterval);
        _closePPTLoading();
        showToast('⚠️ PPT 生成失败：' + (e.message || '未知错误'), 'error');
        console.error('[PPT] 生成失败:', e);
      }
    }, 80);
  };

  // V163: 加载层控制
  function _showPPTLoading(shopCount) {
    var html = '<div id="__ppt_loading_v163" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:999999;display:flex;align-items:center;justify-content:center">' +
      '<div style="background:#fff;border-radius:14px;padding:28px 36px;min-width:340px;max-width:90vw;box-shadow:0 16px 64px rgba(0,0,0,0.4);text-align:center">' +
        '<div style="font-size:36px;margin-bottom:10px">📑</div>' +
        '<div style="font-size:16px;font-weight:600;color:#1f2937;margin-bottom:4px">正在生成 PPT 工作汇报</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-bottom:18px">共 ' + shopCount + ' 家店铺，请稍候（5-15 秒）</div>' +
        '<div style="background:#f3f4f6;border-radius:8px;overflow:hidden;height:8px;margin-bottom:10px">' +
          '<div id="__ppt_loading_bar" style="background:linear-gradient(90deg,#1890ff,#52c41a);height:100%;width:5%;transition:width .3s ease"></div>' +
        '</div>' +
        '<div id="__ppt_loading_text" style="font-size:12px;color:#6b7280">准备中...</div>' +
      '</div>' +
    '</div>';
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstChild);
    return true;
  }
  function _updatePPTLoading(pct, text) {
    var bar = document.getElementById('__ppt_loading_bar');
    var txt = document.getElementById('__ppt_loading_text');
    if (bar) bar.style.width = (pct || 0) + '%';
    if (txt) txt.textContent = text || ('处理中 ' + (pct || 0) + '%');
  }
  function _closePPTLoading() {
    var el = document.getElementById('__ppt_loading_v163');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ===== 5. 弹窗 =====
  window.openPPTExportModal = function(shopIds, fromDate, toDate) {
    var modal = _id('modal-ppt-export');
    if (modal) { openModal('modal-ppt-export'); return; }

    modal = document.createElement('div');
    modal.id = 'modal-ppt-export';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.onclick = function(e) { if (e.target === modal) closeModal(modal.id); };

    var tmplHtml = window._pptTemplates.map(function(t, i) {
      var colors = ['#1890FF', '#1E3A8A', '#F59E0B', '#6D28D9', '#4F46E5'];
      var color = colors[i % colors.length];
      return '<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #334155;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#1e293b" onclick="document.getElementById(\'ppt-tmpl-\' + \'' + t.id + '\').click()">' +
        '<input type="radio" name="ppt-template" id="ppt-tmpl-' + t.id + '" value="' + t.id + '" ' + (i === 0 ? 'checked' : '') + ' style="margin-top:3px;accent-color:' + color + '">' +
        '<div style="flex:1"><div style="font-size:13px;color:#e2e8f0;font-weight:600">' + t.name + '</div><div style="font-size:11px;color:#64748b;margin-top:2px">' + t.desc + '</div></div>' +
      '</label>';
    }).join('');

    modal.innerHTML = '<div class="modal" style="max-width:520px;width:95%">' +
      '<div class="modal-header"><h3>📑 导出 PPT 汇报</h3><button class="modal-close" onclick="closeModal(\'modal-ppt-export\')">✕</button></div>' +
      '<div class="modal-body" style="padding:16px 20px;max-height:70vh;overflow-y:auto">' +
        '<div class="form-group">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<label style="margin:0">选择店铺（<span id="ppt-shop-count" style="color:#1890ff;font-weight:600">0</span> 家已选）</label>' +
            '<div style="display:flex;gap:6px">' +
              '<button type="button" id="ppt-shop-all" style="padding:3px 8px;border-radius:5px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer">全选</button>' +
              '<button type="button" id="ppt-shop-none" style="padding:3px 8px;border-radius:5px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:11px;cursor:pointer">清空</button>' +
            '</div>' +
          '</div>' +
          '<div id="ppt-shop-picker" style="max-height:180px;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:12px">' +
          '<div class="form-group" style="flex:1"><label>开始日期</label><input type="date" id="ppt-date-from" value="' + (fromDate || '') + '" style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"></div>' +
          '<div class="form-group" style="flex:1"><label>结束日期</label><input type="date" id="ppt-date-to" value="' + (toDate || '') + '" style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:12px">' +
          '<label>快速选周期</label>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
            '<button class="ppt-period-btn" data-days="7" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer">本周</button>' +
            '<button class="ppt-period-btn" data-days="14" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer">近两周</button>' +
            '<button class="ppt-period-btn" data-days="30" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer">月度</button>' +
            '<button class="ppt-period-btn" data-days="90" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:12px;cursor:pointer">季度</button>' +
          '</div>' +
        '</div>' +
        '<div class="form-group"><label>选择模板（5 种可选）</label><div style="margin-top:6px">' + tmplHtml + '</div></div>' +
      '</div>' +
      '<div class="modal-btns" style="padding:12px 20px;border-top:1px solid #334155">' +
        '<button class="btn-secondary" onclick="closeModal(\'modal-ppt-export\')">取消</button>' +
        '<button class="btn-primary" onclick="confirmPPTExport()" style="margin-left:8px">📑 导出 PPT</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);

    var pickerEl = _id('ppt-shop-picker');
    if (pickerEl) {
      var allShops = [];
      try { allShops = DB.getShops() || []; } catch(e) {}
      if (allShops.length === 0) {
        pickerEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#64748b;padding:12px;font-size:12px">暂无店铺</div>';
      } else {
        pickerEl.innerHTML = allShops.map(function(shop) {
          var checked = (!shopIds || shopIds.length === 0 || shopIds.indexOf(shop.id) >= 0) ? 'checked' : '';
          return '<label style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1e293b;border:1px solid #334155;border-radius:6px;cursor:pointer;font-size:12px;color:#e2e8f0">' +
            '<input type="checkbox" class="ppt-shop-cb" data-id="' + shop.id + '" ' + checked + ' style="margin:0;cursor:pointer;accent-color:#1890ff">' +
            '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + (shop.color || '#1890ff') + '"></span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(shop.name) + '</span>' +
            '<span style="color:#64748b;font-size:10px">' + (shop.platform || '') + '</span>' +
          '</label>';
        }).join('');
      }
    }
    function _updateShopCount() {
      var n = document.querySelectorAll('.ppt-shop-cb:checked').length;
      var c = _id('ppt-shop-count');
      if (c) c.textContent = n;
    }
    if (pickerEl) {
      pickerEl.addEventListener('change', _updateShopCount);
      _updateShopCount();
    }
    var allBtn = _id('ppt-shop-all');
    var noneBtn = _id('ppt-shop-none');
    if (allBtn) allBtn.onclick = function() { document.querySelectorAll('.ppt-shop-cb').forEach(function(cb) { cb.checked = true; }); _updateShopCount(); };
    if (noneBtn) noneBtn.onclick = function() { document.querySelectorAll('.ppt-shop-cb').forEach(function(cb) { cb.checked = false; }); _updateShopCount(); };

    setTimeout(function() {
      modal.querySelectorAll('.ppt-period-btn').forEach(function(btn) {
        btn.onclick = function() {
          var days = parseInt(this.getAttribute('data-days'));
          // 以「最后数据日」为统计终点（与总览/掉量分析一致）
          var today = _lastDataDatePPT(window._pptExportShopIds);
          var from = _anchorPast(today, days);
          var fromEl = _id('ppt-date-from');
          var toEl = _id('ppt-date-to');
          if (fromEl) fromEl.value = from;
          if (toEl) toEl.value = today;
          modal.querySelectorAll('.ppt-period-btn').forEach(function(b) { b.style.background = '#1e293b'; b.style.color = '#94a3b8'; });
          this.style.background = 'rgba(24,144,255,0.2)'; this.style.color = '#1890ff';
        };
      });
    }, 50);

    openModal(modal.id);
  };

  window.confirmPPTExport = function() {
    var fromEl = _id('ppt-date-from');
    var toEl = _id('ppt-date-to');
    var from = fromEl ? fromEl.value : '';
    var to = toEl ? toEl.value : '';
    if (!from || !to) { showToast('请选择起止日期', 'error'); return; }
    if (from > to) { showToast('开始日期不能大于结束日期', 'error'); return; }

    var selected = document.querySelector('input[name="ppt-template"]:checked');
    var templateId = selected ? selected.value : 'weekly';

    var shopIds = [];
    document.querySelectorAll('.ppt-shop-cb:checked').forEach(function(cb) {
      shopIds.push(cb.getAttribute('data-id'));
    });
    if (shopIds.length === 0) { showToast('请至少选择一个店铺', 'error'); return; }

    closeModal('modal-ppt-export');
    showToast('⏳ 正在生成 PPT（' + shopIds.length + ' 家店铺）...', 'info');
    setTimeout(function() {
      try {
        exportToPPT(shopIds, from, to, templateId);
      } catch(e) {
        showToast('⚠️ PPT 生成失败：' + e.message, 'error');
        console.error('[PPT]', e);
      }
    }, 100);
  };

  // ===== 6. 挂载顶栏按钮 =====
  function _mountPPTButton() {
    var breadcrumb = document.getElementById('breadcrumb');
    if (breadcrumb && !document.getElementById('ppt-export-btn-top')) {
      var btn = document.createElement('button');
      btn.id = 'ppt-export-btn-top';
      btn.className = 'topbar-btn';
      btn.style.cssText = 'background:rgba(24,144,255,0.12)!important;color:#1890ff!important;border-color:rgba(24,144,255,0.3)!important';
      btn.title = '导出PPT工作汇报';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> 导出PPT';
      btn.onclick = function() {
        var allShops = [];
        try { allShops = DB.getShops() || []; } catch(e) {}
        var shopIds = allShops.map(function(s) { return s.id; });
        if (shopIds.length === 0) { showToast('暂无店铺数据', 'warn'); return; }
        window._pptExportShopIds = shopIds;
        window.openPPTExportModal(shopIds);
      };
      var topbarRight = document.querySelector('.topbar-right');
      if (topbarRight) {
        topbarRight.insertBefore(btn, topbarRight.firstChild);
      }
    }
  }

  function _injectInDashboard() {
    var container = document.getElementById('page-dashboard');
    if (!container) return;
    var obs = new MutationObserver(function() {
      var content = document.getElementById('db-tab-content');
      if (!content || document.getElementById('ppt-btn-ds-inject2')) return;
      var header = content.querySelector('.ai-insight') || content.querySelector('.stat-grid');
      if (!header) return;
      var btnBar = document.createElement('div');
      btnBar.id = 'ppt-btn-ds-inject2';
      btnBar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:12px;gap:8px';
      var days = window.dashboardDays || 30;
      btnBar.innerHTML = '<button class="topbar-btn" onclick="exportDashboardPPT()" style="background:rgba(24,144,255,0.12)!important;color:#1890ff!important;border-color:rgba(24,144,255,0.3)!important">📑 导出工作汇报</button>' +
        '<span style="font-size:11px;color:#64748b;display:flex;align-items:center">近 ' + days + ' 天</span>';
      header.parentNode.insertBefore(btnBar, header);
    });
    obs.observe(container, { childList: true, subtree: true });
  }

  window.exportDashboardPPT = function() {
    var allShops = [];
    try { allShops = DB.getShops() || []; } catch(e) {}
    var shopIds = allShops.map(function(s) { return s.id; });
    if (shopIds.length === 0) { showToast('暂无店铺数据', 'warn'); return; }
    window._pptExportShopIds = shopIds;
    var days = window.dashboardDays || 30;
    // 以「最后数据日」为统计终点（与总览/掉量分析一致）
    var today = _lastDataDatePPT(shopIds);
    var from = _anchorPast(today, days);
    window.openPPTExportModal(shopIds, from, today);
  };

  // ===== 初始化 =====
  function init() {
    if (typeof PptxGenJS === 'undefined') {
      // 优先用本地库（避免 CDN 慢/不稳导致导出卡 30 分钟）
      var script = document.createElement('script');
      script.src = 'pptxgen.bundle.js?v=20260725v169';
      script.onload = function() { console.log('[PPT] ✅ PptxGenJS 已加载(本地)'); _mountPPTButton(); _injectInDashboard(); };
      script.onerror = function() {
        console.warn('[PPT] ⚠️ 本地库加载失败，回退 CDN');
        var s2 = document.createElement('script');
        s2.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
        s2.onload = function() { _mountPPTButton(); _injectInDashboard(); };
        s2.onerror = function() { console.warn('[PPT] ⚠️ PptxGenJS 加载失败'); };
        document.head.appendChild(s2);
      };
      document.head.appendChild(script);
    } else {
      _mountPPTButton();
      _injectInDashboard();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
