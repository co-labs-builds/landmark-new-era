/**
 * LANDMARK — EMAIL SEQUENCE TEST SENDER
 * ==================================================================
 * Adds a "Send Test" checkbox beside every email row in the sequence
 * testing sheet. Ticking it fires that email, live and fully merged,
 * to the three fixed test records — routed to the Invitation records
 * or the Registration records depending on which object the message
 * is built against.
 *
 * WHY IT WORKS THIS WAY (the one constraint that shapes everything)
 *   The Ontraport REST API has no "send this message now" endpoint.
 *   The only supported way to trigger a send against a specific
 *   record is PUT /1/objects/subscribe — add the record to an
 *   automation, and the automation sends. So each testable email
 *   needs a one-step automation wrapping it, and this script drops
 *   the test records into that automation.
 *
 *   Note the verbs: PUT objects/subscribe subscribes, DELETE on that
 *   same path unsubscribes. POST to either, or any request to an
 *   objects/unsubscribe path, returns 404.
 *
 *   That also means the merge fields resolve correctly: a Campaign
 *   on objectID 10003 merges against the invitation record, one on
 *   10001 merges against the registration record. Same mechanism the
 *   live funnels (108 / 109 / 113) already use.
 *
 * ONTRAPORT SETUP — once per email
 *   Create an automation named:   Test:<messageId>
 *   e.g.  Test:256
 *   Case and spaces are ignored, so "Test: 256" and "TEST:256" also
 *   match — but the number must be exact, so Test:25 never answers
 *   for message 256.
 *   - Object must match the message's object (Invitations for a
 *     10003 message, Registrations for a 10001 message).
 *   - Trigger: leave it manual / "Added to automation".
 *   - One step only: Send email <that message>. No delay.
 *   The script finds it by name, so there is no mapping tab to keep
 *   in sync. Use "Check setup" to see which ones are still missing.
 *
 *   If you would rather point a row at an existing automation, add an
 *   "Automation ID" column to the sheet and put the ID in it — a
 *   filled cell wins over the name lookup.
 *
 * OBJECT ROUTING — not typed by hand
 *   The script reads object_type_id straight off the message record,
 *   so a message can never be tested against the wrong record set
 *   because someone mislabelled a row.
 *     10003  Invitations   -> 1326 Kathleen Maloney
 *                             1327 Cameron Black
 *                             1328 Killian Black
 *     10001  Registrations ->  863 Kathleen Maloney
 *                             1123 Killian Black
 *                             1176 Cameron Black
 *
 * REPEAT TESTS
 *   Ontraport runs a record through an automation once. Every send
 *   therefore unsubscribes first, pauses, then subscribes — so the
 *   same row can be tested as many times as needed.
 *
 * INSTALL
 *   Extensions ▸ Apps Script ▸ paste this in ▸ Save ▸ reload the sheet.
 *   Then, from the Test Sends menu:
 *     1. Set Ontraport API credentials…
 *     2. Add Send Test buttons     (adds the checkbox + status columns)
 *     3. Turn on Send Test buttons (installs the trigger — approve the
 *        prompt; this is what lets a tick call the API)
 *     4. Check setup               (lists any missing automations)
 *
 * WHO CAN SEE THE API KEY
 *   The trigger runs as whoever installed it, so testers never handle
 *   the credentials. But anyone with edit access to this spreadsheet
 *   can open Apps Script and read the stored key. If the testing team
 *   should not have it, point CFG.API_BASE at an n8n webhook that
 *   holds the credentials instead — that is the only change needed.
 */

