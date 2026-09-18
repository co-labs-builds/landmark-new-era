/**
 * LANDMARK — INVITATIONS TRACKER
 * ==================================================================
 * Team-facing workbook built live from the Ontraport Invitations
 * object (oInvitations, objectID 10003).
 *
 *   1. Dashboard          headline metrics, top inviters, data quality
 *   2. Participants       one row per inviter; click a name in col A
 *                         to list their guests in columns E/F
 *   3. All Invites        one row per invitation record
 *   4. Zoom Links         lookup table: guest, email, join link,
 *                         participant, participant email
 *   5. Grad Guests        All Invites filtered to grads
 *   6. Non-Grad Guests    All Invites filtered to non-grads
 *   7. Unmatched Invites  invitations with no inviting participant
 *
 * GRAD DEFINITION
 *   f2337 "Is guest a grad of The Landmark Forum?"  147 = Yes, 148 = No.
 *   That is the field the invitation form writes. The programmatic
 *   fields f2292 and f2968 are unset on every record — do not use them.
 *
 * SELF-REGISTERED GUESTS
 *   f2694 Invitation Type 457 = "New Era Tues — Self-Registered". These
 *   legitimately have no inviting participant, so they are labelled
 *   rather than flagged as broken.
 *
 * LIVE ONLY — BY DESIGN
 *   This build carries no bundled snapshot. Invitation volume more than
 *   doubled in a single day before graduation, so a baked-in copy would
 *   quietly show stale numbers to the team. No credentials means a clear
 *   setup notice, never plausible-looking wrong figures.
 *
 * INSTALL
 *   Extensions ▸ Apps Script ▸ paste over everything ▸ Save
 *   ▸ run `refreshAll` ▸ approve the prompt ▸ reload the spreadsheet.
 *   Then: Invitations ▸ Set Ontraport API credentials…
 *         Invitations ▸ Auto-refresh ▸ every hour
 */

var CFG = {
  OBJECT_ID: 10003,
  API_BASE:  'https://api.ontraport.com/1/objects',
  PAGE_SIZE: 50,            // Ontraport hard cap per page
  MAX_PAGES: 200,           // runaway guard
  GRAD_YES:  '147',         // f2337
  SELF_REG:  '457',         // f2694 Invitation Type
  FIELDS:    'id,f2337,f2256,f2694,f3306',
  EXTERNS:   'f2259//firstname,f2259//lastname,f2259//email,' +
             'f2257//firstname,f2257//lastname,f2257//email',

  /* ---- Registrations tab (oRegistrations, objectID 10001) ----------------
     Cutoff is the moment the Forum-weekend push began. Filtering on `date`
     (Date Added — when the record was actually created) rather than f2237
     Registration Date, because f2237 is a fulldate that automations stamp to
     a day boundary, so it cannot tell you a registration "came in" tonight.

     Written as a plain date, not an epoch, and resolved to midnight in the
     SPREADSHEET's timezone at run time. A hardcoded UTC epoch would quietly
     mean 5pm the previous day on the US west coast and pull in records from
     the 17th. Change the date, nothing else; the tab header prints the cutoff
     it actually used, so it is never a guess. Timezone comes from
     File ▸ Settings in the sheet.

     Set to 14 Aug to start at this cohort's FIRST seminar registration —
     registration 1209 (Kyle Tait, Breakthroughs), created 14 Aug at 8:58 PM
     Pacific. That is 15 Aug 03:58 UTC, which is why it reads as "the 15th"
     anywhere showing UTC; locally it is still the 14th, and a 15 Aug cutoff
     silently drops the first 13 seminar registrations of the run.
     One earlier seminar registration exists — 1151, Emily Maddox, Integrity,
     11 Aug 5:46 PM Pacific — but it predates the Forum weekend and is not
     part of this cohort, so the window deliberately starts after it. */
  REG_OBJECT_ID:   10001,
  REG_SINCE_DATE:  '2026-08-14',
  REG_FIELDS:    'id,date,f2237,f2424,f2830,f2878,f2465',
  REG_EXTERNS:   'f2213//firstname,f2213//lastname,f2213//email,' +
                 'f2458//f2231,f2214//id',
  REG_STATUS:    { '154': 'Active', '491': 'Withdrawn' },
  REG_TYPE:      { '334': 'Other', '335': 'Subscription', '336': 'Graduate Course',
                   '337': 'Seminar', '338': 'Advanced Course', '339': 'Landmark Forum' }
};

var SH = {
  DASH:      'Dashboard',
  PART:      'Participants',
  ALL:       'All Invites',
  ZOOM:      'Zoom Links',
  GRAD:      'Grad Guests',
  NONGRAD:   'Non-Grad Guests',
  UNMATCHED: 'Unmatched Invites',
  REGS:      'Registrations'
};
var TAB_ORDER = [SH.DASH, SH.PART, SH.ALL, SH.ZOOM, SH.REGS,
                 SH.GRAD, SH.NONGRAD, SH.UNMATCHED];

/**
 * Landmark palette, taken from the portal/dashboard CSS custom properties
 * so this sheet reads as the same product:
 *   --teal #0d2d31 · --teal-deep #0a2226 · mid teal #3f6b6d
 *   --green #217a00 · --green-bright #2ea203 · --green-bg #e9f4e5
 *   --ink #0e1a19 · --ink-3 #6f6b66 · --coral-ink #c8452a
 * Dark teal carries the header bands; green is the accent.
 */
