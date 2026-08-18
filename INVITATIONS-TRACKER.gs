/**
 * LANDMARK — INVITATIONS TRACKER
 * ------------------------------------------------------------------
 * Builds a 6-tab team-facing workbook from the Ontraport Invitations
 * object (oInvitations, objectID 10003):
 *
 *   1. Dashboard          — headline metrics + top inviters + data quality
 *   2. Participants       — one row per inviting participant; click a
 *                           name in column A to list their guests in E/F
 *   3. All Invites        — one row per invitation record
 *   4. Grad Guests        — All Invites filtered to grads
 *   5. Non-Grad Guests    — All Invites filtered to non-grads
 *   6. Unmatched Invites  — invitations missing a participant or a guest
 *
 * GRAD DEFINITION
 *   f2337 "Is guest a grad of The Landmark Forum?"  147 = Yes, 148 = No.
 *   This is the field populated by the invitation form. The programmatic
 *   fields f2292 (Guest is a graduate) and f2968 (Guest Graduate Status)
 *   are currently unset on every record, so they are deliberately unused.
 *
 * DATA SOURCE
 *   Runs off a built-in snapshot until Ontraport API credentials are set.
 *   Menu ▸ Invitations ▸ Set Ontraport API credentials… then Refresh.
 *   Credentials live in Script Properties, never in the sheet.
 *
 * INSTALL
 *   Extensions ▸ Apps Script ▸ paste this file ▸ Save ▸ Run `refreshAll`
 *   ▸ approve the permission prompt. Reload the sheet for the menu.
 */

var CFG = {
  OBJECT_ID: 10003,
  API_BASE: 'https://api.ontraport.com/1/objects',
  PAGE_SIZE: 50,
  GRAD_YES: '147',
  SNAPSHOT_LABEL: 'Built-in snapshot — 17 Aug 2026 (post-dedupe)',
  EXTERNS: 'f2259//firstname,f2259//lastname,f2259//email,' +
           'f2257//firstname,f2257//lastname,f2258//id'
};

var SH = {
  DASH:      'Dashboard',
  PART:      'Participants',
  ALL:       'All Invites',
  GRAD:      'Grad Guests',
  NONGRAD:   'Non-Grad Guests',
  UNMATCHED: 'Unmatched Invites'
};

/**
 * Landmark palette, lifted from the portal/dashboard CSS custom properties
 * so this sheet matches the product:
 *   --teal #0d2d31 · --teal-deep #0a2226 · mid teal #3f6b6d
 *   --green #217a00 · --green-bright #2ea203 · --green-bg #e9f4e5
 *   --ink #0e1a19 · --ink-3 #6f6b66 · --coral-ink #c8452a
 * Dark teal carries the header bands; green is the accent (grads, live links).
 */
var TH = {
  headBg:  '#0d2d31',   // --teal : title bands
  headFg:  '#ffffff',
  subBg:   '#f0eee9',   // warm light : subtitle strip
  colBg:   '#3f6b6d',   // mid teal : column header rows
  ink:     '#0e1a19',   // --ink
  sub:     '#6f6b66',   // --ink-3
  rule:    '#e6e2d8',   // warm border
  cardBg:  '#f7f5ef',   // warm card fill
  accent:  '#217a00',   // --green : clickable / positive
  good:    '#217a00',   // --green
  warnBg:  '#fdf3e3',
  warnFg:  '#b8730a',
  dupBg:   '#fbeae6'    // light coral tint (--coral-ink family)
};

/* Row layout constants -------------------------------------------------- */
var LIST_HEAD = 4;   // header row on the four list tabs
var LIST_DATA = 5;   // first data row on the four list tabs
var P_HINT    = 3;   // Participants: hint row / detail-pane title row
var P_HEAD    = 4;   // Participants: header row
var P_DATA    = 5;   // Participants: first data row

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
    .addItem('Check status', 'checkSource')
    .addToUi();
}

function setCredentials() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Ontraport API', 'Api-Appid:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var b = ui.prompt('Ontraport API', 'Api-Key:', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperties({
    ONTRAPORT_APP_ID: a.getResponseText().trim(),
    ONTRAPORT_API_KEY: b.getResponseText().trim()
  });
  ui.alert('Saved. Run Invitations ▸ Refresh from Ontraport to pull live data.');
}

function checkSource() {
  var p = PropertiesService.getScriptProperties();
  var has = p.getProperty('ONTRAPORT_APP_ID') && p.getProperty('ONTRAPORT_API_KEY');
  var trig = autoRefreshTriggers_().length;
  SpreadsheetApp.getUi().alert(
    (has ? 'Ontraport credentials ARE set — refresh pulls live data.'
         : 'No credentials set — refresh uses the ' + CFG.SNAPSHOT_LABEL + '.') +
    '\n\n' +
    (trig ? 'Auto-refresh is ON (' + trig + ' trigger).'
          : 'Auto-refresh is OFF.'));
}

/* ====================================================================== */
/*  AUTO-REFRESH                                                           */
/*  A time-driven trigger reruns refreshAll on a schedule, so the team     */
/*  always opens current numbers and nobody re-pastes anything.            */
/* ====================================================================== */

function autoRefreshTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'refreshAll';
  });
}

/** Remove any existing refreshAll triggers so we never stack duplicates. */
function removeAutoRefresh() {
  var found = autoRefreshTriggers_();
  found.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  try {
    SpreadsheetApp.getUi().alert(found.length
      ? 'Auto-refresh turned off (' + found.length + ' trigger removed).'
      : 'Auto-refresh was already off.');
  } catch (e) {}
  return found.length;
}

function installHourly()      { return installAutoRefresh_(1); }
function installEvery4Hours() { return installAutoRefresh_(4); }

function installAutoRefresh_(hours) {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ONTRAPORT_APP_ID') || !p.getProperty('ONTRAPORT_API_KEY')) {
    try {
      SpreadsheetApp.getUi().alert(
        'Set the Ontraport API credentials first.\n\n' +
        'Without them the schedule would just rebuild the same built-in snapshot ' +
        'over and over, and the numbers would never actually change.');
    } catch (e) {}
    return 0;
  }

  autoRefreshTriggers_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshAll').timeBased().everyHours(hours).create();

  try {
    SpreadsheetApp.getUi().alert('Auto-refresh is on — every ' + hours +
      (hours === 1 ? ' hour.' : ' hours.') +
      '\n\nIt runs on Google\'s servers under your account, so the sheet stays ' +
      'current even when nobody has it open.');
  } catch (e) {}
  return hours;
}