var CFG = {
  API_BASE:    'https://api.ontraport.com/1',
  MESSAGES:    7,          // Ontraport messages collection
  AUTOMATIONS: 140,        // Ontraport automations (campaigns)

  // objectID -> test record IDs that message type is sent against.
  RECIPIENTS: {
    10003: [1326, 1327, 1328],   // Invitations  — "Testing Group"
    10001: [863, 1123, 1176]     // Registrations — "Test Sends"
  },

  OBJECT_LABEL: {
    10003: 'Invitations',
    10001: 'Registrations'
  },

  // Tab that overrides RECIPIENTS above. Create it from the menu.
  RECIPIENT_SHEET: 'Test Recipients',

  // Notes only — used to prefill the tab so the IDs are readable.
  RECIPIENT_NAMES: {
    1326: 'Kathleen Maloney', 1327: 'Cameron Black', 1328: 'Killian Black',
    863:  'Kathleen Maloney', 1123: 'Killian Black', 1176: 'Cameron Black'
  },

  // Automation naming convention. <id> is substituted with the message ID.
  AUTOMATION_NAME: 'Test:<id>',

  RESUB_PAUSE_MS: 1500,    // let the unsubscribe settle before re-adding
  ROW_PAUSE_MS:   400,     // between rows when several are ticked at once
  CACHE_SECS:     21600    // 6h — message object type / automation lookups
};

/**
 * Header names this script looks for in row 1, lower-cased. First match
 * wins, so the sheet can use any of these spellings.
 */
var HDR = {
  MSG:    ['message id', 'msg id', 'message', 'ontraport id', 'msg'],
  SEND:   ['send test'],
  STATUS: ['last test'],
  AUTO:   ['automation id']
};

/* ====================================================================== */
/*  MENU                                                                   */
/* ====================================================================== */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Test Sends')
    .addItem('Send test for selected row(s)', 'sendTestForSelection')
    .addSeparator()
    .addItem('Add Send Test buttons', 'addButtons')
    .addItem('Turn on Send Test buttons', 'installButtonTrigger')
    .addItem('Turn off Send Test buttons', 'removeButtonTrigger')
    .addItem('Set up Test Recipients tab', 'addRecipientsTab')
    .addSeparator()
    .addItem('Check setup', 'checkSetup')
    .addItem('Set Ontraport API credentials…', 'setCredentials')
    .addItem('Clear lookup cache', 'clearCache')
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
  ui.alert('Saved. Run Test Sends ▸ Check setup to confirm.');
}

function hasCreds_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('ONTRAPORT_APP_ID') && p.getProperty('ONTRAPORT_API_KEY'));
}

function clearCache() {
  var keys = cachedKeys_();
  if (keys.length) CacheService.getScriptCache().removeAll(keys);
  PropertiesService.getScriptProperties().deleteProperty('TEST_CACHE_KEYS');
  SpreadsheetApp.getActive().toast('Lookup cache cleared.', 'Test Sends', 5);
}

/* ====================================================================== */
/*  SHEET WIRING                                                           */
/* ====================================================================== */

/**
 * Locates the columns this script needs by header name. Returns 1-based
 * column numbers; a missing optional column comes back as 0.
 */
function columns_(sheet) {
  var width = sheet.getLastColumn();
  if (width < 1) return { msg: 0, send: 0, status: 0, auto: 0 };

  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var find = function (names) {
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim().toLowerCase();
      if (!h) continue;
      for (var n = 0; n < names.length; n++) {
        if (h === names[n]) return c + 1;
      }
    }
    return 0;
  };
  return {
    msg:    find(HDR.MSG),
    send:   find(HDR.SEND),
    status: find(HDR.STATUS),
    auto:   find(HDR.AUTO)
  };
}

/**
 * Appends the "Send Test" and "Last Test" columns to the active sheet and
 * drops a checkbox on every row that carries a message ID.
 */
