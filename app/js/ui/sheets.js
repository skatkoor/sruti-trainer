// Sheets (iOS .sheet) — Settings, History, Exercises + editor, Find my Sa, Results, the beginner guide.
// Ports of SettingsView, HistoryView, ExerciseListView, FindSaView, ResultsView and GuideView. Keep in step.
import {
  Sruti, RAGAS, raga, Swara, noteLabel, parseNotation, BUILT_IN_EXERCISES, centsText, historyDays, startOfDay,
  SaFinder, westernNote, signed,
} from '../music.js';
import { zoneColor, inTuneColor, COLORS } from './palette.js';
import { Recordings } from '../storage.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// MARK: - Sheet manager

export class Sheets {
  constructor(state) {
    this.state = state;
    this.dialog = document.getElementById('sheet');
    this.stack = [];
    this.dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('click', (e) => {
      if (e.target !== this.dialog) return;
      const r = this.dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside && !this.top?.modal) this.close();
    });
  }

  get isOpen() { return this.stack.length > 0; }
  get top() { return this.stack[this.stack.length - 1]; }

  open(name, opts = {}) {
    const view = VIEWS[name](this.state, this, opts);
    view.name = name;
    this.stack.push(view);
    this.build();
  }

  /** Closes the top sheet (back to the one under it, if any). */
  close() {
    const view = this.stack.pop();
    view?.onClose?.();
    if (this.stack.length) this.build();
    else if (this.dialog.open) this.dialog.close();
  }

  closeAll() { while (this.stack.length) this.close(); }

  build() {
    const v = this.top;
    v.syncs = [];
    const d = this.dialog;
    d.innerHTML = '';
    const head = el('div', 'sheet-head');
    const left = el('button', 'btn-text left', esc(v.left?.label ?? ''));
    if (v.left) left.addEventListener('click', v.left.action); else left.style.visibility = 'hidden';
    const right = el('button', 'btn-text right', esc(v.right?.label ?? ''));
    if (v.right) right.addEventListener('click', () => { if (!right.disabled) v.right.action(); }); else right.style.visibility = 'hidden';
    head.append(left, el('h2', null, esc(v.title)), right);
    v.rightButton = right;
    const body = el('div', 'sheet-body');
    d.append(head, body);
    v.body = body;
    v.build(body, v);
    if (!d.open) d.showModal();
    d.scrollTop = 0;
    for (const sync of v.syncs) sync();
    v.refresh?.();
  }

  /** Called on every state change. */
  refresh() {
    const st = this.state;
    if (st.showResults && st.summary && !this.stack.some((v) => v.name === 'results')) this.open('results');
    const v = this.top;
    if (!v) return;
    for (const sync of v.syncs ?? []) sync();
    v.refresh?.();
  }
}

// MARK: - Form controls (bound to state, kept in sync by `syncs`)

function group(title, foot) {
  const g = el('div', 'group');
  if (title) g.append(el('h3', null, esc(title)));
  const card = el('div', 'card');
  g.append(card);
  if (foot) g.append(el('div', 'foot', foot));
  return { g, card };
}

function row(label) {
  const r = el('div', 'row');
  if (label != null) r.append(el('span', 'label', label));
  return r;
}

function toggleRow(v, label, get, set) {
  const r = row(esc(label));
  const sw = el('label', 'switch');
  const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
  input.setAttribute('aria-label', label);
  sw.append(input, el('span'));
  input.addEventListener('change', () => set(input.checked));
  r.append(sw);
  v.syncs.push(() => { input.checked = !!get(); });
  return r;
}

function selectRow(v, label, options, get, set) {
  const r = row(esc(label));
  const s = document.createElement('select');
  s.setAttribute('aria-label', label);
  for (const o of options) s.append(Object.assign(document.createElement('option'), { value: String(o.value), textContent: o.label }));
  s.addEventListener('change', () => set(options.find((o) => String(o.value) === s.value).value));
  r.append(s);
  v.syncs.push(() => { if (document.activeElement !== s) s.value = String(get()); });
  return r;
}

