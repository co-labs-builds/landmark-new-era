/* ------------------------------------------------------------------
   Prototype interaction only — no data layer, no server. Single logged-
   in-user page: there is no client-side role switch (see field
   dictionary for how access/Revenue gating actually gets enforced in
   production). This script simulates the client-visible half of brief
   §9 (inline edit → saving → success/error, rollback/retry) and §8
   (material release confirm / re-hide / re-show), plus the Event
   Management card list search/pagination, the attendance-override flow,
   the SE reason popup, and the Spouse/Participant person comboboxes.
   ------------------------------------------------------------------ */

/* DASHBOARD_DATA — real Ontraport merge-field syntax, same Page//
   convention proven in member-portal.html. This page's own bound
   object is the CS's oEventTeam (10007) record (Contact+Event
   junction, one record per CS-per-event) — matches this pilot's
   "one authorized Event" scope and the Home card loop's real source
   (oEventTeam, §2). ROLE_MAP/FORMAT_MAP exist because Ontraport
   dropdown fields return the raw option ID via the API, never label
   text (confirmed project-wide gotcha — see member-portal.html).
   Fields that need a live aggregate query (roster count, Not Ready
   count, Event Leader name — a DIFFERENT oEventTeam record than the
   CS's own) are NOT resolvable via merge tag and are left null here,
   to be filled by dashboardFetchBootstrap() once the n8n webhook
   exists (see n8n-dashboard-bootstrap-webhook-spec.md). */
var ROLE_MAP = { '306':'Course Supervisor', '478':'Event Leader' };
var FORMAT_MAP = { '124':'Hybrid', '125':'In Person', '126':'Online' };
var DAY_MAP = { '404':'Day 1 of 3', '405':'Day 2 of 3', '406':'Day 3 of 3', '456':'Graduation' };
var SHORT_DAY_MAP = { '404':'Day 1', '405':'Day 2', '406':'Day 3', '456':'Graduation' };

function dashboardCsRole(){ return ROLE_MAP[DASHBOARD_DATA.csRoleRaw] || DASHBOARD_DATA.csRoleRaw; }
function dashboardEventFormat(){ return FORMAT_MAP[DASHBOARD_DATA.eventFormatRaw] || DASHBOARD_DATA.eventFormatRaw; }
function dashboardTodaysSession(){ return DAY_MAP[DASHBOARD_DATA.todaysSessionRaw] || DASHBOARD_DATA.todaysSessionRaw; }
function dashboardTodaysSessionShort(){ return SHORT_DAY_MAP[DASHBOARD_DATA.todaysSessionRaw] || DASHBOARD_DATA.todaysSessionRaw; }

/* dashboardFetchBootstrap() — calls the n8n webhook (see
   n8n-dashboard-bootstrap-webhook-spec.md) scoped to this CS's
   oEventTeam record, returns participant/not-ready counts, Event
   Leader name, and course name. v1 (this call) covers Home only —
   the Roster/Guests/Master Stats extensions in the spec's "Planned
   extensions" section are separate future work. On failure the
   dependent DOM nodes keep showing '—' (dashboardRenderHome's
   existing null fallback) rather than a fabricated number. */
var DASHBOARD_BOOTSTRAP_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-bootstrap';
function dashboardFetchBootstrap(){
  fetch(DASHBOARD_BOOTSTRAP_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    DASHBOARD_DATA.participantCount = r.result.participantCount;
    DASHBOARD_DATA.notReadyCount = r.result.notReadyCount;
    DASHBOARD_DATA.eventLeaderName = r.result.eventLeaderName;
    DASHBOARD_DATA.courseName = r.result.courseName;
    if(r.result.eventId != null) DASHBOARD_DATA.eventId = r.result.eventId;
    dashboardApplyToggleState(r.result.materials, r.result.announcements);
    dashboardRenderHome();
    dashboardRevealEventCard();
    dashboardInitRealtime();
  }).catch(function(err){
    console.error('dashboardFetchBootstrap failed:', err);
    dashboardRevealEventCard();
  });
}
/* dashboardRevealEventCard() — swaps #homeLoadingState for the real
   #evtCard once Bootstrap settles, success or failure alike (a failed
   fetch still reveals the card rather than leaving the loader spinning
   forever -- title/dates already resolved via merge tag either way,
   only the participant counts fall back to their existing "—" display). */
function dashboardRevealEventCard(){
  var loading = document.getElementById('homeLoadingState');
  var card = document.getElementById('evtCard');
  if(loading) loading.style.display = 'none';
  if(card) card.style.display = '';
}

/* dashboardApplyToggleState() — added 2026-08-12: Materials/Announcements
   toggles previously showed whatever "on" class happened to be hardcoded
   in the static prototype markup, regardless of real Ontraport state
   (confirmed bug — the write side was real, but nothing ever set the
   initial on/off state from a real read). Bootstrap now additively
   returns materials/announcements (see Compute Bootstrap Response on
   CS Dashboard : Bootstrap), keyed the same way as data-key, lowercased
   to dodge the known AC-open/ac-open casing mismatch already handled
   elsewhere this session. Every real toggle gets its class set from
   this on page load — no more static demo default. */
function dashboardApplyToggleState(materials, announcements){
  document.querySelectorAll('.tog[data-toggle="materials"], .tog[data-toggle="announcements"]').forEach(function(btn){
    var key = String(btn.dataset.key || '').toLowerCase();
    if(!key) return;
    var source = btn.dataset.toggle === 'materials' ? materials : announcements;
    if(!source) return;
    var on = false;
    for(var k in source){ if(k.toLowerCase() === key){ on = !!source[k]; break; } }
    if(on){ btn.classList.add('on'); } else { btn.classList.remove('on'); }
  });
}

/* ---------- Roster & Classification — real data render (CS Dashboard
   build, 2026-08-12). dashboardFetchRoster() calls the dashboard-roster
   webhook (see n8n-dashboard-bootstrap-webhook-spec.md's "Planned
   extensions") and dashboardRenderRoster() replaces the prototype's 12
   hardcoded fixture .ev-card rows with real ones built from the field
   rules locked in the CS Dashboard discovery memory. Classification
   pills (MNR/REV/SE) and the Seminar/AC follow-on ladder reuse the
   prototype's existing render helpers (updateProgramPills/
   applyFollowOnLadder/syncNpFlag) — this function only needs to set the
   right data attributes and initial classes, not reimplement that
   state machine. Attendance ticks have no existing helper (see tk-ldp
   CSS addition above) so the day/LDP/pending/absent logic is computed
   here directly. ---------- */
var DASHBOARD_ROSTER_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-roster';
var ROSTER_LOCALE_ABBR = { 'Hybrid':'HYB', 'In Person':'IP', 'Online':'ONL' };
var ROSTER_SE_REASON_MAP = { '420':'LEI Scholarship [India only]', '421':'Resides in China', '422':'Resides in Iran', '423':'Panda Restaurant Group employee', '424':'Banking unavailable in country', '425':'Under 18', '426':'Deaf/Hard of Hearing' };
var ROSTER_SEM_NP_REASON_MAP = { '372':'Other', '373':'Already Registered', '374':'Reviewer', '375':'Minor' };
var ROSTER_AC_NP_REASON_MAP = { '383':'Other', '384':'Reviewer', '385':'Already Registered for AC', '386':'Already Took AC', '387':'Minor' };
var ROSTER_LEFT_TYPE_MAP = { '427':'LDP 2 — Sleep or transient type (WBO)(Refund)', '428':'LDP 1 — Left course no communication (No Refund)', '453':'LDP 5 — Request transfer to future course (No refund)', '454':'LDP 4 — May not participate until leader states (Refund)(WBO)', '455':'LDP 3 — Customer Service (Refund)' };
var ROSTER_LEFT_DAY_TO_NUM = { '431':1, '430':2, '429':3 };
var ROSTER_WBO_REASON_MAP = { '432':'Other (not WBO)', '433':'Program Leader has a health concern and is unwilling for the person to continue', '434':'Said they are thinking of ending their own life / have attempted / thinking of harming self or another', '435':'Insufficient sleep in the days preceding or while taking the program (incl. between last day and the evening session)', '436':'Suffered a serious long-term health problem during the program (e.g., epileptic seizures, heart problems, spinal problems making it impossible to sit)', '437':'Now see they should heed the Health Warnings in their Program Information Form', '438':'Informed us they do not think they can "handle" what they are experiencing' };
var ROSTER_WBO_TRIGGER_TYPES = ['427','454'];
var ROSTER_MATCH_METHOD_MAP = { '311':'Manual', '312':'Email', '313':'Zoom Registrant ID' };
var ROSTER_PREFERRED_COMM_MAP = { '398':'Both', '399':'Email', '400':'Call' };
var ROSTER_DAY_OPTION_ORDER = ['404','405','406','456'];

function rosterEscAttr(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
function rosterEscHtml(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function rosterIsTrue(v){ return v === '1' || v === 1 || v === true; }

/* ---------- Registration Status (f2424) ----------
   One state matters to the dashboard: Withdraw.

   Cancelled (option 153) is NOT modelled. It exists on the field but is verified unused —
   zero registrations carry it account-wide (queried 2026-08-15, not sampled), no dashboard
   action writes it, and no workflow reads it. Modelling a state nothing ever sets buys a
   dead branch and a badge that can never be seen or tested. If it starts being used, add it
   beside WITHDRAWN below; do not revive the old "anything that isn't literally Active counts
   as cancelled" logic, which flagged the majority of a real roster as cancelled.

   Blank/unset reads as active. That is no longer the common case — as of 2026-08-15 every
   one of event 218's 134 registrations carries an explicit 154 Active, where an earlier
   snapshot found 93 blank, so the field has since been backfilled. The blank-tolerant
   reading is kept anyway: it costs nothing, and it is the behaviour that stops a
   newly-created registration (written before whatever step sets 154) from being treated as
   not participating. Only an explicit option ID means anything.

   The Withdraw option was created 2026-08-15 and its ID read from live field metadata, not
   assumed: f2424 now reports `153=Cancelled, 154=Active, 491=Withdraw`. */
var ROSTER_REG_ACTIVE = '154';
var ROSTER_REG_WITHDRAWN = '491';

/* rosterIsWithdrawn() — the specific Withdraw option. Drives the WITHDRAWN badge and the WBS
   tile, both of which are about that one state. */
function rosterIsWithdrawn(reg){ return !!ROSTER_REG_WITHDRAWN && String((reg && reg.f2424) || '') === ROSTER_REG_WITHDRAWN; }

/* rosterIsInactive() — "this registration is not active", whatever the reason. Deliberately
   written as "explicitly set to something that isn't Active" rather than as a list of known
   inactive options. Two reasons:

     1. It is the rule the client actually stated — a record whose status is not active gets
        batched out of the working roster — so encoding the rule beats encoding today's
        option list and having to revisit it whenever an option is added.
     2. It closes the gap left by dropping Cancelled. 153 is slated for deletion but is
        selectable until then, and with no handling of its own a CS who picked it would get a
        fully active-looking participant. Under this predicate they are inactive instead,
        which is the safe direction to be wrong in.

   UNSET stays ACTIVE. That is the state a registration is created in before whatever step
   writes 154, and treating unset as inactive would hide brand-new registrations from the
   roster — the exact failure the old "anything that isn't literally Active is cancelled"
   logic caused.

   Unset on this field is the STRING "0", not null and not empty — verified 2026-08-15
   against the 5 records account-wide that carry it (Ontraport's own IS EMPTY check matches
   them, and they read back as "0"). This is not a detail to infer: an earlier version of
   this predicate tested only for '' and so classified every unset registration as inactive,
   which would have hidden them from the roster and dropped them from every metric. Both
   sentinels are treated as unset. */
var ROSTER_REG_UNSET = ['', '0'];
function rosterIsInactive(reg){
  var s = String((reg && reg.f2424) == null ? '' : (reg && reg.f2424)).trim();
  if(ROSTER_REG_UNSET.indexOf(s) !== -1) return false;
  return s !== ROSTER_REG_ACTIVE;
}
function rosterSplitActive(rows){
  var active = [], inactive = [];
  (rows || []).forEach(function(r){ (rosterIsInactive(r) ? inactive : active).push(r); });
  return { active: active, inactive: inactive };
}

/* Test registrations (registrations.f2878) are excluded everywhere, not merely hidden:
   dropped from the roster array the moment Roster Fetch resolves, before a single card is
   built or a single tile is computed. Everything downstream — the cards, all 14 snapshot
   tiles, the queue/PIQ derivation, sort, search, pagination, and the live-patch handler
   (which only ever looks up a registration inside dashboardLastRoster) — reads that same
   filtered array, so a test record cannot reach any of them.

   Filtering here rather than only server-side is deliberate belt-and-braces: if the Roster
   Fetch webhook is later changed, or an older version is still deployed, the dashboard is
   still correct on its own. The reverse is also true and still worth doing — see the
   webhook note in dashboardFetchRoster(). If f2878 is absent from the payload this reads
   undefined and excludes nothing, which is the safe direction to fail. */
function rosterIsTestRegistration(reg){ return rosterIsTrue(reg && reg.f2878); }
function rosterExcludeTestRegistrations(rows){
  if(!rows || !rows.length) return rows || [];
  var kept = rows.filter(function(r){ return !rosterIsTestRegistration(r); });
  var dropped = rows.length - kept.length;
  if(dropped > 0) console.info('dashboard: excluded ' + dropped + ' test registration(s) (f2878) from the roster');
  return kept;
}

// rosterListLabels() — decodes an Ontraport `list`-type field, which is NOT a
// bare option ID the way a `drop` field is. Values arrive wrapped and joined
// by a */* delimiter: a single selection reads as */*398*/* and a multi-select
// as */*399*/*400*/*. Both confirmed live against registration 1164 on
// 2026-08-13, not inferred. (Line comments deliberately — the delimiter
// contains */ and would close a block comment early.)
// Returns '' for empty/unset, including the documented "0" blank sentinel, so
// callers render their own em dash rather than this asserting a value.
// Unrecognised IDs are dropped rather than printed raw.
function rosterListLabels(v, map){
  if(v === undefined || v === null) return '';
  var raw = String(v).trim();
  if(raw === '' || raw === '0') return '';
  var out = [];
  var parts = raw.split('*/*');
  for(var i = 0; i < parts.length; i++){
    var id = parts[i].trim();
    if(id && map[id] && out.indexOf(map[id]) === -1) out.push(map[id]);
  }
  return out.join(', ');
}
function rosterDayOptionIndex(raw){ var i = ROSTER_DAY_OPTION_ORDER.indexOf(String(raw)); return i === -1 ? 0 : i; }
function rosterFmtEpochTime(sec){
  var n = Number(sec || 0);
  if(!n) return '—';
  var d = new Date(n * 1000);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
}
function rosterFmtMinutes(m){ var n = Number(m || 0); return n > 0 ? n.toFixed(1) : '0'; }
/* Human duration, not a minute count. "204" is a number a CS has to do arithmetic on to
   understand; "3h 24m" is a length of time they already know how to read. Used wherever a
   presence duration is shown to a person — the raw minutes stay available in the same
   popover for anyone reconciling against Zoom's own figures. */
function rosterFmtDuration(mins){
  var n = Math.round(Number(mins || 0));
  if(!(n > 0)) return '—';
  var h = Math.floor(n / 60), m = n % 60;
  if(!h) return m + 'm';
  return m ? (h + 'h ' + m + 'm') : (h + 'h');
}

/* Per-day session fields. The 12 session-ATTENDED checkboxes are the finest-grained
   attendance the pipeline records, and until now 10 of the 12 had no visible target
   anywhere on the dashboard (only D3S3/f3203 and D3S4/f3055 surfaced, as the CPLT CHKPNT
   ticks that this rebuild removes). Opening a Day tick now shows that day's four sessions,
   which is where the detail belonged all along — a checkpoint column at the row level was
   spending permanent horizontal space on two of twelve values. */
var ROSTER_DAY_SESSION_FIELDS = {
  1: ['f3193', 'f3194', 'f3195', 'f3196'],
  2: ['f3197', 'f3198', 'f3199', 'f3200'],
  3: ['f3201', 'f3202', 'f3203', 'f3055']
};
function rosterDaySessionChips(reg, dayNum){
  var fields = ROSTER_DAY_SESSION_FIELDS[dayNum] || [];
  return fields.map(function(f, i){
    return { label: 'S' + (i + 1), on: rosterIsTrue(reg[f]) };
  });
}

function rosterBuildAttendanceTick(reg, dayNum, attendedField, minutesField, currentDayRaw){
  var dayOptionCode = dayNum === 1 ? '404' : dayNum === 2 ? '405' : '406';
  var leftDayNum = ROSTER_LEFT_DAY_TO_NUM[String(reg.f3059 || '')] || 0;
  var isLdpDay = rosterIsTrue(reg.f2293) && leftDayNum === dayNum;
  var attended = rosterIsTrue(reg[attendedField]);
  var minutes = Number(reg[minutesField] || 0);
  var cls, kv, title;
  title = 'Day ' + dayNum;
  /* The four connection facts the client asked for, under the session chips.
     All four are real stored fields, confirmed against the live registrations (10001) field
     metadata on 2026-08-15:
       f2855 First Join Time · f2859 Most Recent Join Time · f2862 Most Recent Leave Time ·
       f2871 Join Count
     (An earlier pass rendered Latest Join as an em dash on the belief that no field backed
     it — f2859 does, and was simply missed. Corrected here.)

     One caveat that IS still true and matters when reading these: all four are
     registration-level, spanning the whole event, not per-day — so they read identically
     inside every day's popover. Only "Present for" below differs per day, because it comes
     from the per-day minute totals f2805/f2806/f2807. Genuine per-day join/leave stamps
     would need new fields written by the Zoom poller. */
  var connectionKv = [
    ['First Join', rosterFmtEpochTime(reg.f2855)],
    ['Latest Join', rosterFmtEpochTime(reg.f2859)],
    ['Latest Leave', rosterFmtEpochTime(reg.f2862)],
    ['Join Count', String(Number(reg.f2871 || 0))]
  ];
  if(isLdpDay){
    cls = 'tk-ldp';
    var leftTypeLabel = ROSTER_LEFT_TYPE_MAP[String(reg.f3056 || '')] || 'LDP';
    kv = [['Attended', 'LDP — ' + leftTypeLabel], ['Left Time', rosterFmtEpochTime(reg.f3060)]];
    if(rosterIsTrue(reg.f2688)) kv.push(['Well Being Out', 'Yes']);
    kv = kv.concat(connectionKv);
  } else if(attended){
    cls = 'tk-attended';
    kv = [['Attended','Yes'], ['Present for', rosterFmtDuration(minutes)]].concat(connectionKv, [['Match', ROSTER_MATCH_METHOD_MAP[String(reg.f2808 || '')] || '—']]);
  } else if(rosterDayOptionIndex(dayOptionCode) >= rosterDayOptionIndex(currentDayRaw)){
    cls = 'tk-pending';
    kv = [['Attended','Pending'], ['Match','Day not yet reached']];
  } else {
    cls = 'tk-absent';
    kv = [['Attended','No'], ['Present for', rosterFmtDuration(minutes)]].concat(connectionKv, [['Match', ROSTER_MATCH_METHOD_MAP[String(reg.f2808 || '')] || 'No Zoom connection recorded for this day']]);
  }
  return '<button class="tick ' + cls + '" data-day-num="' + dayNum + '" onclick="openDetailPop(this)" data-pop-title="' + rosterEscAttr(title) + '"' +
    ' data-pop-chips=\'' + rosterEscAttr(JSON.stringify(rosterDaySessionChips(reg, dayNum))) + '\'' +
    ' data-pop-kv=\'' + rosterEscAttr(JSON.stringify(kv)) + '\'>D' + dayNum + '</button>';
}
function rosterBuildChkpntTick(attended, dayLabel, tickLabel, field){
  var fieldAttr = field ? (' data-field="' + rosterEscAttr(field) + '"') : '';
  if(attended) return '<button class="tick tk-attended"' + fieldAttr + ' onclick="openDetailPop(this)" data-pop-title="' + rosterEscAttr(dayLabel) + '" data-pop-kv=\'' + rosterEscAttr(JSON.stringify([['Status','Complete']])) + '\'>' + tickLabel + '</button>';
  return '<button class="tick tk-pending"' + fieldAttr + ' onclick="openDetailPop(this)" data-pop-title="' + rosterEscAttr(dayLabel) + '" data-pop-kv=\'' + rosterEscAttr(JSON.stringify([['Status','Not yet — checkpoint window not reached']])) + '\'>' + tickLabel + '</button>';
}
function rosterClassPill(classtype, isOn, onClass, label, title, editable, kvOn, kvOff){
  var cls = isOn ? onClass : 'p-slot-off';
  var editAttr = editable ? (' data-pop-edit="classification:' + (classtype === 'reviewer' ? 'reviewer' : 'se') + '"') : '';
  var kv = isOn ? kvOn : kvOff;
  return '<button class="pill ' + cls + ' ev-clickable" data-classtype="' + classtype + '" onclick="openDetailPop(this)" data-pop-eyebrow="Classification" data-pop-title="' + rosterEscAttr(title) + '"' + editAttr + ' data-pop-kv=\'' + rosterEscAttr(JSON.stringify(kv)) + '\'>' + label + '</button>';
}

/* ---------- Status badges (2026-08-15) ----------
   Replaces rosterNameBadge()/rosterNameBadgeHtml()/rosterApplyNameBadge(), which rendered
   ONE badge beside the participant's name, chosen by strict precedence. Two things were
   wrong with that. It sat next to the name, where it competed with the one piece of text
   on the row that is never optional; and being single-valued it actively destroyed
   information — a participant who was both LDP and Well Being Out showed only LDP, and WBO,
   the more consequential of the two, was invisible unless you opened the card.

   Now: every applicable state renders, as its own pill, in its own zone. Order is fixed
   (most current state first) rather than exclusive, so a row reads left-to-right as
   "what is true about this person right now" and two rows with the same states always
   look the same.

   LIVE deliberately still leads and still beats the absence states. Turning up is itself
   the resolution for an absent participant, and the T+20 sweep's Absent-NCNS is provisional
   until a CS confirms it — a record reading ABSENT while the person is sitting in the
   meeting is simply wrong. So LIVE suppresses ABSENT/NSHO specifically (see below); it does
   not suppress anything else.

   Field mapping, all confirmed against the existing field map:
     LIVE       f2853 Currently Present
     LATE       f3062 FS Late Arrival
     LDP        f2293 Left The Course
     WBO        f2688 Well Being Out  (a subtype of LDP — both show, that is the point)
     NSHO       f3191 = 468 Absent-NCNS   (no call, no show)
     ABSENT     f3191 = 467 Absent-Excused
     WITHDRAWN  f2424 = 491 Withdraw   (see ROSTER_REG_WITHDRAWN) */
function rosterStatusBadges(reg){
  var out = [];
  var live = rosterIsTrue(reg.f2853);
  var att = String(reg.f3191 || '');
  if(live){
    /* The LIVE popover answers the question a CS actually asks when they see it — how long
       has this person been here, and did they drop out at any point. Present-for is the
       current day's minutes, which is the only one of the three that is genuinely per-day. */
    var todayMinutesField = { '404':'f2805', '405':'f2806', '406':'f2807' }[String(DASHBOARD_DATA.todaysSessionRaw)] || 'f2805';
    out.push({
      key: 'live', label: 'LIVE', cls: 'p-present live', title: 'In the meeting now',
      kv: [
        ['First join', rosterFmtEpochTime(reg.f2855)],
        ['Latest join', rosterFmtEpochTime(reg.f2859)],
        ['Latest leave', rosterFmtEpochTime(reg.f2862)],
        ['Present for', rosterFmtDuration(reg[todayMinutesField])],
        ['Join count', String(Number(reg.f2871 || 0))]
      ]
    });
  }
  if(rosterIsTrue(reg.f3062)) out.push({ key:'late', label:'LATE', cls:'p-late', title:'Late arrival flagged', kv:[['Status','Late arrival recorded for this session']] });
  if(rosterIsTrue(reg.f2293)){
    out.push({ key:'ldp', label:'LDP', cls:'p-ldp', title:'Left during the programme', kv:[
      ['Left type', ROSTER_LEFT_TYPE_MAP[String(reg.f3056 || '')] || '—'],
      ['Left day', String(ROSTER_LEFT_DAY_TO_NUM[String(reg.f3059 || '')] || '—')],
      ['Left time', rosterFmtEpochTime(reg.f3060)]
    ] });
  }
  if(rosterIsTrue(reg.f2688)){
    out.push({ key:'wbo', label:'WBO', cls:'p-ldp', title:'Well Being Out', kv:[
      ['Status','Well Being Out'],
      ['Reason', ROSTER_WBO_REASON_MAP[String(reg.f3061 || '')] || '—']
    ] });
  }
  if(!live && att === '468') out.push({ key:'nsho', label:'NSHO', cls:'p-absent', title:'Absent — no call, no show', kv:[['Status','Absent — no call, no show']] });
  if(!live && att === '467') out.push({ key:'absent', label:'ABSENT', cls:'p-excused', title:'Absent — excused', kv:[['Status','Absent — excused'],['Note', String(reg.f3190 || '').trim() || '—']] });
  if(rosterIsWithdrawn(reg)) out.push({ key:'withdrawn', label:'WITHDRAWN', cls:'p-absent', title:'Withdrew before the course started', kv:[['Registration','Withdrawn']] });
  return out;
}

/* Flag tokens for the whole record, published on the card as data-flags. Every filter —
   the snapshot tiles, the Advanced search presets, and the query builder — tests this one
   string rather than each re-deriving state by inspecting rendered pills.

   That matters because the old filters did exactly that: `card.querySelector('.ev-name-row
   .p-ldp')` and friends read the DOM for a CSS class as a proxy for a field value, so any
   change to how a pill is styled or where it sits silently changed what the filter matched.
   Deriving once, from the registration, keeps the tiles, the pills and the search agreeing
   by construction. */
function rosterRecordFlags(reg){
  var flags = rosterStatusBadges(reg).map(function(b){ return b.key; });
  if(rosterIsQueued(reg)) flags.push('queued');
  rosterDeviceFlags(reg).forEach(function(f){ flags.push(f); });
  rosterQueueReasons(reg).forEach(function(f){ if(flags.indexOf(f) === -1) flags.push(f); });
  // Blank f2424 counts as active — see rosterIsInactive() for why.
  if(!rosterIsInactive(reg) && !rosterIsTrue(reg.f3046) && !rosterIsTrue(reg.f2293)) flags.push('current');
  /* The flag the roster's default view filters on. Every inactive record still renders a
     card — it is hidden, not dropped — so the Inactive view can reveal it without a refetch,
     and so a partner link or a direct search can still reach it. */
  if(rosterIsInactive(reg)) flags.push('inactive');
  if(rosterIsTrue(reg.f3044)) flags.push('reviewer');
  if(rosterIsTrue(reg.f3046)) flags.push('se');
  if(rosterIsTrue(reg.f3206)) flags.push('minor');
  if(rosterIsTrue(reg.f2303)) flags.push('seminar');
  if(rosterIsTrue(reg.f2302)) flags.push('ac');
  /* Follow-on potential states, added 2026-08-15 so POT and NP can be filtered and excluded
     the same way everything else can. Seminar and AC are kept as SEPARATE flags rather than
     one shared "potential" — the row draws two independent pills and a CS chasing Seminar
     conversions is not chasing AC conversions, so a chip that matched either would return a
     list they would then have to re-sort by eye.
     Read from the same option ids the pills use: f2882 371/370, f2887 382/381. */
  if(String(reg.f2882) === '371') flags.push('sempot');
  if(String(reg.f2882) === '370') flags.push('semnp');
  if(String(reg.f2887) === '382') flags.push('acpot');
  if(String(reg.f2887) === '381') flags.push('acnp');
  if(rosterIsTrue(reg.f2801)) flags.push('d1');
  if(rosterIsTrue(reg.f2802)) flags.push('d2');
  if(rosterIsTrue(reg.f2803)) flags.push('d3');
  return flags;
}
function rosterFlagsAttr(reg){ return ' ' + rosterRecordFlags(reg).join(' ') + ' '; }
function rosterHasFlag(card, flag){ return (card.dataset.flags || '').indexOf(' ' + flag + ' ') !== -1; }

/* One badge-row builder, used by both the initial render and the live patch so the two can
   never drift. The zone is always emitted even when empty, so the live patch always has a
   node to write into rather than having to rebuild the identity block. */
function rosterStatusBadgesHtml(reg){
  return rosterStatusBadges(reg).map(function(b){
    return '<button class="pill ' + b.cls + ' ev-clickable" data-statusbadge="' + b.key + '" onclick="openDetailPop(this)"' +
      ' data-pop-eyebrow="Status" data-pop-title="' + rosterEscAttr(b.label) + '" title="' + rosterEscAttr(b.title) + '"' +
      ' data-pop-kv=\'' + rosterEscAttr(JSON.stringify(b.kv)) + '\'>' + rosterEscHtml(b.label) + '</button>';
  }).join('');
}
function rosterApplyStatusBadges(card, reg){
  var zone = card.querySelector('[data-status-zone="1"]');
  if(zone) zone.innerHTML = rosterStatusBadgesHtml(reg);
  card.dataset.flags = rosterFlagsAttr(reg);
}

/* ---------- The CS queue (2026-08-14) ----------
   "In queue" means a human still needs to do something with this participant. It is derived
   from field state rather than stored, so it cannot drift out of sync with the thing it
   summarises, and the common resolution — the participant simply turns up — clears itself
   with no workflow involvement at all.

   Four reasons, each with its own resolution:
     attention    — Late, or Absent (either value), and not currently present. Resolved by a
                    saved Attendance Override note (f3237), or by them showing up (f2853).
                    The sweep's own f3191=468 does NOT resolve it: the system pre-picking
                    NCNS is a starting position, and the note is the evidence a CS worked it.
     unmatched    — f2808=490, the T+5 reconciliation flagged present-but-not-in-Zoom.
     multidevice  — f3184, one registrant ID holding two concurrent connections.
     shareddevice — f3207, paired with another participant on one device.
   The three device/match reasons all resolve on a saved Zoom/Exception note (f3236).

   Withdrawn and LDP records are never queued — they have left the course, so there is
   nothing for a CS to chase. */
var ROSTER_QUEUE_META = {
  attention:    { label: 'ATTN!',         cls: 'p-needsattn', title: 'Needs attention', action: 'correctAttendance' },
  unmatched:    { label: 'UNMATCHED',     cls: 'p-needsattn', title: 'Zoom match unresolved', action: 'deviceException' },
  multidevice:  { label: 'MULTI-DEVICE',  cls: 'p-needsattn', title: 'Participant using multiple devices', action: 'deviceException' },
  shareddevice: { label: 'SHARED DEVICE', cls: 'p-needsattn', title: 'Shared device with another participant', action: 'deviceException' }
};
function rosterQueueReasons(reg){
  var out = [];
  if(rosterIsWithdrawn(reg) || rosterIsTrue(reg.f2293)) return out;
  var att = String(reg.f3191 || '');
  var attFlagged = rosterIsTrue(reg.f3062) || att === '467' || att === '468';
  if(attFlagged && !rosterIsTrue(reg.f2853) && !String(reg.f3237 || '').trim()) out.push('attention');
  if(String(reg.f2808) === '490' && !String(reg.f3236 || '').trim()) out.push('unmatched');
  return out;
}
function rosterIsQueued(reg){ return rosterQueueReasons(reg).length > 0; }

/* Device flags — shown, never queued (client decision, 2026-08-14). Multi-device (f3184)
   and shared device (f3207) are handled as pure CS interaction if and when they come up,
   rather than as automatic worklist items: the Zoom poller can raise f3184 from nothing
   more than a waiting-room reconnect, and auto-queueing every one of those would bury the
   cases that genuinely need a human. They still render a pill so the state is visible on
   the card, and the pill still opens Device Exception, but they carry no data-queue
   attribute and so never reach PIQ or the queue filter. */
function rosterDeviceFlags(reg){
  var out = [];
  if(rosterIsWithdrawn(reg) || rosterIsTrue(reg.f2293)) return out;
  if(rosterIsTrue(reg.f3184)) out.push('multidevice');
  if(String(reg.f3207 || '').trim()) out.push('shareddevice');
  return out;
}

/* rosterQueuePills() — replaced rosterDeviceExceptionPill() on 2026-08-14. The old pill
   surfaced only the two device states (MULTI-DEVICE from f3184, SHARED DEVICE from f3207)
   and opened a read-only detail pop. This covers the same two device states plus
   the unmatched and needs-attention cases, and — unlike the old detail-pop pill — opens the
   action that resolves the flag. A pill that only describes a problem the CS is required to
   act on is a dead end; every queue pill is now a way in to the modal that clears it. */
function rosterQueuePillHtml(reason, queued){
  var m = ROSTER_QUEUE_META[reason];
  /* data-rosterpill marks every pill this function owns, so the live patch can clear the
     whole set before rebuilding. data-queue is the narrower marker the PIQ filter counts —
     only genuine queue reasons carry it. */
  return '<button class="pill ' + m.cls + ' ev-clickable" data-rosterpill="1"' + (queued ? ' data-queue="1"' : '') +
    ' data-queue-reason="' + reason + '" title="' + rosterEscAttr(m.title) +
    '" onclick="rosterQueuePillAction(this,\'' + m.action + '\')">' + m.label + '</button>';
}
function rosterQueuePills(reg){
  var html = '';
  rosterQueueReasons(reg).forEach(function(reason){ html += rosterQueuePillHtml(reason, true); });
  rosterDeviceFlags(reg).forEach(function(reason){ html += rosterQueuePillHtml(reason, false); });
  return html;
}
function rosterQueuePillAction(el, which){
  var card = el.closest('.ev-card');
  if(!card) return;
  if(which === 'correctAttendance') openCorrectAttendance(card);
  else if(which === 'deviceException') openDeviceException(card);
}

/* ---------- Notes (2026-08-15) ----------
   The row now carries a notes button that opens the full history rather than a single
   write-only textarea. Two things make that possible without a new backend object.

   First, notes were never in one place to begin with. Five different fields on a
   registration hold CS-written prose, each written by a different modal, and a CS had no
   way to see them together — which meant the Attendance Override note that explains why
   someone is marked absent was invisible from everywhere except the modal that wrote it.
   They are aggregated here, each carrying the category it came from.

   Second, the general note field (f2886) is append-only, so its contents are a log already.
   rosterParseNoteBlock() reads the canonical header this dashboard writes —
     [YYYY-MM-DD HH:MM] Author Name — note text
   — and falls back to treating an unrecognised block as a single undated entry rather than
   dropping it. That fallback matters: the append is performed server-side by
   CS Dashboard : Add Note, so existing notes predate the convention and will have no
   header at all until that workflow is updated to write one. They still render, just
   without a timestamp or author, which is an honest representation of what is stored.

   Ordering is newest-first across all categories. */
/* Every longtext field on registrations (10001) that holds CS-written prose, enumerated
   against the live field metadata on 2026-08-15 rather than from memory — the first pass of
   this list was assembled from what the dashboard's own modals happened to write, and missed
   four fields that other surfaces write into. Category is the field's own Ontraport alias,
   so a CS reading the panel sees where each note came from.

   Deliberately excluded, though also longtext: the participant-authored fields (f2583 What I
   Want to Accomplish, f2676 Anything You'd Like Us to Know, f2580 Dietary Restrictions,
   f2582 Forum Participants You Know, f3187-f3189 portal feedback, f2992 Feedback Form,
   f3006 FDBK). Those are the participant's words on their registration form, not CS
   operational notes — surfacing them in a "notes" log would mix two very different things
   and would put someone's dietary and health disclosures into a general operational feed. */
var ROSTER_NOTE_FIELDS = [
  { field: 'f3270', category: 'Note' },
  { field: 'f2886', category: 'Operational' },
  { field: 'f3237', category: 'Attendance override' },
  { field: 'f3236', category: 'Zoom / device' },
  { field: 'f3209', category: 'Device exception' },
  { field: 'f3068', category: 'Classification override' },
  { field: 'f3190', category: 'Excused reason' },
  { field: 'f3235', category: 'Course status' },
  { field: 'f2891', category: 'AC registration' }
];
/* Two patterns, tried in order, matching what CS Dashboard : Add Note has written over time:
     FULL   [YYYY-MM-DD HH:mm] Author — note   (current, since 2026-08-15)
     LEGACY [M/d h:mm a] note                  (original; timestamp, no author)
   The separator is a SPACED em-dash so hyphenated author names parse correctly, and the
   author group excludes newlines so it can never swallow the body. Falling back to the
   legacy pattern rather than only matching the current one matters: every note written
   before today uses it, and treating those as unparseable would strip real timestamps off
   existing history and render the raw "[8/14 9:12 AM]" prefix as if it were note text. */
var ROSTER_NOTE_HEADER_RE = /^\[([^\]]+)\]\s*([^\n]*?)\s+—\s+([\s\S]*)$/;
var ROSTER_NOTE_LEGACY_RE = /^\[([^\]]+)\]\s*([\s\S]*)$/;
function rosterParseNoteBlock(raw, category){
  var text = String(raw == null ? '' : raw).trim();
  if(!text) return [];
  /* Split before each line that opens with a "[" timestamp header — that is the only
     boundary marker an append-only text field can carry. A note whose own body contains a
     bracketed line at the start of a line would split wrongly; accepted, because the
     alternative is a single opaque blob and this degrades to exactly that anyway. */
  return text.split(/\n(?=\[)/).map(function(block){
    var b = block.trim();
    if(!b) return null;
    var m = ROSTER_NOTE_HEADER_RE.exec(b);
    if(m) return { category: category, when: m[1].trim(), who: m[2].trim(), text: m[3].trim() };
    var legacy = ROSTER_NOTE_LEGACY_RE.exec(b);
    if(legacy) return { category: category, when: legacy[1].trim(), who: '', text: legacy[2].trim() };
    return { category: category, when: '', who: '', text: b };
  }).filter(Boolean);
}
function rosterNoteEntries(reg){
  var out = [];
  ROSTER_NOTE_FIELDS.forEach(function(spec){
    out = out.concat(rosterParseNoteBlock(reg[spec.field], spec.category));
  });
  /* Undated entries sort last rather than first: they are the legacy blobs, and a CS
     opening the panel wants the most recent real activity at the top. */
  out.sort(function(a, b){
    if(!a.when && !b.when) return 0;
    if(!a.when) return 1;
    if(!b.when) return -1;
    return a.when < b.when ? 1 : (a.when > b.when ? -1 : 0);
  });
  return out;
}

/* ---------- Copy contact details (2026-08-15) ----------
   A CS phoning or emailing a participant mid-session was previously reading the address off
   the Participant Details drawer and retyping it. These put it on the clipboard from the row.

   Values come from f3252/f3253, which are `related_data` fields — the collection endpoint
   silently drops those from listFields, so Roster Fetch resolves them via the f2213//email
   and f2213//sms_number externs and aliases them onto these keys (see that workflow's Build
   Roster Response). Confirmed present on all 134 records of event 218.

   A button is only rendered when its value exists. An icon that copies an empty string looks
   identical to one that works and fails silently, which is worse than not offering it. */
function rosterCopyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text);
  }
  /* Fallback for non-secure contexts, where navigator.clipboard is undefined. Ontraport
     serves over https so this should never be needed, but a copy button that throws is a
     dead control and the fallback is six lines. */
  return new Promise(function(resolve, reject){
    try{
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if(ok) resolve(); else reject(new Error('copy rejected'));
    }catch(err){ reject(err); }
  });
}
var ROSTER_ICON_EMAIL = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="1.6"/><path d="m3.2 6 6.8 4.8L16.8 6"/></svg>';
var ROSTER_ICON_PHONE = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13.6v2a1.5 1.5 0 0 1-1.6 1.5 14 14 0 0 1-6.1-2.2 13.8 13.8 0 0 1-4.2-4.2A14 14 0 0 1 2.9 4.6 1.5 1.5 0 0 1 4.4 3h2a1.5 1.5 0 0 1 1.5 1.3c.1.7.3 1.4.5 2a1.5 1.5 0 0 1-.3 1.6l-.9.8a11 11 0 0 0 4.2 4.2l.8-.9a1.5 1.5 0 0 1 1.6-.3c.6.2 1.3.4 2 .5A1.5 1.5 0 0 1 17 13.6Z"/></svg>';
function rosterContactButtons(reg){
  var out = '';
  var email = String(reg.f3252 == null ? '' : reg.f3252).trim();
  var phone = String(reg.f3253 == null ? '' : reg.f3253).trim();
  if(email){
    out += '<button class="ev-copy" onclick="rosterCopyContact(event, this)" data-copy="' + rosterEscAttr(email) +
      '" data-copy-label="Email" title="' + rosterEscAttr('Copy ' + email) + '" aria-label="Copy email address">' + ROSTER_ICON_EMAIL + '</button>';
  }
  if(phone){
    out += '<button class="ev-copy" onclick="rosterCopyContact(event, this)" data-copy="' + rosterEscAttr(phone) +
      '" data-copy-label="Phone" title="' + rosterEscAttr('Copy ' + phone) + '" aria-label="Copy phone number">' + ROSTER_ICON_PHONE + '</button>';
  }
  return out;
}
function rosterCopyContact(e, btn){
  /* The row has its own click targets; without this the copy would also open whatever the
     surrounding element does. */
  e.stopPropagation();
  var value = String(btn.dataset.copy || '');
  var label = btn.dataset.copyLabel || 'Value';
  if(!value) return;
  rosterCopyToClipboard(value).then(function(){
    /* The toast names the value, not just "Copied" — a CS working a 134-row roster needs to
       know WHICH record they just copied from, and the row that was clicked has usually
       scrolled or been forgotten by the time they paste. */
    toast(label + ' copied · ' + value);
    // Brief inline confirmation as well: the toast is at the page edge, the eye is on the row.
    btn.classList.add('copied');
    setTimeout(function(){ btn.classList.remove('copied'); }, 1300);
  }).catch(function(err){
    console.error('rosterCopyContact failed:', err);
    toast('Could not copy — ' + value, 'err');
  });
}

