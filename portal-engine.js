/* =============================================================
   PORTAL ENGINE
   Hosted separately from member-portal.html per the plan's
   File / module breakdown. Sectioned internally as each stage
   lands:
     Portal.dateUtil         — Stage 2.5 (this file, today)
     Portal.pdata            — Stage 2 (this file, today)
     Portal.programGrid      — Stage 2 (this file, today)
     Portal.phase            — Stage 6
     Portal.session          — Stage 4
     Portal.render.pre/during/post — Stages 3-5
     Portal.init             — Stage 6
   window.Portal is created by member-portal.html's inline shell
   script (before this file loads) so both can share the same
   Portal.modal.open/shut(modalId, scrimId) helper.
   ============================================================= */
window.Portal = window.Portal || {};

/* =========================================================
   Portal.dateUtil — DST-correct, format-agnostic date/time
   resolution. Ported from the live post-event production
   template (lm.landmarkworldwide.com/post-event-wr7JAU7PT)
   rather than reinvented — that page's version is already
   proven against a real event and documents real gotchas
   (see resolveStart below) that a from-scratch rewrite would
   just risk reintroducing. Shared foundation for the Pre-event
   countdown (Stage 3) and Portal.session.resolveCurrent()
   (Stage 4) — both need the same wall-clock-in-a-zone -> true
   UTC-instant math, just applied to a single target vs. a list
   of session dates.
   ========================================================= */
Portal.dateUtil = (function(){

  /* An unresolved Ontraport merge field arrives as literal "[...]". */
  function val(v){
    v = (v == null ? "" : String(v)).trim();
    return (v === "" || v.charAt(0) === "[") ? "" : v;
  }

  /* "US Pacific · PST/PDT · GMT-8/-7 (America/Los_Angeles)" -> IANA id */
  function ianaOf(s){
    var m = /\(([A-Za-z]+\/[A-Za-z0-9_+\-\/]+|UTC)\)/.exec(s);
    var z = m ? m[1] : s;
    try { new Intl.DateTimeFormat("en-US",{timeZone:z}); return z; }
    catch(e){ return ""; }
  }

  /* "2026-09-25" | "09/25/2026" | "Sep 25, 2026" | "Tues, Aug 18, 2026" -> [y,m,d].
     The trailing form matters for real data: Ontraport's own Graduation Day
     and Date field (events.f2987/f3099) is documented with exactly that
     "Tues, Aug 18, 2026" shape — a non-standard weekday abbreviation
     Date.parse isn't guaranteed to handle — so a leading "Weekday, " prefix
     is stripped before falling through to Date.parse. */
  function parseDate(s){
    s = String(s).trim().replace(/^[A-Za-z]+,\s*/, "");
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if(m) return [+m[1],+m[2],+m[3]];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if(m) return [+m[3],+m[1],+m[2]];
    var t = Date.parse(s + " 00:00:00");
    if(!isNaN(t)){ var d = new Date(t); return [d.getFullYear(), d.getMonth()+1, d.getDate()]; }
    return null;
  }

  /* "9:00 AM" | "09:00" | "7 PM" -> [hour, minute] */
  function parseTime(s){
    var m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?$/.exec(s.trim());
    if(!m) return null;
    var hh = +m[1], mm = m[2] ? +m[2] : 0, ap = m[3] ? m[3].toLowerCase() : "";
    if(ap === "p" && hh < 12) hh += 12;
    if(ap === "a" && hh === 12) hh = 0;
    if(hh > 23 || mm > 59) return null;
    return [hh, mm];
  }

  /* Offset of a zone at a given instant, in ms. */
  function zoneOffset(ts, zone){
    var f = new Intl.DateTimeFormat("en-US",{timeZone:zone,hour12:false,
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit"});
    var q = {}; f.formatToParts(new Date(ts)).forEach(function(x){ q[x.type] = x.value; });
    var asUTC = Date.UTC(+q.year, +q.month-1, +q.day, (+q.hour)%24, +q.minute, +q.second);
    return asUTC - ts;
  }

  /* Wall-clock time in a zone -> true UTC instant (DST-correct).
     Two passes: the first offset may be read on the wrong side of a
     DST boundary, the second is taken at the corrected instant. */
  function zonedToUTC(y, mo, d, hh, mm, zone){
    var wall = Date.UTC(y, mo-1, d, hh, mm);
    var ts = wall - zoneOffset(wall, zone);
    return wall - zoneOffset(ts, zone);
  }

  /* Midnight (00:00) of the calendar day containing ts, in zone —
     DST-correct, reusing the same Intl.DateTimeFormat extraction as
     zoneOffset() and the same zonedToUTC() reconstruction. Added
     2026-08-09 for Portal.phase.compute's pre->during boundary: a
     participant checking the page in the early hours of event day
     should already see During-event content, not stale Pre-event
     framing, regardless of the exact scheduled start clock-time. */
  function startOfDay(ts, zone){
    var f = new Intl.DateTimeFormat("en-US",{timeZone:zone,
      year:"numeric",month:"2-digit",day:"2-digit"});
    var q = {}; f.formatToParts(new Date(ts)).forEach(function(x){ q[x.type] = x.value; });
    return zonedToUTC(+q.year, +q.month, +q.day, 0, 0, zone);
  }

  /* "2026-08-14T16:00:00Z" | 1786723200 | 1786723200000 -> ms */
  function parseInstant(s){
    if(/^\d{13}$/.test(s)) return +s;              /* epoch millis  */
    if(/^\d{10}$/.test(s)) return +s * 1000;       /* epoch seconds */
    /* A bare ISO datetime with no zone is UTC here, not local. */
    if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s))
      s = s.replace(" ", "T") + "Z";
    var t = Date.parse(s);
    return isNaN(t) ? NaN : t;
  }

  /* Resolves one target instant (ms since epoch) from a config object,
     in priority order, returning NaN if nothing usable is found:
       1. config.reference        — an explicit override (any parseInstant format)
       2. domOverride              — e.g. a data-attribute merge field the
                                      caller read off its own DOM element
                                      (merge fields are reliable inside a
                                      Custom HTML block, not necessarily in
                                      hosted footer JS — callers should pass
                                      the value from an element attribute,
                                      not rely on a merge field substituted
                                      directly into this file)
       3. config.date + config.time + config.timeZone reconstructed via
          zonedToUTC — the fallback, and the only path that needs all
          three; a `fulldate`-only field has no time-of-day and will
          silently resolve an hour (or more) off if used alone.
     Config shape: { reference, date, time, timeZone } — all strings. */
  function resolveStart(config, domOverride){
    config = config || {};
    var srcs = [val(config.reference), val(domOverride)];
    for(var i = 0; i < srcs.length; i++){
      if(srcs[i]){ var t = parseInstant(srcs[i]); if(!isNaN(t)) return t; }
    }
    var ds = val(config.date), ts_ = val(config.time), zs = val(config.timeZone);
    if(!ds || !zs) return NaN;
    // A missing time is fine when the caller only needs date-level
    // precision (e.g. eventEnd — there isn't really a meaningful
    // "session end time" per direct instruction 2026-08-09, only the
    // end DATE matters for the date-range chip). Default to local noon
    // rather than failing outright — noon avoids any DST/midnight-
    // boundary edge case that could shift the resolved instant onto the
    // wrong calendar day. Callers that need real time-of-day precision
    // (session start, countdowns) should keep supplying config.time —
    // this only fills the gap, it doesn't mask an actually-missing time
    // for those callers, since eventStartUTC's own `reference` resolves
    // first and this fallback path is rarely reached for start times.
    var dp = parseDate(ds), tp = ts_ ? parseTime(ts_) : [12, 0], z = ianaOf(zs);
    if(!dp || !tp || !z) return NaN;
    return zonedToUTC(dp[0], dp[1], dp[2], tp[0], tp[1], z);
  }

  return { val:val, ianaOf:ianaOf, parseDate:parseDate, parseTime:parseTime,
    zoneOffset:zoneOffset, zonedToUTC:zonedToUTC, startOfDay:startOfDay,
    parseInstant:parseInstant, resolveStart:resolveStart };
})();

/* =========================================================
   Portal.pdata — the 8-program object, ported once.
   Static, phase-agnostic program copy only: title, one-line
   blurb, hosted photo, and an evergreen detail description for
   the Program Detail modal. Anything that varies by participant
   or by phase (registration state, specific dates, designated
   seminar/AC series, pill label, CTA) is NOT here — it comes in
   on each grid card object from the phase renderer (Stage 3+),
   so no program's state can leak into another's the way the
   Post-event mockup's hasSeminarReg/hasACReg bundling bug did.
   ========================================================= */
Portal.pdata = {
  forum: {
    title: 'The Landmark Forum',
    blurb: 'Three days that redefined what’s possible — and the foundation for everything that follows.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-forum.jpg',
    detail: { desc: '<p>Three full days, designed as one complete experience. Across the weekend you take apart the hidden constraints that have been running your life — and leave with a new freedom in the areas that matter most.</p>' }
  },
  seminar: {
    title: 'Seminar Series',
    blurb: 'Ten evening sessions that turn your Forum breakthroughs into lasting momentum in everyday life.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-seminar.jpg',
    detail: { desc: '<p>Evening sessions on a specific area of life — restoring workability and power in the places life feels stuck, applied week by week to your relationships, work, and goals.</p>' }
  },
  ac: {
    title: 'Advanced Course',
    blurb: 'The Forum cleared the canvas. The Advanced Course is where you pick up the brush — from awareness to authorship.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-ac.jpg',
    detail: { desc: '<p>The Forum cleared the canvas. The Advanced Course is where you pick up the brush — moving from awareness to authorship, and designing a future you invent rather than inherit.</p><p>Open to Landmark Forum graduates.</p>' }
  },
  cap: {
    title: 'Communication: Access to Power',
    blurb: 'A new relationship to communication — ease, power, and freedom in the conversations that matter most.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-cap.jpg',
    detail: { desc: '<p>A new relationship to communication — discovering how much of life happens in language, and gaining ease and power in the conversations that matter most.</p>' }
  },
  cpc: {
    title: 'Communication: Power to Create',
    blurb: 'Builds on Access to Power — using language to bring ideas, projects, and possibilities into reality.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-cpc.jpg',
    detail: { desc: '<p>Builds directly on Access to Power — using language not just to relate, but to create: bringing ideas, projects, and possibilities into reality.</p>' }
  },
  tmlp: {
    title: 'Team Management &amp; Leadership Program',
    blurb: 'A program in leading and being led — creating teams that accomplish what none of you could alone.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-tmlp.jpg',
    detail: { desc: '<p>A year-long program in leading and being led — building the kind of teams that accomplish what none of the members could alone, and becoming someone others choose to follow.</p>' }
  },
  wisdom: {
    title: 'Wisdom Course',
    blurb: 'For people committed to living fully — bringing wisdom, play, and possibility to everyday life.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-wisdom.jpg',
    detail: { desc: '<p>For people committed to living fully — a course about everyday life that brings wisdom, play, and possibility to the year you are actually living.</p>' }
  },
  partner: {
    title: 'Partnership Exploration',
    blurb: 'Explore what true partnership makes possible — at home, at work, and in your community.',
    photo: 'https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-program-partner.jpg',
    detail: { desc: '<p>An exploration of what true partnership makes possible — at home, at work, and in your community — and what becomes available when you create it deliberately.</p>' }
  }
};

/* =========================================================
   Portal.programGrid — the shared "All Programs" grid.
   render(root, cards, opts) takes a plain array of independently
   -computed card objects; nothing here reaches across cards or
   assumes a shared participant state, which is what fixes the
   Post-event bundling bug (forum/seminar/ac all forced to "reg"
   from one flag). Each card shape:
     {
       key,                          // Portal.pdata key
       state,                        // 'reg' | 'plain' | 'dim' — this program's own status only
       title, blurb,                 // optional overrides of Portal.pdata (e.g. seminar's
                                      // designated-series title once post.designatedSeminar is set)
       pill: { label, variant },     // variant: 'current' | 'upcoming' | 'next' | 'done'; omit for no pill
       pillSide: 'right',            // optional — mirrors the mockups' .pill.pr modifier
       resourceLink: { label, id },  // optional — e.g. forum's "Your Forum resources" trigger
       detailRows: [ { label, value } ],  // optional — the .pdet rows; omit for none
       cta: { label, variant }       // variant: 'solid' | 'ghost' | 'cert'
     }
   ========================================================= */
Portal.programGrid = (function(){

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', '\'':'&#39;' }[c];
    });
  }

  function buildCard(card){
    var pdata = Portal.pdata[card.key];
    if(!pdata) throw new Error('Portal.programGrid: unknown program key "' + card.key + '"');

    var title = card.title || pdata.title;
    var blurb = card.blurb || pdata.blurb;
    var stateClass = card.state === 'reg' ? ' reg' : card.state === 'dim' ? ' dim' : '';

    var el = document.createElement('div');
    el.className = 'pcard' + stateClass;
    el.setAttribute('data-p', card.key);

    var pillHtml = '';
    if(card.pill){
      var pillSideClass = card.pillSide === 'right' ? ' pr' : '';
      pillHtml = '<span class="pill pill-' + escapeHtml(card.pill.variant) + pillSideClass + '">' + escapeHtml(card.pill.label) + '</span>';
    }

    var resourceLinkHtml = '';
    if(card.resourceLink){
      resourceLinkHtml = '<span class="pres-link" id="' + escapeHtml(card.resourceLink.id) + '">' + escapeHtml(card.resourceLink.label) +
        ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M7 17L17 7M9 7h8v8"/></svg></span>';
    }

    var detailRowsHtml = '';
    if(card.detailRows && card.detailRows.length){
      detailRowsHtml = '<div class="pdet">' + card.detailRows.map(function(r){
        return '<div><span>' + escapeHtml(r.label) + '</span>' + escapeHtml(r.value) + '</div>';
      }).join('') + '</div>';
    }

    var ctaClass = card.cta.variant === 'ghost' ? ' ghost' : card.cta.variant === 'cert' ? ' gcert' : '';

    el.innerHTML =
      '<div class="pav">' + pillHtml + '<img src="' + pdata.photo + '" alt="' + escapeHtml(title) + '"></div>' +
      '<div class="pbody">' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<p>' + escapeHtml(blurb) + '</p>' +
        resourceLinkHtml +
        detailRowsHtml +
        '<button class="pbtn2' + ctaClass + '" type="button">' + escapeHtml(card.cta.label) + '</button>' +
      '</div>';

    // Certificate CTA opens the Certificate modal directly and never the
    // Program Detail modal (stopPropagation keeps the card's own click
    // handler, added below, from also firing).
    if(card.cta.variant === 'cert'){
      el.querySelector('.pbtn2').addEventListener('click', function(e){
        e.stopPropagation();
        Portal.modal.open('certModal', 'certScrim');
      });
    }

    // Resource-link trigger opens Forum Resources independently of the
    // card's own click-to-detail behavior.
    if(card.resourceLink){
      el.querySelector('#' + CSS.escape(card.resourceLink.id)).addEventListener('click', function(e){
        e.stopPropagation();
        Portal.modal.open('resModal', 'resScrim');
      });
    }

    el.addEventListener('click', function(){
      Portal.programGrid.openDetail(card);
    });

    return el;
  }

  return {
    render: function(root, cards, opts){
      opts = opts || {};
      root.innerHTML = '';

      if(opts.heading || opts.lede){
        var head = document.createElement('div');
        head.className = 'phead wrap';
        head.innerHTML =
          (opts.heading ? '<h1>' + escapeHtml(opts.heading) + '</h1>' : '') +
          (opts.lede ? '<p class="plede">' + escapeHtml(opts.lede) + '</p>' : '');
        root.appendChild(head);
      }

      var gridWrap = document.createElement('div');
      gridWrap.className = 'wrap';
      var grid = document.createElement('div');
      grid.className = 'pgrid';
      cards.forEach(function(card){ grid.appendChild(buildCard(card)); });
      gridWrap.appendChild(grid);
      root.appendChild(gridWrap);
    },

    // Opens Program Detail for one card, combining Portal.pdata's static
    // evergreen description with that card's own dynamic status/next/cta —
    // never another card's, since each card only ever describes itself.
    openDetail: function(card){
      var pdata = Portal.pdata[card.key];
      var title = card.title || pdata.title;
      document.getElementById('pgEyebrow').innerHTML = card.pill ? card.pill.label : '';
      document.getElementById('pgTitle').innerHTML = title;
      document.getElementById('pgStatus').innerHTML = (card.detailRows || []).map(function(r){
        return r.label + ' · ' + r.value;
      }).join(' &middot; ');
      document.getElementById('pgDesc').innerHTML = pdata.detail.desc;
      document.getElementById('pgNext').innerHTML = card.next || '';
      var cta = document.getElementById('pgCta');
      cta.innerHTML = card.cta.label;
      cta.onclick = card.onCta || function(){};
      Portal.modal.open('pgModal', 'pgScrim');
    }
  };
})();

/* =========================================================
   Portal.format — human date/time strings from a resolved
   UTC instant (Portal.dateUtil output) + IANA zone. Shared by
   every phase renderer that needs to show a date, so there is
   exactly one place formatting logic lives, not one per page
   the way the original mockups each hand-rolled their own.
   ========================================================= */
Portal.format = (function(){
  var ZONE_LABELS = {
    'America/Los_Angeles':'Pacific', 'America/Denver':'Mountain', 'America/Phoenix':'Arizona',
    'America/Chicago':'Central', 'America/New_York':'Eastern', 'America/Anchorage':'Alaska',
    'Pacific/Honolulu':'Hawaii', 'UTC':'UTC'
  };

  function zoneLabel(ianaId){
    if(ZONE_LABELS[ianaId]) return ZONE_LABELS[ianaId];
    var last = (ianaId || '').split('/').pop() || ianaId || '';
    return last.replace(/_/g, ' ');
  }

  function parts(ts, tz){
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    var q = {};
    f.formatToParts(new Date(ts)).forEach(function(x){ q[x.type] = x.value; });
    return q;
  }

  function weekdayShort(ts, tz){
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ts));
  }

  function weekdayMonthDay(ts, tz){
    var p = parts(ts, tz);
    return p.weekday + ', ' + p.month + ' ' + p.day;
  }

  function time(ts, tz){
    var p = parts(ts, tz);
    return p.hour + ':' + p.minute + ' ' + p.dayPeriod;
  }

  /* "Friday, August 14 · 9:00 AM Pacific" */
  function whenLine(ts, tz){
    return weekdayMonthDay(ts, tz) + ' · ' + time(ts, tz) + ' ' + zoneLabel(tz);
  }

  /* "Fri–Sun, Aug 14–16, 2026" — assumes start/end fall in the same
     month, true for every course this pilot covers; a cross-month
     span would need a fuller implementation, not attempted here. */
  function dateRange(startTs, endTs, tz){
    var ps = parts(startTs, tz), pe = parts(endTs, tz);
    return weekdayShort(startTs, tz) + '–' + weekdayShort(endTs, tz) + ', ' +
      ps.month.slice(0, 3) + ' ' + ps.day + '–' + pe.day + ', ' + ps.year;
  }

  /* hour derived from the resolved instant, not a hardcoded guess */
  function dayPeriodLabel(ts, tz){
    var hour = +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(ts));
    if(hour >= 17) return 'evening';
    if(hour >= 12) return 'afternoon';
    return 'morning';
  }

  return { zoneLabel:zoneLabel, weekdayShort:weekdayShort, weekdayMonthDay:weekdayMonthDay,
    time:time, whenLine:whenLine, dateRange:dateRange, dayPeriodLabel:dayPeriodLabel };
})();

