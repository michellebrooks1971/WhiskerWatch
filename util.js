/* Whisker Watch — util.js
   Small shared helpers. Exposes window.U */
(function () {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- dates (all local-time, ISO strings YYYY-MM-DD) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return toISO(new Date()); }
  function parseISO(iso) {
    const p = String(iso || '').split('-').map(Number);
    return new Date(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1);
  }
  function isISO(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')); }

  function addDaysISO(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  // add months, keeping the day-of-month where possible (31st -> 30th/28th when needed)
  function addMonthsISO(iso, months, preferredDay) {
    const d = parseISO(iso);
    const day = preferredDay || d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth() + months, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(day, last));
    return toISO(t);
  }

  // whole days from today to iso (negative = past)
  function daysFromToday(iso) {
    const a = parseISO(todayISO()).getTime();
    const b = parseISO(iso).getTime();
    return Math.round((b - a) / 86400000);
  }

  function fmtDMY(iso) {
    if (!isISO(iso)) return '—';
    const d = parseISO(iso);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtShort(iso) {
    if (!isISO(iso)) return '—';
    const d = parseISO(iso);
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function weekdayShort(iso) { return DAYS[parseISO(iso).getDay()]; }

  // "Today" / "Tomorrow" / "Yesterday" / "In 5 days" / "5 days ago"
  function relDay(iso) {
    const n = daysFromToday(iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return n > 0 ? 'In ' + n + ' days' : Math.abs(n) + ' days ago';
  }

  // due-date phrasing for treatments
  function dueLabel(iso) {
    const n = daysFromToday(iso);
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    if (n < 0) return 'Overdue ' + Math.abs(n) + (n === -1 ? ' day' : ' days');
    return 'Due in ' + n + ' days';
  }

  // '08:00' -> '8:00 am'
  function fmtTime(hhmm) {
    if (!/^\d{2}:\d{2}$/.test(String(hhmm || ''))) return '';
    let h = Number(hhmm.slice(0, 2));
    const m = hhmm.slice(3);
    const ap = h < 12 ? 'am' : 'pm';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ap;
  }
  function nowHHMM() {
    const d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // '2021-03-14' -> '5 yrs' / '11 mths' / '5 yrs 3 mths' for young cats
  function ageLabel(dobISO) {
    if (!isISO(dobISO)) return '';
    const dob = parseISO(dobISO), now = new Date();
    let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
    if (now.getDate() < dob.getDate()) months--;
    if (months < 0) return '';
    if (months < 12) return months + ' mth' + (months === 1 ? '' : 's');
    const y = Math.floor(months / 12), m = months % 12;
    if (y < 2 && m) return y + ' yr ' + m + ' mth' + (m === 1 ? '' : 's');
    return y + ' yr' + (y === 1 ? '' : 's');
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  // downscale an image file to a small square-ish data URL for avatars
  function fileToDataURL(file, maxSize) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error('That does not look like an image.')); };
        img.onload = function () {
          const max = maxSize || 256;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.U = {
    $: $, $$: $$, esc: esc, uid: uid,
    toISO: toISO, todayISO: todayISO, parseISO: parseISO, isISO: isISO,
    addDaysISO: addDaysISO, addMonthsISO: addMonthsISO, daysFromToday: daysFromToday,
    fmtDMY: fmtDMY, fmtShort: fmtShort, weekdayShort: weekdayShort,
    relDay: relDay, dueLabel: dueLabel, fmtTime: fmtTime, nowHHMM: nowHHMM,
    ageLabel: ageLabel, plural: plural, clampInt: clampInt,
    debounce: debounce, download: download, fileToDataURL: fileToDataURL
  };
})();
