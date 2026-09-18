# Handoff — Payment Stamping & Guest Conversion Tracking
**Session date: 2026-08-20** · Ontraport account 270197 · n8n `landmarkworldwide.awesomate.io`

---

## 0. READ THIS FIRST — the design correction that is not yet applied

Late in the session, reverse-engineering the automation log on registration **1325** revealed that the
model everything was built on is **wrong**.

**A registration is created by `Form: REG : Checkout : Step 02 Post-Purchase Choose Forum Dates (lp) (LIVE)`
— the date-selection step — and the event (`f2214`) is already set at creation.**

Evidence, from the registration-object automation log:
- Log entry: *"Registration created by Form: REG : Checkout : Step 02 Post-Purchase Choose Forum Dates (lp) (LIVE)"*
- Record 1325 carries `source_location: https://lm.landmarkworldwide.com/` and visitor IP `73.78.202.147`
- The same submit writes all 14 page URLs **and** `f2214`

Timing (purchase → registration, same session, ~1 minute):

| Purchase | Registration | Gap |
|---|---|---|
| 507 @ `1787251730` | 1324 @ `1787251810` | 80s |
| 511 @ `1787254228` | 1325 @ `1787254289` | 61s |

### Why this matters

`PUR : Purchase Router` and the `REG` draft were both built to **create a Forum registration with no
event at purchase time**, expecting the date step to fill the event in later. That is backwards. If the
router fires on purchase (via automation 15), it runs ~60s **before** the form — finds no registration,
creates a blank-event one, then the form creates a second.

**→ Duplicate registrations on every New Era checkout. Do not publish the router as built.**

### The correction to make

Trigger on **registration created** (the form does that, event already set), then find the matching
purchase and stamp it. Precedent exists: **rule 5049** already fires a webhook off object 10001.
`OPS : Backfill Registration Financials` already does exactly this matching, proven over 146 records —
reuse its `Build Backfill Plan` logic for the single-record case.

### Two open questions blocking the rework

1. Does anything create a registration for someone who **buys but never completes Step 02**? If not,
   those buyers have a purchase and no registration at all.
2. What n8n call sets **Course (`f2458`) ~8.5 minutes after creation**? Log: *"Course was set to The
   Landmark Forum by API: LM Awesomate / n8n"* at `1787254807`, which then trips
   `Rule: REG : Set Course Type = Landmark Forum [LIVE]`. Unidentified.

---

## 1. What is LIVE in production right now

| Change | Status |
|---|---|
| **146 registrations backfilled** with Price / Discount / Net / Collected | ✅ applied, verified |
| **`f2970` Payment Record** moved onto the registration each purchase belongs to | ✅ 11 → 146 |
| **1 test registration flagged** (`f2878`) — reg 1308, TJCTEST | ✅ |
| **6 new oEvents metric fields** created and wired | ✅ |
| **Event 218 metrics written** | ✅ |

Verified by direct Ontraport query, not by workflow self-report:
`f2970` 11→**146** · `f2848` 131→**146** · `f2863`>0 26→**41** · `f2878`=1 0→**1**

**Safety fields held.** Event 218 rollups unchanged: `f2236` 133 registrants, `f2294` **11 Left Course**,
`f2266` 372 invitations. The 11 withdrawals survived — that was the main risk.

### Event 218 metric values now on the record

| Field | ID | Value |
|---|---|---|
| Guest Conversion Revenue | `f3366` | $0.00 |
| Advanced Course Revenue | `f3367` | $7,225.00 |
| Forum Revenue | `f3368` | $9,350.00 |
| Total Attributable Revenue | `f3369` | $16,575.00 |
| Guest Conversions With Inviter | `f3370` | 0 |
| Guest Conversions Self-Registered | `f3371` | 0 |

The zeros are honest — no invitation has ever had `f2466` set, because the attribution workflow is
still an unpublished draft.

---

## 2. Workflows built this session — ALL UNPUBLISHED DRAFTS

Nothing below is serving traffic. `update_workflow` saves a draft only; the previously-active version
keeps running until `publish_workflow` is called.

