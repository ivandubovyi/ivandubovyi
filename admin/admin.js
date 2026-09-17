/* ------------------------------------------------------------------
   Petition console: how many people signed, who, and when.

   The password is never held here. It is posted once, the backend
   answers with a short-lived signed token, and only that token is kept
   (in sessionStorage, so closing the tab ends the session). Names reach
   this page and nowhere else; the endpoint the public page calls hands
   back a number and never a name.
------------------------------------------------------------------ */
(function () {
  "use strict";

  const CFG = window.CALENDAR_CONFIG || {};
  const API = (CFG.API_URL || "").trim();
  const TZ = CFG.HOST_TIMEZONE || "America/New_York";
  const KEY = "cal_admin_token";

  const el = (id) => document.getElementById(id);
  let petition = null;

  function token() { return sessionStorage.getItem(KEY) || ""; }
  function setToken(t) { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); }

  async function post(payload) {
    if (!API) throw new Error(
      "No backend is connected yet. Paste the Apps Script URL into calendar/config.js."
    );
    const res = await fetch(API, {
      method: "POST",
      // text/plain keeps this a simple request, so the browser skips the
      // CORS preflight that Apps Script leaves unanswered
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

  /* ---------- time, always in Ivan's own timezone ---------- */

  const dayKey = (ms) => new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));

  const clock = (ms) => new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit",
  }).format(new Date(ms)).toLowerCase().replace(/\s/g, "");

  const longDate = (ms) => new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
  }).format(new Date(ms));

  /* Today and yesterday carry the clock; anything older carries the date. */
  function signedWhen(iso) {
    const ms = Date.parse(iso);
    if (isNaN(ms)) return "";
    const today = dayKey(Date.now());
    const day = dayKey(ms);
    if (day === today) return "Today, " + clock(ms);
    if (day === dayKey(Date.now() - 86400000)) return "Yesterday, " + clock(ms);
    return longDate(ms) + ", " + clock(ms);
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
    el("tzNote").textContent = "Times in " + TZ.replace(/_/g, " ");
    await refresh();
  }

  /* ---------- data ---------- */

  async function refresh() {
    const btn = el("refreshBtn");
    btn.disabled = true;
    try {
      const out = await post({ action: "adminData", token: token(), days: 1 });
      petition = out.petition || null;
      render();
    } catch (ex) {
      if (/session expired/i.test(ex.message)) { logout(); notice("err", esc(ex.message)); }
      else notice("err", esc(ex.message));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- rendering ---------- */

  function sigRow(s, number) {
    return (
      '<div class="sig">' +
        '<div class="sig-main">' +
          '<span class="sig-num">' + number + "</span>" +
          "<div>" +
            '<div class="sig-name">' + esc(s.name) + "</div>" +
            '<div class="sig-when">' + esc(signedWhen(s.createdAt)) + "</div>" +
          "</div>" +
        "</div>" +
        '<button class="btn btn-sm btn-danger" data-delsig="' + esc(s.id) + '">Remove</button>' +
      "</div>"
    );
  }

  function render() {
    // An older backend answers without a petition at all. Say so plainly
    // rather than showing a zero that really means "unknown".
    if (!petition) {
      notice("err",
        "This backend predates the petition. In Apps Script, paste the current " +
        "<code>Code.gs</code> and redeploy: Deploy &rsaquo; Manage deployments " +
        "&rsaquo; pencil &rsaquo; Version: New version.");
      el("sigNote").textContent = "";
      el("sigList").innerHTML = '<div class="empty">Waiting on the backend.</div>';
      return;
    }

    const n = petition.count;
    el("sigTotal").textContent = n.toLocaleString("en-US");
    el("sigTotalLabel").textContent = n === 1 ? "signature" : "signatures";
    el("sigToday").textContent = petition.today.toLocaleString("en-US");
    el("sigWeek").textContent = petition.last7Days.toLocaleString("en-US");

    const from = petition.showCountFrom;
    let note;
    if (!petition.open) {
      note = "The petition is closed, so the page thanks anyone who opens it and saves " +
             "nothing further. Set <code>PETITION_OPEN</code> back to <code>true</code> " +
             "in Code.gs to reopen it.";
    } else if (n >= from) {
      note = "The petition page shows this number publicly, and it updates as people sign.";
    } else {
      const left = from - n;
      note = "This number is yours alone until it reaches <strong>" + from + "</strong>, which is " +
             left + " signature" + (left === 1 ? "" : "s") + " from here. A small number on a " +
             "campaign page works against the campaign, so the page shows the petition without " +
             "a count until then. Change <code>PETITION_SHOW_COUNT_FROM</code> in Code.gs to " +
             "move that line.";
    }
    el("sigNote").innerHTML = note;

    const list = petition.signatures;
    el("sigCount").textContent = list.length === 0
      ? "0 names"
      : list.length + (list.length === 1 ? " name" : " names") + ", newest first";
    el("sigList").innerHTML = list.length
      ? list.map((s, i) => sigRow(s, list.length - i)).join("")
      : '<div class="empty">The first signature shows up here. ' +
        'Share ivandubovyi.com/petition to start.</div>';
  }

  /* ---------- actions ---------- */

  async function onClick(e) {
    const sigId = e.target.getAttribute && e.target.getAttribute("data-delsig");
    if (!sigId) return;

    const s = (petition ? petition.signatures : []).filter((x) => x.id === sigId)[0];
    if (!s) return;
    if (!confirm(
      "Remove this signature?\n\n" + s.name + "\n" + signedWhen(s.createdAt) +
      "\n\nThe count drops by one, and that name stays off the petition even if it is entered again."
    )) return;

    e.target.disabled = true;
    try {
      await post({ action: "adminRemoveSignature", token: token(), id: sigId });
      notice("ok", "Removed <strong>" + esc(s.name) + "</strong> from the petition.", 5000);
      await refresh();
    } catch (ex) { notice("err", esc(ex.message)); e.target.disabled = false; }
  }

  /* ---------- init ---------- */

  function init() {
    if (!API) {
      el("loginErr").innerHTML =
        "No backend is connected yet. Paste the Apps Script URL into " +
        "<code>calendar/config.js</code> first.";
      el("loginErr").hidden = false;
      el("loginBtn").disabled = true;
    }
    el("loginForm").addEventListener("submit", doLogin);
    el("logoutBtn").addEventListener("click", logout);
    el("refreshBtn").addEventListener("click", refresh);
    document.addEventListener("click", onClick);

    if (token()) enterApp().catch(() => logout());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
