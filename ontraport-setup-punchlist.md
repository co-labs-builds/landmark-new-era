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
- My Account modal field mapping, live-confirmed on `contacts` (objectID 0): Last Name → `lastname`, Email → `email`, Mobile phone → `sms_number` (not `office_phone` — `sms_number` is what the existing SMS-consent fields are already keyed to), Time zone → `timezone` (real native `timezone`-type field), Photo → `profile_image` (native `image`-type field). **Name field, decided 2026-08-08: the modal's primary editable name field is `f2620` "Display Name", not First Name** — a self-service "how you'd like to be addressed" field (e.g. "Chris R.") that keeps `firstname` untouched. Separate from `f2792` "Name Likes" (the original intake-form preference, still what every greeting elsewhere in the portal uses, per the 2026-08-07 `nameLikes || firstName` decision — confirmed 2026-08-08 these stay independent, Display Name does not feed greetings). None of these need new fields created — the gap is the write-back mechanism, not the fields. See item 5.

## 1. Populate two empty dropdowns

- `registrations.f3058` "Which Seminar" and `f3066` "Which AC" both exist but have **zero options configured**. Need the actual list of seminar series / AC dates added before a participant can be assigned one.
- Related, already-usable fields for the cohort default: `events.f3078` "Designated Seminar" / `f3079` "Designated Advanced Course" (plain text), and per-registrant Alternate-vs-Designated choice via `registrations.f2885` / `f2890`.

## 2. Extend `events.f3025` "Todays Session (Day)"

This is the CS's manual day-release control the whole hybrid session-resolution rule is built around. Currently a dropdown with only 3 options: **Day 1 / Day 2 / Day 3**.

**Resolved shape:** change the option set to **`1`, `2`, `3`, `Final`** — blank/unset means "nothing released yet" (Pre-event), `Final` covers Graduation. No numeric/unbounded rework needed — Seminar's own ~10-week cadence is confirmed out of scope for this pilot.

## 3. Course Materials release triggers — built 2026-08-08, narrower than originally scoped