/* =========================================================
   Portal.calendar — generic .ics download, generalized from the
   pattern duplicated across the during/post-event mockups
   (lmAddCal()) into one reusable function that takes real event
   data instead of hardcoded dates. Fixes the Pre-event "Add to
   Calendar" button, which had no click handler at all in the
   source mockup.
   ========================================================= */
Portal.calendar = (function(){
  function stamp(ts){
    return new Date(ts).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /* events: [{ start, end (ms epoch), summary, location, description }] */
  function download(filename, events){
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Landmark Worldwide//Member Portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    events.forEach(function(e, i){
      L.push('BEGIN:VEVENT',
        'UID:landmark-' + i + '-' + e.start + '@landmarkworldwide.com',
        'DTSTAMP:' + stamp(Date.now()),
        'DTSTART:' + stamp(e.start),
        'DTEND:' + stamp(e.end),
        'SUMMARY:' + e.summary,
        'LOCATION:' + (e.location || 'Online'),
        'DESCRIPTION:' + (e.description || 'Join from your Landmark member portal.'),
        'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    var blob = new Blob([L.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  return { download: download };
})();

/* =========================================================
   Portal.confetti — fires on every Certificate-modal open
   (wired from Portal.modal.open in member-portal.html's own
   shell script, the single choke point every certModal open
   already passes through — current call sites and future ones
   alike — via the modalId === 'certModal' check there, so this
   fires at the exact moment the button click opens the modal).

   Two canvases, not one: a back layer (z-index 90, behind the
   modal's own z-index 91) and a front layer (z-index 92, above
   it), each particle randomly assigned to one at spawn. A
   single shared layer caused a real bug — during the modal's
   own .25s opacity transition, back-layer confetti was briefly
   visible *through* the not-yet-opaque card, reading as "in
   front" for a split second before the card finished fading in.
   Splitting the layers makes "some in front, some behind" the
   actual intended look instead of a transition artifact.

   The cannon sits at bottom-center of the screen and sprays the
   full brand palette across a 180° upward arc; gravity pulls
   each piece back down, and it dissolves as it nears the bottom
   of the screen rather than piling up or vanishing abruptly.
   ========================================================= */
Portal.confetti = (function(){
  var COLORS = ['#f06449', '#c8452a', '#2ea203', '#217a00', '#0d2d31', '#efede7'];
  var raf = null, layers = null, resizeHandler = null;

  function stop(){
    if(raf) window.cancelAnimationFrame(raf);
    if(resizeHandler) window.removeEventListener('resize', resizeHandler);
    if(layers) layers.forEach(function(l){ if(l.canvas.parentNode) l.canvas.parentNode.removeChild(l.canvas); });
    raf = null; layers = null; resizeHandler = null;
  }

  function makeLayer(zIndex){
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:' + zIndex + ';pointer-events:none;';
    document.body.appendChild(canvas);
    return { canvas: canvas, ctx: canvas.getContext('2d') };
  }

  function fire(opts){
    opts = opts || {};
    stop(); // re-triggering mid-burst restarts cleanly rather than stacking canvases

    var back = makeLayer(90);  // behind .modal (z-index 91)
    var front = makeLayer(92); // in front of .modal
    layers = [back, front];

    var dpr = window.devicePixelRatio || 1;
    function size(){
      layers.forEach(function(l){
        l.canvas.width = window.innerWidth * dpr;
        l.canvas.height = window.innerHeight * dpr;
        l.canvas.style.width = window.innerWidth + 'px';
        l.canvas.style.height = window.innerHeight + 'px';
        l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
    }
    size();
    resizeHandler = size;
    window.addEventListener('resize', resizeHandler);

    var vh = window.innerHeight;
    var originX = window.innerWidth / 2;
    var originY = vh; // cannon sits at bottom-center of the screen
    var GRAVITY = 0.32;
    var fadeStartY = vh * 0.55; // dissolve as pieces near the bottom, not on a fixed timer

    var particles = [];
    var count = opts.count || 330; // +50% over the original 220
    var SPREAD_DEG = 100; // tightened from a full 180deg fan to a cannon-width cone, still centered straight up
    for(var i = 0; i < count; i++){
      var angle = (-90 + (Math.random() - 0.5) * SPREAD_DEG) * Math.PI / 180;
      var speed = 15 + Math.random() * 16; // needs real force to reach mid-screen from a bottom-edge origin
      particles.push({
        x: originX, y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 5,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        shape: Math.random() < 0.7 ? 'rect' : 'circle',
        layer: Math.random() < 0.5 ? back : front // ~half behind the popup, half in front, from the same cannon
      });
    }

    // Hard time-based fade on top of the position-based one below — a
    // "nice little experience" means it wraps up fast, so nothing (not
    // even a slow high-arc outlier) is allowed to hang around past
    // ~1.9s, regardless of where it physically is on screen.
    var TIME_FADE_START = 1100, TIME_FADE_END = 1900;

    var startTs = null;
    function tick(ts){
      if(!startTs) startTs = ts;
      layers.forEach(function(l){ l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height); });
      var elapsed = ts - startTs;
      var timeAlpha = elapsed < TIME_FADE_START ? 1 : Math.max(0, 1 - (elapsed - TIME_FADE_START) / (TIME_FADE_END - TIME_FADE_START));
      var alive = timeAlpha > 0;
      particles.forEach(function(p){
        if(p.y > vh + 40) return; // already off the bottom edge — dissolved
        p.vy += GRAVITY;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        var posAlpha = p.y > fadeStartY ? Math.max(0, 1 - (p.y - fadeStartY) / (vh - fadeStartY)) : 1;
        var alpha = Math.min(posAlpha, timeAlpha);
        if(alpha <= 0) return;
        var ctx = p.layer.ctx;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if(p.shape === 'circle'){
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      });
      if(alive){
        raf = window.requestAnimationFrame(tick);
      } else {
        stop();
      }
    }
    raf = window.requestAnimationFrame(tick);
  }

  return { fire: fire, stop: stop };
})();

/* =========================================================
   Portal.techCheck — the Prepare-card "Tech Check" wizard
   (camera/mic -> connection -> Zoom test -> confirm), opened
   from #techOpen. The shipped Pre-event mockup's card was
   inert copy only, with no href or click handler at all
   (flagged 2026-08-07: the live pre-event template doesn't
   have this wired up either — it only exists, working, in an
   earlier prototype build that was otherwise out of scope for
   this plan). Ported from that prototype: real getUserMedia
   camera/mic preview + input-level meter, a test-tone button,
   a fast.com speed-test link, and a zoom.us/test link, gated
   behind per-step confirmation checkboxes. Restyled to this
   file's own tokens/components (.pbtn2 buttons, .tc-* wizard
   chrome) rather than porting the prototype's CSS as-is.
   init() is idempotent so it's safe to call on every
   Portal.render.pre() re-render; it owns this modal's close/
   scrim/Escape handling itself (not the shared wire() list in
   member-portal.html) because closing must also stop the
   camera/mic stream, which the generic Portal.modal.shut()
   doesn't know how to do.
   ========================================================= */

/* =========================================================
   Portal.account — the floating top-right avatar control AND
   the My Account modal it opens (added 2026-08-07: originally
   scoped out — "logout only, no My Profile" was a locked build
   rule — reversed on direct instruction once it became clear
   participants need a real way to change their display name
   and photo, not just log out).

   setAvatar(url) swaps #fabAccountIcon's contents for a real
   photo when the Contact record's Profile Image URL is set,
   falling back to the default person-outline SVG (the shell's
   own static markup) when it isn't. Kept as the ONLY top-right
   affordance on every phase (mobile hides the nav CTA slot
   entirely, see member-portal.html's mobile media query) so the
   avatar is a stable, familiar element across Pre/During/Post.

   populateForm(data) and wirePhotoUpload() are both called once
   from Portal.init() (Stage 6), same as setAvatar — My Account
   is static shell markup (not phase-rendered), so it only needs
   wiring/filling once per page load, not per-renderer. Exact
   crop/fit is a later polish pass.

   wireSave() (added 2026-08-09) is real write-back, not a stub —
   POSTs to the webhook spec'd in ontraport-setup-punchlist.md §5
   (an n8n workflow: uploads the photo to Cloudinary server-side if
   present, then writes everything to Ontraport in one call).
   ACCOUNT_UPDATE_WEBHOOK_URL is empty until that workflow actually
   exists — Save reports a clear "not connected yet" instead of
   silently pretending to work when it's unset, so this never
   regresses back into looking-done-but-isn't the way the old stub
   did (reported live 2026-08-09: photo/fields appeared to save but
   reverted on refresh — nothing was ever actually sent anywhere).
   ========================================================= */
Portal.account = (function(){
  var DEFAULT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  // Production webhook, corrected 2026-08-09 per direct client
  // correction — the UUID-based form previously wired here (per the
  // handoff doc) was actually wrong; this shorter form is the real one.
  var ACCOUNT_UPDATE_WEBHOOK_URL = 'https://landmarkworldwide.awesomate.io/webhook/portal-account-update';

  function escapeAttr(s){
    return String(s).replace(/[&<>"\']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', '\'':'&#39;' }[c]; });
  }

  // Ontraport's [Contact//Profile Image] merge tag renders a full
  // `<img src='...' />` tag once the field is populated, not a bare URL
  // (see member-portal.html's PORTAL_DATA comment on profileImageUrl) —
  // pull the real URL back out of that wrapper if present. Bare URLs
  // (e.g. the webhook's own JSON response) pass through unchanged.
  function extractImgUrl(raw){
    if(!raw) return '';
    var m = /src=['"]([^'"]+)['"]/.exec(raw);
    return m ? m[1] : raw;
  }

  function setAvatar(url){
    url = extractImgUrl(url);
    var icon = document.getElementById('fabAccountIcon');
    if(icon) icon.innerHTML = url ? '<img class="fab-account__avatar" src="' + escapeAttr(url) + '" alt="">' : DEFAULT_ICON;
    var preview = document.getElementById('acctPhotoPreview');
    if(preview) preview.innerHTML = url ? '<img src="' + escapeAttr(url) + '" alt="">' : DEFAULT_ICON;
  }

  function populateForm(data){
    data = data || {};
    var set = function(id, val){ var el = document.getElementById(id); if(el) el.value = val || ''; };
    var setChecked = function(id, val){ var el = document.getElementById(id); if(el) el.checked = !!val; };
    // acctDisplay pulls from Display Name (contacts.f2620), not First
    // Name — 2026-08-08 decision, keeps the real contact record intact.
    set('acctDisplay', data.displayName);
    set('acctLast', data.lastName);
    set('acctEmail', data.email);
    set('acctPhone', data.phone);
    set('acctTz', data.tz);
    setChecked('acctNotifyProgram', data.programUpdateNotifications);
    setChecked('acctNotifyJoin', data.joinNotifications);
    setChecked('acctNotifyMarketing', data.marketingAccepted);
  }

  var pendingPhotoFile = null;
  var photoUploadWired = false;
  function wirePhotoUpload(){
    if(photoUploadWired) return; photoUploadWired = true;
    var btn = document.getElementById('acctPhotoBtn');
    var input = document.getElementById('acctPhotoInput');
    if(!btn || !input) return;
    btn.addEventListener('click', function(){ input.click(); });
    input.addEventListener('change', function(){
      var file = input.files && input.files[0];
      if(!file) return;
      // Instant local preview only (URL.createObjectURL) — the real
      // upload happens on Save, alongside the other fields, so picking
      // a photo without hitting Save doesn't half-persist anything.
      pendingPhotoFile = file;
      setAvatar(URL.createObjectURL(file));
    });
  }

  var saveWired = false;
  function wireSave(){
    if(saveWired) return; saveWired = true;
    var btn = document.getElementById('acctSave');
    if(!btn) return;
    btn.addEventListener('click', function(){
      if(!ACCOUNT_UPDATE_WEBHOOK_URL){
        btn.textContent = 'Not connected yet';
        setTimeout(function(){ btn.textContent = 'Save Changes'; }, 2400);
        return;
      }
      var get = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
      // contact_id comes from Ontraport's own dcParam (embedded on every
      // membership-site page for session identification) — trusted as-is
      // per direct instruction 2026-08-09, NOT cryptographically verified
      // (Ontraport's signing scheme/secret is unknown). Accepted risk for
      // this pilot's small, known participant group — see
      // ontraport-setup-punchlist.md §5 before hardening this later.
      var contactId = (window.dcParam && window.dcParam.contact_id) || '';
      var getChecked = function(id){ var el = document.getElementById(id); return el ? el.checked : false; };
      var fd = new FormData();
      fd.append('contactId', contactId);
      // registrationId (window.PORTAL_DATA.registrationId, [Page//ID]) —
      // needed so the write-back webhook knows which Registration record
      // to update for the two notification checkboxes below; contactId
      // alone isn't enough since those two fields live on registrations,
      // not contacts.
      fd.append('registrationId', (window.PORTAL_DATA && window.PORTAL_DATA.registrationId) || '');
      fd.append('displayName', get('acctDisplay'));
      fd.append('lastName', get('acctLast'));
      fd.append('email', get('acctEmail'));
      fd.append('phone', get('acctPhone'));
      fd.append('programUpdateNotifications', getChecked('acctNotifyProgram') ? '1' : '0');
      fd.append('joinNotifications', getChecked('acctNotifyJoin') ? '1' : '0');
      fd.append('marketingAccepted', getChecked('acctNotifyMarketing') ? '1' : '0');
      if(pendingPhotoFile) fd.append('photo', pendingPhotoFile);

      btn.textContent = 'Saving…'; btn.disabled = true;
      fetch(ACCOUNT_UPDATE_WEBHOOK_URL, { method: 'POST', body: fd }).then(function(res){
        if(!res.ok) throw new Error('Request failed');
        return res.json();
      }).then(function(result){
        if(!result || result.success !== true) throw new Error((result && result.error) || 'Unknown error');
        if(result.profileImageUrl){
          setAvatar(result.profileImageUrl);
          pendingPhotoFile = null;
          if(window.PORTAL_DATA) window.PORTAL_DATA.profileImageUrl = result.profileImageUrl;
        }
        if(window.PORTAL_DATA){
          window.PORTAL_DATA.displayName = fd.get('displayName');
          window.PORTAL_DATA.lastName = fd.get('lastName');
          window.PORTAL_DATA.email = fd.get('email');
          window.PORTAL_DATA.phone = fd.get('phone');
          window.PORTAL_DATA.programUpdateNotifications = fd.get('programUpdateNotifications') === '1';
          window.PORTAL_DATA.joinNotifications = fd.get('joinNotifications') === '1';
          window.PORTAL_DATA.marketingAccepted = fd.get('marketingAccepted') === '1';
        }
        btn.textContent = 'Saved ✓';
        btn.disabled = false;
        setTimeout(function(){ btn.textContent = 'Save Changes'; }, 2400);
      }).catch(function(){
        btn.textContent = 'Save failed — try again';
        btn.disabled = false;
        setTimeout(function(){ btn.textContent = 'Save Changes'; }, 2600);
      });
    });
  }

  return { setAvatar: setAvatar, populateForm: populateForm, wirePhotoUpload: wirePhotoUpload, wireSave: wireSave };
})();

Portal.techCheck = (function(){
  var inited = false, stream = null, audioCtx = null, raf = null, step = 1, returningFromSupport = false;

  function stop(){
    if(raf) cancelAnimationFrame(raf); raf = null;
    if(stream){ stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
    if(audioCtx){ try{ audioCtx.close(); }catch(e){} audioCtx = null; }
    var v = document.getElementById('techVideo'); if(v) v.srcObject = null;
    var lv = document.getElementById('techLevel'); if(lv) lv.style.width = '0';
    var cn = document.getElementById('techCamNote'); if(cn) cn.style.display = '';
  }

  function updateNext(){
    if(step === 4) return;
    var chk = document.getElementById('chk' + step);
    document.getElementById('techNext').disabled = !(chk && chk.checked);
  }

  function show(n){
    step = n;
    var modal = document.getElementById('techModal');
    modal.querySelectorAll('.tc-step').forEach(function(el){
      el.classList.toggle('active', parseInt(el.getAttribute('data-step'), 10) === n);
    });
    modal.querySelectorAll('.tc-dot').forEach(function(el){
      var dn = parseInt(el.getAttribute('data-dot'), 10);
      el.classList.toggle('active', dn === n);
      el.classList.toggle('done', dn < n);
    });
    var back = document.getElementById('techBack'), next = document.getElementById('techNext'),
        dots = modal.querySelector('.tc-dots'), title = document.getElementById('techTitle');
    back.hidden = (n === 1 || n === 4);
    if(n === 4){
      next.textContent = 'Done'; next.disabled = false;
      dots.style.visibility = 'hidden';
      title.textContent = 'You’re all set';
    } else {
      dots.style.visibility = 'visible';
      next.innerHTML = (n === 3 ? 'Finish &rarr;' : 'Next &rarr;');
      title.textContent = (n === 1 ? 'Test your camera & microphone' : n === 2 ? 'Check your connection' : 'Join a Zoom test');
      updateNext();
    }
  }

  function reset(){
    stop();
    ['chk1','chk2','chk3'].forEach(function(id){ var e = document.getElementById(id); if(e) e.checked = false; });
    var st = document.getElementById('techStatus'); if(st) st.textContent = '';
    var b = document.getElementById('techStart'); if(b){ b.disabled = false; b.textContent = 'Start camera & mic test'; }
    show(1);
  }

  function shut(){ Portal.modal.shut('techModal', 'techScrim'); reset(); }

  function init(){
    if(inited) return; inited = true;

    var opener = document.getElementById('techOpen');
    if(opener) opener.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('techModal', 'techScrim'); show(1); });

    document.getElementById('techClose').addEventListener('click', shut);
    document.getElementById('techScrim').addEventListener('click', shut);
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && document.getElementById('techModal').classList.contains('open')) shut();
    });

    ['chk1','chk2','chk3'].forEach(function(id){
      var e = document.getElementById(id); if(e) e.addEventListener('change', updateNext);
    });

    document.getElementById('techNext').addEventListener('click', function(){
      if(step >= 4) shut(); else show(step + 1);
    });
    document.getElementById('techBack').addEventListener('click', function(){ if(step > 1) show(step - 1); });

    // "Contact us" mid-wizard suspends the tech check (hide only — no
    // reset(), so the step, checkboxes, and running camera/mic preview
    // are all exactly as the participant left them) and opens Support
    // on top. Support's own close/scrim/Escape/submit paths are shared
    // shell chrome (wire('supportModal',...) in member-portal.html) used
    // by other contact entry points too, so returningFromSupport gates
    // the return-to-tech-check behavior to only this path — closing
    // Support from anywhere else still just closes it.
    document.getElementById('techContact').addEventListener('click', function(e){
      e.preventDefault();
      returningFromSupport = true;
      Portal.modal.shut('techModal', 'techScrim');
      Portal.modal.open('supportModal', 'supportScrim');
    });
    function returnFromSupport(){
      if(!returningFromSupport) return;
      returningFromSupport = false;
      Portal.modal.shut('supportModal', 'supportScrim');
      Portal.modal.open('techModal', 'techScrim');
    }
    document.getElementById('supportClose').addEventListener('click', returnFromSupport);
    document.getElementById('supportScrim').addEventListener('click', returnFromSupport);
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && returningFromSupport && document.getElementById('supportModal').classList.contains('open')) returnFromSupport();
    });

    document.getElementById('techStart').addEventListener('click', function(){
      var status = document.getElementById('techStatus'), btn = this;
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        status.textContent = 'Your browser can’t run the in-page test — the Zoom test in the last step will confirm everything.';
        return;
      }
      status.textContent = 'Requesting camera and microphone…';
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(function(s){
        stream = s;
        var v = document.getElementById('techVideo'); v.srcObject = s;
        document.getElementById('techCamNote').style.display = 'none';
        status.textContent = ''; btn.textContent = 'Test running…'; btn.disabled = true;
        try{
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          var src = audioCtx.createMediaStreamSource(s);
          var an = audioCtx.createAnalyser(); an.fftSize = 512;
          src.connect(an);
          var data = new Uint8Array(an.frequencyBinCount);
          var lv = document.getElementById('techLevel');
          (function loop(){
            an.getByteFrequencyData(data);
            var sum = 0; for(var i = 0; i < data.length; i++) sum += data[i];
            var pct = Math.min(100, Math.round((sum / data.length) / 140 * 100));
            lv.style.width = pct + '%';
            raf = requestAnimationFrame(loop);
          })();
        }catch(e){}
      }).catch(function(){
        status.textContent = 'We couldn’t reach your camera or microphone. Please allow permission in your browser — the Zoom test in the last step will also confirm everything.';
      });
    });

    document.getElementById('techSound').addEventListener('click', function(){
      try{
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 660;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
        o.start(); o.stop(ctx.currentTime + 0.85);
      }catch(e){}
    });

    show(1);
  }

  return { init: init };
})();

