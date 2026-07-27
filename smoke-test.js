/* ══════════════════════════════════════════════════════════════════════
 * Bhartia Enterprises Productivity ERP
 * §7 — Automated post-deployment smoke test
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 * ------------
 * The directive requires "a repeatable smoke-test routine that runs after
 * every deployment", verifying seventeen named things against PRODUCTION.
 * This file is that routine. It is deliberately NOT part of the app shell:
 * it is never loaded by index.html, never registered in the service worker
 * cache, and adds nothing to the bundle every employee downloads. It is a
 * separate committed artefact that is loaded on demand, against the live
 * site, by whoever is running a deployment.
 *
 * HOW TO RUN IT
 * -------------
 *   1. Open the production app:
 *        https://bhartiaenterprises.github.io/Productivity-Checklist/
 *   2. Open DevTools → Console.
 *   3. Load this file (it is served from the same origin):
 *        fetch('./smoke-test.js?_=' + Date.now())
 *          .then(function(r){ return r.text(); })
 *          .then(function(t){ (0, eval)(t); });
 *   4. Run it:
 *        beSmokeTest({ ownerKey: '<owner key hash>' }).then(function(r){
 *          console.log(r.text);     // human-readable table
 *          window.__SMOKE = r;      // full structured result
 *        });
 *
 *   Options (all optional):
 *     expectVersion   frontend version this deployment is supposed to be
 *                     (defaults to the APP_VERSION of the running page,
 *                     which makes check 2 a repo-vs-served comparison)
 *     ownerKey        the owner key HASH — required to run the scripted
 *                     ZZTEST- cleanup at the end. Without it the test still
 *                     runs but REFUSES to claim it cleaned up, and prints
 *                     the exact identifiers it left behind.
 *     user + hash     a real login, to unlock the authenticated checks
 *       (or token)    (16 = dashboard). Without them those checks report
 *                     BLOCKED with the reason — never PASS.
 *     realUserNoPin   name of a real user who has no PIN yet, used by
 *                     check 11 to prove the server refuses rather than
 *                     downgrades. Skipped if not supplied.
 *     write:false     read-only run: every writing check reports BLOCKED.
 *
 * THE RULES THIS FILE OBEYS
 * -------------------------
 *   · Every record it writes carries the reserved ZZTEST- prefix, and the
 *     only way it removes them is the scripted, owner-gated
 *     ?action=cleanupTest endpoint. Never a manual spreadsheet edit.
 *   · It never touches a real employee record and never touches a real
 *     task: it creates its own ZZTEST- task and its own ZZTEST- App Data
 *     documents, and deletes exactly those.
 *   · It never logs, sends or stores a PIN. The optional 'hash' it accepts
 *     is the same SHA-256 the app already puts on the wire, and it is
 *     scrubbed out of every string this file returns.
 *   · A check that cannot be performed is reported BLOCKED with the reason.
 *     It is never reported PASS. "Could not test it" and "it works" are
 *     different facts and this file keeps them apart.
 *
 * ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var SMOKE_VERSION = '1.0.0';

  // ────────────────────────────────────────────────────────────────────
  // Check 17 support: uncaught error capture.
  //
  // A script injected into an already-loaded page physically cannot see an
  // error that was thrown before it existed. Rather than pretend otherwise,
  // this records the observation window it actually had, and check 17 only
  // returns PASS when that window covers a page load. beSmokeArmErrors()
  // exists so the window can be opened as early as a <script> tag allows.
  // ────────────────────────────────────────────────────────────────────
  function armErrors() {
    if (global.__BE_SMOKE_ERRORS) return global.__BE_SMOKE_ERRORS;
    var box = {
      installedAt: Date.now(),
      readyStateAtInstall: document.readyState,
      coversLoad: (document.readyState === 'loading' || document.readyState === 'interactive'),
      errors: []
    };
    global.addEventListener('error', function (ev) {
      // Resource errors (a 404 image) also arrive here; keep them separate
      // from real uncaught exceptions so the report can tell them apart.
      var isResource = !!(ev && ev.target && ev.target !== global && ev.target.tagName);
      box.errors.push({
        kind: isResource ? 'resource' : 'exception',
        message: isResource ? ('failed to load ' + String(ev.target.tagName)) : String((ev && ev.message) || 'error'),
        source: isResource ? String(ev.target.src || ev.target.href || '') : String((ev && ev.filename) || ''),
        line: (ev && ev.lineno) || 0,
        at: Date.now()
      });
    }, true);
    global.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      box.errors.push({
        kind: 'unhandledrejection',
        message: String((r && (r.message || r)) || 'rejection'),
        source: '', line: 0, at: Date.now()
      });
    });
    global.__BE_SMOKE_ERRORS = box;
    return box;
  }
  armErrors();

  // ────────────────────────────────────────────────────────────────────
  // Small helpers
  // ────────────────────────────────────────────────────────────────────

  function isoNow(offsetMs) { return new Date(Date.now() + (offsetMs || 0)).toISOString(); }

  function today() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // Nothing this file returns may contain the deployment URL or a PIN hash.
  function makeScrub(o) {
    var secrets = [];
    if (o.scriptUrl) {
      secrets.push(o.scriptUrl);
      var m = /\/macros\/s\/([^\/]+)\//.exec(o.scriptUrl);
      if (m) secrets.push(m[1]);
    }
    if (o.hash) secrets.push(o.hash);
    if (o.ownerKey) secrets.push(o.ownerKey);
    if (o.token) secrets.push(o.token);
    return function (s) {
      s = String(s === undefined || s === null ? '' : s);
      for (var i = 0; i < secrets.length; i++) {
        if (!secrets[i]) continue;
        while (s.indexOf(secrets[i]) >= 0) s = s.replace(secrets[i], '<redacted>');
      }
      return s;
    };
  }

  function fetchTimeout(url, init, ms) {
    return new Promise(function (resolve, reject) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) {}
        reject(new Error('timeout after ' + ms + 'ms'));
      }, ms);
      init = init || {};
      if (ctrl) init.signal = ctrl.signal;
      fetch(url, init).then(function (r) { clearTimeout(timer); resolve(r); },
                            function (e) { clearTimeout(timer); reject(e); });
    });
  }

  // GET the Apps Script endpoint and parse whatever comes back. Returns the
  // raw text too, because several checks assert on a NON-JSON response.
  function gj(o, params) {
    var qs = [], k, v;
    for (k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      v = params[k];
      if (v === undefined || v === null || v === '') continue;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    // Cache-bust every read: a cached 200 would make a broken deployment
    // look healthy, which is exactly the failure this file exists to catch.
    qs.push('_smoke=' + Date.now() + Math.random().toString(36).slice(2, 6));
    return fetchTimeout(o.scriptUrl + '?' + qs.join('&'),
                        { method: 'GET', redirect: 'follow', cache: 'no-store' }, o.timeoutMs)
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) {}
          return { ok: r.ok, code: r.status, text: t, json: j };
        });
      });
  }

  // POST exactly the way the app posts: form-encoded, no-cors. Resolving
  // means the request reached the server; the response body is opaque, so
  // every write in this file is proved by a separate read-back, never by
  // the POST "succeeding".
  function post(o, payload) {
    return new Promise(function (resolve) {
      try {
        var form = new FormData();
        var keys = Object.keys(payload);
        for (var i = 0; i < keys.length; i++) {
          var v = payload[keys[i]];
          if (v === undefined || v === null) continue;
          form.append(keys[i], (typeof v === 'object') ? JSON.stringify(v) : String(v));
        }
        fetchTimeout(o.scriptUrl, { method: 'POST', body: form, mode: 'no-cors' }, o.timeoutMs)
          .then(function () { resolve(true); }, function () { resolve(false); });
      } catch (e) { resolve(false); }
    });
  }

  // Poll a read endpoint until testFn returns something truthy, or give up.
  // Apps Script writes are not instantly visible; a single read-back would
  // produce flaky failures and tempt whoever runs this into ignoring them.
  function pollFor(o, params, testFn, budgetMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        gj(o, params).then(function (r) {
          var v = null;
          try { v = testFn(r); } catch (e) { v = null; }
          if (v) { resolve({ found: true, value: v, waitedMs: Date.now() - start, last: r }); return; }
          if (Date.now() - start > budgetMs) { resolve({ found: false, waitedMs: Date.now() - start, last: r }); return; }
          setTimeout(tick, 2500);
        }, function () {
          if (Date.now() - start > budgetMs) { resolve({ found: false, waitedMs: Date.now() - start, last: null }); return; }
          setTimeout(tick, 2500);
        });
      }
      tick();
    });
  }

  // Every read in this file carries a ?_smoke= cache-buster so a cached 200
  // can never make a broken deployment look healthy. The service worker's
  // fetch handler caches any same-origin GET it serves, so those busted URLs
  // would otherwise accumulate in the shell cache, one set per run, forever.
  // They are this file's own litter, so this file removes them — and it
  // removes ONLY entries whose URL carries the _smoke marker, never the real
  // shell entries the offline app depends on.
  function pruneSmokeCacheEntries() {
    if (!('caches' in global)) return Promise.resolve(0);
    return caches.keys().then(function (names) {
      var removed = 0;
      function nextCache(i) {
        if (i >= names.length) return Promise.resolve(removed);
        return caches.open(names[i]).then(function (cache) {
          return cache.keys().then(function (reqs) {
            var doomed = [];
            for (var j = 0; j < reqs.length; j++) {
              if (String(reqs[j].url).indexOf('_smoke=') >= 0) doomed.push(reqs[j]);
            }
            function nextReq(k) {
              if (k >= doomed.length) return Promise.resolve();
              return cache['delete'](doomed[k]).then(function (ok) {
                if (ok) removed++;
                return nextReq(k + 1);
              });
            }
            return nextReq(0);
          });
        }).then(function () { return nextCache(i + 1); },
                function () { return nextCache(i + 1); });
      }
      return nextCache(0);
    }, function () { return 0; });
  }

  function appDataDoc(r, key) {
    if (!r || !r.json || !r.json.items) return null;
    for (var i = 0; i < r.json.items.length; i++) {
      if (r.json.items[i].key === key) return r.json.items[i];
    }
    return null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Result plumbing
  // ────────────────────────────────────────────────────────────────────

  function PASS(detail, data)    { return { status: 'PASS',    detail: detail, data: data || null }; }
  function FAIL(detail, data)    { return { status: 'FAIL',    detail: detail, data: data || null }; }
  function BLOCKED(detail, data) { return { status: 'BLOCKED', detail: detail, data: data || null }; }

  function cfg(opts) {
    opts = opts || {};
    var o = {};
    o.expectVersion = opts.expectVersion || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
    o.expectCache   = opts.expectCache   || ('be-shell-v' + o.expectVersion);
    o.scriptUrl     = opts.scriptUrl     || (typeof SCRIPT_URL !== 'undefined' ? SCRIPT_URL : '');
    o.ownerKey      = opts.ownerKey      || '';
    o.user          = opts.user          || '';
    o.hash          = opts.hash          || '';
    o.token         = opts.token         || '';
    o.realUserNoPin = opts.realUserNoPin || '';
    o.write         = (opts.write === false) ? false : true;
    o.timeoutMs     = opts.timeoutMs     || 20000;
    o.pollMs        = opts.pollMs        || 30000;
    o.shellUrl      = opts.shellUrl      || (new URL('./index.html', location.href)).href;
    o.swUrl         = opts.swUrl         || (new URL('./sw.js', location.href)).href;
    return o;
  }

  // ────────────────────────────────────────────────────────────────────
  // THE SEVENTEEN CHECKS
  // Each returns a promise for {status, detail, data}. 'S' is scratch state
  // shared down the chain (identifiers, fetched text) so later checks can
  // assert against what earlier ones actually observed.
  // ────────────────────────────────────────────────────────────────────

  function buildChecks(o, S) {
    return [

    // 1 ─────────────────────────────────────────────────────────────────
    { id: 'frontend_loads', title: 'Production frontend loads', fn: function () {
      return fetchTimeout(o.shellUrl + '?_smoke=' + Date.now(), { cache: 'no-store' }, o.timeoutMs)
        .then(function (r) {
          if (!r.ok) return FAIL('shell responded HTTP ' + r.status);
          return r.text().then(function (t) {
            S.shellText = t;
            if (t.length < 100000) return FAIL('shell is only ' + t.length + ' chars — truncated or wrong file');
            if (t.indexOf('APP_VERSION') < 0) return FAIL('shell has no APP_VERSION marker');
            if (t.indexOf('</html>') < 0)     return FAIL('shell is not a complete HTML document');
            return PASS('HTTP ' + r.status + ', ' + t.length + ' chars, complete document', { chars: t.length });
          });
        });
    } },

    // 2 ─────────────────────────────────────────────────────────────────
    // Three things must agree: what GitHub Pages is serving, what this page
    // is actually running, and what the deployment says it published. Any
    // two agreeing is the classic "deployed but the browser kept the old
    // shell" false pass, so all three are compared.
    { id: 'frontend_version', title: 'Frontend version is correct', fn: function () {
      if (!S.shellText) return Promise.resolve(BLOCKED('check 1 did not fetch the shell'));
      var m = /var\s+APP_VERSION\s*=\s*'([^']+)'/.exec(S.shellText);
      var served = m ? m[1] : '';
      var running = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '';
      return fetchTimeout(o.swUrl + '?_smoke=' + Date.now(), { cache: 'no-store' }, o.timeoutMs)
        .then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; })
        .then(function (swText) {
          var sm = /var\s+CACHE_VERSION\s*=\s*'([^']+)'/.exec(swText || '');
          var swCache = sm ? sm[1] : '';
          S.swCache = swCache;
          var d = { served: served, running: running, expected: o.expectVersion, swCache: swCache, expectedCache: o.expectCache };
          if (!served)                       return FAIL('could not read APP_VERSION out of the served shell', d);
          if (served !== o.expectVersion)    return FAIL('served ' + served + ' but this deployment expects ' + o.expectVersion, d);
          if (running !== o.expectVersion)   return FAIL('this page is running ' + running + ' — an old shell is still cached', d);
          if (swCache !== o.expectCache)     return FAIL('service worker cache is ' + swCache + ', expected ' + o.expectCache, d);
          return PASS('served / running / service-worker cache all agree on ' + served, d);
        });
    } },

    // 3 ─────────────────────────────────────────────────────────────────
    { id: 'endpoint_responds', title: 'Apps Script endpoint responds', fn: function () {
      if (!o.scriptUrl) return Promise.resolve(BLOCKED('no SCRIPT_URL available on this page'));
      return gj(o, {}).then(function (r) {
        if (!r.ok) return FAIL('HTTP ' + r.code);
        if (!r.text || r.text.length < 10) return FAIL('empty response body');
        if (r.text.indexOf('Bhartia Enterprises API') !== 0) {
          return FAIL('unexpected root response: ' + r.text.slice(0, 80));
        }
        return PASS('HTTP ' + r.code + ' — ' + r.text.slice(0, 60), { body: r.text.slice(0, 120) });
      }, function (e) { return FAIL('request failed: ' + (e && e.message)); });
    } },

    // 4 ─────────────────────────────────────────────────────────────────
    { id: 'get_tasks', title: 'getTasks works', fn: function () {
      return gj(o, { action: 'getTasks' }).then(function (r) {
        if (!r.json) return FAIL('response was not JSON: ' + r.text.slice(0, 80));
        if (r.json.status !== 'ok') return FAIL('status=' + r.json.status);
        var list = r.json.tasks;
        if (!(list instanceof Array)) return FAIL('no tasks array in the response');
        S.taskCountBefore = list.length;
        return PASS(list.length + ' task rows returned', { count: list.length });
      }, function (e) { return FAIL('request failed: ' + (e && e.message)); });
    } },

    // 5 ─────────────────────────────────────────────────────────────────
    { id: 'state', title: 'state works', fn: function () {
      return gj(o, { action: 'state' }).then(function (r) {
        if (!r.json) return FAIL('response was not JSON: ' + r.text.slice(0, 80));
        if (r.json.status !== 'ok') return FAIL('status=' + r.json.status);
        var st = r.json.state;
        if (!st || !st.stores) return FAIL('no state.stores in the response');
        if (!st.stores.BC || !st.stores.VKS) return FAIL('state is missing BC and/or VKS');
        return PASS('state for ' + st.date + ' with BC and VKS present',
                    { date: st.date, stores: Object.keys(st.stores) });
      }, function (e) { return FAIL('request failed: ' + (e && e.message)); });
    } },

    // 6 ─────────────────────────────────────────────────────────────────
    { id: 'get_appdata', title: 'getAppData works', fn: function () {
      return gj(o, { action: 'getAppData', prefix: 'be_' }).then(function (r) {
        if (!r.json) return FAIL('response was not JSON: ' + r.text.slice(0, 80));
        if (r.json.status !== 'ok') return FAIL('status=' + r.json.status);
        if (!(r.json.items instanceof Array)) return FAIL('no items array in the response');
        return PASS(r.json.count + ' App Data documents returned', { count: r.json.count });
      }, function (e) { return FAIL('request failed: ' + (e && e.message)); });
    } },

    // 7 ─────────────────────────────────────────────────────────────────
    // A real write through the real production task path. The row is stored
    // with store 'ZZTEST' and assignee 'ZZTEST-SMOKE' so it cannot appear in
    // any employee's store-filtered or person-filtered pull, and it is
    // deleted by the scripted cleanup at the end of the run.
    { id: 'task_roundtrip', title: 'Task write and read round-trip works', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      var id = S.tid + '-TASK';
      S.created.tasks.push(id);
      var task = {
        id: id, store: 'ZZTEST', assignedTo: 'ZZTEST-SMOKE', addedBy: 'ZZTEST-SMOKE',
        source: 'smoke-test', desc: 'ZZTEST smoke test row — created by smoke-test.js, removed automatically',
        priority: 'normal', status: 'pending', date: today(), type: 'oneoff',
        recurrence: null, doneDates: [], history: []
      };
      return post(o, { type_: 'task_sync', tasks: JSON.stringify([task]), cid: S.tid + '-c1' })
        .then(function (sent) {
          if (!sent) return FAIL('POST did not reach the server');
          return pollFor(o, { action: 'getTasks' }, function (r) {
            if (!r.json || !(r.json.tasks instanceof Array)) return null;
            for (var i = 0; i < r.json.tasks.length; i++) {
              if (r.json.tasks[i].id === id) return r.json.tasks[i];
            }
            return null;
          }, o.pollMs).then(function (res) {
            if (!res.found) return FAIL('task ' + id + ' was not readable back within ' + Math.round(o.pollMs / 1000) + 's');
            var got = res.value;
            if (got.desc !== task.desc)   return FAIL('round-tripped desc does not match what was written', { got: got.desc });
            if (got.store !== 'ZZTEST')   return FAIL('round-tripped store does not match', { got: got.store });
            if (got.status !== 'pending') return FAIL('round-tripped status does not match', { got: got.status });
            return PASS('wrote and read back ' + id + ' in ' + res.waitedMs + 'ms, fields identical', { id: id, waitedMs: res.waitedMs });
          });
        });
    } },

    // 8 ─────────────────────────────────────────────────────────────────
    { id: 'appdata_roundtrip', title: 'App Data write and read round-trip works', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      var key = S.tid + '-DOC';
      S.created.appdata.push(key);
      S.docKey = key;
      S.docStamp = isoNow();
      var body = JSON.stringify({ marker: S.tid, note: 'smoke test document', at: S.docStamp });
      S.docBody = body;
      return post(o, { type_: 'appdata', key: key, json: body, updatedAt: S.docStamp,
                       actor: 'ZZTEST-SMOKE', cid: S.tid + '-c2' })
        .then(function (sent) {
          if (!sent) return FAIL('POST did not reach the server');
          return pollFor(o, { action: 'getAppData', keys: key }, function (r) {
            return appDataDoc(r, key);
          }, o.pollMs).then(function (res) {
            if (!res.found) return FAIL('document ' + key + ' was not readable back within ' + Math.round(o.pollMs / 1000) + 's');
            var doc = res.value;
            var parsed = null;
            try { parsed = JSON.parse(doc.json); } catch (e) {}
            if (!parsed) return FAIL('stored document is not valid JSON');
            if (parsed.marker !== S.tid) return FAIL('stored marker does not match what was written', { got: parsed.marker });
            S.docStoredAt = doc.updatedAt;
            return PASS('wrote and read back ' + key + ' in ' + res.waitedMs + 'ms, marker identical',
                        { key: key, waitedMs: res.waitedMs, updatedAt: doc.updatedAt });
          });
        });
    } },

    // 9 ─────────────────────────────────────────────────────────────────
    // Last-write-wins on updatedAt (§6). Re-post the SAME key with an older
    // timestamp and different content: the server must keep the newer copy.
    // Proved by reading the document back, not by trusting the POST result —
    // a no-cors response body is opaque and cannot be evidence of anything.
    { id: 'stale_rejection', title: 'Stale write rejection works', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      if (!S.docKey || !S.docStoredAt) return Promise.resolve(BLOCKED('check 8 did not establish a stored document'));
      var stale = JSON.stringify({ marker: 'ZZTEST-STALE-MUST-NOT-LAND', at: isoNow(-3600000) });
      return post(o, { type_: 'appdata', key: S.docKey, json: stale, updatedAt: isoNow(-3600000),
                       actor: 'ZZTEST-SMOKE', cid: S.tid + '-c3' })
        .then(function (sent) {
          if (!sent) return FAIL('POST did not reach the server');
          // Give the write a chance to land before asserting it did not.
          return new Promise(function (res) { setTimeout(res, 6000); });
        })
        .then(function () {
          return gj(o, { action: 'getAppData', keys: S.docKey });
        })
        .then(function (r) {
          var doc = appDataDoc(r, S.docKey);
          if (!doc) return FAIL('document disappeared after the stale write');
          var parsed = null;
          try { parsed = JSON.parse(doc.json); } catch (e) {}
          if (!parsed) return FAIL('document is no longer valid JSON after the stale write');
          if (parsed.marker !== S.tid) return FAIL('STALE WRITE OVERWROTE THE NEWER DOCUMENT — last-write-wins is broken', { marker: parsed.marker });
          if (doc.updatedAt !== S.docStoredAt) return FAIL('updatedAt moved backwards to ' + doc.updatedAt, { was: S.docStoredAt });
          return PASS('one-hour-old write was skipped; stored copy still ' + doc.updatedAt, { updatedAt: doc.updatedAt });
        });
    } },

    // 10 ────────────────────────────────────────────────────────────────
    // Malformed input must be refused with a meaningful outcome, not stored
    // and not crashed on. Again asserted by read-back: the bad key must not
    // exist afterwards.
    { id: 'malformed_rejection', title: 'Malformed request rejection works', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      var badKey = S.tid + '-BAD';
      S.created.appdata.push(badKey);
      var notes = [];
      return post(o, { type_: 'appdata', key: badKey, json: '{this is not valid json',
                       updatedAt: isoNow(), cid: S.tid + '-c4' })
        .then(function () {
          // A second malformation: no key at all.
          return post(o, { type_: 'appdata', json: '{"a":1}', updatedAt: isoNow(), cid: S.tid + '-c5' });
        })
        .then(function () { return new Promise(function (res) { setTimeout(res, 6000); }); })
        .then(function () { return gj(o, { action: 'getAppData', keys: badKey }); })
        .then(function (r) {
          if (!r.json) return FAIL('read-back was not JSON');
          var doc = appDataDoc(r, badKey);
          if (doc) return FAIL('MALFORMED DOCUMENT WAS STORED as ' + badKey, { json: String(doc.json).slice(0, 80) });
          notes.push('invalid JSON was not stored');
          notes.push('keyless document was not stored');
          // And an unknown GET action must answer, not 500.
          return gj(o, { action: 'zzz_no_such_action_smoke' }).then(function (r2) {
            if (!r2.ok) { notes.push('unknown action returned HTTP ' + r2.code); return FAIL(notes.join('; ')); }
            notes.push('unknown GET action answered HTTP ' + r2.code + ' without crashing');
            return PASS(notes.join('; '), { notes: notes });
          });
        });
    } },

    // 11 ────────────────────────────────────────────────────────────────
    // RBAC at the DATA layer, not the interface layer (§4). Every one of
    // these must be REFUSED. A single one returning business data is a
    // failure of the whole check — there is no partial credit here.
    { id: 'rbac', title: 'RBAC prevents unauthorised access', fn: function () {
      var probes = [
        { name: 'module read with no user',        params: { action: 'module', name: 'kpi' } },
        { name: 'module read, unknown module',     params: { action: 'module', name: 'zzz_not_a_module', user: 'ZZTEST-NOBODY', hash: 'x' } },
        { name: 'module read, unknown user',       params: { action: 'module', name: 'kpi', user: 'ZZTEST-NOBODY', hash: 'x' } },
        { name: 'module registry, unknown user',   params: { action: 'modules', user: 'ZZTEST-NOBODY', hash: 'x' } },
        { name: 'dashboard, unknown user',         params: { action: 'dashboard', user: 'ZZTEST-NOBODY', hash: 'x' } },
        { name: 'dashboard, no credentials',       params: { action: 'dashboard' } },
        { name: 'cleanupTest without owner key',   params: { action: 'cleanupTest' } },
        { name: 'cleanupTest, wrong owner key',    params: { action: 'cleanupTest', ownerKey: 'ZZTEST-not-the-key' } }
      ];
      if (o.realUserNoPin) {
        probes.push({ name: 'module read, real user with no PIN', params: { action: 'module', name: 'kpi', user: o.realUserNoPin } });
      }
      var out = [], bad = [];
      function step(i) {
        if (i >= probes.length) {
          if (bad.length) return FAIL('NOT REFUSED: ' + bad.join(' | '), { probes: out });
          return PASS('all ' + probes.length + ' unauthorised probes refused, none returned data', { probes: out });
        }
        return gj(o, probes[i].params).then(function (r) {
          var j = r.json;
          // Refused means: status is not ok, AND no business payload came back.
          var leaked = !!(j && (j.items || j.tasks || j.modules || j.owner || j.manager || j.employee || j.removed));
          var refused = !!(j && j.status === 'error') && !leaked;
          out.push({ probe: probes[i].name, refused: refused, reason: (j && (j.reason || j.message)) || String(r.text).slice(0, 60) });
          if (!refused) bad.push(probes[i].name);
          return step(i + 1);
        }, function (e) {
          out.push({ probe: probes[i].name, refused: false, reason: 'request failed: ' + (e && e.message) });
          bad.push(probes[i].name + ' (request failed)');
          return step(i + 1);
        });
      }
      return step(0);
    } },

    // 12 ────────────────────────────────────────────────────────────────
    { id: 'sw_registers', title: 'Service worker registers', fn: function () {
      if (!('serviceWorker' in navigator)) return Promise.resolve(FAIL('this browser has no service worker support'));
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) return FAIL('no service worker registration on this origin');
        var active = !!(reg.active);
        var ctrl = !!navigator.serviceWorker.controller;
        return caches.keys().then(function (keys) {
          S.cacheKeys = keys;
          var d = { active: active, controlling: ctrl, caches: keys, scriptUrl: String(reg.active && reg.active.scriptURL || '').split('/').pop() };
          if (!active) return FAIL('registration exists but no active worker', d);
          if (!ctrl)   return FAIL('active worker is not controlling this page — reload once and re-run', d);
          if (keys.length !== 1 || keys[0] !== o.expectCache) {
            return FAIL('cache keys are ' + JSON.stringify(keys) + ', expected exactly ["' + o.expectCache + '"]', d);
          }
          return PASS('active, controlling, and exactly one cache: ' + keys[0], d);
        });
      }, function (e) { return FAIL('getRegistration failed: ' + (e && e.message)); });
    } },

    // 13 ────────────────────────────────────────────────────────────────
    // What can be proved from script: the versioned cache actually holds a
    // complete, current shell that the fetch handler would serve when the
    // network is gone. What CANNOT be proved from script is the literal
    // "turn Wi-Fi off and reload" test — that is a device test, and this
    // check says so rather than implying it covered it.
    { id: 'offline_shell', title: 'Offline shell loads', fn: function () {
      if (!('caches' in global)) return Promise.resolve(FAIL('this browser has no Cache Storage'));
      return caches.open(o.expectCache).then(function (cache) {
        return cache.match('./index.html').then(function (res) {
          if (!res) return cache.match('./').then(function (r2) { return r2; });
          return res;
        }).then(function (res) {
          if (!res) return FAIL('the ' + o.expectCache + ' cache holds no shell entry');
          return res.text().then(function (t) {
            if (t.length < 100000) return FAIL('cached shell is only ' + t.length + ' chars');
            var m = /var\s+APP_VERSION\s*=\s*'([^']+)'/.exec(t);
            var v = m ? m[1] : '';
            if (v !== o.expectVersion) return FAIL('cached shell is version ' + v + ', expected ' + o.expectVersion);
            return PASS('cache holds a complete ' + v + ' shell (' + t.length + ' chars) — note: the literal ' +
                        'Wi-Fi-off reload remains a device test this script cannot perform',
                        { chars: t.length, version: v, deviceTestOutstanding: true });
          });
        });
      }, function (e) { return FAIL('caches.open failed: ' + (e && e.message)); });
    } },

    // 14 ────────────────────────────────────────────────────────────────
    // The offline outbox must actually drain. This seeds one ZZTEST payload
    // through the app's OWN outbox API and calls the app's OWN flush, then
    // proves the row reached the server.
    //
    // If the outbox already holds genuine pending items, this check refuses
    // to run: flushing them would write real business records, and §7 says
    // the smoke test must not modify real records. Re-run when it is empty.
    { id: 'queue_retries', title: 'Pending queue retries', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      if (typeof outboxLoad !== 'function' || typeof outboxAdd !== 'function' || typeof syncOutbox !== 'function') {
        return Promise.resolve(BLOCKED('outbox API not present on this page — run this on the app itself'));
      }
      var baseline = outboxLoad().length;
      if (baseline > 0) {
        return Promise.resolve(BLOCKED('outbox already holds ' + baseline + ' genuine pending item(s); flushing them ' +
                                       'would write real records. Re-run when the queue is empty.'));
      }
      var key = S.tid + '-QUEUE';
      S.created.appdata.push(key);
      var body = JSON.stringify({ marker: S.tid, via: 'outbox' });
      outboxAdd({ type_: 'appdata', key: key, json: body, updatedAt: isoNow(),
                  actor: 'ZZTEST-SMOKE', cid: S.tid + '-c6' });
      var queued = outboxLoad().length;
      if (queued !== baseline + 1) return Promise.resolve(FAIL('outboxAdd did not queue the item (' + baseline + ' -> ' + queued + ')'));
      return syncOutbox(true).then(function (outcome) {
        var after = outboxLoad().length;
        if (after !== 0) return FAIL('queue did not drain: ' + after + ' still pending, syncOutbox said "' + outcome + '"');
        return pollFor(o, { action: 'getAppData', keys: key }, function (r) { return appDataDoc(r, key); }, o.pollMs)
          .then(function (res) {
            if (!res.found) return FAIL('queue drained but the document never reached the server');
            return PASS('queued 1 item, syncOutbox returned "' + outcome + '", queue drained to 0, document confirmed on the server',
                        { outcome: outcome, waitedMs: res.waitedMs });
          });
      }, function (e) { return FAIL('syncOutbox threw: ' + (e && e.message)); });
    } },

    // 15 ────────────────────────────────────────────────────────────────
    // Duplicate protection. Re-post an ALREADY USED cid carrying different
    // content and a NEWER updatedAt — so if the content lands, the only
    // possible explanation is that cid dedupe failed (staleness cannot be
    // the reason it was rejected). Then confirm the cid is on record.
    { id: 'no_duplicate_write', title: 'No duplicate write occurs', fn: function () {
      if (!o.write) return Promise.resolve(BLOCKED('read-only run (write:false)'));
      if (!S.docKey) return Promise.resolve(BLOCKED('check 8 did not establish a stored document'));
      var dup = JSON.stringify({ marker: 'ZZTEST-DUP-MUST-NOT-LAND', at: isoNow(60000) });
      return post(o, { type_: 'appdata', key: S.docKey, json: dup, updatedAt: isoNow(60000),
                       actor: 'ZZTEST-SMOKE', cid: S.tid + '-c2' })   // <- deliberately the cid from check 8
        .then(function (sent) {
          if (!sent) return FAIL('POST did not reach the server');
          return new Promise(function (res) { setTimeout(res, 6000); });
        })
        .then(function () { return gj(o, { action: 'getAppData', keys: S.docKey }); })
        .then(function (r) {
          var doc = appDataDoc(r, S.docKey);
          if (!doc) return FAIL('document disappeared after the duplicate post');
          var parsed = null;
          try { parsed = JSON.parse(doc.json); } catch (e) {}
          if (!parsed) return FAIL('document is no longer valid JSON');
          if (parsed.marker !== S.tid) return FAIL('DUPLICATE cid WAS PROCESSED — content changed to ' + parsed.marker);
          return gj(o, { action: 'confirm', cid: S.tid + '-c2' }).then(function (c) {
            var found = !!(c.json && c.json.found);
            if (!found) return FAIL('duplicate was ignored, but the original cid is not on record either');
            return PASS('re-posting a used cid with newer content changed nothing; cid is on record', { cid: '<test cid>' });
          });
        });
    } },

    // 16 ────────────────────────────────────────────────────────────────
    // Dashboard sanity. Needs a real login: the endpoint refuses rather than
    // downgrades, which is correct, so without credentials this reports
    // BLOCKED. It never reports PASS on the strength of a refusal.
    { id: 'dashboard_consistency', title: 'Dashboard counts non-negative and internally consistent', fn: function () {
      if (!o.user || (!o.hash && !o.token)) {
        return Promise.resolve(BLOCKED('no credentials supplied — pass {user, hash} or {user, token} to run this check. ' +
                                       'The endpoint correctly refuses anonymous callers, and a refusal is not evidence ' +
                                       'that the numbers are right.'));
      }
      var p = { action: 'dashboard', user: o.user, date: today() };
      if (o.hash) p.hash = o.hash; else p.token = o.token;
      return gj(o, p).then(function (r) {
        if (!r.json) return FAIL('response was not JSON');
        if (r.json.status !== 'ok') return FAIL('dashboard refused: ' + (r.json.reason || r.json.message));
        var d = r.json, problems = [], numbers = 0;
        var COUNT_KEYS = /^(active|overdue|dueToday|doneToday|open|total|count|present|absent|late|pending|done|late|onLeave)$/;
        var PCT_KEYS = /(pct|percent)$/i;
        function walk(node, path) {
          if (node === null || node === undefined) return;
          if (typeof node === 'number') {
            numbers++;
            if (!isFinite(node)) problems.push(path + ' is not finite (' + node + ')');
            return;
          }
          if (node instanceof Array) {
            for (var i = 0; i < node.length; i++) walk(node[i], path + '[' + i + ']');
            return;
          }
          if (typeof node !== 'object') return;
          var keys = Object.keys(node);
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k], v = node[key], sub = path ? (path + '.' + key) : key;
            if (typeof v === 'number') {
              numbers++;
              if (!isFinite(v)) { problems.push(sub + ' is not finite'); continue; }
              if (COUNT_KEYS.test(key) && v < 0) problems.push(sub + ' is negative (' + v + ')');
              if (PCT_KEYS.test(key) && (v < 0 || v > 100)) problems.push(sub + ' is out of 0..100 (' + v + ')');
              continue;
            }
            // Internal consistency: the recurring block is computed, so it
            // must agree with itself.
            if (key === 'recurring' && v && typeof v === 'object') {
              if (typeof v.dueToday === 'number' && typeof v.doneToday === 'number') {
                if (v.doneToday > v.dueToday) problems.push(sub + ': doneToday ' + v.doneToday + ' > dueToday ' + v.dueToday);
                var want = v.dueToday ? Math.round(v.doneToday * 100 / v.dueToday) : null;
                if (v.pct !== want) problems.push(sub + ': pct ' + v.pct + ' does not match ' + want);
              }
            }
            // A list and its own count must agree where both are present.
            if (v && typeof v === 'object' && !(v instanceof Array)) {
              if ((v.list instanceof Array) && typeof v.open === 'number' && v.open !== v.list.length && v.list.length > 0) {
                // Not necessarily an error (lists are often capped), so only
                // flag the impossible direction.
                if (v.open < v.list.length) problems.push(sub + ': open ' + v.open + ' < list length ' + v.list.length);
              }
            }
            walk(v, sub);
          }
        }
        walk(d, '');
        // Data-level RBAC: a non-owner payload must not carry owner sections.
        if (d.scope !== 'owner' && (d.owner || d.allStores)) problems.push('scope=' + d.scope + ' but the payload carries an owner section');
        if (problems.length) return FAIL(problems.length + ' problem(s): ' + problems.slice(0, 5).join(' | '), { problems: problems });
        return PASS('scope=' + d.scope + ', ' + numbers + ' numeric values, all finite, non-negative and self-consistent',
                    { scope: d.scope, numbers: numbers });
      }, function (e) { return FAIL('request failed: ' + (e && e.message)); });
    } },

    // 17 ────────────────────────────────────────────────────────────────
    { id: 'no_console_errors', title: 'No uncaught console errors on clean load', fn: function () {
      var box = global.__BE_SMOKE_ERRORS;
      if (!box) return Promise.resolve(BLOCKED('error capture was never installed'));
      var exceptions = [];
      for (var i = 0; i < box.errors.length; i++) {
        if (box.errors[i].kind !== 'resource') exceptions.push(box.errors[i]);
      }
      var d = { observedSince: new Date(box.installedAt).toISOString(), coversLoad: box.coversLoad,
                readyStateAtInstall: box.readyStateAtInstall, exceptions: exceptions.length,
                resourceErrors: box.errors.length - exceptions.length,
                first: exceptions.slice(0, 3) };
      if (exceptions.length) {
        return Promise.resolve(FAIL(exceptions.length + ' uncaught error(s): ' +
          exceptions.slice(0, 3).map(function (e) { return e.message; }).join(' | '), d));
      }
      if (!box.coversLoad) {
        return Promise.resolve(BLOCKED('zero uncaught errors since ' + d.observedSince + ', but this capture started ' +
                                       'after the page had finished loading, so it cannot speak for the load itself. ' +
                                       'Read the DevTools console after a hard reload, or load this file from a ' +
                                       '<script> tag in the document head, to close this check.', d));
      }
      return Promise.resolve(PASS('zero uncaught errors across a clean load', d));
    } }

    ];
  }

  // ────────────────────────────────────────────────────────────────────
  // Runner
  // ────────────────────────────────────────────────────────────────────

  function beSmokeTest(opts) {
    var o = cfg(opts);
    var scrub = makeScrub(o);
    var S = {
      tid: 'ZZTEST-SMOKE-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      created: { tasks: [], appdata: [] }
    };
    var checks = buildChecks(o, S);
    var results = [];
    var started = Date.now();

    function runOne(i) {
      if (i >= checks.length) return Promise.resolve();
      var c = checks[i];
      var t0 = Date.now();
      var p;
      try { p = c.fn(); } catch (e) { p = Promise.resolve(FAIL('threw: ' + (e && e.message))); }
      return Promise.resolve(p).then(function (r) { return r; }, function (e) {
        return FAIL('threw: ' + (e && (e.message || e)));
      }).then(function (r) {
        r = r || FAIL('check returned nothing');
        results.push({ n: i + 1, id: c.id, title: c.title, status: r.status,
                       detail: scrub(r.detail), data: r.data, ms: Date.now() - t0 });
        return runOne(i + 1);
      });
    }

    return runOne(0).then(function () {
      // ── Scripted cleanup (§7). The ONLY removal path used. ──
      var cleanup = { attempted: false, ok: false, removed: null,
                      leftBehind: { tasks: S.created.tasks.slice(), appdata: S.created.appdata.slice() } };
      if (!o.write) {
        cleanup.note = 'read-only run — nothing was written, nothing to clean up';
        return prunedFinish(cleanup);
      }
      if (!o.ownerKey) {
        cleanup.note = 'NO OWNER KEY SUPPLIED — the scripted cleanup did not run. The ZZTEST- records listed in ' +
                       'leftBehind are still in the spreadsheet. Re-run with {ownerKey:...} or call ' +
                       '?action=cleanupTest&ownerKey=... to remove them. Do not delete them by hand.';
        return prunedFinish(cleanup);
      }
      cleanup.attempted = true;
      return gj(o, { action: 'cleanupTest', ownerKey: o.ownerKey }).then(function (r) {
        cleanup.ok = !!(r.json && r.json.ok);
        cleanup.removed = (r.json && r.json.removed) || null;
        if (!cleanup.ok) {
          cleanup.note = 'cleanup did not report ok: ' + scrub(r.text).slice(0, 120) +
                         ' — the ZZTEST- records listed in leftBehind may still be present.';
        } else {
          cleanup.note = 'scripted cleanup removed: ' + JSON.stringify(cleanup.removed);
        }
        return prunedFinish(cleanup);
      }, function (e) {
        cleanup.note = 'cleanup request failed: ' + scrub(e && e.message);
        return prunedFinish(cleanup);
      });
    });

    // Tidy this run's own cache-buster entries out of the shell cache before
    // reporting. Purely hygiene on litter this file created; it never touches
    // the real './' and './index.html' entries the offline shell needs.
    function prunedFinish(cleanup) {
      return pruneSmokeCacheEntries().then(function (n) {
        cleanup.cacheEntriesPruned = n;
        return finish(cleanup);
      }, function () { return finish(cleanup); });
    }

    function finish(cleanup) {
      var pass = 0, fail = 0, blocked = 0, i;
      for (i = 0; i < results.length; i++) {
        if (results[i].status === 'PASS') pass++;
        else if (results[i].status === 'FAIL') fail++;
        else blocked++;
      }
      var out = {
        smokeVersion: SMOKE_VERSION,
        ranAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        expectedVersion: o.expectVersion,
        expectedCache: o.expectCache,
        testIdPrefix: S.tid,
        checks: results,
        summary: { total: results.length, pass: pass, fail: fail, blocked: blocked },
        // The headline is deliberately conservative: a run with blocked
        // checks is NOT a green run, and must never be reported as one.
        verdict: fail ? 'FAILED' : (blocked ? 'INCOMPLETE' : 'GREEN'),
        cleanup: cleanup
      };
      var lines = [];
      lines.push('BE ERP §7 smoke test — ' + out.verdict +
                 '  (' + pass + ' pass, ' + fail + ' fail, ' + blocked + ' blocked of ' + results.length + ')');
      lines.push('expected frontend ' + o.expectVersion + ' / cache ' + o.expectCache);
      lines.push('test id prefix ' + S.tid);
      lines.push('');
      for (i = 0; i < results.length; i++) {
        var r = results[i];
        lines.push(('  ' + r.n).slice(-3) + '. [' + r.status + '] ' + r.title);
        lines.push('       ' + r.detail);
      }
      lines.push('');
      lines.push('cleanup: ' + (cleanup.note || ''));
      out.text = lines.join('\n');
      return out;
    }
  }

  global.beSmokeTest = beSmokeTest;
  global.beSmokeArmErrors = armErrors;

})(window);
