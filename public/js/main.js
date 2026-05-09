'use strict';

// ─── Theme Toggle ─────────────────────────────────────────────────────────
(function () {
  const root = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  let theme = root.getAttribute('data-theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', theme);

  function updateIcon() {
    if (!toggle) return;
    toggle.innerHTML = theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  updateIcon();
  if (toggle) {
    toggle.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      updateIcon();
    });
  }
})();

// ─── User Dropdown ────────────────────────────────────────────────────────
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
if (userMenuBtn && userDropdown) {
  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !userDropdown.hidden;
    userDropdown.hidden = open;
    userMenuBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', () => { if (userDropdown) userDropdown.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && userDropdown) userDropdown.hidden = true; });
}

// ─── Status-Modal ─────────────────────────────────────────────────────────
const modal = document.getElementById('statusModal');
const modalDesc = document.getElementById('modalDesc');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');
const statusNote = document.getElementById('statusNote');
let pendingAction = null;
const STATUS_LABELS = { gesendet: 'Eingegangen', bestaetigt: 'In Bearbeitung', erledigt: 'Erledigt' };

document.querySelectorAll('.status-change-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    pendingAction = { id: btn.dataset.id, target: btn.dataset.target };
    if (modalDesc) modalDesc.textContent = `Störung wird auf "${STATUS_LABELS[btn.dataset.target] || btn.dataset.target}" gesetzt.`;
    if (statusNote) statusNote.value = '';
    if (modal) { modal.hidden = false; modal.focus(); }
  });
});
if (modalCancel) modalCancel.addEventListener('click', () => { if (modal) modal.hidden = true; pendingAction = null; });
if (modal) {
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.hidden = true; pendingAction = null; } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) { modal.hidden = true; pendingAction = null; } });
}
if (modalConfirm) {
  modalConfirm.addEventListener('click', async () => {
    if (!pendingAction) return;
    const note = statusNote ? statusNote.value.trim() : '';
    modalConfirm.disabled = true;
    modalConfirm.textContent = 'Wird gespeichert…';
    try {
      const res = await fetch(`/status/${pendingAction.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ newStatus: pendingAction.target, note })
      });
      if (res.ok) { window.location.reload(); }
      else { alert('Fehler beim Speichern. Bitte Seite neu laden.'); }
    } catch (err) { alert('Netzwerkfehler. Bitte Seite neu laden.'); }
    finally {
      modalConfirm.disabled = false;
      modalConfirm.textContent = 'Bestätigen';
      if (modal) modal.hidden = true;
      pendingAction = null;
    }
  });
}

// ─── Success Flash ────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
if (params.has('success')) {
  const flash = document.createElement('div');
  flash.className = 'flash flash-success';
  flash.setAttribute('role', 'alert');
  const msgs = { created: '✓ Störung erfolgreich gemeldet und E-Mail gesendet.', updated: '✓ Status wurde aktualisiert.' };
  flash.innerHTML = `${msgs[params.get('success')] || '✓ Gespeichert.'} <button class="flash-close" onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById('main-content')?.prepend(flash);
  history.replaceState(null, '', location.pathname);
}