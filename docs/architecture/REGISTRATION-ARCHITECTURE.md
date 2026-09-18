# Registration Data Architecture

**Landmark Worldwide — New Era**

The three-layer model, how a purchase moves through it, and what has to change so a shared browser can never again overwrite one participant with another.

Ontraport account 270197 · n8n landmarkworldwide.awesomate.io · All figures read live 21 Aug 2026

## The model

Three objects, three jobs. Every field belongs to exactly one of them.

- **Invitation — the entry point.** How this person first entered the ecosystem. Who invited them, to which event, and what that invitation eventually produced. Written once, at the start. Not everyone has one.
- **Contact — the journey.** Surface level. Where is this person now, in one glance: Registered for Forum, Completed Forum, Attended Graduation, Registered for Seminar, Registered for Advanced Course. This is the layer you segment, filter and report on.
- **Registration — the deep dive.** One record per course engagement, holding everything about that step: the event, the dates, the money, attendance, the information form, the outcome.

### Deciding where a field goes

- Would you build a list or a group on it? → **Contact.**
- Does it describe one specific course engagement? → **Registration.**
- Does it describe how they arrived? → **Invitation.**

The contact layer is a *summary* of the registration layer. It never holds anything the registrations don't already prove, and it is always derived, never typed.

## Layer 1 — Invitation: the entry point

376 invitation records exist. 281 carry an inviter; the rest are self-registered guests.

**Key fields.** `f2258` Event (the source event), `f2259` Guest, `f2260` / `f2257` Inviter, `f2291` Status, `f2337` Graduate Status, `f3210` Attended. Conversion is recorded by `f2299` Registered for Forum, `f2298` Registered for Advanced Course, `f2300` Registered for Seminar, and `f2466` Resulting Registration.

**Current state.** `f2299` is set on **2** invitations — 946 and 1124, both written 20 Aug. `f2298` and `f2300` are set on **0**.

### Three rules

- **Credit the source event, always.** A guest invited at event 218 who registers for the November Forum is a *registrant* of 283 but a *conversion* of 218. The scope is the invitation's `f2258`, never the event they joined.
- **One contact may hold several invitations for the same event.** Contact 1183 holds both 1124 and 1133 for event 218. Deduplicate: prefer the invitation carrying an inviter, tie-break on lowest id, mark exactly one. Otherwise one conversion counts twice.
- **`f2466` holds one registration only.** It already points at the Forum registration on both marked invitations. If the same guest later buys the Advanced Course and something writes `f2466` again, the Forum attribution is destroyed. **`f2466` records the first conversion. Advanced Course and Seminar conversions ride on `f2298` and `f2300` alone.**

## Layer 2 — Contact: the journey

**The journey fields already exist. Nothing needs creating.**

- `f3359` **Registered For Forum** — check
- `f3360` **Completed Forum** — check
- `f3361` **Attended Graduation** — check
- `f3362` **Registered For Seminar** — check
- `f3363` **Registered For Advanced Course** — check
- `f3372` **Date Purchased** — timestamp
- `f3373` **Price Paid** — price
- `f3374` **Forum Registration ID** — text
- `f3305` **Master Record ID** — text

**Current population, across 667 contacts.** `f3359` is set on **113**. `f3360` is set on **102** — exactly the event 218 completer count, so this was backfilled once from that cohort and never maintained. `f3361`, `f3362` and `f3363` are set on **0**. `f3374` and `f3305` are set on **0**.

So half the journey layer was populated by hand for one event, and nothing writes any of it going forward.

### Rules for the journey layer

- **Derived, never typed.** Every flag is written by the router from a registration that actually exists. If a flag is true, a registration proves it.
- **Monotonic. Set, never clear.** "Completed Forum" stays true forever. Withdrawal and refund are registration-level facts; they do not un-happen a journey step.
- **`f3374` Forum Registration ID is the pointer to the master.** Today the Advanced Course and Seminar stampers find the master Forum registration by searching contact + `f2424` = 154 Active + newest event. `f2424` is blank on every newly created Forum registration, so that search misses exactly the people who registered most recently. Writing `f3374` at Forum registration removes the search entirely.

## Layer 3 — Registration: the deep dive

224 registrations: **139 Forum**, **75 Seminar**, **10 Advanced Course**.

**The Forum registration is the master.** It holds the participant's own course detail *and* a summary block for whatever they signed up for next, so the portal and the email templates can render the next step without a second lookup.

