# Pilot Participant Portal — Build Specification v2

**Pilot Participant Portal — Build Specification v2**

For: Chris   |   Owner: Tobin   |   July 18, 2026   |   Companion to “Pilot Dashboard — Build Spec v2”   |   v2 change: resource delivery uses FIELDS on existing objects (no new custom object), and Course Supervisor materials move fully in-portal.

**Sources:** the CRT (Course Resource Timeline — Stesha’s per-event sheet defining every resource, which session it belongs to, and who uses it; example analyzed: CRT 256314, Chicago 15-May-26), the live Sites inventory in OP (17 dynamic templates \+ 6 static pages), the OP object schema, and Kate’s pilot decisions. Same rules as the dashboard spec: plain language, jargon defined where used, additive schema changes only, working by August 3 for the August 14 pilot.

# **1\. What you are building**

The participant-facing side of the Landmark Portal: everything a course participant sees from registration through graduation — plus the guest-facing pages their invitations point to. Most of it already exists as dynamic templates; your job is one new subsystem (resource delivery), two template completions, content alignment, and cleanup. This spec gives a verdict on every existing page.

* **The new thing:** The heart of this spec: participants get different materials on different days, and today that schedule lives in a spreadsheet (the CRT) that humans re-transcribe into pages per event. We are turning it into data that pages render automatically. Section 4\.

* **Already done:** The invite hub is BUILT and LIVE. Checkout is BUILT (pilot versions live). Guest enrollment flows are LIVE. Do not rebuild working things.

# **2\. Glossary (additions to the dashboard spec glossary — both apply)**

| Term | What it actually means |
| :---- | :---- |
| CRT (Course Resource Timeline) | A per-event spreadsheet listing every resource a course needs: name, category (Workbook, Handouts, Slides, Manuals, Registration Opportunity, etc.), type (PDF, URL, Video, Form), link, and which session it belongs to. Today it is filled and QA’d by hand for every event. |
| Session codes | Which session a resource belongs to: 1, 2, 3 \= course days; ES \= the final evening session; FORW \= the whole course (always available). |
| Resource release / session gating | A resource “tagged Session 2” should appear to participants when Day 2 opens — not before. Note the pattern in the CRT: the Day 1 Letter is tagged Session 2 (it is a recap released AFTER Day 1). Gating follows the tag, no cleverness needed. |
| Registration Opportunity | CRT category for the money/enrollment resources: seminar schedule \+ selection, Advanced Course flyer \+ registration links, dates of upcoming Forums. These surface at Day 3 and the Final Session. |
| reid links | Landmark’s corporate registration URLs carry ?reid=\<event id\> so registrations attribute to this event (e.g., advanced-course-online?reid=256314). The portal must always emit these with the current event’s ID — never hardcoded. |
| Invite hub | The built-and-live OP flow where participants invite guests (Forum) and graduates (Grad courses). Every invite is an oInvitations record — this is what feeds the dashboard’s invitation counts and guest tracking. |
| Student Portal | The logged-in participant home page (dynamic template, LIVE). This spec makes it the container for resource delivery. |

# **3\. The participant journey (what shows when)**

Six phases. Each phase lists what the participant sees; pages named here get verdicts in Section 5\.

| Phase | What the participant sees / does |
| :---- | :---- |
| A. Register | Checkout (pilot version, LIVE) → choose Forum date → Success \+ T\&C’s → Registration Complete. Creates the oRegistrations record. |
| B. Prepare (registration → Day 1\) | Student Portal home: course overview, dates/times, Information Form (emergency contact, dietary, what-I-want-to-accomplish — fields already on oRegistrations), “Can’t attend first session?” request, workbook link, emergency/tech-support contact info, and the Invite a Guest button (visible from day one — building guest momentum early is pilot strategy). |
| C. In course (Days 1–3) | Student Portal shows session-gated resources as they release: Day N assignment \+ course materials pages, recap letters (Day 1 letter appears with Session 2, etc.), course materials video. Day 2: Vanto info \+ Communication Course interest (per CRT). Day 3: Advanced Course flyer/video \+ registration opportunities begin. |
| D. Final Session (all-online) | Join details, celebration framing (Kate: “it’s graduation — two hours, about them, not sales”), invite hub prominently, guest arrival via personalized invitation links. |
| E. Register into what’s next | Seminar schedule \+ selection (free, included), Advanced Course registration (reid links; window through the Saturday after the Final Session), designated vs alternate presented clearly. |
| F. Graduate | Grad invitations (invite hub, grad flavor), upcoming Forum dates for their guests, grad course signup. |

# **4\. Resource delivery — fields on existing objects, no new object**

Every Landmark Forum uses the same resource set, so resources are FIELDS, not records — and most participant-facing ones ALREADY EXIST on oEvents (verified against live meta July 18). (An earlier draft proposed a custom object; rejected. It remains the post-pilot upgrade only if resource sets start varying per event or translated variants multiply.)

## **4.1 Participant resources — VERIFIED, mostly already built as fields on oEvents**

* **Existing (bind, don’t create):** Workbook URL (f2708) · Materials Video URL (f2709) · Day 1 Materials URL (f2710) · Day 2 Materials URL (f2711) · Day 3 Materials URL (f2713) · Day 1 Letter URL (f2712) · AC Materials URL (f2714) · Zoom links: Participants (f2469) / Guests (f2470) · Registration Support Phone (f2750) · Registration Contact Person 1/2 (f2751/f2762) · Seminar Display (f2760: Designated/Secondary/Hidden — designated-seminar handling already exists) · Session Dates (f2753) \+ Session Start/End Times (f2754/f2755) \+ Calendar Time Zone (f2757).

* **Gaps to ADD on oEvents:** Day 2 Letter URL · Vanto Info URL · Vanto Announcement URL · Communication Course Interest URL · Upcoming Forum Dates PDF URL · Current Released Session (none/1/2/3/ES — the gating field; CS advances it one click from Master Stats).

* **Existing on oCourses:** Day 1–6 Course Summary (f2412–f2417) and Day 1–6 Homework (f2418–f2423) rich text on oCourses — evergreen content the Student Portal renders alongside the day’s resource links.

## **4.2 Course Team resources — new field group on oCourses (evergreen; never varies per event)**

* \~35 URL fields in day-grouped sections: CS slide decks (D1/D2/D3/ES) · WEDO manuals (D1/D2/D3/FS) · timeline · launch/admin manual · breakout manager doc · policies · bulletin board · CMP manual · breakdown report form · Mentimeter links · music/loop files · timer videos (D1–D3 × B1–B3) · session videos (ES, AC, Vanto) · tech support materials. On oCourses (not oEvents) so nothing is re-entered per event.

* reid links are NEVER stored per event: base URL \+ this event’s ID merged at render time.