/* =========================================================
   Portal.render.pre — the Pre-event page. Ported from
   member-portal-preevent_7.html with two defects fixed at the
   source (see the PRE-EVENT CSS comment in member-portal.html):
     - the hero's date copy and the countdown target were two
       independently-hardcoded literals; both now derive from
       one Portal.dateUtil.resolveStart() call.
     - "Add to Calendar" (hero + Prepare card) had no click
       handler at all; both now call Portal.calendar.download().
   The nav's Prepare/Guidance/FAQ/Contact tabs and the flip-card
   tips / agreements / FAQ copy are generic, not participant-
   specific, so they're authored once as static markup here
   rather than templated per field.
   ========================================================= */
Portal.render = Portal.render || {};

/* =========================================================
   Portal.render._sec — shared section builders used by both
   Pre-event's own hero-course and Post-event's "next course"
   view (Stage 5). Confirmed by direct diff: Prepare, Set
   Yourself Up, Agreements, Be Present, and FAQ are byte-
   identical in content/structure across the preevent_7 and
   postevent-registered mockups (postevent's own copy of the
   FAQ's "When should I log in" answer even hardcoded literal
   9:30/10:00 times where Pre-event already computed them —
   same defect class as everything else in this project, fixed
   for free by sharing this code instead of re-porting it).
   Authored once so a correction to one phase's copy/behavior
   can't drift from the other, per the locked "propagate to
   every shared path" rule.
   ========================================================= */