- Advanced Course block — `f2302` checked, `f2889` Registration Status, `f2887` Potential Status, plus `f3287` Event ID, `f3186` Title, `f3288` Dates, `f3290` Begins, `f3289` Pattern, `f3291` Schedule, `f3285` Start Date, `f3286` End Date, `f3292` Session Dates, `f3067` Reg Date, `f3293` Session Start Time, `f3294` Time Zone, `f3295` Graduation Day and Date, `f3296` / `f3297` Graduation Times, `f3298` Format, `f3304` Add To Calendar URL.
- Seminar block — `f2303` checked, `f2882` Potential Status, `f2884` Confirmation Status, plus `f3276` Event ID, `f3185` Title, `f3271` Dates, `f3274` Begins, `f3272` Pattern, `f3275` Schedule, `f3277` Start Date, `f3283` End Date, `f3278` Session Dates, `f3282` Language.

**Advanced Course and Seminar each get their own registration record too**, so each engagement has somewhere to hold its own event, dates, money and attendance. The block on the master is a mirror for display; the AC or Seminar record is the source of truth for that step.

### Dates: never compute what the event already holds

`f3099` Graduation Day and Date, `f3100` / `f3101` graduation times, `f3102` time zone, `f2394` start date, `f3086` countdown reference and `f3080` course all arrive **free** as related-data mirrors the moment `f2214` is set. Confirmed live on registration 1325.

Only three registration fields have no event source — `f3108` Graduation Day Full, `f3109` Short, `f3110` TOD. Add those to the **event** and mirror them, rather than deriving a day name on every registration forever. Event 218 reads `Tues, Aug 18, 2026` while event 283 reads `Tuesday, November 10, 2026`; parsing both reliably is work you don't need to own.

## Protecting identity — the duplicate and cookie override

### What happens

Ontraport's tracking script identifies the visitor from a browser cookie **before** the form is submitted. The fillout is matched to that contact — **not to the email typed into the form**. So when a second person uses the same browser, their submit updates the first person's record, identity fields included.

On 20 Aug, two people checked out on one laptop 41 minutes apart. The record was created on 18 Aug by Participant A's own graduation self-registration, so her 2:49pm checkout matched correctly. At 3:30pm Participant B checked out on the same still-cookied session, and the log shows the overwrite explicitly: first name, last name and email all rewritten from A's values to B's, and the address moved from Arkansas to London. Two $875 invoices ended up on one contact, and B's own record — contact 1210, created 18 Aug — was never touched.

**The cookie that caused it was left by the previous checkout on the same browser.** That matters: it is the chaining case, and it is preventable.

### Six defences, in order of leverage

**1. Stop the checkout form overwriting identity fields.** If the form's First Name, Last Name and Email mappings are set not to overwrite an existing populated value, a second person's submit can no longer destroy the first person's identity. The purchase still attaches to the wrong contact, but nothing is lost and the mismatch stays detectable. This converts a destructive failure into a recoverable one, which is why it comes first. *To verify: whether Ontraport form field mappings support set-if-empty on this account.*

**2. Clear the tracking session at the end of every checkout.** On the confirmation and Step 03 completion pages, clear Ontraport's tracking and session cookies — the ones feeding `gsid`. This alone would have prevented the 20 Aug incident. Confirm the exact cookie names in DevTools on the live page.

**3. Put a "Not you?" control on the checkout page.** Landmark's audience genuinely shares laptops at graduation events. Show the session-matched name and email at the top of the form with a link that clears the session and reloads. Design for the shared device instead of treating it as an edge case.

**4. Guard typed email against the session contact.** On submit, compare the typed email to the session-matched contact; on mismatch, force a new-contact submission. This is the capability in the open Ontraport support ticket.

**5. Detect it server-side — the defence we fully control.** `f2674` Email on the registration is captured at Step 02 from the form and is never rewritten afterwards. The contact's own `email` can be overwritten later. **A registration whose `f2674` differs from its contact's `email` is the signature of an override.** That is exactly how the two records were untangled. Make it a check in the router and a standing sweeper — it needs nothing from Ontraport.

**6. Sweep for duplicate contacts, and use `f3305`.** Email uniqueness is not enforced here: contacts 1183 and 1210 both hold Participant B's email address. `f3305` Master Record ID exists and is unused on all 667 contacts. When duplicates are found, point the duplicate at the surviving record rather than deleting it, so invitations and history stay traceable.

### Repairing one after the fact

