# Landmark Member Portal — My Account Write-Back Workflow Handoff

**Purpose:** Technical handoff for the agent responsible for wiring the Landmark Member Portal frontend to the completed n8n workflow and maintaining/debugging the workflow going forward.

**Status:** Backend workflow is built, tested end-to-end, published, and active.  
**Workflow:** `PORTAL : My Account : Write-Back`  
**n8n Workflow ID:** `dTqrDpYs9XWMwehp`  
**Last verified:** 2026-08-09  
**Cloudinary cloud:** `mynd`  
**Cloudinary n8n credential:** `Cloudinary - Landmark`  
**Ontraport object:** Contacts (`objectID = 0`)

---

## 1. What Was Built

A single n8n webhook workflow now handles the complete **My Account** save operation from the Landmark Member Portal.

The browser sends one `multipart/form-data` request containing the participant's editable text fields plus an optional new profile photo.

The workflow:

1. Validates the incoming request.
2. If a photo was submitted:
   - Loads the Contact from Ontraport.
   - Reads the Contact's actual Ontraport `unique_id`.
   - Builds the Contact-specific Cloudinary folder path.
   - Searches for that folder.
   - Reuses it if it already exists.
   - Creates it if it does not exist.
   - Uploads the new photo into that folder.
   - Captures Cloudinary's `secure_url`.
3. Updates the correct Ontraport Contact.
4. Writes `profile_image` only when a new photo was actually uploaded.
5. Returns JSON to the browser in the contract already expected by `portal-engine.js`.

The browser never communicates directly with Cloudinary or Ontraport.

---

## 2. Canonical Production Webhook URL

n8n currently reports this exact Production URL:

```text
https://landmarkworldwide.awesomate.io/webhook/482b78d7-0e00-4a20-ad2f-0d851c865574/portal-account-update
```

**Use the exact URL above when wiring `portal-engine.js`.**

Do not assume the shortened form:

```text
https://landmarkworldwide.awesomate.io/webhook/portal-account-update
```

is equivalent. The currently registered production trigger reports the UUID-based URL above.

### Webhook configuration

- Method: `POST`
- Path: `portal-account-update`
- n8n Webhook ID: `482b78d7-0e00-4a20-ad2f-0d851c865574`
- Authentication: none
- Response mode: Respond to Webhook node
- Incoming binary data enabled
- CORS currently allows `*`

---

## 3. Browser Request Contract

The portal sends:

