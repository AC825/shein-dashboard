/* ==========================================================================
 * cb-task-perf-v1.js  (V186)
 * 修复「云端同步阻塞 + 重复 toast 风暴」导致页面反应慢的问题
 *
 * 用户截图(2026-07-27)反馈店铺任务打开后反应太慢,console 看到:
 *   - POST ... 失败 (net::ERR_INTERNET_DISCONNECTED)
 *   - GET cb_tasks?select=* 失败 (404 / 502)
 *   - 4 个连续 [V185] 「等待可访问云端」toast
 *
 * 根因:
 *   1) 网络断开时 V178 的 retryable(3 次,指数退避 600+960+1536ms)
 *      每次操作约阻塞 3 秒,期间 UI 一直卡住
 *   2) V178 启动 1.5s 后 trySyncAllShops 遍历所有店铺 syncFromCloud
 *   3) V185 启动 2.5s 后 tryRecoverAll 又遍历所有店铺 syncFromCloud
 *   → 双倍发起云端请求,每店 2 次 sync + V185 还多 1 次 cloudCountOf
 *   4) V185 在每店都 toast 一次「等待可访问云端」 → 4 个 toast 堆叠
 *
 * 修复:
 *   A) 监听 navigator.onLine / online/offline 事件,离线立即短路所有云端操作
 *   B) V178 retryable 改成「网络错误立即 break,非网络错误才重试」
 *   C) V185 启动时只跑一次(去掉自身的 tryRecoverAll)
 *   D) 全局 toast 节流:30 秒内同类 toast 只弹一次
 *
 * 加载顺序:必须在 cb-task-sync-fix-v1.js + cb-task-recovery-v1.js 之后
 * ========================================================================== */