function addButtons() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var cols  = columns_(sheet);

  if (!cols.msg) {
    SpreadsheetApp.getUi().alert(
      'No message ID column found on "' + sheet.getName() + '".\n\n' +
      'Row 1 needs a header called one of: ' + HDR.MSG.join(', ') + '.');
    return;
  }

  if (!cols.send) {
    cols.send = sheet.getLastColumn() + 1;
    sheet.getRange(1, cols.send).setValue('Send Test');
  }
  if (!cols.status) {
    cols.status = sheet.getLastColumn() + 1;
    sheet.getRange(1, cols.status).setValue('Last Test');
  }

  var lastRow = sheet.getLastRow();
  ensureCheckboxes_(sheet, 2, lastRow - 1, cols);

  var placed = 0;
  for (var r = 2; r <= lastRow; r++) {
    if (String(sheet.getRange(r, cols.msg).getValue() || '').trim()) placed++;
  }

  sheet.getRange(1, cols.send).setFontWeight('bold');
  sheet.getRange(1, cols.status).setFontWeight('bold');
  sheet.setColumnWidth(cols.send, 90);
  sheet.setColumnWidth(cols.status, 190);

  SpreadsheetApp.getActive().toast(
    placed + ' Send Test buttons placed. Turn them on from the menu if you ' +
    'have not already.', 'Test Sends', 8);
}

function installButtonTrigger() {
  removeButtonTrigger();
  ScriptApp.newTrigger('onTestCheckboxEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  SpreadsheetApp.getActive().toast(
    'Send Test buttons are live. They run as you, so testers never need ' +
    'the API key.', 'Test Sends', 8);
}

function removeButtonTrigger() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'onTestCheckboxEdit') {
      ScriptApp.deleteTrigger(all[i]);
    }
  }
}

/* ====================================================================== */
/*  TRIGGER                                                                */
/* ====================================================================== */

/**
 * Installable onEdit handler. A simple onEdit cannot be used here: simple
 * triggers run without authorisation and UrlFetchApp is unavailable to them.
 */
function onTestCheckboxEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (sheet.getName() === CFG.RECIPIENT_SHEET) return;

  var cols = columns_(sheet);
  if (!cols.send || !cols.msg) return;

  // A message ID typed into a new row gets its own button, so adding an
  // email to the sheet needs no menu run and no code change.
  if (e.range.getColumn() === cols.msg) {
    ensureCheckboxes_(sheet, e.range.getRow(), e.range.getNumRows(), cols);
    return;
  }

  if (e.range.getColumn() !== cols.send) return;
  // e.value is undefined for multi-cell edits, which still need checking.
  if (e.value && e.value !== 'TRUE') return;

  // A tick is one cell, but a paste or fill can set several at once.
  var rows   = [];
  var values = e.range.getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === true) rows.push(e.range.getRow() + i);
  }
  rows = rows.filter(function (r) { return r > 1; });
  if (!rows.length) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getActive().toast(
      'Another test send is already running — try again in a moment.',
      'Test Sends', 8);
    return;
  }
  try {
    sendTestForRows_(sheet, rows, cols);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gives every row in the span a checkbox if it carries a message ID, and
 * takes it away if it does not — so blank spacer and heading rows stay
 * clean. Shared by the trigger and by "Add Send Test buttons".
 */
function ensureCheckboxes_(sheet, startRow, numRows, cols) {
  for (var r = startRow; r < startRow + numRows; r++) {
    if (r < 2) continue;
    var hasId = !!String(sheet.getRange(r, cols.msg).getValue() || '').trim();
    var cell  = sheet.getRange(r, cols.send);
    var isBox = cell.getDataValidation() !== null;

    if (hasId && !isBox) {
      cell.insertCheckboxes();
      cell.setValue(false);
    } else if (!hasId && isBox) {
      cell.clearDataValidations().clearContent();
    }
  }
}

function sendTestForSelection() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var cols  = columns_(sheet);
  if (!cols.msg) {
    SpreadsheetApp.getUi().alert('No message ID column found on this sheet.');
    return;
  }
  var sel  = sheet.getActiveRange();
  var rows = [];
  for (var r = sel.getRow(); r < sel.getRow() + sel.getNumRows(); r++) {
    if (r > 1) rows.push(r);
  }
  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Select one or more email rows first.');
    return;
  }
  sendTestForRows_(sheet, rows, cols);
}

