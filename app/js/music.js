// Music model, notation parser, feedback, scoring and the practice session — a port of
// SrutiTrainer/Music and SrutiTrainer/Practice. No DOM here (unit-tested in Node). Keep in step with Swift.

// MARK: - Swara (Swara.swift)

export const SWARAS = ['s', 'r1', 'r2', 'r3', 'g1', 'g2', 'g3', 'm1', 'm2', 'p', 'd1', 'd2', 'd3', 'n1', 'n2', 'n3'];
const POSITION = { s: 0, r1: 1, r2: 2, g1: 2, r3: 3, g2: 3, g3: 4, m1: 5, m2: 6, p: 7, d1: 8, d2: 9, n1: 9, d3: 10, n2: 10, n3: 11 };
const BASE = { s: 'Sa', r: 'Ri', g: 'Ga', m: 'Ma', p: 'Pa', d: 'Da', n: 'Ni' };
const SUBSCRIPTS = ['₀', '₁', '₂', '₃'];

export const Swara = {
  position: (s) => POSITION[s],
  letter: (s) => s[0],
  variant: (s) => (s.length > 1 ? Number(s[1]) : null),
  /** "Sa", "Ri1", … */
  name: (s) => BASE[s[0]] + (s.length > 1 ? s[1] : ''),
  /** "S", "R₁", … */
  shortName: (s) => s[0].toUpperCase() + (s.length > 1 ? SUBSCRIPTS[Number(s[1])] : ''),
  /** "Sa", "Ri₁", "Ṡa", "Ṇi₃": octave dots and subscript variants. */
  notationLabel(s, octave) {
    const base = BASE[s[0]];
    return base[0] + octaveDots(octave) + base.slice(1) + (s.length > 1 ? SUBSCRIPTS[Number(s[1])] : '');
  },
  defaultForPosition: ['s', 'r1', 'r2', 'r3', 'g3', 'm1', 'm2', 'p', 'd1', 'd2', 'd3', 'n3'],
};

export function octaveDots(octave) {
  return octave > 0 ? '̇'.repeat(octave) : '̣'.repeat(-octave);
}

export const Octave = {
  mandra: -1, madhya: 0, tara: 1,
  name: (o) => ({ '-1': 'Mandra', 0: 'Madhya', 1: 'Tara' })[o],
  plainName: (o) => ({ '-1': 'lower', 0: 'middle', 1: 'upper' })[o],
  valid: (o) => o === -1 || o === 0 || o === 1,
};

export const noteCents = (note, intonation) => intonationCents(intonation, POSITION[note.swara]) + 1200 * note.octave;
export const noteLabel = (note) => Swara.notationLabel(note.swara, note.octave);
export const sameNote = (a, b) => a.swara === b.swara && a.octave === b.octave;

// MARK: - Intonation (Intonation.swift)

const JUST = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8]];
export function intonationCents(intonation, position) {
  if (intonation === 'equal') return position * 100;
  const [n, d] = JUST[position];
  return 1200 * Math.log2(n / d);
}

// MARK: - Ragas & exercises (Resources/*.json — copied verbatim)

export const RAGAS = [
  { id: 'mayamalavagowla', name: 'Mayamalavagowla', swaras: ['s', 'r1', 'g3', 'm1', 'p', 'd1', 'n3'] },
  { id: 'shankarabharanam', name: 'Shankarabharanam', swaras: ['s', 'r2', 'g3', 'm1', 'p', 'd2', 'n3'] },
  { id: 'kalyani', name: 'Kalyani', swaras: ['s', 'r2', 'g3', 'm2', 'p', 'd2', 'n3'] },
  { id: 'kharaharapriya', name: 'Kharaharapriya', swaras: ['s', 'r2', 'g2', 'm1', 'p', 'd2', 'n2'] },
  { id: 'mohanam', name: 'Mohanam', swaras: ['s', 'r2', 'g3', 'p', 'd2'] },
  { id: 'hindolam', name: 'Hindolam', swaras: ['s', 'g2', 'm1', 'd1', 'n2'] },
];
export const raga = (id) => RAGAS.find((r) => r.id === id) ?? RAGAS[0];
export const ragaSwaraForLetter = (r, letter) => r.swaras.find((s) => s[0] === letter) ?? null;
export const ragaSwaraAtPosition = (r, position) => r.swaras.find((s) => POSITION[s] === position) ?? null;