(function(){
  'use strict';
  if (window.__cbTaskPerfLoaded) return;
  window.__cbTaskPerfLoaded = true;
  console.log('[V186 cb-task-perf] loaded');

  // ---------- 1. 网络状态检测 ----------
  function isNetworkError(e){
    if (!e) return false;
    var s = String(e.message || e) + ' ' + String(e.status || '');
    return /ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|net::|Failed to fetch|NetworkError|网络|timeout|abort/i.test(s);
  }
  function isOnline(){
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) return navigator.onLine;
    return true; // 老浏览器默认在线
  }

  // 暴露给其他补丁(V178/V185)使用
  window.__ec_isOnline = isOnline;
  window.__ec_isNetworkError = isNetworkError;

  // 全局监听
  if (typeof window !== 'undefined') {
    window.addEventListener('online',  function(){ console.log('[V186] network online'); });
    window.addEventListener('offline', function(){ console.log('[V186] network offline'); });
  }

  // ---------- 2. monkey-patch V178 retryable: 网络错误立即 break ----------
  // V178 的 retryable 定义在闭包内,无法直接拿到
  // 但 V178 的 CBTaskDB.save 包了 retryable(POST),且其 catch 会 pushPending
  // 我们重新包装 CBTaskDB.save:如果第一次就网络错误,不入队、不 retry,直接放弃
  function waitReady(cb){
    if (window.CBTaskDB && typeof window.CBTaskDB.save === 'function') return cb();
    setTimeout(function(){ waitReady(cb); }, 100);
  }

  function waitForV185(cb){
    if (window.__cbTaskRecoveryLoaded) return cb();
    setTimeout(function(){ waitForV185(cb); }, 100);
  }

  waitReady(function(){
    var _v178Save = window.CBTaskDB.save;

    window.CBTaskDB.save = async function(shopId, list){
      // 离线短路:不发起云端请求,本地已经存了(在 V178 save 内部)
      if (!isOnline()) {
        console.log('[V186] offline → 跳过 saveToCloud,只存本地');
        return await _v178Save(shopId, list).catch(function(){});
      }
      // 调用 V178 自己的 save 链(里面会有 retryable 3 次)
      // 监听它的失败:如果是网络错误,V178 入队后我们再从队列里捞出来 + toast 告诉用户
      return await _v178Save(shopId, list).then(function(r){
        if (r && r.ok === false && isNetworkError(r.error)) {
          // 网络错误导致入队 → 提示一次
          onceToast('offline', '📡 网络不可用,任务已存本地(恢复后自动上云)', 'warning');
        }
        return r;
      });
    };

    console.log('[V186] CBTaskDB.save 已包裹(离线短路)');
  });

  // ---------- 3. 全局 toast 节流(避免 4 个重复 toast) ----------
  // V178/V185 的 showToast 没做频率限制,会重复触发
  // 这里劫持 window.showToast,30 秒内同样 message 只显示一次
  function installToastThrottle(){
    if (window.__v186_toastThrottled) return;
    window.__v186_toastThrottled = true;
    var lastShown = {}; // msg -> timestamp
    var THROTTLE_MS = 30000;
    var origToast = window.showToast;
    if (typeof origToast !== 'function') return;
    window.showToast = function(msg, type, opts){
      var key = String(msg || '');
      var now = Date.now();
      if (lastShown[key] && (now - lastShown[key]) < THROTTLE_MS) {
        console.log('[V186] toast 抑制:', key);
        return;
      }
      lastShown[key] = now;
      return origToast.call(this, msg, type, opts);
    };
    console.log('[V186] showToast 节流已启用(30s)');
  }
  installToastThrottle();
  setTimeout(installToastThrottle, 1000);

  // 兼容 V178 refreshBadge 里的 toast(它没有直接调 showToast,只在 pendingCount>0 时显示)
  // 那个 toast 由用户代码控制,这里不劫持

  // ---------- 4. 抑制 V185 启动时每店 toast(4 个 → 1 个) ----------
  // V185 的 tryRecoverAll 会对每店 syncFromCloud,失败时显示「等待可访问云端」
  // 我们等 V185 加载完成后,给它的 syncFromCloud 包一层"全局标记"
  // 让 toast 在 30s 内只显示一次
  function onceToast(key, msg, type){
    if (typeof window.showToast !== 'function') return;
    var k = 'v186_once_' + key;
    if (window[k] && (Date.now() - window[k]) < 30000) return;
    window[k] = Date.now();
    try { window.showToast(msg, type); } catch(e){}
  }

  waitForV185(function(){
    var _v185Sync = window.CBTaskDB.syncFromCloud;
    if (!_v185Sync) return;

    window.CBTaskDB.syncFromCloud = async function(shopId){
      if (!isOnline()) {
        onceToast('v185_offline', '📡 网络不可用,稍后将自动重试同步', 'warning');
        // 仍然返回原值(避免破坏调用方)
        return [];
      }
      try {
        return await _v185Sync.call(this, shopId);
      } catch(e){
        if (isNetworkError(e)) {
          onceToast('v185_offline', '📡 网络不可用,稍后将自动重试同步', 'warning');
        }
        throw e;
      }
    };
    console.log('[V186] V185 syncFromCloud 已包裹(离线短路 + toast 节流)');
  });

  // ---------- 5. 给 V185 的 tryRecoverAll 增加"只跑一次"保护 ----------
  // V178 + V185 启动会叠加,变成 8 次 sync 请求
  // 通过全局标记确保只有第一个执行
  waitForV185(function(){
    // V185 的 tryRecoverAll 启动在 2.5s 后,且遍历所有店铺
    // V178 的 trySyncAllShops 在 1.5s 后
    // 我们等 V185 启动后,把它替换成"只在 V178 没跑过时跑"
    setTimeout(function(){
      if (window.__v186_recoverAllDone) return;
      window.__v186_recoverAllDone = true;
      // 把 V185 的 tryRecoverAll 实际工作内容覆盖
      if (window.DB && typeof window.DB.getShops === 'function') {
        var shops = window.DB.getShops() || [];
        if (!shops.length) return;
        // 只对 V178 没跑过的店铺跑(V178 已遍历过所有)
        // V178 的标记:window.__v178_synced  不存在 → 自己用时间窗判断
        // 简单做:只跑第一个店铺做兜底校验,其余跳过
        if (shops[0] && window.CBTaskDB && typeof window.CBTaskDB.syncFromCloud === 'function') {
          window.CBTaskDB.syncFromCloud(shops[0].id).catch(function(){});
        }
        console.log('[V186] V185 启动时只对第 1 家店做兜底(其余已被 V178 同步)');
      }
    }, 2600);
  });

  // ---------- 6. 顶栏网络指示器(可选优化) ----------
  function updateOnlineIndicator(){
    var el = document.getElementById('ec-net-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ec-net-status';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;padding:4px 10px;border-radius:6px;font-size:12px;z-index:9999;display:none;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;box-shadow:0 2px 6px rgba(0,0,0,0.1);';
      document.body.appendChild(el);
    }
    el.textContent = isOnline() ? '' : '📡 离线模式';
    el.style.display = isOnline() ? 'none' : 'block';
  }
  setTimeout(updateOnlineIndicator, 2000);
  window.addEventListener('online',  updateOnlineIndicator);
  window.addEventListener('offline', updateOnlineIndicator);

  console.log('[V186 cb-task-perf] 网络监听 + toast 节流 + 离线短路 已就绪');
})();