var TH = {
  headBg:  '#0d2d31',
  headFg:  '#ffffff',
  subBg:   '#f0eee9',
  colBg:   '#3f6b6d',
  ink:     '#0e1a19',
  sub:     '#6f6b66',
  rule:    '#e6e2d8',
  cardBg:  '#f7f5ef',
  accent:  '#217a00',
  good:    '#217a00',
  softBg:  '#e9f4e5',
  warnBg:  '#fdf3e3',
  warnFg:  '#b8730a',
  dupBg:   '#fbeae6',
  band:    '#f7f5ef'
};

/* Row layout ----------------------------------------------------------- */
var HEAD_ROW = 4;   // header row on every list tab
var DATA_ROW = 5;   // first data row on every list tab
var P_HINT   = 3;   // Participants: detail-pane title row

/* ====================================================================== */
/*  MENU                                                                   */
/* ====================================================================== */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Invitations')
    .addItem('Refresh now', 'refreshAll')
    .addItem('Show guests for selected participant', 'showSelectedParticipant')
    .addSeparator()
    .addSubMenu(ui.createMenu('Auto-refresh')
      .addItem('Turn on — every hour', 'installHourly')
      .addItem('Turn on — every 4 hours', 'installEvery4Hours')
      .addItem('Turn off', 'removeAutoRefresh'))
    .addSeparator()
    .addItem('Set Ontraport API credentials…', 'setCredentials')
    .addItem('Check status', 'checkStatus')
    .addToUi();
}

function setCredentials() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Ontraport API', 'Api-Appid:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var b = ui.prompt('Ontraport API', 'Api-Key:', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperties({
    ONTRAPORT_APP_ID:  a.getResponseText().trim(),
    ONTRAPORT_API_KEY: b.getResponseText().trim()
  });
  ui.alert('Saved. Run Invitations ▸ Refresh now to pull live data.');
}

function checkStatus() {
  var trig = autoRefreshTriggers_().length;
  SpreadsheetApp.getUi().alert(
    (hasCreds_() ? 'Ontraport credentials ARE set.'
                 : 'No Ontraport credentials set — refresh cannot pull data.') +
    '\n' +
    (trig ? 'Auto-refresh is ON (' + trig + ' trigger).' : 'Auto-refresh is OFF.'));
}

function hasCreds_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('ONTRAPORT_APP_ID') && p.getProperty('ONTRAPORT_API_KEY'));
}

/* ====================================================================== */
/*  AUTO-REFRESH                                                           */
/* ====================================================================== */

function autoRefreshTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'refreshAll';
  });
}

function removeAutoRefresh() {
  var found = autoRefreshTriggers_();
  found.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  alert_(found.length ? 'Auto-refresh turned off (' + found.length + ' removed).'
                      : 'Auto-refresh was already off.');
  return found.length;
}

function installHourly()      { return installAutoRefresh_(1); }
function installEvery4Hours() { return installAutoRefresh_(4); }

function installAutoRefresh_(hours) {
  if (!hasCreds_()) {
    alert_('Set the Ontraport API credentials first — a schedule with no ' +
           'credentials would just rebuild an empty sheet on a timer.');
    return 0;
  }
  autoRefreshTriggers_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshAll').timeBased().everyHours(hours).create();
  alert_('Auto-refresh on — every ' + hours + (hours === 1 ? ' hour.' : ' hours.') +
         '\n\nIt runs on Google\'s servers under your account, so the sheet stays ' +
         'current even when nobody has it open.');
  return hours;
}

/** UI calls must never break an unattended trigger run. */
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ====================================================================== */
/*  MAIN                                                                   */
/* ====================================================================== */

function refreshAll() {
  var ss = SpreadsheetApp.getActive();
  ensureDashboardSheet_(ss);

  if (!hasCreds_()) {
    buildSetupNotice_(ss, 'No Ontraport API credentials set.');
    return;
  }

  var rows;
  try {
    rows = fetchLive_();
  } catch (err) {
    buildSetupNotice_(ss, 'Could not reach Ontraport: ' + err.message);
    return;
  }
  if (!rows.length) {
    buildSetupNotice_(ss, 'Ontraport returned no invitation records.');
    return;
  }

  var source = 'Live from Ontraport · ' + stamp_();
  buildAllInvites_(ss, rows);
  buildZoomLinks_(ss, rows);

  /* Registrations are a second object and a second round trip. Isolated so a
     failure there cannot take down the invitation tabs, which are the ones
     being watched during the event. */
  try {
    buildRegistrations_(ss, fetchRegistrations_());
  } catch (err) {
    var rsh = resetSheet_(ss, SH.REGS, 8, 30);
    titleBand_(rsh, 8, 'REGISTRATIONS', 'Could not load');
    rsh.getRange(4, 1, 1, 8).merge()
      .setValue('⚠  ' + err.message + ' — the invitation tabs above are unaffected.')
      .setBackground(TH.warnBg).setFontColor(TH.warnFg).setFontWeight('bold');
    trimCols_(rsh, 8);
  }

  buildFiltered_(ss, SH.GRAD, rows.filter(function (r) { return r.grad; }),
                 'Guests who have completed The Landmark Forum');
  buildFiltered_(ss, SH.NONGRAD, rows.filter(function (r) { return !r.grad; }),
                 'Guests who have not completed The Landmark Forum');
  buildParticipants_(ss, rows);
  buildUnmatched_(ss, rows);
  buildDashboard_(ss, rows, source);

  orderSheets_(ss);
  try {
    ss.setActiveSheet(ss.getSheetByName(SH.DASH));
    ss.toast(rows.length + ' invitations loaded.', 'Refresh complete', 6);
  } catch (e) {}
}