| Workflow | ID | Webhook | State |
|---|---|---|---|
| **PUR : Purchase Router** | `uZ3FkPw73S360nHj` | `/webhook/purchase-router` | ⚠️ **needs redesign** (§0) |
| **INV : Registration → Attribute to Invitation** | `YhtQ7P5teq9c5RYu` | `/webhook/registration-attribute-invitation` | ready, needs an OP rule |
| **EVT : Recompute Event Revenue Metrics** | `QJ6DXWnJ1A4ytFeJ` | `/webhook/event-recompute-metrics` | ✅ works, run on demand |
| **OPS : Backfill Registration Financials** | `4ssHFVOMR4CmUXOL` | `/webhook/backfill-registration-financials` | ✅ already run live once |
| **REG : Create Registration at Checkout (Pilot)** | `hTQ5oFvaHxeEWHBR` | `/webhook/pilot-create-registration` | ⚠️ draft, de-hardcoded from 218 — reconsider per §0 |
| **REV : Stamp Payment Details To Registration** | `qMD898FNDnvsbl6p` | `/webhook/Financial-information-stamp-on-registration` | draft, de-hardcoded from 218 |

All use Ontraport credential **`OsCRIpklBoVrdcmH`** ("Ontraport", `httpCustomAuth`) and error workflow
`q0zD6r3s2ZYTycGu`. Project: `JByFRakFAP4x9knK`.

### Backfill re-run instructions
`POST /webhook/backfill-registration-financials` — **dry run by default**.
`{}` returns the full per-record plan and writes nothing. `{"dryRun": false}` applies. `maxWrites`
caps a live run (default 500). It is a pure recalculation, safe to re-run.

### Metrics re-run
`POST /webhook/event-recompute-metrics` with `{"eventId": "218"}`. Pure recalculation, also the
backfill tool for metrics. Safe any time.

---

## 3. The original problem, and what was actually wrong

**Two questions asked:** (1) are payments stamped back to the master registration? (2) when a guest
converts, is the invitation and inviting participant marked?

**Both answers were no.** Root causes found:

1. **Event 218 was hardcoded in 4 places** across two ACTIVE workflows (`REG` lookup + create + sheet
   column, `REV` lookup). Any non-218 checkout created a fresh registration on 218.
2. **`REV`'s product map had 1 entry** (product 2) out of 8 live Forum SKUs.
3. **The catch-all went to an AC-shaped filter.** Ontraport automation **15**
   `REG : Course Reg : Post-Purchase Setup (All Checkouts) [LIVE]` posts `{id, email}` to
   `/webhook/ac-purchase-update-forum-reg`, which tests the product name for "Advanced" and drops
   everything else into a node literally named **"Abandon - Not Advanced Course"**.
4. **Guest conversion fields existed but nothing wrote them** — `f2299`/`f2298`/`f2300`/`f2466` all 0
   across 375 invitations; `f2465` 0 across 221 registrations.
5. **A broken conversion-marking payload lives in automation 15** (see §6).

---

## 4. Reference data

### The six new oEvents metric fields (created by hand 2026-08-20)
`f3366` Guest Conversion Revenue (price) · `f3367` Advanced Course Revenue (price) ·
`f3368` Forum Revenue (price) · `f3369` Total Attributable Revenue (price) ·
`f3370` Guest Conversions With Inviter (numeric) · `f3371` Guest Conversions Self-Registered (numeric)

Pasted into the **Config** node of `QJ6DXWnJ1A4ytFeJ`. The four discount/full-price slots
(`discountCountField`, `fullPriceCountField`, `discountRevenueField`, `fullPriceRevenueField`) are
**deliberately blank** — user derives that split with Ontraport conditions instead. Those figures still
compute and return, they just write nowhere.

### Product catalogue (objectID 16)
**Forum:** 2 Landmark Forum $975 · 9 [Discount] $875 · 10 [Full] $1175 · 11 [Split Promo] $437.50 ·
12 [Split Full] $587.50 · 13 [Split Full – Payment 2] · 14 [Split Promo – Payment 2] · 7 TEST Forum Split
**AC:** 8 The Advanced Course $0 · 15 [FULL] $1150 · 16 [DISCOUNTED] $850

