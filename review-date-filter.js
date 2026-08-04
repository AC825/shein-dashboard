/**
 * 差评率 Tab：综合差评率与日期范围联动
 * 用户需求：选择日期范围 → 综合差评率 / 最新差评率 / 最差 / 总数 自动重新计算
 *
 * 策略：监听 #cb-tab-reviews-{shopId} 内的日期输入框（rvf-start / rvf-end），
 * 以及月份快速选择变化时，重新计算顶部 4 个汇总卡片。
 */
(function() {
  'use strict';

  function _id(s) { return document.getElementById(s); }

  // 计算统计
  function calcStats(shopId, fromDate, toDate) {
    var all = [];
    try { if (typeof CBReviewDB !== 'undefined' && CBReviewDB.getAll) all = CBReviewDB.getAll(shopId) || []; } catch(e) { all = []; }
    var filtered = all.filter(function(r) { return r.date && (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate); });
    if (filtered.length === 0) {
      return { count: 0, avgRate: 0, latest: null, latestDate: '', peak: null, peakRate: 0, peakDate: '' };
    }
    var total = 0, ratedCount = 0;
    filtered.forEach(function(r) {
      if (r.negative_rate != null) { total += r.negative_rate; ratedCount++; }
    });
    var avgRate = ratedCount > 0 ? total / ratedCount : 0;
    var sorted = filtered.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var latest = sorted[0];
    var peak = sorted[0]; var peakRate = (latest && latest.negative_rate) || 0;
    sorted.forEach(function(r) {
      var rRate = r.negative_rate || 0;
      if (rRate > peakRate) { peak = r; peakRate = rRate; }
    });
    return {
      count: filtered.length,
      avgRate: avgRate,
      latest: latest,
      latestDate: latest ? (latest.date || '') : '',
      latestRate: latest ? (latest.negative_rate || 0) : 0,
      peak: peak,
      peakRate: peakRate,
      peakDate: peak ? (peak.date || '') : ''
    };
  }

  // 刷新 4 个汇总卡片
  function refreshSummary(shopId, fromDate, toDate) {
    var tab = _id('cb-tab-reviews-' + shopId);
    if (!tab) return;
    var stats = calcStats(shopId, fromDate, toDate);

    // 找包含"综合差评率"的卡片（4 个 summary 卡片都在一个 grid 容器里）
    var allGrids = tab.querySelectorAll('div[style*="grid-template-columns"]');
    var summaryGrid = null;
    for (var i = 0; i < allGrids.length; i++) {
      if (allGrids[i].textContent.indexOf('综合差评率') >= 0) { summaryGrid = allGrids[i]; break; }
    }
    if (!summaryGrid) return;

    // 4 个卡片 div（按 [0]=综合 [1]=最新 [2]=最差 [3]=总数 顺序）
    var cards = summaryGrid.querySelectorAll(':scope > div');
    if (cards.length < 4) return;

    // 卡片 0: 综合差评率（平均值）
    var avgColor = stats.avgRate <= 2 ? '#34d399' : (stats.avgRate <= 5 ? '#fbbf24' : '#f87171');
    var avgBg = stats.avgRate <= 2 ? 'rgba(52,211,153,0.08)' : (stats.avgRate <= 5 ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)');
    cards[0].style.background = avgBg;
    cards[0].style.borderColor = avgColor + '33';
    var avgNum = cards[0].querySelector('div[style*="font-size:22px"]');
    if (avgNum) { avgNum.textContent = stats.count > 0 ? stats.avgRate.toFixed(2) + '%' : '-'; avgNum.style.color = avgColor; }
    // 找综合差评率下的 sub（第三个 div）
    var avgSubDivs = cards[0].querySelectorAll(':scope > div');
    if (avgSubDivs[2] && stats.count > 0) {
      avgSubDivs[2].textContent = stats.avgRate <= 2 ? '优秀' : (stats.avgRate <= 5 ? '注意' : '偏高');
      avgSubDivs[2].style.color = avgColor;
      avgSubDivs[2].style.opacity = '0.8';
    }

    // 卡片 1: 最新差评率
    var latestColor = stats.latestRate <= 2 ? '#34d399' : (stats.latestRate <= 5 ? '#fbbf24' : '#f87171');
    var latestNum = cards[1].querySelector('div[style*="font-size:22px"]');
    if (latestNum) { latestNum.textContent = stats.latest ? stats.latestRate.toFixed(2) + '%' : '-'; latestNum.style.color = latestColor; }
    var lSubDivs = cards[1].querySelectorAll(':scope > div');
    if (lSubDivs[2]) lSubDivs[2].textContent = stats.latestDate || '';

    // 卡片 2: 最差
    var peakColor = stats.peakRate <= 2 ? '#34d399' : (stats.peakRate <= 5 ? '#fbbf24' : '#f87171');
    var peakNum = cards[2].querySelector('div[style*="font-size:22px"]');
    if (peakNum) { peakNum.textContent = stats.peak ? stats.peakRate.toFixed(2) + '%' : '-'; peakNum.style.color = peakColor; }
    var pSubDivs = cards[2].querySelectorAll(':scope > div');
    if (pSubDivs[2]) pSubDivs[2].textContent = stats.peakDate || '';

    // 卡片 3: 总记录数
    var countNum = cards[3].querySelector('div[style*="font-size:22px"]');
    if (countNum) countNum.textContent = stats.count;
  }

  // 给现有日期范围输入框绑定事件
  function bindDateEvents(shopId) {
    var tab = _id('cb-tab-reviews-' + shopId);
    if (!tab) return;
    if (tab.getAttribute('data-rps-bound') === '1') return;
    tab.setAttribute('data-rps-bound', '1');

    var fromInput = _id('rvf-start-' + shopId);
    var toInput = _id('rvf-end-' + shopId);
    var from = function() { return fromInput ? fromInput.value : ''; };
    var to = function() { return toInput ? toInput.value : ''; };

    function update() {
      // 延迟 100ms 让 applyReviewFilter 先执行
      setTimeout(function() { refreshSummary(shopId, from(), to()); }, 100);
    }

    if (fromInput) fromInput.addEventListener('input', update);
    if (fromInput) fromInput.addEventListener('change', update);
    if (toInput) toInput.addEventListener('input', update);
    if (toInput) toInput.addEventListener('change', update);

    // 也监听月份快速选择（select）
    var selects = tab.querySelectorAll('select');
    selects.forEach(function(sel) {
      if (sel.getAttribute('onchange') && sel.getAttribute('onchange').indexOf('applyReviewFilterByMonth') >= 0) {
        sel.addEventListener('change', update);
      }
      if (sel.getAttribute('onchange') && sel.getAttribute('onchange').indexOf('resetReviewFilter') >= 0) {
        sel.addEventListener('click', update);
      }
    });

    // 监听重置按钮
    var resetBtn = tab.querySelector('button[onclick*="resetReviewFilter"]');
    if (resetBtn) resetBtn.addEventListener('click', update);

    // 初始加载
    setTimeout(function() { refreshSummary(shopId, from(), to()); }, 200);
  }

  // 扫描
  function scanReviewTabs() {
    document.querySelectorAll('[id^="cb-tab-reviews-"]').forEach(function(tab) {
      var shopId = tab.id.replace('cb-tab-reviews-', '');
      bindDateEvents(shopId);
    });
  }

  // 初始化
  function init() {
    var timer = null;
    var obs = new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(scanReviewTabs, 100);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    scanReviewTabs();
    console.log('[ReviewDateFilter] ✅ 差评率日期联动已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