/**
 * Paged reader for any Ontraport collection.
 * opts: {objectID, fields, externs, condition (optional), map}
 * De-dupes by id — the API's paged `total` can disagree with the real row
 * count, and a bad page must not be able to double records.
 */
function fetchPaged_(opts) {
  var p = PropertiesService.getScriptProperties();
  var appId = p.getProperty('ONTRAPORT_APP_ID');
  var key   = p.getProperty('ONTRAPORT_API_KEY');
  var out = [], seen = {}, start = 0, page = 0;

  while (page++ < CFG.MAX_PAGES) {
    var url = CFG.API_BASE +
      '?objectID=' + opts.objectID +
      '&range='    + CFG.PAGE_SIZE +
      '&start='    + start +
      '&sort=id&sortDir=asc' +
      '&listFields=' + encodeURIComponent(opts.fields) +
      '&externs='    + encodeURIComponent(opts.externs);
    if (opts.condition) {
      url += '&condition=' + encodeURIComponent(JSON.stringify(opts.condition));
    }

    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Api-Appid': appId, 'Api-Key': key, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 429) throw new Error('rate limited (429) — try again shortly');
    if (code !== 200) throw new Error('HTTP ' + code);

    var data = JSON.parse(resp.getContentText()).data || [];
    for (var i = 0; i < data.length; i++) {
      if (seen[data[i].id]) continue;
      seen[data[i].id] = true;
      out.push(opts.map(data[i]));
    }
    if (data.length < CFG.PAGE_SIZE) break;
    start += CFG.PAGE_SIZE;
  }
  return out;
}

function fetchLive_() {
  return fetchPaged_({
    objectID: CFG.OBJECT_ID,
    fields:   CFG.FIELDS,
    externs:  CFG.EXTERNS,
    map:      normalize_
  });
}

/**
 * REG_SINCE_DATE as a unix epoch, taken as local midnight in the sheet's
 * timezone. Ontraport stores `date` as a UTC epoch, so the conversion has to
 * happen here rather than being assumed.
 */
function regCutoffEpoch_() {
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var d = Utilities.parseDate(CFG.REG_SINCE_DATE + ' 00:00:00', tz,
                              'yyyy-MM-dd HH:mm:ss');
  return Math.floor(d.getTime() / 1000);
}

function fetchRegistrations_() {
  /* Ontraport's REST condition wants each clause shaped
     {field:{field}, op, value:{value}} — not the flat form the MCP accepts. */
  return fetchPaged_({
    objectID:  CFG.REG_OBJECT_ID,
    fields:    CFG.REG_FIELDS,
    externs:   CFG.REG_EXTERNS,
    condition: [{ field: { field: 'date' }, op: '>=',
                  value: { value: String(regCutoffEpoch_()) } }],
    map:       normalizeReg_
  });
}

function normalizeReg_(r) {
  var name = ((r['f2213//firstname'] || '') + ' ' + (r['f2213//lastname'] || ''))
    .replace(/\s+/g, ' ').trim();
  /* Course name: prefer the registration's own Course link, fall back to the
     course behind the linked Event. f3040 Event Title is blank on most events,
     so the Course name is the only reliable label — never read the event. */
  var course = (r['f2458//f2231'] || r['f2214//f2235//f2231'] || '').toString().trim();
  return {
    id:       r.id,
    added:    Number(r.date || 0),
    regDate:  Number(r.f2237 || 0),
    name:     name,
    email:    (r['f2213//email'] || '').toString().trim(),
    course:   course,
    eventId:  (r['f2214//id'] || '').toString().trim(),
    status:   CFG.REG_STATUS[String(r.f2424)] || '',
    type:     CFG.REG_TYPE[String(r.f2830)] || '',
    fromInv:  (r.f2465 && String(r.f2465) !== '0') ? String(r.f2465) : '',
    isTest:   String(r.f2878) === '1'
  };
}

function normalize_(r) {
  var join = function (a, b) {
    return ((r[a] || '') + ' ' + (r[b] || '')).replace(/\s+/g, ' ').trim();
  };
  var participant = join('f2257//firstname', 'f2257//lastname');
  return {
    id:          r.id,
    participant: participant,
    pEmail:      (r['f2257//email'] || '').toString().trim(),
    guest:       join('f2259//firstname', 'f2259//lastname'),
    email:       (r['f2259//email'] || '').toString().trim(),
    zoom:        (r.f3306 || '').toString().trim(),
    grad:        String(r.f2337) === CFG.GRAD_YES,
    selfReg:     String(r.f2694) === CFG.SELF_REG || !participant
  };
}

function stamp_() {
  return Utilities.formatDate(new Date(),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "d MMM yyyy 'at' h:mm a");
}

/* ====================================================================== */
/*  SHEET SCAFFOLDING                                                      */
/* ====================================================================== */

function ensureDashboardSheet_(ss) {
  if (ss.getSheetByName(SH.DASH)) return;
  var first = ss.getSheets()[0];
  if (first.getLastRow() <= 2 && first.getLastColumn() <= 6) first.setName(SH.DASH);
  else ss.insertSheet(SH.DASH);
}

