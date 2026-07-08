/* Whisker Watch — views.js
   Renders the six pages + all modals. Exposes window.Views
   Pages return HTML strings; interaction is wired through data-act attributes
   handled by the dispatcher in app.js. */
(function () {
  'use strict';
  const U = window.U, S = window.Store, UI = window.UI;

  // page-level UI state (survives re-renders, not persisted)
  const state = {
    logDate: U.todayISO(),
    medFilter: 'all',
    logFilter: 'all',
    showArchived: false
  };

  function section(title, body, headExtra) {
    return '<section class="block">' +
      '<div class="block-head"><h2>' + title + '</h2>' + (headExtra || '') + '</div>' +
      body + '</section>';
  }

  function kindChip(t) {
    return '<span class="chip c-kind">' + U.esc(S.KINDS[t.kind] || t.kind) + '</span>';
  }

  function appetiteChip(code) {
    if (!code) return '';
    const cls = { none: 'c-bad', reduced: 'c-warn', normal: 'c-ok', increased: 'c-accent' }[code] || 'c-muted';
    return '<span class="chip ' + cls + '">' + U.esc(S.APPETITES[code]) + '</span>';
  }

  function doseRow(r, dateISO) {
    const label = r.time ? U.fmtTime(r.time) : 'Dose ' + (r.slot + 1);
    return '<label class="dose-row">' +
      '<input type="checkbox" data-act="dose-toggle" data-med="' + r.med.id + '" data-slot="' + r.slot + '" data-date="' + dateISO + '"' + (r.given ? ' checked' : '') + '>' +
      '<span class="tickmark"></span>' +
      UI.avatar(r.cat, 'a-sm') +
      '<span class="dr-main"><b>' + U.esc(r.cat.name) + '</b> — ' + U.esc(r.med.name) +
      '<span class="muted small">' + U.esc(r.med.dose || '') + (r.med.dose ? ' · ' : '') + label + '</span></span>' +
      '</label>';
  }

  // ---------- attachments (photos & videos on logs and vet visits) ----------
  function isVideoFile(f) {
    return (f.type || '').indexOf('video') === 0 || /\.(mp4|m4v|webm|mov)$/i.test(f.name || '');
  }

  function mediaFieldHtml() {
    const server = S.status().mode === 'server';
    return '<div class="field"><span class="f-label">Photos &amp; videos</span>' +
      '<div id="media-items" class="media-items"></div>' +
      (server
        ? '<label class="btn btn-small btn-ghost media-add">📎 Add photo / video' +
          '<input type="file" id="media-file" accept="image/*,video/*" multiple hidden></label>' +
          '<span class="f-hint">Great for odd behaviour you want to show the vet — on a phone this opens the camera roll or lets you record.</span>'
        : '<span class="f-hint">Attachments need the home server — start the app with “Start Whisker Watch.bat” to add photos &amp; videos.</span>') +
      '</div>';
  }

  // Uploads go to the server immediately; the entry keeps only references.
  // New uploads are removed again if the modal is closed without saving,
  // and removals of existing attachments only happen on save.
  function bindMediaField(wrap, initial) {
    const st = { list: (initial || []).slice(), newIds: {}, toDelete: [], uploading: 0, saved: false };
    const box = U.$('#media-items', wrap);
    const input = U.$('#media-file', wrap);

    function draw() {
      let h = st.list.map(function (m, i) {
        const inner = m.type === 'video'
          ? '<span class="mt-ico">🎥</span>'
          : '<img src="api/media/' + encodeURIComponent(m.id) + '" alt="" loading="lazy">';
        return '<span class="m-thumb" data-i="' + i + '" title="' + U.esc(m.name) + '">' + inner +
          '<button type="button" class="mt-x" data-i="' + i + '" aria-label="Remove">✕</button></span>';
      }).join('');
      for (let n = 0; n < st.uploading; n++) h += '<span class="m-thumb m-up" title="Uploading…">↑</span>';
      box.innerHTML = h;
    }

    box.addEventListener('click', function (e) {
      const x = e.target.closest('.mt-x');
      if (x) {
        const m = st.list.splice(Number(x.dataset.i), 1)[0];
        if (st.newIds[m.id]) { delete st.newIds[m.id]; S.deleteMediaFiles([m]); }
        else st.toDelete.push(m);
        draw();
        return;
      }
      const th = e.target.closest('.m-thumb');
      if (th && st.list[Number(th.dataset.i)]) UI.lightbox(st.list[Number(th.dataset.i)]);
    });

    if (input) input.addEventListener('change', function () {
      Array.prototype.slice.call(input.files).forEach(function (f) {
        st.uploading++; draw();
        fetch('api/media?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
              if (!r.ok) throw new Error(j.error || 'upload failed');
              return j;
            });
          })
          .then(function (j) {
            st.uploading--;
            const m = { id: j.id, type: isVideoFile(f) ? 'video' : 'image', name: f.name };
            st.newIds[m.id] = 1;
            st.list.push(m);
            draw();
          })
          .catch(function (err) {
            st.uploading--; draw();
            UI.toast('Upload failed: ' + err.message, { kind: 'error' });
          });
      });
      input.value = '';
    });

    draw();
    return {
      media: function () { return st.list.slice(); },
      busy: function () { return st.uploading > 0; },
      markSaved: function () { st.saved = true; S.deleteMediaFiles(st.toDelete); },
      cleanup: function () {
        if (st.saved) return;
        S.deleteMediaFiles(st.list.filter(function (m) { return st.newIds[m.id]; }));
      }
    };
  }

  // small read-only thumbnail row for cards / lists
  function mediaStrip(media, clickable) {
    if (!media || !media.length) return '';
    const shown = media.slice(0, 4);
    return '<div class="m-strip">' + shown.map(function (m) {
      const inner = m.type === 'video'
        ? '<span class="mt-ico">🎥</span>'
        : '<img src="api/media/' + encodeURIComponent(m.id) + '" alt="" loading="lazy">';
      return clickable
        ? '<button type="button" class="m-thumb m-mini" data-act="media-view" data-id="' + U.esc(m.id) + '" data-type="' + m.type + '" title="' + U.esc(m.name) + '">' + inner + '</button>'
        : '<span class="m-thumb m-mini">' + inner + '</span>';
    }).join('') + (media.length > 4 ? '<span class="m-more">+' + (media.length - 4) + '</span>' : '') + '</div>';
  }

  // ============================== HOME ==============================
  function home() {
    if (!S.doc.cats.length) {
      return UI.empty('🐾', 'Welcome to Whisker Watch',
        'Track your cats’ wellbeing, medications, flea & worming treatments and vet visits — all in one place.',
        '<div class="empty-actions">' +
        '<button class="btn btn-primary" data-act="cat-add">+ Add your first cat</button>' +
        '<button class="btn btn-ghost" data-act="sample-load">Show me with sample data</button>' +
        '</div>');
    }

    const today = U.todayISO();
    const catsList = S.activeCats();
    const doses = S.dosesDue(today);
    const remaining = doses.filter(function (r) { return !r.given; }).length;
    const alerts = S.treatmentAlerts();
    const upcoming = S.visitsUpcoming().filter(function (v) { return v.date <= U.addDaysISO(today, 14); });
    const unlogged = catsList.filter(function (c) { return !S.logFor(c.id, today); });

    const bits = [];
    if (remaining) bits.push(U.plural(remaining, 'dose') + ' to give');
    const od = alerts.filter(function (a) { return a.info.state === 'overdue'; }).length;
    if (od) bits.push(U.plural(od, 'treatment') + ' overdue');
    const soon = alerts.length - od;
    if (soon) bits.push(U.plural(soon, 'treatment') + ' due soon');
    const vToday = upcoming.filter(function (v) { return v.date === today; }).length;
    if (vToday) bits.push('vet visit today');
    const summary = bits.length ? bits.join(' · ') : 'Nothing urgent — enjoy the purrs 🐈';

    let html = '<div class="page-head"><h1>' + U.weekdayShort(today) + ' ' + U.fmtDMY(today) + '</h1>' +
      '<p class="muted">' + U.esc(summary) + '</p></div>';

    // medications today
    let medBody;
    if (!doses.length) {
      medBody = '<p class="muted pad-s">No medications scheduled today.</p>';
    } else {
      medBody = '<div class="card">' + doses.map(function (r) { return doseRow(r, today); }).join('') + '</div>';
    }
    html += section('Medications today', medBody,
      remaining ? '<span class="chip c-warn">' + remaining + ' to go</span>' : (doses.length ? '<span class="chip c-ok">All done ✓</span>' : ''));

    // treatments due
    let trBody;
    if (!alerts.length) {
      trBody = '<p class="muted pad-s">All flea & worming treatments are up to date. ✓</p>';
    } else {
      trBody = '<div class="card">' + alerts.map(function (a) {
        return '<div class="card-row">' +
          UI.avatar(a.cat, 'a-sm') +
          '<span class="dr-main"><b>' + U.esc(a.cat.name) + '</b> — ' + U.esc(a.t.name) +
          '<span class="muted small">' + U.esc(S.KINDS[a.t.kind]) + ' · next due ' + U.fmtDMY(a.t.nextDue) + '</span></span>' +
          UI.dueChip(a.t) +
          '<button class="btn btn-small" data-act="treat-given" data-id="' + a.t.id + '">✓ Given</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    html += section('Treatments due', trBody);

    // vet
    if (upcoming.length) {
      html += section('Vet in the next fortnight', '<div class="card">' + upcoming.map(function (v) {
        const cat = S.getCat(v.catId);
        return '<button class="card-row row-btn" data-act="visit-edit" data-id="' + v.id + '">' +
          UI.avatar(cat, 'a-sm') +
          '<span class="dr-main"><b>' + U.esc(cat ? cat.name : '?') + '</b> — ' + U.esc(v.reason || 'Vet visit') +
          '<span class="muted small">' + U.fmtDMY(v.date) + (v.time ? ' · ' + U.fmtTime(v.time) : '') + '</span></span>' +
          '<span class="chip ' + (v.date === today ? 'c-warn' : 'c-muted') + '">' + U.esc(U.relDay(v.date)) + '</span>' +
          '</button>';
      }).join('') + '</div>');
    }

    // wellness check
    let wellBody = '<div class="chip-row pad-s">' + catsList.map(function (c) {
      const done = !S.logFor(c.id, today) ? false : true;
      if (done) return '<span class="chip c-ok">' + U.esc(c.name) + ' ✓</span>';
      return '<button class="chip-btn" data-act="log-add" data-cat="' + c.id + '" data-date="' + today + '">+ ' + U.esc(c.name) + '</button>';
    }).join('') + '</div>';
    html += section('Today’s wellness check', wellBody,
      unlogged.length ? '' : '<span class="chip c-ok">Everyone logged ✓</span>');

    return html;
  }

  // ============================== CATS ==============================
  function cats() {
    const active = S.activeCats();
    const archived = S.archivedCats();

    let html = '<div class="page-head row-between"><h1>My cats</h1>' +
      '<button class="btn btn-primary" data-act="cat-add">+ Add cat</button></div>';

    if (!active.length && !archived.length) {
      return html + UI.empty('🐱', 'No cats yet', 'Add your first cat to start tracking their health.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="cat-add">+ Add a cat</button></div>');
    }

    html += '<div class="cards-grid">' + active.map(function (c) {
      const meta = [U.ageLabel(c.dob), c.sex ? (c.sex === 'female' ? '♀' : '♂') : '', c.breed]
        .filter(Boolean).join(' · ');
      const medCount = S.medsForCat(c.id, true).length;
      const earliest = S.catEarliestDue(c.id);
      const logs = S.doc.logs.filter(function (l) { return l.catId === c.id; });
      let lastLog = '';
      logs.forEach(function (l) { if (l.date > lastLog) lastLog = l.date; });
      return '<button class="cat-card" data-act="cat-edit" data-id="' + c.id + '">' +
        UI.avatar(c, 'a-lg') +
        '<div class="cc-body"><div class="cc-name">' + U.esc(c.name) + '</div>' +
        '<div class="muted small">' + U.esc(meta || '—') + '</div>' +
        '<div class="chip-row">' +
        (medCount ? '<span class="chip c-accent">' + U.plural(medCount, 'med') + '</span>' : '') +
        (earliest ? UI.dueChip({ nextDue: earliest }) : '<span class="chip c-muted">No treatments</span>') +
        '</div>' +
        '<div class="muted small">' + (lastLog ? (lastLog === U.todayISO() ? 'Logged today ✓' : 'Last log ' + U.fmtShort(lastLog)) : 'No wellness logs yet') + '</div>' +
        '</div></button>';
    }).join('') + '</div>';

    if (archived.length) {
      html += '<div class="pad-s"><button class="chip-btn" data-act="cats-archived-toggle">' +
        (state.showArchived ? 'Hide' : 'Show') + ' archived (' + archived.length + ')</button></div>';
      if (state.showArchived) {
        html += '<div class="cards-grid dim">' + archived.map(function (c) {
          return '<button class="cat-card" data-act="cat-edit" data-id="' + c.id + '">' +
            UI.avatar(c, 'a-lg') +
            '<div class="cc-body"><div class="cc-name">' + U.esc(c.name) + '</div>' +
            '<div class="muted small">Archived</div></div></button>';
        }).join('') + '</div>';
      }
    }
    return html;
  }

  function catModal(id) {
    const cat = id ? S.getCat(id) : null;
    const c = cat || { name: '', dob: '', sex: '', breed: '', colour: S.CAT_COLOURS[Math.floor(Math.random() * S.CAT_COLOURS.length)], photo: '', notes: '' };
    const swatches = S.CAT_COLOURS.map(function (col) {
      return '<label class="swatch"><input type="radio" name="colour" value="' + col + '"' + (col === c.colour ? ' checked' : '') + '>' +
        '<span style="background:' + col + '"></span></label>';
    }).join('');

    const body =
      '<form id="cat-form">' +
      UI.field('Name *', '<input name="name" required maxlength="40" value="' + U.esc(c.name) + '" placeholder="e.g. Mochi">') +
      '<div class="field-row">' +
      UI.field('Date of birth', '<input type="date" name="dob" value="' + U.esc(c.dob) + '">') +
      UI.field('Sex', '<select name="sex">' +
        '<option value=""' + (!c.sex ? ' selected' : '') + '>—</option>' +
        '<option value="female"' + (c.sex === 'female' ? ' selected' : '') + '>Female</option>' +
        '<option value="male"' + (c.sex === 'male' ? ' selected' : '') + '>Male</option></select>') +
      '</div>' +
      UI.field('Breed / description', '<input name="breed" maxlength="60" value="' + U.esc(c.breed) + '" placeholder="e.g. Ginger tabby">') +
      UI.field('Colour tag', '<div class="swatches">' + swatches + '</div>') +
      UI.field('Photo (optional)', '<div class="photo-line">' +
        '<span id="photo-preview">' + (c.photo ? '<img class="avatar a-md" src="' + c.photo + '" alt="">' : '<span class="muted small">None</span>') + '</span>' +
        '<input type="file" id="cat-photo" accept="image/*">' +
        (c.photo ? '<button type="button" class="btn btn-small btn-ghost" id="photo-remove">Remove</button>' : '') +
        '</div>') +
      '<input type="hidden" name="photo" value="' + U.esc(c.photo) + '">' +
      UI.field('Notes', '<textarea name="notes" rows="3" placeholder="Microchip no., desexed, allergies, quirks…">' + U.esc(c.notes) + '</textarea>') +
      '<div class="modal-foot">' +
      (cat ? '<button type="button" class="btn btn-ghost" data-act="cat-archive-toggle" data-id="' + cat.id + '">' + (cat.archived ? 'Restore' : 'Archive') + '</button>' +
        '<button type="button" class="btn btn-danger-ghost" data-act="cat-delete" data-id="' + cat.id + '">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div></form>';

    UI.modal({
      title: cat ? 'Edit ' + cat.name : 'Add a cat',
      body: body,
      onOpen: function (wrap) {
        const form = U.$('#cat-form', wrap);
        const photoInput = U.$('#cat-photo', wrap);
        photoInput.addEventListener('change', function () {
          const f = photoInput.files && photoInput.files[0];
          if (!f) return;
          U.fileToDataURL(f, 256).then(function (dataUrl) {
            form.elements.photo.value = dataUrl;
            U.$('#photo-preview', wrap).innerHTML = '<img class="avatar a-md" src="' + dataUrl + '" alt="">';
          }).catch(function (e) { UI.toast(e.message, { kind: 'error' }); });
        });
        const rm = U.$('#photo-remove', wrap);
        if (rm) rm.addEventListener('click', function () {
          form.elements.photo.value = '';
          U.$('#photo-preview', wrap).innerHTML = '<span class="muted small">None</span>';
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          const fd = new FormData(form);
          S.upsertCat({
            id: cat ? cat.id : undefined,
            name: fd.get('name'), dob: fd.get('dob'), sex: fd.get('sex'),
            breed: fd.get('breed'), colour: fd.get('colour'), photo: fd.get('photo'),
            notes: fd.get('notes')
          });
          UI.closeModal();
          UI.toast(cat ? 'Updated ' + fd.get('name') + '.' : 'Welcome, ' + fd.get('name') + '! 🐾');
        });
      }
    });
  }

  // ============================== DAILY LOG ==============================
  function log() {
    const catsList = S.activeCats();
    const d = state.logDate;
    const today = U.todayISO();

    let html = '<div class="page-head row-between"><h1>Daily log</h1></div>';

    if (!catsList.length) {
      return html + UI.empty('📋', 'No cats to log yet', 'Add a cat first, then record appetite, diet and wellbeing each day.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="cat-add">+ Add a cat</button></div>');
    }

    html += '<div class="log-nav card">' +
      '<button class="icon-btn" data-act="log-prev" aria-label="Previous day">‹</button>' +
      '<div class="ln-mid"><input type="date" data-act="log-date" value="' + d + '" max="' + today + '">' +
      '<span class="muted small">' + U.esc(U.relDay(d)) + '</span></div>' +
      '<button class="icon-btn" data-act="log-next" aria-label="Next day"' + (d >= today ? ' disabled' : '') + '>›</button>' +
      (d !== today ? '<button class="btn btn-small btn-ghost" data-act="log-today">Today</button>' : '') +
      '</div>';

    html += '<div class="cards-grid">' + catsList.map(function (c) {
      const entry = S.logFor(c.id, d);
      if (!entry) {
        return '<div class="log-card empty-log">' +
          '<div class="lc-head">' + UI.avatar(c, 'a-md') + '<b>' + U.esc(c.name) + '</b></div>' +
          '<button class="btn btn-ghost" data-act="log-add" data-cat="' + c.id + '" data-date="' + d + '">+ Add entry</button>' +
          '</div>';
      }
      return '<button class="log-card" data-act="log-add" data-cat="' + c.id + '" data-date="' + d + '">' +
        '<div class="lc-head">' + UI.avatar(c, 'a-md') + '<b>' + U.esc(c.name) + '</b>' +
        '<span class="spacer"></span>' + appetiteChip(entry.appetite) + '</div>' +
        (entry.weight ? '<div class="small"><span class="muted">Weight:</span> ' + entry.weight + ' kg</div>' : '') +
        (entry.diet ? '<div class="small"><span class="muted">Diet:</span> ' + U.esc(entry.diet) + '</div>' : '') +
        (entry.wellness ? '<div class="small">' + U.esc(entry.wellness) + '</div>' : '') +
        mediaStrip(entry.media, false) +
        '</button>';
    }).join('') + '</div>';

    // recent entries
    const recent = S.recentLogs(14).filter(function (l) {
      if (state.logFilter !== 'all' && l.catId !== state.logFilter) return false;
      const cat = S.getCat(l.catId);
      return cat && !cat.archived;
    });
    const filters = '<div class="chip-row">' +
      '<button class="chip-btn' + (state.logFilter === 'all' ? ' on' : '') + '" data-act="log-filter" data-cat="all">All</button>' +
      catsList.map(function (c) {
        return '<button class="chip-btn' + (state.logFilter === c.id ? ' on' : '') + '" data-act="log-filter" data-cat="' + c.id + '">' + U.esc(c.name) + '</button>';
      }).join('') + '</div>';

    let recentBody;
    if (!recent.length) {
      recentBody = '<p class="muted pad-s">No entries in the last fortnight.</p>';
    } else {
      recentBody = '<div class="card">' + recent.map(function (l) {
        const cat = S.getCat(l.catId);
        return '<button class="card-row row-btn" data-act="log-add" data-cat="' + l.catId + '" data-date="' + l.date + '">' +
          UI.avatar(cat, 'a-sm') +
          '<span class="dr-main"><b>' + U.esc(cat.name) + '</b> <span class="muted small">' + U.fmtShort(l.date) + '</span>' +
          '<span class="muted small">' + U.esc((l.wellness || l.diet || '').slice(0, 90)) + '</span></span>' +
          (l.media && l.media.length ? '<span class="chip c-muted">' + (l.media.some(function (m) { return m.type === 'video'; }) ? '🎥' : '📎') + ' ' + l.media.length + '</span>' : '') +
          appetiteChip(l.appetite) +
          '</button>';
      }).join('') + '</div>';
    }
    html += section('Last 14 days', filters + recentBody);
    return html;
  }

  function logModal(catId, dateISO) {
    const cat = S.getCat(catId);
    if (!cat) return;
    const entry = S.logFor(catId, dateISO);
    const l = entry || { appetite: '', diet: '', wellness: '', weight: null };

    const appetiteOpts = Object.keys(S.APPETITES).map(function (code) {
      return '<label class="seg-opt"><input type="radio" name="appetite" value="' + code + '"' + (l.appetite === code ? ' checked' : '') + '>' +
        '<span>' + S.APPETITES[code] + '</span></label>';
    }).join('');

    const body =
      '<form id="log-form">' +
      '<div class="modal-cat">' + UI.avatar(cat, 'a-md') + '<b>' + U.esc(cat.name) + '</b>' +
      '<span class="muted">· ' + U.fmtDMY(dateISO) + '</span></div>' +
      UI.field('Appetite', '<div class="seg">' + appetiteOpts + '</div>') +
      UI.field('Diet & food notes', '<textarea name="diet" rows="2" placeholder="What they ate, any diet changes…">' + U.esc(l.diet) + '</textarea>') +
      UI.field('Wellness notes', '<textarea name="wellness" rows="3" placeholder="Energy, behaviour, symptoms, litter box, anything unusual…">' + U.esc(l.wellness) + '</textarea>') +
      UI.field('Weight (kg, optional)', '<input type="number" name="weight" min="0" step="0.01" inputmode="decimal" value="' + (l.weight || '') + '">') +
      mediaFieldHtml() +
      '<div class="modal-foot">' +
      (entry ? '<button type="button" class="btn btn-danger-ghost" data-act="log-delete" data-id="' + entry.id + '">Delete entry</button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div></form>';

    let mf = null;
    UI.modal({
      title: (entry ? 'Edit' : 'Add') + ' wellness entry',
      body: body,
      onClose: function () { if (mf) mf.cleanup(); },
      onOpen: function (wrap) {
        mf = bindMediaField(wrap, l.media);
        U.$('#log-form', wrap).addEventListener('submit', function (e) {
          e.preventDefault();
          if (mf.busy()) { UI.toast('Still uploading — one moment…'); return; }
          const fd = new FormData(e.target);
          mf.markSaved();
          S.upsertLog({
            catId: catId, date: dateISO,
            appetite: fd.get('appetite') || '',
            diet: fd.get('diet'), wellness: fd.get('wellness'), weight: fd.get('weight'),
            media: mf.media()
          });
          UI.closeModal();
          UI.toast('Wellness entry saved for ' + cat.name + '.');
        });
      }
    });
  }

  // ============================== MEDICATIONS ==============================
  function meds() {
    const catsList = S.activeCats();
    let html = '<div class="page-head row-between"><h1>Medications</h1>' +
      (catsList.length ? '<button class="btn btn-primary" data-act="med-add">+ Add medication</button>' : '') +
      '</div>';

    if (!catsList.length) {
      return html + UI.empty('💊', 'No cats yet', 'Add a cat first, then set up their medications with daily tick-offs.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="cat-add">+ Add a cat</button></div>');
    }

    html += '<div class="chip-row">' +
      '<button class="chip-btn' + (state.medFilter === 'all' ? ' on' : '') + '" data-act="med-filter" data-cat="all">All cats</button>' +
      catsList.map(function (c) {
        return '<button class="chip-btn' + (state.medFilter === c.id ? ' on' : '') + '" data-act="med-filter" data-cat="' + c.id + '">' + U.esc(c.name) + '</button>';
      }).join('') + '</div>';

    const active = S.activeMeds().filter(function (m) { return state.medFilter === 'all' || m.catId === state.medFilter; })
      .sort(function (a, b) {
        const ca = S.getCat(a.catId).name, cb = S.getCat(b.catId).name;
        return ca === cb ? a.name.localeCompare(b.name) : ca.localeCompare(cb);
      });

    if (!active.length) {
      html += UI.empty('💊', 'No active medications', 'When a cat starts a medication, add it here — you’ll get a daily tick-off and reminders.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="med-add">+ Add medication</button></div>');
    } else {
      html += '<div class="cards-grid wide-cards">' + active.map(medCard).join('') + '</div>';
    }

    const finished = S.doc.meds.filter(function (m) {
      const cat = S.getCat(m.catId);
      return !m.active && cat && (state.medFilter === 'all' || m.catId === state.medFilter);
    });
    if (finished.length) {
      html += '<details class="finished"><summary>Finished medications (' + finished.length + ')</summary><div class="card">' +
        finished.map(function (m) {
          const cat = S.getCat(m.catId);
          return '<div class="card-row">' + UI.avatar(cat, 'a-sm') +
            '<span class="dr-main"><b>' + U.esc(cat.name) + '</b> — ' + U.esc(m.name) +
            '<span class="muted small">' + U.esc(m.dose || '') + ' · ended ' + (m.endDate ? U.fmtDMY(m.endDate) : '—') + '</span></span>' +
            '<button class="btn btn-small btn-ghost" data-act="med-edit" data-id="' + m.id + '">Edit</button>' +
            '</div>';
        }).join('') + '</div></details>';
    }
    return html;
  }

  function medCard(m) {
    const cat = S.getCat(m.catId);
    const today = U.todayISO();
    const timesLabel = m.times.filter(Boolean).map(U.fmtTime).join(' · ') ||
      (m.timesPerDay === 1 ? 'Once daily' : m.timesPerDay + '× daily');

    // today's tick row
    let ticks = '';
    if (S.scheduledOn(m, today)) {
      ticks = '<div class="ticks">' + Array.apply(null, Array(m.timesPerDay)).map(function (_, i) {
        const given = !!S.doseGiven(m.id, today, i);
        const label = m.times[i] ? U.fmtTime(m.times[i]) : 'Dose ' + (i + 1);
        return '<label class="tick-pill' + (given ? ' done' : '') + '">' +
          '<input type="checkbox" data-act="dose-toggle" data-med="' + m.id + '" data-slot="' + i + '" data-date="' + today + '"' + (given ? ' checked' : '') + '>' +
          '<span>' + (given ? '✓ ' : '') + label + '</span></label>';
      }).join('') + '</div>';
    } else {
      ticks = '<p class="muted small">Not scheduled today (' +
        (today < m.startDate ? 'starts ' + U.fmtDMY(m.startDate) : 'ended ' + U.fmtDMY(m.endDate)) + ')</p>';
    }

    // last-7-days grid
    const days = [];
    for (let n = -6; n <= 0; n++) days.push(U.addDaysISO(today, n));
    let grid = '<div class="dgrid" style="grid-template-columns: repeat(7, 1fr)">';
    grid += days.map(function (d) {
      return '<span class="dg-head' + (d === today ? ' today' : '') + '">' + U.weekdayShort(d).charAt(0) + '</span>';
    }).join('');
    for (let slot = 0; slot < m.timesPerDay; slot++) {
      grid += days.map(function (d) {
        const on = S.scheduledOn(m, d);
        const given = on && !!S.doseGiven(m.id, d, slot);
        let cls = 'dg-cell';
        if (!on) cls += ' off';
        else if (given) cls += ' given';
        else cls += ' missed';
        const title = U.fmtDMY(d) + ' — ' + (m.times[slot] ? U.fmtTime(m.times[slot]) : 'dose ' + (slot + 1)) +
          (!on ? ' (not scheduled)' : given ? ' ✓ given' : ' not ticked');
        return '<button class="' + cls + '" title="' + U.esc(title) + '"' +
          (on ? ' data-act="dose-toggle" data-med="' + m.id + '" data-slot="' + slot + '" data-date="' + d + '"' : ' disabled') + '></button>';
      }).join('');
    }
    grid += '</div>';

    return '<div class="card med-card">' +
      '<div class="mc-head">' + UI.avatar(cat, 'a-md') +
      '<div class="dr-main"><b>' + U.esc(m.name) + '</b><span class="muted small">' + U.esc(cat.name) +
      (m.dose ? ' · ' + U.esc(m.dose) : '') + ' · ' + U.esc(timesLabel) + '</span></div>' +
      '<button class="icon-btn" data-act="med-edit" data-id="' + m.id + '" aria-label="Edit">✎</button></div>' +
      ticks + grid +
      (m.notes ? '<p class="muted small mc-notes">' + U.esc(m.notes) + '</p>' : '') +
      '</div>';
  }

  function medModal(id, presetCatId) {
    const med = id ? S.getMed(id) : null;
    const m = med || {
      catId: presetCatId || (S.activeCats()[0] || {}).id, name: '', dose: '',
      timesPerDay: 1, times: [''], startDate: U.todayISO(), endDate: '', notes: '', active: true
    };

    function timeInputs(per, times) {
      let h = '';
      for (let i = 0; i < per; i++) {
        h += '<label class="field slim"><span class="f-label">Time ' + (i + 1) + ' <span class="muted">(optional — used for reminders)</span></span>' +
          '<input type="time" name="time' + i + '" value="' + U.esc(times[i] || '') + '"></label>';
      }
      return h;
    }

    const body =
      '<form id="med-form">' +
      UI.field('Cat', UI.catSelect('catId', m.catId, med ? S.allCats() : S.activeCats())) +
      UI.field('Medication *', '<input name="name" required maxlength="60" value="' + U.esc(m.name) + '" placeholder="e.g. Meloxicam, Amoxicillin">') +
      UI.field('Dose', '<input name="dose" maxlength="60" value="' + U.esc(m.dose) + '" placeholder="e.g. ½ tablet, 0.5 mL on food">') +
      UI.field('Times per day', '<select name="timesPerDay">' + [1, 2, 3, 4].map(function (n) {
        return '<option value="' + n + '"' + (m.timesPerDay === n ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select>') +
      '<div id="time-inputs">' + timeInputs(m.timesPerDay, m.times) + '</div>' +
      '<div class="field-row">' +
      UI.field('Start date', '<input type="date" name="startDate" value="' + U.esc(m.startDate) + '">') +
      UI.field('End date (optional)', '<input type="date" name="endDate" value="' + U.esc(m.endDate) + '">') +
      '</div>' +
      UI.field('Notes', '<textarea name="notes" rows="2" placeholder="With food, from Dr Chen, finish the course…">' + U.esc(m.notes) + '</textarea>') +
      '<div class="modal-foot">' +
      (med ? (med.active
        ? '<button type="button" class="btn btn-ghost" data-act="med-stop" data-id="' + med.id + '">Finish course</button>'
        : '<button type="button" class="btn btn-ghost" data-act="med-resume" data-id="' + med.id + '">Resume</button>') +
        '<button type="button" class="btn btn-danger-ghost" data-act="med-delete" data-id="' + med.id + '">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div></form>';

    UI.modal({
      title: med ? 'Edit medication' : 'Add medication',
      body: body,
      onOpen: function (wrap) {
        const form = U.$('#med-form', wrap);
        form.elements.timesPerDay.addEventListener('change', function () {
          const per = Number(form.elements.timesPerDay.value);
          const current = [];
          for (let i = 0; i < 4; i++) {
            const el = form.elements['time' + i];
            current.push(el ? el.value : '');
          }
          U.$('#time-inputs', wrap).innerHTML = timeInputs(per, current);
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          const fd = new FormData(form);
          const per = Number(fd.get('timesPerDay'));
          const times = [];
          for (let i = 0; i < per; i++) times.push(fd.get('time' + i) || '');
          const data = {
            catId: fd.get('catId'), name: fd.get('name'), dose: fd.get('dose'),
            timesPerDay: per, times: times,
            startDate: fd.get('startDate'), endDate: fd.get('endDate'), notes: fd.get('notes')
          };
          if (med) S.updateMed(med.id, data); else S.addMed(data);
          UI.closeModal();
          UI.toast('Saved ' + fd.get('name') + '.');
        });
      }
    });
  }

  // ============================== TREATMENTS ==============================
  function treatments() {
    const catsList = S.activeCats();
    let html = '<div class="page-head"><h1>Flea, worming & parasite treatments</h1>' +
      '<p class="muted">Tick a treatment off when it’s given and the next due date rolls forward automatically. Up to ' + S.MAX_TREATMENTS + ' per cat, each with its own schedule.</p></div>';

    if (!catsList.length) {
      return html + UI.empty('🪱', 'No cats yet', 'Add a cat first, then set up their flea and worming schedules.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="cat-add">+ Add a cat</button></div>');
    }

    const blocks = catsList.map(function (c) {
      return { cat: c, list: S.treatmentsForCat(c.id), earliest: S.catEarliestDue(c.id) };
    }).sort(function (a, b) {
      return (a.earliest || '9999') < (b.earliest || '9999') ? -1 : 1;
    });

    html += blocks.map(function (b) {
      let rows;
      if (!b.list.length) {
        rows = '<p class="muted pad-s">No treatments yet.</p>';
      } else {
        rows = b.list.map(function (t) {
          return '<div class="treat-row">' +
            '<div class="tr-main"><b>' + U.esc(t.name) + '</b> ' + kindChip(t) +
            '<div class="muted small">' + U.esc(S.intervalLabel(t)) + ' · Last given: ' + (t.lastGiven ? U.fmtDMY(t.lastGiven) : '—') + '</div></div>' +
            '<div class="tr-due">' + UI.dueChip(t) +
            '<div class="muted small">' + (t.nextDue ? U.fmtDMY(t.nextDue) : 'no date') + '</div></div>' +
            '<div class="tr-actions">' +
            '<button class="btn btn-small" data-act="treat-given" data-id="' + t.id + '">✓ Given</button>' +
            '<button class="icon-btn" data-act="treat-edit" data-id="' + t.id + '" aria-label="Edit">✎</button>' +
            '</div></div>';
        }).join('');
      }
      const addBtn = b.list.length < S.MAX_TREATMENTS
        ? '<button class="btn btn-small btn-ghost" data-act="treat-add" data-cat="' + b.cat.id + '">+ Add treatment (' + b.list.length + ' of ' + S.MAX_TREATMENTS + ')</button>'
        : '';
      return '<section class="card treat-card">' +
        '<div class="tc-head">' + UI.avatar(b.cat, 'a-md') + '<b>' + U.esc(b.cat.name) + '</b>' +
        '<span class="spacer"></span>' + addBtn + '</div>' + rows + '</section>';
    }).join('');

    return html;
  }

  function treatmentModal(catId, id) {
    const t = id ? S.getTreatment(id) : null;
    const v = t || { catId: catId, name: '', kind: 'flea', every: 1, unit: 'month', lastGiven: '', nextDue: '', notes: '', history: [] };
    const cat = S.getCat(v.catId);

    const kindOpts = Object.keys(S.KINDS).map(function (k) {
      return '<option value="' + k + '"' + (v.kind === k ? ' selected' : '') + '>' + S.KINDS[k] + '</option>';
    }).join('');
    const unitOpts = ['day', 'week', 'month'].map(function (u) {
      return '<option value="' + u + '"' + (v.unit === u ? ' selected' : '') + '>' + u + (u === 'day' ? 's' : 's') + '</option>';
    }).join('');

    let history = '';
    if (t && t.history.length) {
      history = UI.field('History', '<div class="hist">' + t.history.slice().reverse().map(function (h, ri) {
        const idx = t.history.length - 1 - ri;
        return '<span class="chip c-muted hist-chip">' + U.fmtDMY(h.date) +
          ' <button type="button" class="hist-x" data-act="treat-hist-del" data-id="' + t.id + '" data-idx="' + idx + '" aria-label="Remove">✕</button></span>';
      }).join('') + '</div>', 'Removing a history entry doesn’t change the due dates above.');
    }

    const body =
      '<form id="treat-form">' +
      '<div class="modal-cat">' + UI.avatar(cat, 'a-md') + '<b>' + U.esc(cat ? cat.name : '?') + '</b></div>' +
      UI.field('Treatment *', '<input name="name" required maxlength="60" value="' + U.esc(v.name) + '" placeholder="e.g. Bravecto, Milbemax, NexGard">') +
      UI.field('Type', '<select name="kind">' + kindOpts + '</select>') +
      UI.field('Repeat every', '<div class="field-row tight">' +
        '<input type="number" name="every" min="1" max="365" required value="' + v.every + '">' +
        '<select name="unit">' + unitOpts + '</select></div>') +
      '<div class="field-row">' +
      UI.field('Last given', '<input type="date" name="lastGiven" value="' + U.esc(v.lastGiven) + '">') +
      UI.field('Next due', '<input type="date" name="nextDue" value="' + U.esc(v.nextDue) + '">') +
      '</div>' +
      '<p class="f-hint">Leave “next due” blank and it’s worked out from “last given” + the repeat interval.</p>' +
      UI.field('Notes', '<textarea name="notes" rows="2" placeholder="Brand, dose size, where you buy it…">' + U.esc(v.notes) + '</textarea>') +
      history +
      '<div class="modal-foot">' +
      (t ? '<button type="button" class="btn btn-danger-ghost" data-act="treat-delete" data-id="' + t.id + '">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div></form>';

    UI.modal({
      title: t ? 'Edit treatment' : 'Add treatment',
      body: body,
      onOpen: function (wrap) {
        U.$('#treat-form', wrap).addEventListener('submit', function (e) {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = {
            catId: v.catId, name: fd.get('name'), kind: fd.get('kind'),
            every: fd.get('every'), unit: fd.get('unit'),
            lastGiven: fd.get('lastGiven'), nextDue: fd.get('nextDue'), notes: fd.get('notes')
          };
          try {
            if (t) S.updateTreatment(t.id, data); else S.addTreatment(data);
            UI.closeModal();
            UI.toast('Saved ' + fd.get('name') + '.');
          } catch (err) {
            UI.toast(err.message, { kind: 'error' });
          }
        });
      }
    });
  }

  function givenModal(treatId) {
    const t = S.getTreatment(treatId);
    if (!t) return;
    const cat = S.getCat(t.catId);
    const today = U.todayISO();

    const body =
      '<form id="given-form">' +
      '<div class="modal-cat">' + UI.avatar(cat, 'a-md') + '<b>' + U.esc(cat ? cat.name : '?') + '</b>' +
      '<span class="muted">· ' + U.esc(t.name) + '</span></div>' +
      UI.field('Given on', '<input type="date" name="date" required value="' + today + '" max="' + today + '">') +
      '<p class="f-hint" id="next-preview">Next due will be <b>' + U.fmtDMY(S.stepForward(today, t.every, t.unit)) + '</b> (' + S.intervalLabel(t).toLowerCase() + ').</p>' +
      '<div class="modal-foot"><span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">✓ Mark as given</button>' +
      '</div></form>';

    UI.modal({
      title: 'Tick off ' + t.name,
      body: body,
      onOpen: function (wrap) {
        const form = U.$('#given-form', wrap);
        form.elements.date.addEventListener('change', function () {
          const d = form.elements.date.value;
          if (U.isISO(d)) {
            U.$('#next-preview', wrap).innerHTML = 'Next due will be <b>' + U.fmtDMY(S.stepForward(d, t.every, t.unit)) + '</b> (' + S.intervalLabel(t).toLowerCase() + ').';
          }
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          const d = form.elements.date.value;
          if (!U.isISO(d)) return;
          const snap = S.markTreatmentGiven(t.id, d);
          UI.closeModal();
          UI.toast(t.name + ' given to ' + (cat ? cat.name : '?') + ' — next due ' + U.fmtDMY(S.getTreatment(t.id).nextDue) + '.', {
            label: 'Undo',
            onAction: function () { S.undoTreatmentGiven(t.id, d, snap); }
          });
        });
      }
    });
  }

  // ============================== VET ==============================
  function vet() {
    const catsList = S.activeCats();
    let html = '<div class="page-head row-between"><h1>Vet visits</h1>' +
      (catsList.length ? '<button class="btn btn-primary" data-act="visit-add">+ Add appointment</button>' : '') +
      '</div>';

    if (!catsList.length && !S.doc.visits.length) {
      return html + UI.empty('🩺', 'No cats yet', 'Add a cat first, then keep track of appointments and past visits.',
        '<div class="empty-actions"><button class="btn btn-primary" data-act="cat-add">+ Add a cat</button></div>');
    }

    const today = U.todayISO();
    const upcoming = S.visitsUpcoming();
    let upBody;
    if (!upcoming.length) {
      upBody = '<p class="muted pad-s">No upcoming appointments.</p>';
    } else {
      upBody = '<div class="cards-grid">' + upcoming.map(function (v) {
        const cat = S.getCat(v.catId);
        const past = v.date < today;
        return '<div class="card visit-card' + (past ? ' overdue' : '') + '">' +
          '<div class="vc-when"><b>' + U.fmtDMY(v.date) + '</b>' + (v.time ? ' · ' + U.fmtTime(v.time) : '') +
          '<span class="chip ' + (past ? 'c-bad' : v.date === today ? 'c-warn' : 'c-muted') + '">' + U.esc(U.relDay(v.date)) + '</span></div>' +
          '<div class="vc-who">' + UI.avatar(cat, 'a-sm') + '<b>' + U.esc(cat ? cat.name : '?') + '</b></div>' +
          '<div>' + U.esc(v.reason || 'Vet visit') + '</div>' +
          (v.notes ? '<div class="muted small">' + U.esc(v.notes) + '</div>' : '') +
          mediaStrip(v.media, true) +
          '<div class="vc-actions">' +
          '<button class="btn btn-small" data-act="visit-done" data-id="' + v.id + '">✓ Done</button>' +
          '<button class="btn btn-small btn-ghost" data-act="visit-edit" data-id="' + v.id + '">Edit</button>' +
          '</div></div>';
      }).join('') + '</div>';
    }
    html += section('Upcoming', upBody);

    const past = S.visitsPast();
    if (past.length) {
      html += section('Past visits', '<div class="card">' + past.map(function (v) {
        const cat = S.getCat(v.catId);
        return '<button class="card-row row-btn" data-act="visit-edit" data-id="' + v.id + '">' +
          UI.avatar(cat, 'a-sm') +
          '<span class="dr-main"><b>' + U.esc(cat ? cat.name : '?') + '</b> — ' + U.esc(v.reason || 'Vet visit') +
          '<span class="muted small">' + U.fmtDMY(v.date) + (v.notes ? ' · ' + U.esc(v.notes.slice(0, 80)) : '') + '</span></span>' +
          (v.media && v.media.length ? '<span class="chip c-muted">' + (v.media.some(function (m) { return m.type === 'video'; }) ? '🎥' : '📎') + ' ' + v.media.length + '</span>' : '') +
          '</button>';
      }).join('') + '</div>');
    }
    return html;
  }

  function visitModal(id) {
    const visit = id ? S.getVisit(id) : null;
    const v = visit || { catId: (S.activeCats()[0] || {}).id, date: U.todayISO(), time: '', reason: '', notes: '', done: false };

    const body =
      '<form id="visit-form">' +
      UI.field('Cat', UI.catSelect('catId', v.catId, visit ? S.allCats() : S.activeCats())) +
      '<div class="field-row">' +
      UI.field('Date *', '<input type="date" name="date" required value="' + U.esc(v.date) + '">') +
      UI.field('Time', '<input type="time" name="time" value="' + U.esc(v.time) + '">') +
      '</div>' +
      UI.field('Reason *', '<input name="reason" required maxlength="120" value="' + U.esc(v.reason) + '" placeholder="e.g. Annual vaccination, dental check">') +
      UI.field('Notes / outcome', '<textarea name="notes" rows="3" placeholder="Diagnosis, weight at the vet, what was prescribed…">' + U.esc(v.notes) + '</textarea>') +
      mediaFieldHtml() +
      UI.field('', '<label class="check-line"><input type="checkbox" name="done"' + (v.done ? ' checked' : '') + '> This visit has happened (move to past visits)</label>') +
      '<div class="modal-foot">' +
      (visit ? '<button type="button" class="btn btn-danger-ghost" data-act="visit-delete" data-id="' + visit.id + '">Delete</button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div></form>';

    let mf = null;
    UI.modal({
      title: visit ? 'Edit vet visit' : 'Add vet appointment',
      body: body,
      onClose: function () { if (mf) mf.cleanup(); },
      onOpen: function (wrap) {
        mf = bindMediaField(wrap, v.media);
        U.$('#visit-form', wrap).addEventListener('submit', function (e) {
          e.preventDefault();
          if (mf.busy()) { UI.toast('Still uploading — one moment…'); return; }
          const fd = new FormData(e.target);
          mf.markSaved();
          const data = {
            catId: fd.get('catId'), date: fd.get('date'), time: fd.get('time') || '',
            reason: fd.get('reason'), notes: fd.get('notes'), done: !!fd.get('done'),
            media: mf.media()
          };
          if (visit) S.updateVisit(visit.id, data); else S.addVisit(data);
          UI.closeModal();
          UI.toast('Vet visit saved.');
        });
      }
    });
  }

  // ============================== SETTINGS ==============================
  function settingsModal() {
    const st = S.status();
    const c = S.counts();
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    const notifOn = S.doc.settings.notifications;

    let permLine;
    if (perm === 'unsupported') permLine = 'This browser doesn’t support notifications.';
    else if (perm === 'denied') permLine = 'Notifications are blocked in your browser settings for this site.';
    else if (notifOn && perm === 'granted') permLine = 'Reminders are on — they pop up while Whisker Watch is open (or when you open it) for due meds, treatments and vet visits.';
    else permLine = 'Turn on to get a pop-up when a timed dose is due and a daily summary of anything overdue.';

    const syncLine = st.mode === 'server'
      ? 'Syncing through your home server — laptop and phone share the same data file (data/cat-data.json), with automatic backups on every save.'
      : 'Stored locally in this browser only. Run “Start Whisker Watch.bat” and open the app through it to sync between devices, or use export/import below.';

    const body =
      '<div class="settings">' +
      '<h3>Sync</h3>' +
      '<p class="muted small">' + U.esc(syncLine) + '</p>' +
      '<h3>Reminders</h3>' +
      '<label class="check-line"><input type="checkbox" id="notif-toggle"' + (notifOn ? ' checked' : '') + (perm === 'unsupported' || perm === 'denied' ? ' disabled' : '') + '> Browser notifications</label>' +
      '<p class="muted small">' + U.esc(permLine) + '</p>' +
      '<h3>Backups</h3>' +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-act="export-data">Export backup</button>' +
      '<button class="btn btn-ghost" data-act="import-pick">Import backup</button>' +
      '</div>' +
      '<p class="muted small">' + (S.doc.settings.lastExport ? 'Last export: ' + U.fmtDMY(S.doc.settings.lastExport.slice(0, 10)) : 'No exports yet — a JSON file you can keep anywhere safe.') +
      (st.mode === 'server' ? ' Photos & videos aren’t inside the JSON — they live in the app’s data\\media folder; copy that folder to back them up.' : '') + '</p>' +
      '<h3>Sample data</h3>' +
      '<div class="btn-row">' +
      (S.hasSample()
        ? '<button class="btn btn-ghost" data-act="sample-remove">Remove sample data</button>'
        : '<button class="btn btn-ghost" data-act="sample-load">Load sample data</button>') +
      '</div>' +
      '<h3>Danger zone</h3>' +
      '<button class="btn btn-danger-ghost" data-act="erase-all">Erase all data</button>' +
      '<p class="muted small about-line">Whisker Watch v1.1 · ' + c.cats + ' cats · ' + c.logs + ' log entries · ' +
      c.meds + ' medications · ' + c.treatments + ' treatments · ' + c.visits + ' vet visits</p>' +
      '</div>';

    UI.modal({
      title: 'Settings',
      body: body,
      onOpen: function (wrap) {
        const toggle = U.$('#notif-toggle', wrap);
        if (toggle) toggle.addEventListener('change', function () {
          window.App.setNotifications(toggle.checked);
        });
      }
    });
  }

  window.Views = {
    state: state,
    home: home, cats: cats, log: log, meds: meds, treatments: treatments, vet: vet,
    catModal: catModal, logModal: logModal, medModal: medModal,
    treatmentModal: treatmentModal, givenModal: givenModal, visitModal: visitModal,
    settingsModal: settingsModal
  };
})();