/* ---------- Participant avatar (2026-08-15) ----------
   The row had no avatar at all: identity was a name, a legal name and a PID, three lines of
   text with nothing to anchor them. An avatar gives the eye something to scan down a
   143-row roster by, which is how a CS actually finds a person they are looking at in Zoom.

   Image source is the linked Contact's standard Ontraport `profile_image`, reached the same
   `f2213//` way the row already reads firstname/lastname/f2792 — so it needs the Roster
   Fetch webhook to include `f2213//profile_image` in its listFields. Until it does, this
   reads undefined and every avatar falls back to initials, which is the intended graceful
   state rather than a failure: a monogram on the participant's own colour is a perfectly
   good anchor, and most Contacts will never have an image at all.

   Only http(s) values are accepted as an image. Ontraport stores this field inconsistently
   across accounts (sometimes a bare filename, sometimes a full CDN URL) and a bare filename
   resolved against the dashboard's own origin would issue a 404 per row per render. */
function rosterInitials(name){
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  if(parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
/* Deterministic tint per person, so the same participant is the same colour on every
   render and between sessions. Hash the display name rather than the record id: the id is
   sequential, which would band adjacent rows into near-identical hues. */
var ROSTER_AVATAR_TINTS = ['#0d2d31', '#217a00', '#3f6b6d', '#b8730a', '#c8452a', '#4a5b8c', '#6b4a7c', '#2f6b57'];
function rosterAvatarTint(seed){
  var s = String(seed || ''), h = 0;
  for(var i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return ROSTER_AVATAR_TINTS[h % ROSTER_AVATAR_TINTS.length];
}
function rosterAvatarFaceHtml(name, imgUrl, extraClass){
  var url = String(imgUrl || '').trim();
  var isImg = /^https?:\/\//i.test(url);
  var cls = 'av-face' + (extraClass ? ' ' + extraClass : '');
  if(isImg){
    return '<span class="' + cls + '" style="background-image:url(' + rosterEscAttr(url) + ')" role="img" aria-label="' + rosterEscAttr(name) + '"></span>';
  }
  return '<span class="' + cls + '" style="background:' + rosterAvatarTint(name) + '" aria-hidden="true">' + rosterEscHtml(rosterInitials(name)) + '</span>';
}

/* Stacked avatar — "here with someone".
   Source is f3207 Shared Device, the only real pairing signal on the record: it holds the
   OTHER participant's name as free text (not an id), written by the Device Exception modal.
   partnerIndex is a name -> registration lookup built once per render in
   dashboardRenderRoster(), so resolving the partner to a clickable record is O(1) per row
   rather than a scan of the roster per row.

   Name matching is inherently lossy — the CS types the name into Device Exception, so
   "Jo Blyth" will not match a roster entry of "Joanna Blyth". When it fails we still stack
   the avatar (the pairing is real and worth showing) but the second face is not clickable
   and the popover says who we were told they are paired with. Failing to a non-clickable
   avatar is the honest outcome; inventing a link to the wrong person is not.

   Interaction: the stack is collapsed by default (one face, one peeking behind). Clicking
   it fans the two apart; clicking the partner's face then jumps to their row. */
function rosterAvatarHtml(reg, displayName, partnerIndex){
  var img = reg['f2213//profile_image'];
  var partnerName = String(reg.f3207 || '').trim();
  var self = rosterAvatarFaceHtml(displayName, img, 'av-self');
  if(!partnerName) return '<div class="ev-av">' + self + '</div>';
  var partner = partnerIndex ? partnerIndex[partnerName.toLowerCase()] : null;
  var partnerImg = partner ? partner['f2213//profile_image'] : '';
  var partnerFace = rosterAvatarFaceHtml(partnerName, partnerImg, 'av-partner');
  var partnerAttrs = partner
    ? ' data-partner-reg="' + rosterEscAttr(partner.id) + '" title="' + rosterEscAttr('Shared device with ' + partnerName + ' — open their record') + '"'
    : ' data-partner-unmatched="1" title="' + rosterEscAttr('Shared device with ' + partnerName + ' — no matching roster record') + '"';
  /* role/tabindex, not a <button>: this element CONTAINS the partner button, and a button
     inside a button is invalid and behaves unpredictably. The delegated Enter/Space handler
     gives it real keyboard operation; aria-expanded reports the fanned state. */
  return '<div class="ev-av ev-av-stack" role="button" tabindex="0" aria-expanded="false"' +
      ' onclick="rosterToggleAvatarStack(event, this)" title="' +
      rosterEscAttr('Sharing a device with ' + partnerName) + '">' +
      self +
      '<button type="button" class="av-partner-btn"' + partnerAttrs + ' onclick="rosterOpenPartner(event, this)">' + partnerFace + '</button>' +
    '</div>';
}
function rosterToggleAvatarStack(e, el){
  /* Only the collapsed stack toggles. Once fanned, a click on the partner face has to reach
     its own handler — swallowing it here would make the second avatar permanently inert,
     which is the whole point of fanning it out. */
  if(e.target.closest('.av-partner-btn')) return;
  e.stopPropagation();
  el.setAttribute('aria-expanded', el.classList.toggle('fanned') ? 'true' : 'false');
}
function rosterOpenPartner(e, btn){
  e.stopPropagation();
  var id = btn.dataset.partnerReg;
  if(!id){ toast('No roster record matches that name — open Device Exception to re-link them.', 'err'); return; }
  var target = document.querySelector('#rosterList .ev-card[data-reg-id="' + id + '"]');
  if(!target){ toast('That participant is not on the current roster.', 'err'); return; }
  /* The partner may be filtered out or on another page. Clear the filter state and page to
     them rather than silently doing nothing — "navigate to their record" has to work from
     wherever the CS happens to be standing. */
  rosterRevealCard(target);
}
/* Bring a specific card into view regardless of the current filter/search/page state, then
   mark it so the CS can see which row answered their click. */
function rosterRevealCard(card){
  var list = document.getElementById('rosterList');
  if(!list || !card) return;
  /* Jumping to the partner may require dropping whatever narrowing is in force — they can
     easily be filtered out or on another page. Say so rather than doing it silently: a CS
     who had a PNA filter running and finds it gone, with no explanation, will read the
     dashboard as having lost their place on its own. Only announced when something was
     actually cleared. */
  var cleared = (rosterStatFilter ? 1 : 0) + (rosterAdvancedQuery ? 1 : 0) +
                ((document.getElementById('rosterSearch') || {}).value ? 1 : 0);
  if(cleared) rosterClearAllFilters();
  /* The partner may be an inactive registration, which the default view hides — switch
     population if so, or the scroll below would target a card that is display:none and the
     click would appear to do nothing. */
  var targetInactive = rosterHasFlag(card, 'inactive');
  if(targetInactive !== rosterShowInactive){
    rosterShowInactive = targetInactive;
    list.classList.toggle('viewing-inactive', rosterShowInactive);
    rosterSyncInactiveButton();
  }
  var cards = Array.prototype.filter.call(list.children, function(c){ return c.classList.contains('ev-card'); });
  var idx = cards.indexOf(card);
  if(idx !== -1) pageState.roster = Math.floor(idx / rosterPageSize) + 1;
  paginate('roster');
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('ev-card-flash');
  setTimeout(function(){ card.classList.remove('ev-card-flash'); }, 1800);
  if(cleared) toast('Filters cleared to show this participant.');
}

/* Rebuilt 2026-08-15. The row's information architecture changed, not just its skin:
     - Identity leads with an avatar and the participant's LEGAL first+last name, with the
       preferred name ("Name Likes") demoted to a quiet second line. It used to be the other
       way round, with the legal name and PID crammed into one mono sub-line.
     - PID is gone. It is an internal Zoom registrant identifier; a CS never reads it, never
       types it, and it was occupying the most-read line on the row. It stays in data-search,
       so anyone who does have a PID can still paste it into the search box and find them.
     - Status badges moved out of the name row into their own zone (see rosterStatusBadges).
     - CPLT CHKPNT is gone as a column; its two values now live inside the Day 3 tick's
       session detail alongside the ten sibling sessions that never had a home.
     - Seminar and AC share one Follow-on zone rather than a column each, and a notes button
       joins them.
   Every zone below is a plain flex/grid cell so the row can reflow without the six
   fixed-width columns it used to assume. */
function rosterBuildCardHtml(reg, currentDayRaw, localeAbbr, partnerIndex){
  var first = reg['f2213//firstname'] || '';
  var last = reg['f2213//lastname'] || '';
  var nameLikes = reg['f2213//f2792'] || '';
  var legalName = (first + ' ' + last).trim() || 'Unknown Participant';
  var displayFirst = nameLikes || first;
  var displayName = (displayFirst + ' ' + last).trim() || legalName;
  /* data-sort-name stays the DISPLAY name (see rosterApplySort) but the row now LEADS with
     the legal name, so the two can differ. Sorting on what the eye reads is still right:
     the preferred name is the line a CS scans when hunting alphabetically. */
  var searchStr = (displayName + ' ' + legalName + ' ' + nameLikes + ' ' + (reg.f2794 || '') + ' ' + reg.id).toLowerCase();

  var mnrOn = rosterIsTrue(reg.f3206);
  var revOn = rosterIsTrue(reg.f3044);
  var seOn = rosterIsTrue(reg.f3046);
  var seReason = ROSTER_SE_REASON_MAP[String(reg.f3053 || '')] || '';

  var mnrPill = rosterClassPill('mnr', mnrOn, 'p-minor', 'MNR', 'Minor', false, [['Status','Yes']], [['Status','No']]);
  var revPill = rosterClassPill('reviewer', revOn, 'p-review', 'REV', 'Reviewer', true, [['Reviewer','Yes'],['Source','Participant history']], [['Reviewer','No']]);
  var sePill = rosterClassPill('se', seOn, 'p-excluded', 'SE', 'Statistical Exclusion', true, [['Status','Excluded'],['Reason', seReason || '—']], [['Status','Not excluded']]);
  var acNpIsNonPotential = String(reg.f2887) === '381';
  var acNpKv = [['AC Potential', acNpIsNonPotential ? 'Non-Potential' : 'Pending']];
  if(acNpIsNonPotential) acNpKv.push(['Reason', ROSTER_AC_NP_REASON_MAP[String(reg.f2888 || '')] || '—']);
  var acNpPill = '<button class="pill p-slot-off ev-clickable" data-classtype="ac-np" onclick="openDetailPop(this)" data-pop-eyebrow="Classification" data-pop-title="Advanced Course — Not Potential" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(acNpKv)) + '\'>AC-NP</button>';
  var semNpIsNonPotential = String(reg.f2882) === '370';
  var semNpKv = [['Seminar Potential', semNpIsNonPotential ? 'Non-Potential' : 'Pending']];
  if(semNpIsNonPotential) semNpKv.push(['Reason', ROSTER_SEM_NP_REASON_MAP[String(reg.f2883 || '')] || '—']);
  var semNpPill = '<button class="pill p-slot-off ev-clickable" data-classtype="sem-np" onclick="openDetailPop(this)" data-pop-eyebrow="Classification" data-pop-title="Seminar — Not Potential" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(semNpKv)) + '\'>SEM NP</button>';
  var queuePills = rosterQueuePills(reg);

  var d1Tick = rosterBuildAttendanceTick(reg, 1, 'f2801', 'f2805', currentDayRaw);
  var d2Tick = rosterBuildAttendanceTick(reg, 2, 'f2802', 'f2806', currentDayRaw);
  var d3Tick = rosterBuildAttendanceTick(reg, 3, 'f2803', 'f2807', currentDayRaw);
  /* The S3/S4 CPLT CHKPNT ticks that used to render here are gone. They showed two of the
     twelve per-session attendance flags as a permanent row column, while the other ten had
     no representation anywhere. Both values now appear as session chips inside the Day 3
     tick's popover, together with D3S1 and D3S2 — same data, in the place where the rest of
     it already lives, and a whole column recovered. rosterBuildChkpntTick() is retained: the
     attendance.changed live handler still uses it, and f3203/f3055 remain individually
     patchable fields. */

  /* Three states, not two (2026-08-15). data-pot was a boolean, so an unset Potential field
     was indistinguishable from Non-Potential and the pill rendered NP for both — which would
     have made the new "clear" invisible on the row, defeating the point of being able to do
     it. data-potstate carries pot / np / none, read from the same option ids the override
     modal writes.
     data-pot is still emitted for anything reading the old attribute; the ladder uses
     data-potstate. CONF is gone entirely — the client uses REG, POT and NP only. */
  var semReg = rosterIsTrue(reg.f2303) ? 1 : 0;
  var semState = String(reg.f2882) === '371' ? 'pot' : (String(reg.f2882) === '370' ? 'np' : 'none');
  var semPot = semState === 'pot' ? 1 : 0;
  var semDesig = String(reg.f2885) === '380' ? 1 : 0;
  var semAlt = String(reg.f2885) === '379' ? 1 : 0;
  var semKv = semReg ? [['Registered','Yes'],['Seminar', reg.f3185 || '—']]
                     : [['Potential', semState === 'pot' ? 'Yes' : (semState === 'np' ? 'No — non-potential' : 'Not set')],['Registered','No']];
  var seminarPill = '<button class="pill p-neutral ev-clickable prog-seminar" onclick="openDetailPop(this)" data-pot="' + semPot + '" data-potstate="' + semState + '" data-reg="' + semReg + '" data-desig="' + semDesig + '" data-alt="' + semAlt + '" data-pop-title="Seminar Registration" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(semKv)) + '\'>—</button>';

  var acReg = rosterIsTrue(reg.f2302) ? 1 : 0;
  var acState = String(reg.f2887) === '382' ? 'pot' : (String(reg.f2887) === '381' ? 'np' : 'none');
  var acPot = acState === 'pot' ? 1 : 0;
  var acDesig = String(reg.f2890) === '392' ? 1 : 0;
  var acAlt = String(reg.f2890) === '391' ? 1 : 0;
  var acKv = acReg ? [['Registered','Yes'],['Course', reg.f3186 || '—']]
                   : [['Potential', acState === 'pot' ? 'Yes' : (acState === 'np' ? 'No — non-potential' : 'Not set')],['Registered','No']];
  var acPill = '<button class="pill p-neutral ev-clickable prog-ac" onclick="openDetailPop(this)" data-pot="' + acPot + '" data-potstate="' + acState + '" data-reg="' + acReg + '" data-desig="' + acDesig + '" data-alt="' + acAlt + '" data-pop-title="Advanced Course Registration" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(acKv)) + '\'>—</button>';

  var notesCount = rosterNoteEntries(reg).length;
  var notesBtn = '<button class="ev-notesbtn' + (notesCount ? ' has-note' : '') + '" onclick="openNotes(this)" title="' +
    (notesCount ? rosterEscAttr(notesCount + ' note' + (notesCount === 1 ? '' : 's')) : 'Add a note') + '" aria-label="Notes">' +
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h10a1 1 0 0 1 1 1v8l-3 3H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M7 8h6M7 11h4"/></svg>' +
    (notesCount ? '<span class="ev-notesbtn-n">' + notesCount + '</span>' : '') + '</button>';

  return '<div class="ev-card" data-search="' + rosterEscAttr(searchStr) + '" data-sort-name="' + rosterEscAttr(displayName) + '" data-reg-id="' + rosterEscAttr(reg.id) + '" data-flags="' + rosterEscAttr(rosterFlagsAttr(reg)) + '">' +
    '<div class="ev-row1">' +
      '<div class="ev-field ev-identity">' +
        rosterAvatarHtml(reg, displayName, partnerIndex) +
        /* Legal name leads; "goes by" sits under it, quiet enough not to compete. A CS
           matching a Zoom tile to a roster row is usually reading whichever of the two the
           participant typed into Zoom, so both have to be present — but only one can be the
           headline, and the legal name is the one that also appears on every other system. */
        '<div class="ev-name">' +
          '<b>' + rosterEscHtml(legalName) + '</b>' +
          (nameLikes ? '<span class="ev-goesby">(' + rosterEscHtml(nameLikes) + ')</span>' : '') +
          /* Copy buttons lead the row so they sit at a fixed x on every card. Placed after
             the pills they would land at a different offset per row, depending on how many
             queue pills that participant happens to carry — and a control whose position
             moves per row cannot be hit without looking for it first.
             They also have to precede the queue pills for the live patch to be safe:
             dashboardApplyAttendanceChanged() rebuilds the queue set by removing every
             [data-rosterpill] and re-appending, so anything that must survive has to sit
             before them in the DOM. */
          '<div class="ev-sub">' + rosterContactButtons(reg) +
            '<button class="pill p-locale ev-clickable" onclick="openDetailPop(this)" data-pop-title="Locale" data-pop-kv=\'' + rosterEscAttr(JSON.stringify([['Value', localeAbbr.full]])) + '\'>' + localeAbbr.abbr + '</button>' + queuePills + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ev-field ev-status"><div class="ev-l">Status</div><div class="status-pills" data-status-zone="1">' + rosterStatusBadgesHtml(reg) + '</div></div>' +
      /* 3 over 2. The .class-pills grid is 6 columns wide: the three top pills span 2 each
         and the two NP pills span 3 each, so the lower pair is evenly divided and exactly
         as wide as the trio above it. */
      '<div class="ev-field ev-classification">' +
        '<div class="ev-l">Classification</div>' +
        '<div class="class-pills">' + mnrPill + revPill + sePill + acNpPill + semNpPill + '</div>' +
      '</div>' +
      '<div class="ev-field"><div class="ev-l">Attendance</div><div class="ticks">' + d1Tick + d2Tick + d3Tick + '</div></div>' +
      '<div class="ev-field ev-followon"><div class="ev-l">Seminar &amp; AC</div><div class="followon-pills">' + seminarPill + acPill + notesBtn + '</div></div>' +
      '<div class="ev-field ev-exception"><button class="kebab-btn" onclick="openRowMenu(this)" aria-label="Actions"><svg viewBox="0 0 4 16" fill="currentColor"><circle cx="2" cy="2" r="1.6"/><circle cx="2" cy="8" r="1.6"/><circle cx="2" cy="14" r="1.6"/></svg></button></div>' +
    '</div>' +
  '</div>';
}

function dashboardRenderRoster(registrations){
  var list = document.getElementById('rosterList');
  var header = list.querySelector('.hr-row.hd');
  var localeFull = dashboardEventFormat();
  var localeAbbr = { full: localeFull, abbr: ROSTER_LOCALE_ABBR[localeFull] || localeFull };
  var currentDayRaw = DASHBOARD_DATA.todaysSessionRaw;
  /* Shared-device partner lookup, built once per render rather than per row. f3207 holds the
     partner's NAME as free text, so this indexes every roster record under both the name the
     CS sees and the legal name — a CS filling in Device Exception could reasonably have
     typed either. Lower-cased and trimmed on both sides; nothing fuzzier than that, because
     a near-match that resolves to the wrong participant is worse than no link at all. */
  var partnerIndex = {};
  registrations.forEach(function(r){
    var f = r['f2213//firstname'] || '', l = r['f2213//lastname'] || '', nl = r['f2213//f2792'] || '';
    [(f + ' ' + l), ((nl || f) + ' ' + l)].forEach(function(n){
      var key = n.trim().toLowerCase();
      if(key && !partnerIndex[key]) partnerIndex[key] = r;
    });
  });
  var html = registrations.map(function(reg){ return rosterBuildCardHtml(reg, currentDayRaw, localeAbbr, partnerIndex); }).join('');
  list.innerHTML = html;
  document.querySelectorAll('#rosterList .ev-card').forEach(updateProgramPills);
  /* The card header's "Showing N of M participants" line was removed 2026-08-15, and with
     it the `.card-hd .sub .mf` node this used to write. paginate() already maintains the
     real counts (#rosterShowingCount / #rosterTotalCount, both guarded), and pagination now
     states the position in the list at the point the CS acts on it. */
  rosterRenderAdvanced();
  rosterSyncInactiveButton();
  /* Re-apply before paginating. This runs on every Ably live push as well as
     the initial load, so without it an attendance change arriving mid-Forum
     would silently drop the CS's chosen sort back to server order. No-ops
     while the CS hasn't sorted. */
  rosterApplySort();
  paginate('roster');
}

/* ---------- Course Snapshot + Device & Zoom Reconciliation — real data
   render (CS Dashboard build, 2026-08-12; restructured 2026-08-14). Both
   tile sets now live in one tabbed #em-snapshot card on Event Management
   (#snap-course / #snap-device panes); the Master Stats mirror was deleted
   along with its nav tab. One shared dashboardRenderSnapshot() writes every
   data-stat on both panes regardless of which is visible, off the same
   registrations array Roster Fetch already returns, plus the eventFields/
   staffCount/staffPresence the webhook was extended to include.

   Tiles cut 2026-08-14: Final Session expected (formula never settled and CS
   confirmed they don't know what it means) and Completions (empty until the
   end of Day 3 — it lives on Reporting instead). Attendance now moved into
   the card's title bar. LDP and WBO merged into one split tile. PIQ added.
   Starts (Day 1) is no longer a permanent "—": it reads a locked value
   written at Day 1 close. Material Released tile cut entirely (locked
   spec). Reviewer/SE split into two single-stat tiles per the locked
   spec (was one combined "4/5" tile in the prototype).

   Detabbed and re-scoped 2026-08-15 to the client's locked 14-tile set (one 7x2
   grid — see the body block's #em-snapshot comment for the row semantics). Six
   keys the Event Management card no longer displays — seminarPct, acPct,
   invitationsSent, reviewer, se, drReconciled — are still computed and still
   written below on purpose: the Reporting Dashboard renders them off the same
   data-stat keys, and dashboardSetStat() writes every matching element on the
   page rather than a specific card. Deleting the computation to match the tile
   removal would have silently blanked Reporting.

   Four keys are new: totalRegistrations, wbs, absent, and drSharedCount, plus
   ldpPct/wboPct and the pna alias for piq. ---------- */
function dashboardFmtPct(num, den){ return den ? Math.round((num / den) * 100) + '%' : '—'; }
function dashboardSetStat(key, value){ document.querySelectorAll('[data-stat="' + key + '"]').forEach(function(el){ el.textContent = value; }); }
function dashboardSetSub(key, value){ document.querySelectorAll('[data-stat-sub="' + key + '"]').forEach(function(el){ el.textContent = value; }); }

function dashboardRenderSnapshot(registrations, eventFields, staffCount){
  eventFields = eventFields || {};
  staffCount = Number(staffCount || 0);

  /* Inactive registrations are excluded from EVERY metric below, not merely hidden in the
     list (client instruction 2026-08-15: "ignored for all reasons"). The split happens once,
     here, and every count downstream reads `active` — so there is no per-tile decision to
     get wrong and no way for one tile to disagree with another about who counts.

     `inactiveRows` is kept, not discarded, for exactly two purposes: the WBS tile, whose job
     is to count withdrawals, and the roster's Inactive view. Everything else ignores it.

     ONE deliberate exception, client-confirmed 2026-08-15: "Total event registrations" counts
     EVERY registration, inactive included. It is the only tile that answers "how many people
     ever registered for this event", so a withdrawal must not decrement it — otherwise the
     event appears to have been smaller than it was, and WBS would have nothing to be a
     proportion of. Every other number on the page, including the Reporting Dashboard's
     participant total, counts actives only.

     Hence two variables, named to make misuse obvious at the call site:
       totalAll  — every registration. Used by exactly one tile.
       total     — active registrations. The denominator for everything else. */
  var split = rosterSplitActive(registrations);
  var active = split.active;
  var inactiveRows = split.inactive;

  var totalAll = registrations.length;
  var total = active.length;
  var ldpRows = active.filter(function(r){ return String(r.f2293) === '1'; });
  var current = active.filter(function(r){ return String(r.f3046) !== '1' && String(r.f2293) !== '1'; }).length;
  var ldp = ldpRows.length;
  var wbo = active.filter(function(r){ return String(r.f2688) === '1'; }).length;
  var completions = active.filter(function(r){ return String(r.f2809) === '1'; }).length;
  var attendingNow = active.filter(function(r){ return String(r.f2853) === '1'; }).length;
  var seminarReg = active.filter(function(r){ return String(r.f2303) === '1'; }).length;
  var seminarPotential = active.filter(function(r){ return String(r.f2882) === '371'; }).length;
  var acReg = active.filter(function(r){ return String(r.f2302) === '1'; }).length;
  var acPotential = active.filter(function(r){ return String(r.f2887) === '382'; }).length;
  var invitationsWithGuests = active.filter(function(r){ return Number(r.f2272 || 0) > 0; }).length;
  var reviewer = active.filter(function(r){ return String(r.f3044) === '1'; }).length;
  var se = active.filter(function(r){ return String(r.f3046) === '1'; }).length;
  /* PNA (formerly PIQ) counts participants, not reasons — someone flagged both multi-device
     and unmatched is one person for a CS to work, and the tile is a workload number.
     rosterQueueReasons() is shared with the roster pills so the count and the pills can
     never disagree. Renamed on the tile 2026-08-15; the derivation is untouched. */
  var piqRows = active.filter(rosterIsQueued);
  var piq = piqRows.length;

  /* WBS — Withdraw Before Start. The one tile that reads the INACTIVE set, because counting
     withdrawals is what it is for; every other tile above ignores them. Counts the specific
     Withdraw option (f2424=491) rather than all inactive states, so if another non-Active
     option ever appears it is batched out of the roster without being silently miscounted
     as a withdrawal here. */
  var wbs = inactiveRows.filter(rosterIsWithdrawn).length;

  /* Absent — the manually-resolved absence states on f3191 Attendance Status: 467
     Absent-Excused and 468 Absent-NCNS. Both count, with the sub-label splitting them,
     because the tile answers "how many people are unaccounted for" and a CS needs the
     NCNS share of that to know how much of it is still chaseable.
     Currently-present records are excluded for the same reason rosterNameBadge() ranks
     LIVE above f3191: the T+20 sweep's Absent-NCNS is provisional until a CS confirms it,
     and a record reading Absent while the person is sitting in the meeting is simply
     wrong. Present wins, in the tile exactly as on the card. */
  var absentRows = active.filter(function(r){
    var s = String(r.f3191 || '');
    return (s === '467' || s === '468') && !rosterIsTrue(r.f2853);
  });
  var absent = absentRows.length;
  var absentNcns = absentRows.filter(function(r){ return String(r.f3191) === '468'; }).length;

  /* Starts (Day 1) — read, never derived. It is locked once by CS Dashboard : Day Advance
     when Day 1 closes (count of registrations present for D1S1 or D1S2, the 15-minute start
     threshold) precisely so it stops moving afterwards; recomputing it here from the live
     roster would defeat the entire point of locking it.

     Zero is treated as not-yet-locked rather than as a real count: Ontraport numeric fields
     default to the string "0" rather than empty, so there is no way to tell the two apart
     from the value alone — and a Forum where nobody at all started Day 1 does not happen. */
  var startsLocked = Number(eventFields.f3263 || 0);
  dashboardSetStat('starts', startsLocked > 0 ? startsLocked : '—');
  dashboardSetSub('starts', startsLocked > 0 ? 'locked at Day 1 close' : 'locks at Day 1 close');

  /* The one tile that counts inactive registrations too — see totalAll above. The sub-line
     says so when the two differ, because a CS comparing this against Active participants
     needs to know the gap is withdrawals rather than a miscount. */
  dashboardSetStat('totalRegistrations', totalAll);
  dashboardSetSub('totalRegistrations', inactiveRows.length
    ? total + ' active · ' + inactiveRows.length + ' inactive'
    : 'on the roster');
  // Numeric only — no sub-label. A headcount of withdrawals needs no qualifier.
  dashboardSetStat('wbs', wbs);
  dashboardSetStat('absent', absent);
  dashboardSetSub('absent', absent === 0 ? 'none outstanding' : absentNcns + ' NCNS · ' + (absent - absentNcns) + ' excused');

  dashboardSetStat('current', current);
  dashboardSetStat('ldp', ldp);
  dashboardSetStat('wbo', wbo);
  dashboardSetSub('wbo', wbo + ' of ' + total + ' participants');
  /* LDP and WBO are both rates over the SAME denominator: total participants.
     Corrected 2026-08-15 on client instruction — "WBO is not a sub number of Left. It's off
     the total of participants, same for LDP."

     Two things changed. WBO was a share of LDP, which framed it as a subset of those who
     left; it is now a share of all participants, so the two tiles are directly comparable
     and WBO no longer swings wildly on a small LDP count (1 of 2 people reading "50%").
     LDP's denominator also no longer switches to the locked Day 1 starts once that exists —
     a denominator that silently changes partway through the event makes the same tile mean
     two different things on Day 1 and Day 2, and the client has now specified which one it
     should be. Both read off `total`, which is active registrations. */
  dashboardSetStat('ldpPct', dashboardFmtPct(ldp, total));
  dashboardSetSub('ldpPct', 'of ' + total + ' participants');
  dashboardSetStat('wboPct', dashboardFmtPct(wbo, total));
  dashboardSetSub('wboPct', 'of ' + total + ' participants');
  dashboardSetStat('completions', completions);
  dashboardSetStat('attendanceNow', dashboardFmtPct(attendingNow, current));
  dashboardSetSub('attendanceNow', attendingNow + ' / ' + current);
  dashboardSetStat('seminarPct', dashboardFmtPct(seminarReg, seminarPotential));
  dashboardSetSub('seminarPct', seminarReg + ' of ' + seminarPotential + ' potential');
  dashboardSetStat('acPct', dashboardFmtPct(acReg, acPotential));
  dashboardSetSub('acPct', acReg + ' of ' + acPotential + ' potential');
  dashboardSetStat('invitationsSent', eventFields.f2266 != null ? eventFields.f2266 : '—');
  dashboardSetSub('invitationsSent', invitationsWithGuests + ' participants invited');
  dashboardSetStat('reviewer', reviewer);
  dashboardSetStat('se', se);
  /* Both keys, one number. 'pna' is what the tile reads today; 'piq' is kept written
     because it is the key the Reporting Dashboard and any saved view still reference —
     the rename was to the label, not to the measure. */
  dashboardSetStat('piq', piq);
  dashboardSetSub('piq', piq === 0 ? 'nothing outstanding' : piq + ' need CS action');
  dashboardSetStat('pna', piq);
  dashboardSetSub('pna', piq === 0 ? 'nothing outstanding' : piq + ' need CS action');

  // Raw counts (as opposed to the % tiles above) — needed for Reporting
  // Dashboard's Seminar/AC/Invitations bands, which show Potential/
  // Confirmed as their own tiles rather than folding straight into a %.
  dashboardSetStat('seminarPotentialCount', seminarPotential);
  dashboardSetSub('seminarPotentialCount', seminarPotential + ' invited');
  dashboardSetStat('seminarRegCount', seminarReg);
  dashboardSetStat('acPotentialCount', acPotential);
  dashboardSetSub('acPotentialCount', acPotential + ' invited');
  dashboardSetStat('acRegCount', acReg);
  dashboardSetStat('participantsWhoInvited', invitationsWithGuests);
  dashboardSetSub('participantsWhoInvited', dashboardFmtPct(invitationsWithGuests, total) + ' of the course');

  /* Device & Zoom reconciliation, corrected 2026-08-14. Both sides of this comparison are
     HEADCOUNTS, not device counts: attendingNow counts registrations with f2853=1, one per
     person however many devices they are on, and staffCount counts oEventTeam rows with
     f3218=1. The tile labels said "devices" but nothing here ever had a device count to
     work from — the dashboard never receives Zoom's live connection total. So the formula
     is expressed in people, and the two adjustments are applied on that basis.

     Shared device: two people on one connection, so Zoom reports one registrant_id and only
     one of them can ever be observed present. That is a real subtraction from what we can
     expect to see — one per pair.

     Multi-device: one person on two connections is still one person and still one f2853=1,
     so it does NOT move a headcount either way. It used to be subtracted, which quietly
     made expected too low by one per occurrence. It is now surfaced as its own informational
     count rather than folded into the arithmetic. */
  var sharedDeviceCount = active.filter(function(r){ return String(r.f3207 || '').trim() !== ''; }).length;
  var sharedAdj = -Math.floor(sharedDeviceCount / 2);
  /* Counts the poller's auto-detected f3184 as well as the CS-declared f3208=474, so the
     tile moves when the Zoom poller raises multi-device on its own — previously only a
     manual Device Exception save could shift it, leaving it at 0 all session while the
     roster showed MULTI-DEVICE pills. */
  var multiDeviceCount = active.filter(function(r){ return String(r.f3208) === '474' || rosterIsTrue(r.f3184); }).length;
  /* Built from `current`, never `total`: total includes withdrawn and LDP records, who are
     never going to appear in Zoom, so a single cancellation made ✓ permanently unreachable
     for the whole event. */
  var expected = current + staffCount + sharedAdj;
  var observed = attendingNow + staffCount;
  var reconciled = expected === observed;

  dashboardSetStat('drParticipants', total);
  dashboardSetStat('drStaff', staffCount);
  dashboardSetStat('drSharedAdj', sharedAdj);
  /* The Shared device tile shows the headcount of people paired on a shared connection —
     the plain count of the flag. drSharedAdj (the negative half-pair correction the
     Expected arithmetic applies) is still written for anything reading that key, but it is
     the wrong number to put on a tile labelled "Shared device": a CS reading "-3" would
     reasonably assume something had gone wrong rather than that six people are doubled up. */
  dashboardSetStat('drSharedCount', sharedDeviceCount);
  dashboardSetSub('drSharedCount', sharedDeviceCount === 0 ? 'none reported' : 'expected count adjusted by ' + sharedAdj);
  dashboardSetStat('drDupAdj', multiDeviceCount);
  /* Drop-in viewers — events.f3262, written by LM | Zoom | Live Attendance Poller for live
     participants matching neither a Registration nor an oEventTeam row. Read straight off
     eventFields like the other Event-level numbers, so it does not matter whether the value
     arrived on a full Roster Fetch or live via event.metric.changed. */
  dashboardSetStat('drDropIns', Number(eventFields.f3262 || 0));
  dashboardSetStat('drExpected', expected);
  dashboardSetStat('drObserved', observed);
  dashboardSetStat('drReconciled', reconciled ? '✓' : '✗');
  dashboardSetSub('drReconciled', observed + ' / ' + expected + (reconciled ? ' · reconciled' : ' · ' + Math.abs(expected - observed) + ' unresolved'));
  /* Live now's own sub, rather than borrowing drReconciled's. That string is written for a
     tile whose VALUE is a ✓/✗ and so has to restate both sides of the comparison — on Live
     now it repeated the number already printed directly above it ("27" over "27 / 53"). This
     says only the part Live now doesn't already show: how far off expected it is, and in
     which direction. Reporting's Reconciled tile keeps the fuller string above. */
  var gap = observed - expected;
  dashboardSetSub('drObserved', reconciled
    ? 'matches expected'
    : (gap > 0 ? '+' + gap + ' more than expected' : Math.abs(gap) + ' fewer than expected'));
}

function dashboardFetchRoster(){
  fetch(DASHBOARD_ROSTER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    /* Single choke point for the test-registration exclusion: every later consumer reads
       either this local `registrations` or dashboardLastRoster, and both are the filtered
       array. Note the two counts this does NOT reach, because they are computed server-side
       and never pass through here: Home's participantCount/notReadyCount from
       CS Dashboard : Bootstrap (step 3/4 of the bootstrap spec count registrations with
       "no exclusions of any kind"). Those need the same f2878 exclusion added to the n8n
       workflow, or Home will keep counting test records the roster no longer shows. */
    var registrations = rosterExcludeTestRegistrations(r.result.registrations);
    dashboardRenderRoster(registrations);
    dashboardRenderSnapshot(registrations, r.result.eventFields, r.result.staffCount);
    dashboardLastRoster = registrations;
    dashboardLastEventFields = r.result.eventFields;
    dashboardLastStaffCount = r.result.staffCount;
    dashboardLastStaffPresence = {};
    (r.result.staffPresence || []).forEach(function(s){ dashboardLastStaffPresence[String(s.id)] = !!s.present; });
    dashboardRenderGuestSnapshot();
  }).catch(function(err){
    console.error('dashboardFetchRoster failed:', err);
  });
}

/* ---------- Guests — real data render (CS Dashboard build, 2026-08-12;
   write-back added 2026-08-12). dashboardFetchGuests() calls the
   dashboard-guests webhook, dashboardRenderGuests() replaces the prototype's
   fixture .ev-card rows with real ones from oInvitations.
   Real spec-vs-prototype gap found: invitations.f2959/f2960 (Guest First/Last Name)
   are blank on every real record (confirmed via live event 218 data) — the actual
   name lives on the linked Guest Contact (f2259) via f2259//firstname/f2259//lastname.
   FS # column and the SE/Under-18/TOS/ENG pill row are cut — no confirmed in-scope
   field mapping for them this pass. REG (Forum) and ADV. CRS reuse the roster's
   NP/POT/REG pill styling (not toggle chips), per the locked spec, and stay
   read-only this pass (client-confirmed scope: chips + notes only — pill editing
   and guest-participant re-association are separate future passes). Format reuses
   the same event-level value the roster shows (not per-guest).
   Write-back scope (client-confirmed 2026-08-12): the 3 boolean chips
   (After 7:30pm/Attend/LF Grad?, via CS Dashboard : Guest Toggle,
   invitations.f2966/f3210/f2292) and Notes (via CS Dashboard : Guest Add
   Note, append-only to invitations.f3214, same pattern as the roster's Add
   Note). Both reuse dashboardFetchGuests() to refresh from server truth on
   success. ---------- */
var DASHBOARD_GUESTS_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-guests';
var GUEST_NP_REASON_MAP = { '413':'Guest of SE participant', '414':'Under 18', '415':'Requires translation, no Forum in their language available', '416':'Registered for the LF prior to attending', '417':'Previously completed the LF' };
var GUEST_AC_NP_REASON_MAP = { '476':'Already Registered For AC', '477':"Hasn't gone through LF" };

function guestEscAttr(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
function guestEscHtml(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function guestIsTrue(v){ return v === '1' || v === 1 || v === true; }

function guestProgPill(kind, registered, potential, reasonCode, reasonMap){
  var cls, label, kv;
  if(registered){ cls = 'p-pot'; label = 'REG'; kv = [['Status','Registered']]; }
  else if(potential){ cls = 'p-neutral'; label = 'POT'; kv = [['Status','Potential']]; }
  else { cls = 'p-neutral'; label = 'NP'; kv = [['Status','Non-Potential'], ['Reason', reasonMap[String(reasonCode || '')] || '—']]; }
  return '<button class="pill ' + cls + ' ev-clickable prog-' + kind + '" data-reg="' + (registered ? 1 : 0) + '" onclick="openDetailPop(this)" data-pop-title="' + (kind === 'ac' ? 'Advanced Course' : 'Forum') + ' Registration" data-pop-kv=\'' + guestEscAttr(JSON.stringify(kv)) + '\'>' + label + '</button>';
}

function guestBuildCardHtml(inv, localeAbbr){
  var guestFirst = inv['f2259//firstname'] || '';
  var guestLast = inv['f2259//lastname'] || '';
  var guestName = (guestFirst + ' ' + guestLast).trim() || 'Unknown Guest';
  var invFirst = inv['f2257//firstname'] || '';
  var invLast = inv['f2257//lastname'] || '';
  var invNameLikes = inv['f2257//f2792'] || '';
  var inviterDisplay = ((invNameLikes || invFirst) + ' ' + invLast).trim() || 'Not associated';
  var searchStr = (guestName + ' ' + inviterDisplay).toLowerCase();

  var after730 = guestIsTrue(inv.f2966);
  var attended = guestIsTrue(inv.f3210);
  var lfGrad = guestIsTrue(inv.f2292);

  function regChip(on, label, key){
    return '<button class="togchip chip-check' + (on ? ' on' : '') + '" data-key="' + key + '" onclick="toggleGuestChip(this)" title="' + label + (on ? ': Yes' : ': No') + '"><span class="dot"></span></button>';
  }

  var regPill = guestProgPill('lf', guestIsTrue(inv.f2299), guestIsTrue(inv.f3211), inv.f3050, GUEST_NP_REASON_MAP);
  var acPill = guestProgPill('ac', guestIsTrue(inv.f2298), guestIsTrue(inv.f3212), inv.f3213, GUEST_AC_NP_REASON_MAP);

  var notes = inv.f3214 || '';
  var notesBtn = '<button class="ev-notesbtn' + (notes ? ' has-note' : '') + '" onclick="openNotes(this)" title="Operational note" aria-label="Operational note"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h10a1 1 0 0 1 1 1v8l-3 3H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M7 8h6M7 11h4"/></svg></button>';

  return '<div class="ev-card" data-search="' + guestEscAttr(searchStr) + '" data-inv-id="' + guestEscAttr(inv.id) + '">' +
    '<div class="ev-row1">' +
      '<div class="ev-name"><b>' + guestEscHtml(guestName) + '</b><div class="ev-sub">Invited by ' + guestEscHtml(inviterDisplay) + '</div></div>' +
      '<div class="ev-field"><div class="ev-l">After 7:30pm</div>' + regChip(after730, 'After 7:30pm', 'after730') + '</div>' +
      '<div class="ev-field"><div class="ev-l">Attend</div>' + regChip(attended, 'Attend', 'attend') + '</div>' +
      '<div class="ev-field"><div class="ev-l">Format</div><span class="pill p-locale">' + guestEscHtml(localeAbbr.abbr) + '</span></div>' +
      '<div class="ev-field"><div class="ev-l">LF Grad?</div>' + regChip(lfGrad, 'LF Grad', 'lfGrad') + '</div>' +
      '<div class="ev-field"><div class="ev-l">REG</div>' + regPill + '</div>' +
      '<div class="ev-field"><div class="ev-l">ADV. CRS</div>' + acPill + '</div>' +
      '<div class="ev-field"><div class="ev-l">Notes</div>' + notesBtn + '</div>' +
    '</div>' +
  '</div>';
}

function toggleGuestChip(btn){
  if(btn.disabled) return;
  var card = btn.closest('.ev-card');
  var invId = Number(card.dataset.invId);
  var key = btn.dataset.key;
  var wasOn = btn.classList.contains('on');
  var newValue = !wasOn;
  btn.disabled = true;
  btn.classList.toggle('on', newValue);
  fetch(DASHBOARD_GUEST_TOGGLE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId, invitationId: invId, key: key, value: newValue })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    btn.disabled = false;
    btn.title = btn.title.replace(/: (Yes|No)$/, newValue ? ': Yes' : ': No');
    logAudit('staff', currentActorName() + ' set guest ' + key + ' = ' + newValue);
  }).catch(function(err){
    console.error('toggleGuestChip failed:', err);
    btn.classList.toggle('on', wasOn);
    btn.disabled = false;
    toast('Could not save — try again.', 'err');
  });
}

function dashboardRenderGuests(guests){
  var list = document.getElementById('guestList');
  var localeFull = dashboardEventFormat();
  var localeAbbr = { full: localeFull, abbr: ROSTER_LOCALE_ABBR[localeFull] || localeFull };
  var html = guests.map(function(inv){ return guestBuildCardHtml(inv, localeAbbr); }).join('');
  list.innerHTML = html || '<div class="tokline" style="padding:12px 20px;">No guests recorded yet for this event.</div>';
  var totalEl = list.closest('.card').querySelector('.card-hd .sub .mf');
  if(totalEl) totalEl.textContent = guests.length;
  paginate('guest');
}

/* ---------- Guest Snapshot — real data render (CS Dashboard build,
   2026-08-12). Needs BOTH the roster (for the less-SE participant
   denominator) and the guests array (for grad/non-grad + distinct-guest
   counting) — dashboardFetchRoster()/dashboardFetchGuests() run roughly
   in parallel on page load, so this only computes once both have landed
   (dashboardLastRoster/dashboardLastGuests/dashboardLastEventFields),
   called from both fetch callbacks. Shared data-stat="gs*" hooks drive
   both #em-guest-snapshot (Event Management > Guests) and the Reporting
   Dashboard's "Landmark Forum / guests" band — same underlying numbers,
   per the locked spec ("same data as Guest Snapshot"); Reporting's GP100
   tile reuses gsGph directly (Reporting shows one combined tile, no
   separate GGPH — Guest Snapshot itself keeps GPH/GGPH as two tiles). ---------- */
var dashboardLastRoster = null;
var dashboardLastGuests = null;
var dashboardLastEventFields = null;
var dashboardLastStaffCount = 0;
/* Per-row oEventTeam presence, keyed by row id. Seeded by dashboardFetchRoster() from the
   staffPresence array Roster Fetch was extended to return (2026-08-14), then maintained by
   dashboardApplyStaffChanged(). Null until the first successful fetch. */
var dashboardLastStaffPresence = null;
function dashboardRenderGuestSnapshot(){
  if(!dashboardLastRoster || !dashboardLastGuests || !dashboardLastEventFields) return;
  var roster = dashboardLastRoster;
  var guests = dashboardLastGuests;
  var ev = dashboardLastEventFields;
  var participantsLessSE = roster.filter(function(r){ return String(r.f3046) !== '1'; }).length;

  var invitationsSent = ev.f2266 != null ? ev.f2266 : 0;
  var perParticipant = participantsLessSE ? (invitationsSent / participantsLessSE).toFixed(1) : '—';

  var distinctGuestIds = {};
  guests.forEach(function(g){ if(g.f2259) distinctGuestIds[g.f2259] = true; });
  var totalGuests = Object.keys(distinctGuestIds).length;
  var pctOfInvitations = invitationsSent ? Math.round((totalGuests / invitationsSent) * 100) + '%' : '—';

  var gph = Number(ev.f2306 || 0) + Number(ev.f2307 || 0);
  var ggph = Number(ev.f2307 || 0);
  var rph = participantsLessSE ? Math.round((Number(ev.f2301 || 0) / participantsLessSE) * 100) + '%' : '—';

  var nonGradGuests = guests.filter(function(g){ return String(g.f2292) !== '1'; });
  var gradGuestsCount = guests.length - nonGradGuests.length;
  var nonGradRegistered = nonGradGuests.filter(function(g){ return String(g.f2299) === '1'; }).length;
  var forumRegEff = nonGradGuests.length ? Math.round((nonGradRegistered / nonGradGuests.length) * 100) + '%' : '—';

  dashboardSetStat('gsInvitationsSent', invitationsSent);
  dashboardSetSub('gsInvitationsSent', perParticipant + ' per participant');
  dashboardSetStat('gsTotalGuests', totalGuests);
  dashboardSetSub('gsTotalGuests', pctOfInvitations + ' of invitations');
  dashboardSetStat('gsGph', gph);
  dashboardSetStat('gsGgph', ggph);
  dashboardSetStat('gsRph', rph);
  dashboardSetStat('gsForumRegEff', forumRegEff);
  dashboardSetSub('gsForumRegEff', nonGradRegistered + ' ÷ ' + nonGradGuests.length + ' non-graduate guests');
  dashboardSetStat('gsGradGuests', gradGuestsCount);
  dashboardSetStat('gsNonGradGuests', nonGradGuests.length);
}

function dashboardFetchGuests(){
  fetch(DASHBOARD_GUESTS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    dashboardRenderGuests(r.result.guests);
    dashboardLastGuests = r.result.guests;
    dashboardRenderGuestSnapshot();
  }).catch(function(err){
    console.error('dashboardFetchGuests failed:', err);
  });
}

