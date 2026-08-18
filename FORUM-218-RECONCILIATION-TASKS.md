# Forum 218 Reconciliation — Cleanup & Data Flow Task List

Source: `Forum 218 Reconciliation` audit (Ontraport read-only, 17 Aug 2026) vs. the CS's
Preliminary Statistics Report (Google Sheets, gid 2123819044).

Event 218 · The Landmark Forum · Online English · Aug 14–16, 2026 · Graduation Tues Aug 18
142 registration rows.

---

## How this list works

Every discrepancy below is numbered `D#`. Each one is **blocked pending context from Tobin**
— the answer determines whether it is a *data cleanup*, a *definition mismatch*, or a
*missing write path*. Questions are asked one at a time; answers get recorded inline under
each item as **CONTEXT:**, and the item is then re-classified into one of:

| Class | Meaning | Action shape |
|---|---|---|
| `CLEAN` | Bad data in Ontraport | One-time correction + guard so it can't recur |
| `DEFINE` | Ontraport is right, the metric means something else | Document the definition, fix the report/dashboard mapping |
| `WRITE` | The value is never written at all | Build the automation / workflow / rollup |
| `FIELD` | No field exists to hold the value | Create the field, then a `WRITE` task |
| `DROP` | Not actually tracked; remove from the comparison | Remove from report + dashboard |

---

## Phase 0 — Establish the contract (do first)

- [ ] **P0.1** Decide the system of record for each metric family. Right now the CS's hand
      report and Ontraport are two independent books. Nothing downstream is fixable until we
      say which one defines each number.
- [ ] **P0.2** Write the metric dictionary: for each of the ~40 lines on the Preliminary
      Statistics Report, record the exact Ontraport field(s), the filter, the numerator and
      the denominator. This becomes the spec the dashboard reads.
- [ ] **P0.3** Confirm whether the target is (a) Ontraport reproduces the CS report
      automatically, or (b) the CS keeps reporting by hand and Ontraport just has to not
      contradict it.

---

## Phase 1 — Data hygiene (contaminates every count)

- [ ] **D1 — Test registrations inside the live event.** 9 rows carry Test Registration =
      checked and sit among the 142. Two of them also carry AC and Seminar flags, so they
      inflate enrollment as well as headcount. Names: Test Account, Chariz Test, Christopher
      Test, Christopherlatest TestUser ×2, GateTest Forum, URL Test Resolving, Membership32
      Testing Email, Chris Russell.
      **STATUS: awaiting context**

- [ ] **D2 — Negative denominators.** `f2405` Capacity = **−268**, `f3020` Seats Remaining =
      **−408**, `f3263` Event Starts — Locked = **0** (this is the divisor for LDP % and WBO %).
      **STATUS: awaiting context**

- [ ] **D3 — One registration has no Registration Status** at all. 124 active + 17 withdrawn
      = 141 of 142.
      **STATUS: awaiting context**

- [ ] **D4 — Stale presence flags.** Two staff and two participants still flagged present days
      after the event ended, while the event's Total Staff Present rollup reads 0.
      **STATUS: awaiting context**

---

## Phase 2 — Classification (the labels, not the roster)

The rosters agree. These are all disagreements about how a matched person is *typed*.

- [ ] **D5 — LDP 5 typed as LDP 1 (root cause, moves 4 numbers).** Annamarie Phillips,
      Gretchen Leaton, Paul Schürch are LDP 5 (request transfer to future course) in the manual
      log; all 11 departures carry `f3056 = 428` (LDP 1, left course no communication) in
      Ontraport. Manual convention excludes LDP 5 from both the LDP count and the non-reviewer
      start base.
      · LDP count 8 vs 11 · % LDP 9% vs 12% · # Non-Rev Start 93 vs 96 (denominator under
      % Reg AC, % Int Assist, % WBO)
      **STATUS: awaiting context**

- [ ] **D6 — Price Type: Scholarship 43 / Standard 9 / Reviewer 1 / blank 89** vs manual
      0 scholarships and 85 standards. All 43 "Scholarship" rows carry $495 gross, which is
      standard tuition.
      **STATUS: awaiting context**

- [ ] **D7 — Statistically Excluded = 23** in Ontraport (`f3046`) vs **0** in the manual.
      17 of the 23 are simply the withdrawals.
      **STATUS: awaiting context**

