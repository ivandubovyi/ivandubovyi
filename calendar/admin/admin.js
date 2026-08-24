/* ------------------------------------------------------------------
   Admin console.

   The password is never held here. It is posted once, the backend
   answers with a short-lived signed token, and only that token is
   kept (in sessionStorage, so closing the tab ends the session).
------------------------------------------------------------------ */
(function () {
  "use strict";

  const CFG = window.CALENDAR_CONFIG;
  const S = window.Scheduling;
  const API = (CFG.API_URL || "").trim();
  const TZ = CFG.HOST_TIMEZONE;
  const KEY = "cal_admin_token";

  const el = (id) => document.getElementById(id);
  let data = { bookings: [], blocks: [] };

  function token() { return sessionStorage.getItem(KEY) || ""; }
  function setToken(t) { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); }

  async function post(payload) {
    if (!API) throw new Error(
      "No backend is connected yet. Paste the Apps Script URL into calendar/config.js."
    );
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    const out = await res.json();
    if (out && out.error) throw new Error(out.error);
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function notice(kind, html, holdMs) {
    const box = el("notice");
    box.innerHTML = '<div class="alert alert-' + kind + '">' + html + "</div>";
    if (holdMs) setTimeout(() => { if (box.firstChild) box.innerHTML = ""; }, holdMs);
  }

  /* ---------- login ---------- */

  async function doLogin(e) {
    e.preventDefault();
    const btn = el("loginBtn");
    const err = el("loginErr");
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const out = await post({ action: "adminLogin", password: el("pw").value });
      setToken(out.token);
      el("pw").value = "";
      await enterApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  }

  function logout() {
    setToken("");
    el("appView").hidden = true;
    el("loginView").hidden = false;
  }

  async function enterApp() {
    el("loginView").hidden = true;
    el("appView").hidden = false;
    el("tzNote").textContent =
      "All times shown in " + TZ.replace(/_/g, " ") + " (" + S.tzLabel(TZ) + "), your own timezone";
    const p = S.utcToZonedParts(Date.now(), TZ);
    el("bDate").value = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    await refresh();
  }

  /* ---------- data ---------- */

  async function refresh() {
    const btn = el("refreshBtn");
    btn.disabled = true;
    try {
      const out = await post({ action: "adminData", token: token(), days: 180 });
      data = { bookings: out.bookings || [], blocks: out.blocks || [] };
      render();
    } catch (ex) {
      if (/session expired/i.test(ex.message)) { logout(); notice("err", esc(ex.message)); }
      else notice("err", esc(ex.message));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- rendering ---------- */

  function whenText(startIso, endIso) {
    const s = Date.parse(startIso), e = Date.parse(endIso);
    return S.formatTime(s, TZ) + " - " + S.formatTime(e, TZ) + ", " + S.formatLongDate(s, TZ);
  }

  function bookingRow(b) {
    const cancelled = String(b.status) !== "confirmed";
    const theirTz = b.timezone && b.timezone !== TZ
      ? '<br>Their time: ' + esc(S.formatTime(Date.parse(b.startUtc), b.timezone)) +
        " " + esc(b.timezone.replace(/_/g, " "))
      : "";
    return (
      '<div class="row' + (cancelled ? " cancelled" : "") + '">' +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(b.title) +
            '<span class="pill ' + (cancelled ? "pill-off" : "pill-ok") + '">' +
            (cancelled ? "cancelled" : "confirmed") + "</span></div>" +
          '<div class="row-when">' + esc(whenText(b.startUtc, b.endUtc)) +
            " &middot; " + esc(b.durationMin) + " min</div>" +
          '<div class="row-meta">' +
            "<strong>" + esc(b.name) + "</strong><br>" +
            '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + "</a><br>" +
            '<a href="tel:' + esc(String(b.phone).replace(/[^\d+]/g, "")) + '">' + esc(b.phone) + "</a>" +
            theirTz +
          "</div>" +
          (b.notes ? '<div class="row-notes">' + esc(b.notes) + "</div>" : "") +
        "</div>" +
        '<div class="row-actions">' +
          (cancelled ? "" :
            '<button class="btn btn-sm btn-danger" data-cancel="' + esc(b.id) + '">Cancel</button>') +
        "</div>" +
      "</div>"
    );
  }

  function blockRow(b) {
    return (
      '<div class="row">' +
        '<div class="row-main">' +
          '<div class="row-title">' + esc(b.label) +
            '<span class="pill pill-block">your event</span></div>' +
          '<div class="row-when">' + esc(whenText(b.startUtc, b.endUtc)) + "</div>" +
          (b.notes ? '<div class="row-notes">' + esc(b.notes) + "</div>" : "") +
        "</div>" +
        '<div class="row-actions">' +
          '<button class="btn btn-sm btn-danger" data-delblock="' + esc(b.id) + '">Remove</button>' +
        "</div>" +
      "</div>"
    );
  }

  function render() {
    const now = Date.now();
    const upcoming = data.bookings.filter(
      (b) => String(b.status) === "confirmed" && Date.parse(b.startUtc) >= now);
    const past = data.bookings.filter(
      (b) => String(b.status) !== "confirmed" || Date.parse(b.startUtc) < now);
    const blocks = data.blocks.filter((b) => Date.parse(b.endUtc) >= now);

    el("upcomingCount").textContent = upcoming.length + (upcoming.length === 1 ? " meeting" : " meetings");
    el("upcomingList").innerHTML = upcoming.length
      ? upcoming.map(bookingRow).join("")
      : '<div class="empty">Nothing booked yet.</div>';
    el("upcomingTz").hidden = upcoming.length === 0;
    el("upcomingTz").textContent = "Shown in " + TZ.replace(/_/g, " ") + ".";

    el("blockCount").textContent = blocks.length + (blocks.length === 1 ? " event" : " events");
    el("blockList").innerHTML = blocks.length
      ? blocks.map(blockRow).join("")
      : '<div class="empty">Nothing blocked. Every slot from 8:00am to 9:00pm is open.</div>';

    el("pastCount").textContent = past.length + (past.length === 1 ? " item" : " items");
    el("pastList").innerHTML = past.length
      ? past.slice().reverse().map(bookingRow).join("")
      : '<div class="empty">Nothing yet.</div>';
  }

  /* ---------- actions ---------- */

  async function onClick(e) {
    const cancelId = e.target.getAttribute && e.target.getAttribute("data-cancel");
    const delId = e.target.getAttribute && e.target.getAttribute("data-delblock");

    if (cancelId) {
      const b = data.bookings.filter((x) => x.id === cancelId)[0];
      if (!b) return;
      if (!confirm(
        "Cancel this meeting?\n\n" + b.title + "\n" + whenText(b.startUtc, b.endUtc) +
        "\nwith " + b.name + "\n\n" + b.name.split(" ")[0] + " will be emailed."
      )) return;
      e.target.disabled = true;
      try {
        const out = await post({ action: "adminCancel", token: token(), id: cancelId });
        notice(out.warning ? "warn" : "ok",
          out.warning ? esc(out.warning) : "Meeting cancelled and " + esc(b.name.split(" ")[0]) + " was emailed.",
          6000);
        await refresh();
      } catch (ex) { notice("err", esc(ex.message)); e.target.disabled = false; }
    }

    if (delId) {
      if (!confirm("Remove this event? The time opens back up for booking.")) return;
      e.target.disabled = true;
      try {
        await post({ action: "adminDeleteBlock", token: token(), id: delId });
        notice("ok", "Event removed.", 4000);
        await refresh();
      } catch (ex) { notice("err", esc(ex.message)); e.target.disabled = false; }
    }
  }

  async function addBlock(e) {
    e.preventDefault();
    const label = el("bLabel").value.trim();
    const date = el("bDate").value;
    const start = el("bStart").value;
    const end = el("bEnd").value;
    if (!label || !date || !start || !end) return;

    const { y, m, d } = S.parseDateKey(date);
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startMs = S.zonedToUtc(y, m, d, sh, sm, TZ);
    let endMs = S.zonedToUtc(y, m, d, eh, em, TZ);
    // "22:00 to 01:00" means it runs into the next day.
    if (endMs <= startMs) endMs = S.zonedToUtc(y, m, d + 1, eh, em, TZ);

    const btn = el("blockBtn");
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const out = await post({
        action: "adminAddBlock", token: token(), label: label,
        notes: el("bNotes").value.trim(),
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(endMs).toISOString(),
      });
      let msg = "Added <strong>" + esc(label) + "</strong>. That time is now blocked.";
      if (out.clashes && out.clashes.length) {
        msg += "<br><br><strong>Heads up:</strong> " + out.clashes.length +
          " meeting" + (out.clashes.length === 1 ? " is" : "s are") +
          " already booked inside it: " +
          out.clashes.map((c) => esc(c.title) + " with " + esc(c.name)).join(", ") +
          ". Those stay booked, so cancel them here if they need to move.";
        notice("warn", msg);
      } else {
        notice("ok", msg, 6000);
      }
      el("bLabel").value = "";
      el("bNotes").value = "";
      await refresh();
    } catch (ex) {
      notice("err", esc(ex.message));
    } finally {
      btn.disabled = false;
      btn.textContent = "Add event";
    }
  }

  function allDay() {
    el("bStart").value = "00:00";
    el("bEnd").value = "23:59";
    el("blockHint").textContent = "Set to the whole day. Add a label, then press Add event.";
    el("bLabel").focus();
  }

  /* ---------- init ---------- */

  function init() {
    if (!API) {
      el("loginErr").innerHTML =
        "No backend is connected yet. Paste the Apps Script URL into " +
        "<code>calendar/config.js</code> first. See <code>SETUP.md</code>.";
      el("loginErr").hidden = false;
      el("loginBtn").disabled = true;
    }
    el("loginForm").addEventListener("submit", doLogin);
    el("logoutBtn").addEventListener("click", logout);
    el("refreshBtn").addEventListener("click", refresh);
    el("blockForm").addEventListener("submit", addBlock);
    el("allDayBtn").addEventListener("click", allDay);
    document.addEventListener("click", onClick);

    if (token()) enterApp().catch(() => logout());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
