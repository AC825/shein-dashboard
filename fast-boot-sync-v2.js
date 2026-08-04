/**
 * fast-boot-sync-v2.js — UI 立即响应 + 云端同步后台异步 + 进度条 (V214)
 *
 * V213 基础（已上线，登录后 < 1s 见店铺）：
 *   - 首次 syncFromSupabase 立即返回，5s 后后台跑真实同步
 *   - 顶栏显示 "⏳ 后台同步中..." 文字 + 沙漏
 *
 * V214 升级（用户 2026-07-31 反馈「沙漏文字改成进度条」）：
 *   - 顶栏 #sync-status 元素从纯文字升级为「图标 + 文字 + 进度条 + 数字」
 *   - 进度条：5px 高，橘色渐变，左→右流光动画
 *   - 文字部分：左侧 "📊 后台同步中" / "✓ 数据已同步"，右侧 "已用 12s"
 *   - 进度条基于时间递增：0~30s 匀速到 92%，30~90s 缓慢到 100%
 *   - 完成时进度条变绿 + 100%，文字变 "✓ 数据已同步"
 *   - 失败时进度条变红，文字变 "⚠ 同步失败"
 *
 * 实现策略：V213 内部用 `el.textContent = '⏳ 后台同步中...'` 改状态
 *   V2 用 MutationObserver 监听 #sync-status 的 textContent/childList 变化
 *   根据 V213 设的文字内容 ('后台同步中' / '数据已同步' / '同步失败') 推断状态
 *   然后用 applyState() 切 UI（整体替换 innerHTML 为对应模板）
 *
 * 加载顺序：在 fast-boot-sync-v1.js 之后（要等 V213 hook 完成）
 */