function dashboardRenderHome(){
  var first = DASHBOARD_DATA.csFirstName;
  var last = DASHBOARD_DATA.csLastName;
  document.getElementById('pcName').textContent = [first, last].filter(Boolean).join(' ');
  document.getElementById('pcRole').textContent = dashboardCsRole();
  document.getElementById('homeGreetName').textContent = first;
  // Event Title (f3040) is an optional field and is blank on most real
  // events (confirmed live on event 218) -- fall back to the Course name
  // so the card/selector never render an empty headline.
  var displayEventTitle = DASHBOARD_DATA.eventTitle || DASHBOARD_DATA.courseName || '—';
  document.getElementById('evtSelName').textContent = displayEventTitle;
  document.getElementById('evtSelCourseFormat').textContent =
    (DASHBOARD_DATA.courseName || '—') + ' · ' + dashboardEventFormat();
  document.getElementById('evtLeaderName').textContent = DASHBOARD_DATA.eventLeaderName || '—';
  document.getElementById('evtCardTitle').textContent = displayEventTitle;
  document.getElementById('evtCardDates').textContent =
    formatEventDateRange(DASHBOARD_DATA.eventStartDate, DASHBOARD_DATA.eventEndDate);
  document.getElementById('evtCardParticipants').textContent =
    DASHBOARD_DATA.participantCount == null ? '—' : DASHBOARD_DATA.participantCount;
  document.getElementById('evtCardNotReady').textContent =
    DASHBOARD_DATA.notReadyCount == null ? '—' : DASHBOARD_DATA.notReadyCount;
  document.querySelector('.evt-card').dataset.regId = DASHBOARD_DATA.eventId;
}

