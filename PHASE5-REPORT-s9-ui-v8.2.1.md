# Phase 5 — §9 Performance (KRA / KPI / Goals) interface
## Mandatory final report (directive §10) — deployment cycle `8.2.1-phase5-kpi`

Date: 27 July 2026
Scope of this cycle: **frontend only.** No Apps Script source, no sheet, no column
and no production record was changed. The backend that this interface talks to was
deployed and reported separately as Apps Script **Version 21**.

---

## A. Genuinely completed

**The §9 Performance interface is live in the production app.** The directive's
12-step per-module process is complete for the interface layer of §9:

The generic module data layer (`beModSpec`, `beModRegistry`, `beModCacheLoad`,
`beModCacheSave`, `beModFetch`, `beModValidate`, `beModSave`, `beModVerify`,
`beModNorm`, `beModRowMatches`, `beModDiff`) reads the module registry from the
server rather than hard-coding field lists, caches per-user with a 45-second
freshness window, times out at 20 seconds, falls back to the last cached rows for
the *same* user only, and returns one of four honest outcomes from a write —
`confirmed`, `queued`, `unconfirmed`, `conflict`. It never reports `confirmed`
from the fact that a request was sent; `beModVerify` re-reads the module and
compares the stored row field-by-field against what was submitted, because
`logCid` fires for module writes even when the write itself is rejected, so
`?action=confirm&cid=` is not evidence a row was accepted.

The Performance screens (`renderPerformance`, `perfSetSeg`, `perfSegButtons`,
`perfRenderStatus`, `perfRenderList`, `perfCard`, `perfRenderForm`, `perfField`,
`perfSave`, `perfRenderConflict`, `perfConflictKeepServer`, `perfConflictRetry`
and their helpers) present three segments — KPI, Goals, KRA — inside a new
`performance` sub-tab. Every displayed number comes from a server row or from a
field the user typed; there are no sample statistics, no placeholder buttons and
no "coming soon" pages. Achievement % and Progress % are shown as the server
derives them, not recomputed client-side.

Role scope is applied at the interface (`applyProdSubTabScope` gates the sub-tab
for all 11 roles) **and** independently at the data-response level by the server's
RBAC-scoped reader — hiding the tab is not what protects the data, and this was
confirmed live: an identity the server does not recognise is refused at the
endpoint, not merely hidden in the UI.

Backward compatibility is preserved: the new code adds keys
(`be_modreg_v1`, `be_modcache_v1_*`) and reads nothing it did not write. The
existing offline outbox `be_outbox_v1`, session key, PIN cache and every prior
localStorage key are untouched.

**The service worker offline shell was re-versioned correctly.**
`CACHE_VERSION` is `be-shell-v8.2.1-phase5-kpi`, matching `APP_VERSION`
`8.2.1-phase5-kpi`, so `activate()` deleted the older cache instead of
accumulating it — verified live below.

---

## B. Tested

### Offline test harness — 650 assertions, 0 failures

| Harness | Result |
|---|---|
| `dashtest.js` | 48 passed, 0 failed |
| `personatest.js` | 151 passed, 0 failed |
| `attntest.js` | 68 passed, 0 failed |
| `refactortest.js` | 14 passed, 0 failed |
| `backendtest.js` | 207 passed, 0 failed |
| `perftest.js` | **162 passed, 0 failed** (was 157; 5 new) |
| **Total** | **650 passed, 0 failed** |

Syntax: both inline `<script>` blocks of `index.html` and `sw.js` pass
`node --check`.

### Live tests against the production Web App

Deployment ID `AKfycbzNVv8qwdqysoQDCyWB…_add1At8fT-` — **unchanged.**
All requests issued from the deployed GitHub Pages origin, i.e. the real
production frontend origin, not a local harness.

| # | Test | Result |
|---|---|---|
| 1 | GitHub Pages serves the committed `index.html` | HTTP 200, 617,032 UTF-16 units, djb2 `3396418577` — byte-identical to the repo copy |
| 2 | GitHub Pages serves the committed `sw.js` | HTTP 200, 3,678 units, djb2 `3262663023` — byte-identical |
| 3 | Frontend version served | `APP_VERSION = 8.2.1-phase5-kpi` |
| 4 | Service-worker cache name served | `be-shell-v8.2.1-phase5-kpi` |
| 5 | Live runtime after SW update + reload | `APP_VERSION 8.2.1-phase5-kpi`, service worker controlling |
| 6 | Old caches deleted by `activate()` | `caches.keys()` = **exactly** `["be-shell-v8.2.1-phase5-kpi"]` |
| 7 | All 15 §9 functions present at runtime | 0 missing |
| 8 | All 7 §9 DOM nodes present at runtime | 0 missing |
| 9 | `?action=state` | `{"status":"ok"…}` |
| 10 | `?action=module&name=kpi` (no user) | `{"status":"error","reason":"no_user"}` |
| 11 | `?action=module&name=notamodule` | `{"status":"error","message":"unknown module: notamodule"}` |
| 12 | `?action=module&name=kpi` as unknown identity | `{"status":"error","reason":"unknown_user"}` |
| 13 | `?action=modules` as unknown identity | `{"status":"error","reason":"unknown_user"}` |
| 14 | `?action=module&name=kpi` as real user `PC HO` (no stored PIN) | `{"status":"error","reason":"pin_required"}` |
| 15 | End-to-end client exercise, identity `ZZTEST-LIVE-CHECK`, **read-only, zero writes** | no exception, no console errors, correct Hindi refusal in the status line, working Refresh control, **no 64-hex hash anywhere in the DOM** |