function resetSheet_(ss, name, minCols, minRows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);

  var c = sh.getMaxColumns();
  if (c < minCols) sh.insertColumnsAfter(c, minCols - c);
  var r = sh.getMaxRows();
  if (r < minRows) sh.insertRowsAfter(r, minRows - r);

  sh.clear();
  sh.clearConditionalFormatRules();
  var filter = sh.getFilter();
  if (filter) filter.remove();
  sh.getBandings().forEach(function (b) { b.remove(); });
  // clear() leaves merges behind, and a stale merge breaks later setValues.
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns())
    .breakApart().clearDataValidations().clearNote().setFontLine('none');
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  return sh;
}

function titleBand_(sh, lastCol, title, subtitle) {
  sh.getRange(1, 1, 1, lastCol).merge()
    .setValue(title).setFontSize(15).setFontWeight('bold')
    .setFontColor(TH.headFg).setBackground(TH.headBg)
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 40);
  sh.getRange(2, 1, 1, lastCol).merge()
    .setValue(subtitle).setFontSize(10).setFontColor(TH.sub)
    .setBackground(TH.subBg).setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);
}

function headerRow_(sh, row, labels, startCol) {
  sh.getRange(row, startCol || 1, 1, labels.length)
    .setValues([labels]).setFontWeight('bold').setFontSize(10)
    .setFontColor(TH.headFg).setBackground(TH.colBg)
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 26);
}

function orderSheets_(ss) {
  try {
    for (var i = 0; i < TAB_ORDER.length; i++) {
      var sh = ss.getSheetByName(TAB_ORDER[i]);
      if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
    }
  } catch (e) { /* tab order is cosmetic */ }
}

function trimCols_(sh, keep) {
  var extra = sh.getMaxColumns() - keep;
  if (extra > 0) sh.deleteColumns(keep + 1, extra);
}

function widths_(sh, w) {
  for (var i = 0; i < w.length; i++) sh.setColumnWidth(i + 1, w[i]);
}