/* ====================================================================== */
/*  MAIN                                                                   */
/* ====================================================================== */

function refreshAll() {
  var ss = SpreadsheetApp.getActive();
  var loaded = loadInvitations_();
  var rows = loaded.rows;

  ensureDashboardSheet_(ss);
  buildAllInvites_(ss, rows);
  buildFiltered_(ss, SH.GRAD, rows.filter(function (r) { return r.grad; }),
                 'Guests who have completed The Landmark Forum.');
  buildFiltered_(ss, SH.NONGRAD, rows.filter(function (r) { return !r.grad; }),
                 'Guests who have not completed The Landmark Forum.');
  buildParticipants_(ss, rows);
  buildUnmatched_(ss, rows);
  buildDashboard_(ss, rows, loaded.source);

  orderSheets_(ss);

  // Anything UI-ish is optional: refreshAll also runs unattended from the
  // time-driven trigger, where there is no active user to show it to.
  try {
    ss.setActiveSheet(ss.getSheetByName(SH.DASH));
    ss.toast(rows.length + ' invitations loaded. ' + loaded.source,
             'Refresh complete', 6);
  } catch (e) {}
}

function loadInvitations_() {
  var p = PropertiesService.getScriptProperties();
  var appId = p.getProperty('ONTRAPORT_APP_ID');
  var key = p.getProperty('ONTRAPORT_API_KEY');
  if (appId && key) {
    try {
      var live = fetchLive_(appId, key);
      if (live.length) {
        return { rows: live, source: 'Live from Ontraport · ' + stamp_() };
      }
      throw new Error('API returned no records');
    } catch (err) {
      SpreadsheetApp.getActive()
        .toast('Live fetch failed: ' + err.message + ' — using snapshot.', 'Invitations', 10);
    }
  }
  return { rows: seedRows_(), source: CFG.SNAPSHOT_LABEL };
}

function fetchLive_(appId, key) {
  var out = [], start = 0;
  while (true) {
    var url = CFG.API_BASE +
      '?objectID=' + CFG.OBJECT_ID +
      '&range=' + CFG.PAGE_SIZE +
      '&start=' + start +
      '&sort=id&sortDir=asc' +
      '&listFields=' + encodeURIComponent('id,f2337,f2256') +
      '&externs=' + encodeURIComponent(CFG.EXTERNS);

    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Api-Appid': appId, 'Api-Key': key, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('HTTP ' + resp.getResponseCode());
    }
    var data = JSON.parse(resp.getContentText()).data || [];
    for (var i = 0; i < data.length; i++) out.push(normalize_(data[i]));
    if (data.length < CFG.PAGE_SIZE) break;
    start += CFG.PAGE_SIZE;
    if (start > 20000) break;   // runaway guard
  }
  return out;
}

function normalize_(r) {
  var name = function (a, b) {
    return ((r[a] || '') + ' ' + (r[b] || '')).replace(/\s+/g, ' ').trim();
  };
  return {
    id: r.id,
    participant: name('f2257//firstname', 'f2257//lastname'),
    guest: name('f2259//firstname', 'f2259//lastname'),
    email: (r['f2259//email'] || '').toString().trim(),
    grad: String(r.f2337) === CFG.GRAD_YES
  };
}

function seedRows_() {
  return SEED_ROWS.map(function (a) {
    return {
      id: a[0],
      participant: a[1],
      guest: (a[2] + ' ' + a[3]).replace(/\s+/g, ' ').trim(),
      email: a[4],
      grad: a[5] === 1
    };
  });
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
  // Reuse the starter tab if it is effectively empty, otherwise add a new one.
  if (first.getLastRow() <= 2 && first.getLastColumn() <= 6) {
    first.setName(SH.DASH);
  } else {
    ss.insertSheet(SH.DASH);
  }
}

/** Guarantee the sheet is at least minCols wide and minRows tall. */
function ensureSize_(sh, minCols, minRows) {
  var c = sh.getMaxColumns();
  if (c < minCols) sh.insertColumnsAfter(c, minCols - c);
  var r = sh.getMaxRows();
  if (r < minRows) sh.insertRowsAfter(r, minRows - r);
  return sh;
}

function resetSheet_(ss, name, minCols, minRows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  ensureSize_(sh, minCols || 8, minRows || 40);
  sh.clear();
  sh.clearConditionalFormatRules();
  var filter = sh.getFilter();
  if (filter) filter.remove();
  var bandings = sh.getBandings();
  for (var i = 0; i < bandings.length; i++) bandings[i].remove();
  // clear() leaves merges behind; stale merges break later setValues calls.
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns())
    .breakApart()
    .clearDataValidations().clearNote().setFontLine('none');
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  return sh;
}

function titleBand_(sh, lastCol, title, subtitle) {
  sh.getRange(1, 1, 1, lastCol).merge()
    .setValue(title)
    .setFontSize(15).setFontWeight('bold')
    .setFontColor(TH.headFg).setBackground(TH.headBg)
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 40);

  sh.getRange(2, 1, 1, lastCol).merge()
    .setValue(subtitle)
    .setFontSize(10).setFontColor(TH.sub).setBackground(TH.subBg)
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);
}

function headerRow_(sh, row, labels, startCol) {
  startCol = startCol || 1;
  sh.getRange(row, startCol, 1, labels.length)
    .setValues([labels])
    .setFontWeight('bold').setFontSize(10)
    .setFontColor(TH.headFg).setBackground(TH.colBg)
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 26);
}

function orderSheets_(ss) {
  var order = [SH.DASH, SH.PART, SH.ALL, SH.GRAD, SH.NONGRAD, SH.UNMATCHED];
  try {
    for (var i = 0; i < order.length; i++) {
      var sh = ss.getSheetByName(order[i]);
      if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
    }
  } catch (e) {
    // Tab order is cosmetic — never let it fail an unattended refresh.
  }
}

/* ====================================================================== */
/*  LIST TABS                                                              */
/* ====================================================================== */

/**
 * Shared renderer for All Invites / Grad Guests / Non-Grad Guests.
 * Columns: A Invitee · B Participant · C Grad? (checkbox) · D Guest Email
 */
