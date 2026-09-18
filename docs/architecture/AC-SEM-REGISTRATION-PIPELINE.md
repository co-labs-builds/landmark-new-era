# Advanced Course & Seminar Pipeline

**Landmark Worldwide — New Era**

What fires when a participant signs up for the Advanced Course or a Seminar, and which records own each write.

Ontraport account 270197 · n8n landmarkworldwide.awesomate.io · Read live 21 Aug 2026

## How this differs from the Forum pipeline

The Forum pipeline starts with a stranger at a checkout. AC and Seminar start with a **known participant who already holds a master Forum registration**. Three consequences follow.

- **Identity is not at risk the same way.** The signup page is keyed to the master registration's own unique id — `page_107` Participant Advanced/Seminar Signup — so there is no cookie-matching step to get wrong. Stage 0 of the Forum pipeline has no equivalent here.
- **Every signup has three write targets, not one.** The new registration, the master Forum registration, and the invitation.
- **The invitation belongs to the participant's source event**, not the AC or Seminar event they just joined.

## The three write targets

1. **The new registration** — its own record on object 10001, course type 338 Advanced Course or 337 Seminar. This is the anchor.
2. **The master Forum registration** — a checkbox plus a detail block, so the portal and the email templates can render the participant's next course without a second lookup.
3. **The invitation** — `f2298` Registered for Advanced Course or `f2300` Registered for Seminar. Only if the participant came in as a guest; many did not.

## Current state, read 21 Aug 2026

### Seminar — working end to end

- `SEM : Create Seminar Registration (Pilot)` (`klOH6X4rFYniYJ9i`) — **active**
- `SEM : Seminar Confirmed -> Update Forum Registration` (`I9u1ndXxf2JQhnDh`) — **active**
- 75 seminar registrations exist, and all 75 carry `f2424` = 154 Active.
- 75 master registrations carry `f3276` Seminar Event ID; 74 of them also have `f2303` checked.
- **No seminar product exists** in the catalogue — 16 products, none of them a seminar SKU. So 0 of 75 seminar registrations carrying purchase or cash data is correct by design, not a gap.

### Advanced Course — dead at the door

- `AC : Create Registration at Checkout` (`S26UUphNMJGlIH5H`) — **inactive**
- `AC : Set Advanced Course Dates` (`2wIr1oC7lCjPYe7J`) — **inactive**
- `AC : Calendars : Build AddEvent Calendars + Session Events` (`CMsHl0Digu7Opoka`) — **inactive**
- `AC : Registration Confirmed -> Update Forum Registration` (`XuW1rh03v4wyFZPN`) — **active, but orphaned.** Both of its callers are switched off, so it is never invoked.

The consequence, in numbers:

- **29 Advanced Course purchases exist. 10 Advanced Course registrations exist.**
- 19 of those purchases are unclaimed — `f2969` is 0, so no registration holds them.
- Of the 10 AC registrations that do exist, only 3 carry `f2424` = 154 Active.
- 14 master registrations have `f2302` AC Registration checked, but only 9 carry the AC detail block.

### Invitations — nothing is marked

- `f2298` Registered for Advanced Course = 1 on **0** invitations.
- `f2300` Registered for Seminar = 1 on **0** invitations.
- `f2299` Registered for Forum = 1 on **2** — invitations 946 and 1124, both written on 20 Aug.

## Advanced Course track

### Stage A1 — Purchase submitted

*Trigger: checkout form, products 8 / 15 / 16*

Contact, invoice and purchase land. As with the Forum, no event has been chosen yet, so this stage writes contact-level state only and does **not** create a registration.

- Set the contact's AC purchase state to Awaiting Dates.
- Record the invoice id immutably, for the same reason the Forum pipeline does — a second purchase overwrites `mriInvoiceNum`.

### Stage A2 — Dates chosen → AC registration created

*Trigger: Ontraport rule on object 10001, record created, course type 338*

The anchor. Writes on the **new AC registration**:

- **`f2213` Contact, `f2214` Event** — the AC event.
- **`f2458` Course** → 66 Advanced Course. **`f2830` Course Type** → 338.
- **`f2424` Registration Status** → 154 Active. Only 3 of the existing 10 have this.
- **`f2237` Registration Date**, **`f3067` AC Reg Date**.
- **Financials from the resolved purchase** — `f2844` `f2848` `f2841` `f2820` `f2854` `f2857` `f2860` `f2863` `f2869` `f2872` `f2874` `f2875` `f2970`.
- **`f2465` Source Invitation** — currently 0 on all 10.

Dates follow the Forum rule: **never compute a date string the event already holds.** The AC event record carries the written-out formats; mirror them rather than deriving them.

### Stage A3 — Stamp back to the master Forum registration

*Chained off Stage A2, same execution*

This is what `AC : Registration Confirmed -> Update Forum Registration` already does. It needs its caller turned back on, not a rewrite.

On the **master Forum registration**:

- **`f2302` AC Registration** → checked.
- **`f2889` AC Registration Status** → 390 Registered. **`f2887` AC Potential Status** → 382 Potential.
- **Detail block** — `f3287` AC Event ID, `f3186` AC Title, `f3288` AC Dates, `f3290` AC Begins, `f3289` AC Pattern, `f3291` AC Schedule, `f3285` AC Start Date, `f3286` AC End Date, `f3292` AC Session Dates, `f3293` AC Session Start Time, `f3294` AC Time Zone, `f3295` AC Graduation Day and Date, `f3296` AC Graduation Start Time, `f3297` AC Graduation End Time, `f3298` AC Format, `f3304` AC Add To Calendar URL.
- **`f2890` AC Course Choice** — 392 Designated or 391 Alternate.

The existing workflow's PUT body is hand-assembled precisely so the first call cannot blank what the second call sets. Preserve that behaviour.

### Stage A4 — Invitation

*Chained off Stage A2*

If the participant holds an invitation, set **`f2298`** Registered for Advanced Course and recompute metrics on the invitation's source event `f2258`.

## Seminar track

### Stage S1 — Signup

*Trigger: Participant Advanced/Seminar Signup page*

No purchase, no invoice, no financial stage. Seminars have no SKU. Do not stamp empty financial fields onto the record.

### Stage S2 — Seminar registration created

*Trigger: Ontraport rule on object 10001, record created, course type 337*

On the **new seminar registration**: `f2213` Contact, `f2214` Event, `f2458` Course, `f2830` → 337, `f2424` → 154 Active, `f2237` Registration Date, and `f2465` Source Invitation.

This half already works — all 75 existing records are Active.

### Stage S3 — Stamp back to the master Forum registration

*Handled today by `SEM : Seminar Confirmed -> Update Forum Registration`*

- **`f2303` SEM Registration** → checked.
- **`f2882` Seminar Potential Status** → 371 Potential. **`f2884` Seminar Confirmation Status** → 378 Confirmed.
- **Detail block** — `f3276` Seminar Event ID, `f3185` Seminar Title, `f3271` Seminar Dates, `f3274` Seminar Begins, `f3272` Seminar Pattern, `f3275` Seminar Schedule, `f3277` Seminar Start Date, `f3283` Seminar End Date, `f3278` Seminar Session Dates, `f3282` Seminar Language.
- **`f2885` Seminar Course Choice** — 380 Designated or 379 Alternate.

### Stage S4 — Invitation

Set **`f2300`** Registered for Seminar, credit the source event `f2258`.

## Cross-cutting rules

### Finding the master registration is the landmine

`AC : Registration Confirmed -> Update Forum Registration` locates the master by contact, `f2424` = 154 Active, and is-Forum, newest event first. **`f2424` is blank on every newly created Forum registration.**

So a participant who registers for the Forum today and buys the Advanced Course tomorrow has a master the stamper cannot see. Setting `f2424` = 154 in Forum Stage 2 fixes the Forum pipeline and both of these tracks at the same time. It is the single highest-value change across all three.

### `f2466` holds one registration only

`f2466` Resulting Registration already points at the Forum registration on both marked invitations. If the same guest later buys the Advanced Course and the attribution step writes `f2466` again, the Forum attribution is destroyed.

**Rule: `f2466` records the first conversion — the Forum registration. Advanced Course and Seminar conversions are recorded by `f2298` and `f2300` alone.**

### The invitation may not exist, or there may be several

Most participants have no invitation at all. Some have more than one for the same event — contact 1183 holds both 1124 and 1133 for event 218. Apply the same rule as the Forum track: prefer the invitation carrying an inviter, tie-break on lowest id, mark exactly one, and credit the source event `f2258` rather than the course just joined.

### Advanced Course money belongs on the AC registration

`f2970` Payment Record is an exclusive one-to-one. Two AC purchases are currently parked on master Forum registrations — purchase 512 on registration 797, and purchase 513 on registration 1183 — because no AC registration existed to hold them. Once AC registration creation is live, those two move onto their own records.

### Seminars carry no money, and that is correct

Zero of 75 seminar registrations have purchase or cash data because no seminar product exists. Do not treat those zeros as a backfill gap.

## What to fix, in order

1. **Set `f2424` = 154 Active** on registration creation. Unblocks the master lookup for both tracks.
2. **Turn on `AC : Create Registration at Checkout`**, de-hardcoded from event 218 first. This is why 29 purchases produced 10 registrations.
3. **Backfill the 19 unclaimed Advanced Course purchases** into AC registrations, then move their `f2970` links off the master.
4. **Reconcile the 5 master registrations** carrying `f2302` with no detail block — registrations 797, 957, 1008, 1042 and 1183. All five contacts do hold a paid $850 AC purchase.
5. **Reconcile the 1 master** carrying `f3276` Seminar Event ID with `f2303` unchecked — registration 748.
6. **Wire `f2298` and `f2300`** into the attribution step. Both are currently 0 across every invitation.

## Also worth a look

**Contact 915 holds two $850 Advanced Course purchases** — 466 and 467, both unclaimed. Same double-charge shape as the Geoff Smyth incident on 20 Aug, and worth checking before the AC backfill runs, so it does not create two registrations for one person.