Test 14 settles a question left open in the previous cycle: `beAuth` requires a
PIN for module reads even on the legacy no-hash path, so there is no route to a
positive authenticated module read without a real PIN.

Test 15 used a clearly-prefixed temporary identity that does not exist in the
Users sheet, performed no writes, and modified no employee record or task.

---

## C. Failed

**One production defect was found by live testing, and it was found only because
the interface was exercised against the real Web App rather than in a harness.**

`perfRenderList` rendered *"अभी तक कोई रिकॉर्ड नहीं — नीचे/ऊपर फ़ॉर्म से पहला जोड़ें।"*
("No records yet — add the first one") whenever the item list was empty — **including
when the server had refused the read.** That asserts a fact to the user (the server
holds zero rows) that was never established. A staff member seeing it would have
concluded their KPIs were missing, and an owner would have concluded no one had
recorded anything. This is exactly the class of claim the directive forbids.

Nothing else failed. No other console error, exception, layout break or leaked
credential was observed.

---

## D. Fixed

`perfRenderList` now distinguishes three genuinely different states:

- read refused or failed, no cached rows → *"Could not load the list — see the reason above, then press Refresh."* / *"सूची लोड नहीं हो पाई — ऊपर दिया कारण देखें, फिर ↻ ताज़ा करें दबाएँ।"*
- read succeeded and returned nothing → *"No records yet — add the first one using the form above."*
- read failed but cached rows exist → the cached rows are still shown, with the failure stated in the status line

Five regression assertions were added as section M of `perftest.js`, and they test
the shipped file, not a copy: refused reads must not claim emptiness, timed-out
reads must not claim emptiness, a genuinely empty list must still say so plainly,
and cached rows must survive a failed refresh.

**The fix was then re-verified live.** Repeating test 15 against the deployed
8.2.1 build now returns
`listText = "सूची लोड नहीं हो पाई — ऊपर दिया कारण देखें, फिर ↻ ताज़ा करें दबाएँ।"`.
The wrong sentence is gone from production.

---

## E. Remaining

**Owed on §9 itself — stated plainly rather than glossed:**

The **authenticated read path and every write path remain unverified against the
live Web App.** Both require a real PIN hash. I do not have one and deliberately
did not obtain one: I did not brute-force a PIN, did not read a stored hash out of
the spreadsheet, did not create a temporary Owner-role user, and did not use the
owner-key `set_pin` reset against a real employee record. Closing this needs the
Owner to log in once, open Productivity → Performance, and save one KPI row. Until
that happens §9 is *working as far as it can be proven*, not proven end-to-end.

The three module sheets (`KRA Definitions`, `KPI Entries`, `Goals`) are created by
the server on first write. Because no authenticated write has occurred, I am not
claiming they exist yet.

**Owed elsewhere:**

- §7's 17-check automated post-deployment smoke test is not yet a committed, repeatable script.
- Bug #9's literal "Wi-Fi off → reload → shell opens" test on a real device.
- Bug #12's confirmation on a real Android device, in the WhatsApp in-app browser and as an installed PWA.
- §10 Training and §12 Timesheet have working backends and no interface.
- §11 and §§13–18 (Handholding, Inventory redesign, Reports redesign, Communication Centre, Notification engine, AI features) are not started.
- Four blocking `window.prompt()` calls, and the placeholder inline-SVG manifest icon.

**Owner-side, outside the code:** fill `BHASH_PASS` in the Config sheet, flip
`WA_ENABLED` to `YES`, get the six WhatsApp templates approved by Meta, map the
BUZWAP sender to 7004149616. Decide whether the six zero-row role modules (Social
Media Exec, Billing Exec, Billing Customers, CRM, BDA, Salesman Closing) are dead
or simply untrained.

---

## F. Bugs found this session

1. **Refused module read presented as an empty list** (§C above). Severity: high —
   it stated a false fact about business data. Found live. Fixed, regression-guarded,
   redeployed and re-verified live.

Production **data** issues, previously flagged, still open — these are not code
defects and I have not "corrected" them, because doing so would mean editing real
records on an assumption:

- The VKS roster App Data document lists 4 people while 9 have attendance rows.
- Ramu's store is `BC` in the Users sheet but `VKS` on his attendance row.
- Abhishek is `HO` in the client's local user map and `VKS` on the server.
- The Attendance header row is stale relative to its own data (already handled in code by reading headers from the live sheet).
- `PC HO` has role `PC` and no PIN, and now correctly receives `pin_required` until a PIN is created through the login screen's first-time flow.

---

## G. Database changes

