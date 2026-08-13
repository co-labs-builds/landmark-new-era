# Ontraport Automation Rules — State-Change Live-Push (rewritten 2026-08-13)

**This doc's old title ("Attendance/Classification") undersold its own scope — it's rewritten here to cover the full state-change family: attendance/presence, LDP/WBO, Reviewer/SE/Seminar/AC Potential overrides, and (new) Device Exception.** These are the native Ontraport automation rules needed so that **manually editing a field directly on a Registration record** pushes live to the CS Dashboard, no refresh needed — same mechanism as the Materials/Announcements rules already built and confirmed working, just registration-scoped instead of event-scoped.

## Status as of a fresh live-fire test, 2026-08-13 (supersedes all prior snapshots in this doc)

Every prior version of this table — including the "confirmed working" claims from 2026-08-12 — was a point-in-time snapshot of automation `85` ("Untitled Automation 08/12/2026 11:40 am PDT"), which is still being hand-built in the Ontraport UI and can change from hour to hour. **Don't trust any field's status here without re-testing it** — this table reflects a real, fresh test run against the live account this morning, not an inference from execution-history timestamps.

**✅ Confirmed firing today** (real `mode:"webhook"` execution observed in `PORTAL : Ably Publish` immediately after a real field change):
| Field | Name |
|---|---|
| `f2293` | Left The Course |
| `f3191` | Attendance Status |
| `f3203` | D3S3 Attended |

**❌ Confirmed NOT firing today** (real, guaranteed value change made, zero automation-log enrollment, zero Ably Publish execution — not a "maybe delayed," genuinely no trigger wired):
| Field | Name |
|---|---|
| `f3056` | Left Type |
| `f3059` | Left Day |
| `f2688` | Well Being Out |
| `f3044` | Reviewer |
| `f3046` | Statistical Exclusion |
| `f2882` | Seminar Potential |
| `f2887` | Advanced Course Potential |
| `f2801` | Attended Day 1 |
| `f2802` | Attended Day 2 |
| `f2803` | Attended Day 3 |
| `f3196` | D1S4 Attended |
| `f3206` | Minor |