function renderInviteList_(sh, rows, title, subtitle, dupKeys) {
  titleBand_(sh, 4, title, subtitle);
  headerRow_(sh, LIST_HEAD, ['Invitee', 'Participant', 'Grad?', 'Guest Email']);

  var n = rows.length;
  if (!n) {
    sh.getRange(LIST_DATA, 1, 1, 4).merge()
      .setValue('No records.')
      .setFontColor(TH.sub).setFontStyle('italic')
      .setHorizontalAlignment('center');
    finishList_(sh, 0);
    return;
  }

  var body = rows.map(function (r) {
    return [r.guest || '(no guest on record)', r.participant || '(unmatched)', '', r.email];
  });
  sh.getRange(LIST_DATA, 1, n, 4).setValues(body);

  var cb = sh.getRange(LIST_DATA, 3, n, 1);
  cb.insertCheckboxes();
  cb.setValues(rows.map(function (r) { return [r.grad === true]; }));
  cb.setHorizontalAlignment('center');

  sh.getRange(LIST_DATA, 1, n, 4)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  // Tint rows that repeat the same participant + guest email pair.
  if (dupKeys) {
    for (var i = 0; i < rows.length; i++) {
      if (dupKeys[dupKey_(rows[i])]) {
        sh.getRange(LIST_DATA + i, 1, 1, 4).setBackground(TH.dupBg);
        sh.getRange(LIST_DATA + i, 1)
          .setNote('Duplicate: this participant already has another invitation ' +
                   'to the same guest email.');
      }
    }
  }

  finishList_(sh, n);
}

function finishList_(sh, n) {
  sh.setFrozenRows(LIST_HEAD);
  sh.setColumnWidth(1, 210);
  sh.setColumnWidth(2, 200);
  sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 260);
  if (n) {
    sh.getRange(LIST_HEAD, 1, n + 1, 4).createFilter();
    sh.getRange(LIST_DATA, 1, n, 4)
      .setBorder(true, true, true, true, true, true, TH.rule,
                 SpreadsheetApp.BorderStyle.SOLID);
  }
  trimCols_(sh, 4);
}

function trimCols_(sh, keep) {
  var extra = sh.getMaxColumns() - keep;
  if (extra > 0) sh.deleteColumns(keep + 1, extra);
}

function dupKey_(r) {
  return (r.participant || '').toLowerCase() + '||' + (r.email || '').toLowerCase();
}

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

function buildAllInvites_(ss, rows) {
  var sh = resetSheet_(ss, SH.ALL, 4, LIST_DATA + rows.length + 5);
  var sorted = rows.slice().sort(function (a, b) {
    return cmp_(a.guest, b.guest);
  });
  renderInviteList_(sh, sorted,
    'ALL INVITES',
    'One row per invitation record · ' + rows.length +
    ' total · tinted rows are duplicate participant + guest pairs',
    duplicateKeys_(rows));
}

function buildFiltered_(ss, name, rows, note) {
  var sh = resetSheet_(ss, name, 4, LIST_DATA + rows.length + 5);
  var sorted = rows.slice().sort(function (a, b) { return cmp_(a.guest, b.guest); });
  renderInviteList_(sh, sorted, name.toUpperCase(),
    note + ' · ' + rows.length + ' records', null);
}

function cmp_(a, b) {
  a = (a || '').toLowerCase(); b = (b || '').toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ====================================================================== */
/*  PARTICIPANTS TAB                                                       */
/* ====================================================================== */

function buildParticipants_(ss, rows) {
  var sh = resetSheet_(ss, SH.PART, 6, P_DATA + rows.length + 5);

  var byName = {};
  rows.forEach(function (r) {
    var p = r.participant;
    if (!p) return;
    if (!byName[p]) byName[p] = { name: p, total: 0, grads: 0 };
    byName[p].total++;
    if (r.grad) byName[p].grads++;
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

  headerRow_(sh, P_HEAD, ['Participant', 'Total Invites']);
  headerRow_(sh, P_HEAD, ['Invitee', 'Grad / Non-Grad'], 5);

  if (list.length) {
    sh.getRange(P_DATA, 1, list.length, 2).setValues(
      list.map(function (p) { return [p.name, p.total]; }));
    sh.getRange(P_DATA, 2, list.length, 1).setHorizontalAlignment('center');
    // applyRowBanding returns a Banding, not a Range — don't chain Range calls off it.
    var pRange = sh.getRange(P_DATA, 1, list.length, 2);
    pRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    pRange.setBorder(true, true, true, true, true, true, TH.rule,
                     SpreadsheetApp.BorderStyle.SOLID);
    // Green marks the names as the clickable thing on this tab.
    sh.getRange(P_DATA, 1, list.length, 1)
      .setFontColor(TH.accent).setFontWeight('bold');
  }

  sh.setFrozenRows(P_HEAD);
  sh.setColumnWidth(1, 210);
  sh.setColumnWidth(2, 100);
  sh.setColumnWidth(3, 24);
  sh.setColumnWidth(4, 24);
  sh.setColumnWidth(5, 210);
  sh.setColumnWidth(6, 130);
  trimCols_(sh, 6);
}

/**
 * Simple trigger: clicking a participant name repaints the E/F detail pane.
 */
function onSelectionChange(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SH.PART) return;
    if (e.range.getColumn() !== 1 || e.range.getRow() < P_DATA) return;
    var name = sh.getRange(e.range.getRow(), 1).getValue();
    if (!name) return;
    var shown = String(sh.getRange(P_HINT, 5).getValue());
    if (shown.indexOf(name + '  (') === 0) return;   // already displayed
    paintInvitees_(sh, name);
  } catch (err) {
    // Simple triggers must fail silently; use the menu item to diagnose.
  }
}

function showSelectedParticipant() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SH.PART) {
    SpreadsheetApp.getUi().alert('Open the Participants tab and select a name in column A.');
    return;
  }
  var cell = sh.getActiveCell();
  if (cell.getColumn() !== 1 || cell.getRow() < P_DATA || !cell.getValue()) {
    SpreadsheetApp.getUi().alert('Select a participant name in column A first.');
    return;
  }
  paintInvitees_(sh, cell.getValue());
}

