# My Account Write-Back Webhook — Build Spec

**For:** whoever builds this n8n workflow
**Context:** Landmark Member Portal (`member-portal.html` + `portal-engine.js`, hosted via Ontraport Page + jsDelivr). The portal's "My Account" modal lets a logged-in participant update their Display Name, Last Name, Email, Phone, and profile photo. The frontend is fully built and already calls this webhook — it just doesn't exist yet.

---

## 1. What this needs to do

Receive one submission from the browser containing text fields + an optional photo, then:

1. If a photo was submitted, upload it to Cloudinary and get back a permanent URL.
2. Write all the fields (including the new photo URL, if any) to the correct Ontraport Contact record.
3. Tell the browser whether it worked.

One consolidated call — not two separate integrations. The browser never talks to Cloudinary or Ontraport directly; it only ever talks to this webhook.

---

## 2. Request contract (what the browser sends)

`POST` to your webhook URL, `Content-Type: multipart/form-data`.

| Field | Type | Always present? | Notes |
|---|---|---|---|
| `contactId` | string | Yes | Ontraport Contact ID — see §4 for how this is obtained/trusted |
| `displayName` | string | Yes | May be empty string |
| `lastName` | string | Yes | May be empty string |
| `email` | string | Yes | May be empty string |
| `phone` | string | Yes | May be empty string |
| `photo` | file | Only if the participant picked a new photo | Whatever image format the browser's file picker allowed (no client-side restriction currently enforced — recommend the workflow validates/limits format and size, see §6) |

## 3. Response contract (what the browser expects back)

`Content-Type: application/json`.

**Success:**
```json
{ "success": true, "profileImageUrl": "https://res.cloudinary.com/.../photo.jpg" }
```
`profileImageUrl` should be **omitted entirely** (not `null`, just absent from the JSON) if no photo was submitted in this request — the frontend only updates the avatar when this key is present.

**Failure:**
```json
{ "success": false, "error": "human-readable reason" }
```
The frontend shows a generic "Save failed — try again" regardless of the error text, but include a real reason anyway for your own logging/debugging.

The frontend treats any non-2xx HTTP status, or a body that isn't valid JSON, or a body missing `"success": true`, as a failure — so it's safe to return a normal error status code (e.g. 400/500) with the failure JSON body above.

---

## 4. Workflow steps

**Step 1 — Webhook trigger node**
`POST`, accept `multipart/form-data`. This is the entry point; its URL is what gets pasted into the frontend config (see §7).

**Step 2 — (Optional) Upload photo to Cloudinary**
Only if the `photo` field is present in the incoming request.

