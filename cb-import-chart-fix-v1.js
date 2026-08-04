/**
 * cb-import-chart-fix-v1.js  (V211)
 * 一站式修复 4 个用户反馈问题:
 *   1) "优化"页差评率趋势图(简陋的 Chart.js 折线) → 改成 review-trend-enhanced.js 同款浅色 SVG
 *      (双 Y 轴 + 固定刻度 0-18% + 红色 5% 警戒 + 橙色 2% 警戒 + 居中图例 + 底部说明)
 *   2) "优化"页好评数趋势图(简陋堆叠柱) → 改成浅色 SVG
 *   3) 款式评价批量导入"选文件没反应/很慢" → V176 模式提速(关闭 cellStyles + raw:true + defval + 进度 toast)
 *   4) 款式评价 type 字段支持中文(好评/差评/中评/赞/不满意 等)
 *
 * 全部 monkey-patch,不动 minified 主代码。
 */
(function () {
  'use strict';

  if (window.__cbImportChartFixV211Loaded) return;
  window.__cbImportChartFixV211Loaded = true;

  function _id(s) { return document.getElementById(s); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _showInfo(msg){ if (typeof window.showToast === 'function') window.showToast(msg, 'info', 30000); }
  function _showOK(msg){ if (typeof window.showToast === 'function') window.showToast(msg, 'success', 4000); }
  function _showErr(msg){ if (typeof window.showToast === 'function') window.showToast(msg, 'error', 8000); }
  function _stripBOM(s){ return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }

  // ============================================================
  //  PART 1: 优化页"差评率趋势" + "好评数趋势"图美化 (SVG 替换 Chart.js canvas)
  // ============================================================
  // 数据源沿用 optimize-v2.js 的 getReviewDailyData() — 它已经是全局函数

  function _getRatePts(shopId) {
    // 拉 cb_reviews (差评率) + cb_sku_reviews (差评/好评条数)
    var rateList = [];
    var skuList = [];
    try { if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) rateList = CBReviewDB.getAll(shopId) || []; } catch(e) {}
    try { if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) skuList = CBSkuReviewDB.getAll(shopId) || []; } catch(e) {}
    // 差评率按天
    var rateMap = {};
    rateList.forEach(function (r) {
      if (!r.date) return;
      var rate = r.negative_rate != null ? r.negative_rate : (r.total_reviews > 0 ? r.negative_reviews / r.total_reviews * 100 : 0);
      rateMap[r.date] = rate;
    });
    // 差评/好评条数按天
    var badMap = {}, goodMap = {};
    skuList.forEach(function (r) {
      if (!r.date) return;
      var t = (r.type || '').toLowerCase();
      if (t === 'bad') badMap[r.date] = (badMap[r.date] || 0) + 1;
      else if (t === 'good') goodMap[r.date] = (goodMap[r.date] || 0) + 1;
    });
    // 最近 30 天
    var fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    var fromStr = fromDate.toISOString().slice(0, 10);
    var allDates = Object.keys(rateMap).concat(Object.keys(badMap)).concat(Object.keys(goodMap));
    var uniq = Array.from(new Set(allDates)).filter(function (d) { return d >= fromStr; }).sort();
    return uniq.map(function (date) {
      return {
        date: date,
        rate: rateMap[date] != null ? rateMap[date] : null,
        bad: badMap[date] || 0,
        good: goodMap[date] || 0
      };
    });
  }

  // ============= SVG 渲染: 差评率趋势 =============
  function _renderReviewSvg(pts) {
    if (!pts || pts.length < 1) return '<div style="text-align:center;padding:40px 20px;color:#94a3b8;font-size:13px">近 30 天无评价数据<br><span style="font-size:11px;margin-top:6px;display:inline-block">请到「差评率」Tab 或「评价明细」录入数据</span></div>';
    var W = 900, H = 280, PL = 50, PR = 60, PT = 30, PB = 36;
    var iw = W - PL - PR, ih = H - PT - PB;
    var xStep = pts.length > 1 ? iw / (pts.length - 1) : iw;
    function toX(i) { return PL + i * xStep; }
    var YRATE_MAX = 18, YRATE_STEP = 2;
    function toYRate(v) { return PT + ih - (Math.min(v, YRATE_MAX) / YRATE_MAX) * ih; }
    var maxCount = Math.max.apply(null, pts.map(function (p) { return Math.max(p.bad, p.good); }).concat([1]));
    var YCOUNT_MAX = Math.max(12, Math.ceil(maxCount / 2) * 2);
    function toYCount(v) { return PT + ih - (Math.min(v, YCOUNT_MAX) / YCOUNT_MAX) * ih; }

    // 配色 — 沿用 review-trend-enhanced.js v194
    var COLOR_BG = '#ffffff', COLOR_GRID = '#e2e8f0', COLOR_AXIS_TXT = '#475569';
    var COLOR_RATE = '#ef4444', COLOR_COUNT = '#f97316', COLOR_GOOD = '#10b981';
    var COLOR_WARN_2 = '#fb923c', COLOR_WARN_5 = '#dc2626';

    var ratePts2 = pts.filter(function (p) { return p.rate != null; });
    var ratePolyline = ratePts2.map(function (p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYRate(p.rate).toFixed(1); }).join(' ');
    var rateArea = ratePolyline ? (ratePolyline + ' ' + toX(pts.indexOf(ratePts2[ratePts2.length - 1])).toFixed(1) + ',' + (PT + ih).toFixed(1) + ' ' + toX(pts.indexOf(ratePts2[0])).toFixed(1) + ',' + (PT + ih).toFixed(1)) : '';
    var badPts = pts.filter(function (p) { return p.bad > 0; });
    var badPolyline = badPts.map(function (p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYCount(p.bad).toFixed(1); }).join(' ');
    var goodPts = pts.filter(function (p) { return p.good > 0; });
    var goodPolyline = goodPts.map(function (p) { return toX(pts.indexOf(p)).toFixed(1) + ',' + toYCount(p.good).toFixed(1); }).join(' ');

    var yTicksRate = []; for (var yi = 0; yi <= YRATE_MAX; yi += YRATE_STEP) yTicksRate.push(yi);
    var yTicksCount = []; for (var yj = 0; yj <= YCOUNT_MAX; yj += 2) yTicksCount.push(yj);

    var legendHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:18px;margin-bottom:10px;flex-wrap:wrap;font-size:12px;color:#334155">' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + COLOR_RATE + '"></span><span>差评率(%)</span></span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + COLOR_COUNT + '"></span><span>差评条数</span></span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ' + COLOR_WARN_2 + '"></span><span>2% 警戒</span></span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ' + COLOR_WARN_5 + '"></span><span>5% 警戒</span></span>' +
      '</div>';

    var svgHtml = '<div data-v211-svg="review" style="background:' + COLOR_BG + ';border:1px solid ' + COLOR_GRID + ';border-radius:10px;padding:14px 8px 8px 8px">' +
      legendHtml +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block;width:100%;height:' + H + 'px">' +
      yTicksRate.map(function (v) {
        return '<line x1="' + PL + '" y1="' + toYRate(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(v).toFixed(1) + '" stroke="' + COLOR_GRID + '" stroke-width="1"/>' +
          '<text x="' + (PL - 6) + '" y="' + (toYRate(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + COLOR_AXIS_TXT + '">' + v + '%</text>';
      }).join('') +
      yTicksCount.map(function (v) {
        return '<text x="' + (W - PR + 6) + '" y="' + (toYCount(v) + 4).toFixed(1) + '" text-anchor="start" font-size="10" fill="' + COLOR_COUNT + '">' + v + '</text>';
      }).join('') +
      '<line x1="' + PL + '" y1="' + toYRate(2).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(2).toFixed(1) + '" stroke="' + COLOR_WARN_2 + '" stroke-width="1.5" stroke-dasharray="6,4"/>' +
      '<text x="' + (W - PR + 6) + '" y="' + (toYRate(2) - 2).toFixed(1) + '" font-size="9" fill="' + COLOR_WARN_2 + '" font-weight="600">2% 警戒</text>' +
      '<line x1="' + PL + '" y1="' + toYRate(5).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toYRate(5).toFixed(1) + '" stroke="' + COLOR_WARN_5 + '" stroke-width="1.5" stroke-dasharray="6,4"/>' +
      '<text x="' + (PL - 6) + '" y="' + (toYRate(5) - 2).toFixed(1) + '" text-anchor="end" font-size="9" fill="' + COLOR_WARN_5 + '" font-weight="600">5% 警戒</text>' +
      (rateArea ? '<polygon points="' + rateArea + '" fill="rgba(239,68,68,0.08)"/>' : '') +
      (ratePolyline ? '<polyline points="' + ratePolyline + '" fill="none" stroke="' + COLOR_RATE + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
      ratePts2.map(function (p) {
        return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYRate(p.rate).toFixed(1) + '" r="4" fill="' + COLOR_RATE + '" stroke="#fff" stroke-width="1.5"/>';
      }).join('') +
      (badPolyline ? '<polyline points="' + badPolyline + '" fill="none" stroke="' + COLOR_COUNT + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
      badPts.map(function (p) {
        return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYCount(p.bad).toFixed(1) + '" r="5" fill="' + COLOR_COUNT + '" stroke="#fff" stroke-width="1.5"/>' +
          '<text x="' + toX(pts.indexOf(p)).toFixed(1) + '" y="' + (toYCount(p.bad) - 8).toFixed(1) + '" text-anchor="middle" font-size="9" fill="' + COLOR_COUNT + '" font-weight="700">' + p.bad + '</text>';
      }).join('') +
      (goodPolyline ? '<polyline points="' + goodPolyline + '" fill="none" stroke="' + COLOR_GOOD + '" stroke-width="1.5" stroke-dasharray="2,2" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
      goodPts.map(function (p) {
        return '<circle cx="' + toX(pts.indexOf(p)).toFixed(1) + '" cy="' + toYCount(p.good).toFixed(1) + '" r="3" fill="' + COLOR_GOOD + '" stroke="#fff" stroke-width="1"/>';
      }).join('') +
      pts.map(function (p, i) {
        if (pts.length > 10 && i % Math.ceil(pts.length / 8) !== 0) return '';
        return '<text x="' + toX(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#64748b">' + (p.date || '').slice(5) + '</text>';
      }).join('') +
      '</svg></div>';
    return svgHtml;
  }

  // ============= SVG 渲染: 好评数趋势 (堆叠柱) =============
  function _renderPositiveSvg(pts) {
    if (!pts || pts.length < 1) return '<div style="text-align:center;padding:40px 20px;color:#94a3b8;font-size:13px">近 30 天无评价数据</div>';
    var W = 900, H = 280, PL = 50, PR = 20, PT = 30, PB = 36;
    var iw = W - PL - PR, ih = H - PT - PB;
    var xStep = pts.length > 1 ? iw / pts.length : iw;
    var barW = Math.max(8, xStep * 0.6);
    var maxVal = Math.max.apply(null, pts.map(function (p) { return p.bad + p.good; }).concat([1]));
    var yMax = Math.max(10, Math.ceil(maxVal / 5) * 5);
    function toX(i) { return PL + i * xStep; }
    function toY(v) { return PT + ih - (v / yMax) * ih; }

    var COLOR_GOOD = '#52c41a', COLOR_BAD = '#ff4d4f', COLOR_GRID = '#e2e8f0', COLOR_AXIS_TXT = '#475569';
    var yTicks = []; for (var yi = 0; yi <= yMax; yi += Math.max(1, Math.floor(yMax / 5))) yTicks.push(yi);

    var totalPos = pts.reduce(function (s, p) { return s + p.good; }, 0);
    var totalNeg = pts.reduce(function (s, p) { return s + p.bad; }, 0);
    var legendHtml = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;font-size:12px;color:#334155">' +
      '<div style="display:flex;gap:18px">' +
        '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + COLOR_GOOD + '"></span><span>好评数</span></span>' +
        '<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + COLOR_BAD + '"></span><span>差评数</span></span>' +
      '</div>' +
      '<div style="font-size:11px;color:#64748b">总好评 <span style="color:' + COLOR_GOOD + ';font-weight:600">' + totalPos + '</span> · 总差评 <span style="color:' + COLOR_BAD + ';font-weight:600">' + totalNeg + '</span></div>' +
      '</div>';

    var barsHtml = pts.map(function (p, i) {
      var x = toX(i) + (xStep - barW) / 2;
      var goodH = (p.good / yMax) * ih;
      var badH = (p.bad / yMax) * ih;
      var goodY = PT + ih - goodH;
      var badY = goodY - badH;
      var html = '';
      if (p.good > 0) html += '<rect x="' + x.toFixed(1) + '" y="' + goodY.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + goodH.toFixed(1) + '" fill="' + COLOR_GOOD + '" opacity="0.78" rx="2"/>';
      if (p.bad > 0) html += '<rect x="' + x.toFixed(1) + '" y="' + badY.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + badH.toFixed(1) + '" fill="' + COLOR_BAD + '" opacity="0.72" rx="2"/>';
      return html;
    }).join('');

    var svgHtml = '<div data-v211-svg="positive" style="background:#fff;border:1px solid ' + COLOR_GRID + ';border-radius:10px;padding:14px 8px 8px 8px">' +
      legendHtml +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block;width:100%;height:' + H + 'px">' +
      yTicks.map(function (v) {
        return '<line x1="' + PL + '" y1="' + toY(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + toY(v).toFixed(1) + '" stroke="' + COLOR_GRID + '" stroke-width="1"/>' +
          '<text x="' + (PL - 6) + '" y="' + (toY(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + COLOR_AXIS_TXT + '">' + v + '</text>';
      }).join('') +
      barsHtml +
      pts.map(function (p, i) {
        if (pts.length > 10 && i % Math.ceil(pts.length / 8) !== 0) return '';
        return '<text x="' + toX(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#64748b">' + (p.date || '').slice(5) + '</text>';
      }).join('') +
      '</svg></div>';
    return svgHtml;
  }

  // ============= 注入: 替换 opt-canvas-* canvas 为 SVG =============
  function _injectSvgForShop(shopId) {
    var reviewCanvas = _id('opt-canvas-review-' + shopId);
    var positiveCanvas = _id('opt-canvas-positive-' + shopId);
    if (reviewCanvas) {
      // 销毁可能已存在的 Chart.js 实例
      try {
        if (window._optCharts && window._optCharts.review) {
          window._optCharts.review.destroy();
          window._optCharts.review = null;
        }
      } catch (e) {}
      var pts = _getRatePts(shopId);
      var svg = _renderReviewSvg(pts);
      var container = reviewCanvas.parentNode;
      if (container) container.innerHTML = svg;
    }
    if (positiveCanvas) {
      try {
        if (window._optCharts && window._optCharts.positive) {
          window._optCharts.positive.destroy();
          window._optCharts.positive = null;
        }
      } catch (e) {}
      var pts2 = _getRatePts(shopId);
      var svg2 = _renderPositiveSvg(pts2);
      var container2 = positiveCanvas.parentNode;
      if (container2) container2.innerHTML = svg2;
    }
  }

  // ============= hook renderOptimizeTab: 渲染完后再 250ms 替换成 SVG =============
  function _hookRenderOptimizeTab() {
    if (typeof window.renderOptimizeTab !== 'function' || window.__v211_patchedOptimize) return;
    window.__v211_patchedOptimize = true;
    var _orig = window.renderOptimizeTab;
    window.renderOptimizeTab = function (shopId) {
      var ret = _orig.apply(this, arguments);
      // 优化页用了 setTimeout(100) 调 Chart.js, 我们在 350ms 后替换
      setTimeout(function () {
        try { _injectSvgForShop(shopId); } catch (e) { console.warn('[V211] SVG 注入失败:', e); }
      }, 350);
      return ret;
    };
    console.log('[V211] renderOptimizeTab hooked (差评率/好评数趋势图将用 SVG 美化)');
  }

  function _loopHookOptimize() {
    if (typeof window.renderOptimizeTab === 'function') {
      _hookRenderOptimizeTab();
    } else {
      setTimeout(_loopHookOptimize, 200);
    }
  }
  _loopHookOptimize();

  // ============================================================
  //  PART 2: 款式评价批量导入提速 (V176 模式)
  // ============================================================
  function _optimizedReadSkuReviewFile(file) {
    var name = file.name || '';
    var lower = name.toLowerCase();
    var isExcel = /\.(xlsx|xls|ods|xlsm)$/i.test(lower);

    if (!isExcel) {
      return file.text().then(_stripBOM);
    }
    if (typeof XLSX === 'undefined') {
      return Promise.reject(new Error('Excel 解析库未加载,请刷新页面重试'));
    }
    _showInfo('📊 正在解析 "' + name + '" ...');
    return file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, {
        type: 'array',
        cellStyles:  false,
        cellHTML:    false,
        cellNF:      false,
        cellText:    false,
        cellDates:   false
      });
      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error('Excel 中没有工作表');
      var csv = XLSX.utils.sheet_to_csv(sheet, {
        blankrows: false,
        raw:       true,
        defval:    ''
      });
      return csv;
    });
  }

  function _newHandleSkuReviewFileSelect(input, shopId) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var ta = _id('skur-import-text-' + shopId);
    var preview = _id('skur-import-preview-' + shopId);
    _optimizedReadSkuReviewFile(file)
      .then(function (text) {
        if (ta) ta.value = text;
        if (preview) {
          var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; }).length;
          preview.textContent = '📄 已读取：' + file.name + '（' + lines + ' 行数据）';
        }
        _showOK('✅ 已读取 "' + file.name + '" ,点 "导入" 开始处理');
      })
      .catch(function (err) {
        _showErr('文件读取失败：' + (err && err.message || err));
        if (preview) preview.textContent = '❌ 读取失败：' + (err && err.message || err);
      });
  }

  function _newHandleSkuReviewFileDrop(evt, shopId) {
    evt.preventDefault();
    var drop = _id('skur-drop-' + shopId);
    if (drop) drop.style.borderColor = '#334155';
    var file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
    if (!file) return;
    _newHandleSkuReviewFileSelect({ files: [file], value: '' }, shopId);
  }

  // ============================================================
  //  PART 3: importSkuReviews 支持中文 type
  // ============================================================
  function _normalizeType(raw, rating) {
    var v = (raw == null ? '' : String(raw)).trim();
    if (!v) {
      // 没有 type 字段,根据 rating 推断
      if (rating && rating >= 4) return 'good';
      if (rating && rating <= 2) return 'bad';
      return 'bad';  // 默认差评
    }
    var t = v.toLowerCase();
    // 英文
    if (t === 'good' || t === 'positive' || t === 'pos') return 'good';
    if (t === 'bad' || t === 'negative' || t === 'neg') return 'bad';
    if (t === 'neutral' || t === 'mid' || t === 'neu') return 'neutral';
    // 中文 (好评)
    if (/^(好|好评|很好|非常好|很满意|满意|赞|推荐|优秀|棒)$/.test(v)) return 'good';
    // 中文 (差评)
    if (/^(差|差评|很差|非常差|不满意|投诉|差劲|退货|退差)$/.test(v)) return 'bad';
    // 中文 (中评)
    if (/^(中|中评|一般|还行|凑合|普通|中等)$/.test(v)) return 'neutral';
    // 兜底: 根据 rating 推断
    if (rating && rating >= 4) return 'good';
    if (rating && rating <= 2) return 'bad';
    return 'bad';
  }

  function _newImportSkuReviews(shopId) {
    var ta = _id('skur-import-text-' + shopId);
    var raw = ta ? ta.value.trim() : '';
    var preview = _id('skur-import-preview-' + shopId);
    if (!raw) {
      if (typeof showToast === 'function') showToast('请粘贴或上传数据', 'error');
      return;
    }

    // 调原函数
    if (typeof window._origImportSkuReviews === 'function') {
      try {
        window._origImportSkuReviews(shopId);
      } catch (e) {
        console.warn('[V211] 原 importSkuReviews 调用失败,改用 V211 自实现:', e);
        _selfImplementImport(shopId, raw, preview);
        return;
      }
    } else {
      _selfImplementImport(shopId, raw, preview);
      return;
    }

    // 原函数用英文识别, 补一轮: 把所有 type=中文 但没被原函数识别的, 用 _normalizeType 修正
    try {
      if (typeof CBSkuReviewDB !== 'undefined' && CBSkuReviewDB.getAll) {
        var all = CBSkuReviewDB.getAll(shopId) || [];
        // 找刚导入的(没 _v211_norm 标记, 原始 type 字段是中文/没值)
        var newOnes = all.filter(function (r) { return r && !r._v211_norm; });
        if (newOnes.length) {
          newOnes.forEach(function (r) {
            var newType = _normalizeType(r.type, r.rating);
            if (r.type !== newType) {
              r.type = newType;
              r._v211_norm = 1;
            } else {
              r._v211_norm = 1;
            }
          });
          // 批量写回
          try { CBSkuReviewDB.batchAdd(shopId, newOnes); } catch (e) { /* batchAdd 可能 add */ }
          console.log('[V211] 已修正 ' + newOnes.length + ' 条评价的 type 字段(支持中文)');
        }
      }
    } catch (e) {
      console.warn('[V211] 中文 type 修正失败:', e);
    }
  }

  function _selfImplementImport(shopId, raw, preview) {
    // 自实现 (如果原 importSkuReviews 不在 window)
    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^(日期|date|sku|货号)/i.test(l); });
    var errors = 0;
    var a = Date.now();
    var rows = lines.map(function (line, idx) {
      var cols = line.split(/[,\t]/).map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
      if (cols.length < 3) { errors++; return null; }
      var dateStr = cols[0] || '';
      var d = dateStr.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
      if (!d) { errors++; return null; }
      var date = d[1] + '-' + d[2].padStart(2, '0') + '-' + d[3].padStart(2, '0');
      var sku = cols[1] || '';
      var content = cols[2] || '';
      if (!sku || !content) { errors++; return null; }
      var rating = parseInt(cols[3]) || null;
      var type = _normalizeType(cols[7] || '', rating);
      return {
        id: 'skur_' + a + '_' + idx,
        date: date, sku: sku, negative_content: content, content: content,
        type: type, rating: rating,
        reviewer: cols[4] || '',
        status: ['待处理', '已回复', '已解决'].includes((cols[5] || '').trim()) ? cols[5].trim() : '待处理',
        remark: cols[6] || ''
      };
    }).filter(Boolean);
    if (rows.length === 0) {
      if (preview) preview.textContent = '❌ 没有有效数据，' + errors + ' 条格式错误';
      return;
    }
    try { CBSkuReviewDB.batchAdd(shopId, rows); } catch (e) { console.error('[V211] batchAdd failed:', e); }
    if (typeof closeModal === 'function') closeModal('modal-sku-review-import-' + shopId);
    if (typeof showToast === 'function') showToast('✅ 已导入 ' + rows.length + ' 条款式评价', 'success');
  }

  function _hookImport() {
    // 1) hook file handlers
    if (typeof window.handleSkuReviewFileSelect === 'function' && !window.__v211_patchedSkuSelect) {
      window.__v211_patchedSkuSelect = true;
      window._origHandleSkuReviewFileSelect = window.handleSkuReviewFileSelect;
      window.handleSkuReviewFileSelect = _newHandleSkuReviewFileSelect;
    }
    if (typeof window.handleSkuReviewFileDrop === 'function' && !window.__v211_patchedSkuDrop) {
      window.__v211_patchedSkuDrop = true;
      window._origHandleSkuReviewFileDrop = window.handleSkuReviewFileDrop;
      window.handleSkuReviewFileDrop = _newHandleSkuReviewFileDrop;
    }
    // 2) hook importSkuReviews
    if (typeof window.importSkuReviews === 'function' && !window.__v211_patchedImport) {
      window.__v211_patchedImport = true;
      window._origImportSkuReviews = window.importSkuReviews;
      window.importSkuReviews = _newImportSkuReviews;
    }
  }

  function _waitAndHookImport() {
    if (typeof window.handleSkuReviewFileSelect === 'function' ||
        typeof window.importSkuReviews === 'function') {
      _hookImport();
      setTimeout(_hookImport, 500);  // 兜底
    } else {
      setTimeout(_waitAndHookImport, 200);
    }
  }
  _waitAndHookImport();

  console.log('[V211 cb-import-chart-fix] 已加载: ① 优化页差评率/好评数趋势图 SVG 美化 ② 款式评价批量导入提速 ③ type 字段支持中文(好评/差评/中评)');
})();
