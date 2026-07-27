# Phase 5 — Sections 10 and 12 report (Apps Script Version 23, frontend 8.3.0-phase5-train-ts)

Date: 27 July 2026, ~17:30 IST
Scope of this work stream: build the Section 10 (Training) and Section 12 (Timesheet)
interfaces on top of the already-deployed module data layer, fix the date/time storage
defect that tracing that work uncovered, deploy, and verify against the live production
Web App.

This report follows the structure required by Section 10 of the Phase 5 directive.

---

## A. Genuinely completed

**A1 — Section 10 (Training) interface, live on production.**
The Training screen now carries a server-backed module hub underneath the existing daily
training checklist. Two segments are exposed, `Training Progress` and `Training Module`,
each backed by the corresponding entry in the server module registry. The hub reads through
the same authenticated, RBAC-scoped reader the Section 9 KPI screen uses, and writes through
the same validated writer. There is no second copy of the transport, cache, validation,
conflict or offline-queue logic; the Section 9 client layer was generalised rather than
duplicated.

**A2 — Section 12 (Timesheet) interface, live on production.**
The Timesheet screen now carries a server-backed `Timesheet` section underneath the existing
local 15/30/60-minute planner. `Date` renders as a native date input, `Start` and `End` as
native time inputs, and `Minutes` is not editable — the form states plainly that the server
derives it. `Minutes` is computed server-side from `Start` and `End`, including the
midnight-crossing case, so the figure cannot be typed in by hand.

**A3 — Both legacy screens are untouched.**
`prod-training-view` still calls `renderTraining()` and still submits through
`submitTraining()`. `prod-timesheet-view` still holds the local planner and
`submitProductivity()`. The new sections sit below a horizontal divider. No existing control
was moved, renamed or removed.

**A4 — Hub generalisation with no duplicate DOM ids.**
Every generated element id is prefixed per hub (`perf-`, `trn-`, `tsx-`), resolved through
`perfPfx()` / `perfEl()`. Leaving a hub wipes its list, form, conflict and status nodes.
Verified live: switching from Training to Timesheet left `trn-list` at zero length, and
switching back left `tsx-list` at zero length. No stale rows survive a segment or hub change.

**A5 — Apps Script Version 23 created; deployment ID unchanged.**
A new immutable version was created and the existing deployment was updated in place.

**A6 — The `beTextHeaders` date/time defect is fixed in the deployed backend.**
See section F.

---

## B. Tested

All of the following were executed against the live production Web App and the live GitHub
Pages origin, not against local files.

**B1 — Repository and deployed source are byte-identical.**
After publishing through the browser, `git fetch` plus `sha256sum` confirmed all three
changed files match `origin/main` exactly:

| File | Bytes | sha256 | Commit |
|---|---|---|---|
| `Code.gs` | 193,844 | `c87e4aaeaf2dd2e41ddfd9cdb444fcb008d191175105ebb27927cf9fb10142bf` | `5fc3cf9` |
| `index.html` | 685,858 | `92fd8be47e9eefd51564c154beb8d7f7d8480e73365e5041021c3f70f8b68e13` | `a0d9b2a` |
| `sw.js` | 3,945 | `c182ef6e8ae89ff6b11bc87ed4f90833b92da51f34a14b732be97d8eec4980c1` | `9531be2` |

**B2 — Apps Script HEAD matches the repository.**
`script.google.com` fetched `Code.gs` from the commit-pinned raw GitHub URL for `5fc3cf9`
and the text was hash-checked before it was written into the editor
(`u16 181,624 / djb2 2,086,350,917`, matching the local file). The save was then **proved**
by reloading the tab and re-hashing the editor model — not by the state of the save button,
which is not evidence.

**B3 — Version 23 deployed; deployment ID unchanged.**
The Manage-deployments dialog reported `Deployment successfully updated. Version 23 on
Jul 27, 2026, 5:24 PM`. The deployment ID was fingerprinted before and after the update and
is identical: length 72, djb2 `4042534410`. Rule 6 of Section 1 is satisfied.

**B4 — `/exec` actually serves, tested from the production origin (not from the dialog).**
- Bare GET returned `Bhartia Enterprises API v5.5 — Running — 27/7/2026, 5:25:21 …`
- `?action=state` returned `{"status":"ok", …}`
- `?action=modules` with no credentials returned
  `{"status":"error","reason":"no_user","message":"not authorised (no_user)"}` — the correct
  RBAC refusal, identical to pre-deployment behaviour, i.e. no regression.