1. **`f2674` on each registration tells you who actually submitted it.** It survives the overwrite.
2. The information-form answers on that registration — emergency contact, preferred name, what I want to accomplish — belong to whoever submitted it, not to whoever the contact now says it is.
3. The purchase and invoice stay on the contact that was matched at the time. They must be moved deliberately; they do not follow the registration.
4. Check for a stranded invitation. Invitation 1133 is Participant A's graduation self-registration and still sits on Participant B's contact today.
5. Re-point records; do not delete them.

## The pipeline — two doors

### Door 1 — Purchase submitted

*Trigger: Ontraport automation 15, on every purchase*

There is no registration and no chosen event yet, and ordering is unreliable — on the two live purchases on 20 Aug the post-purchase webhook fired 17 seconds *before* the registration existed on one, and 19 seconds *after* it on the next. So this door is deliberately thin. It writes contact state only:

- Forum purchase state → Awaiting Dates.
- `f3372` Date Purchased, `f3373` Price Paid.
- An immutable snapshot of the invoice id. A single mutable "last invoice" cannot describe a contact with two purchases — on 20 Aug the second checkout moved `mriInvoiceNum` from 498 to 502.

Seminars skip this door entirely; they have no product.

### Door 2 — Registration created

*Trigger: Ontraport rule on object 10001, record created*

**This is the anchor, and it is the only trigger all three course types share.** Forum, Advanced Course and Seminar all create a record on 10001. Seminars never produce a purchase, so a purchase-triggered router structurally cannot cover them.

**Classify on the event's course, not on `f2830`.** Course Type is not set at creation — 24 seconds after registration 1325 was created, both `f2830` and `f2458` were still `0`. What *is* present is the event's course, mirrored in as `f3080` / `f3080_id`. The router reads that, then *sets* `f2458` and `f2830` itself — which also retires the unidentified writer that currently sets Course about nine minutes after creation.

**Shared head.** Resolve contact and event, classify from `f3080_id`, set `f2424` = 154 Active, `f2458`, `f2830`, `f2237`.

**Three branches, as separate sub-workflows.**

- *Forum* — financials onto this record; contact date fields; write `f3374` Forum Registration ID; no stamp-back, this record **is** the master.
- *Advanced Course* — financials onto the AC record; AC date block; stamp the AC block back onto the master.
- *Seminar* — no financial stage at all; seminar date block; stamp the Seminar block back onto the master.

Keep them as separate workflows rather than one flow: publishing is a discrete step on this account, and a monolith means a change to the Seminar branch forces a republish of the live Forum path.

**Shared tail.** Set the contact journey flag. Find the invitation, dedupe, mark the conversion, credit the source event, recompute event metrics. Identical for all three types; only the flag differs.

**Sweepers, built alongside the router, not after it.** One door is one point of failure, and these are what make that acceptable: registrations with `f2424` = 0; purchases with `f2969` empty older than 30 minutes; registrations with an event but no financial sync; contacts stuck on Awaiting Dates past 24 hours; and registrations whose `f2674` disagrees with their contact's email.

### After the branch — post-purchase and welcome sequencing

The router's job ends when the data is correct. **Communication is a separate layer**, and each branch hands off to its own track. There are 99 automations on the account and no legacy sequences — everything lives in Automations.

**The handoff rule: one explicit signal per type.** The router sets the contact journey flag and applies a start tag; the welcome track subscribes to that and nothing else. A sequence must never do its own product or event lookup to decide whether it applies — that is precisely how the current catch-all ended up testing product names inside a webhook and discarding every Forum buyer.

**Shared, for every purchase — already live.** 15 `REG : Course Reg : Post-Purchase Setup (All Checkouts)` · 38 `PORTAL : My Account : Grant Access`, which issues portal credentials · 2 / 4 / 3 `SYS : Maintenance` for Sales Stage, First Purchase Date and Last Activity · 40 `REG : Confirmation & NO DATE CHOSEN Reminder Loop : Post-Purchase Loop`, which nudges buyers who never picked dates — this already exists and is the communication half of the Awaiting Dates sweeper.

**Forum track — already live.** 25 `REG : Confirm : Registration Confirmation` · 19 `REG : Fulfillment : Forum Participants` · 62 `REG : PILOT Confirmation, and Pre-Course Reminders` · 72 `PILOT: Countdown Sequence: Registration, 14, 7, 2 days out` · 93 `REG : PILOT During Course` and 90 `Forum: During: Toggle-Switch Email Sends` · 20 `INV : Guest : Invite Your Friends`.

**Advanced Course track.** 13 `REG : Course Reg : Advanced for Participant` · 105 `Advanced Course Registration Confirmation` · 106 `AC: SET DATES`. These sit downstream of an Advanced Course registration that is not being created, so in practice they rarely fire. Turning AC registration creation back on is what activates this whole track.