function dashboardRenderSessionStrip(){
  document.getElementById('esDayLabel').textContent = dashboardTodaysSession();
}

/* formatEventDateRange() — same Date.parse() fallback pattern as
   Portal.dateUtil.parseDate() in member-portal.html; Ontraport
   fulldate fields render in a browser-Date-parseable default format. */
function formatEventDateRange(startRaw, endRaw){
  var s = new Date(startRaw), e = new Date(endRaw);
  if(isNaN(s) || isNaN(e)) return startRaw + ' – ' + endRaw;
  var optsFull = {weekday:'short', month:'short', day:'numeric'};
  var optsDay = {weekday:'short', day:'numeric'};
  return s.toLocaleDateString('en-US', optsDay) + ' - ' + e.toLocaleDateString('en-US', optsFull) + ', ' + e.getFullYear();
}

var currentView = 'home';
var pageState = { roster: 1, guest: 1 };

function currentActorName(){ return DASHBOARD_DATA.csFirstName; }
function currentRoleLabel(){ return dashboardCsRole(); }

/* ---------- sticky header stack ----------
   Three stacked position:sticky bars, each of which has to dock directly
   below the one above it:
     1 .topbar    logo / event selector / Day X of Y / End session / profile
     2 .tabbar    Event Management / Reporting Dashboard  — hidden on Home
     3 .secnav    Roster & Classification / Course Materials / Guests
                                                          — Event Management only

   Was four bars until 2026-08-15: .evtstrip, a dedicated dark band holding only the
   Day indicator and End session, was removed and both controls folded into .topbar.
   That is why --stick-evtstrip is gone rather than merely unused — nothing docks
   against it any more, and leaving it published would have been a variable the
   stylesheet could silently read a stale value from.

   Those dock offsets used to be hardcoded (top:64px / 114px / 156px): a sum
   of the heights this stylesheet *intends* each bar to have. That is correct
   in isolation and wrong inside Ontraport, whose own page CSS competes on
   typography and can render a bar taller than the 64/50/42px assumed here.
   The moment any bar is taller than its assumption, every offset below it is
   short by the difference, and that bar docks *behind* its predecessor rather
   than beneath it — which is exactly how the Event Management sub-nav ended
   up tucked under .tabbar, visibly pinned but ~20px too high.

   Measuring beats asserting. Read the real rendered heights and publish the
   running totals as CSS custom properties the stylesheet consumes, so the
   stack self-corrects against whatever Ontraport does to it. The stylesheet
   keeps the old literals as var() fallbacks, so nothing regresses if this
   never runs. Bars that are hidden (body.home, or .secnav outside Event
   Management) measure 0 and collapse out of the sum on their own. */
function dashboardBarHeight(sel){
  var el = document.querySelector(sel);
  if(!el) return 0;
  /* Fractional height on purpose — rounding down leaves a 1px sliver of
     scrolling content visible in the seam between two bars. */
  return el.getBoundingClientRect().height || 0;
}
function dashboardSyncStickyOffsets(){
  var root = document.documentElement;
  var topbar = dashboardBarHeight('.topbar');
  var tabbar = dashboardBarHeight('.tabbar');
  root.style.setProperty('--stick-tabbar', topbar + 'px');
  root.style.setProperty('--stick-secnav', (topbar + tabbar) + 'px');
}
var dashboardStickySyncQueued = false;
function dashboardQueueStickySync(){
  if(dashboardStickySyncQueued) return;
  dashboardStickySyncQueued = true;
  requestAnimationFrame(function(){
    dashboardStickySyncQueued = false;
    dashboardSyncStickyOffsets();
  });
}
window.addEventListener('resize', dashboardQueueStickySync);
/* A webfont swapping in after first paint changes bar heights, and Ontraport
   loads its own fonts — re-measure once the swap has settled. Guarded because
   document.fonts is absent in older browsers. */
if(document.fonts && document.fonts.ready && document.fonts.ready.then){
  document.fonts.ready.then(dashboardQueueStickySync).catch(function(){});
}

/* ---------- navigation ---------- */
function go(view){
  currentView = view;
  document.body.classList.toggle('home', view === 'home');
  document.querySelectorAll('.view').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('v-' + view).classList.add('active');
  document.querySelectorAll('.tabbar button[data-v]').forEach(function(b){ b.classList.toggle('active', b.dataset.v === view); });
  document.getElementById('secnav').style.display = view === 'em' ? '' : 'none';
  /* Home hides .tabbar/.secnav and the other views hide .secnav, so the stack's
     total height changes on every view switch — re-measure before the next paint
     or the remaining bars keep the previous view's offsets. */
  dashboardSyncStickyOffsets();
  window.scrollTo({top:0, behavior:'instant'});
}

/* snapTab() was deleted 2026-08-15 along with the Course snapshot / Device & Zoom
   reconciliation tabs it switched between — the card now renders one 7x2 grid with nothing
   to switch. Removed rather than left in place because a live onclick handler with no
   matching markup is a trap for whoever next reads the body block looking for the tabs. */

function emTab(btn, key){
  document.querySelectorAll('#secnav button').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.emview').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('em-' + key).classList.add('active');
}

/* ---------- Home (§0x) — Start Event is the only door into the
   dashboard chrome; go('em') already handles showing it (body.home
   toggle above). Previously ignored data-reg-id entirely (Phase 2
   punchlist item) — now threads the clicked card's real Event ID
   into dashboardActiveEventId, which every later Event Management/
   Master Stats/Guests fetch call keys off of. Single-card today
   (this pilot demos exactly one authorized Event per §2), but this
   makes the card loop safe to extend to multiple Events later
   without revisiting startEvent() itself. ---------- */
var dashboardActiveEventId = null;
function startEvent(btn){
  var card = btn.closest('.evt-card');
  dashboardActiveEventId = card ? card.dataset.regId : DASHBOARD_DATA.eventId;
  logAudit('staff', currentActorName() + ' started the event — entering dashboard');
  go('em');
}
function openEventCardMenu(btn){
  closeDetailPop();
  var menu = document.getElementById('eventCardMenu');
  positionFloating(menu, btn);
  menu.classList.add('open');
}
function closeEventCardMenu(){ document.getElementById('eventCardMenu').classList.remove('open'); }
function eventCardMenuAction(which){
  closeEventCardMenu();
  if(which === 'roster') openHomeRoster(false);
  else if(which === 'exceptions') openHomeRoster(true);
  else if(which === 'assignments') openModal('mAssignments');
}
function openHomeRoster(onlyExceptions){
  document.getElementById('hrTitle').textContent = onlyExceptions ? 'Exceptions — The Landmark Forum - Online' : 'Roster — The Landmark Forum - Online';
  document.getElementById('hrSub').textContent = onlyExceptions ? '18 participants need attention before this Forum can begin.' : '188 on oRegistrations for this Event · showing 12.';
  document.querySelectorAll('#homeRosterList .hr-row:not(.hd)').forEach(function(row){
    row.style.display = (!onlyExceptions || row.classList.contains('needsattn')) ? '' : 'none';
  });
  openModal('mHomeRoster');
}

/* ---------- Participant quick-view popout (§0x) — the Home roster's
   own lightweight "who is this" lookup: Name, Contact, Preferred
   Communication, and the Forum Information Form answers, or a notice
   that the form hasn't been submitted (driven by data-fif, the same
   flag the READY/NEEDS ATTENTION tag reads). Deliberately not the
   Event Management roster's View Participant Details drawer — that
   component assumes .ev-card's DOM shape (Spouse combo, Follow-On
   pills, etc.) and covers a wider, editable surface; this is a
   read-only subset scoped to what the Home roster needs. ---------- */
function openParticipantQuickView(btn){
  var row = btn.closest('.hr-row');
  var nameEl = row.querySelector('.hr-name b');
  var legalEl = row.querySelector('.hr-name > span');
  var name = nameEl ? nameEl.textContent : 'Participant details';
  document.getElementById('qvName').textContent = name;
  document.getElementById('qvLegalPid').textContent = legalEl ? legalEl.textContent : '';
  var emailEl = document.getElementById('qvEmail');
  emailEl.textContent = row.dataset.email || '—';
  emailEl.href = row.dataset.email ? 'mailto:' + row.dataset.email : '#';
  var phoneEl = document.getElementById('qvPhone');
  phoneEl.textContent = row.dataset.phone || '—';
  phoneEl.href = row.dataset.phone ? 'tel:' + row.dataset.phone.replace(/[^\d+]/g, '') : '#';
  /* Deliberately still '—', unlike the Event Management drawer which now
     reads registrations.f2993. This popout hangs off the Home roster, which
     is still static prototype markup with no registration binding — .hr-row
     has no data-reg-id, and the data-email/data-phone read above resolve to
     nothing for the same reason. Wiring f2993 here is blocked on rebuilding
     the Home roster from real data, not on the field mapping. */
  document.getElementById('qvPreferredComm').textContent = '—';
  var submitted = row.dataset.fif === '1';
  document.getElementById('qvFormKv').style.display = submitted ? '' : 'none';
  document.getElementById('qvFormNotice').style.display = submitted ? 'none' : '';
  if(submitted) document.getElementById('qvFormKv').innerHTML = buildInformationFormKv();
  openModal('mParticipantQuickView');
}
/* Home roster popout's form block. Every value here was fixture data too
   (same fabricated emergency contact as the drawer). Unlike the drawer this
   surface has no registration record to read from — #homeRosterList's rows
   are static prototype markup in INSTALL-dashboard-body-block.html that
   openHomeRoster() only shows/hides, so there is no regId to look up. Until
   that roster is rendered from real data, this reports the values as
   unavailable rather than inventing them. */
function buildInformationFormKv(){
  var rows = [
    'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship',
    'Coaching Call Availability', 'Agreed to Registration Policies', 'Agreed to Privacy Policy',
    'Agreed to Terms of Use', 'Anything you’d like us to know?',
    'Dietary Restrictions / Special Needs', 'Forum Participants You Know', 'What I Want to Accomplish'
  ];
  return rows.map(function(k){
    return '<span class="k">' + k + '</span><span class="v">—</span>';
  }).join('');
}

/* ---------- profile chip: logout-only, no role switching ---------- */
function toggleProfileMenu(e){ e.stopPropagation(); document.getElementById('profileMenu').classList.toggle('open'); }
/* dashboardLogout() — same mechanism as the Member Portal's logoutBtn
   handler (portal-engine.js), added there first since no documented
   public API exists for a custom-page Ontraport logout link. Directly
   expiring the OPWSESS_* session cookie client-side was rejected by
   Ontraport's Custom HTML editor as "suspicious" on save (its own
   scanner catching the read-cookie-then-reassign-with-widened-domain
   shape, which looks like session hijacking even though it wasn't).
   logout=true is a real, server-recognized signal instead (found live
   in Ontraport's own generated "already logged in" form on /login) --
   surfaces Ontraport's native confirmation screen, not an instant
   single-step logout, but it does correctly clear the session. */
function dashboardLogout(){
  window.location.href = window.location.origin + '/login?logout=true';
}
document.addEventListener('click', function(e){
  var menu = document.getElementById('profileMenu');
  if(menu && menu.classList.contains('open') && !e.target.closest('#profileMenu') && !e.target.closest('#profileChip')) menu.classList.remove('open');
  var pop = document.getElementById('detailPop');
  if(pop && pop.classList.contains('open') && !e.target.closest('#detailPop') && !e.target.closest('.ev-clickable') && !e.target.closest('.tick') && !e.target.closest('.tick-exception')) closeDetailPop();
  var rmenu = document.getElementById('rowMenu');
  if(rmenu && rmenu.classList.contains('open') && !e.target.closest('#rowMenu') && !e.target.closest('.kebab-btn')) closeRowMenu();
  var ecmenu = document.getElementById('eventCardMenu');
  if(ecmenu && ecmenu.classList.contains('open') && !e.target.closest('#eventCardMenu') && !e.target.closest('.evt-card')) closeEventCardMenu();
  var taMenu = document.getElementById('takeAttendanceMenu');
  if(taMenu && taMenu.classList.contains('open') && !e.target.closest('#takeAttendanceMenu') && !e.target.closest('#takeAttendanceBtn')) closeTakeAttendanceMenu();
  var sortMenu = document.getElementById('rosterSortMenu');
  if(sortMenu && sortMenu.classList.contains('open') && !e.target.closest('#rosterSortMenu') && !e.target.closest('#rosterSortBtn')) closeRosterSortMenu();
});

/* ---------- End session — review-first confirmation. Confirming submits
   every entry recorded for the day as final; there is no quiet one-click
   path. Writes events.f3025 via the dashboard-day-advance webhook, which
   already triggers the existing Ably participant-notification pipeline
   (day-advance is one of its 7 watched fields) — no separate publish
   call needed here. ---------- */
var DASHBOARD_DAY_ADVANCE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-day-advance';
var DASHBOARD_UPDATE_COURSE_STATUS_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-update-course-status';
var DASHBOARD_DEVICE_EXCEPTION_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-device-exception';
var DASHBOARD_OVERRIDE_CLASSIFICATION_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-override-classification';
var DASHBOARD_CORRECT_ATTENDANCE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-correct-attendance';
var DASHBOARD_TAKE_ATTENDANCE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-take-attendance';
var DASHBOARD_ADD_NOTE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-add-note';
var DASHBOARD_GUEST_TOGGLE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-guest-toggle';
var DASHBOARD_GUEST_ADD_NOTE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/dashboard-guest-add-note';
function openEndSessionModal(){
  var label = dashboardTodaysSessionShort();
  document.getElementById('esmTitleDay').textContent = label;
  document.getElementById('esmBodyDay').textContent = label;
  openModal('mEndSession');
}
function confirmEndSession(){
  var confirmBtn = document.getElementById('btnConfirmEndSession');
  var originalLabel = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Ending session…';
  fetch(DASHBOARD_DAY_ADVANCE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    var endedLabel = SHORT_DAY_MAP[r.result.previousDayRaw] || r.result.previousDayRaw;
    DASHBOARD_DATA.todaysSessionRaw = r.result.newDayRaw;
    dashboardRenderSessionStrip();
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalLabel;
    closeAll();
    var sessBtn = document.getElementById('btnSession');
    sessBtn.textContent = 'Session ended';
    sessBtn.disabled = true;
    document.getElementById('evtStatusPill').style.display = '';
    logAudit('staff', currentActorName() + ' ended the session for ' + endedLabel + ' — entries submitted');
    go('home');
    toast('Session ended. ' + endedLabel + ' entries submitted.');
  }).catch(function(err){
    console.error('confirmEndSession failed:', err);
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Could not end session — try again';
    setTimeout(function(){ confirmBtn.textContent = originalLabel; }, 2600);
  });
}
/* ---------- drawers / modals / toast ----------
   modalStack (§0x) — when a modal is opened while another modal is
   already open (currently only mNotes/mParticipantQuickView from
   within mHomeRoster), the one underneath is remembered instead of
   discarded. dismissModal() — the "Close"/"Cancel"/Escape/scrim path
   — pops back to it rather than clearing everything; closeAll() stays
   a hard, full close (End Session's exit-to-Home flow, and dismissModal()'s
   own base case when nothing is nested). ---------- */
var modalStack = [];
function openDrawer(id){
  modalStack = [];
  document.querySelectorAll('.dw.open, .modal.open').forEach(function(el){ el.classList.remove('open'); });
  closeDetailPop(); closeRowMenu(); closeEventCardMenu();
  document.getElementById(id).classList.add('open');
  document.getElementById('scrim').classList.add('open');
}
function openModal(id){
  var current = document.querySelector('.modal.open');
  if(current && current.id !== id) modalStack.push(current.id); else modalStack = [];
  document.querySelectorAll('.dw.open, .modal.open').forEach(function(el){ el.classList.remove('open'); });
  closeDetailPop(); closeRowMenu(); closeEventCardMenu();
  document.getElementById(id).classList.add('open');
  document.getElementById('scrim').classList.add('open');
}
function closeAll(keepScrim){
  modalStack = [];
  document.querySelectorAll('.dw.open, .modal.open').forEach(function(el){ el.classList.remove('open'); });
  closeDetailPop();
  closeRowMenu();
  closeEventCardMenu();
  if(!keepScrim) document.getElementById('scrim').classList.remove('open');
}
function dismissModal(){
  /* Clear any blocked-submit message so a reopened modal never shows the previous attempt's
     complaint against a field the CS has since filled in. Also covers the success path,
     where no new prompt is raised and the old one would otherwise linger. */
  attnClearPrompt(document);
  if(modalStack.length){
    var prevId = modalStack.pop();
    document.querySelectorAll('.modal.open').forEach(function(el){ el.classList.remove('open'); });
    closeDetailPop(); closeRowMenu(); closeEventCardMenu();
    document.getElementById(prevId).classList.add('open');
  } else {
    closeAll();
  }
}
var toastTimer;
function toast(msg, kind){
  var t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.toggle('err', kind === 'err');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 3200);
}
function tog(el){ el.classList.toggle('on'); }
/* Escape used to dismiss modals only, so the three lighter-weight overlays this page also
   opens — the anchored detail popover, the row kebab menu, and the Advanced search panel —
   had no keyboard dismissal at all. They close innermost-first: a CS with a popover open on
   top of the Advanced panel expects one Escape to close the popover, not both. */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var pop = document.getElementById('detailPop');
  var rowMenu = document.getElementById('rowMenu');
  var advPanel = document.getElementById('rosterAdvPanel');
  if(pop && pop.classList.contains('open')){ closeDetailPop(); return; }
  if(rowMenu && rowMenu.classList.contains('open')){ closeRowMenu(); return; }
  var sortMenu = document.getElementById('rosterSortMenu');
  if(sortMenu && sortMenu.classList.contains('open')){ closeRosterSortMenu(); return; }
  if(document.querySelector('.modal.open, .drawer.open, .scrim.show')){ dismissModal(); return; }
  if(advPanel && !advPanel.hidden){ rosterToggleAdvanced(); return; }
  dismissModal();
});

/* Enter/Space on anything marked role="button" that is not already a real <button>.
   Several controls on this page are clickable <div>s — the snapshot stat tiles and the
   shared-device avatar stack — which means they are unreachable by keyboard however they
   are styled. Making them focusable in the markup (tabindex/role) only gets them focus;
   a div does not fire click on Enter or Space the way a button does, so without this a
   keyboard user could tab onto a tile and have nothing happen when they pressed it.
   Delegated rather than per-element so any future role="button" div is covered too. */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  var el = e.target;
  if(!el || typeof el.closest !== 'function') return;
  var target = el.closest('[role="button"]');
  if(!target || target.tagName === 'BUTTON') return;
  e.preventDefault();   // Space would otherwise scroll the page
  target.click();
});

/* ---------- audit ----------
   Both the global audit-trail drawer and the inline Release audit list
   were removed per revision feedback. These calls document which actions
   are meant to be audited server-side in production; there is no on-page
   sink for either anymore. */
function logAudit(kind, text){ /* no on-page sink — write is still audited server-side in production */ }
function flashSaved(afterEl){
  var span = document.createElement('span');
  span.className = 'savestate ok';
  span.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5 6.5 12 13 4.5"/></svg>Saved';
  afterEl.insertAdjacentElement('afterend', span);
  setTimeout(function(){ span.remove(); }, 1400);
}

/* ---------- roster inline edit: saving → success/error → rollback/retry (brief §9) ---------- */
function inlineSave(el){
  if(el.dataset.orig === undefined) el.dataset.orig = el.value;
  var existing = el.nextElementSibling;
  if(existing && existing.classList.contains('savestate')) existing.remove();
  var state = document.createElement('span');
  state.className = 'savestate';
  state.innerHTML = '<span class="spin"></span>Saving…';
  el.insertAdjacentElement('afterend', state);
  var willFail = el.dataset.demofail === '1' && el.dataset.retried !== '1';
  setTimeout(function(){
    if(willFail){
      el.value = el.dataset.orig;
      state.className = 'savestate err';
      state.textContent = "Couldn't save — network error ";
      var retry = document.createElement('span');
      retry.className = 'retry';
      retry.textContent = 'Retry';
      retry.onclick = function(){ el.dataset.retried = '1'; inlineSave(el); };
      state.appendChild(retry);
      toast('Write failed for ' + (el.dataset.action || 'this field') + ' — rolled back to the prior value.', 'err');
    } else {
      state.className = 'savestate ok';
      state.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5 6.5 12 13 4.5"/></svg>Saved';
      var val = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value;
      logAudit('staff', currentActorName() + ' set ' + (el.dataset.action || 'field') + ' = "' + val + '"');
      setTimeout(function(){ state.remove(); }, 1600);
    }
  }, 650);
}

/* ---------- SE reason popup — Guests tab only (§0t, unchanged, out of
   scope for this revision). Required whenever a guest's SE chip is turned
   on; cancelling reverts the chip since SE=on with no reason isn't valid.
   The roster's equivalent flow is the separate Override Classification
   modal below (mOverrideClassification) — the two intentionally don't
   share a write path. ---------- */
var pendingSEChip = null;
function openSEReason(chip){
  pendingSEChip = chip;
  document.getElementById('seReasonText').value = chip.dataset.reason || '';
  openModal('mSEReason');
}
function confirmSEReason(){
  if(pendingSEChip){
    var val = document.getElementById('seReasonText').value.trim();
    pendingSEChip.dataset.reason = val;
    pendingSEChip.title = val ? ('SE reason: ' + val) : '';
    logAudit('staff', currentActorName() + ' recorded an SE reason');
  }
  pendingSEChip = null;
  dismissModal();
  toast('SE reason saved.');
}
function cancelSEReason(){
  if(pendingSEChip) pendingSEChip.classList.remove('on');
  pendingSEChip = null;
  dismissModal();
}

/* ---------- Seminar / ADV. CRS — state-priority ladder (§0p). Roster pills
   carry their own data-pot/data-confirmed/data-reg/data-desig/data-alt and
   collapse to the single most-operationally-advanced state; the Guests tab
   (unchanged, out of scope) keeps its original card-level-potential-chip
   shape, detected here by the absence of a data-pot attribute on the pill
   itself, so one function safely serves both surfaces. ---------- */
function updateProgramPills(card){
  if(!card) return;
  var potChip = card.querySelector('[data-action="set_guest_potential"]');
  var potOn = potChip ? potChip.classList.contains('on') : false;
  ['seminar', 'ac'].forEach(function(key){
    var el = card.querySelector('.prog-' + key);
    if(!el) return;
    if(el.hasAttribute('data-pot')){
      applyFollowOnLadder(el);
    } else if(el.dataset.reg === '1'){
      el.className = 'pill p-pot prog-' + key;
      el.textContent = 'REG';
    } else {
      el.className = 'pill p-neutral prog-' + key;
      el.textContent = potOn ? 'POT' : 'NP';
    }
  });
}
/* Ladder: REG > POT / NP / not set.
   CONF removed 2026-08-15 — the client does not use a Confirmed state; the vocabulary is
   REG, POT and NP. It also actively misled: a record marked Non-Potential that happened to
   carry Seminar Confirmation Status = Confirmed rendered as CONF, hiding the NP.

   "Not set" renders an em dash rather than falling back to NP. Those are different facts —
   nobody has judged this person yet, versus somebody judged them non-potential — and
   collapsing them would make clearing a classification invisible on the row. */
function applyFollowOnLadder(el){
  var reg = el.dataset.reg === '1';
  /* Falls back to the old boolean attribute so a pill rendered before data-potstate existed
     still resolves rather than showing an em dash for everyone. */
  var state = el.dataset.potstate || (el.dataset.pot === '1' ? 'pot' : 'np');
  var desig = el.dataset.desig === '1', alt = el.dataset.alt === '1';
  var progClass = el.classList.contains('prog-seminar') ? 'prog-seminar' : 'prog-ac';
  var cls, text, editable;
  if(desig && alt){ cls = 'p-dataerr'; text = 'REG · ⚠'; editable = false; }
  else if(reg){ cls = 'p-pot'; text = 'REG'; editable = false; }
  else if(state === 'pot'){ cls = 'p-neutral'; text = 'POT'; editable = true; }
  else if(state === 'np'){ cls = 'p-neutral'; text = 'NP'; editable = true; }
  else { cls = 'p-slot-off'; text = '—'; editable = true; }
  el.className = 'pill ' + cls + ' ev-clickable ' + progClass;
  el.textContent = text;
  if(editable) el.dataset.popEdit = 'classification:' + (progClass === 'prog-seminar' ? 'seminarPotential' : 'acPotential');
  else delete el.dataset.popEdit;
  syncNpFlag(el, progClass === 'prog-seminar' ? 'sem-np' : 'ac-np', text === 'NP');
}
/* Keeps the Classification zone's always-visible AC-NP/SEM-NP slot in sync
   with the Follow-On ladder — a participant showing NP in the Seminar/AC
   column also lights up the matching Classification flag, greyed
   otherwise (§0w). Not present on cards with no Seminar/AC record at all
   (e.g. a card using the plain "—" v-na markup instead of a prog pill). */