export const BUILT_IN_EXERCISES = [
  { id: 'hold-sa', name: 'Hold Sa', notation: 's ; ; ;', ragaID: null },
  { id: 'sa-pa-sa', name: 'Sa Pa Sa', notation: "s ; ; ; p ; ; ; s' ; ; ; p ; ; ; s ; ; ;", ragaID: null },
  { id: 'sarali-1', name: 'Sarali 1', notation: "s r g m | p d n s' | s' n d p | m g r s", ragaID: 'mayamalavagowla' },
];

/** Random practice (Exercise.drillSeconds): Sa (middle) first, then `count − 1` random picks from `pool`. */
export const DRILL_SECONDS_RANGE = [2, 30];
export function drillSequence(pool, count, random = Math.random) {
  const notes = [{ swara: 's', octave: 0 }];
  if (!pool.length) return notes.map((note) => ({ note, counts: 1 }));
  while (notes.length < count) notes.push(pool[Math.floor(random() * pool.length)]);
  return notes.map((note) => ({ note: { ...note }, counts: 1 }));
}

// MARK: - Sruti & Western notes (Sruti.swift, WesternNote.swift)

export const WESTERN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const KATTAI = ['1', '1.5', '2', '2.5', '3', '4', '4.5', '5', '5.5', '6', '6.5', '7'];

export const Sruti = {
  noteRange: [36, 59],
  fineTuneRange: [-50, 50],
  saHz: (s) => 440 * Math.pow(2, ((s.midiNote - 69) * 100 + s.fineTuneCents) / 1200),
  centsOfHz: (s, hz) => 1200 * Math.log2(hz / Sruti.saHz(s)),
  hzOfCents: (s, cents) => Sruti.saHz(s) * Math.pow(2, cents / 1200),
  westernName: (midi) => WESTERN[((midi % 12) + 12) % 12] + String(Math.trunc(midi / 12) - 1),
  kattaiName: (midi) => KATTAI[((midi % 12) + 12) % 12],
};

export function westernNote(hz, a4 = 440) {
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100, name: Sruti.westernName(midi) };
}

// MARK: - Notation parser (NotationParser.swift)

const TARA_MARKS = new Set(["'", '’', '‘', '`']);

export function tokenize(text) {
  const tokens = [];
  let current = '';
  const flush = () => { if (current) { tokens.push(current); current = ''; } };
  for (const ch of text) {
    if (/\s/.test(ch)) flush();
    else if (ch === ',' || ch === ';' || ch === '|') { flush(); tokens.push(ch); }
    else current += ch;
  }
  flush();
  return tokens;
}

/** { steps: [{note, counts}], errors: [{tokenIndex, token, message}], isValid } */
export function parseNotation(text, r) {
  const steps = [], errors = [];
  tokenize(text).forEach((token, index) => {
    if (token === '|') return;
    if (token === ',' || token === ';') {
      if (!steps.length) { errors.push({ tokenIndex: index, token, message: `“${token}” must come after a swara` }); return; }
      steps[steps.length - 1].counts += token === ',' ? 1 : 2;
      return;
    }
    const res = parseNote(token, r);
    if (res.note) steps.push({ note: res.note, counts: 1 });
    else errors.push({ tokenIndex: index, token, message: res.error });
  });
  if (!steps.length && !errors.length) errors.push({ tokenIndex: 0, token: '', message: 'Type some swaras, e.g. s r g m p' });
  return { steps, errors, isValid: errors.length === 0 && steps.length > 0 };
}

function parseNote(token, r) {
  let chars = [...token.toLowerCase()];
  let low = 0, high = 0;
  while (chars[0] === '.') { low++; chars.shift(); }
  while (chars.length && TARA_MARKS.has(chars[chars.length - 1])) { high++; chars.pop(); }
  const q = (t) => `“${t}”`;
  const letter = chars[0];
  if (!letter || !'srgmpdn'.includes(letter) || chars.length > 2) return { error: `${q(token)} isn't a swara — use s r g m p d n` };
  if (low > 0 && high > 0) return { error: `${q(token)}: use either . (lower) or ' (upper), not both` };
  const octave = high - low;
  if (!Octave.valid(octave)) return { error: `${q(token)}: only one octave up (s') or down (.s) is supported` };
  let swara;
  if (chars.length === 2) {
    if (!/^[0-9]$/.test(chars[1])) return { error: `${q(token)} isn't a swara — use s r g m p d n` };
    if (letter === 's' || letter === 'p') return { error: `${q(token)}: Sa and Pa have no variants — just write ${letter}` };
    const id = letter + chars[1];
    if (!SWARAS.includes(id)) return { error: `${q(token)}: ${letter} only has variants ${letter === 'm' ? '1–2' : '1–3'}` };
    swara = id;
  } else if (letter === 's') {
    swara = 's';
  } else {
    swara = ragaSwaraForLetter(r, letter);
    if (!swara) {
      if (letter === 'p') return { error: `${q(token)}: ${r.name} has no Pa` };
      const name = BASE[letter];
      return { error: `${q(token)}: ${r.name} has no ${name} — write a variant, e.g. ${letter}${letter === 'm' ? '1' : '2'}` };
    }
  }
  return { note: { swara, octave } };
}

