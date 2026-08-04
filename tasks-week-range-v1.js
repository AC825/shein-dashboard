/**
 * V215 周范围算法改为"周六 → 下周五"（monkey-patch 外挂层）
 *
 * 背景：
 *  - 原 shop-tasks-v1.js getWeekRange 用 `getDay() || 7` 算法，周= 周一~周日
 *  - 用户工作周：周六开会、周日放假；一周跨度 7 天 = 本周六 → 本周五（按周一算法此时是 "上周六~本周五"）
 *  - 例：今天 2026-07-31（周五）
 *      原算法本周: 2026-07-27 (周一) ~ 2026-08-02 (周日)
 *      用户语义本周: 2026-07-25 (上周六) ~ 2026-07-31 (本周五)
 *      用户语义下周: 2026-08-01 (本周六) ~ 2026-08-07 (下周五)
 *
 * 实现：
 *  - 不修改原 shop-tasks-v1.js；hook window._v191_injectTaskTab（任务面板渲染入口）
 *  - 渲染后扫面板 DOM，把卡片里的日期 hint（"📆 YYYY-MM-DD ~ MM-DD"）按新算法重写
 *  - 暴露 window.__ec_weekRange() 供加急抽屉 / 其他模块复用同一算法
 *
 * 注：
 *  - 分类逻辑 classifyTask 内部也调用 getWeekRange，但模块内部拿不到，本补丁只
 *    改渲染展示。分类逻辑差异影响任务归到哪个卡片，但用户感知主要是日期 hint 和
 *    "今天是不是本周内"的判断（自动完成度、添加任务弹窗的默认日期等）。
 *    → 添加任务弹窗的默认值会带 `defaultModule=thisWeek`，hint 显示会被这里改掉。
 */
(function() {
  'use strict';

  // ---------- 周六 → 下周五 算法 ----------
  // 用本地日期分量拼字符串（避免 GMT+8 时区下 toISOString 漂移到前一天）
  function _fmtLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function _addDays(date, days) {
    var d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return _fmtLocal(d);
  }
  // 给定任意日期，返回它所在"工作周"的周六
  //   周六(6) -> offset 0
  //   周日(0) -> offset 1
  //   周一(1) -> offset 2
  //   ...
  //   周五(5) -> offset 6
  function _saturdayOf(date) {
    var d = new Date(date + 'T00:00:00');
    var day = d.getDay();
    var offset = (day + 1) % 7;
    d.setDate(d.getDate() - offset);
    return _fmtLocal(d);
  }
  // 工作周范围：{ start: 本周六, end: 本周五(=本周六+6) }
  function getWorkWeekRange(date) {
    var sat = _saturdayOf(date);
    return { start: sat, end: _addDays(sat, 6) };
  }

  // 暴露给其他模块复用
  window.__ec_weekRange = getWorkWeekRange;
  window.__ec_addDays = _addDays;

  // ---------- DOM patch ----------
  // 找到"本周任务 / 下周任务"卡片，把里面的 hint 换成新算法
  function patchWeekHints(shopId) {
    var container = document.getElementById('cb-tab-tasks-' + shopId);
    if (!container) return;

    var today = new Date().toISOString().slice(0, 10);
    var thisWeek = getWorkWeekRange(today);
    var nextWeek = { start: _addDays(thisWeek.start, 7), end: _addDays(thisWeek.end, 7) };

    // 卡片容器特征：style 含 "border-top:3px solid"
    var cards = container.querySelectorAll('div[style*="border-top:3px solid"]');
    cards.forEach(function(card) {
      var titleWrap = card.querySelector('div[style*="font-size:14px"][style*="font-weight:600"]');
      if (!titleWrap) return;
      var titleText = (titleWrap.textContent || '').trim();
      // 找 hint 子 div（color:#94a3b8 的小字）
      var hintDiv = titleWrap.querySelector('div[style*="color:#94a3b8"]');
      if (!hintDiv) return;

      var newHint = '';
      if (titleText.indexOf('本周任务') >= 0) {
        newHint = '📆 ' + thisWeek.start + ' ~ ' + thisWeek.end.slice(5);
      } else if (titleText.indexOf('下周任务') >= 0) {
        newHint = '📆 ' + nextWeek.start + ' ~ ' + nextWeek.end.slice(5);
      } else {
        return; // 本月任务不动
      }
      hintDiv.textContent = newHint;
    });
  }

  // ---------- hook _v191_injectTaskTab ----------
  var orig = window._v191_injectTaskTab;
  if (typeof orig !== 'function') {
    console.warn('[V215 week-range] _v191_injectTaskTab not found, will retry on DOMContentLoaded');
    var retry = function() {
      var fn = window._v191_injectTaskTab;
      if (typeof fn !== 'function') { setTimeout(retry, 200); return; }
      installHook(fn);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', retry);
    } else {
      retry();
    }
    return;
  }
  installHook(orig);

  function installHook(origFn) {
    if (window._v215_weekHooked) return;
    window._v215_weekHooked = true;
    window._v191_injectTaskTab = function(shopId) {
      origFn.call(window, shopId);
      // 渲染后等一帧（renderModule hint 在 DOM 中可能异步），再扫
      try { patchWeekHints(shopId); } catch(e) { console.warn('[V215] patchWeekHints err', e); }
      setTimeout(function() { try { patchWeekHints(shopId); } catch(e) {} }, 30);
    };
    console.log('[V215] 周范围算法 patch 已安装（周六→下周五）');
  }
})();