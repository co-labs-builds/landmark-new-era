# landmark-new-era

Working repo for the Landmark "New Era" build: the Ontraport data architecture,
the automation specs behind it, the Member Portal and CS Dashboard engines, and
the tooling used to keep them running.

> **This repository is public,** and the pages it drives are personalised.
> Read [Before you commit](#before-you-commit) first — the failure mode here is
> publishing a participant's contact details or a live credential.

## Start here

New to the project? Read in this order:

1. `docs/architecture/REGISTRATION-ARCHITECTURE.md` — how Contacts, Events,
   Registrations and Invitations relate. Everything else assumes this.
2. `docs/architecture/FORUM-CYCLE-MAP.html` — the participant's journey end to
   end, as a diagram.
3. `HANDOFF.md` — where the build was last left.
4. `ontraport-field-master-list.md` — field IDs. Ontraport custom fields are
   `fNNNN`, so this is the decoder ring for almost every other document.

## Layout

```
docs/
  architecture/    how the system is put together, .md plus a rendered .html
  handoffs/        dated notes handing a workstream to the next person
  CLEANUP-LEDGER.html
apps-script/       Google Apps Script tools (Ontraport API, run from Sheets)
scripts/           shell tooling for CDN pinning (see "Do not move" below)
Assets/            images served live over CDN — see "Do not move"
Workflows/         n8n workflow exports
Backups/           point-in-time copies kept deliberately
Outdated/          superseded work, kept for reference — check dates before trusting
```

Root holds the engines, the paste-ready page snapshots, and the specs and
punchlists that are still in active use.

### Where the page source lives

Front-end source for the Ontraport pages is **not** in this repo. It lives in
[`co-labs-builds/LWW`](https://github.com/co-labs-builds/LWW) under
`page-builds/`, which has a per-page convention (`about-page`, `structure-map`,
`master.css`, `sections/`). The Forum Journey build is
`page-builds/forum-journey/`.

This repo holds the system around those pages: the data model, the automations,
and the engines the pages call.

## Do not move these files

Several paths are referenced by live URLs. Moving or renaming them breaks
production, in some cases the moment the change is pushed.

| Path | Why |
|---|---|
| `Assets/**` | Served via jsDelivr pinned to `@main`. A rename breaks the live Member Portal **immediately** — there is no version pin to shield you. |
| `portal-engine.js` | Served via jsDelivr pinned to a commit SHA. Safe until someone re-pins, then the new path must exist. |
| `dashboard-engine.js` | Same as above. |

Engine releases are pinned by commit SHA rather than `@main` so a push cannot
change live behaviour on its own. `scripts/repin.sh` moves the pin forward and
`scripts/verify-pin.sh` checks the pinned SHA still serves what you expect.

When comparing a local engine against what the CDN serves, compare the **git
blob**, not the working tree — the files are CRLF on disk and the hashes will
never match otherwise.

## Working with Ontraport

- **Custom fields are `fNNNN`.** `ontraport-field-master-list.md` and
  `CS-DASHBOARD-FIELD-DICTIONARY.md` map them to names.
- **Checkbox fields merge as words.** A checkbox stored as `1` merges into a
  page as `"Yes"`. Match `Yes`/`No`, not `1`/`0`.
- **Merge fields resolve inside HTML attributes,** not only in text — an `href`
  merge works. Some older comments in these files say otherwise; they are wrong.
- **The custom-code sanitizer rejects saves** containing `sessionStorage`,
  `URLSearchParams(location.search)`, `setAttribute("href", …)` or a literal
  `https://` URL in a page script. `removeAttribute("href")` is accepted.

## Before you commit

- **Never commit a rendered page.** Live pages have merge fields already
  resolved, so a saved copy carries a real participant's name, email and phone.
  Keep `[Page//…]` tags intact.
- **Never commit a personalised URL.** Journey and portal URLs need no login —
  the URL *is* the credential. Anyone with one can read that person's details.
- **No keys.** Apps Script reads credentials from `PropertiesService` and
  prompts for them at runtime; keep it that way. The n8n token comes from
  `${N8N_MCP_TOKEN}` in the environment, which is why `.mcp.json` is safe to
  track.
- `.gitignore` deliberately excludes the `claude old machine` archive: it
  contains a live OAuth credential and full session transcripts. Those entries
  are a backstop, not permission to keep the archive in the working tree.