function paintInvitees_(sh, name) {
  var all = sh.getParent().getSheetByName(SH.ALL);
  if (!all) return;

  var out = [];
  var n = all.getLastRow() - LIST_DATA + 1;
  if (n > 0) {
    var vals = all.getRange(LIST_DATA, 1, n, 3).getValues();
    var target = String(name).trim().toLowerCase();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][1]).trim().toLowerCase() === target) {
        out.push([vals[i][0], vals[i][2] === true ? 'Grad' : 'Non-Grad']);
      }
    }
  }
  out.sort(function (a, b) { return cmp_(a[0], b[0]); });

  // Bandings are objects on the sheet, not formatting — clearFormat leaves them,
  // and applyRowBanding throws if the new range overlaps an existing one.
  var bandings = sh.getBandings();
  for (var b = 0; b < bandings.length; b++) {
    if (bandings[b].getRange().getColumn() >= 5) bandings[b].remove();
  }

  var clearRows = Math.max(1, sh.getMaxRows() - P_DATA + 1);
  sh.getRange(P_DATA, 5, clearRows, 2)
    .clearContent().clearFormat().setBorder(false, false, false, false, false, false);

  sh.getRange(P_HINT, 5).setValue(name + '  (' + out.length +
    (out.length === 1 ? ' guest)' : ' guests)'));

  if (!out.length) return;

  var rng = sh.getRange(P_DATA, 5, out.length, 2);
  rng.setValues(out);
  rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  rng.setBorder(true, true, true, true, true, true, TH.rule,
                SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(P_DATA, 6, out.length, 1).setHorizontalAlignment('center');

  for (var j = 0; j < out.length; j++) {
    if (out[j][1] === 'Grad') {
      sh.getRange(P_DATA + j, 6).setFontColor(TH.good).setFontWeight('bold');
    } else {
      sh.getRange(P_DATA + j, 6).setFontColor(TH.sub);
    }
  }
}

/* ====================================================================== */
/*  UNMATCHED TAB                                                          */
/* ====================================================================== */

function buildUnmatched_(ss, rows) {
  var sh = resetSheet_(ss, SH.UNMATCHED, 5, 60);

  var bad = [];
  rows.forEach(function (r) {
    var noParticipant = !r.participant;
    var noGuest = !r.guest && !r.email;
    if (noParticipant || noGuest) {
      bad.push({
        name: r.guest || '(no guest name on record)',
        email: r.email || '(no email on record)',
        grad: r.grad,
        reason: noParticipant
          ? 'No inviting participant linked (f2257 empty)'
          : 'No guest identity linked (f2259 empty) — inviter: ' + r.participant,
        id: r.id
      });
    }
  });

  titleBand_(sh, 5, 'UNMATCHED INVITES',
    'Invitation records missing an inviting participant or a guest identity · ' +
    bad.length + ' found');
  headerRow_(sh, LIST_HEAD, ['Name', 'Email', 'Grad?', 'Why unmatched', 'Ontraport ID']);

  if (!bad.length) {
    sh.getRange(LIST_DATA, 1, 1, 5).merge()
      .setValue('None — every invitation has both an inviting participant and a guest.')
      .setFontColor(TH.good).setFontStyle('italic')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setRowHeight(LIST_DATA, 30);
  } else {
    sh.getRange(LIST_DATA, 1, bad.length, 5).setValues(bad.map(function (b) {
      return [b.name, b.email, '', b.reason, b.id];
    }));
    var cb = sh.getRange(LIST_DATA, 3, bad.length, 1);
    cb.insertCheckboxes();
    cb.setValues(bad.map(function (b) { return [b.grad === true]; }));
    cb.setHorizontalAlignment('center');
    sh.getRange(LIST_DATA, 1, bad.length, 5)
      .setBackground(TH.warnBg)
      .setBorder(true, true, true, true, true, true, TH.rule,
                 SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(LIST_DATA, 4, bad.length, 1).setFontColor(TH.warnFg).setFontSize(9);
  }

  sh.setFrozenRows(LIST_HEAD);
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 240);
  sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 330);
  sh.setColumnWidth(5, 110);
  trimCols_(sh, 5);
}

/* ====================================================================== */
/*  DASHBOARD                                                              */
/* ====================================================================== */