⚠️ **Products 10 and 15 have ZERO purchases ever.** All volume is on the discounted SKUs.
⚠️ **Product list prices are edited IN PLACE** — product 2 lists $975 today but all 11+ historical
purchases on it recorded **$495**. Only the purchase row's own `price`/`total_price` is trustworthy.

**Courses:** 1 = The Landmark Forum · 66 = Advanced Course · 113 Le Landmark Forum · 114 JP BTC

### Coupons (across the 146 matched purchases)
103 `VIPGUEST` (full scholarship, $0) · 28 none · 13 `LAUNCH26` ($370 off → $125) ·
1 `TJCTEST` (internal test) · 1 `REV26` ($195 reviewer → $300)

Event 218 was overwhelmingly a comped cohort. That is why its Forum revenue is low — **not** a
stamping gap.

### Key Ontraport ids
- **Objects:** 0 Contacts · 10000 Events · 10001 Registrations · 10002 Courses · 10003 Invitations ·
  16 Products · 17 Purchases · 46 Invoices · 140 Automations · 6 Rules
- **Automations:** 15 Post-Purchase Setup (All Checkouts) · 24 Checkout Update Event Start Date ·
  58 Create Registration at Checkout · 63 Set Forum Start Date + Reschedule Split Payment
- **Rules:** 5045 If test registration tag as test · 5046/5047/5048 Set Course Type ·
  5049 AC Registration → Stamp Forum Registration (webhook) — *precedent for a rule on 10001*
- **Registration status `f2424`:** 154 Active · 491 Withdraw
- **Financial status `f2824`:** 320 Written Off · 321 Voided · 322 Refunded · 323 Paid ·
  324 Partially Paid · 325 Booked · 326 Pending
- **Course type `f2830`:** 337 Seminar · 338 Advanced Course · 339 Landmark Forum
- **Invitation status `f2291`:** 127 Registered · 128 Attended not registered · 129 Not attended

---

## 5. Gotchas that cost real time — do not rediscover these

### n8n
1. **The Workflow SDK silently drops `expr()` nested inside `options.pagination.pagination.parameters`.**
   It imported as `{type:'qs', name:'', value:''}` with `paginationCompleteWhen` reset to
   `responseIsEmpty`. Valid workflow, no warning, read exactly one page of 50 and built a
   confident-looking plan over a 23% sample.
2. **`$pageCount` does not resolve inside pagination parameters** on this n8n build. The offset never
   reached the query string; n8n aborted with *"The returned response was identical 5x"*.
3. **`update_workflow`'s `updateNodeParameters` MERGES, it does not replace.** Rewriting `options` left
   the old broken `pagination` block underneath, still firing. Disable explicitly via
   `setNodeParameter` on `/options/pagination/pagination/paginationMode` = `off`.
4. **Working pagination pattern:** a Code node emitting one item per offset (`start = i * 50`), feeding
   an HTTP node whose `start` query param is `={{ $json.start }}`, with n8n pagination OFF.
5. **JSON Pointer paths cannot descend into arrays** — `setNodeParameter` on
   `/conditions/conditions/0/...` fails. Use `updateNodeParameters` with the whole object.
6. **`update_workflow` saves a DRAFT only.** Compare `versionId` vs `activeVersionId`; call
   `publish_workflow` to go live.
7. **SDK sandbox bans `Object.assign`** at the top level of workflow code. Use spread.

### Ontraport
8. **⚠️ An unusable `ids` value is IGNORED — it returns an arbitrary page, not an empty set.** Passing
   sentinel `ids=0` returned 50 unrelated registrations whose cash was summed as Guest Conversion
   Revenue: **$5,080 invented against a conversion count of 0**. Never send a sentinel id; guard on the
   source list being non-empty and skip the call, then filter the response against that same list.
9. **`f2259` Guest renders as a DISPLAY STRING, not an id** (`"Corey Yeaton corey@…"`). Use the
   `f2259//id` extern. But `f2260` and `f2466` **do** return plain ids — the rendering is inconsistent
   per parent field. Check each one.
10. **Field creation via API is refused on this account.** Create fields by hand in Field Manager.
11. **`range` caps at 50** per page on `/1/objects`; `ids` lookups also cap at 50.
12. Account rate limit is **360/min** (not the documented 180).