// MARK: - Feedback (FeedbackEngine.swift)

export const Zone = { green: 'green', yellow: 'yellow', red: 'red' };
export function zoneOf(errorCents, tolerance) {
  const m = Math.abs(errorCents);
  return m <= tolerance.green ? Zone.green : (m <= tolerance.yellow ? Zone.yellow : Zone.red);
}

export const LITTLE_LIMIT = 50;

export function nearestPosition(cents, intonation) {
  const octave = Math.floor(cents / 1200);
  const within = cents - 1200 * octave;
  let bestPosition = 0, bestDistance = Infinity;
  for (let position = 0; position <= 12; position++) {
    const c = position === 12 ? 1200 : intonationCents(intonation, position);
    const d = Math.abs(within - c);
    if (d < bestDistance) { bestDistance = d; bestPosition = position; }
  }
  return bestPosition === 12 ? { position: 0, octave: octave + 1 } : { position: bestPosition, octave };
}

export function evaluateFeedback(sungHz, target, sruti, intonation, r, tolerance) {
  const sungCents = Sruti.centsOfHz(sruti, sungHz);
  const targetCents = noteCents(target, intonation);
  const err = sungCents - targetCents, magnitude = Math.abs(err);
  const zone = zoneOf(err, tolerance);
  let direction;
  if (magnitude <= tolerance.green) direction = 'hold';
  else if (err < 0) direction = magnitude <= LITTLE_LIMIT ? 'upLittle' : 'upLot';
  else direction = magnitude <= LITTLE_LIMIT ? 'downLittle' : 'downLot';
  const octaveMistake = Math.abs(magnitude - 1200) <= 50 ? (err > 0 ? 'tooHigh' : 'tooLow') : null;
  const nearest = nearestPosition(sungCents, intonation);
  const swara = (r ? ragaSwaraAtPosition(r, nearest.position) : null) ?? Swara.defaultForPosition[nearest.position];
  return {
    target, errorCents: err, errorHz: sungHz - Sruti.hzOfCents(sruti, targetCents), zone, direction,
    nearestSwara: POSITION[target.swara] === nearest.position ? target.swara : swara,
    nearestOctave: nearest.octave, octaveMistake,
  };
}

export const isOnTargetSwara = (f) => POSITION[f.nearestSwara] === POSITION[f.target.swara] && f.nearestOctave === f.target.octave;

export function directionText(f) {
  if (f.octaveMistake) return `Right note, one octave too ${f.octaveMistake === 'tooHigh' ? 'high' : 'low'}`;
  return {
    hold: 'In tune — hold it', upLittle: 'Sing a little higher', upLot: 'Sing much higher',
    downLittle: 'Sing a little lower', downLot: 'Sing much lower',
  }[f.direction];
}

export const signed = (v, digits = 0) => (v >= 0 || Object.is(Math.round(v * 10 ** digits), 0) ? '+' : '−') + Math.abs(v).toFixed(digits);
export const centsText = (v) => `${signed(v)}¢`;

// MARK: - Scorer (Scorer.swift)