```http
POST <production webhook URL>
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `contactId` | string | Yes | Numeric Ontraport Contact record ID |
| `displayName` | string | Yes | May be empty |
| `lastName` | string | Yes | May be empty |
| `email` | string | Yes | May be empty |
| `phone` | string | Yes | May be empty |
| `photo` | file | No | Present only when participant selected a new image |

### Important binary normalization

In actual n8n multipart testing, the incoming binary property may be named something like `photo0` instead of exactly `photo`.

The `Normalize and Validate Input` node intentionally handles this by finding a binary property whose key:

- equals `photo`, or
- starts with `photo`

and then normalizing it internally back to:

```text
photo
```

Do not remove this normalization unless the webhook behavior is retested.

---

## 4. Browser Response Contract

### Success without a new photo

```json
{
  "success": true
}
```

`profileImageUrl` is intentionally omitted.

### Success with a new photo

```json
{
  "success": true,
  "profileImageUrl": "https://res.cloudinary.com/..."
}
```

### Failure

```json
{
  "success": false,
  "error": "human-readable reason"
}
```

Current failure behavior includes:

- `400` for invalid/missing `contactId` or invalid photo type.
- `502` for upstream identity lookup / Cloudinary folder / Cloudinary upload failures.
- Ontraport update failures return the upstream error status when possible, otherwise `500`.

All responses are JSON and include CORS response headers.

---

## 5. Ontraport Field Mapping

The workflow updates Ontraport Contacts (`objectID = 0`).

| Ontraport field | Source | Behavior |
|---|---|---|
| `f2620` | `displayName` | Always written |
| `lastname` | `lastName` | Always written |
| `email` | `email` | Always written |
| `sms_number` | `phone` | Always written |
| `profile_image` | Cloudinary `secure_url` | Written **only** when a new photo was submitted and uploaded |

### Critical rule

**Never write to `firstname`.**

The participant's real first name on file must not be overwritten by the editable Display Name field.

### `profile_image` question has been resolved

The original build spec identified an open question about whether the Ontraport `profile_image` field, which is typed as an image field, would accept a normal URL.

This was explicitly tested.

A real Cloudinary URL was written to a test Contact's `profile_image` through the Ontraport API, fetched back, and confirmed as an exact match. The original value was then restored.

**Conclusion:** `profile_image` accepts the Cloudinary URL string used by this workflow.

---

## 6. Contact Identity vs. Contact Record ID

This distinction is critical.

The browser sends:

```text
contactId
```

which is the normal numeric Ontraport Contact record ID.

That ID is used to find/update the Contact in Ontraport.

However, the Cloudinary folder is **not** named from that numeric record ID.

Before any photo work, the workflow fetches the Contact from Ontraport:

```http
GET https://api.ontraport.com/1/object
```

with:

```text
objectID=0
id=<contactId>
```

The workflow then reads:

```text
data.unique_id
```

That value is the Contact's actual Ontraport **Unique ID** and is what must be used for Cloudinary storage.

---

## 7. Cloudinary Folder Convention

All participant profile photos belong under:

```text
database/usertables/
```

Each Contact receives their own folder:

```text
database/usertables/cuid-[Contact Unique ID]
```

Example pattern:

```text
database/usertables/cuid-ABC123XYZ
```

The `cuid-` value is based on Ontraport `unique_id`, **not** the numeric `contactId`.

### Required behavior on every new photo upload

1. Resolve the Contact's Ontraport `unique_id`.
2. Construct:

```text
database/usertables/cuid-<unique_id>
```

3. Search Cloudinary for that exact folder.
4. If it exists:
   - reuse it.
5. If it does not exist:
   - create it.
6. Upload the new image to that folder.

A participant changing their photo later should **not** create a new Contact folder. Their new image is added to the same existing `cuid-...` folder.

---

## 8. Cloudinary API Implementation

The workflow uses the saved n8n credential:

```text
Cloudinary - Landmark
```

Authentication remains server-side inside n8n. Cloudinary credentials are never sent to or exposed in the browser.

The Cloudinary account was confirmed to be using **dynamic folder mode**, so the upload uses `asset_folder`.

### Folder search

```http
GET https://api.cloudinary.com/v1_1/mynd/folders/search
```

Search expression:

```text
path=<calculated folder path>
```

with:

```text
max_results=1
```

### Folder creation

If the folder does not exist:

```http
POST https://api.cloudinary.com/v1_1/mynd/folders/<calculated folder path>
```

### Image upload

```http
POST https://api.cloudinary.com/v1_1/mynd/image/upload
Content-Type: multipart/form-data
```

Form values:

```text
file = incoming binary photo
asset_folder = database/usertables/cuid-<unique_id>
use_asset_folder_as_public_id_prefix = false
```

The workflow takes:

```text
secure_url
```

from Cloudinary's response and uses that as `profileImageUrl` and the Ontraport `profile_image` value.

---

## 9. n8n Workflow Topology

Current production workflow:

```text
POST My Account Update
        |
        v
Normalize and Validate Input
        |
        v
Input Valid?
   |          |
  yes        no
   |          |
   |      Respond 400
   v
Photo Submitted?
   |                         |
  yes                       no
   |                         |
   |                         v
   |              Build Ontraport Contact Update
   |                         |
   |                         v
   |              Update Ontraport Contact
   |                         |
   |                         v
   |              Build Browser Response
   |                         |
   |                         v
   |              Respond to Browser
   |
   +-----------------------------+
   |                             |
   v                             v
