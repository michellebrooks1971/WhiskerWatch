/* Whisker Watch — ui.js
   Modal, toast, avatar and small shared components. Exposes window.UI */
(function () {
  'use strict';
  const U = window.U;

  // ---------- modal ----------
  let onCloseCb = null; // one per open modal, fired however it closes

  function modal(opts) {
    closeModal();
    onCloseCb = opts.onClose || null;
    const root = U.$('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML =
      '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + U.esc(opts.title || '') + '">' +
      '  <div class="modal-head">' +
      '    <h2>' + U.esc(opts.title || '') + '</h2>' +
      '    <button type="button" class="icon-btn modal-x" aria-label="Close">✕</button>' +
      '  </div>' +
      '  <div class="modal-body">' + (opts.body || '') + '</div>' +
      '</div>';
    root.appendChild(wrap);
    document.body.classList.add('modal-open');

    wrap.addEventListener('mousedown', function (e) {
      if (e.target === wrap) closeModal();
    });
    U.$('.modal-x', wrap).addEventListener('click', closeModal);

    const first = U.$('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button', wrap);
    if (first && window.matchMedia('(min-width: 741px)').matches) {
      setTimeout(function () { try { first.focus(); } catch (e) { } }, 30);
    }
    if (opts.onOpen) opts.onOpen(wrap);
    return wrap;
  }

  function closeModal() {
    const root = U.$('#modal-root');
    if (root) root.innerHTML = '';
    document.body.classList.remove('modal-open');
    const cb = onCloseCb;
    onCloseCb = null;
    if (cb) { try { cb(); } catch (e) { console.error(e); } }
  }

  // ---------- lightbox (sits above modals, for viewing attachments) ----------
  function lightbox(m) {
    const root = U.$('#lightbox-root');
    const src = 'api/media/' + encodeURIComponent(m.id);
    root.innerHTML =
      '<div class="lb-backdrop">' +
      '<button type="button" class="icon-btn lb-x" aria-label="Close">✕</button>' +
      (m.type === 'video'
        ? '<video src="' + src + '" controls playsinline></video>'
        : '<img src="' + src + '" alt="">') +
      '</div>';
    U.$('.lb-backdrop', root).addEventListener('click', function (e) {
      if (e.target.classList.contains('lb-backdrop') || e.target.closest('.lb-x')) closeLightbox();
    });
  }
  function closeLightbox() {
    const root = U.$('#lightbox-root');
    if (root) root.innerHTML = '';
  }
  function lightboxOpen() {
    const root = U.$('#lightbox-root');
    return !!(root && root.innerHTML);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (lightboxOpen()) closeLightbox();
    else closeModal();
  });

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    const root = U.$('#toast-root');
    root.innerHTML =
      '<div class="toast' + (opts.kind === 'error' ? ' t-error' : '') + '">' +
      '  <span>' + U.esc(msg) + '</span>' +
      (opts.label ? '<button type="button" class="toast-action">' + U.esc(opts.label) + '</button>' : '') +
      '</div>';
    if (opts.label && opts.onAction) {
      U.$('.toast-action', root).addEventListener('click', function () {
        root.innerHTML = '';
        opts.onAction();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { root.innerHTML = ''; }, opts.timeout || 6000);
  }

  // ---------- avatar ----------
  function avatar(cat, size) {
    const cls = 'avatar ' + (size || 'a-md');
    if (!cat) return '<span class="' + cls + '" style="background:#999">?</span>';
    if (cat.photo) return '<img class="' + cls + '" src="' + cat.photo + '" alt="">';
    const initial = (cat.name || '?').trim().charAt(0).toUpperCase();
    return '<span class="' + cls + '" style="background:' + U.esc(cat.colour) + '">' + U.esc(initial) + '</span>';
  }

  // ---------- form field helpers (html strings) ----------
  function field(label, inner, hint) {
    return '<label class="field"><span class="f-label">' + U.esc(label) + '</span>' + inner +
      (hint ? '<span class="f-hint">' + U.esc(hint) + '</span>' : '') + '</label>';
  }

  function catSelect(name, selectedId, cats) {
    const list = cats || window.Store.activeCats();
    return '<select name="' + name + '" required>' +
      list.map(function (c) {
        return '<option value="' + U.esc(c.id) + '"' + (c.id === selectedId ? ' selected' : '') + '>' + U.esc(c.name) + '</option>';
      }).join('') + '</select>';
  }

  function dueChip(t) {
    const info = window.Store.dueInfo(t);
    const cls = { overdue: 'c-bad', soon: 'c-warn', ok: 'c-ok', none: 'c-muted' }[info.state];
    return '<span class="chip ' + cls + '">' + U.esc(info.label) + '</span>';
  }

  function empty(emoji, title, sub, buttonHtml) {
    return '<div class="empty">' +
      '<div class="empty-emoji">' + emoji + '</div>' +
      '<h3>' + U.esc(title) + '</h3>' +
      (sub ? '<p>' + U.esc(sub) + '</p>' : '') +
      (buttonHtml || '') +
      '</div>';
  }

  window.UI = {
    modal: modal, closeModal: closeModal, toast: toast,
    lightbox: lightbox, closeLightbox: closeLightbox,
    avatar: avatar, field: field, catSelect: catSelect, dueChip: dueChip, empty: empty
  };
})();