export const Scorer = {
  minimumSamples: 4,
  strictSteadinessLimit: 15,
  score(index, step, voicedCents, targetCents, tolerance, strict) {
    if (voicedCents.length < this.minimumSamples) return { index, step, medianError: null, steadiness: null, zone: null };
    const n = voicedCents.length;
    const middle = voicedCents.slice(Math.floor(n / 4), n - Math.floor(n / 4));
    const error = medianOf(middle) - targetCents;
    const mean = middle.reduce((a, b) => a + b, 0) / middle.length;
    const steadiness = Math.sqrt(middle.reduce((a, v) => a + (v - mean) * (v - mean), 0) / middle.length);
    let zone = zoneOf(error, tolerance);
    if (strict && steadiness > this.strictSteadinessLimit) zone = zone === Zone.green ? Zone.yellow : Zone.red;
    return { index, step, medianError: error, steadiness, zone };
  },
  summarize(results, inTuneFraction) {
    const sung = results.filter((r) => r.medianError != null);
    const errors = sung.map((r) => Math.abs(r.medianError));
    const steadiness = sung.map((r) => r.steadiness).filter((s) => s != null);
    let worst = results.find((r) => r.medianError == null) ?? null;
    if (!worst && sung.length) worst = sung.reduce((a, b) => (Math.abs(b.medianError) > Math.abs(a.medianError) ? b : a));
    return {
      results, inTuneFraction,
      averageAbsError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
      averageSteadiness: steadiness.length ? steadiness.reduce((a, b) => a + b, 0) / steadiness.length : null,
      worst,
    };
  },
};

