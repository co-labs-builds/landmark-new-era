# Ontraport Automation Rules — Attendance/Classification Live-Push (2026-08-12)

These are the native Ontraport automation rules needed so that **manually editing a field directly on a Registration record** pushes live to the CS Dashboard, no refresh needed — same idea as the Materials/Announcements rules already built, just registration-scoped instead of event-scoped.

**Corrected 2026-08-12**: an earlier version of this doc said the original 14 attendance/presence fields (`f2853`, the 12 session ATTENDED fields, `f3062`) didn't need rules here. That was only true if all real attendance changes flow through `CS Dashboard : Take Attendance` / `Attendance Reconcile Sweep` / `LM | Zoom | Live Attendance Poller` — those workflows do publish automatically after writing. But confirmed live: manually editing `Currently Present`/`FS Late Arrival` directly on the record (the walkthrough's actual testing method) does **not** go through those workflows, so nothing publishes, and the dashboard only shows the change after a manual refresh. **If you want manual edits to any of these 28 fields to live-push, all 28 need a rule** — not just the 14 classification/LDP ones from the original version of this doc.

## Merge tag syntax — CONFIRMED WORKING 2026-08-12

The `f2853` test rule fired live (real `mode:"webhook"` execution, `user-agent: "Ontraport Webhook"`, confirmed via n8n execution history) with `eventId:"271"` and `registrationId:"1127"` both resolved correctly — `[Event//ID]` and `[ID]` are the right syntax, no adjustment needed. **The one real gotcha found**: the rule sent `field:"Currently Present"` (the field's display label, presumably auto-filled by Ontraport's field picker) instead of the literal ID `f2853` — the webhook correctly rejected it (400) since only literal `f####` strings are whitelisted. **`field` must be typed as plain literal text (`f2853`, `f2801`, etc.), not selected via any field picker or merge tag** — same as your existing Materials rules already hardcode `"day1-assignments"` as plain text. Use the field-ID column in the table below, not the field-name column, for that value.

## Common setup, every rule

- **Trigger**: "When this field is changed" on a **Registration** record → the specific field listed below.
- **Action**: Webhook / HTTP POST
- **URL**: `https://landmarkworldwide.awesomate.io/webhook/ably-publish`
- **Method**: POST
- **Body** (JSON): `{"eventId":"[Event//ID]","registrationId":"[ID]","field":"<literal field ID from the table below>"}`

## Field name → field ID (for the `field` value — use the ID column, typed literally)

**Priority tier — build these first:**

| Field Name (in Ontraport) | Field ID |
|---|---|
| Attended Day 1 | `f2801` |
| Currently Present | `f2853` |
| FS Late Arrival | `f3062` |
| Attendance Status | `f3191` |
| Left The Course | `f2293` |

**Remaining fields:**

| Field Name (in Ontraport) | Field ID |
|---|---|
| Attended Day 2 | `f2802` |
| Attended Day 3 | `f2803` |
| Minor | `f3206` |
| Reviewer | `f3044` |
| Statistical Exclusion | `f3046` |
| Seminar Potential | `f2882` |
| Advanced Course Potential | `f2887` |
| Registered for Seminar | `f2303` |
| Registered for Advanced Course | `f2302` |
| Left Type | `f3056` |
| Left Day | `f3059` |
| Well Being Out | `f2688` |
| D1S1 Attended | `f3193` |
| D1S2 Attended | `f3194` |
| D1S3 Attended | `f3195` |
| D1S4 Attended | `f3196` |
| D2S1 Attended | `f3197` |
| D2S2 Attended | `f3198` |
| D2S3 Attended | `f3199` |
| D2S4 Attended | `f3200` |
| D3S1 Attended | `f3201` |
| D3S2 Attended | `f3202` |
| D3S3 Attended | `f3203` |
| D3S4 Attended | `f3055` |

Field *names* above are reconstructed from this session's work, not pulled fresh from the live account — if the field picker shows a slightly different label (capitalization, a typo), trust what's on screen and match by context to the right ID. The IDs themselves came from live API reads throughout this build.

That's 28 fields total. Note: `f3193`-`f3202` (10 of the 12 session fields) have no dedicated tick on the roster card today — only `f3203`/`f3055` (the CPLT CHKPNT S3/S4 ticks) do. Rules for the other 10 will correctly update the dashboard's in-memory data (visible if you open that record's detail popover) but won't flip anything visibly on the card itself. Build them for completeness if you want, but they're not worth prioritizing for the walkthrough.

## What each one visibly does on the dashboard

- **f2853** → name badge LIVE. **f3062** → name badge LATE. **f3191** → name badge ABSENT - EXCUSED/NCNS. **f2293/f3059** → name badge LDP (beats everything else), also overrides whichever Day tick matches.
- **f2801/f2802/f2803** → flips that Day's attendance tick (green/red/amber) on the roster card.
- **f3206/f3044/f3046** → flips the MNR/REV/SE classification pill.
- **f2882/f2887/f2303/f2302** → flips the Seminar/AC NP-POT-REG pill (f2882+f2303 drive Seminar together; f2887+f2302 drive AC together — a rule on either one alone still works, it just recomputes both when either fires).
- **f3203/f3055** → flips the CPLT CHKPNT S3/S4 tick.
- **f2688, f3056, f3193-f3202** → no dedicated visible target right now; in-memory data stays correct for the next full render/detail-pop.

## Name badge precedence (for reference)

CANCELLED (registration itself inactive) → LDP (f2293) → ABSENT - EXCUSED/NCNS (f3191) → LIVE (f2853) → LATE (f3062) → ACTIVE (default).

## For the real pilot (not just this walkthrough)

Once real attendance flows through `Take Attendance`/`Reconcile Sweep`/the Live Poller instead of manual edits, rules for `f2853`, `f3062`, and the 12 session fields become redundant (those workflows already publish automatically) — but harmless to leave in place, they'd just fire twice for the same change. The classification/LDP fields (`f2801`-`f2803`, `f3206`, `f3044`, `f3046`, `f2882`, `f2887`, `f2303`, `f2302`, `f2293`, `f3056`, `f3059`, `f2688`, `f3191`) have no other writer, so those rules stay load-bearing for real production use, not just this walkthrough.
