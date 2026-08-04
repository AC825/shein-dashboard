/* cloudbase-fetch-shim.js — 把前端所有 Supabase API 调用透明重定向到 CloudBase 云函数
 * 用法：在 index.html 顶部 <head> 里用 <script> 标签加载（必须在 data-v3-v10.js 之前）
 *
 * 原理：
 *   1. 拦截 window.fetch
 *   2. 如果 URL 是 Supabase PostgREST (/rest/v1/<table>?...)  → 改写到 CloudBase /data-api?table=<table>&...
 *   3. 拦截 Response.json()
 *   4. 如果返回 { code, data: { rows } } → 解包成 Supabase 兼容的 rows 数组
 *
 * 效果：前端 data-v3-v10.js / auth-v6-safe.js 完全不需要改，自动走 CloudBase 内网
 */

(function() {
  const SUPABASE_HOSTS = ['mcxdvhdyrgqxiuptbjjo.supabase.co'];
  const CB_BASE = 'https://ec-dashboard-9gd5ade79bc8032c-1415986681.ap-shanghai.app.tcloudbase.com';
  const ENABLE = true; // 全局开关

  if (!ENABLE) return;
  if (window.__EC_CB_SHIM__) return; // 防重复
  window.__EC_CB_SHIM__ = true;

  console.log('[CloudBase shim] 已激活，所有 Supabase 请求将自动转 CloudBase /data-api');

  const _origFetch = window.fetch.bind(window);

  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || '';
    let rewritten = false;
    try {
      const u = new URL(url, window.location.href);
      if (SUPABASE_HOSTS.includes(u.host)) {
        // /rest/v1/<table>?... → CB_BASE/data-api?table=<table>&...
        const m = u.pathname.match(/^\/rest\/v1\/([^/?]+)/);
        if (m) {
          const table = m[1];
          const newUrl = new URL(CB_BASE + '/data-api');
          newUrl.searchParams.set('table', table);
          // 透传所有 query（apikey/authorization 跳过）
          u.searchParams.forEach((v, k) => {
            if (k === 'apikey' || k === 'authorization') return;
            newUrl.searchParams.set(k, v);
          });
          url = newUrl.toString();
          rewritten = true;
          console.log('[CloudBase shim]', u.pathname + u.search, '→', newUrl.pathname + newUrl.search);
        }
      }
    } catch (e) {
      // URL parse failed, pass through
    }
    const p = rewritten ? url : (typeof input === 'string' ? url : input);
    return _origFetch(p, init).then(resp => {
      if (!rewritten) return resp;
      // 包一层 json()：解包 {code, data: {rows}}
      const _origJson = resp.json.bind(resp);
      resp.json = function() {
        return _origJson().then(j => {
          if (j && typeof j === 'object' && 'code' in j && 'data' in j) {
            const d = j.data;
            if (d && Array.isArray(d.rows)) return d.rows;
            if (d && typeof d.count === 'number' && Array.isArray(d.rows)) return d.rows;
            return d; // 兜底
          }
          return j;
        });
      };
      return resp;
    });
  };

  // 保留原 fetch 备用
  window.__origFetch = _origFetch;
})();