function cmp_(a, b) {
  a = (a || '').toLowerCase(); b = (b || '').toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

function byGuest_(a, b) { return cmp_(a.guest, b.guest); }

/** Shown instead of numbers when we cannot prove the data is current. */
function buildSetupNotice_(ss, reason) {
  var sh = resetSheet_(ss, SH.DASH, 8, 30);
  titleBand_(sh, 8, 'INVITATIONS DASHBOARD', 'Not connected');
  sh.getRange(4, 1, 1, 8).merge()
    .setValue('⚠  ' + reason)
    .setBackground(TH.warnBg).setFontColor(TH.warnFg)
    .setFontWeight('bold').setFontSize(12)
    .setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(4, 34);
  sh.getRange(6, 1, 1, 8).merge()
    .setValue('This sheet shows live Ontraport data only — it deliberately ships ' +
              'no bundled copy, so it will never show you stale numbers that look current.\n\n' +
              'To connect:  Invitations ▸ Set Ontraport API credentials…  then  Refresh now.\n' +
              'Credentials come from Ontraport ▸ Administration ▸ Integrations ▸ ' +
              'Ontraport API Instructions and Key Manager. They are stored in Script ' +
              'Properties, never in the spreadsheet.')
    .setFontColor(TH.ink).setVerticalAlignment('top').setWrap(true);
  sh.setRowHeight(6, 110);
  widths_(sh, [210, 110, 90, 90, 40, 190, 80, 90]);
  trimCols_(sh, 8);
  sh.setHiddenGridlines(true);
  try { ss.setActiveSheet(sh); } catch (e) {}
}

/* ====================================================================== */
/*  LIST TABS                                                              */
/* ====================================================================== */

function dupKey_(r) {
  return (r.participant || '').toLowerCase() + '||' + (r.email || '').toLowerCase();
}

/** Map of participant+email keys that appear more than once. */
function duplicateKeys_(rows) {
  var count = {}, dup = {};
  rows.forEach(function (r) {
    if (!r.email || !r.participant) return;
    var k = dupKey_(r);
    count[k] = (count[k] || 0) + 1;
  });
  Object.keys(count).forEach(function (k) { if (count[k] > 1) dup[k] = true; });
  return dup;
}

function duplicateExcess_(rows) {
  var count = {}, excess = 0;
  rows.forEach(function (r) {
    if (!r.email || !r.participant) return;
    var k = dupKey_(r);
    count[k] = (count[k] || 0) + 1;
  });
  Object.keys(count).forEach(function (k) { if (count[k] > 1) excess += count[k] - 1; });
  return excess;
}

/** A Invitee · B Participant · C Grad? · D Guest Email */
function renderInviteList_(sh, rows, title, subtitle, dupKeys) {
  titleBand_(sh, 4, title, subtitle);
  headerRow_(sh, HEAD_ROW, ['Invitee', 'Participant', 'Grad?', 'Guest Email']);

  var n = rows.length;
  if (!n) {
    sh.getRange(DATA_ROW, 1, 1, 4).merge().setValue('No records.')
      .setFontColor(TH.sub).setFontStyle('italic').setHorizontalAlignment('center');
    sh.setFrozenRows(HEAD_ROW);
    widths_(sh, [210, 200, 70, 260]);
    trimCols_(sh, 4);
    return;
  }

  var body = [], backs = [], hasDup = false;
  for (var i = 0; i < n; i++) {
    var r = rows[i];
    body.push([r.guest || '(no guest on record)',
               r.participant || (r.selfReg ? '(self-registered)' : '(unmatched)'),
               '', r.email]);
    // Build backgrounds as one array — 400+ single setBackground calls is slow.
    var tint = (dupKeys && dupKeys[dupKey_(r)]) ? TH.dupBg
             : (i % 2 ? TH.band : '#ffffff');
    if (dupKeys && dupKeys[dupKey_(r)]) hasDup = true;
    backs.push([tint, tint, tint, tint]);
  }

  var rng = sh.getRange(DATA_ROW, 1, n, 4);
  rng.setValues(body);
  rng.setBackgrounds(backs);
  rng.setBorder(true, true, true, true, true, true, TH.rule,
                SpreadsheetApp.BorderStyle.SOLID);

  var cb = sh.getRange(DATA_ROW, 3, n, 1);
  cb.insertCheckboxes();
  cb.setValues(rows.map(function (r) { return [r.grad === true]; }));
  cb.setHorizontalAlignment('center');

  sh.setFrozenRows(HEAD_ROW);
  sh.getRange(HEAD_ROW, 1, n + 1, 4).createFilter();
  widths_(sh, [210, 200, 70, 260]);
  trimCols_(sh, 4);
  return hasDup;
}

function buildAllInvites_(ss, rows) {
  var sh = resetSheet_(ss, SH.ALL, 4, DATA_ROW + rows.length + 5);
  var dup = duplicateKeys_(rows);
  var excess = duplicateExcess_(rows);
  renderInviteList_(sh, rows.slice().sort(byGuest_),
    'ALL INVITES',
    'One row per invitation record · ' + rows.length + ' total' +
    (excess ? ' · ' + excess + ' duplicate row(s) tinted' : ' · no duplicates'),
    dup);
}

function buildFiltered_(ss, name, rows, note) {
  var sh = resetSheet_(ss, name, 4, DATA_ROW + rows.length + 5);
  renderInviteList_(sh, rows.slice().sort(byGuest_),
    name.toUpperCase(), note + ' · ' + rows.length + ' records', null);
}

/* ====================================================================== */
/*  ZOOM LINKS — the team's lookup table                                   */
/* ====================================================================== */

function buildZoomLinks_(ss, rows) {
  var sh = resetSheet_(ss, SH.ZOOM, 5, DATA_ROW + rows.length + 5);
  var sorted = rows.slice().sort(byGuest_);
  var missing = 0;

  titleBand_(sh, 5, 'ZOOM LINKS',
    'Every invitation with its guest join link · ' + rows.length + ' records · ' +
    'use Ctrl+F, or the filter arrows, to find a person');
  headerRow_(sh, HEAD_ROW,
    ['Guest', 'Guest Email', 'Zoom Join Link', 'Participant', 'Participant Email']);

  if (!sorted.length) {
    sh.getRange(DATA_ROW, 1, 1, 5).merge().setValue('No records.')
      .setFontColor(TH.sub).setFontStyle('italic').setHorizontalAlignment('center');
    sh.setFrozenRows(HEAD_ROW);
    widths_(sh, [190, 230, 300, 170, 230]);
    trimCols_(sh, 5);
    return;
  }

  var body = [], backs = [];
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    if (!r.zoom) missing++;
    body.push([
      r.guest || '(no guest on record)',
      r.email || '',
      r.zoom || '— not issued yet —',
      r.participant || (r.selfReg ? '(self-registered)' : '(unmatched)'),
      r.pEmail || ''
    ]);
    var tint = !r.zoom ? TH.warnBg : (i % 2 ? TH.band : '#ffffff');
    backs.push([tint, tint, tint, tint, tint]);
  }

  var rng = sh.getRange(DATA_ROW, 1, sorted.length, 5);
  rng.setValues(body);
  rng.setBackgrounds(backs);
  rng.setBorder(true, true, true, true, true, true, TH.rule,
                SpreadsheetApp.BorderStyle.SOLID);
  rng.setVerticalAlignment('middle');

  // Links stay as raw text: searchable with Ctrl+F, copyable, and still
  // clickable. Clipping keeps the very long token from blowing out the row.
  sh.getRange(DATA_ROW, 3, sorted.length, 1)
    .setWrap(false).setFontSize(9).setFontColor('#1155cc');

  // No setFrozenColumns here: the title band in rows 1-2 is merged across all
  // five columns, and freezing part of a merged cell throws.
  sh.setFrozenRows(HEAD_ROW);
  sh.getRange(HEAD_ROW, 1, sorted.length + 1, 5).createFilter();
  widths_(sh, [190, 230, 300, 170, 230]);
  trimCols_(sh, 5);

  if (missing) {
    sh.getRange(2, 1, 1, 5)
      .setValue('⚠  ' + missing + ' of ' + rows.length +
                ' have no Zoom link yet — registration lags invitation creation ' +
                'by a few minutes. They are highlighted below; re-refresh shortly.')
      .setBackground(TH.warnBg).setFontColor(TH.warnFg).setFontWeight('bold');
  }
}

/* ====================================================================== */
/*  REGISTRATIONS — everything that came in since the cutoff               */
/* ====================================================================== */

function fmtDate_(epoch) {
  if (!epoch) return '';
  return Utilities.formatDate(new Date(epoch * 1000),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'd MMM, h:mm a');
}

