# Bug #14 — Closing Checklist could not be submitted

**Reported by the Owner as:** *"Users are often complaining inability to submit closing sheet."*

**Frontend version deployed:** `8.3.1-bug14-closing-submit`
**Service-worker cache version:** `be-shell-v8.3.1-bug14-closing-submit`
**Apps Script version:** 23 — **unchanged** (this defect was entirely in the frontend; no server code was touched)
**Deployment ID:** `AKfycbzNVv8qwdqysoQDCyWB_9Q1Ksc14-nNjSapWOH9Rzi10LWPYPpYIu48I_add1At8fT-` — **unchanged**
**GitHub commits:** `2f0745e` (index.html), `bd52024` (sw.js)
**Repository restore point before this work:** `809e176`

---

## Root cause

`clState.staffTasks` is created in exactly one place, `buildStaffSection()`. That
function is called only from inside the **opening** branch of the checklist
builder; the closing branch never calls it, and `clReset()` does not include
`staffTasks` in the state object it constructs. So whenever a member of staff
opened a **Closing** checklist without having filled an **Opening** checklist in
the same browser session — and without a saved day-snapshot to restore from —
`clState.staffTasks` was `undefined`.

Pressing Submit then ran `clSubmit()` → `validateBeforeSubmit()` →
`checkTaskBlankAlert()`, which evaluated `clState.staffTasks[nm]` and threw
`TypeError: Cannot read properties of undefined (reading 'Ramu')`.

That throw is what made the defect so damaging. It happened *after*
`_inflightForms['checklist'] = true` and after the Submit button was disabled,
but *before* any `try`/`finally` block. The in-flight guard therefore stayed
`true` and the button stayed disabled **permanently**. Every subsequent tap hit
the early `if(_inflightForms['checklist']) return;` and did nothing at all — no
error, no spinner, no message. From the shop floor it looked exactly like
"the app won't let me submit the closing sheet". Only a full reload of the app
cleared it, which is also why the complaint was intermittent rather than
constant: staff who happened to fill the Opening first, or who had a restored
day-snapshot, never saw it.

---

## A. Genuinely completed

Five changes, all in `index.html`, plus a service-worker cache bump.

1. **`checkTaskBlankAlert()` guard (the actual fix).** When `clState.staffTasks`
   is absent or is not an object the function now returns `[]`. It deliberately
   does **not** default to `{}` — that would make every staff member look
   "blank" on every closing submit and, after three days, would demand a written
   reason before every submission. Trading a crash for a daily obstruction is
   not a fix. `staffTasks === undefined` now carries its true meaning: this form
   never collected staff tasks, so there is nothing to judge.
2. **`validateBeforeSubmit()` defence-in-depth.** The blank-task check is
   advisory. It is now wrapped in `try`/`catch`; if it ever throws again for any
   other reason, the failure is logged through `beDiag` and the submission
   continues instead of destroying the user's whole closing sheet.
3. **`clSubmit()` split into a guarded wrapper plus `clSubmitInner()`.** The
   in-flight guard and the disabled button are now released in a `finally`
   block that covers every exit path including an unexpected throw. This class
   of failure — one exception bricking the Submit button until a page reload —
   is now structurally impossible, whatever future code is added inside.
   On an unexpected throw the user is told plainly: *"❌ जमा नहीं हुआ — दोबारा
   'जमा करें' दबाएं"*, the spinner is hidden and the form is restored.
4. **Transport failures are queued, never lost.** If `submitAndVerify()` itself
   throws, the payload goes into the local outbox and the result is reported
   honestly as `queued`, not as "Synced".
5. **Elapsed-time feedback during submit.** `postWithRetry` can legitimately
   take around 65 seconds on a weak connection before the outbox takes over. A
   silent spinner for that long reads as "the app is broken", and users
   force-quit mid-submit, which is a second way work was being lost. The
   spinner now counts seconds and, at 10s and 35s, explains that the network is
   slow and that their data will be saved — in Hindi or English per the current
   language setting.

The duplicate-submit guard is now set *before* validation runs, so a rapid
double-tap on Android cannot race in while the validation modal is open.

## B. Tested — live, against production

Every check below was run against `https://bhartiaenterprises.github.io/Productivity-Checklist/`
after the deploy, not against a local copy.