The full custom object below was never built. Instead, the client added **6 fixed checkboxes directly on `events`**, each with a `related_data` mirror on `registrations` (same live-pull-through pattern as item 4's Announcement triggers) — confirmed live 2026-08-08:

| Day | Item | events checkbox | registrations mirror (read this, no prefix) | URL field (events, `Events//` prefix) |
|---|---|---|---|---|
| 1 | Assignments | `f3121` | `f3127` "Day 1 Assignments Visible?" | `f3027` "LM-Day 1 Assignments" |
| 1 | Agreements | `f3122` | `f3128` "Day 1 Agreements Visible?" | `f3026` "Day 1 Agreements" |
| 1 | Letter | `f3123` | `f3129` "Day 1 Letter Visible?" | `f3028` "LM-Day 1 Letter" |
| 2 | Assignments | `f3124` | `f3130` "Day 2 Assignments" (no "Visible?" suffix, unlike siblings) | `f3029` "LM-Day 2 Assignment" |
| 2 | Letter | `f3125` | `f3131` "Day 2 Letter Visible?" | `f3030` "LM-Day 2 Letter" |
| 3 | Follow-Through | `f3126` | `f3132` "Day 3 Follow Through Visible?" | `f3031` "LM-Day 3 Follow Through" |

**Confirmed 2026-08-08: the "LM-" `f3026`-`f3031` set is the authoritative URL field set**, not the legacy `f2708`-`f2714` set (`Workbook URL`, `Day 1/2/3 Materials URL`, `AC Materials URL`, `Materials Video URL`) — those legacy fields are superseded, not a second source of truth to reconcile against.

**What this is NOT, confirmed intentional for the pilot:** no per-item metadata (no Kind categorization, no Session Index, no First Shown At timestamp, no Notified flag — the original object design below), no toggle at all for Workbook/Materials Video/Day 3 Materials/AC Materials, and nothing for Graduation. **Decided 2026-08-08: omit all of these entirely rather than build around a guess** — the Member Portal's During-event assignments stack only renders the 6 items above; the renderer's existing empty-state covers Graduation and anything else omitted. Wired into `member-portal.html`'s `PORTAL_DATA.materials` — see that file for the exact merge-tag mapping.

<details><summary>Original fuller object design (superseded, kept for reference only)</summary>

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

</details>

## 4. Announcements checkboxes — done 2026-08-08

Built exactly per the recommended placement: `events.f3104` "Seminar Reg Open" / `events.f3105` "AC Reg Open" (checkboxes), each with a `registrations`-side `related_data` mirror — `f3106` "Trigger Seminar Announcement: DURING EVENT" / `f3107` "Trigger AC Announcement: DURING EVENT". This resolves the fan-out concern this item originally flagged: each registration has its own live-mirrored trigger field to condition on, no separate fan-out automation needed to get from "event-level toggle" to "per-registrant visibility."

Still to confirm/build: the actual Ontraport automation sending the participant email/SMS on `true` (not yet verified as built — the fields exist, the automation wiring is a separate check).

**Portal-side note, updated 2026-08-11: explicitly out of scope, removed.** `member-portal.html`'s `PORTAL_DATA.seminarRegOpen`/`acRegOpen` fields and `portal-engine.js`'s `Portal.realtime` `announcement.changed` handler (`applyAnnouncementChanged`) were dead code — no UI ever read either field — and have been deleted rather than built out further. CS-side notification (this section's checkboxes/automation) is unaffected; only the never-built participant-facing announcement banner is cut.

## 5. My Account write-back — narrowed 2026-08-08, real architecture decision needed

The My Account modal's "Save Changes" (currently a UI-only stub — see `member-portal.html`) needs a real submission path, and it can't be a direct client-side call to `update_object`/`saveorupdate_object` — that requires an API key, which can't safely live in browser JS (anyone with devtools could read it and edit any contact record, not just their own).

**Researched further 2026-08-08 (Ontraport's own public docs — [Updating existing records with forms](https://ontraport.com/university/Ontraport-for-marketing/Forms/Updating-existing-records-with-forms), [Create a form on an Ontraport page](https://ontraport.com/support/Pages/create-a-form-on-an-Ontraport-page), [Form settings](https://ontraport.com/support/Pages/form-settings)). This resolves the mechanism question but surfaces a real implementation-shape decision instead of just confirming the modal can reuse it as-is:**

- **The native update-the-logged-in-contact mechanism is real and more reliable than expected.** Ontraport's own docs state: *"The most reliable way to identify your contacts is on a membership site."* The Member Portal already IS a membership-gated page (per this build's own architecture — Ontraport's native membership login gates access before `Portal.init()` ever runs), so a native form on this page gets free, reliable "this is the logged-in contact, update don't create" identification — no PURL/cookie/hidden-field trickery needed, no API key exposed.
- **The catch: this only applies to native drag-and-drop Form Field + Submit Button elements added through Page Builder** ("Forms & Sales" palette), each field bound to a real CRM field by Ontraport itself. It is NOT a syntax or binding convention you can attach to arbitrary hand-coded `<input>` elements inside a Custom HTML block — the docs describe no such hook, and nothing found suggests one exists. **The existing My Account modal is fully custom-coded** (its own styled inputs, its own JS), so it can't literally "reuse" this mechanism without becoming a different kind of thing.
- **This is a real decision, not just a technical detail:**
  1. **Rebuild My Account's fields as native Ontraport Form elements**, styled via Ontraport's own style settings to match the existing modal as closely as possible (docs confirm forms are stylable and support image/file upload fields — so `profile_image` could plausibly go through this path too). Gets the write-back essentially for free, but the modal's exact custom look-and-feel may not be fully reproducible with native form styling — some visual fidelity risk.
  2. **Keep the custom modal exactly as designed**, and build the fallback server-side proxy (serverless function/webhook holding the API key, called from the client, calling `update_object` server-side) to submit its data instead. Full design control, more to build and secure.

**Decided 2026-08-08 (design lead, direct): option 2.** Native Ontraport form elements are ruled out — My Account stays fully custom-coded, write-back goes through a server-side proxy once that infra exists (not built yet). Also decided: the modal's primary editable name field is `f2620` "Display Name", not `firstname` — see the "Already fine" section above and `member-portal.html`'s `PORTAL_DATA`/My Account modal for the wiring. When the proxy gets built, its target for that field is `contacts.f2620`, never `firstname` — flagged directly in the code comment at the Save Changes stub so this doesn't drift.
  - Needs a call from whoever owns the visual bar for this modal — how much fidelity loss option 1 would actually mean is only knowable by testing Ontraport's form styling controls hands-on in the Page Builder (same manual-access blocker as §7's ONTRApage install).

**Photo specifically:** Ontraport's native forms generally do support image/file upload fields (confirmed via their docs), so the native path may cover `profile_image` directly — but this isn't confirmed for the authenticated-member-update case specifically. If it doesn't pan out, the agreed fallback is uploading to Cloudinary client-side (same pattern already used for this project's own image assets) and writing the resulting URL into `profile_image` via the proxy path — `profile_image` is a plain `image`-type field, so a URL string should be a valid value either way.

**Confirmed 2026-08-07, apply when this gets wired:** the form's First Name input writes to `firstname` directly (not `f2620` Display Name), never Display Name.

**Display-Name-defaults-from-First-Name assumption — resolved 2026-08-08, and the assumption was wrong.** Queried the real `contacts` data directly: only **2 of 183** contacts have `f2620` "Display Name" populated at all (`count_objects`, confirmed), and both are synthetic `ZoomTest Alice`/`ZoomTest Bob` records where it was manually set to the full "First Last" name — not just First Name, and not an automatic default in either case. **There is no auto-population from First Name happening** — Display Name is effectively an unused, empty field across the real contact base. Doesn't change anything already decided (the portal never wrote to it and still won't), but the earlier "believed" is now a confirmed no, not a guess.