function buildRegistrations_(ss, regs) {
  var sh = resetSheet_(ss, SH.REGS, 8, DATA_ROW + regs.length + 5);
  var since = Utilities.formatDate(new Date(regCutoffEpoch_() * 1000),
    ss.getSpreadsheetTimeZone(), 'd MMM yyyy');

  /* Newest first: this tab is read to see what just landed, so the useful row
     is at the top rather than the bottom of a growing list. */
  var sorted = regs.slice().sort(function (a, b) { return b.added - a.added; });

  var courses = {};
  regs.forEach(function (r) { if (r.course) courses[r.course] = (courses[r.course] || 0) + 1; });
  var courseSummary = Object.keys(courses).sort(function (a, b) {
    return courses[b] - courses[a] || cmp_(a, b);
  }).map(function (c) { return c + ' ' + courses[c]; }).join(' · ');

  titleBand_(sh, 8, 'REGISTRATIONS',
    regs.length + ' registration(s) created on or after ' + since +
    (courseSummary ? ' · ' + courseSummary : ''));
  headerRow_(sh, HEAD_ROW, ['Came In', 'Name', 'Email', 'Course',
                            'Course Type', 'Event', 'Status', 'From Invite']);

  if (!sorted.length) {
    sh.getRange(DATA_ROW, 1, 1, 8).merge()
      .setValue('No registrations since ' + since + '.')
      .setFontColor(TH.sub).setFontStyle('italic')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setRowHeight(DATA_ROW, 30);
  } else {
    var body = [], backs = [];
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      body.push([
        fmtDate_(r.added),
        r.name || '(no name on contact)',
        r.email,
        r.course || '— no course linked —',
        r.type,
        r.eventId,
        r.status || '(unset)',
        r.fromInv ? 'inv ' + r.fromInv : ''
      ]);
      /* Withdrawn and test rows are tinted rather than dropped: a registration
         that came in and then withdrew is still something the team needs to
         see, and silently filtering it would make the count unexplainable. */
      var t = (r.status === 'Withdrawn' || r.isTest) ? TH.warnBg
            : (i % 2 ? TH.band : '#ffffff');
      backs.push([t, t, t, t, t, t, t, t]);
    }
    var rng = sh.getRange(DATA_ROW, 1, sorted.length, 8);
    rng.setValues(body);
    rng.setBackgrounds(backs);
    rng.setBorder(true, true, true, true, true, true, TH.rule,
                  SpreadsheetApp.BorderStyle.SOLID);
    rng.setVerticalAlignment('middle');
    sh.getRange(DATA_ROW, 4, sorted.length, 1).setFontWeight('bold')
      .setFontColor(TH.accent);
    sh.getRange(DATA_ROW, 6, sorted.length, 1).setHorizontalAlignment('center');
    sh.getRange(HEAD_ROW, 1, sorted.length + 1, 8).createFilter();
  }

  sh.setFrozenRows(HEAD_ROW);
  widths_(sh, [130, 170, 230, 170, 130, 70, 90, 100]);
  trimCols_(sh, 8);
}

/* ====================================================================== */
/*  PARTICIPANTS                                                           */
/* ====================================================================== */

function buildParticipants_(ss, rows) {
  var sh = resetSheet_(ss, SH.PART, 6, DATA_ROW + rows.length + 5);

  var byName = {};
  rows.forEach(function (r) {
    if (!r.participant) return;
    if (!byName[r.participant]) byName[r.participant] = { name: r.participant, total: 0 };
    byName[r.participant].total++;
  });
  var list = Object.keys(byName).map(function (k) { return byName[k]; });
  list.sort(function (a, b) { return b.total - a.total || cmp_(a.name, b.name); });

  titleBand_(sh, 6, 'PARTICIPANTS',
    list.length + ' participants have sent invitations · sorted by invite count');

  sh.getRange(P_HINT, 1, 1, 2).merge()
    .setValue('Click a name in column A →')
    .setFontStyle('italic').setFontSize(10).setFontColor(TH.sub);
  sh.getRange(P_HINT, 5, 1, 2).merge()
    .setValue('Click a participant to list their guests')
    .setFontWeight('bold').setFontSize(11).setFontColor(TH.headBg);

  headerRow_(sh, HEAD_ROW, ['Participant', 'Total Invites']);
  headerRow_(sh, HEAD_ROW, ['Invitee', 'Grad / Non-Grad'], 5);

  if (list.length) {
    var rng = sh.getRange(DATA_ROW, 1, list.length, 2);
    rng.setValues(list.map(function (p) { return [p.name, p.total]; }));
    rng.setBorder(true, true, true, true, true, true, TH.rule,
                  SpreadsheetApp.BorderStyle.SOLID);
    var backs = [];
    for (var i = 0; i < list.length; i++) {
      var t = i % 2 ? TH.band : '#ffffff';
      backs.push([t, t]);
    }
    rng.setBackgrounds(backs);
    sh.getRange(DATA_ROW, 2, list.length, 1).setHorizontalAlignment('center');
    // Green marks the names as the clickable thing on this tab.
    sh.getRange(DATA_ROW, 1, list.length, 1)
      .setFontColor(TH.accent).setFontWeight('bold');
  }

  sh.setFrozenRows(HEAD_ROW);
  widths_(sh, [210, 100, 24, 24, 210, 130]);
  trimCols_(sh, 6);
}

/** Simple trigger: clicking a participant name repaints the E/F detail pane. */
function onSelectionChange(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SH.PART) return;
    if (e.range.getColumn() !== 1 || e.range.getRow() < DATA_ROW) return;
    var name = sh.getRange(e.range.getRow(), 1).getValue();
    if (!name) return;
    if (String(sh.getRange(P_HINT, 5).getValue()).indexOf(name + '  (') === 0) return;
    paintInvitees_(sh, name);
  } catch (err) { /* simple triggers must fail silently */ }
}

