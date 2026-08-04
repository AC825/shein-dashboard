/**
 * V215 加急任务抽屉（超过 1 周未完成 → 标红 + 加急处理）
 *
 * 触发：hook _v191_injectTaskTab（任务面板渲染入口），渲染完后：
 *   1) 计算加急任务清单：未完成（completion ≠ '已完成'）+ 截止已过 7 天以上
 *      - 截止 = date_end || task_date
 *      - 超期天数 = today - 截止
 *      - 加急阈值 = 7 天
 *   2) 在 cb-tab-tasks-{shopId} 顶部插一个「⚠️ 加急 N」红色按钮
 *   3) 点按钮 → 展开抽屉，列出加急任务（每条带红色边框 + 「加急处理」红底白字徽标）
 *      操作：编辑（调 openTaskModal）/ 一键标记完成（调 cycleTaskCompletion）
 *
 * 数据：window.CBTaskDB.getAll(shopId)，兼容 cb_tasks 表
 */
(function() {
  'use strict';

  // ---------- 超期检测 ----------
  // 用本地分量拼字符串，避免 GMT+8 凌晨 toISOString 漂移到前一天
  function _today() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function _addDays(date, days) {
    var d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function _daysBetween(a, b) {
    // a, b 是 'YYYY-MM-DD'；返回 b - a 的天数（b 在 a 之后为正）
    var da = new Date(a + 'T00:00:00');
    var db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  // 返回 { task, overdueDays } 数组，按 overdueDays 倒序
  function getUrgentTasks(shopId) {
    var all = [];
    try {
      if (window.CBTaskDB && typeof window.CBTaskDB.getAll === 'function') {
        all = window.CBTaskDB.getAll(shopId) || [];
      }
    } catch(e) { all = []; }
    if (!all.length) return [];
    var today = _today();
    var result = [];
    all.forEach(function(r) {
      if (r.completion === '已完成') return; // 已完成不算
      var due = r.date_end || r.task_date;
      if (!due) return;
      var od = _daysBetween(due, today);
      if (od > 7) { // 超过 1 周未完成
        result.push({ task: r, overdueDays: od });
      }
    });
    result.sort(function(a, b) { return b.overdueDays - a.overdueDays; });
    return result;
  }

  // ---------- 注入 DOM ----------
  function renderUrgentBar(shopId, urgentList) {
    var container = document.getElementById('cb-tab-tasks-' + shopId);
    if (!container) return;
    // 移除旧实例（避免重复渲染）
    var old = container.querySelector('.ec-urgent-wrap');
    if (old) old.remove();

    if (!urgentList.length) return; // 0 条不显示入口

    var barId = 'ec-urgent-bar-' + shopId;
    var drawerId = 'ec-urgent-drawer-' + shopId;
    var topN = urgentList.length;

    var bar = document.createElement('div');
    bar.className = 'ec-urgent-wrap';
    bar.style.cssText = 'margin:0 0 12px 0;display:flex;flex-direction:column;gap:0';

    // 顶部按钮
    var btn = document.createElement('button');
    btn.id = barId;
    btn.type = 'button';
    btn.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:10px 14px', 'background:linear-gradient(135deg,#fee2e2,#fecaca)',
      'border:1px solid #fca5a5', 'border-left:4px solid #dc2626',
      'border-radius:8px', 'cursor:pointer', 'font-size:13px',
      'color:#991b1b', 'font-weight:600', 'box-shadow:0 1px 3px rgba(220,38,38,0.08)'
    ].join(';');
    btn.innerHTML = '<span>⚠️ <span style="font-size:14px">加急任务 ' + topN + ' 项</span> <span style="font-size:11px;font-weight:400;color:#b91c1c">（已超过 1 周未完成）</span></span>' +
                    '<span class="ec-urgent-toggle" style="font-size:11px;color:#7f1d1d">展开 ▾</span>';
    btn.onclick = function() {
      var dr = document.getElementById(drawerId);
      if (!dr) return;
      var hidden = dr.style.display === 'none';
      dr.style.display = hidden ? '' : 'none';
      btn.querySelector('.ec-urgent-toggle').textContent = hidden ? '收起 ▴' : '展开 ▾';
    };
    bar.appendChild(btn);

    // 抽屉
    var drawer = document.createElement('div');
    drawer.id = drawerId;
    drawer.style.cssText = 'display:none;margin-top:8px;background:#fff;border:1px solid #fca5a5;border-radius:8px;overflow:hidden';

    var rowsHtml = urgentList.map(function(item) {
      var t = item.task;
      var od = item.overdueDays;
      var content = (t.task_content || t.style_no || '(无内容)');
      var shopIdSafe = (t.shop_id || shopId || '');
      // date_end > today-od
      var range = (t.task_date || '') + (t.date_end && t.date_end !== t.task_date ? (' ~ ' + t.date_end) : '');
      var typeLabel = t.task_type === 'weekly' ? '周度目标' : (t.task_type === 'monthly' ? '月度目标' : '每日任务');
      var completionLabel = t.completion === '处理中' ? '<span style="background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">处理中</span>'
                          : '<span style="background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">待处理</span>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #fee2e2;background:linear-gradient(180deg,#fff5f5,#fff);">' +
        '<span style="background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;white-space:nowrap;letter-spacing:0.3px">加急处理</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;color:#0f172a;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(content) + '">' + _esc(content) + '</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<span>📅 ' + _esc(range) + '</span>' +
            '<span style="color:#dc2626;font-weight:600">⏰ 已超 ' + od + ' 天</span>' +
            '<span style="background:#e0e7ff;color:#4338ca;padding:1px 6px;border-radius:4px;font-size:10px">' + typeLabel + '</span>' +
            completionLabel +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0">' +
          '<button onclick="window.openTaskModal && window.openTaskModal(\'' + _esc(shopIdSafe) + '\',\'' + _esc(t.id) + '\')" style="background:#fff;border:1px solid #cbd5e1;color:#475569;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px">编辑</button>' +
          '<button onclick="window.cycleTaskCompletion && window.cycleTaskCompletion(\'' + _esc(shopIdSafe) + '\',\'' + _esc(t.id) + '\')" style="background:#16a34a;border:none;color:#fff;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:500">✓ 完成</button>' +
        '</div>' +
      '</div>';
    }).join('');

    drawer.innerHTML = '<div style="padding:8px 14px;background:#fef2f2;border-bottom:1px solid #fecaca;font-size:11px;color:#7f1d1d;font-weight:500">' +
                       '🔥 以下任务已超过截止日期 7 天，请尽快处理：</div>' + rowsHtml;

    bar.appendChild(drawer);

    // 插到面板最顶部
    container.insertBefore(bar, container.firstChild);
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- hook _v191_injectTaskTab ----------
  function installHook(origFn) {
    if (window._v215_urgentHooked) return;
    window._v215_urgentHooked = true;
    window._v191_injectTaskTab = function(shopId) {
      origFn.call(window, shopId);
      // 等一帧，等任务卡片渲染完
      setTimeout(function() {
        try {
          var urgent = getUrgentTasks(shopId);
          renderUrgentBar(shopId, urgent);
        } catch(e) { console.warn('[V215 urgent] render err', e); }
      }, 50);
    };
    console.log('[V215] 加急任务抽屉 patch 已安装');
  }

  var orig = window._v191_injectTaskTab;
  if (typeof orig !== 'function') {
    var retry = function() {
      var fn = window._v191_injectTaskTab;
      if (typeof fn !== 'function') { setTimeout(retry, 200); return; }
      installHook(fn);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', retry);
    } else { retry(); }
    return;
  }
  installHook(orig);

  // 暴露给调试用
  window.__ec_getUrgentTasks = getUrgentTasks;
})();