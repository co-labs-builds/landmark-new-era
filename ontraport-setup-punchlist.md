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
- My Account modal (added 2026-08-07) field mapping, live-confirmed on `contacts` (objectID 0): First Name → `firstname`, Last Name → `lastname`, Email → `email`, Mobile phone → `sms_number` (not `office_phone` — `sms_number` is what the existing SMS-consent fields are already keyed to), Time zone → `timezone` (real native `timezone`-type field), Photo → `profile_image` (native `image`-type field). Also found: `f2792` "Name Likes" (what the participant told us they want to be called — now used everywhere the portal greets someone, with a fallback to First Name, per 2026-08-07 decision) and `f2620` "Display Name" (portal-facing display name, believed to default from First Name — **unconfirmed**, see item 5). None of these need new fields created — the gap is the write-back mechanism, not the fields. See item 5.

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

## 5. My Account write-back — mechanism unresolved, don't build against a guess

The My Account modal's "Save Changes" (currently a UI-only stub — see `member-portal.html`) needs a real submission path, and it can't be a direct client-side call to `update_object`/`saveorupdate_object` — that requires an API key, which can't safely live in browser JS (anyone with devtools could read it and edit any contact record, not just their own). Two real options, neither fully verified yet:

- **Preferred: Ontraport's native "update the logged-in contact" form mechanism.** Confirmed to exist — it's what powers Ontraport's own prebuilt "My Account" / Customer Center app (`page_111_url` etc. already present on `contacts`, and Ontraport's own docs confirm "any info updated in the Customer Center automatically updates your contact records"). **Not yet confirmed:** the exact native form field-naming/binding syntax needed to reuse this mechanism inside our own custom-built modal instead of their prebuilt template — Ontraport's public docs don't document this at the level of detail needed (checked 2026-08-07, both the Forms and My Account app help pages). Needs hands-on verification in the Page Builder, or a support ticket.
- **Fallback: a small server-side proxy** (serverless function or webhook) holding the API key, called from the client, which then calls `update_object` server-side. Needed regardless of the above for anything the native form can't cover.

**Photo specifically:** Ontraport's native forms generally do support image/file upload fields (confirmed via their docs), so the native path may cover `profile_image` directly — but this isn't confirmed for the authenticated-member-update case specifically. If it doesn't pan out, the agreed fallback is uploading to Cloudinary client-side (same pattern already used for this project's own image assets) and writing the resulting URL into `profile_image` via the proxy path — `profile_image` is a plain `image`-type field, so a URL string should be a valid value either way.

**Confirmed 2026-08-07, apply when this gets wired:** the form's First Name input writes to `firstname` directly (not `f2620` Display Name) — Display Name is believed to default from First Name automatically, so it isn't written to directly. This "believed" needs confirming too, same trip as the form-binding mechanism above.

---

## Nice-to-have, not a gap

`courses.f2412`-`f2423` ("Day 1-6 Course Summary" / "Day 1-6 Homework") — evergreen per-course curriculum copy already exists on the Courses object. Could eventually replace the hand-written copy in `Portal.pdata`'s program descriptions instead of maintaining it separately, but Stage 2 already shipped its own copy — not worth touching mid-build.

---

## 6. CS Dashboard field cross-check (`master-stats-dashboard-demo-LATEST.html`)

Checked live 2026-08-07 against `event team` (10007), `invitations` (10003), `courses` (10002), plus fresh pulls of `registrations` (10001), `events` (10000), `contacts` (0) — resolving the "Assumed, unconfirmed (§0X)" rows in the demo file's own DATA OWNERSHIP (§7) table before Track 2a build starts.

