# Forum Checkout Pipeline

**Landmark Worldwide — New Era Forum**

What fires from the moment a purchase is submitted, in what order, and which record owns each write.

Ontraport account 270197 · n8n landmarkworldwide.awesomate.io · Reverse-engineered from registrations 1324 & 1325, 20 Aug 2026

## The organising principle

**The registration record is the anchor, not the purchase.**

At purchase time there is no registration and no chosen event, so nothing event-shaped can be written yet. The registration is created by the Step 02 date-selection form with the event already attached — that is the first moment contact, event and purchase are all knowable together.

Ordering at purchase time is also unreliable. On the two live purchases on 20 Aug, the post-purchase webhook fired *17 seconds before* the registration existed on one, and *19 seconds after* it on the next. Anything triggered off the purchase inherits that race.

## Stage 0 — Before submit

*Page-side, not Ontraport*

The only place identity corruption can be prevented. Everything downstream inherits it.

- **On checkout page load** — compare the typed email against the session-matched contact. On mismatch, force a new-contact submission.
- **On confirmation page** — clear Ontraport's tracking and session cookies (the ones feeding `gsid`).

**Why this is first.** On 20 Aug two people checked out on one browser 41 minutes apart. The second submit overwrote the first buyer's name, email and address on the same contact record. The pipeline then processed both purchases faithfully — for the wrong person. No downstream logic can recover from a bad identity match.

## Stage 1 — Purchase submitted

*Trigger: checkout form*

Contact, invoice and purchase land. Writes **contact-level state only** — it records intent, and does not create a registration.

Contact writes:

- **`mriInvoiceNum`** — set to the invoice id. Already exists as a native field and is already populated.
- **Forum Purchase Status** — set to Awaiting Dates. Field must be created. This is "Registered for Forum = true, waiting for dates".
- **Forum Purchase Invoice** — set to a snapshot of the invoice id. Field must be created. Immutable per purchase.

**Why a second invoice field.** A single mutable "last invoice" field cannot describe a contact with two purchases. On 20 Aug the second checkout moved `mriInvoiceNum` from 498 to 502, erasing the only pointer to the first purchase.

## Stage 2 — Dates chosen → registration created

*Trigger: Ontraport rule on object 10001, record created*

The anchor. One workflow, one door. Precedent already exists — rule 5049 fires a webhook off object 10001 today.

### Identity and status

- **`f2424` Registration Status** → 154 Active. Currently blank on every new record, which makes them invisible to every workflow filtering on Active.
- **`f2458` Course** → from the product map. Set deterministically here, replacing the unidentified caller.
- **`f2830` Course Type** → 339 Landmark Forum. The rule fires off `f2458`; set it directly as belt-and-braces.

### Financials, from the resolved purchase

`f2844` `f2848` `f2841` `f2820` `f2854` `f2857` `f2860` `f2863` `f2869` `f2872` `f2874` `f2875` `f2970` `f2835` `f3045`

**Never** write `f2878` Test Registration from the invoice refund flag — that silently marks refunded live registrations as test records. Refunds set `f2824 = 322 Refunded` instead.

### Dates

**Core rule: never compute a date string the event already holds.** `f3099` Graduation Day and Date, `f3100`/`f3101` graduation times, `f3102` time zone, `f2394` start date and `f3086` countdown reference all arrive *free* as related-data mirrors the moment `f2214` is set. Verified live on registration 1325.

Only three registration fields have no event source: `f3108` Graduation Day – Full, `f3109` Short, and `f3110` TOD.

**Recommendation.** Add those three to the **event** instead and mirror them. Three values per event, authored once by whoever builds the event, versus three derived writes on every registration forever — and derivation is where format drift starts. Event 218 already reads `Tues, Aug 18, 2026` while event 283 reads `Tuesday, November 10, 2026`; parsing both reliably is work you don't need to own.

Contact writes — normalise from the event, not from form input:

