/* Whisker Watch — app.js
   Router, action dispatcher, nav badges, reminders, boot. Exposes window.App */
(function () {
  'use strict';
  const U = window.U, S = window.Store, UI = window.UI, V = window.Views;

  const ROUTES = ['home', 'cats', 'log', 'meds', 'treatments', 'vaccines', 'vet'];
  const notified = {};          // session-only: which timed doses we've already popped
  let lastDay = U.todayISO();   // for midnight rollover while the app stays open

  function currentRoute() {
    const h = (location.hash || '#/home').replace('#/', '');
    return ROUTES.indexOf(h) >= 0 ? h : 'home';
  }

  function render() {
    const route = currentRoute();
    U.$('#view').innerHTML = V[route]();
    U.$$('#nav .nav-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.route === route);
    });
    refreshBadges();
  }

  function refreshBadges() {
    setBadge('meds', S.remainingToday());
    setBadge('treatments', S.overdueTreatmentsCount());
    setBadge('vaccines', S.overdueVaxCount());
    setBadge('vet', S.visitsSoonCount());
  }
  function setBadge(route, n) {
    const el = U.$('#nav .nav-btn[data-route="' + route + '"] .badge');
    if (!el) return;
    el.textContent = n > 0 ? (n > 9 ? '9+' : n) : '';
    el.classList.toggle('show', n > 0);
  }

  function updateSync(st) {
    const el = U.$('#sync');
    if (!el) return;
    const map = {
      server: ['s-ok', 'Synced'],
      local: ['s-local', 'Local only']
    };
    let cls, label;
    if (st.saveState === 'saving') { cls = 's-saving'; label = 'Saving…'; }
    else if (st.saveState === 'error') { cls = 's-error'; label = 'Save failed'; }
    else { cls = map[st.mode][0]; label = map[st.mode][1]; }
    el.className = 'sync ' + cls;
    el.innerHTML = '<span class="sync-dot"></span>' + label;
    el.title = st.mode === 'server'
      ? 'Saving to your home server — phone and laptop share this data.'
      : 'Data is stored in this browser only. Start the Whisker Watch server to sync devices.';
  }

  // ---------- reminders ----------
  function canNotify() {
    return S.doc.settings.notifications && 'Notification' in window && Notification.permission === 'granted';
  }
  function notify(title, body) {
    try {
      const n = new Notification(title, { body: body, icon: 'icon.svg', badge: 'icon.svg' });
      n.onclick = function () { try { window.focus(); } catch (e) { } n.close(); };
    } catch (e) { /* some platforms need a service worker — in-app chips still show */ }
  }

  function checkTimedDoses() {
    if (!canNotify()) return;
    const today = U.todayISO(), now = U.nowHHMM();
    S.dosesDue(today).forEach(function (r) {
      if (r.given || !r.time || r.time > now) return;
      const key = r.med.id + '|' + today + '|' + r.slot;
      if (notified[key]) return;
      notified[key] = 1;
      notify(r.cat.name + ' — ' + r.med.name,
        (r.med.dose ? r.med.dose + ' · ' : '') + U.fmtTime(r.time) + ' dose is due');
    });
  }

  function dailySummary() {
    if (!canNotify()) return;
    const today = U.todayISO();
    if (S.doc.settings.lastDailySummary === today) return;
    const bits = [];
    const doses = S.dosesDue(today).filter(function (r) { return !r.given; }).length;
    if (doses) bits.push(U.plural(doses, 'dose') + ' to give');
    const overdue = S.overdueTreatmentsCount();
    if (overdue) bits.push(U.plural(overdue, 'treatment') + ' overdue');
    const vaxOverdue = S.overdueVaxCount();
    if (vaxOverdue) bits.push(U.plural(vaxOverdue, 'vaccination') + ' overdue');
    const visits = S.visitsUpcoming().filter(function (v) { return v.date === today; });
    visits.forEach(function (v) {
      const cat = S.getCat(v.catId);
      bits.push('vet for ' + (cat ? cat.name : '?') + (v.time ? ' at ' + U.fmtTime(v.time) : '') );
    });
    S.setSettings({ lastDailySummary: today });
    if (bits.length) notify('Whisker Watch — today', bits.join(' · '));
  }

  function setNotifications(on) {
    if (!on) {
      S.setSettings({ notifications: false });
      V.settingsModal();
      return;
    }
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        S.setSettings({ notifications: true });
        UI.toast('Reminders are on. 🔔');
        dailySummary();
        checkTimedDoses();
      } else {
        S.setSettings({ notifications: false });
        UI.toast('Notifications were not allowed by the browser.', { kind: 'error' });
      }
      V.settingsModal(); // refresh the modal so the toggle reflects reality
    });
  }

  function tick() {
    const today = U.todayISO();
    if (today !== lastDay) {           // past midnight with the app open
      lastDay = today;
      render();
      dailySummary();
    }
    checkTimedDoses();
  }

  // ---------- import / export ----------
  function exportData() {
    const stamp = U.todayISO();
    U.download('whisker-watch-backup-' + stamp + '.json', S.exportJSON());
    S.setSettings({ lastExport: new Date().toISOString() });
    UI.toast('Backup exported — keep it somewhere safe.');
  }

  function importDialog(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.cats)) throw new Error('no cats list');
    } catch (e) {
      UI.toast('That file doesn’t look like a Whisker Watch backup.', { kind: 'error' });
      return;
    }
    const summary = (parsed.cats || []).length + ' cats, ' + (parsed.logs || []).length + ' log entries, ' +
      (parsed.meds || []).length + ' medications, ' + (parsed.treatments || []).length + ' treatments, ' +
      (parsed.visits || []).length + ' vet visits';
    UI.modal({
      title: 'Import backup',
      body: '<p>This file contains <b>' + U.esc(summary) + '</b>.</p>' +
        '<p class="muted small">“Merge” adds anything not already here. “Replace” throws away current data and uses the file instead.</p>' +
        '<div class="modal-foot">' +
        '<button class="btn btn-danger-ghost" id="imp-replace">Replace everything</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary" id="imp-merge">Merge</button>' +
        '</div>',
      onOpen: function (wrap) {
        U.$('#imp-merge', wrap).addEventListener('click', function () {
          const n = S.importJSON(text, 'merge');
          UI.closeModal();
          UI.toast('Merged ' + U.plural(n, 'new record') + ' from the backup.');
        });
        U.$('#imp-replace', wrap).addEventListener('click', function () {
          if (!confirm('Replace ALL current data with this backup? This cannot be undone.')) return;
          S.importJSON(text, 'replace');
          UI.closeModal();
          UI.toast('Backup imported.');
        });
      }
    });
  }

  // ---------- action dispatcher ----------
  function dispatch(el) {
    const act = el.dataset.act;
    const id = el.dataset.id;

    switch (act) {
      case 'nav': location.hash = '#/' + el.dataset.route; break;
      case 'settings-open': V.settingsModal(); break;

      // cats
      case 'cat-add': UI.closeModal(); V.catModal(); break;
      case 'cat-profile': V.catProfileModal(id); break;
      case 'cat-edit': V.catModal(id); break;
      case 'cats-archived-toggle': V.state.showArchived = !V.state.showArchived; render(); break;
      case 'cat-archive-toggle': {
        const cat = S.getCat(id);
        if (!cat) break;
        S.setCatArchived(id, !cat.archived);
        UI.closeModal();
        UI.toast(cat.name + (cat.archived ? ' archived. They stay in your records.' : ' restored.'));
        break;
      }
      case 'cat-delete': {
        const cat = S.getCat(id);
        if (!cat) break;
        if (confirm('Delete ' + cat.name + ' and ALL their records — wellness logs, medications, treatments and vet visits? This cannot be undone.\n\n(Tip: “Archive” keeps their history but hides them.)')) {
          S.deleteCat(id);
          UI.closeModal();
          UI.toast(cat.name + ' deleted.');
        }
        break;
      }

      // daily log
      case 'log-add': V.logModal(el.dataset.cat, el.dataset.date); break;
      case 'log-delete':
        if (confirm('Delete this wellness entry?')) { S.deleteLog(id); UI.closeModal(); }
        break;
      case 'log-prev': V.state.logDate = U.addDaysISO(V.state.logDate, -1); render(); break;
      case 'log-next':
        if (V.state.logDate < U.todayISO()) { V.state.logDate = U.addDaysISO(V.state.logDate, 1); render(); }
        break;
      case 'log-today': V.state.logDate = U.todayISO(); render(); break;
      case 'log-filter': V.state.logFilter = el.dataset.cat; render(); break;
      case 'log-range': V.state.logRange = el.dataset.range; render(); break;

      // meds
      case 'med-add': V.medModal(null, V.state.medFilter !== 'all' ? V.state.medFilter : undefined); break;
      case 'med-edit': V.medModal(id); break;
      case 'med-filter': V.state.medFilter = el.dataset.cat; render(); break;
      case 'med-stop': S.stopMed(id); UI.closeModal(); UI.toast('Course finished — moved to past medications.'); break;
      case 'med-resume': S.resumeMed(id); UI.closeModal(); UI.toast('Medication resumed.'); break;
      case 'med-delete':
        if (confirm('Delete this medication and its tick-off history?')) { S.deleteMed(id); UI.closeModal(); }
        break;
      case 'dose-toggle':
        S.toggleDose(el.dataset.med, el.dataset.date, Number(el.dataset.slot));
        break;

      // treatments
      case 'treat-add': V.treatmentModal(el.dataset.cat); break;
      case 'treat-edit': {
        const t = S.getTreatment(id);
        if (t) V.treatmentModal(t.catId, id);
        break;
      }
      case 'treat-given': V.givenModal(id); break;
      case 'treat-delete':
        if (confirm('Delete this treatment and its history?')) { S.deleteTreatment(id); UI.closeModal(); }
        break;
      case 'treat-hist-del': {
        const t = S.getTreatment(id);
        if (!t) break;
        S.removeHistoryEntry(id, Number(el.dataset.idx));
        V.treatmentModal(t.catId, id); // refresh the open modal
        break;
      }

      // vaccinations
      case 'vax-add': V.vaxModal(el.dataset.cat); break;
      case 'vax-edit': {
        const v = S.getVax(id);
        if (v) V.vaxModal(v.catId, id);
        break;
      }
      case 'vax-given': V.givenModal(id, true); break;
      case 'vax-delete':
        if (confirm('Delete this vaccination and its history?')) { S.deleteVax(id); UI.closeModal(); }
        break;
      case 'vax-hist-del': {
        const v = S.getVax(id);
        if (!v) break;
        S.removeVaxHistoryEntry(id, Number(el.dataset.idx));
        V.vaxModal(v.catId, id); // refresh the open modal
        break;
      }

      // vet
      case 'visit-add': V.visitModal(); break;
      case 'visit-edit': V.visitModal(id); break;
      case 'visit-delete':
        if (confirm('Delete this vet visit?')) { S.deleteVisit(id); UI.closeModal(); }
        break;
      case 'visit-done': {
        S.setVisitDone(id, true);
        UI.toast('Marked as done — it’s now under past visits.', {
          label: 'Undo',
          onAction: function () { S.setVisitDone(id, false); }
        });
        break;
      }

      // attachments
      case 'media-view': UI.lightbox({ id: el.dataset.id, type: el.dataset.type }); break;

      // data
      case 'export-data': exportData(); break;
      case 'import-pick': U.$('#import-file').click(); break;
      case 'erase-all':
        if (confirm('Erase ALL Whisker Watch data — every cat, log, medication, treatment and vet visit?') &&
            confirm('Really erase everything? Consider exporting a backup first.')) {
          S.clearAll();
          UI.closeModal();
          UI.toast('All data erased.');
        }
        break;
      case 'sample-load': S.loadSample(); UI.closeModal(); UI.toast('Sample data loaded — remove it any time in Settings.'); break;
      case 'sample-remove': S.removeSample(); UI.closeModal(); UI.toast('Sample data removed.'); break;
    }
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.matches('input')) return;      // checkboxes/date inputs are handled on 'change'
    dispatch(el);
  });

  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-act]');
    if (!el || !el.matches('input')) return;
    if (el.dataset.act === 'dose-toggle') dispatch(el);
    if (el.dataset.act === 'log-date' && U.isISO(el.value)) {
      V.state.logDate = el.value > U.todayISO() ? U.todayISO() : el.value;
      render();
    }
    // custom history range pickers — keep from <= to and never in the future
    if (el.dataset.act === 'log-range-from' && U.isISO(el.value)) {
      V.state.logFrom = el.value > U.todayISO() ? U.todayISO() : el.value;
      if (V.state.logFrom > V.state.logTo) V.state.logTo = V.state.logFrom;
      render();
    }
    if (el.dataset.act === 'log-range-to' && U.isISO(el.value)) {
      V.state.logTo = el.value > U.todayISO() ? U.todayISO() : el.value;
      if (V.state.logTo < V.state.logFrom) V.state.logFrom = V.state.logTo;
      render();
    }
  });

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    U.$('#import-file').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      f.text().then(importDialog);
    });

    S.onChange(render);
    S.onStatus(updateSync);
    window.addEventListener('hashchange', render);
    window.addEventListener('focus', function () { S.refreshFromServer(); });

    S.boot().then(function () {
      if (!location.hash) location.replace('#/home');
      render();
      updateSync(S.status());
      dailySummary();
      checkTimedDoses();
      setInterval(tick, 30000);
      setInterval(function () { S.refreshFromServer(); }, 90000);
    });
  });

  window.App = { setNotifications: setNotifications, render: render };
})();