- Cloudinary Upload API: `POST https://api.cloudinary.com/v1_1/<cloud_name>/image/upload`
- **Cloud name:** almost certainly `mynd` — this project already hosts its brand fonts on Cloudinary under that cloud name (`res.cloudinary.com/mynd/...`, see `member-portal.html`'s `@font-face` rule). Confirm with whoever has Cloudinary dashboard access before assuming it's the right account for photo uploads too — could be a different cloud/environment.
- Authenticate this call **server-side inside n8n** (API key + secret stored in n8n credentials, signed upload). Never expose Cloudinary credentials to the browser — that defeats the purpose of having a proxy at all.
- Take `secure_url` from Cloudinary's JSON response — that's your `profileImageUrl`.
- Recommend uploading into a dedicated folder (e.g. `member-portal/profile-photos/`) so these are easy to find/manage separately from the project's other Cloudinary-hosted assets (fonts, marketing images).

**Step 3 — Write to Ontraport**
HTTP Request node → Ontraport API, `contacts` object (**objectID `0`**), update the record identified by `contactId` from the incoming request.

Endpoint shape (Ontraport's standard object-update API — confirm exact path/verb against current Ontraport API docs when building, this describes the fields/values, not the literal HTTP call):
- Target object: `contacts` (objectID `0`)
- Record ID: `contactId` from the request
- Fields to write:

| Ontraport field key | Value from request | Notes |
|---|---|---|
| `f2620` | `displayName` | "Display Name" — **never write to `firstname`**, that's the participant's real name on file and must stay untouched |
| `lastname` | `lastName` | standard system field |
| `email` | `email` | standard system field |
| `sms_number` | `phone` | **not** `office_phone` — this project's SMS-consent fields are already keyed to `sms_number` specifically |
| `profile_image` | the Cloudinary `secure_url` from Step 2 | **only include this field in the update if Step 2 actually ran** (a photo was submitted) — don't send an empty/null value here on every save, that would wipe out an existing photo whenever someone updates just their name |

- Authenticate via an Ontraport API key stored in n8n credentials — never expose this to the browser.

**⚠️ Open question, verify before considering this done:** `profile_image` is typed as an `image` (file-upload) field in Ontraport's schema, not a plain `url`/`text` field. It's not confirmed whether Ontraport's `update_object`/`saveorupdate_object` API accepts a plain URL string for this field type the way it would for a `url`-type field, or whether it actually needs the image bytes uploaded through Ontraport's own file-upload mechanism instead. **Test this specifically** — write a real Cloudinary URL to a test contact's `profile_image` via the API and confirm it actually renders as their photo (check via the Ontraport dashboard or by re-fetching the field) before assuming this step works as described.

**Step 4 — Respond to the browser**
Return the JSON shape from §3 based on whether Step 3 succeeded.

---

## 5. Field reference (Ontraport `contacts`, objectID `0`)

| Field | Key | Type |
|---|---|---|
| Display Name | `f2620` | text |
| Last Name | `lastname` | text |
| Email | `email` | text |
| SMS Number | `sms_number` | text |
| Profile Image | `profile_image` | image (file upload) — see open question above |

(First Name, `firstname`, is intentionally not in this list — it's never written by this flow.)

---

## 6. Security — read this before building

**Identity is NOT cryptographically verified in this design, by explicit client decision (2026-08-09).**

`contactId` is read client-side from Ontraport's own `dcParam.contact_id` (a value Ontraport embeds on every membership-site page for its own session identification — visible in page source as `<script id='dc-param'>dcParam = {"object_id": "...", "contact_id": "...", "hash": "..."}</script>`) and sent to this webhook as-is. **This webhook does not verify that hash** — the signing scheme/secret Ontraport uses to generate it isn't known. That means anyone with browser DevTools access could, in principle, open the network request and submit a different `contactId`, overwriting a different participant's Display Name/photo/etc.

This was an **accepted risk**, not an oversight — the client's own call, made because this is a small, known pilot group, not a public-internet-scale concern. If this ever needs to be hardened later:
- Ask Ontraport support how `dcParam.hash` is generated and whether it can be independently verified.
- Or find a documented Ontraport API endpoint that verifies "is this the currently logged-in contact" server-side using the visitor's real session (rather than trusting a client-supplied ID).

**Recommended minimum hardening even while accepting this risk:**
- Rate-limit the webhook (e.g. per-IP or per-contactId) to make casual abuse harder.
- Validate `photo` file size/type server-side before uploading to Cloudinary (don't trust the browser's `<input accept="image/*">` as an actual restriction — it's a UI hint only, not enforced).
- Log every write (contactId + fields changed + timestamp) somewhere durable, so any misuse is at least traceable after the fact.

---

## 7. Wiring it up once built

One line to change in `portal-engine.js`, inside the `Portal.account` module:

```js
var ACCOUNT_UPDATE_WEBHOOK_URL = '';  // <- put the real n8n webhook URL here
```

After that: push to the repo (`github.com/co-labs-builds/landmark-new-era`), purge the jsDelivr cache for `portal-engine.js` (`https://purge.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/portal-engine.js`), and Save will work end-to-end — no other frontend changes needed. The frontend already:
- Builds the exact request shape in §2
- Handles the exact response shape in §3
- Updates the avatar and the in-memory page data immediately on success (no page reload needed to see the change reflected)
- Shows "Not connected yet" (current behavior, until this is wired) vs "Saving…" / "Saved ✓" / "Save failed — try again" appropriately

No frontend rebuild should be needed on your end beyond that one URL — flag it if the request/response shape above turns out to need adjusting for how you build the workflow, and that line + this doc are the only things that need updating in that case too.
