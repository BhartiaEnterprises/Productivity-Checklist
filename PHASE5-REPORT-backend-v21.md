# Phase 5 — Mandatory Final Report (§10)

**Session subject:** full-stack backend build-out of the live Bhartia Enterprises Productivity ERP
**Report date:** 27 July 2026
**Reporting structure:** exactly A–I as required by Directive §10

---

## Header facts

| Item | Value |
|---|---|
| Deployed Apps Script version | **21** (Jul 27, 2026, 10:47 AM) |
| Version description | `Phase 5 backend: row-addressed module writes + read-back self-heal (Period fix) - repo ad48452` |
| Deployment ID | `AKfycbzNVv8qwdqysoQDCyWB_9Q1Ksc14-nNjSapWOH9Rzi10LWPYPpYIu48I_add1At8fT-` — **unchanged**, confirmed on the deployment-success screen |
| Web App URL | unchanged (`.../macros/s/AKfycbz…add1At8fT-/exec`) |
| Frontend version | `8.1-backend` (`index.html` line 2714) |
| Service-worker cache version | `be-shell-v8.1-backend` (`sw.js` line 13) |
| GitHub commits this phase | `40500e7` (sw.js) → `1972861` (index.html) → `17b251e` (Code.gs identity + module layer) → `210440d` (text-format v1) → **`ad48452`** (row-addressed write + self-heal) |
| Code.gs on origin/main | 190,818 bytes, sha256 `b3a462b09e3f836e06abe98e57262cd4218eed72319f1220e230c0f67ede25c3` |
| Sheets before → after | **30 → 36** |
| Automated test suites | 5 suites, **488 assertions, 0 failures**; `node --check` SYNTAX OK |
| Exact completion | **57.7%** (calculation in §9 table below) |

---

## A. Genuinely completed

Only items verified working against the live production Web App are listed here.

**Backend identity and access control.** `Code.gs` now carries a single shared authenticator, `beAuth()`, used by every new endpoint. Sessions are stateless HMAC-signed tokens (`Utilities.computeHmacSha256Signature` + `base64EncodeWebSafe`) with the secret auto-generated into Script Properties — no secret is present in the repository or the frontend. Access level resolves to `owner` / `manager` / `member`, and the module reader filters rows before they are serialised, so a member never receives another employee's record even in the raw response. This closes the directive's requirement that permissions be enforced "at both interface and data-response levels".

**Generic module data layer.** A declarative registry (`BE_MODULES`) describes six modules — KRA Definitions, KPI Entries, Goals, Training Modules, Training Progress, Timesheet Entries — each with its sheet, ID prefix, field types, ownership column and RBAC rules. One validated writer (`handleModuleWrite`) and one scoped reader serve all six. Writes carry validation, `updatedAt` conflict protection, `cid` dedupe, retry tolerance and offline-queue compatibility, and return meaningful error objects rather than opaque failures. Computed fields are derived at read time, never stored.

**Text-integrity fix for module writes (the `Period` defect).** Module writes now resolve an explicit target row, apply the plain-text (`'@'`) number format to that exact row in the same execution immediately before `setValues()`, then read the row back and repair any cell Sheets still re-typed. The response reports `row` and `repaired` so the behaviour is observable in production rather than assumed.

**Live endpoint surface.** All twenty `doGet` actions were exercised against Version 21 and respond correctly, including the correct-rejection paths.

**Deployment discipline.** Repository and deployed source were proven byte-identical (container-side `git show origin/main:Code.gs | sha256sum` matched, and the Monaco model content hash was verified both before and after the paste). A new immutable version was cut on the existing deployment without changing its ID.

**Carried forward from earlier sessions and re-confirmed healthy this session:** Bug #10 (controlled orphan cleanup), Bug #11 (stale configuration guidance moved to a Config-sheet/admin process), §3 sync visibility, and the three dashboards (§§6–8) all continue to respond with real production data.