export function medianOf(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// MARK: - Practice session (PracticeSession.swift)

export class PracticeSession {
  static foundCents = 50;
  static guidedDisplaySeconds = 1.8;

  /** config: { mode: {kind:'guided', holdPerCount} | {kind:'tempo', secondsPerCount, countIn}, intonation, tolerance, strict } */
  constructor(steps, config, startTime) {
    this.steps = steps;
    this.config = config;
    this.index = 0;
    this.heldInTune = 0;
    this.results = [];
    this.lastTime = null;
    this.stepVoiced = [];
    this.voicedFrames = 0;
    this.inTuneFrames = 0;
    if (config.mode.kind === 'tempo' && config.mode.countIn > 0) {
      this.phase = 'countIn';
      this.runStart = startTime + config.mode.countIn;
    } else {
      this.phase = steps.length ? 'running' : 'finished';
      this.runStart = startTime;
    }
    this.stepStart = this.runStart;
  }

  get currentStep() { return this.phase === 'finished' ? null : this.steps[this.index]; }
  get nextStep() { return this.phase === 'finished' || this.index + 1 >= this.steps.length ? null : this.steps[this.index + 1]; }
  /** Tempo mode: when the current note ends. */
  get currentStepEnd() {
    const step = this.currentStep;
    if (this.config.mode.kind !== 'tempo' || !step) return null;
    return this.stepStart + step.counts * this.config.mode.secondsPerCount;
  }
  targetCents(step) { return noteCents(step.note, this.config.intonation); }

  get holdProgress() {
    const step = this.currentStep;
    if (this.config.mode.kind !== 'guided' || !step) return 0;
    return Math.min(this.heldInTune / (this.config.mode.holdPerCount * step.counts), 1);
  }

  get summary() {
    return Scorer.summarize(this.results, this.voicedFrames === 0 ? 0 : this.inTuneFrames / this.voicedFrames);
  }

  process(time, sungCents) {
    if (this.phase === 'finished') return;
    const dt = Math.min(Math.max(time - (this.lastTime ?? time), 0), 0.05);
    this.lastTime = time;
    if (this.phase === 'countIn') {
      if (time < this.runStart) return;
      this.phase = 'running';
    }
    const mode = this.config.mode;
    if (mode.kind === 'tempo') {
      while (this.phase === 'running' && time >= this.stepStart + this.steps[this.index].counts * mode.secondsPerCount) {
        this.finishStep(this.stepStart + this.steps[this.index].counts * mode.secondsPerCount);
      }
      if (this.phase !== 'running') return;
    }
    const target = this.targetCents(this.steps[this.index]);
    if (sungCents != null) {
      this.stepVoiced.push(sungCents);
      if (Math.abs(sungCents - target) <= this.config.tolerance.green) this.heldInTune += dt;
    }
    if (mode.kind === 'guided' && this.heldInTune >= mode.holdPerCount * this.steps[this.index].counts) this.finishStep(time);
  }

  finishStep(time) {
    const step = this.steps[this.index];
    const target = this.targetCents(step);
    let scored = this.stepVoiced;
    if (this.config.mode.kind === 'guided' || this.config.scoreFromFound) {
      const found = this.stepVoiced.findIndex((c) => Math.abs(c - target) <= PracticeSession.foundCents);
      if (found >= 0) scored = this.stepVoiced.slice(found);
    }
    this.voicedFrames += scored.length;
    this.inTuneFrames += scored.filter((c) => Math.abs(c - target) <= this.config.tolerance.green).length;
    this.results.push(Scorer.score(this.index, step, [...scored], target, this.config.tolerance, this.config.strict));
    this.stepVoiced = [];
    this.heldInTune = 0;
    this.index += 1;
    if (this.index >= this.steps.length) this.phase = 'finished';
    else this.stepStart = time;
  }

  upcoming(now, horizon) {
    if (this.phase === 'finished') return [];
    const segments = [];
    const add = (i, start, end) => {
      const step = this.steps[i];
      segments.push({ start, end, cents: this.targetCents(step), label: noteLabel(step.note) });
    };
    const mode = this.config.mode;
    if (mode.kind === 'tempo') {
      let t = this.stepStart;
      const last = this.config.revealAhead != null ? Math.min(this.steps.length - 1, this.index + this.config.revealAhead) : this.steps.length - 1;
      for (let i = this.index; i <= last; i++) {
        if (!(t < now + horizon || i <= this.index + 1)) continue;
        const end = t + this.steps[i].counts * mode.secondsPerCount;
        add(i, t, end);
        t = end;
      }
    } else {
      const hold = mode.holdPerCount;
      const remaining = Math.min(Math.max(hold * this.steps[this.index].counts - this.heldInTune, 0.3), PracticeSession.guidedDisplaySeconds);
      let t = now + remaining;
      add(this.index, now, t);
      for (let i = this.index + 1; i < this.steps.length; i++) {
        if (!(t < now + horizon || i === this.index + 1)) continue;
        const end = t + Math.min(hold * this.steps[i].counts, PracticeSession.guidedDisplaySeconds);
        add(i, t, end);
        t = end;
      }
    }
    return segments;
  }
}

// MARK: - Find my Sa (SaFinder.swift)

export class SaFinder {
  static targetSeconds = 5;
  constructor() { this.voicedHz = []; this.voicedSeconds = 0; }
  add(hz, frameDuration) { if (hz == null) return; this.voicedHz.push(hz); this.voicedSeconds += frameDuration; }
  get progress() { return Math.min(this.voicedSeconds / SaFinder.targetSeconds, 1); }
  get isComplete() { return this.voicedSeconds >= SaFinder.targetSeconds; }
  get result() {
    if (this.voicedHz.length < 10) return null;
    const m = medianOf(this.voicedHz);
    const sung = westernNote(m);
    let midi = sung.midi;
    while (midi > Sruti.noteRange[1]) midi -= 12;
    while (midi < Sruti.noteRange[0]) midi += 12;
    return { medianHz: m, sung, suggestedMidi: midi };
  }
}

// MARK: - Graph viewport (GraphViewport.swift)

export class GraphViewport {
  static minimumSpan = 300;
  static targetMargin = 150;
  static voiceMargin = 60;
  static recentVoiceSeconds = 3;
  static sustainedSeconds = 0.3;
  static widenSeconds = 0.12;
  static narrowSeconds = 0.9;

  constructor() { this.lower = -150; this.upper = 150; this.lastDate = null; }

  static desiredRange(targets, recentVoice) {
    let lo = Infinity, hi = -Infinity;
    for (const t of targets) { lo = Math.min(lo, t - this.targetMargin); hi = Math.max(hi, t + this.targetMargin); }
    for (const v of recentVoice) { lo = Math.min(lo, v - this.voiceMargin); hi = Math.max(hi, v + this.voiceMargin); }
    if (!Number.isFinite(lo)) { lo = -this.minimumSpan / 2; hi = this.minimumSpan / 2; }
    if (hi - lo < this.minimumSpan) { const mid = (lo + hi) / 2; lo = mid - this.minimumSpan / 2; hi = mid + this.minimumSpan / 2; }
    return [lo, hi];
  }

  /** date in seconds (performance.now()/1000). */
  update(desired, date, animate) {
    const last = this.lastDate;
    this.lastDate = date;
    if (!animate || last == null) { [this.lower, this.upper] = desired; return [this.lower, this.upper]; }
    const dt = Math.min(Math.max(date - last, 0), 0.1);
    const widen = 1 - Math.exp(-dt / GraphViewport.widenSeconds);
    const narrow = 1 - Math.exp(-dt / GraphViewport.narrowSeconds);
    this.lower += (desired[0] - this.lower) * (desired[0] < this.lower ? widen : narrow);
    this.upper += (desired[1] - this.upper) * (desired[1] > this.upper ? widen : narrow);
    return [this.lower, this.upper];
  }
}

// MARK: - Pitch history (PitchHistory.swift)

export class PitchHistory {
  static minVoicedRun = 0.06;
  constructor() { this.keepSeconds = 12; this.clear(); }
  clear() { this.points = []; this.lastTime = 0; this.lastArrival = null; }

  /** Appends frames (each {time, hz}) against the target active then; arrival = performance.now()/1000. */
  append(frames, targetCents, arrival) {
    if (!frames.length) return;
    for (const f of frames) this.points.push({ time: f.time, hz: f.hz, targetCents });
    this.lastTime = frames[frames.length - 1].time;
    this.lastArrival = arrival;
    const cutoff = this.lastTime - this.keepSeconds;
    let firstKept = 0;
    while (firstKept < this.points.length && this.points[firstKept].time < cutoff) firstKept++;
    if (firstKept > 0) this.points.splice(0, firstKept);
  }

  /** [start, end) index ranges of voiced runs from `time` on lasting ≥ minVoicedRun. */
  voicedRuns(time) {
    const runs = [], pts = this.points;
    let start = null;
    const close = (end) => {
      if (start == null) return;
      if (pts[end - 1].time - pts[start].time >= PitchHistory.minVoicedRun) runs.push([start, end]);
      start = null;
    };
    let first = pts.findIndex((p) => p.time >= time);
    if (first < 0) first = pts.length;
    for (let i = first; i < pts.length; i++) {
      if (pts[i].hz != null) { if (start == null) start = i; } else close(i);
    }
    close(pts.length);
    return runs;
  }

  sustainedVoiceHz(since, minDuration) {
    const out = [];
    for (const [a, b] of this.voicedRuns(since)) {
      if (this.points[b - 1].time - this.points[a].time < minDuration) continue;
      for (let i = a; i < b; i++) if (this.points[i].hz != null) out.push(this.points[i].hz);
    }
    return out;
  }

  now(date, live) {
    if (!live || this.lastArrival == null) return this.lastTime;
    return this.lastTime + Math.min(Math.max(date - this.lastArrival, 0), 0.1);
  }
}

// MARK: - Display smoother (DisplaySmoother.swift)

/**
 * Calms the pitch line and the readout for the eye: a voice wobbles a few cents many times a second, which the
 * detector measures faithfully but nobody can follow by eye. A one-pole smoother in cents (τ ≈ 0.15 s) keeps the
 * shape of the note — slides, a gamaka's swing, a drift sharp — without the shimmer. A real jump (a new note,
 * > 150¢) is never smoothed into a glide. Scoring, Find my Sa and history always use the unsmoothed pitch.
 */
export class DisplaySmoother {
  static timeConstant = 0.15;
  constructor() { this.reset(); }
  reset() { this.cents = null; this.lastTime = null; }
  process(hz, time) {
    if (hz == null) return null;
    const c = 1200 * Math.log2(hz);
    if (this.cents != null && this.lastTime != null && Math.abs(c - this.cents) < 150 && time - this.lastTime < 0.2) {
      const a = 1 - Math.exp(-(time - this.lastTime) / DisplaySmoother.timeConstant);
      this.cents += a * (c - this.cents);
    } else {
      this.cents = c;
    }
    this.lastTime = time;
    return Math.pow(2, this.cents / 1200);
  }
}

// MARK: - History stats (HistoryStats.swift)

export function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function historyDays(entries) {
  const groups = new Map();
  for (const e of entries) {
    const day = startOfDay(e.date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((day) => {
    const items = groups.get(day);
    const total = items.reduce((a, e) => a + e.seconds, 0);
    const average = total > 0
      ? items.reduce((a, e) => a + e.inTuneFraction * e.seconds, 0) / total
      : items.reduce((a, e) => a + e.inTuneFraction, 0) / items.length;
    return { day, sessions: items.length, averageInTune: average, practiceSeconds: total };
  });
}

export class FreeHoldStats {
  constructor() { this.reset(); }
  reset() { this.voicedFrames = 0; this.inTuneFrames = 0; this.absErrorSum = 0; }
  add(errorCents, tolerance) {
    this.voicedFrames += 1;
    this.absErrorSum += Math.abs(errorCents);
    if (Math.abs(errorCents) <= tolerance.green) this.inTuneFrames += 1;
  }
  get inTuneFraction() { return this.voicedFrames === 0 ? 0 : this.inTuneFrames / this.voicedFrames; }
  get averageAbsError() { return this.voicedFrames === 0 ? null : this.absErrorSum / this.voicedFrames; }
  seconds(frameDuration) { return this.voicedFrames * frameDuration; }
}
