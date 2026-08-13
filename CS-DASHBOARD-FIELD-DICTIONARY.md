# CS Dashboard — Engineering Field Dictionary

Relocated 2026-08-13 from the trailing HTML comment in `master-stats-dashboard-demo-LATEST.html` (that file is now a frozen historical snapshot — see the note at its top). This is the current, living copy; correct it here going forward, not in the frozen file.

Two sections below were stale as of the relocation and have been corrected in place (marked inline): §8.1/§8.2 described a confirm-modal re-hide/re-show flow that production replaced with `directToggle()` on 2026-08-12 (and the old flow's code was fully removed 2026-08-13); §0q/§0t claimed `toggleCardExpand()`/`toggleChip()` were kept because the Guests tab still used them — the Guests tab moved to static non-interactive markup and those functions were confirmed unreferenced anywhere, removed 2026-08-13.

---

     ENGINEERING FIELD DICTIONARY — pilot revision
     Reflects Landmark Admin Portal Revision Brief v2 §6–§8, updated for
     the Event Management pass (three destinations: Event Management,
     Master Stats, Reporting Dashboard; card-based roster/guests; a
     single logged-in user per page load). This is the binding contract
     for the secure write service; nothing in this demo's client-side JS
     should be read as the real implementation of it.

     ============================================================================
     FEASIBILITY NOTES — Event Management revision pass
     ============================================================================
     0a. Single-user page, no client role switch. This page is reached by
         one authenticated Contact at a time. Production access control
         (Event Management + Master Stats restricted to Course Supervisor;
         Revenue restricted to Event Leader) belongs OUTSIDE this file:
         either (a) separate Ontraport pages/templates per role, gated by
         Ontraport's page-level login/redirect rules, or (b) one page with
         an Ontraport-side conditional content block keyed to the visitor's
         verified oEventTeam/Event Leader relationship. Do not rebuild the
         old client-side "deny panel" — that was only useful for demoing
         the rule to stakeholders, and there is no client checkable role
         anymore.

     0b. Roster / Guests / Course Materials are NOT a Dynamic Template
         merge-loop. A Dynamic Template page merges the fields of ONE
         bound record (e.g., one oEventTeam or oRegistration) at render
         time — it has no native mechanism for a searchable, paginated,
         inline-editable list across ~180 other records. The correct
         pattern (and the one this demo's card lists assume): an
         authenticated Ontraport PAGE whose JS, on load, calls the secure
         write service already specified below (§6) with a "list
         registrations for my Event" read action, renders the JSON as
         cards client-side, and posts every edit back through the same
         service's semantic-action allowlist. Only single-record context
         (event name/course/dates/Event Leader in the persistent header)
         is a good fit for true per-record Dynamic Template merge fields.

     0c. Session state timing (Day X of Y dot + Not Started/In Session
         pill). "Day X of Y" is a plain merge of Today's Session Day — no
         computation needed. The dot/pill DOES need a comparison against
         "now", and that comparison must not be done as browser-side
         timezone math against a human-readable {Session Start Time} +
         {Event Timezone} pair (label strings like "Pacific Time" aren't
         reliably convertible). Recommended: an Ontraport automation/
         formula field computes and stores an absolute UTC instant (or a
         boolean "Session Started" flag) ahead of time; the page merges
         that value into a data attribute and client JS does a single
         Date.now() comparison against it — see applySessionState() in
         this file's script for the comparison shape. This demo defaults
         that instant to "10 minutes ago" so the page loads showing In
         Session. An earlier pilot draft of this page had an adjacent
         "Demo: flip state" toggle for previewing both states without
         waiting on the clock — removed, since it was explicitly
         demo-only and was never meant to ship.

     0d. Attendance override write path — Guests tab only now (unchanged,
         out of scope for the roster revision below). The "Attendance"
         field on each guest card still opens a reason-required override
         flow rather than one-click buttons with no justification —
         matches conversion-handoff guidance (§20 of the HTML-to-Ontraport
         handoff) to keep native-form-shaped writes for real record
         updates rather than fabricating a client-only form with no
         Ontraport submit behavior. The roster's attendance model changed
         substantially in the Event Management revision pass below — see
         §0l/§0m — normal attendance is now Zoom-sourced and read-only;
         this note's "mAttendance modal" no longer exists on the roster
         (repurposed into the minimal mCorrectAttendance placeholder).

     0e. Classification pill field mapping is assumed, not confirmed. REV/
         POT/SE/TOS/18+/ENG are implemented generically from the mockup's
         abbreviations (Reviewer, Potential, Statistically Excluded,
         presumed Translation-of-Services/consent flag, age 18+, English-
         speaking). Confirm the real field each abbreviation maps to
         before wiring the semantic-action allowlist below — do not treat
         this demo's action names as settled.

     0f. Seminar / ADV. CRS are derived display, not manual entry, on the
         record cards. This note describes the Guests tab's card shape
         (unchanged, out of scope): grey NP/POT follows the card's POT
         pill (one pill drives both fields), green REG means the backend
         has recorded an actual registration and overrides NP/POT
         regardless of the POT pill. There is no manual "set registered"
         control here — mark_seminar_registered / mark_ac_registered are
         retained in the allowlist below for the backend/sync path that
         flips data-reg, not for this UI to call directly. The roster's
         Follow-On pill replaced this two-state model with a fuller
         state-priority ladder (NP→POT→CONF→REG[·DES/·ALT]) — see §0p —
         and does expose a human correction path for the Potential stage
         specifically, via Override Classification (§0s).

     0g. Spouse / household link and the guest's inviting-Participant field
         are both type-to-filter comboboxes over the current Event's roster
         (see renderCombo() + spouseFilter()/selectSpouse() and
         participantFilter()/selectParticipant() in the script), not plain
         text. Spouse writes a link between two oRegistration records (or
         the underlying Contacts, if the household relationship is meant
         to persist beyond one Event — confirm which); associating a guest
         to a participant writes the oInvitation → oRegistration link and,
         in this demo, unlocks that guest card's other fields (which start
         disabled while unassociated — see Hannah Kim). Both reuse the
         same in-memory PARTICIPANT_NAMES array; the real version should
         query the current Event's roster, not a hardcoded array.

     0h. Course Materials no longer has day tabs. Every day section
         (Day 1, Day 2, Day 3, Graduation) is always visible in
         chronological order — "Graduation" last (renamed from "Final
         Session" for this label only; the Final Session concept elsewhere
         in the app — guest expectations, KPI cards — is unchanged). The
         per-day Hidden/Visible legend was removed as redundant with the
         pill text itself. A later revision removed the "Always" and
         "Prep" sections entirely — nothing on this course should default
         to always-visible; every resource, including anything evergreen,
         is released manually on a specific day. If a genuinely day-
         independent resource is needed again, it should attach to
         whichever day it's first relevant on, not default to visible.

     0i. Record cards collapse behind a two-row pattern: row 1 (name +
         every metric) is always visible; row 2 (classification pills) is
         collapsed by default via toggleCardExpand() since those values
         are prepopulated and rarely need a second look. This is now the
         Guests tab's pattern only (unchanged, out of scope) — the roster
         retired the chevron/expand mechanism entirely in the Event
         Management revision pass below (§0q), in favor of exception-only
         classification pills plus the ••• menu. Notes moved from an
         inline textarea to an icon button (openNotes()/confirmNotes())
         that opens a small popup and fills green once a note exists —
         this keeps the collapsed row scannable at a glance; the roster's
         ••• menu now provides a second entry point to the same flow.

     0j. Course Materials rows were stripped to the essentials this pass:
         no separate Hidden/Visible pill (the toggle switch already shows
         that), no topic or engagement metrics under the title (title +
         material type only), and no per-row notification-status pill or
         Resend button — just one timestamp cell reading "First shown
         {time}" once released, or a failure state ("Send failed — retry")
         for the one demo row that simulates a failed dispatch. The
         explicit resend_material_notification action is gone from both
         the UI and the allowlist; re-hide/re-show still behave per §8.1/
         §8.2 (no automatic duplicate message), they just don't expose a
         manual "send it again" control anymore. The inline Release-audit
         list was also removed — logAuditRelease() is now a no-op stub,
         same pattern as logAudit() after the drawer was removed.

     0k. Dropdown fields (the guest's IA/OOA/ONL locale, formerly the
         Seminar/ADV. CRS selects) are styled to carry no visible chrome —
         no border, no native arrow — so they read as plain data at rest
         and only reveal that they're editable on hover/click, matching
         how every other inline-editable field on these cards behaves.
         Spouse and the guest's inviting-Participant field follow the same
         principle one level further: a type-to-filter combobox (see §0g)
         that looks like plain text (or a muted "Not associated" prompt)
         until clicked.
     ============================================================================
     EVENT MANAGEMENT ROSTER — exception-first revision pass
     Everything below (§0l–§0t) is new for this pass and applies to the
     roster (#ms-roster) only. The Guests tab is explicitly unchanged and
     out of scope — every §0a–§0k note above still describes it accurately.
     Design contract: the roster is a live exception-management interface
     over an Event's Registration records. Normal conditions stay visually
     quiet; exceptions get visual priority. Viewing a pill is always one
     click; a write requires an explicit second click (an Edit/Override CTA
     inside that pill's popover, or a ••• action) — never a raw inline
     control sitting in the monitoring surface. Absence of a pill = the
     normal/false state; no "NOT REV," no "NOT SE." When normalized
     booleans contradict each other (e.g. Designated AND Alternate both
     true), the UI surfaces a data-quality exception rather than guessing
     which one the CS meant.
     ============================================================================

     0l. Course Status (ACTIVE/LDP/NSHO) is a new, assumed-not-confirmed
         field, distinct from per-day Attendance. Structure: Left Course?
         (Y/N) → Left Type (LDP or NSHO only — no "Other" until a real
         business status is confirmed for it) → Day/Time/Leave Reason.
         WBO is explicitly a derived subtype of LDP (WBO ⊂ LDP), never a
         peer top-level status and never a field the CS sets directly —
         it's read off the chosen Leave Reason. LDP/NSHO replace ACTIVE in
         the UI rather than co-displaying (see confirmCourseStatus()).
         Explicit save-time behavior: reverting Left Course? to No clears
         Left Type/Day/Time/Leave Reason/WBO and restores ACTIVE — the
         dashboard does not need to retain the obsolete values for
         history; that history belongs to the backend audit trail
         (logAudit() documents the intended shape), not to stale fields
         the live UI hangs onto. Setting Left Course? to Yes requires Left
         Type + Day + Time + an approved Leave Reason before the write is
         considered valid. Attendance is now multi-day (§0m below), so any
         real set_attendance_status-equivalent action needs a Day
         parameter it didn't need in the single-status model at §0d.

     0m. Attendance and Completion are two separate new concepts, neither
         resembling the old Present/Late/Absent/Left/Excused model at §0d.
         Attendance (D1/D2/D3 ticks) is Zoom-sourced evidence, disclosed
         read-only via the tick's popover (Attended/Minutes/First Join/
         Most Recent Leave/Join Count/Match) — there is deliberately no
         "Late" state yet, since Late has no locked business rule; ticks
         use attended/not-attended/pending/needs-review only, and
         not-attended only renders once that day's window has actually
         closed (a zero-minutes-so-far mid-session participant stays
         pending, not implied-absent). Completion (S3/S4 checkpoints) was
         originally scoped as two Day-3-only Event-level actions —
         run_d3s3_checkpoint_poll, run_d3s4_attendance_poll — behind the
         old runCheckpointPoll() stub and its "Checkpoint Attendance" /
         "Attendance Check" header buttons. SUPERSEDED 2026-08-12 by the
         real Attendance Architecture Layer 2 build: a single "Take
         Attendance" button + Session (S1-S4) floating menu, spanning all
         three Days (not Day 3 only), Day always resolved server-side from
         events.f3025 — see openTakeAttendanceMenu()/confirmTakeAttendance()
         and CS Dashboard : Take Attendance (n8n). Never a generic browser-
         settable per-participant field; the browser must never be able to
         directly flip completion true for an arbitrary participant.
         Completion visibility is
         gated by the same current-session signal the header already
         computes for Day X of Y (§0c) — it should not appear at the start
         of Day 3 before the actual D3S3/D3S4 session window is reached.
         An out-of-order checkpoint result (S4 resolved before S3) is a
         display exception only; nothing here validates data integrity
         server-side. bulkMarkPresent()/"Mark all present" was removed
         from the roster header — it contradicted attendance now being
         Zoom-sourced rather than something the CS sets by hand.

     0n. Device/Zoom exception state is associated with the participant's
         Registration; exact storage fields are unconfirmed pending the
         live schema — no new custom object is being proposed. Two
         distinct UI signals map to (presumably) two distinct field
         values, not one: a passive, informational .device-flag (known
         shared device / known duplicate device — no CS action implied)
         versus an elevated .zoom-flag ("Needs Review" — an unresolved
         identity/match problem). Only the elevated flag drives the
         conditional "Resolve Zoom Match" kebab item (openRowMenu()).
         mDeviceException's four sub-actions have distinct, directional
         effects rather than one uniform set/clear: "Shared device" and
         "Duplicate device" only ever touch the passive flag; "Resolve
         duplicate identity" is reachable only because Needs Review is
         already true and CLEARS it; "Other Zoom exception" is how a new
         unresolved condition gets logged and SETS it. The Master Stats
         reconciliation card's Shared-device/Duplicate-device adjustment
         tiles should eventually derive specifically from the passive
         .device-flag state — never from the elevated needs-review
         signal, which is a separate data-quality condition and doesn't
         belong in the Expected/Observed device arithmetic (it's a
         candidate for its own distinct "Needs Review" count on that card
         later, not a substitute input into the existing tiles). The
         pilot's static reconciliation numbers are a placeholder for that
         eventual rollup.

     0o. Scholarship (SCH) is a brand-new classification concept, assumed
         not confirmed, derived from payment data (Amount Paid = $0.00 on
         the registration/payment record) — not a boolean the CS sets.
         It is deliberately excluded from the Override Classification
         field list (§0s): if the underlying financial data is wrong,
         that's a financial/registration correction outside this UI's
         scope, not a Forum-room classification override. There is no
         set_scholarship action in the allowlist below for that reason.
         The Scholarship pill is still clickable like every other pill —
         disclosure is always available — its popover simply has no Edit
         CTA.

     0p. Follow-On (Seminar / ADV. CRS) data-modeling principle for the
         roster: Registration stores the decision and relationship —
         Seminar/AC Potential? Y/N, Confirmed? Y/N, Registered? Y/N,
         Designated? Y/N, Alternate? Y/N, and a reference to the selected
         course/seminar choice. Descriptive detail (name, dates, location)
         is read from that related record — an existing Registration
         course-choice relationship, or a related Course/Event record —
         never copied as flat fields onto every Registration (no "Seminar
         Date 1," "Seminar Date 2," etc.). This is a modeling constraint
         for the future real data-binding pass; the static demo can only
         demonstrate it in the popover copy (see applyFollowOnLadder() and
         the data-pop-kv wording on each prog-seminar/prog-ac pill), not
         literally enforce it. State-priority ladder: NP → POT → CONF →
         REG — the pill only ever displays one of these four states; a
         later revision dropped the ·DES/·ALT text modifier from the
         visible pill entirely (Designated/Alternate is disclosure detail,
         available in the popover via data-desig/data-alt, not something
         the compact pill itself needs to narrate). Only the single
         highest true state renders; the underlying booleans persist as
         data attributes for reporting even when the UI stops narrating
         the full
         progression. Guard cases the derivation must not guess past:
         Registered with neither Designated nor Alternate set is a valid
         plain REG, not an error; Designated and Alternate both set
         simultaneously is a data-quality contradiction, rendered with the
         .p-dataerr treatment (REG · ⚠) instead of being concatenated.
         The Edit link on a Follow-On pill (routing to Override
         Classification, preset to Seminar/AC Potential) appears only at
         the POT/NP stage — once the pill has advanced to CONF/REG/
         REG·DES/REG·ALT/REG·⚠, its popover is read-only, so the CS is
         never offered an Edit affordance that would secretly still be
         correcting a different, upstream field than the one displayed.
         Potential correction stays reachable at any ladder stage through
         ••• → Override Classification directly.

     0q. TOS/18+/ENG and the inline REV/POT/SE toggle-chip + chevron/expand
         mechanism (§0i) were deliberately retired from the roster this
         pass. Ontraport may still track TOS/18+/ENG elsewhere (other
         surfaces/reports) — they're simply not surfaced on this card
         anymore. Classification is now read-only-until-exception (empty
         when false, a colored pill when true) plus kebab-driven
         corrections, so there's nothing left on the roster to hide behind
         a chevron. [CORRECTED 2026-08-13: this originally said
         toggleCardExpand()/.ev-pills remain in this file because the
         Guests tab still uses them — false by the time this was checked.
         The Guests tab was later redesigned to static, non-interactive
         chip markup (per the Guests-tab build pass), which never calls
         toggleCardExpand(). Confirmed zero call sites anywhere in the
         shipped files; both the function and the .ev-pills/.ev-chevron
         CSS were removed entirely on 2026-08-13.]

     0r. House rules for the roster surface, restated as implementation
         requirements: absence of a pill = normal/false state (no
         always-visible negative badges); exceptions visually outrank
         normal (elevated color + shadow on LDP/NSHO/an unresolved Zoom
         match, versus a quiet gray ACTIVE); when normalized booleans
         contradict, surface a data-quality exception instead of
         inferring intent (§0p's .p-dataerr is the template — the same
         instinct applies to an out-of-order Completion checkpoint or
         conflicting Zoom evidence on an attendance record, not just the
         Follow-On ladder). ACTIVE is still rendered as a quiet pill in
         this demo so the design is legible; it's a candidate for full
         suppression in production under the same absence-as-default rule
         once the pattern is validated live.

     0s. Classification override scope: Reviewer, Statistical Exclusion,
         Seminar Potential, and Advanced Course Potential are all
         CS-correctable — but only through the one shared Override
         Classification modal (openOverrideClassification(), reached via
         a pill's Edit link or the ••• menu), never as a raw inline
         toggle. Reviewer is automatically populated but CS-overridable
         (unlike the read-only assumption in an earlier draft of this
         pass) — its popover does carry an Edit CTA. Scholarship is
         excluded from this set per §0o.

     0t. Participant Sharing ("Shared") is intentionally out of scope for
         this revision, pending a separate CS workflow discussion —
         removed from the roster row entirely rather than carried forward
         by default. [CORRECTED 2026-08-13: this originally said
         mark_shared/toggleChip() remain in this file for the Guests tab —
         false by the time this was checked. toggleChip() had zero call
         sites anywhere in the shipped files (the Guests tab's chips moved
         to static markup in a later redesign) and was removed 2026-08-13.
         mark_shared itself was never called from anywhere in this build —
         see the server-side allowlist note below, still accurate.] Spouse is relocated
         from the row into the View Participant Details drawer
         (openParticipantDrawer(), first real use of the .dw component —
         see §11/LAYERS below for why it was otherwise unused), alongside
         the participant's name, which also moves from an inline-editable
         row field to an "Edit Name" affordance inside that same drawer —
         the roster row itself has no editable text fields left at all.

     0u. Participant Details drawer additions: Contact (Email, Phone,
         Preferred Communication), Join Link, and Information Form are all
         new, assumed-not-confirmed concepts, read-only in this drawer
         (none of them are CS-write surfaces). Contact's Email/Phone are
         read from the Contact record; Preferred Communication defaults
         to Email for
         every participant — the registration export this pilot's roster
         identities were seeded from had that column present but blank on
         every row, with only the column header itself ("Prefered
         Communication (Email") implying the intended default — confirm
         the real field and whether other channels (SMS, phone) are
         actually offered before treating "Email" as settled. Join Link is
         a single Event-wide Zoom join URL personalized via a per-
         registrant tracking query parameter (EVENT_ZOOM_JOIN_BASE +
         &tk=<Registration ID>) — the real mechanism for a unique
         per-participant join link (if one exists, vs. a shared Event
         link) is unconfirmed. Information Form mirrors an existing
         participant-facing intake form (Emergency Contact Name/Phone/
         Relationship, Coaching Call Availability, Agreed to Registration
         Policies/Privacy Policy/Terms of Use, Information Form Completed,
         free-text "Anything you'd like us to know," Dietary Restrictions/
         Special Needs, Forum Participants You Know, What I Want to
         Accomplish) — assumed to live on Contact or a related intake-form
         object, fields unconfirmed; demo content is one fictional
         placeholder set shown for every participant, not real submitted
         data. Roster identities (name, PID stays synthetic, email) for
         this pilot were seeded from a real Ontraport registration export
         for this Event — production must never hold real participant PII
         (names, personal emails) in a client-side file with no access
         control; this pilot file is a local working demo, not something
         to publish or share as-is.

     0v. Row layout revision (visual only — no change to the underlying
         data model or write actions in §0l–§0u): the Status pill (ACTIVE/
         LDP/NSHO) moved out of the trailing Exception/Actions zone and
         now sits inline with the name — "Name – STATUS" (.ev-name-row) —
         so the CS reads identity and standing together at a glance. The
         Exception/Actions zone now holds only the optional device/zoom
         flags plus the ••• trigger; confirmCourseStatus() and
         openParticipantDrawer() read/write the status pill from
         .ev-name-row accordingly, not .ev-exception. Classification moved
         to be the first column after Identity (previously it sat between
         Completion and Seminar) and now carries a permanent "Classification"
         header — a deliberate, requested exception to the absence-as-
         default rule (§0r): the column label itself always shows, only
         the pills inside it are absent when nothing applies. Completion
         was renamed "CPLT CHKPNT" and now always renders S3/S4 as greyed
         "not yet reached" ticks rather than nothing, matching the
         always-visible-but-quiet treatment Attendance's D1/D2/D3 ticks
         already had, instead of rendering empty until the checkpoint
         window opens. The passive .device-flag and elevated .zoom-flag
         indicators also moved — out of the trailing Exception/Actions
         zone (which has no column header) and into the Identity zone's
         secondary line (.ev-sub), next to Locale/Guests, so every item on
         the right side of the row sits under an actual column header.
         Both are now clickable buttons wired through the same
         openDetailPop() anchored-popover mechanism as every other pill
         (data-pop-title/data-pop-kv), replacing the native-title-attribute
         hover this pattern started with — one consistent disclosure
         mechanism across the whole row, not two.

     0w. Classification reverses the absence-as-default rule (§0r) by
         explicit request: it now always renders five fixed slots — MNR
         (Minor, new/unconfirmed, no CS write path yet), REV, SE, AC-NP,
         SEM NP — greyed (.p-slot-off) when inactive, colored when active,
         rather than showing nothing until something is true. Pills are no
         longer inserted/removed by confirmOverrideClassification(); they
         always exist in the DOM and only toggle their active class and
         data-pop-kv. AC-NP/SEM-NP are derived, not independently stored —
         syncNpFlag() keeps them mirroring whatever applyFollowOnLadder()
         just computed for the Seminar/AC pill (active exactly when that
         pill reads NP), so they can never drift out of sync with the
         Follow-On column. Scholarship (SCH) is deliberately NOT one of
         the five slots — it stays conditionally rendered per §0o, since
         it's derived/read-only and not part of the CS-correctable set §0s
         describes. The label + pill row also changed from side-by-side to
         stacked (label on top, pills below), matching how every other
         zone already presents its column header over its content.

     0x. HOME — new pre-Forum landing page, added as its own pass in
         front of the three existing destinations (out of scope for
         the Event Management/Master Stats/Reporting Dashboard
         revision above). The CS lands here first, sees one card per
         Event they're authorized on (oEventTeam, same resolution as
         §2), and only reaches the Event Management/Master Stats/
         Reporting Dashboard chrome by clicking Start Event on a card
         (startEvent() → go('em')). That chrome (evt-sel/evtstrip/
         tabbar/secnav) is fully hidden while on Home (body.home in
         CSS), not just scrolled past — it has no meaning before an
         Event is entered. Ending the session (confirmEndSession(),
         unchanged otherwise) now also returns to Home and flips the
         card's status pill to "In Progress"; that pill state is
         demo-only (a DOM class toggle), not persisted — a real
         implementation needs an actual Event status field (Not
         Started/In Progress/Completed) written through the same
         secure write service as everything else, not inferred
         client-side. "188 Participants · 18 Not Ready" on the card is
         a static demo caption; production would derive both counts
         from the same registration list the roster below reads.

         The card's ••• menu (View Roster / Show Exceptions / View
         Assignments) opens a NEW, purpose-built, read-only roster
         view (openHomeRoster(), #mHomeRoster) — this is deliberately
         NOT the Event Management roster and does not reverse §0q
         (TOS/18+/ENG stay dropped from that in-session surface). This
         is a pre-Forum readiness gate: same 188 registrations,
         reduced to Participant / TOS / FIF / Notes. TOS and FIF are
         assumed-not-confirmed prerequisite flags — TOS presumed to be
         the existing Agreed to Terms of Use field (§0u's intake
         form), FIF presumed to be Information Form Completed (also
         §0u) under a different abbreviation; confirm both before
         wiring real data. Absence of either flag means the
         participant "is not supposed to be in the forum" per the
         brief, and drives a derived tag in the same inline-with-name
         slot the roster uses for its Status pill (§0v): READY when
         both are active (quiet/neutral, matching the absence-as-
         default instinct in §0r — nothing to see when everything's
         fine), NEEDS ATTENTION (elevated coral, native title-
         attribute hover naming the missing prerequisite — the
         simpler pre-§0v hover mechanism, not the shared popover,
         since this view has no other disclosure need) when either is
         not. Show Exceptions is the identical modal/markup filtered
         client-side to NEEDS ATTENTION rows only (openHomeRoster(true))
         rather than a second copy. View Assignments (#mAssignments)
         lists the same items as Course Materials (#ms-release) but
         purely to browse/open — no release toggle, no write path;
         clicking an item does not close the modal, so more than one
         can be opened before the CS closes it manually, per the brief.

     0y. Course snapshot metrics as roster filters — Event Management's
         em-snapshot only (ROSTER_STAT_FILTERS, applyStatFilter()).
         Master Stats' ms-snapshot is deliberately left non-interactive:
         it has no roster beneath it to filter, and stays numbers-only
         per §0b/the page's own "No editing happens here" lede — this
         isn't an editing action, but click-to-filter is still an
         Event-Management-only interaction to keep that boundary clean.
         Each predicate reads a signal already rendered on the card
         (course status pill, classification pill, prog-seminar/prog-ac
         text, attendance/checkpoint tick class) — nothing new is
         tracked. Starts (Day 1)/Attendance now key off the D1/D2
         attendance tick; Completions keys off S3/S4 not being
         tk-pending (matches nobody yet in this demo, same as the "not
         started" caption already said). Invitations sent, Final
         Session expected, and Material released are NOT wired to a
         filter — none of them is a per-registration boolean the roster
         row actually carries (invitations are an oInvitation/guest
         concept; the other two aren't modeled per participant here) —
         rather than fabricate a predicate, they were left as plain,
         unclickable stats.
     ============================================================================

     ROLE / ACCESS RESOLUTION (§2)
       Event Leader   → oEvents(10000).Event Leader(f2397) → Contacts(0)
       Course Supervisor → oEventTeam(10007): Contact(f2788)→Contacts,
                            Event(f2789)→oEvents, Role(f2790)=306
       Resolution is per-Event. Access to Event A never implies Event B.
       A global "Leadership Access" checkbox is a coarse portal-entry
       helper only — it is not an event-level Revenue authorization.
       Event Management is the same audience as Master Stats (Course
       Supervisor) — it is the roster/guest/material editing surface that
       Master Stats used to carry; Master Stats is now numbers-only.

     DATA OWNERSHIP (§7) — what gets edited where
       UI concept                                   Authoritative object   Why
       Name Likes / preferred identity               Contact                Identity follows the person across Events
       Attendance / Left / WBO / Reviewer / SE /      oRegistration          Status belongs to one participant in one Event
         Seminar / AC / completion
       Guest attendance / registration / inviter      oInvitation            Guest activity is invitation/event-specific
       Participant resource URLs + release state      oEvents (fixed set)    Varies by Event; no Resource custom object for pilot
       Course-team evergreen resources                oCourses               Assets that don't vary by Event
       Role assignment                                oEventTeam             One Contact working one Event in a role
       Revenue / financial facts                       Existing financial     Read-only on KPI; never editable from Master Stats
                                                        objects / derived reporting
       Course Status (ACTIVE/LDP/NSHO), WBO           oRegistration          Assumed, unconfirmed (§0l) — same object as
         (derived), Completion / checkpoints                                 existing Attendance/Left, not a new object
       Scholarship (derived, read-only here)          Payment / financial    Derived from Amount Paid = $0.00 (§0o); never
                                                        record                 written from this UI
       Device/Zoom exception (per participant —       oRegistration          Assumed, unconfirmed (§0n); passive/elevated
         passive .device-flag vs. elevated .zoom-flag)                       are two distinct fields, not one
       Device/Zoom reconciliation aggregates          oEvents / derived      Event-level rollup, eventually derived from
         (Couples, Shared/Duplicate-device adj.,       reporting              per-Registration device-flag state (§0n) —
         Expected, Observed, Reconciled)                                     never stored per participant
       Join Link, Preferred Communication              Contact / oRegistration Assumed, unconfirmed (§0u); read-only in the
                                                        (unconfirmed which)     drawer, never a CS-write surface
       Information Form responses                     Contact / related      Assumed, unconfirmed (§0u); an existing
                                                        intake-form object     participant-facing form, not new collection
       TOS / FIF prerequisite flags (Home roster only) oRegistration          Assumed, unconfirmed (§0x) — presumed to be
                                                                               the Agreed to Terms of Use / Information Form
                                                                               Completed fields from §0u, read-only here;
                                                                               does not reverse §0q's removal from the
                                                                               Event Management roster
       Event status pill (Not Started/In Progress/     oEvents                New, unconfirmed (§0x); this demo holds it
         Completed)                                                          in the DOM only, never persisted
       Guardrail: do not store event-wide metrics as if they belong to an
       individual EventTeam member — EventTeam is authorization/assignment
       only. Event-level results derive from event/registration/invitation/
       financial records.

     SEMANTIC ACTION ALLOWLIST (§6.2) — the write endpoint accepts named
     actions, never arbitrary Ontraport field IDs. Each maps server-side
     to a fixed object, fixed field(s), validation rule and permission
     requirement; everything else is denied.
       update_name_likes                → Contact.Name Likes (roster: called from the View
                                           Participant Details drawer now, not an inline
                                           row field — §0t)
       set_attendance_status            → Guests tab only now (§0d); the roster's Zoom-
                                           sourced attendance has no equivalent write action
                                           yet, only the placeholder correct_attendance below
       set_reviewer / set_statistically_excluded /
         set_se_reason                   → oRegistration classification fields. On the
                                            roster these are called only through Override
                                            Classification (openOverrideClassification(),
                                            §0s), never a raw inline toggle; set_se_reason's
                                            Guests-tab reason-popup equivalent (openSEReason())
                                            is unchanged and separate (§0d/§0t)
       set_seminar_potential / set_ac_potential → oRegistration Potential flags, one per
                                            program (§0p) — replaces the single generic
                                            set_potential this allowlist used before the
                                            Follow-On ladder was split per-program
       set_18_plus / set_translation_need /
         set_english / mark_shared        → retained server-side; not called from the
                                            roster this revision (§0q TOS/18+/ENG dropped
                                            from this UI; §0t Shared pending a separate CS
                                            workflow discussion) — Guests tab still calls
                                            the guest-scoped equivalents below
       set_spouse                        → link between two oRegistrations (or Contacts —
                                            confirm per §0g) for household reporting; on the
                                            roster, called from the View Participant Details
                                            drawer now, not an inline row field (§0t)
       set_guest_participant             → oInvitation → oRegistration inviter link (§0g)
       mark_seminar_registered /
         mark_ac_registered             → oRegistration registration flags — backend/sync
                                           only; the UI displays the Follow-On ladder (§0p),
                                           it does not call these directly
       set_ac_alternate                 → oRegistration.Designated Alternate
       set_course_status                → oRegistration Course Status fields — Left Course?/
                                           Left Type(LDP·NSHO)/Day/Time/Leave Reason; WBO is
                                           derived from Leave Reason, never a separate write
                                           (§0l). No "Other" Left Type until confirmed.
       run_d3s3_checkpoint_poll /
         run_d3s4_attendance_poll        → Event-level Zoom poll actions (§0m) — return an
                                           aggregate result; never a per-participant
                                           browser-settable completion flag
       record_device_exception          → oRegistration device/Zoom exception state (§0n),
                                           object/fields unconfirmed — no new custom object
                                           proposed; carries a sub-type distinguishing the
                                           passive .device-flag pair (shared/duplicate
                                           device) from the elevated .zoom-flag pair
                                           (resolve/log an identity-match problem)
       (no set_scholarship action — Scholarship is derived from payment data and is not
        CS-settable from this UI; see §0o)
       set_guest_potential / set_guest_se /
         set_guest_18_plus / set_guest_tos /
         set_guest_english / set_guest_after730 /
         set_guest_attend / set_guest_locale /
         set_guest_lf_grad / mark_guest_registered → oInvitation guest fields
       release_material / hide_material → oEvents resource Visible / Released At / Notification Sent At
                                           (no resend_material_notification action in this revision — §0j)
       (no set_tos / set_fif action — the Home roster (§0x) is read-only; TOS/FIF are
        surfaced from existing data, never edited from this view)

     TARGET VALIDATION (§6.3) — required before any write
       oRegistration        → Registration.Event = current authorized Event
       Related Contact       → Contact must be linked from an oRegistration
                                belonging to the current authorized Event,
                                unless the action is explicitly staff-self-service
       oInvitation / guest    → Invitation linked to current Event / registration
       oEvent resource state  → Event = the Event authorized by the actor's
                                oEventTeam record

     MATERIAL RELEASE FIELDS (§8) — per participant-facing resource, kept
     on the existing oEvents resource fields rather than a new custom object
       url                    Existing/gap URL field
       visible                New checkbox — default false except explicit Always/Prep resources
       released_at            Timestamp of first visible transition
       notification_sent_at   Timestamp after successful first-release notification
       release actor          Captured in the audit log, not repeated per resource

     [CORRECTED 2026-08-13 — see note below before reading this section]

     FIRST-RELEASE SEQUENCE (§8.1) — CS clicks Show → confirmation shown
     → service re-validates CS/Event permission → Visible=true, Released
     At set if empty → resolve audience (active oRegistrations for this
     Event → related Contacts) → email all eligible, SMS only where SMS
     Consent=Yes and a valid number → notification links to the portal,
     never the raw external URL in SMS → Notification Sent At set only
     after dispatch succeeds; failures are logged for retry/review →
     portal renders the resource immediately. Re-hide (§8.2) sets
     visible=false and sends nothing; re-show does not re-notify because
     Notification Sent At is already populated. This revision removed the
     explicit resend action from the UI (§0j) — if operations later prove
     they genuinely need to send a second message, that's new scope, not
     something to route through re-hide/re-show.

     CORRECTION (2026-08-13): the "confirmation shown" step above described
     a confirm-are-you-sure modal (relToggle()/confirmRelease()/
     confirmRehide()/confirmReshow() in the demo file) that was the actual
     shipped behavior through 2026-08-12. Per a direct client instruction
     that day ("every toggle usable immediately, no confirm dialog" — the
     walkthrough needed instant writes), production replaced this with
     directToggle(): toggle-on checks the field, toggle-off unchecks it,
     no confirmation step, same optimistic-update/revert-on-failure safety
     net as everywhere else in the build. The old modal flow's code was
     removed entirely on 2026-08-13 (dashboard-engine.js, INSTALL-dashboard-
     body-block.html). Everything else in this sequence — audience
     resolution, email/SMS dispatch rules, Notification Sent At semantics,
     the removed resend action — is still accurate; only the "confirmation
     shown" step is stale.

     LAYERS (§6)
       Ontraport portal page   → authenticated UI, current Event context,
                                  roster display, edit controls, optimistic/
                                  success/error states
       Secure write service    → authenticate/resolve actor from an event-
       (n8n webhook recommended) scoped, revocable credential (never a
                                  client-supplied Contact ID) → authorize
                                  for Event → validate target → map action
                                  to whitelisted field(s) → write via
                                  Ontraport API → log audit result
       Ontraport API            → authoritative persistence
       Audit store               → actor, target, old/new values, time,
                                   action — durable, server-side

     NOT REPRESENTED IN THIS DEMO (backend/security-only, brief §11)
       - Cross-event tamper test (write service denies mismatched Event)
       - Arbitrary-field tamper test (write service denies non-allowlisted fields)
       - Revoking a browser-held client identity credential
       - Concurrent-edit "server result wins" resolution