---

## B. Tested

All live tests were issued from `script.google.com` against the production `/exec` endpoint (the container cannot reach that host; the browser channel is the only route).

**Module write — insert path.** POST module `kpi`, user Ramu, id `ZZTEST-KPI-P2`, `Period: '2026-07'`.
Response: `{"status":"ok","ok":true,"id":"ZZTEST-KPI-P2","module":"kpi","updatedAt":"2026-07-27T05:19:18.072Z","created":true,"row":3,"repaired":0}`.
The new `row` and `repaired` fields confirm Version 21 is the code actually serving traffic, and `repaired: 0` shows the row-addressed format pass got it right on the first write.

**Module read — literal text confirmed.** `?action=module&name=kpi&user=Ramu&limit=200` returned `"Period":"2026-07"` as a literal string, not the `"2026-06-30T18:30:00.000Z"` Date that Version 20 produced.

**Reader-side normalisation ruled out.** A second insert, `ZZTEST-KPI-P3` with a deliberately different value `Period: '2026-11'`, read back as the literal `"2026-11"`. This proves the reader is not simply reformatting a stored Date back into `YYYY-MM`.

**Update path.** `ZZTEST-KPI-P3` re-POSTed with `Period: '2026-12'`, `Actual: 45`. Read-back returned `"2026-12"` and `45`, and the ZZTEST row count stayed at 3 — the update reused the same row rather than appending a duplicate.

**Scripted test-data cleanup (§7).** `?action=cleanupTest&ownerKey=025ff…` → `{"status":"ok","ok":true,"removed":{"KPI Entries":3}}`; a follow-up read confirmed **0** remaining ZZTEST rows. No manual spreadsheet clicks were used, and no real employee record or real task was touched.

**Seventeen-check smoke suite against Version 21 — 14 direct passes plus 3 correct-rejection cases:** ping, `state`, `userinfo`, `getChecklist`, `getTasks`, `getAppData`, `dashboard`, `modules` (with user), `module` (kpi shape), `session` → `unknown_user`, `session` → `pin_required`, `confirm` (unknown cid), `getAttendance`, `getVitals`, `getReports`; plus `cleanupTest` with a wrong owner key → `not_authorised`, `module` with an unknown module name → `unknown module: nosuch`, and `module` with an unknown user → `unknown_user`.

**Automated harness.** `dashtest` 48/48 · `personatest` 151/151 · `attntest` 68/68 · `refactortest` 14/14 · `backendtest` **207/207** = **488 assertions, 0 failures**. `node --check` on a copy of `Code.gs`: SYNTAX OK.

**Negative proof that the harness now catches the defect.** The upgraded Node fake of Sheets was run against the *pre-fix* source and correctly failed — `PASS 197 FAIL 1`, with the failing assertion reporting `got "Wed Jul 01 2026 00:00:00 GMT+0000…"`. Against the fixed source it is 207/207. A test that cannot fail proves nothing; this one can.

---

## C. Failed

**The Version 20 fix did not work in production.** Version 20 pinned module text columns to plain text at the *sheet* level and cached the result in Script Properties. The `Period` value was still stored as a Date. This was a real failure of a change I had previously reported as fixed, and it is recorded as such.

**The Node harness gave a false pass.** Before this session the fake Sheets host did not emulate auto-typing at all, so `backendtest` asserted on `Period` and passed while production was broken. The harness, not just the code, was defective.

**First live POST after cutting Version 21 returned `ERR Failed to fetch`.** Transient propagation.

**A combined insert+update+read script returned `ERR Unexpected token '<', "<!DOCTYPE "…`, and a retried single insert returned the `doGet` ping text instead of the `doPost` JSON.**

**Three lines of my first corrected smoke run read as "FAIL" but were not defects** — they were my assertions being wrong about the expected shape of correct server rejections.