**B5 — Section 7 smoke test re-run live against Version 23 and frontend 8.3.0.**
Result: **15 PASS, 0 FAIL, 2 BLOCKED** — unchanged from the Version 22 run, so the deployment
introduced no regression.

| # | Check | Result |
|---|---|---|
| 1 | Production frontend loads | PASS |
| 2 | Frontend version is correct | PASS |
| 3 | Apps Script endpoint responds | PASS |
| 4 | `getTasks` works | PASS |
| 5 | `state` works | PASS |
| 6 | `getAppData` works | PASS |
| 7 | Task write and read round-trip works | PASS |
| 8 | App Data write and read round-trip works | PASS |
| 9 | Stale write rejection works | PASS |
| 10 | Malformed request rejection works | PASS |
| 11 | RBAC prevents unauthorised access | PASS |
| 12 | Service worker registers | PASS |
| 13 | Offline shell loads | PASS |
| 14 | Pending queue retries | PASS |
| 15 | No duplicate write occurs | PASS |
| 16 | Dashboard counts non-negative and internally consistent | BLOCKED — needs a real employee credential |
| 17 | No uncaught console errors on clean load | BLOCKED — instrumentation must be installed before page load |

Check 2 passing is the direct evidence that the deployed frontend is the new build: the smoke
test compares the running `APP_VERSION` against the expected value and it read
`8.3.0-phase5-train-ts`.

**B6 — Live interface tests on the deployed origin.**

| Test | Observed |
|---|---|
| Training hub mounts | `PERF_HUB='train'`, `PERF_SEG='training_progress'`, prefix `trn` |
| Training Progress list renders | Loading state, then the real empty-state message (no rows exist yet) |
| Segment switch to Training Module | `PERF_SEG='training_module'`, form header `नया Training Module` |
| Timesheet hub mounts | `PERF_HUB='ts'`, `PERF_SEG='timesheet'`, prefix `tsx` |
| Cross-hub cleanup | `trn-list` and `tsx-list` each emptied on leaving their hub |
| Timesheet form field types | `Date`→`date`, `Start`→`time`, `End`→`time`, `Note`→textarea, ids `tsx-f-*` |
| `Minutes` is not editable | Confirmed — the form shows "server derives: Minutes" and renders no input for it |
| Training Progress form field types | `Status`→`select` with 4 options, `Progress %`/`Score`/`Attempts`→`number`, ids `trn-f-*` |
| Course picker fallback | With an empty catalogue, `Module ID` correctly falls back to a text input rather than an empty dropdown |
| Sync/status control | Refresh control rendered in both `trn-status` and `tsx-status` |

**B7 — Static checks before publishing.**
`node --check` passed on the two extracted inline script blocks of `index.html`
(480,945 characters), on `Code.gs`, and on `sw.js`. A targeted ES5 scan over only the 298
added `index.html` lines found no arrow functions, template literals, `let`/`const`, spread,
`class`, or ES6 library calls. All 14 newly referenced helper functions were confirmed
defined, and confirmed live as `typeof === 'function'` in the running page.

---

## C. Failed

Nothing failed in this work stream. Zero smoke-test checks are in the FAIL state, and no live
interface test produced an error.

Two items are **BLOCKED, not failed**, and the distinction is real:

- **C1 — Smoke check 16 (dashboard consistency).** The dashboard endpoint requires a genuine
  employee PIN hash. The owner key grants cleanup and session-revocation rights but
  deliberately does not grant dashboard access, so it cannot be substituted.
- **C2 — Smoke check 17 (no uncaught console errors).** The error collector must be installed
  before the page begins loading; a check that runs after load can only report zero because it
  saw nothing, which would be a false pass. It is reported BLOCKED rather than forced green.

---

## D. Fixed

**D1 — `beTextHeaders` did not pin `date` and `time` module fields to plain text.**
Fixed in `Code.gs`, deployed as Version 23. Detail in section F.