function buildDashboard_(ss, rows, source) {
  var sh = resetSheet_(ss, SH.DASH, 8, 40);

  var total = rows.length;
  var grads = rows.filter(function (r) { return r.grad; }).length;
  var nonGrads = total - grads;

  var participants = {}, emails = {};
  rows.forEach(function (r) {
    if (r.participant) participants[r.participant] = (participants[r.participant] || 0) + 1;
    if (r.email) emails[r.email.toLowerCase()] = true;
  });
  var pNames = Object.keys(participants);
  var pCount = pNames.length;
  var uniqueGuests = Object.keys(emails).length;
  var avgGpp = pCount ? total / pCount : 0;
  var dupExcess = duplicateExcess_(rows);
  var noGuest = rows.filter(function (r) { return !r.guest && !r.email; }).length;
  var noParticipant = rows.filter(function (r) { return !r.participant; }).length;
  var zeroGradInviters = pNames.filter(function (p) {
    return !rows.some(function (r) { return r.participant === p && r.grad; });
  }).length;

  titleBand_(sh, 8, 'INVITATIONS DASHBOARD', source);

  // If a scheduled refresh quietly fell back to the snapshot, the numbers are
  // stale. Make that impossible to miss rather than letting it read as live.
  if (source.indexOf('Live') !== 0) {
    sh.getRange(2, 1, 1, 8)
      .setValue('⚠  ' + source +
                ' — not live. Set Ontraport API credentials via the Invitations menu.')
      .setBackground(TH.warnBg).setFontColor(TH.warnFg).setFontWeight('bold');
  }

  /* ---- KPI cards ---------------------------------------------------- */
  var kpis = [
    ['Total Invites', total, '0'],
    ['Grad Invites', grads, '0'],
    ['Non-Grad Invites', nonGrads, '0'],
    ['Avg GPP', avgGpp, '0.0']
  ];
  for (var i = 0; i < kpis.length; i++) {
    var c = 1 + i * 2;
    sh.getRange(4, c, 1, 2).merge()
      .setValue(kpis[i][0])
      .setFontSize(10).setFontWeight('bold').setFontColor(TH.sub)
      .setHorizontalAlignment('center').setBackground(TH.cardBg);
    sh.getRange(5, c, 1, 2).merge()
      .setValue(kpis[i][1]).setNumberFormat(kpis[i][2])
      .setFontSize(26).setFontWeight('bold').setFontColor(TH.headBg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground(TH.cardBg);
    sh.getRange(4, c, 2, 2)
      .setBorder(true, true, true, true, false, false, TH.rule,
                 SpreadsheetApp.BorderStyle.SOLID);
  }
  sh.setRowHeight(4, 22);
  sh.setRowHeight(5, 52);
  sh.getRange(6, 1, 1, 8).merge()
    .setValue('Avg GPP = guests per participant (total invites ÷ participants who invited)')
    .setFontSize(9).setFontStyle('italic').setFontColor(TH.sub);

  /* ---- Breakdown ---------------------------------------------------- */
  headerRow_(sh, 8, ['Breakdown', 'Value']);
  var breakdown = [
    ['Participants who sent invites', pCount, '0'],
    ['Unique guests (by email)', uniqueGuests, '0'],
    ['Grad share of invites', total ? grads / total : 0, '0.0%'],
    ['Most invites by one participant', pCount ? Math.max.apply(null,
      pNames.map(function (p) { return participants[p]; })) : 0, '0'],
    ['Participants who invited no grads', zeroGradInviters, '0']
  ];
  sh.getRange(9, 1, breakdown.length, 2)
    .setValues(breakdown.map(function (b) { return [b[0], b[1]]; }));
  for (var j = 0; j < breakdown.length; j++) {
    sh.getRange(9 + j, 2).setNumberFormat(breakdown[j][2]).setHorizontalAlignment('center');
  }
  sh.getRange(9, 1, breakdown.length, 2)
    .setBorder(true, true, true, true, true, true, TH.rule,
               SpreadsheetApp.BorderStyle.SOLID);

  /* ---- Data quality ------------------------------------------------- */
  headerRow_(sh, 15, ['Data quality', 'Value']);
  var quality = [
    ['Duplicate invitations (same participant + guest email)', dupExcess],
    ['Invites with no guest identity', noGuest],
    ['Invites with no inviting participant', noParticipant],
    ['Distinct guests after removing duplicates', uniqueGuests]
  ];
  sh.getRange(16, 1, quality.length, 2).setValues(quality);
  sh.getRange(16, 2, quality.length, 1)
    .setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange(16, 1, quality.length, 2)
    .setBorder(true, true, true, true, true, true, TH.rule,
               SpreadsheetApp.BorderStyle.SOLID);
  for (var q = 0; q < 3; q++) {
    if (quality[q][1] > 0) {
      sh.getRange(16 + q, 1, 1, 2).setBackground(TH.warnBg);
      sh.getRange(16 + q, 2).setFontColor(TH.warnFg).setFontWeight('bold');
    }
  }

  /* ---- Top inviters ------------------------------------------------- */
  var top = pNames.map(function (p) { return [p, participants[p]]; })
    .sort(function (a, b) { return b[1] - a[1] || cmp_(a[0], b[0]); })
    .slice(0, 10);

  headerRow_(sh, 8, ['#', 'Top inviters', 'Invites'], 5);
  if (top.length) {
    sh.getRange(9, 5, top.length, 3).setValues(top.map(function (t, k) {
      return [k + 1, t[0], t[1]];
    }));
    sh.getRange(9, 5, top.length, 1).setHorizontalAlignment('center').setFontColor(TH.sub);
    sh.getRange(9, 7, top.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
    var topRange = sh.getRange(9, 5, top.length, 3);
    topRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    topRange.setBorder(true, true, true, true, true, true, TH.rule,
                       SpreadsheetApp.BorderStyle.SOLID);
  }

  /* ---- Footer ------------------------------------------------------- */
  sh.getRange(21, 1, 1, 8).merge()
    .setValue('Grad = invitation field "Is guest a grad of The Landmark Forum?" (f2337) set to Yes. ' +
              'Refresh via the Invitations menu.')
    .setFontSize(9).setFontStyle('italic').setFontColor(TH.sub)
    .setVerticalAlignment('middle');
  sh.setRowHeight(21, 24);

  sh.setColumnWidth(1, 210);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 90);
  sh.setColumnWidth(5, 40);
  sh.setColumnWidth(6, 190);
  sh.setColumnWidth(7, 80);
  sh.setColumnWidth(8, 90);
  trimCols_(sh, 8);
  sh.setHiddenGridlines(true);
}

/* ====================================================================== */
/*  SNAPSHOT DATA                                                          */
/*  [id, participant, guestFirst, guestLast, email, grad(1=yes)]           */
/*  Pulled from Ontraport oInvitations on 17 Aug 2026 after dedupe — 174 records,       */
/*  all for event 218 (The Landmark Forum). Replaced by live data once     */
/*  API credentials are set.                                               */
/* ====================================================================== */

var SEED_ROWS = [
  [878, 'Corey Yeaton', 'Kara', 'Yeaton', 'karacha14@gmail.com', 0],
  [879, 'Julia Aguinaldo', 'Dawn', 'Aguinaldo', 'libertysol1989@gmail.com', 1],
  [880, 'Devendra Das', 'John', 'Miller', 'johndmillerjr@gmail.com', 0],
  [881, 'Katie Bergbauer', 'Zak', 'Kloster', 'zkloster@gmail.com', 0],
  [882, 'Jess Scheu', 'Helen', 'Nixon', 'Hnixon62@gmail.com', 0],
  [884, 'Kyle Tait', 'Austan', 'Tait', 'austan.tait@gmail.com', 0],
  [886, 'Jess Scheu', 'James', 'Scheu', 'Jscheu91@gmail.com', 0],
  [889, 'Jess Scheu', 'Heather', 'Scheu', 'hscheu1986@gmail.com', 0],
  [890, 'Suzanne Kronisch', 'Lennie', 'Kronisch', 'lenniekronisch134@gmail.com', 0],
  [891, 'Suzanne Kronisch', 'Anthony', 'Susana', 'anthony42376@gmail.com', 0],
  [892, 'Suzanne Kronisch', 'Sandee', 'Schaps', 'chantismom@gmail.com', 0],
  [893, 'Kamili Kelly', 'Alison', 'Brown', 'alisonbrown21@yahoo.com', 0],
  [894, 'Jim Rubin', 'Kathryn', 'Keown', 'kathryn@hotyogarepublic.com', 1],
  [895, 'Teig Stanley', 'Erlinda', 'Vo', 'erlindavo@proton.me', 1],
  [896, 'Wren LaFeet', 'Kristin', 'Mineah', 'yemamadesigns@gmail.com', 0],
  [897, 'Wren LaFeet', 'Dennis', 'Naumann', 'dennisnaumann73@gmail.com', 0],
  [898, 'Curtis Poppenberg', 'Trude', 'White', 'trudeandtim@yahoo.com', 0],
  [899, 'Curtis Poppenberg', 'Bethany', 'Wilson', 'BethanyLeaWilson@gmail.com', 1],
  [900, 'Curtis Poppenberg', '', '', '', 1],
  [901, 'Curtis Poppenberg', 'Bethany', 'Poppenberg', 'Bethany.poppenberg@gmail.com', 1],
  [902, 'Suzanne Kronisch', 'Naomi', 'Henderson', 'naomi@loloft.com', 0],
  [903, 'Helena Gibson', 'Kim', 'Bradley', 'squirrelyacres@aol.com', 0],
  [905, 'Helena Gibson', 'Layla', 'Gibson', 'layla3713@icloud.com', 0],
  [906, 'Shalini Lunia', 'saakshi', 'lunkad', 'lunkadsaakshi@gmail.com', 0],
  [907, 'Shalini Lunia', 'JAI', 'LUNKAD', 'jailunkad@hotmail.com', 0],
  [908, 'Julia Aguinaldo', 'Chase', 'Koda', 'chasekoda@me.com', 0],
  [909, 'Julia Aguinaldo', 'Pedro', 'Morales', 'pedroartist314@gmail.com', 0],
  [910, 'Julia Aguinaldo', 'Amanda', 'Goodridge', 'goodridgeamanda18@gmail.com', 0],
  [911, 'Julia Aguinaldo', 'Rebecca', 'Fernandez', 'bexkf520@gmail.com', 0],
  [912, 'Julia Aguinaldo', 'Elise', 'Barnes', 'egabbyb05@gmail.com', 0],
  [913, 'Keesha Bowers', 'Josiah', 'Garcia', 'joe_duder@gmail.com', 0],
  [914, 'Keesha Bowers', 'Rowen', 'Garvin', 'rowengarvin232@gmail.com', 0],
  [915, 'Emzi Takahashi', 'Dale', 'Crippsta', 'Dacrippsta@msn.com', 0],
  [916, 'Stacey Dunn', 'Tara', 'Gravino', 'tara.gravino@vineyardgcfa.com', 0],
  [917, 'Stacey Dunn', 'Cheri', 'Berman', 'jak4444@gmail.com', 0],
  [918, 'Jim Rubin', 'Dan', 'Olshansky', 'dolshansky@yahoo.com', 0],
  [919, 'Heidi Moss', 'Maddox', 'Rees', 'maddoxhardin@yahoo.com', 0],
  [920, 'Heidi Moss', 'Alissa', 'Kramer', 'alissakramer@gmail.com', 0],
  [921, 'Heidi Moss', 'Carolyn', 'Kramer', 'ckramer@me.com', 0],
  [922, 'kamyar marashi', 'Parwana', 'Marashi', 'parwana01@gmail.com', 0],
  [923, 'kamyar marashi', 'Ella', 'Marashi', 'ella.marashi@gmail.com', 0],
  [924, 'kamyar marashi', 'eva', 'marashi', 'eva.marashi8@gmail.com', 0],
  [925, 'kamyar marashi', 'Leila', 'Marashi', 'leila.marashi123@gmail.com', 0],
  [926, 'Mary Joy Menor', 'Cecilia', 'Strachan', 'cstrachan@vcc.ca', 0],
  [927, 'Cirilo Rolotti', 'Inaki', 'Ledesma', 'inicolasledesma@gmail.com', 0],
  [928, 'Cirilo Rolotti', 'Santiago', 'Veiga', 'santiveiga02@gmail.com', 0],
  [929, 'Kamili Kelly', 'Chris', 'Kelly', 'kellychris875@gmail.com', 0],
  [930, 'Sandra Gonzalez', 'Dreena', 'Naggar', 'dreenadiane@gmail.com', 1],
  [931, 'Sandra Gonzalez', 'Hazel', 'Ortega', 'ortega.hazel@gmail.com', 1],
  [932, 'Sandra Gonzalez', 'Dagmar', 'Kusiak', 'daggiek@gmail.com', 0],
  [933, 'Sandra Gonzalez', 'Alyssa', 'Gonzalez', 'allister9879@gmail.com', 0],
  [934, 'Melissa Clark', 'Jennie', 'Boesel', 'jimse87@gmail.com', 0],
  [935, 'Sandra Gonzalez', 'Alanna', 'Caldarella', 'alanna.phelps@yahoo.com', 0],
  [936, 'Kayla Morrissey', 'Collyn', 'Aubrey', 'whatsmynameart@gmail.com', 0],
  [937, 'Sandra Gonzalez', 'Salvador', 'Gonzalez', 'impautoshop@gmail.com', 0],
  [938, 'Devendra Das', 'Dayanand', 'Das', 'dayananda@sai-ma.com', 1],
  [939, 'Devendra Das', 'Sandy', 'Miller', 'scmiller713@gmail.com', 0],
  [940, 'Devendra Das', 'Chalice', 'Puzio', 'cjpuzio@gmail.com', 0],
  [942, 'Cameron Black', 'Shari', 'Flam', 'sharilflam@gmail.com', 0],
  [943, 'Devendra Das', 'Triveni', 'Das', 'trivenidas@sai-maa.com', 1],
  [944, 'Jennifer Bright', 'Kate', 'Maloney', 'katemaloneyphd@gmail.com', 0],
  [945, 'Jennifer Bright', 'Jane', 'Bright', 'janeisbright@gmail.com', 1],
  [946, 'Jennifer Bright', 'Bev', 'Wheeler', 'bwheels4u@gmail.com', 0],
  [947, 'Jim Rubin', 'Melanie', 'Riley', 'mriley@landmarkworldwide.com', 1],
  [948, 'Jennifer Bright', 'Nikki', 'Costello', 'nikkipt2@gmail.com', 1],
  [950, 'Francesca Abreu', 'Daniela', 'Azari', 'Daniela.azari@gmail.com', 0],
  [951, 'Aymie Majerski', 'Aymie Majerski', 'Susan Robertson', 'susanrobertson18@icloud.com', 0],
  [952, 'Aymie Majerski', 'Connie', 'Taylor', 'taylorconnie35@gmail.com', 0],
  [953, 'Aymie Majerski', 'Hazel', 'Ortega', 'berkeandhazel@mymanifestuniversity.com', 1],
  [954, 'Aymie Majerski', 'Tony', 'Huser', 'ahuser@blspille.com', 0],
  [955, 'Aymie Majerski', 'Katie', 'Kanaana', 'kanaana2@hotmail.com', 0],
  [956, 'Aymie Majerski', 'Alexandria', 'Palmer', 'aliykatepalmer@gmail.com', 0],
  [957, 'Cameron Cushing', 'Patrick', 'Coady', 'patrickcoady29@yahoo.ca', 1],
  [958, 'Cameron Cushing', 'Irena', 'Petrush', 'irenapetrush@gmail.com', 0],
  [959, 'Cameron Cushing', 'Jeannette', 'Quiroz', 'QuirozJeannette2009@gmail.com', 0],
  [960, 'Cameron Cushing', 'Cynthia', 'Soto', 'cask1330@aol.com', 0],
  [961, 'Cameron Cushing', 'Clara', 'Jane', 'shiningstarhc@gmail.com', 0],
  [962, 'Abby Avrunin', 'Holly', 'Malone', 'rijtown@gmail.com', 0],
  [963, 'Abby Avrunin', 'Barbara', 'Trager', 'barbaratrager@gmail.com', 0],
  [964, 'Francesca Abreu', 'Caroline', 'Resnik', 'Caroline_resnick@iCloud.com', 0],
  [965, 'Carolina Ayala', 'Laura', 'Morlett', 'morlett5@aol.com', 0],
  [966, 'Ana De La Torre', 'Nicole', 'Mungues', 'nicolemungues12@gmail.com', 0],
  [967, 'Brad Stam', 'Nick', 'Dolce', 'nickd4252@gmail.com', 0],
  [968, 'Ana De La Torre', 'Maggie', 'Del Valle', 'maggie.dvalle@gmail.com', 0],
  [969, 'Brad Stam', 'Derrek', 'Peel', 'derrekpeel@gmail.com', 1],
  [970, 'Wren LaFeet', 'Elliot', 'Katz', 'elliotkatz6@gmail.com', 0],
  [971, 'Adam Clark', 'Connie', 'Chadwick', 'conneez5@gmail.com', 0],
  [973, 'Carolina Ayala', 'Marie', 'Heinzig', 'mheinzig@cox.net', 0],
  [974, 'Ana De La Torre', 'Gabriella', 'De La Torre', 'gdelatorre24@outlook.com', 0],
  [975, 'Ana De La Torre', 'Talia', 'Atar', 'taliaatar789@gmail.com', 0],
  [976, 'Michael Ramczyk', 'David', 'Variaboff', 'dave@goldbay.com', 1],
  [977, 'Michael Ramczyk', 'David', 'Ramczyk', 'calaverasgold@aol.com', 0],
  [978, 'Michael Ramczyk', 'Sara', 'Ramczyk', 'sramczyksuy@gmail.com', 0],
  [979, 'Carolina Ayala', 'Erica', 'Ann', 'just.erica.ann@gmail.com', 0],
  [981, 'Ana De La Torre', 'Isabella', 'De La Torre', 'belladlt21@outlook.com', 0],
  [982, 'Kayla Morrissey', 'Kayla', 'Morrissey', 'kaylamorrisseyy@gmail.com', 0],
  [983, 'Acacia Blyth', 'Nina', 'Corso', 'nina@corsonet.com', 0],
  [984, 'Ana De La Torre', 'Enrique', 'De La Torre', 'rickydelatorre@yahoo.com', 1],
  [985, 'Cameron Cushing', 'Shawn', 'Wilson', 'info@shawnwilsoncoaching.com', 0],
  [986, 'Sandra Garcia', 'Todd', 'Zimmerman', 'todd@soulprints.me', 1],
  [987, 'Sandra Garcia', 'Eros', 'Eros', 'folarin.erogbogbo@gmail.com', 0],
  [988, 'Sandra Garcia', 'Eran', 'Sandhaus', 'eransandhaus@gmail.com', 1],
  [989, 'Emzi Takahashi', 'Leia', 'Takahashi', 'leiatakahashi@gmail.com', 0],
  [990, 'Isaiah Mendieta', 'Jose', 'Flores', 'meettheflores@gmail.com', 0],
  [991, 'Isaiah Mendieta', 'Jade', 'Safran', 'plantjadee@gmail.com', 0],
  [992, 'Isaiah Mendieta', 'Nancy', 'Del Carmen', 'nanadel@ymail.com', 0],
  [993, 'Isaiah Mendieta', 'Erin', 'Vasquez', 'evasqzn@gmail.com', 0],
  [994, 'Isaiah Mendieta', 'Jina', 'T', 'jinat7820@gmail.com', 0],
  [995, 'Isaiah Mendieta', 'Dominic', 'B', 'dbroesel64@gmail.com', 0],
  [996, 'Matthew Kurtyka', 'Lindsay', 'Dorio', 'lindsay@zenith-massage.com', 0],
  [997, 'Havilah Malone', 'Cathy', 'Riva', 'cathyriva1@gmail.com', 0],
  [998, 'Havilah Malone', 'Susan', 'Hemme', 'susan@hemme2500.com', 0],
  [999, 'Havilah Malone', 'Christina', 'Ledo', '1missledo@gmail.com', 0],
  [1001, 'Havilah Malone', 'Cherion', 'Drakes', 'cherion.drakes@gmail.com', 0],
  [1002, 'Julia Aguinaldo', 'David', 'Arjun', 'da@davidarjun.com', 0],
  [1003, 'Cody Edwards', 'Marya', 'Lehman', 'marylehman@gmail.com', 0],
  [1005, 'Cirilo Rolotti', 'Juan', 'Camilion', 'Camilionjuan@gmail.com', 0],
  [1006, 'Stacey Dunn', 'Kyle', 'Onsett', 'kyonstott@marketingempiregroup.com', 0],
  [1007, 'Jim Rubin', 'Dave', 'Bobrow', 'davidbobrow@cox.net', 0],
  [1008, 'Aspen Gronmark', 'Dom', 'St.Clair', 'domstclair3@gmail.com', 0],
  [1010, 'Stacey Dunn', 'John', 'Flick', 'johnflick91@gmail.com', 0],
  [1011, 'Havilah Malone', 'Marcus', 'Bellringer', 'bellringerproductions@gmail.com', 1],
  [1012, 'Havilah Malone', 'Gogo Lomo', 'David', 'gogolomodavid@gmail.com', 0],
  [1013, 'Havilah Malone', 'Drew', 'Bird', 'bird.drew@yahoo.com', 0],
  [1014, 'Ellora Hans-Price', 'Selena', 'Magram', 'selenalael@gmail.com', 1],
  [1015, 'Casey Bjorn', 'Nancy', 'Jeppesen', 'nancy@teamjepp.com', 0],
  [1016, 'Amanda Goolsby', 'Betty', 'Millington', 'bmillington28@gmail.com', 0],
  [1017, 'Amanda Goolsby', 'Sunny', 'Settles', 'sunnymarie0908@gmail.com', 0],
  [1018, 'Ed Mendieta', 'Lisa', 'Navarete', 'lilbithb@yahoo.com', 0],
  [1019, 'Ed Mendieta', 'Veronica', 'Mendieta', 'verokl46@hotmail.com', 0],
  [1020, 'Ed Mendieta', 'Rad', 'Bielicki', 'rad@coolcatdeluxe.com', 1],
  [1021, 'Casey Bjorn', 'Kelly', 'Haynes', 'kelly@teamjepp.com', 0],
  [1022, 'Cameron Cushing', 'lenny', 'Helena Cruz', 'dralennymagallanes@yahoo.com', 0],
  [1023, 'Cameron Cushing', 'Peter', 'Langelaar', 'peterlangelaar@yahoo.com', 0],
  [1024, 'Cameron Cushing', 'Rheece', 'Hartte', 'hartte@telus.net', 0],
  [1025, 'Rashika Aggarwal', 'Ellen', 'Curtis', 'ellenlcurtis@me.com', 1],
  [1026, 'Cameron Cushing', 'Trisston', 'Hartte', 'contact.trisston@gmail.com', 0],
  [1027, 'Cameron Cushing', 'Trae', 'Hartte', 'traehartte@gmail.com', 0],
  [1028, 'Cameron Cushing', 'Steven', 'Terry', 'steven.terry@heroacts.com', 1],
  [1031, 'Katie Collina', 'Kathleen', 'Cosgrove', 'Kathleen.Cosgrove@outlook.com', 0],
  [1032, 'Katie Collina', 'Hazel', 'Ortega', 'hazel@hazelortega.com', 1],
  [1033, 'Cody Edwards', 'Wellington', 'Clark', 'wheel_555@hotmail.com', 0],
  [1034, 'Suzanne Kronisch', 'Gaby', 'Sheehan', 'gabysheehan@gmail.com', 0],
  [1035, 'Kristin Renee Shaparenko', 'Andrea', 'Shaparenko', 'andreashaparenko@yahoo.com', 0],
  [1036, 'Kristin Renee Shaparenko', 'Michelle', 'Bloomquist', 'michelle@bloomquist.com', 0],
  [1037, 'Olivia Rolotti', 'Delfina', 'Saiz', 'delfisaiz@gmail.com', 0],
  [1038, 'Olivia Rolotti', 'Sofia', 'Sojo', 'sofiasojo46@gmail.com', 0],
  [1039, 'Mary Joy Menor', 'Jhoan', 'Padaca', 'jhocmanaguelod62191@gmail.com', 0],
  [1040, 'Michael Mankowski', 'Kay', 'Williams', 'kawilliams1125@gmail.com', 0],
  [1041, 'Olivia Rolotti', 'Josefina', 'Callwood', 'josefinacallwood@gmail.com', 0],
  [1042, 'Sharlene Ruiz', 'Yesenia', 'Arellanes', 'jarellanes@fatco.com', 0],
  [1043, 'Sharlene Ruiz', 'Jennifer', 'Valdez', 'jennifervaldez509@gmail.com', 0],
  [1045, 'Ellora Hans-Price', 'Michael', 'Hans-Price', 'mhansprice@gmail.com', 0],
  [1046, 'Ellora Hans-Price', 'Mitchell', 'Price', 'mprice456@gmail.com', 0],
  [1047, 'Ana De La Torre', 'Jeannie', 'Prager', 'jeanniepragerlcsw@gmail.com', 0],
  [1049, 'Michael Mankowski', 'Lauren', 'Mankowski', 'lauren.mankowski32@gmail.com', 0],
  [1050, 'Kelby Durnin', 'Caleb', 'Shonk', 'calebshonk42@gmail.com', 0],
  [1051, 'Suzanne Kronisch', 'Zoe', 'Ringham', 'zringham@gmail.com', 0],
  [1052, 'Kelby Durnin', 'Mandie', 'Morris', 'thriftymum@outlook.com', 0],
  [1055, 'Havilah Malone', 'Cynthia', 'Malone', 'cmaloneltd@aol.com', 0],
  [1056, 'Corey Yeaton', 'chris', 'Yeaton', 'cy0825@aol.com', 0],
  [1058, 'Corey Yeaton', 'steve', 'Yeaton', 'castles@kona.net', 0],
  [1060, 'Suzanne Kronisch', 'Jennifer', 'Oliver', 'ladyoliver59937@gmail.com', 0],
  [1061, 'Corey Yeaton', 'Bill', 'Munson', 'wmdmunson@gmail.com', 0],
  [1062, 'Suzanne Kronisch', 'Paulette', 'Dolin', 'pvdolin@gmail.com', 0],
  [1063, 'Corey Yeaton', 'barbara', 'Engdahl', 'babsdahl@yahoo.com', 1],
  [1064, 'Kristin Renee Shaparenko', 'Kevin', 'Bloomquist', 'ktb@bloomquist.com', 0],
  [1065, 'Kristin Renee Shaparenko', 'Julee', 'Shea', 'juleelmn@yahoo.com', 1],
  [1066, 'Curtis Poppenberg', 'Stephanie', 'Rowles', 'tootsierowles@icloud.com', 0],
  [1067, 'Carolina Ayala', 'Danielle', 'Dominguez', 'ddoming9@asu.edu', 0],
  [1068, 'Kristin Renee Shaparenko', 'Jomelie', 'Parayno', 'joeydazzle95@gmail.com', 0],
  [1069, 'Amanda Goolsby', 'Steven', 'Goolsby', 's.goolsby357@gmail.com', 0],
  [1070, 'Amanda Goolsby', 'Rocco', 'Shields', 'rocco@experiencegeniusacademy.com', 0],
  [1071, 'Ana De La Torre', 'Criselda', 'Pedro', 'lacopinblues@yahoo.com', 0],
];