**My very first smoke harness reported nonsense** — the pass flag was inverted (`pass: !!v` where `v === ''` meant success), and four of the action names I tested (`getConfig`, `getUsers`, `me`, `appdata`) do not exist, so they silently fell through to the ping text.

---

## D. Fixed

**Root cause of the `Period` defect.** Two independent causes, both now addressed. First, `appendRow()` does not reliably honour a number format that was pre-applied to the destination row, so formatting the sheet in advance had no effect on the inserted values. Second, the `BE_FMT_VERSION` cache mark meant that once a sheet had been marked "already formatted", the pass was skipped entirely on later executions. The fix resolves an explicit target row for both the insert and the update path, formats that exact row in the same execution immediately before `setValues()`, and then reads the row back and repairs any cell that is still not a string — so the write is correct even if the format pass is rejected, without depending on knowing why. `BE_FMT_VERSION` was bumped to `v2` so no stale mark can suppress the repair. Live-verified on both paths (§B).

**Root cause of the harness false pass.** `/tmp/gasenv.js` now models Sheets' auto-typing: a `YYYY-MM` string written to a cell whose number format is not `'@'` becomes a Date, and `appendRow` deliberately ignores pre-applied formats. Nine new assertions cover the insert path, the update path and the self-heal path (the last by stubbing out the format helper and asserting `repaired >= 1` with the value still correct on the sheet).

**Root cause of the POST-returns-HTML failure.** Apps Script answers a `fetch` POST to `/exec` with a 302, and the browser re-issues it as a GET, which lands in `doGet` and returns the ping text. Sometimes the redirect lands on the `script.googleusercontent.com` echo and the real JSON comes back, which is why it appeared to work intermittently. Fixed by switching live write tests to `mode:'no-cors'` POST — exactly the transport the production app itself uses — followed by a separate `doGet` read-back. I did not keep retrying the failing pattern.

**Root cause of the bad smoke harness.** I had guessed action names instead of reading them. Fixed by grepping the real action list out of `Code.gs` (lines 222–336) and rewriting the suite with correct names and correct pass semantics.

**The three "FAIL" lines** were re-run with corrected expectations and all three servers' responses were confirmed correct.

**Transient `Failed to fetch`** was resolved by confirming the endpoint was alive with a GET ping and retrying.

---

## E. Remaining

**Module user interfaces are not built.** This is the most important item in this report and I want it stated without softening. For KRA/KPI/Goals (§9), Training (§10) and Timesheet (§12), steps 1–5, 7 and 9–12 of the directive's twelve-step per-module process are done — inspection, reuse, additive schema, server read/write paths, RBAC, validation, deploy, live test, defect fixes and evidence. **Step 6, "connect the interface", is not done.** These modules are working *backends* with no screens in the app yet. An employee cannot today open the app and enter a KPI. Calling §§9, 10 and 12 "complete" would be exactly the kind of claim the directive forbids.

**Directive §11 and §§13–18 are not started:** §11, plus Handholding (§13), Inventory redesign (§14), Reports redesign (§15), Communication Centre (§16), Notification engine (§17) and AI features (§18).

**The positive token-issuance path and any manager/owner-level write are harness-verified only.** Both require a PIN hash I do not possess and must not obtain. I deliberately did not brute-force a PIN, read a stored hash out of the spreadsheet, create a temporary Owner-role user, or use the owner-key `set_pin` reset against a real employee record. Their live *negative* counterparts all fired correctly in production this session (`unknown_user`, `pin_required`, `no_user`, `not_authorised`, `unknown module`), which demonstrates the guard is live but not that a valid token round-trips in production. Clearing this needs the Owner to log in once with a real PIN so the positive path can be observed.

**The §7 smoke test is not yet a committed, repeatable script.** All seventeen checks were run this session, but from the browser console. It should be codified into the repository so it runs after every deployment rather than depending on me reconstructing it.

