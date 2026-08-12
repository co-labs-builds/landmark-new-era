# Ontraport Automation Rules — Classification/LDP Live-Push (2026-08-12)

These are the native Ontraport automation rules needed so that **manually editing these fields directly on a Registration record** pushes live to the CS Dashboard, no refresh needed — same idea as the Materials/Announcements rules already built, just registration-scoped instead of event-scoped.

**The 14 original attendance/presence fields (f2853, the 12 session ATTENDED fields, f3062) do NOT need a rule here** — those already publish automatically from inside `CS Dashboard : Take Attendance` / `Attendance Reconcile Sweep` / `LM | Zoom | Live Attendance Poller` whenever those workflows write them. This file only covers the fields you'd edit **by hand** in Ontraport.

## Before building all 14 — test one first

I don't have live Ontraport access this session, so the exact merge-tag syntax below is my best inference, not confirmed. **Build and test just the `f2801` rule first** (biggest visual payoff — flips a real Day 1 attendance tick), confirm it actually pushes to the dashboard, then copy the pattern for the rest. If the merge tags don't resolve as written, compare against one of the working Materials/Announcements rules you already built — those are a known-good reference for whatever the correct syntax actually is in your account.

## Common setup, every rule

- **Trigger**: "When this field is changed" on a **Registration** record → the specific field listed below.
- **Action**: Webhook / HTTP POST
- **URL**: `https://landmarkworldwide.awesomate.io/webhook/ably-publish`
- **Method**: POST
- **Body** (JSON): `{"eventId":"[Event//ID]","registrationId":"[ID]","field":"<literal field ID>"}`
  - `[ID]` = the triggering Registration's own ID (record context is the Registration itself)
  - `[Event//ID]` = the linked Event's ID, via the Registration's Event parent field (f2214) — **this is the part most likely to need adjusting** if Ontraport's automation-rule merge tags use different relationship syntax than assumed here
  - `field` is a **literal string**, not a merge tag — hardcode the exact value shown per rule below, same as the existing Materials rules hardcode `"day1-assignments"` etc.

## The 14 fields, one rule each

| Field | Name | `field` value to hardcode |
|---|---|---|
| f2801 | Day 1 Attended | `f2801` |
| f2802 | Day 2 Attended | `f2802` |
| f2803 | Day 3 Attended | `f2803` |
| f3206 | Minor | `f3206` |
| f3044 | Reviewer | `f3044` |
| f3046 | Statistical Exclusion (SE) | `f3046` |
| f2882 | Seminar Potential | `f2882` |
| f2887 | AC Potential | `f2887` |
| f2303 | SEM Registration | `f2303` |
| f2302 | AC Registration | `f2302` |
| f2293 | Left The Course (LDP) | `f2293` |
| f3056 | Left Type (LDP option) | `f3056` |
| f3059 | Left Day | `f3059` |
| f2688 | WBO (Well Being Out) | `f2688` |
| f3191 | Attendance Status (drives the Absent-Excused/NCNS badge) | `f3191` |

## What each one visibly does on the dashboard

- **f2801/f2802/f2803** → flips that Day's attendance tick (green/red/amber) on the roster card.
- **f3206/f3044/f3046** → flips the MNR/REV/SE classification pill.
- **f2882/f2887/f2303/f2302** → flips the Seminar/AC NP-POT-REG pill (f2882+f2303 drive Seminar together; f2887+f2302 drive AC together — a rule on either one alone will still work, it just recomputes both when either fires).
- **f2293/f3059** → flips the name-row badge to LDP (red), and also overrides whichever Day tick matches — once someone's marked as having left, this takes priority over everything else on the badge.
- **f2688** → no separate visual target on its own right now (it's folded into the LDP tick's popover detail, not a distinct badge state).
- **f3191** → flips the name-row badge to "ABSENT - EXCUSED" (467) or "ABSENT - NCNS" (468); any other value falls through to LIVE/LATE/ACTIVE based on f2853/f3062.

## Name badge precedence (for reference)

CANCELLED (registration itself inactive) → LDP (f2293) → ABSENT - EXCUSED/NCNS (f3191) → LIVE (f2853) → LATE (f3062) → ACTIVE (default).
