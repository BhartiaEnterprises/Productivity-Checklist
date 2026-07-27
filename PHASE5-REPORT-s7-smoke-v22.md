# Phase 5 — §10 Mandatory Final Report
## Cycle: §7 automated post-deployment smoke test

**Apps Script deployed version:** 22
**Frontend version:** 8.2.1-phase5-kpi
**Deployment ID:** `AKfycbzNVv8qwdqysoQDCyWB_9Q1Ksc14-nNjSapWOH9Rzi10LWPYPpYIu48I_add1At8fT-` — **UNCHANGED** (verified in the Manage-deployments dialog before the edit and again in the success panel)
**GitHub commits this cycle:** `7aa8bd7` (smoke-test.js v1.0.0), `2d81979` (Code.gs — scripted cleanup extended)
**Service-worker cache version:** `be-shell-v8.2.1-phase5-kpi`
**Report date:** 27 July 2026

---

## A. Genuinely completed

§7 of the directive asks for "a repeatable smoke-test routine that runs after every
deployment" verifying seventeen named conditions. That routine now exists as
`smoke-test.js`, committed to the repository, served from the production origin, and
run twice against the live Web App.

`smoke-test.js` (52,011 bytes, 47,973 UTF-16 code units, sha256
`088b8f912703f47b0b955569b76f650d3f6f3cf440ab30ca016c1e65d4a7db6a`) is a single
ES5-safe IIFE exposing `beSmokeTest(opts)`. It is loaded from the deployed origin
with `fetch('./smoke-test.js')` and evaluated, so the file the test runs is provably
the file in the repository — the running copy re-measured at exactly 47,973 code
units, matching the committed file.

`beCleanupTestRecords` in `Code.gs` was extended from module sheets only to four
targets: module sheets, `Tasks`, `App Data` and `Submit Log`. This closes the gap
where §7 checks 7, 8, 9, 10, 14 and 15 round-trip records through sheets that
predate the module registry and were therefore invisible to the original cleanup
loop. Every target reads its key column from the live header row rather than
assuming a position, so a future column insert cannot silently retarget a deletion.

Both changes are additive. No sheet, column, task, user, ID or production record was
deleted, renamed, reordered or overwritten.

## B. Tested

Two complete runs against production, both from the real frontend origin
`https://bhartiaenterprises.github.io/Productivity-Checklist/` against the live
`/exec` endpoint. Run 1: 146,454 ms, test prefix `ZZTEST-SMOKE-ms2xp5ck3r54`.
Run 2: 119,313 ms, test prefix `ZZTEST-SMOKE-ms2xue62f9qs`.

**Both runs returned identical per-check statuses: 15 PASS, 0 FAIL, 2 BLOCKED.**

| # | Check | Status | Live evidence |
|---|---|---|---|
| 1 | `frontend_loads` | PASS | HTTP 200, 617,032 chars, complete document |
| 2 | `frontend_version` | PASS | served shell / running page / SW cache name all agree on `8.2.1-phase5-kpi` |
| 3 | `endpoint_responds` | PASS | HTTP 200 — `Bhartia Enterprises API v5.5 — Running — 27/7/2026, 1:27:30` |
| 4 | `get_tasks` | PASS | 45 task rows returned |
| 5 | `state` | PASS | state for 2026-07-27 with BC and VKS present |
| 6 | `get_appdata` | PASS | 1 App Data document returned |
| 7 | `task_roundtrip` | PASS | wrote and read back `ZZTEST-SMOKE-…-TASK` in 4,281 ms, fields identical |
| 8 | `appdata_roundtrip` | PASS | wrote and read back `ZZTEST-SMOKE-…-DOC` in 3,066 ms, marker identical |
| 9 | `stale_rejection` | PASS | one-hour-old write skipped; stored copy still `2026-07-27T07:57:49.455Z` |
| 10 | `malformed_rejection` | PASS | invalid JSON not stored; keyless document not stored; unknown GET action answered HTTP 200 without crashing |
| 11 | `rbac` | PASS | all 8 unauthorised probes refused, none returned data |
| 12 | `sw_registers` | PASS | active, controlling, and exactly one cache: `be-shell-v8.2.1-phase5-kpi` |
| 13 | `offline_shell` | PASS | cache holds a complete 8.2.1-phase5-kpi shell (617,032 chars) |
| 14 | `queue_retries` | PASS | queued 1 item, `syncOutbox` returned "done", queue drained to 0, document confirmed on the server |
| 15 | `no_duplicate_write` | PASS | re-posting a used cid with newer content changed nothing; cid is on record |
| 16 | `dashboard_consistency` | **BLOCKED** | no credentials supplied — see section E |
| 17 | `no_console_errors` | **BLOCKED** | capture began after load — see section E |