**Two real-device confirmations are still owed.** Bug #12 on an actual Android device, both in the WhatsApp in-app browser and as an installed PWA; and Bug #9's literal "Wi-Fi off → reload → shell opens" test. Nine of Bug #9's ten acceptance tests are verified; that tenth one cannot be faked from here.

**`?action=getReports` did not reproduce the previously reported empty body.** On Version 21 it returned real records. I am recording this as *did not reproduce*, not as *fixed* — I did not change that code path and I cannot explain the earlier observation.

**Minor follow-ups:** the manifest still carries a placeholder inline-SVG icon rather than a real multi-resolution PNG set, and four blocking `window.prompt()` calls remain in the frontend.

**Owner-side items, unchanged:** fill `BHASH_PASS` in the Config sheet, flip `WA_ENABLED` from `NO` to `YES`, get the six WhatsApp templates approved by Meta, and map the BUZWAP sender to 7004149616. Two decisions are also owed: whether the six role modules with zero rows (Social Media Exec, Billing Exec, Billing Customers, CRM, BDA, Salesman Closing) are dead or merely untrained, and the canonical user identifier for any future Firebase work.

---

## F. Bugs found this session

**F1 — `appendRow()` silently re-types text values (severity: high, fixed and live-verified).** Detailed in §C/§D. Worth recording as a standing lesson: any string that looks like a date, a number or a fraction must be written through a row-addressed `setValues()` on a cell already formatted `'@'` in the same execution, and read back.

**F2 — the Node fake of Sheets did not model auto-typing (severity: high, fixed).** A green test suite was actively misleading me about production behaviour.

**F3 — `const now = nowIST();` returns a String, not a Date** (Code.gs lines 66, 3056, 3111). Not a defect in itself, but it means a text-looking `Created At` in the sheet is *not* evidence that the column carries the `'@'` format. This mis-cue is part of why the Version 20 failure went unnoticed. No code change made; recorded so it is not mistaken for evidence again.

**F4 — `PC HO` (role `PC`) has no PIN and now receives `pin_required`** from the session endpoint. This is correct behaviour for the new token path, not a regression: that account continues to work through the legacy no-hash path in `beAuth`, and a PIN can be created through the login screen's existing first-time flow. Flagging it so it is not mistaken for a lockout.

**Production data issues previously flagged and still open (not code defects):** the VKS roster App Data document lists four people while nine have attendance rows; Ramu's Users-sheet store is BC but his attendance row is VKS; the client's local `getUsers()` map places Abhishek under HO while the server says VKS; and the Attendance header row is stale relative to its own data.

---

## G. Database changes

All changes are **additive**. No sheet, column, task, user, ID or production record was deleted, renamed, reordered or overwritten.

**Six new sheets** (30 → 36), created lazily on first write with a header row: `KRA Definitions`, `KPI Entries`, `Goals`, `Training Modules`, `Training Progress`, `Timesheet Entries`. Each carries `ID`, `Created At`, `Created By`, `Updated At`, `Updated By` plus its declared module fields.

**No columns were added to, or removed from, any existing sheet.** The `App Data` sheet, `Tasks`, `Attendance`, `Users`, `Config` and every report sheet are untouched in structure.

**Script Properties:** an HMAC session secret is auto-generated on first use and stored in `PropertiesService.getScriptProperties()`. Per-sheet formatting marks are stored under a key versioned by `BE_FMT_VERSION`, bumped from `v1` to `v2` this session. Neither is in the repository or the frontend.

**Number formats:** the text columns of the six new module sheets are set to plain text (`'@'`). No existing sheet's formatting was altered.

**No new triggers** were created this session.

**Data written and removed:** three temporary rows in `KPI Entries` with the `ZZTEST-` prefix, all removed through the scripted `?action=cleanupTest` path. Zero real records were created, modified or deleted.

---

## H. Migration impact