Preserve Photo             Get Contact Identity
                                 |
                                 v
                         Assess Contact Identity
                                 |
                                 v
                         Contact Identity OK?
                           |             |
                          yes           no
                           |             |
                           v       Respond Service Error
                  Search Contact Folder
                           |
                           v
                  Assess Folder Lookup
                           |
                           v
                   Folder Lookup OK?
                     |            |
                    yes          no
                     |            |
                     v      Respond Service Error
                 Folder Exists?
                  |          |
                 yes        no
                  |          |
                  |          v
                  |   Create Contact Folder
                  |          |
                  |          v
                  |   Assess Folder Create
                  |          |
                  |          v
                  |   Folder Create OK?
                  |      |          |
                  |     yes        no
                  |      |          |
                  |      |    Respond Service Error
                  |      |
                  +------+
                     |
                     v
                 Folder Ready
                     |
                     +--------------------+
                                          |
Preserve Photo ---------------------------+
                                          |
                                          v
                                Wait for Folder + Photo
                                          |
                                          v
                                Upload Profile Photo
                                          |
                                          v
                                Assess Photo Upload
                                          |
                                          v
                                Photo Upload OK?
                                  |             |
                                 yes           no
                                  |             |
                                  v       Respond Service Error
                       Build Ontraport Contact Update
                                  |
                                  v
                       Update Ontraport Contact
                                  |
                                  v
                       Build Browser Response
                                  |
                                  v
                       Respond to Browser