**None.** No sheet was created, renamed, deleted, re-ordered or re-typed this
cycle. No column was added or removed. No row was written, edited or deleted. No ID
was reset. The only persistent state introduced is in the browser: two new
localStorage key families, `be_modreg_v1` and `be_modcache_v1_*`, both
additive and both safely absent on first run.

Sheets before this cycle = sheets after this cycle.

---

## H. Migration impact

**None.** There is nothing to migrate. Existing browser storage is read
unchanged; a client that has never seen 8.2 simply finds the two new keys absent
and fetches fresh. Queued offline requests in `be_outbox_v1` are untouched by this
change and continue to drain through the unchanged `sendToSheets()` → `doPost`
path. A user still running the previous shell gets the new one on their following
load, because the service worker serves cache-first with a background refresh.

---

## I. Rollback impact

Reverting `index.html` and `sw.js` to commit `1ccd0a9` restores the previous
working build with **no data consequences whatsoever** — no schema was changed, so
there is nothing to unwind. The only user-visible effect of a rollback would be the
return of the "No records yet" defect, which is a reason not to roll back rather
than a risk of rolling back. The Apps Script deployment is not involved: rolling
the frontend back does not require touching Version 21 or the deployment ID.

---

## Deployment record

| Item | Value |
|---|---|
| Deployed Apps Script version | **21** (unchanged this cycle) |
| Apps Script deployment ID | `AKfycbzNVv8qwdqysoQDCyWB_9Q1Ksc14-nNjSapWOH9Rzi10LWPYPpYIu48I_add1At8fT-` — **confirmed unchanged** |
| Web App URL | unchanged |
| Frontend version | `8.2.1-phase5-kpi` |
| Service-worker cache version | `be-shell-v8.2.1-phase5-kpi` (live `caches.keys()` holds this and nothing else) |
| GitHub commit — §9 interface | `1ccd0a9` |
| GitHub commit — honesty fix | `1cdcc6d` |
| GitHub commit — SW cache bump | `aa1ade6` |
| Repo vs deployed source | `index.html` sha256 `0b91a5ed…5a6bee2`, `sw.js` sha256 `ed8a05bd…7b4f978` — identical in the repo, in the working tree and as served by GitHub Pages |
| Sheets before → after | unchanged |

---

## Completion

Scored requirement by requirement from the directive, not by volume of source
written. Working = 1.0, partially working = as stated, not started = 0.

| # | Requirement | State | Score |
|---|---|---|---|
| 1 | Bug #9 — genuine PWA offline shell | working (9 of 10 acceptance tests verified; 1 is a physical-device observation) | 1.0 |
| 2 | Bug #10 — controlled orphan cleanup | working | 1.0 |
| 3 | Bug #11 — stale configuration guidance | working | 1.0 |
| 4 | §3 — sync visibility | working | 1.0 |
| 5 | §6 — Owner Business Command Centre (15 cards) | working | 1.0 |
| 6 | §7 — Manager dashboard (9 cards) | working | 1.0 |
| 7 | §8 — Employee dashboard (11 cards) | working | 1.0 |
| 8 | §9 — KRA / KPI / Goals | **partially working** — backend live, interface live, read-refusal paths live-verified; authenticated read and all writes unverified live (steps 1–9, 11, 12 complete; step 10 partial) | 0.75 |
| 9 | §10 — Training | partially working — backend only, no interface | 0.5 |
| 10 | §11 | not started | 0 |
| 11 | §12 — Timesheet | partially working — backend only, no interface | 0.5 |
| 12 | §13 — Handholding | not started | 0 |
| 13 | §14 — Inventory redesign | not started | 0 |
| 14 | §15 — Reports redesign | not started | 0 |
| 15 | §16 — Communication Centre | not started | 0 |
| 16 | §17 — Notification engine | not started | 0 |
| 17 | §18 — AI features | not started | 0 |
| 18 | §6 — adoption / backward-data rules | working | 1.0 |
| 19 | §7 — automated 17-check smoke test as a repeatable script | not started | 0 |
| 20 | §8 — deployment discipline | working | 1.0 |
| 21 | Bug #12 — Android closing checklist | working (real-device confirmation outstanding) | 1.0 |

**Calculation:** 10 requirements at 1.0 = 10.0; §9 at 0.75; §10 and §12 at 0.5 each
= 1.0. Total 11.75 of 21 requirements.

**11.75 ÷ 21 = 55.95% → 56.0% complete.**

This is functionality that has been demonstrated, not source code that has been
written. Items 9, 11 and 19 are the cheapest remaining gains.

---

## Next highest-priority action

**Codify the §7 post-deployment smoke test as a committed, repeatable script**
covering all 17 checks, using only `ZZTEST-`-prefixed temporary IDs and the
existing scripted `beCleanupTestRecords` path for teardown — never manual
spreadsheet edits. It is the last piece of §8's "run the full smoke test against
production" that is currently performed by hand, and every subsequent module
(§10 and §12 interfaces next) will need it.

**In parallel, one action is needed from the Owner and only the Owner:** log in
once with a real PIN, open Productivity → Performance, and save a single KPI row.
That single action closes the authenticated read and write verification for §9 and
would move item 8 from 0.75 to 1.0.