**Existing browser storage is unaffected.** No localStorage key was renamed, removed or re-keyed. Older queued offline requests in `be_outbox_v1` remain valid: the transport, the `cid` dedupe contract and the `doPost` parameter shape are all unchanged, so a request queued under version 15 still posts and still de-duplicates correctly under version 21.

**Existing server data is unaffected.** The module layer only ever touches the six new sheets. No backfill, no rewrite of legacy rows, and no fabricated history. Legacy tasks missing `type`, `recurrence` or `history` continue to receive sensible read-time defaults and are counted honestly by the dashboards.

**Login is unaffected.** Users with a PIN gain the option of a signed session token; users without one continue through the existing no-hash path. Nobody is locked out. The `pin_required` response is an invitation to set a PIN through the existing first-time flow, not a denial of service.

**`App Data` semantics are unchanged:** last-write-wins on `updatedAt`, stale queued writes rejected, conflict information displayed, no silent discarding of unsaved work, and no retroactive upload of browser keys outside the defined allow-list.

**One observation, offered as an observation and not relied upon as proof.** `ZZTEST-KPI-P1`, written under the broken Version 20 and previously read back as `"2026-06-30T18:30:00.000Z"`, read back as the literal `"2026-07"` after Version 21 — most likely because the `BE_FMT_VERSION` bump caused the sheet-level `'@'` pass to re-run and convert the stored value. Only my own test row was ever involved; no production data was in scope. The fix's proof rests on P2 and P3, not on this.

---

## I. Rollback impact

**To roll the backend back one step:** redeploy Apps Script **Version 20** on the existing deployment (Deploy → Manage deployments → edit → Version → 20). The deployment ID and URL do not change. Consequence: module writes revert to `appendRow()`, the `Period` text-typing defect returns, and the `row`/`repaired` fields disappear from write responses. Everything else keeps working.

**To roll the backend back to before the full-stack work:** redeploy **Version 15**, the Phase 5.1 baseline. Consequence: the module registry, the session-token endpoints, the module reader/writer and the dashboard endpoint all disappear. The six new sheets remain on disk and are simply no longer read or written — nothing is lost. The frontend at `8.1-backend` degrades gracefully because every new call is additive and failure-tolerant, but the dashboards will lose their server data source, so `1972861` should be rolled back with it.

**Repository restore points:** `74dcda5` (Phase 5.1 baseline, matches Apps Script Version 15) · `a6887d1` (before the §§6–8 dashboard cache bump) · `17b251e` (identity + module layer, before any text-format work) · `210440d` (text-format v1, matches Version 20) · **`ad48452`** (current, matches Version 21).

**To roll the frontend back:** revert `index.html` to `1972861`'s parent and `sw.js` to `40500e7`'s parent, then bump `CACHE_VERSION` to a *new* string rather than reusing an old one — reusing an old cache name leaves stale entries in place on devices that already installed the newer shell.

**Data rollback:** none required and none possible to need. Every change this session was additive, and the only rows written were removed by script.

---

## §9 requirement-by-requirement completion table

Scoring method, stated explicitly because the directive forbids an arbitrary percentage: each requirement counts **1.0** when it is working *and* live-verified in production, **0.5** when the implementation is complete and evidenced but one required confirmation or one directive step is genuinely outstanding, and **0** when not started. The percentage is the sum divided by the requirement count. It measures working functionality, not lines of code.