/* ====================================================================== */
/*  SEND                                                                   */
/* ====================================================================== */

function sendTestForRows_(sheet, rows, cols) {
  var ss = SpreadsheetApp.getActive();

  if (!hasCreds_()) {
    untick_(sheet, rows, cols);
    stampAll_(sheet, rows, cols, 'No API credentials set');
    ss.toast('Set Ontraport API credentials from the Test Sends menu first.',
             'Test Sends', 10);
    return;
  }

  var sent = 0, failed = 0, lastNote = '';

  for (var i = 0; i < rows.length; i++) {
    var row   = rows[i];
    var msgId = String(sheet.getRange(row, cols.msg).getValue() || '').trim();
    var note;

    if (!msgId) {
      note = 'No message ID on this row';
      failed++;
    } else {
      try {
        var override = cols.auto
          ? String(sheet.getRange(row, cols.auto).getValue() || '').trim()
          : '';
        var result = sendOne_(msgId, override);
        note = '✓ ' + result.count + ' × ' + result.label + ' · ' + now_();
        sent++;
      } catch (err) {
        note = '✗ ' + err.message;
        failed++;
      }
    }

    lastNote = note;
    stamp_(sheet, row, cols, note);
    if (i < rows.length - 1) Utilities.sleep(CFG.ROW_PAUSE_MS);
  }

  untick_(sheet, rows, cols);

  var summary = rows.length === 1
    ? lastNote
    : sent + ' sent, ' + failed + ' failed';
  ss.toast(summary, 'Test Sends', failed ? 15 : 8);
}

/**
 * Fires one message at its matching test records.
 * Returns { count, label } on success; throws with a readable reason.
 */
function sendOne_(msgId, automationOverride) {
  var objectTypeId = messageObjectType_(msgId);

  var recipients = recipientsFor_(objectTypeId);
  if (!recipients || !recipients.length) {
    throw new Error(
      'message ' + msgId + ' is built on object ' + objectTypeId +
      ', which has no test records defined');
  }

  var automationId;
  if (automationOverride) {
    automationId = automationOverride;
  } else {
    var found = findAutomation_(msgId);
    if (!found) {
      throw new Error(
        'no automation named "' + automationName_(msgId) + '" in Ontraport');
    }
    // An automation built on the wrong object would take the subscribe call
    // and then merge against nothing. Catch it here rather than let it send.
    if (found.obj && found.obj !== String(objectTypeId)) {
      throw new Error(
        'automation "' + automationName_(msgId) + '" is on object ' +
        (CFG.OBJECT_LABEL[found.obj] || found.obj) + ' but message ' + msgId +
        ' is on ' + (CFG.OBJECT_LABEL[objectTypeId] || objectTypeId));
    }
    automationId = found.id;
  }

  var ids = recipients.join(',');

  // Subscribe and unsubscribe are the SAME path, separated by verb:
  // PUT objects/subscribe adds, DELETE objects/subscribe removes.
  // There is no objects/unsubscribe route — asking for one returns 404.

  // Ontraport runs a record through an automation once, so clear it first.
  // On a first-ever test the records are not in the automation at all and
  // this can come back non-2xx — that is a no-op, not a failure, so it must
  // not stop the send.
  try {
    api_('DELETE', '/objects/subscribe?' + qs_({
      objectID:    objectTypeId,
      ids:         ids,
      remove_list: automationId,
      sub_type:    'Campaign'
    }));
    Utilities.sleep(CFG.RESUB_PAUSE_MS);
  } catch (err) {
    if (/rate limited|credentials rejected/.test(err.message)) throw err;
  }

  api_('PUT', '/objects/subscribe', {
    objectID:  Number(objectTypeId),
    ids:       ids,
    add_list:  String(automationId),
    sub_type:  'Campaign'
  });

  return {
    count: recipients.length,
    label: CFG.OBJECT_LABEL[objectTypeId] || ('object ' + objectTypeId)
  };
}