function segmentedRow(v, label, options, get, set) {
  const r = row(label == null ? null : esc(label));
  const seg = el('div', 'segmented');
  if (label == null) seg.style.width = '100%';
  const buttons = options.map((o) => {
    const b = el('button', null, esc(o.label));
    if (label == null) b.style.flex = '1';
    b.addEventListener('click', () => set(o.value));
    seg.append(b);
    return [b, o.value];
  });
  r.append(seg);
  v.syncs.push(() => { for (const [b, val] of buttons) b.classList.toggle('on', get() === val); });
  return r;
}

function sliderRow(v, labelFn, min, max, step, get, set) {
  const r = el('div', 'row col');
  const label = el('span');
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
  input.addEventListener('input', () => set(Number(input.value)));
  r.append(label, input);
  v.syncs.push(() => { label.textContent = labelFn(get()); if (document.activeElement !== input) input.value = String(get()); });
  return r;
}

function stepperRow(v, labelFn, get, set, minFn, maxFn) {
  const r = row('');
  const label = r.querySelector('.label');
  const st = el('span', 'stepper');
  const minus = el('button', null, '−'), plus = el('button', null, '+');
  minus.addEventListener('click', () => set(Math.max(minFn(), get() - 1)));
  plus.addEventListener('click', () => set(Math.min(maxFn(), get() + 1)));
  st.append(minus, plus);
  r.append(st);
  v.syncs.push(() => { label.textContent = labelFn(get()); minus.disabled = get() <= minFn(); plus.disabled = get() >= maxFn(); });
  return r;
}

function valueRow(v, label, valueFn) {
  const r = row(esc(label));
  const val = el('span', 'value');
  r.append(val);
  v.syncs.push(() => { val.textContent = valueFn(); });
  return r;
}

function linkRow(label, action) {
  const r = row(null);
  const b = el('button', 'link', label);
  b.addEventListener('click', action);
  r.append(b);
  return r;
}

const noteOptions = (descending) => {
  const out = [];
  for (let m = Sruti.noteRange[0]; m <= Sruti.noteRange[1]; m++) out.push({ value: m, label: `${Sruti.westernName(m)}  ·  kattai ${Sruti.kattaiName(m)}` });
  return descending ? out.reverse() : out;
};

// MARK: - Views