---

## 6. The broken conversion payload inside automation 15

Found in Ontraport automation **15**, posting to `https://api.ontraport.com/1/Invitations`:

```json
{
  "f2291": "127",
  "f2299": "1",
  "unique_id": "[Temp Invitation ID]"
}
```

Decoded: set oInvitations Status = Registered, Registered for Forum = checked, targeting the invitation
by `unique_id` stashed on the contact in **`f2285` "Temp Invitation ID"**.

**It has never fired.** `f2285` is empty on **every contact (0 records)**, so the merge field renders
blank and matches nothing. Confirmed by `f2299` = 0 and `f2291` = 0 across all 375 invitations.

Further problems:
- No `objectID` (consistent with believing `/1/Invitations` is a valid named endpoint — unverified;
  an unauthenticated probe returns 401 for *every* path including invented ones, so it proves nothing)
- **Forum only.** Automation 15 fires on *every* purchase, so an AC buyer with an invitation would have
  been marked a **Forum** conversion. Had `f2285` ever been populated this would have produced wrong
  data rather than no data.

**Recommendation: delete this step when reworking automation 15.** Left in place it is an inert no-op
that looks reasonable — someone later populates `f2285` and two systems write the same fields by
different routes, one of which never sets `f2466`/`f2465`.

---

## 7. Corrections to claims made earlier in the session

- **"107 of 133 event-218 registrations are missing Cash Collected; revenue under-reports by ~80%"** —
  **WRONG.** Only **17** records needed a cash correction. The ~105 zeros are genuinely $0 sales
  (VIPGUEST scholarships, TJCTEST tests, 100%-discount lines). A zero was inferred to be missing data
  without checking why it was zero.
- The guest-conversion metrics engine ran twice with **truncated** reads (50 of 133 registrations,
  50 of 372 invitations) before the pagination fix. Any figure quoted before execution **104619** is
  unreliable.

---

## 8. Open items

**Blocking the router rework** — the two questions in §0.

**Data questions for the client:**
- **Geoff Smyth (contact 1183)** has two registrations (1324, 1325) on event 283 and two separate $875
  charges — **$1,750**. Both created by the form, so he went through the flow twice. Intentional?
- **`f2424` Registration Status is blank** (`0`, not 154) on registrations 1324, 1325 and 1308. Nothing
  in the creation chain sets it. The AC stamper and others filter `f2424 = 154 Active`, so these records
  are invisible to them. Needs fixing at the source.
- **Killian Black paid $425** for AC [DISCOUNTED] where everyone else paid $850. No split SKU exists
  for AC. Unexplained.

**Still unbuilt:**
- **AC financial stamping at source.** The backfill filled the 10 existing AC registrations, but no
  live workflow writes AC money going forward. `REV` is Forum-only by design (AC money belongs on the
  AC registration, not doubled onto the master).
- `AC : Create Registration at Checkout` (`S26UUphNMJGlIH5H`) and `AC : Set Advanced Course Dates`
  (`2wIr1oC7lCjPYe7J`) are both **INACTIVE**.
- **Publish + wire:** automation 15 repoint (with `[Last Invoice #]` = `mriInvoiceNum` added to the
  payload — it is populated and removes the newest-purchase-by-date race), and an Ontraport rule on
  10001 record-created pointing at the attribution workflow.

**Rollups to watch:** `f2301`, `f2467`, `f2468` on oEvents are auto-calculating rollups currently at 0.
They should self-populate once attribution writes `f2299`/`f2466` — the rollup *conditions* are not
readable via API, so verify empirically on the first real conversion.

---

## 9. Memory files (persist across sessions)

`~/.claude/projects/c--Users-Mickey-Downloads-Landmark-landmark-new-era/memory/`

- `project_landmark_checkout_payment_stamping.md` — **the main record for this work**
- `project_ontraport_invitations_guest_identity.md` — guest identity, conversion fields, attribution
- `project_ontraport_f2878_refund_bug.md` — why `f2878` must never be written from a refund flag
- `project_n8n_update_saves_draft_only.md` · `project_ontraport_related_data_externs.md` ·
  `project_ontraport_api_rate_limit.md`