function showSelectedParticipant() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SH.PART) {
    alert_('Open the Participants tab and select a name in column A.');
    return;
  }
  var cell = sh.getActiveCell();
  if (cell.getColumn() !== 1 || cell.getRow() < DATA_ROW || !cell.getValue()) {
    alert_('Select a participant name in column A first.');
    return;
  }
  paintInvitees_(sh, cell.getValue());
}

function paintInvitees_(sh, name) {
  var all = sh.getParent().getSheetByName(SH.ALL);
  if (!all) return;

  var out = [];
  var n = all.getLastRow() - DATA_ROW + 1;
  if (n > 0) {
    var vals = all.getRange(DATA_ROW, 1, n, 3).getValues();
    var target = String(name).trim().toLowerCase();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][1]).trim().toLowerCase() === target) {
        out.push([vals[i][0], vals[i][2] === true ? 'Grad' : 'Non-Grad']);
      }
    }
  }
  out.sort(function (a, b) { return cmp_(a[0], b[0]); });

  // Bandings are sheet objects, not formatting — clearFormat leaves them behind
  // and applyRowBanding throws on an overlapping range.
  sh.getBandings().forEach(function (b) {
    if (b.getRange().getColumn() >= 5) b.remove();
  });

  sh.getRange(DATA_ROW, 5, Math.max(1, sh.getMaxRows() - DATA_ROW + 1), 2)
    .clearContent().clearFormat()
    .setBorder(false, false, false, false, false, false);

  sh.getRange(P_HINT, 5).setValue(
    name + '  (' + out.length + (out.length === 1 ? ' guest)' : ' guests)'));
  if (!out.length) return;

  var rng = sh.getRange(DATA_ROW, 5, out.length, 2);
  rng.setValues(out);
  rng.setBorder(true, true, true, true, true, true, TH.rule,
                SpreadsheetApp.BorderStyle.SOLID);

  var backs = [], colors = [];
  for (var j = 0; j < out.length; j++) {
    var t = j % 2 ? TH.band : '#ffffff';
    backs.push([t, t]);
    colors.push([TH.ink, out[j][1] === 'Grad' ? TH.good : TH.sub]);
  }
  rng.setBackgrounds(backs);
  rng.setFontColors(colors);
  sh.getRange(DATA_ROW, 6, out.length, 1).setHorizontalAlignment('center');
}

/* ====================================================================== */
/*  UNMATCHED                                                              */
/* ====================================================================== */

function buildUnmatched_(ss, rows) {
  var sh = resetSheet_(ss, SH.UNMATCHED, 5, 60);

  var bad = rows.filter(function (r) { return !r.participant || !r.guest; });
  var selfReg = bad.filter(function (r) { return r.selfReg && r.guest; }).length;
  var broken  = bad.length - selfReg;

  titleBand_(sh, 5, 'UNMATCHED INVITES',
    bad.length + ' invitation(s) with no inviting participant · ' +
    selfReg + ' self-registered (expected)' +
    (broken ? ' · ' + broken + ' need attention' : ''));
  headerRow_(sh, HEAD_ROW, ['Name', 'Email', 'Grad?', 'Why unmatched', 'Ontraport ID']);

  if (!bad.length) {
    sh.getRange(DATA_ROW, 1, 1, 5).merge()
      .setValue('None — every invitation has both an inviting participant and a guest.')
      .setFontColor(TH.good).setFontStyle('italic')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setRowHeight(DATA_ROW, 30);
  } else {
    bad.sort(byGuest_);
    var body = [], backs = [];
    for (var i = 0; i < bad.length; i++) {
      var r = bad[i];
      var expected = r.selfReg && r.guest;
      body.push([
        r.guest || '(no guest name on record)',
        r.email || '(no email on record)',
        '',
        expected ? 'Self-registered — signed up directly, no inviter by design'
                 : (!r.guest ? 'No guest identity linked (f2259 empty)'
                             : 'No inviting participant linked (f2257 empty)'),
        r.id
      ]);
      var t = expected ? (i % 2 ? TH.band : '#ffffff') : TH.warnBg;
      backs.push([t, t, t, t, t]);
    }
    var rng = sh.getRange(DATA_ROW, 1, bad.length, 5);
    rng.setValues(body);
    rng.setBackgrounds(backs);
    rng.setBorder(true, true, true, true, true, true, TH.rule,
                  SpreadsheetApp.BorderStyle.SOLID);

    var cb = sh.getRange(DATA_ROW, 3, bad.length, 1);
    cb.insertCheckboxes();
    cb.setValues(bad.map(function (r) { return [r.grad === true]; }));
    cb.setHorizontalAlignment('center');
    sh.getRange(DATA_ROW, 4, bad.length, 1).setFontSize(9);
    sh.getRange(HEAD_ROW, 1, bad.length + 1, 5).createFilter();
  }

  sh.setFrozenRows(HEAD_ROW);
  widths_(sh, [200, 240, 70, 330, 110]);
  trimCols_(sh, 5);
}

/* ====================================================================== */
/*  DASHBOARD                                                              */
/* ====================================================================== */