function syncNpFlag(progEl, slotType, isNp){
  var card = progEl.closest('.ev-card');
  var slot = card && card.querySelector('[data-classtype="' + slotType + '"]');
  if(!slot) return;
  slot.classList.remove('p-slot-off', 'p-npflag');
  slot.classList.add(isNp ? 'p-npflag' : 'p-slot-off');
  var label = slotType === 'sem-np' ? 'Seminar Potential' : 'AC Potential';
  slot.setAttribute('data-pop-kv', JSON.stringify([[label, isNp ? 'No' : 'Yes or already progressed']]).replace(/'/g, "&#39;"));
}

var pendingNotesCard = null;
function openNotes(btn){
  var card = btn.closest('.ev-card, .hr-row');
  pendingNotesCard = card;
  var nameEl = card.querySelector('.ev-name b, .ev-name input, .hr-name b');
  document.getElementById('notesName').textContent = nameEl ? (nameEl.value || nameEl.textContent) : 'this record';
  document.getElementById('notesText').value = '';
  /* Show what is already on the record before asking for another note. The panel used to be
     write-only: a CS could add a note but had no way to see the five existing ones, so the
     same observation got re-entered every session. */
  var listEl = document.getElementById('notesList');
  if(listEl){
    var reg = rosterFindRegById(card.dataset.regId);
    var entries = reg ? rosterNoteEntries(reg) : [];
    listEl.innerHTML = entries.length
      ? entries.map(function(n){
          return '<div class="note-entry">' +
            '<div class="note-meta">' +
              '<span class="pill p-neutral note-cat">' + rosterEscHtml(n.category) + '</span>' +
              (n.when ? '<span class="note-when">' + rosterEscHtml(n.when) + '</span>' : '') +
              (n.who ? '<span class="note-who">' + rosterEscHtml(n.who) + '</span>' : '') +
            '</div>' +
            '<div class="note-text">' + rosterEscHtml(n.text) + '</div>' +
          '</div>';
        }).join('')
      : '<div class="note-empty">No notes on this record yet.</div>';
  }
  openModal('mNotes');
}
function confirmNotes(){
  var card = pendingNotesCard;
  if(!card){ dismissModal(); return; }
  var val = document.getElementById('notesText').value.trim();
  if(!val){ toast('A note is required.', 'err'); return; }
  var isRealRoster = card.classList.contains('ev-card') && /^\d+$/.test(card.dataset.regId || '');
  var isRealGuest = card.classList.contains('ev-card') && /^\d+$/.test(card.dataset.invId || '');
  if(!isRealRoster && !isRealGuest){
    card.dataset.note = val;
    var demoBtn = card.querySelector('.ev-notesbtn');
    if(demoBtn) demoBtn.classList.toggle('has-note', val.length > 0);
    logAudit('staff', currentActorName() + ' updated the operational note');
    pendingNotesCard = null;
    dismissModal();
    toast('Note saved.');
    return;
  }
  var url = isRealGuest ? DASHBOARD_GUEST_ADD_NOTE_WEBHOOK_URL : DASHBOARD_ADD_NOTE_WEBHOOK_URL;
  var payload = isRealGuest
    ? { eventTeamId: DASHBOARD_DATA.eventTeamId, invitationId: Number(card.dataset.invId), note: val }
    : { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), note: val };
  var saveBtn = document.getElementById('notesSaveBtn');
  var originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' added an operational note');
    pendingNotesCard = null;
    dismissModal();
    toast('Note saved.');
    /* Refetch on BOTH paths as of 2026-08-15. Guests always refetched; the roster never did,
       which was invisible while the roster had no notes UI at all — but the row now shows a
       note-count badge and the panel now lists existing notes, so without this a CS saved a
       note, reopened the panel and saw neither it nor an updated count. The write had
       succeeded; the page was just showing pre-write state, which is the worst version of
       that failure because it looks like the save was lost. */
    if(isRealGuest) dashboardFetchGuests();
    else dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmNotes failed:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Could not save — try again';
    setTimeout(function(){ saveBtn.textContent = originalLabel; }, 2600);
  });
}

/* ============================================================
   PARTICIPANT ROW REDESIGN — anchored popover, per-row kebab menu,
   new contextual modals. See field dictionary §0l–§0t.
   ============================================================ */

/* ---------- Anchored detail popover — one shared instance, positioned via
   getBoundingClientRect() of whatever pill/tick triggered it. Pills are
   read/display components: viewing is always one click; the Edit footer
   only appears when data-pop-edit names a CS-correctable state. ---------- */
var pendingPopTrigger = null;
function positionFloating(el, trigger){
  var r = trigger.getBoundingClientRect();
  /* Reset any clamp left over from a previous open, or the measurement below reads the
     constrained height instead of the menu's natural one. */
  el.style.maxHeight = '';
  el.style.overflowY = '';
  el.style.top = (r.bottom + 6) + 'px';
  el.style.left = r.left + 'px';
  requestAnimationFrame(function(){
    var w = el.offsetWidth, h = el.offsetHeight;
    if(r.left + w > window.innerWidth - 12){
      el.style.left = Math.max(12, window.innerWidth - w - 12) + 'px';
    }
    /* Vertical collision (2026-08-14). Previously the menu was always placed below the
       trigger, so a roster card near the bottom of the viewport opened a menu clipped by
       the window edge — and being fixed-positioned, it did not scroll back into view
       either, leaving the CS looking at one of six actions with no way to reach the rest.
       Prefer below, flip above when below has no room, and when neither side fits, take
       the roomier side and let the menu scroll inside itself. */
    var below = window.innerHeight - r.bottom - 12;
    var above = r.top - 12;
    if(h <= below) return;
    if(h <= above){ el.style.top = (r.top - h - 6) + 'px'; return; }
    var capped = Math.max(120, Math.max(below, above) - 6);
    el.style.maxHeight = capped + 'px';
    el.style.overflowY = 'auto';
    el.style.top = (below >= above ? (r.bottom + 6) : Math.max(12, r.top - capped - 6)) + 'px';
  });
}
function openDetailPop(trigger){
  closeRowMenu();
  pendingPopTrigger = trigger;
  var eyebrowEl = document.getElementById('detailPopEyebrow');
  eyebrowEl.textContent = trigger.dataset.popEyebrow || '';
  eyebrowEl.style.display = trigger.dataset.popEyebrow ? '' : 'none';
  document.getElementById('detailPopTitle').textContent = trigger.dataset.popTitle || '';
  /* Optional chip strip above the key/value list, separated by a faint rule (2026-08-15).
     Added for the Day ticks, which now open onto that day's four sessions — S1-S4 across the
     top, then the connection detail beneath. Any trigger can use it; triggers without
     data-pop-chips render exactly as before, chip strip and rule both hidden. */
  var chipWrap = document.getElementById('detailPopChips');
  if(chipWrap){
    var chips = [];
    try { chips = JSON.parse(trigger.dataset.popChips || '[]'); } catch(e){}
    chipWrap.innerHTML = chips.map(function(c){
      return '<span class="popchip' + (c.on ? ' on' : '') + '">' + rosterEscHtml(c.label) + '</span>';
    }).join('');
    chipWrap.style.display = chips.length ? '' : 'none';
  }
  var kv = [];
  try { kv = JSON.parse(trigger.dataset.popKv || '[]'); } catch(e){}
  document.getElementById('detailPopKv').innerHTML = kv.map(function(pair){
    return '<dt>' + pair[0] + '</dt><dd>' + pair[1] + '</dd>';
  }).join('');
  document.getElementById('detailPopFt').style.display = trigger.dataset.popEdit ? '' : 'none';
  var pop = document.getElementById('detailPop');
  positionFloating(pop, trigger);
  pop.classList.add('open');
}
function closeDetailPop(){
  document.getElementById('detailPop').classList.remove('open');
  pendingPopTrigger = null;
}
function onEditFromPop(){
  if(!pendingPopTrigger) return;
  var edit = pendingPopTrigger.dataset.popEdit;
  var card = pendingPopTrigger.closest('.ev-card');
  closeDetailPop();
  if(!edit) return;
  if(edit === 'courseStatus') openCourseStatus(card);
  else if(edit.indexOf('classification:') === 0) openOverrideClassification(card, edit.slice('classification:'.length));
}

/* ---------- Per-row ••• kebab menu — Registration-contextual (§0t): every
   action resolves against pendingRowMenuCard's data-reg-id, not just the
   Contact. ---------- */
var pendingRowMenuCard = null;
function openRowMenu(btn){
  closeDetailPop();
  pendingRowMenuCard = btn.closest('.ev-card');
  var menu = document.getElementById('rowMenu');
  positionFloating(menu, btn);
  menu.classList.add('open');
}
function closeRowMenu(){
  document.getElementById('rowMenu').classList.remove('open');
}
function kebabAction(which){
  var card = pendingRowMenuCard;
  closeRowMenu();
  if(!card) return;
  if(which === 'courseStatus') openCourseStatus(card);
  else if(which === 'deviceException') openDeviceException(card);
  else if(which === 'overrideClassification') openOverrideClassification(card);
  else if(which === 'correctAttendance') openCorrectAttendance(card);
  else if(which === 'addNote') openNotes(card.querySelector('.kebab-btn'));
  else if(which === 'viewDetails') openParticipantDrawer(card);
}
function cardName(card){
  var nameEl = card.querySelector('.ev-name b, .ev-name input');
  return nameEl ? (nameEl.value || nameEl.textContent) : 'this participant';
}

/* ---------- Update Course Status (§0l) — REAL BUILD 2026-08-12. Left
   Course? drives Left Type (real f3056, 5 LDP options), Day (f3059),
   Time (f3060, optional), Leave Reason (f3061 "WBO Reason", real
   7-option list). WBO (f2688) is read-only/derived from Left Type
   (LDP 2/LDP 4 trigger it), computed here for display only — the
   server independently recomputes and is authoritative. Writes via
   dashboardWriteCourseStatus() below to CS Dashboard : Update Course
   Status (n8n id lj3Ewx20NFYpOp3g); on success the roster is refetched
   so ticks/pills reflect real server state instead of hand-patched DOM
   (no name-row LDP pill exists in the real card render — the tick-level
   amber LDP state, already built in the Roster read+render pass, is the
   confirmed real display for this). ---------- */
var pendingCourseStatusCard = null;
/* Name -> registration, matched the same way dashboardRenderRoster() builds its stacked-avatar
   partner index: against both the display name (preferred first + last) and the legal name,
   lower-cased and trimmed, and nothing fuzzier. A near-match that resolves to the wrong
   participant would clear an unrelated person's pairing, which is worse than not clearing. */
function rosterFindRegByName(name){
  var key = String(name || '').trim().toLowerCase();
  if(!key) return null;
  var list = dashboardLastRoster || [];
  for(var i = 0; i < list.length; i++){
    var r = list[i];
    var f = r['f2213//firstname'] || '', l = r['f2213//lastname'] || '', nl = r['f2213//f2792'] || '';
    if ((f + ' ' + l).trim().toLowerCase() === key) return r;
    if (((nl || f) + ' ' + l).trim().toLowerCase() === key) return r;
  }
  return null;
}
function rosterFindRegById(id){
  var list = dashboardLastRoster || [];
  for(var i = 0; i < list.length; i++){ if(String(list[i].id) === String(id)) return list[i]; }
  return null;
}
function csEpochToTimeInput(epoch){
  var n = Number(epoch || 0);
  if(!n) return '';
  var d = new Date(n * 1000);
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}
function csTimeInputToEpoch(hhmm){
  if(!hhmm) return '';
  var parts = hhmm.split(':');
  var d = new Date();
  d.setHours(Number(parts[0] || 0), Number(parts[1] || 0), 0, 0);
  return String(Math.floor(d.getTime() / 1000));
}
function openCourseStatus(card){
  pendingCourseStatusCard = card;
  document.getElementById('csName').textContent = cardName(card);
  var reg = rosterFindRegById(card.dataset.regId) || {};
  var isLeft = rosterIsTrue(reg.f2293);
  /* Left course? reflects a real stored boolean (f2293 is always either set
     or the documented "0" sentinel), so showing it is current state, not a
     fabricated default — it keeps no placeholder. The three below are
     genuinely unset until a CS chooses, and previously fell back to
     428/430/432, which silently pre-answered the question and could be
     saved through untouched. They now fall back to '' so the placeholder
     option shows and csNextUnsetField() can see they still need input. */
  /* Withdrawn outranks left-the-course when both somehow read true. The server clears the
     LDP cluster on a withdraw so the combination should not occur, but a record predating
     that — or edited directly in Ontraport — could still carry both, and showing the more
     final of the two is the safer reading. */
  document.getElementById('csLeftCourse').value = rosterIsWithdrawn(reg) ? 'withdraw' : (isLeft ? 'yes' : 'no');
  document.getElementById('csWithdrawNote').value = rosterIsWithdrawn(reg) ? (reg.f3235 || '') : '';
  document.getElementById('csLeftType').value = ROSTER_LEFT_TYPE_MAP[String(reg.f3056 || '')] ? String(reg.f3056) : '';
  document.getElementById('csDay').value = ROSTER_LEFT_DAY_TO_NUM[String(reg.f3059 || '')] ? String(reg.f3059) : '';
  /* Was hardcoded '15:42' — a prototype artefact that wrote a fabricated
     leave time to Ontraport on any save where the CS never touched the
     field. Blank instead: the workflow only writes f3060 when leftTime is
     non-empty, so an untouched Time now records nothing rather than a
     wrong timestamp. */
  document.getElementById('csTime').value = csEpochToTimeInput(reg.f3060) || '';
  document.getElementById('csLeaveReason').value = ROSTER_WBO_REASON_MAP[String(reg.f3061 || '')] ? String(reg.f3061) : '';
  document.getElementById('csWboNote').value = reg.f3235 || '';
  onCsLeftCourseChange();
  onCsLeftTypeOrReasonChange();
  openModal('mCourseStatus');
}
function onCsLeftCourseChange(){
  var v = document.getElementById('csLeftCourse').value;
  document.getElementById('csLeftFields').style.display = v === 'yes' ? 'block' : 'none';
  /* Withdraw shows a note and nothing else — the LDP block's day, time, type and WBO
     reason all describe leaving DURING the programme and have no meaning for someone who
     never started. Hiding rather than disabling them: a disabled control still reads as
     "something I might have to fill in". */
  var wd = document.getElementById('csWithdrawFields');
  if(wd) wd.style.display = v === 'withdraw' ? 'block' : 'none';
  csUpdateAttention();
}
function onCsLeftTypeOrReasonChange(){
  var type = document.getElementById('csLeftType').value;
  var isWbo = ROSTER_WBO_TRIGGER_TYPES.indexOf(type) !== -1;
  document.getElementById('csWboDerived').textContent = isWbo ? 'Yes' : 'No';
  document.getElementById('csWboFields').style.display = isWbo ? 'block' : 'none';
  csUpdateAttention();
}
/* Progressive attention cue. csNextUnsetField() returns the single field
   the CS still has to answer, in the order the form reveals them, or null
   when nothing is outstanding. It is deliberately the one source of truth
   for both the highlight and the save-time guard below, so the field the
   cue points at and the field that blocks saving can never disagree.
   Note Day is required by the server whenever leftCourse is true, but Time
   is not — Time is genuinely optional and never carries the cue. */
/* Shared by all three progressive modals so their cue behaviour cannot
   drift apart. attnFieldOf() matches .field and .ev-field because the
   Device Exception participant combo uses the latter. */
function attnFieldOf(id){
  var el = document.getElementById(id);
  return el ? el.closest('.field,.ev-field') : null;
}
function attnApply(modalId, nextFn){
  var modal = document.getElementById(modalId);
  if(!modal) return null;
  modal.querySelectorAll('.attn').forEach(function(f){ f.classList.remove('attn'); });
  attnClearPrompt(modal);
  var next = nextFn();
  if(next) next.classList.add('attn');
  return next;
}

/* ---------- Blocked-submit feedback (2026-08-15) ----------
   Attempting to save with a required field empty used to do two quiet things: tint the
   field's border and fire a toast at the edge of the screen. In a modal the eye is on the
   Save button, so the tint was easy to miss entirely and the toast named the problem
   somewhere the CS was not looking — leaving "I pressed Save and nothing happened".

   Now the field itself says what it needs, next to itself, and pulses until acknowledged.
   The pulse stops the moment the field takes focus: it exists to find the field, and an
   animation that continues while you are answering it is just noise. */
function attnClearPrompt(scope){
  (scope || document).querySelectorAll('.attn-prompt').forEach(function(p){ p.remove(); });
  (scope || document).querySelectorAll('.attn-pulse').forEach(function(f){ f.classList.remove('attn-pulse'); });
}
function attnPrompt(fieldEl, message){
  if(!fieldEl) return;
  var modal = fieldEl.closest('.modal') || document;
  attnClearPrompt(modal);
  fieldEl.classList.add('attn', 'attn-pulse');
  var tip = document.createElement('div');
  tip.className = 'attn-prompt';
  tip.setAttribute('role', 'alert');
  tip.textContent = message;
  fieldEl.appendChild(tip);
  var ctl = fieldEl.querySelector('select,input,textarea');
  if(ctl){
    /* Deliberately NOT auto-focused. The pulse exists to draw the eye to the field, and
       focusing it programmatically stops the pulse on the same tick — the two cancel out and
       nothing ever animates. Scroll it into view instead and let the pulse do its job until
       the CS actually goes there.

       Keyboard and screen-reader users are not left behind by this: the message carries
       role="alert", so it is announced on insertion without stealing focus. */
    var stop = function(){
      fieldEl.classList.remove('attn-pulse');
      ctl.removeEventListener('focus', stop);
    };
    ctl.addEventListener('focus', stop);
    try{ fieldEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }catch(e){}
  }
}
/* Each next*UnsetField() lists that modal's required answers in the order
   the form reveals them, returning the first still outstanding or null.
   Each is the single source of truth for both its highlight and its
   save-time guard, so the field the cue points at and the field that
   blocks saving can never disagree. Optional inputs (Course Status Time,
   Device Exception note, the attendance Override note) are deliberately
   absent — the cue only ever points at something actually required. */
function csNextUnsetField(){
  if(document.getElementById('csLeftCourse').value !== 'yes') return null;
  var type = document.getElementById('csLeftType').value;
  if(!type) return attnFieldOf('csLeftType');
  if(!document.getElementById('csDay').value) return attnFieldOf('csDay');
  if(ROSTER_WBO_TRIGGER_TYPES.indexOf(type) !== -1 && !document.getElementById('csLeaveReason').value) return attnFieldOf('csLeaveReason');
  return null;
}
function csUpdateAttention(){ return attnApply('mCourseStatus', csNextUnsetField); }
function corrAttNextUnsetField(){
  if(!document.getElementById('corrAttDay').value) return attnFieldOf('corrAttDay');
  if(!document.getElementById('corrAttSession').value) return attnFieldOf('corrAttSession');
  var status = document.getElementById('corrAttStatus').value;
  if(!status) return attnFieldOf('corrAttStatus');
  /* Reason is required only for Absent - Excused (467), matching the
     existing guard in confirmCorrectAttendance(). */
  if(status === '467' && !document.getElementById('corrAttNote').value.trim()) return attnFieldOf('corrAttNote');
  return null;
}
function corrAttUpdateAttention(){ return attnApply('mCorrectAttendance', corrAttNextUnsetField); }
function deNextUnsetField(){
  var type = document.getElementById('deExceptionType').value;
  /* "0" is a real, deliberate choice (clear the record), not an unset select — the guard
     below tests for the empty placeholder specifically, so it must not use falsiness. */
  if(type === '') return attnFieldOf('deExceptionType');
  /* Shared device (475) needs a resolved partner. The dataset flag, not the
     visible text, is what confirmDeviceException() sends, so typing a name
     without picking from the list correctly still counts as unanswered. */
  if(type === '475' && !document.getElementById('deOtherParticipant').dataset.otherRegId) return attnFieldOf('deOtherParticipant');
  return null;
}
function deUpdateAttention(){ return attnApply('mDeviceException', deNextUnsetField); }
function confirmCourseStatus(){
  var card = pendingCourseStatusCard;
  if(!card){ dismissModal(); return; }
  var saveBtn = document.getElementById('csSaveBtn');
  var originalLabel = saveBtn.textContent;
  // Clear the previous attempt's message before re-validating, so a resolved field's
  // complaint does not survive into a successful save.
  attnClearPrompt(document.getElementById('mCourseStatus'));
  var statusVal = document.getElementById('csLeftCourse').value;
  var left = statusVal === 'yes';
  var isWithdraw = statusVal === 'withdraw';
  /* Guard added alongside the placeholder options. leftType/leftDay — and
     wboReason on an LDP 2/4 type — are genuinely empty until chosen now,
     and the server rejects empties with a 400. Catching it here means the
     CS gets the field highlighted and focused instead of a generic failure
     toast. Reuses csNextUnsetField() so this can never diverge from the
     cue. */
  if(left){
    var missing = csNextUnsetField();
    if(missing){
      csUpdateAttention();
      attnPrompt(missing, 'Required — choose an option to continue.');
      return;
    }
  }
  /* courseStatus is the field the server now reads; leftCourse is still sent so an older
     deployed workflow keeps working if the two ever get out of step. */
  var payload = {
    eventTeamId: DASHBOARD_DATA.eventTeamId,
    registrationId: Number(card.dataset.regId),
    courseStatus: isWithdraw ? 'withdraw' : (left ? 'left' : 'active'),
    leftCourse: left
  };
  if(isWithdraw) payload.note = document.getElementById('csWithdrawNote').value.trim();
  var type = '', reason = '', isWbo = false;
  if(left){
    type = document.getElementById('csLeftType').value;
    isWbo = ROSTER_WBO_TRIGGER_TYPES.indexOf(type) !== -1;
    reason = isWbo ? document.getElementById('csLeaveReason').value : '';
    payload.leftType = type;
    payload.leftDay = document.getElementById('csDay').value;
    payload.wboReason = reason;
    payload.wboNote = isWbo ? document.getElementById('csWboNote').value.trim() : '';
    var timeEpoch = csTimeInputToEpoch(document.getElementById('csTime').value);
    if(timeEpoch) payload.leftTime = timeEpoch;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  fetch(DASHBOARD_UPDATE_COURSE_STATUS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    if(left){
      logAudit('staff', currentActorName() + ' set course status = ' + (ROSTER_LEFT_TYPE_MAP[type] || type) + (reason ? ' · ' + (ROSTER_WBO_REASON_MAP[reason] || reason) : '') + (r.result.wbo ? ' · WBO' : ''));
      toast('Course status saved.');
    } else {
      logAudit('staff', currentActorName() + ' set course status = ACTIVE');
      toast('Course status saved — reverted to ACTIVE.');
    }
    pendingCourseStatusCard = null;
    dismissModal();
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmCourseStatus failed:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Could not save — try again';
    setTimeout(function(){ saveBtn.textContent = originalLabel; }, 2600);
  });
}

/* ---------- Override Classification (§0s) — REAL BUILD 2026-08-12. One
   shared modal for Reviewer (f3044), Statistical Exclusion (f3046),
   Seminar Potential (f2882), Advanced Course Potential (f2887).
   Scholarship is deliberately excluded (§0o) — derived from payment data,
   not overridable here. ocCurrentValue() already read real DOM state
   from the Roster read+render pass (data-classtype/data-pot), unchanged.
   confirmOverrideClassification() now POSTs to the real webhook (required
   reason → f3068; optional note appends to f2886) instead of hand-patching
   pill classes — dashboardFetchRoster() refreshes from server truth on
   success, same pattern as Update Course Status/Device Exception. ---------- */
var pendingOcCard = null;
var OC_LABELS = {reviewer:'Reviewer', se:'Statistical Exclusion', seminarPotential:'Seminar Potential', acPotential:'Advanced Course Potential'};
/* The two Potential fields are tri-state, so "Yes/No" cannot describe them: it collapsed
   Non-Potential and not-yet-decided into the same "No", which is precisely the distinction a
   CS needs when deciding whether to clear one. Read from the registration record rather than
   from rendered pill classes — the record is the truth, and the pill only renders POT. */
var OC_POTENTIAL_FIELDS = { seminarPotential: { field: 'f2882', pot: '371', np: '370' },
                            acPotential:      { field: 'f2887', pot: '382', np: '381' } };
function ocIsPotentialField(field){ return !!OC_POTENTIAL_FIELDS[field]; }
function ocCurrentValue(card, field){
  var reg = rosterFindRegById(card.dataset.regId) || {};
  if(field === 'reviewer') return rosterIsTrue(reg.f3044) ? 'Yes' : 'No';
  if(field === 'se') return rosterIsTrue(reg.f3046) ? 'Yes' : 'No';
  var map = OC_POTENTIAL_FIELDS[field];
  if(map){
    var v = String(reg[map.field] == null ? '' : reg[map.field]).trim();
    if(v === map.pot) return 'Potential';
    if(v === map.np) return 'Non-potential';
    return 'Not set';
  }
  return '—';
}
/* Swap which control is shown, and preselect it from current state so opening the modal and
   saving without touching anything is a no-op rather than a silent change. */
function onOcFieldChange(card){
  var field = document.getElementById('ocField').value;
  var isPot = ocIsPotentialField(field);
  document.getElementById('ocToggleField').style.display = isPot ? 'none' : '';
  document.getElementById('ocValueField').style.display = isPot ? '' : 'none';
  document.getElementById('ocCurrent').textContent = OC_LABELS[field] + ': ' + ocCurrentValue(card, field);
  var cur = ocCurrentValue(card, field);
  if(isPot){
    document.getElementById('ocValue').value = cur === 'Potential' ? 'pot' : (cur === 'Non-potential' ? 'np' : 'none');
  } else {
    document.getElementById('ocChangeTo').classList.toggle('on', cur === 'Yes');
  }
}
function openOverrideClassification(card, presetField){
  pendingOcCard = card;
  document.getElementById('ocName').textContent = cardName(card);
  var field = presetField || 'reviewer';
  document.getElementById('ocField').value = field;
  document.getElementById('ocReasonText').value = '';
  document.getElementById('ocNoteText').value = '';
  document.getElementById('ocField').onchange = function(){ onOcFieldChange(card); };
  onOcFieldChange(card);
  openModal('mOverrideClassification');
}
function confirmOverrideClassification(){
  var card = pendingOcCard;
  if(!card){ dismissModal(); return; }
  attnClearPrompt(document.getElementById('mOverrideClassification'));
  var field = document.getElementById('ocField').value;
  var isPot = ocIsPotentialField(field);
  var changeTo = document.getElementById('ocChangeTo').classList.contains('on');
  var potValue = document.getElementById('ocValue').value;
  var reason = document.getElementById('ocReasonText').value.trim();
  var note = document.getElementById('ocNoteText').value.trim();
  if(!reason){
    // Same inline treatment as the other modals rather than an edge-of-screen toast.
    attnPrompt(attnFieldOf('ocReasonText'), 'Required — say why this classification is being overridden.');
    return;
  }
  var saveBtn = document.getElementById('ocSaveBtn');
  var originalLabel = saveBtn.textContent;
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), field: field, overrideNote: reason, operationalNote: note };
  /* Potential fields send the tri-state `value`; the two checkbox fields keep `changeTo`.
     Sending only the one the server expects for that field means an invalid combination
     cannot be constructed from the UI at all. */
  if(isPot) payload.value = potValue; else payload.changeTo = changeTo;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  fetch(DASHBOARD_OVERRIDE_CLASSIFICATION_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' overrode ' + OC_LABELS[field] + ' = ' + (isPot ? potValue : changeTo) + ' · reason: ' + reason);
    pendingOcCard = null;
    dismissModal();
    toast('Override saved.');
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmOverrideClassification failed:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Could not save — try again';
    setTimeout(function(){ saveBtn.textContent = originalLabel; }, 2600);
  });
}
function cancelOverrideClassification(){ pendingOcCard = null; dismissModal(); }

/* ---------- Correct Attendance — REAL BUILD 2026-08-12. Manual-override
   tail of Attendance Architecture Layer 2. Writes f3191 (Attendance
   Status) always, f3190 (FS LATE NOTE) only when Absent-Excused, and the
   specific per-session ATTENDED checkbox (f3193-f3203/f3055) only when
   Present. Normal attendance stays Zoom-sourced/read-only via the tick's
   popover — this is only the manual path for a failed automated match.
   dashboardFetchRoster() refreshes from server truth on success, same
   pattern as every other kebab action this build. ---------- */
var pendingCorrectAttCard = null;
var CORR_ATT_STATUS_LABELS = {'469':'Present', '467':'Absent - Excused', '468':'Absent - NCNS'};
function openCorrectAttendance(card){
  pendingCorrectAttCard = card;
  document.getElementById('attName').textContent = cardName(card);
  /* Previously defaulted to Day 2 / Session 1 / Present. Attendance
     correction is an action rather than a stored state, so there is no
     "current value" these could legitimately reflect — they were pure
     fabricated defaults, and Present being pre-selected meant a mis-click
     could record attendance nobody chose. Blank + placeholder now. */
  document.getElementById('corrAttDay').value = '';
  document.getElementById('corrAttSession').value = '';
  document.getElementById('corrAttStatus').value = '';
  document.getElementById('corrAttNote').value = '';
  document.getElementById('corrAttOverrideNote').value = '';
  onCorrAttStatusChange();
  openModal('mCorrectAttendance');
}
function onCorrAttStatusChange(){
  var isExcused = document.getElementById('corrAttStatus').value === '467';
  document.getElementById('corrAttNoteField').style.display = isExcused ? 'block' : 'none';
  corrAttUpdateAttention();
}
function confirmCorrectAttendance(){
  var card = pendingCorrectAttCard;
  if(!card){ dismissModal(); return; }
  var day = document.getElementById('corrAttDay').value;
  var session = document.getElementById('corrAttSession').value;
  var status = document.getElementById('corrAttStatus').value;
  var note = document.getElementById('corrAttNote').value.trim();
  attnClearPrompt(document.getElementById('mCorrectAttendance'));
  var attMissing = corrAttNextUnsetField();
  if(attMissing){
    corrAttUpdateAttention();
    attnPrompt(attMissing, attMissing.id === 'corrAttNoteField' ? 'A reason is required for Absent — Excused.' : 'Required — choose an option to continue.');
    return;
  }
  var overrideNote = document.getElementById('corrAttOverrideNote').value.trim();
  var saveBtn = document.getElementById('corrAttSaveBtn');
  var originalLabel = saveBtn.textContent;
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), day: day, session: session, status: status, note: note, overrideNote: overrideNote };
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  fetch(DASHBOARD_CORRECT_ATTENDANCE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' corrected attendance — Day ' + day + ' Session ' + session + ' = ' + CORR_ATT_STATUS_LABELS[status]);
    pendingCorrectAttCard = null;
    dismissModal();
    toast('Correction recorded.');
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmCorrectAttendance failed:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Could not save — try again';
    setTimeout(function(){ saveBtn.textContent = originalLabel; }, 2600);
  });
}