Portal.render._sec = {
  // Hoisted out of Portal.render.pre 2026-08-09 (was defined and called
  // there only) — .rules li / #bepresent start at opacity:0 by design
  // (see member-portal.html's "AGREEMENTS — staggered reveal + hover"
  // CSS) and only ever become visible once this adds the 'in' class.
  // During's own #rules and Post's shared _sec.rules/_sec.bepresent were
  // rendering permanently invisible with no JS bug of their own to find
  // — the reveal wiring itself just never existed for them. Now shared
  // so every phase that renders these sections also reveals them.
  reveal: function(el, cls, th){
    if(!el) return;
    if('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ el.classList.add(cls); io.unobserve(el); } });
      }, { threshold: th });
      io.observe(el);
    } else { el.classList.add(cls); }
  },
  // Information Form destination. Real URL added 2026-08-09, per direct
  // instruction — previously just an inert <span>, no href at all.
  // Lifted out of prepare() 2026-08-14 so During-event's info-form gate
  // banner points at the identical destination: two hand-built copies of
  // this URL would eventually drift, and a participant who's blocked out
  // of the room is the worst place to discover a stale link.
  infoFormUrl: function(data){
    data = data || {};
    return 'https://lm.landmarkworldwide.com/registration-confirmed' +
      '?cuid=' + encodeURIComponent(data.contactUniqueId || '') +
      '&cemail=' + encodeURIComponent(data.email || '') +
      '&cfirstname=' + encodeURIComponent(data.firstName || '');
  },
  // data is optional (only prepare() needs it, for the Information Form
  // link's query params) — callers that don't have it yet can omit it,
  // same tolerance every other renderer already has for partial data.
  prepare: function(courseType, infoFormDone, data){
    data = data || {};
    function escapeHtml(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', '\'':'&#39;' }[c];
      });
    }
    var infoFormUrl = Portal.render._sec.infoFormUrl(data);
    var infoCardHtml = infoFormDone ?
      '<div class="pcard done"><div class="ph"><span class="pill pr pill-done">Completed</span><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-prepare-form.jpg" alt="Complete your information form"></div><div class="pbody"><div class="ptag serif-it">a few minutes.</div><h3>Complete Your Information Form</h3><p>Thanks — we have everything we need from you.</p></div></div>' :
      '<div class="pcard"><div class="ph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-prepare-form.jpg" alt="Complete your information form"></div><div class="pbody"><div class="ptag serif-it">a few minutes.</div><h3>Complete Your Information Form</h3><p>We still need a few details from you before the weekend. It only takes a few minutes.</p><a class="go" href="' + escapeHtml(infoFormUrl) + '" target="_blank" rel="noopener">Finish now &rarr;</a></div></div>';
    return '<section class="block paper" id="prepare"><div class="wrap">' +
      '<div class="sec-head"><div class="eyebrow">Get Ready</div><h2>Prepare for your ' + courseType + '</h2><p>A few simple things to take care of before your course begins. Each takes just a couple of minutes.</p></div>' +
      '<div class="pcards">' +
        '<div class="pcard"><div class="ph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-prepare-calendar.jpg" alt="Add the ' + courseType + ' to your calendar"></div><div class="pbody"><div class="ptag serif-it">block the time.</div><h3>Add to Your Calendar</h3><p>Block Friday through Sunday, plus the Tuesday graduation evening, so nothing slips into your ' + courseType + ' time.</p><span class="go" id="prepAddCal">Add to calendar &rarr;</span></div></div>' +
        '<div class="pcard"><div class="ph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-prepare-techcheck.jpg" alt="Test your camera, microphone, and connection"></div><div class="pbody"><div class="ptag serif-it">join with ease.</div><h3>Tech Check</h3><p>Test your connection, camera, and sound so joining on Friday is completely effortless.</p><span class="go" id="techOpen">Check your setup &rarr;</span></div></div>' +
        infoCardHtml +
      '</div>' +
    '</div></section>';
  },
  guide: function(courseType){
    var FLIP_TIPS = [
      { icon:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>', h:'Let people know', f:'Give your household a heads-up you’ll be in the ' + courseType + ', so you’re not interrupted.', b:'Protect the time. This weekend is yours.' },
      { icon:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', h:'Join on time', f:'Log in a few minutes before each session begins.', b:'Start strong. Set yourself up to win.' },
      { icon:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><line x1="3" y1="3" x2="21" y2="21"/>', h:'Minimize distractions', f:'Silence your phone and close the other tabs.', b:'Give the weekend everything you’ve got.' },
      { icon:'<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8l-6 4 6 4V8z"/>', h:'Turn on your camera', f:'Being seen keeps you connected to the room.', b:'Be seen. Be part of the room.' },
      { icon:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>', h:'Prepare your space', f:'Find a quiet, comfortable spot where you won’t be interrupted.', b:'A calm space, a clear mind.' },
      { icon:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', h:'Have a notebook', f:'Keep one nearby for anything you want to hold onto.', b:'Catch the thoughts worth keeping.' },
      { icon:'<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/><path d="M6 1v3M10 1v3M14 1v3"/>', h:'Eat well', f:'Have nourishing food and snacks ready for the weekend.', b:'Fuel yourself for a full day.' },
      { icon:'<path d="M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', h:'Drink water', f:'Keep a full glass or bottle within reach all weekend.', b:'Stay sharp. Keep the water close.' },
      { icon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>', h:'Rest well', f:'Get good sleep so you arrive fresh for each day.', b:'Show up rested and ready.' }
    ];
    var flipRefreshIcon = '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>';
    var flipsHtml = FLIP_TIPS.map(function(t){
      return '<div class="flip" tabindex="0"><div class="flip-in">' +
        '<div class="flip-face flip-front"><div class="flip-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + flipRefreshIcon + '</svg></div>' +
        '<div class="fico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + t.icon + '</svg></div>' +
        '<h4>' + t.h + '</h4><p>' + t.f + '</p></div>' +
        '<div class="flip-face flip-back"><p>' + t.b + '</p></div>' +
      '</div></div>';
    }).join('');
    return '<section class="block alt" id="guide"><div class="wrap">' +
      '<div class="sec-head"><div class="eyebrow">Create the Best Experience</div><h2>Set yourself up.</h2><p>The ' + courseType + ' works best when you can be fully present. A little preparation goes a long way.</p></div>' +
      '<div class="flips">' + flipsHtml + '</div>' +
    '</div></section>';
  },
  rules: function(courseType){
    var RULES = [
      'Be present for the full day, start to finish',
      'Arrive on time for each session and stay through the close',
      'Give the room your full attention — set phones, devices, and other distractions aside',
      'Keep what others share confidential and treat everyone with respect',
      'Please don’t record, screen-capture, or share any part of the event'
    ];
    return '<section class="block paper"><div class="wrap">' +
      '<div class="rules" id="rules">' +
        '<div class="big">A few simple agreements that make the ' + courseType + ' work for everyone.</div>' +
        '<ul>' + RULES.map(function(r){
          return '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5"/></svg> <span>' + r + '<b class="gd">.</b></span></li>';
        }).join('') + '</ul>' +
      '</div>' +
    '</div></section>';
  },
  bepresent: function(){
    return '<section class="block alt" style="padding-top:0;"><div class="wrap">' +
      '<div class="g-note" id="bepresent">' +
        '<div class="np"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-engage-photo.jpg" alt="A Forum participant fully engaged in the room"></div>' +
        '<div class="gtxt"><h4>Above all — <span class="swipe">come ready to engage.</span></h4>' +
        '<p>There’s nothing to study or prepare in advance — just come ready to engage fully. Between now and Friday, keep considering what you’d like to be different, and what you’d love to create. Bring your real life with you: the relationships, the situations, and the parts of your life that matter most.</p></div>' +
      '</div>' +
    '</div></section>';
  },
  faq: function(courseType, hasStart, roomOpenTs, startTs, ianaId){
    var FAQS = [
      ['What do I need to join?', 'A computer or tablet with a reliable internet connection, a working camera and microphone, and a quiet space. We’ll send a direct link, and you’ll enter the ' + courseType + ' right from this page.'],
      ['When should I log in each day?', hasStart ? 'The room opens at ' + Portal.format.time(roomOpenTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + '. Plan to arrive at least 15 minutes before the ' + Portal.format.time(startTs, ianaId) + ' start so your technology is set and you’re settled when we begin.' : 'Your room-open time will appear here as soon as it’s confirmed.'],
      ['What if something comes up during the weekend?', 'The ' + courseType + ' is designed to be experienced in full, so we ask that you arrange your schedule to be present for all sessions. If you have a concern, reach out to our team below and we’ll help.'],
      ['Do I need to take notes or prepare anything?', 'There’s nothing to study or prepare in advance. You’re welcome to keep a notebook nearby, but you don’t need to capture everything — you’ll receive materials, and the value is in being present.'],
      ['What should I have ready in my space?', 'Water, nourishing food and snacks, anything you need to be comfortable, and a way to minimize interruptions. Treat it as time set aside just for you.'],
      ['Who do I contact if I need help?', 'Our support team is here throughout. You’ll find our email and phone in the Contact section just below.']
    ];
    return '<section class="block paper" id="faq"><div class="wrap">' +
      '<div class="faq"><div class="huge">Good to<br>know<span>.</span></div><div class="acc">' +
        FAQS.map(function(qa, i){
          return '<details' + (i === 0 ? ' open' : '') + '><summary>' + qa[0] + ' <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6"/></svg></summary><div class="body">' + qa[1] + '</div></details>';
        }).join('') +
      '</div></div>' +
    '</div></section>';
  },
  // Seminar/AC program-grid card construction — identical business rule
  // needed by both During-event's "All Programs" tab and Post-event's
  // grid (registered -> show the specific one they're in; not
  // registered but a designated recommendation exists via
  // data.seminarNext/acNext -> recommend it; neither -> dim). Extracted
  // here (Stage 5) so the two phases can't drift; behavior unchanged
  // from the During-event version this was ported from.
  // Seminar detail rows, shaped to parallel the Forum card's Dates/Graduation/
  // Format block (2026-08-15, per direct instruction). Sources are the fields
  // n8n copies off the seminar's own Event record, all display-formatted
  // upstream, so nothing is parsed or reformatted here:
  //   Dates     f3274 Seminar Begins, widened to a range when f3279 Seminar
  //             Ends is also set -> "Thu, Sep 10 – Thu, Dec 3"
  //   Schedule  f3275 Seminar Schedule -> "Thursdays, 6:00 PM PT"
  //   Sessions  counted off f3278 Seminar Session Dates — the one derived row,
  //             since a seminar's length is what most distinguishes it from the
  //             Forum's three days -> "10 evenings"
  //
  // mf() drops any value that is still an unresolved Ontraport merge tag. Those
  // arrive as the literal "[Page//Seminar Ends]", which is truthy and would
  // otherwise render inside the range. This also means a field can be wired
  // here BEFORE it exists in Ontraport: it reads as absent until it's real.
  // Reads one PORTAL_DATA value, discarding anything that is still an
  // unresolved Ontraport merge tag. Those arrive as the literal
  // "[Page//Seminar Ends]", which is truthy and would otherwise print inside a
  // date range. Consequence worth knowing: a field can be wired here BEFORE it
  // exists in Ontraport — it simply reads as absent until it's real.
  mergeVal: function(v){
    v = (v == null ? '' : String(v)).trim();
    return v.charAt(0) === '[' ? '' : v;
  },

  // Seminar detail rows, shaped to parallel the Forum card's Dates/Graduation/
  // Format block. Sources are the fields n8n copies off the seminar's own Event
  // record, all display-formatted upstream, so nothing is parsed here:
  //   Dates     f3274 Seminar Begins, widened to a range when f3279 Seminar
  //             Ends is also set -> "Thu, Sep 10 – Thu, Dec 3"
  //   Schedule  f3275 Seminar Schedule -> "Thursdays, 6:00 PM PT"
  //   Sessions  counted off f3278 Seminar Session Dates — the one derived row,
  //             since a seminar's length is what most distinguishes it from the
  //             Forum's three days. Comma-separated on seminar Events, but the
  //             same field is newline-separated ISO on AC Events, so split both.
  //
  // There is deliberately no Advanced Course equivalent of this: an AC
  // registration has no dates to show, because the participant picks their
  // dates AFTER registering (2026-08-15, per direct instruction). The AC card
  // keeps the evergreen Format line in both states rather than rendering rows
  // that would be permanently blank.
  seminarDetailRows: function(post){
    var mf = Portal.render._sec.mergeVal;
    var begins = mf(post.seminarBegins);
    var ends = mf(post.seminarEnds);
    var sessions = mf(post.seminarSessionDates)
      .split(/[,\n]/).filter(function(s){ return s.trim(); }).length;
    return [
      { label: 'Dates', value: (begins && ends) ? begins + ' – ' + ends : begins },
      { label: 'Schedule', value: mf(post.seminarSchedule) },
      { label: 'Sessions', value: sessions ? sessions + ' evenings' : '' }
    ].filter(function(r){ return r.value; });
  },

  seminarAcCards: function(data){
    var hasSeminarReg = !!(data.post && data.post.hasSeminarReg);
    var hasACReg = !!(data.post && data.post.hasACReg);
    var seminar = {
      key: 'seminar',
      state: hasSeminarReg ? 'reg' : (data.seminarNext ? 'plain' : 'dim'),
      pill: hasSeminarReg ? { label: 'Upcoming', variant: 'upcoming' }
        : data.seminarNext ? { label: 'Recommended Next', variant: 'next' } : undefined,
      pillSide: hasSeminarReg ? undefined : 'right',
      // Registered -> name the seminar they actually chose (registrations
      // .f3185, via post.seminarTitle); not registered -> the recommendation's
      // title. Both fall through to Portal.pdata.seminar.title ("Seminar
      // Series") when unset, which is the common case: f3185 is blank on most
      // records that have f2303 checked.
      title: (hasSeminarReg && data.post.seminarTitle)
        || (data.seminarNext && data.seminarNext.title),
      // Registered -> the seminar they're actually in (see seminarDetailRows
      // above). Not registered -> the recommendation's own labels, unchanged.
      // Either way empty rows are dropped rather than rendered as blank .pdet
      // lines, so a registration with no seminar detail yet renders a lit card
      // with no detail block rather than a row of empty labels.
      detailRows: hasSeminarReg ? Portal.render._sec.seminarDetailRows(data.post || {})
      : data.seminarNext ? [
        { label: 'Begins', value: data.seminarNext.beginsLabel || 'Details available soon' },
        { label: 'Schedule', value: data.seminarNext.scheduleLabel || '' }
      ].filter(function(r){ return r.value; }) : [],
      cta: (hasSeminarReg || data.seminarNext)
        ? { label: hasSeminarReg ? 'View Details' : 'Learn More', variant: 'solid' }
        : { label: 'Learn More', variant: 'ghost' }
    };
    var ac = {
      key: 'ac',
      state: hasACReg ? 'reg' : (data.acNext ? 'plain' : 'dim'),
      pill: hasACReg ? { label: 'Upcoming', variant: 'upcoming' }
        : data.acNext ? { label: 'Recommended Next', variant: 'next' } : undefined,
      pillSide: hasACReg ? undefined : 'right',
      // Registered -> name the AC they actually enrolled in (registrations.f3186
      // "AC Title"), falling through to the recommendation's title and then to
      // Portal.pdata's "Advanced Course".
      title: (hasACReg && Portal.render._sec.mergeVal(data.post.acTitle))
        || (data.acNext && data.acNext.title),
      // No dates row in either state: AC participants choose their dates after
      // registering, so there is nothing date-shaped to show even once they're
      // enrolled. The Format line is evergreen and true regardless.
      detailRows: [{ label: 'Format', value: (data.acNext && data.acNext.formatLabel) || '3-day weekend + graduation evening' }],
      cta: (hasACReg || data.acNext)
        ? { label: hasACReg ? 'View Details' : 'View Advanced Course Dates', variant: 'solid' }
        : { label: 'Learn More', variant: 'ghost' }
    };
    return { seminar: seminar, ac: ac };
  }
};

Portal.render.pre = function(data){
  data = data || {};
  // Name Likes (contacts.f2792 — what they told us they want to be
  // called) wins over First Name for anything greeting-facing, falling
  // back to First Name when Name Likes is unset. Per direct instruction
  // 2026-08-07: this mirrors how the merge-field version would read —
  // [Name Likes] with a [Contacts//First Name] fallback — just resolved
  // here instead of in static Ontraport merge-tag copy, consistent with
  // every other participant-facing value in this file.
  var firstName = data.nameLikes || data.firstName || '';
  var courseType = data.courseType || 'Forum';
  var format = data.format || 'Online';
  var infoFormDone = !!data.infoFormCompleted; // registrations.f2579 "Information Form Completed"
  var tz = data.tz || 'US Pacific · PST/PDT · GMT-8/-7 (America/Los_Angeles)';
  var ianaId = Portal.dateUtil.ianaOf(tz) || 'America/Los_Angeles';

  var startTs = Portal.dateUtil.resolveStart({
    reference: data.eventStartUTC,
    date: data.eventStartDate,
    time: data.sessionStartTime,
    timeZone: tz
  });
  var endTs = Portal.dateUtil.resolveStart({ reference: data.eventEnd && data.eventEnd.reference, date: data.eventEnd && data.eventEnd.date, time: data.eventEnd && data.eventEnd.time, timeZone: tz }) ||
    (isNaN(startTs) ? NaN : startTs + 2 * 86400000); // fallback: assume a 3-day span if no explicit end given
  var gradTs = data.graduation ? Portal.dateUtil.resolveStart({
    reference: data.graduation.reference, date: data.graduation.date, time: data.graduation.time, timeZone: tz
  }) : NaN;

  var hasStart = !isNaN(startTs);
  var roomOpenTs = hasStart ? startTs - 30 * 60000 : NaN;

  // ---- nav links ----
  var navLinks = document.getElementById('navLinks');
  if(navLinks) navLinks.innerHTML =
    '<a href="#prepare">Prepare</a><a href="#guide">Guidance</a><a href="#faq">FAQ</a><a href="#contact">Contact</a>';

  // ---- program tabs ----
  // Added 2026-08-09 per direct instruction — the pilot has exactly one
  // program (this Forum), so there's no "Prior/All Programs" content to
  // switch to yet; a single always-active "Upcoming" button, using the
  // exact same .progtabs button markup/classes as During/Post so the
  // font/treatment stays identical across every phase.
  var progTabs = document.getElementById('progTabs');
  if(progTabs){
    progTabs.style.display = '';
    progTabs.querySelector('.wrap').innerHTML =
      '<button class="active" type="button">Upcoming</button>';
  }

  // ---- hero ----
  var heroMetaChips = hasStart ?
    '<span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> ' + courseType + ' &middot; ' + Portal.format.dateRange(startTs, isNaN(endTs) ? startTs : endTs, ianaId) + '</span>' +
    (!isNaN(gradTs) ? '<span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 6.9H22l-6 4.4 2.3 7-6.3-4.6L5.7 20l2.3-7-6-4.4h7.6z"/></svg> Graduation &middot; ' + Portal.format.weekdayShort(gradTs, ianaId) + ' ' + Portal.format.dayPeriodLabel(gradTs, ianaId) + ', ' + Portal.format.weekdayMonthDay(gradTs, ianaId).split(', ')[1] + '</span>' : '') +
    '<span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg> ' + format + '</span>' +
    '<span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Full-day experience &middot; ' + Portal.format.time(startTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + ' start</span>'
    : '';

  var heroHtml =
    '<header class="hero"><div class="wrap hero-inner">' +
      '<div class="hero-copy">' +
        '<div class="eyebrow">The Landmark ' + courseType + '</div>' +
        '<h1>Welcome to <span class="serif-it">your</span> ' + courseType + (firstName ? ', ' + firstName : '') + '.</h1>' +
        '<p class="lede">You\'re registered and ready to go. Everything you need to prepare, join the ' + courseType + ', and make the most of your experience lives right here — before and throughout the weekend.</p>' +
        '<div class="meta">' + heroMetaChips + '</div>' +
      '</div>' +
      '<aside class="anchor">' +
        '<div class="k">Your ' + courseType + ' begins</div>' +
        (hasStart ?
          '<div class="when">' + Portal.format.weekdayMonthDay(startTs, ianaId) + ' <span class="serif-it">&middot; ' + Portal.format.time(startTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + '</span></div>' +
          '<div class="countdown"><div class="cd-cell"><div class="cd-num" id="cd-d">–</div><div class="cd-lab">Days</div></div><div class="cd-cell"><div class="cd-num" id="cd-h">–</div><div class="cd-lab">Hours</div></div><div class="cd-cell"><div class="cd-num" id="cd-m">–</div><div class="cd-lab">Min</div></div><div class="cd-cell"><div class="cd-num" id="cd-s">–</div><div class="cd-lab">Sec</div></div></div>' +
          '<p class="note">The room will open at <b>' + Portal.format.time(roomOpenTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + '</b> — please arrive at least 15 minutes early to make sure your technology is all set. We\'ll see you soon.</p>'
          : '<p class="note">Your start time will appear here as soon as it\'s confirmed.</p>') +
        '<button class="pbtn pbtn-lg" id="heroAddCal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg> Add to Calendar</button>' +
      '</aside>' +
    '</div></header>';

  // ---- prepare / guide / agreements / be-present / faq ----
  // Ported to Portal.render._sec above (Stage 5) since Post-event's
  // "next course" view needs the identical content, re-parameterized.
  var prepareHtml = Portal.render._sec.prepare(courseType, infoFormDone, data);
  var guideHtml = Portal.render._sec.guide(courseType);
  var rulesHtml = Portal.render._sec.rules(courseType);
  var bepresentHtml = Portal.render._sec.bepresent();
  var faqHtml = Portal.render._sec.faq(courseType, hasStart, roomOpenTs, startTs, ianaId);

  var lmfBandHtml = '<div class="lmf-band"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-lmf-logo.png" alt="The Landmark Forum"></div>';

  // ---- contact ----
  var contactHtml =
    '<section class="contact" id="contact"><div class="wrap">' +
      '<div class="contact-grid">' +
        '<div><div class="eyebrow" style="color:var(--green-bright);">We’re Here For You</div><h2 style="margin-top:12px;">Questions? <span class="serif-it">We’ve got you.</span></h2><p>Anything at all — before or during the ' + courseType + ' — our team is happy to help you get ready and make the most of your weekend.</p><div class="health"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--green-bright)" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.9z"/></svg> Looking for extra support? <a id="hrLink">Explore Health Resources &rarr;</a></div></div>' +
        '<div class="ways">' +
          '<a class="cway" href="mailto:tjarrett@landmarkworldwide.com"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg></div><div><div class="lab">Email</div><div class="val">info@landmarkworldwide.com</div></div></a>' +
          '<a class="cway" href="tel:+13124403464"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg></div><div><div class="lab">Phone</div><div class="val">+1 (312) 440-3464</div></div></a>' +
          '<button class="cway" id="fbLink" type="button"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.9L3 21l1.9-4.5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg></div><div><div class="lab">We want to hear from you</div><div class="val">How’s it going so far? &rarr;</div></div></button>' +
        '</div>' +
      '</div>' +
    '</div></section>';

  var root = document.getElementById('portal-root');
  if(root) root.innerHTML = heroHtml + prepareHtml + guideHtml + rulesHtml + bepresentHtml + faqHtml + lmfBandHtml + contactHtml;

  // ---- wire behavior ----
  // hrLink/fbLink are content this function just rendered, not static
  // shell markup — the shell's own wire('hrModal',...) call ran before
  // this existed, so these triggers are wired here, directly, same
  // pattern Portal.programGrid already uses for its own dynamic triggers.
  var hrLink = document.getElementById('hrLink');
  if(hrLink) hrLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('hrModal', 'hrScrim'); });
  var fbLink = document.getElementById('fbLink');
  if(fbLink) fbLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('fbModal', 'fbScrim'); });
  Portal.techCheck.init();

  document.querySelectorAll('.flip').forEach(function(f){
    f.addEventListener('click', function(){ f.classList.toggle('flipped'); });
  });

  Portal.render._sec.reveal(document.getElementById('bepresent'), 'in', .35);
  Portal.render._sec.reveal(document.getElementById('rules'), 'in', .35);

  if(hasStart){
    var cdD = document.getElementById('cd-d'), cdH = document.getElementById('cd-h'), cdM = document.getElementById('cd-m'), cdS = document.getElementById('cd-s');
    // Seconds box added + interval dropped to 1s (was 30s) 2026-08-09 —
    // a countdown with no visible second-to-second movement reads as
    // stuck/broken even though the minutes were updating correctly.
    var tick = function(){
      var d = startTs - Date.now(); if(d < 0) d = 0;
      cdD.textContent = Math.floor(d / 86400000);
      cdH.textContent = Math.floor((d % 86400000) / 3600000);
      cdM.textContent = Math.floor((d % 3600000) / 60000);
      if(cdS) cdS.textContent = Math.floor((d % 60000) / 1000);
    };
    tick();
    window.setInterval(tick, 1000);

    var calEvents = [{
      start: startTs, end: !isNaN(endTs) ? endTs : startTs + 3 * 3600000,
      summary: 'The Landmark ' + courseType, location: format,
      description: 'Join from your Landmark member portal.'
    }];
    if(!isNaN(gradTs)){
      calEvents.push({ start: gradTs, end: gradTs + 2 * 3600000, summary: 'The Landmark ' + courseType + ' — Graduation', location: format });
    }
    // Pre-event only, per direct instruction 2026-08-09: also open the
    // client's AddEvent.com page alongside our own .ics download, rather
    // than replacing it.
    var ADD_EVENT_URL = 'https://www.addevent.com/calendar/05z6s5wm4wmc';
    var addCal = function(){
      Portal.calendar.download(courseType.toLowerCase() + '.ics', calEvents);
      window.open(ADD_EVENT_URL, '_blank', 'noopener');
    };
    var heroAddCal = document.getElementById('heroAddCal'); if(heroAddCal) heroAddCal.addEventListener('click', addCal);
    var prepAddCal = document.getElementById('prepAddCal'); if(prepAddCal) prepAddCal.addEventListener('click', addCal);
  }
};

/* =========================================================
   Portal.session.resolveCurrent(data, now) — Stage 4. Which
   session section is open/default-focused on the During-event
   page (not resource-item visibility — that's each item's own
   `released` flag). The hybrid rule from the Data Contract: the
   CS's manual override (registrations... no, events.f3025
   "Todays Session (Day)" — a session index or "Final") always
   wins when set; date math is only a fallback for the field
   being genuinely unset, never a way to auto-advance to
   Graduation (that release is manual-only, same as every
   Course Materials item).

   Correction to the plan's own pseudocode (2026-08-07): as
   first written, the null-check short-circuited to 0 before
   the stated date-math fallback could ever execute, which
   would make the "pure date-fallback" fixture case the Build
   Order explicitly calls for unreachable. Reordered so the
   override (including "Final") is checked first and always
   wins, computeFromDates only runs when it's genuinely unset,
   and 0 is the last-resort default if even that resolves to
   nothing (e.g. sessionDates missing).
   ========================================================= */
Portal.session = (function(){

  function compareYMD(a, b){
    if(a[0] !== b[0]) return a[0] - b[0];
    if(a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
  }

  function wallDateParts(ts, zone){
    var f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    var q = {}; f.formatToParts(new Date(ts)).forEach(function(x){ q[x.type] = x.value; });
    return [+q.year, +q.month, +q.day];
  }

  /* Date-math fallback only. Finds the highest session index whose
     date has arrived (<=), so a gap day between sessions holds at the
     last one reached rather than jumping to the next — this is what
     lets the same logic generalize to a Seminar's irregular weekly
     cadence later, not just the Forum's 3 consecutive days. Capped at
     the last known session; never advances to "Final" on its own. */
  function computeFromDates(sessionDates, now, tz){
    if(!sessionDates || !sessionDates.length) return 0;
    var zone = Portal.dateUtil.ianaOf(tz) || 'America/Los_Angeles';
    var today = wallDateParts(now, zone);
    var current = 0;
    for(var i = 0; i < sessionDates.length; i++){
      var d = Portal.dateUtil.parseDate(sessionDates[i]);
      if(d && compareYMD(d, today) <= 0) current = i + 1;
    }
    return current;
  }

  function resolveCurrent(data, now){
    data = data || {};
    var raw = Portal.dateUtil.val(data.currentReleasedSession);
    if(raw === 'Final') return 'Final';
    if(raw !== ''){
      var n = parseInt(raw, 10);
      return isNaN(n) ? raw : n;
    }
    var computed = computeFromDates(data.sessionDates, now, data.tz);
    return computed || 0;
  }

  return { resolveCurrent: resolveCurrent, computeFromDates: computeFromDates };
})();

/* =========================================================
   Portal.render.during — the During-event page. Ported from
   member-portal-during.html with the plan's flagship Stage-4
   defect fixed at the source: the hero hardcoded "Day One"
   while the assignments section simultaneously hardcoded "Day
   Three" as current, and the mockup's own comment admits the
   "inbox stack" day-switching this implies was never wired up.
   Both now read the same Portal.session.resolveCurrent() value,
   so that contradiction can't recur. The assignments stack is
   built from data.materials.sessions[] (Data Contract, 2026-
   08-07 corrections) — item count and session count both come
   from array length, never a fixed 3-slot day1/day2/day3 shape.
   Also fixed: two separate alert('This will open your Zoom
   room.') stubs (nav button + hero progcard) and one hardcoded
   phone number in the FAQ's transfer-course answer that
   disagreed with every other phone number in this file — the
   locked build rule is +1 (312) 440-3464 everywhere.
   ========================================================= */
/* `phase` (added 2026-08-17) is 'during' | 'pregrad' | 'graduation'. All three
   render THIS page — the assignments stack, materials, graduation section and
   everything else below the hero are identical in each, per direct instruction
   ("just the hero and the assignments all should be visible"). Only the hero
   block and the join CTA vary. Defaults to 'during' so every existing caller,
   including the three Ably handlers, keeps working unchanged. */
Portal.render.during = function(data, phase){
  data = data || {};
  phase = phase || 'during';
  var isPreGrad = phase === 'pregrad';
  var isGraduation = phase === 'graduation';
  // Name Likes (contacts.f2792 — what they told us they want to be
  // called) wins over First Name for anything greeting-facing, falling
  // back to First Name when Name Likes is unset. Per direct instruction
  // 2026-08-07: this mirrors how the merge-field version would read —
  // [Name Likes] with a [Contacts//First Name] fallback — just resolved
  // here instead of in static Ontraport merge-tag copy, consistent with
  // every other participant-facing value in this file.
  var firstName = data.nameLikes || data.firstName || '';
  var courseType = data.courseType || 'Forum';
  var format = data.format || 'Online';
  var tz = data.tz || 'US Pacific · PST/PDT · GMT-8/-7 (America/Los_Angeles)';
  var ianaId = Portal.dateUtil.ianaOf(tz) || 'America/Los_Angeles';
  var materials = data.materials || {};
  var sessions = materials.sessions || [];
  var graduationItems = materials.graduation || [];
  var guests = data.graduationGuests || []; // Data Contract gap — see 2026-08-07 plan note (Gap 4)
  var hasSeminarReg = !!(data.post && data.post.hasSeminarReg); // registrations.f2303
  var hasACReg = !!(data.post && data.post.hasACReg); // registrations.f2302
  var announcements = data.announcements || {}; // events.f3104/f3105/f3167 via registrations mirrors — see PORTAL_DATA
  var infoFormDone = !!data.infoFormCompleted; // registrations.f2579 "Information Form Completed"

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', '\'':'&#39;' }[c];
    });
  }

  // Invite Guest hub destination for "Invite another guest" and "Invite
  // your guests". 2026-08-14, per direct instruction: read Ontraport's own
  // registrations.page_104_url "Invite your friends URL" straight off the
  // record (PORTAL_DATA.inviteHubUrl) instead of assembling the path here.
  // The hand-built version this replaces used data.contactUniqueId — the
  // Contact's Unique ID — but the generated page is keyed to the
  // Registration's, so it pointed at the wrong path. No fallback: a made-up
  // URL that 404s is worse than an empty href, and the field is populated
  // and published on every registration checked.
  var inviteHubUrl = data.inviteHubUrl || '';

  // Seminar announcement card destination (PORTAL_DATA.seminarUrl),
  // 2026-08-15 per direct instruction — the card's "Claim your seminar"
  // CTA was one of the inert, hrefless spans carried over from the source
  // mockup. Same source pattern as inviteHubUrl above: Ontraport's own
  // generated registrations.page_119_url "Available Seminars URL", read off
  // the record rather than assembled here. Empty stays inert rather than
  // becoming href="" (which reloads the portal) — the announcement toggle
  // controls whether the card shows at all, not whether it has a
  // destination.
  var seminarUrl = data.seminarUrl || '';

  var startTs = Portal.dateUtil.resolveStart({
    reference: data.eventStartUTC, date: data.eventStartDate, time: data.sessionStartTime, timeZone: tz
  });
  var hasStart = !isNaN(startTs);
  var roomOpenTs = hasStart ? startTs - 30 * 60000 : NaN;
  var endTs = Portal.dateUtil.resolveStart({ reference: data.eventEnd && data.eventEnd.reference, date: data.eventEnd && data.eventEnd.date, time: data.eventEnd && data.eventEnd.time, timeZone: tz });
  var gradTs = data.graduation ? Portal.dateUtil.resolveStart({
    reference: data.graduation.reference, date: data.graduation.date, time: data.graduation.time, timeZone: tz
  }) : NaN;

  var currentIdx = Portal.session.resolveCurrent(data, Date.now()); // number | 'Final' | 0
  var ORDINALS = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve'];
  function dayLabel(n){ return 'Day ' + (ORDINALS[n] || n); }
  var sessionLabel = currentIdx === 'Final' ? 'Graduation' : currentIdx > 0 ? dayLabel(currentIdx) : '';

  /* The CTA is one mechanism across all three phases rather than three parallel
     ones — renderJoinCta() below already keeps the nav pill and the hero button
     in lockstep off a single boolean, and that property is worth more than the
     brevity of a separate graduation button.

     pregrad     Invite your guests -> inviteHubUrl, the SAME destination the
                 invite section further down this page uses. Always available:
                 there is nothing to gate, and no room to be admitted to.
     graduation  Join The Graduation -> registrations.f2799 "Grad Zoom Join URL",
                 the per-registrant graduation link. NOT data.zoomJoin (f2795),
                 which is the Forum room and was what this button pointed at on
                 graduation day until 2026-08-17, and NOT events.f3038, which is
                 a bare meeting ID the attendance poller uses server-side. */
  var gradRoomOpenTs = !isNaN(gradTs) ? gradTs - 30 * 60000 : NaN;
  function joinHref(){
    if(isPreGrad) return inviteHubUrl ? escapeHtml(inviteHubUrl) : '';
    if(isGraduation) return data.gradZoomJoin ? escapeHtml(data.gradZoomJoin) : '';
    return data.zoomJoin ? escapeHtml(data.zoomJoin) : '';
  }
  function joinLabel(){
    if(isPreGrad) return 'Invite your guests';
    if(isGraduation) return 'Join The Graduation';
    return 'Join Your ' + courseType;
  }

  // Real join link becomes available 30 minutes before session start
  // (roomOpenTs, below) rather than purely on data.zoomJoin being set —
  // per direct instruction 2026-08-09. Nav (.nav-join, compact) and hero
  // (.btn-join, larger) both render off this ONE shared boolean rather
  // than independently duplicating the same check, so they can never
  // disagree — each keeps its own existing markup/CSS class, only the
  // underlying availability decision is unified. renderJoinCta() runs
  // once immediately and then on a timer, so the button flips live for
  // anyone already on the page when the 30-minute mark passes — no
  // reload required.
  //
  // 2026-08-14, per direct instruction: a missing Information Form
  // (registrations.f2579) is now a hard gate on that same boolean. Nobody
  // without it on file can be admitted to the room, so the link is
  // withheld rather than handed out for a door they'd be turned away at.
  // Two things follow from putting it HERE rather than in the markup
  // branches: nav and hero stay in lockstep for free, and the 30-second
  // re-check can't quietly resurrect the button on the time condition
  // alone. The withheld state is never unexplained — blockedLabel() names
  // which of the two conditions is holding it, and infoGateHtml (below)
  // carries the full message and the link to fix it.
  //
  // 2026-08-17: the same boolean now answers for all three phases. Pre-grad is
  // deliberately ungated — inviting guests has no Information Form prerequisite
  // and no room-open time — while Graduation keeps BOTH gates, measured off
  // graduation start rather than Forum start.
  function linkAvailable(){
    if(isPreGrad) return !!inviteHubUrl;
    if(isGraduation) return !!(infoFormDone && data.gradZoomJoin && !isNaN(gradTs) && Date.now() >= gradRoomOpenTs);
    return !!(infoFormDone && data.zoomJoin && hasStart && Date.now() >= roomOpenTs);
  }
  function blockedLabel(){
    if(isPreGrad) return 'Invitations open soon';
    return infoFormDone ? 'Link available soon' : 'Information form required';
  }
  var LOCK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><rect x="4.2" y="10.4" width="15.6" height="9.9" rx="2.2"/><path d="M8.1 10.4V7.6a3.9 3.9 0 0 1 7.8 0v2.8"/></svg>';
  /* The lock glyph means specifically "the Information Form is what's holding
     this", so it is suppressed in pre-grad: that CTA has no info-form gate at
     all, and showing a padlock next to "Invitations open soon" would name the
     wrong reason. */
  function lockGlyph(){ return (!isPreGrad && !infoFormDone) ? LOCK_SVG : ''; }
  function navJoinHtml(avail){
    return avail ?
      '<a class="nav-join" href="' + joinHref() + '" target="_blank" rel="noopener"><span class="dot"></span><span class="jt">' + joinLabel() + '</span></a>' :
      '<span class="nav-join" aria-disabled="true">' + lockGlyph() + '<span class="jt">' + blockedLabel() + '</span></span>';
  }
  function heroJoinHtml(avail){
    return avail ?
      '<a class="btn-join" href="' + joinHref() + '" target="_blank" rel="noopener">' + joinLabel() + ' <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></a>' :
      '<span class="btn-join" aria-disabled="true">' + lockGlyph() + blockedLabel() + '</span>';
  }
  function renderJoinCta(){
    var avail = linkAvailable();
    var navCtaSlot = document.getElementById('navCtaSlot');
    if(navCtaSlot) navCtaSlot.innerHTML = navJoinHtml(avail);
    var heroJoinCta = document.getElementById('heroJoinCta');
    if(heroJoinCta) heroJoinCta.innerHTML = heroJoinHtml(avail);
  }

  // ---- nav ----
  var navLinks = document.getElementById('navLinks');
  if(navLinks) navLinks.innerHTML =
    '<a href="#today">Today</a><a href="#programs">Programs</a><a href="#graduation">Graduation</a><a href="#contact">Contact</a>';

  // ---- hero ----
  // No forced <br> between the greeting and the session label (removed
  // 2026-08-14 per direct instruction) — a hardcoded break put "welcome
  // to" on its own line and orphaned "to" once the name pushed the first
  // line long enough to wrap on its own. The h1 now wraps naturally at
  // whatever width it gets, which is the only thing that holds up across
  // "Cameron, welcome to Day One." and "Welcome to your Forum."
  var heroName = firstName ? escapeHtml(firstName) + ', welcome to' : 'Welcome to';
  var heroTarget = sessionLabel ? sessionLabel + '.' : 'your ' + courseType + '.';
  var nameSuffix = firstName ? ', ' + escapeHtml(firstName) : '';

  /* Countdown markup is the pre-event element verbatim (render.pre, above) —
     same .countdown/.cd-cell/.cd-num/.cd-lab classes and the same cd-d/h/m/s
     ids, so it inherits the existing CSS with no new rules beyond spacing
     inside .progcard. Those ids are document-unique, which is safe here only
     because During has never rendered a countdown and only ONE of the two new
     phases can be live at a time. */
  var GRAD_COUNTDOWN_HTML =
    '<div class="countdown">' +
      '<div class="cd-cell"><div class="cd-num" id="cd-d">–</div><div class="cd-lab">Days</div></div>' +
      '<div class="cd-cell"><div class="cd-num" id="cd-h">–</div><div class="cd-lab">Hours</div></div>' +
      '<div class="cd-cell"><div class="cd-num" id="cd-m">–</div><div class="cd-lab">Min</div></div>' +
      '<div class="cd-cell"><div class="cd-num" id="cd-s">–</div><div class="cd-lab">Sec</div></div>' +
    '</div>';

  var heroEyebrow, heroH1, heroLede, pcEyebrow, pcNote;
  if(isPreGrad){
    heroEyebrow = 'The Landmark ' + courseType + ' &middot; Completed';
    heroH1 = 'You completed <span class="serif-it">your</span> ' + courseType + nameSuffix + '.';
    heroLede = 'You stayed on the court all three days, and what you created this weekend is yours. Tomorrow evening we come back together to complete your ' + courseType + ' — and that night is meant to be shared. Invite the people who matter most to you.';
    pcEyebrow = 'Your Graduation';
    pcNote = 'Guest invitations close 90 minutes before we begin, so we can prepare the room for everyone’s guests.';
  } else if(isGraduation){
    heroEyebrow = 'The Landmark ' + courseType + ' &middot; Graduation';
    heroH1 = (firstName ? escapeHtml(firstName) + ', tonight ' : 'Tonight ') + '<span class="serif-it">we celebrate.</span>';
    heroLede = 'This is the completion of your ' + courseType + ' — an evening of inspiration, possibility and acknowledgment, with the people you invited beside you. Log in 20 minutes early so you are settled and there to welcome your guests when they arrive.';
    pcEyebrow = 'Your Graduation';
    pcNote = 'Ask your guests to arrive 15 minutes early, and make sure they know how to switch to speaker view, raise a hand and open the chat — so nobody is wrestling with Zoom during the evening.';
  }

  var heroHtml = (isPreGrad || isGraduation) ?
    '<header class="hero" id="today"><div class="wrap hero-inner">' +
      '<div class="hero-copy">' +
        '<div class="eyebrow">' + heroEyebrow + '</div>' +
        '<h1>' + heroH1 + '</h1>' +
        '<p class="lede">' + heroLede + '</p>' +
      '</div>' +
      '<aside class="progcard">' +
        '<div class="pc-eyebrow">' + pcEyebrow + '</div>' +
        (!isNaN(gradTs) ?
          '<div class="pc-dates">' + Portal.format.weekdayMonthDay(gradTs, ianaId) + '</div>' +
          '<div class="pc-grad"><span>Begins</span> &middot; ' + Portal.format.time(gradTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + '</div>' +
          GRAD_COUNTDOWN_HTML
          : '<div class="pc-fine">Your Graduation time will appear here as soon as it’s confirmed.</div>') +
        '<div class="pc-cta">' +
          '<img class="pc-logo" src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-lmf-logo.png" alt="The Landmark ' + courseType + '">' +
          '<span id="heroJoinCta">' + heroJoinHtml(linkAvailable()) + '</span>' +
        '</div>' +
        '<div class="pc-note">' + pcNote + '</div>' +
      '</aside>' +
    '</div></header>'
    :
    '<header class="hero" id="today"><div class="wrap hero-inner">' +
      '<div class="hero-copy">' +
        '<div class="eyebrow">The Landmark ' + courseType + '</div>' +
        '<h1>' + heroName + ' <span class="serif-it">' + heroTarget + '</span></h1>' +
        '<p class="lede">You’ve set this time aside for your life. Everything you need for the weekend lives on this page — your link to join, assignments, and what’s ahead. Bring your real life with you — that’s what this time is for.</p>' +
      '</div>' +
      '<aside class="progcard">' +
        '<div class="pc-eyebrow">Your ' + courseType + '</div>' +
        (hasStart ? '<div class="pc-dates">' + Portal.format.dateRange(startTs, isNaN(endTs) ? startTs : endTs, ianaId) + '</div>' : '') +
        (!isNaN(gradTs) ? '<div class="pc-grad"><span>Graduation</span> &middot; ' + Portal.format.weekdayShort(gradTs, ianaId) + ' ' + Portal.format.dayPeriodLabel(gradTs, ianaId) + ', ' + Portal.format.weekdayMonthDay(gradTs, ianaId).split(', ')[1] + '</div>' : '') +
        '<div class="pc-fine">' + format + ' &middot; Full-day experience &middot; Starts ' + (hasStart ? Portal.format.time(startTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) : 'time TBD') + '</div>' +
        '<div class="pc-cta">' +
          '<img class="pc-logo" src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-lmf-logo.png" alt="The Landmark ' + courseType + '">' +
          '<span id="heroJoinCta">' + heroJoinHtml(linkAvailable()) + '</span>' +
        '</div>' +
        (hasStart ? '<div class="pc-note">Please arrive at least 15 minutes before the ' + Portal.format.time(startTs, ianaId) + ' start time. The room opens at <b>' + Portal.format.time(roomOpenTs, ianaId) + '</b> each morning, in the time zone of your ' + courseType + ' — we’ll see you there.</div>' : '') +
      '</aside>' +
    '</div></header>';

  // ---- action CTAs — "Invite Friends & Family" always renders (real
  // destination: the Graduation section below); Seminar/AC/Gift cards
  // are announcement-gated (2026-08-12) — each only renders once the CS
  // has toggled its Course Materials > Announcements switch on
  // (events.f3104/f3105/f3167 via the registrations mirrors in
  // PORTAL_DATA.announcements). Plain show/hide, no strikethrough or
  // disabled state for the hidden ones — they're just not in the DOM.
  // Every card's CTA now has a real destination (2026-08-15). They arrived
  // from the source mockup as inert hrefless spans; Seminar and AC were the
  // last two, wired below. Nothing here is vestigial any more. ----

  // Advanced Course announcement destination, 2026-08-15 per direct
  // instruction. A literal rather than a PORTAL_DATA merge field, same as the
  // Gift card's transformationfoundation.org link below; contrast the Seminar
  // card, which IS per-registration (post.seminarUrl / page_119_url).
  //
  // ?e= is the sales page's own countdown deadline, in MILLISECONDS.
  // 1787554800000 -> Mon 2026-08-24 07:00 UTC (midnight Pacific), i.e. the
  // $300 offer expiry this cohort's card is promising.
  //
  // HARDCODED, AND IT EXPIRES. Ontraport already has the moving version:
  // events.f3259 / registrations.f3254 "Advanced Course Sales Page URL",
  // rewritten per discount phase by the n8n workflow "Cohort Sales Page URLs
  // - AC + LF Guest" (bare URL -> ?e=<Friday> -> ?e=<Saturday>&offer=extended).
  // Both are empty account-wide as of 2026-08-15, which is why this is a
  // literal. Once that automation runs, switch to the merge field and keep
  // this only as the fallback — otherwise every later cohort inherits this
  // cohort's expired deadline.
  var AC_ANNOUNCEMENT_URL = 'https://forum.landmarkworldwide.com/advanced-course/?e=1787554800000';

  var inviteCardHtml =
    '<div class="acard"><div class="aph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-during-acard-invite.jpg" alt=""></div><div class="abody"><div class="aeye">Graduation</div><h4>Invite Friends &amp; Family</h4><p>Tuesday evening is a celebration of what you’ve created. Invite the people who matter most to be there.</p><a href="#graduation" class="go">Invite guests &rarr;</a></div></div>';
  var seminarCardHtml = announcements.seminarOpen ?
    '<div class="acard"><div class="aph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-during-acard-seminar.jpg" alt=""><span class="abadge">Free</span></div><div class="abody"><div class="aeye">On Us</div><h4>Claim Your Complimentary Seminar</h4><p>Your next seminar is on us. Reserve your spot and keep exploring what’s possible.</p>' +
    (seminarUrl
      ? '<a class="go" href="' + escapeHtml(seminarUrl) + '" target="_blank" rel="noopener">Claim your seminar &rarr;</a>'
      : '<span class="go">Claim your seminar &rarr;</span>') +
    '</div></div>' : '';
  var acCardHtml = announcements.acOpen ?
    '<div class="acard"><div class="aph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-during-acard-ac.jpg" alt=""><span class="abadge">Save $300</span></div><div class="abody"><div class="aeye">Keep Going</div><h4>Advanced Course &mdash; Reserve Your Spot</h4><p>Continue your momentum into the Advanced Course. Register before Friday to save $300.</p><a class="go" href="' + AC_ANNOUNCEMENT_URL + '" target="_blank" rel="noopener">Reserve your spot &rarr;</a></div></div>' : '';
  var giftCardHtml = announcements.giftOpen ?
    '<div class="acard"><div class="aph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-during-acard-gift.jpg" alt=""></div><div class="abody"><div class="aeye serif-it" style="text-transform:none;letter-spacing:.02em;font-size:14px;">Give transformation.</div><h4 class="serif-it" style="color:var(--green);font-weight:300;font-size:20px;">Gift someone their ' + courseType + '.</h4><p>Many people are here this weekend because of the generosity of someone who came before them. If you feel moved, here’s an opportunity to make it possible for someone else.</p><a class="go serif-it" style="font-style:italic;font-weight:300;font-size:14px;" href="https://transformationfoundation.org/" target="_blank" rel="noopener">Contribute &rarr;</a></div></div>' : '';
  var actionsHtml =
    '<section class="block paper" id="programs"><div class="wrap">' +
      '<div class="sec-head"><div class="eyebrow">This Weekend</div><h2>Take your next steps</h2></div>' +
      '<div class="actions">' +
        inviteCardHtml + seminarCardHtml + acCardHtml + giftCardHtml +
      '</div>' +
    '</div></section>';

  // ---- your assignments — the inbox stack. One card per session
  // that has actually begun (index <= currentIdx, or every session
  // once currentIdx is 'Final'), newest on top per the mockup's own
  // stated intent, each showing its released items or the per-
  // section empty-state copy. Nothing hardcodes a day count or a
  // day1/day2/day3 shape — both come from data.materials.sessions.
  //
  // 2026-08-07 review round: every session now always renders (never
  // omitted), strictly chronologically (Day 1 -> Day 2 -> Day 3,
  // regardless of which is current — the old "newest on top" inbox
  // ordering is gone, per direct feedback). Sessions past currentIdx
  // render dimmed with a distinct "not yet begun" empty state, even
  // if they happen to have items with released:true (shouldn't occur,
  // but the future/dim state is driven by the session's index vs.
  // currentIdx, not by its own item data, so it can't happen). The
  // current session gets a .pill.pill-current "Today" badge, reusing
  // the exact component the program grid already uses for its own
  // "Current" pill, instead of a bespoke text prefix.
  function releasedLinksHtml(items){
    return (items || []).filter(function(it){ return it && it.released; }).map(function(it){
      return '<a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.name) +
        ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M7 17L17 7M9 7h8v8"/></svg></a>';
    }).join('');
  }
  var DOC_ICON = '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h4"/>';
  // 2026-08-10: dropped the card's own "Day N Assignments" <h3> — with
  // the session's day already shown in the .teye row above it, the
  // title was pure redundancy. The released item links now carry that
  // same bold/18px treatment directly (.alinks a), so the assignment's
  // own name is what reads as the card's heading instead of a generic
  // label, per direct feedback with an annotated screenshot.
  function sessionCardHtml(session, currentIdx){
    var isFinal = currentIdx === 'Final';
    var isCurrent = !isFinal && session.index === currentIdx;
    var isFuture = !isFinal && session.index > currentIdx;
    var links = isFuture ? '' : releasedLinksHtml(session.items);
    var body = isFuture ?
      '<div class="res-empty">This session’s materials will be released during the event.</div>' :
      (links ? '<div class="alinks">' + links + '</div>' : '<div class="res-empty">Course materials will be made available during the event.</div>');
    var cardClass = 'today' + (isCurrent ? ' current' : '') + (isFuture ? ' dim' : '');
    var pillHtml = isCurrent ? '<span class="pill pill-current">Today</span> &middot; ' : '';
    return '<div class="' + cardClass + '"><div class="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + DOC_ICON + '</svg></div>' +
      '<div class="tbody"><div class="teye">' + pillHtml + escapeHtml(session.label) + '</div>' +
      body + '</div></div>';
  }

  var sessionsToShow = sessions.slice().sort(function(a, b){ return a.index - b.index; });

  var assignmentsBodyHtml = sessionsToShow.length ?
    '<div class="today-row">' + sessionsToShow.map(function(s){ return sessionCardHtml(s, currentIdx); }).join('') + '</div>' :
    '<div class="today-empty">Your first day’s assignments will appear here once your Forum Leader releases them.</div>';

  var assignmentsHtml =
    '<section class="block alt"><div class="wrap">' +
      '<div class="sec-head"><div class="eyebrow">Today</div><h2>Your assignments</h2></div>' +
      assignmentsBodyHtml +
    '</div></section>';

  // ---- Forum Resources modal content — every session in ascending
  // order (never hidden, per the Data Contract's rendering rule),
  // each with its released items or the same empty-state copy;
  // Graduation always included as its own trailing section. ----
  function resGroupHtml(label, items){
    var links = releasedLinksHtml(items);
    return '<div class="res-group"><div class="rg-t">' + escapeHtml(label) + '</div>' +
      (links || '<div class="res-empty">Course materials will be made available during the event.</div>') + '</div>';
  }
  var resBody = document.getElementById('resBody');
  if(resBody) resBody.innerHTML =
    sessions.slice().sort(function(a, b){ return a.index - b.index; }).map(function(s){ return resGroupHtml(s.label, s.items); }).join('') +
    resGroupHtml('Graduation', graduationItems);

  // ---- graduation ----
  // Guest links are real, unique, per-registrant Zoom join URLs (an n8n/
  // Zoom integration generates one for every registration, guests
  // included) — long, so only the *displayed* text is truncated (through
  // the "?" plus a few characters); the copy button and any href always
  // use the full, untruncated URL. Paginated 5/page (2026-08-07 review
  // round) since a registration can have more invitations than that.
  /* 10 per page as of 2026-08-17, up from the 5 chosen in the 2026-08-07 round when
     this card sat far down the page. On the Graduation state it is the first thing
     under the hero, so most participants should see their whole list without paging.
     guestPage is re-declared on every render.during call, so it naturally starts at 0
     each time the page is rebuilt by a fetch or an Ably push. */
  var GUESTS_PER_PAGE = 10;
  var guestPage = 0;
  function guestPageCount(){ return Math.max(1, Math.ceil(guests.length / GUESTS_PER_PAGE)); }
  function truncateLinkDisplay(url){
    var qIdx = url.indexOf('?');
    if(qIdx === -1) return url;
    return url.slice(0, qIdx + 5) + '…';
  }
  function copyBtnHtml(link){
    return '<button class="inv-copy" type="button" data-link="' + escapeHtml(link) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="ct">Copy</span><span class="tip">Copy link</span></button>';
  }
  function guestRowsHtml(){
    var start = guestPage * GUESTS_PER_PAGE;
    return guests.slice(start, start + GUESTS_PER_PAGE).map(function(g){
      return '<div class="inv-row"><div class="inv-name">' + escapeHtml(g.name) + '</div><div class="inv-link">' + escapeHtml(truncateLinkDisplay(g.link)) + '</div>' + copyBtnHtml(g.link) + '</div>';
    }).join('');
  }
  /* Minimal pagination (2026-08-17, direct instruction): two chevrons and "n / m",
     nothing else. The previous "Prev / Page 1 of 3 / Next" bar was wider than the rows
     it paged. Still omitted entirely below one page, so a participant with ten or
     fewer guests never sees pagination at all. The button ids are unchanged, so the
     existing click handlers keep working untouched. */
  function guestPagerHtml(){
    if(guests.length <= GUESTS_PER_PAGE) return '';
    return '<div class="inv-pager">' +
      '<button class="inv-pager-btn" id="guestPrev" type="button" aria-label="Previous page"' + (guestPage === 0 ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<span class="inv-pager-count">' + (guestPage + 1) + ' / ' + guestPageCount() + '</span>' +
      '<button class="inv-pager-btn" id="guestNext" type="button" aria-label="Next page"' + (guestPage >= guestPageCount() - 1 ? ' disabled' : '') + '>&rsaquo;</button>' +
    '</div>';
  }
  // "Invite another guest" and the pager share one row (right-aligned
  // pager via justify-content:space-between) — 2026-08-07 review round,
  // was two stacked rows. Regenerated on every page change along with
  // the pager even though its own content is static; harmless.
  function guestFooterHtml(){
    return '<div class="inv-footer">' +
      '<a class="inv-more" href="' + escapeHtml(inviteHubUrl) + '" target="_blank" rel="noopener">Invite more guests <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
      guestPagerHtml() +
    '</div>';
  }
  function guestListWrapHtml(){
    return '<div class="inv-list">' + guestRowsHtml() + '</div>' + guestFooterHtml();
  }

  var inviteesInnerHtml =
    '<div class="inv-eye">Graduation Guests</div>' +
    '<h3>Your <span class="serif-it">Guest List.</span></h3>' +
    '<p class="inv-sub">Each guest has their own Zoom link for the evening &mdash; copy it and send it their way.</p>' +
    '<div id="guestListWrap">' + guestListWrapHtml() + '</div>';

  /* On the Graduation state the guest list is promoted out of the Graduation section
     and rendered as its own band directly under the hero (2026-08-17, direct
     instruction) — on the night itself, getting links to guests is the job, so it
     leads. It is rendered in ONE place or the other, never both: guestListSectionHtml
     below and inviteesHtml here are mutually exclusive on isGraduation. */
  var guestListSectionHtml = (isGraduation && guests.length) ?
    '<section class="block" id="guestlist"><div class="wrap"><div class="invitees">' +
      inviteesInnerHtml +
    '</div></div></section>' : '';

  // The whole invitees card is omitted (not an empty-state message) when
  // there are no guests — the .ginvite "Invite your guests" CTA in the
  // card above already covers that prompt, so a second message here
  // would be redundant (2026-08-07 review round).
  var inviteesHtml = (!isGraduation && guests.length) ?
    '<div class="gradrow"><div class="invitees">' +
      inviteesInnerHtml +
    '</div></div>' : '';

  /* The Graduation section copy is phase-aware as of 2026-08-17. It was written for the
     weekend, when Graduation was still days out ("Tuesday evening — an experience like no
     other", future tense throughout, and a date line naming a weekday). Left as-is it
     reads as an event still coming up while a participant is looking at the page on the
     night itself.

     during   unchanged — Graduation genuinely is days away
     pregrad  "Tomorrow evening", still forward-looking but immediate
     graduation "Tonight", present tense, and the date line leads with Tonight rather
              than the weekday, since naming the weekday to someone standing in it is
              exactly what made the old copy feel stale.

     The invite question also changes on the night: "Who would you love to have there?"
     is a planning prompt, and by graduation evening the useful prompt is that there is
     still time. Guest invitations close 90 minutes before the start. */
  var gradWhen = isGraduation ? 'Tonight' : (isPreGrad ? 'Tomorrow evening' : 'Tuesday evening');
  var gradHeadline = isGraduation
    ? 'Tonight &ndash; <span class="serif-it">an experience like no other.</span>'
    : gradWhen + ' &ndash; <span class="serif-it">an experience like no other.</span>';
  var gradLede = isGraduation
    ? 'For many participants, Graduation is the most memorable part of the ' + courseType + '. Tonight you come back together with the people you shared this time alongside — and with the family, friends and colleagues you invited — for an evening of celebration, acknowledgment and possibility.'
    : 'For many participants, Graduation is the most memorable part of the ' + courseType + '. You’ll come back together with the people you’ve shared this time alongside — and with the family, friends, and colleagues you choose to invite — for an evening of celebration, acknowledgment, and possibility.';
  var gradLede2 = isGraduation
    ? 'It’s your chance to celebrate what you created — and to share that moment with the people who matter most to you.'
    : 'It’s a chance to celebrate what you’ve created — and to share that moment with the people who matter most to you.';
  var gradInviteQ = isGraduation ? 'There’s still time to invite someone.' : 'Who would you love to have there?';
  var gradMetaHtml = !isNaN(gradTs)
    ? '<div class="gmeta">' + (isGraduation ? 'Tonight' : Portal.format.weekdayMonthDay(gradTs, ianaId)) + ' &middot; Starts ' + Portal.format.time(gradTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) + ' &middot; All guests are welcome</div>'
    : '';

  var graduationHtml =
    '<section class="block paper" id="graduation"><div class="wrap">' +
      '<div class="gradfeat">' +
        '<div class="gph"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-during-grad-photo.jpg" alt=""></div>' +
        '<div>' +
          '<div class="geye">The Graduation Evening</div>' +
          '<h3>' + gradHeadline + '</h3>' +
          gradMetaHtml +
          '<p>' + gradLede + '</p>' +
          '<p>' + gradLede2 + '</p>' +
          '<div class="ginvite"><div class="gq">' + gradInviteQ + '</div><a class="gbtn" href="' + escapeHtml(inviteHubUrl) + '" target="_blank" rel="noopener">Invite your guests <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></div>' +
        '</div>' +
      '</div>' +
      inviteesHtml +
    '</div></section>';

  // ---- agreements ----
  var RULES = [
    'Be present for the full day, start to finish',
    'Arrive on time for each session and stay through the close',
    'Give the room your full attention — set phones, devices, and other distractions aside',
    'Keep what others share confidential and treat everyone with respect',
    'Please don’t record, screen-capture, or share any part of the event'
  ];
  var rulesHtml =
    '<section class="block alt"><div class="wrap"><div class="rules" id="rules">' +
      '<div class="big">A few simple agreements that make the ' + courseType + ' work for everyone<span class="gp">.</span></div>' +
      '<ul>' + RULES.map(function(r){
        return '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5"/></svg> <span>' + r + '.</span></li>';
      }).join('') + '</ul>' +
    '</div></div></section>';

  // ---- FAQ — phone number corrected to the locked +1 (312)
  // 440-3464 (the mockup's transfer-course answer had a different,
  // stale number that disagreed with every other phone reference
  // in this file). ----
  var FAQS = [
    { q: 'How do I join each session?', a: 'Use the green <b>Join Your ' + courseType + '</b> button — it’s at the top of this page throughout the weekend. It opens your Zoom room directly.' },
    { q: 'When should I log in each day?', a: hasStart ? ('The room opens at ' + Portal.format.time(roomOpenTs, ianaId) + ' each morning, in the time zone of your ' + courseType + '. Plan to arrive at least 15 minutes before the ' + Portal.format.time(startTs, ianaId) + ' start so you’re settled when we begin.') : 'Plan to arrive at least 15 minutes before the start time each morning, in the time zone of your ' + courseType + '.' },
    { q: 'What if I get disconnected?', a: 'Just click Join Your ' + courseType + ' again to come right back in. If you have ongoing trouble, reach our team using the contact details below.' },
    { q: 'Where do I find each day’s assignment?', a: 'Right here on this page, in the “Your assignments” section. Each day’s assignment appears the morning it opens, with the newest at the top.' },
    { q: 'Can I invite guests to graduation?', a: 'Yes — Graduation is open to the family, friends, and colleagues you’d love to have there. Use the Graduation section above to invite them.' },
    { q: 'What if I need to transfer my course?', a: 'No problem — plans change. Contact us at info@landmarkworldwide.com or <a href="tel:+13124403464">+1 (312) 440-3464</a>, and for a small $35 administrative fee we’ll transfer you to another course date that works for you.' },
    { q: 'Who do I contact if I need help?', a: 'Our support team is here throughout. You’ll find our email and phone in the Contact section just below.' }
  ];
  var faqHtml =
    '<section class="block paper" id="faq"><div class="wrap"><div class="faq">' +
      '<div class="huge">Good to<br>know<span class="gp">.</span></div>' +
      '<div class="acc">' + FAQS.map(function(f){
        return '<details><summary>' + f.q + ' <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6"/></svg></summary><div class="body">' + f.a + '</div></details>';
      }).join('') + '</div>' +
    '</div></div></section>';

  var lmfBandHtml = '<div class="lmf-band"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-lmf-logo.png" alt="The Landmark ' + courseType + '"></div>';

  // ---- contact ----
  var contactHtml =
    '<section class="contact" id="contact"><div class="wrap">' +
      '<div class="contact-grid">' +
        '<div><div class="eyebrow" style="color:var(--green-bright);">We’re Here For You</div><h2 style="margin-top:12px;">Questions? <span class="serif-it">We’ve got you.</span></h2><p>Anything at all — during the ' + courseType + ' or between sessions — our team is happy to help.</p><div class="health"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--green-bright)" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.9z"/></svg> Looking for extra support? <a id="hrLink">Explore Health Resources &rarr;</a></div></div>' +
        '<div class="ways">' +
          '<a class="cway" href="mailto:tjarrett@landmarkworldwide.com"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg></div><div><div class="lab">Email</div><div class="val">info@landmarkworldwide.com</div></div></a>' +
          '<a class="cway" href="tel:+13124403464"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg></div><div><div class="lab">Phone</div><div class="val">+1 (312) 440-3464</div></div></a>' +
          '<button class="cway" id="fbLink" type="button"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.9L3 21l1.9-4.5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg></div><div><div class="lab">We want to hear from you</div><div class="val">How’s it going so far? &rarr;</div></div></button>' +
        '</div>' +
      '</div>' +
    '</div></section>';

  // Course Supervisor contact for the gate banner below —
  // events.f3089/f3090 via PORTAL_DATA.csName/csPhone. Both are
  // populated per event and BOTH CAN BE EMPTY (confirmed by reading the
  // records: event 218 has "Jennifer Tracy & Lois Pearson" /
  // "+1 (213) 302-4464", event 271 has neither), so each falls back
  // independently rather than as a pair — an event with a name but no
  // number still names the right person, and one with neither still
  // gives out a number that rings. The fallback is the build-wide
  // +1 (312) 440-3464 the Contact section and the FAQ's transfer answer
  // already use (locked rule: that number everywhere).
  //
  // csTel is the href form: f3090 is stored for display
  // ("+1 (213) 302-4464"), which is not dialable as a tel: URI, so
  // everything except digits and a leading + comes out. csName is free
  // text and routinely contains an ampersand (two supervisors share one
  // field), so it is escaped at the point of use like every other
  // participant-facing string here.
  var csName = data.csName || '';
  var csPhoneDisplay = data.csPhone || '+1 (312) 440-3464';
  var csTel = csPhoneDisplay.replace(/[^0-9+]/g, '');
  // f3090 is hand-entered per event, so the country code can't be
  // assumed present. Event 218 (the only event carrying one today) reads
  // "+1 (213) 302-4464", but a supervisor typing "(312) 555-0198" would
  // otherwise produce tel:3125550198 — dialable in the US, dead for the
  // online participants abroad this portal explicitly serves. Normalize
  // the two North American shapes to E.164; anything already starting
  // with + is left exactly as entered.
  if(csTel.charAt(0) !== '+'){
    if(csTel.length === 10) csTel = '+1' + csTel;
    else if(csTel.length === 11 && csTel.charAt(0) === '1') csTel = '+' + csTel;
  }
  var csWho = csName ? escapeHtml(csName) : 'your Course Supervisor';

  // ---- Information Form gate banner (2026-08-14, per direct
  // instruction) — the counterpart to the withheld join CTA above. Rides
  // at the very top of #portal-root, so it's directly under the sticky
  // nav and is the first thing on the page, and it's plain markup inside
  // the same innerHTML the rest of the page is built from: a re-render
  // driven by the live Ably push (render.during is re-callable by design)
  // clears the banner and restores the join button in one pass the
  // moment CS checks f2579, with no reload. Coral rather than the page's
  // green because this is the one state on the portal that stops someone
  // from getting in — it should not read as another green suggestion. ----
  var infoGateHtml = infoFormDone ? '' :
    '<div class="infogate" id="infoGate"><div class="wrap row">' +
      '<div class="ig-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.2" y="10.4" width="15.6" height="9.9" rx="2.2"/><path d="M8.1 10.4V7.6a3.9 3.9 0 0 1 7.8 0v2.8"/></svg></div>' +
      '<div class="ig-copy">' +
        '<div class="ig-t">Your access link is on hold.</div>' +
        '<div class="ig-s">We don’t have your Information Form yet, and we can’t let you into the ' + courseType + ' room without it. Complete it now and your join link appears right here — or call or text ' + csWho + ' and they can take it from you directly.</div>' +
      '</div>' +
      '<div class="ig-actions">' +
        '<a class="ig-btn" href="' + escapeHtml(Portal.render._sec.infoFormUrl(data)) + '" target="_blank" rel="noopener">Complete Your Information Form <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M9 6l6 6-6 6"/></svg></a>' +
        '<a class="ig-alt" href="tel:' + escapeHtml(csTel) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg> Call or text ' + escapeHtml(csPhoneDisplay) + '</a>' +
      '</div>' +
    '</div></div>';

  var root = document.getElementById('portal-root');
  /* Graduation day is a different page from the Forum weekend, not the same page with a
     different hero (2026-08-17, direct instruction). Three sections come out and one
     moves up:

       Assignments   the weekend's work is done; a to-do stack under a celebration hero
                     reads as homework nobody has to do any more
       Agreements    the room agreements governed the three days that already happened
       FAQ           written for the weekend — arrival times, breaks, what to bring

     and the guest list is promoted out of the Graduation section to sit directly under
     the hero, because on the night itself getting links to guests is the job.

     pregrad deliberately keeps all three: the Forum is over but Graduation has not
     started, and per direct instruction the assignments stay visible in that window. */
  if(root) root.innerHTML = isGraduation
    ? infoGateHtml + heroHtml + guestListSectionHtml + actionsHtml + graduationHtml + lmfBandHtml + contactHtml
    : infoGateHtml + heroHtml + actionsHtml + assignmentsHtml + graduationHtml + rulesHtml + faqHtml + lmfBandHtml + contactHtml;

  // Sets #navCtaSlot's initial content (heroJoinCta's own initial state
  // was already baked into heroHtml above) and starts the live 30-
  // second re-check so the join CTA flips from "Link available soon" to
  // the real link without a reload once the 30-minute mark passes.
  // Cleared/reset defensively in case render.during is ever invoked more
  // than once in a page's lifetime (shouldn't normally happen).
  renderJoinCta();
  if(Portal.render._joinCtaTimer) clearInterval(Portal.render._joinCtaTimer);
  Portal.render._joinCtaTimer = setInterval(renderJoinCta, 30000);

  /* Graduation countdown ticker — same 1-second cadence and the same clamped
     arithmetic as the pre-event one, because a countdown with no visible
     second-to-second movement reads as stuck.
     Unlike pre-event's, this one MUST be guarded: render.during is re-invoked
     by all three Ably handlers, so an unguarded setInterval would stack another
     ticker onto the same ids on every material/day/announcement push and the
     digits would visibly stutter. Same defensive pattern as _joinCtaTimer above.
     Always cleared first, including on plain 'during' renders, so switching
     phases mid-session never leaves an orphan ticker writing to ids that the
     new hero no longer contains. */
  if(Portal.render._gradCdTimer){ clearInterval(Portal.render._gradCdTimer); Portal.render._gradCdTimer = null; }
  if((isPreGrad || isGraduation) && !isNaN(gradTs)){
    var cdD = document.getElementById('cd-d'), cdH = document.getElementById('cd-h'),
        cdM = document.getElementById('cd-m'), cdS = document.getElementById('cd-s');
    if(cdD && cdH && cdM && cdS){
      var gradTick = function(){
        var d = gradTs - Date.now(); if(d < 0) d = 0;
        cdD.textContent = Math.floor(d / 86400000);
        cdH.textContent = Math.floor((d % 86400000) / 3600000);
        cdM.textContent = Math.floor((d % 3600000) / 60000);
        cdS.textContent = Math.floor((d % 60000) / 1000);
      };
      gradTick();
      Portal.render._gradCdTimer = setInterval(gradTick, 1000);
    }
  }

  // ---- Current Program / All Programs tabs + the shared grid ----
  var progTabs = document.getElementById('progTabs');
  if(progTabs){
    progTabs.style.display = '';
    progTabs.querySelector('.wrap').innerHTML =
      '<button class="active" data-tab="current">Current Program</button><button data-tab="all">All Programs</button>';
  }
  var gridRoot = document.getElementById('program-grid-root');
  function activateTab(name){
    var isAll = name === 'all';
    if(root) root.style.display = isAll ? 'none' : '';
    if(gridRoot) gridRoot.style.display = isAll ? '' : 'none';
    if(progTabs) progTabs.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', (b.getAttribute('data-tab') === 'all') === isAll); });
    window.scrollTo({ top: 0 });
  }
  if(progTabs) progTabs.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click', function(){ activateTab(b.getAttribute('data-tab')); });
  });
  if(gridRoot) gridRoot.style.display = 'none';

  // Seminar/AC cards, 2026-08-07 review round: previously hardcoded to
  // always show "reg"/"Upcoming" and "plain"/"Recommended Next" — now
  // driven by data.post.hasSeminarReg/hasACReg (registrations.f2303/
  // f2302), matching the described business rule: registered -> show
  // the specific one they're in; not registered but a designated
  // option exists (data.seminarNext/acNext, eventually resolved from
  // whichever event has events.f2760 "Next Course Recommended Display"
  // = Designated) -> recommend it; neither -> dim, same as every other
  // unregistered program. The actual Ontraport query behind
  // seminarNext/acNext stays out of scope — that's the not-yet-built
  // Portal Context Resolver's job, same boundary kept everywhere else
  // in this file. events.f2760 = "Secondary" gets no distinct
  // treatment for now; it collapses into the same dim fallback as
  // Hidden/unset — a deliberate scope call, not an oversight.
  var _saCards = Portal.render._sec.seminarAcCards(data);
  var seminarCard = _saCards.seminar;
  var acCard = _saCards.ac;

  Portal.programGrid.render(gridRoot, [
    { key: 'forum', state: 'reg', pill: { label: 'Current', variant: 'current' },
      detailRows: [
        { label: 'Dates', value: hasStart ? Portal.format.dateRange(startTs, isNaN(endTs) ? startTs : endTs, ianaId) : 'TBD' },
        { label: 'Graduation', value: !isNaN(gradTs) ? Portal.format.weekdayMonthDay(gradTs, ianaId) + ', ' + Portal.format.time(gradTs, ianaId) : 'TBD' },
        { label: 'Format', value: format + (hasStart ? ' · ' + Portal.format.time(startTs, ianaId) + ' ' + Portal.format.zoneLabel(ianaId) : '') }
      ],
      cta: { label: 'Continue', variant: 'solid' },
      onCta: function(){ Portal.modal.shut('pgModal', 'pgScrim'); activateTab('current'); } },
    seminarCard,
    acCard,
    { key: 'cap', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'cpc', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'tmlp', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'wisdom', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'partner', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } }
  ], { heading: 'All Programs.', lede: 'A map of where you are and what’s ahead — what you’re in the middle of, what’s included with your ' + courseType + ', and where the curriculum goes from here.' });

  // ---- wire behavior ----
  var hrLink = document.getElementById('hrLink');
  if(hrLink) hrLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('hrModal', 'hrScrim'); });
  var fbLink = document.getElementById('fbLink');
  if(fbLink) fbLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('fbModal', 'fbScrim'); });
  Portal.render._sec.reveal(document.getElementById('rules'), 'in', .35);

  // Re-callable (not one-shot): the guest list re-renders per page, so
  // copy buttons need to be re-wired every time, not just once against
  // the DOM nodes that happened to exist on page 1.
  function wireGuestCopyButtons(){
    document.querySelectorAll('#guestListWrap .inv-copy').forEach(function(b){
      b.addEventListener('click', function(){
        var t = b.getAttribute('data-link');
        function done(){
          var ct = b.querySelector('.ct'), tip = b.querySelector('.tip');
          b.classList.add('copied'); ct.textContent = 'Link copied'; tip.textContent = 'Link copied';
          setTimeout(function(){ b.classList.remove('copied'); ct.textContent = 'Copy'; tip.textContent = 'Copy link'; }, 1800);
        }
        if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done, done); }
        else{ var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} ta.remove(); done(); }
      });
    });
  }
  function wireGuestPager(){
    var prev = document.getElementById('guestPrev'), next = document.getElementById('guestNext');
    if(prev) prev.addEventListener('click', function(){ if(guestPage > 0){ guestPage--; renderGuestPage(); } });
    if(next) next.addEventListener('click', function(){ if(guestPage < guestPageCount() - 1){ guestPage++; renderGuestPage(); } });
  }
  function renderGuestPage(){
    var wrap = document.getElementById('guestListWrap');
    if(!wrap) return;
    wrap.innerHTML = guestListWrapHtml();
    wireGuestCopyButtons();
    wireGuestPager();
  }
  wireGuestCopyButtons();
  wireGuestPager();
};