* Note the existing stat rollups on oEvents (Participants Day One f2689, WBO f2690, \# Left Course f2294, AC Potentials/Registrations f2691/f2692, guests-per-100 f2306/f2307, invitation rollups) — the dashboard build reuses these; do not create duplicates.

## **4.3 Rendering**

* **Participants:** Student Portal: hardcoded sections bound to the participant fields, each section gated by Current Released Session (Day 1 Letter sits in the Session-2 section, per the CRT). Fixed resource set \= fixed sections; nothing dynamic to build.

* **Course Supervisors:** Master Stats gets a “Course Resources” production panel (role-gated by the existing oEventTeam rule): tabs per session (Prep / Day 1 / Day 2 / Day 3 / Final Session / Always) with one-click launch of every Course Team asset — decks open, videos play, forms submit, all in real time from inside the portal. The CRT Google Sheet is RETIRED as a CS working surface; it survives only as the one-time seeding source for these fields.

* **Guests:** Guest-audience links (upcoming Forums, promo reid URLs) render on the guest-facing pages, Section 5\.

Pilot seeding: populate the course/event fields once from the pilot CRT (Chris or Tobin, \~an hour). After that, no per-event transcription ever again.

# **5\. Page inventory — verdict on every existing page**

## **5.1 Dynamic templates (the real portal) — 17 total**

| Template (status) | Verdict | Notes |
| :---- | :---- | :---- |
| PORTAL : My Courses : Student Portal (LIVE) | EXTEND | Becomes the resource-delivery container (Section 4). Keep everything that works; add the category-grouped, session-gated resource sections \+ Information Form status \+ invite button. |
| REG : Registration : Overview (LIVE) | KEEP | Verify copy matches pilot framing. |
| PORTAL : My Courses : Course Overview (LIVE) | KEEP | Evergreen course info; verify pilot dates render from the event. |
| PORTAL : My Account / Profile / Security ×3 (LIVE) | KEEP | Untouched. |
| REG : Checkout Step 03 Success \+ T\&C’s / Step 04 Complete (LIVE) | KEEP | Pilot checkout chain is live; verify T\&C content current. |
| INV : Guest : Invitation Form (LIVE) | KEEP | The invite hub. Feeds oInvitations → dashboard counts. Do not touch mechanics. |
| INV : Guest : Forum / Graduate Enrollment Conversation ×2 (LIVE) | KEEP \+ VERIFY COPY | Guest-facing landing per invitation. Copy must match celebration framing — no hard-sell. Kate reviews copy. |
| DISC : Guest Checkout : Guest Forum Signup (LIVE) | KEEP | This is where \# LF Registrations come from. Verify the registration timestamp lands on the oInvitations record (dashboard needs the midnight cutoff). |
| REG : Course Reg : Participant Advanced-Seminar Signup (LIVE) | ALIGN | Must present Designated vs Alternate clearly, write “Which Seminar/AC” \+ AC Reg Date to oRegistrations (dashboard spec §3.2), and honor the Saturday-after cutoff. |
| REG : Course Reg : Grad Guest Advanced Signup (LIVE) | KEEP | Verify attribution to oInvitations. |
| SEM : Selection : Available Seminars (WIP) | FINISH — P0 | Replaces the CRT’s external seminar-selection links (SEMSCHED / SEMSELCONF): in-portal schedule \+ one-click selection writing f2303 \+ Which Seminar. |
| INV : Bring a Buddy : Invitation Form (DRAFT) | FINISH — P0 if BaB is in pilot pricing | BaB price is in Kate’s PCR price types, so presumably yes — confirm with Kate, then finish and delete the old form page. |
| REG : Checkout : Forum Checkout (WIP, Courses object) | RESOLVE | A live checkout landing page chain already exists (pages 25/78/83/84). Determine if this template is superseded; finish or delete — don’t leave two checkouts. |

## **5.2 Static pages — 6 total**

| Page (status) | Verdict |
| :---- | :---- |
| INV : Bring a Buddy : Guest Invite Form (TO DELETE) | DELETE (after DRAFT replacement ships). |
| EVENT : All Events Listing (TEST) | DELETE for pilot unless someone claims it — participants reach their event through their registration, not a listing. |
| PORTAL : My Account : Membership Suspended / Cancellation Form / Survey / Confirmation (all TEST) | PARK — not pilot-path. Leave unlinked; Chris’s cleanup audit decides post-pilot. |

# **6\. Pilot deltas — content decisions already made (do not undo)**

* **DO NOT SURFACE:** The CRT’s “Intention to Register into Advanced Course” form (INTENTREG) is the DA / “let us know” flow Kate explicitly cut. It does NOT appear in the pilot portal. Same for any deposit-agreement language.

* **DO NOT SURFACE:** The CRT’s “Alternative Guest Invite Form” (the legacy LISA guestInvite link) — our native invite hub replaces it. CS keeps the link as a Course Team fallback resource only.

* **Tone:** Final Session pages use celebration framing: it’s a graduation for them and their people, two hours, guests welcomed warmly. Registration opportunities present, not pushed. Kate signs off on this copy.

* **Simplification:** All-online final session: no in-person logistics, no room/venue content anywhere in the participant path.

* **Language:** en-only for pilot; translated-materials structure exists in the data model but no translated content ships.

# **7\. Build order**

## **P0 — must work Aug 3**

1. Add the six gap fields to oEvents (Section 4.1) and the Course Team field group to oCourses (Section 4.2); CS release control on Master Stats.

2. Student Portal resource sections bound to course fields with session gating; Master Stats Course Resources production panel (session tabs, one-click launch); all fields seeded from the pilot CRT.

3. Finish Available Seminars selection (write-through to oRegistrations).

4. Finish Bring a Buddy invitation form (pending Kate’s confirm on BaB in pilot).

5. Advanced-Seminar Signup alignment (Designated/Alternate, Which fields, AC Reg Date, Saturday cutoff).

6. Resolve the duplicate checkout; delete/park pages per Section 5.2.

## **P1 — nice to have**

1. Guest-resources block on enrollment pages; date-based auto-release; per-event resource overrides (the demoted custom-object idea) if ever needed.

# **8\. Acceptance test (run before handoff)**

1. Set Current Released Session \= none → new participant sees prep materials \+ FORW resources only, no day materials.

2. Advance to Session 1 → Day 1 assignment appears; Day 1 Letter does NOT (it is tagged Session 2). Advance to 2 → letter \+ Vanto/Comm-interest appear. Advance to 3 → AC flyer/video \+ registration opportunities. Advance to ES → final-session resources.

3. Course Team resources never render for a participant login; the Master Stats Course Resources panel launches every seeded asset (deck, video, timer, form) in one click and is invisible to non-CS logins.

4. CS runs a full dress rehearsal of one course day (advance session, launch deck, play timer, open manual) entirely from Master Stats without opening the CRT sheet.

5. Every reid link on rendered pages carries the pilot event’s ID dynamically.

6. Seminar selection from the portal sets Registered for Seminar (f2303) \+ Which Seminar, and shows up on both dashboard views within one refresh.

7. A guest completing Guest Forum Signup stamps registration \+ timestamp on the right oInvitations record (visible in Master Stats final-session panel).

8. No page anywhere in the participant path shows INTENTREG, deposit-agreement language, or the legacy guest-invite link.

9. The old Bring a Buddy form page is deleted and its URL does not resolve to a live form.

# **9\. Open items**

* BaB (Bring a Buddy) in pilot pricing — confirm with Kate; gates the DRAFT invite form finish.

* Final Session \+ guest-page copy — Kate reviews against celebration framing.

* Duplicate checkout resolution — Chris determines which chain is canonical, tells Tobin what he deleted.

* Static TEST pages (cancellation set) — post-pilot audit, not blocking.

* Workbook links in CRT are open Google links — fine for pilot; consider portal-hosted copies post-pilot.

# Pilot Course Reporting Dashboard (for Event Team …

# Pilot Course Reporting Dashboard (Master Stats \+ KPI Dashboard) — Build Specification v2.2

**For: Chris (builder) | Owner: Tobin | July 22, 2026 | Supersedes v2 and v2.1 entirely**

**What changed in v2.1 → v2.2:** Builder is Chris (was Chris). The LM Teen Guest rule is REMOVED: since the LM procedure was written, teen Forums have been discontinued and Landmark Forum registration requires being 18+. Under-18 guests are therefore always non-potential, no exceptions (documented as a pilot delta in §9).

**What changed in v2 → v2.1:** The official LM document — *Statistic Procedure for The Forum (Online)* — is now integrated as the authoritative source for every statistic definition. Where the v2 spec paraphrased or contradicted it, the LM text wins. The raw LM dump (old §2.5) has been folded into the sections below and deleted; nothing from it was dropped. All deviations from LM are deliberate pilot deltas, listed in §9 only.

## Change log: v2 → v2.2 (read this first, Chris)

These are the places the LM procedure contradicted or extended the v2 spec. Everything else is unchanged.

1. **SE participants' guests — exception rule (NEW LOGIC).** v2 said guests of Statistically Excluded participants never count. LM: they count as Guests/Registrations in exactly two cases — (a) hearing guests of Deaf/Hard-of-Hearing participants, (b) guests aged 18+ invited by a participant under 18\. → New "SE Exception" handling on oInvitations (§3.2), formula update (§6), new acceptance test (§12.3b).  
2. **Teen Guest rule — NOT adopted (OBSOLETE in LM doc).** LM's note that a Teen Guest (15–17) registering during the Final Session gets added to \# LF Guests predates the discontinuation of teen Forums; the Landmark Forum now requires 18+. Under-18 guests are always non-potential. Do not build any teen-registration flow (§9).  
3. **Designated Advanced Course is date-based, not exact-match (CHANGED LOGIC).** v2 treated "Designated" as the one promoted date. LM: Designated \= the promoted AC **or any other AC that begins on or before the Designated AC's start date**; Alternate \= any AC starting after it. → Comparison must be on start dates (§3.2, §6, test §12.7b).  
4. **WBO/LDP are non-reviewer-only; \# Reviewers Completed is its own stat (CHANGED \+ NEW).** v2's Master Stats showed WBO with a "non-reviewer vs reviewer split." LM defines LDP and WBO on non-reviewers only, and defines **\# Reviewers Completed** as a separate statistic (same D3S3 \+ D3S4 test). → §4.2 and §6 updated.  
5. **Translation-unavailable non-potential category (ADDED FOR FIDELITY).** LM lists "requires translation, none available in their language" as non-potential for both Seminar and AC. Moot for the en-only pilot, but the formula carries the category so pilot numbers stay comparable (§6).  
6. **WBO reason list is now verbatim (WAS PARAPHRASED).** The six LM well-being reasons are the literal dropdown values for Leave Reason (§3.2).  
7. **No-impact notes.** LM's ANZ/NAR Google-Registration-Form rule and the non-web-reg next-business-day confirmation rule don't apply — every pilot registration happens inside OP with a timestamp (§6, LF Registrations note). LM reliability disclaimers (shared devices, mismatched emails, Grad-guest email mismatch) already live in the automation roadmap (§10). Interest in Assisting is defined by LM but remains deliberately out of pilot scope (§9).

# 1\. What you are building, and by when

Two pages inside the existing OP (Ontraport) member portal, both reading and writing the same OP objects. Users log in to the portal as they already do; what they see is controlled by if/then display rules on fields (§8). No separate app, database, or login.

- **Page 1: Master Stats** — the course supervisors' working page. Data entry (attendance, statuses, registrations) plus live in-course statistics. Editable only by Course Supervisors (CS).  
- **Page 2: KPI Dashboard** — the leadership summary. Read-only cards, modeled on the existing dashboard layout (screenshot supplied). Visible to CS, staff, and leadership; the Revenue section renders for leadership only.  
- **Non-goal:** The two pages do NOT link to or navigate into each other. Deliberately separate (cross-view deep-linking deferred post-pilot).  
- **Deadline:** Working end to end by Monday, August 3, 2026\. Pilot course runs August 14\.

Every specialized term is defined in plain language at first use and in the glossary. If anything is ambiguous, ask Tobin — do not guess.

# 2\. Glossary

Course-business vocabulary. Statistic definitions here are the LM *Statistic Procedure for The Forum (Online)* wording; §6 holds the formulas.

| Term | What it actually means |
| :---- | :---- |
| OP / Ontraport | The CRM \+ portal platform everything runs on. Participants register, invite guests, and log in through it. The dashboard is two portal pages inside it. |
| Participant | A person taking the 3-day course. |
| Guest | Someone a participant invites to the final evening session, via the OP invite hub. Guests are the sales prospects. |
| Final Session | An evening event a few days after the 3-day course ends (all online for the pilot). Participants return, bring guests, guests can register. Also called "Session 5." |
| Reviewer | A participant retaking the course. Tracked, but excluded from most sales statistics — they already bought the product. LM tracks **\# Reviewers Completed** as its own stat. |
| Non-Reviewer (NR) | A first-time participant. Most statistics count only these people. |
| Statistically Excluded (SE) | A participant counted in NO statistical measure (starts, completions, LDP/WBO, final-session attendance/%, AC potential/registration, seminar potential/registration). LM list: Deaf/Hard-of-Hearing; under 18; banking unavailable in their country (i.e., Russia); Panda Restaurant Group employees; residing in Iran; residing in China; \[India only\] LEI Scholarship recipients. |
| SE guest exceptions | Guests of SE participants are NOT counted as Guests or Registrations, **unless**: hearing guests of Deaf/Hard-of-Hearing participants, or guests 18+ invited by a participant under 18\. Those count normally. |
| Scholarship / Standard | Pricing categories. Tracked as flags; still count in statistics. |
| Start | A non-reviewer present on Day 1\. The base headcount. |
| Completed | Present for the "Empty and Meaningless" conversation (Day 3, Session 3\) AND any portion of Day 3, Session 4\. Applies to both NR and Reviewer completion stats. |
| LDP (Left During Program) | A non-reviewer start who left before Day 3 Session 4\. **Non-reviewers only** per LM. |
| WBO (Well-Being Out) | A subset of LDP: left for one of the six LM well-being reasons (verbatim list in §3.2). Reported separately; still included in LDP. |
| Potential / Non-Potential | Whether a person counts in the denominator of a registration statistic. Example: reviewers are non-potential for the seminar stat — they can still take it (free), it just doesn't count for or against the percentage. |
| ATP | "Already Took Program" — a non-potential reason for the Advanced Course. |
| Seminar Confirmation | Signing up for the free follow-on 10-week seminar (included with the course). |
| Advanced Course (AC) | The paid next course. Key revenue number. |
| Designated vs. Alternate (Seminar) | Designated \= the designated promoted Seminar (for translation participants: first available Seminar in their language). Alternate \= any other Seminar. Duplicate submissions: last entry wins. |
| Designated vs. Alternate (AC) | Designated \= the designated promoted AC **or any other AC that begins on or before the Designated AC's start date** (for translation participants: first available AC in their language). Alternate \= any AC starting after the Designated AC. Date-based comparison. |
| LF (Landmark Forum) | The course itself. "LF Guests" / "LF Registrations" \= guests at the final session and those guests buying the course. Registration requires being 18+ (teen Forums discontinued). |
| GPH (Guests Per Hundred) | Guests per 100 completing participants. §6. |
| GPH Baseline | The denominator: \# non-reviewers completed (a 1-guest-per-participant target). Badly named — it's not a minimum. §6. |
| RPH (Registrations Per Hundred) | Guest registrations per 100 of GPH Baseline. THE headline metric. §6. |
| Reg Effectiveness / % LF Reg | Registrations ÷ guests actually present. Pure conversion. Different from RPH — §6 has both, same worked example. |
| Unverified Guest | A guest who could not be identified as either an LF Guest or Non-Potential after due diligence by the CS and Registration Team. LM rule: 85% of them are added to \# LF Guests. With hub invite links this bucket should be near zero — the rule stays for comparability. |
| PCR (Projected Course Revenue) | Registrations × the registration price for each registration's type. Leadership-only. §7. |
| LM Stats Procedure | *Statistic Procedure for The Forum (Online)* — the official company document defining every statistic. **The authoritative source for this spec.** Pilot deviations are in §9 only. |
| LISA | The company's legacy registration system. Source of some roster data. No integration needed for the pilot. |

# 3\. Data model — real OP objects and what to add

Everything lives on the existing custom objects. Rule: all schema changes are ADDITIVE — never modify or remove existing fields. Verify current meta via API before adding anything (some listed additions may partially exist).

## 3.1 Already exists (do not recreate)

| Object (ID) | Relevant existing fields |
| :---- | :---- |
| Contacts (0) | Name, email, etc. New (already created): Leadership Access (f2770, checkbox) · Staff Access (f2771, checkbox) in section "Portal Access." |
| oEvents (10000) | The scheduled course run: date, format, leader, capacity, stats fields. |
| oRegistrations (10001) | One participant's enrollment in one event. Contact (f2213) · Event (f2214) · Course (f2458) · Day 1 Attended (f2687) · Left The Course (f2293) · Well Being Out (f2688) · Registered for Advanced Course (f2302) · Registered for Seminar (f2303) · Has Attended the Forum (f2464) · Registration Status (f2424) · Source Invitation (f2465) · \# Invitations rollup (f2272) · portal page URLs. |
| oInvitations (10003) | One participant inviting one guest: who was invited, whether they attended, whether they registered. Personalized guest pages per invitation. |
| oEventTeam (10007) — NEW, already created | Contact (f2788 → Contacts) · Event (f2789 → oEvents) · Role (f2790, dropdown; option 306 \= "Course Supervisor") · Notes (f2791). One record \= one person working one event in a role. |
| Products (16) / Invoices / Payments | OP commerce objects. Prices for PCR come from here or from a simple price table on the event — Chris's choice, whichever is faster; document it. |

#  

## 3.2 Fields to ADD (verify-then-create; names indicative)

*Complete table — replaces the existing §3.2 table in the v2.2 Dashboard spec.*

| Object | Field | Type / values | Why |
| :---- | :---- | :---- | :---- |
| Contacts | Name They Like | text | What they want to be called. Prominent on the Master Stats roster (first column, always editable). Explicit requirement. |
| oRegistrations | Reviewer | checkbox | Set manually by CS (import data unreliable). Drives all NR splits AND the separate \# Reviewers Completed stat. |
| oRegistrations | Pricing Category | dropdown: Standard / Scholarship | Flag only; still counts in stats. |
| oRegistrations | Statistically Excluded \+ SE Reason | checkbox \+ dropdown (verbatim LM list: Deaf/Hard of Hearing · Under 18 · Banking unavailable in country · Panda Restaurant Group employee · Resides in Iran · Resides in China · LEI Scholarship \[India only\]) | If checked: excluded from EVERY statistical measure, and their guests don't count except per the SE guest exceptions (see oInvitations below). |
| oRegistrations | Day 2 Attended · Day 3 Attended · D3S3 Checkpoint · D3S4 Attended · Final Session Attended | 5 checkboxes | Day 1 already exists (f2687). These complete the attendance chain that drives starts, completions (NR and Reviewer), LDP, final-session %. |
| oRegistrations | Left Day \+ Leave Reason | dropdown (1/2/3) \+ dropdown — verbatim LM well-being values: (1) Informed us they do not think they can "handle" what they are experiencing · (2) Now see they should heed the Health Warnings in their Program Information Form · (3) Suffered a serious long-term health problem during the program (e.g., epileptic seizures, heart problems, spinal problems making it impossible to sit) · (4) Insufficient sleep in the days preceding or while taking the program (incl. between last day and the evening session) · (5) Said they are thinking of ending their own life / have attempted / thinking of harming self or another · (6) Program Leader has a health concern and is unwilling for the person to continue · Other (not WBO) | Choosing any of reasons 1–6 auto-checks the existing WBO field (f2688); "Other" \= plain LDP. LDP/WBO computed for non-reviewers only. Notes field carries help text: "Facts only — NO story, NO interpretation." |
| oRegistrations | Left Type | dropdown: LDP / NSHO | Workbook distinguishes no-shows (NSHO: registered but never started) from left-during-program. NSHO excluded from Starts entirely. |
| oRegistrations | Seminar Potential · Which Seminar · Seminar Notes | checkbox (auto-default: unchecked if Reviewer or translation-unavailable) \+ dropdown \+ longtext | Confirmation flag already exists (f2303). "Which" \+ the event's designated seminar → Designated vs Alternate. Last entry wins on duplicates. |
| oRegistrations | AC Potential · Which AC · AC Reg Date | checkbox \+ dropdown \+ date | Reg flag exists (f2302). AC Reg Date enforces the Saturday-after cutoff. Non-potential (LM list): reviewer who already took the AC (ATP) · reviewer already registered prior to course start · requires translation with no AC in their language · observes Shabbat. |
| oRegistrations | FS Late Arrival | checkbox | Legacy "After 7:30 pm" flag at the Final Session. |
| oRegistrations | Interested In: Assisting · Vanto · Family Division · TCP | 4 checkboxes | Capture-only flags from the legacy prelim report. No stats computed (Interest-in-Assisting stats out of pilot scope per §9). |
| oRegistrations | Participation fields (per-day off-camera/away counts, prompted?, declined/came back, sharing: shared?, \# times, which distinction, pronunciation notes) | per §4.7 | ONLY if Kate confirms §4.7 participation tracking is in pilot scope (decision by July 28). |
| oRegistrations | Price Type \+ Invoice ID | dropdown (real price list from Kate/ops incl. $125/$495/BaB/scholarship variants) \+ text | Stamped by checkout at registration time. Price Type feeds PCR; Invoice ID is the post-pilot foundation for booked/cash/refund reporting. One-time backfill of existing registrations by contact \+ purchase date. |
| oEvents | Designated Seminar · Designated Advanced Course \+ Designated AC Start Date | text/dropdown \+ date | Reference values for the Designated vs Alternate split. The AC split is DATE-BASED: an AC counts as Designated if its start date ≤ Designated AC Start Date. Store the date so the comparison is computable — do not compare names. |
| oEvents | Price table (or Products link): price per registration type per program | per Chris | Feeds PCR. Must support type-specific prices (Standard, BaB, etc.). |
| oEvents | Couples Sharing Device · Double Devices (per day) | numeric | Headcount reconciliation (§4.2): roster-present \+ couples − doubles vs. Zoom login count; reporting to OPMs gated on the match. |
| oInvitations | Invite Type | dropdown: Forum / Grad Course | Splits the invitation-sent counts. Verify it isn't already derivable from the linked course before adding. |
| oInvitations | Guest Status \+ Non-Potential Reason | dropdown: LF Guest / Non-Potential / Unverified \+ reason dropdown (verbatim LM list: Previously completed the LF · Registered for the LF prior to attending · Requires translation, no Forum in their language available · Under 18 · Guest of SE participant) | Set by CS at/after the final session. Under-18 guests are always non-potential — no teen registration path (teen Forums discontinued; see §9). |
| oInvitations | SE Exception | checkbox (+ optional reason dropdown: Hearing guest of Deaf/HoH participant · Guest 18+ of under-18 participant) | LM rule: guests of SE participants don't count UNLESS one of these two exceptions applies. Checked → guest counts normally despite SE inviter. |

# 

# 4\. Page 1 — Master Stats (CS working page)

Specced around the exact interactions in the legacy CS workbook (analyzed July 22). Goal: a CS runs an entire course weekend from this page and never opens the spreadsheet. Sub-sections 4.1–4.6 are P0; 4.7 is pending Kate.

### **4.1 Roster & classification (pre-course \+ always editable)**

* Roster of the event's oRegistrations. First column: **Name They Like** (editable inline — it is the first column of every legacy sheet for a reason).  
* Inline-editable flags per participant: Reviewer, Scholarship, SE \+ reason, translation need. Registration data pre-fills these but CS override always wins (LM: import data is unreliable).  
* "Forum Participants You Know" (f2582) surfaced read-only on the roster — the legacy "People to Note" column. CS needs to see relationships when someone leaves.

### **4.2 Daily session check-in (high-frequency, time-pressured)**

* One click per person per session. **Must support "mark all present, then un-mark missing"** — CS will not click \~100 boxes individually.  
* Headcount reconciliation strip: CS enters \# couples sharing a device and \# double devices (fields on oEvents, per day); page computes roster-present \+ couples − doubles vs. expected and shows MATCH / MISMATCH. Legacy rule: reporting to OPMs is gated on the match.

### **4.3 Leaving & status changes (event-driven, sensitive)**

* Marking someone "left" prompts for: Left Type (**LDP or NSHO** — no-show, registered but never started), day, time left, reason. The six LM well-being reasons auto-set WBO (f2688); "Other" \= plain LDP.  
* Notes field carries permanent help text: **"Facts only — NO story, NO interpretation (e.g., 'Transfer, left Day 2 4:15pm')"** — verbatim policy from the legacy workbook.

### **4.4 Day 3 / registration entry**

* Per participant, inline: Seminar (potential status, confirmed?, which, des/alt, conversation notes — last entry wins) and AC (potential status \+ non-potential reason, registered?, which, des/alt).  
* Interested-in flags: Assisting · Vanto · Family Division · TCP (capture only; no stats computed — Interest-in-Assisting stats remain out of scope per §9).

### **4.5 In-course stats panel (live, computed, read-aloud layout)**

* Headcounts: total, reviewers, scholarships, standards, SE.  
* Per day: \# started, \# left. Totals: LDP \# and %, WBO \# and % — non-reviewers only. Completions: \# NR Completed and \# Reviewers Completed separately.  
* Seminar and AC: potentials, confirmations/registrations, %, Designated vs Alternate (date-based for AC).  
* Invitations sent: Forum · Grad · Total — straight count of oInvitations records; never manual.  
* Layout mirrors the legacy workbook's stat blocks (Preliminary Stats / Final Stats) so a CS can read it to the Forum Leader verbatim at the scripted moments.

### **4.6 Final session panel**

* Participant check-in \+ **After-7:30pm late flag**; count and % of completers.  
* Guest working list from oInvitations: check-in, inviter shown (replaces the entire legacy GV\#/Zoom-naming apparatus), Guest Status (LF Guest / Non-Potential \+ reason / Unverified), SE Exception checkbox, registration marking.  
* Live: GPH Baseline, GPH, \# LF Registrations, % LF Reg, RPH.  
* **Provisional labeling:** the 85%-adjusted guest count and all derived stats display a "PROVISIONAL — do not report until end of night" badge until CS clicks "Finalize" (legacy workbook rule, all caps in the original).

### **4.7 Participation tracking (PENDING Kate — build only if pilot CS team requires it)**

* Per participant per day: off-camera/away counts, prompted? (declined / came back on), "in communication w/ CS?" note; sharing tracker (shared?, \# times, which distinction, pronunciation notes).  
* Zero stats impact — pure room management. If Kate says the pilot team needs it and it isn't here, they keep the spreadsheet open all weekend, defeating the purpose. Decision needed by July 28\.

No revenue anywhere on this page — revenue is leadership-only, on the KPI Dashboard.

# 5\. A worked example everyone agrees on

Use this scenario in your tests — it is from a real January course. 48 non-reviewers completed the course (GPH Baseline \= 48). At the final session, 204 LF Guests attended online, and 13 of them registered.

- GPH \= 204 ÷ 48 × 100 \= 425\. (Target is 100 — one guest per completer. The commonly quoted "minimum" is 105.)  
- % LF Reg (effectiveness) \= 13 ÷ 204 × 100 ≈ 6%. (Of guests present, 6% registered.)  
- RPH \= 13 ÷ 48 × 100 ≈ 27\. (Registrations per 100 of baseline. The number leadership watches.)

Why both: RPH rewards guest volume — 3× the guests triples RPH even at flat conversion. Effectiveness measures pure conversion. Both must be visible together.

# 6\. Metric formulas (the contract)

Verbatim from the LM *Statistic Procedure for The Forum (Online)*, expressed as build formulas. "NR" \= non-reviewer. **Statistically Excluded people are removed from every count before anything below is computed; their guests are removed too, except SE-Exception guests (§3.2), who count normally.**

**Non-Reviewer Starts** Formula: count of NR participants (incl. Standards & Scholarships) present Day 1\. Plain English: first-timers who showed up on Day 1\. Example: *48 non-reviewers show up Day 1 → Starts \= 48\. SE participants are simply not in the count.*

**\# Non-Reviewers Completed** Formula: count of NR Starts with D3S3 Checkpoint AND D3S4 Attended checked. Plain English: first-timers present for the "Empty and Meaningless" conversation (Day 3 Session 3\) who attend any portion of Day 3 Session 4\.

**\# Reviewers Completed** Formula: count of Reviewer Starts with D3S3 Checkpoint AND D3S4 Attended checked. Plain English: same completion test, reviewers counted separately. (New in v2.1 — LM defines this as its own stat.)

**\# / % LDP** *(non-reviewers only)* Formula: \# \= NR Starts who left before D3S4. % \= \# LDP ÷ NR Starts × 100\. Plain English: how many first-timers left early, as a share of starters. Example: *48 starts, 4 leave → LDP \= 4, %LDP ≈ 8%.*

**\# WBO** *(non-reviewers only)* Formula: count of LDP whose Leave Reason is one of the six LM well-being reasons (§3.2). Plain English: left for health/well-being reasons. Reported separately; still included in LDP.

**\# / % Attending Final Session** Formula: \# \= NR Completed with Final Session Attended. % \= that ÷ \# NR Completed × 100\. Plain English: how many finishers came back for the evening event.

**Invitations Sent (Forum / Grad / Total)** Formula: count of oInvitations records for this event, split by Invite Type. Plain English: how many invites participants sent through the invite hub. Native data — never manually entered.

**\# LF Guests** Formula: attended invitations with Guest Status \= LF Guest, PLUS 85% of Unverified attendees (round to nearest whole number). Excludes: previously-completed-LF, registered-prior, translation-unavailable, under-18 (always — LM's Teen Guest note is obsolete, see §9), and guests of SE participants (except SE-Exception guests). Plain English: countable prospects in the room. With hub invite links, Unverified should be \~0, but keep the 85% term for comparability. Example: *200 verified \+ 10 unverified → 200 \+ 8.5 → 209\.*

**GPH Baseline** Formula: \# NR Completed. Plain English: the guest target — one per completing first-timer. (Online formula; in-person uses in-area \+ half out-of-area — not needed for pilot.) Example: *48 completers → baseline 48\.*

**GPH (Guests Per Hundred)** Formula: \# LF Guests ÷ GPH Baseline × 100\. Example: *204 ÷ 48 × 100 \= 425\.*

**\# LF Registrations** Formula: invitations where the guest registered before midnight local time of the Final Session. Plain English: guests who bought the course that night. Note: LM's ANZ/NAR Google-Registration-Form rule and the next-business-day confirmation for non-web-reg locations do NOT apply to the pilot — every pilot registration happens inside OP with its own timestamp. The midnight-local cutoff is the only rule to build.

**% LF Reg (Reg Effectiveness)** Formula: \# LF Registrations ÷ \# LF Guests × 100\. Example: *13 ÷ 204 ≈ 6%.*

**RPH (LF Reg Per 100\)** Formula: \# LF Registrations ÷ GPH Baseline × 100\. Plain English: registrations per 100 completers — volume and conversion in one number. Headline metric. Example: *13 ÷ 48 ≈ 27\.*

**Seminar Potential / \# Confirmations / %** Formula: Potential \= participants minus non-potentials — LM list: reviewers, and participants requiring translation with no Seminar in their language available. \# Confirmations \= each confirmation submitted by a Potential participant. % \= confirmations ÷ potential × 100\. Plain English: who could sign up free, and what share did. Reviewers can still take it; they just don't count. (Translation category is moot for the en-only pilot but stays in the formula.)

**Designated vs. Alternate — Seminar** Formula: confirmations into the Designated Seminar ÷ total confirmations × 100\. Designated \= the designated promoted Seminar (translation participants: first available in their language). Alternate \= any other. Duplicates: last entry wins.

**AC Potential / \# Registrations / %** Formula: Potential \= participants minus non-potentials — LM list: reviewer who already took the AC (ATP), reviewer already registered prior to course start, requires translation with no AC in their language, observes Shabbat. Registrations count if completed by a Potential participant with AC Reg Date ≤ end of day Saturday following the Final Session. % \= registrations ÷ potential × 100\. Plain English: who could buy the AC and what share did. Window extends past course end — late entries through that Saturday must count.

**Designated vs. Alternate — Advanced Course** *(date-based; changed in v2.1)* Formula: registrations into a Designated AC ÷ total AC registrations × 100, where an AC is Designated if its **start date ≤ the Designated AC's start date** (translation participants: first available AC in their language is their Designated). Alternate \= any AC starting after the Designated AC. Compare dates, never names.

**AC Reg per 100 / AC Reg Effectiveness** Formula: registrations ÷ GPH Baseline × 100; and registrations ÷ AC Potential × 100\. Plain English: mirrors the LF pair so every program reads the same way.

**PCR — Projected Course Revenue (leadership-only)** Formula: per program: sum over registrations of that registration's type-specific price. Total \= sum of programs. Example: *100 registrations at $785 \= $78,500.*

*(LM also defines \# Potential / % Interest in Assisting — outside US/Canada only. Out of pilot scope per §9; do not build.)*

# 7\. Page 2 — KPI Dashboard

Start from the existing dashboard layout (header: date / course / format / time zone / leader; then card sections). Read-only for everyone. Sections and cards:

| Section | Cards (in order; "new" \= not on the current dashboard) |
| :---- | :---- |
| Course Stats | Participants Day One · Current In Course · In the Room · Left During Forum · Well-Being Out · \# Completed (new; show NR and Reviewer figures) · Statistically Excluded (new) |
| Seminar (new section — PENDING Kate's call; build behind a toggle) | Seminar Potentials · \# Confirmations · % Confirmed · % Designated |
| Advanced Course | Reviewers In Course · AC Potentials · AC Registrations · AC Reg Per 100 · AC Reg Effectiveness · % Designated (new; date-based rule) |
| Landmark Forum | Forum Invitations Sent · \# LF Guests · \# LF Registrations · LF Reg Per 100 (RPH) · LF Reg Effectiveness · GPH (new) · GPH Baseline (new) · \# Unverified Guests (new) |
| Graduate Courses | Grad Invitations Sent · \# Grad Guests · \# Grad Registrations · Per 100 · Effectiveness |
| Invitations (new) | Forum Invitations Sent · Grad Invitations Sent · Total Invitations Sent (all native counts) |
| Revenue — LEADERSHIP ONLY (display rule c) | AC PCR · LF PCR · Grad PCR · Total PCR |

Cards show "—" (not 0\) when underlying data hasn't started, matching the current dashboard's "--" convention. All cards compute from live object data; nothing on this page is manually entered.

# 8\. Permissions — already half-built; here is the whole model

The portal has no native account types. Access \= if/then display rules on fields. The data side is DONE (created July 18, verified): oEventTeam object (10007) and two contact checkboxes. Chris implements the display rules and page gating:

| Rule | Condition | Effect |
| :---- | :---- | :---- |
| (a) Master Stats | Logged-in contact has an oEventTeam record where Event (f2789) \= current event AND Role (f2790) \= Course Supervisor (option 306\) | Nav item \+ page visible, WITH edit controls. Everyone else: no nav, no access. |
| (b) KPI Dashboard | Condition (a) OR Staff Access (f2771) checked OR Leadership Access (f2770) checked | Nav item \+ page visible, read-only by construction (page has no edit controls). |
| (c) Revenue section | Leadership Access (f2770) checked | Revenue cards render; otherwise the section is absent entirely. |

- Registrations are participants ONLY. CS/staff/leadership never get oRegistrations records — that is why oEventTeam exists. Nothing in the stats needs role filtering as a result.  
- Setup task (UI, 2 min, Tobin/Chris): set oEventTeam record & dropdown title to: Contact — Role @ Event.  
- Participant role: sees neither page; they keep their existing student portal.

# 9\. Pilot deltas — deliberate differences from the LM Stats Procedure

- **DO NOT BUILD:** Deposit Agreement / "let us know" form flow. Kate cut it for the pilot.  
- **DO NOT BUILD:** Cross-navigation between Master Stats and KPI Dashboard. Deferred post-pilot deliberately.  
- **DO NOT BUILD:** Interest-in-Assisting stats (LM defines them for outside US/Canada only). Out of pilot scope.  
- **DO NOT BUILD — obsolete LM rule:** The LM Teen Guest note (15–17 registering during the Final Session gets added to \# LF Guests) predates the discontinuation of teen Forums. Landmark Forum registration now requires 18+, so under-18 guests are always non-potential with no registration path. No teen flow anywhere.  
- **Simplification:** Final session is all-online: online formulas everywhere; no in-area/out-of-area logic, no hybrid tabs.  
- **Simplification:** en-only pilot — the translation-unavailable non-potential categories are carried in the formulas but will match zero participants.  
- **N/A for pilot:** LM's ANZ/NAR Google-Registration-Form counting rule and non-web-reg next-business-day confirmations — all pilot registrations are in-OP and timestamped.  
- **Addition:** "Name They Like" is a required, prominent roster field.

Everything else follows the LM Stats Procedure verbatim so pilot numbers are comparable to existing programs.

# 10\. Automation roadmap (context, not pilot scope)

Kate's direction: manual CS fields get automated over time. Pilot ships manual-with-assists; this table is the path. Do not let any of it threaten Aug 3\. The LM disclaimers are baked in: 100% reliability does NOT cover multiple people on one device, or people registering with a different email than LISA has; Grad-guest email mismatch caps cross-program Forum GPH at \~99% until Grad guest functionality lands. 

Tooling decision (July 22): attendance automation will be built in n8n calling the Zoom and Ontraport APIs directly. PlusThis is NOT used (it can only tag Contacts, not write oRegistrations fields, and adds a license for nothing n8n can't do). Zoom Events / Webinars Plus analytics were evaluated and rejected (separate license; dashboard/CSV reports only, no path into OP). Zoom Pro or higher is required for the participants report API.

| Manual today | Automatable via | When |
| :---- | :---- | :---- |
| Daily attendance check-in | n8n workflow: Zoom past-meeting participants report (or participant\_joined/left webhooks) → match by email → set the §3.2 attendance checkboxes on oRegistrations directly; guest attendance stamped on oInvitations the same way. Join/leave timestamps can auto-SUGGEST D3S3/D3S4 presence for CS to confirm — the checkpoint stays a CS judgment call. Caveat (LM): shared devices and mismatched emails cap reliability; CS override always wins. | P1: n8n sync as an assist. Full auto post-pilot. Do not risk P0 — Aug 3 ships manual-with-assists. | |
| Guest check-in \+ verification | Native: hub invite links already tie each guest to an inviter (oInvitations). Unverified bucket \~0 for pilot. | Largely automatic already. |
| Seminar confirmations / AC registrations | In-system registration flows write f2303/f2302 directly. | Partially native now; fully post-pilot. |
| Reviewer / ATP flags | LISA participation history — but LM warns it isn't 100% accurate; keep manual override forever. | Post-pilot, with override. |
| Statistically Excluded flags | Derivable from roster data (age, country, employer). | P1: auto-suggest; CS confirms. |
| Invitations sent | Native oInvitations counts. | DONE — never manual. |

# 11\. Build order (priorities)

## P0 — must work Aug 3

1. Field additions from §3.2 (verify-then-create, additive only) — including the new SE Exception, verbatim Leave Reason values, and Designated AC Start Date.  
2. Master Stats page: roster, check-in flows, classification editing, stats panel (NR-only LDP/WBO \+ separate Reviewers Completed), final session panel (with SE Exception flagging).  
3. KPI Dashboard page with all card sections; Seminar section behind a toggle pending Kate.  
4. Display rules (a)(b)(c) wired and tested with real logins.  
5. All §6 formulas live and matching the worked example.

## P1 — nice to have, do not risk P0

1. Zoom attendance CSV import assist; SE auto-suggest; over-70 highlight; AC Saturday-cutoff reminder; designated/alternate charts; CSV export of stats.

# 12\. Acceptance test (run before handoff)

1. Enter the §5 worked example; confirm GPH \= 425, % LF Reg \= 6%, RPH \= 27\.  
2. Permissions: (i) contact with an oEventTeam CS record for THIS event sees Master Stats with edit \+ KPI without Revenue; (ii) same contact on a DIFFERENT event sees neither; (iii) Staff Access contact sees KPI read-only, no Revenue, no Master Stats; (iv) Leadership Access contact sees KPI with Revenue; (v) plain participant sees neither page.  
3. Mark a participant Statistically Excluded → every stat updates (starts, completions, potentials), and their guests drop out of guest counts. 3b. Check SE Exception on one of that participant's guests (e.g., hearing guest of Deaf/HoH inviter) → that guest re-enters \# LF Guests and, if registered, \# LF Registrations; the others stay excluded. 3c. A guest marked Non-Potential (Under 18\) never appears in \# LF Guests or \# LF Registrations — there is no path to flip them.  
4. Mark a leaver with one of the six LM well-being reasons → appears in LDP and WBO; "Other" reason → LDP only. Mark a REVIEWER as leaving → LDP/WBO counts do not move (NR-only).  
5. Add 10 unverified attended guests → \# LF Guests rises by 8 or 9 (85%, rounded); GPH, % LF Reg, RPH recompute.  
6. Reviewer confirms a seminar → recorded, but potentials/% unchanged. A reviewer completes the course → \# Reviewers Completed increments; NR Completed and GPH Baseline unchanged.  
7. AC registration dated the Saturday after the final session → counted; dated Sunday → not counted. 7b. Designated AC split: register one participant into an AC starting BEFORE the Designated AC's start date and one into an AC starting AFTER it → the earlier one counts as Designated, the later as Alternate.  
8. Invitation counts on both pages exactly equal the number of oInvitations records for the event, split correctly Forum vs Grad.  
9. PCR: create registrations at two different price types → PCR \= sum of type-specific prices, and the section is invisible to a non-leadership login.  
10. KPI Dashboard on an untouched course shows "—" on cards, not zeros.

# 13\. Open items (may change details, not structure)

- Seminar section on the KPI Dashboard — Kate deciding. Build it behind a toggle.  
- 85% unverified rule — recommended keep (near-moot with hub invite links); awaiting Kate's confirmation.  
- Price table contents — registration types and current prices (incl. BaB) per program, from Kate/ops.  
- Whether staff's read-only views should mask participant ages/PIDs — awaiting call.  
- oEventTeam record/dropdown title — 2-minute UI task (§8).  
- SE Exception UX — proposed as a checkbox in the final session panel; Chris may implement differently as long as §6 math holds.  
- If Forum registration is now 18+ across the board, the "under 18" SE participant category and the "guest 18+ of under-18 participant" SE exception may also be dead letters. Keep them in the data model (they cost nothing and preserve LM comparability) but confirm with LM/Kate whether they can ever fire.  
- n8n Zoom→OP attendance sync (P1) — Chris to confirm Zoom account is Pro+ and API credentials/scopes are available; not blocking Aug 3\.  
- §4.7 participation tracking in/out of pilot scope — Kate, by July 28\.  
- Real price-type list (incl. $125/$495/BaB/scholarship variants) — Kate/ops; blocks PCR and the Price Type dropdown.  
- Revenue fallback: if Price Type stamping \+ backfill can't land before volume grows, defer the Revenue section (one display-rule toggle) rather than show an estimate.

# **Glossary**

**The product ladder** (each one feeds the next):

1. **Landmark Forum (LF)** — the entry Course. 3 days (Fri-Sun) \+ an evening **Final (Graduation) Session** a few days later (Tues evening). This is what our pilot course is.

2. **Seminar** — free 10-week follow-on, included with the Forum. Not revenue; it keeps people engaged. **But also, peeps can later take seminars for a fee, too.** 

3. **Advanced Course (AC)** — the paid next course after The Forum. The key upsell.

4. **Beyond that:** grad courses galore \- Communication Courses, Wisdom Courses, Etc


## **The customer journey:**

The Pilot:

1. [Sales page](https://forum.landmarkworldwide.com/launch/#testimonials)  \> [Checkout](https://lm.landmarkworldwide.com/launch/) \> Forum Info Form \+ T\&C’s \> Success\!  
2. Registrants for Pilot go through The Forum Aug 14-16, [inviting guests](https://landmark-portal.com/invite/7IRW7PT) throughout their experience to their graduation evening (Tues. 18th).   
3. There’s 2 kinds of Guests (which is important because the offers each receives on Tuesday night is different)  
   1. Non-grad guest (never done Forum in the past)  
      1. Offer: sign $300 off The Forum tuition if you register by Saturday 11:59pm (handled via daily emails \+ [sales page](https://forum.landmarkworldwide.com/guests/) (which will have countdown timer counting down to discount expiration \- done using UTC params passed via their email links\!)  
   2. Grad guests (has done The Forum at some point in the past \- and may well be who told the Participant who invited them to be their Tues. night guest) about The Forum in the first place)  
      1. Offer: $300 off any grad. Course now through Saturday\!  
4. And for current Forum participants:  
   1. The offer they receive during the Forum is to sign up for **The Advanced Course (“AC”)** (also (handled via daily emails \+ [sales page](https://forum.landmarkworldwide.com/advanced-course/) (which will have countdown timer counting down to discount expiration \- done using UTC params passed via their email links\!)

      

    


## **How the stats hang off that journey:**

* **Start** \= first-timer present Day 1\. **Completed** \= made it through Day 3\.  
* **LDP** — Left During Program. A first-timer who showed up Day 1 but left before the end of Day 3 (specifically, before Day 3's final session block). It's the dropout stat. If 48 people start and 4 walk out partway through, LDP \= 4 (\~8%). Reviewers (retakers) who leave don't count here — LDP only tracks non-reviewers.  
* **WBO** \= the subset of LDP who left for health/well-being reasons.  
* **Reviewer** \= someone retaking the Forum. They attend but are excluded from sales stats — already a customer.  
* **Potential** \= exactly your instinct: an "at-bat." The denominator of every conversion stat — people who *could* buy the thing. Reviewers are non-potential for the Seminar; someone who already took or booked the AC is non-potential for the AC. Each stat \= registrations ÷ its potentials.  
* **GPH Baseline** \= \# of first-timers who completed. Badly named — just the denominator for guest metrics, on the theory of "one guest per completer." **GPH** \= guests per 100 completers (100 \= everyone brought one). **RPH** \= guest *registrations* per 100 completers — the headline number, since it captures volume × conversion in one figure.

The through-line: everything is anchored to *non-reviewers who finished*. Completing first-timers are the population LM measures — both for how many made it through (LDP/WBO measure attrition from that pool) and for how much new business they generate (GPH/RPH measure guests and sales against that pool).

## **Data / Objects Glossary / Hierarchy:**

**The mental model:** 

* **Program** — the top tier: the product *line* in LM's catalog. "The Landmark Forum," and "The Advanced Course," are under the “Curriculum For Living Program. But there’s also the "Seminar Series Program," which houses all Seminar courses.  Then there’s the “Wisdom Division” which houses all Wisdom Courses. There’s the Communication Division (program) which houses all Communication Courses.   It's what the stats and revenue roll up to (PCR is summed *per program*; the KPI Dashboard's sections — LF / Seminar / AC / Grad — are program-level groupings). Important for Chris: there is no oPrograms object in OP. Program exists as a category, not a record — each oCourses record belongs to a program by name/dropdown. Don't go looking for a table; it's an attribute.  
* **Courses** — Every course belongs to a Program via the Program parent field (f2388 → oPrograms).the evergreen product definition. "The Landmark Forum (Online)" is one oCourses record; the Advanced Course would be another. Holds everything that never changes between runs: day summaries, homework text, Course Team materials (\~35 resource URLs). What LM calls a "program" maps here.


* **Events** — one scheduled run of a course: "Forum, Aug 14, Chicago, Leader X." Holds the per-run stuff: dates, Zoom links, resource URLs, Designated Seminar / Designated AC, Current Released Session (the gating field), and the stat rollups. **The dashboard is always scoped to one oEvents record.**  
* **Registration \= oRegistrations** — one Contact taking one Event. The workhorse: all attendance checkboxes, Reviewer/SE/Scholarship flags, LDP/WBO fields, seminar \+ AC fields live here. Every participant stat is computed by counting oRegistrations for the event.  
* **Contacts** — people. One record per human, whether they're a participant, guest, CS, or leadership. Role is determined by what's *linked* to them, not by the contact itself (plus two checkboxes: Staff Access f2771, Leadership Access f2770).

* **Invitations** — one participant (Registration/Contact) inviting one guest to one event's Final Session. Holds guest identity, attended?, Guest Status (LF Guest / Non-Potential / Unverified), registered?. Every guest stat is computed by counting these.

* **EventTeam** — one Contact working one Event in a Role (e.g., Course Supervisor). This is how a person gets Master Stats access within the Portal without being a participant. Staff never get Registrations records because they’re not participants— that's the whole trick.

* **Products / Invoices / Payments** — OP commerce. Feeds PCR (revenue) only.

**Linkage in one line:** Contact → has oRegistrations (participant in events) → sends oInvitations (guests to those events) → guests become a new Contact just as soon as the inviting participant invites them through their Invitation Hub (form), and may later become a Registration in a *future* event — and the funnel loops.