- [ ] **D8 — Potential flags ignore the Non-Potential rules.** Manual rules: reviewers and
      minors are Non-Potential for Seminars; reviewers, minors and prior/registered attendees
      are Non-Potential for the Advanced Course.
      · Seminar Potential: manual 85, `f2882` 115
      · AC Potential: manual 93, `f2887` 118, event rollup `f2691` **5** — three answers for
      one number
      **STATUS: awaiting context**

- [ ] **D9 — Non-Potential list length.** The manual names 12 people NP against 17 recorded
      reviewers.
      **STATUS: awaiting context**

---

## Phase 3 — Enrollment fields in the wrong place

- [ ] **D10 — Seminar confirmations live in the wrong field.** `f2884` Seminar Confirmation
      Status = Confirmed is set on **0** registrations; the SEM Registration checkbox (`f2303`)
      is set on **73**. Filtering the 73 by the manual's rules (−12 reviewers, −2 test, −1 who
      left) = 58 vs manual 59.
      **STATUS: awaiting context**

- [ ] **D11 — AC Registered: checkbox vs status field disagree by 1.** Checkbox 11 (→9 after
      test removal, all nine names identical to manual); status field 12 (→9).
      **STATUS: awaiting context**

---

## Phase 4 — Values that are never written at all

- [ ] **D12 — Completion never recorded.** `f2809` Forum Completed = **0 / 142**, `f2804`
      Attended Graduation = **0 / 142**. Manual: 102 participants completed, 85 non-reviewers
      completed. Derivable (113 − 11 = 102) but never stored, so no automation, segment or
      report can read it.
      **STATUS: awaiting context**

- [ ] **D13 — The CS statistics panel is entirely zero.** oEventTeam carries 62 numeric stat
      fields (`f2892`–`f2953`) — starts, lefts, potentials, confirmations, guest counts, all
      four revenue blocks. All 0 across all six event-team records for 218, except Lois's
      `f2895` Starting Classlist Reviewers = 13 (actual 17). This field set *is* the system's
      version of the CS's hand report.
      **STATUS: awaiting context**

- [ ] **D14 — Aggregate attendance minutes never roll up.** Per-day minutes populated on 112
      rows; `f2867` Total Attendance Minutes = 0 on all 142.
      **STATUS: awaiting context**

- [ ] **D15 — Financial fields mostly empty.** 90 of 142 have no Financial Status, only 7 carry
      Net Revenue above zero, every revenue rollup on the event team reads $0.00.
      **STATUS: awaiting context**

---

## Phase 5 — Attendance chain

- [ ] **D16 — Day 2 / Day 3 don't chain, in either source.** Manual as written:
      113 → 108 → 108 → 102 (does not chain). Manual corrected: 113 → 111 → 108 → 102 (chains).
      Ontraport: 113 → 108 → 107 → (not recorded). Day 3 is off by one regardless.
      **STATUS: awaiting context**

- [ ] **D17 — Session-level checkboxes abandoned.** Twelve fields exist (D1S1–D3S4); D1S1 is
      checked on 3 rows. Attendance Status is set on 4.
      **STATUS: awaiting context**

---

## Phase 6 — Guests & final session

- [ ] **D18 — Guest records are shells.** 132 invitations exist with names and inviters;
      Invitation Sent, Attended, Registered and the Status dropdown are unset on every one.
      Guest Email is blank. Kyle Onsett and Marya Lehman each appear twice, so 132 is a row
      count, not a distinct-guest count.
      **PARTLY CORRECTED 2026-08-17 (live read, event 218, now 154 rows):** "Guest Email is
      blank" is true of the *denormalised text copies* only — `f2961` Guest Email and `f2957`
      Guest Contact ID are empty on all 154. The real guest identity is on the **`f2259` Guest
      parent link**, and it is populated: 153 of 154 resolve to a Contact with both a name and
      a working email (146 distinct emails, so 7 are repeat guests; 1 row has no guest link at
      all). So guests are reachable and can be Zoom-provisioned — read them via the extern
      `f2259//email`, never `f2961`. `f2962` Invitation Sent = 0 and `f2291` Status = 0 on all
      154 remain accurate. All 154 are `f2694` = 260 "LF: Tues. Grad".
      **STATUS: awaiting context on the unset Sent/Status flags; the email gap is resolved.**
      **Guest graduation links provisioned 2026-08-17** — new fields `f3306` (Invited) Guest
      Zoom URL and `f3307` Guest Zoom Registrant ID now populated on 158 of 159 invitations
      (the 159th has no `f2259` guest link, so no email to register). All point at graduation
      meeting 97116706744. Delivery is still open: Zoom sends nothing
      (`registrants_confirmation_email` = false) and `f2962` Invitation Sent remains 0.

