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
    dashboardInitRealtime();
  }).catch(function(err){
    console.error('dashboardFetchBootstrap failed:', err);
  });
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
var ROSTER_DAY_OPTION_ORDER = ['404','405','406','456'];

function rosterEscAttr(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
function rosterEscHtml(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function rosterIsTrue(v){ return v === '1' || v === 1 || v === true; }
function rosterDayOptionIndex(raw){ var i = ROSTER_DAY_OPTION_ORDER.indexOf(String(raw)); return i === -1 ? 0 : i; }
function rosterFmtEpochTime(sec){
  var n = Number(sec || 0);
  if(!n) return '—';
  var d = new Date(n * 1000);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
}
function rosterFmtMinutes(m){ var n = Number(m || 0); return n > 0 ? n.toFixed(1) : '0'; }

function rosterBuildAttendanceTick(reg, dayNum, attendedField, minutesField, currentDayRaw){
  var dayOptionCode = dayNum === 1 ? '404' : dayNum === 2 ? '405' : '406';
  var leftDayNum = ROSTER_LEFT_DAY_TO_NUM[String(reg.f3059 || '')] || 0;
  var isLdpDay = rosterIsTrue(reg.f2293) && leftDayNum === dayNum;
  var attended = rosterIsTrue(reg[attendedField]);
  var minutes = Number(reg[minutesField] || 0);
  var cls, kv, title;
  title = 'Day ' + dayNum + ' Attendance';
  if(isLdpDay){
    cls = 'tk-ldp';
    var leftTypeLabel = ROSTER_LEFT_TYPE_MAP[String(reg.f3056 || '')] || 'LDP';
    kv = [['Attended', 'LDP — ' + leftTypeLabel], ['Left Time', rosterFmtEpochTime(reg.f3060)]];
    if(rosterIsTrue(reg.f2688)) kv.push(['Well Being Out', 'Yes']);
  } else if(attended){
    cls = 'tk-attended';
    kv = [['Attended','Yes'], ['Minutes', rosterFmtMinutes(minutes)], ['First Join', rosterFmtEpochTime(reg.f2855)], ['Most Recent Leave', rosterFmtEpochTime(reg.f2862)], ['Join Count', String(Number(reg.f2871 || 0))], ['Match', ROSTER_MATCH_METHOD_MAP[String(reg.f2808 || '')] || '—']];
  } else if(rosterDayOptionIndex(dayOptionCode) >= rosterDayOptionIndex(currentDayRaw)){
    cls = 'tk-pending';
    kv = [['Attended','Pending'], ['Match','Day not yet reached']];
  } else {
    cls = 'tk-absent';
    kv = [['Attended','No'], ['Minutes', rosterFmtMinutes(minutes)], ['Match', ROSTER_MATCH_METHOD_MAP[String(reg.f2808 || '')] || 'No Zoom connection recorded for this day']];
  }
  return '<button class="tick ' + cls + '" data-day-num="' + dayNum + '" onclick="openDetailPop(this)" data-pop-title="' + rosterEscAttr(title) + '" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(kv)) + '\'>D' + dayNum + '</button>';
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

/* rosterNameBadge() — added 2026-08-12: the name-row badge previously
   only ever showed ACTIVE/CANCELLED (registration status, f2424). Client
   wants it to also surface live attendance/course-status signals so a
   CS can see at a glance without opening a card: LIVE (green, f2853
   Currently Present), LATE (amber, f3062 FS Late Arrival), LDP (red,
   f2293 Left The Course — once someone's left they stay LDP for the
   rest of the event, no day-matching needed here unlike the per-day
   tick's LDP check), ABSENT - EXCUSED/NCNS (f3191 Attendance Status,
   the Correct Attendance manual-resolution field). Precedence, most
   authoritative first: CANCELLED (registration itself isn't active) >
   LDP (they've left, nothing else matters) > manually-resolved absence
   (f3191) > LIVE > LATE > default ACTIVE. Reused by both the initial
   card render and the attendance.changed live-patch handler so the two
   can never drift apart. */
function rosterNameBadge(reg){
  // f2424 (Registration Status) is blank/unset on most real registrations
  // (confirmed live against event 218: 0 explicit Cancelled, 45 explicit
  // Active, 93 blank) -- the field is apparently only set by a later
  // confirmation step, not at registration creation. Blank must read as
  // the normal/active state; only the explicit Cancelled option (153)
  // should show the CANCELLED badge. The prior "anything that isn't
  // literally Active (154) counts as cancelled" check incorrectly flagged
  // the majority of a real event's roster as cancelled. Fixed 2026-08-13.
  if(String(reg.f2424) === '153') return {label:'CANCELLED', cls:'p-active'};
  if(rosterIsTrue(reg.f2293)) return {label:'LDP', cls:'p-ldp'};
  var attStatus = String(reg.f3191 || '');
  if(attStatus === '467') return {label:'ABSENT - EXCUSED', cls:'p-excused'};
  if(attStatus === '468') return {label:'ABSENT - NCNS', cls:'p-absent'};
  if(rosterIsTrue(reg.f2853)) return {label:'LIVE', cls:'p-present'};
  if(rosterIsTrue(reg.f3062)) return {label:'LATE', cls:'p-late'};
  return {label:'ACTIVE', cls:'p-active'};
}

function rosterBuildCardHtml(reg, currentDayRaw, localeAbbr){
  var first = reg['f2213//firstname'] || '';
  var last = reg['f2213//lastname'] || '';
  var nameLikes = reg['f2213//f2792'] || '';
  var legalName = (first + ' ' + last).trim() || 'Unknown Participant';
  var displayFirst = nameLikes || first;
  var displayName = (displayFirst + ' ' + last).trim() || legalName;
  var pid = 'PID-' + (reg.f2794 || reg.id);
  var nameBadge = rosterNameBadge(reg);
  var statusLabel = nameBadge.label;
  var searchStr = (displayName + ' ' + legalName + ' ' + (reg.f2794 || '') + ' ' + reg.id).toLowerCase();

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

  var d1Tick = rosterBuildAttendanceTick(reg, 1, 'f2801', 'f2805', currentDayRaw);
  var d2Tick = rosterBuildAttendanceTick(reg, 2, 'f2802', 'f2806', currentDayRaw);
  var d3Tick = rosterBuildAttendanceTick(reg, 3, 'f2803', 'f2807', currentDayRaw);
  var s3Tick = rosterBuildChkpntTick(rosterIsTrue(reg.f3203), 'Day 3 Session 3 Checkpoint', 'S3', 'f3203');
  var s4Tick = rosterBuildChkpntTick(rosterIsTrue(reg.f3055), 'Day 3 Session 4 Attendance Check', 'S4', 'f3055');

  var semReg = rosterIsTrue(reg.f2303) ? 1 : 0;
  var semPot = String(reg.f2882) === '371' ? 1 : 0;
  var semConf = (!semReg && String(reg.f2884) === '378') ? 1 : 0;
  var semDesig = String(reg.f2885) === '380' ? 1 : 0;
  var semAlt = String(reg.f2885) === '379' ? 1 : 0;
  var semKv = semReg ? [['Registered','Yes'],['Seminar', reg.f3185 || '—']] : (semConf ? [['Potential','Yes'],['Confirmed','Yes'],['Registered','Not yet']] : [['Potential', semPot ? 'Yes' : 'No'],['Registered','No']]);
  var seminarPill = '<button class="pill p-neutral ev-clickable prog-seminar" onclick="openDetailPop(this)" data-pot="' + semPot + '" data-confirmed="' + semConf + '" data-reg="' + semReg + '" data-desig="' + semDesig + '" data-alt="' + semAlt + '" data-pop-title="Seminar Registration" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(semKv)) + '\'>—</button>';

  var acReg = rosterIsTrue(reg.f2302) ? 1 : 0;
  var acPot = String(reg.f2887) === '382' ? 1 : 0;
  var acDesig = String(reg.f2890) === '392' ? 1 : 0;
  var acAlt = String(reg.f2890) === '391' ? 1 : 0;
  var acKv = acReg ? [['Registered','Yes'],['Course', reg.f3186 || '—']] : [['Potential', acPot ? 'Yes' : 'No'],['Registered','No']];
  var acPill = '<button class="pill p-neutral ev-clickable prog-ac" onclick="openDetailPop(this)" data-pot="' + acPot + '" data-confirmed="0" data-reg="' + acReg + '" data-desig="' + acDesig + '" data-alt="' + acAlt + '" data-pop-title="Advanced Course Registration" data-pop-kv=\'' + rosterEscAttr(JSON.stringify(acKv)) + '\'>—</button>';

  return '<div class="ev-card" data-search="' + rosterEscAttr(searchStr) + '" data-reg-id="' + rosterEscAttr(reg.id) + '">' +
    '<div class="ev-row1">' +
      '<div class="ev-field ev-identity">' +
        '<div class="ev-name"><div class="ev-name-row"><b>' + rosterEscHtml(displayName) + '</b> <span class="status-sep">–</span> <span class="pill ' + nameBadge.cls + '" data-name-badge="1">' + rosterEscHtml(statusLabel) + '</span></div><span>Legal: ' + rosterEscHtml(legalName) + ' · ' + rosterEscHtml(pid) + '</span></div>' +
        '<div class="ev-sub"><button class="pill p-locale ev-clickable" onclick="openDetailPop(this)" data-pop-title="Locale" data-pop-kv=\'' + rosterEscAttr(JSON.stringify([['Value', localeAbbr.full]])) + '\'>' + localeAbbr.abbr + '</button></div>' +
      '</div>' +
      '<div class="ev-field ev-classification">' +
        '<div class="ev-l">Classification</div>' +
        '<div class="class-pills">' + mnrPill + revPill + sePill + acNpPill + semNpPill + '</div>' +
      '</div>' +
      '<div class="ev-field"><div class="ev-l">Attendance</div><div class="ticks">' + d1Tick + d2Tick + d3Tick + '</div></div>' +
      '<div class="ev-field"><div class="ev-l">CPLT CHKPNT</div><div class="ticks">' + s3Tick + s4Tick + '</div></div>' +
      '<div class="ev-field"><div class="ev-l">Seminar</div>' + seminarPill + '</div>' +
      '<div class="ev-field"><div class="ev-l">AC</div>' + acPill + '</div>' +
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
  var html = registrations.map(function(reg){ return rosterBuildCardHtml(reg, currentDayRaw, localeAbbr); }).join('');
  list.innerHTML = html;
  document.querySelectorAll('#rosterList .ev-card').forEach(updateProgramPills);
  var totalEl = list.closest('.card').querySelector('.card-hd .sub .mf');
  if(totalEl) totalEl.textContent = registrations.length;
  paginate('roster');
}

/* ---------- Course Snapshot + Device & Zoom Reconciliation — real data
   render (CS Dashboard build, 2026-08-12). Same #em-snapshot (Event
   Management, filterable) and #ms-snapshot (Master Stats, plain mirror)
   cards, driven by one shared dashboardRenderSnapshot() off the same
   registrations array Roster Fetch already returns, plus the eventFields/
   staffCount the webhook was extended to include. Starts (Day 1) and
   Final Session Expected are deliberately left as "—" — Starts needs a
   frozen-at-Day-1-lock snapshot mechanism that doesn't exist yet (no
   storage field confirmed), and Final Session Expected's formula was
   explicitly flagged by the client as "confirm with Landmark team, may
   change" — showing a fabricated number for either would be worse than
   an honest empty state. Material Released tile cut entirely (locked
   spec). Reviewer/SE split into two single-stat tiles per the locked
   spec (was one combined "4/5" tile in the prototype). ---------- */
function dashboardFmtPct(num, den){ return den ? Math.round((num / den) * 100) + '%' : '—'; }
function dashboardSetStat(key, value){ document.querySelectorAll('[data-stat="' + key + '"]').forEach(function(el){ el.textContent = value; }); }
function dashboardSetSub(key, value){ document.querySelectorAll('[data-stat-sub="' + key + '"]').forEach(function(el){ el.textContent = value; }); }

function dashboardRenderSnapshot(registrations, eventFields, staffCount){
  eventFields = eventFields || {};
  staffCount = Number(staffCount || 0);
  var total = registrations.length;
  var ldpRows = registrations.filter(function(r){ return String(r.f2293) === '1'; });
  // f2424 blank must count as active, not excluded -- see the matching
  // fix/explanation in rosterNameBadge() above (2026-08-13).
  var current = registrations.filter(function(r){ return String(r.f2424) !== '153' && String(r.f3046) !== '1' && String(r.f2293) !== '1'; }).length;
  var ldp = ldpRows.length;
  var wbo = registrations.filter(function(r){ return String(r.f2688) === '1'; }).length;
  var completions = registrations.filter(function(r){ return String(r.f2809) === '1'; }).length;
  var attendingNow = registrations.filter(function(r){ return String(r.f2853) === '1'; }).length;
  var seminarReg = registrations.filter(function(r){ return String(r.f2303) === '1'; }).length;
  var seminarPotential = registrations.filter(function(r){ return String(r.f2882) === '371'; }).length;
  var acReg = registrations.filter(function(r){ return String(r.f2302) === '1'; }).length;
  var acPotential = registrations.filter(function(r){ return String(r.f2887) === '382'; }).length;
  var invitationsWithGuests = registrations.filter(function(r){ return Number(r.f2272 || 0) > 0; }).length;
  var reviewer = registrations.filter(function(r){ return String(r.f3044) === '1'; }).length;
  var se = registrations.filter(function(r){ return String(r.f3046) === '1'; }).length;

  dashboardSetStat('current', current);
  dashboardSetStat('ldp', ldp);
  dashboardSetStat('wbo', wbo);
  dashboardSetSub('wbo', wbo + ' of ' + ldp + ' who left');
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

  var sharedDeviceCount = registrations.filter(function(r){ return String(r.f3207 || '').trim() !== ''; }).length;
  var sharedAdj = -Math.floor(sharedDeviceCount / 2);
  var dupAdj = -registrations.filter(function(r){ return String(r.f3208) === '474'; }).length;
  var expected = total + staffCount + sharedAdj + dupAdj;
  var observed = attendingNow + staffCount;
  var reconciled = expected === observed;

  dashboardSetStat('drParticipants', total);
  dashboardSetStat('drStaff', staffCount);
  dashboardSetStat('drSharedAdj', sharedAdj);
  dashboardSetStat('drDupAdj', dupAdj);
  dashboardSetStat('drExpected', expected);
  dashboardSetStat('drObserved', observed);
  dashboardSetStat('drReconciled', reconciled ? '✓' : '✗');
  dashboardSetSub('drReconciled', observed + ' / ' + expected + (reconciled ? ' · reconciled' : ' · ' + Math.abs(expected - observed) + ' unresolved'));
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
    dashboardRenderRoster(r.result.registrations);
    dashboardRenderSnapshot(r.result.registrations, r.result.eventFields, r.result.staffCount);
    dashboardLastRoster = r.result.registrations;
    dashboardLastEventFields = r.result.eventFields;
    dashboardLastStaffCount = r.result.staffCount;
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
  document.getElementById('evtSelName').textContent = DASHBOARD_DATA.eventTitle;
  document.getElementById('evtSelCourseFormat').textContent =
    (DASHBOARD_DATA.courseName || '—') + ' · ' + dashboardEventFormat();
  document.getElementById('evtLeaderName').textContent = DASHBOARD_DATA.eventLeaderName || '—';
  document.getElementById('evtCardTitle').textContent = DASHBOARD_DATA.eventTitle;
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

/* ---------- navigation ---------- */
function go(view){
  currentView = view;
  document.body.classList.toggle('home', view === 'home');
  document.querySelectorAll('.view').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('v-' + view).classList.add('active');
  document.querySelectorAll('.tabbar button[data-v]').forEach(function(b){ b.classList.toggle('active', b.dataset.v === view); });
  document.getElementById('secnav').style.display = view === 'em' ? '' : 'none';
  window.scrollTo({top:0, behavior:'instant'});
}

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
  document.getElementById('qvPreferredComm').textContent = 'Email';
  var submitted = row.dataset.fif === '1';
  document.getElementById('qvFormKv').style.display = submitted ? '' : 'none';
  document.getElementById('qvFormNotice').style.display = submitted ? 'none' : '';
  if(submitted) document.getElementById('qvFormKv').innerHTML = buildInformationFormKv(name);
  openModal('mParticipantQuickView');
}
function buildInformationFormKv(name){
  return '<span class="k">Emergency Contact Name</span><span class="v">Jordan Ellis</span>' +
    '<span class="k">Emergency Contact Phone</span><span class="v">(555) 019-2044</span>' +
    '<span class="k">Emergency Contact Relationship</span><span class="v">Spouse</span>' +
    '<span class="k">Coaching Call Availability</span><span class="v">Weekday evenings</span>' +
    '<span class="k">Agreed to Registration Policies</span><span class="v">Yes</span>' +
    '<span class="k">Agreed to Privacy Policy</span><span class="v">Yes</span>' +
    '<span class="k">Agreed to Terms of Use</span><span class="v">Yes</span>' +
    '<span class="k">Anything you’d like us to know?</span><span class="v">n/a</span>' +
    '<span class="k">Dietary Restrictions / Special Needs</span><span class="v">None</span>' +
    '<span class="k">Forum Participants You Know</span><span class="v">None listed</span>' +
    '<span class="k">What I Want to Accomplish</span><span class="v">' + name + ' would like to build on what they got from the Forum and apply it more consistently.</span>';
}

/* ---------- profile chip: logout-only, no role switching ---------- */
function toggleProfileMenu(e){ e.stopPropagation(); document.getElementById('profileMenu').classList.toggle('open'); }
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
document.addEventListener('keydown', function(e){ if(e.key === 'Escape') dismissModal(); });

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
function applyFollowOnLadder(el){
  var pot = el.dataset.pot === '1', conf = el.dataset.confirmed === '1', reg = el.dataset.reg === '1';
  var desig = el.dataset.desig === '1', alt = el.dataset.alt === '1';
  var progClass = el.classList.contains('prog-seminar') ? 'prog-seminar' : 'prog-ac';
  var cls, text, editable;
  if(desig && alt){ cls = 'p-dataerr'; text = 'REG · ⚠'; editable = false; }
  else if(reg){ cls = 'p-pot'; text = 'REG'; editable = false; }
  else if(conf){ cls = 'p-conf'; text = 'CONF'; editable = false; }
  else { cls = 'p-neutral'; text = pot ? 'POT' : 'NP'; editable = true; }
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
    if(isRealGuest) dashboardFetchGuests();
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
  el.style.top = (r.bottom + 6) + 'px';
  el.style.left = r.left + 'px';
  requestAnimationFrame(function(){
    var w = el.offsetWidth;
    if(r.left + w > window.innerWidth - 12){
      el.style.left = Math.max(12, window.innerWidth - w - 12) + 'px';
    }
  });
}
function openDetailPop(trigger){
  closeRowMenu();
  pendingPopTrigger = trigger;
  var eyebrowEl = document.getElementById('detailPopEyebrow');
  eyebrowEl.textContent = trigger.dataset.popEyebrow || '';
  eyebrowEl.style.display = trigger.dataset.popEyebrow ? '' : 'none';
  document.getElementById('detailPopTitle').textContent = trigger.dataset.popTitle || '';
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
  document.getElementById('csLeftCourse').value = isLeft ? 'yes' : 'no';
  document.getElementById('csLeftType').value = ROSTER_LEFT_TYPE_MAP[String(reg.f3056 || '')] ? String(reg.f3056) : '428';
  document.getElementById('csDay').value = ROSTER_LEFT_DAY_TO_NUM[String(reg.f3059 || '')] ? String(reg.f3059) : '430';
  document.getElementById('csTime').value = csEpochToTimeInput(reg.f3060) || '15:42';
  document.getElementById('csLeaveReason').value = ROSTER_WBO_REASON_MAP[String(reg.f3061 || '')] ? String(reg.f3061) : '432';
  onCsLeftCourseChange();
  onCsLeftTypeOrReasonChange();
  openModal('mCourseStatus');
}
function onCsLeftCourseChange(){
  document.getElementById('csLeftFields').style.display = document.getElementById('csLeftCourse').value === 'yes' ? 'block' : 'none';
}
function onCsLeftTypeOrReasonChange(){
  var type = document.getElementById('csLeftType').value;
  document.getElementById('csWboDerived').textContent = ROSTER_WBO_TRIGGER_TYPES.indexOf(type) !== -1 ? 'Yes' : 'No';
}
function confirmCourseStatus(){
  var card = pendingCourseStatusCard;
  if(!card){ dismissModal(); return; }
  var saveBtn = document.getElementById('csSaveBtn');
  var originalLabel = saveBtn.textContent;
  var left = document.getElementById('csLeftCourse').value === 'yes';
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), leftCourse: left };
  var type = '', reason = '';
  if(left){
    type = document.getElementById('csLeftType').value;
    reason = document.getElementById('csLeaveReason').value;
    payload.leftType = type;
    payload.leftDay = document.getElementById('csDay').value;
    payload.wboReason = reason;
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
      logAudit('staff', currentActorName() + ' set course status = ' + (ROSTER_LEFT_TYPE_MAP[type] || type) + ' · ' + (ROSTER_WBO_REASON_MAP[reason] || reason) + (r.result.wbo ? ' · WBO' : ''));
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
function ocCurrentValue(card, field){
  if(field === 'reviewer') return card.querySelector('[data-classtype="reviewer"]').classList.contains('p-review') ? 'Yes' : 'No';
  if(field === 'se') return card.querySelector('[data-classtype="se"]').classList.contains('p-excluded') ? 'Yes' : 'No';
  if(field === 'seminarPotential') return (card.querySelector('.prog-seminar') || {}).dataset && card.querySelector('.prog-seminar').dataset.pot === '1' ? 'Yes' : 'No';
  if(field === 'acPotential') return (card.querySelector('.prog-ac') || {}).dataset && card.querySelector('.prog-ac').dataset.pot === '1' ? 'Yes' : 'No';
  return '—';
}
function openOverrideClassification(card, presetField){
  pendingOcCard = card;
  document.getElementById('ocName').textContent = cardName(card);
  var field = presetField || 'reviewer';
  document.getElementById('ocField').value = field;
  document.getElementById('ocCurrent').textContent = OC_LABELS[field] + ': ' + ocCurrentValue(card, field);
  document.getElementById('ocChangeTo').classList.remove('on');
  document.getElementById('ocReasonText').value = '';
  document.getElementById('ocNoteText').value = '';
  document.getElementById('ocField').onchange = function(){
    document.getElementById('ocCurrent').textContent = OC_LABELS[this.value] + ': ' + ocCurrentValue(card, this.value);
  };
  openModal('mOverrideClassification');
}
function confirmOverrideClassification(){
  var card = pendingOcCard;
  if(!card){ dismissModal(); return; }
  var field = document.getElementById('ocField').value;
  var changeTo = document.getElementById('ocChangeTo').classList.contains('on');
  var reason = document.getElementById('ocReasonText').value.trim();
  var note = document.getElementById('ocNoteText').value.trim();
  if(!reason){ toast('An override reason is required.', 'err'); return; }
  var saveBtn = document.getElementById('ocSaveBtn');
  var originalLabel = saveBtn.textContent;
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), field: field, changeTo: changeTo, overrideNote: reason, operationalNote: note };
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
    logAudit('staff', currentActorName() + ' overrode ' + OC_LABELS[field] + ' = ' + changeTo + ' · reason: ' + reason);
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
  document.getElementById('corrAttDay').value = '2';
  document.getElementById('corrAttSession').value = '1';
  document.getElementById('corrAttStatus').value = '469';
  document.getElementById('corrAttNote').value = '';
  onCorrAttStatusChange();
  openModal('mCorrectAttendance');
}
function onCorrAttStatusChange(){
  var isExcused = document.getElementById('corrAttStatus').value === '467';
  document.getElementById('corrAttNoteField').style.display = isExcused ? 'block' : 'none';
}
function confirmCorrectAttendance(){
  var card = pendingCorrectAttCard;
  if(!card){ dismissModal(); return; }
  var day = document.getElementById('corrAttDay').value;
  var session = document.getElementById('corrAttSession').value;
  var status = document.getElementById('corrAttStatus').value;
  var note = document.getElementById('corrAttNote').value.trim();
  if(status === '467' && !note){ toast('A reason is required for Absent - Excused.', 'err'); return; }
  var saveBtn = document.getElementById('corrAttSaveBtn');
  var originalLabel = saveBtn.textContent;
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), day: day, session: session, status: status, note: note };
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
  document.getElementById('deExceptionType').value = '473';
  document.getElementById('deOtherParticipantField').style.display = 'none';
  var otherInput = document.getElementById('deOtherParticipant');
  otherInput.value = '';
  delete otherInput.dataset.otherRegId;
  document.getElementById('deNoteText').value = '';
  openModal('mDeviceException');
}
function onDeExceptionTypeChange(){
  var isShared = document.getElementById('deExceptionType').value === '475';
  document.getElementById('deOtherParticipantField').style.display = isShared ? 'block' : 'none';
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
}
function confirmDeviceException(){
  var card = pendingDeCard;
  if(!card){ dismissModal(); return; }
  var saveBtn = document.getElementById('deSaveBtn');
  var originalLabel = saveBtn.textContent;
  var exceptionType = document.getElementById('deExceptionType').value;
  var note = document.getElementById('deNoteText').value.trim();
  var payload = { eventTeamId: DASHBOARD_DATA.eventTeamId, registrationId: Number(card.dataset.regId), exceptionType: exceptionType, note: note };
  if(exceptionType === '475'){
    var otherRegId = document.getElementById('deOtherParticipant').dataset.otherRegId;
    if(!otherRegId){ toast('Select who this participant is sharing a device with.', 'err'); return; }
    payload.otherRegistrationId = Number(otherRegId);
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
  var legalEl = card.querySelector('.ev-name span');
  document.getElementById('dwName').textContent = nameEl ? nameEl.textContent : 'Participant details';
  document.getElementById('dwLegalPid').textContent = legalEl ? legalEl.textContent : '';
  var nameInput = document.getElementById('dwNameInput');
  nameInput.value = nameEl ? nameEl.textContent : '';
  nameInput.dataset.targetCard = card.dataset.regId || '';
  nameInput.onblur = function(){ if(nameEl) nameEl.textContent = this.value; inlineSave(this); };
  var spouseInput = document.getElementById('dwSpouseInput');
  spouseInput.value = card.dataset.spouse || '';
  spouseInput.onblur = function(){ comboBlur(this); card.dataset.spouse = this.value; inlineSave(this); };
  var status = (card.querySelector('.ev-name-row .p-ldp, .ev-name-row .p-nsho') || {}).textContent || 'Active';
  var seminarText = (card.querySelector('.prog-seminar') || {}).textContent || '—';
  var acText = (card.querySelector('.prog-ac') || {}).textContent || '—';
  document.getElementById('dwSummary').innerHTML =
    '<span class="k">Status</span><span class="v">' + status + '</span>' +
    '<span class="k">Seminar</span><span class="v">' + seminarText + '</span>' +
    '<span class="k">AC</span><span class="v">' + acText + '</span>';
  var email = card.dataset.email || '—';
  var emailEl = document.getElementById('dwEmail');
  emailEl.textContent = email;
  emailEl.href = card.dataset.email ? 'mailto:' + card.dataset.email : '#';
  var phone = card.dataset.phone || '—';
  var phoneEl = document.getElementById('dwPhone');
  phoneEl.textContent = phone;
  phoneEl.href = card.dataset.phone ? 'tel:' + card.dataset.phone.replace(/[^\d+]/g, '') : '#';
  document.getElementById('dwPreferredComm').textContent = 'Email';
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
function populateInformationForm(card){
  var name = cardName(card);
  document.getElementById('dwEcName').textContent = 'Jordan Ellis';
  document.getElementById('dwEcPhone').textContent = '(555) 019-2044';
  document.getElementById('dwEcRel').textContent = 'Spouse';
  document.getElementById('dwCoaching').textContent = 'Weekday evenings';
  document.getElementById('dwAgreeReg').textContent = 'Yes';
  document.getElementById('dwAgreePriv').textContent = 'Yes';
  document.getElementById('dwAgreeTerms').textContent = 'Yes';
  document.getElementById('dwFormComplete').textContent = 'Yes';
  document.getElementById('dwAnythingKnow').textContent = 'n/a';
  document.getElementById('dwDietary').textContent = 'None';
  document.getElementById('dwParticipantsKnow').textContent = 'None listed';
  document.getElementById('dwWantAccomplish').textContent = name + ' would like to build on what they got from the Forum and apply it more consistently.';
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
    return res.json().then(function(result){ return { ok: res.ok, result: result }; });
  }).then(function(r){
    if(!r.ok || !r.result || r.result.success !== true) throw new Error((r.result && r.result.error) || 'Request failed');
    btn.disabled = false;
    btn.textContent = originalLabel;
    logAudit('staff', currentActorName() + ' took attendance — Session ' + session + ' (Day ' + r.result.day + ') — ' + r.result.presentCount + ' present, ' + r.result.lateMarkedCount + ' not yet present');
    toast('Attendance taken — Session ' + session + ': ' + r.result.presentCount + ' present · ' + r.result.lateMarkedCount + ' not present yet.');
    dashboardFetchRoster();
  }).catch(function(err){
    console.error('confirmTakeAttendance failed:', err);
    btn.disabled = false;
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
/* ---------- Course snapshot metrics as roster filters (§0y) — Event
   Management only; each predicate reads state already rendered on the
   card (course status pill, classification pill, prog-seminar/prog-ac
   text, attendance/checkpoint ticks) rather than tracking anything
   new. Invitations sent / Final Session expected are deliberately NOT
   wired here — neither is a per-registration boolean the roster row
   actually carries (invitations are an oInvitation/guest concept,
   Final Session expected isn't modeled per participant on this card).
   Material Released tile was cut entirely per the locked spec. ---------- */
var rosterStatFilter = null;
var ROSTER_STAT_FILTERS = {
  starts: { label: 'Starts (Day 1)', test: function(card){
    var t = card.querySelector('[data-pop-title="Day 1 Attendance"]');
    return !!t && t.classList.contains('tk-attended');
  } },
  current: { label: 'Current', test: function(card){
    return !card.querySelector('.ev-name-row .p-ldp, .ev-name-row .p-nsho');
  } },
  ldp: { label: 'LDP', test: function(card){
    return !!card.querySelector('.ev-name-row .p-ldp');
  } },
  wbo: { label: 'WBO', test: function(card){
    var pill = card.querySelector('.ev-name-row .p-ldp');
    if(!pill) return false;
    try { return JSON.parse(pill.dataset.popKv || '[]').some(function(pair){ return pair[0] === 'WBO' && pair[1] === 'Yes'; }); }
    catch(e){ return false; }
  } },
  completions: { label: 'Completions', test: function(card){
    var s3 = card.querySelector('[data-pop-title="Day 3 Session 3 Checkpoint"]');
    var s4 = card.querySelector('[data-pop-title="Day 3 Session 4 Attendance Check"]');
    return (!!s3 && !s3.classList.contains('tk-pending')) || (!!s4 && !s4.classList.contains('tk-pending'));
  } },
  attendanceNow: { label: 'Attendance now', test: function(card){
    var t = card.querySelector('[data-pop-title="Day 2 Attendance"]');
    return !!t && t.classList.contains('tk-attended');
  } },
  seminar: { label: 'Seminar registered', test: function(card){
    var el = card.querySelector('.prog-seminar');
    return !!el && el.textContent.trim() === 'REG';
  } },
  ac: { label: 'AC registered', test: function(card){
    var el = card.querySelector('.prog-ac');
    return !!el && el.textContent.trim() === 'REG';
  } },
  reviewer: { label: 'Reviewer', test: function(card){
    return !!card.querySelector('[data-classtype="reviewer"].p-review');
  } },
  se: { label: 'SE', test: function(card){
    return !!card.querySelector('[data-classtype="se"].p-excluded');
  } }
};
function applyStatFilter(key, el){
  if(rosterStatFilter === key){ clearStatFilter(); return; }
  rosterStatFilter = key;
  document.querySelectorAll('#em-snapshot .stat-filterable').forEach(function(s){ s.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('rosterFilterLabel').textContent = ROSTER_STAT_FILTERS[key].label;
  document.getElementById('rosterFilterChip').style.display = '';
  pageState.roster = 1;
  paginate('roster');
}
function clearStatFilter(){
  rosterStatFilter = null;
  document.querySelectorAll('#em-snapshot .stat-filterable').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('rosterFilterChip').style.display = 'none';
  pageState.roster = 1;
  paginate('roster');
}
function paginate(kind){
  var list = document.getElementById(kind + 'List');
  var searchEl = document.getElementById(kind + 'Search');
  var q = (searchEl.value || '').toLowerCase().trim();
  var cards = Array.prototype.filter.call(list.children, function(c){ return c.classList.contains('ev-card'); });
  var filtered = cards.filter(function(c){
    if(q && (c.dataset.search || '').indexOf(q) === -1) return false;
    if(kind === 'roster' && rosterStatFilter && !ROSTER_STAT_FILTERS[rosterStatFilter].test(c)) return false;
    return true;
  });
  var totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  if(pageState[kind] > totalPages) pageState[kind] = totalPages;
  if(pageState[kind] < 1) pageState[kind] = 1;
  var start = (pageState[kind] - 1) * 10, end = start + 10;
  cards.forEach(function(c){ c.style.display = 'none'; });
  filtered.slice(start, end).forEach(function(c){ c.style.display = ''; });
  document.getElementById(kind + 'PageLabel').textContent = 'Page ' + pageState[kind] + ' of ' + totalPages;
  document.getElementById(kind === 'roster' ? 'rosterShowingCount' : 'guestShowingCount').textContent = filtered.length;
}
function filterList(kind){ pageState[kind] = 1; paginate(kind); }
function pagerGo(kind, delta){ pageState[kind] = (pageState[kind] || 1) + delta; paginate(kind); }

/* ---------- 4.7 / §8 Live Material Release — sectioned by day, no tabs.
   Each row is just the toggle, title + type, and a single timestamp cell
   (children[2]) showing when the item was first shown — no separate
   Hidden/Visible pill, no notification-status pill, no Resend button.
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
   wants every toggle to write immediately on click, no confirm-are-you-sure
   modal first ("simply toggle on checks the box, toggle off unchecks the
   box"). The old relToggle()/confirmRelease()/confirmRehide()/
   confirmReshow() modal flow (superseded by this) was removed 2026-08-13. */
function directToggle(btn){
  if(btn.disabled) return;
  var isOn = btn.classList.contains('on');
  var newVal = !isOn;
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
    var row = btn.closest('.res-row');
    var timeCell = row ? row.children[2] : null;
    if(wantOn){
      btn.classList.add('on');
      btn.dataset.notified = '1';
      btn.dataset.notifat = 'just now';
      if(timeCell) timeCell.innerHTML = 'First shown <b>just now</b>';
    } else {
      btn.classList.remove('on');
      if(timeCell) timeCell.innerHTML = '—';
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
    var row = btn.closest('.res-row');
    var timeCell = row ? row.children[2] : null;
    if(wantOn){
      btn.classList.add('on');
      btn.dataset.notified = '1';
      btn.dataset.notifat = 'just now';
      if(timeCell) timeCell.innerHTML = 'First shown <b>just now</b>';
    } else {
      btn.classList.remove('on');
      if(timeCell) timeCell.innerHTML = '—';
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
var DASHBOARD_ATTENDANCE_DROPDOWN_FIELDS = ['f3191', 'f3056', 'f3059'];
var DASHBOARD_DAY_TICK_FIELDS = { f2801: 1, f2802: 2, f2803: 3 };
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
  var isDropdown = DASHBOARD_ATTENDANCE_DROPDOWN_FIELDS.indexOf(field) !== -1;
  var newVal = isDropdown ? String(data.value || '') : (data.value ? 1 : 0);
  if(String(reg[field] == null ? '' : reg[field]) === String(newVal)) return;
  reg[field] = newVal;

  var card = document.querySelector('#rosterList .ev-card[data-reg-id="' + regId + '"]');
  if(!card) return;

  // Name badge: LIVE/LATE/LDP/ABSENT — any of these 4 fields can flip it.
  if(field === 'f2853' || field === 'f3062' || field === 'f2293' || field === 'f3191'){
    var badge = card.querySelector('[data-name-badge="1"]');
    if(badge){
      var nb = rosterNameBadge(reg);
      badge.className = 'pill ' + nb.cls;
      badge.textContent = nb.label;
    }
  }

  // S3/S4 checkpoint ticks (existing behavior, unchanged).
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
  if(DASHBOARD_DAY_TICK_FIELDS[field] || field === 'f2293' || field === 'f3059'){
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

  // Seminar/AC NP-POT-REG pills — update the data-* attrs updateProgramPills()
  // already reads, then let it (and applyFollowOnLadder/syncNpFlag) do the
  // actual re-render, same as a full page load already does.
  if(field === 'f2882' || field === 'f2303'){
    var semEl = card.querySelector('.prog-seminar');
    if(semEl){
      semEl.dataset.pot = String(reg.f2882) === '371' ? '1' : '0';
      semEl.dataset.reg = rosterIsTrue(reg.f2303) ? '1' : '0';
      updateProgramPills(card);
    }
  }
  if(field === 'f2887' || field === 'f2302'){
    var acEl = card.querySelector('.prog-ac');
    if(acEl){
      acEl.dataset.pot = String(reg.f2887) === '382' ? '1' : '0';
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
  var SNAPSHOT_RECOMPUTE_FIELDS = ['f2853', 'f2882', 'f2887', 'f2303', 'f2302', 'f2293', 'f2688', 'f3044', 'f3046', 'f3208', 'f3207'];
  if(SNAPSHOT_RECOMPUTE_FIELDS.indexOf(field) !== -1){
    dashboardRenderSnapshot(dashboardLastRoster, dashboardLastEventFields, dashboardLastStaffCount);
  }
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
    }catch(err){
      console.error('dashboardInitRealtime failed:', err);
    }
  });
}

go('home');
dashboardRenderHome();
dashboardRenderSessionStrip();
dashboardFetchBootstrap();
dashboardFetchRoster();
dashboardFetchGuests();
paginate('roster');
paginate('guest');
document.querySelectorAll('.ev-card').forEach(updateProgramPills);