/* ====================================================================== */
/*  ONTRAPORT LOOKUPS                                                      */
/* ====================================================================== */

/**
 * The object a message is built against, read off the message record.
 * This is what decides Invitation IDs vs Registration IDs — never a
 * value typed into the sheet.
 */
function messageObjectType_(msgId) {
  var key    = 'objtype_' + msgId;
  var cached = CacheService.getScriptCache().get(key);
  if (cached) return cached;

  var res = api_('GET', '/object?objectID=' + CFG.MESSAGES + '&id=' +
                 encodeURIComponent(msgId));
  var data = res.data;
  if (!data || !data.id) throw new Error('message ' + msgId + ' not found');

  var objectTypeId = String(data.object_type_id || '').trim();
  if (!objectTypeId) {
    throw new Error('message ' + msgId + ' has no object set on it');
  }
  putCache_(key, objectTypeId);
  return objectTypeId;
}

function automationName_(msgId) {
  return CFG.AUTOMATION_NAME.replace('<id>', msgId);
}

/**
 * Case- and space-insensitive form of an automation name, so "Test:256",
 * "Test: 256" and "TEST:256" are one key. Nothing else is stripped — the
 * digits still have to match exactly.
 */
function normName_(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Finds the Test: automation for a message.
 * Returns { id, obj } or null if there is no match.
 *
 * This pages the whole automation list rather than using the API's search
 * param. "Test:256" is a bare prefix plus a number, and a fuzzy search hit
 * on "Test:25" answering for message 256 would send the wrong email under
 * a green tick. Whole-name match, or nothing.
 *
 * A miss retries once against a fresh list before giving up. The cached
 * list lives for six hours, so without this an automation created since
 * the last lookup reads as "does not exist" — which is exactly what it
 * looks like from the sheet, and is not something a tester can diagnose.
 */
function findAutomation_(msgId) {
  var wanted = normName_(automationName_(msgId));
  var hit    = automationMap_()[wanted];
  if (!hit) hit = automationMap_(true)[wanted];
  return hit || null;
}

/**
 * normalised name -> { id, obj } for every automation on the account.
 *
 * The cache key carries a version. Changing what goes into this map — the
 * key casing, the value shape — while leaving the key alone means the old
 * format is read back as if it were the new one, and every lookup silently
 * misses until the cache ages out. Bump the version on any format change.
 */
function automationMap_(forceRefresh) {
  var key = 'automap_v2';
  if (!forceRefresh) {
    var cached = CacheService.getScriptCache().get(key);
    if (cached) {
      try { return JSON.parse(cached); } catch (err) { /* refetch below */ }
    }
  }

  var map = {}, start = 0, page = 0;
  while (page++ < 20) {                       // runaway guard
    var res = api_('GET', '/objects?objectID=' + CFG.AUTOMATIONS +
                   '&range=50&start=' + start + '&sort=id&sortDir=asc' +
                   '&listFields=' + encodeURIComponent('id,name,object_type_id'));
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) {
      var name = normName_(rows[i].name);
      if (name) {
        map[name] = {
          id:  String(rows[i].id),
          obj: String(rows[i].object_type_id || '')
        };
      }
    }
    if (rows.length < 50) break;
    start += 50;
  }

  putCache_(key, JSON.stringify(map));
  return map;
}

/* ====================================================================== */
/*  SETUP CHECK                                                            */
/* ====================================================================== */

/**
 * Walks every row with a message ID and reports what is not ready:
 * missing automations, unknown messages, messages on an object with no
 * test records. Cheaper than discovering it mid-test-run.
 */
