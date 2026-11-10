// Drop-down menus (SwiftUI Menu on iOS). Items: {label, detail?, checked?, icon?, action} | {section} | {sep}.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let cleanup = null;

export function closeMenu() {
  const pop = document.getElementById('popover');
  pop.hidden = true;
  pop.innerHTML = '';
  cleanup?.();
  cleanup = null;
}

export function openMenu(anchor, items) {
  closeMenu();
  const pop = document.getElementById('popover');
  const buttons = [];
  for (const item of items) {
    if (item.sep) { pop.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    if (item.section) { pop.insertAdjacentHTML('beforeend', `<div class="menu-section">${esc(item.section)}</div>`); continue; }
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="check">${item.checked ? '✓' : (item.icon ? esc(item.icon) : '')}</span><span>${esc(item.label)}</span>`
      + (item.detail ? `<span class="detail">${esc(item.detail)}</span>` : '');
    b.addEventListener('click', () => { closeMenu(); item.action(); });
    pop.appendChild(b);
    buttons.push({ b, checked: item.checked });
  }
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  const focus = buttons.find((x) => x.checked)?.b ?? buttons[0]?.b;
  focus?.focus({ preventScroll: true });
  focus?.scrollIntoView({ block: 'nearest' });

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); anchor.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = buttons.map((x) => x.b);
      const i = list.indexOf(document.activeElement);
      const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      next?.focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu, { once: true });
  cleanup = () => {
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('keydown', onKey, true);
  };
}
