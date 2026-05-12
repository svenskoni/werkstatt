'use strict';

// ─── Theme Toggle ───────────────────────────────────────────────────────────
(function () {
  const root   = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  let theme    = root.getAttribute('data-theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', theme);

  function updateIcon() {
    if (!toggle) return;
    toggle.innerHTML = theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  updateIcon();
  if (toggle) toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    updateIcon();
  });
})();

// ─── Globales Status-Modal ──────────────────────────────────────────────────
(function () {
  const modal          = document.getElementById('statusModal');
  const modalTitle     = document.getElementById('modalTitle');
  const modalDesc      = document.getElementById('modalDesc');
  const modalConfirm   = document.getElementById('modalConfirm');
  const modalCancel    = document.getElementById('modalCancel');
  const statusNote     = document.getElementById('statusNote');
  const schwereWrap    = document.getElementById('schwereWrap');
  const schwereSelect  = document.getElementById('schwereSelect');
  const reminderWrap   = document.getElementById('reminderWrap');
  const reminderEnabled= document.getElementById('reminderEnabled');
  const reminderFields = document.getElementById('reminderFields');
  const reminderAtInput= document.getElementById('modalReminderAt');
  if (!modal) return;

  const STATUS_LABELS = {
    gesendet: 'Eingegangen', bestaetigt: 'In Bearbeitung',
    erledigt: 'Erledigt',   zurueckgewiesen: 'Zur\u00fcckgewiesen',
  };

  let pendingAction = null;
  let aktSchwereRef = 'normal';

  // Morgen 08:00 im Format "YYYY-MM-DDTHH:MM" (lokale Zeit)
  function defaultReminderTime() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T08:00`;
  }

  // String-Vergleich in lokaler Zeit – vermeidet Timezone-Probleme mit new Date()
  function isFuture(datetimeLocalValue) {
    if (!datetimeLocalValue) return false;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return datetimeLocalValue > nowStr;
  }

  if (reminderEnabled) {
    reminderEnabled.addEventListener('change', () => {
      reminderFields.style.display = reminderEnabled.checked ? '' : 'none';
      if (reminderEnabled.checked && !reminderAtInput.value) {
        reminderAtInput.value = defaultReminderTime();
      }
    });
  }

  function openModal(btn) {
    const target       = btn.dataset.target;
    const mitSchwere   = btn.dataset.mitSchwere === '1';
    const withReminder = btn.dataset.withReminder === '1';
    aktSchwereRef      = btn.dataset.schwere || 'normal';
    const label        = btn.dataset.label || STATUS_LABELS[target] || target;
    const color        = btn.dataset.color || '';

    pendingAction = { id: btn.dataset.id, target };

    modalTitle.textContent     = btn.dataset.title || `${label} best\u00e4tigen`;
    modalDesc.textContent      = btn.dataset.desc  || `St\u00f6rung wird auf \u201e${STATUS_LABELS[target] || target}\u201c gesetzt.`;
    modalConfirm.textContent   = label;
    modalConfirm.style.cssText = color ? `background:${color};color:#fff;border:none` : '';
    modalConfirm.disabled      = false;

    schwereWrap.style.display  = mitSchwere ? '' : 'none';
    if (mitSchwere) schwereSelect.value = aktSchwereRef;

    reminderWrap.style.display        = withReminder ? '' : 'none';
    reminderEnabled.checked           = false;
    reminderFields.style.display      = 'none';
    reminderAtInput.value             = '';
    reminderAtInput.style.borderColor = '';

    statusNote.value = '';
    modal.hidden = false;
    setTimeout(() => (mitSchwere ? schwereSelect : statusNote).focus(), 50);
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.status-change-btn');
    if (btn) openModal(btn);
  });

  modalCancel.addEventListener('click', () => { modal.hidden = true; pendingAction = null; });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.hidden = true; pendingAction = null; } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) { modal.hidden = true; pendingAction = null; }
  });

  modalConfirm.addEventListener('click', async () => {
    if (!pendingAction) return;

    // Reminder-Validierung: nur wenn Checkbox aktiv
    const wantsReminder = reminderEnabled.checked;
    if (wantsReminder && !isFuture(reminderAtInput.value)) {
      reminderAtInput.style.borderColor = 'var(--color-error)';
      reminderAtInput.focus();
      return;
    }
    if (wantsReminder) reminderAtInput.style.borderColor = '';

    const notiz      = statusNote.value.trim() || null;
    const mitSchwere = schwereWrap.style.display !== 'none';
    const payload    = { status: pendingAction.target, notiz };
    if (mitSchwere && schwereSelect.value !== aktSchwereRef) {
      payload.neuSchwere = schwereSelect.value;
    }

    modalConfirm.disabled    = true;
    modalConfirm.textContent = 'Wird gespeichert\u2026';

    try {
      // 1. Status setzen
      const res  = await fetch(`/stoerung/${pendingAction.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        alert('Fehler: ' + (data.error || 'Unbekannt'));
        modalConfirm.disabled    = false;
        modalConfirm.textContent = 'Best\u00e4tigen';
        return;
      }

      // 2. Reminder setzen – geht an eingeloggten Admin (Server löst Username → Mail auf)
      if (wantsReminder) {
        await fetch(`/stoerung/${pendingAction.id}/reminder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminderAt: reminderAtInput.value, reminderTo: '' }),
        }).catch(err => console.warn('[Reminder] Setzen fehlgeschlagen:', err));
      }

      modal.hidden  = true;
      pendingAction = null;
      window.location.reload();
    } catch {
      alert('Netzwerkfehler. Bitte Seite neu laden.');
      modalConfirm.disabled    = false;
      modalConfirm.textContent = 'Best\u00e4tigen';
    }
  });
})();

// ─── Success Flash ──────────────────────────────────────────────────────────
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('success')) return;
  const flash = document.createElement('div');
  flash.className = 'flash flash-success';
  flash.setAttribute('role', 'alert');
  const msgs = {
    created: '\u2713 St\u00f6rung erfolgreich gemeldet und E-Mail gesendet.',
    updated: '\u2713 Status wurde aktualisiert.',
    deleted: '\u2713 St\u00f6rung wurde gel\u00f6scht.',
  };
  flash.innerHTML = `${msgs[params.get('success')] || '\u2713 Gespeichert.'} <button class="flash-close" onclick="this.parentElement.remove()">&#x2715;</button>`;
  document.getElementById('main-content')?.prepend(flash);
  history.replaceState(null, '', location.pathname);
})();