function checkSetup() {
  var ui = SpreadsheetApp.getUi();
  if (!hasCreds_()) {
    ui.alert('No Ontraport API credentials set.');
    return;
  }

  var sheet = SpreadsheetApp.getActiveSheet();
  var cols  = columns_(sheet);
  if (!cols.msg) {
    ui.alert('No message ID column found on "' + sheet.getName() + '".');
    return;
  }

  var lastRow = sheet.getLastRow();
  var ready = [], problems = [];

  for (var r = 2; r <= lastRow; r++) {
    var msgId = String(sheet.getRange(r, cols.msg).getValue() || '').trim();
    if (!msgId) continue;

    try {
      var objectTypeId = messageObjectType_(msgId);
      var label = CFG.OBJECT_LABEL[objectTypeId] || ('object ' + objectTypeId);

      var recipients = recipientsFor_(objectTypeId);
      if (!recipients || !recipients.length) {
        problems.push('row ' + r + ' · msg ' + msgId +
                      ' — on ' + label + ', no test records defined');
        continue;
      }
      var override = cols.auto
        ? String(sheet.getRange(r, cols.auto).getValue() || '').trim()
        : '';
      var automationId = override;
      if (!automationId) {
        var found = findAutomation_(msgId);
        if (!found) {
          problems.push('row ' + r + ' · msg ' + msgId + ' (' + label +
                        ') — missing automation "' + automationName_(msgId) + '"');
          continue;
        }
        if (found.obj && found.obj !== String(objectTypeId)) {
          problems.push('row ' + r + ' · msg ' + msgId + ' — automation "' +
                        automationName_(msgId) + '" is on ' +
                        (CFG.OBJECT_LABEL[found.obj] || found.obj) +
                        ' but the message is on ' + label);
          continue;
        }
        automationId = found.id;
      }
      ready.push('msg ' + msgId + ' → ' + label + ' via automation ' + automationId);
    } catch (err) {
      problems.push('row ' + r + ' · msg ' + msgId + ' — ' + err.message);
    }
  }

  var out = ready.length + ' row(s) ready to test.\n';
  if (problems.length) {
    out += '\n' + problems.length + ' need attention:\n\n' +
           problems.join('\n');
  } else {
    out += '\nNothing missing.';
  }
  ui.alert('Test Sends — setup', out, ui.ButtonSet.OK);
}

/* ====================================================================== */
/*  HTTP                                                                   */
/* ====================================================================== */

function api_(method, path, payload) {
  var p = PropertiesService.getScriptProperties();
  var opts = {
    method: method.toLowerCase(),
    headers: {
      'Api-Appid': p.getProperty('ONTRAPORT_APP_ID'),
      'Api-Key':   p.getProperty('ONTRAPORT_API_KEY'),
      'Accept':    'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload     = JSON.stringify(payload);
  }

  var resp = UrlFetchApp.fetch(CFG.API_BASE + path, opts);
  var code = resp.getResponseCode();
  var body = resp.getContentText();

  // This account is 360 req/min and 429s fail outright — they do not queue.
  if (code === 429) throw new Error('rate limited (429) — wait a moment and retry');
  if (code === 401 || code === 403) throw new Error('API credentials rejected (' + code + ')');
  if (code === 404) throw new Error('not found (404)');
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ' ' + body.slice(0, 140));
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error('unreadable response: ' + body.slice(0, 140));
  }
}

/* ====================================================================== */
/*  SMALL HELPERS                                                          */
/* ====================================================================== */

/* ====================================================================== */
/*  TEST RECIPIENTS                                                        */
/* ====================================================================== */

/**
 * Record IDs to send at, for a given object.
 *
 * Read from the "Test Recipients" tab if it exists, so swapping a tester
 * is a sheet edit rather than a code edit. Falls back to CFG.RECIPIENTS
 * when the tab is absent.
 */
function recipientsFor_(objectTypeId) {
  return recipientTable_()[String(objectTypeId)] || null;
}