Verdict string returned by the script both times: `INCOMPLETE`. That is the script's
own honest arithmetic — it reports `GREEN` only when nothing is blocked. **Nothing
failed.**

### Scripted cleanup — verified by independent read-back

| Run | Tasks | App Data | Submit Log | SW cache entries pruned |
|---|---|---|---|---|
| 1 | 1 | 2 | 17 | 2 |
| 2 | 1 | 2 | 6 | 2 |

App Data shows 2 removed rather than 3 written because the deliberately malformed
document from check 10 was correctly never stored in the first place.

After both runs I re-read the live endpoints independently of the smoke test:
`getTasks` returned **45 rows, zero beginning `ZZTEST-`**; `getAppData` returned
exactly one key, `be_points_v1`, **zero beginning `ZZTEST-`**. The task count is the
same 45 recorded by check 4 before the first write, and the App Data count is the
same 1 recorded by check 6 — so the cleanup removed the test rows without removing
anything else.

### Repeatability

The two runs are byte-for-byte identical in status across all seventeen checks
(`identicalStatuses: true`, empty diff). A single green run proves the code works
once; two identical runs either side of a destructive cleanup prove the routine is
repeatable, which is what §7 actually asks for.

## C. Failed

Nothing failed. No check returned FAIL in either run.

## D. Fixed

Nothing required fixing in this cycle. §8's "fix anything that fails; redeploy;
repeat until all acceptance tests pass" step was reached with an empty failure list,
so no second deployment was made and Version 22 stands.

The one defect *anticipated* and pre-emptively closed before running was the
cleanup gap described in section A — `beCleanupTestRecords` covering only module
sheets would have left the smoke test's own `Tasks`, `App Data` and `Submit Log`
rows behind on every run, which would have violated §7's requirement that test data
"must be removed through a safe scripted cleanup method". That is now closed and
live-verified.

## E. Remaining

**Check 16 — `dashboard_consistency`.** The dashboard endpoint authenticates through
`dashScope(ss, name, hash, token)`. Reading `getDashboardEndpoint` at Code.gs:2557
confirms there is no owner-key bypass: it requires either a real employee's PIN hash
or a session token minted from one. I do not possess a real PIN and will not obtain
one — not by brute force, not by reading the stored hash out of the spreadsheet, not
by creating a temporary Owner-role user, and not by using the owner-key `set_pin`
reset on a real employee record. The endpoint refusing an anonymous caller is
correct behaviour, and a refusal is not evidence that the numbers behind it are
right. **This check needs the Owner to run it once while logged in**; the invocation
is `beSmokeTest({ownerKey: '…', user: '<name>', token: '<session token>'})`.

**Check 17 — `no_console_errors`.** The script arms its error listener the moment it
is evaluated, but because it is fetched *after* the page has finished loading, it
records `coversLoad: false` and correctly declines to claim a clean load it did not
observe. Corroborating evidence from outside the script: a hard reload of the
production frontend produced exactly three console messages, all `LOG`, and zero
errors or warnings —

```
BE Productivity App 8.2.1-phase5-kpi          (index:3270)
✅ Bhartia Enterprises App loaded successfully (index:9775)
[BE-DIAG] sw-registered Object                (index:3443)
```

That is real evidence for §7's "no uncaught console errors occur on clean load", but
it is external corroboration, not the script's own verdict, and I am not going to
promote a BLOCKED to a PASS on the strength of it. Making the script's own capture
honest would require a `<script>` tag inside `index.html`, i.e. shipping test
scaffolding to production users, which is not a trade I made unilaterally.

**Also still outstanding, unchanged by this cycle:** Bug #9's literal
"Wi-Fi off → reload → shell opens" device test (check 13 says so in its own PASS
text); Bug #12 confirmation on a real Android device; the positive session-token
path and any authenticated module read or write; the §10 Training and §12 Timesheet
interfaces; and §§11, 13–18.

