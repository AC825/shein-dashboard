// 电商数据平台 - Service Worker
// 版本号：每次部署时更新，确保缓存刷新
const CACHE_NAME = 'ec-dashboard-v20260410b';

// 核心静态资源（预缓存）
// 注意：index.html 不预缓存，避免旧版本被长期缓存
const PRECACHE_URLS = [
  '/',
  '/app-v3.js',
  '/data-v3.js',
  '/style.css',
  '/auth.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 静态资源扩展名（缓存优先）
const STATIC_EXTS = /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|otf|json)(\?.*)?$/i;

// =====================
// 安装阶段：预缓存核心资源
// =====================
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching core assets');
      // 逐个添加，避免一个失败导致全部失败
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Failed to cache:', url, err);
        }))
      );
    }).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting();
    })
  );
});

// =====================
// 激活阶段：清理旧缓存
// =====================
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activate complete');
      return self.clients.claim();
    })
  );
});

// =====================
// 请求拦截：按资源类型分级缓存策略
// =====================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 外部 API 请求（Supabase、汇率API）：只走网络，不缓存
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('exchangerate-api.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('open.er-api.com')
  ) {
    return; // 不拦截，直接走网络
  }

  // CDN 资源（Chart.js、xlsx 等）：缓存优先，命中即返回，不再等网络
  if (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached; // 直接返回缓存
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // JS 文件：永远从网络拉最新版（network first），避免旧缓存问题
  // 因为 JS 文件带有 ?v= 版本号参数，每次部署都会变化
  if (/\.js(\?.*)?$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // 图片/CSS/字体等静态资源：缓存优先 + 后台静默刷新（Stale While Revalidate）
  if (STATIC_EXTS.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => null);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // HTML 文档（index.html）：永远不缓存，永远从网络拉最新
  event.respondWith(
    fetch(request, { cache: 'no-store' }).then(response => {
      return response;
    }).catch(() => {
      // 离线时才用缓存兜底
      return caches.match(request).then(cached => {
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// =====================
// 后台同步（可选，用于离线时的数据队列）
// =====================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