(function () {
  'use strict';
  if (window.__ec_fastBootV2Loaded) return;
  window.__ec_fastBootV2Loaded = true;
  console.log('[FastBoot V214] loaded — 顶栏同步状态升级为进度条样式');

  function waitForV1(cb) {
    if (window.__ec_fastBootLoaded) {
      cb();
    } else {
      setTimeout(function () { waitForV1(cb); }, 100);
    }
  }

  function waitForElement(id, cb) {
    var el = document.getElementById(id);
    if (el) { cb(el); return; }
    setTimeout(function () { waitForElement(id, cb); }, 150);
  }

  // 注入动画 CSS（一次性）
  function injectStyle() {
    if (document.getElementById('ec-sync-progress-style')) return;
    var style = document.createElement('style');
    style.id = 'ec-sync-progress-style';
    style.textContent = `
      @keyframes ec-sync-shimmer {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);
  }

  // 状态模板
  var TEMPLATES = {
    idle:
      '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;line-height:1;">' +
        '<span class="ec-sync-icon" style="display:inline-flex;align-items:center;font-size:13px;">⚡</span>' +
        '<span class="ec-sync-text" style="font-weight:500;white-space:nowrap;color:#94a3b8;">本地缓存</span>' +
      '</span>',
    running:
      '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;line-height:1;">' +
        '<span class="ec-sync-icon" style="display:inline-flex;align-items:center;font-size:13px;">📊</span>' +
        '<span class="ec-sync-text" style="font-weight:500;white-space:nowrap;color:#fbbf24;">后台同步中</span>' +
        '<span class="ec-sync-bar-wrap" style="display:inline-block;width:80px;height:5px;background:rgba(148,163,184,0.2);border-radius:3px;overflow:hidden;position:relative;">' +
          '<span class="ec-sync-bar" style="display:block;height:100%;width:0%;background:linear-gradient(90deg,#fbbf24,#f59e0b);border-radius:3px;transition:width 0.4s ease;position:relative;overflow:hidden;">' +
            '<span style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.5) 50%,transparent 100%);animation:ec-sync-shimmer 1.5s linear infinite;"></span>' +
          '</span>' +
        '</span>' +
        '<span class="ec-sync-time" style="font-size:11px;color:#94a3b8;min-width:36px;text-align:right;white-space:nowrap;">0s</span>' +
      '</span>',
    success:
      '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;line-height:1;">' +
        '<span class="ec-sync-icon" style="display:inline-flex;align-items:center;font-size:13px;">✓</span>' +
        '<span class="ec-sync-text" style="font-weight:500;white-space:nowrap;color:#10b981;">数据已同步</span>' +
        '<span class="ec-sync-time" style="font-size:11px;color:#10b981;min-width:36px;text-align:right;white-space:nowrap;"></span>' +
      '</span>',
    failed:
      '<span class="ec-sync-content" style="display:inline-flex;align-items:center;gap:6px;line-height:1;">' +
        '<span class="ec-sync-icon" style="display:inline-flex;align-items:center;font-size:13px;">⚠</span>' +
        '<span class="ec-sync-text" style="font-weight:500;white-space:nowrap;color:#ef4444;">同步失败</span>' +
      '</span>'
  };

  // 状态机
  var currentState = 'idle';
  var tickHandle = null;
  var t0Running = 0;
  var autoReturnIdleHandle = null;

  function clearTick() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function applyState(state, extra) {
    if (state === currentState && state !== 'running') return; // 已在目标状态，跳过
    currentState = state;
    clearTick();
    if (autoReturnIdleHandle) { clearTimeout(autoReturnIdleHandle); autoReturnIdleHandle = null; }

    var el = document.getElementById('sync-status');
    if (!el) return;

    if (state === 'running') {
      t0Running = Date.now();
      el.style.background = 'rgba(245,158,11,0.12)';
      el.style.padding = '2px 10px';
      el.innerHTML = TEMPLATES.running;
      tickHandle = setInterval(function () {
        try {
          var s = Math.floor((Date.now() - t0Running) / 1000);
          var bar = el.querySelector('.ec-sync-bar');
          var time = el.querySelector('.ec-sync-time');
          if (!bar || !time) { clearTick(); return; }
          var pct;
          if (s < 30) pct = (s / 30) * 92;
          else if (s < 90) pct = 92 + ((s - 30) / 60) * 8;
          else pct = 100;
          bar.style.width = Math.min(100, pct).toFixed(1) + '%';
          time.textContent = s + 's';
        } catch (e) { clearTick(); }
      }, 500);
    } else if (state === 'success') {
      el.style.background = 'rgba(16,185,129,0.12)';
      el.style.padding = '2px 10px';
      el.innerHTML = TEMPLATES.success;
      // 把 V213 给的耗时秒数写到 .ec-sync-time
      if (extra) {
        var timeEl = el.querySelector('.ec-sync-time');
        if (timeEl) timeEl.textContent = extra;
      }
      // 5 秒后淡回 idle
      autoReturnIdleHandle = setTimeout(function () {
        if (currentState === 'success') applyState('idle');
      }, 5000);
    } else if (state === 'failed') {
      el.style.background = 'rgba(239,68,68,0.12)';
      el.style.padding = '2px 10px';
      el.innerHTML = TEMPLATES.failed;
    } else {
      // idle
      el.style.background = 'transparent';
      el.style.padding = '2px 8px';
      el.innerHTML = TEMPLATES.idle;
    }
  }

  // 检测 V213 改的 textContent 推断状态
  function detectStateFromDOM() {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var txt = el.textContent || '';
    if (txt.indexOf('后台同步中') >= 0) {
      if (currentState !== 'running') applyState('running');
    } else if (txt.indexOf('数据已同步') >= 0) {
      if (currentState !== 'success') {
        // 提取耗时秒数，如 "(30.5s)"
        var m = txt.match(/\(([\d.]+s)\)/);
        applyState('success', m ? m[1] : '');
      }
    } else if (txt.indexOf('同步失败') >= 0) {
      if (currentState !== 'failed') applyState('failed');
    } else {
      // 文字里没 V213 标记 → V213 没动过，是 idle 状态
      // 但**只在 sync-status 之前已经被外部破坏时**才回 idle
      // 避免 observer 在我们刚 setInnerHTML 后立刻回 idle
      if (currentState === 'running' && !el.querySelector('.ec-sync-content')) {
        applyState('idle');
      }
    }
  }

  waitForV1(function () {
    waitForElement('sync-status', function (el) {
      injectStyle();
      // 初始：扫描一次看是否已经有 V213 设的状态
      detectStateFromDOM();
      // 如果 V213 还没动过（首次加载），显示 idle
      if (currentState !== 'running' && currentState !== 'success' && currentState !== 'failed') {
        applyState('idle');
      }

      // MutationObserver 监听 V213 的 textContent 切换
      var observer = new MutationObserver(function (mutations) {
        // 我们的 setInnerHTML 也会触发 mutation，需要过滤
        // 简单办法：设个标志位，在 applyState 改 innerHTML 时跳过 observer
        // 这里用 async check：观察后用 queueMicrotask 异步检查
        queueMicrotask(detectStateFromDOM);
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });

      // 暴露手动控制接口
      window.__ec_syncUI = {
        idle: function () { applyState('idle'); },
        running: function () { applyState('running'); },
        success: function (elapsedStr) { applyState('success', elapsedStr); },
        failed: function () { applyState('failed'); }
      };

      console.log('[FastBoot V214] ✅ 顶栏进度条 UI 就绪 (textContent 监听模式 v2)');
    });
  });
})();