### 6.1 Confirmed exactly as the dashboard file assumed
- `oEventTeam` is real: object name `event team`, objectID **10007**. `f2788` Contact→Contacts(0), `f2789` Event→oEvents(10000), `f2790` Role (drop) — **the only configured option is `306=Course Supervisor`**, no other roles exist yet.
- `events.f2397` "Event Leader" (parent→Contacts) — confirmed.
- **TOS/FIF gate, resolved 2026-08-08 (client confirmed directly, overrides the §6.4 ambiguity this cross-check originally flagged):** TOS = `registrations.f2585` **"Agreed to Registration Policies"** (check); FIF = `registrations.f2579` **"Information Form Completed"** (check). Both live on **registrations**, not contacts. `f2586` "Agreed to Terms of Use" and `f2584` "Agreed to Privacy Policy" are real neighboring fields but are NOT the TOS gate — don't substitute either. The `contacts.f2335`/`f2723`/`f2724` LF-specific trio (§6.4) is confirmed irrelevant to this gate — registrations' own fields are authoritative. (Don't confuse any of these with `contacts.f2792` "Name Likes" — unrelated, already documented above.)
- `registrations.f2993` "Prefered Communication (Email/Call)" (list: 398=Both, 399=Email, 400=Call) — confirmed, on registrations.
- `courses.f2412`–`f2423` (Day 1–6 Course Summary + Day 1–6 Homework, rich_text) — confirmed real, exact IDs match, matches the "nice-to-have" note above.
- `oInvitation` exists: object name `invitations`, objectID **10003**, with the full guest attendance/registration/inviter-link core the DATA OWNERSHIP table needs: `f2257` Participant→Contact, `f2258` Event→oEvents, `f2259` Guest→Contact, `f2260` Participant's Registration→oRegistrations, `f2466` Resulting Registration→oRegistrations.
- Event status pill (Not Started/In Progress/Completed) on `events` — confirmed genuinely absent. Closest neighbor is `f3012` "Availability" (Closed/Full/Open), which controls whether the event is open for *new registrations* — a different concept from in-session lifecycle state. Don't reuse it; this needs a real new field.
- Device/Zoom aggregate rollups on `events`: `f3072` "Couples Sharing Device" and `f3073` "Double Devices" (both numeric) — confirmed, matches the file's "event-level rollup, derived from per-Registration state" note.

### 6.2 Confirmed but under a different name/shape than assumed — changes the build plan
| Dashboard concept | Real field | What's different |
|---|---|---|
| WBO "derived from Leave Reason, never a separate write" (§0l) | `registrations.f2688` **"Well Being Out"** (check) | This is a real, independently-writable field, not a derivation. `Leave Reason` (`f3061`)'s 7 real options don't even contain the literal string "Approved well-being departure" the demo's `WBO_LEAVE_REASONS` array checks for. **`set_course_status` should write WBO directly**, not infer it from Leave Reason text-matching. |
| Scholarship "derived from Amount Paid = $0.00, never CS-settable" (§0o) | `registrations.f3045` **"Pricing Category"** (drop: Scholarship/Standard) and `f2835` **"Price Type"** (drop, includes a Scholarship option) | A direct categorical field already exists — no $0-derivation needed. Amount-paid fields also exist if still wanted for display: `f2863` Cash Collected, `f2869` Net Revenue, `f2970` Payment Record→purchases (17). |
| Join Link (§0u) | `registrations.f2795` **"Zoom Join URL"** (auto-generated, per-registrant) | A better, already-personalized source than the file's event-wide link + manual `&tk=` query-param hack. Grad-day variant also exists: `f2799` "Grad Zoom Join URL". |
| Left Course?/Type/Day/Time/Leave Reason | `f2293` "Left The Course" (check), `f3056` Left Type (LDP/NSHO — matches), `f3059` Left Day (**dropdown** Day 1/2/3, not free text), `f3060` Left Time (timestamp), `f3061` Leave Reason (drop, 7 real options) | All exist and are usable as-is; just note Left Day is a constrained dropdown, not a freeform field. |
| Designated Alternate | No field literally named this | Closest candidates: `f2890` "AC Course Choice" (Alternate/Designated) and `f2889` "AC Registration Status" (includes a `DA` option). Needs a decision on which one `set_ac_alternate` should target — this is genuinely ambiguous, not simply missing. |
| Reviewer / SE / Seminar Potential / AC Potential | `f3044` Reviewer ✓, `f3046` Statistically Excluded ✓ + `f3053` SE Reason (drop, includes "Under 18") ✓, `f3057` Seminar Potential ✓, `f3065` AC Potential ✓ — all checkboxes, all confirmed | Each of Seminar/AC Potential also has a **second, separate status dropdown** already on the object (`f2882` Seminar Potential Status, `f2887` AC Potential Status) duplicating the same concept. Pick one pair as canonical before wiring writes or the two will drift out of sync. |

### 6.3 Genuinely missing — needs creation
- Per-participant device/Zoom exception flag pair on `registrations` — no shared/duplicate-device field and no dedicated elevated-review field exist. Closest partial substitutes: `f2832` Attendance Match Status (Manually Matched/Unmatched/Ambiguous/Matched) and `f2849` Attendance Review Required (check) cover part of the "elevated" (.zoom-flag) concept but nothing covers the "passive" shared/duplicate-device (.device-flag) concept at all.
- On `oInvitation`, four of the ten guest allowlist actions have no backing field: **`set_guest_potential`** (no boolean Guest Potential field exists — only `f3050` "Non-Potential Reason", implying the primary flag was never built), **`set_guest_tos`**, **`set_guest_english`**, **`set_guest_locale`**. The other six ARE backed: `set_guest_attend`→`f2964` Attended Final Session, `set_guest_after730`→`f2966` Attended After Cutoff, `set_guest_18_plus`→`f3103` "Is guest under 18?" (note: inverse polarity — field asks under-18, not 18+), `set_guest_se`→`f3051`/`f3052`, `mark_guest_registered`→`f2299`/`f2298`/`f2300` (Forum/AC/Seminar), `set_guest_lf_grad`→ **three redundant fields** (`f2337`, `f2292`, `f2968` — pick one canonical).

### 6.4 Resolved 2026-08-08 — TOS/FIF gate
**Was flagged as ambiguous (two unrelated TOS-style consent field sets exist across `registrations` and `contacts`); client resolved it directly.** The Home roster's TOS/FIF gate uses `registrations.f2585` "Agreed to Registration Policies" (TOS) and `registrations.f2579` "Information Form Completed" (FIF) — see §6.1. The `contacts.f2335`/`f2723`/`f2724` LF-specific trio is not used for this gate. Superseded, kept only so the reasoning trail isn't lost if this ever needs re-litigating.