| # | Test | Result |
|---|------|--------|
| 1 | Live frontend reports `APP_VERSION === '8.3.1-bug14-closing-submit'` | PASS |
| 2 | `caches.keys()` returns exactly `["be-shell-v8.3.1-bug14-closing-submit"]` — no stale caches | PASS |
| 3 | Production condition reproduced live (`type='closing'`, `staffTasks` deleted); `checkTaskBlankAlert()` returns `[]` and does not throw | PASS |
| 4 | The **pre-fix** expression, evaluated live under the same condition, still throws `Cannot read properties of undefined (reading 'Ramu')` — the root cause is proven, not assumed | CONFIRMED |
| 5 | With `clSubmitInner` forced to throw: guard released, button re-enabled, user informed, and a **second tap is accepted** | PASS |
| 6 | Zero uncaught console errors on a clean load | PASS |
| 7 | Full §7 smoke test: **15 PASS, 0 FAIL, 2 BLOCKED** (both blocked checks need an employee PIN, which is still deferred) | PASS |
| 8 | Test data cleaned: `getTasks` and `getAppData` contain no `ZZTEST` records; 45 real task rows intact and unchanged | PASS |
| 9 | Repository and deployed source byte-identical — `sha256(index.html)` = `594f0e74a6ba9c60713ea325c5ee9586765b269af58275ef299e862da8d4d3da`, `sha256(sw.js)` = `7ae31fdc12df76b81bfd0e0ca41d430926f17d69c1cf3db5d1b5cd87ec0d5247`, matching `origin/main` exactly | PASS |

Offline behaviour beyond the earlier verified 9 of 10 tests is unchanged by this
work.

## C. Failed

Nothing failed in the final verification run. Two problems occurred *during*
publishing and were resolved:

- A first commit attempt died when the Chrome extension disconnected mid-dialog.
- A second attempt returned GitHub's *"File could not be edited"* — a
  double-submit caused by mixing a coordinate click with a DOM-dispatched click
  on the same button. Confirmed via `git fetch` that neither attempt wrote
  anything to `origin/main`.

## D. Fixed

The defect described above, plus the two publishing failures (resolved by
reloading the edit page for a fresh token and dispatching exactly one click per
commit).

## E. Remaining

- **Confirmation on a real staff device.** Everything above was verified live in
  a desktop browser against production. One member of staff completing one
  genuine closing sheet on their own Android phone is the last piece of evidence
  I cannot produce myself.
- Bug #9's literal "Wi-Fi off → reload → shell opens" device test (9 of 10
  acceptance tests already verified).
- Bug #12's confirmation inside the WhatsApp in-app browser and the installed
  PWA.
- Smoke check 16 (dashboard consistency) and any authenticated module read or
  write — all require an employee PIN, deferred at your request.
- Phase 5 sections 11 and 13–18.

## F. Bugs found this session

**Bug #14** — the defect above. Found, fixed, deployed and verified live.

No new defects were introduced. No regression was found in Bugs #1, #2, #9, #10,
#11 or #12; the `askReasonModal()` DOM-overlay fix from Bug #12 is intact and was
confirmed *not* to be the cause of these complaints.

## G. Database changes

**None.** No sheet was created, renamed, reordered or deleted; no column was
added or removed; no row was modified. This was a pure frontend logic fix. The
smoke test wrote and then removed its own clearly-prefixed `ZZTEST-SMOKE-…`
records through the scripted cleanup path, verified empty afterwards.

## H. Migration impact

**None.** No schema change, so nothing to migrate. Existing browser storage,
queued offline items and saved day-snapshots all continue to work unchanged —
`clState.staffTasks` restored from a snapshot is still honoured exactly as
before.

## I. Rollback impact

Rolling back is a single revert of `2f0745e` and `bd52024`, returning the
frontend to `8.3.0-phase5-train-ts`. No data would be lost, because nothing was
migrated. Rolling back would, however, restore the defect. Apps Script Version
23 and the deployment ID are untouched, so no server rollback is possible or
needed.

---

## Sheets before and after

Unchanged: `Tasks` (45 rows, verified before and after), `App Data` (1 real
document, `be_points_v1`), `Attendance`, `Users`, `Config`, `Submit Log`,
`WA Group Additions` (archived per Bug #10), and the rest. No sheet was added or
removed.

## Completion

This report covers one production defect, not a percentage of Phase 5. Phase 5
itself is unchanged by this work: sections 6, 7, 8, 9, 10 and 12 are complete
and live; sections 11 and 13–18 remain. The blocked items are blocked on an
employee PIN and on real-device access, both of which sit with you rather than
with the code.

## Next highest-priority action

Ask one member of staff at each store to submit tomorrow's closing sheet
normally and report back. If it goes through, Bug #14 is closed on real
hardware and the next piece of work is Phase 5 section 11.
