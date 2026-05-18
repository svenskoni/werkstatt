'use strict';

// ─── Theme Toggle ───────────────────────────────────────────────────────
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
  const modal           = document.getElementById('statusModal');
  const modalTitle      = document.getElementById('modalTitle');
  const modalDesc       = document.getElementById('modalDesc');
  const modalConfirm    = document.getElementById('modalConfirm');
  const modalCancel     = document.getElementById('modalCancel');
  const statusNote      = document.getElementById('statusNote');
  const klasseWrap      = document.getElementById('klasseWrap');
  const schwereWrap     = document.getElementById('schwereWrap');
  const schwereSelect   = document.getElementById('schwereSelect');
  const reminderWrap    = document.getElementById('reminderWrap');
  const reminderEnabled = document.getElementById('reminderEnabled');
  const reminderFields  = document.getElementById('reminderFields');
  // fix #50: datetime-local durch Datum + Stunden-Dropdown ersetzt
  const reminderDateInput = document.getElementById('modalReminderDate');
  const reminderHourInput = document.getElementById('modalReminderHour');
  const reminderFeedback  = document.getElementById('modalReminderFeedback');
  if (!modal) return;

  const STATUS_LABELS = {
    gesendet: 'Eingegangen', bestaetigt: 'In Bearbeitung',
    erledigt: 'Erledigt',   zurueckgewiesen: 'Zur\u00fcckgewiesen',
  };

  let pendingAction  = null;
  let aktSchwereRef  = 'normal';
  let aktKlasseRef   = 'kfz';
  let selectedKlasse = 'kfz';

  function pad(n) { return String(n).padStart(2, '0'); }

  // Setzt Datum und Stunde auf sinnvollen Default (morgen 08:00 oder nächste volle Stunde)
  function initReminderDefaults() {
    const now = new Date();
    let defaultDate = new Date(now);
    let defaultHour = now.getHours() + 1;
    if (defaultHour >= 24) {
      defaultDate.setDate(defaultDate.getDate() + 1);
      defaultHour = 8;
    } else if (defaultHour < 8) {
      defaultHour = 8;
    }
    const dateStr = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth()+1)}-${pad(defaultDate.getDate())}`;
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    reminderDateInput.value = dateStr;
    reminderDateInput.min   = todayStr;
    reminderHourInput.value = String(defaultHour);
    if (reminderFeedback) reminderFeedback.textContent = '';
    reminderDateInput.style.borderColor = '';
  }

  // Baut ISO-String aus Datum + Stunde (volle Stunde, Minuten immer :00)
  function buildReminderISO() {
    const dateVal = reminderDateInput.value;
    const hourVal = parseInt(reminderHourInput.value, 10);
    if (!dateVal) return null;
    const parts = dateVal.split('-');
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10),
      hourVal, 0, 0, 0
    );
  }

  // Prüft ob gewählte Zeit >= 1 Stunde in der Zukunft liegt
  function isValidFutureHour() {
    const dt = buildReminderISO();
    if (!dt) return false;
    return dt.getTime() > Date.now() + 59 * 60 * 1000;
  }

  function setKlasseActive(val) {
    document.querySelectorAll('.klasse-modal-btn').forEach(b => {
      const active = b.dataset.value === val;
      b.style.borderColor = active ? 'var(--color-primary)' : 'var(--color-border)';
      b.style.background  = active ? 'color-mix(in oklch, var(--color-primary) 8%, var(--color-surface))' : 'var(--color-surface)';
      b.style.fontWeight  = active ? '700' : '400';
    });
  }

  document.querySelectorAll('.klasse-modal-btn').forEach(b => {
    b.addEventListener('click', () => {
      selectedKlasse = b.dataset.value;
      setKlasseActive(selectedKlasse);
    });
  });

  if (reminderEnabled) {
    reminderEnabled.addEventListener('change', () => {
      reminderFields.style.display = reminderEnabled.checked ? 'block' : 'none';
      if (reminderEnabled.checked) initReminderDefaults();
    });
  }

  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none';  }

  function openModal(btn) {
    const target       = btn.dataset.target;
    const mitSchwere   = btn.dataset.mitSchwere   === '1';
    const mitKlasse    = btn.dataset.mitKlasse    === '1';
    const withReminder = btn.dataset.withReminder === '1';
    aktSchwereRef      = btn.dataset.schwere || 'normal';
    aktKlasseRef       = btn.dataset.klasse  || 'kfz';
    selectedKlasse     = aktKlasseRef;
    const label        = btn.dataset.label || STATUS_LABELS[target] || target;
    const color        = btn.dataset.color || '';

    pendingAction = { id: btn.dataset.id, target };

    modalTitle.textContent     = btn.dataset.title || `${label} best\u00e4tigen`;
    modalDesc.textContent      = btn.dataset.desc  || `St\u00f6rung wird auf \u201e${STATUS_LABELS[target] || target}\u201c gesetzt.`;
    modalConfirm.textContent   = label;
    modalConfirm.style.cssText = color ? `background:${color};color:#fff;border:none` : '';
    modalConfirm.disabled      = false;

    if (mitKlasse) { show(klasseWrap); setKlasseActive(selectedKlasse); }
    else           { hide(klasseWrap); }

    if (mitSchwere) { show(schwereWrap); schwereSelect.value = aktSchwereRef; }
    else            { hide(schwereWrap); }

    if (withReminder) { show(reminderWrap); } else { hide(reminderWrap); }
    reminderEnabled.checked      = false;
    reminderFields.style.display = 'none';
    reminderDateInput.value      = '';
    reminderDateInput.style.borderColor = '';
    if (reminderFeedback) reminderFeedback.textContent = '';

    statusNote.value = '';
    modal.hidden = false;
    setTimeout(() => (mitKlasse ? document.querySelector('.klasse-modal-btn') : mitSchwere ? schwereSelect : statusNote).focus(), 50);
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

    const wantsReminder = reminderEnabled.checked;
    if (wantsReminder) {
      if (!reminderDateInput.value) {
        if (reminderFeedback) reminderFeedback.textContent = 'Bitte ein Datum w\u00e4hlen.';
        reminderDateInput.style.borderColor = 'var(--color-error)';
        reminderDateInput.focus();
        return;
      }
      if (!isValidFutureHour()) {
        if (reminderFeedback) reminderFeedback.textContent = 'Der Zeitpunkt muss mindestens 1 Stunde in der Zukunft liegen.';
        reminderDateInput.style.borderColor = 'var(--color-error)';
        return;
      }
      reminderDateInput.style.borderColor = '';
      if (reminderFeedback) reminderFeedback.textContent = '';
    }

    const notiz      = statusNote.value.trim() || null;
    const mitSchwere = schwereWrap.style.display === 'block';
    const mitKlasse  = klasseWrap.style.display  === 'block';
    const payload    = { status: pendingAction.target, notiz };

    if (mitSchwere && schwereSelect.value !== aktSchwereRef) {
      payload.neuSchwere = schwereSelect.value;
    }
    if (mitKlasse && selectedKlasse !== aktKlasseRef) {
      payload.neuKlasse = selectedKlasse;
    }

    modalConfirm.disabled    = true;
    modalConfirm.textContent = 'Wird gespeichert\u2026';

    try {
      const res  = await fetch(`/stoerung/${pendingAction.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        alert('Fehler: ' + (data.error || 'Unbekannt'));
        modalConfirm.disabled    = false;
        modalConfirm.textContent = pendingAction.label || 'Best\u00e4tigen';
        return;
      }

      if (wantsReminder) {
        const reminderISO = buildReminderISO().toISOString();
        await fetch(`/stoerung/${pendingAction.id}/reminder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminderAt: reminderISO, reminderTo: '' }),
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