**D2 — First reload after deployment served the previous shell.**
Observed and diagnosed during verification: the service worker is cache-first with background
refresh, so the first navigation after a deploy returns the cached shell while the new copy is
fetched, and the second navigation returns the new build. Confirmed by direct measurement —
the network copy read `8.3.0-phase5-train-ts` while the rendered page still read
`8.2.1-phase5-kpi`, and the following reload rendered `8.3.0-phase5-train-ts`. This is the
designed behaviour of a cache-first shell, not a defect, but it is recorded here because it
means **any post-deployment verification must reload twice before trusting the version it
sees.** No code change was made.

---

## E. Remaining

**E1 — No authenticated module write has been performed, so the three module sheets do not
exist yet.** `Training Modules`, `Training Progress` and `Timesheet` are created by
`beModuleSheet()` on the first authenticated write. Until an employee signs in with a real
PIN and saves one record, those sheets are absent. They must not be described as existing.

**E2 — The positive session-token path is unverified.** Token minting requires a PIN by
design. The negative paths (`pin_required`, `no_user`, RBAC refusal) are all verified; the
positive path is not.

**E3 — Smoke checks 16 and 17**, per section C.

**E4 — Real-device confirmations still owed:** Bug #12 on an actual Android handset (WhatsApp
in-app browser and installed PWA), and Bug #9's literal "turn Wi-Fi off, reload, shell opens"
test.

**E5 — Sections 11 and 13–18 are not started.**

E1, E2 and E3 are all the same single dependency: one real employee PIN. They were deferred at
the Owner's explicit instruction, and no attempt was made to work around the credential — no
PIN was guessed, no stored hash was read, no temporary Owner-role user was created, and the
owner-key PIN-reset path was not used against a real employee.

---

## F. Bugs found this session

**Bug #13 — `beTextHeaders` left `date` and `time` module fields unpinned, so Google Sheets
re-typed them on write.** Severity: high. Status: fixed and deployed in Version 23.

The generic module writer pins certain columns to the `'@'` (plain text) format so that Sheets
cannot silently convert a stored string into something else. The list of columns to pin was
built from field types `text`, `longtext` and `enum` only. Every `date` and `time` field was
therefore left unpinned.

The consequence, had this shipped as planned: `beValidate` canonicalises a date to
`yyyy-mm-dd` and a time to `hh:mm` and hands clean strings to the writer, but Sheets would
convert `2026-07-27` into a Date value and `09:30` into an 1899-epoch time carrying the
+05:21 Madras offset. The value read back would not be the value written. This would have
corrupted every Timesheet `Date`, `Start` and `End`, and the `goal` module's `Start Date` and
`Due Date`, from the first save onward.

This was not found by testing the interface — the interface looked correct. It was found by
tracing the date and time round trip through the server before trusting it, which contradicted
the plan's assumption that the existing writer already handled these types.

The fix is one condition, additive, and touches no sheet, column, ID or existing record:

```js
    if (f.t === 'text' || f.t === 'longtext' || f.t === 'enum' ||
        f.t === 'date' || f.t === 'time') out.push(f.k);
```

The client keeps its compensating converter (`perfFormVal`) regardless, because rows written
before this fix — and any cell a person edits by hand in the spreadsheet — will still come
back as Dates. Neither half assumes the other succeeded.

---

## G. Database changes

**None.** No sheet was created, deleted, renamed or reordered. No column was added, removed or
moved. No row was written, edited or deleted. No ID was reset.

The three module sheets that Sections 10 and 12 will use do not exist yet and will be created
additively, by `beModuleSheet()`, on the first authenticated write — see E1.

The `beTextHeaders` change alters only the cell *format* applied to newly written rows in
module sheets. It never rewrites existing cells and never touches a non-module sheet.

---

## H. Migration impact

**None required.** No existing data shape changed, so nothing needs migrating.

Backward compatibility was preserved on every axis the directive names: older browser storage
keys are read unchanged; queued offline requests written by the previous frontend remain valid
because the transport envelope (`cid`, retry policy, outbox key `be_outbox_v1`) is unchanged;
the Web App URL and deployment ID are unchanged, so any installed PWA continues to reach the
same endpoint; and legacy rows lacking `type`, `recurrence` or `history` continue to be read
with sensible defaults rather than being rewritten.

Where a module row was written before the Bug #13 fix, the client's `perfFormVal` converts a
Sheets date value back to `yyyy-mm-dd` through Asia/Kolkata (not through the device's own time
zone) and a clock value back to `hh:mm`, so historical rows display correctly without being
touched. No backfill is performed and no historical record is fabricated.