/* =========================================================
   Portal.post.resolveHeroProgram(data, now) — Stage 5. Which
   upcoming registered program (if any) drives the Post-event
   hero. Corrected 2026-08-07 per direct confirmation: the
   plan's original "State A/B/C" framing oversold how distinct
   B and C are — they are the same dynamic template (the exact
   copy pattern Portal.render.pre already uses for its own
   hero), re-scoped to whichever registered program starts
   soonest. Registering for both Seminar and AC doesn't create
   a fourth state; it's still this one template, pointed at
   whichever of the two has the nearer *future* start date
   (already-started/past dates are excluded, same as a
   registration for a program with no resolvable date yet —
   both fall through to the "nothing upcoming" case, same as
   not being registered at all).
   ========================================================= */
Portal.post = (function(){
  function resolveHeroProgram(data, now){
    data = data || {};
    var post = data.post || {};
    var candidates = [];
    function tryAdd(key, next, registered){
      if(!registered || !next || next.startUTC == null) return;
      var ts = Portal.dateUtil.resolveStart({ reference: next.startUTC, timeZone: next.tz });
      if(!isNaN(ts) && ts > now) candidates.push({ key: key, next: next, startTs: ts });
    }
    tryAdd('ac', data.acNext, post.hasACReg);
    tryAdd('seminar', data.seminarNext, post.hasSeminarReg);
    if(!candidates.length) return null;
    candidates.sort(function(a, b){ return a.startTs - b.startTs; });
    return candidates[0];
  }
  return { resolveHeroProgram: resolveHeroProgram };
})();