## F. Bugs found this session

None in production code. The two BLOCKED checks are environmental limits, not
defects — in both cases the application behaved correctly and the *test* was unable
to observe it.

Worth recording as a design note rather than a bug: `Submit Log` accumulated 17 cid
rows in run 1 and 6 in run 2 for the same set of writes. The difference is retry
behaviour under `postWithRetry`, which is working as designed, but it means the log
grows faster than the number of logical submissions. Not acted on.

## G. Database changes

**None.** No sheet was created, renamed, deleted or reordered. No column was added,
removed or moved. No header row was rewritten.

The only code path in this cycle that could create a sheet is the module registry's
first-authenticated-write path, and it was never reached, because no authenticated
write occurred (see section E). `KRA Definitions`, `KPI Entries` and `Goals` are
still not claimed to exist.

Rows written and then removed by the smoke test, per run: 1 in `Tasks`, 2 in
`App Data`, 6–17 in `Submit Log` — all carrying the reserved `ZZTEST-` prefix, all
removed by the scripted owner-gated method, none by a manual spreadsheet edit.

**Sheets before this cycle = sheets after this cycle.**

## H. Migration impact

None. No schema version changed, no legacy row was rewritten, no backfill ran. Older
browser storage and any queued offline requests are unaffected: check 14 exercised
the real `outboxLoad`/`outboxAdd`/`syncOutbox` path and drained cleanly, and the
check refuses to run at all if the outbox already holds genuine pending items, so no
real user's queued work was ever at risk.

## I. Rollback impact

Rolling back is safe and cheap in both directions.

To revert the backend: create a new Apps Script version from commit `ad48452`
(Version 21's source, sha256 `b3a462b09e3f836e06abe98e57262cd4218eed72319f1220e230c0f67ede25c3`)
on the same deployment. The only functional difference is that
`beCleanupTestRecords` would again cover module sheets only; nothing a real user
touches changes.

To revert the frontend: nothing to revert. `index.html`, `sw.js` and `manifest.json`
were not modified in this cycle. `smoke-test.js` is a new file that no production
code path references — it is only ever loaded deliberately, by hand, into a console.
Deleting it would remove the test and change nothing about the running application.

The GitHub restore point `74dcda5` named in the directive remains valid.

---

## Completion percentage

The previous report scored 21 requirements at **11.75 ÷ 21 = 55.95% → 56.0%**, with
row 19 (§7 — automated 17-check smoke test as a repeatable script) at **0**.

Row 19 now scores **15 ÷ 17 = 0.88**: fifteen of the seventeen required conditions
verified green against the live Web App, twice, with identical results. The two
blocked checks earn nothing, because a check that could not be performed is not
working functionality.

No other row changed. Nothing else was built this cycle, so nothing else moves.

**Calculation:** 10 requirements at 1.0 = 10.0; §9 at 0.75; §10 at 0.5; §12 at 0.5;
§7 at 0.88. Total **12.63 of 21**.

**12.63 ÷ 21 = 60.14% → 60.1% complete.**

That is a 4.1-point move, and it is arithmetic from the check tally, not a chosen
number.

---

## Next highest-priority action

**Have the Owner run the smoke test once while logged in, to close check 16.**

This is now the single cheapest unblock in the project, and it unblocks more than
one thing. A logged-in run would: verify dashboard counts are non-negative and
internally consistent at the data level (§7 check 16, moving row 19 from 0.88 to
1.0); exercise the positive session-token path for the first time; and make an
authenticated module read possible, which is the last gap keeping §9 at 0.75 rather
than 1.0. Together those two rows are worth 1.37 points, or 6.5 percentage points,
for a few minutes of the Owner's time and no new code at all.

Concretely: log in normally, open the browser console on the live app, and run

```js
fetch('./smoke-test.js?_=' + Date.now())
  .then(function (r) { return r.text(); })
  .then(function (t) { (0, eval)(t); });

beSmokeTest({
  ownerKey: '<owner key hash>',
  user:     '<your name as it appears in the Users sheet>',
  token:    '<the session token from be_session_v1 in localStorage>'
}).then(function (r) { console.log(r.text); });
```

The routine writes only `ZZTEST-`-prefixed records and removes them itself. It will
not touch a real employee record or a real task.
