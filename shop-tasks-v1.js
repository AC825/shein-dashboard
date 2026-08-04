/**
 * 店铺任务模块 v6（2026-07-24 V151 任务按钮稳定注入 + 任务类型分离）
 *  - date_end  = 结束日期（可选，留空视为单日任务）
 *  - 分类逻辑：任务的 [task_date, date_end] 区间 与 本周/下周/本月 有交集即归入对应模块
 *  - 每日任务：按 task_date（开始日期）聚合
 *  - task_type = 'daily' | 'weekly' | 'monthly'，默认 'daily'
 *    - daily: 每日任务，不进顶部 Tab，只在底部「每日任务」区显示
 *    - weekly: 周度目标，进「本周/下周」Tab，完成度自动汇总周期内匹配的每日任务
 *    - monthly: 月度目标，进「本月」Tab，完成度自动汇总周期内匹配的每日任务
 *  - V151 修复：拦截 refreshCBArea，在 innerHTML 赋值后立即重注入任务按钮，根除"快速切换 Tab 时按钮消失"的 bug
 *
 * 时间范围支持：
 *  - task_date = 开始日期（必填）
 *  - date_end  = 结束日期（可选，留空视为单日任务）
 *  - 分类逻辑：任务的 [task_date, date_end] 区间 与 本周/下周/本月 有交集即归入对应模块
 *  - 每日任务：按 task_date（开始日期）聚合
 *  - 趋势图：按 task_date 统计
 *
 * 布局：
 *  ┌─────────────────────────────────────────────┐
 *  │  本周任务  +  │  下周任务  +  │  本月任务  +  │  ← 3 模块并排
 *  ├──────────────┴──────────────┴──────────────┤
 *  │  任务趋势图                          [大块]  │
 *  ├─────────────────────────────────────────────┤
 *  │  每日任务  ➕ 添加今日任务         [大块]    │
 *  └─────────────────────────────────────────────┘
 *
 * 数据：localStorage (ec_cb_tasks_{shopId}) + Supabase (cb_tasks 表，新增 date_end 列)
 */
