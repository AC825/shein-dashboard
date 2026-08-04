/**
 * 差评率趋势图表增强 v1
 * 目标：在差评率 Tab 的趋势图中增加「差评数量」柱状图，并基于差评数据给出更详细的店铺建议
 *
 * 修复 v2：去掉「17条」这种错误显示
 * - 之前用 `negative_reviews` 当条数，但实际这个字段存的是百分比（用户输入 17% 时，Math.round(17) = 17）
 * - 改为：只显示差评率%，不伪造条数
 * - 柱状图的「数量」改为「差评率%（镜像）」，避免误读
 */
(function() {
  'use strict';

  function _id(s) { return document.getElementById(s); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _reviews(shopId) {
    if (typeof CBReviewDB === 'undefined' || !CBReviewDB.getAll) return [];
    try { return CBReviewDB.getAll(shopId) || []; } catch(e) { return []; }
  }

  // 提取差评率（cb_reviews）+ 客户差评条数（cb_sku_reviews）数据
  function _extractPts(shopId) {
    var rateList = _reviews(shopId);
    // 获取款式差评明细（每条差评有真实日期，可按天聚合）
    var skuList = [];
    try {
      if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) {
        skuList = CBSkuReviewDB.getAll(shopId) || [];
      }
    } catch(e) { skuList = []; }

    // 差评率：按天保留
    var rateMap = {};
    rateList.forEach(function(r) {
      if (!r.date) return;
      var rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews / r.total_reviews * 100 : 0);
      rateMap[r.date] = rate;
    });

    // V160: 差评条数 = 按天统计 type==='bad' 的款式评价；好评条数 = type==='good'
    // 旧逻辑把每条 cb_sku_reviews 都当差评，导致差评数被严重放大（实际含大量好评）
    var badCountMap = {};
    var goodCountMap = {};
    skuList.forEach(function(r) {
      if (!r.date) return;
      var t = (r.type || '').toLowerCase();
      if (t === 'bad') badCountMap[r.date] = (badCountMap[r.date] || 0) + 1;
      else if (t === 'good') goodCountMap[r.date] = (goodCountMap[r.date] || 0) + 1;
    });

    // 合并所有日期
    var allDates = Object.keys(rateMap)
      .concat(Object.keys(badCountMap))
      .concat(Object.keys(goodCountMap));
    var uniqueDates = Array.from(new Set(allDates)).sort();

    return uniqueDates.map(function(date) {
      return {
        date: date,
        rate: rateMap[date] != null ? rateMap[date] : null,
        count: badCountMap[date] || 0,
        goodCount: goodCountMap[date] || 0
      };
    });
  }

  function _renderEnhancedChart(shopId) {
    var tab = _id('cb-tab-reviews-' + shopId);
    if (!tab) return;
    // V193g: 找出真正的图表 svg —— 排除按钮内的 12px 图标
    // 之前直接 tab.querySelector('svg') 会拿到"导入评价"按钮里的 12px svg,
    // 然后 parentNode.parentNode 上升到外层,替换 innerHTML 时把整个 reviews tab / 详情页擦空!
    var oldSvg = null;
    var allSvgs = tab.querySelectorAll('svg');
    for (var si = 0; si < allSvgs.length; si++) {
      if (!allSvgs[si].closest('button')) { oldSvg = allSvgs[si]; break; }
    }
    if (!oldSvg) return; // 原图是 canvas / 不存在 直接退出,绝不误擦
    // 防重入: 已增强标记
    if (oldSvg.getAttribute('data-enhanced') === '1') return;

    var pts = _extractPts(shopId);
    if (pts.length < 2) return;

    // 拆出有差评率的数据点（用于平均/峰谷/告警），和有客户差评条数的数据点（用于客户差评曲线）
    var ratePts = pts.filter(function(p) { return p.rate != null; });
    var countPts = pts.filter(function(p) { return p.count > 0; });
    if (ratePts.length < 1 && countPts.length < 1) return;

    // 差评率统计（仅基于真实差评率记录）
    var maxRate = 5;
    var avgRate = 0, latestRate = 0, firstRate = 0, trendChange = 0;
    if (ratePts.length > 0) {
      maxRate = Math.max.apply(null, ratePts.map(function(p) { return p.rate; }).concat([5]));
      avgRate = ratePts.reduce(function(s, p) { return s + p.rate; }, 0) / ratePts.length;
      latestRate = ratePts[ratePts.length - 1].rate;
      firstRate = ratePts[0].rate;
      trendChange = ratePts.length > 1 ? (latestRate - firstRate) : 0;
    }
    // 客户差评条数统计
    var maxCount = 1;
    var totalCount = 0, avgCount = 0, peakCount = null;
    if (countPts.length > 0) {
      maxCount = Math.max.apply(null, countPts.map(function(p) { return p.count; }).concat([5]));
      totalCount = countPts.reduce(function(s, p) { return s + p.count; }, 0);
      avgCount = totalCount / countPts.length;
      peakCount = countPts.reduce(function(b, p) { return p.count > (b ? b.count : -1) ? p : b; }, null);
    }
    // V160: 客户好评条数统计（type==='good'）
    var goodCountPts = pts.filter(function(p) { return p.goodCount > 0; });
    var maxGoodCount = 1, totalGoodCount = 0, avgGoodCount = 0;
    if (goodCountPts.length > 0) {
      maxGoodCount = Math.max.apply(null, goodCountPts.map(function(p) { return p.goodCount; }).concat([5]));
      totalGoodCount = goodCountPts.reduce(function(s, p) { return s + p.goodCount; }, 0);
      avgGoodCount = totalGoodCount / goodCountPts.length;
    }

    // 高峰日（按 rate 判断）
    var peak = ratePts.length > 0 ? ratePts.reduce(function(b, p) { return p.rate > (b ? b.rate : -1) ? p : b; }, null) : null;
    var peakDateStr = peak ? (peak.date || '') : '';

    // 是否有差评率数据
    var hasRate = ratePts.length > 0;
    // 是否有客户差评条数
    var hasCount = countPts.length > 0;

    // 建议
    var warnings = [];
    if (hasRate) {
      if (latestRate > 5) {
        warnings.push({ level: 'high', text: '差评率 ' + latestRate.toFixed(2) + '% 已超过 5% 高警线，建议立即排查产品/服务/物流问题' });
      } else if (latestRate > 2) {
        warnings.push({ level: 'mid', text: '差评率 ' + latestRate.toFixed(2) + '% 处于 2-5% 区间，需重点关注' });
      } else if (latestRate > 0) {
        warnings.push({ level: 'good', text: '差评率 ' + latestRate.toFixed(2) + '% 控制良好（<2%），继续保持' });
      }
      if (trendChange > 1) {
        warnings.push({ level: 'high', text: '📈 差评率环比上升 ' + trendChange.toFixed(2) + '%，趋势恶化，建议逐日分析近 7 天的差评内容' });
      } else if (trendChange < -1) {
        warnings.push({ level: 'good', text: '📉 差评率环比下降 ' + Math.abs(trendChange).toFixed(2) + '%，改善明显，恭喜！' });
      }
      if (peak && peak.rate > avgRate * 1.5) {
        warnings.push({ level: 'mid', text: '⚠️ ' + (peakDateStr || '某天') + ' 差评率最高（' + peak.rate.toFixed(2) + '%，日均 ' + avgRate.toFixed(2) + '%），建议查看该日的评价内容并采取针对性改进' });
      }
    }
    if (hasCount && peakCount && avgCount > 0 && peakCount.count > avgCount * 1.5) {
      warnings.push({ level: 'mid', text: '📊 ' + (peakCount.date || '某天') + ' 客户差评达到 ' + peakCount.count + ' 条（日均 ' + avgCount.toFixed(0) + ' 条），需追溯该日客户反馈' });
    }
    // V160: 好评高峰日（type==='good' 集中日）
    if (goodCountPts.length > 0) {
      var peakGood = goodCountPts.reduce(function(b, p) { return p.goodCount > (b ? b.goodCount : -1) ? p : b; }, null);
      if (peakGood && avgGoodCount > 0 && peakGood.goodCount > avgGoodCount * 1.5) {
        warnings.push({ level: 'good', text: '🌟 ' + (peakGood.date || '某天') + ' 客户好评达到 ' + peakGood.goodCount + ' 条（日均 ' + avgGoodCount.toFixed(0) + ' 条），好评集中，可沉淀为优质买家秀/复购素材' });
      }
    }
    if (warnings.length === 0) {
      warnings.push({ level: 'good', text: '✅ 差评数据健康，请继续保持' });
    }

    var warnHtml = warnings.map(function(w) {
      var bg = w.level === 'high' ? 'rgba(248,113,113,0.1)' : (w.level === 'mid' ? 'rgba(251,191,36,0.1)' : 'rgba(52,211,153,0.1)');
      var border = w.level === 'high' ? '#f87171' : (w.level === 'mid' ? '#fbbf24' : '#34d399');
      var color = w.level === 'high' ? '#fca5a5' : (w.level === 'mid' ? '#fcd34d' : '#86efac');
      return '<div style="background:' + bg + ';border-left:3px solid ' + border + ';border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;color:#e2e8f0">' +
        '<span style="color:' + color + ';font-weight:600">' + (w.level === 'high' ? '🚨' : w.level === 'mid' ? '⚠️' : '✅') + ' </span>' + _esc(w.text) +
      '</div>';
    }).join('');

    // 数据汇总（只显示真实存在的指标）
    var summaryItems = [];
    if (hasRate) {
      summaryItems.push({ label: '最新差评率', value: latestRate.toFixed(2) + '%', color: (latestRate > 5 ? '#f87171' : (latestRate > 2 ? '#fbbf24' : '#34d399')), sub: (ratePts[ratePts.length - 1].date || '').slice(5) });
      summaryItems.push({ label: '平均差评率', value: avgRate.toFixed(2) + '%', color: '#5eead4', sub: '日均' });
    }
    if (hasCount) {
      summaryItems.push({ label: '最新客户差评', value: countPts[countPts.length - 1].count + ' <span style="font-size:11px;color:#64748b">条</span>', color: '#fb923c', sub: (countPts[countPts.length - 1].date || '').slice(5) });
      summaryItems.push({ label: '日均客户差评', value: avgCount.toFixed(1) + ' <span style="font-size:11px;color:#64748b">条/天</span>', color: '#fbbf24', sub: '共 ' + totalCount + ' 条' });
    }
    if (goodCountPts.length > 0) {
      summaryItems.push({ label: '最新客户好评', value: goodCountPts[goodCountPts.length - 1].goodCount + ' <span style="font-size:11px;color:#64748b">条</span>', color: '#34d399', sub: (goodCountPts[goodCountPts.length - 1].date || '').slice(5) });
      summaryItems.push({ label: '日均客户好评', value: avgGoodCount.toFixed(1) + ' <span style="font-size:11px;color:#64748b">条/天</span>', color: '#52c41a', sub: '共 ' + totalGoodCount + ' 条' });
    }
    if (summaryItems.length === 0) {
      summaryItems.push({ label: '记录条数', value: pts.length + ' <span style="font-size:11px;color:#64748b">天</span>', color: '#a78bfa', sub: '本周期' });
    }
    var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(' + summaryItems.length + ',1fr);gap:8px;margin-top:10px">' +
      summaryItems.map(function(item) {
        return '<div style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;text-align:center">' +
          '<div style="font-size:10px;color:#64748b;margin-bottom:3px">' + item.label + '</div>' +
          '<div style="font-size:16px;font-weight:700;color:' + item.color + '">' + item.value + '</div>' +
          '<div style="font-size:10px;color:#475569">' + item.sub + '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    // 图表：双 Y 轴（差评率% 左轴 + 客户差评/好评条数 右轴）
    // V160: 右轴同时展示差评(橙)与好评(绿)，好评条数来自 type==='good'
    // V194 重写: 按用户截图#2样式 — 浅色背景,左轴固定 0~18% 步长2,
    //   红色 5% 警戒线 + 橙色 2% 警戒线, 图例正上方居中
    var maxCountAll = Math.max(maxCount, maxGoodCount);
    var W = 900, H = 280, PL = 50, PR = 60, PT = 30, PB = 36;  // V236 高度 260→280 避免图例被裁剪
    var iw = W - PL - PR, ih = H - PT - PB;
    var xStep = pts.length > 1 ? iw / (pts.length - 1) : iw;
    function toX(i) { return PL + i * xStep; }
    // V194 关键: 左轴固定 0~18% 步长2 (用户截图#2样式)
    var YRATE_MAX = 18, YRATE_STEP = 2;
    function toYRate(v) { return PT + ih - (Math.min(v, YRATE_MAX) / YRATE_MAX) * ih; }
    // V194 关键: 右轴固定 0~12 步长2
    var YCOUNT_MAX = 12, YCOUNT_STEP = 2;
    function toYCount(v) { return PT + ih - (Math.min(v, YCOUNT_MAX) / YCOUNT_MAX) * ih; }

    // 整体差评率折线
    var ratePts2 = pts.filter(function(p) { return p.rate != null; });
    var ratePolyline = ratePts2.map(function(p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYRate(p.rate).toFixed(1); }).join(' ');
    var rateArea = ratePolyline ? (ratePolyline + ' ' + toX(pts.indexOf(ratePts2[ratePts2.length - 1])).toFixed(1) + ',' + (PT + ih).toFixed(1) + ' ' + toX(pts.indexOf(ratePts2[0])).toFixed(1) + ',' + (PT + ih).toFixed(1)) : '';
    // 客户差评条数折线
    var countPolyline = countPts.map(function(p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYCount(p.count).toFixed(1); }).join(' ');
    // V160: 客户好评条数折线 (本次在 V194 中保留绿色虚线, 但优先级低于用户主要关心的差评条数橙线)
    var goodCountPolyline = goodCountPts.map(function(p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYCount(p.goodCount).toFixed(1); }).join(' ');

    // V194: 左轴刻度 0/2/4/6/.../18
    var yTicksRate = [];
    for (var yi = 0; yi <= YRATE_MAX; yi += YRATE_STEP) yTicksRate.push(yi);
    // V194: 右轴刻度 0/2/4/6/.../12
    var yTicksCount = [];
    for (var yj = 0; yj <= YCOUNT_MAX; yj += YCOUNT_STEP) yTicksCount.push(yj);

    // V194: 配色 (用户截图#2 风格, 浅色背景)
    var COLOR_BG = '#ffffff';
    var COLOR_GRID = '#e2e8f0';
    var COLOR_AXIS_TXT = '#475569';
    var COLOR_RATE = '#ef4444';      // 红色差评率
    var COLOR_COUNT = '#f97316';     // 橙色差评条数
    var COLOR_GOOD = '#10b981';      // 绿色好评条数 (保留)
    var COLOR_WARN_2 = '#fb923c';    // 橙色 2% 警戒
    var COLOR_WARN_5 = '#dc2626';    // 红色 5% 警戒

    // V236: 图例 3 个：差评率(%)/差评条数/警戒线，去掉好评条数图例（线已不画）
    var legendHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:20px;margin-bottom:14px;flex-wrap:wrap;font-size:13px;color:#334155;font-weight:500">' +
      '<span style="display:inline-flex;align-items:center;gap:6px">' +
        '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + COLOR_RATE + '"></span>' +
        '<span>差评率(%)</span>' +
      '</span>' +
      '<span style="display:inline-flex;align-items:center;gap:6px">' +
        '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + COLOR_COUNT + '"></span>' +
        '<span>差评条数</span>' +
      '</span>' +
      '<span style="display:inline-flex;align-items:center;gap:6px">' +
        '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + COLOR_WARN_2 + '"></span>' +
        '<span>2% / 5% 警戒线</span>' +
      '</span>' +
    '</div>';

    // V194: 标题左上 (用户截图#2样式)
    var titleHtml = '<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:4px">差评率(%)</div>';

    var newHtml = '<div style="margin-bottom:16px;width:100% !important;max-width:none !important;display:block;box-sizing:border-box;text-align:left">' +
      titleHtml +
      legendHtml +
      '<div style="background:' + COLOR_BG + ';border:1px solid ' + COLOR_GRID + ';border-radius:10px;padding:14px 8px 8px 8px;width:100% !important;max-width:none !important;box-sizing:border-box;display:block">' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block;width:100% !important;min-width:0;max-width:none;height:' + H + 'px;margin:0" data-enhanced="1">' +
          // 左轴网格 + 刻度 (差评率%) — V194 固定 0/2/4/.../18
          yTicksRate.map(function(v) {
            return '<line x1="' + PL + '" y1="' + toYRate(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(v).toFixed(1) + '" stroke="' + COLOR_GRID + '" stroke-width="1"/>' +
              '<text x="' + (PL - 6) + '" y="' + (toYRate(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + COLOR_AXIS_TXT + '">' + v + '%</text>';
          }).join('') +
          // 右轴刻度 (差评条数) — V194 固定 0/2/4/.../12
          yTicksCount.map(function(v) {
            return '<text x="' + (W - PR + 6) + '" y="' + (toYCount(v) + 4).toFixed(1) + '" text-anchor="start" font-size="10" fill="' + COLOR_COUNT + '">' + v + '</text>';
          }).join('') +
          // 2% 警戒线 (橙色虚线) — V194 按用户截图#2
          '<line x1="' + PL + '" y1="' + toYRate(2).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(2).toFixed(1) + '" stroke="' + COLOR_WARN_2 + '" stroke-width="1.5" stroke-dasharray="6,4"/>' +
          '<text x="' + (W - PR + 6) + '" y="' + (toYRate(2) - 2).toFixed(1) + '" font-size="9" fill="' + COLOR_WARN_2 + '" font-weight="600">2% 警戒</text>' +
          // 5% 警戒线 (红色虚线) — V194 按用户截图#2
          '<line x1="' + PL + '" y1="' + toYRate(5).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(5).toFixed(1) + '" stroke="' + COLOR_WARN_5 + '" stroke-width="1.5" stroke-dasharray="6,4"/>' +
          '<text x="' + (PL - 6) + '" y="' + (toYRate(5) - 2).toFixed(1) + '" text-anchor="end" font-size="9" fill="' + COLOR_WARN_5 + '" font-weight="600">5% 警戒</text>' +
          // 整体差评率面积 (浅红色)
          (rateArea ? '<polygon points="' + rateArea + '" fill="rgba(239,68,68,0.08)"/>' : '') +
          // 整体差评率折线 (红色)
          (ratePolyline ? '<polyline points="' + ratePolyline + '" fill="none" stroke="' + COLOR_RATE + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
    // V236: 数字标签去重叠 —— 同一 x 坐标只显示数值最大的一个
    //   - 之前 V194 每个点都显示 count 数字，07-01 后面 4/2/1 多个标签挤一起
    //   - 策略：每 3 个相邻数据点里只显示 1 个数字标签（count 最大的那个）
    var countPtsLabeled = countPts.map(function(p, idx) {
      // 每 3 个点显示 1 次（且优先 count 大的）
      if (idx % 3 !== 0) return null;
      return p;
    }).filter(function(p) { return p != null; });

    // 整体差评率数据点 (红圆) — V194 突出红色
    ratePts2.map(function(p) {
      return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYRate(p.rate).toFixed(1) + '" r="4" fill="' + COLOR_RATE + '" stroke="#fff" stroke-width="1.5"/>';
    }).join('') +
          // 客户差评条数折线 (橙色粗实线)
          (countPolyline ? '<polyline points="' + countPolyline + '" fill="none" stroke="' + COLOR_COUNT + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
          // 客户差评条数数据点 (大橙圆 + 数字标签，V236 改为稀疏显示)
          countPts.map(function(p) {
            return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYCount(p.count).toFixed(1) + '" r="5" fill="' + COLOR_COUNT + '" stroke="#fff" stroke-width="1.5"/>';
          }).join('') +
          // V236: 差评条数数字标签稀疏显示（每 3 个 1 次），且加白底防与红线重叠
          countPtsLabeled.map(function(p) {
            return '<text x="' + toX(pts.indexOf(p)).toFixed(1) + '" y="' + (toYCount(p.count) - 9).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + COLOR_COUNT + '" stroke="#fff" stroke-width="3" paint-order="stroke">' + p.count + '</text>';
          }).join('') +
          // V236: 好评条数折线去掉（之前画 dashed polyline 每天 0/2/4/18 剧烈震荡像心电图，难看）
          //   - 只保留小绿圆点（弱化显示）
          //   - 用户能看出"哪天有好评"，但不被虚线干扰主图
          // 客户好评条数数据点 (小绿圆)
          goodCountPts.map(function(p) {
            return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYCount(p.goodCount).toFixed(1) + '" r="3" fill="' + COLOR_GOOD + '" stroke="#fff" stroke-width="1" opacity="0.7"/>';
          }).join('') +
          // x 轴日期
          pts.map(function(p, i) {
            if (pts.length > 10 && i % Math.ceil(pts.length / 8) !== 0) return '';
            return '<text x="' + toX(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#64748b">' + (p.date || '').slice(5) + '</text>';
          }).join('') +
        '</svg>' +
      '</div>' +
      summaryHtml +
      '</div>';

    // 建议区
    var suggestBox = '<div style="margin-bottom:16px" data-enhanced="1">' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:8px;font-weight:600">💡 差评专项建议</div>' +
      warnHtml +
    '</div>';

    // 替换老的 SVG 容器（保留外层 div，避免移除后定位失败）
    var oldContainer = oldSvg.parentNode.parentNode;
    if (oldContainer) {
      // V193: 强制重置父容器的对齐方式,避免被外层 text-align:center / flex 居中
      try {
        oldContainer.style.textAlign = 'left';
        oldContainer.style.display = 'block';
        oldContainer.style.width = '100%';
        oldContainer.style.maxWidth = 'none';
        oldContainer.style.margin = '0';
        // V193b: 强制 cb-tab-reviews-{shopId} 容器也是 block + width:100%
        // 否则外层 flex 居中让 newHtml 跑中间
        var reviewsTab = document.getElementById('cb-tab-reviews-' + shopId);
        if (reviewsTab) {
          reviewsTab.style.display = 'block';
          reviewsTab.style.textAlign = 'left';
          reviewsTab.style.width = '100%';
          reviewsTab.style.maxWidth = 'none';
          reviewsTab.style.flex = 'none';
          // 沿链向上修复 display:flex -> display:block 直到 page-shop-detail
          var p = reviewsTab.parentNode;
          var chain = 0;
          while (p && p.id !== 'page-shop-detail' && chain < 8) {
            var cs = p.ownerDocument.defaultView.getComputedStyle(p);
            if (cs.display === 'flex' || cs.display === 'inline-flex') {
              p.style.display = 'block';
            }
            p.style.textAlign = 'left';
            p = p.parentNode;
            chain++;
          }
        }
      } catch(e){}
      oldContainer.innerHTML = newHtml + suggestBox;
      console.log('[ReviewChart] ✅ 差评率趋势图已增强 v2（原容器内替换,左对齐铺满）');
      return;
    }
  }

  function _scanForReviewTabs() {
    document.querySelectorAll('[id^="cb-tab-reviews-"]').forEach(function(tab) {
      var shopId = tab.id.replace('cb-tab-reviews-', '');
      _renderEnhancedChart(shopId);
      _fixCanvasChartLayout(shopId);
    });
  }

  // V193g: 原差评率趋势图是 Chart.js canvas(不是 svg),增强模块只处理 svg
  // 这里单独修 canvas 布局: 找到 canvas -> 把 canvas 及卡片容器拉到满宽
  // 解决用户投诉"差评率趋势图窄/居中"
  function _fixCanvasChartLayout(shopId) {
    var tab = _id('cb-tab-reviews-' + shopId);
    if (!tab) return;
    // 已经增强过(有 data-enhanced svg)就不动 canvas
    if (tab.querySelector('svg[data-enhanced="1"]')) return;
    var canvases = tab.querySelectorAll('canvas');
    if (!canvases.length) return;
    canvases.forEach(function(cv) {
      try {
        // 1) canvas 本身满宽 + 限高
        cv.style.width = '100%';
        cv.style.maxWidth = 'none';
        cv.style.minWidth = '0';
        cv.style.height = 'auto';
        cv.style.minHeight = '180px';
        cv.style.display = 'block';
        // 2) 沿父链找最近的有 display:flex/inline-flex 且影响 canvas 显示的容器
        //    Chart.js canvas 的父容器通常是 .card 内的一个 div(可能 flex)
        var p = cv.parentElement;
        var chain = 0;
        while (p && p !== tab && chain < 6) {
          var cs = p.ownerDocument.defaultView.getComputedStyle(p);
          if (cs.display === 'flex' || cs.display === 'inline-flex') {
            p.style.display = 'block';
          }
          p.style.width = '100%';
          p.style.maxWidth = 'none';
          p.style.textAlign = 'left';
          p = p.parentElement;
          chain++;
        }
        // 3) tab 本身也修
        tab.style.display = 'block';
        tab.style.width = '100%';
        tab.style.maxWidth = 'none';
        tab.style.textAlign = 'left';
      } catch (e) {}
    });
  }

  // V193j: 强制全宽 CSS 注入,解决用户反馈"差评率趋势图还是窄的居中"
  // 直接用 <style> 标签 + !important,绕过任何 inline style / flex 容器居中
  function _injectFullWidthCSS() {
    if (document.getElementById('v193j-reviews-fullwidth')) return;
    var s = document.createElement('style');
    s.id = 'v193j-reviews-fullwidth';
    s.textContent = [
      // 1) 店铺详情页 reviews tab 全宽,左对齐
      //    V202 关键修复: 删掉 display:block!important
      //    原版带了这条, 导致 [id^="cb-tab-reviews-"] 所有容器(无论 activeTab)都被锁成 display:block
      //    → 切到其他 tab 时,内联 style.display='none' 失效,差评率页面内容永远显示在分析 tab 上面
      //    现在只保留布局属性 (width/box/text-align) 的 !important, display 走内联 style 控制
      '[id^="cb-tab-reviews-"]{width:100%!important;max-width:none!important;text-align:left!important;flex:none!important;margin:0!important;padding:12px!important;box-sizing:border-box!important}',
      // 2) reviews tab 内部所有 .card / .panel 全宽
      '[id^="cb-tab-reviews-"] .card,[id^="cb-tab-reviews-"] .panel,[id^="cb-tab-reviews-"] div.card{display:block!important;width:100%!important;max-width:none!important;margin:0 0 12px 0!important;text-align:left!important;box-sizing:border-box!important}',
      // 3) 容器: 任何 flex 居中, 强制改成 block + 100%
      '[id^="cb-tab-reviews-"] > *{max-width:none!important}',
      '[id^="cb-tab-reviews-"] *{box-sizing:border-box!important}',
      // 4) canvas: 真正的全宽
      '[id^="cb-tab-reviews-"] canvas{width:100%!important;max-width:none!important;min-width:0!important;height:auto!important;min-height:180px!important;display:block!important;margin:0!important}',
      // 5) 父链(直到 page-shop-detail)取消 flex 居中
      '[id^="cb-tab-reviews-"] ~ *, [id^="cb-tab-reviews-"]{text-align:left!important}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
    console.log('[ReviewChart] ✅ V193j 强制全宽 CSS 已注入');
  }

  function _init() {
    var timer = null;
    var obs = new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(_scanForReviewTabs, 100);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    _injectFullWidthCSS();
    _scanForReviewTabs();
    console.log('[ReviewChart] ✅ 差评率趋势图增强模块 v2 已加载（移除假数据）');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