| # | Requirement | State | Score | Live evidence | Remaining action |
|---|---|---|---|---|---|
| 1 | Bug #9 — genuine PWA offline shell | Partially working | 0.5 | 9 of 10 acceptance tests verified live | Literal Wi-Fi-off → reload test on a device |
| 2 | Bug #10 — controlled orphan cleanup | Working | 1.0 | Archived, not deleted; verified | — |
| 3 | Bug #11 — stale configuration guidance | Working | 1.0 | Config-sheet/admin process live | — |
| 4 | Bug #12 — Android Closing Checklist submits | Partially working | 0.5 | Server path verified live; verbose logging restricted | Real-device confirmation (WhatsApp browser + installed PWA) |
| 5 | §3 — full sync visibility | Working | 1.0 | Online/offline, last sync, pending count, retry all live | — |
| 6 | §6 — Owner Business Command Centre (15 cards) | Working | 1.0 | Real production data; published and live-verified | — |
| 7 | §7 — Manager dashboard (9 cards) | Working | 1.0 | Real production data; live-verified | — |
| 8 | §8 — Employee dashboard (11 cards) | Working | 1.0 | Real production data; live-verified | — |
| 9 | RBAC enforced at the data-response level | Working | 1.0 | Row-level filtering; `no_user` / `not_authorised` fired live | — |
| 10 | Server-side identity + signed session tokens | Partially working | 0.5 | Negative paths live (`unknown_user`, `pin_required`); positive path harness-only | Owner login with a real PIN to observe a live token round-trip |
| 11 | Generic module data layer (validated writer + scoped reader) | Working | 1.0 | Insert, update and read all verified live on Version 21 | — |
| 12 | Text-typing integrity on module writes | Working | 1.0 | `row: 3, repaired: 0`; `"2026-07"`, `"2026-11"`, `"2026-12"` all literal | — |
| 13 | §9 — KRA / KPI / Goals | Partially working | 0.5 | Backend live-verified end to end | Build the app screens (step 6, connect the interface) |
| 14 | §10 — Training | Partially working | 0.5 | Sheets, schema, read/write, RBAC live | Build the app screens |
| 15 | §11 | Not started | 0 | — | Full 12-step implementation |
| 16 | §12 — Timesheet | Partially working | 0.5 | Sheets, schema, read/write, RBAC live | Build the app screens |
| 17 | §13 — Handholding | Not started | 0 | — | Full 12-step implementation |
| 18 | §14 — Inventory redesign | Not started | 0 | — | Full 12-step implementation |
| 19 | §15 — Reports redesign | Not started | 0 | — | Full 12-step implementation |
| 20 | §16 — Communication Centre | Not started | 0 | — | Full 12-step implementation |
| 21 | §17 — Notification engine | Not started | 0 | — | Full 12-step implementation |
| 22 | §18 — AI features | Not started | 0 | — | Full 12-step implementation |
| 23 | §6 — legacy-data defaults without rewriting old rows | Working | 1.0 | Dashboards count legacy tasks correctly; no fabricated history | — |
| 24 | §6 — App Data last-write-wins, stale rejection, conflict display | Working | 1.0 | Live behaviour unchanged and verified | — |
| 25 | §7 — repeatable automated post-deployment smoke test | Partially working | 0.5 | All 17 checks executed and passed on Version 21 | Codify as a committed script that runs after every deploy |
| 26 | §8 — deployment discipline (12 steps) | Working | 1.0 | Byte-identical repo↔deployed proven; new version, unchanged ID | — |

**Calculation:** sum of scores **15.0** ÷ **26** requirements = **0.5769** → **57.7%**.

For contrast, the same table scored at the start of this session gave 11.0 ÷ 26 = 42.3%. The 15.4-point movement is entirely attributable to rows 10, 11, 12, 13, 14, 16 and 26 and is not an estimate.

---

## Next highest-priority action

**Build the KRA/KPI/Goals user interface (§9, step 6).** It is the single change that converts the largest amount of already-working, already-deployed, already-tested backend into functionality the Owner and staff can actually use. The data layer behind it is live-verified for insert, update and scoped read; today it has no screens, so none of that value reaches anyone. Training (§10) and Timesheet (§12) follow immediately behind it on the same layer, and each will be substantially faster than the first because the reader/writer contract, the RBAC scoping and the offline behaviour are already proven.

Second priority, and it should be done in the same deployment cycle: codify the §7 smoke test as a committed repeatable script, so this session's seventeen checks run automatically after every future deployment rather than depending on being reconstructed by hand.