/* =========================================================
   Portal.render.post — the Post-event page (Stage 5). Ported
   from member-portal-postevent-registered.html (hero when a
   next course is upcoming; Prepare/Guide/Agreements/Be-Present/
   FAQ reused verbatim from Portal.render._sec, confirmed
   byte-identical content to Pre-event's own) and
   member-portal-postevent-NOT-REGISTERED.html (hero + FAQ when
   nothing is upcoming). Defects fixed at the source: the
   registered mock's hero countdown target and "9:30/10:00 AM"
   FAQ answer were hardcoded literals (same class of bug as
   "Kate" everywhere else) — both now derive from
   Portal.dateUtil like every other phase.
   ========================================================= */
Portal.render.post = function(data){
  data = data || {};
  // Name Likes (contacts.f2792 — what they told us they want to be
  // called) wins over First Name for anything greeting-facing, falling
  // back to First Name when Name Likes is unset. Per direct instruction
  // 2026-08-07: this mirrors how the merge-field version would read —
  // [Name Likes] with a [Contacts//First Name] fallback — just resolved
  // here instead of in static Ontraport merge-tag copy, consistent with
  // every other participant-facing value in this file.
  var firstName = data.nameLikes || data.firstName || '';
  var lastName = data.lastName || '';
  var courseType = data.courseType || 'Forum'; // the just-completed course
  var format = data.format || 'Online';
  var infoFormDone = !!data.infoFormCompleted;
  var tz = data.tz || 'US Pacific · PST/PDT · GMT-8/-7 (America/Los_Angeles)';
  var ianaId = Portal.dateUtil.ianaOf(tz) || 'America/Los_Angeles';

  var startTs = Portal.dateUtil.resolveStart({
    reference: data.eventStartUTC, date: data.eventStartDate, time: data.sessionStartTime, timeZone: tz
  });
  var endTs = Portal.dateUtil.resolveStart({ reference: data.eventEnd && data.eventEnd.reference, date: data.eventEnd && data.eventEnd.date, time: data.eventEnd && data.eventEnd.time, timeZone: tz }) ||
    (isNaN(startTs) ? NaN : startTs + 2 * 86400000);
  var gradTs = data.graduation ? Portal.dateUtil.resolveStart({
    reference: data.graduation.reference, date: data.graduation.date, time: data.graduation.time, timeZone: tz
  }) : NaN;

  // ---- nav links (no Prepare/Guidance/FAQ anchors unless the hero
  // actually renders those sections — wired again below when it does) ----
  var navLinks = document.getElementById('navLinks');
  if(navLinks) navLinks.innerHTML = '<a href="https://www.landmarkworldwide.com/schedules" target="_blank" rel="noopener">Explore Courses</a>';

  var now = Date.now();
  var winner = Portal.post.resolveHeroProgram(data, now);

  var heroHtml, midSectionsHtml = '', hasNextStart = !!winner, tabFirstLabel;

  if(winner){
    tabFirstLabel = 'Upcoming Program';
    var pdataNext = Portal.pdata[winner.key];
    var nextCourseType = winner.next.title || pdataNext.title;
    var nextTz = winner.next.tz || tz;
    var nextIana = Portal.dateUtil.ianaOf(nextTz) || ianaId;
    var nextEndTs = winner.next.endUTC != null ? Portal.dateUtil.resolveStart({ reference: winner.next.endUTC, timeZone: nextTz }) : NaN;
    var nextGradTs = winner.next.gradUTC != null ? Portal.dateUtil.resolveStart({ reference: winner.next.gradUTC, timeZone: nextTz }) : NaN;
    var nextFormat = winner.next.format || 'Online';
    var nextStartTs = winner.startTs;
    var roomOpenTs = nextStartTs - 30 * 60000;

    heroHtml =
      '<header class="hero"><div class="wrap hero-inner">' +
        '<div class="hero-copy">' +
          '<div class="eyebrow">The ' + nextCourseType + '</div>' +
          '<h1>Welcome to <span class="serif-it">your</span> ' + nextCourseType + (firstName ? ', ' + firstName : '') + '.</h1>' +
          '<p class="lede">You’re registered and ready to go. Everything you need to prepare, join the ' + nextCourseType + ', and make the most of your experience lives right here — before and throughout the weekend.</p>' +
        '</div>' +
        '<aside class="anchor">' +
          '<div class="k">Your ' + nextCourseType + '</div>' +
          '<div class="dates">' + Portal.format.dateRange(nextStartTs, isNaN(nextEndTs) ? nextStartTs : nextEndTs, nextIana) + '</div>' +
          (!isNaN(nextGradTs) ? '<div class="grad"><span>Final Session</span> &middot; ' + Portal.format.weekdayShort(nextGradTs, nextIana) + ' ' + Portal.format.dayPeriodLabel(nextGradTs, nextIana) + ', ' + Portal.format.weekdayMonthDay(nextGradTs, nextIana).split(', ')[1] + '</div>' : '') +
          '<div class="fine">' + nextFormat + ' &middot; ' + (winner.next.formatLabel || 'Details available soon') + '</div>' +
          '<div class="cd-cap">Until we begin</div>' +
          '<div class="countdown"><div class="cd-cell"><div class="cd-num" id="cd-d">–</div><div class="cd-lab">Days</div></div><div class="cd-cell"><div class="cd-num" id="cd-h">–</div><div class="cd-lab">Hours</div></div><div class="cd-cell"><div class="cd-num" id="cd-m">–</div><div class="cd-lab">Min</div></div><div class="cd-cell"><div class="cd-num" id="cd-s">–</div><div class="cd-lab">Sec</div></div></div>' +
          '<p class="note">Please arrive at least 15 minutes before the ' + Portal.format.time(nextStartTs, nextIana) + ' start time. The room opens at <b>' + Portal.format.time(roomOpenTs, nextIana) + '</b> — we’ll see you there.</p>' +
          '<button class="pbtn pbtn-lg" id="heroAddCal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg> Add to Calendar</button>' +
        '</aside>' +
      '</div></header>';

    midSectionsHtml = Portal.render._sec.prepare(nextCourseType, infoFormDone, data) +
      Portal.render._sec.guide(nextCourseType) +
      Portal.render._sec.rules(nextCourseType) +
      Portal.render._sec.bepresent() +
      Portal.render._sec.faq(nextCourseType, true, roomOpenTs, nextStartTs, nextIana);
  } else {
    tabFirstLabel = 'Up Next';
    var recKey = (data.post && data.post.recommendedNext === 'seminar') ? 'seminar' : 'ac';
    var recPdata = Portal.pdata[recKey];
    var recNext = recKey === 'seminar' ? data.seminarNext : data.acNext;

    heroHtml =
      '<header class="hero"><div class="wrap hero-inner">' +
        '<div class="hero-copy">' +
          '<div class="eyebrow">Landmark ' + courseType + ' Graduate</div>' +
          '<h1>Up next for you' + (firstName ? ', <span class="serif-it">' + firstName + '.</span>' : '.') + '</h1>' +
          '<p class="lede">Congratulations on completing The Landmark ' + courseType + '. There’s nothing you need to do — your certificate and programs live right here. And when you’re ready for what’s next, this is the natural next step.</p>' +
        '</div>' +
        '<aside class="pcard" data-p="' + recKey + '" id="heroNext" style="cursor:pointer;">' +
          '<div class="pav"><span class="pill pill-next">Recommended Next</span><img src="' + recPdata.photo + '" alt="' + recPdata.title + '"></div>' +
          '<div class="pbody">' +
            '<h3>' + recPdata.title + '</h3>' +
            '<p>' + recPdata.blurb + '</p>' +
            (recNext && (recNext.beginsLabel || recNext.scheduleLabel) ?
              '<div class="pdet">' +
                (recNext.beginsLabel ? '<div><span>Begins</span>' + recNext.beginsLabel + '</div>' : '') +
                (recNext.scheduleLabel ? '<div><span>Schedule</span>' + recNext.scheduleLabel + '</div>' : '') +
              '</div>' :
              '<div class="pdet"><div><span>Offered</span>Year-round &middot; online</div></div>') +
            '<button class="pbtn2" type="button">View ' + recPdata.title + ' Dates</button>' +
          '</div>' +
        '</aside>' +
      '</div></header>';

    // Recommended-program FAQ — genuinely different content from the
    // registered-course FAQ above (this one explains the program being
    // recommended, not how to join a course you're already in), so it's
    // authored here rather than forced into Portal.render._sec.faq.
    var RECOMMEND_FAQS = [
      ['What is the ' + recPdata.title + '?', recPdata.detail.desc.replace(/<\/p><p>/g, ' ').replace(/<\/?p>/g, '')],
      ['When should I take it?', 'Whenever you’re ready. Many graduates find the momentum from their ' + courseType + ' is a powerful thing to build on and register within a few months — but it’s offered year-round, online.'],
      ['Where do I find my certificate and materials?', 'On the All Programs tab above — The Landmark ' + courseType + ' now shows as completed, with your certificate available to download any time.'],
      ['How do I register?', 'Click View ' + recPdata.title + ' Dates above to see upcoming dates and reserve your spot. If you’d like help choosing a date, our team is glad to talk it through with you. See our contact information below.'],
      ['What if I need to transfer my course?', 'No problem — plans change. Contact us at info@landmarkworldwide.com or +1 (312) 440-3464, and for a small $35 administrative fee we’ll transfer you to another course date that works for you.'],
      ['Who do I contact if I have questions?', 'Our support team is here for you. You’ll find our email and phone in the Contact section just below.']
    ];
    midSectionsHtml =
      '<section class="block paper" id="faq"><div class="wrap">' +
        '<div class="faq"><div class="huge">Good to<br>know<span>.</span></div><div class="acc">' +
          RECOMMEND_FAQS.map(function(qa, i){
            return '<details' + (i === 0 ? ' open' : '') + '><summary>' + qa[0] + ' <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6-6 6"/></svg></summary><div class="body">' + qa[1] + '</div></details>';
          }).join('') +
        '</div></div>' +
      '</div></section>';
  }

  var lmfBandHtml = '<div class="lmf-band"><img src="https://cdn.jsdelivr.net/gh/co-labs-builds/landmark-new-era@main/Assets/lm-mp-lmf-logo.png" alt="The Landmark Forum"></div>';

  var contactHtml =
    '<section class="contact" id="contact"><div class="wrap">' +
      '<div class="contact-grid">' +
        '<div><div class="eyebrow" style="color:var(--green-bright);">We’re Here For You</div><h2 style="margin-top:12px;">Questions? <span class="serif-it">We’ve got you.</span></h2><p>Anything at all — our team is happy to help.</p><div class="health"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--green-bright)" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.9z"/></svg> Looking for extra support? <a id="hrLink">Explore Health Resources &rarr;</a></div></div>' +
        '<div class="ways">' +
          '<a class="cway" href="mailto:tjarrett@landmarkworldwide.com"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg></div><div><div class="lab">Email</div><div class="val">info@landmarkworldwide.com</div></div></a>' +
          '<a class="cway" href="tel:+13124403464"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg></div><div><div class="lab">Phone</div><div class="val">+1 (312) 440-3464</div></div></a>' +
          '<button class="cway" id="fbLink" type="button"><div class="gi"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.9L3 21l1.9-4.5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg></div><div><div class="lab">We want to hear from you</div><div class="val">How’s it going so far? &rarr;</div></div></button>' +
        '</div>' +
      '</div>' +
    '</div></section>';

  var curricHtml =
    '<section class="curric"><div class="wrap">' +
      '<h2>There’s a whole curriculum <span class="serif-it">beyond this weekend.</span></h2>' +
      '<a class="cbtn" href="https://www.landmarkworldwide.com/programs" target="_blank" rel="noopener">Explore the Full Landmark Curriculum <svg viewBox="0 0 36 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:10px;flex:none;"><path d="M0 7h30M24 1l8 6-8 6"/></svg></a>' +
    '</div></section>';

  var root = document.getElementById('portal-root');
  if(root) root.innerHTML = heroHtml + midSectionsHtml + lmfBandHtml + curricHtml + contactHtml;

  // ---- Upcoming/Up-Next tab + All Programs tab, shared grid ----
  var progTabs = document.getElementById('progTabs');
  if(progTabs){
    progTabs.style.display = '';
    progTabs.querySelector('.wrap').innerHTML =
      '<button class="active" data-tab="current">' + tabFirstLabel + '</button><button data-tab="all">All Programs</button>';
  }
  var gridRoot = document.getElementById('program-grid-root');
  function activateTab(name){
    var isAll = name === 'all';
    if(root) root.style.display = isAll ? 'none' : '';
    if(gridRoot) gridRoot.style.display = isAll ? '' : 'none';
    if(progTabs) progTabs.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', (b.getAttribute('data-tab') === 'all') === isAll); });
    window.scrollTo({ top: 0 });
  }
  if(progTabs) progTabs.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click', function(){ activateTab(b.getAttribute('data-tab')); });
  });
  if(gridRoot) gridRoot.style.display = 'none';

  var _saCards = Portal.render._sec.seminarAcCards(data);
  var forumTitle = 'The Landmark ' + courseType;
  Portal.programGrid.render(gridRoot, [
    { key: 'forum', title: forumTitle, state: 'reg', pill: { label: 'Completed', variant: 'done' },
      detailRows: [
        { label: 'Completed', value: hasStartLabel(startTs, ianaId) },
        { label: 'Format', value: format }
      ],
      cta: { label: 'Download Certificate', variant: 'cert' } },
    _saCards.seminar,
    _saCards.ac,
    { key: 'cap', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'cpc', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'tmlp', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'wisdom', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } },
    { key: 'partner', state: 'dim', cta: { label: 'Learn More', variant: 'ghost' } }
  ], { heading: 'All Programs.', lede: 'A map of where you are and what’s ahead — what you’ve completed, and where the curriculum goes from here.' });

  function hasStartLabel(ts, iana){
    return isNaN(ts) ? 'TBD' : Portal.format.weekdayMonthDay(ts, iana);
  }

  // ---- certificate modal content ----
  var certName = document.getElementById('certName');
  var certProgram = document.getElementById('certProgram');
  var certDates = document.getElementById('certDates');
  if(certName) certName.textContent = (firstName + ' ' + lastName).trim();
  if(certProgram) certProgram.textContent = forumTitle;
  if(certDates) certDates.textContent = [
    !isNaN(startTs) ? Portal.format.dateRange(startTs, isNaN(endTs) ? startTs : endTs, ianaId) : '',
    !isNaN(gradTs) ? 'Graduation ' + Portal.format.weekdayMonthDay(gradTs, ianaId).split(', ')[1] : '',
    format
  ].filter(Boolean).join(' · ');

  // ---- wire behavior ----
  var hrLink = document.getElementById('hrLink');
  if(hrLink) hrLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('hrModal', 'hrScrim'); });
  var fbLink = document.getElementById('fbLink');
  if(fbLink) fbLink.addEventListener('click', function(e){ e.preventDefault(); Portal.modal.open('fbModal', 'fbScrim'); });

  if(winner){
    Portal.techCheck.init();
    document.querySelectorAll('.flip').forEach(function(f){
      f.addEventListener('click', function(){ f.classList.toggle('flipped'); });
    });
    Portal.render._sec.reveal(document.getElementById('bepresent'), 'in', .35);
    Portal.render._sec.reveal(document.getElementById('rules'), 'in', .35);
    var cdD = document.getElementById('cd-d'), cdH = document.getElementById('cd-h'), cdM = document.getElementById('cd-m'), cdS = document.getElementById('cd-s');
    var tick = function(){
      var d = winner.startTs - Date.now(); if(d < 0) d = 0;
      cdD.textContent = Math.floor(d / 86400000);
      cdH.textContent = Math.floor((d % 86400000) / 3600000);
      cdM.textContent = Math.floor((d % 3600000) / 60000);
      if(cdS) cdS.textContent = Math.floor((d % 60000) / 1000);
    };
    tick();
    window.setInterval(tick, 1000);

    var nextCourseTypeForCal = winner.next.title || Portal.pdata[winner.key].title;
    var calEvents = [{
      start: winner.startTs, end: !isNaN(nextEndTs) ? nextEndTs : winner.startTs + 3 * 3600000,
      summary: 'The Landmark ' + nextCourseTypeForCal, location: winner.next.format || 'Online',
      description: 'Join from your Landmark member portal.'
    }];
    if(!isNaN(nextGradTs)){
      calEvents.push({ start: nextGradTs, end: nextGradTs + 2 * 3600000, summary: 'The Landmark ' + nextCourseTypeForCal + ' — Final Session', location: winner.next.format || 'Online' });
    }
    var heroAddCal = document.getElementById('heroAddCal');
    if(heroAddCal) heroAddCal.addEventListener('click', function(){ Portal.calendar.download(nextCourseTypeForCal.toLowerCase().replace(/\s+/g, '-') + '.ics', calEvents); });
  } else {
    var heroNext = document.getElementById('heroNext');
    if(heroNext) heroNext.addEventListener('click', function(){
      Portal.programGrid.openDetail({
        key: (data.post && data.post.recommendedNext === 'seminar') ? 'seminar' : 'ac',
        pill: { label: 'Recommended Next' },
        detailRows: [],
        cta: { label: 'Explore Courses', variant: 'solid' },
        onCta: function(){ window.open('https://www.landmarkworldwide.com/schedules', '_blank', 'noopener'); }
      });
    });
  }
};