function recipientTable_() {
  // Memoised for the life of one execution so a multi-row send reads the
  // tab once rather than once per row.
  if (recipientTable_._memo) return recipientTable_._memo;

  var sheet = SpreadsheetApp.getActive().getSheetByName(CFG.RECIPIENT_SHEET);
  var table = null;

  if (sheet && sheet.getLastRow() > 1) {
    var found = {}, any = false;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      var obj = objectIdFromLabel_(rows[i][0]);
      var id  = String(rows[i][1] || '').trim();
      if (!obj || !id) continue;
      if (!found[obj]) found[obj] = [];
      found[obj].push(id);
      any = true;
    }
    // A tab that exists but parses to nothing must not read as "send to
    // no one" — that would look like a silent success. Fall back instead.
    if (any) table = found;
  }

  if (!table) {
    table = {};
    for (var o in CFG.RECIPIENTS) {
      if (CFG.RECIPIENTS.hasOwnProperty(o)) table[o] = CFG.RECIPIENTS[o].slice();
    }
  }

  recipientTable_._memo = table;
  return table;
}

/** Accepts "Invitations", "invitations" or a raw object ID. */
function objectIdFromLabel_(value) {
  var s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  for (var id in CFG.OBJECT_LABEL) {
    if (CFG.OBJECT_LABEL.hasOwnProperty(id) &&
        CFG.OBJECT_LABEL[id].toLowerCase() === s) return id;
  }
  return '';
}

/** Creates the Test Recipients tab, prefilled with the current defaults. */
function addRecipientsTab() {
  var ss    = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CFG.RECIPIENT_SHEET);
  if (sheet) {
    ss.setActiveSheet(sheet);
    ss.toast('The Test Recipients tab already exists.', 'Test Sends', 6);
    return;
  }

  sheet = ss.insertSheet(CFG.RECIPIENT_SHEET);
  var rows = [['Object', 'Record ID', 'Who']];
  for (var obj in CFG.RECIPIENTS) {
    if (!CFG.RECIPIENTS.hasOwnProperty(obj)) continue;
    var ids = CFG.RECIPIENTS[obj];
    for (var i = 0; i < ids.length; i++) {
      rows.push([CFG.OBJECT_LABEL[obj] || obj, ids[i],
                 CFG.RECIPIENT_NAMES[ids[i]] || '']);
    }
  }
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 200);
  sheet.getRange(rows.length + 2, 1).setValue(
    'Add or remove rows here to change who test sends go to. ' +
    'Object must read Invitations or Registrations. ' +
    'The "Who" column is a note for humans and is not used by the script.');

  ss.toast('Test Recipients tab created. Edit it here from now on — no ' +
           'code changes needed.', 'Test Sends', 10);
}

/**
 * Query string for the endpoints that take their params in the URL.
 * Ontraport reads GET and DELETE params from the query string, not a body.
 */
function qs_(params) {
  var parts = [];
  for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  }
  return parts.join('&');
}

function now_() {
  return Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'M/d HH:mm');
}

function stamp_(sheet, row, cols, note) {
  if (!cols.status) return;
  sheet.getRange(row, cols.status).setValue(note);
}

function stampAll_(sheet, rows, cols, note) {
  for (var i = 0; i < rows.length; i++) stamp_(sheet, rows[i], cols, note);
}

function untick_(sheet, rows, cols) {
  if (!cols.send) return;          // menu path on a sheet with no checkboxes
  for (var i = 0; i < rows.length; i++) {
    sheet.getRange(rows[i], cols.send).setValue(false);
  }
  SpreadsheetApp.flush();
}

/**
 * CacheService has no "list keys", so the keys we set are tracked in a
 * script property. Without this, "Clear lookup cache" could not reach them
 * and a renamed automation would stay stale for six hours.
 */
function putCache_(key, value) {
  CacheService.getScriptCache().put(key, value, CFG.CACHE_SECS);
  var p    = PropertiesService.getScriptProperties();
  var keys = cachedKeys_();
  if (keys.indexOf(key) === -1) {
    keys.push(key);
    p.setProperty('TEST_CACHE_KEYS', JSON.stringify(keys));
  }
}

function cachedKeys_() {
  var raw = PropertiesService.getScriptProperties()
    .getProperty('TEST_CACHE_KEYS');
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch (err) { return []; }
}
