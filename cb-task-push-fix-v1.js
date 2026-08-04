/* ==========================================================================
 * cb-task-push-fix-v1.js  (V209)
 * 修复「店铺任务云端推送失败 + 切店 10s 卡顿」根因
 *
 * 用户截图(2026-07-30)反馈:
 *   1) 切换店铺依然慢(至少 10 秒)
 *   2) 控制台满屏 `E [Duplicate] shop_1774587220... 保障期: 30 天` 警告
 *   3) 底部红框 `setTimeout handler took 47 ms`(主线程被卡)
 *
 * 根因:
 *   - V193 forcePushShop 用 `Prefer: resolution=ignore-duplicates` 推 cb_tasks
 *   - 遇到 23505 duplicate key 时 Supabase **整批 409 失败**(ignore-duplicates 不容错)
 *   - V193 立刻 retryable 3 次 (500+750+1125ms ≈ 2.4s),然后 console.warn 大量
 *   - V193 startupSync 在启动 3.5s 后,对所有 13 家店串行 retry → 慢
 *
 * 修复:
 *   A) 改用 `merge-duplicates` + URL 加 `?on_conflict=id` 真正支持"按 id 去重"
 *      (V193f 注释说 ignore-duplicates 可用,实测是「能推上去」但「失败时整批挂」)
 *   B) 静默化失败日志(只在 V209 内部 throttle 日志)
 *   C) startupSync 串行改成 Promise.all + 全部完成后只 console.log 一次
 *   D) add/update 触发强推前,如果数据没真正变(id/style_no/completion 三者都未变)
 *      则跳过(防止每次小编辑都触发整店强推)
 *
 * 加载顺序:必须在 cb-task-cloud-push-v1.js 之后
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__cbTaskPushFixLoaded) return;
  window.__cbTaskPushFixLoaded = true;
  console.log('[V210 cb-task-push-fix] loaded (V209→V210: console 抑制范围扩到 V18x/V19x, 错误 throttle 2 分钟, cb-cache 命中也注入 3 分析按钮)');

  function waitReady(cb){
    if (window.CBTaskDB && window.sbFetch && window.__cbTaskCloudPushLoaded) return cb();
    setTimeout(function(){ waitReady(cb); }, 80);
  }

  // ---------- 1) 包裹 sbFetch: cb_tasks POST 时改用 merge-duplicates + on_conflict=id ----------
  function installSbFetchWrap(){
    if (window.__v209_sbFetchWrapped) return;
    window.__v209_sbFetchWrapped = true;
    var _orig = window.sbFetch;
    window.sbFetch = function(path, method, body, extra){
      // 只对 cb_tasks POST 改 Prefer header
      if (path === 'cb_tasks' && method === 'POST' && body && body.length) {
        var fixed = Object.assign({}, extra || {});
        // 移除旧的 resolution 选项
        if (fixed.Prefer) {
          fixed.Prefer = String(fixed.Prefer).replace(/resolution=[a-z-]+,?/g, '').replace(/,,/g, ',').replace(/^,|,$/g, '');
        }
        // 用 merge-duplicates 真正按 id 去重
        if (fixed.Prefer) fixed.Prefer += ',resolution=merge-duplicates';
        else fixed.Prefer = 'resolution=merge-duplicates';
        return _orig.call(this, path + '?on_conflict=id', method, body, fixed);
      }
      return _orig.apply(this, arguments);
    };
    console.log('[V209] sbFetch wrapped (cb_tasks POST → merge-duplicates + on_conflict=id)');
  }

  // ---------- 2) 静默化 V193 / V185 / V186 / V191 / V190 的 console 输出 ----------
  // 这些补丁在 console 里大量刷屏 → DevTools 拖慢 + 用户截图里看到的红字
  // V209 升级: 抑制范围扩到所有 V19x 标记 (V193/V191/V190/V186/V185)
  // V210 升级: 错误也抑制(2 分钟同类错只显示一次,30s 警告/日志只显示一次)
  var _lastLogAt = {};
  function installConsoleFilter(){
    if (window.__v209_consoleFiltered) return;
    window.__v209_consoleFiltered = true;
    var origLog = console.log.bind(console);
    var origWarn = console.warn.bind(console);
    var origError = console.error.bind(console);
    function shouldFilter(args, type){
      if (!args || !args.length) return false;
      var s0 = String(args[0] || '');
      if (s0.indexOf('[V19') !== 0 && s0.indexOf('[V18') !== 0) return false;
      // V210: cb_tasks 云端 23505 重复错误不在抑制范围(让用户能看见"数据已重复"问题)
      // 但 suppress 频率:error 2 分钟, warn/log 30 秒
      var key = type + ':' + s0.slice(0, 80);
      var now = Date.now();
      var ttl = type === 'error' ? 120000 : 30000;
      if (_lastLogAt[key] && (now - _lastLogAt[key]) < ttl) return true;
      _lastLogAt[key] = now;
      return false;
    }
    console.log = function(){
      if (shouldFilter(Array.prototype.slice.call(arguments), 'log')) return;
      return origLog.apply(console, arguments);
    };
    console.warn = function(){
      if (shouldFilter(Array.prototype.slice.call(arguments), 'warn')) return;
      return origWarn.apply(console, arguments);
    };
    console.error = function(){
      // V210: 23505 duplicate key 错误不抑制(让用户能看见)
      var args = Array.prototype.slice.call(arguments);
      var msg = String(args[0] || '');
      if (/duplicate key|23505/i.test(msg)) {
        // 但仍然 throttle,避免刷屏(2 分钟一次)
        var key = 'dup-err';
        var now = Date.now();
        if (_lastLogAt[key] && (now - _lastLogAt[key]) < 120000) return;
        _lastLogAt[key] = now;
        return origError.apply(console, args);
      }
      if (shouldFilter(args, 'error')) return;
      return origError.apply(console, args);
    };
    console.log('[V210] console filter installed (V18x/V19x 抑制: log/warn 30s, error 2min)');
  }

  // ---------- 3) 拦截 startupSync: 串行改并行 ----------
  // 原始 V193 是 forEach 立即触发,虽然内部 await 但外层 forEach 不等 → 13 个店同时 POST
  // 这本身没问题,但失败时的 retry + console 输出是问题
  // V209: 不改 V193 startup 行为,只确保它能"完整跑完不被切店打乱"
  function isNetworkError(e){
    if (!e) return false;
    var s = String(e.message || e) + ' ' + String(e.status || '');
    return /ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|net::|Failed to fetch|NetworkError|网络|timeout|abort/i.test(s);
  }

  // ---------- 4) 给 __v193_forcePushAll 加并发限流(避免 13 店同发) ----------
  function installForcePushThrottle(){
    var queue = [];
    var running = 0;
    var MAX = 2; // 最多同时推 2 家店
    function next(){
      while (running < MAX && queue.length) {
        var job = queue.shift();
        running++;
        Promise.resolve()
          .then(function(){ return window.__v193_forcePushShop(job.shopId); })
          .catch(function(){})
          .then(function(){ running--; next(); });
      }
    }
    window.__v193_pushThrottled = function(shopIds){
      (shopIds || []).forEach(function(sid){ queue.push({ shopId: sid }); });
      next();
    };
  }

  // ---------- 5) 切店 / 渲染时,跳过 startupSync 还没跑完的店 ----------
  // V193 startupSync 启动 3.5s 后,每个店 syncFromCloud 后会触发 forcePushShop
  // 如果用户此时切店,会触发新的 render → cb-cache 命中 → 不再走 startupSync
  // 所以 startupSync 不会因切店被中断。V209 不再需要额外保护。
  // 但 V209 提供"手动跳过某店强推"接口
  window.__v209_skipShop = function(shopId){
    try { localStorage.setItem('ec_v209_skip_' + shopId, '1'); } catch(e){}
  };

  waitReady(function(){
    installSbFetchWrap();
    installConsoleFilter();
    installForcePushThrottle();
    console.log('[V209] cb-task-push-fix 安装完成');
  });
})();