/* =========================================================
   Portal.phase.compute(data, now) — Stage 6. Which of the three
   renderers owns the page: Pre before the event's own start,
   During from start through Graduation (not through the raw
   3-day span alone — During's own Graduation section is a real
   part of the event, per Stage 4, so the During/Post boundary
   is the *later* of eventEnd and graduation when both are
   given, not the plain 3-day end. A participant mid-Graduation-
   evening should still see During, not a premature Post-event
   "you're done" page), Post from Graduation on.

   Reuses Portal.dateUtil.resolveStart the same way every
   renderer already does, so this is automatically timezone-
   correct for the same reason their own countdowns are — the
   underlying wall-clock-in-a-zone -> UTC-instant math doesn't
   change here, just what it's used to decide.

   No resolvable start at all -> 'pre' (the same graceful-
   unknown fallback every renderer already uses for a missing
   date, e.g. Pre-event's own "your start time will appear here
   as soon as it's confirmed").
   ========================================================= */
Portal.phase = (function(){
  function compute(data, now){
    data = data || {};
    now = now == null ? Date.now() : now;
    var tz = data.tz;
    var ianaId = Portal.dateUtil.ianaOf(tz) || 'America/Los_Angeles';

    var startTs = Portal.dateUtil.resolveStart({
      reference: data.eventStartUTC, date: data.eventStartDate, time: data.sessionStartTime, timeZone: tz
    });
    if(isNaN(startTs)) return 'pre';

    // Pre -> During at midnight of the event's own start date, in the
    // event's own timezone — not the exact scheduled start clock-time —
    // per direct instruction 2026-08-09, so a participant checking the
    // page in the early hours of event day already sees During-event
    // content instead of stale Pre-event framing.
    var duringBoundary = Portal.dateUtil.startOfDay(startTs, ianaId);
    if(now < duringBoundary) return 'pre';

    var endTs = Portal.dateUtil.resolveStart({ reference: data.eventEnd && data.eventEnd.reference, date: data.eventEnd && data.eventEnd.date, time: data.eventEnd && data.eventEnd.time, timeZone: tz });
    if(isNaN(endTs)) endTs = startTs + 2 * 86400000; // same 3-day fallback every renderer already uses
    var gradTs = data.graduation ? Portal.dateUtil.resolveStart({
      reference: data.graduation.reference, date: data.graduation.date, time: data.graduation.time, timeZone: tz
    }) : NaN;

    /* Post now begins at the START OF THE DAY AFTER Graduation, not at the
       graduation instant itself. The old boundary was Math.max(endTs, gradTs),
       which flipped the page to Post at 6:00 PM on graduation day — the exact
       moment Graduation begins — directly contradicting this function's own
       contract above ("A participant mid-Graduation-evening should still see
       During, not a premature Post-event 'you're done' page"). Corrected
       2026-08-17 alongside the two new phases below. */
    var postBoundary = !isNaN(gradTs)
      ? Math.max(endTs, Portal.dateUtil.startOfDay(gradTs + 86400000, ianaId))
      : endTs;

    if(now >= postBoundary) return 'post';

    /* Two phases carved out of the old single 'during' window (2026-08-17).
       Both are DATE-DERIVED rather than driven by an events.f3025 option: a new
       option id would be silently mis-read by four dashboard consumers —
       ROSTER_DAY_OPTION_ORDER (indexOf -> -1 -> 0, so every day tick renders
       pending instead of absent), DAY_MAP/SHORT_DAY_MAP, DASHBOARD_DAY_NUM_TO_RAW,
       and the portal's own /^Day (\d+)$/ label parser. None of those fail loudly.

       Guarded on a resolvable gradTs throughout, so an event with no graduation
       data behaves exactly as it did before: 'during' straight through to
       postBoundary, no new branch reachable. */
    if(!isNaN(gradTs)){
      // pregrad — Day 3 is over, Graduation day has not started.
      if(now >= endTs && now < Portal.dateUtil.startOfDay(gradTs, ianaId)) return 'pregrad';
      // graduation — the whole of Graduation day, including the evening itself.
      if(now >= Portal.dateUtil.startOfDay(gradTs, ianaId)) return 'graduation';
    }
    return 'during';
  }
  return { compute: compute };
})();

