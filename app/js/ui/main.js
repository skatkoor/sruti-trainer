// The practice screen — a port of SrutiTrainer/UI (PracticeView, TargetHeaderView, ReadoutView,
// SwaraStripView, SwaraPickerView, ExerciseBarView, DroneControlsView). Keep in step with Swift.
import {
  Sruti, Swara, Octave, noteLabel, sameNote, westernNote, directionText, isOnTargetSwara, centsText, signed,
  intonationCents, ragaSwaraAtPosition, SWARAS, BUILT_IN_EXERCISES, SaFinder,
} from '../music.js';
import { PitchGraph } from './graph.js';
import { zoneColor, COLORS } from './palette.js';
import { openMenu, closeMenu } from './menu.js';
import { Sheets } from './sheets.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class MainScreen {
  constructor(state) {
    this.state = state;
    this.graph = new PitchGraph($('graph'), state);
    this.sheets = new Sheets(state);
    this.keys = {};
    this.scheduled = false;
    this.bind();
    state.onChange(() => this.schedule());
    this.render();
    if (!state.settings.hasSeenGuide) this.sheets.open('guide');
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  // MARK: Events

  bind() {
    const st = this.state;
    $('saChip').addEventListener('click', (e) => this.saMenu(e.currentTarget));
    $('exerciseChip').addEventListener('click', (e) => this.exerciseMenu(e.currentTarget));
    $('btnGuide').addEventListener('click', () => this.sheets.open('guide'));
    $('btnHistory').addEventListener('click', () => this.sheets.open('history'));
    $('btnSettings').addEventListener('click', () => this.sheets.open('settings'));
    $('btnFullscreen').addEventListener('click', () => toggleFullscreen());
    $('hearBtn').addEventListener('click', () => st.hearTarget());
    $('startBtn').addEventListener('click', () => st.toggleListening());
    $('blindToggle').addEventListener('click', () => st.updateSettings((s) => { s.blindMode = !s.blindMode; }));
    $('tanpuraToggle').addEventListener('click', () => st.updateSettings((s) => { s.droneOn = !s.droneOn; }));
    $('guideToggle').addEventListener('click', () => st.updateSettings((s) => { s.guideNote = !s.guideNote; }));
    $('volume').addEventListener('input', (e) => st.updateSettings((s) => { s.droneVolume = Number(e.target.value); }));
    document.addEventListener('fullscreenchange', () => this.render());
    document.addEventListener('keydown', (e) => this.onKey(e));

    // Install as an app (Chrome shows its own prompt when the page is installable).
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e;
      $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', async () => {
      if (!this.installEvent) return;
      this.installEvent.prompt();
      await this.installEvent.userChoice.catch(() => null);
      this.installEvent = null;
      $('btnInstall').hidden = true;
    });
    window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; });
  }

  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (this.sheets.isOpen) return;
    const st = this.state;
    const k = e.key;
    if (k === 'Escape') { closeMenu(); return; }
    if (document.getElementById('popover').hidden === false && k !== ' ') return;
    if (k === ' ') { e.preventDefault(); st.toggleListening(); }
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'h' || k === 'H') st.hearTarget();
    else if (k === 'g' || k === 'G') st.updateSettings((s) => { s.guideNote = !s.guideNote; });
    else if (k === 't' || k === 'T') st.updateSettings((s) => { s.droneOn = !s.droneOn; });
    else if (k === 'b' || k === 'B') st.updateSettings((s) => { s.blindMode = !s.blindMode; });
    else if (k === '?') this.sheets.open('guide');
    else if (/^[1-9]$/.test(k) && !st.exercise) {
      const notes = this.pickerNotes();
      const n = notes[Number(k) - 1];
      if (n) st.setFreeTarget(n);
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !st.exercise) {
      e.preventDefault();
      const notes = this.pickerNotes();
      const i = notes.findIndex((n) => sameNote(n, st.freeTarget));
      const next = notes[Math.max(0, Math.min(notes.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowRight' ? 1 : -1)))];
      if (next) st.setFreeTarget(next);
    }
  }

  // MARK: Menus

  saMenu(anchor) {
    const st = this.state;
    const items = [{ label: 'Find my Sa…', icon: '🎙', action: () => this.sheets.open('findSa') }, { sep: true }, { section: 'Sa' }];
    for (let midi = Sruti.noteRange[1]; midi >= Sruti.noteRange[0]; midi--) {
      items.push({
        label: `${Sruti.westernName(midi)}`, detail: `kattai ${Sruti.kattaiName(midi)}`, checked: st.settings.sruti.midiNote === midi,
        action: () => st.updateSettings((s) => { s.sruti.midiNote = midi; }),
      });
    }
    openMenu(anchor, items);
  }

  exerciseMenu(anchor) {
    const st = this.state;
    const items = [{ label: 'Free hold', checked: st.exerciseID == null, action: () => st.setExercise(null) }, { section: 'Exercises' }];
    for (const e of BUILT_IN_EXERCISES) items.push({ label: e.name, checked: st.exerciseID === e.id, action: () => st.setExercise(e.id) });
    if (st.customExercises.length) {
      items.push({ section: 'My exercises' });
      for (const e of st.customExercises) items.push({ label: e.name, checked: st.exerciseID === e.id, action: () => st.setExercise(e.id) });
    }
    items.push({ sep: true });
    items.push({ label: 'New exercise…', icon: '+', action: () => this.sheets.open('exercises', { startWithNew: true }) });
    items.push({ label: 'New random practice…', icon: '⤮', action: () => this.sheets.open('exercises', { startWithDrill: true }) });
    items.push({ label: 'Manage exercises…', icon: '≡', action: () => this.sheets.open('exercises') });
    openMenu(anchor, items);
  }

  moreMenu(anchor) {
    const st = this.state;
    const r = st.raga;
    const items = [{ section: 'Octave' },
      { label: 'Middle octave (madhya) — start here', checked: st.practiceOctave === 0, action: () => st.setPracticeOctave(0) },
      { label: 'Lower octave (mandra) — dot below', checked: st.practiceOctave === -1, action: () => st.setPracticeOctave(-1) },
      { label: 'Upper octave (tara) — dot above', checked: st.practiceOctave === 1, action: () => st.setPracticeOctave(1) },
      { section: `Swaras not in ${r.name}` }];
    for (const sw of SWARAS.filter((x) => !r.swaras.includes(x))) {
      items.push({ label: Swara.notationLabel(sw, st.practiceOctave), action: () => st.setFreeTarget({ swara: sw, octave: st.practiceOctave }) });
    }
    openMenu(anchor, items);
  }

  // MARK: Render

  render() {
    const st = this.state, s = st.settings;
    // Top bar
    $('saName').textContent = `Sa ${Sruti.westernName(s.sruti.midiNote)}`;
    $('saSub').textContent = `kattai ${Sruti.kattaiName(s.sruti.midiNote)} · ${st.raga.name}`;
    $('saChip').setAttribute('aria-label', `Sa is ${Sruti.westernName(s.sruti.midiNote)}. Change Sa`);
    $('exerciseName').textContent = st.exercise?.name ?? 'Free hold';
    const fs = !!document.fullscreenElement;
    $('btnFullscreen').title = fs ? 'Exit full screen (F)' : 'Full screen (F)';
    $('fsIcon').innerHTML = fs ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';

    this.renderTarget();
    this.renderReadout();
    this.graph.sync();
    $('blindOverlay').hidden = !st.feedbackHidden;
    this.renderStrip();
    const exercise = !!st.exercise;
    $('picker').hidden = exercise;
    $('exerciseBar').hidden = !exercise;
    if (exercise) this.renderExerciseBar(); else this.renderPicker();
    this.renderDrone();
    this.renderControls();
    this.renderDiagnostics();
    this.sheets.refresh();
  }

  renderTarget() {
    const st = this.state;
    const hz = st.targetHz;
    const name = $('targetName');
    name.textContent = noteLabel(st.target);
    const fb = st.feedbackHidden ? null : st.feedback;
    name.style.color = fb ? zoneColor(fb.zone) : '#fff';
    const session = st.session;
    const meta = $('targetMeta');
    const next = st.drillNext;
    if (next) {
      // Random practice: what's coming, so you can get ready while still holding this note.
      meta.textContent = `Next: ${noteLabel(next.note)} · in ${Math.ceil(next.inSeconds)} s`;
      meta.classList.add('next');
    } else {
      const progress = session && session.phase !== 'finished' ? ` · ${session.index + 1}/${session.steps.length}` : '';
      meta.textContent = `${westernNote(hz).name} · ${hz.toFixed(0)} Hz · ${Octave.plainName(st.target.octave)} octave${progress}`;
      meta.classList.remove('next');
    }
    $('hearBtn').setAttribute('aria-label', `Hear ${Swara.name(st.target.swara)}`);
  }

  renderReadout() {
    const st = this.state, s = st.settings;
    let html;
    const session = st.session, now = st.latest?.time;
    if (session && session.phase === 'countIn' && now != null) {
      const n = Math.max(Math.trunc((session.runStart - now) * s.tempoBPM / 60) + 1, 1);
      html = `<div class="ro-dir muted">Get ready</div><div class="ro-count">${n}</div>`;
    } else if (st.feedbackHidden) {
      html = '<div class="ro-main muted">👂</div><div class="ro-dir muted">Listen and match</div>';
    } else if (st.feedback && st.lastVoicedHz != null) {
      const f = st.feedback, color = zoneColor(f.zone);
      const arrow = { hold: '✓', upLittle: '↑', upLot: '⤒', downLittle: '↓', downLot: '⤓' }[f.direction];
      let sub = '';
      if (!isOnTargetSwara(f) && !f.octaveMistake) {
        sub = `You're on ${Swara.notationLabel(f.nearestSwara, f.nearestOctave)} (${westernNote(st.lastVoicedHz).name}) — aim for ${noteLabel(f.target)}`;
      } else if (s.showHz) {
        sub = `${signed(f.errorHz, 1)} Hz`;
      }
      html = `<div class="ro-main" style="color:${color}"><span class="arrow">${arrow}</span>${esc(centsText(f.errorCents))}</div>`
        + `<div class="ro-dir" style="color:${color}">${esc(directionText(f))}</div>`
        + (sub ? `<div class="ro-sub">${esc(sub)}</div>` : '');
    } else {
      const hint = this.dropoutHint();
      if (hint) html = `<div class="ro-hint">${esc(hint)}</div>`;
      else html = `<div class="ro-idle">${st.isListening ? `Sing ${esc(noteLabel(st.target))}…` : 'Press Start,<br>then sing'}</div>`;
    }
    if (html !== this.lastReadout) { $('readout').innerHTML = html; this.lastReadout = html; }
  }

  dropoutHint() {
    const st = this.state, frame = st.latest;
    if (!st.isListening || !frame || !(st.lastVoicedTime > 0) || frame.time - st.lastVoicedTime >= 2.5) return null;
    switch (frame.gate) {
      case 'quiet': return frame.rmsDB < -62 ? null : 'Too soft — sing a little louder or move closer to the laptop';
      case 'unclear': return 'Can’t hear a clear note — hold a steady “aaa”';
      case 'leak': return 'That sounded like the tanpura — headphones work best';
      default: return null;
    }
  }

  needleIndex(cents) {
    const intonation = this.state.settings.intonation;
    const octaves = Math.floor(cents / 1200);
    const within = cents - 1200 * octaves;
    let index = 12;
    for (let p = 0; p < 12; p++) {
      const lo = intonationCents(intonation, p), hi = p === 11 ? 1200 : intonationCents(intonation, p + 1);
      if (within < hi) { index = p + (within - lo) / (hi - lo); break; }
    }
    return index + 12 * octaves;
  }

  renderStrip() {
    const st = this.state, s = st.settings, sruti = s.sruti;
    const octave = st.stripOctave;
    const fb = st.feedbackHidden ? null : st.feedback;
    const sung = st.feedbackHidden || st.lastVoicedHz == null ? null : Sruti.centsOfHz(sruti, st.lastVoicedHz);
    const needle = sung == null ? null : this.needleIndex(sung - 1200 * octave);
    const offRow = needle != null && (needle < -0.5 || needle > 12.5);

    let line;
    if (fb && Octave.valid(fb.nearestOctave)) {
      const o = fb.nearestOctave;
      const color = o === -1 ? 'var(--mandra)' : o === 1 ? 'var(--tara)' : '#fff';
      const note = needle == null ? '' : needle < -0.5 ? ' (below this row)' : needle > 12.5 ? ' (above this row)' : '';
      line = `${esc(Swara.notationLabel(fb.nearestSwara, o))} <span class="oct" style="color:${color}">· ${Octave.plainName(o)} octave${note}</span>`;
    } else if (fb) line = 'far outside this range';
    else line = '<span class="muted">—</span>';
    if (line !== this.lastSinging) { $('singing').innerHTML = line; this.lastSinging = line; }

    const blind = s.blindMode;
    const bt = $('blindToggle');
    bt.textContent = blind ? '🙈 Blind: on' : '👁 Blind';
    bt.classList.toggle('on', blind);
    bt.setAttribute('aria-label', blind ? 'Turn off blind mode' : 'Turn on blind mode');

    const target = st.target, r = st.raga;
    const key = JSON.stringify([octave, r.id, target, s.intonation, sruti]);
    const cells = $('stripCells');
    if (key !== this.stripKey) {
      this.stripKey = key;
      let html = '';
      const tp = Swara.position(target.swara);
      for (let i = 0; i < 13; i++) {
        const position = i % 12, cellOctave = octave + (i === 12 ? 1 : 0);
        const sw = tp === position ? target.swara : (ragaSwaraAtPosition(r, position) ?? Swara.defaultForPosition[position]);
        const inRaga = ragaSwaraAtPosition(r, position) != null || tp === position;
        const isTarget = tp === position && target.octave === cellOctave;
        const hz = Sruti.hzOfCents(sruti, intonationCents(s.intonation, position) + 1200 * cellOctave);
        html += `<div class="cell${inRaga ? ' in-raga' : ''}${isTarget ? ' target' : ''}" data-pos="${position}" data-oct="${cellOctave}">`
          + `<span class="sw">${esc(Swara.notationLabel(sw, cellOctave))}</span><span class="we">${westernNote(hz).name}</span></div>`;
      }
      cells.innerHTML = `${html}<div class="needle" id="needle" hidden></div>`;
      this.sungCell = null;
    }
    // The sung cell, filled green (it's the target) or coral.
    const sungKey = fb ? `${Swara.position(fb.nearestSwara)}|${fb.nearestOctave}` : null;
    if (sungKey !== this.sungCell) {
      this.sungCell = sungKey;
      for (const c of cells.querySelectorAll('.cell')) {
        const isSung = fb && Number(c.dataset.pos) === Swara.position(fb.nearestSwara) && Number(c.dataset.oct) === fb.nearestOctave;
        c.classList.toggle('sung', !!isSung);
        c.classList.toggle('hit', !!isSung && c.classList.contains('target'));
        c.classList.toggle('miss', !!isSung && !c.classList.contains('target'));
      }
    }
    const n = $('needle');
    if (needle != null && needle >= -0.5 && needle <= 12.5) {
      n.hidden = false;
      n.style.left = `${((needle + 0.5) / 13) * 100}%`;
    } else n.hidden = true;
    cells.classList.toggle('off-row', offRow);
  }

  pickerNotes() {
    const st = this.state;
    const notes = st.raga.swaras.map((sw) => ({ swara: sw, octave: st.practiceOctave }));
    if (Octave.valid(st.practiceOctave + 1)) notes.push({ swara: 's', octave: st.practiceOctave + 1 });
    return notes;
  }

  renderPicker() {
    const st = this.state;
    const notes = this.pickerNotes();
    const others = SWARAS.filter((x) => !st.raga.swaras.includes(x));
    const selectedOther = others.includes(st.freeTarget.swara);
    const key = JSON.stringify([notes, st.freeTarget, selectedOther]);
    if (key === this.pickerKey) return;
    this.pickerKey = key;
    const el = $('picker');
    el.innerHTML = '';
    notes.forEach((note, i) => {
      const b = document.createElement('button');
      b.className = `swara-btn${sameNote(note, st.freeTarget) ? ' selected' : ''}`;
      b.innerHTML = `${esc(noteLabel(note))}<span class="key">${i + 1}</span>`;
      b.title = `${Swara.name(note.swara)} (key ${i + 1})`;
      b.setAttribute('aria-label', noteLabel(note));
      b.addEventListener('click', () => st.setFreeTarget(note));
      el.appendChild(b);
    });
    const more = document.createElement('button');
    more.className = `swara-btn${selectedOther ? ' selected' : ''}`;
    more.textContent = selectedOther ? noteLabel(st.freeTarget) : '⋯';
    more.title = 'Octave and more swaras';
    more.setAttribute('aria-label', 'Octave and more swaras');
    more.addEventListener('click', (e) => this.moreMenu(e.currentTarget));
    el.appendChild(more);
  }

  /** Random practice: the last few notes (coloured by score), the one to sing now, and the next one. */
  renderDrillBar() {
    const st = this.state, session = st.session, ex = st.exercise;
    const recent = (session?.results ?? []).slice(-12);
    const key = JSON.stringify([ex.id, session?.index ?? -1, recent.length, session ? 1 : 0]);
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      const chip = (note, cls, style = '', small = '') => `<div class="note-chip ${cls}" style="${style}">${small}${esc(noteLabel(note))}</div>`;
      let html = recent.map((r) => chip(r.step.note, 'scored', `background:${r.zone ? zoneColor(r.zone) : 'rgba(142,142,147,0.85)'}`)).join('');
      if (session?.currentStep) {
        html += chip(session.currentStep.note, 'current');
        if (session.nextStep) html += chip(session.nextStep.note, 'next-chip', '', '<span class="tiny">next</span>');
      } else {
        html += `<span class="muted" style="align-self:center">Starts on Sa, then a random swara every ${ex.drillSeconds} s</span>`;
      }
      const chips = $('chips');
      chips.innerHTML = html;
      chips.scrollLeft = chips.scrollWidth;
    }
    $('holdProgress').hidden = true;
    const ckey = JSON.stringify(['drill', ex.id, ex.notation, ex.drillSeconds]);
    if (ckey !== this.controlsKey) {
      this.controlsKey = ckey;
      const pool = st.exerciseSteps.map((x) => noteLabel(x.note)).join(' ');
      const el = $('exerciseControls');
      el.innerHTML = `<span class="muted">⤮ Random: ${esc(pool)} · ${ex.drillSeconds} s each</span><button class="pill" id="editDrill">Edit</button>`;
      el.querySelector('#editDrill').addEventListener('click', () => this.sheets.open('drill', { existing: ex }));
    }
  }

  renderExerciseBar() {
    if (this.state.exercise?.drillSeconds) { this.renderDrillBar(); return; }
    const st = this.state, s = st.settings, session = st.session;
    const steps = st.exerciseSteps;
    const current = session?.phase === 'finished' ? -1 : (session?.index ?? -1);
    const results = session?.results ?? [];
    const key = JSON.stringify([st.exerciseID, steps.length, current, results.length, s.intonation]);
    const chips = $('chips');
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      chips.innerHTML = steps.map((step, i) => {
        const result = results.find((r) => r.index === i);
        const isCurrent = i === current;
        let cls = 'note-chip', style = '';
        if (result) { cls += ' scored'; style = `background:${result.zone ? zoneColor(result.zone) : 'rgba(142,142,147,0.85)'}`; }
        else if (isCurrent) cls += ' current';
        else if (current >= 0 && i < current) cls += ' done-past';
        const dots = step.counts > 1 ? `<span class="dots">${'·'.repeat(Math.min(step.counts - 1, 7))}</span>` : '';
        return `<div class="${cls}" style="${style}" data-i="${i}">${esc(noteLabel(step.note))}${dots}</div>`;
      }).join('');
      if (current >= 0) chips.children[current]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    const running = s.practiceMode === 'guided' && session && session.phase === 'running';
    $('holdProgress').hidden = !running;
    if (running) $('holdFill').style.width = `${session.holdProgress * 100}%`;

    const ckey = JSON.stringify([s.practiceMode, s.tempoBPM, s.tempoSpeed]);
    if (ckey !== this.controlsKey) {
      this.controlsKey = ckey;
      const el = $('exerciseControls');
      el.innerHTML = `<div class="segmented"><button data-mode="guided" class="${s.practiceMode === 'guided' ? 'on' : ''}">Guided</button>`
        + `<button data-mode="tempo" class="${s.practiceMode === 'tempo' ? 'on' : ''}">Tempo</button></div>`
        + (s.practiceMode === 'tempo'
          ? `<span class="stepper"><button data-bpm="-5" aria-label="Slower">−</button><span>${s.tempoBPM} bpm</span><button data-bpm="5" aria-label="Faster">+</button></span>`
            + `<span class="segmented">${[1, 2, 3].map((n) => `<button data-speed="${n}" class="${s.tempoSpeed === n ? 'on' : ''}">${['1st', '2nd', '3rd'][n - 1]}</button>`).join('')}</span>`
          : '<span class="muted">Hold each note in the green band to move on</span>');
      el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => st.updateSettings((x) => { x.practiceMode = b.dataset.mode; })));
      el.querySelectorAll('[data-bpm]').forEach((b) => b.addEventListener('click', () => st.updateSettings((x) => { x.tempoBPM = Math.min(160, Math.max(30, x.tempoBPM + Number(b.dataset.bpm))); })));
      el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => st.updateSettings((x) => { x.tempoSpeed = Number(b.dataset.speed); })));
    }
  }

  renderDrone() {
    const st = this.state, s = st.settings;
    const t = $('tanpuraToggle'), g = $('guideToggle'), v = $('volume');
    t.classList.toggle('on', s.droneOn);
    t.textContent = s.droneOn ? '♪ Tanpura' : '🔇 Tanpura';
    t.title = 'The steady Sa reference (T)';
    g.classList.toggle('on', s.guideNote);
    g.title = 'Also play the swara you’re aiming for (G)';
    if (document.activeElement !== v) v.value = String(s.droneVolume);
    v.disabled = !s.droneOn && !s.guideNote;
    $('routeIcon').textContent = st.usingHeadphones ? '🎧' : '🔈';
    $('routeIcon').title = st.usingHeadphones ? 'Headphones' : 'Speakers';

    const note = $('routeNote');
    let text = null, fix = false;
    if (s.droneOn && !st.usingHeadphones && !st.replayingName && !(st.isListening && s.echoCancel)) {
      if (st.isListening || !s.echoCancel) {
        text = s.echoCancel ? null : 'The mic can hear the tanpura. Use headphones, or click to remove it from the mic.';
        fix = !s.echoCancel;
      }
    }
    if (text !== this.routeText) {
      this.routeText = text;
      note.hidden = !text;
      note.textContent = text ?? '';
      note.onclick = fix ? () => st.updateSettings((x) => { x.echoCancel = true; }) : null;
      note.style.cursor = fix ? 'pointer' : 'default';
    }
  }

  renderControls() {
    const st = this.state;
    const b = $('startBtn');
    b.textContent = st.starting ? 'Starting…' : (st.isListening ? 'Stop' : 'Start');
    b.classList.toggle('stop', st.isListening);
    b.disabled = st.starting;
    $('permissionNote').hidden = st.permission !== 'denied';
    $('errorNote').hidden = !st.errorMessage;
    $('errorNote').textContent = st.errorMessage ?? '';
    $('replayNote').hidden = !st.replayingName;
    $('replayNote').textContent = st.replayingName ? `Replaying “${st.replayingName}” — not the microphone` : '';
  }

  renderDiagnostics() {
    const st = this.state, d = $('diag');
    const show = st.settings.showDiagnostics && st.isListening && st.latest;
    d.hidden = !show;
    if (!show) return;
    const f = st.latest;
    d.textContent = `${f.gate} · raw ${f.rawHz != null ? f.rawHz.toFixed(1) : '–'} · conf ${f.confidence.toFixed(2)} · ${f.rmsDB.toFixed(0)} dBFS · snr ${f.snrDB.toFixed(1)} · noise ${f.noiseDB.toFixed(0)} · ${st.framesPerSecond.toFixed(0)} fps · ${st.engine.sampleRate} Hz · lag ${st.engine.lagSamples ?? '–'}`;
  }
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

export { SaFinder, COLORS };
