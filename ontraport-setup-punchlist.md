# Ontraport Setup Punch List — Member Portal

Everything the Member Portal build needs from Ontraport that isn't done yet. None of this blocks frontend work — Stages 3-7 build and verify against local JSON fixtures matching these shapes. This list matters before Stage 8 (live hand-off), not before.

Checked live against the real `registrations` (10001) and `events` (10000) schemas plus the fresh full field-list pull on 2026-08-07.

---

## ✅ Already fine, no action needed

- `registrations.f2303` "Registered for Seminar" / `f2302` "Registered for Advanced Course" — genuinely independent checkboxes, exactly what the portal's program-grid fix needs.
- `registrations.f2809` "Forum Completed", `f2801`-`f2804` "Attended Day 1/2/3/Graduation" — all present.
- `events.f2469` "Event Zoom Link: Participants" — present.
- `events.f2753` "Session Dates" (longtext, staff-pasted list) — functional, just needs an agreed parse format when Stage 4 actually consumes it.
- `registrations.f3086` "Countdown Timer Starting Reference" and `events.f2754`/`f2757` (Session Start Time / Event Time Zone) — the fields the ported countdown logic (`Portal.dateUtil`) already reads.

## 1. Populate two empty dropdowns

- `registrations.f3058` "Which Seminar" and `f3066` "Which AC" both exist but have **zero options configured**. Need the actual list of seminar series / AC dates added before a participant can be assigned one.
- Related, already-usable fields for the cohort default: `events.f3078` "Designated Seminar" / `f3079` "Designated Advanced Course" (plain text), and per-registrant Alternate-vs-Designated choice via `registrations.f2885` / `f2890`.

## 2. Extend `events.f3025` "Todays Session (Day)"

This is the CS's manual day-release control the whole hybrid session-resolution rule is built around. Currently a dropdown with only 3 options: **Day 1 / Day 2 / Day 3**.

**Resolved shape:** change the option set to **`1`, `2`, `3`, `Final`** — blank/unset means "nothing released yet" (Pre-event), `Final` covers Graduation. No numeric/unbounded rework needed — Seminar's own ~10-week cadence is confirmed out of scope for this pilot.

## 3. Build a new Course Materials custom object

No backing data model exists at all today for the CS dashboard's per-resource release toggles. What exists on `events` is ~10 fixed, inconsistently-named URL fields (`f2710`-`f2714`, `f3026`-`f3031`) with no release toggle, no per-item metadata, no section grouping — not enough.

New object, one row per resource:

| Field | Type | Notes |
|---|---|---|
| Event | Parent → `events` (10000) | required |
| Section Type | Dropdown: `Session`, `Graduation` | no Always/Prep bucket — confirmed nothing on this course is evergreen |
| Session Index | Numeric | only meaningful when Section Type = `Session`; positional match against `events.f2753` Session Dates |
| Name | Text | e.g. "Day 2 Letter" |
| Kind | Text (free label) | seen values: Assignment, Agreement, Letter, Link — don't constrain to a dropdown enum |
| URL | URL | |
| Released | Checkbox | the CS's manual per-item toggle |
| First Shown At | Timestamp | auto-set on first release |
| Notified | Checkbox | matches the dashboard's existing notify tracking |

## 4. Add two new checkbox fields for Announcements

The CS dashboard's "Announcements" card (Seminar registration open / AC registration open) has no backing fields. Add:

- **`Seminar Open`** (checkbox)
- **`Advanced Course Open`** (checkbox)

Not yet decided whether these belong on `registrations` (10001) or `events` (10000) — confirm before creating. Given the CS toggles this once per cohort (same pattern as `Todays Session (Day)`), `events` is the more consistent placement — but if placed there, the automation needs to fan out to every linked `registrations` record for that event rather than firing on the event record itself.

Wire an Ontraport automation on each: condition = field value is `true` → send the participant email/SMS announcing that program's registration is open.

**Portal-side note:** these are not surfaced in the Member Portal UI — CS-side notification only, confirmed 2026-08-07. No grid/pill/copy change needed unless that changes later.

---

## Nice-to-have, not a gap

`courses.f2412`-`f2423` ("Day 1-6 Course Summary" / "Day 1-6 Homework") — evergreen per-course curriculum copy already exists on the Courses object. Could eventually replace the hand-written copy in `Portal.pdata`'s program descriptions instead of maintaining it separately, but Stage 2 already shipped its own copy — not worth touching mid-build.
