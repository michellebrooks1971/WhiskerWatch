/* Whisker Watch — store.js
   State, normalisation, schedules, server sync (with localStorage fallback),
   import/export, sample data. Exposes window.Store */
(function () {
  'use strict';
  const U = window.U;

  const KINDS = {
    flea: 'Flea', worm: 'Worming', both: 'Flea + worming', other: 'Other parasite'
  };
  const UNITS = { day: 'day', week: 'week', month: 'month', year: 'year' };
  const APPETITES = {
    none: 'Not eating', reduced: 'Eating less', normal: 'Normal', increased: 'Eating more'
  };
  const SEVERITIES = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };
  const CAT_COLOURS = ['#c96f4a', '#8a9b6e', '#6e8a9b', '#b0779b', '#a9895b', '#7b8fae', '#9b6e6e', '#5f9b8a'];

  function defaultDoc() {
    return {
      schema: 1,
      updatedAt: null,
      settings: {
        notifications: false,
        lastDailySummary: null,
        lastExport: null
      },
      cats: [], logs: [], meds: [], doses: [], treatments: [], vaccinations: [], visits: []
    };
  }

  // ---------- state ----------
  let doc = defaultDoc();
  let mode = 'local';            // 'server' | 'local'
  let saveState = 'idle';        // 'idle' | 'saving' | 'error'
  let pendingSave = false;
  const changeSubs = [];
  const statusSubs = [];
  const LS_KEY = 'whiskerwatch.doc.v1';

  function emitChange() { changeSubs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function emitStatus() { statusSubs.forEach(function (f) { try { f(status()); } catch (e) { console.error(e); } }); }
  function status() { return { mode: mode, saveState: saveState }; }

  // ---------- normalisation ----------
  // allergies / adverse reactions: [{ id, substance, severity, reaction }]
  function normAllergies(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(function (a) { return a && String(a.substance || '').trim(); })
      .map(function (a) {
        return {
          id: a.id || U.uid('alg'),
          substance: String(a.substance).trim().slice(0, 80),
          severity: SEVERITIES[a.severity] ? a.severity : 'mild',
          reaction: String(a.reaction || '').slice(0, 300)
        };
      });
  }

  function normCat(c) {
    c = c || {};
    return {
      id: c.id || U.uid('cat'),
      name: String(c.name || 'Unnamed cat').trim() || 'Unnamed cat',
      dob: U.isISO(c.dob) ? c.dob : '',
      sex: c.sex === 'female' || c.sex === 'male' ? c.sex : '',
      breed: String(c.breed || ''),
      colour: /^#[0-9a-f]{6}$/i.test(c.colour || '') ? c.colour : CAT_COLOURS[0],
      photo: typeof c.photo === 'string' && c.photo.indexOf('data:image') === 0 ? c.photo : '',
      notes: String(c.notes || ''),
      allergies: normAllergies(c.allergies),
      archived: !!c.archived,
      createdAt: c.createdAt || new Date().toISOString()
    };
  }

  // attachments: [{ id: 'file-on-server.ext', type: 'image'|'video', name: 'original.ext' }]
  function normMedia(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(function (m) { return m && typeof m.id === 'string' && m.id; })
      .map(function (m) {
        return { id: m.id, type: m.type === 'video' ? 'video' : 'image', name: String(m.name || '') };
      });
  }

  function normLog(l) {
    l = l || {};
    const weight = Number(l.weight);
    return {
      id: l.id || U.uid('log'),
      catId: l.catId || null,
      date: U.isISO(l.date) ? l.date : U.todayISO(),
      appetite: APPETITES[l.appetite] ? l.appetite : '',
      diet: String(l.diet || ''),
      wellness: String(l.wellness || ''),
      weight: isFinite(weight) && weight > 0 ? Math.round(weight * 100) / 100 : null,
      media: normMedia(l.media),
      updatedAt: l.updatedAt || new Date().toISOString()
    };
  }

  function normMed(m) {
    m = m || {};
    const per = U.clampInt(m.timesPerDay, 1, 4, 1);
    let times = Array.isArray(m.times) ? m.times.slice(0, per) : [];
    while (times.length < per) times.push('');
    times = times.map(function (t) { return /^\d{2}:\d{2}$/.test(t || '') ? t : ''; });
    return {
      id: m.id || U.uid('med'),
      catId: m.catId || null,
      name: String(m.name || 'Medication').trim() || 'Medication',
      dose: String(m.dose || ''),
      timesPerDay: per,
      times: times,
      startDate: U.isISO(m.startDate) ? m.startDate : U.todayISO(),
      endDate: U.isISO(m.endDate) ? m.endDate : '',
      notes: String(m.notes || ''),
      active: m.active !== false,
      createdAt: m.createdAt || new Date().toISOString()
    };
  }

  function normDose(d) {
    d = d || {};
    return {
      id: d.id || U.uid('dose'),
      medId: d.medId || null,
      date: U.isISO(d.date) ? d.date : U.todayISO(),
      slot: U.clampInt(d.slot, 0, 3, 0),
      at: d.at || new Date().toISOString()
    };
  }

  function normTreatment(t) {
    t = t || {};
    const every = U.clampInt(t.every, 1, 365, 1);
    const unit = UNITS[t.unit] ? t.unit : 'month';
    const lastGiven = U.isISO(t.lastGiven) ? t.lastGiven : '';
    let nextDue = U.isISO(t.nextDue) ? t.nextDue : '';
    if (!nextDue && lastGiven) nextDue = stepForward(lastGiven, every, unit);
    return {
      id: t.id || U.uid('tr'),
      catId: t.catId || null,
      name: String(t.name || 'Treatment').trim() || 'Treatment',
      kind: KINDS[t.kind] ? t.kind : 'flea',
      every: every,
      unit: unit,
      lastGiven: lastGiven,
      nextDue: nextDue,
      notes: String(t.notes || ''),
      history: (Array.isArray(t.history) ? t.history : [])
        .filter(function (h) { return h && U.isISO(h.date); })
        .map(function (h) { return { date: h.date, at: h.at || null }; }),
      createdAt: t.createdAt || new Date().toISOString()
    };
  }

  // vaccinations reuse the same schedule shape as treatments (no 'kind'),
  // with intervals from days up to years (e.g. every 2 weeks … every 3 years)
  function normVax(t) {
    t = t || {};
    const every = U.clampInt(t.every, 1, 365, 1);
    const unit = UNITS[t.unit] ? t.unit : 'year';
    const lastGiven = U.isISO(t.lastGiven) ? t.lastGiven : '';
    let nextDue = U.isISO(t.nextDue) ? t.nextDue : '';
    if (!nextDue && lastGiven) nextDue = stepForward(lastGiven, every, unit);
    return {
      id: t.id || U.uid('vax'),
      catId: t.catId || null,
      name: String(t.name || 'Vaccination').trim() || 'Vaccination',
      every: every,
      unit: unit,
      lastGiven: lastGiven,
      nextDue: nextDue,
      notes: String(t.notes || ''),
      history: (Array.isArray(t.history) ? t.history : [])
        .filter(function (h) { return h && U.isISO(h.date); })
        .map(function (h) { return { date: h.date, at: h.at || null }; }),
      createdAt: t.createdAt || new Date().toISOString()
    };
  }

  function normVisit(v) {
    v = v || {};
    return {
      id: v.id || U.uid('vet'),
      catId: v.catId || null,
      date: U.isISO(v.date) ? v.date : U.todayISO(),
      time: /^\d{2}:\d{2}$/.test(v.time || '') ? v.time : '',
      reason: String(v.reason || ''),
      notes: String(v.notes || ''),
      media: normMedia(v.media),
      done: !!v.done,
      createdAt: v.createdAt || new Date().toISOString()
    };
  }

  function normDoc(d) {
    const base = defaultDoc();
    d = (d && typeof d === 'object') ? d : {};
    const s = d.settings || {};
    base.updatedAt = d.updatedAt || null;
    base.settings.notifications = !!s.notifications;
    base.settings.lastDailySummary = s.lastDailySummary || null;
    base.settings.lastExport = s.lastExport || null;
    base.cats = (Array.isArray(d.cats) ? d.cats : []).map(normCat);
    base.logs = (Array.isArray(d.logs) ? d.logs : []).map(normLog);
    base.meds = (Array.isArray(d.meds) ? d.meds : []).map(normMed);
    base.doses = (Array.isArray(d.doses) ? d.doses : []).map(normDose);
    base.treatments = (Array.isArray(d.treatments) ? d.treatments : []).map(normTreatment);
    base.vaccinations = (Array.isArray(d.vaccinations) ? d.vaccinations : []).map(normVax);
    base.visits = (Array.isArray(d.visits) ? d.visits : []).map(normVisit);
    return base;
  }

  // ---------- schedule engine ----------
  // one interval forward from a date
  function stepForward(iso, every, unit) {
    if (unit === 'day') return U.addDaysISO(iso, every);
    if (unit === 'week') return U.addDaysISO(iso, every * 7);
    if (unit === 'year') return U.addMonthsISO(iso, every * 12, U.parseISO(iso).getDate());
    return U.addMonthsISO(iso, every, U.parseISO(iso).getDate());
  }

  function intervalLabel(t) {
    return 'Every ' + (t.every === 1 ? '' : t.every + ' ') + t.unit + (t.every === 1 ? '' : 's');
  }

  // { state: 'none'|'ok'|'soon'|'overdue', days, label }
  // soonDays: how far ahead counts as "due soon" (7 for treatments, 14 for vaccinations)
  function dueInfo(t, soonDays) {
    if (!t.nextDue) return { state: 'none', days: null, label: 'No date set' };
    const days = U.daysFromToday(t.nextDue);
    const label = U.dueLabel(t.nextDue);
    if (days < 0) return { state: 'overdue', days: days, label: label };
    if (days <= (soonDays || 7)) return { state: 'soon', days: days, label: label };
    return { state: 'ok', days: days, label: label };
  }

  // ---------- queries: cats ----------
  function allCats() { return doc.cats.slice().sort(byName); }
  function activeCats() { return doc.cats.filter(function (c) { return !c.archived; }).sort(byName); }
  function archivedCats() { return doc.cats.filter(function (c) { return c.archived; }).sort(byName); }
  function getCat(id) { return doc.cats.find(function (c) { return c.id === id; }) || null; }
  function byName(a, b) { return a.name.localeCompare(b.name); }

  // ---------- queries: logs ----------
  function logFor(catId, dateISO) {
    return doc.logs.find(function (l) { return l.catId === catId && l.date === dateISO; }) || null;
  }
  function getLog(id) { return doc.logs.find(function (l) { return l.id === id; }) || null; }
  function recentLogs(daysBack) {
    return logsInRange(U.addDaysISO(U.todayISO(), -(daysBack || 14)), U.todayISO());
  }
  // all logs between two ISO dates inclusive; pass '' for open-ended
  function logsInRange(fromISO, toISO) {
    return doc.logs
      .filter(function (l) {
        return (!fromISO || l.date >= fromISO) && (!toISO || l.date <= toISO);
      })
      .sort(function (a, b) { return a.date === b.date ? a.updatedAt.localeCompare(b.updatedAt) : (a.date < b.date ? 1 : -1); });
  }

  // ---------- queries: meds ----------
  function getMed(id) { return doc.meds.find(function (m) { return m.id === id; }) || null; }
  function medsForCat(catId, activeOnly) {
    return doc.meds.filter(function (m) {
      return m.catId === catId && (!activeOnly || m.active);
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function activeMeds() {
    return doc.meds.filter(function (m) {
      const cat = getCat(m.catId);
      return m.active && cat && !cat.archived;
    });
  }
  function scheduledOn(med, iso) {
    return iso >= med.startDate && (!med.endDate || iso <= med.endDate);
  }
  function doseGiven(medId, iso, slot) {
    return doc.doses.find(function (d) { return d.medId === medId && d.date === iso && d.slot === slot; }) || null;
  }
  // all dose slots scheduled for a date across active meds
  function dosesDue(iso) {
    const rows = [];
    activeMeds().forEach(function (m) {
      if (!scheduledOn(m, iso)) return;
      const cat = getCat(m.catId);
      for (let i = 0; i < m.timesPerDay; i++) {
        rows.push({ med: m, cat: cat, slot: i, time: m.times[i] || '', given: !!doseGiven(m.id, iso, i) });
      }
    });
    rows.sort(function (a, b) {
      const ta = a.time || '99', tb = b.time || '99';
      return ta === tb ? a.cat.name.localeCompare(b.cat.name) : (ta < tb ? -1 : 1);
    });
    return rows;
  }
  function remainingToday() {
    return dosesDue(U.todayISO()).filter(function (r) { return !r.given; }).length;
  }

  // ---------- queries: treatments ----------
  function getTreatment(id) { return doc.treatments.find(function (t) { return t.id === id; }) || null; }
  function treatmentsForCat(catId) {
    return doc.treatments.filter(function (t) { return t.catId === catId; })
      .sort(function (a, b) { return (a.nextDue || '9999') < (b.nextDue || '9999') ? -1 : 1; });
  }
  function catEarliestDue(catId) {
    let best = null;
    treatmentsForCat(catId).forEach(function (t) {
      if (t.nextDue && (!best || t.nextDue < best)) best = t.nextDue;
    });
    return best;
  }
  // overdue + due within 7 days, for active cats, sorted most urgent first
  function treatmentAlerts() {
    const out = [];
    activeCats().forEach(function (c) {
      treatmentsForCat(c.id).forEach(function (t) {
        const info = dueInfo(t);
        if (info.state === 'overdue' || info.state === 'soon') out.push({ cat: c, t: t, info: info });
      });
    });
    out.sort(function (a, b) { return a.t.nextDue < b.t.nextDue ? -1 : 1; });
    return out;
  }
  function overdueTreatmentsCount() {
    return treatmentAlerts().filter(function (r) { return r.info.state === 'overdue'; }).length;
  }

  // ---------- queries: vaccinations ----------
  const VAX_SOON_DAYS = 14; // longer heads-up than flea/worm — boosters are booked ahead
  function getVax(id) { return doc.vaccinations.find(function (v) { return v.id === id; }) || null; }
  function vaxForCat(catId) {
    return doc.vaccinations.filter(function (v) { return v.catId === catId; })
      .sort(function (a, b) { return (a.nextDue || '9999') < (b.nextDue || '9999') ? -1 : 1; });
  }
  function catEarliestVaxDue(catId) {
    let best = null;
    vaxForCat(catId).forEach(function (v) {
      if (v.nextDue && (!best || v.nextDue < best)) best = v.nextDue;
    });
    return best;
  }
  // one row per active cat: their next vaccination due (or none) — the all-cats overview
  function vaxOverview() {
    return activeCats().map(function (c) {
      let next = null;
      vaxForCat(c.id).forEach(function (v) {
        if (v.nextDue && (!next || v.nextDue < next.nextDue)) next = v;
      });
      return { cat: c, vax: next, info: next ? dueInfo(next, VAX_SOON_DAYS) : null };
    }).sort(function (a, b) {
      const da = a.vax ? a.vax.nextDue : '9999', db = b.vax ? b.vax.nextDue : '9999';
      return da === db ? a.cat.name.localeCompare(b.cat.name) : (da < db ? -1 : 1);
    });
  }
  // overdue + due within VAX_SOON_DAYS, for active cats
  function vaxAlerts() {
    const out = [];
    activeCats().forEach(function (c) {
      vaxForCat(c.id).forEach(function (v) {
        const info = dueInfo(v, VAX_SOON_DAYS);
        if (info.state === 'overdue' || info.state === 'soon') out.push({ cat: c, t: v, info: info });
      });
    });
    out.sort(function (a, b) { return a.t.nextDue < b.t.nextDue ? -1 : 1; });
    return out;
  }
  function overdueVaxCount() {
    return vaxAlerts().filter(function (r) { return r.info.state === 'overdue'; }).length;
  }

  // ---------- queries: visits ----------
  function getVisit(id) { return doc.visits.find(function (v) { return v.id === id; }) || null; }
  function visitsUpcoming() {
    return doc.visits.filter(function (v) { return !v.done; })
      .sort(function (a, b) { return a.date === b.date ? (a.time || '99').localeCompare(b.time || '99') : (a.date < b.date ? -1 : 1); });
  }
  function visitsPast() {
    return doc.visits.filter(function (v) { return v.done; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function visitsSoonCount() {
    const limit = U.addDaysISO(U.todayISO(), 2);
    return visitsUpcoming().filter(function (v) { return v.date <= limit; }).length;
  }

  function counts() {
    return {
      cats: doc.cats.length, logs: doc.logs.length, meds: doc.meds.length,
      doses: doc.doses.length, treatments: doc.treatments.length,
      vaccinations: doc.vaccinations.length, visits: doc.visits.length
    };
  }
  function isEmpty() {
    const c = counts();
    return !c.cats && !c.logs && !c.meds && !c.treatments && !c.visits;
  }

  // ---------- mutations: cats ----------
  function upsertCat(data) {
    const existing = data.id ? getCat(data.id) : null;
    if (existing) {
      Object.assign(existing, normCat(Object.assign({}, existing, data)));
      save('update cat');
      return existing;
    }
    const c = normCat(data);
    doc.cats.push(c);
    save('add cat');
    return c;
  }
  function setCatArchived(id, archived) {
    const c = getCat(id);
    if (!c) return;
    c.archived = !!archived;
    save(archived ? 'archive cat' : 'restore cat');
  }
  // best-effort removal of attachment files on the server (no-op when serverless)
  function deleteMediaFiles(list) {
    (list || []).forEach(function (m) {
      fetch('api/media/' + encodeURIComponent(m.id), { method: 'DELETE' }).catch(function () { });
    });
  }

  function deleteCat(id) {
    const medIds = {};
    doc.meds.forEach(function (m) { if (m.catId === id) medIds[m.id] = 1; });
    doc.logs.forEach(function (l) { if (l.catId === id) deleteMediaFiles(l.media); });
    doc.visits.forEach(function (v) { if (v.catId === id) deleteMediaFiles(v.media); });
    doc.cats = doc.cats.filter(function (c) { return c.id !== id; });
    doc.logs = doc.logs.filter(function (l) { return l.catId !== id; });
    doc.meds = doc.meds.filter(function (m) { return m.catId !== id; });
    doc.doses = doc.doses.filter(function (d) { return !medIds[d.medId]; });
    doc.treatments = doc.treatments.filter(function (t) { return t.catId !== id; });
    doc.vaccinations = doc.vaccinations.filter(function (t) { return t.catId !== id; });
    doc.visits = doc.visits.filter(function (v) { return v.catId !== id; });
    save('delete cat');
  }

  // ---------- mutations: logs ----------
  function upsertLog(data) {
    const existing = logFor(data.catId, data.date);
    if (existing) {
      const patch = normLog(Object.assign({}, existing, data, { id: existing.id }));
      patch.updatedAt = new Date().toISOString();
      Object.assign(existing, patch);
      save('update log');
      return existing;
    }
    const l = normLog(data);
    doc.logs.push(l);
    save('add log');
    return l;
  }
  function deleteLog(id) {
    const l = getLog(id);
    if (l) deleteMediaFiles(l.media);
    doc.logs = doc.logs.filter(function (x) { return x.id !== id; });
    save('delete log');
  }

  // ---------- mutations: meds ----------
  function addMed(data) {
    const m = normMed(data);
    doc.meds.push(m);
    save('add med');
    return m;
  }
  function updateMed(id, patch) {
    const m = getMed(id);
    if (!m) return null;
    Object.assign(m, normMed(Object.assign({}, m, patch, { id: m.id })));
    save('update med');
    return m;
  }
  function stopMed(id) {
    const m = getMed(id);
    if (!m) return;
    m.active = false;
    if (!m.endDate || m.endDate > U.todayISO()) m.endDate = U.todayISO();
    save('stop med');
  }
  function resumeMed(id) {
    const m = getMed(id);
    if (!m) return;
    m.active = true;
    m.endDate = '';
    save('resume med');
  }
  function deleteMed(id) {
    doc.meds = doc.meds.filter(function (m) { return m.id !== id; });
    doc.doses = doc.doses.filter(function (d) { return d.medId !== id; });
    save('delete med');
  }
  function toggleDose(medId, iso, slot) {
    const existing = doseGiven(medId, iso, slot);
    if (existing) {
      doc.doses = doc.doses.filter(function (d) { return d.id !== existing.id; });
      save('untick dose');
      return null;
    }
    const d = normDose({ medId: medId, date: iso, slot: slot });
    doc.doses.push(d);
    save('tick dose');
    return d;
  }

  // ---------- mutations: treatments ----------
  function addTreatment(data) {
    const t = normTreatment(data);
    doc.treatments.push(t);
    save('add treatment');
    return t;
  }
  function updateTreatment(id, patch) {
    const t = getTreatment(id);
    if (!t) return null;
    const merged = Object.assign({}, t, patch, { id: t.id });
    // if the interval or last-given changed and no explicit next-due was supplied, recalc
    if (!patch.nextDue && merged.lastGiven) {
      merged.nextDue = stepForward(merged.lastGiven, U.clampInt(merged.every, 1, 365, 1), UNITS[merged.unit] ? merged.unit : 'month');
    }
    Object.assign(t, normTreatment(merged));
    save('update treatment');
    return t;
  }
  function deleteTreatment(id) {
    doc.treatments = doc.treatments.filter(function (t) { return t.id !== id; });
    save('delete treatment');
  }
  // tick off a treatment: roll last-given / next-due forward. Returns undo snapshot.
  function markTreatmentGiven(id, dateISO) {
    const t = getTreatment(id);
    if (!t) return null;
    const snap = { lastGiven: t.lastGiven, nextDue: t.nextDue };
    t.lastGiven = dateISO;
    t.nextDue = stepForward(dateISO, t.every, t.unit);
    t.history.push({ date: dateISO, at: new Date().toISOString() });
    t.history.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    save('treatment given');
    return snap;
  }
  function undoTreatmentGiven(id, dateISO, snap) {
    const t = getTreatment(id);
    if (!t || !snap) return;
    const idx = t.history.map(function (h) { return h.date; }).lastIndexOf(dateISO);
    if (idx >= 0) t.history.splice(idx, 1);
    t.lastGiven = snap.lastGiven;
    t.nextDue = snap.nextDue;
    save('undo treatment given');
  }
  function removeHistoryEntry(id, index) {
    const t = getTreatment(id);
    if (!t || !t.history[index]) return;
    t.history.splice(index, 1);
    save('remove history entry');
  }

  // ---------- mutations: vaccinations ----------
  function addVax(data) {
    const v = normVax(data);
    doc.vaccinations.push(v);
    save('add vaccination');
    return v;
  }
  function updateVax(id, patch) {
    const v = getVax(id);
    if (!v) return null;
    const merged = Object.assign({}, v, patch, { id: v.id });
    // if the interval or last-given changed and no explicit next-due was supplied, recalc
    if (!patch.nextDue && merged.lastGiven) {
      merged.nextDue = stepForward(merged.lastGiven, U.clampInt(merged.every, 1, 365, 1), UNITS[merged.unit] ? merged.unit : 'year');
    }
    Object.assign(v, normVax(merged));
    save('update vaccination');
    return v;
  }
  function deleteVax(id) {
    doc.vaccinations = doc.vaccinations.filter(function (v) { return v.id !== id; });
    save('delete vaccination');
  }
  // tick off a vaccination: roll last-given / next-due forward. Returns undo snapshot.
  function markVaxGiven(id, dateISO) {
    const v = getVax(id);
    if (!v) return null;
    const snap = { lastGiven: v.lastGiven, nextDue: v.nextDue };
    v.lastGiven = dateISO;
    v.nextDue = stepForward(dateISO, v.every, v.unit);
    v.history.push({ date: dateISO, at: new Date().toISOString() });
    v.history.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    save('vaccination given');
    return snap;
  }
  function undoVaxGiven(id, dateISO, snap) {
    const v = getVax(id);
    if (!v || !snap) return;
    const idx = v.history.map(function (h) { return h.date; }).lastIndexOf(dateISO);
    if (idx >= 0) v.history.splice(idx, 1);
    v.lastGiven = snap.lastGiven;
    v.nextDue = snap.nextDue;
    save('undo vaccination given');
  }
  function removeVaxHistoryEntry(id, index) {
    const v = getVax(id);
    if (!v || !v.history[index]) return;
    v.history.splice(index, 1);
    save('remove vaccination history entry');
  }

  // ---------- mutations: visits ----------
  function addVisit(data) {
    const v = normVisit(data);
    doc.visits.push(v);
    save('add visit');
    return v;
  }
  function updateVisit(id, patch) {
    const v = getVisit(id);
    if (!v) return null;
    Object.assign(v, normVisit(Object.assign({}, v, patch, { id: v.id })));
    save('update visit');
    return v;
  }
  function deleteVisit(id) {
    const v = getVisit(id);
    if (v) deleteMediaFiles(v.media);
    doc.visits = doc.visits.filter(function (x) { return x.id !== id; });
    save('delete visit');
  }
  function setVisitDone(id, done) {
    const v = getVisit(id);
    if (!v) return;
    v.done = !!done;
    save('visit done');
  }

  function setSettings(patch) {
    Object.assign(doc.settings, patch);
    save('settings');
  }

  // ---------- persistence & sync ----------
  function mirrorLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch (e) { /* storage full/blocked */ }
  }
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController();
    setTimeout(function () { c.abort(); }, ms);
    return c.signal;
  }

  const pushServer = U.debounce(function () {
    if (mode !== 'server') return;
    saveState = 'saving'; emitStatus();
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pendingSave = false;
      saveState = 'idle'; emitStatus();
    }).catch(function (e) {
      console.warn('save failed', e);
      saveState = 'error'; emitStatus();
    });
  }, 400);

  function save(reason) {
    doc.updatedAt = new Date().toISOString();
    pendingSave = true;
    mirrorLocal();
    pushServer();
    emitChange();
  }

  function boot() {
    return fetch('/api/data', { signal: timeoutSignal(2500) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (remote) {
        mode = 'server';
        const local = readLocal();
        const remoteEmpty = !remote || ((remote.cats || []).length === 0 && (remote.logs || []).length === 0);
        const localHasData = local && ((local.cats || []).length > 0 || (local.logs || []).length > 0);
        if (remoteEmpty && localHasData) {
          // first run against a fresh server file — adopt this device's data
          doc = normDoc(local);
          save('migrate local to server');
        } else {
          doc = normDoc(remote);
          mirrorLocal();
        }
        emitStatus();
      })
      .catch(function () {
        mode = 'local';
        const local = readLocal();
        doc = local ? normDoc(local) : defaultDoc();
        emitStatus();
      });
  }

  // adopt newer data saved from another device (called on window focus / timer)
  function refreshFromServer() {
    if (mode !== 'server' || pendingSave) return Promise.resolve(false);
    return fetch('/api/data', { signal: timeoutSignal(4000) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (!remote || !remote.updatedAt) return false;
        if (!doc.updatedAt || remote.updatedAt > doc.updatedAt) {
          doc = normDoc(remote);
          mirrorLocal();
          emitChange();
          return true;
        }
        return false;
      })
      .catch(function () { return false; });
  }

  function serverInfo() {
    return fetch('/api/info', { signal: timeoutSignal(3000) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ---------- import / export ----------
  function exportJSON() {
    return JSON.stringify(doc, null, 2);
  }

  // mode: 'replace' | 'merge' (merge adds records whose id is not already present)
  function importJSON(text, importMode) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cats)) {
      throw new Error('That file does not look like a Whisker Watch backup (no cats list found).');
    }
    const incoming = normDoc(parsed);
    let added = 0;
    if (importMode === 'merge') {
      ['cats', 'logs', 'meds', 'doses', 'treatments', 'vaccinations', 'visits'].forEach(function (key) {
        const seen = {};
        doc[key].forEach(function (r) { seen[r.id] = 1; });
        incoming[key].forEach(function (r) { if (!seen[r.id]) { doc[key].push(r); added++; } });
      });
    } else {
      const settings = doc.settings;
      doc = incoming;
      doc.settings = Object.assign({}, incoming.settings, { notifications: settings.notifications });
      added = incoming.cats.length + incoming.logs.length + incoming.meds.length +
              incoming.treatments.length + incoming.vaccinations.length + incoming.visits.length;
    }
    save('import');
    return added;
  }

  function clearAll() {
    doc.logs.forEach(function (l) { deleteMediaFiles(l.media); });
    doc.visits.forEach(function (v) { deleteMediaFiles(v.media); });
    doc = defaultDoc();
    save('clear all');
  }

  // ---------- sample data ----------
  function hasSample() {
    return doc.cats.some(function (c) { return c.id.indexOf('sample-') === 0; });
  }

  function loadSample() {
    if (hasSample()) return;
    const T = U.todayISO();
    const cats = [
      normCat({ id: 'sample-c1', name: 'Mochi', dob: '2021-03-14', sex: 'female', breed: 'Domestic shorthair', colour: CAT_COLOURS[0], notes: 'Microchipped, desexed. A little shy with strangers.' }),
      normCat({ id: 'sample-c2', name: 'Biscuit', dob: '2019-07-02', sex: 'male', breed: 'Ginger tabby', colour: CAT_COLOURS[4], notes: 'Food-obsessed — watch his weight.', allergies: [{ id: 'sample-a1', substance: 'Penicillin-type antibiotics', severity: 'moderate', reaction: 'Vomiting and facial swelling within an hour of the first dose (2023). Vet switched him to a different class.' }] }),
      normCat({ id: 'sample-c3', name: 'Storm', dob: '2023-11-20', sex: 'female', breed: 'Grey DSH', colour: CAT_COLOURS[2], notes: '' })
    ];
    const meds = [
      normMed({ id: 'sample-m1', catId: 'sample-c1', name: 'Meloxicam', dose: '0.5 mL on food', timesPerDay: 1, times: ['08:00'], startDate: U.addDaysISO(T, -6), notes: 'For arthritis flare — 14-day course from the vet.' }),
      normMed({ id: 'sample-m2', catId: 'sample-c2', name: 'Amoxicillin', dose: '½ tablet (50 mg)', timesPerDay: 2, times: ['08:00', '20:00'], startDate: U.addDaysISO(T, -2), notes: 'With food. Finish the whole course.' })
    ];
    const doses = [];
    // Mochi took her morning dose the last few days; Biscuit had this morning's tablet
    [-3, -2, -1].forEach(function (off, i) {
      doses.push(normDose({ id: 'sample-d' + i, medId: 'sample-m1', date: U.addDaysISO(T, off), slot: 0 }));
    });
    doses.push(normDose({ id: 'sample-d10', medId: 'sample-m2', date: U.addDaysISO(T, -1), slot: 0 }));
    doses.push(normDose({ id: 'sample-d11', medId: 'sample-m2', date: U.addDaysISO(T, -1), slot: 1 }));

    const treatments = [
      normTreatment({ id: 'sample-t1', catId: 'sample-c1', name: 'Bravecto Plus', kind: 'both', every: 2, unit: 'month', lastGiven: U.addDaysISO(T, -25), history: [{ date: U.addDaysISO(T, -25) }] }),
      normTreatment({ id: 'sample-t2', catId: 'sample-c1', name: 'Milbemax', kind: 'worm', every: 3, unit: 'month', lastGiven: U.addDaysISO(T, -88), history: [{ date: U.addDaysISO(T, -88) }] }),
      normTreatment({ id: 'sample-t3', catId: 'sample-c2', name: 'NexGard Spectra', kind: 'both', every: 1, unit: 'month', lastGiven: U.addDaysISO(T, -37), history: [{ date: U.addDaysISO(T, -37) }] }),
      normTreatment({ id: 'sample-t4', catId: 'sample-c2', name: 'Profender', kind: 'worm', every: 3, unit: 'month', lastGiven: U.addDaysISO(T, -30), history: [{ date: U.addDaysISO(T, -30) }] }),
      normTreatment({ id: 'sample-t5', catId: 'sample-c3', name: 'NexGard Spectra', kind: 'both', every: 1, unit: 'month', lastGiven: U.addDaysISO(T, -10), history: [{ date: U.addDaysISO(T, -10) }] })
    ];
    const vaccinations = [
      normVax({ id: 'sample-x1', catId: 'sample-c1', name: 'F3 (core) booster', every: 1, unit: 'year', lastGiven: U.addMonthsISO(T, -11), history: [{ date: U.addMonthsISO(T, -11) }] }),
      normVax({ id: 'sample-x2', catId: 'sample-c2', name: 'F3 (core) booster', every: 3, unit: 'year', lastGiven: U.addMonthsISO(T, -20), history: [{ date: U.addMonthsISO(T, -20) }] }),
      normVax({ id: 'sample-x3', catId: 'sample-c3', name: 'FIV primary course', every: 2, unit: 'week', lastGiven: U.addDaysISO(T, -10), history: [{ date: U.addDaysISO(T, -10) }] })
    ];
    const visits = [
      normVisit({ id: 'sample-v1', catId: 'sample-c3', date: U.addDaysISO(T, 4), time: '14:30', reason: 'Annual vaccination + check-up' }),
      normVisit({ id: 'sample-v2', catId: 'sample-c1', date: U.addDaysISO(T, -6), reason: 'Limping on back leg', notes: 'Mild arthritis. Started Meloxicam, recheck in 2 weeks.', done: true }),
      normVisit({ id: 'sample-v3', catId: 'sample-c2', date: U.addDaysISO(T, -60), reason: 'Dental clean', notes: 'Two teeth removed, recovered well.', done: true })
    ];
    const logs = [
      normLog({ id: 'sample-l1', catId: 'sample-c1', date: U.addDaysISO(T, -1), appetite: 'normal', diet: 'Usual wet food AM, biscuits PM', wellness: 'Moving better on the Meloxicam, happy to jump onto the couch again.', weight: 4.1 }),
      normLog({ id: 'sample-l2', catId: 'sample-c2', date: U.addDaysISO(T, -1), appetite: 'increased', diet: 'Tried the new kidney-support kibble — ate the lot', wellness: 'Bright and bossy as usual.' }),
      normLog({ id: 'sample-l3', catId: 'sample-c3', date: U.addDaysISO(T, -2), appetite: 'reduced', diet: 'Left half her breakfast', wellness: 'Quiet day, slept a lot. Keep an eye on her.', weight: 3.4 })
    ];

    doc.cats = doc.cats.concat(cats);
    doc.meds = doc.meds.concat(meds);
    doc.doses = doc.doses.concat(doses);
    doc.treatments = doc.treatments.concat(treatments);
    doc.vaccinations = doc.vaccinations.concat(vaccinations);
    doc.visits = doc.visits.concat(visits);
    doc.logs = doc.logs.concat(logs);
    save('load sample');
  }

  function removeSample() {
    const isSample = function (r) { return String(r.id).indexOf('sample-') === 0; };
    doc.cats = doc.cats.filter(function (r) { return !isSample(r); });
    doc.logs = doc.logs.filter(function (r) { return !isSample(r); });
    doc.meds = doc.meds.filter(function (r) { return !isSample(r); });
    doc.doses = doc.doses.filter(function (r) { return !isSample(r) && String(r.medId).indexOf('sample-') !== 0; });
    doc.treatments = doc.treatments.filter(function (r) { return !isSample(r); });
    doc.vaccinations = doc.vaccinations.filter(function (r) { return !isSample(r); });
    doc.visits = doc.visits.filter(function (r) { return !isSample(r); });
    save('remove sample');
  }

  // ---------- expose ----------
  window.Store = {
    KINDS: KINDS, UNITS: UNITS, APPETITES: APPETITES, SEVERITIES: SEVERITIES,
    CAT_COLOURS: CAT_COLOURS, VAX_SOON_DAYS: VAX_SOON_DAYS,
    get doc() { return doc; },
    boot: boot, save: save, status: status, refreshFromServer: refreshFromServer, serverInfo: serverInfo,
    onChange: function (f) { changeSubs.push(f); },
    onStatus: function (f) { statusSubs.push(f); },
    // engine
    stepForward: stepForward, intervalLabel: intervalLabel, dueInfo: dueInfo,
    // queries
    allCats: allCats, activeCats: activeCats, archivedCats: archivedCats, getCat: getCat,
    logFor: logFor, getLog: getLog, recentLogs: recentLogs, logsInRange: logsInRange,
    getMed: getMed, medsForCat: medsForCat, activeMeds: activeMeds, scheduledOn: scheduledOn,
    doseGiven: doseGiven, dosesDue: dosesDue, remainingToday: remainingToday,
    getTreatment: getTreatment, treatmentsForCat: treatmentsForCat, catEarliestDue: catEarliestDue,
    treatmentAlerts: treatmentAlerts, overdueTreatmentsCount: overdueTreatmentsCount,
    getVax: getVax, vaxForCat: vaxForCat, catEarliestVaxDue: catEarliestVaxDue,
    vaxOverview: vaxOverview, vaxAlerts: vaxAlerts, overdueVaxCount: overdueVaxCount,
    getVisit: getVisit, visitsUpcoming: visitsUpcoming, visitsPast: visitsPast, visitsSoonCount: visitsSoonCount,
    counts: counts, isEmpty: isEmpty,
    // mutations
    upsertCat: upsertCat, setCatArchived: setCatArchived, deleteCat: deleteCat,
    upsertLog: upsertLog, deleteLog: deleteLog, deleteMediaFiles: deleteMediaFiles,
    addMed: addMed, updateMed: updateMed, stopMed: stopMed, resumeMed: resumeMed, deleteMed: deleteMed, toggleDose: toggleDose,
    addTreatment: addTreatment, updateTreatment: updateTreatment, deleteTreatment: deleteTreatment,
    markTreatmentGiven: markTreatmentGiven, undoTreatmentGiven: undoTreatmentGiven, removeHistoryEntry: removeHistoryEntry,
    addVax: addVax, updateVax: updateVax, deleteVax: deleteVax,
    markVaxGiven: markVaxGiven, undoVaxGiven: undoVaxGiven, removeVaxHistoryEntry: removeVaxHistoryEntry,
    addVisit: addVisit, updateVisit: updateVisit, deleteVisit: deleteVisit, setVisitDone: setVisitDone,
    setSettings: setSettings,
    // data
    exportJSON: exportJSON, importJSON: importJSON, clearAll: clearAll,
    loadSample: loadSample, removeSample: removeSample, hasSample: hasSample
  };
})();