**⚠️ Untested today, status unknown** (never edited during this pass — same caveat as always, don't assume working or broken):
`f2853`, `f3062`, `f3193`, `f3194`, `f3195`, `f3197`, `f3198`, `f3199`, `f3200`, `f3201`, `f3202`, `f3055`, `f2303`, `f2302`

**🆕 New fields, added to the whitelist today, never had a rule at all before**: `f3208` (Device Exception), `f3207` (Shared Device name) — previously these weren't even in `PORTAL : Ably Publish`'s recognized-field list, so a rule pointed at them would have gotten a 400 regardless. That's fixed (see engineering note below); rules can now be built for these two.

## The engineering-side fix that changes how urgent this doc is

As of today, 4 of the CS Dashboard's own write-back n8n workflows (`Override Classification`, `Update Course Status`, `Correct Attendance`, `Device Exception`) **self-publish directly to Ably** after every write, independent of whether a native rule exists — confirmed live for all of: `f2293`, `f3056`, `f3059`, `f2688`, `f3044`, `f3046`, `f2882`, `f2887`, `f3191`, `f3208`, `f3207`, plus the session-attended field each Correct Attendance call touches. **This means: if a CS makes these changes through the dashboard's own kebab actions (the normal path), the fields above will live-push correctly today, regardless of this doc's status.**

**What native rules are still the *only* path for:**
1. **A CS editing a field directly in raw Ontraport**, bypassing the dashboard entirely — the self-publish additions only fire when the dashboard's own webhook is called, so this case still depends 100% on the native automation.
2. **`f2801`/`f2802`/`f2803` (Attended Day 1/2/3) and `f3206` (Minor)** — no dashboard action writes these at all (they're computed by the Zoom attendance pipeline / not exposed in any modal), so they have no self-publish path and depend entirely on either a native rule or the `LM | Zoom | Live Attendance Poller`'s own publish (which was also widened today to cover Day-Attended flips, but only fires when that poller actually runs against a live Zoom meeting).
3. **`f3195`/`f3197`-`f3202`** (8 of the 12 session-attended fields) — same as above, no dashboard write path outside `Take Attendance`/`Correct Attendance`, and those two workflows only touch whichever single session was picked.

**Bottom line for prioritizing remaining Ontraport UI work**: building/fixing rules for `f2801`/`f2802`/`f2803`/`f3206` is the highest-value remaining native-automation work, since nothing else covers those. Rules for the classification/LDP fields (Reviewer/SE/Seminar/AC Potential, the LDP cluster) are now a secondary safety net — nice to have for the direct-edit case, not blocking the dashboard's own reliability anymore.

## Merge tag syntax — confirmed working

`[Event//ID]` and `[ID]` are the right syntax for `eventId`/`registrationId` respectively — confirmed via a real fired rule. **The one real gotcha found**: an early rule sent `field:"Currently Present"` (the field's display label, auto-filled by Ontraport's field picker) instead of the literal ID `f2853` — the webhook correctly rejected it (400) since only literal `f####` strings are whitelisted. **`field` must be typed as plain literal text (`f2853`, `f2801`, etc.), not selected via any field picker** — same as the Materials rules already hardcode `"day1-assignments"` as plain text.

## Common setup, every rule

- **Trigger**: "When this field is changed" on a **Registration** record → the specific field listed below.
- **Action**: Webhook / HTTP POST
- **URL**: `https://landmarkworldwide.awesomate.io/webhook/ably-publish`
- **Method**: POST
- **Body** (JSON): `{"eventId":"[Event//ID]","registrationId":"[ID]","field":"<literal field ID from the table below>"}`

## Full field list (30 fields, includes the 2 newly-whitelisted Device Exception fields)

| Field Name (in Ontraport) | Field ID | Status today |
|---|---|---|
| Left The Course | `f2293` | ✅ firing |
| Attendance Status | `f3191` | ✅ firing |
| D3S3 Attended | `f3203` | ✅ firing |
| Left Type | `f3056` | ❌ not firing |
| Left Day | `f3059` | ❌ not firing |
| Well Being Out | `f2688` | ❌ not firing |
| Reviewer | `f3044` | ❌ not firing |
| Statistical Exclusion | `f3046` | ❌ not firing |
| Seminar Potential | `f2882` | ❌ not firing |
| Advanced Course Potential | `f2887` | ❌ not firing |
| Attended Day 1 | `f2801` | ❌ not firing — highest priority to fix |
| Attended Day 2 | `f2802` | ❌ not firing — highest priority to fix |
| Attended Day 3 | `f2803` | ❌ not firing — highest priority to fix |
| Minor | `f3206` | ❌ not firing — highest priority to fix |
| D1S4 Attended | `f3196` | ❌ not firing |
| Currently Present | `f2853` | ⚠️ untested today |
| FS Late Arrival | `f3062` | ⚠️ untested today |
| Registered for Seminar | `f2303` | ⚠️ untested today |
| Registered for Advanced Course | `f2302` | ⚠️ untested today |
| D1S1/D1S2/D1S3 Attended | `f3193`/`f3194`/`f3195` | ⚠️ untested today |
| D2S1-D2S4 Attended | `f3197`-`f3200` | ⚠️ untested today |
| D3S1/D3S2 Attended | `f3201`/`f3202` | ⚠️ untested today |
| D3S4 Attended | `f3055` | ⚠️ untested today |
| Device Exception | `f3208` | 🆕 newly whitelisted, no rule built yet |
| Shared Device (name) | `f3207` | 🆕 newly whitelisted, no rule built yet |

## What each one visibly does on the dashboard

- **f2853** → name badge LIVE. **f3062** → name badge LATE. **f3191** → name badge ABSENT - EXCUSED/NCNS. **f2293/f3059** → name badge LDP (beats everything else), also overrides whichever Day tick matches.
- **f2801/f2802/f2803** → flips that Day's attendance tick (green/red/amber) on the roster card, **and** (as of today) recomputes the Current/LDP tiles on Master Stats/Reporting.
- **f3206/f3044/f3046** → flips the MNR/REV/SE classification pill, **and** (f3044/f3046, as of today) recomputes the Reviewer/SE/Current tiles.
- **f2688** → (as of today) recomputes the WBO tile — previously had no live consumer at all.
- **f2882/f2887/f2303/f2302** → flips the Seminar/AC NP-POT-REG pill and recomputes the Seminar/AC tiles (f2882+f2303 drive Seminar together; f2887+f2302 drive AC together — a rule on either one alone still works, it just recomputes both when either fires).
- **f3203/f3055** → flips the CPLT CHKPNT S3/S4 tick.
- **f3208/f3207** → recomputes the Device Reconciliation card's Shared/Duplicate-Device Adj. tiles live (as of today — previously had no live path at all). No dedicated roster-card visual yet, but the stat tiles update.
- **f3056, f3193-f3202 (except f3203/f3055)** → no dedicated visible target right now; in-memory data stays correct for the next full render/detail-pop.

## Name badge precedence (for reference)

CANCELLED (registration itself inactive) → LDP (f2293) → ABSENT - EXCUSED/NCNS (f3191) → LIVE (f2853) → LATE (f3062) → ACTIVE (default).

## Known, separate, non-buildable gap: Registration Status (`f2424`)

Confirmed not in the Ably whitelist at all, and no dashboard action writes it (registration cancellation isn't part of any kebab action) — the roster's CANCELLED badge state only ever refreshes on a full page reload. This is a pre-existing limitation, not a regression from any of today's work. Only worth building out (whitelist `f2424` + a native rule + a small `rosterNameBadge()` client-side change) if the client confirms it's actually needed for Friday — flagging here rather than building speculatively.

## 🚨 Separate, urgent, non-buildable blocker: Zoom S2S credential

Confirmed via direct execution-log inspection: the Zoom Server-to-Server OAuth credential (`LM - Zoom TJC`, id `xKXhhw7jCSrKtCsE`) fails with `400 {"reason":"Bad Request","error":"invalid_request"}` **at the token-mint call itself** (`POST https://zoom.us/oauth/token`), before any meeting-specific request is ever reached — this rules out a bad/fake meeting ID as the cause (verified directly: a fake test meeting ID was sitting in memory in the failing executions but never sent anywhere, because the token call died first). The same credential minted a valid token successfully on 2026-08-11 at 19:35 UTC and has failed 100% of every real attempt since — something changed on the Zoom app/credential side in between. **This blocks all real Zoom-sourced attendance (Layers 1/2/3) for the pilot** and is not fixable from the dashboard/n8n side. Needs the owner of the Zoom Marketplace S2S app to check: has the client secret been regenerated/rotated recently, is the app still active (not deactivated/suspended), and was any new IP restriction added. A second, unused credential (`Zoom S2S - Test`, id `DgBbyDhAx9Iqpsgl`) exists in the same credential store — worth a quick check in case it's the intended replacement, but this hasn't been confirmed.