function buildDashboard_(ss, rows, source) {
  var sh = resetSheet_(ss, SH.DASH, 8, 40);

  var total    = rows.length;
  var grads    = rows.filter(function (r) { return r.grad; }).length;
  var nonGrads = total - grads;
  var selfReg  = rows.filter(function (r) { return !r.participant; }).length;
  var noZoom   = rows.filter(function (r) { return !r.zoom; }).length;

  var participants = {}, emails = {};
  rows.forEach(function (r) {
    if (r.participant) participants[r.participant] = (participants[r.participant] || 0) + 1;
    if (r.email) emails[r.email.toLowerCase()] = true;
  });
  var pNames = Object.keys(participants);
  var pCount = pNames.length;
  var invitedCount = total - selfReg;
  var avgGpp = pCount ? invitedCount / pCount : 0;
  var dupExcess = duplicateExcess_(rows);

  titleBand_(sh, 8, 'INVITATIONS DASHBOARD', source);

  var kpis = [['Total Invites', total, '0'], ['Grad Invites', grads, '0'],
              ['Non-Grad Invites', nonGrads, '0'], ['Avg GPP', avgGpp, '0.0']];
  for (var i = 0; i < kpis.length; i++) {
    var c = 1 + i * 2;
    sh.getRange(4, c, 1, 2).merge().setValue(kpis[i][0])
      .setFontSize(10).setFontWeight('bold').setFontColor(TH.sub)
      .setHorizontalAlignment('center').setBackground(TH.cardBg);
    sh.getRange(5, c, 1, 2).merge().setValue(kpis[i][1]).setNumberFormat(kpis[i][2])
      .setFontSize(26).setFontWeight('bold').setFontColor(TH.headBg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground(TH.cardBg);
    sh.getRange(4, c, 2, 2).setBorder(true, true, true, true, false, false,
      TH.rule, SpreadsheetApp.BorderStyle.SOLID);
  }
  sh.setRowHeight(4, 22);
  sh.setRowHeight(5, 52);
  sh.getRange(6, 1, 1, 8).merge()
    .setValue('Avg GPP = participant-invited guests ÷ participants who invited ' +
              '(self-registered guests excluded, they have no inviter)')
    .setFontSize(9).setFontStyle('italic').setFontColor(TH.sub);

  headerRow_(sh, 8, ['Breakdown', 'Value']);
  var breakdown = [
    ['Participants who sent invites', pCount, '0'],
    ['Guests invited by a participant', invitedCount, '0'],
    ['Self-registered guests', selfReg, '0'],
    ['Unique guests (by email)', Object.keys(emails).length, '0'],
    ['Grad share of invites', total ? grads / total : 0, '0.0%']
  ];
  sh.getRange(9, 1, breakdown.length, 2)
    .setValues(breakdown.map(function (b) { return [b[0], b[1]]; }));
  for (var j = 0; j < breakdown.length; j++) {
    sh.getRange(9 + j, 2).setNumberFormat(breakdown[j][2]).setHorizontalAlignment('center');
  }
  sh.getRange(9, 1, breakdown.length, 2).setBorder(true, true, true, true, true, true,
    TH.rule, SpreadsheetApp.BorderStyle.SOLID);

  headerRow_(sh, 15, ['Data quality', 'Value']);
  var quality = [
    ['Duplicate invitations (same participant + guest email)', dupExcess],
    ['Invitations with no Zoom link yet', noZoom],
    ['Invitations with no guest identity', rows.filter(function (r) { return !r.guest; }).length]
  ];
  sh.getRange(16, 1, quality.length, 2).setValues(quality);
  sh.getRange(16, 2, quality.length, 1).setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange(16, 1, quality.length, 2).setBorder(true, true, true, true, true, true,
    TH.rule, SpreadsheetApp.BorderStyle.SOLID);
  for (var q = 0; q < quality.length; q++) {
    if (quality[q][1] > 0) {
      sh.getRange(16 + q, 1, 1, 2).setBackground(TH.warnBg);
      sh.getRange(16 + q, 2).setFontColor(TH.warnFg).setFontWeight('bold');
    }
  }

  var top = pNames.map(function (p) { return [p, participants[p]]; })
    .sort(function (a, b) { return b[1] - a[1] || cmp_(a[0], b[0]); })
    .slice(0, 10);
  headerRow_(sh, 8, ['#', 'Top inviters', 'Invites'], 5);
  if (top.length) {
    var tr = sh.getRange(9, 5, top.length, 3);
    tr.setValues(top.map(function (t, k) { return [k + 1, t[0], t[1]]; }));
    tr.setBorder(true, true, true, true, true, true, TH.rule,
                 SpreadsheetApp.BorderStyle.SOLID);
    var tb = [];
    for (var m = 0; m < top.length; m++) {
      var tt = m % 2 ? TH.band : '#ffffff';
      tb.push([tt, tt, tt]);
    }
    tr.setBackgrounds(tb);
    sh.getRange(9, 5, top.length, 1).setHorizontalAlignment('center').setFontColor(TH.sub);
    sh.getRange(9, 7, top.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
  }

  sh.getRange(21, 1, 1, 8).merge()
    .setValue('Grad = invitation field "Is guest a grad of The Landmark Forum?" (f2337) = Yes.  ' +
              'Self-registered = Invitation Type 457.  Zoom links live on the Zoom Links tab.')
    .setFontSize(9).setFontStyle('italic').setFontColor(TH.sub)
    .setVerticalAlignment('middle');
  sh.setRowHeight(21, 24);

  widths_(sh, [210, 110, 90, 90, 40, 190, 80, 90]);
  trimCols_(sh, 8);
  sh.setHiddenGridlines(true);
}