(function() {
  'use strict';

  // ============= 工具函数 =============
  function _id(s) { return document.getElementById(s); }
  function _q(s) { return document.querySelector(s); }
  function _qAll(s) { return document.querySelectorAll(s); }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _uuid() { return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
  function _today() { return new Date().toISOString().slice(0, 10); }

  // ============= 日期工具 =============
  function _dateRange(row) {
    var s = row.task_date;
    var e = row.date_end || row.task_date;
    if (!s) return { start: '', end: '' };
    if (e && e < s) e = s; // 兜底：结束早于开始则视为单日
    return { start: s, end: e || s };
  }
  function _intersects(rangeS, rangeE, winS, winE) {
    if (!rangeS) return false;
    return rangeS <= winE && rangeE >= winS;
  }
  function _fmtRange(row) {
    var r = _dateRange(row);
    if (!r.start) return '-';
    if (!r.end || r.end === r.start) return r.start;
    // 跨月/跨年时分别完整显示
    if (r.start.slice(0, 7) === r.end.slice(0, 7)) {
      return r.start + ' ~ ' + r.end.slice(8);
    }
    return r.start + ' ~ ' + r.end;
  }
  function _dayCount(row) {
    var r = _dateRange(row);
    if (!r.start || !r.end) return 1;
    var sd = new Date(r.start + 'T00:00:00');
    var ed = new Date(r.end + 'T00:00:00');
    return Math.max(1, Math.round((ed - sd) / 86400000) + 1);
  }

  // ============= 数据层 =============
  const STORAGE_KEY = 'ec_cb_tasks_';

  function getAllLocal(shopId) {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY + shopId) || '[]'); }
    catch(e) { return []; }
  }
  function saveLocal(shopId, list) {
    localStorage.setItem(STORAGE_KEY + shopId, JSON.stringify(list));
  }
  async function saveToCloud(shopId, list) {
    try {
      if (!list || !list.length) return;
      if (typeof window.sbFetch !== 'function') return;
      if (typeof window.SUPABASE_ENABLED !== 'undefined' && !window.SUPABASE_ENABLED) return;
      try { await window.sbFetch('cb_tasks?shop_id=eq.' + encodeURIComponent(shopId), 'DELETE'); } catch(e) {}
      const normalized = list.map(function(r) {
        return {
          id: r.id, shop_id: shopId,
          task_date: r.task_date || null,
          // V193f: 云端 cb_tasks 表实测缺失 date_end 列(PGRST204),
          // 必须剔除该字段,否则整批 POST 失败 → 任务永远传不上云。
          // 本地 localStorage 仍保留 date_end,功能不受影响;待云端补列后可恢复推送。
          style_no: r.style_no || null,
          task_content: r.task_content || null,
          spu: r.spu || null,
          shop: r.shop || null,
          image_source: r.image_source || null,
          completion: r.completion || null,
          assignee: r.assignee || null,
          updated_at: r.updated_at || null,
          remark: r.remark || null,
          task_type: r.task_type || 'daily'
        };
      });
      for (let i = 0; i < normalized.length; i += 50) {
        const chunk = normalized.slice(i, i + 50);
        try {
          await window.sbFetch('cb_tasks', 'POST', chunk, { 'Prefer': 'resolution=ignore-duplicates' });
        } catch (e) {
          // 兜底：老库可能尚未执行 SQL 增加 task_type 列，去掉该字段重试，保证数据不丢
          var msg = String((e && e.message) || e || '');
          if (msg.indexOf('task_type') >= 0 || msg.indexOf('column') >= 0) {
            const stripped = chunk.map(function(x) { var c = Object.assign({}, x); delete c.task_type; return c; });
            await window.sbFetch('cb_tasks', 'POST', stripped, { 'Prefer': 'resolution=ignore-duplicates' });
          } else {
            throw e;
          }
        }
      }
    } catch(e) { console.warn('[Tasks] 云端保存失败:', e.message); }
  }
  async function loadFromCloud(shopId) {
    try {
      if (typeof window.sbFetch !== 'function') return [];
      if (typeof window.SUPABASE_ENABLED !== 'undefined' && !window.SUPABASE_ENABLED) return [];
      const rows = await window.sbFetch('cb_tasks?shop_id=eq.' + encodeURIComponent(shopId) + '&select=*&order=task_date.desc');
      if (!Array.isArray(rows)) return [];
      return rows.map(function(r) {
        return {
          id: r.id, shop_id: r.shop_id,
          task_date: r.task_date,
          date_end: r.date_end || null,
          style_no: r.style_no, task_content: r.task_content,
          spu: r.spu, shop: r.shop, image_source: r.image_source,
          completion: r.completion, assignee: r.assignee,
          updated_at: r.updated_at, remark: r.remark,
          task_type: r.task_type || 'daily'
        };
      });
    } catch(e) { return []; }
  }

  window.CBTaskDB = {
    getAll: getAllLocal,
    save: function(shopId, list) { saveLocal(shopId, list); saveToCloud(shopId, list); },
    add: function(shopId, row) {
      var list = getAllLocal(shopId);
      row.id = row.id || _uuid();
      row.shop_id = shopId;
      row.updated_at = _today();
      if (!row.task_type) row.task_type = 'daily';
      // 兜底：date_end < task_date 时清空 date_end
      if (row.date_end && row.task_date && row.date_end < row.task_date) {
        row.date_end = null;
      }
      list.unshift(row);
      this.save(shopId, list);
      return row;
    },
    update: function(shopId, id, updates) {
      var list = getAllLocal(shopId);
      var idx = list.findIndex(function(r) { return r.id === id; });
      if (idx < 0) return null;
      if (updates.date_end && updates.task_date && updates.date_end < updates.task_date) {
        updates.date_end = null;
      }
      Object.assign(list[idx], updates, { updated_at: _today() });
      this.save(shopId, list);
      return list[idx];
    },
    remove: function(shopId, id) {
      var list = getAllLocal(shopId).filter(function(r) { return r.id !== id; });
      this.save(shopId, list);
    },
    // 从云端拉取并 merge 到本地（云端优先 + 本地独有保留），返回最终 list
    syncFromCloud: async function(shopId) {
      var cloudList = await loadFromCloud(shopId);
      var localList = getAllLocal(shopId);
      if (cloudList.length > 0) {
        // 云端非空：merge（云端为主，本地独有的保留）
        var cloudIds = {};
        cloudList.forEach(function(r) { if (r.id) cloudIds[r.id] = 1; });
        var localOnly = localList.filter(function(r) { return r.id && !cloudIds[r.id]; });
        // V193f: 云端可能缺列(如 date_end 未建),merge 时以本地为基底、云端覆盖,
        // 但本地有而云端为 null 的字段(如 date_end)予以保留,避免被云端 null 抹掉。
        var merged = cloudList.map(function(c) {
          var local = localList.find(function(l) { return l.id === c.id; });
          var m = Object.assign({}, local || {}, c);
          if ((m.date_end == null) && local && local.date_end) m.date_end = local.date_end;
          return m;
        }).concat(localOnly);
        saveLocal(shopId, merged);
        // 本地有云端没有的条目 → 补推云端
        if (localOnly.length > 0) {
          console.log('[Tasks] sync 发现本地独有 ' + localOnly.length + ' 条，已补推云端');
          saveToCloud(shopId, merged);
        }
        return merged;
      }
      // 云端为空（可能没列、可能断网）→ 保留本地不动，绝不覆盖
      return localList;
    }
  };

  // ============= 时间分类 =============
  function getWeekRange(date) {
    var d = new Date(date + 'T00:00:00');
    var day = d.getDay() || 7;
    var mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    var sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }
  function addDays(date, days) {
    var d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  // 任务类型归一化（兼容 V149 之前跑 SQL 出现的 Supabase 中文默认值 '每日'/'周度'/'月度'）
  // 返回 'daily' | 'weekly' | 'monthly' | ''（空表示未知/老数据）
  function _normalizeTaskType(t) {
    if (!t) return '';
    var s = String(t).toLowerCase().trim();
    if (s === 'daily' || s === '每日' || s === '日') return 'daily';
    if (s === 'weekly' || s === '周度' || s === '周' || s === '本周' || s === '下周') return 'weekly';
    if (s === 'monthly' || s === '月度' || s === '月' || s === '本月') return 'monthly';
    return s; // 其他值原样返回（防御）
  }

  // 任务按「类型 + 日期」归类：
  //  - task_type='weekly'  → 本周 / 下周（按其日期范围归属）
  //  - task_type='monthly' → 本月
  //  - task_type='daily'（或老数据无字段）→ 不进入顶部 Tab，只在底部「每日任务」按日期显示
  function classifyTask(row) {
    var type = _normalizeTaskType(row.task_type) || 'daily';
    if (type === 'daily') return null; // 每日任务不进顶部模块

    var r = _dateRange(row);
    if (!r.start) return type === 'monthly' ? 'thisMonth' : 'thisWeek';

    var thisWeek = getWeekRange(_today());
    var nextWeek = { start: addDays(thisWeek.start, 7), end: addDays(thisWeek.end, 7) };
    var monthStart = _today().slice(0, 7) + '-01';
    var monthEnd = _today().slice(0, 7) + '-31';

    if (type === 'monthly') {
      // 月度目标归入本月（只要与本月有交集，或本身就是本月范围）
      if (_intersects(r.start, r.end, monthStart, monthEnd)) return 'thisMonth';
      return 'thisMonth';
    }
    // weekly：优先下周，否则本周
    if (_intersects(r.start, r.end, nextWeek.start, nextWeek.end)) return 'nextWeek';
    return 'thisWeek';
  }

  // ============= 目标型任务完成度计算 =============
  // 周度/月度目标本身只生成「目标」，其完成度自动汇总周期内匹配的「每日任务」
  // 匹配规则：
  //  1) 每日任务的 task_date 落在目标的 [task_date, date_end] 区间内
  //  2) 若目标填写了「款号」作为关键词，则仅匹配款号相同 / 内容含该关键词的每日任务
  function computeGoalCompletion(goal, shopId) {
    var all = getAllLocal(shopId);
    var r = _dateRange(goal);
    var gs = r.start, ge = r.end || r.start;
    var kw = (goal.style_no || '').trim();
    var goalContent = (goal.task_content || '').trim();
    var matched = [];
    all.forEach(function(d) {
      var dt = _normalizeTaskType(d.task_type) || 'daily';
      if (dt === 'weekly' || dt === 'monthly') return; // 只看每日任务
      var dd = d.task_date;
      if (!dd) return;
      if (dd < gs || dd > ge) return; // 不在目标周期内
      if (kw) {
        var dm = (d.style_no || '') + ' ' + (d.task_content || '');
        if (d.style_no !== kw && dm.indexOf(kw) < 0 && goalContent.indexOf(d.style_no || '') < 0) return;
      }
      matched.push(d);
    });
    var total = matched.length;
    var done = matched.filter(function(d) { return d.completion === '已完成'; }).length;
    var inProgress = matched.filter(function(d) { return d.completion === '处理中'; }).length;
    var rate = total ? Math.round(done / total * 100) : 0;
    return { total: total, done: done, inProgress: inProgress, rate: rate, hasDaily: total > 0 };
  }

  function renderGoalCard(r, shopId) {
    var stat = computeGoalCompletion(r, shopId);
    var rate = stat.rate;
    var barColor = rate >= 100 ? '#22c55e' : (rate >= 50 ? '#1890ff' : '#f59e0b');
    var goalTypeLabel = _normalizeTaskType(r.task_type) === 'monthly' ? '🎯 月度目标' : '🎯 周度目标';
    var days = _dayCount(r);
    var dateText = _fmtRange(r);
    var daysBadge = days > 1
      ? ' · <span style="background:#1890ff15;color:#1890ff;padding:1px 6px;border-radius:8px;font-weight:600">' + days + ' 天</span>'
      : '';
    return '<div style="background:linear-gradient(180deg,#fffbeb,#fff);border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:#0f172a;margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
            _esc(r.task_content || r.style_no || '(无目标内容)') +
          '</div>' +
          '<div style="font-size:11px;color:#64748b;display:flex;align-items:center;flex-wrap:wrap;gap:2px">' +
            '📅 ' + dateText + daysBadge +
            (r.style_no ? ' · 款号 ' + _esc(r.style_no) : '') +
            (r.assignee ? ' · ' + _esc(r.assignee) : '') +
          '</div>' +
        '</div>' +
        '<span style="background:#f59e0b22;color:#b45309;font-size:10px;padding:2px 8px;border-radius:10px;white-space:nowrap;font-weight:600;flex-shrink:0">' +
          goalTypeLabel +
        '</span>' +
      '</div>' +
      '<div style="margin:8px 0 6px">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:#475569;margin-bottom:3px">' +
          '<span>自动完成度（匹配每日任务）</span>' +
          '<span style="font-weight:700;color:' + barColor + '">' + rate + '%</span>' +
        '</div>' +
        '<div style="height:8px;background:#f1f5f9;border-radius:6px;overflow:hidden">' +
          '<div style="height:100%;width:' + rate + '%;background:' + barColor + ';border-radius:6px;transition:width .3s"></div>' +
        '</div>' +
        '<div style="font-size:10px;color:#94a3b8;margin-top:3px">' +
          (stat.hasDaily
            ? '已完成 ' + stat.done + ' / 共 ' + stat.total + ' 项每日任务' + (stat.inProgress ? ' · 处理中 ' + stat.inProgress : '')
            : '⚠️ 该周期内暂无匹配的每日任务（用「款号」作为匹配关键词）') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px dashed #fde68a">' +
        '<div style="font-size:10px;color:#94a3b8;display:flex;gap:8px;flex-wrap:wrap">' +
          (r.spu ? '<span>SPU: ' + _esc(r.spu) + '</span>' : '') +
          (r.shop ? '<span>店铺: ' + _esc(r.shop) + '</span>' : '') +
          (r.image_source ? '<span>来源: ' + _esc(r.image_source) + '</span>' : '') +
          (r.remark ? '<span title="' + _esc(r.remark) + '">备注: ' + _esc(r.remark).slice(0, 20) + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0">' +
          '<button onclick="openTaskModal(\'' + shopId + '\',\'' + r.id + '\')" style="background:transparent;border:1px solid #f59e0b;color:#b45309;cursor:pointer;padding:1px 8px;border-radius:4px;font-size:10px">编辑</button>' +
          '<button onclick="deleteTask(\'' + shopId + '\',\'' + r.id + '\')" style="background:transparent;border:1px solid #ef4444;color:#ef4444;cursor:pointer;padding:1px 8px;border-radius:4px;font-size:10px">删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============= 单个任务卡片 =============
  function renderTaskCard(r, shopId) {
    var rt = _normalizeTaskType(r.task_type);
    if (rt === 'weekly' || rt === 'monthly') return renderGoalCard(r, shopId);
    var c = r.completion || '待处理';
    var colors = {
      '已完成':   { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', dot: '#22c55e' },
      '处理中':   { bg: '#fef3c7', border: '#fde68a', text: '#b45309', dot: '#f59e0b' },
      '待处理':   { bg: '#f1f5f9', border: '#e2e8f0', text: '#475569', dot: '#94a3b8' }
    };
    var cs = colors[c] || colors['待处理'];
    var days = _dayCount(r);
    var dateText = _fmtRange(r);
    var daysBadge = days > 1
      ? ' · <span style="background:#1890ff15;color:#1890ff;padding:1px 6px;border-radius:8px;font-weight:600">' + days + ' 天</span>'
      : '';
    return '<div style="background:' + cs.bg + ';border:1px solid ' + cs.border + ';border-left:3px solid ' + cs.dot + ';border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:#0f172a;margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
            _esc(r.task_content || r.style_no || '(无任务内容)') +
          '</div>' +
          '<div style="font-size:11px;color:#64748b;display:flex;align-items:center;flex-wrap:wrap;gap:2px">' +
            '📅 ' + dateText + daysBadge +
            (r.style_no ? ' · 款号 ' + _esc(r.style_no) : '') +
            (r.assignee ? ' · ' + _esc(r.assignee) : '') +
          '</div>' +
        '</div>' +
        '<span style="background:' + cs.dot + '20;color:' + cs.text + ';font-size:10px;padding:2px 8px;border-radius:10px;white-space:nowrap;font-weight:600;flex-shrink:0">' +
          c +
        '</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px dashed ' + cs.border + '">' +
        '<div style="font-size:10px;color:#94a3b8;display:flex;gap:8px;flex-wrap:wrap">' +
          (r.spu ? '<span>SPU: ' + _esc(r.spu) + '</span>' : '') +
          (r.shop ? '<span>店铺: ' + _esc(r.shop) : '') +
          (r.image_source ? '<span>来源: ' + _esc(r.image_source) + '</span>' : '') +
          (r.remark ? '<span title="' + _esc(r.remark) + '">备注: ' + _esc(r.remark).slice(0, 20) + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0">' +
          '<button onclick="openTaskModal(\'' + shopId + '\',\'' + r.id + '\')" style="background:transparent;border:1px solid #1890ff;color:#1890ff;cursor:pointer;padding:1px 8px;border-radius:4px;font-size:10px">编辑</button>' +
          '<button onclick="deleteTask(\'' + shopId + '\',\'' + r.id + '\')" style="background:transparent;border:1px solid #ef4444;color:#ef4444;cursor:pointer;padding:1px 8px;border-radius:4px;font-size:10px">删除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============= 单个模块（卡片列表式）=============
  function renderModule(key, title, color, list, shopId) {
    var empty = '<div style="text-align:center;color:#94a3b8;padding:30px 10px;font-size:12px;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">暂无任务 · 点击右上 [ + 新增任务 ]</div>';
    var inner = list.length
      ? list.map(function(r) { return renderTaskCard(r, shopId); }).join('')
      : empty;

    // 提示当前模块的时间窗口
    var hint = '';
    if (key === 'thisWeek') {
      var w = getWeekRange(_today());
      hint = w.start + ' ~ ' + w.end.slice(5);
    } else if (key === 'nextWeek') {
      var w2 = getWeekRange(_today());
      var nw = { start: addDays(w2.start, 7), end: addDays(w2.end, 7) };
      hint = nw.start + ' ~ ' + nw.end.slice(5);
    } else if (key === 'thisMonth') {
      hint = _today().slice(0, 7);
    }

    return '<div style="background:#fff;border:1px solid #e2e8f0;border-top:3px solid ' + color + ';border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-height:300px">' +
      '<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(180deg, ' + color + '08, #fff);border-bottom:1px solid #f1f5f9">' +
        '<div style="font-size:14px;font-weight:600;color:#0f172a">' + title +
          ' <span style="font-size:11px;color:' + color + ';background:' + color + '15;padding:1px 8px;border-radius:10px;margin-left:6px;font-weight:500">' + list.length + '</span>' +
          '<div style="font-size:10px;color:#94a3b8;font-weight:400;margin-top:2px">📆 ' + hint + '</div>' +
        '</div>' +
        '<button onclick="openTaskModal(\'' + shopId + '\', null, \'' + key + '\')" style="background:' + color + ';border:none;color:#fff;cursor:pointer;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap">+ 新增任务</button>' +
      '</div>' +
      '<div style="padding:10px 12px;flex:1;overflow-y:auto;max-height:400px;background:#fafbfc">' + inner + '</div>' +
    '</div>';
  }

  // ============= 任务趋势图（canvas）=============
  function renderTrendChart(shopId) {
    var canvasId = 'task-trend-chart-' + shopId;
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
        '<span>📈 任务趋势图</span>' +
        '<span style="font-size:11px;color:#64748b;font-weight:normal">近 30 天任务完成情况（按开始日期）</span>' +
      '</div>' +
      '<div style="position:relative;height:240px;background:#fafbfc;border-radius:8px;padding:8px"><canvas id="' + canvasId + '"></canvas></div>' +
    '</div>';
  }

  // ============= 每日任务（按开始日期分组）=============
  function renderDailyTasks(shopId) {
    var all = getAllLocal(shopId);
    // 按开始日期 task_date 倒序
    var byDate = {};
    all.forEach(function(r) {
      var rt = _normalizeTaskType(r.task_type);
      if (rt === 'weekly' || rt === 'monthly') return; // 目标型不进每日任务区
      var d = r.task_date || '未排期';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(r);
    });
    var dates = Object.keys(byDate).sort(function(a, b) { return b.localeCompare(a); }).slice(0, 7);

    var inner;
    if (dates.length === 0) {
      inner = '<div style="text-align:center;color:#94a3b8;padding:36px 16px;font-size:13px;background:linear-gradient(180deg, #f8fafc, #f1f5f9);border-radius:10px;border:1px dashed #cbd5e1">' +
        '<div style="font-size:32px;margin-bottom:8px">📝</div>' +
        '<div style="font-weight:600;color:#475569;margin-bottom:4px">还没有每日任务</div>' +
        '<div style="font-size:12px;color:#94a3b8;margin-bottom:12px">具体到某一天要做什么，例：拍款、售后、报表</div>' +
        '<button onclick="openDailyTaskModal(\'' + shopId + '\', \'' + _today() + '\')" style="background:#1890ff;border:none;color:white;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;box-shadow:0 2px 4px rgba(24,144,255,0.3)">➕ 添加今日任务</button>' +
      '</div>';
    } else {
      inner = dates.map(function(d) {
        var items = byDate[d];
        var dayLabel = d;
        if (d === _today()) dayLabel = '🌟 今天 · ' + d;
        else if (d === addDays(_today(), 1)) dayLabel = '🌅 明天 · ' + d;
        else if (d === addDays(_today(), -1)) dayLabel = '⏪ 昨天 · ' + d;
        return '<div style="margin-bottom:10px;background:#fafbfc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">' +
          '<div style="font-size:12px;font-weight:600;color:#1890ff;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">' +
            '<span>📅 ' + dayLabel + '</span>' +
            '<span style="display:flex;gap:6px;align-items:center">' +
              '<span style="font-size:10px;color:#94a3b8;font-weight:normal">' + items.length + ' 个任务</span>' +
              '<button onclick="openDailyTaskModal(\'' + shopId + '\', \'' + d + '\')" style="background:#1890ff;border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px">+ 添加</button>' +
            '</span>' +
          '</div>' +
          items.map(function(r) {
            var c = r.completion || '待处理';
            var icon = c === '已完成' ? '✅' : (c === '处理中' ? '⏳' : '⭕');
            var days = _dayCount(r);
            var rangeText = _fmtRange(r);
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;color:#475569;border-bottom:1px dashed #f1f5f9">' +
              '<span style="cursor:pointer" onclick="cycleTaskCompletion(\'' + shopId + '\',\'' + r.id + '\')" title="点击切换状态">' + icon + '</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="openTaskModal(\'' + shopId + '\',\'' + r.id + '\')" title="点击编辑">' +
                '<span>' + _esc(r.task_content || r.style_no || '(无)') + '</span>' +
                (days > 1 ? ' <span style="font-size:10px;color:#1890ff;background:#1890ff10;padding:0 5px;border-radius:8px">↪ ' + rangeText + ' · ' + days + '天</span>' : '') +
              '</span>' +
              '<span style="font-size:10px;color:#94a3b8;background:#fff;padding:1px 6px;border-radius:4px;border:1px solid #e2e8f0">' + _esc(r.assignee || '-') + '</span>' +
              '<button onclick="deleteTask(\'' + shopId + '\',\'' + r.id + '\')" style="background:transparent;border:none;color:#cbd5e1;cursor:pointer;font-size:14px;padding:0 4px" title="删除">×</button>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('');
    }

    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px">' +
      '<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
        '<span>🗓️ 每日任务 <span style="font-size:11px;color:#64748b;font-weight:normal">· 具体执行项（按开始日期）</span></span>' +
        '<button onclick="openDailyTaskModal(\'' + shopId + '\', \'' + _today() + '\')" style="background:linear-gradient(135deg, #1890ff, #096dd9);border:none;color:white;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;box-shadow:0 2px 4px rgba(24,144,255,0.25)">➕ 添加今日任务</button>' +
      '</div>' +
      '<div>' + inner + '</div>' +
    '</div>';
  }

  // ============= 完整模块 =============
  function renderTaskModule(shopId) {
    var all = getAllLocal(shopId);
    var groups = { thisWeek: [], nextWeek: [], thisMonth: [] };
    all.forEach(function(r) {
      var k = classifyTask(r);
      if (groups[k]) groups[k].push(r);
    });
    Object.values(groups).forEach(function(arr) {
      arr.sort(function(a, b) { return (a.task_date || '').localeCompare(b.task_date || ''); });
    });

    var totalCount = all.length;
    var modulesHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">' +
      renderModule('thisWeek', '本周任务', '#1890ff', groups.thisWeek, shopId) +
      renderModule('nextWeek', '下周任务', '#a855f7', groups.nextWeek, shopId) +
      renderModule('thisMonth', '本月任务', '#f59e0b', groups.thisMonth, shopId) +
    '</div>';

    return '<div style="padding:0">' +
      // 顶部：标题 + 一键恢复按钮
      '<div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #bae6fd;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;flex-direction:column">' +
          '<div style="font-size:14px;font-weight:600;color:#0c4a6e">📋 店铺任务 · 共 <span style="color:#0284c7;font-size:16px">' + totalCount + '</span> 条</div>' +
          '<div style="font-size:11px;color:#0369a1;margin-top:2px">💡 数据同时保存在浏览器和云端，互相同步</div>' +
        '</div>' +
        '<button id="task-sync-cloud-btn" onclick="window._cbTaskSyncFromCloud && window._cbTaskSyncFromCloud(\'' + shopId + '\')" ' +
          'style="background:linear-gradient(135deg,#0ea5e9,#0284c7);border:none;color:white;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;box-shadow:0 2px 6px rgba(14,165,233,0.3);display:flex;align-items:center;gap:6px">' +
          '🔄 从云端同步' +
        '</button>' +
      '</div>' +
      // 3 个模块并排
      modulesHtml +
      // 任务趋势图
      renderTrendChart(shopId) +
      // 每日任务
      renderDailyTasks(shopId) +
    '</div>';
  }

  // ============= 应用 Tab 按钮高亮 =============
  function highlightTaskButton(shopId) {
    var bar = _id('cb-tab-buttons-' + shopId);
    if (!bar) return;
    Array.from(bar.children).forEach(function(b) {
      b.style.background = 'transparent';
      b.style.color = '#64748b';
      b.style.borderBottom = '2px solid transparent';
    });
    var taskBtn = bar.querySelector('[data-task-tab="' + shopId + '"]');
    if (taskBtn) {
      taskBtn.style.background = 'rgba(24,144,255,0.15)';
      taskBtn.style.color = '#1890ff';
      taskBtn.style.borderBottom = '2px solid #1890ff';
      taskBtn.style.fontWeight = '600';
    }
  }

  // ============= 注入 Tab 按钮 =============
  function injectTaskButton(shopId) {
    // V151 修复：多锚点查找 Tab 栏（不再只依赖 reviews 按钮）
    // 锚点优先级：reviews(差评率) > orders(订单列表) > refunds(退货退款) > daily(每日数据) > optimize(店铺优化)
    var anchors = ['reviews', 'orders', 'refunds', 'daily', 'optimize', 'overview'];
    var reviewsBtn = null;
    for (var i = 0; i < anchors.length; i++) {
      reviewsBtn = _q('button[onclick*="setCBTab(\'' + shopId + '\',\'' + anchors[i] + '\')"]');
      if (reviewsBtn) break;
    }
    if (!reviewsBtn) return false;
    // 找同一父级的 tab 栏
    var bar = reviewsBtn.parentNode;
    if (!bar) return false;
    if (bar.querySelector('[data-task-tab="' + shopId + '"]')) {
      if (window['_cbTab_' + shopId] === 'tasks') highlightTaskButton(shopId);
      return true;
    }

    if (!bar.id) bar.id = 'cb-tab-buttons-' + shopId;

    var btn = document.createElement('button');
    btn.setAttribute('data-task-tab', shopId);
    btn.style.cssText = reviewsBtn.style.cssText;
    btn.innerHTML = '📋 店铺任务';
    btn.onclick = function(e) {
      e.stopPropagation();
      switchToTasks(shopId);
    };
    // V151 修复：永远追加到 reviews 之后（如果存在），否则追加到末尾
    var reviewsAnchor = _q('button[onclick*="setCBTab(\'' + shopId + '\',\'reviews\')"]');
    if (reviewsAnchor && reviewsAnchor.parentNode === bar) {
      if (reviewsAnchor.nextSibling) {
        bar.insertBefore(btn, reviewsAnchor.nextSibling);
      } else {
        bar.appendChild(btn);
      }
    } else {
      bar.appendChild(btn);
    }
    if (window['_cbTab_' + shopId] === 'tasks') highlightTaskButton(shopId);
    return true;
  }

  // ============= 注入 Tab 内容 =============
  function injectTaskContent(shopId) {
    var reviewsContent = _id('cb-tab-reviews-' + shopId);
    if (!reviewsContent) return false;
    if (_id('cb-tab-tasks-' + shopId)) return true;

    var content = document.createElement('div');
    content.id = 'cb-tab-tasks-' + shopId;
    content.setAttribute('data-task-tab-content', shopId);
    content.style.display = 'none';
    content.innerHTML = renderTaskModule(shopId);
    reviewsContent.parentNode.insertBefore(content, reviewsContent.nextSibling);

    setTimeout(function() { drawTrendChart(shopId); }, 50);
    return true;
  }

  // ============= 画趋势图 =============
  function drawTrendChart(shopId) {
    var canvasId = 'task-trend-chart-' + shopId;
    var canvas = _id(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (canvas._chart) { try { canvas._chart.destroy(); } catch(e) {} }

    var all = getAllLocal(shopId);
    // 构造最近 30 天的数据（按 task_date 开始日期聚合）
    var today = new Date();
    var labels = [];
    var completedData = [];
    var pendingData = [];
    var inProgressData = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      var dateStr = d.toISOString().slice(0, 10);
      labels.push(dateStr.slice(5));
      var dayTasks = all.filter(function(r) { return (r.task_date || '') === dateStr && r.task_type !== 'weekly' && r.task_type !== 'monthly'; });
      completedData.push(dayTasks.filter(function(r) { return r.completion === '已完成'; }).length);
      inProgressData.push(dayTasks.filter(function(r) { return r.completion === '处理中'; }).length);
      pendingData.push(dayTasks.filter(function(r) { return !r.completion || r.completion === '待处理'; }).length);
    }

    var ctx = canvas.getContext('2d');
    canvas._chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: '已完成', data: completedData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, fill: true, pointRadius: 3 },
          { label: '处理中', data: inProgressData, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, fill: true, pointRadius: 3 },
          { label: '待处理', data: pendingData, borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.1)', tension: 0.3, fill: true, pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f1f5f9' } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } }
        }
      }
    });
  }

  // ============= 切换到任务 Tab =============
  function switchToTasks(shopId) {
    window['_cbTab_' + shopId] = 'tasks';
    // V208: 隐藏全部「其他」容器（6 内置 + 3 分析 drop/review-split/boost）
    //   之前漏了 3 个分析 tab 容器 → 从分析 tab 切到店铺任务时, 分析页内容会残留叠加
    ['overview', 'optimize', 'orders', 'refunds', 'daily', 'reviews',
     'drop', 'review-split', 'boost'].forEach(function(name) {
      var el = _id('cb-tab-' + name + '-' + shopId);
      if (el) el.style.display = 'none';
    });
    var taskEl = _id('cb-tab-tasks-' + shopId);
    if (taskEl) taskEl.style.display = 'block';

    highlightTaskButton(shopId);

    // 进入 Tab 时自动从云端拉一次（防止本地丢失导致看不到数据）
    setTimeout(function() { _autoSyncFromCloud(shopId); }, 80);
    setTimeout(function() { drawTrendChart(shopId); }, 100);
  }

  // 自动静默同步：拉云端 → merge → 如果有新增则刷新界面
  var _syncingShops = {};
  function _autoSyncFromCloud(shopId) {
    if (_syncingShops[shopId]) return;
    if (typeof window.sbFetch !== 'function') return;
    _syncingShops[shopId] = true;
    window.CBTaskDB.syncFromCloud(shopId).then(function(merged) {
      _syncingShops[shopId] = false;
      try {
        var cur = _id('cb-tab-tasks-' + shopId);
        if (!cur) return;
        var beforeCount = (window._cbTaskPrevCount && window._cbTaskPrevCount[shopId]) || 0;
        var afterCount = merged.length;
        window._cbTaskPrevCount = window._cbTaskPrevCount || {};
        window._cbTaskPrevCount[shopId] = afterCount;
        if (afterCount !== beforeCount && cur.style.display !== 'none') {
          refreshTaskContent(shopId);
          if (afterCount > beforeCount && beforeCount > 0) {
            (window.showToast || function(){})('☁️ 从云端恢复了 ' + (afterCount - beforeCount) + ' 条任务', 'success');
          }
        }
      } catch(e) {}
    }).catch(function() { _syncingShops[shopId] = false; });
  }

  // 暴露手动同步入口（按钮 onclick 调用）
  window._cbTaskSyncFromCloud = function(shopId) {
    if (!shopId) return;
    var btn = _id('task-sync-cloud-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ 同步中...';
      btn.style.opacity = '0.7';
    }
    window.CBTaskDB.syncFromCloud(shopId).then(function(merged) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 从云端同步';
        btn.style.opacity = '1';
      }
      refreshTaskContent(shopId);
      var localBefore = getAllLocal(shopId).length;
      (window.showToast || function(){})(
        '☁️ 同步完成 · 共 ' + merged.length + ' 条任务（云端优先 + 本地保留）',
        'success'
      );
    }).catch(function(err) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 从云端同步';
        btn.style.opacity = '1';
      }
      (window.showToast || alert)('同步失败：' + (err && err.message ? err.message : '未知错误'), 'warn');
    });
  };

  function deactivateTasks(shopId) {
    var taskEl = _id('cb-tab-tasks-' + shopId);
    if (taskEl) taskEl.style.display = 'none';
    var bar = _id('cb-tab-buttons-' + shopId);
    if (bar) {
      var taskBtn = bar.querySelector('[data-task-tab="' + shopId + '"]');
      if (taskBtn) {
        taskBtn.style.background = 'transparent';
        taskBtn.style.color = '#64748b';
      }
    }
  }

  // ============= 接管 setCBTab =============
  function hookSetCBTab() {
    if (typeof window.setCBTab !== 'function') return;
    if (window._setCBTabHooked) return;
    window._setCBTabHooked = true;
    var orig = window.setCBTab;
    window.setCBTab = function(shopId, tab) {
      if (tab === 'tasks') { switchToTasks(shopId); return; }
      deactivateTasks(shopId);
      return orig(shopId, tab);
    };
  }

  // ============= 接管 refreshCBArea（V151 核心修复）=============
  // setCBTab -> refreshCBArea -> innerHTML = renderCrossBorderDetail(...)
  // 整个 Tab 栏 innerHTML 被重置，动态注入的"店铺任务"按钮被销毁
  // 拦截 refreshCBArea，innerHTML 赋值后立即（0ms / 50ms / 200ms）三重注入
  // 解决"快速切换 Tab 时按钮消失"的 bug
  function hookRefreshCBArea() {
    if (typeof window.refreshCBArea !== 'function') return false;
    if (window._refreshCBAreaHooked) return true;
    window._refreshCBAreaHooked = true;
    var orig = window.refreshCBArea;
    window.refreshCBArea = function(shopId) {
      var result = orig(shopId);
      // 三重注入：0ms（同步兜底） + 50ms（DOM 渲染后） + 200ms（图表等异步组件完成后）
      try {
        injectTaskButton(shopId);
        injectTaskContent(shopId);
      } catch (e) { console.warn('[ShopTasks] sync inject failed:', e); }
      setTimeout(function() {
        try {
          injectTaskButton(shopId);
          injectTaskContent(shopId);
          if (window['_cbTab_' + shopId] === 'tasks') {
            var c = _id('cb-tab-tasks-' + shopId);
            if (c) c.style.display = 'block';
            highlightTaskButton(shopId);
          }
        } catch (e) { console.warn('[ShopTasks] 50ms inject failed:', e); }
      }, 50);
      setTimeout(function() {
        try {
          injectTaskButton(shopId);
          injectTaskContent(shopId);
        } catch (e) {}
      }, 200);
      return result;
    };
    console.log('[ShopTasks] ✅ hookRefreshCBArea 已挂载');
    return true;
  }

  function scanAndInject() {
    // V151 修复：扫描所有 setCBTab 按钮（不再限定 reviews）
    // 因为 reviews 按钮可能被 setCBTab 切换销毁
    var btns = _qAll('button[onclick*="setCBTab("]');
    var shopIds = new Set();
    btns.forEach(function(btn) {
      var m = btn.getAttribute('onclick').match(/setCBTab\('([^']+)'/);
      if (m) shopIds.add(m[1]);
    });
    shopIds.forEach(function(shopId) {
      injectTaskButton(shopId);
      injectTaskContent(shopId);
    });
    // V151 修复：每次扫描都尝试 hook refreshCBArea（首次出现时拦截）
    hookRefreshCBArea();
  }

  // ============= 每日任务快速弹窗（精简模式）=============
  window.openDailyTaskModal = function(shopId, defaultDate) {
    var modalId = 'modal-daily-task-' + shopId;
    var existing = _id(modalId);
    if (existing) existing.remove();

    var todayStr = defaultDate || _today();
    var html = '<div id="' + modalId + '" class="modal-overlay" style="display:flex;z-index:9999">' +
      '<div class="modal" style="max-width:560px;width:92%;background:#fff;border:1px solid #e2e8f0">' +
        '<div class="modal-header" style="background:linear-gradient(135deg,#1890ff,#096dd9);border-bottom:1px solid #e2e8f0;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">' +
          '<div class="modal-title" style="color:#fff;font-size:15px;font-weight:600">➕ 添加每日任务</div>' +
          '<button class="modal-close" onclick="closeModal(\'' + modalId + '\')" style="background:transparent;border:none;color:rgba(255,255,255,0.85);font-size:20px;cursor:pointer">&times;</button>' +
        '</div>' +
        '<div class="modal-body" style="display:grid;gap:12px;padding:20px">' +
          // 日期范围
          '<div>' +
            '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">📅 日期范围（开始 ~ 结束，留空结束 = 单日）</label>' +
            '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">' +
              '<input type="date" id="daily-date-start" value="' + todayStr + '" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
              '<span style="color:#94a3b8;font-size:14px">~</span>' +
              '<input type="date" id="daily-date-end" placeholder="留空" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
            '</div>' +
          '</div>' +
          // 任务内容
          '<div>' +
            '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">📝 任务内容 <span style="color:#ef4444">*</span></label>' +
            '<textarea id="daily-content" rows="2" placeholder="例：拍款 X123、跟单 5 单售后、统计昨日营业额..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>' +
          '</div>' +
          // 领取人 + 完成度
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div>' +
              '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">👤 领取人</label>' +
              '<input type="text" id="daily-assignee" placeholder="例：张三" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">⏱️ 完成度</label>' +
              '<select id="daily-completion" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
                '<option value="待处理">⭕ 待处理</option>' +
                '<option value="处理中">⏳ 处理中</option>' +
                '<option value="已完成">✅ 已完成</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          // 备注
          '<div>' +
            '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">💬 备注（可选）</label>' +
            '<input type="text" id="daily-remark" placeholder="补充说明..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:13px;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<div class="modal-btns" style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc">' +
          '<span style="font-size:11px;color:#94a3b8">💡 留空结束日期 = 单日任务；自动归到对应窗口</span>' +
          '<div style="display:flex;gap:8px">' +
            '<button onclick="closeModal(\'' + modalId + '\')" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
            '<button onclick="saveDailyTask(\'' + shopId + '\')" style="background:linear-gradient(135deg,#1890ff,#096dd9);border:none;color:white;padding:7px 22px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;box-shadow:0 2px 4px rgba(24,144,255,0.3)">✓ 保存</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(function() { var el = _id('daily-content'); if (el) el.focus(); }, 100);
  };

  window.saveDailyTask = function(shopId) {
    var content = ((_id('daily-content') || {}).value || '').trim();
    if (!content) {
      (window.showToast || alert)('请填写任务内容', 'warn');
      var el = _id('daily-content'); if (el) el.focus();
      return;
    }
    var startDate = (_id('daily-date-start') || {}).value || _today();
    var endDate = (_id('daily-date-end') || {}).value || '';
    if (endDate && endDate < startDate) endDate = ''; // 兜底
    var row = {
      task_date: startDate,
      date_end: endDate || null,
      task_content: content,
      assignee: (_id('daily-assignee') || {}).value || '',
      completion: (_id('daily-completion') || {}).value || '待处理',
      remark: (_id('daily-remark') || {}).value || ''
    };
    CBTaskDB.add(shopId, row);
    (window.showToast || function(){})('✅ 已添加任务' + (row.date_end ? '（' + row.task_date + ' ~ ' + row.date_end + '）' : ''), 'success');
    closeModal('modal-daily-task-' + shopId);
    refreshTaskContent(shopId);
  };

  // ============= 点击图标循环切换状态 =============
  window.cycleTaskCompletion = function(shopId, taskId) {
    var list = getAllLocal(shopId);
    var row = list.find(function(r) { return r.id === taskId; });
    if (!row) return;
    var flow = ['待处理', '处理中', '已完成'];
    var cur = row.completion || '待处理';
    var idx = flow.indexOf(cur);
    var next = flow[(idx + 1) % flow.length];
    CBTaskDB.update(shopId, taskId, { completion: next });
    refreshTaskContent(shopId);
  };

  // ============= 弹窗 =============
  window._toggleTaskTypeFields = function() {
    var sel = _id('task-type');
    if (!sel) return;
    var t = sel.value;
    var wrap = _id('task-completion-wrap');
    var hint = _id('task-goal-hint');
    if (wrap) wrap.style.display = (t === 'daily') ? '' : 'none';
    if (hint) hint.style.display = (t === 'daily') ? 'none' : '';
  };
  window.openTaskModal = function(shopId, taskId, defaultModule) {
    var row = taskId ? getAllLocal(shopId).find(function(r) { return r.id === taskId; }) : null;
    var modalId = 'modal-shop-task-' + shopId;
    var existing = _id(modalId);
    if (existing) existing.remove();

    var isEdit = !!row;
    var defaultType = 'daily';
    if (row && row.task_type) defaultType = row.task_type;
    else if (defaultModule === 'thisWeek' || defaultModule === 'nextWeek') defaultType = 'weekly';
    else if (defaultModule === 'thisMonth') defaultType = 'monthly';
    var defaultDateStart = _today();
    var defaultDateEnd = '';
    var moduleHint = '';
    if (defaultModule === 'thisWeek') {
      var w = getWeekRange(_today());
      defaultDateStart = w.start;
      defaultDateEnd = w.end;
      moduleHint = '本周（' + w.start + ' ~ ' + w.end.slice(5) + '）';
    } else if (defaultModule === 'nextWeek') {
      var w2 = getWeekRange(_today());
      defaultDateStart = addDays(w2.start, 7);
      defaultDateEnd = addDays(w2.end, 7);
      moduleHint = '下周（' + defaultDateStart + ' ~ ' + defaultDateEnd.slice(5) + '）';
    } else if (defaultModule === 'thisMonth') {
      defaultDateStart = _today().slice(0, 7) + '-01';
      // 本月最后一天
      var nextMonth = _today().slice(0, 7);
      var ny = parseInt(nextMonth.slice(0, 4));
      var nm = parseInt(nextMonth.slice(5, 7));
      var lastDay = new Date(ny, nm, 0).getDate();
      defaultDateEnd = _today().slice(0, 7) + '-' + String(lastDay).padStart(2, '0');
      moduleHint = '本月（' + _today().slice(0, 7) + '）';
    }

    var html = '<div id="' + modalId + '" class="modal-overlay" style="display:flex;z-index:9999">' +
      '<div class="modal" style="max-width:680px;width:92%;background:#fff;border:1px solid #e2e8f0">' +
        '<div class="modal-header" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">' +
          '<div class="modal-title" style="color:#0f172a;font-size:15px;font-weight:600">' + (isEdit ? '✏️ 编辑任务' : '➕ 新增任务') + (moduleHint ? ' · <span style="font-size:11px;color:#1890ff;font-weight:500">' + moduleHint + '</span>' : '') + '</div>' +
          '<button class="modal-close" onclick="closeModal(\'' + modalId + '\')" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer">&times;</button>' +
        '</div>' +
        '<div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px">' +
          // 时间范围（跨整列）
          '<div style="grid-column:1 / -1">' +
            '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">📅 时间范围 <span style="color:#ef4444">*</span> <span style="color:#94a3b8;font-weight:400">（留空结束 = 单日任务）</span></label>' +
            '<div style="display:grid;grid-template-columns:1fr auto 1fr auto;gap:6px;align-items:center">' +
              '<input type="date" id="task-date" value="' + (row ? (row.task_date || defaultDateStart) : defaultDateStart) + '" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
              '<span style="color:#94a3b8;font-size:14px">~</span>' +
              '<input type="date" id="task-date-end" value="' + (row ? (row.date_end || '') : defaultDateEnd) + '" placeholder="留空 = 单日" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
              '<button type="button" onclick="document.getElementById(\'task-date-end\').value=\'\'" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#64748b;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">清空</button>' +
            '</div>' +
          '</div>' +
          '<div style="grid-column:1 / -1">' +
            '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">🏷️ 任务类型 <span style="color:#94a3b8;font-weight:400">（决定归类位置与完成度计算方式）</span></label>' +
            '<select id="task-type" onchange="window._toggleTaskTypeFields && window._toggleTaskTypeFields()" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:14px;box-sizing:border-box">' +
              '<option value="daily"' + (defaultType === 'daily' ? ' selected' : '') + '>📝 每日任务（显示在底部「每日任务」区，需手动标记完成度）</option>' +
              '<option value="weekly"' + (defaultType === 'weekly' ? ' selected' : '') + '>🎯 周度目标（归入本周/下周，完成度自动匹配每日任务）</option>' +
              '<option value="monthly"' + (defaultType === 'monthly' ? ' selected' : '') + '>🎯 月度目标（归入本月，完成度自动匹配每日任务）</option>' +
            '</select>' +
          '</div>' +
          '<div id="task-goal-hint" style="grid-column:1 / -1;display:' + (defaultType === 'daily' ? 'none' : '') + ';background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;font-size:11px;color:#b45309">' +
            '💡 该任务为<span style="font-weight:700">' + (defaultType === 'monthly' ? '月度目标' : '周度目标') + '</span>，完成度将<b>自动</b>根据「' + (defaultType === 'monthly' ? '本月' : '对应周') + '」周期内<strong>匹配的每日任务</strong>计算，无需手动设置。可用「款号」作为匹配关键词。' +
          '</div>' +
          _field('款号', 'task-style', 'text', row ? row.style_no : '') +
          _field('SPU', 'task-spu', 'text', row ? row.spu : '') +
          _field('店铺', 'task-shop', 'text', row ? row.shop : '') +
          _field('图片来源', 'task-image-source', 'text', row ? row.image_source : '') +
          '<div id="task-completion-wrap" style="display:' + (defaultType === 'daily' ? '' : 'none') + '">' + _field('完成度', 'task-completion', 'select', row ? row.completion : '待处理', ['待处理','处理中','已完成']) + '</div>' +
          _field('领取人', 'task-assignee', 'text', row ? row.assignee : '') +
          _field('最新更新', 'task-updated', 'date', row ? row.updated_at : _today()) +
          '<div style="grid-column:1 / -1">' + _textarea('任务内容', 'task-content', row ? row.task_content : '') + '</div>' +
          '<div style="grid-column:1 / -1">' + _textarea('备注', 'task-remark', row ? row.remark : '') + '</div>' +
          '<input type="hidden" id="task-edit-id" value="' + (taskId || '') + '">' +
        '</div>' +
        '<div class="modal-btns" style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:11px;color:#94a3b8">💡 时间范围与本周/下周/本月有交集时，会同时显示在对应模块</span>' +
          '<div style="display:flex;gap:8px">' +
            '<button onclick="closeModal(\'' + modalId + '\')" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
            '<button onclick="saveTask(\'' + shopId + '\')" style="background:#1890ff;border:none;color:white;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(function() { if (window._toggleTaskTypeFields) window._toggleTaskTypeFields(); }, 30);
  };

  function _field(label, id, type, value, options) {
    var input;
    if (type === 'select') {
      input = '<select id="' + id + '" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:13px">' +
        options.map(function(o) { return '<option value="' + o + '"' + (o === value ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select>';
    } else {
      input = '<input type="' + type + '" id="' + id + '" value="' + _esc(value) + '" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:13px;box-sizing:border-box">';
    }
    return '<div><label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">' + label + '</label>' + input + '</div>';
  }
  function _textarea(label, id, value) {
    return '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:4px;font-weight:500">' + label + '</label>' +
      '<textarea id="' + id + '" rows="2" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-size:13px;box-sizing:border-box;resize:vertical">' + _esc(value) + '</textarea>';
  }

  window.saveTask = function(shopId) {
    var taskIdEl = _id('task-edit-id');
    if (!taskIdEl) { (window.showToast || alert)('弹窗已失效，请重新打开'); return; }
    var taskId = taskIdEl.value;
    var taskDate = (_id('task-date') || {}).value || null;
    var dateEnd = (_id('task-date-end') || {}).value || '';
    if (dateEnd && taskDate && dateEnd < taskDate) {
      (window.showToast || alert)('⚠️ 结束日期早于开始日期，已自动忽略结束', 'warn');
      dateEnd = '';
    }
    var taskType = (_id('task-type') || {}).value || 'daily';
    var row = {
      task_date: taskDate,
      date_end: dateEnd || null,
      task_type: taskType,
      style_no: (_id('task-style') || {}).value || '',
      task_content: (_id('task-content') || {}).value || '',
      spu: (_id('task-spu') || {}).value || '',
      shop: (_id('task-shop') || {}).value || '',
      image_source: (_id('task-image-source') || {}).value || '',
      completion: (taskType === 'daily' ? ((_id('task-completion') || {}).value || '待处理') : null),
      assignee: (_id('task-assignee') || {}).value || '',
      updated_at: (_id('task-updated') || {}).value || _today(),
      remark: (_id('task-remark') || {}).value || ''
    };
    if (!row.task_date) {
      (window.showToast || alert)('请选择开始日期', 'warn');
      return;
    }
    if (taskId) {
      CBTaskDB.update(shopId, taskId, row);
      (window.showToast || function(){})('✅ 任务已更新', 'success');
    } else {
      CBTaskDB.add(shopId, row);
      (window.showToast || function(){})('✅ 任务已添加' + (row.date_end ? '（' + row.task_date + ' ~ ' + row.date_end + '）' : ''), 'success');
    }
    closeModal('modal-shop-task-' + shopId);
    refreshTaskContent(shopId);
  };

  window.deleteTask = function(shopId, taskId) {
    if (!confirm('确定删除这条任务吗？')) return;
    CBTaskDB.remove(shopId, taskId);
    (window.showToast || function(){})('已删除', 'info');
    refreshTaskContent(shopId);
  };

  function refreshTaskContent(shopId) {
    var content = _id('cb-tab-tasks-' + shopId);
    if (!content) return;
    content.innerHTML = renderTaskModule(shopId);
    setTimeout(function() { drawTrendChart(shopId); }, 50);
  }

  // ============= 初始化 =============
  function init() {
    hookSetCBTab();
    hookRefreshCBArea();
    setTimeout(scanAndInject, 200);
    setTimeout(scanAndInject, 800);
    setTimeout(scanAndInject, 2000);

    // V151 修复：防抖从 80ms 改为 30ms（更灵敏），并增加 500ms 兜底轮询
    // 解决"快速切换 Tab 时防抖一直被清空、按钮永远不出现"的 bug
    var obs = new MutationObserver(function() {
      clearTimeout(window._taskScanTimer);
      window._taskScanTimer = setTimeout(function() {
        scanAndInject();
      }, 30);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });

    // V151 兜底：每 2 秒轮询一次，确保按钮始终存在
    // 只在有 setCBTab 按钮（即当前在店铺详情页）时才扫描
    setInterval(function() {
      if (_q('button[onclick*="setCBTab("]')) {
        scanAndInject();
      }
    }, 2000);

    console.log('[ShopTasks] ✅ 店铺任务模块 v6 已加载（V151 任务按钮稳定注入 + 任务类型分离）');
  }

  // V191: 暴露 injectTaskContent 到 window 供 cb-cache-v2 调用
  window._v191_injectTaskTab = function(shopId) {
    try {
      // 调用方的 cb-cache 命中已经写了 domestic-detail-area.innerHTML = cachedHTML
      // → cb-tab-reviews-XXX 等原 tab div 仍在（cachedHTML 包含）
      // → cb-tab-tasks-XXX 已被清掉（不在 cachedHTML 里）
      // → 直接调 injectTaskContent 重新注入
      if (typeof injectTaskContent === 'function') {
        injectTaskContent(shopId);
        injectTaskButton(shopId);
      }
      // cb-cache 命中后是 "ov5 默认显示 overview" 还是用户当前显示哪个 tab?
      // 通过 window._cbTab_XXX 读当前激活的 tab
      var activeTab = window['_cbTab_' + shopId];
      if (activeTab === 'tasks') {
        // 用户当前在任务 tab → 需要显示
        var c = _id('cb-tab-tasks-' + shopId);
        if (c) c.style.display = 'block';
        // 隐藏其它 tab (V208: 含 3 个分析容器 drop/review-split/boost, 否则缓存命中恢复时会残留)
        ['overview','optimize','orders','refunds','daily','reviews',
         'drop','review-split','boost'].forEach(function(n){
          var el = _id('cb-tab-' + n + '-' + shopId);
          if (el) el.style.display = 'none';
        });
        // 高亮 task button
        if (typeof highlightTaskButton === 'function') highlightTaskButton(shopId);
      }
    } catch(e) { console.warn('[V191] injectTaskTab err', e); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();