/* =========================================================
   Portal.invitations — Stage 6b (2026-08-17). Supplies the
   Graduation invitees card in Portal.render.during.

   That card has existed since Stage 4 and rendered correctly
   against demo data, but was switched off when PORTAL_DATA
   moved to real merge fields (commit 72c0e2f): a participant's
   invitations are CHILD records, and an Ontraport merge tag
   cannot loop a child collection. It is the only thing on the
   portal that genuinely cannot be served by the page's own
   server-side render, which is why this is the portal's first
   read fetch — everything else is still merge tags.

   Auth is PORTAL : Ably Token Auth's model, not a new one: the
   browser sends contactId + eventId, and the workflow treats
   the existence of a registration joining them as the
   authorization, resolving the registration id itself rather
   than trusting one from the client.

   Enhancement, not a requirement, exactly like Portal.realtime:
   any failure leaves the page as it loaded (card simply absent)
   and is never surfaced to the participant.
   ========================================================= */
Portal.invitations = (function(){
  var INVITATIONS_URL = 'https://landmarkworldwide.awesomate.io/webhook/portal-invitations';

  /* Re-renders through the phase so a fetch resolving during pre-grad or
     graduation does not drop the page back to the During hero — the same
     clamp the Ably handlers use. */
  function rerender(data){
    var p = Portal.phase.compute(data, Date.now());
    if(p !== 'pregrad' && p !== 'graduation') p = 'during';
    Portal.render.during(data, p);
  }

  function load(data){
    /* registrationId identifies WHOSE list this is; contactId only says who is
       looking. They diverge whenever staff preview a participant's portal — seen
       2026-08-17 with dcParam.contact_id 877 (event crew) on registration 942
       (Cameron Cushing). Scoping by the contact returned the wrong list or none, and
       the card silently never rendered. Same identity trap already documented for
       Ably token auth: the logged-in contact is not the page's subject.

       Prefer PORTAL_DATA.registrationId ([Page//ID], server-rendered by Ontraport),
       falling back to dcParam.object_id, which carries the same value. */
    if(!data || !data.eventId) return;
    var contactId = (window.dcParam && window.dcParam.contact_id) || '';
    var registrationId = data.registrationId || (window.dcParam && window.dcParam.object_id) || '';
    if(!contactId || !registrationId){
      /* Not silent, unlike Portal.realtime. That module degrades quietly because
         live push is an invisible enhancement; this card is something a participant
         is looking for, so a missing prerequisite must leave a trace rather than an
         unexplained empty page. */
      if(window.console && console.warn) console.warn('Portal.invitations: skipped — contactId=' + contactId + ' registrationId=' + registrationId);
      return;
    }
    var url = INVITATIONS_URL + '?contactId=' + encodeURIComponent(String(contactId)) +
      '&eventId=' + encodeURIComponent(String(data.eventId)) +
      '&registrationId=' + encodeURIComponent(String(registrationId));
    fetch(url, { method: 'GET' }).then(function(res){
      if(!res.ok){
        if(window.console && console.warn) console.warn('Portal.invitations: HTTP ' + res.status);
        return null;
      }
      return res.json();
    }).then(function(result){
      if(!result || result.success !== true) return;
      if(!result.guests || !result.guests.length){
        /* An empty list is the normal case for a participant who invited nobody, and
           the card is deliberately omitted rather than shown empty — the "Invite your
           guests" CTA already carries that prompt. Logged so an empty card is
           distinguishable from a broken one. */
        if(window.console && console.info) console.info('Portal.invitations: 0 guests for registration ' + registrationId);
        return;
      }
      data.graduationGuests = result.guests;
      rerender(data);
    }).catch(function(err){
      if(window.console && console.warn) console.warn('Portal.invitations: fetch failed', err);
    });
  }

  return { load: load };
})();

/* =========================================================
   Portal.realtime — During-event live updates via Ably (added
   2026-08-10, per the "Real-time design (Ably)" section of
   ok-great-so-the-parallel-pizza.md). One Ably channel per Event
   (`event:{eventId}`), two message types (material.changed,
   day.advanced). Subscribe-only: the publish side is the write
   service (n8n, Track 2a's CS Dashboard work), not built here.

   Auth: the client never sees a publish-capable key. It requests
   a short-lived (1hr), channel-restricted, subscribe-only token
   from the "PORTAL : Ably Token Auth" n8n webhook, which verifies
   server-side that contactId actually has a real Ontraport
   Registration for eventId before minting anything — the same
   accepted-risk contactId source as Portal.account.wireSave()
   (window.dcParam.contact_id), but this endpoint does real
   per-request authorization, not just blind trust, since a leak
   here would expose a whole Event's live data, not just one
   person's own profile fields.

   Init happens exactly once, from Portal.init() — NOT from
   inside render.during() itself, since render.during() is what
   the message handlers below call on every update; connecting
   again on each of those calls would pile up duplicate Ably
   connections. Confirmed safe to call render.during() repeatedly
   on the render side: it fully replaces #portal-root's innerHTML
   each time, so old element listeners are discarded with their
   nodes rather than double-binding, the one timer that survives
   a re-render (the join-CTA interval) already guards itself via
   Portal.render._joinCtaTimer, and open modals live outside
   #portal-root (reparented to document.body on load), so a
   re-render can't close one out from under someone.

   Real-time is an enhancement, not a requirement — any failure
   here (SDK fails to load, token request fails, no eventId on
   the page) degrades silently to the page's normal load-time
   data with no live updates, never a broken page.
   ========================================================= */
Portal.realtime = (function(){
  var TOKEN_AUTH_URL = 'https://landmarkworldwide.awesomate.io/webhook/ably-token-auth';
  var SDK_URL = 'https://cdn.ably.com/lib/ably.min-2.js';

  function loadSdk(cb){
    if(window.Ably){ cb(); return; }
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = cb;
    s.onerror = function(){};
    document.head.appendChild(s);
  }

  // Materials don't have a stable numeric ID yet (Course Materials is
  // still a fixed set of per-day checkboxes, not its own object — see
  // the punchlist), so matching is by sessionIndex + name, the same
  // pair PORTAL_DATA.materials.sessions[] is already keyed by.
  function applyMaterialChanged(data, msg){
    data.materials = data.materials || { sessions: [], graduation: [] };
    var bucket = null;
    if(msg && msg.sessionIndex != null){
      bucket = (data.materials.sessions || []).filter(function(s){ return s.index === msg.sessionIndex; })[0];
    }
    var items = bucket ? bucket.items : (data.materials.graduation = data.materials.graduation || []);
    var existing = (items || []).filter(function(it){ return it.name === msg.name; })[0];
    if(existing){
      existing.url = msg.url != null ? msg.url : existing.url;
      existing.released = !!msg.visible;
    } else if(items){
      items.push({ name: msg.name, url: msg.url || '', released: !!msg.visible });
    }
  }

  function applyDayAdvanced(data, msg){
    data.currentReleasedSession = msg.day;
  }

  // announcement.changed — 2026-08-12, mirrors material.changed's shape.
  // PORTAL : Ably Publish sends msg.key as one of seminar-open/ac-open/
  // gift-open (lowercase-hyphenated, normalized server-side even though
  // the Ontraport automation's own field key for AC is capitalized
  // "AC-open" — see CS Dashboard build notes) — map straight to the
  // matching PORTAL_DATA.announcements boolean.
  var ANNOUNCEMENT_KEY_MAP = { 'seminar-open': 'seminarOpen', 'ac-open': 'acOpen', 'gift-open': 'giftOpen' };
  function applyAnnouncementChanged(data, msg){
    data.announcements = data.announcements || {};
    var prop = ANNOUNCEMENT_KEY_MAP[msg && msg.key];
    if(prop) data.announcements[prop] = !!(msg && msg.open);
  }

  function init(data){
    if(!data || !data.eventId) return;
    var contactId = (window.dcParam && window.dcParam.contact_id) || '';
    if(!contactId) return;
    loadSdk(function(){
      if(!window.Ably) return;
      var client = new Ably.Realtime({
        authUrl: TOKEN_AUTH_URL,
        authParams: { contactId: String(contactId), eventId: String(data.eventId) }
      });
      var channel = client.channels.get('event:' + data.eventId);
      /* Re-derive the phase on every push rather than hard-calling During.
         These three used to pass no phase at all, which defaulted to 'during'
         — so once pregrad/graduation existed (2026-08-17) any material, day or
         announcement push would have silently yanked a participant on the
         Graduation hero back to the Forum hero, mid-evening. Recomputing also
         means the page crosses a phase boundary correctly if a push happens to
         arrive after it. */
      var rerender = function(){
        var p = Portal.phase.compute(data, Date.now());
        // Clamped to the During family. If the clock has since crossed into
        // 'pre' or 'post', a live push is not the right moment to swap the
        // whole page out from under someone — keep the During-page behaviour
        // these handlers have always had and let the next load re-phase.
        if(p !== 'pregrad' && p !== 'graduation') p = 'during';
        Portal.render.during(data, p);
      };
      channel.subscribe('material.changed', function(msg){ applyMaterialChanged(data, msg.data); rerender(); });
      channel.subscribe('day.advanced', function(msg){ applyDayAdvanced(data, msg.data); rerender(); });
      channel.subscribe('announcement.changed', function(msg){ applyAnnouncementChanged(data, msg.data); rerender(); });
    });
  }

  return { init: init };
})();

/* =========================================================
   Portal.init() — Stage 6. Reads window.PORTAL_DATA, computes
   the phase, and dispatches to the one matching renderer. Modal
   close/scrim/Escape wiring is already handled unconditionally
   by member-portal.html's own inline script (it doesn't depend
   on phase or data), so this only owns what's actually phase-
   dependent: which render.* function runs, and the avatar (see
   Portal.account above — centralized here so Pre/Post get a
   real photo too, not just During).
   ========================================================= */
Portal.init = function(){
  var data = window.PORTAL_DATA || {};
  Portal.account.setAvatar(data.profileImageUrl);
  Portal.account.populateForm(data);
  Portal.account.wirePhotoUpload();
  Portal.account.wireSave();
  var phase = Portal.phase.compute(data, Date.now());
  if(phase === 'pre') Portal.render.pre(data);
  /* pregrad and graduation are variants of the During page, not separate
     renderers — assignments and materials stay visible and stay live, so they
     keep realtime too. The phase is passed through so render.during knows which
     hero and which CTA to build. */
  else if(phase === 'during' || phase === 'pregrad' || phase === 'graduation'){
    Portal.render.during(data, phase);
    Portal.realtime.init(data);
    Portal.invitations.load(data);
  }
  else Portal.render.post(data);
};