/* ---------- Device / Zoom Exception (§0n) — REAL BUILD 2026-08-12. Writes
   registrations.f3208 (473 Other Zoom exception / 474 Multiple devices /
   475 Shared device) + f3209 (note) to this registration only via
   dashboardWriteDeviceException()'s real webhook call. When exceptionType
   is 475, the CS searches the real roster (deviceParticipantFilter, off
   dashboardLastRoster — not the fake PARTICIPANT_NAMES list) for who the
   device is shared with; only the selected registration's real ID is
   ever sent — the server independently resolves both real names and
   writes f3207 bidirectionally, so no client-typed name string is ever
   trusted or transmitted. No DOM patching on save (no real .device-flag
   pill exists in the roster card render yet) — dashboardFetchRoster()
   refreshes from server truth instead, same pattern as Update Course
   Status. ---------- */
var pendingDeCard = null;
function dashboardParticipantDisplayName(reg){
  var first = reg['f2213//firstname'] || '';
  var last = reg['f2213//lastname'] || '';
  var nameLikes = reg['f2213//f2792'] || '';
  return ((nameLikes || first) + ' ' + last).trim() || 'Unknown Participant';
}
function openDeviceException(card){
  pendingDeCard = card;
  document.getElementById('deName').textContent = cardName(card);
  /* Was pre-selected to 473 "Other Zoom exception" — a fabricated default
     that could be saved through untouched. Blank + placeholder now. */
  document.getElementById('deExceptionType').value = '';
  document.getElementById('deOtherParticipantField').style.display = 'none';
  var otherInput = document.getElementById('deOtherParticipant');
  otherInput.value = '';
  delete otherInput.dataset.otherRegId;
  document.getElementById('deNoteText').value = '';
  deUpdateAttention();
  openModal('mDeviceException');
}
function onDeExceptionTypeChange(){
  var isShared = document.getElementById('deExceptionType').value === '475';
  document.getElementById('deOtherParticipantField').style.display = isShared ? 'block' : 'none';
  deUpdateAttention();
}
function deviceParticipantFilter(input){
  var q = input.value.toLowerCase().trim();
  var excludeId = String(pendingDeCard ? pendingDeCard.dataset.regId : '');
  var candidates = (dashboardLastRoster || []).filter(function(r){ return String(r.id) !== excludeId; });
  var matches = candidates.filter(function(r){
    var name = dashboardParticipantDisplayName(r);
    return !q || name.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 6);
  var list = input.nextElementSibling;
  list.innerHTML = matches.length
    ? matches.map(function(r){
        var name = dashboardParticipantDisplayName(r);
        return '<div class="combo-opt" onmousedown="selectDeviceParticipant(this,\'' + r.id + '\',\'' + name.replace(/'/g, "\\'") + '\')">' + rosterEscHtml(name) + '</div>';
      }).join('')
    : '<div class="combo-opt muted">No match</div>';
  list.classList.add('open');
}
function selectDeviceParticipant(el, regId, name){
  var wrapper = el.closest('.participant-combo');
  var input = wrapper.querySelector('.participant-input');
  input.value = name;
  input.dataset.otherRegId = regId;
  wrapper.querySelector('.combo-list').classList.remove('open');
  /* Clears the cue the moment a partner is actually resolved — the input's
     own oninput can't do this, since typing alone never sets otherRegId. */
  deUpdateAttention();
}
function confirmDeviceException(){
  var card = pendingDeCard;
  if(!card){ dismissModal(); return; }
  var saveBtn = document.getElementById('deSaveBtn');
  var originalLabel = saveBtn.textContent;
  attnClearPrompt(document.getElementById('mDeviceException'));
  var deMissing = deNextUnsetField();
  if(deMissing){
    deUpdateAttention();
    attnPrompt(deMissing, deMissing.id === 'deOtherParticipantField' ? 'Required — select who they are sharing a device with.' : 'Required — choose an option to continue.');
    return;
  }
  var exceptionType = document.getElementById('deExceptionType').value;
  var note = document.getElementById('deNoteText').value.trim();
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), exceptionType: exceptionType, note: note };
  if(exceptionType === '475'){
    payload.otherRegistrationId = Number(document.getElementById('deOtherParticipant').dataset.otherRegId);
  } else if(exceptionType === '0'){
    /* Clearing a shared-device record has to clear the OTHER side too, or the pairing is left
       half-standing: the partner keeps a f3207 pointing at someone who is no longer paired
       with them, which keeps them in the Shared device count and keeps drawing a stacked
       avatar with a dead click-through.

       f3207 stores the partner's NAME, not an id, so the id is resolved here from the roster
       already in memory — the same name lookup the stacked avatar uses. If the name does not
       resolve (a CS typed it differently when creating the pairing), no otherRegistrationId
       is sent and the server clears this record only. That is a real, known limit of a
       name-keyed pairing; it fails to a partial clear rather than to a wrong one. */
    var reg = rosterFindRegById(card.dataset.regId);
    var partnerName = reg ? String(reg.f3207 || '').trim() : '';
    if(partnerName){
      var partner = rosterFindRegByName(partnerName);
      if(partner) payload.otherRegistrationId = Number(partner.id);
    }
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  fetch(DASHBOARD_DEVICE_EXCEPTION_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' recorded a device/Zoom exception for ' + cardName(card) + (r.result.hasOther ? (' (shared with ' + r.result.otherName + ')') : ''));
    pendingDeCard = null;
    dismissModal();
    toast('Device/Zoom exception saved.');
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmDeviceException failed:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Could not save — try again';
    setTimeout(function(){ saveBtn.textContent = originalLabel; }, 2600);
  });
}

/* ---------- View Participant Details drawer — read-only roster summary,
   plus Edit Name and Spouse, relocated here from the row (§0t). ---------- */
function openParticipantDrawer(card){
  var nameEl = card.querySelector('.ev-name b');
  /* Was `.ev-name span`, which pointed at the row's "Legal: … · PID-…" line. That line is
     gone — the row now LEADS with the legal name and carries the preferred name beneath it
     — and the old selector would have silently matched .ev-goesby instead, printing the
     nickname into a field labelled "Legal". Reads the goes-by explicitly and labels it as
     such; the PID is deliberately not restored here (it is an internal Zoom identifier the
     drawer has no more use for than the row did). */
  var goesByEl = card.querySelector('.ev-goesby');
  var goesBy = goesByEl ? goesByEl.textContent.replace(/^\(|\)$/g, '').trim() : '';
  document.getElementById('dwName').textContent = nameEl ? nameEl.textContent : 'Participant details';
  document.getElementById('dwLegalPid').textContent = goesBy ? 'Goes by ' + goesBy : '';
  var nameInput = document.getElementById('dwNameInput');
  nameInput.value = nameEl ? nameEl.textContent : '';
  nameInput.dataset.targetCard = card.dataset.regId || '';
  nameInput.onblur = function(){ if(nameEl) nameEl.textContent = this.value; inlineSave(this); };
  var spouseInput = document.getElementById('dwSpouseInput');
  spouseInput.value = card.dataset.spouse || '';
  spouseInput.onblur = function(){ comboBlur(this); card.dataset.spouse = this.value; inlineSave(this); };
  /* Status line for the drawer. Was a single lookup for an LDP/NSHO pill inside .ev-name-row
     — a selector that no longer matches anything, since the status pills moved into their
     own zone and became a set rather than one exclusive badge. Reads the whole set now and
     joins it, so a participant who is both LDP and WBO says so here as well. */
  var statusPills = Array.prototype.map.call(card.querySelectorAll('[data-statusbadge]'), function(p){ return p.textContent.trim(); });
  var status = statusPills.length ? statusPills.join(' · ') : 'Active';
  var seminarText = (card.querySelector('.prog-seminar') || {}).textContent || '—';
  var acText = (card.querySelector('.prog-ac') || {}).textContent || '—';
  document.getElementById('dwSummary').innerHTML =
    '<span class="k">Status</span><span class="v">' + status + '</span>' +
    '<span class="k">Seminar</span><span class="v">' + seminarText + '</span>' +
    '<span class="k">AC</span><span class="v">' + acText + '</span>';
  /* Read straight off the registration record rather than card.dataset:
     nothing in this file ever SET data-email/data-phone, so those lookups
     silently resolved to '—' for every participant. f3252/f3253 are
     registration-level mirrors of the Contact's email and SMS number
     (Ontraport returns them paired with f2213//email and
     f2213//sms_number), so no extern hop is needed here. */
  var infoReg = rosterFindRegById(card.dataset.regId) || {};
  var email = rosterFieldText(infoReg.f3252);
  var emailEl = document.getElementById('dwEmail');
  emailEl.textContent = email || '—';
  emailEl.href = email ? 'mailto:' + email : '#';
  var phone = rosterFieldText(infoReg.f3253);
  var phoneEl = document.getElementById('dwPhone');
  phoneEl.textContent = phone || '—';
  phoneEl.href = phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : '#';
  /* Was hardcoded 'Email' — a fabricated default, since the source export's
     Preferred Communication column was blank on every row and only the header
     implied Email. The real field is registrations.f2993, a `list` (not
     `drop`) type, so it is delimiter-wrapped and can hold more than one value.
     Renders '—' when unset rather than assuming a preference.

     Worth knowing when reading this on the floor: as of 2026-08-13 the field
     was populated account-wide, and every one of the 171 populated records
     holds 398 "Both" — zero "Email", zero "Call", none left empty on event
     218. So this row will read "Both" for every participant. That is the real
     stored value and is reported as-is, but a uniform value across the whole
     roster is consistent with a bulk default rather than a preference each
     participant actually expressed; don't treat it as an individual choice
     until someone confirms how it was set. */
  document.getElementById('dwPreferredComm').textContent =
    rosterListLabels(infoReg.f2993, ROSTER_PREFERRED_COMM_MAP) || '—';
  document.getElementById('dwJoinLink').textContent = EVENT_ZOOM_JOIN_BASE + (card.dataset.regId ? '&tk=' + card.dataset.regId : '');
  populateInformationForm(card);
  openDrawer('dwParticipant');
}

/* ---------- Join link (§0u) — one Event-wide Zoom join URL, personalized
   per participant via a registrant-tracking query param, so the CS can
   hand it to someone who's late/locked out without hunting for it. ---------- */
var EVENT_ZOOM_JOIN_BASE = 'https://us02web.zoom.us/j/88231405071?pwd=NAForum25';
function copyJoinLink(){
  var text = document.getElementById('dwJoinLink').textContent;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(
      function(){ toast('Join link copied.'); },
      function(){ toast('Could not copy — copy manually.', 'err'); }
    );
  } else {
    toast('Copy not supported in this browser — copy manually.', 'err');
  }
}

/* ---------- Information form (§0u) — the participant's own pre-Event
   submission, read-only in this drawer. Demo uses the same fictional
   placeholder set for every participant; production would merge each
   participant's actual submitted responses. ---------- */
/* rosterFieldText() — normalises an Ontraport text value for display,
   collapsing both empty string and the documented "0" blank sentinel to ''.
   Returns '' rather than '—' so callers can distinguish "nothing to show"
   from the dash they render. */
function rosterFieldText(v){
  if(v === undefined || v === null) return '';
  var s = String(v).trim();
  return (s === '' || s === '0') ? '' : s;
}
/* Every value here was previously hardcoded fixture data — the same
   "Jordan Ellis / (555) 019-2044 / Spouse" shown for every participant,
   with fabricated dietary, policy and free-text answers. Missing data
   reading as missing is safe; a fabricated emergency contact number
   presented as real is not, which is why this now renders the actual
   registration fields and an em dash where they are genuinely blank. */
function populateInformationForm(card){
  var reg = rosterFindRegById(card.dataset.regId) || {};
  function show(id, v){ document.getElementById(id).textContent = rosterFieldText(v) || '—'; }
  function showYesNo(id, v){ document.getElementById(id).textContent = rosterIsTrue(v) ? 'Yes' : 'No'; }
  show('dwEcName', reg.f2574);
  show('dwEcPhone', reg.f2575);
  show('dwEcRel', reg.f2576);
  show('dwCoaching', reg.f2578);
  showYesNo('dwAgreeReg', reg.f2585);
  showYesNo('dwAgreePriv', reg.f2584);
  showYesNo('dwAgreeTerms', reg.f2586);
  showYesNo('dwFormComplete', reg.f2579);
  show('dwAnythingKnow', reg.f2676);
  show('dwDietary', reg.f2580);
  show('dwParticipantsKnow', reg.f2582);
  show('dwWantAccomplish', reg.f2583);
}

/* ---------- Take Attendance (§0m) — REAL BUILD 2026-08-12. Attendance
   Architecture Layer 2. Replaces the old runCheckpointPoll() prototype
   stub (which only toasted a fake aggregate — no real webhook existed).
   The browser never sets an individual participant's attendance flag
   directly: CS picks Session (S1-S4) from the floating menu; the server
   resolves Day from events.f3025, does a fresh independent Zoom Live
   Dashboard poll at click-time, writes the per-session ATTENDED field for
   present participants / f3062 FS Late Arrival for everyone else on the
   full Event roster, and returns an aggregate result. Same disable-button/
   error-revert/refresh-from-server-truth pattern as every other kebab
   action this build (confirmCourseStatus() etc.) — dashboardFetchRoster()
   on success so ticks reflect real server state. ---------- */
function openTakeAttendanceMenu(btn){
  closeDetailPop();
  var menu = document.getElementById('takeAttendanceMenu');
  positionFloating(menu, btn);
  menu.classList.add('open');
}
function closeTakeAttendanceMenu(){ document.getElementById('takeAttendanceMenu').classList.remove('open'); }
function confirmTakeAttendance(session){
  closeTakeAttendanceMenu();
  var btn = document.getElementById('takeAttendanceBtn');
  if(!btn) return;
  var originalLabel = btn.textContent;
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, session: session };
  btn.disabled = true;
  btn.textContent = 'Taking attendance…';
  fetch(DASHBOARD_TAKE_ATTENDANCE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, status: res.status, result: result }; });
  }).then(function(r){
    /* The workflow being switched off is a distinct failure from the workflow erroring, and
       has to read differently. n8n answers an inactive production webhook with 404 and a
       "not registered" message — retrying that never succeeds, so the generic "try again"
       copy below actively misleads a CS into hammering a dead button during a live session.
       Verified live 2026-08-15: CS Dashboard : Take Attendance is inactive and its production
       URL returns exactly this. Detected by status AND message because either alone could
       plausibly come from something else. */
    var msg = String((r.result && (r.result.message || r.result.error)) || '');
    if(r.status === 404 || /not registered/i.test(msg)){
      var e = new Error('Take Attendance is not enabled for this account.');
      e.disabled = true;
      throw e;
    }
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    btn.disabled = false;
    btn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' took attendance — Session ' + session + ' (Day ' + r.result.day + ') — ' + r.result.presentCount + ' present, ' + r.result.lateMarkedCount + ' not yet present');
    toast('Attendance taken — Session ' + session + ': ' + r.result.presentCount + ' present · ' + r.result.lateMarkedCount + ' not present yet.');
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmTakeAttendance failed:', err);
    btn.disabled = false;
    btn.textContent = originalLabel;
    if(err && err.disabled){
      /* Names the alternative rather than just refusing. Presence is still being recorded by
         the Zoom poller regardless, so the CS needs to know nothing is being lost — and that
         a single record can still be fixed by hand through the row's Correct Attendance
         action, whose workflow IS active. */
      toast('Take Attendance is switched off for this account. Live presence is still being recorded automatically; use a row\'s ••• → Correct Attendance to set one manually.', 'err');
      return;
    }
    btn.textContent = 'Could not take attendance — try again';
    setTimeout(function(){ btn.textContent = originalLabel; }, 2600);
  });
}

/* ---------- Person comboboxes: Spouse (household link) and the guest's
   inviting Participant. Nothing marks these as dropdowns at rest — value
   just reads as normal data; click/focus opens the filtered option list,
   same interaction as any other click-to-edit field. ---------- */
