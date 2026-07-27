// ══════════════════════════════════════════════════════════════
// Bhartia Enterprises Productivity App — offline shell (Bug #9)
// ══════════════════════════════════════════════════════════════
// Prior to this file, the app had no service worker at all: no offline load,
// no app-shell cache, nothing. This file exists to make the app usable
// (form entry, local-first save, offline outbox) when the connection drops,
// without ever showing a cached Apps Script response as if it were current
// business data — that distinction is the whole design of this file.
//
// CACHE_VERSION embeds the frontend version. Bumping APP_VERSION in
// index.html and updating this string together is what lets activate()
// safely delete every older cache instead of accumulating them forever.
var CACHE_VERSION = 'be-shell-v8.2.1-phase5-kpi';

// Only the static shell — never an API response — goes in this cache.
var SHELL_URLS = ['./', './index.html'];

self.addEventListener('install', function (event) {
  // Take over from any previous worker immediately; the shell it caches
  // below is versioned by CACHE_VERSION so this is safe even mid-session.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Best-effort: a slow/broken network on first install should not
      // throw and abort registration — the app must still work uncached.
      return cache.addAll(SHELL_URLS).catch(function () {});
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Never intercept POSTs — that is every checklist/attendance/task/appdata
  // submission. A service worker has no business standing between the app
  // and a write; doing so is how "silently didn't submit" bugs get made.
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Never cache or intercept the Apps Script API. Business data (tasks,
  // state, appdata) must always come from the network or be handled by the
  // app's own outbox/retry logic — a cached API response would show stale
  // numbers as if they were current, which is explicitly forbidden.
  if (url.hostname.indexOf('script.google.com') !== -1 ||
      url.hostname.indexOf('script.googleusercontent.com') !== -1) return;

  // Only manage same-origin requests (the app shell itself). Cross-origin
  // requests (Google Fonts, etc.) pass straight through to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // Offline, or the network request failed outright: serve the last
        // good shell rather than a browser error page, and fall back to the
        // cached index.html for any shell URL we don't have an exact hit for.
        return cached || caches.match('./index.html');
      });
      // Cached shell first (instant, works offline); refresh it in the
      // background whenever the network is actually available.
      return cached || networkFetch;
    })
  );
});