**Proxy architecture — decided 2026-08-09, ready to build, not yet built.** Live bug report confirmed the stub was never wired: photo upload previews locally via `URL.createObjectURL` (never persisted anywhere) and "Save Changes" only flashes button text — neither survives a refresh. Client decisions this round:
- **Host: n8n**, reusing the same instance already running the Zoom/registration automation, rather than standing up a new platform.
- **Identity check: trust the client-submitted `contact_id` as-is for now**, explicit accepted-risk decision — this is a small, known pilot group, not a public-internet-scale concern. `dcParam.contact_id`/`.hash` (Ontraport's own membership-site session params, visible in page source) is the source value, but the workflow does NOT cryptographically verify the hash (Ontraport's signing scheme/secret isn't known) — anyone with devtools access could in principle submit a different contact_id. Revisit if this ever needs to harden (ask Ontraport support for the hash verification method, or find a documented "verify session" API call).
- **Consolidated into ONE webhook**, not two separate integrations — the earlier "Cloudinary client-side, then proxy separately" sketch above is superseded by this: browser POSTs text fields + the raw photo file together; the n8n workflow uploads the photo to Cloudinary server-side (signed, safe — no preset/client-side Cloudinary integration needed) if present, then writes everything to Ontraport in the same run.

**n8n workflow spec (to build):**
1. **Webhook node** — `POST`, multipart/form-data. Fields: `contactId`, `displayName`, `lastName`, `email`, `phone`, `photo` (optional file).
2. **IF `photo` present** → HTTP Request node → Cloudinary Upload API (`https://api.cloudinary.com/v1_1/<cloud_name>/image/upload`), authenticated via Cloudinary credentials stored in n8n (never touches the browser) → take `secure_url` from the response as `profileImageUrl`.
3. **HTTP Request node** → Ontraport `update_object` (or `saveorupdate_object`) on `contacts` (objectID 0), `id: contactId`, fields: `{ f2620: displayName, lastname: lastName, email: email, sms_number: phone, profile_image: profileImageUrl }` (only include `profile_image` if step 2 ran). Ontraport API key stored in n8n credentials.
   - **Open question, not yet empirically confirmed:** whether Ontraport's `image`-type `profile_image` field actually accepts a plain URL string via the API the same way a `url`-type field would, or requires an actual file upload through Ontraport's own upload mechanism. The "Photo specifically" note above flags this as an assumption, not a tested fact — test with a real value when building this step, don't assume it'll just work.
4. **Respond** to the browser: `{success: true, profileImageUrl}` or `{success: false, error}`.

**Frontend is wired and ready** (`portal-engine.js` `Portal.account`, 2026-08-09) to call this webhook the moment it exists — see the `ACCOUNT_UPDATE_WEBHOOK_URL` placeholder constant at the top of that module. Someone needs to either build this n8n workflow by hand from the spec above, or authorize the "claude.ai LMN8N" connector (claude.ai connector settings) so Claude can build/wire it directly in a future interactive session — non-interactive sessions can't complete the OAuth step.

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

## 7. ONTRApage install — manual step, needs an Ontraport admin

**No tool available here can create, read, or edit Ontraport Page Builder content.** Confirmed 2026-08-08: there's no `create_page`/`edit_page` API tool, and the page-template object itself (`objectID 178`, target of `page_120_template_id`/`page_121_template_id`/`page_125_template_id` etc.) isn't a queryable object type through this API ("Object type 178 is not recognized"). This has to happen by hand in the Page Builder UI.

**Full step-by-step install/verify/repoint/rollback procedure, researched and written up 2026-08-08:** `C:\Users\chris\.claude\plans\review-the-docs-and-mutable-moler.md`. Confirms Ontraport's actual mechanism (Dynamic CMS Page Types, a per-record template-assignment field — exactly what `page_120/121/125_template_id` already are), the Custom HTML Block / Custom Header Code content split, a concrete verification approach against the silent-fallback-to-Pre-event failure mode, the repoint sequencing, and a two-lever rollback plan. Read that file for the actual procedure — this section is now just the pointer + status.

**Pre-install blocker found and fixed 2026-08-08:** `member-portal.html`/`portal-engine.js` referenced all 19 images via bare relative `Assets/...` paths — fine locally, but would 404 live on an Ontraport URL (no `Assets/` folder exists there), hitting the nav logo on every phase plus the certificate logo. Rewrote all 24 occurrences to the same jsDelivr-fronted URL already used for the hosted engine's own `<script src>`; committed, pushed, purged, and spot-checked live (200s confirmed). `member-portal.html` is now genuinely paste-ready — no further content edits needed before install.

**Decision already made 2026-08-08 (client, direct):** the unified page replaces all three of the existing Pre-Event (`page_120`)/Post Event (`page_121`)/During Event (`page_125`) page templates, and all three keep resolving to it — **repoint, don't retire** — so any automation/email already linking to `page_120_url`/`page_121_url`/`page_125_url` keeps working unchanged; only the rendered content behind those URLs changes.
