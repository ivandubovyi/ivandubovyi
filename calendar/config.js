/* ------------------------------------------------------------------
   Calendar configuration.

   ONE thing to change here: API_URL.
   Paste the Google Apps Script Web App URL you get at the end of
   SETUP.md (it looks like
   https://script.google.com/macros/s/AKfy..../exec).

   Until you paste it, the page runs in DEMO MODE: the interface works
   and shows real time slots, and booking is disabled with a notice,
   so nothing silently pretends to have been booked.
------------------------------------------------------------------ */
window.CALENDAR_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbwsB25xpZ8t7VOuSKnUBcM6Sk1mGGVVFetn2ZWM2Md2lsI9BonzaulR3xtcq6ucO-hR/exec",

  HOST_NAME: "Ivan Dubovyi",
  HOST_INITIALS: "ID",
  HOST_TIMEZONE: "America/New_York",

  // Ivan's working window, in HIS timezone (HOST_TIMEZONE above).
  // 8:00am to 9:00pm. The last bookable slot ends by WORK_END.
  WORK_START: "08:00",
  WORK_END:   "21:00",

  // Meeting lengths offered, in minutes. First one is the default.
  DURATIONS: [30, 15, 60],

  // Slots are offered on this grid, in minutes.
  SLOT_INTERVAL: 30,

  // Gap kept after each meeting, in minutes.
  BUFFER_AFTER: 0,

  // Soonest a meeting can be booked, in hours from now.
  MIN_NOTICE_HOURS: 4,

  // How far ahead the calendar opens, in days.
  MAX_DAYS_AHEAD: 60,

  // Weekdays Ivan takes meetings. 0 = Sunday ... 6 = Saturday.
  AVAILABLE_WEEKDAYS: [0, 1, 2, 3, 4, 5, 6],
};
