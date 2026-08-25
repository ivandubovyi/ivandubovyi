/* ------------------------------------------------------------------
   Timezone + slot maths shared by the booking page and the admin page.

   Everything crossing the wire is a UTC ISO string. Timezones are only
   applied for display and for working out what "8:00am for Ivan" means
   on a given calendar day.

   Ivan's hours are stored as wall-clock times in America/New_York, so
   8:00am stays 8:00am across the DST change instead of drifting by an
   hour in November. That is why offsets are computed per instant
   rather than hardcoded to -5 or -4.
------------------------------------------------------------------ */
(function (global) {
  "use strict";

  /* Offset of `tz` from UTC, in ms, at the instant `utcMs`. */
  function tzOffsetMs(utcMs, tz) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUTC - utcMs;
  }

  /* Wall-clock time in `tz` -> UTC ms.
     Applied twice because the offset itself depends on the instant we
     are solving for, and near a DST boundary the first guess lands in
     the wrong offset. */
  function zonedToUtc(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
    const o1 = tzOffsetMs(guess, tz);
    let ts = guess - o1;
    const o2 = tzOffsetMs(ts, tz);
    if (o2 !== o1) ts = guess - o2;
    return ts;
  }

  /* UTC ms -> {y,m,d,hh,mm} as read on a clock in `tz`. */
  function utcToZonedParts(utcMs, tz) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute };
  }

  /* "YYYY-MM-DD" for an instant, as read in `tz`. */
  function dateKeyInTz(utcMs, tz) {
    const p = utcToZonedParts(utcMs, tz);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return { y, m, d };
  }

  function addDaysToKey(key, delta) {
    const { y, m, d } = parseDateKey(key);
    const t = Date.UTC(y, m - 1, d) + delta * 86400000;
    const dt = new Date(t);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  function hhmmToMinutes(s) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }

  /* Weekday (0=Sun) of a calendar day as read in `tz`. */
  function weekdayInTz(dateKey, tz) {
    const { y, m, d } = parseDateKey(dateKey);
    const noonUtc = zonedToUtc(y, m, d, 12, 0, tz);
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
      .format(new Date(noonUtc));
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  }

  /* Every slot start Ivan offers on ONE of his own calendar days,
     as UTC ms. */
  function slotsForHostDay(hostDateKey, cfg) {
    const tz = cfg.HOST_TIMEZONE;
    if (cfg.AVAILABLE_WEEKDAYS.indexOf(weekdayInTz(hostDateKey, tz)) === -1) return [];

    const { y, m, d } = parseDateKey(hostDateKey);
    const startMin = hhmmToMinutes(cfg.WORK_START);
    const endMin = hhmmToMinutes(cfg.WORK_END);
    const out = [];
    for (let t = startMin; t + 0 <= endMin; t += cfg.SLOT_INTERVAL) {
      out.push(zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, tz));
    }
    return out;
  }

  /* The recurring daily blocks, as real UTC intervals, for ONE of the
     host's calendar days. Built per day so 12:00 stays 12:00 through the
     DST change instead of sliding an hour. */
  function dailyBlocksForHostDay(hostDateKey, cfg) {
    const list = cfg.DAILY_BLOCKS || [];
    if (!list.length) return [];
    const { y, m, d } = parseDateKey(hostDateKey);
    const tz = cfg.HOST_TIMEZONE;
    return list.map((b) => {
      const s = hhmmToMinutes(b.start);
      const e = hhmmToMinutes(b.end);
      return {
        start: zonedToUtc(y, m, d, Math.floor(s / 60), s % 60, tz),
        end: zonedToUtc(y, m, d, Math.floor(e / 60), e % 60, tz),
        label: b.label || "Busy",
      };
    });
  }

  /* Daily blocks covering the three host days a viewer's day can touch. */
  function dailyBlocksAround(viewerDateKey, cfg) {
    const out = [];
    for (const delta of [-1, 0, 1]) {
      for (const b of dailyBlocksForHostDay(addDaysToKey(viewerDateKey, delta), cfg)) {
        out.push(b);
      }
    }
    return out;
  }

  /* Slot starts that land on `viewerDateKey` when read in `viewerTz`.

     Ivan's day and the viewer's day are different windows on the same
     line, so three of his days are generated and then filtered. A
     viewer in Tokyo picking Tuesday is offered Ivan's Monday evening,
     which is what actually overlaps their Tuesday. */
  function slotsForViewerDay(viewerDateKey, viewerTz, cfg) {
    const candidates = [];
    for (const delta of [-1, 0, 1]) {
      const hostKey = addDaysToKey(viewerDateKey, delta);
      for (const ms of slotsForHostDay(hostKey, cfg)) candidates.push(ms);
    }
    const seen = new Set();
    return candidates
      .filter((ms) => dateKeyInTz(ms, viewerTz) === viewerDateKey)
      .filter((ms) => (seen.has(ms) ? false : (seen.add(ms), true)))
      .sort((a, b) => a - b);
  }

  /* Does [aStart,aEnd) overlap [bStart,bEnd)? */
  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  /* Slots that survive: long enough to fit before Ivan's day ends,
     far enough out to respect notice, and clear of everything busy. */
  function availableSlots(viewerDateKey, viewerTz, durationMin, busy, cfg, nowMs) {
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    const minStart = now + cfg.MIN_NOTICE_HOURS * 3600000;
    const endLimitMin = hhmmToMinutes(cfg.WORK_END);
    const durMs = durationMin * 60000;
    const bufMs = (cfg.BUFFER_AFTER || 0) * 60000;

    // The gym block and anything else recurring counts as busy too.
    const allBusy = busy.concat(dailyBlocksAround(viewerDateKey, cfg));

    return slotsForViewerDay(viewerDateKey, viewerTz, cfg).filter((start) => {
      if (start < minStart) return false;

      // The meeting has to finish inside Ivan's own working window.
      const endMs = start + durMs;
      const endParts = utcToZonedParts(endMs, cfg.HOST_TIMEZONE);
      const startParts = utcToZonedParts(start, cfg.HOST_TIMEZONE);
      const endMinutes = endParts.hh * 60 + endParts.mm;
      const startMinutes = startParts.hh * 60 + startParts.mm;
      if (endMinutes > endLimitMin && !(endMinutes === 0 && endLimitMin === 1440)) return false;
      if (endMinutes < startMinutes) return false; // ran past midnight

      for (const b of allBusy) {
        if (overlaps(start, endMs + bufMs, b.start, b.end)) return false;
      }
      return true;
    });
  }

  /* ---- formatting ---- */

  function formatTime(utcMs, tz, hour12) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: hour12 !== false,
    }).format(new Date(utcMs)).toLowerCase().replace(/\s/g, "");
  }

  function formatLongDate(utcMs, tz) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric",
    }).format(new Date(utcMs));
  }

  function formatFullDateTime(utcMs, tz, durationMin) {
    const start = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(utcMs));
    const end = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(utcMs + durationMin * 60000));
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric",
    }).format(new Date(utcMs));
    return `${start} - ${end}, ${day}`;
  }

  /* "GMT-4:00" style label for the timezone dropdown. */
  function tzLabel(tz, atMs) {
    const off = tzOffsetMs(typeof atMs === "number" ? atMs : Date.now(), tz);
    const sign = off < 0 ? "-" : "+";
    const abs = Math.abs(off);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    return `GMT${sign}${h}:${String(m).padStart(2, "0")}`;
  }

  function guessTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    } catch (e) {
      return "America/New_York";
    }
  }

  global.Scheduling = {
    tzOffsetMs, zonedToUtc, utcToZonedParts, dateKeyInTz, parseDateKey,
    addDaysToKey, weekdayInTz, slotsForHostDay, slotsForViewerDay,
    availableSlots, overlaps, formatTime, formatLongDate, formatFullDateTime,
    dailyBlocksForHostDay, dailyBlocksAround,
    tzLabel, guessTimezone, hhmmToMinutes,
  };
})(window);