**Seminar track.** 14 `REG : Course Reg : Seminar for Participant` · 16 `REG : Course Reg : Seminar Guest from Invite` · 103 `SEM: Seminar Confirmation`.

**Next-step offer funnels.** 108 `LF: Non-Grad Guest: Forum Offer Tue-Sat` · 109 `LF: Grad: Graduate Course Offer Tue-Sat` · 110 `DISC: Participants: Advanced Course Offer Tue-Sat` · 113 `LF: Participants: AC/Grad: Tues-Sat Funnel`.

These offer funnels segment on the journey layer. That is why keeping `f3359` to `f3363` accurate matters well beyond reporting — they are the audience definition the next sale runs on. A journey flag that nobody writes is a funnel that targets nobody.

**Two automations worth checking while you are in here.** 97 `Attended Graduation Checked on Contact Record` is plainly intended to write `f3361` Attended Graduation, and `f3361` is set on 0 of 667 contacts — so it is either unwired or silently not firing. And 61 `REG : Reconcile Duplicate Registration (Pilot)` already exists and is directly relevant to the duplicate-contact work below.

## Current state

**Forum.** Working, but `f2424` Registration Status is blank on every newly created record, which makes them invisible to every workflow that filters on Active — including the Advanced Course and Seminar stampers.

**Seminar.** Working end to end. `SEM : Create Seminar Registration (Pilot)` and `SEM : Seminar Confirmed -> Update Forum Registration` are both active. 75 registrations, all Active, 75 masters stamped. No seminar SKU exists in the 16-product catalogue, so zero money on all 75 is correct by design — not a backfill gap.

**Advanced Course.** Dead at the door. `AC : Create Registration at Checkout` and `AC : Set Advanced Course Dates` are both inactive. `AC : Registration Confirmed -> Update Forum Registration` is active but orphaned, because both of its callers are the two that are off. The result: **29 Advanced Course purchases, 10 Advanced Course registrations**, 19 of those purchases unclaimed. Only 3 of the 10 AC registrations are Active. 14 masters have `f2302` checked but only 9 carry the detail block.

**Post-purchase catch-all.** Automation 15 posts to `AC : Purchase -> Stamp Forum Registration`, which tests the product name for "Advanced" and drops everything else into a node named *Abandon - Not Advanced Course*. Confirmed live on Participant B's purchase: it resolved the product, set `isAdvancedCourse: false`, and returned *"Abandoned … Nothing written."* Every Forum purchase reaches an Advanced-Course-shaped filter and is discarded.

## Fix order

1. **Set `f2424` = 154 Active on registration creation.** Single highest-value change — it unblocks the master lookup for the Advanced Course and Seminar tracks at the same time as fixing the Forum records.
2. **Clear tracking cookies on the confirmation page**, and confirm whether form mappings can be set not to overwrite identity. Defences 1 and 2 above.
3. **Ship the `f2674` versus contact-email mismatch check.** It needs nothing from Ontraport and it catches the next incident on the day it happens.
4. **Build the router on registration-created**, classifying from `f3080_id`, with the three branches and the shared tail.
5. **Repoint automation 15** at the thin purchase handler and delete its `/1/Invitations` payload — it targets `f2285`, empty on every contact, so it is an inert no-op that will collide the day someone populates that field.
6. **Turn on Advanced Course registration creation**, de-hardcoded from event 218, then backfill the 19 unclaimed purchases.
7. **Backfill the journey layer** from the registrations that already exist, then let the router maintain it.

## Loose ends worth a look

- **Contact 915 holds two $850 Advanced Course purchases** — 466 and 467, both unclaimed. Same double-charge shape as the 20 Aug incident. Check before any AC backfill runs, so it does not create two registrations for one person.
- **Five masters carry `f2302` with no detail block** — registrations 797, 957, 1008, 1042 and 1183. All five contacts do hold a paid $850 AC purchase.
- **One master carries `f3276` Seminar Event ID with `f2303` unchecked** — registration 748.
- **Two AC purchases are parked on master Forum registrations** — 512 on registration 797, 513 on registration 1183 — because no AC record existed to hold them. `f2970` is an exclusive one-to-one, so the money had nowhere else to go.
- **Registration ids and contact ids collide.** Registration 1046 belongs to Havilah Malone; contact 1046 is Bev A. Registration 1183 belongs to Olivia Rolotti; contact 1183 is Participant B. Always state which object an id refers to.
