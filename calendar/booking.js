/* ------------------------------------------------------------------
   Booking page behaviour.

   The page renders real, correct slots on its own. The backend is
   asked for two things only: what is already busy, and to record a
   booking. If no backend is configured the page says so plainly
   rather than accepting a booking that goes nowhere.
------------------------------------------------------------------ */
(function () {
  "use strict";

  const CFG = window.CALENDAR_CONFIG;
  const S = window.Scheduling;
  const API = (CFG.API_URL || "").trim();
  const LIVE = API.length > 0;

  const el = (id) => document.getElementById(id);
  const state = {
    tz: S.guessTimezone(),
    duration: CFG.DURATIONS[0],
    monthCursor: null,   // {y, m}
    selectedDate: null,  // "YYYY-MM-DD" in viewer tz
    selectedSlot: null,  // UTC ms
    busy: [],            // [{start,end}] UTC ms
    busyLoaded: false,
    submitting: false,
  };

  /* ---------- backend ---------- */

  async function apiGet(params) {
    const url = API + (API.indexOf("?") === -1 ? "?" : "&") +
      new URLSearchParams(params).toString();
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  /* text/plain keeps this a "simple" request, so the browser skips the
     CORS preflight that Apps Script web apps do not answer. */
  async function apiPost(payload) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
    } catch (netErr) {
      throw new Error(
        "Could not reach the calendar. If this keeps happening, the Apps " +
        "Script deployment needs \"Who has access\" set to Anyone."
      );
    }
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function loadBusy() {
    if (!LIVE) { state.busyLoaded = true; return; }
    try {
      const from = new Date(Date.now() - 86400000).toISOString();
      const to = new Date(Date.now() + CFG.MAX_DAYS_AHEAD * 86400000).toISOString();
      const data = await apiGet({ action: "busy", from: from, to: to });
      state.busy = (data.busy || []).map((b) => ({
        start: Date.parse(b.start),
        end: Date.parse(b.end),
      })).filter((b) => !isNaN(b.start) && !isNaN(b.end));
    } catch (err) {
      showBanner(
        "<strong>Ivan's existing events could not be loaded.</strong> " +
        "Times below still respect his working hours, and a slot he has " +
        "already filled will be caught when you submit. (" + escapeHtml(err.message) + ")"
      );
    }
    state.busyLoaded = true;
  }

  /* ---------- helpers ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function showBanner(html) {
    const b = el("banner");
    b.innerHTML = html;
    b.hidden = false;
  }

  function todayKey() { return S.dateKeyInTz(Date.now(), state.tz); }

  function slotsFor(dateKey) {
    return S.availableSlots(dateKey, state.tz, state.duration, state.busy, CFG);
  }

  function withinRange(dateKey) {
    const first = todayKey();
    const last = S.dateKeyInTz(Date.now() + CFG.MAX_DAYS_AHEAD * 86400000, state.tz);
    return dateKey >= first && dateKey <= last;
  }

  /* ---------- timezone dropdown ---------- */

  const TZ_CHOICES = [
    "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
    "America/Phoenix", "America/Chicago", "America/New_York", "America/Toronto",
    "America/Halifax", "America/Sao_Paulo", "Atlantic/Reykjavik", "Europe/London",
    "Europe/Lisbon", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Europe/Rome",
    "Europe/Warsaw", "Europe/Kyiv", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
    "Africa/Lagos", "Africa/Cairo", "Africa/Johannesburg", "Africa/Nairobi",
    "Asia/Jerusalem", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka",
    "Asia/Bangkok", "Asia/Jakarta", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore",
    "Asia/Manila", "Asia/Seoul", "Asia/Tokyo", "Australia/Perth", "Australia/Brisbane",
    "Australia/Sydney", "Pacific/Auckland", "UTC",
  ];

  function buildTzSelect() {
    const sel = el("tzSelect");
    const list = TZ_CHOICES.slice();
    if (list.indexOf(state.tz) === -1) list.push(state.tz);
    list
      .map((tz) => ({ tz: tz, off: S.tzOffsetMs(Date.now(), tz) }))
      .sort((a, b) => a.off - b.off || a.tz.localeCompare(b.tz))
      .forEach(({ tz }) => {
        const o = document.createElement("option");
        o.value = tz;
        o.textContent = tz.replace(/_/g, " ") + " (" + S.tzLabel(tz) + ")";
        sel.appendChild(o);
      });
    sel.value = state.tz;
    sel.addEventListener("change", () => {
      state.tz = sel.value;
      state.selectedDate = null;
      state.selectedSlot = null;
      renderTzMeta();
      renderMonth();
      renderSlots();
    });
  }

  function renderTzMeta() {
    el("metaTz").textContent = state.tz.replace(/_/g, " ") + " (" + S.tzLabel(state.tz) + ")";
  }

  /* ---------- duration ---------- */

  function buildDurations() {
    const box = el("durations");
    box.innerHTML = "";
    CFG.DURATIONS.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dur-btn" + (d === state.duration ? " active" : "");
      b.textContent = d + " min";
      b.addEventListener("click", () => {
        state.duration = d;
        state.selectedSlot = null;
        buildDurations();
        el("metaDuration").textContent = d + " min";
        renderMonth();
        renderSlots();
      });
      box.appendChild(b);
    });
    el("metaDuration").textContent = state.duration + " min";
  }

  /* ---------- month grid ---------- */

  function renderMonth() {
    const cur = state.monthCursor;
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(cur.y, cur.m - 1, 1)));
    el("monthLabel").textContent = label;

    const firstWeekday = new Date(Date.UTC(cur.y, cur.m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();
    const grid = el("days");
    grid.innerHTML = "";

    for (let i = 0; i < firstWeekday; i++) {
      const cell = document.createElement("div");
      cell.className = "day";
      grid.appendChild(cell);
    }

    const today = todayKey();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${cur.y}-${String(cur.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = "day";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(d);

      const open = withinRange(key) && slotsFor(key).length > 0;
      btn.disabled = !open;
      if (key === today) btn.classList.add("today");
      if (key === state.selectedDate) btn.classList.add("selected");
      if (open) {
        btn.setAttribute("aria-label", S.formatLongDate(S.zonedToUtc(cur.y, cur.m, d, 12, 0, state.tz), state.tz));
        btn.addEventListener("click", () => {
          state.selectedDate = key;
          state.selectedSlot = null;
          renderMonth();
          renderSlots();
        });
      }
      cell.appendChild(btn);
      grid.appendChild(cell);
    }

    const firstKey = today.slice(0, 7);
    const lastKey = S.dateKeyInTz(Date.now() + CFG.MAX_DAYS_AHEAD * 86400000, state.tz).slice(0, 7);
    const curKey = `${cur.y}-${String(cur.m).padStart(2, "0")}`;
    el("prevMonth").disabled = curKey <= firstKey;
    el("nextMonth").disabled = curKey >= lastKey;
  }

  /* ---------- slot column ---------- */

  function renderSlots() {
    const col = el("slotCol");
    const card = el("card");
    if (!state.selectedDate) {
      col.hidden = true;
      card.classList.remove("has-slots");
      return;
    }
    col.hidden = false;
    card.classList.add("has-slots");

    const { y, m, d } = S.parseDateKey(state.selectedDate);
    const noon = S.zonedToUtc(y, m, d, 12, 0, state.tz);
    el("slotDate").textContent = S.formatLongDate(noon, state.tz);

    const list = el("slotList");
    list.innerHTML = "";

    if (!state.busyLoaded) {
      list.innerHTML = '<div class="loading">Loading times&hellip;</div>';
      return;
    }

    const slots = slotsFor(state.selectedDate);
    if (!slots.length) {
      list.innerHTML = '<div class="slots-empty">No times left on this day. Try another date.</div>';
      return;
    }

    slots.forEach((ms) => {
      const row = document.createElement("div");
      row.className = "slot-row";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-btn";
      b.textContent = S.formatTime(ms, state.tz);

      if (state.selectedSlot === ms) {
        b.classList.add("chosen");
        const next = document.createElement("button");
        next.type = "button";
        next.className = "slot-next";
        next.textContent = "Next";
        next.addEventListener("click", goToForm);
        row.appendChild(b);
        row.appendChild(next);
      } else {
        b.addEventListener("click", () => {
          state.selectedSlot = ms;
          renderSlots();
          const chosen = list.querySelector(".slot-btn.chosen");
          if (chosen) chosen.scrollIntoView({ block: "nearest" });
        });
        row.appendChild(b);
      }
      list.appendChild(row);
    });
  }

  /* ---------- steps ---------- */

  function goToForm() {
    el("stepPick").hidden = true;
    el("slotCol").hidden = true;
    el("card").classList.remove("has-slots");
    el("stepForm").hidden = false;
    el("back").classList.add("show");
    setWhenMeta();
    el("fTitle").focus();
  }

  function backToPick() {
    el("stepForm").hidden = true;
    el("stepPick").hidden = false;
    el("back").classList.remove("show");
    el("metaWhen").hidden = true;
    el("eventTitle").textContent = "Meeting with Ivan";
    renderSlots();
  }

  function setWhenMeta() {
    el("metaWhen").hidden = false;
    el("metaWhenText").textContent =
      S.formatFullDateTime(state.selectedSlot, state.tz, state.duration);
  }

  /* ---------- submit ---------- */

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function validPhone(v) { return (v.match(/\d/g) || []).length >= 7; }

  function fieldError(inputId, errId, bad) {
    el(errId).classList.toggle("show", bad);
    el(inputId).setAttribute("aria-invalid", bad ? "true" : "false");
    return bad;
  }

  async function submit(e) {
    e.preventDefault();
    if (state.submitting) return;

    const title = el("fTitle").value.trim();
    const name = el("fName").value.trim();
    const email = el("fEmail").value.trim();
    const phone = el("fPhone").value.trim();
    const notes = el("fNotes").value.trim();

    let bad = false;
    bad = fieldError("fTitle", "eTitle", title.length < 2) || bad;
    bad = fieldError("fName", "eName", name.length < 2) || bad;
    bad = fieldError("fEmail", "eEmail", !validEmail(email)) || bad;
    bad = fieldError("fPhone", "ePhone", !validPhone(phone)) || bad;
    if (bad) return;

    const errBox = el("formError");
    errBox.classList.remove("show");

    if (!LIVE) {
      errBox.innerHTML =
        "<strong>Bookings are not open yet.</strong> Nothing was saved and " +
        "no email was sent, so please do not count on this time. " +
        'Reach Ivan through <a href="/">ivandubovyi.com</a> instead.';
      errBox.classList.add("show");
      errBox.scrollIntoView({ block: "nearest" });
      return;
    }

    state.submitting = true;
    const btn = el("submitBtn");
    btn.disabled = true;
    btn.textContent = "Scheduling…";

    try {
      const res = await apiPost({
        action: "book",
        title: title,
        name: name,
        email: email,
        phone: phone,
        notes: notes,
        startUtc: new Date(state.selectedSlot).toISOString(),
        durationMin: state.duration,
        timezone: state.tz,
      });
      showDone(res, title, email);
    } catch (err) {
      errBox.textContent = err.message || "Something went wrong. Please try again.";
      errBox.classList.add("show");
      errBox.scrollIntoView({ block: "nearest" });
      // The slot may have gone while the form was open.
      state.busyLoaded = false;
      loadBusy().then(() => { state.busyLoaded = true; });
    } finally {
      state.submitting = false;
      btn.disabled = false;
      btn.textContent = "Schedule Event";
    }
  }

  function showDone(res, title, email) {
    el("stepForm").hidden = true;
    el("stepDone").hidden = false;
    el("back").classList.remove("show");
    el("eventTitle").textContent = title;
    el("doneTitle").textContent = title;
    el("doneWhen").textContent = S.formatFullDateTime(state.selectedSlot, state.tz, state.duration);
    el("doneTz").textContent = state.tz.replace(/_/g, " ") + " (" + S.tzLabel(state.tz) + ")";
    el("doneEmail").textContent = "Confirmation sent to " + email;
    if (res && res.emailWarning) {
      el("doneLead").textContent =
        "Your meeting is booked. " + res.emailWarning;
    }
  }

  /* ---------- init ---------- */

  function init() {
    el("hostName").textContent = CFG.HOST_NAME;
    el("avatar").textContent = CFG.HOST_INITIALS;
    document.title = "Book a meeting with " + CFG.HOST_NAME;

    if (!LIVE) {
      showBanner(
        "<strong>This page is not taking bookings just yet.</strong> " +
        "The times shown are real and correct, and booking opens as soon as " +
        "the calendar is connected. To reach Ivan meanwhile, head to " +
        '<a href="/">ivandubovyi.com</a>.'
      );
    }

    const nowParts = S.utcToZonedParts(Date.now(), state.tz);
    state.monthCursor = { y: nowParts.y, m: nowParts.m };

    buildTzSelect();
    renderTzMeta();
    buildDurations();
    renderMonth();

    el("prevMonth").addEventListener("click", () => {
      const c = state.monthCursor;
      state.monthCursor = c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 };
      renderMonth();
    });
    el("nextMonth").addEventListener("click", () => {
      const c = state.monthCursor;
      state.monthCursor = c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 };
      renderMonth();
    });
    el("back").addEventListener("click", backToPick);
    el("bookForm").addEventListener("submit", submit);

    loadBusy().then(() => {
      renderMonth();
      renderSlots();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
