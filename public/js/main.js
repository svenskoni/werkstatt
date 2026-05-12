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
// Wird von Dashboard-Cards UND der Detail-Seite genutzt.
// Jeder Button braucht die Klasse .status-change-btn und:
//   data-id           = Störungs-ID
//   data-target       = Ziel-Status
//   data-schwere      = aktueller Schweregrad
//   data-mit-schwere  = "1"  → Schwere-Dropdown anzeigen (nur Bestätigen)
//   data-title        = Modal-Überschrift (optional)
//   data-desc         = Modal-Beschreibung (optional)
//   data-label        = Text des Bestätigungs-Buttons (optional)
//   data-color        = CSS-Farbe des Bestätigungs-Buttons (optional)
(function () {
  const modal        = document.getElementById('statusModal');
  const modalTitle   = document.getElementById('modalTitle');
  const modalDesc    = document.getElementById('modalDesc');
  const modalConfirm = document.getElementById('modalConfirm');
  const modalCancel  = document.getElementById('modalCancel');
  const statusNote   = document.getElementById('statusNote');
  const schwereWrap  = document.getElementById('schwereWrap');
  const schwereSelect= document.getElementById('schwereSelect');
  if (!modal) return;

  const STATUS_LABELS = {
    gesendet: 'Eingegangen', bestaetigt: 'In Bearbeitung',
    erledigt: 'Erledigt',   zurueckgewiesen: 'Zurückgewiesen',
  };

  let pendingAction  = null;
  let aktSchwereRef  = 'normal'; // merkt sich den Ausgangswert für Vergleich

  function openModal(btn) {
    const target     = btn.dataset.target;
    const mitSchwere = btn.dataset.mitSchwere === '1';
    aktSchwereRef    = btn.dataset.schwere || 'normal';
    const label      = btn.dataset.label || STATUS_LABELS[target] || target;
    const color      = btn.dataset.color || '';

    pendingAction = { id: btn.dataset.id, target };

    modalTitle.textContent   = btn.dataset.title || `${label} bestätigen`;
    modalDesc.textContent    = btn.dataset.desc  || `Störung wird auf „${STATUS_LABELS[target] || target}" gesetzt.`;
    modalConfirm.textContent = label;
    modalConfirm.style.cssText = color ? `background:${color};color:#fff;border:none` : '';

    schwereWrap.style.display = mitSchwere ? '' : 'none';
    if (mitSchwere) schwereSelect.value = aktSchwereRef;

    statusNote.value = '';
    modal.hidden = false;
    setTimeout(() => (mitSchwere ? schwereSelect : statusNote).focus(), 50);
  }

  // Event-Delegation – funktioniert für Dashboard-Cards + Detail-Seite
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
    const notiz      = statusNote.value.trim() || null;
    const mitSchwere = schwereWrap.style.display !== 'none';
    const payload    = { status: pendingAction.target, notiz };

    // neuSchwere nur senden wenn Dropdown sichtbar UND Wert geändert
    if (mitSchwere && schwereSelect.value !== aktSchwereRef) {
      payload.neuSchwere = schwereSelect.value;
    }

    modalConfirm.disabled    = true;
    modalConfirm.textContent = 'Wird gespeichert…';
    try {
      const res = await fetch(`/stoerung/${pendingAction.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) { window.location.reload(); }
      else { alert('Fehler: ' + (data.error || 'Unbekannt')); }
    } catch { alert('Netzwerkfehler. Bitte Seite neu laden.'); }
    finally {
      modalConfirm.disabled    = false;
      modalConfirm.textContent = 'Bestätigen';
      modal.hidden  = true;
      pendingAction = null;
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
    created: '✓ Störung erfolgreich gemeldet und E-Mail gesendet.',
    updated: '✓ Status wurde aktualisiert.',
    deleted: '✓ Störung wurde gelöscht.',
  };
  flash.innerHTML = `${msgs[params.get('success')] || '✓ Gespeichert.'} <button class="flash-close" onclick="this.parentElement.remove()">&#x2715;</button>`;
  document.getElementById('main-content')?.prepend(flash);
  history.replaceState(null, '', location.pathname);
})();
