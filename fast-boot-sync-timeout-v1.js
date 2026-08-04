/**
 * V215 同步超时降级（后台同步卡 30 分钟 → 自动标红提示重试）
 *
 * 背景（用户 2026-07-31 反馈）：
 *   「后台同步中已经同步了 30 分钟了，还没有成功」
 *   V213 fast-boot-sync 把首屏同步改成 5s 后后台异步，但跑 30 分钟卡住时 UI 永远停在
 *   "⏳ 后台同步中..."，没有超时/重试引导。
 *
 * 实现（外挂层，不改 fast-boot-sync-v1.js）：
 *  - MutationObserver 监听 #sync-status 的 textContent 变化
 *  - 检测到写入「后台同步中」→ 启动 30 分钟（1800s）倒计时
 *  - 30 分钟内如果检测到「数据已同步」或「同步失败」→ 清掉倒计时
 *  - 30 分钟后还在「后台同步中」→ 主动覆盖状态：
 *      「⚠ 同步超时（30 分钟未完成）· 点此重试」
 *      → 点击调 window.__ec_forceBackgroundSync() 重新触发后台同步
 *
 * 与 fast-boot-sync-v2.js（V214 进度条）的关系：
 *  - V214 的 MutationObserver 已经把文字变化映射成 running/success/failed 状态
 *  - 本补丁只会在 V214 没识别到的「超时」场景介入；不影响 V214 的 idle/running/success/failed 流
 */
(function() {
  'use strict';
  if (window.__ec_syncTimeoutLoaded) return;
  window.__ec_syncTimeoutLoaded = true;

  var TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
  var checkTimer = null;
  var lastSyncStartTime = 0;

  function getStatusText() {
    var el = document.getElementById('sync-status');
    if (!el) return '';
    // 取出 ec-sync-text 子元素的文字（V214 进度条模式），否则取 textContent
    var textEl = el.querySelector('.ec-sync-text');
    return (textEl ? textEl.textContent : el.textContent) || '';
  }

  function setStatusText(newText, color) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    // V214 模式下要把 .ec-sync-text 的文字改掉，否则 V214 的 observer 会重置回 running
    var textEl = el.querySelector('.ec-sync-text');
    if (textEl) {
      textEl.textContent = newText;
      if (color) textEl.style.color = color;
    } else {
      el.textContent = newText;
      if (color) el.style.color = color;
    }
  }

  function isSyncing(text) {
    return text.indexOf('后台同步中') >= 0 || text.indexOf('同步中') >= 0;
  }
  function isDone(text) {
    return text.indexOf('数据已同步') >= 0 || text.indexOf('同步失败') >= 0 || text.indexOf('同步超时') >= 0;
  }

  function clearTimer() {
    if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
  }

  function startTimer() {
    clearTimer();
    lastSyncStartTime = Date.now();
    console.log('[V215 sync-timeout] 启动 30 分钟超时倒计时');
    checkTimer = setTimeout(function() {
      var text = getStatusText();
      if (!isSyncing(text)) return;
      console.warn('[V215 sync-timeout] 后台同步超过 30 分钟未完成，强制标超时');
      clearTimer();
      // 直接覆盖状态
      var el = document.getElementById('sync-status');
      if (!el) return;
      // 把整个状态换成"超时+重试"复合按钮
      el.innerHTML = '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;color:#dc2626;background:#fee2e2;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #fca5a5" ' +
                    'onclick="window.__ec_retrySyncAfterTimeout && window.__ec_retrySyncAfterTimeout()" ' +
                    'title="后台同步超过 30 分钟未完成，可能是网络或云端问题，点击重试">' +
                    '⚠ 同步超时（30 分钟未完成） · <span style="text-decoration:underline;color:#991b1b">点此重试</span>' +
                    '</span>';
      // 触发 toast 提示
      try {
        if (typeof window.showToast === 'function') {
          window.showToast('⚠ 后台同步超时（30 分钟未完成），请点击右上角重试', 'warning', 6000);
        }
      } catch(e) {}
    }, TIMEOUT_MS);
  }

  function setupObserver() {
    var el = document.getElementById('sync-status');
    if (!el) {
      setTimeout(setupObserver, 500);
      return;
    }

    var mo = new MutationObserver(function() {
      var text = getStatusText();
      if (isSyncing(text) && !checkTimer) {
        startTimer();
      } else if (isDone(text)) {
        clearTimer();
      }
    });

    mo.observe(el, { childList: true, characterData: true, subtree: true });

    // 重试入口：暴露给「点此重试」按钮 + 调试用
    window.__ec_retrySyncAfterTimeout = function() {
      console.log('[V215 sync-timeout] 手动重试后台同步');
      try {
        // 把 UI 切回 running
        var el2 = document.getElementById('sync-status');
        if (el2) {
          el2.innerHTML = '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;color:#f59e0b"><span class="ec-sync-text">⏳ 正在重新同步...</span></span>';
        }
        if (typeof window.__ec_forceBackgroundSync === 'function') {
          window.__ec_forceBackgroundSync();
        } else {
          console.warn('[V215] window.__ec_forceBackgroundSync 不存在，请刷新页面或手动点同步按钮');
        }
      } catch(e) { console.warn('[V215] retry err', e); }
    };

    console.log('[V215] 同步超时降级已启动（30 分钟无响应 → 自动标红重试）');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver);
  } else {
    setupObserver();
  }
})();