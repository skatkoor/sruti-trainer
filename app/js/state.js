// App state and behaviour — a port of SrutiTrainer/App/AppState.swift. The UI (ui.js) reads from this and
// calls its methods; `onChange` fires whenever something visible changed. Keep in step with Swift.
import {
  BUILT_IN_EXERCISES, raga, parseNotation, drillSequence, noteCents, noteLabel, Sruti, intonationCents, evaluateFeedback,
  PracticeSession, PitchHistory, FreeHoldStats, SaFinder, centsText, DisplaySmoother,
} from './music.js';
import { AudioEngine, HOP } from './audio/engine.js';
import { droneFrequencies, Style } from './dsp/tanpura.js';
import {
  loadSettings, saveSettings, loadCustomExercises, saveCustomExercises, loadHistory, saveHistory, Recordings,
} from './storage.js';

const RESTART_KEYS = ['practiceMode', 'tempoBPM', 'tempoSpeed', 'guidedHoldSeconds', 'strictPlainNotes', 'ragaID'];
const clone = (o) => JSON.parse(JSON.stringify(o));

export class AppState {
  static drillGuideBreak = 0.35;

  constructor() {
    this.settings = loadSettings();
    this.freeTarget = { swara: 's', octave: 0 };
    this.practiceOctave = 0;
    this.exerciseID = null;
    this.session = null;
    this.summary = null;
    this.showResults = false;
    this.customExercises = loadCustomExercises();
    this.records = loadHistory();
    this.saFinder = null;
    this.droneWasOnBeforeFinder = false;
    this.replayingName = null;
    this.permission = 'prompt';
    this.isListening = false;
    this.starting = false;
    this.latest = null;
    this.lastVoicedHz = null;
    this.lastVoicedTime = 0;
    this.errorMessage = null;
    this.framesPerSecond = 0;
    this.usingHeadphones = false;
    this.outputSealed = false;
    this.sessionTick = 0;
    this.history = new PitchHistory();
    this.engine = new AudioEngine();
    this.freeHoldStats = new FreeHoldStats();
    this.displaySmoother = new DisplaySmoother();
    this.voicedRunStart = null;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.guideKeySent = undefined;
    this.listeners = new Set();
    this.wakeLock = null;

    this.engine.onFrames = (batch) => this.receive(batch);
    this.engine.onReplayFinished = () => this.stop();
    this.engine.onEnded = () => { if (this.isListening && !this.replayingName) this.stop(); };
    this.engine.onRecording = (m) => this.saveRecording(m);
    AudioEngine.micPermission().then((p) => { this.permission = p; this.changed(); });
    this.refreshOutputRoute();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshOutputRoute());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isListening) this.requestWakeLock();
    });
    this.syncAudioSettings();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(); }

  // MARK: Settings

  /** Changes settings through a mutator, then saves and pushes them to the audio (like Swift's didSet). */
  updateSettings(mutate) {
    const old = clone(this.settings);
    mutate(this.settings);
    if (this.settings.tolerance.yellow <= this.settings.tolerance.green) this.settings.tolerance.yellow = this.settings.tolerance.green + 1;
    if (JSON.stringify(old) === JSON.stringify(this.settings)) return;
    saveSettings(this.settings);
    this.syncAudioSettings();
    if (RESTART_KEYS.some((k) => old[k] !== this.settings[k])) this.restartSessionIfActive();
    this.changed();
  }

  // MARK: Derived

  get allExercises() { return [...BUILT_IN_EXERCISES, ...this.customExercises]; }
  get exercise() { return this.allExercises.find((e) => e.id === this.exerciseID) ?? null; }
  get raga() { return raga(this.exercise?.ragaID ?? this.settings.ragaID); }
  get exerciseSteps() { const e = this.exercise; return e ? parseNotation(e.notation, this.raga).steps : []; }
  get saHz() { return Sruti.saHz(this.settings.sruti); }

  get feedbackHidden() {
    const now = this.latest?.time;
    if (!this.settings.blindMode || !this.isListening || now == null) return false;
    return this.lastVoicedHz != null || now - this.lastVoicedTime < 1.0;
  }

  get target() {
    if (this.session?.currentStep) return this.session.currentStep.note;
    if (this.exercise?.drillSeconds) return { swara: 's', octave: 0 };   // random practice starts on Sa
    const steps = this.exerciseSteps;
    if (steps.length) return steps[0].note;
    return this.freeTarget;
  }
  get targetCents() { return noteCents(this.target, this.settings.intonation); }
  get targetHz() { return Sruti.hzOfCents(this.settings.sruti, this.targetCents); }

  get notesPerBeat() { return this.settings.tempoSpeed === 3 ? 4 : (this.settings.tempoSpeed === 2 ? 2 : 1); }

  get exercisePreview() {
    if (!this.exercise || this.exercise.drillSeconds) return [];
    const s = this.settings;
    const guided = s.practiceMode !== 'tempo';
    const perCount = guided ? s.guidedHoldSeconds : 60 / s.tempoBPM / this.notesPerBeat;
    let t = 0;
    return this.exerciseSteps.map((step) => {
      const length = perCount * step.counts;
      const end = t + (guided ? Math.min(length, PracticeSession.guidedDisplaySeconds) : length);
      const seg = { start: t, end, cents: noteCents(step.note, s.intonation), label: noteLabel(step.note) };
      t = end;
      return seg;
    });
  }

  get stripOctave() {
    if (!this.exercise) return this.practiceOctave;
    const octaves = this.exerciseSteps.map((s) => s.note.octave);
    return octaves.length ? Math.min(...octaves) : 0;
  }

  get graphRange() {
    const cents = this.exercise ? this.exerciseSteps.map((s) => noteCents(s.note, this.settings.intonation)) : [this.targetCents];
    const lo = cents.length ? Math.min(...cents) : 0, hi = cents.length ? Math.max(...cents) : 0;
    if (this.settings.graphRange === 'auto') {
      const m = this.exercise ? 250 : 400;
      return [lo - m, hi + m];
    }
    return [Math.min(-500, lo - 300), Math.max(1500, hi + 300)];
  }

  get feedback() {
    if (this.lastVoicedHz == null) return null;
    return evaluateFeedback(this.lastVoicedHz, this.target, this.settings.sruti, this.settings.intonation, this.raga, this.settings.tolerance);
  }

  get frameDuration() { return HOP / Math.max(this.engine.sampleRate, 1); }

  // MARK: Free hold

  setFreeTarget(note) { this.freeTarget = note; this.syncGuide(); this.changed(); }

  setPracticeOctave(octave) {
    const old = this.practiceOctave;
    if (octave === old) return;
    this.practiceOctave = octave;
    const wasUpperSa = this.freeTarget.swara === 's' && this.freeTarget.octave === old + 1;
    const o = Math.max(-1, Math.min(1, octave + (wasUpperSa ? 1 : 0)));
    this.setFreeTarget({ swara: this.freeTarget.swara, octave: o });
  }

  setExercise(id) {
    if (id === this.exerciseID) return;
    this.exerciseID = id;
    this.showResults = false;
    this.restartSessionIfActive();
    this.syncGuide();
    this.changed();
  }

  // MARK: Listening

  async toggleListening() { if (this.isListening) this.stop(); else await this.start(); }

  async start() {
    if (this.isListening || this.starting) return;
    this.errorMessage = null;
    this.starting = true;
    this.changed();
    try {
      this.syncAudioSettings();
      await this.engine.start({ record: this.settings.recordSessions });
      this.permission = 'granted';
      this.beginListening(null);
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) this.permission = 'denied';
      else this.errorMessage = err?.name === 'NotFoundError' ? 'No microphone found.' : `Couldn't start the microphone: ${err?.message ?? err}`;
    } finally {
      this.starting = false;
      this.changed();
    }
    this.refreshOutputRoute();
  }

  beginListening(replayName) {
    this.history.clear();
    this.freeHoldStats.reset();
    this.isListening = true;
    this.replayingName = replayName;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.voicedRunStart = null;
    this.displaySmoother.reset();
    this.guideKeySent = undefined;
    this.syncGuide();
    this.requestWakeLock();
    this.startSession(0);
  }

  stop() {
    if (!this.isListening && !this.starting) return;
    this.saveFreeHoldRecord();
    // Random practice runs until you stop: score what was sung so far.
    if (this.session && this.exercise?.drillSeconds && this.session.results.length) this.finishSession(this.session);
    this.endSession();
    if (this.saFinder) this.cancelFindSa();
    this.engine.stop();
    this.isListening = false;
    this.replayingName = null;
    this.latest = null;
    this.lastVoicedHz = null;
    this.releaseWakeLock();
    this.changed();
  }

  async hearTarget() {
    if (!this.isListening) await this.start();
    if (!this.isListening) return;
    this.engine.setParams({ referenceHz: this.targetHz, referenceSerial: this.engine.params.referenceSerial + 1 });
  }

  async requestWakeLock() {
    try { if ('wakeLock' in navigator && !this.wakeLock) { this.wakeLock = await navigator.wakeLock.request('screen'); this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }); } } catch { /* not allowed */ }
  }
  releaseWakeLock() { this.wakeLock?.release().catch(() => {}); this.wakeLock = null; }

  /** Headphones can't be detected reliably in a browser; the default output's name is a good hint. */
  async refreshOutputRoute() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const out = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default') ?? devices.find((d) => d.kind === 'audiooutput');
      const label = out?.label ?? '';
      const usingHeadphones = /head(phone|set)|airpods|earpods|buds|beats|earphone/i.test(label);
      // Wired headphones can't reach the mic; Bluetooth may be a speaker or a car, so it counts as audible.
      const outputSealed = /external headphones|wired/i.test(label);
      if (usingHeadphones !== this.usingHeadphones || outputSealed !== this.outputSealed) {
        this.usingHeadphones = usingHeadphones;
        this.outputSealed = outputSealed;
        this.guideKeySent = undefined;
        this.syncGuide();
        this.changed();
      }
    } catch { /* no device info */ }
  }

  // MARK: Exercise sessions

  async practiceAgain() {
    this.showResults = false;
    if (this.isListening) this.startSession(this.history.lastTime); else await this.start();
    this.changed();
  }

  restartSessionIfActive() { if (this.isListening) this.startSession(this.history.lastTime); }

  startSession(time) {
    this.endSession();
    this.summary = null;
    const steps = this.exerciseSteps;
    if (!this.exercise || !steps.length) return;
    const s = this.settings;
    const seconds = this.exercise.drillSeconds;
    if (seconds) {
      // Random practice: Sa first, then a random swara from the pool every `seconds` (no click, no count-in).
      const run = drillSequence(steps.map((x) => x.note), Math.floor(3600 / seconds) + 1);
      this.session = new PracticeSession(run, {
        mode: { kind: 'tempo', secondsPerCount: seconds, countIn: 0 }, intonation: s.intonation,
        tolerance: { ...s.tolerance }, strict: s.strictPlainNotes, scoreFromFound: true, revealAhead: 1,
      }, time);
      this.syncGuide();
      return;
    }
    const beat = 60 / s.tempoBPM;
    let mode;
    if (s.practiceMode === 'tempo') {
      mode = { kind: 'tempo', secondsPerCount: beat / this.notesPerBeat, countIn: 4 * beat };
      this.engine.setParams({ clickBPM: s.tempoBPM, clickAccentEvery: 8, clickOn: true, clickSerial: this.engine.params.clickSerial + 1 });
    } else {
      mode = { kind: 'guided', holdPerCount: s.guidedHoldSeconds };
    }
    this.session = new PracticeSession(steps, { mode, intonation: s.intonation, tolerance: { ...s.tolerance }, strict: s.strictPlainNotes }, time);
  }

  endSession() {
    this.engine.setParams({ clickOn: false });
    this.session = null;
  }

  finishSession(finished) {
    this.engine.setParams({ clickOn: false });
    this.summary = finished.summary;
    this.showResults = true;
    this.saveRecord(finished);
  }

  // MARK: History

  addRecord(r) {
    this.records.push(r);
    saveHistory(this.records);
  }

  deleteRecord(date) {
    this.records = this.records.filter((r) => r.date !== date);
    saveHistory(this.records);
    this.changed();
  }

  saveRecord(finished) {
    const exercise = this.exercise;
    if (!exercise) return;
    const summary = finished.summary;
    let worst = null;
    const w = summary.worst;
    if (w && w.zone !== 'green') {
      const label = noteLabel(w.step.note);
      worst = w.medianError != null ? `${label} ${centsText(w.medianError)}` : `${label} not sung`;
    }
    this.addRecord({
      date: Date.now(), exerciseID: exercise.id, exerciseName: exercise.name,
      mode: exercise.drillSeconds ? 'Random' : (this.settings.practiceMode === 'tempo' ? 'Tempo' : 'Guided'),
      inTuneFraction: summary.inTuneFraction, averageAbsError: summary.averageAbsError, averageSteadiness: summary.averageSteadiness,
      noteCount: summary.results.length, sungCount: summary.results.filter((r) => r.zone != null).length,
      worstNote: worst, durationSeconds: Math.max((this.latest?.time ?? 0) - finished.runStart, 0),
      saName: Sruti.westernName(this.settings.sruti.midiNote),
    });
  }

  saveFreeHoldRecord() {
    const stats = this.freeHoldStats;
    const seconds = stats.seconds(this.frameDuration);
    if (!this.exercise && !this.replayingName && !this.saFinder && seconds >= 5) {
      this.addRecord({
        date: Date.now(), exerciseID: null, exerciseName: 'Free hold', mode: 'Free hold',
        inTuneFraction: stats.inTuneFraction, averageAbsError: stats.averageAbsError, averageSteadiness: null,
        noteCount: 0, sungCount: 0, worstNote: null, durationSeconds: seconds,
        saName: Sruti.westernName(this.settings.sruti.midiNote),
      });
    }
    stats.reset();
  }

  // MARK: Custom exercises

  saveCustomExercise(id, name, notation, ragaID, drillSeconds = null) {
    let ex = id ? this.customExercises.find((e) => e.id === id) : null;
    if (ex) Object.assign(ex, { name, notation, ragaID, drillSeconds });
    else {
      ex = { id: `custom-${crypto.randomUUID()}`, name, notation, ragaID, drillSeconds, createdAt: Date.now() };
      this.customExercises.push(ex);
    }
    saveCustomExercises(this.customExercises);
    if (this.exerciseID === ex.id) this.restartSessionIfActive();
    this.changed();
    return ex.id;
  }

  deleteCustomExercise(id) {
    this.customExercises = this.customExercises.filter((e) => e.id !== id);
    saveCustomExercises(this.customExercises);
    if (this.exerciseID === id) this.setExercise(null);
    this.changed();
  }

  // MARK: Find my Sa

  async startFindSa() {
    this.droneWasOnBeforeFinder = this.settings.droneOn;
    this.engine.setParams({ droneOn: false });
    if (!this.isListening) await this.start();
    this.engine.setParams({ droneOn: false });
    this.saFinder = this.isListening ? new SaFinder() : null;
    this.changed();
  }

  cancelFindSa() {
    this.saFinder = null;
    this.engine.setParams({ droneOn: this.droneWasOnBeforeFinder && this.settings.droneOn });
    this.changed();
  }

  applySuggestedSa(midi) {
    this.updateSettings((s) => { s.sruti.midiNote = midi; s.sruti.fineTuneCents = 0; });
  }

  // MARK: Diagnostics

  exportRecentAudio() { return this.engine.exportRecent(30); }

  async saveRecording(m) {
    const date = Date.now();
    await Recordings.add({
      id: `${date}`, date, name: m.name, lag: m.lag,
      mic: new Blob([m.mic], { type: 'audio/wav' }), ref: m.ref ? new Blob([m.ref], { type: 'audio/wav' }) : null,
    }).catch(() => {});
    this.changed();
  }

  /** Plays a recording through the pitch pipeline instead of the mic (and aloud). */
  async startReplay(name, arrayBufferPromise) {
    if (this.isListening) this.stop();
    const ctx = this.engine.makeContext();   // created inside the click, before any await
    try {
      const data = await arrayBufferPromise;
      const audio = await ctx.decodeAudioData(data);
      const samples = new Float32Array(audio.getChannelData(0));
      this.syncAudioSettings();
      await this.engine.start({ replaySamples: samples, replayContext: ctx });
      this.beginListening(name);
    } catch (err) {
      ctx.close().catch(() => {});
      this.errorMessage = `Couldn't replay ${name}: ${err?.message ?? err}`;
    }
    this.changed();
  }

  // MARK: Audio settings

  syncAudioSettings() {
    const s = this.settings;
    const firstStringRatio = Math.pow(2, intonationCents(s.intonation, s.droneFirstString === 'pa' ? 7 : 5) / 1200);
    const octaveShift = s.droneOctave === 'traditional' ? 0 : 1;
    this.engine.setParams({
      saHz: this.saHz, firstStringRatio, octaveShift, volume: s.droneVolume,
      droneOn: s.droneOn && !this.saFinder, style: s.droneStyle === 'plucked' ? Style.plucked : Style.smooth,
    });
    this.droneFrequencies = droneFrequencies(this.saHz, firstStringRatio, octaveShift);
    this.guideKeySent = undefined;
    this.syncGuide();
  }

  /** Random practice plays each note on the guide voice, with a short break before the next (even the same note). */
  get drillGuideOn() {
    const session = this.session;
    if (!this.exercise?.drillSeconds || !session || session.phase !== 'running') return false;
    const end = session.currentStepEnd, now = this.latest?.time;
    if (end == null || now == null) return true;
    return end - now > AppState.drillGuideBreak;
  }

  /** The note after the current one in random practice, and seconds until it. */
  get drillNext() {
    const session = this.session;
    if (!this.exercise?.drillSeconds || !session || !session.nextStep) return null;
    const end = session.currentStepEnd;
    if (end == null) return null;
    return { note: session.nextStep.note, inSeconds: Math.max(end - (this.latest?.time ?? session.stepStart), 0) };
  }

  syncGuide() {
    const s = this.settings;
    const hz = this.targetHz;
    const isDrill = !!this.exercise?.drillSeconds;
    this.engine.setParams({ guideOn: isDrill ? this.drillGuideOn : s.guideNote, guideHz: hz });
    const guideAudible = s.guideNote || isDrill;
    const key = JSON.stringify([guideAudible ? hz : 0, s.droneOn, s.echoCancel, this.saHz, this.droneFrequencies, this.outputSealed]);
    if (key === this.guideKeySent) return;
    this.guideKeySent = key;
    const audible = !this.outputSealed;
    const pitches = [...(s.droneOn ? this.droneFrequencies : []), ...(guideAudible ? [hz] : [])];
    this.engine.setAnalysisContext({
      saHz: this.saHz,
      droneStrings: s.droneOn ? this.droneFrequencies : [],
      leakPitches: audible ? pitches : [],
      echoCancel: s.echoCancel,
    });
  }

  // MARK: Frames

  receive(batch) {
    if (!this.isListening || !batch.length) return;
    const last = batch[batch.length - 1];
    if (batch[0].time < this.history.lastTime) {
      this.history.clear();
      if (this.session) this.startSession(batch[0].time);
    }
    this.latest = last;
    const arrival = performance.now() / 1000;
    const sruti = this.settings.sruti;
    for (const frame of batch) {
      const session = this.session;
      if (session && session.phase !== 'finished') {
        session.process(frame.time, frame.hz != null ? Sruti.centsOfHz(sruti, frame.hz) : null);
        if (session.phase === 'finished') this.finishSession(session);
      }
      // What the eye sees (graph, readout, strip) is calmed; everything that scores uses frame.hz itself.
      const shownHz = this.settings.pitchLine === 'detailed' ? frame.hz : this.displaySmoother.process(frame.hz, frame.time);
      this.history.append([{ time: frame.time, hz: shownHz }], this.session?.phase === 'countIn' ? null : this.targetCents, arrival);
      if (frame.hz != null && !this.session && !this.exercise && !this.saFinder) {
        this.freeHoldStats.add(Sruti.centsOfHz(sruti, frame.hz) - this.targetCents, this.settings.tolerance);
      }
      if (this.saFinder) this.saFinder.add(frame.hz, this.frameDuration);
      if (frame.hz != null) {
        const start = this.voicedRunStart ?? frame.time;
        this.voicedRunStart = start;
        if (frame.time - start >= PitchHistory.minVoicedRun) { this.lastVoicedHz = shownHz; this.lastVoicedTime = frame.time; }
      } else {
        this.voicedRunStart = null;
      }
    }
    if (last.time - this.lastVoicedTime > 0.3) this.lastVoicedHz = null;
    if (this.session || this.showResults) { this.sessionTick++; this.syncGuide(); }
    this.frameCount += batch.length;
    if (last.time - this.fpsWindowStart >= 1) {
      this.framesPerSecond = this.frameCount / (last.time - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = last.time;
    }
    this.changed();
  }
}