var PARTICIPANT_NAMES = ['Emily Maddox','Michael Mankowski','Acacia Blyth','Galahad Blyth','Gabe Shamash','Henry Kay','Paul Schürch','Lisa Moreno','Annamarie Phillips','Gretchen Leaton','Suzanne Kronisch','Melissa Clark'];
function renderCombo(input, names, onSelect){
  var q = input.value.toLowerCase().trim();
  var matches = names.filter(function(n){ return !q || n.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
  var list = input.nextElementSibling;
  list.innerHTML = matches.length
    ? matches.map(function(n){ return '<div class="combo-opt" onmousedown="' + onSelect + '(this,\'' + n.replace(/'/g, "\\'") + '\')">' + n + '</div>'; }).join('')
    : '<div class="combo-opt muted">No match</div>';
  list.classList.add('open');
}
function comboBlur(input){
  var list = input.nextElementSibling;
  setTimeout(function(){ list.classList.remove('open'); }, 150);
}
function spouseFilter(input){ renderCombo(input, PARTICIPANT_NAMES, 'selectSpouse'); }
function selectSpouse(el, name){
  var wrapper = el.closest('.spouse-combo');
  var input = wrapper.querySelector('.spouse-input');
  input.value = name;
  wrapper.querySelector('.combo-list').classList.remove('open');
  inlineSave(input);
}
function spouseBlur(input){ comboBlur(input); }

function participantBlur(input){ comboBlur(input); }

/* ---------- Roster & Guests: search + 10-per-page pagination ---------- */
/* ---------- Course snapshot metrics as roster filters (§0y) — Event Management only.
   Rewritten 2026-08-15 to test the card's data-flags string (see rosterRecordFlags())
   instead of interrogating rendered markup. The old predicates asked questions like
   `card.querySelector('.ev-name-row .p-ldp')` — using the presence of a CSS class, in a
   specific DOM position, as a stand-in for a field value. That coupled every filter to the
   row's visual structure: this rebuild moved the status pills out of .ev-name-row, which
   would have silently broken four of them with no error anywhere. Flags are derived once
   from the registration, so tile, pill and filter cannot disagree.

   Two exceptions still read the DOM, and legitimately so: `starts` and `attendanceNow`
   are about a specific day's tick, which is genuinely a rendered, day-relative thing. ---- */
var rosterStatFilter = null;
function rosterFlagFilter(label, flag){
  return { label: label, test: function(card){ return rosterHasFlag(card, flag); } };
}
var ROSTER_STAT_FILTERS = {
  /* 'all' is the Total event registrations tile. It matches everything — its purpose is to
     be the obvious way back out of any other filter, since the tile a CS is most likely to
     click after narrowing is the total. */
  all: { label: 'All participants', test: function(){ return true; } },
  starts: { label: 'Starts (Day 1)', test: function(card){
    return !!card.querySelector('.tick[data-day-num="1"].tk-attended');
  } },
  current: rosterFlagFilter('Active participants', 'current'),
  ldp: rosterFlagFilter('LDP', 'ldp'),
  wbo: rosterFlagFilter('WBO', 'wbo'),
  wbs: rosterFlagFilter('WBS — withdrew before start', 'withdrawn'),
  /* Absent covers both resolved absence states, matching the tile it drives — the tile
     counts f3191 467 and 468 together and splits them in its sub-label. */
  absent: { label: 'Absent', test: function(card){ return rosterHasFlag(card, 'absent') || rosterHasFlag(card, 'nsho'); } },
  nsho: rosterFlagFilter('Absent — NCNS', 'nsho'),
  late: rosterFlagFilter('Late', 'late'),
  liveNow: rosterFlagFilter('Live now', 'live'),
  sharedDevice: rosterFlagFilter('Shared device', 'shareddevice'),
  multiDevice: rosterFlagFilter('Multi-device', 'multidevice'),
  unmatched: rosterFlagFilter('Zoom match unresolved', 'unmatched'),
  completions: { label: 'Completions', test: function(card){
    return rosterHasFlag(card, 'd3');
  } },
  attendanceNow: { label: 'Attendance now', test: function(card){
    var day = { '404':1, '405':2, '406':3 }[String(DASHBOARD_DATA.todaysSessionRaw)] || 1;
    return !!card.querySelector('.tick[data-day-num="' + day + '"].tk-attended');
  } },
  seminar: rosterFlagFilter('Seminar registered', 'seminar'),
  ac: rosterFlagFilter('AC registered', 'ac'),
  reviewer: rosterFlagFilter('Reviewer', 'reviewer'),
  se: rosterFlagFilter('SE', 'se'),
  /* PNA (formerly PIQ) — the participants a CS still has to work. Both keys resolve to the
     same predicate so the rename could not strand an existing caller. */
  piq: rosterFlagFilter('Participants needing attention', 'queued'),
  pna: rosterFlagFilter('Participants needing attention', 'queued')
};
/* aria-pressed alongside the .active class throughout. These tiles are toggles — clicking
   the active one clears it — and that on/off state was previously carried by background
   colour alone, which conveys nothing to a screen reader and nothing to a CS who cannot
   distinguish the tint. */
function rosterMarkTiles(activeEl){
  document.querySelectorAll('#em-snapshot .stat-filterable').forEach(function(s){
    var on = s === activeEl;
    s.classList.toggle('active', on);
    s.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function applyStatFilter(key, el){
  if(rosterStatFilter === key){ clearStatFilter(); return; }
  rosterStatFilter = key;
  rosterMarkTiles(el);
  rosterSyncFilterChip();
  pageState.roster = 1;
  paginate('roster');
}
function clearStatFilter(){
  rosterStatFilter = null;
  rosterMarkTiles(null);
  rosterSyncFilterChip();
  pageState.roster = 1;
  paginate('roster');
}
/* One chip describes whatever narrowing is currently in force, whether it came from a
   snapshot tile or from Advanced search, so there is never a hidden filter the CS can't see
   or clear. Clicking it clears both. */
function rosterSyncFilterChip(){
  var chip = document.getElementById('rosterFilterChip');
  var label = document.getElementById('rosterFilterLabel');
  if(!chip || !label) return;
  var parts = [];
  if(rosterStatFilter && ROSTER_STAT_FILTERS[rosterStatFilter]) parts.push(ROSTER_STAT_FILTERS[rosterStatFilter].label);
  if(rosterAdvancedQuery) parts.push(rosterAdvancedQuery.label);
  // Blank the text as well as hiding it — a stale label is a trap for anything that reads
  // the chip to describe the current view, and it briefly flashes the old filter on re-show.
  if(!parts.length){ chip.style.display = 'none'; label.textContent = ''; return; }
  label.textContent = parts.join(' + ');
  chip.style.display = '';
}
/* Clears every kind of narrowing at once — tile filter, preset/built query, AND the search
   term. All three are surfaced by the same chip and the same empty state, so a control
   labelled "Clear filters" that left a search term in place would appear not to work. */
function rosterClearAllFilters(){
  rosterAdvancedQuery = null;
  var input = document.getElementById('rosterSearch');
  if(input && input.value){
    input.value = '';
    var wrap = document.getElementById('rosterSearchWrap');
    if(wrap) wrap.classList.remove('open');
  }
  rosterRenderAdvanced();
  clearStatFilter();
}
/* ---------- Roster name sort ----------
   Reorders the .ev-card elements inside #rosterList rather than re-rendering
   from the registrations array. paginate() re-reads list.children on every
   call, so DOM order is the single source of truth for ordering and this
   composes with the search box and the snapshot stat filter for free —
   neither needs to know sorting exists.

   Sorts on data-sort-name, which carries the participant's DISPLAY name (the
   "Name Likes" preferred first name where one is set, else the legal first,
   plus last). That is deliberately the string the CS actually sees on the
   card: sorting by surname while the card leads with a first name produces an
   order that looks broken to the person reading it. rosterBuildCardHtml()
   always resolves displayName to something non-empty (it falls back to the
   legal name, then to 'Unknown Participant'), so there is no blank case.

   Default is unsorted — whatever order Roster Fetch returned — until the CS
   opts in. First click sorts A-Z, subsequent clicks flip direction. */
/* ---------- Sort by attribute (2026-08-15) ----------
   Was name-only. A CS scanning 134 rows for the people who need them was reading every row;
   sorting by attribute puts those people at the top instead.

   Boolean attributes sort as "matching first", with NAME as the tiebreak — without a stable
   secondary key the non-matching remainder would sit in whatever order the server returned,
   which changes between fetches and makes the list appear to reshuffle on every live push.

   Reversing a boolean sort gives "matching last", which is a useful third thing: it answers
   "show me everyone else" without removing the flagged people from the list the way the
   exclude filter does.

   The attribute vocabulary is deliberately the same one the filter chips use, so a CS who
   has learned "Needs attention" as a filter already knows it as a sort. */
var ROSTER_SORTS = [
  { key: 'name',      label: 'Name',              asc: 'A–Z',        desc: 'Z–A' },
  { key: 'attention', label: 'Needs attention',   flags: ['queued'] },
  { key: 'live',      label: 'Live now',          flags: ['live'] },
  { key: 'late',      label: 'Late',              flags: ['late'] },
  { key: 'absent',    label: 'Absent',            flags: ['absent', 'nsho'] },
  { key: 'ldp',       label: 'Left the course',   flags: ['ldp'] },
  { key: 'device',    label: 'Device exception',  flags: ['shareddevice', 'multidevice', 'unmatched'] },
  { key: 'days',      label: 'Days attended',     numeric: true, asc: 'fewest first', desc: 'most first' }
];
var rosterSortKey = null;
function rosterSortSpec(){
  return ROSTER_SORTS.filter(function(s){ return s.key === rosterSortKey; })[0] || null;
}
/* Lower sorts earlier. Booleans map matching -> 0 so "matching first" is the natural
   ascending direction and needs no special-casing in the comparator. */
function rosterSortValue(card, spec){
  if(spec.numeric){
    var n = 0;
    ['d1','d2','d3'].forEach(function(d){ if(rosterHasFlag(card, d)) n++; });
    return n;
  }
  for(var i = 0; i < spec.flags.length; i++){ if(rosterHasFlag(card, spec.flags[i])) return 0; }
  return 1;
}
function rosterCompareNames(a, b){
  /* localeCompare with sensitivity:'base' so accented names file under their
     base letter (this roster really contains Schürch and Abdel-Wahab) and
     case never decides order. Guarded: the options argument throws on some
     older engines, and a broken sort is worse than an approximate one. */
  try{ return a.localeCompare(b, undefined, { sensitivity:'base', numeric:true }); }
  catch(e){
    var al = a.toLowerCase(), bl = b.toLowerCase();
    return al < bl ? -1 : (al > bl ? 1 : 0);
  }
}
function rosterApplySort(){
  var spec = rosterSortSpec();
  if(!spec || !rosterSortDir) return;
  var list = document.getElementById('rosterList');
  if(!list) return;
  var cards = Array.prototype.filter.call(list.children, function(c){ return c.classList.contains('ev-card'); });
  if(cards.length < 2) return;
  var dir = rosterSortDir === 'desc' ? -1 : 1;
  cards.sort(function(a, b){
    if(spec.key !== 'name'){
      var av = rosterSortValue(a, spec), bv = rosterSortValue(b, spec);
      if(av !== bv) return dir * (av - bv);
      /* Name tiebreak, always ascending regardless of the primary direction. Without a
         stable secondary key the tied remainder keeps whatever order the last fetch
         happened to return, so the list visibly reshuffles on every Ably push even though
         nothing about the sort changed. */
      return rosterCompareNames(a.dataset.sortName || '', b.dataset.sortName || '');
    }
    return dir * rosterCompareNames(a.dataset.sortName || '', b.dataset.sortName || '');
  });
  /* One fragment, one reflow — appending each card individually would thrash
     layout across a 138-row roster. Appending every card in sorted order
     re-seats the whole set, so no explicit removal is needed. */
  var frag = document.createDocumentFragment();
  cards.forEach(function(c){ frag.appendChild(c); });
  list.appendChild(frag);
}
/* The button always states the CURRENT order, not what the next click would do — it labels
   the list you are looking at, which is the reading a CS needs mid-scan. */
function rosterSortLabel(){
  var spec = rosterSortSpec();
  if(!spec || !rosterSortDir) return 'Sort';
  var desc = rosterSortDir === 'desc';
  if(spec.asc) return spec.label + ' ' + (desc ? spec.desc : spec.asc);
  return spec.label + (desc ? ' last' : ' first');
}
function rosterUpdateSortButton(){
  var btn = document.getElementById('rosterSortBtn');
  if(!btn) return;
  btn.textContent = rosterSortLabel();
  btn.classList.toggle('on', !!rosterSortKey);
  btn.setAttribute('aria-pressed', rosterSortKey ? 'true' : 'false');
}
function openRosterSortMenu(btn){
  closeDetailPop();
  var menu = document.getElementById('rosterSortMenu');
  if(!menu) return;
  menu.innerHTML = ROSTER_SORTS.map(function(s){
    var on = rosterSortKey === s.key;
    /* Each row shows the direction it will apply, and the active one shows a check plus the
       direction it is currently in, so choosing it again to flip direction is discoverable
       rather than something you have to be told. */
    var hint = s.asc ? (on && rosterSortDir === 'desc' ? s.desc : s.asc) : (on && rosterSortDir === 'desc' ? 'last' : 'first');
    return '<button class="kebab-item' + (on ? ' on' : '') + '" onclick="rosterSetSort(\'' + s.key + '\')">' +
      (on ? '✓ ' : '') + rosterEscHtml(s.label) + '<span class="sort-hint">' + rosterEscHtml(hint) + '</span></button>';
  }).join('') + '<button class="kebab-item" onclick="rosterClearSort()">Clear sort</button>';
  positionFloating(menu, btn);
  menu.classList.add('open');
}
function closeRosterSortMenu(){
  var m = document.getElementById('rosterSortMenu');
  if(m) m.classList.remove('open');
}
function rosterSetSort(key){
  // Same key again flips direction; a different key starts ascending.
  if(rosterSortKey === key) rosterSortDir = rosterSortDir === 'asc' ? 'desc' : 'asc';
  else { rosterSortKey = key; rosterSortDir = 'asc'; }
  closeRosterSortMenu();
  rosterApplySort();
  /* Back to page 1: holding the page number across a re-sort would land the
     CS on a page of people they never asked to see. */
  pageState.roster = 1;
  paginate('roster');
  rosterUpdateSortButton();
}
function rosterClearSort(){
  /* Returns to server order rather than to name order. There is no way to un-sort a list
     that has already been reordered in the DOM, so this refetches — which is also the only
     way to get back the order the server actually returned. */
  rosterSortKey = null;
  rosterSortDir = null;
  closeRosterSortMenu();
  rosterUpdateSortButton();
  if(dashboardLastRoster) dashboardRenderRoster(dashboardLastRoster);
}
/* Rows per page. Was a hardcoded 10 in three places inside paginate(); now one variable so
   the roster's new rows-per-page control can move it. Guests stay at 10 — that list is
   short and has no control of its own. */
var rosterPageSize = 10;

/* ---------- Active / Inactive view mode (2026-08-15) ----------
   The roster shows ACTIVE registrations by default and nothing else. Inactive records are
   batched behind their own view rather than removed, so they remain inspectable without
   cluttering the list a CS works during a live session.

   Modelled as a mode rather than as another entry in ROSTER_STAT_FILTERS on purpose: a
   filter narrows the current population, whereas this SWAPS which population is on screen.
   Treating it as a filter would have made "no filter" mean "everyone", which is exactly the
   mixed list this is meant to prevent. */
var rosterShowInactive = false;
function rosterToggleInactive(){
  rosterShowInactive = !rosterShowInactive;
  /* Filters are cleared on the way in and out. They were chosen against the other
     population, so carrying them across would silently narrow the view the CS just switched
     to — and an empty Inactive list caused by a stale Late filter reads as "no inactive
     records", which is wrong and unfalsifiable from the screen. */
  rosterStatFilter = null;
  rosterAdvancedQuery = null;
  rosterMarkTiles(null);
  var input = document.getElementById('rosterSearch');
  if(input && input.value){
    input.value = '';
    var wrap = document.getElementById('rosterSearchWrap');
    if(wrap) wrap.classList.remove('open');
  }
  rosterRenderAdvanced();
  rosterSyncFilterChip();
  pageState.roster = 1;
  paginate('roster');
  rosterSyncInactiveButton();
}
function rosterSyncInactiveButton(){
  var btn = document.getElementById('rosterInactiveBtn');
  if(!btn) return;
  var list = document.getElementById('rosterList');
  var count = list ? list.querySelectorAll('.ev-card[data-flags*=" inactive "]').length : 0;
  var label = btn.querySelector('.inactive-lbl');
  var num = btn.querySelector('.inactive-n');
  if(label) label.textContent = rosterShowInactive ? 'Back to active' : 'Inactive';
  if(num){
    num.textContent = count;
    // The count is only meaningful on the way IN; once inside, it is the list you are
    // looking at, and repeating it beside "Back to active" reads as a second population.
    num.style.display = (!rosterShowInactive && count > 0) ? '' : 'none';
  }
  btn.classList.toggle('on', rosterShowInactive);
  btn.setAttribute('aria-pressed', rosterShowInactive ? 'true' : 'false');
  // Nothing inactive and not currently viewing it — the control has nothing to offer.
  btn.style.display = (count === 0 && !rosterShowInactive) ? 'none' : '';
}
function rosterSetPageSize(size){
  var n = Number(size) || 10;
  rosterPageSize = n;
  /* Back to page 1 rather than trying to keep the CS's scroll position: after a size change
     the old page number points at a different set of people, and silently landing them on
     page 4 of a re-cut list is more disorienting than an honest reset. */
  pageState.roster = 1;
  paginate('roster');
}
function paginate(kind){
  var list = document.getElementById(kind + 'List');
  var searchEl = document.getElementById(kind + 'Search');
  var q = (searchEl.value || '').toLowerCase().trim();
  var cards = Array.prototype.filter.call(list.children, function(c){ return c.classList.contains('ev-card'); });
  var filtered = cards.filter(function(c){
    /* Inactive records are batched out of the working roster before any other filter runs.
       This is a VIEW MODE, not a filter: the CS's default list is the people they can
       actually act on, and inactive records are reachable only by switching into the
       Inactive view. Applied first so it cannot be accidentally defeated by a search term
       or a stat filter that happens to match a withdrawn record. */
    if(kind === 'roster'){
      var isInactive = rosterHasFlag(c, 'inactive');
      if(rosterShowInactive !== isInactive) return false;
    }
    if(q && (c.dataset.search || '').indexOf(q) === -1) return false;
    if(kind === 'roster' && rosterStatFilter && !ROSTER_STAT_FILTERS[rosterStatFilter].test(c)) return false;
    if(kind === 'roster' && rosterAdvancedQuery && !rosterAdvancedQuery.test(c)) return false;
    return true;
  });
  var perPage = kind === 'roster' ? rosterPageSize : 10;
  var totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if(pageState[kind] > totalPages) pageState[kind] = totalPages;
  if(pageState[kind] < 1) pageState[kind] = 1;
  var start = (pageState[kind] - 1) * perPage, end = start + perPage;
  cards.forEach(function(c){ c.style.display = 'none'; });
  filtered.slice(start, end).forEach(function(c){ c.style.display = ''; });

  /* Empty state. With every row hidden the list rendered as blank space, which reads exactly
     like a failed load — a CS filtering to "Absent NCNS" and seeing nothing could not tell
     whether nobody matched or whether the dashboard had broken. Says which, names the reason,
     and offers the way out, since the narrowing that caused it may be a tile, a preset, a
     built query or a search term (or several at once). */
  var emptyId = kind + 'Empty';
  var emptyEl = document.getElementById(emptyId);
  if(!filtered.length && cards.length){
    if(!emptyEl){
      emptyEl = document.createElement('div');
      emptyEl.id = emptyId;
      emptyEl.className = 'ev-empty';
      list.appendChild(emptyEl);
    }
    var why = [];
    if(q) why.push('the search “' + q + '”');
    if(kind === 'roster' && rosterStatFilter && ROSTER_STAT_FILTERS[rosterStatFilter]) why.push('the ' + ROSTER_STAT_FILTERS[rosterStatFilter].label + ' filter');
    if(kind === 'roster' && rosterAdvancedQuery) why.push('the query “' + rosterAdvancedQuery.label + '”');
    /* Names the population as well as the filters. "No participants match" inside the
       Inactive view, with no mention of which list is on screen, would read as though the
       whole roster were empty. */
    var where = (kind === 'roster' && rosterShowInactive) ? 'inactive registrations' : 'this roster';
    emptyEl.innerHTML = '<b>No participants match</b>' +
      (why.length ? 'Nobody in ' + where + ' matches ' + why.join(' and ') + '.'
                  : (kind === 'roster' && rosterShowInactive ? 'There are no inactive registrations.' : 'Nothing to show.')) +
      (kind === 'roster' && why.length ? '<div><button class="btn btn-sm" onclick="rosterClearAllFilters()">Clear filters</button></div>' : '');
    emptyEl.style.display = '';
  } else if(emptyEl){
    emptyEl.style.display = 'none';
  }
  document.getElementById(kind + 'PageLabel').textContent = 'Page ' + pageState[kind] + ' of ' + totalPages;
  var showingEl = document.getElementById(kind === 'roster' ? 'rosterShowingCount' : 'guestShowingCount');
  if(showingEl) showingEl.textContent = filtered.length;
  if(kind === 'roster'){
    list.classList.toggle('viewing-inactive', rosterShowInactive);
    var totalEl = document.getElementById('rosterTotalCount');
    if(totalEl) totalEl.textContent = cards.length;
    /* Chevrons disable at the ends. Prev/Next used to be always-enabled buttons that
       no-opped at the boundaries — pressable controls that do nothing read as broken. */
    var prev = document.getElementById('rosterPagePrev');
    var next = document.getElementById('rosterPageNext');
    if(prev) prev.disabled = pageState.roster <= 1;
    if(next) next.disabled = pageState.roster >= totalPages;
    var advCount = document.getElementById('rosterAdvCount');
    if(advCount) advCount.textContent = filtered.length + ' of ' + cards.length + ' match';
  }
}
function filterList(kind){ pageState[kind] = 1; paginate(kind); }
function pagerGo(kind, delta){ pageState[kind] = (pageState[kind] || 1) + delta; paginate(kind); }

/* ---------- Roster search + Advanced search (2026-08-15) ----------
   The search box is collapsed to its icon until used. Everything below queries the roster
   already in the browser — dashboardLastRoster and the data-flags the rows were built with
   — so there is no webhook, no server round trip, and no new field to keep in sync. */
/* Three states, not two, so a typed query is never destroyed by one stray click:
     closed            -> open and focus
     open + has text   -> clear the text and STAY open (focused, ready to retype)
     open + empty      -> collapse
   The obvious two-state version (toggle open/closed, clearing on close) meant a CS who
   mis-clicked the magnifier lost the query they had just typed with no undo. It also can't
   simply collapse while keeping the value: a hidden search box still filtering the list is
   the invisible-filter problem the chip and the empty state exist to prevent. Clearing in
   place resolves both — nothing is hidden, and nothing is lost without the CS seeing it go. */
function rosterToggleSearch(){
  var wrap = document.getElementById('rosterSearchWrap');
  var input = document.getElementById('rosterSearch');
  if(!wrap || !input) return;
  if(!wrap.classList.contains('open')){ wrap.classList.add('open'); input.focus(); return; }
  if(input.value){ input.value = ''; filterList('roster'); input.focus(); return; }
  wrap.classList.remove('open');
}

/* Presets — the named cases a CS works from every session, straight off the flag model.
   These are exactly the ones the client named, plus the two device states, since a CS
   chasing "who is unaccounted for" almost always wants those in the same sweep. */
/* Two groups as of 2026-08-15. Adding the six follow-on states to one undifferentiated run
   of chips would have made seventeen, which stops being scannable — and the two sets answer
   different questions. Status is "who needs me right now"; Follow-on is "who still has to be
   converted", which is worked between sessions rather than during one.

   Every chip is tri-state and they all compose, so the genuinely useful combination is one
   click apart: Seminar potential included + Seminar registered EXCLUDED is exactly the
   Seminar conversion worklist, and the same pair does AC. */
var ROSTER_ADV_PRESETS = [
  { key: 'queued',       label: 'Needs attention',  group: 'Status' },
  { key: 'late',         label: 'Late',             group: 'Status' },
  { key: 'absent',       label: 'Absent',           group: 'Status' },
  { key: 'nsho',         label: 'Absent NCNS',      group: 'Status' },
  { key: 'live',         label: 'Live',             group: 'Status' },
  { key: 'ldp',          label: 'LDP',              group: 'Status' },
  { key: 'wbo',          label: 'WBO',              group: 'Status' },
  { key: 'withdrawn',    label: 'Withdrawn',        group: 'Status' },
  { key: 'unmatched',    label: 'Zoom unmatched',   group: 'Status' },
  { key: 'shareddevice', label: 'Shared device',    group: 'Status' },
  { key: 'multidevice',  label: 'Multi-device',     group: 'Status' },
  { key: 'seminar',      label: 'SEM reg',          group: 'Follow-on' },
  { key: 'sempot',       label: 'SEM POT',          group: 'Follow-on' },
  { key: 'semnp',        label: 'SEM NP',           group: 'Follow-on' },
  { key: 'ac',           label: 'AC reg',           group: 'Follow-on' },
  { key: 'acpot',        label: 'AC POT',           group: 'Follow-on' },
  { key: 'acnp',         label: 'AC NP',            group: 'Follow-on' }
];

/* Queryable fields for the builder. Each is a flag token plus a human label — deliberately
   the same vocabulary the presets and the snapshot tiles use, so a CS who has learned one
   has learned all three. Everything is boolean because everything on this row is: the
   record either carries the flag or it doesn't. */
var ROSTER_ADV_FIELDS = [
  { key: 'live', label: 'Present now' },
  { key: 'late', label: 'Late arrival' },
  { key: 'absent', label: 'Absent — excused' },
  { key: 'nsho', label: 'Absent — NCNS' },
  { key: 'ldp', label: 'Left during programme' },
  { key: 'wbo', label: 'Well Being Out' },
  { key: 'withdrawn', label: 'Withdrawn' },
  { key: 'queued', label: 'Needs attention' },
  { key: 'unmatched', label: 'Zoom match unresolved' },
  { key: 'shareddevice', label: 'Shared device' },
  { key: 'multidevice', label: 'Multi-device' },
  { key: 'current', label: 'Still participating' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'se', label: 'Statistical exclusion' },
  { key: 'minor', label: 'Minor' },
  { key: 'seminar', label: 'Seminar registered' },
  { key: 'sempot', label: 'Seminar potential' },
  { key: 'semnp', label: 'Seminar non-potential' },
  { key: 'ac', label: 'AC registered' },
  { key: 'acpot', label: 'AC potential' },
  { key: 'acnp', label: 'AC non-potential' },
  { key: 'd1', label: 'Attended Day 1' },
  { key: 'd2', label: 'Attended Day 2' },
  { key: 'd3', label: 'Attended Day 3' }
];

var rosterAdvancedQuery = null;   // {label, test} once applied
var rosterAdvConditions = [];      // [{field, op}] while being edited

function rosterToggleAdvanced(){
  var panel = document.getElementById('rosterAdvPanel');
  if(!panel) return;
  panel.hidden = !panel.hidden;
  document.getElementById('rosterAdvBtn').classList.toggle('on', !panel.hidden);
  if(!panel.hidden){
    if(!rosterAdvConditions.length) rosterAdvConditions = [{ field: ROSTER_ADV_FIELDS[0].key, op: 'is' }];
    rosterRenderAdvanced();
    paginate('roster');
  }
}
function rosterAddCondition(){
  rosterAdvConditions.push({ field: ROSTER_ADV_FIELDS[0].key, op: 'is' });
  rosterRenderAdvanced();
}
function rosterRemoveCondition(i){
  rosterAdvConditions.splice(i, 1);
  rosterRenderAdvanced();
}
function rosterCondChanged(i, what, value){
  if(!rosterAdvConditions[i]) return;
  rosterAdvConditions[i][what] = value;
}
/* One chip. The excluded state prefixes its own label with "not" rather than relying on
   colour alone — a red chip reading "Late" is ambiguous about whether it shows late people
   or hides them, and colour is the one channel some users cannot read. */
function rosterPresetChipHtml(p){
  var st = rosterPresetState[p.key];
  var cls = st === 'in' ? ' on' : (st === 'ex' ? ' ex' : '');
  var text = (st === 'ex' ? 'not ' : '') + p.label;
  var title = st === 'in' ? 'Showing only ' + p.label + ' — click to exclude instead'
            : st === 'ex' ? 'Hiding ' + p.label + ' — click to clear'
            : 'Click to show only ' + p.label + ', twice to exclude';
  return '<button class="advchip' + cls + '" aria-pressed="' + (st === 'in' ? 'true' : 'false') +
    '" title="' + rosterEscAttr(title) + '" onclick="rosterCyclePreset(\'' + p.key + '\')">' + rosterEscHtml(text) + '</button>';
}
function rosterRenderAdvanced(){
  /* Seed the first condition here rather than only in rosterToggleAdvanced(). The builder
     is useless with zero rows — there is nothing to edit and "+ Add condition" is the only
     way in — and seeding at the single point that draws it means the panel is always usable
     however it came to be shown. */
  if(!rosterAdvConditions.length) rosterAdvConditions = [{ field: ROSTER_ADV_FIELDS[0].key, op: 'is' }];
  var presetWrap = document.getElementById('rosterAdvPresets');
  if(presetWrap){
    /* Rendered as labelled groups, in declaration order, so adding a preset is a one-line
       change to ROSTER_ADV_PRESETS and never a markup edit. */
    var groups = [];
    ROSTER_ADV_PRESETS.forEach(function(p){
      var g = groups.filter(function(x){ return x.name === (p.group || 'Popular'); })[0];
      if(!g){ g = { name: p.group || 'Popular', items: [] }; groups.push(g); }
      g.items.push(p);
    });
    presetWrap.innerHTML = groups.map(function(g, gi){
      return '<div class="advsearch-row">' +
        '<span class="advsearch-l">' + rosterEscHtml(g.name) +
          (gi === 0 ? '<span class="advsearch-hint">click twice to exclude</span>' : '') +
        '</span>' +
        '<div class="advsearch-presets">' + g.items.map(rosterPresetChipHtml).join('') + '</div>' +
      '</div>';
    }).join('');
  }
  var condWrap = document.getElementById('rosterAdvConds');
  if(condWrap){
    condWrap.innerHTML = rosterAdvConditions.map(function(c, i){
      var opts = ROSTER_ADV_FIELDS.map(function(f){
        return '<option value="' + f.key + '"' + (f.key === c.field ? ' selected' : '') + '>' + rosterEscHtml(f.label) + '</option>';
      }).join('');
      return '<div class="advcond">' +
        '<span class="advcond-l">' + (i === 0 ? 'Where' : '<span class="advcond-join" data-join="1"></span>') + '</span>' +
        '<select onchange="rosterCondChanged(' + i + ',\'field\',this.value)">' + opts + '</select>' +
        '<select onchange="rosterCondChanged(' + i + ',\'op\',this.value)">' +
          '<option value="is"' + (c.op === 'is' ? ' selected' : '') + '>is</option>' +
          '<option value="not"' + (c.op === 'not' ? ' selected' : '') + '>is not</option>' +
        '</select>' +
        '<button class="advcond-x" onclick="rosterRemoveCondition(' + i + ')" aria-label="Remove condition" title="Remove">✕</button>' +
      '</div>';
    }).join('');
    rosterSyncCondJoinLabels();
  }
}
/* The "and"/"or" word between rows mirrors the Match selector, so the builder reads as the
   sentence it will actually evaluate rather than leaving the CS to infer it from a dropdown
   at the bottom. */
function rosterSyncCondJoinLabels(){
  var mode = (document.getElementById('rosterAdvMatch') || {}).value || 'all';
  document.querySelectorAll('#rosterAdvConds [data-join="1"]').forEach(function(el){
    el.textContent = mode === 'any' ? 'or' : 'and';
  });
}
/* ---------- Preset chips: three states, and they compose (2026-08-15) ----------
   Was single-select and include-only: clicking a chip replaced whatever was there, and there
   was no way to say "everyone EXCEPT". Exclusion existed only in the row builder below, where
   a CS has to open a panel and pick from two dropdowns to express "not late" — which is the
   single most common thing they want and should not cost that much.

   Each chip now cycles  off -> include -> exclude -> off, and any number can be on at once.
   Includes AND together, excludes AND together, and the two combine: "Late, not SE" is two
   clicks on one chip and two on another.

   Kept as a cycle on the same chip rather than adding a parallel row of "exclude" chips: the
   vocabulary is already eleven items long and duplicating it would double a list a CS has to
   scan, to express a state that belongs to the item itself. */
var rosterPresetState = {};   // key -> 'in' | 'ex'   (absent = off)
function rosterCyclePreset(key){
  var cur = rosterPresetState[key];
  if(!cur) rosterPresetState[key] = 'in';
  else if(cur === 'in') rosterPresetState[key] = 'ex';
  else delete rosterPresetState[key];
  rosterComposeQuery();
}

/* The row builder's own result, held separately from the chips so the two layers can be
   edited independently and still both apply. Previously each overwrote the other, so opening
   the builder silently discarded the chip you had just clicked. */
var rosterBuilderQuery = null;

/* One query from both layers, ANDed. Called by every path that changes either. */
function rosterComposeQuery(){
  var inc = [], exc = [];
  Object.keys(rosterPresetState).forEach(function(k){
    (rosterPresetState[k] === 'ex' ? exc : inc).push(k);
  });
  var labelFor = function(k){
    var p = ROSTER_ADV_PRESETS.filter(function(x){ return x.key === k; })[0];
    return p ? p.label : k;
  };
  var parts = inc.map(labelFor).concat(exc.map(function(k){ return 'not ' + labelFor(k); }));
  if(rosterBuilderQuery) parts.push(rosterBuilderQuery.label);

  if(!parts.length){
    rosterAdvancedQuery = null;
  } else {
    rosterAdvancedQuery = {
      label: parts.join(' · '),
      test: function(card){
        for(var i = 0; i < inc.length; i++){ if(!rosterHasFlag(card, inc[i])) return false; }
        for(var j = 0; j < exc.length; j++){ if(rosterHasFlag(card, exc[j])) return false; }
        return rosterBuilderQuery ? rosterBuilderQuery.test(card) : true;
      }
    };
  }
  rosterRenderAdvanced();
  rosterSyncFilterChip();
  pageState.roster = 1;
  paginate('roster');
}
function rosterApplyAdvanced(){
  rosterSyncCondJoinLabels();
  var mode = (document.getElementById('rosterAdvMatch') || {}).value || 'all';
  var conds = rosterAdvConditions.filter(function(c){ return !!c.field; });
  var labelFor = function(k){
    var f = ROSTER_ADV_FIELDS.filter(function(x){ return x.key === k; })[0];
    return f ? f.label : k;
  };
  /* Sets only the BUILDER layer. Any preset chips stay in force — applying a built query
     used to wipe them, which meant the panel could silently undo a click made outside it. */
  rosterBuilderQuery = !conds.length ? null : {
    label: conds.map(function(c){ return (c.op === 'not' ? 'not ' : '') + labelFor(c.field); }).join(mode === 'any' ? ' or ' : ' and '),
    test: function(card){
      var results = conds.map(function(c){
        var has = rosterHasFlag(card, c.field);
        return c.op === 'not' ? !has : has;
      });
      return mode === 'any' ? results.some(Boolean) : results.every(Boolean);
    }
  };
  rosterComposeQuery();
}
function rosterClearAdvanced(){
  // Clears BOTH layers — a control labelled "Clear" that left chips lit would not be clearing.
  rosterPresetState = {};
  rosterBuilderQuery = null;
  rosterAdvConditions = [];
  rosterComposeQuery();
}

/* ---------- 4.7 / §8 Live Material Release — sectioned by day, no tabs.
   Each row is just the toggle and title + type — no separate
   Hidden/Visible pill, no notification-status pill, no Resend button,
   and since 2026-08-14 no "first shown" timestamp cell either (it was
   never wired to a real release time, so it sat on hardcoded demo
   values; the handlers below no longer write to children[2]).
   Rows carrying data-key + data-toggle write through the matching
   webhook on confirm — semantic key + explicit boolean, server flips the
   field directly (no read-then-toggle). data-toggle="materials" covers
   the 6 Course Materials fields (events.f3121-f3126); data-toggle=
   "announcements" covers the 3 Announcements fields (f3104/f3105/f3167,
   built 2026-08-12) — both already fire the existing PORTAL : Ably
   Publish automation once the field write lands. */
var DASHBOARD_TOGGLE_WEBHOOKS = {
  materials: 'https://landmarkworldwide.awesomate.io/webhook/dashboard-course-materials',
  announcements: 'https://landmarkworldwide.awesomate.io/webhook/dashboard-announcements'
};
function dashboardWriteToggle(btn, value, onSuccess, onError){
  var key = btn.dataset.key;
  var url = DASHBOARD_TOGGLE_WEBHOOKS[btn.dataset.toggle];
  if(!key || !url){ if(onSuccess) onSuccess(); return; }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventTeamId: DASHBOARD_DATA.eventTeamId, key: key, value: value })
  }).then(function(res){
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    if(onSuccess) onSuccess();
  }).catch(function(err){
    console.error('dashboardWriteToggle failed:', err);
    if(onError) onError(err);
  });
}
/* directToggle() — added 2026-08-12 for the stakeholder walkthrough: client
   wanted every toggle to write immediately on click, no confirm-are-you-sure
   modal first ("simply toggle on checks the box, toggle off unchecks the
   box"). The old relToggle()/confirmRelease()/confirmRehide()/
   confirmReshow() modal flow (superseded by this) was removed 2026-08-13.
   Revised later the same day: ON now confirms again via openToggleConfirm()
   because every ON write notifies registrants. OFF kept the instant
   behaviour, so the original decision still holds in the direction that
   can't send anything. Note this is a single shared dialog, NOT a return
   to the old per-action relToggle()/confirmRelease() family. */
function directToggle(btn){
  if(btn.disabled) return;
  var isOn = btn.classList.contains('on');
  var newVal = !isOn;
  /* Switching ON is what notifies registrants — materials/announcements
     push live via Ably, the Emails rows fire an Ontraport send — so every
     toggle confirms first (client decision 2026-08-13, partially walking
     back the "no confirm modal anywhere" call above). Switching back OFF
     writes the field but notifies nobody, so it stays a one-click action;
     a warning there would be claiming something that doesn't happen. */
  if(newVal){ openToggleConfirm(btn); return; }
  applyToggleWrite(btn, false);
}
/* applyToggleWrite() — the original directToggle() body, split out so the
   confirm path and the instant OFF path share one implementation
   (optimistic class flip, disable, revert + toast on failure). */
function applyToggleWrite(btn, newVal){
  if(newVal){ btn.classList.add('on'); } else { btn.classList.remove('on'); }
  btn.disabled = true;
  dashboardWriteToggle(btn, newVal, function(){
    btn.disabled = false;
  }, function(){
    if(newVal){ btn.classList.remove('on'); } else { btn.classList.add('on'); }
    btn.disabled = false;
    toast('Could not save — try again.', 'err');
  });
}
/* Toggle confirmation — added 2026-08-13. Every ON write goes through
   #mToggleConfirm first, warning that it notifies all registrants of the
   event. Reuses the existing openModal/dismissModal stack and the End
   Session modal's .warnbox styling rather than inventing a new dialog.
   Recipient count comes from DASHBOARD_DATA.participantCount, already
   server-verified by CS Dashboard : Bootstrap and the same number shown
   on the Home card — falls back to a neutral phrase if Bootstrap failed,
   so the dialog never shows a confident wrong number. */
/* Copy is per-card, keyed by the containing .card's id, because the three
   sections do genuinely different things and a single generic warning read
   as vague. Keyed on card id rather than data-toggle since Announcements
   and Emails deliberately share data-toggle="announcements" (they post to
   the same webhook — see the Emails card comment in the body block), so
   data-toggle alone cannot tell them apart. */
var TOGGLE_CONFIRM_COPY = {
  'ms-release': {
    warn: 'This releases material to participants',
    heading: function(name){ return 'Release ' + name + '?'; },
    body: function(name){
      return 'Confirming will release ' + name + ' and may also be accompanied by an email notification. '
           + 'Only proceed if you are ready to release the material.';
    },
    cta: 'Confirm and Release'
  },
  'ms-announcements': {
    warn: 'This releases content to every registrant’s member portal',
    heading: function(name){ return 'Release The “' + name + '” Announcement?'; },
    body: function(name, recipients){
      return 'Confirming will release ' + name + ' content to the member portal of all ' + recipients
           + ' and may also be accompanied by an email notification. '
           + 'Only proceed if you are ready to release the ' + name + ' announcement.';
    },
    cta: 'Confirm and Release'
  },
  'ms-emails': {
    warn: 'This sends an email to every registrant of this event',
    heading: function(name){ return 'Send The “' + name + '” Email?'; },
    body: function(name, recipients){
      return 'Confirming will send the ' + name + ' email to ' + recipients + ' of this event. '
           + 'Only proceed if you are ready to send the email now.';
    },
    cta: 'Confirm & Send'
  }
};
var pendingToggleConfirm = null;
function openToggleConfirm(btn){
  pendingToggleConfirm = btn;
  /* Prefer the row's visible .nm text over data-title: data-title carries a
     disambiguating suffix ("Seminar announcement", "Invite Your Guests
     email") that reads as a stutter once the copy already says
     Announcement/Email around it. */
  var row = btn.closest('.res-row');
  var nmEl = row ? row.querySelector('.nm') : null;
  var name = (nmEl && nmEl.textContent.trim()) || btn.dataset.title || 'this item';
  var card = btn.closest('.card');
  var copy = (card && TOGGLE_CONFIRM_COPY[card.id]) || TOGGLE_CONFIRM_COPY['ms-release'];
  var n = DASHBOARD_DATA.participantCount;
  var recipients = (n === null || n === undefined || n === '')
    ? 'every registrant'
    : (n + (Number(n) === 1 ? ' registrant' : ' registrants'));
  var set = function(id, text){ var el = document.getElementById(id); if(el) el.textContent = text; };
  set('tcHeading', copy.heading(name, recipients));
  set('tcWarnTitle', copy.warn);
  set('tcBody', copy.body(name, recipients));
  set('btnConfirmToggle', copy.cta);
  openModal('mToggleConfirm');
}
function cancelToggleConfirm(){ pendingToggleConfirm = null; dismissModal(); }
function confirmToggleConfirm(){
  var btn = pendingToggleConfirm;
  pendingToggleConfirm = null;
  dismissModal();
  if(btn) applyToggleWrite(btn, true);
}

/* ---------- CS Dashboard : Ably Realtime (added 2026-08-12) ----------
   Both directions of "Ably subscribe both directions":
     Direction 1 — subscribes to material.changed / announcement.changed /
       day.advanced, already published by the CS Dashboard's own toggle
       actions (dashboardWriteToggle) and End Session (confirmEndSession)
       via the existing PORTAL : Ably Publish automation. This is what
       makes a second open dashboard tab/device reflect a change live,
       and is part of what backs the client's locked "no Recalculate
       button anywhere" decision.
     Direction 2 — subscribes to attendance.changed, whitelist of 28
       fields on PORTAL : Ably Publish (f2853, the 12 session ATTENDED
       fields f3193-f3203/f3055, f3062, f2801-f2803, f3206, f3044,
       f3046, f2882, f2887, f2303, f2302, f2293, f3056, f3059, f2688,
       f3191). The first 14 ALSO publish automatically from inside CS
       Dashboard : Take Attendance / Attendance Reconcile Sweep / LM |
       Zoom | Live Attendance Poller right after each write, but that's
       NOT sufficient on its own — a direct manual edit in Ontraport
       (confirmed 2026-08-12: shows correctly on next refresh, does NOT
       push live) bypasses those workflows entirely. Every one of the 28
       needs its own native Ontraport automation rule for a manual edit
       to push live — see ONTRAPORT-ATTENDANCE-AUTOMATION-RULES.md. For
       the 14 original fields the rule is redundant once real attendance
       flows through the workflows above instead of manual edits, but
       harmless to leave in place.

   Mirrors the subscribe-only shape of Portal.realtime in
   portal-engine.js conceptually (same dynamic-SDK-load pattern, same
   CDN URL, same "degrade silently on any failure" contract) — but this
   is a different file with its own DOM/state, so nothing is shared code.
   Auth is via PORTAL : Ably Token Auth's new eventTeamId path (CS staff
   have no oRegistrations row, so they authorize via their oEventTeam
   record instead — see n8n workflow jKY55TShApwyZ2mP), channel
   event:<eventId>, with eventId coming from dashboardFetchBootstrap()'s
   now-additive eventId field (server-verified, independent of the
   [Page//Event//ID] merge tag already in DASHBOARD_DATA).

   Guarded against the known local-demo limitation (merge tags/
   eventTeamId unresolved): dashboardInitRealtime() only runs from
   dashboardFetchBootstrap()'s SUCCESS branch, and bootstrap itself
   already 400s on a non-numeric eventTeamId, so this code path is
   simply never reached in that state — no console errors either way. */
var DASHBOARD_ABLY_TOKEN_AUTH_URL = 'https://landmarkworldwide.awesomate.io/webhook/ably-token-auth';
var DASHBOARD_ABLY_SDK_URL = 'https://cdn.ably.com/lib/ably.min-2.js';
var dashboardAblyClient = null;
var DASHBOARD_ATTENDANCE_TICK_FIELDS = {
  f3203: { label: 'S3', title: 'Day 3 Session 3 Checkpoint' },
  f3055: { label: 'S4', title: 'Day 3 Session 4 Attendance Check' }
};
var DASHBOARD_DAY_NUM_TO_RAW = { 1: '404', 2: '405', 3: '406', 'Final': '456' };

function dashboardLoadAblySdk(cb){
  if(window.Ably){ cb(); return; }
  var s = document.createElement('script');
  s.src = DASHBOARD_ABLY_SDK_URL;
  s.onload = cb;
  s.onerror = function(){ console.error('dashboardLoadAblySdk: Ably SDK failed to load'); };
  document.head.appendChild(s);
}

/* Materials — matched by data-title (the Ably message's `name`), not by
   the toggle's own data-key: the two use different string conventions
   (e.g. data-key="day3-follow-through" vs the Ably field key
   'day3-followthrough') that were never reconciled since key matching
   isn't actually needed here — data-title/name are already unique and
   exact-match across every material row (confirmed against the MATERIALS
   map in PORTAL : Ably Publish). */
function dashboardApplyMaterialChanged(msg){
  var data = (msg && msg.data) || {};
  if(!data.name) return;
  var btns = document.querySelectorAll('.tog[data-toggle="materials"]');
  for(var i = 0; i < btns.length; i++){
    var btn = btns[i];
    if(btn.dataset.title !== data.name) continue;
    var wantOn = !!data.visible;
    if(btn.classList.contains('on') === wantOn) return;
    if(wantOn){
      btn.classList.add('on');
      btn.dataset.notified = '1';
    } else {
      btn.classList.remove('on');
    }
    return;
  }
}

/* Announcements — matched case-insensitively by data-key vs the Ably
   message's `key`: PORTAL : Ably Publish normalizes AC's key to
   lowercase ('ac-open') even though the dashboard's own toggle button
   keeps the capitalized 'AC-open' as its data-key (see CS Dashboard
   build notes / portal-engine.js's identical ANNOUNCEMENT_KEY_MAP
   comment) — case-insensitive comparison sidesteps that mismatch. */
function dashboardApplyAnnouncementChanged(msg){
  var data = (msg && msg.data) || {};
  if(!data.key) return;
  var btns = document.querySelectorAll('.tog[data-toggle="announcements"]');
  for(var i = 0; i < btns.length; i++){
    var btn = btns[i];
    if(!btn.dataset.key || btn.dataset.key.toLowerCase() !== String(data.key).toLowerCase()) continue;
    var wantOn = !!data.open;
    if(btn.classList.contains('on') === wantOn) return;
    if(wantOn){
      btn.classList.add('on');
      btn.dataset.notified = '1';
    } else {
      btn.classList.remove('on');
    }
    return;
  }
}

function dashboardApplyDayAdvanced(msg){
  var data = (msg && msg.data) || {};
  var raw = DASHBOARD_DAY_NUM_TO_RAW[data.day];
  if(!raw || raw === DASHBOARD_DATA.todaysSessionRaw) return;
  DASHBOARD_DATA.todaysSessionRaw = raw;
  dashboardRenderSessionStrip();
  dashboardFetchRoster();
}

/* Attendance/classification — targeted in-place patch, not a full
   dashboardFetchRoster() refetch (these can fire often during a live
   session). Extended 2026-08-12 to cover the broader classification/LDP
   whitelist alongside the original 14 attendance/presence fields.
   f3191/f3056/f3059 are dropdown fields — PORTAL : Ably Publish now
   sends their raw option-ID string, not a collapsed boolean (fixed
   2026-08-12, see that workflow's Extract & Build Ably Message note) —
   everything else on the whitelist is a real checkbox field and still
   arrives as a boolean. The 10 of 12 session fields with no dedicated
   per-card tick (f3193-f3202) still get dashboardLastRoster kept in
   sync for correctness on the next re-render/detail-pop, just no live
   DOM patch target exists for those specifically. */
/* Must mirror RAW_VALUE_FIELDS in PORTAL : Ably Publish exactly — anything the server sends
   raw and the client coerces gets silently mangled. f3208 was published raw but missing here
   (found 2026-08-14), so a live Device Exception push wrote 1 into a field the snapshot
   compares against '474', quietly breaking the duplicate-device adjustment until the next
   full refresh. The Zoom pipeline's numeric/text fields are on the list for the same reason:
   f2871 is a join count and f2805-f2807 are minute totals, not flags. */
/* f2424 added 2026-08-15 — the SAME class of bug this comment already describes, found by
   tracing what the (still unbuilt) native rule for it would actually do on arrival.
   PORTAL : Ably Publish has had f2424 in its RAW_VALUE_FIELDS since 2026-08-14 and sends the
   raw option id, but this mirror never gained it, so the client ran `data.value ? 1 : 0` and
   turned BOTH '491' and '154' into 1. rosterIsInactive() then reads '1' as "an explicit
   non-Active option" — so a live push saying someone had been set back to ACTIVE would have
   hidden them from the roster and dropped them from every metric. Worse than the f3208 case,
   because it fires on the value that is supposed to restore a record, not remove it. */
/* All nine note fields added 2026-08-15, and f3237/f3236 with them — those two had been
   published raw by the server since 2026-08-14 while this list still coerced them, so a
   saved Attendance Override or Zoom note arrived as the boolean 1 and the notes panel would
   have rendered "1" as the note body. The queue pill happened to resolve correctly anyway
   (it only tests the field for emptiness, and "1" is non-empty), which is exactly why this
   went unnoticed: the visible symptom was right for the wrong reason. */
/* f2882/f2887 added 2026-08-15 — the third instance of this same bug. Both are DROPDOWNS and
   had been coerced since the beginning, so a live push setting Seminar Potential to 371
   arrived as 1, failed the `=== '371'` test below and repainted the pill as NP: the exact
   opposite of what was set. THE RULE, now stated once: anything that is not a checkbox
   belongs in this list, and it must mirror RAW_VALUE_FIELDS in PORTAL : Ably Publish
   exactly. */
var DASHBOARD_ATTENDANCE_RAW_FIELDS = ['f3191', 'f3056', 'f3059', 'f3208', 'f2808', 'f2871', 'f2805', 'f2806', 'f2807', 'f3190', 'f2424',
  'f3237', 'f3236', 'f2886', 'f3270', 'f3068', 'f2891', 'f3235', 'f2882', 'f2887'];
/* The note fields, mirroring ROSTER_NOTE_FIELDS. A change to any of them has to repaint the
   row's note button and count — the panel reads from dashboardLastRoster, which this handler
   keeps current, but the badge is baked into the card at build time. */
var DASHBOARD_NOTE_FIELDS = ROSTER_NOTE_FIELDS.map(function(n){ return n.field; });
var DASHBOARD_DAY_TICK_FIELDS = { f2801: 1, f2802: 2, f2803: 3 };
/* The per-day minute totals the Zoom poller writes. They live inside the D-tick's detail
   pop (rosterBuildAttendanceTick bakes them into data-pop-kv at build time), so a minutes
   change has to rebuild the tick or the pop keeps showing a stale figure until the next
   full roster fetch. Added 2026-08-14 — previously these arrived, updated dashboardLastRoster
   and repainted nothing. */
var DASHBOARD_DAY_MINUTES_FIELDS = { f2805: 1, f2806: 2, f2807: 3 };
/* Reverse index of ROSTER_DAY_SESSION_FIELDS: session field -> day number. Built rather
   than written out so the two can never disagree if a session mapping is corrected. */
var DASHBOARD_SESSION_FIELD_TO_DAY = (function(){
  var out = {};
  Object.keys(ROSTER_DAY_SESSION_FIELDS).forEach(function(day){
    ROSTER_DAY_SESSION_FIELDS[day].forEach(function(f){ out[f] = Number(day); });
  });
  return out;
})();
/* Fields that can change queue membership — the four raising conditions plus the two note
   fields that resolve them, plus the states that remove a record from the queue entirely
   (present, left the course, withdrawn). Must stay in step with rosterQueueReasons(). */
var DASHBOARD_QUEUE_FIELDS = ['f3062', 'f3191', 'f2853', 'f2808', 'f3184', 'f3207', 'f3237', 'f3236', 'f2293', 'f2424'];
function dashboardApplyAttendanceChanged(msg){
  var data = (msg && msg.data) || {};
  var regId = data.registrationId;
  var field = data.field;
  if(!regId || !field) return;
  var list = dashboardLastRoster || [];
  var reg = null;
  for(var i = 0; i < list.length; i++){
    if(Number(list[i].id) === Number(regId)){ reg = list[i]; break; }
  }
  if(!reg) return;
  var isRaw = DASHBOARD_ATTENDANCE_RAW_FIELDS.indexOf(field) !== -1;
  var newVal = isRaw ? String(data.value == null ? '' : data.value) : (data.value ? 1 : 0);
  if(String(reg[field] == null ? '' : reg[field]) === String(newVal)) return;
  reg[field] = newVal;

  var card = document.querySelector('#rosterList .ev-card[data-reg-id="' + regId + '"]');
  if(!card) return;
  /* Snapshot the flag string so the handler can tell, at the end, whether this push changed
     what the record IS rather than only how it looks. See the re-paginate at the bottom. */
  var flagsBefore = card.dataset.flags || '';

  // Status badges: LIVE/LATE/LDP/WBO/NSHO/ABSENT/WITHDRAWN — any of these can add or remove
  // a pill, so the shared applier rebuilds the whole zone rather than patching one node.
  // It also refreshes data-flags, which every filter and the Advanced search read.
  // f2688 (Well Being Out) joins the list 2026-08-15: it now has its own badge, where
  // previously it only ever appeared inside the LDP tick's popover.
  if(field === 'f2853' || field === 'f3062' || field === 'f2293' || field === 'f3191' || field === 'f2424' ||
     field === 'f2688' || field === 'f3056' || field === 'f3059' || field === 'f3061'){
    rosterApplyStatusBadges(card, reg);
  }

  /* S3/S4 checkpoint ticks. These no longer render as their own row column — they moved
     into the Day 3 tick's session chips — so this only fires if a .tick[data-field] node is
     actually present. Kept rather than deleted because rosterBuildChkpntTick() is still the
     correct patch for anywhere those two fields ARE rendered individually, and the guard
     already made it a no-op when they are not. The live session-chip refresh is handled by
     the day-tick rebuild below, which f3203/f3055 now also trigger. */
  var tickMeta = DASHBOARD_ATTENDANCE_TICK_FIELDS[field];
  if(tickMeta){
    var oldTick = card.querySelector('.tick[data-field="' + field + '"]');
    if(oldTick){
      var wrap = document.createElement('div');
      wrap.innerHTML = rosterBuildChkpntTick(newVal === 1, tickMeta.title, tickMeta.label, field);
      oldTick.replaceWith(wrap.firstChild);
    }
  }

  // D1/D2/D3 attendance ticks — f2801-f2803 directly, or f2293/f3059
  // since LDP overrides whichever day's tick matches (rebuild all 3,
  // simplest correct approach given the day match can shift).
  // The 12 per-session fields join this list 2026-08-15: they are now baked into each day
  // tick's data-pop-chips at build time, so a session flip has to rebuild the tick or the
  // popover keeps showing yesterday's chips until the next full roster fetch — the same
  // staleness DASHBOARD_DAY_MINUTES_FIELDS was added to fix.
  if(DASHBOARD_DAY_TICK_FIELDS[field] || DASHBOARD_DAY_MINUTES_FIELDS[field] || field === 'f2293' || field === 'f3059' ||
     DASHBOARD_SESSION_FIELD_TO_DAY[field]){
    [1, 2, 3].forEach(function(dayNum){
      var attendedField = 'f280' + dayNum, minutesField = 'f280' + (dayNum + 4);
      var oldDayTick = card.querySelector('.tick[data-day-num="' + dayNum + '"]');
      if(oldDayTick){
        var dwrap = document.createElement('div');
        dwrap.innerHTML = rosterBuildAttendanceTick(reg, dayNum, attendedField, minutesField, DASHBOARD_DATA.todaysSessionRaw);
        oldDayTick.replaceWith(dwrap.firstChild);
      }
    });
  }

  // REV / SE / MNR classification pills.
  var CLASS_PILL_FIELDS = {
    f3044: { classtype: 'reviewer', onClass: 'p-review', label: 'REV', title: 'Reviewer', editable: true, kvOn: [['Reviewer','Yes'],['Source','Participant history']], kvOff: [['Reviewer','No']] },
    f3046: { classtype: 'se', onClass: 'p-excluded', label: 'SE', title: 'Statistical Exclusion', editable: true, kvOn: [['Status','Excluded'],['Reason', ROSTER_SE_REASON_MAP[String(reg.f3053 || '')] || '—']], kvOff: [['Status','Not excluded']] },
    f3206: { classtype: 'mnr', onClass: 'p-minor', label: 'MNR', title: 'Minor', editable: false, kvOn: [['Status','Yes']], kvOff: [['Status','No']] }
  };
  var pillMeta = CLASS_PILL_FIELDS[field];
  if(pillMeta){
    var oldPill = card.querySelector('[data-classtype="' + pillMeta.classtype + '"]');
    if(oldPill){
      var pwrap = document.createElement('div');
      pwrap.innerHTML = rosterClassPill(pillMeta.classtype, newVal === 1, pillMeta.onClass, pillMeta.label, pillMeta.title, pillMeta.editable, pillMeta.kvOn, pillMeta.kvOff);
      oldPill.replaceWith(pwrap.firstChild);
    }
  }

  // Device Exception pill (multi-device/shared-device) — f3184/f3207/f3208
  // can each independently flip whether/what this shows; rebuild from
  // scratch (remove-then-reinsert) since it can also disappear entirely
  // (e.g. switching back to plain "Other").
  // Queue pills (ATTN! / UNMATCHED / MULTI-DEVICE / SHARED DEVICE). Any of these fields can
  // add a reason, remove one, or empty the set entirely — and the note fields resolve a
  // reason without touching the field that raised it — so the whole set is rebuilt from
  // rosterQueueReasons() rather than patched pill by pill.
  if(DASHBOARD_QUEUE_FIELDS.indexOf(field) !== -1){
    var evSub = card.querySelector('.ev-sub');
    if(evSub){
      evSub.querySelectorAll('[data-rosterpill="1"]').forEach(function(p){ p.remove(); });
      var queueWrap = document.createElement('div');
      queueWrap.innerHTML = rosterQueuePills(reg);
      while(queueWrap.firstChild) evSub.appendChild(queueWrap.firstChild);
    }
    /* Queue membership is part of data-flags (the `queued` token and each reason), and the
       PNA tile, the Needs-attention preset and the query builder all read it — so the flag
       string has to be rewritten here too, not only when a status badge changes. */
    card.dataset.flags = rosterFlagsAttr(reg);
  }

  // Seminar/AC NP-POT-REG pills — update the data-* attrs updateProgramPills()
  // already reads, then let it (and applyFollowOnLadder/syncNpFlag) do the
  // actual re-render, same as a full page load already does.
  if(field === 'f2882' || field === 'f2303'){
    var semEl = card.querySelector('.prog-seminar');
    if(semEl){
      semEl.dataset.pot = String(reg.f2882) === '371' ? '1' : '0';
      /* Must set data-potstate too, or a live clear repaints as NP — the ladder reads the
         tri-state attribute and only falls back to the boolean when it is absent. */
      semEl.dataset.potstate = String(reg.f2882) === '371' ? 'pot' : (String(reg.f2882) === '370' ? 'np' : 'none');
      semEl.dataset.reg = rosterIsTrue(reg.f2303) ? '1' : '0';
      updateProgramPills(card);
    }
  }
  if(field === 'f2887' || field === 'f2302'){
    var acEl = card.querySelector('.prog-ac');
    if(acEl){
      acEl.dataset.pot = String(reg.f2887) === '382' ? '1' : '0';
      acEl.dataset.potstate = String(reg.f2887) === '382' ? 'pot' : (String(reg.f2887) === '381' ? 'np' : 'none');
      acEl.dataset.reg = rosterIsTrue(reg.f2302) ? '1' : '0';
      updateProgramPills(card);
    }
  }

  // Master Stats/Reporting aggregate tiles (Attendance Now %, Seminar/AC
  // Registrant %, etc.) read dashboardLastRoster directly at render time —
  // the underlying per-card data above is already kept live-accurate by
  // this same function, these tiles just need to be told to recompute.
  // No new automation rule needed, all 9 fields below are already on the
  // whitelist and already patch their own per-card pill/badge above.
  // f2293/f2688/f3044/f3046 added 2026-08-13 — these drive the Current/LDP/
  // WBO/Reviewer/SE tiles, which previously sat stale after a live-pushed
  // change until some unrelated field happened to trigger a recompute.
  // f3208/f3207 also added 2026-08-13, alongside newly whitelisting and
  // self-publishing them from CS Dashboard : Device Exception — drives the
  // Device Reconciliation card's Shared/Duplicate-Device Adj. tiles, which
  // previously had no live path under any code path at all.
  // f2808/f3184/f3062/f3191/f3237/f3236 added 2026-08-14 — every one of them can change
  // queue membership, and PIQ is a tile like any other, so it has to recompute on the same
  // pass. f2424 too: it decides both the WITHDRAWN badge and whether a record counts as
  // Current at all.
  /* f2801-f2803 added 2026-08-14. A Day-attended flip rebuilt that card's tick but never
     recomputed the aggregate tiles, so Master Stats/Reporting sat stale behind the roster
     until some unrelated field happened to trigger a pass — exactly the drift
     ONTRAPORT-ATTENDANCE-AUTOMATION-RULES.md already claimed was fixed. */
  var SNAPSHOT_RECOMPUTE_FIELDS = ['f2853', 'f2882', 'f2887', 'f2303', 'f2302', 'f2293', 'f2688', 'f3044', 'f3046', 'f3208', 'f3207',
    'f2808', 'f3184', 'f3062', 'f3191', 'f3237', 'f3236', 'f2424', 'f2801', 'f2802', 'f2803'];
  if(SNAPSHOT_RECOMPUTE_FIELDS.indexOf(field) !== -1){
    dashboardRenderSnapshot(dashboardLastRoster, dashboardLastEventFields, dashboardLastStaffCount);
  }

  /* Note count badge. The panel itself always reads live — openNotes() re-parses from
     dashboardLastRoster, which this handler has already updated — but the button's count and
     its filled/empty state are baked into the card at render time, so a note arriving by
     push would leave the row saying "no notes" while the panel behind it had one. */
  if(DASHBOARD_NOTE_FIELDS.indexOf(field) !== -1){
    var notesBtn = card.querySelector('.ev-notesbtn');
    if(notesBtn){
      var count = rosterNoteEntries(reg).length;
      notesBtn.classList.toggle('has-note', count > 0);
      notesBtn.title = count ? (count + ' note' + (count === 1 ? '' : 's')) : 'Add a note';
      var nEl = notesBtn.querySelector('.ev-notesbtn-n');
      if(count && !nEl){
        nEl = document.createElement('span');
        nEl.className = 'ev-notesbtn-n';
        notesBtn.appendChild(nEl);
      }
      if(nEl){
        nEl.textContent = count;
        nEl.style.display = count ? '' : 'none';
      }
    }
  }

  /* Recompute the flag string unconditionally (2026-08-15). It used to be rewritten only by
     the status-badge and queue branches, so a live change to any OTHER flag-bearing field —
     Seminar/AC potential, registration, the day-attended flags — repainted the pill but left
     data-flags describing the previous state. The filter chips, the sort and the Advanced
     query all read that string, so the row could visibly say REG while the SEM-NP filter
     still matched it.
     One derivation over one record; cheap enough to do every time, and doing it every time
     is the only version that cannot drift. */
  card.dataset.flags = rosterFlagsAttr(reg);

  /* Re-paginate when the flag set actually changed (2026-08-15). Everything above patches
     how a row LOOKS; nothing re-evaluated whether it still belongs in the visible list.
     That was survivable while the roster showed everyone, and stopped being survivable with
     the active/inactive split and the flag-driven filters: a live Withdraw rewrote
     data-flags but left the row sitting in the active list until some unrelated action
     happened to paginate, and a record that gained or lost a filtered attribute likewise
     stayed put while the count beside it said otherwise.

     Gated on the flags actually differing so an ordinary presence flip — by far the most
     frequent push during a session — doesn't re-run pagination over 134 rows for nothing.
     Sort order is untouched: paginate() only toggles visibility, it never reorders. */
  if((card.dataset.flags || '') !== flagsBefore){
    paginate('roster');
    /* The Inactive switch carries a count, and a live Withdraw changes it. Without this the
       control keeps reporting the count from the last full fetch — or stays hidden entirely
       when the first inactive record of the session arrives by push, leaving no way to reach
       a participant who has just vanished from the list. */
    rosterSyncInactiveButton();
  }
}

/* Staff presence — oEventTeam rows, published as staff.changed by PORTAL : Ably Publish's
   10007 resolve branch (added 2026-08-14; before that this workflow could only ever resolve
   a Registration or an Event, so a staff member joining or leaving Zoom never moved the
   Device Reconciliation tiles until a full refetch).

   Held as a per-row map rather than a running total on purpose: each message names one row
   and carries its absolute state, so recomputing the count from the map is idempotent. A
   duplicate delivery, or a redelivery after an Ably reconnect, can't drift the number the
   way a +/-1 counter would. Roster Fetch seeds the map; until it has, we no-op rather than
   invent a count from a single row. */
function dashboardApplyStaffChanged(msg){
  var data = (msg && msg.data) || {};
  if(data.eventTeamId == null || !dashboardLastStaffPresence || !dashboardLastRoster) return;
  var key = String(data.eventTeamId);
  var present = !!data.present;
  if(dashboardLastStaffPresence[key] === present) return;
  dashboardLastStaffPresence[key] = present;
  var count = 0;
  for(var k in dashboardLastStaffPresence){
    if(Object.prototype.hasOwnProperty.call(dashboardLastStaffPresence, k) && dashboardLastStaffPresence[k]) count++;
  }
  dashboardLastStaffCount = count;
  dashboardRenderSnapshot(dashboardLastRoster, dashboardLastEventFields, dashboardLastStaffCount);
}

/* Event-level numeric metrics — event.metric.changed, for the Events fields the snapshot
   reads directly rather than deriving from the roster array (f3262 Current Drop-In Viewers;
   f3257 once rule 9's generic-vs-drop-in semantics are settled). Merged into
   dashboardLastEventFields so the tiles read them exactly as a full Roster Fetch delivers
   them, and no tile needs to know whether its number arrived live or on load. */
function dashboardApplyEventMetricChanged(msg){
  var data = (msg && msg.data) || {};
  if(!data.field || !dashboardLastEventFields || !dashboardLastRoster) return;
  var next = Number(data.value || 0);
  if(Number(dashboardLastEventFields[data.field] || 0) === next) return;
  dashboardLastEventFields[data.field] = next;
  dashboardRenderSnapshot(dashboardLastRoster, dashboardLastEventFields, dashboardLastStaffCount);
}

function dashboardInitRealtime(){
  var eventId = DASHBOARD_DATA.eventId;
  var eventTeamId = DASHBOARD_DATA.eventTeamId;
  if(!eventId || !eventTeamId || dashboardAblyClient) return;
  dashboardLoadAblySdk(function(){
    if(!window.Ably) return;
    try{
      dashboardAblyClient = new Ably.Realtime({
        authUrl: DASHBOARD_ABLY_TOKEN_AUTH_URL,
        authParams: { eventTeamId: String(eventTeamId) }
      });
      dashboardAblyClient.connection.on('failed', function(err){ console.error('dashboardInitRealtime: Ably connection failed', err); });
      var channel = dashboardAblyClient.channels.get('event:' + eventId);
      channel.subscribe('material.changed', dashboardApplyMaterialChanged);
      channel.subscribe('announcement.changed', dashboardApplyAnnouncementChanged);
      channel.subscribe('day.advanced', dashboardApplyDayAdvanced);
      channel.subscribe('attendance.changed', dashboardApplyAttendanceChanged);
      channel.subscribe('staff.changed', dashboardApplyStaffChanged);
      channel.subscribe('event.metric.changed', dashboardApplyEventMetricChanged);
    }catch(err){
      console.error('dashboardInitRealtime failed:', err);
    }
  });
}

/* Ontraport strips our body-block.html's <body class="home cs-dashboard">
   opening tag entirely -- the page already has its own real <body
   opt-version="..."> from Ontraport's own template, and a browser can't
   have two <body> tags, so ours never survives parsing. 'home' has always
   worked because go() below sets it on the real body via classList at
   runtime; cs-dashboard needs the same treatment, or every
   body.cs-dashboard-scoped rule (button colors, modal/scrim scoping, the
   button/heading font-family collision fix) silently never applies. */
document.body.classList.add('cs-dashboard');

go('home');
dashboardSyncStickyOffsets();
dashboardRenderHome();
dashboardRenderSessionStrip();
dashboardFetchBootstrap();
dashboardFetchRoster();
dashboardFetchGuests();
paginate('roster');
paginate('guest');
document.querySelectorAll('.ev-card').forEach(updateProgramPills);