- **`f3013` Chosen Event Start Date** ← event `f2988`. Currently empty.
- **`f2481` Chosen Event Dates** ← event `f2753`. Currently empty.
- **`f2696` Chosen Event End Date** ← event `f2989`. Currently crude — the form writes `11-8-2026`.
- **`f2454` Forum Start Date** ← event `f2233`. Already works.
- **Forum Purchase Status** → Dates Chosen. Field must be created.

## Stage 3 — Terms and conditions

*Trigger: Step 03 form*

Writes the information-form block — `f2574` to `f2585`, and `f3279` Preferred Name. This already works.

Add `f2579` Information Form Completed so an abandoned Step 03 is detectable. Registration 1325 never received this block and nothing flags it.

## Stage 4 — Guest conversion attribution

*Chained off Stage 2, same execution*

Find the invitation, mark the conversion, recompute the source event. Writes `f2291 = 127` Registered, `f2299 = 1` Registered for Forum, and `f2466` = the registration id.

1. **Deduplicate.** One contact can hold several invitations for the same event — contact 1183 holds both 1124 and 1133 for event 218. Pick one deterministically: *prefer the invitation carrying an inviter*, tie-break on lowest id, and mark exactly one. Otherwise a single conversion counts twice.
2. **Credit the source event.** The invitation's `f2258` — the event where they were a guest — not the event they just bought into.

**Already proven.** This logic is currently correct on invitation 946 → registration 1324 and invitation 1124 → registration 1325. It needs moving onto the registration-created trigger rather than being run by hand.

## Stage 5 — Sweepers

*Scheduled, idempotent*

- **Forum purchase, `f2969` empty, older than 30 min** — bought but never completed Step 02. Handled operationally rather than answered theoretically.
- **Registration with `f2214` set, `f2875` not Synced** — financial stamp missed.
- **Registration `f2424` = 0** — anything that slipped past Stage 2.
- **Contact Forum Purchase Status = Awaiting Dates, older than 24h** — abandoned funnel, CS follow-up list.

## Guardrails to build in

- **One door.** Repoint automation 15 at the router and delete its `/1/Invitations` payload. It targets `f2285` Temp Invitation ID, which is empty on every contact in the account, so it is an inert no-op that will collide the day someone populates that field.
- **Claim before write.** `f2970` Payment Record is an exclusive one-to-one, and `f2969` is its purchase-side twin. Use it as the idempotency key so a re-run cannot double-stamp.
- **Never send a sentinel id.** Ontraport ignores an unusable `ids` value and returns an arbitrary page rather than an empty set. Guard on the source list being non-empty and skip the call, then filter the response against that same list.
- **Buyer is not always the registrant.** Four of the five cross-contact payment links in the account are household purchases — one family member paying for another. At creation time buyer and registrant are the same record; divergence is created later by human correction, and the link still points at the right purchase. Do not "fix" it.
- **Publishing means publishing.** `update_workflow` saves a draft; the previously active version keeps serving until `publish_workflow` is called.
- **Rate limit is 360 requests per minute** on this account, not the documented 180. Requests over the limit fail; they do not queue.

## Blocking Stage 2

1. **The `f2458` writer is still unidentified.** Something using the n8n API credential sets Course roughly nine minutes after registration creation. Eliminated so far: `QjA13vVwnalgDvEr` (its only write targets the contact), `6Ki7pEPczPvI8Cqq` (abandons and writes nothing) and `npITxdMALHR0tdPK`. If Stage 2 sets `f2458` while that caller is still live, they race. It must be found and retired first.
2. **Field creation by API is refused on this account.** The new contact fields — and the three event fields, if that route is taken — must be created by hand in Field Manager before anything can write to them.

## Hand-work before build

- Create contact field **Forum Purchase Status** (dropdown: Awaiting Dates / Dates Chosen / Complete).
- Create contact field **Forum Purchase Invoice** (text).
- Create event fields **Graduation Day – Full**, **Graduation Day – Short**, **Graduation TOD**, plus their related-data mirrors on the registration.
- Normalise the existing day-and-date formats across event records so the mirrors read consistently.
- Locate and retire the unidentified `f2458` writer.