---

## I. Rollback impact

**Low, and reversible in both halves independently.**

- **Backend:** the Apps Script version history retains Versions 1–22. Pointing the existing
  deployment back at Version 22 restores the previous backend without changing the deployment
  ID. The only behavioural difference is that `date` and `time` module cells stop being pinned
  to text — i.e. Bug #13 returns.
- **Frontend:** `git revert a0d9b2a 9531be2` restores `index.html` 8.2.1-phase5-kpi and the
  matching service-worker cache name. Because the cache name embeds the version, a rollback
  produces a fresh cache rather than a stale one.
- **Data:** nothing to roll back — no rows were written.
- **Restore point:** the repository restore point named in the directive, `74dcda5`, remains
  valid and untouched.

---

## Deployment record

| Item | Value |
|---|---|
| Deployed Apps Script version | **23** (created 27 Jul 2026, 5:24 PM IST) |
| Version description | `Phase 5 sections 10 and 12: pin module date and time fields to text (beTextHeaders) - repo 5fc3cf9` |
| Deployment ID | **unchanged** — length 72, djb2 `4042534410` (identical before and after) |
| Web App URL | unchanged |
| Frontend version | **8.3.0-phase5-train-ts** |
| Service worker cache | **be-shell-v8.3.0-phase5-train-ts** |
| GitHub commits | `5fc3cf9` (Code.gs) · `a0d9b2a` (index.html) · `9531be2` (sw.js) |
| Sheets before | unchanged |
| Sheets after | unchanged — no sheet created, renamed, reordered or deleted |
| Smoke test | 15 PASS · 0 FAIL · 2 BLOCKED |

---

## Completion percentage

The percentage is scored on working functionality, not on lines of source.

Requirements at **1.0** (ten): Bug #9 offline shell · Bug #10 orphan cleanup · Bug #11 stale
configuration guidance · Bug #12 Android closing checklist · Section 3 sync visibility ·
Section 6 Owner dashboard · Section 7 Manager dashboard · Section 8 Employee dashboard ·
Section 6 adoption/backward data handling · Section 8 deployment discipline.

Requirements below 1.0:

| Requirement | Score | Why not 1.0 |
|---|---|---|
| §7 automated smoke test | 0.88 | 15 of 17 conditions verified live; 2 blocked on a credential |
| §9 KPI/Goal/KRA module | 0.75 | Interface and backend live and verified; no authenticated write yet |
| §10 Training module | 0.75 | Interface and backend live and verified; no authenticated write yet, so the sheets do not exist |
| §12 Timesheet module | 0.75 | Interface and backend live and verified; no authenticated write yet, so the sheet does not exist |

**Calculation:** 10 requirements at 1.0 = 10.00; §7 at 0.88; §9 at 0.75; §10 at 0.75;
§12 at 0.75. Total **13.13 of 21**.

**13.13 ÷ 21 = 62.52% → 62.5% complete.**

The previous figure was 60.1% (12.63 of 21). The increase of 2.4 points is exactly the two
quarter-point movements of §10 and §12 from 0.5 to 0.75, each earned by an interface that was
built, published, deployed and then verified running on the production origin. Nothing was
rounded up and no arbitrary increase was applied.

Sections 10 and 12 are deliberately capped at 0.75, the same ceiling as Section 9, because
the identical gap applies to all three: no record has yet been written through them by a real
authenticated user. Calling them finished would be false.

---

## Next highest-priority action

**Obtain one real employee PIN — or have the Owner sign in on the live app and save a single
Timesheet row — and then immediately re-verify.** That one action unblocks, in a single pass:

1. the positive session-token path (E2);
2. the first authenticated module write, which creates the `Training Modules`,
   `Training Progress` and `Timesheet` sheets additively (E1);
3. the Bug #13 fix under real conditions — read the saved row back and confirm `Date` returns
   as `2026-07-27` and `Start` as `09:30`, as literal strings rather than converted values;
4. server-derived `Minutes`, confirming it matches `End − Start` and was not typed;
5. smoke check 16, moving §7 from 0.88 to 1.0.

Completing that pass would move §9, §10 and §12 from 0.75 to 1.0 and §7 to 1.0, taking the
total to 16.00 of 21 = 76.2%. It is the single highest-leverage step available, and it is
blocked only on a credential that I correctly do not hold and must not manufacture.
