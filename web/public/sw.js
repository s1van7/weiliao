/**
 * Service Worker（离线壳 + 强制更新）：
 *   - /api、/socket.io、/uploads 一律放行，绝不缓存（聊天数据必须实时）；
 *   - 导航请求：network + cache:'no-store'，彻底绕开 HTTP 缓存，失败才回退；
 *   - /assets/ 下带内容哈希的文件：cache-first（哈希变了 URL 就变，安全）；
 *   - 其余资源（index.html、sw.js、manifest）：network-first，不写死缓存；
 *   - 版本升级：install 直接 skipWaiting，activate 清空所有旧缓存并 claim，
 *     随后 controllerchange 触发页面自动刷新，用户无需手动强刷。
 */

const VERSION = 'v3';
const ASSET_CACHE = `wx-assets-${VERSION}`;

/** 允许 cache-first 的静态资源扩展名 */
const ASSET_PATTERN = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico)$/i;

self.addEventListener('install', () => {
  // 新版本立即进入等待转激活流程，不提前接管
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * cache-first：命中缓存直接返回，否则请求网络并写入缓存。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

/**
 * network-first（强制走网络）：避免 HTML / sw.js 被浏览器 HTTP 缓存卡住旧版本。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(ASSET_CACHE);
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口与实时通道：直接放行，不缓存
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/uploads') || url.pathname.startsWith('/downloads')) return;

  // 应用外壳（HTML）与 sw.js 自身：永远走网络
  if (request.mode === 'navigate' || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/assets/') || ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
