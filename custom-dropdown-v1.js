/* ==========================================================================
 * custom-dropdown-v1.js  (V187)
 * 终极方案:完全自定义 dropdown 组件,替换浏览器原生 <select> 和 <input type="date">
 *
 * 背景(V173/V178/V181/V186 全部失效):
 *   Chrome 在某些环境下,native select 的下拉 popup 完全不渲染 option,
 *   native date input 的日历按钮是空白灰板,点不开。
 *   之前所有修补都假设能用 `color-scheme:light` 或 `appearance:auto` 救活原生 UI,
 *   实测在用户这台 Chrome 上**完全无效**。
 *
 * 方案:
 *   1) **不替换**原 <select> / <input type="date">(保留它们的 onchange 绑定 + form 语义)
 *   2) 监听 mousedown 事件 → preventDefault → 弹我们自己的 div popup
 *   3) popup 用绝对定位 + 浅色背景 + 深色文字 + 边框 + 阴影(完全 CSS 自控)
 *   4) 支持键盘导航(↑↓ 选择,Enter 确认,Esc 关闭)
 *   5) 确认后设置原 select.value / input.value + 触发原 onchange + 关闭 popup
 *   6) MutationObserver 自动应用到 DOM 变化后新增的 select/date input
 *
 * 应用范围:
 *   - 所有 visible 的 <select>(不管是否在弹窗里)
 *   - 所有 <input type="date">
 *   - 排除: display:none / visibility:hidden / 在 disabled state 的
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__customDropdownLoaded) return;
  window.__customDropdownLoaded = true;
  console.log('[V187 custom-dropdown] loaded');

  // ---------- CSS 注入 ----------
  var CSS_ID = 'v187-custom-dropdown-css';
  if (!document.getElementById(CSS_ID)) {
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.v187-popup{',
      '  position:absolute;z-index:2147483647;',
      '  background:#fff;color:#1f2937;',
      '  border:1px solid #d1d5db;border-radius:8px;',
      '  box-shadow:0 8px 24px rgba(0,0,0,0.18),0 2px 6px rgba(0,0,0,0.08);',
      '  max-height:280px;overflow-y:auto;',
      '  font-size:14px;line-height:1.4;',
      '  min-width:140px;',
      '  padding:4px 0;',
      '  font-family:inherit;',
      '  box-sizing:border-box;',
      '}',
      '.v187-opt{',
      '  padding:8px 14px;cursor:pointer;user-select:none;',
      '  color:#1f2937;background:#fff;',
      '  transition:background 0.1s;',
      '}',
      '.v187-opt:hover{background:#eef2ff;}',
      '.v187-opt.v187-active{background:#dbeafe;color:#1d4ed8;font-weight:600;}',
      '.v187-opt.v187-disabled{color:#9ca3af;cursor:not-allowed;}',
      '.v187-opt.v187-disabled:hover{background:#fff;}',
      '.v187-date-popup{',
      '  position:absolute !important;z-index:2147483647 !important;',
      '  background:#fff;color:#1f2937;',
      '  border:1px solid #d1d5db;border-radius:10px;',
      '  box-shadow:0 8px 24px rgba(0,0,0,0.18),0 2px 6px rgba(0,0,0,0.08);',
      '  padding:12px;',
      '  font-family:inherit;',
      '  width:300px !important;min-width:300px !important;max-width:320px !important;',
      '  box-sizing:border-box !important;',
      '}',
      '.v187-date-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600;}',
      '.v187-date-nav{',
      '  background:none;border:1px solid #e5e7eb;border-radius:6px;',
      '  padding:4px 10px;cursor:pointer;font-size:14px;color:#374151;',
      '}',
      '.v187-date-nav:hover{background:#f3f4f6;}',
      '.v187-date-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;width:100%;}',
      '.v187-date-dow{text-align:center;font-size:11px;color:#6b7280;padding:4px 0;font-weight:600;}',
      '.v187-date-day{',
      '  text-align:center;padding:6px 0;cursor:pointer;border-radius:6px;',
      '  font-size:13px;color:#1f2937;',
      '  min-width:32px;',
      '}',
      '.v187-date-day:hover{background:#eef2ff;}',
      '.v187-date-day.v187-today{outline:1px solid #3b82f6;}',
      '.v187-date-day.v187-selected{background:#3b82f6;color:#fff;font-weight:600;}',
      '.v187-date-day.v187-empty{color:#d1d5db;cursor:default;}',
      '.v187-date-day.v187-empty:hover{background:transparent;}',
      '.v187-date-input{',
      '  width:100%;box-sizing:border-box;',
      '  border:1px solid #d1d5db;border-radius:6px;',
      '  padding:6px 8px;font-size:13px;color:#1f2937;',
      '  margin-bottom:8px;font-family:inherit;',
      '}',
      '.v187-date-foot{display:flex;justify-content:space-between;margin-top:8px;}',
      '.v187-date-btn{',
      '  background:#fff;border:1px solid #d1d5db;border-radius:6px;',
      '  padding:6px 12px;cursor:pointer;font-size:13px;color:#374151;',
      '}',
      '.v187-date-btn:hover{background:#f3f4f6;}',
      '.v187-date-btn.v187-primary{background:#3b82f6;color:#fff;border-color:#3b82f6;}',
      '.v187-date-btn.v187-primary:hover{background:#2563eb;}',
      // 强制隐藏 native 元素的弹出(让 mousedown 直接被我们拦截)
      // 但保留元素可见,只是不让 Chrome 自己弹 popup
      'select.v187-hooked,input[type="date"].v187-hooked{',
      '  /* 不改 appearance,只确保我们能拦截 mousedown */',
      '}',
      // 给日历按钮加提示
      'input[type="date"].v187-hooked{cursor:pointer;}',
      // V207: 隐藏原生日历图标按钮 (::-webkit-calendar-picker-indicator 是 shadow DOM,
      //       点它不会走我们 document 上的 mousedown handler, 会直接弹原生 picker)
      'input[type="date"].v187-hooked::-webkit-calendar-picker-indicator{',
      '  display:none !important;',
      '}',
      'input[type="date"].v187-hooked::-webkit-inner-spin-button,',
      'input[type="date"].v187-hooked::-webkit-clear-button{',
      '  display:none !important;',
      '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------- 关闭所有 popup ----------
  function closeAllPopups(){
    document.querySelectorAll('.v187-popup,.v187-date-popup').forEach(function(p){
      p.remove();
    });
    document.removeEventListener('mousedown', _outsideClick, true);
    document.removeEventListener('keydown', _keyNav, true);
    // V207 关键修复: 还原被临时改成 text 的 date input
    // (原因: 拦截 mousedown 时把 type=date 改成 type=text 来阻止 Chrome 原生 picker;
    //        关闭 popup 时要还原 type=date, 不影响 onchange/form 语义)
    document.querySelectorAll('input[data-v187-orig-type="date"]').forEach(function(inp){
      var saved = inp.getAttribute('data-v187-saved-value') || inp.value || '';
      try { inp.type = 'date'; } catch(e) { /* 极少数浏览器不支持, 忽略 */ }
      inp.removeAttribute('data-v187-orig-type');
      inp.removeAttribute('data-v187-saved-value');
      inp.readOnly = false;
      // type 改回后 value 仍是 "YYYY-MM-DD" 字符串, 对 type=date 合法, 无需重设
      // 但为了以防某些 Chrome 改了 type 后清空 value, 显式设回
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        try { inp.value = saved; } catch(e) {}
      }
    });
  }
  var _outsideClick = function(e){
    var popups = document.querySelectorAll('.v187-popup,.v187-date-popup');
    for (var i = 0; i < popups.length; i++) {
      if (!popups[i].contains(e.target)) {
        // 检查点击的是不是 select/date input(可能是切换到下一个)
        var t = e.target;
        if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type === 'date'))) {
          // 让这个新的 select 自己的 mousedown handler 处理
          popups[i].remove();
          continue;
        }
        popups[i].remove();
      }
    }
    if (!document.querySelector('.v187-popup,.v187-date-popup')) {
      document.removeEventListener('mousedown', _outsideClick, true);
    }
  };
  var _keyNav = function(e){ /* 由各 popup 自己绑 */ };

  // ---------- 通用 select dropdown ----------
  function openSelectPopup(sel){
    closeAllPopups();
    // 收集 options
    var options = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      options.push({
        value: o.value,
        text: o.text,
        disabled: o.disabled,
        index: i
      });
    }
    if (!options.length) return;

    var rect = sel.getBoundingClientRect();
    var scrollY = window.scrollY || document.documentElement.scrollTop;
    var scrollX = window.scrollX || document.documentElement.scrollLeft;

    var popup = document.createElement('div');
    popup.className = 'v187-popup';
    popup.style.left = (rect.left + scrollX) + 'px';
    popup.style.top  = (rect.bottom + scrollY + 2) + 'px';
    popup.style.minWidth = Math.max(rect.width, 120) + 'px';

    var activeIdx = sel.selectedIndex;
    options.forEach(function(opt, idx){
      var div = document.createElement('div');
      div.className = 'v187-opt' + (idx === activeIdx ? ' v187-active' : '') + (opt.disabled ? ' v187-disabled' : '');
      div.textContent = opt.text;
      div.dataset.value = opt.value;
      div.dataset.index = String(idx);
      div.addEventListener('mousedown', function(e){
        e.preventDefault();
        e.stopPropagation();
        if (opt.disabled) return;
        // 关键:设置 value + 触发 onchange,模拟用户选择
        var oldVal = sel.value;
        sel.value = opt.value;
        if (sel.selectedIndex !== idx) {
          sel.selectedIndex = idx;
        }
        // 触发 onchange(同用户操作一致)
        try {
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } catch(e2){
          // 老浏览器 fallback
          var fn = sel.onchange;
          if (typeof fn === 'function') {
            try { fn.call(sel); } catch(e3){}
          }
        }
        // 触发 input 事件(某些代码监听 oninput)
        try { sel.dispatchEvent(new Event('input', { bubbles: true })); } catch(e2){}
        closeAllPopups();
        // 阻止后续 focus 触发 native popup
        sel.blur();
      });
      popup.appendChild(div);
    });

    document.body.appendChild(popup);

    // 自动定位(防止超出视口底部)
    var popupRect = popup.getBoundingClientRect();
    var viewH = window.innerHeight;
    if (popupRect.bottom > viewH) {
      // 改为向上弹
      popup.style.top = (rect.top + scrollY - popupRect.height - 2) + 'px';
    }
    // 防止超出右边
    if (popupRect.right > window.innerWidth) {
      popup.style.left = Math.max(0, (rect.right + scrollX - popupRect.width)) + 'px';
    }

    // 键盘导航
    var activeOptionIdx = activeIdx >= 0 ? activeIdx : 0;
    function setActive(idx){
      var children = popup.children;
      if (idx < 0) idx = 0;
      if (idx >= children.length) idx = children.length - 1;
      for (var j = 0; j < children.length; j++) {
        children[j].classList.toggle('v187-active', j === idx);
      }
      activeOptionIdx = idx;
      // 滚动到可见
      var el = children[idx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function onKey(e){
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeOptionIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeOptionIdx - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var target = popup.children[activeOptionIdx];
        if (target) target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAllPopups();
      }
    }
    document.addEventListener('keydown', onKey, true);

    // 全局 mousedown 关闭
    setTimeout(function(){
      document.addEventListener('mousedown', _outsideClick, true);
    }, 0);
  }

  // ---------- 通用 date picker ----------
  function openDatePopup(inp){
    closeAllPopups();
    var rect = inp.getBoundingClientRect();
    var scrollY = window.scrollY || document.documentElement.scrollTop;
    var scrollX = window.scrollX || document.documentElement.scrollLeft;

    var currentVal = inp.value || '';
    var today = new Date();
    var initDate = parseDate(currentVal) || today;
    var viewYear = initDate.getFullYear();
    var viewMonth = initDate.getMonth(); // 0-11

    var popup = document.createElement('div');
    popup.className = 'v187-date-popup';
    popup.style.left = (rect.left + scrollX) + 'px';
    popup.style.top  = (rect.bottom + scrollY + 2) + 'px';

    function render(){
      popup.innerHTML = '';
      // 顶部:年-月
      var head = document.createElement('div');
      head.className = 'v187-date-head';
      var prev = mkBtn('◀', function(){ if(--viewMonth < 0){ viewMonth = 11; viewYear--; } render(); });
      var label = document.createElement('span');
      label.textContent = viewYear + '年' + (viewMonth + 1) + '月';
      var next = mkBtn('▶', function(){ if(++viewMonth > 11){ viewMonth = 0; viewYear++; } render(); });
      head.appendChild(prev); head.appendChild(label); head.appendChild(next);
      popup.appendChild(head);

      // 手动输入框(可选)
      var inputBox = document.createElement('input');
      inputBox.type = 'text';
      inputBox.className = 'v187-date-input';
      inputBox.placeholder = 'YYYY-MM-DD(可手动输入)';
      inputBox.value = currentVal;
      inputBox.addEventListener('keydown', function(e){
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(inputBox.value);
        }
      });
      popup.appendChild(inputBox);

      // 星期行
      var dows = ['日','一','二','三','四','五','六'];
      var grid = document.createElement('div');
      grid.className = 'v187-date-grid';
      dows.forEach(function(d){
        var c = document.createElement('div');
        c.className = 'v187-date-dow';
        c.textContent = d;
        grid.appendChild(c);
      });

      // 日期格子
      var firstDay = new Date(viewYear, viewMonth, 1);
      var startDow = firstDay.getDay();
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      for (var i = 0; i < startDow; i++) {
        var e = document.createElement('div');
        e.className = 'v187-date-day v187-empty';
        grid.appendChild(e);
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var cell = document.createElement('div');
        cell.className = 'v187-date-day';
        cell.textContent = String(d);
        var thisDate = new Date(viewYear, viewMonth, d);
        var iso = isoDate(thisDate);
        cell.dataset.iso = iso;
        if (iso === currentVal) cell.classList.add('v187-selected');
        if (thisDate.toDateString() === today.toDateString()) cell.classList.add('v187-today');
        cell.addEventListener('mousedown', function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          commit(this.dataset.iso);
        });
        grid.appendChild(cell);
      }
      popup.appendChild(grid);

      // 底部:今天 / 清除
      var foot = document.createElement('div');
      foot.className = 'v187-date-foot';
      var today2 = mkBtn('今天', function(){ commit(isoDate(today)); });
      var clear  = mkBtn('清除', function(){
        inp.value = '';
        try {
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        } catch(e){}
        closeAllPopups();
      });
      var closeBtn = mkBtn('关闭', function(){ closeAllPopups(); });
      closeBtn.classList.add('v187-primary');
      foot.appendChild(today2); foot.appendChild(clear); foot.appendChild(closeBtn);
      popup.appendChild(foot);
    }
    function mkBtn(text, fn){
      var b = document.createElement('button');
      b.className = 'v187-date-nav';
      if (fn) b.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); fn(); });
      b.textContent = text;
      return b;
    }
    function commit(val){
      if (!val) return;
      // 简单校验
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        var d = parseDate(val);
        if (d) val = isoDate(d);
        else return;
      }
      inp.value = val;
      try {
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(e){}
      closeAllPopups();
    }

    render();
    document.body.appendChild(popup);

    // 向上弹(防超出底部)
    var pr = popup.getBoundingClientRect();
    if (pr.bottom > window.innerHeight) {
      popup.style.top = (rect.top + scrollY - pr.height - 2) + 'px';
    }

    setTimeout(function(){
      document.addEventListener('mousedown', _outsideClick, true);
    }, 0);
  }

  function parseDate(s){
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return null;
  }
  function isoDate(d){
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ---------- 拦截 mousedown ----------
  function onDocMouseDown(e){
    var t = e.target;
    if (!t) return;
    // 检查 select
    if (t.tagName === 'SELECT' && t.type !== 'date') {
      // 跳过被我们标记 disabled / 不可见的
      if (t.disabled || t.style.display === 'none' || t.offsetParent === null) return;
      // 检查 select 自身是否有 size > 1(那是 listbox 不需要弹 popup)
      if (t.size && t.size > 1) return;
      e.preventDefault();
      e.stopPropagation();
      openSelectPopup(t);
      return;
    }
    // 检查 input[type=date]
    if (t.tagName === 'INPUT' && t.type === 'date') {
      if (t.disabled || t.readOnly || t.style.display === 'none' || t.offsetParent === null) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // V207 关键修复: 临时把 type='date' 改成 'text' + readOnly
      // 原因: 单纯 preventDefault mousedown 在某些 Chrome 版本里不够, 后续 click 仍会触发
      //       原生 date picker → 出现 "custom popup + native picker 同时弹出, 互相遮挡" 的乱叠
      // 改成 text 后 Chrome 根本不会把它当 date input, 原生 picker 100% 不弹
      // closeAllPopups 时会还原 type=date
      try {
        t.setAttribute('data-v187-orig-type', 'date');
        t.setAttribute('data-v187-saved-value', t.value || '');
        t.type = 'text';
        t.readOnly = true;
        // type 改了之后 value 可能被清空, 显式设回 (YYYY-MM-DD 格式对 type=text 合法)
        var sv = t.getAttribute('data-v187-saved-value');
        if (sv) t.value = sv;
      } catch(eType) {
        console.warn('[V207] 临时改 type 失败, 继续:', eType);
      }
      openDatePopup(t);
      return;
    }
  }

  // ---------- 应用到所有 select/date input ----------
  function applyToElement(el){
    if (el.__v187_hooked) return;
    el.__v187_hooked = true;
    el.classList.add('v187-hooked');
  }

  function scanAndApply(root){
    root = root || document;
    try {
      root.querySelectorAll('select').forEach(applyToElement);
      root.querySelectorAll('input[type="date"]').forEach(applyToElement);
    } catch(e){}
  }

  // ---------- 启动 ----------
  function start(){
    document.addEventListener('mousedown', onDocMouseDown, true);
    scanAndApply();
    // MutationObserver 监控新增节点
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function(muts){
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          m.addedNodes && m.addedNodes.forEach(function(n){
            if (n.nodeType !== 1) return;
            if (n.tagName === 'SELECT' || (n.tagName === 'INPUT' && n.type === 'date')) {
              applyToElement(n);
            }
            if (n.querySelectorAll) {
              try { scanAndApply(n); } catch(e){}
            }
          });
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      window.__v187_mo = mo;
    }
    console.log('[V187] ready · 拦截了 mousedown,所有 select/date 改为自定义 popup');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