- [ ] **D19 — Final session section is zero on both sides.** The manual is explicitly
      *preliminary*, taken before Tuesday graduation. Need a defined point at which the final
      numbers get captured.
      **STATUS: awaiting context**

---

## Phase 7 — Metrics with no write path (D20/D21 were mis-filed here as "no field"; corrected 2026-08-17)

- [ ] **D20 — Assisting: potential 85 / interest 0.**
      **CORRECTED 2026-08-17 (field master list, not a live read):** the original entry said
      there is no Ontraport field for either. There is. `oRegistrations` carries `f3063`
      Interested In: Assisting, and `oEventTeam` carries the whole rollup trio — `f2922`
      Potential for Assisting, `f2923` Interest in Assisting, `f2924` Interest in Assisting
      Percentage. So this is a `WRITE`, not a `FIELD`.
      The dashboard now counts `f3063` live for the Registered row. **Not yet verified
      against live data whether `f3063` is ever set on a real registration** — if it never
      is, the row reads 0, which is the honest answer and the next thing to check.
      Potential stays unmapped: the sheet's 85 equals both Standards and Seminar Potential,
      but that is a resemblance, not a confirmed rule, so it is not wired.
      **STATUS: awaiting context on the Potential rule; field existence resolved.**

- [ ] **D21 — Course interest: Family Division / TCP / Vanto.**
      **CORRECTED 2026-08-17 (field master list, not a live read):** the original entry said
      there are no Ontraport fields. All three exist on `oRegistrations` — `f3074` Interested
      In: Family Division, `f3075` Interested In: TCP, `f3064` Interested In: Vanto. `WRITE`,
      not `FIELD`. All three are now counted live on the dashboard's Reporting page, with the
      same unverified-population caveat as D20.
      **STATUS: field existence resolved; population unverified.**

- [ ] **D22 — Computed rates not derivable from stored fields:** Seminar Confirmed %,
      AC Reg %, % LDP, % WBO.
      **STATUS: awaiting context**

---

## Phase 8 — Individual records to resolve

- [ ] **I1 — Michael Robinson** — on the manual's confirmed-seminar list, `f2303` SEM
      Registration unchecked in Ontraport.
- [ ] **I2 — Brad Hopkins vs Daniel Hopkins** — manual's confirmed list names Brad; Ontraport
      has Daniel Hopkins with the seminar flag set, no Brad. Same person or two?
- [ ] **I3 — Amanda Fox vs Barry Fox** — manual's Non-Potential list names Amanda Fox, who has
      no registration on 218. Ontraport has Barry Fox, flagged reviewer.
- [ ] **I4 — Paul Schürch** — carries a seminar registration despite leaving on Day 3.
- [ ] **I5 — Ana De La Torre** — flagged reviewer in Ontraport, Non-Potential in the manual,
      yet holds a confirmed AC registration on both sides.

---

## Phase 9 — Build (unblocked once Phases 0–8 are answered)

- [ ] **B1** Write the corrected values back to the affected registrations (scoped, logged).
- [ ] **B2** Build the write path for whatever was classed `WRITE` — completion marking at
      graduation, eventteam stat rollups, attendance-minute aggregation.
- [ ] **B3** Create any fields classed `FIELD`.
- [ ] **B4** Guard rails: keep test registrations out of live events; prevent negative
      capacity; require Registration Status.
- [ ] **B5** Point the CS dashboard at the metric dictionary from P0.2 so the dashboard and
      the hand report are computing the same thing.
- [ ] **B6** Re-run this reconciliation against the next Forum as the regression test.

---

## Confirmed clean — no action

- Left the Course: all 11 names and days match exactly (Day 1: Graham Balch, Armin Alkhamis;
  Day 2: Sante Lesh, Yulonda Springer, Heather Armstrong; Day 3: Daniella Serquen, Gabe
  Shamash, Vanessa Gutierrez, Annamarie Phillips, Gretchen Leaton, Paul Schürch).
- Reviewers 20 − 3 test = 17 · manual 17.
- AC registrations 11 − 2 test = 9 · manual 9, all nine names identical.
- Attended Day 1 114 − 1 test = 113 · manual 113.
- Well Being Out: 0 on both sides.
- Zoom: all 142 registrations have a Zoom Registrant ID, zero unmatched attendance rows.
  Staff Zoom Participant IDs (`f3216`) blank — expected, that field stays empty for join-time.