```

---

## 10. Important Production Node Behaviors

### `Normalize and Validate Input`

Responsibilities:

- Reads form values.
- Validates `contactId` is numeric.
- Detects the uploaded photo binary.
- Normalizes `photo`, `photo0`, etc. to a single `photo` binary key.
- Rejects a submitted file when its MIME type does not start with `image/`.

Current validation does **not** enforce a file-size maximum.

### `Photo Submitted?`

Creates two independent paths:

- no photo → direct Ontraport text-field update
- photo → Cloudinary identity/folder/upload path

This ensures a normal profile edit does not touch or erase `profile_image`.

### `Preserve Photo`

Keeps the binary image alive while the parallel Contact/folder lookup branch runs.

Do not remove this unless the merge/upload behavior is reworked.

### `Wait for Folder + Photo`

A Merge node waits until both are ready:

1. preserved photo binary
2. verified/created Cloudinary Contact folder

The photo upload cannot proceed until both exist.

### `Build Ontraport Contact Update`

Base payload:

```json
{
  "objectID": 0,
  "id": "<numeric contactId>",
  "f2620": "<displayName>",
  "lastname": "<lastName>",
  "email": "<email>",
  "sms_number": "<phone>"
}
```

When and only when a photo upload succeeded:

```json
{
  "profile_image": "<Cloudinary secure_url>"
}
```

is added.

### `Update Ontraport Contact`

Current endpoint:

```http
PUT https://api.ontraport.com/1/objects
```

Uses the saved Ontraport n8n credential.

---

## 11. Testing Already Completed

The backend was not considered complete until real live tests passed.

### Text-only test

Verified:

- valid request accepted
- Ontraport Contact update succeeded
- response returned:

```json
{
  "success": true
}
```

### Invalid request test

Verified missing/invalid `contactId` routes to the validation failure response:

```json
{
  "success": false,
  "error": "contactId is required and must be a numeric Ontraport Contact ID"
}
```

with HTTP `400`.

### Ontraport profile-image URL test

Verified separately that:

1. a real Cloudinary URL can be written to Ontraport `profile_image`
2. it can be fetched back as the same URL
3. the Contact's previous value can be restored

### Live multipart photo test

A real multipart image request was run through the published production workflow.

Verified:

- browser-style multipart request reached the live workflow
- Contact `unique_id` was resolved
- correct `database/usertables/cuid-<unique_id>` folder path was generated
- missing folder could be created
- existing folder could be found and reused
- uploaded binary reached Cloudinary
- Cloudinary reported the asset in the exact expected Contact folder
- `secure_url` was returned
- the same URL was written to Ontraport `profile_image`
- the browser response included `profileImageUrl`

### Cleanup

Temporary test assets were deleted.

Temporary test Contact profile-image changes were restored.

Temporary test Contact folders were removed.

An accidental temporary `undefined` Cloudinary folder created during an intermediate test was also deleted.

The temporary n8n E2E/cleanup workflows were archived.

The production workflow remains active.

---

## 12. What Is Already Live vs. What Still Needs To Be Wired

### Already live

- n8n workflow exists
- workflow is published
- workflow is active
- Ontraport credential is connected
- Cloudinary credential is connected
- text update path works
- photo upload path works
- Contact-specific Cloudinary folder creation works
- existing Contact folder reuse works
- `profile_image` write-back works
- browser success/failure JSON contract works

### Not yet wired into the portal frontend

The portal still needs the production webhook URL inserted into `portal-engine.js`.

Until that frontend config is deployed and the CDN cache is purged, the **backend is live but the portal UI is not fully connected to it**.

---

# 13. REQUIRED STEPS TO MAKE THE PORTAL LIVE

## Step 1 — Update `portal-engine.js`

Inside the `Portal.account` module, locate:

```js
var ACCOUNT_UPDATE_WEBHOOK_URL = '';
```

Change it to:

```js
var ACCOUNT_UPDATE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/482b78d7-0e00-4a20-ad2f-0d851c865574/portal-account-update';
```

No other request/response frontend changes should be necessary.

---

## Step 2 — Push the frontend change

Commit/push the updated `portal-engine.js` to:

```text
github.com/co-labs-builds/landmark-new-era
```

using the deployment process already used by the portal.

---

## Step 3 — Purge jsDelivr

After the GitHub update is on `main`, purge the cached JavaScript:

```text
https://purge.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/portal-engine.js
```

Then confirm the normal jsDelivr-served copy contains the new webhook URL.

---

## Step 4 — Verify the actual Ontraport portal page

Log into the real participant portal and open **My Account**.

Run two production smoke tests.

### Test A — text only

Change a harmless editable text field without selecting a new image.

Verify:

- UI displays `Saving…`
- request returns HTTP 2xx
- JSON is:

```json
{
  "success": true
}
```

- Ontraport Contact reflects the edited text
- existing profile image remains unchanged
- `firstname` remains unchanged

### Test B — new photo

Select a real image and save.

Verify:

- request is `multipart/form-data`
- JSON includes:

```json
{
  "success": true,
  "profileImageUrl": "https://res.cloudinary.com/..."
}
```

- avatar updates in the portal
- Ontraport `profile_image` contains the same URL
- Cloudinary asset exists in:

```text
database/usertables/cuid-<that Contact's Ontraport unique_id>
```

Save a second different image for the same Contact and verify the same folder is reused.

---

## Step 5 — Confirm no stale frontend cache

If the UI still reports the old/not-connected state:

1. confirm GitHub `main` contains the correct URL
2. purge jsDelivr again
3. hard refresh / bypass browser cache
4. inspect the loaded `portal-engine.js`
5. confirm the loaded script contains the exact production webhook URL

---

## Step 6 — Monitor the first real participant writes

For the first production uses, inspect n8n executions and confirm:

- expected `contactId`
- Contact lookup succeeded
- correct Ontraport `unique_id`
- correct Cloudinary folder path
- Ontraport returned success
- no unexpected service errors

Avoid changing the current node sequence while early production behavior is being observed unless there is a verified problem.

---

# 14. Security / Hardening Status

The original design explicitly accepted the risk of trusting the browser-supplied `contactId`.

The workflow currently does **not** cryptographically validate Ontraport's membership-session `dcParam.hash`.

This is an accepted pilot risk from the original build spec.

### Current protection

- Ontraport credentials stay server-side.
- Cloudinary credentials stay server-side.
- `contactId` must be numeric.
- submitted photo MIME type must begin with `image/`.
- service failures return controlled JSON rather than exposing credentials.

### Recommended follow-up hardening not yet implemented

These are **not blockers for the current pilot**, but remain recommended:

1. **Photo file-size limit**
   - Reject images over a defined maximum before Cloudinary upload.

2. **Stricter image validation**
   - MIME validation exists, but stronger file/content validation can be added.

3. **Rate limiting**
   - Per-IP and/or per-Contact rate limits.

4. **Durable audit log**
   - Log timestamp, Contact ID, Contact Unique ID, fields changed, Cloudinary asset, and outcome.

5. **Identity/session verification**
   - If Ontraport documents a supported way to verify `dcParam.hash` or current logged-in Contact server-side, add it later.

6. **CORS tightening**
   - Current webhook allows `*`.
   - Once final portal host/origin behavior is confirmed, consider limiting CORS to expected production origins.

---

## 15. Maintenance Rules for Future Agents

When modifying this workflow, preserve these rules unless the architecture is intentionally being changed and retested:

1. **Never write `firstname`.**
2. **Never clear `profile_image` on a text-only save.**
3. **Use Contact `unique_id` for Cloudinary `cuid-...` folder naming.**
4. **Do not use numeric `contactId` as the Cloudinary folder identity.**
5. **Reuse an existing Contact folder.**
6. **Create the Contact folder only when it does not exist.**
7. **Keep participant assets under `database/usertables/`.**
8. **Keep Cloudinary credentials server-side.**
9. **Keep Ontraport credentials server-side.**
10. **Use Cloudinary `secure_url` for Ontraport `profile_image`.**
11. **Preserve multipart photo binary while folder/identity work is happening.**
12. **Keep support for n8n binary keys such as `photo0`.**
13. **Return valid JSON for both success and failure.**
14. **Omit `profileImageUrl` entirely when no new photo was submitted.**
15. **Retest both text-only and multipart-photo paths after meaningful workflow changes.**

---

## 16. Fast Debug Checklist

### Portal says Save failed

Check the latest n8n execution and identify the last successful node.

### No photo detected

Inspect the webhook binary keys.

The normalization node should catch `photo`, `photo0`, etc.

### Cloudinary folder is wrong

Verify:

```text
Assess Contact Identity → contactUniqueId
Assess Contact Identity → folderPath
```

Expected:

```text
database/usertables/cuid-<Ontraport unique_id>
```

### Folder exists but workflow tries to recreate it

Inspect:

```text
Search Contact Folder
Assess Folder Lookup
Folder Exists?
```

Search must use the exact path.

### Image uploads to the wrong location

Inspect the `Upload Profile Photo` node.

Its `asset_folder` must be:

```text
={{ $('Assess Contact Identity').first().json.folderPath }}
```

### Ontraport image disappears after a text-only edit

Inspect `Build Ontraport Contact Update`.

`profile_image` must only be added when `profileImageUrl` is non-empty.

### Display Name overwrites first name

Stop and fix immediately.

Display Name must map to:

```text
f2620
```

Never:

```text
firstname
```

---

## 17. Source Build Spec vs. Final Implementation

The original build spec called for:

- one consolidated browser → n8n call
- optional Cloudinary upload
- Ontraport write-back
- JSON response
- no browser-side API secrets
- no writes to `firstname`
- `profile_image` only when a new photo exists

All of that is preserved.

The final implementation additionally resolves/details several items that were open or intentionally generic in the original spec:

1. Cloudinary account confirmed as `mynd`.
2. Profile storage location finalized as:

```text
database/usertables/cuid-<Contact unique_id>
```

3. Folder lookup/create/reuse behavior added.
4. Ontraport `profile_image` URL compatibility was tested and confirmed.
5. n8n multipart binary-key normalization was added after live testing.
6. Dynamic Cloudinary folder behavior was confirmed.
7. Exact published webhook URL is documented above.

---

# Final State

**Backend:** READY / ACTIVE  
**Portal frontend:** REQUIRES WEBHOOK URL CONFIG + DEPLOY + CDN PURGE  
**Primary remaining action:** Wire the exact Production Webhook URL into `portal-engine.js`, deploy, purge jsDelivr, and run the two production smoke tests.