const VIEWS = {
  // ----------------------------------------------------------------- Settings
  settings(st, sheets) {
    const S = (fn) => st.updateSettings(fn);
    return {
      title: 'Settings',
      right: { label: 'Done', action: () => sheets.close() },
      build(body, v) {
        let { g, card } = group('Sa (sruti)');
        card.append(
          selectRow(v, 'Note', noteOptions(false), () => st.settings.sruti.midiNote, (m) => S((s) => { s.sruti.midiNote = m; })),
          sliderRow(v, (x) => `Fine-tune: ${signed(x)}¢`, -50, 50, 1, () => st.settings.sruti.fineTuneCents, (x) => S((s) => { s.sruti.fineTuneCents = x; })),
          valueRow(v, 'Sa frequency', () => `${st.saHz.toFixed(2)} Hz`),
          linkRow('🎙 Find my Sa…', () => sheets.open('findSa')),
        );
        body.append(g);

        ({ g, card } = group('Swaras'));
        card.append(
          segmentedRow(v, null, [{ value: 'just', label: 'Just' }, { value: 'equal', label: 'Equal' }], () => st.settings.intonation, (x) => S((s) => { s.intonation = x; })),
          selectRow(v, 'Raga', RAGAS.map((r) => ({ value: r.id, label: r.name })), () => st.settings.ragaID, (x) => S((s) => { s.ragaID = x; })),
          valueRow(v, '', () => raga(st.settings.ragaID).swaras.map((x) => Swara.notationLabel(x, 0)).join(' ')),
        );
        body.append(g);

        ({ g, card } = group('Tolerance', 'Inside green = in tune. Beyond yellow = red.'));
        card.append(
          stepperRow(v, (x) => `Green: ±${x}¢`, () => st.settings.tolerance.green, (x) => S((s) => { s.tolerance.green = x; }), () => 3, () => 25),
          stepperRow(v, (x) => `Yellow: ±${x}¢`, () => st.settings.tolerance.yellow, (x) => S((s) => { s.tolerance.yellow = x; }), () => st.settings.tolerance.green + 1, () => 60),
        );
        body.append(g);

        ({ g, card } = group('Tanpura', 'When the tanpura plays from a speaker — the laptop’s own, a Bluetooth speaker or a monitor — Sruti Trainer subtracts its own tanpura from what the mic hears, so only your voice is measured, even when you sing Sa or Pa with it. Not needed with wired headphones; harmless with AirPods.'));
        card.append(
          selectRow(v, 'Sound', [{ value: 'smooth', label: 'Smooth' }, { value: 'plucked', label: 'Plucked' }], () => st.settings.droneStyle, (x) => S((s) => { s.droneStyle = x; })),
          segmentedRow(v, 'First string', [{ value: 'pa', label: 'Pa' }, { value: 'ma', label: 'Ma' }], () => st.settings.droneFirstString, (x) => S((s) => { s.droneFirstString = x; })),
          selectRow(v, 'Octave', [{ value: 'traditional', label: 'Traditional (.P S S .S)' }, { value: 'high', label: "High (P S' S' S)" }], () => st.settings.droneOctave, (x) => S((s) => { s.droneOctave = x; })),
          toggleRow(v, 'Remove tanpura from the mic', () => st.settings.echoCancel, (x) => S((s) => { s.echoCancel = x; })),
        );
        body.append(g);

        ({ g, card } = group('Exercises', 'Strict mode also scores steadiness — for Sarali-style plain notes. Leave it off when singing gamakas. Blind mode hides your pitch while you sing and shows it when you pause — it trains your ear, not just your eyes.'));
        card.append(
          sliderRow(v, (x) => `Guided: hold ${x.toFixed(1)} s per count`, 0.3, 1.5, 0.1, () => st.settings.guidedHoldSeconds, (x) => S((s) => { s.guidedHoldSeconds = Math.round(x * 10) / 10; })),
          toggleRow(v, 'Plain notes (strict)', () => st.settings.strictPlainNotes, (x) => S((s) => { s.strictPlainNotes = x; })),
          toggleRow(v, 'Blind mode', () => st.settings.blindMode, (x) => S((s) => { s.blindMode = x; })),
        );
        body.append(g);

        ({ g, card } = group('Display'));
        card.append(
          toggleRow(v, 'Show Hz error', () => st.settings.showHz, (x) => S((s) => { s.showHz = x; })),
          selectRow(v, 'Graph range', [{ value: 'auto', label: 'Auto (zooms to your singing)' }, { value: 'full', label: 'Full (−500…+1500¢)' }], () => st.settings.graphRange, (x) => S((s) => { s.graphRange = x; })),
          toggleRow(v, 'Show diagnostics line', () => st.settings.showDiagnostics, (x) => S((s) => { s.showDiagnostics = x; })),
        );
        body.append(g);

        ({ g, card } = group('Diagnostics', 'If the line did something odd, come here straight away and download the last 30 seconds — it’s exactly what the microphone heard. “Record each session” saves whole sessions in this browser (listed below). Click a recording to replay it through the pitch display instead of the mic.'));
        const recent = row(null);
        const recentBtn = el('button', 'link', '⬇ Download the last 30 seconds');
        const recentNote = el('span', 'value');
        recentBtn.addEventListener('click', async () => {
          const r = await st.exportRecentAudio();
          if (r) { download(r.blob, r.name); recentNote.textContent = ''; } else recentNote.textContent = 'Nothing heard yet — press Start, sing, then come back here.';
        });
        recent.append(recentBtn, recentNote);
        card.append(recent, toggleRow(v, 'Record each session', () => st.settings.recordSessions, (x) => S((s) => { s.recordSessions = x; })));
        card.append(linkRow('▶ Demo: Sarali 1 (Sa = D3)', () => {
          sheets.closeAll();
          st.startReplay('test-sarali-1-D3', fetch('demo/test-sarali-1-D3.wav').then((r) => r.arrayBuffer()));
        }));
        const fileRow = row(null);
        const fileBtn = el('button', 'link', '▶ Replay a WAV file…');
        const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*,.wav', hidden: true });
        fileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          const f = fileInput.files[0];
          if (!f) return;
          sheets.closeAll();
          st.startReplay(f.name.replace(/\.[^.]+$/, ''), f.arrayBuffer());
        });
        fileRow.append(fileBtn, fileInput);
        card.append(fileRow);
        const recList = el('div');
        card.append(recList);
        body.append(g);
        const loadRecordings = async () => {
          const list = await Recordings.list();
          recList.innerHTML = '';
          for (const rec of list) {
            const r = row(null);
            const play = el('button', 'link', `▶ ${esc(rec.name)}`);
            play.style.flex = '1';
            play.addEventListener('click', () => { sheets.closeAll(); st.startReplay(rec.name, rec.mic.arrayBuffer()); });
            const dl = el('button', 'link', '⬇');
            dl.title = 'Download (with the tanpura as played, if any)';
            dl.addEventListener('click', () => {
              download(rec.mic, `${rec.name}.wav`);
              if (rec.ref) setTimeout(() => download(rec.ref, `${rec.name} tanpura lag ${rec.lag}.wav`), 300);
            });
            const del = el('button', 'link danger', '🗑');
            del.title = 'Delete recording';
            del.addEventListener('click', async () => {
              if (!confirm(`Delete “${rec.name}”? This can’t be undone.`)) return;
              await Recordings.remove(rec.id);
              loadRecordings();
            });
            r.append(play, dl, del);
            recList.append(r);
          }
        };
        loadRecordings();
      },
    };
  },

  // ----------------------------------------------------------------- Find my Sa
  findSa(st, sheets) {
    let finished = null;
    let phase = null;
    return {
      title: 'Find my Sa',
      left: { label: 'Close', action: () => sheets.close() },
      modal: true,
      onClose() { if (st.saFinder) st.cancelFindSa(); },
      build(body, v) { v.render(body); },
      render(body) {
        body.innerHTML = '';
        if (finished) {
          phase = 'result';
          const r = finished;
          const suggested = Sruti.westernName(r.suggestedMidi), kattai = Sruti.kattaiName(r.suggestedMidi);
          const current = st.settings.sruti.midiNote;
          body.append(el('div', 'center muted', 'Your comfortable note'),
            el('div', 'big-note', `${esc(r.sung.name)}  ${esc(centsText(r.sung.cents))}`),
            el('div', 'center muted', `${r.medianHz.toFixed(1)} Hz`),
            el('div', 'center', r.sung.midi === r.suggestedMidi
              ? `Suggested Sa: ${suggested} (kattai ${kattai})`
              : `Suggested Sa: ${suggested} (kattai ${kattai}) — same note, moved into the app’s range`));
          if (r.suggestedMidi === current) {
            body.append(el('div', 'center', `<span style="color:${COLORS.inTune}">✓ That’s already your Sa</span>`));
          } else {
            const use = el('button', 'primary-btn', `Use ${suggested} as Sa`);
            use.addEventListener('click', () => { st.applySuggestedSa(r.suggestedMidi); sheets.close(); });
            const keep = el('button', 'secondary-btn', `Keep ${Sruti.westernName(current)}`);
            keep.addEventListener('click', () => sheets.close());
            body.append(use, keep);
          }
          const again = el('button', 'secondary-btn', 'Try again');
          again.addEventListener('click', () => { finished = null; st.startFindSa(); });
          body.append(again);
        } else if (st.saFinder) {
          phase = 'listening';
          body.append(el('div', 'ring', `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.1)" stroke-width="6"/>`
            + `<circle id="ringArc" cx="50" cy="50" r="44" stroke="${COLORS.inTune}" stroke-width="6" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg>`
            + '<div class="inner"><div class="hz" id="ringHz">aaa…</div><div class="muted" id="ringSec">0 / 5 s</div></div>'),
          el('div', 'center muted', 'Keep holding…'));
        } else {
          phase = 'intro';
          body.append(el('p', 'center', 'Sing a relaxed, comfortable “aaa” — not high, not low, the note your voice settles on — and hold it for 5 seconds.'),
            el('p', 'center muted', 'This is only a suggestion. Your teacher’s advice comes first.'));
          const start = el('button', 'primary-btn', 'Start');
          start.addEventListener('click', () => st.startFindSa());
          body.append(start);
        }
      },
      refresh() {
        const f = st.saFinder;
        if (f && f.isComplete && f.result) { finished = f.result; st.cancelFindSa(); }
        const want = finished ? 'result' : (st.saFinder ? 'listening' : 'intro');
        if (want !== phase) this.render(this.body);
        if (phase === 'listening' && st.saFinder) {
          const p = st.saFinder.progress;
          document.getElementById('ringArc')?.setAttribute('stroke-dashoffset', String(276.5 * (1 - p)));
          const hz = document.getElementById('ringHz');
          if (hz) hz.textContent = st.lastVoicedHz != null ? `${st.lastVoicedHz.toFixed(0)} Hz` : 'aaa…';
          const sec = document.getElementById('ringSec');
          if (sec) sec.textContent = `${Math.floor(p * SaFinder.targetSeconds)} / 5 s`;
        }
      },
    };
  },

  // ----------------------------------------------------------------- Results
  results(st, sheets) {
    return {
      title: st.exercise?.name ?? 'Results',
      left: { label: 'Done', action: () => sheets.close() },
      right: { label: 'Again', action: () => { sheets.close(); st.practiceAgain(); } },
      onClose() { st.showResults = false; },
      build(body) {
        const s = st.summary;
        if (!s) return;
        const stat = (t, val, color = '#fff') => `<div class="stat"><div class="t">${t}</div><div class="v" style="color:${color}">${esc(val)}</div></div>`;
        const w = s.worst;
        const worstText = (r) => {
          const name = noteLabel(r.step.note);
          return r.medianError == null ? `${name} (not sung)` : `${name} ${centsText(r.medianError)}`;
        };
        body.append(el('div', 'stat-grid',
          stat('In tune', `${(s.inTuneFraction * 100).toFixed(0)}%`, inTuneColor(s.inTuneFraction))
          + stat('Average error', s.averageAbsError != null ? `${s.averageAbsError.toFixed(0)}¢` : '—')
          + stat('Steadiness', s.averageSteadiness != null ? `±${s.averageSteadiness.toFixed(0)}¢` : '—')
          + (w && w.zone !== 'green' ? stat('Work on', worstText(w), w.zone ? zoneColor(w.zone) : 'var(--muted)') : stat('Work on', 'All in tune', COLORS.inTune))));
        body.append(el('div', 'result-grid', s.results.map((r) => `<div class="result${r.zone ? '' : ' unsung'}" style="${r.zone ? `background:${zoneColor(r.zone)}` : ''}">`
          + `<div class="n">${esc(noteLabel(r.step.note))}</div><div class="e">${r.medianError != null ? esc(centsText(r.medianError)) : '—'}</div></div>`).join('')));
        body.append(el('div', 'foot muted', 'Each note is scored on the middle half of how you sang it, so sliding in or out doesn’t count against you. Grey = not sung.'));
      },
    };
  },

  // ----------------------------------------------------------------- History
  history(st, sheets) {
    return {
      title: 'History',
      right: { label: 'Done', action: () => sheets.close() },
      build(body, v) { v.render(body); },
      render(body) {
        body.innerHTML = '';
        const records = [...st.records].sort((a, b) => b.date - a.date);
        if (!records.length) {
          body.append(el('div', 'empty', '<b>No practice yet</b>Finish an exercise, or sing in free hold for 5 seconds or more, and it will appear here.'));
          return;
        }
        const days = historyDays(records.map((r) => ({ date: r.date, inTuneFraction: r.inTuneFraction, seconds: r.durationSeconds }))).slice(-14);
        const chart = days.map((d) => {
          const pct = Math.round(d.averageInTune * 100);
          return `<div class="bar-col"><div class="bar-pct">${pct}%</div><div class="bar" style="height:${Math.max(pct, 1) * 0.87}%;background:${inTuneColor(d.averageInTune)}"></div></div>`;
        }).join('');
        const labels = days.map((d) => `<div class="bar-day" style="flex:1">${new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>`).join('');
        const { g, card } = group('In tune per day');
        card.style.padding = '0 8px';
        card.innerHTML = `<div class="chart">${chart}</div><div style="display:flex;gap:8px;padding:0 8px">${labels}</div>`;
        body.append(g);

        const groups = new Map();
        for (const r of records) {
          const d = startOfDay(r.date);
          if (!groups.has(d)) groups.set(d, []);
          groups.get(d).push(r);
        }
        for (const [day, items] of groups) {
          const title = new Date(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
          const { g: gg, card: c } = group(title);
          for (const r of items) {
            const rowEl = el('div', 'hist-row');
            rowEl.innerHTML = `<div><div class="name">${esc(r.exerciseName)}</div><div class="det">${esc(details(r))}</div></div>`
              + `<div class="pct" style="color:${inTuneColor(r.inTuneFraction)}">${Math.round(r.inTuneFraction * 100)}%</div>`;
            const del = el('button', 'del', '✕');
            del.title = 'Delete';
            del.setAttribute('aria-label', `Delete ${r.exerciseName}`);
            del.addEventListener('click', () => { st.deleteRecord(r.date); this.render(body); });
            rowEl.append(del);
            c.append(rowEl);
          }
          body.append(gg);
        }
      },
    };
  },

  // ----------------------------------------------------------------- Exercises list
  exercises(st, sheets, opts) {
    return {
      title: 'Exercises',
      right: { label: 'Done', action: () => sheets.close() },
      build(body, v) {
        v.render(body);
        if (opts.startWithNew) { opts.startWithNew = false; setTimeout(() => sheets.open('editor', {}), 0); }
      },
      render(body) {
        body.innerHTML = '';
        const rowFor = (e, editable) => {
          const r = el('div', 'row');
          const pick = el('button', null, `<div style="font-weight:600">${esc(e.name)} ${st.exerciseID === e.id ? `<span style="color:${COLORS.inTune}">✓</span>` : ''}</div>`
            + `<div class="muted" style="font: 12px ui-monospace, Menlo, monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${esc(e.notation)}</div>`);
          pick.style.cssText = 'flex:1;text-align:left;min-width:0';
          pick.addEventListener('click', () => { st.setExercise(e.id); sheets.closeAll(); });
          r.append(pick);
          if (editable) {
            const edit = el('button', 'link', '✎');
            edit.title = `Edit ${e.name}`;
            edit.style.fontSize = '18px';
            edit.addEventListener('click', () => sheets.open('editor', { existing: e }));
            const del = el('button', 'link danger', '🗑');
            del.title = `Delete ${e.name}`;
            del.addEventListener('click', () => {
              if (!confirm(`Delete “${e.name}”? This can’t be undone.`)) return;
              st.deleteCustomExercise(e.id);
              this.render(body);
            });
            r.append(edit, del);
          }
          return r;
        };
        let { g, card } = group('Built in');
        for (const e of BUILT_IN_EXERCISES) card.append(rowFor(e, false));
        body.append(g);
        ({ g, card } = group('My exercises', 'Type what your teacher gives you, e.g. “s r g m p ; ; ;”.'));
        for (const e of st.customExercises) card.append(rowFor(e, true));
        card.append(linkRow('+ New exercise', () => sheets.open('editor', {})));
        body.append(g);
      },
      refresh() { /* list re-renders when you come back from the editor (build) */ },
    };
  },

  // ----------------------------------------------------------------- Exercise editor
  editor(st, sheets, opts) {
    const existing = opts.existing ?? null;
    let name = existing?.name ?? '', notation = existing?.notation ?? '', ragaID = existing?.ragaID ?? '';
    const currentRaga = () => raga(ragaID || st.settings.ragaID);
    const parsed = () => parseNotation(notation, currentRaga());
    const canSave = () => name.trim().length > 0 && parsed().isValid;
    const save = (practise) => {
      const id = st.saveCustomExercise(existing?.id ?? null, name.trim(), notation, ragaID || null);
      if (practise) { st.setExercise(id); sheets.closeAll(); } else sheets.close();
    };
    return {
      title: existing ? 'Edit exercise' : 'New exercise',
      left: { label: 'Cancel', action: () => sheets.close() },
      right: { label: 'Save', action: () => save(false) },
      modal: true,
      build(body, v) {
        let { g, card } = group('Name');
        const nameInput = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'e.g. Janta 1', value: name });
        nameInput.addEventListener('input', () => { name = nameInput.value; v.update(); });
        const r1 = row(null); r1.append(nameInput); card.append(r1);
        body.append(g);

        ({ g, card } = group('Swaras', 's r g m p d n (variant from the raga) · r1 g3 m2… exact variant · .n lower octave · s’ upper octave · , = +1 count · ; = +2 counts · | separator'));
        const sel = document.createElement('select');
        sel.append(Object.assign(document.createElement('option'), { value: '', textContent: `From Settings (${raga(st.settings.ragaID).name})` }));
        for (const r of RAGAS) sel.append(Object.assign(document.createElement('option'), { value: r.id, textContent: r.name }));
        sel.value = ragaID;
        sel.addEventListener('change', () => { ragaID = sel.value; v.update(); });
        const r2 = row('Raga'); r2.append(sel); card.append(r2);
        const ta = Object.assign(document.createElement('textarea'), { placeholder: "s r g m | p d n s'", value: notation, spellcheck: false, autocapitalize: 'off' });
        ta.addEventListener('input', () => { notation = ta.value; v.update(); });
        const r3 = el('div', 'row col'); r3.append(ta); card.append(r3);
        body.append(g);

        ({ g, card } = group('Preview'));
        v.preview = el('div', 'row col');
        card.append(v.preview);
        body.append(g);

        v.practise = el('button', 'primary-btn', 'Save & practise');
        v.practise.addEventListener('click', () => { if (canSave()) save(true); });
        body.append(v.practise);
        v.update();
        setTimeout(() => (existing ? ta : nameInput).focus(), 0);
      },
      update() {
        const result = parsed();
        const p = this.preview;
        if (!notation.trim()) p.innerHTML = '<span class="muted">Type swaras above to see them here.</span>';
        else if (result.errors.length) p.innerHTML = result.errors.map((e) => `<div class="parse-error">⚠ ${esc(e.message)}</div>`).join('');
        else {
          p.innerHTML = `<div class="muted" style="font-size:12px">${result.steps.length} notes · ${result.steps.reduce((a, s) => a + s.counts, 0)} counts · ${esc(currentRaga().name)}</div>`
            + `<div class="preview-chips">${result.steps.map((s) => `<div class="preview-chip">${esc(noteLabel(s.note))}${s.counts > 1 ? `<small>×${s.counts}</small>` : ''}</div>`).join('')}</div>`;
        }
        const ok = canSave();
        this.rightButton.disabled = !ok;
        this.practise.disabled = !ok;
        this.practise.style.opacity = ok ? '1' : '0.4';
      },
    };
  },

  // ----------------------------------------------------------------- Guide
  guide(st, sheets) {
    const done = () => { st.updateSettings((s) => { s.hasSeenGuide = true; }); sheets.close(); };
    return {
      title: 'How to use',
      right: { label: 'Got it', action: done },
      onClose() { if (!st.settings.hasSeenGuide) st.updateSettings((s) => { s.hasSeenGuide = true; }); },
      build(body) {
        const sa = Sruti.westernName(st.settings.sruti.midiNote), kattai = Sruti.kattaiName(st.settings.sruti.midiNote);
        body.classList.add('guide');
        body.innerHTML = `
<section><h3>🎵 The idea</h3>
<p>The tanpura plays <b>your Sa</b> all the time. Every swara is sung against it — that's why it stays on Sa (and Pa) and doesn't follow the note you sing.</p>
<p>Your Sa is <b>${sa}</b> (kattai ${kattai}). Change it from the <b>Sa</b> button at the top-left. If your teacher has given you a Sa, pick exactly that note (C3 and C#3 sit next to each other in the list). Not sure? Try <b>Find my Sa</b> in the same menu.</p></section>
<section><h3>▤ Reading the screen</h3><ul>
<li><b>Sing — Pa</b>: the note to sing. 🔊 plays it once so you can hear it.</li>
<li><b>The graph</b>: your voice is the coloured line, moving right to left. The <b>green band</b> is the note you're aiming for.</li>
<li>Line <b>above</b> the band → you're too high → sing lower. Line <b>below</b> → sing higher.</li>
<li>Colours: <b>green</b> = in tune, <b>amber</b> = close, <b>coral</b> = off.</li>
<li><b>The row of boxes</b>: one octave, Sa up to upper Ṡa. The box you're singing lights up; the white needle slides as your voice moves.</li></ul></section>
<section><h3>↕ “Higher” and “lower” mean pitch</h3>
<p>Not louder, and not more air. Pitch is how high or low the note is — like the difference between Sa and Pa.</p><ul>
<li>Keep the same comfortable volume and breath.</li>
<li>To go higher, slide your voice up a tiny bit — like the end of a question (“really?”). To go lower, let it relax down.</li>
<li>Make small changes and watch the line move. It's normal to overshoot at first.</li></ul></section>
<section><h3>👂 Finding Sa — first session</h3><ol>
<li>Put on headphones or AirPods (most accurate). Press <b>Start</b> and just listen to the tanpura for a few seconds. The first time, Chrome asks to use the microphone — click <b>Allow</b>.</li>
<li>Hum “mmm” softly. Slide slowly up and down until your hum blends into the tanpura — the wobbling stops and it feels like one sound.</li>
<li>Open to “aaa” and hold it. Watch your line settle in the green band.</li>
<li>Turn on <b>Guide</b> if you'd like to hear the exact note you're aiming for while you sing.</li></ol></section>
<section><h3>⌂ Octaves (Mandra, Madhya, Tara)</h3><ul>
<li><b>Madhya</b> = the middle octave, starting at your Sa. <b>Start here</b> — you don't need to change anything.</li>
<li><b>Mandra</b> = the octave below. Shown with a <b>dot below</b>: Ṇi, Ḍa.</li>
<li><b>Tara</b> = the octave above. Shown with a <b>dot above</b>: <b>Ṡa</b> is upper Sa (double the frequency of Sa). Sarali 1 goes up to Ṡa.</li>
<li>To change octave in free practice, use the <b>⋯</b> button at the end of the swara row.</li></ul></section>
<section><h3>≡ Exercises</h3><ul>
<li>Click <b>Free hold ▾</b> at the top and choose Hold Sa, Sa Pa Sa or Sarali 1 — or make your own.</li>
<li><b>Guided</b> moves to the next note once you've held the current one in tune. <b>Tempo</b> moves on the beat with a click.</li>
<li><b>Blind</b> hides your pitch while you sing and shows it when you pause — it trains your ear.</li></ul></section>
<section><h3>⌨ Keyboard</h3><ul>
<li><kbd>Space</kbd> start / stop · <kbd>F</kbd> full screen · <kbd>H</kbd> hear the note</li>
<li><kbd>1</kbd>–<kbd>8</kbd> or <kbd>←</kbd> <kbd>→</kbd> pick a swara (free hold) · <kbd>T</kbd> tanpura · <kbd>G</kbd> guide · <kbd>B</kbd> blind · <kbd>?</kbd> this guide</li></ul></section>
<section><h3>⬇ Use it like an app</h3>
<p>In Chrome, click the <b>install</b> icon at the right of the address bar (or ⋮ menu → <b>Cast, save and share → Install page as app</b>). Sruti Trainer then opens in its own window from the Dock or Launchpad, and works offline. Your settings and history stay in this browser on this computer — they don't sync with the iPhone app.</p></section>`;
      },
    };
  },
};

function details(r) {
  const parts = [new Date(r.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), r.mode, `Sa ${r.saName}`];
  if (r.averageAbsError != null) parts.push(`avg ${r.averageAbsError.toFixed(0)}¢`);
  if (r.noteCount > 0 && r.sungCount < r.noteCount) parts.push(`${r.sungCount}/${r.noteCount} sung`);
  if (r.worstNote) parts.push(`work on ${r.worstNote}`);
  const m = Math.trunc(r.durationSeconds / 60), s = Math.trunc(r.durationSeconds) % 60;
  parts.push(m > 0 ? `${m}m ${s}s` : `${s}s`);
  return parts.join(' · ');
}

export { westernNote };
