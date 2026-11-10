// Drone synthesis, reference pluck, guide note and metronome click — a port of
// SrutiTrainer/Audio/TanpuraRenderer.swift. Runs in the AudioWorklet (real-time thread) and in Node tests.
// Keep in step with the Swift code.

/** SplitMix64, exactly as in Swift (same sequence, so the drone sounds the same). */
export class SplitMix {
  constructor(seed) { this.state = BigInt.asUintN(64, BigInt(seed)); }
  next() {
    this.state = BigInt.asUintN(64, this.state + 0x9E3779B97F4A7C15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn);
    return z ^ (z >> 31n);
  }
  /** Uniform in −1…1. */
  uniform() { return Number(this.next() >> 11n) / 9007199254740992 * 2 - 1; }
}

export const Style = { smooth: 0, plucked: 1 };

export function defaultParams() {
  return {
    saHz: 146.83, firstStringRatio: 1.5, octaveShift: 0, style: Style.smooth, volume: 0.5, droneOn: false,
    pluckInterval: 1.1, referenceHz: 146.83, referenceSerial: 0, clickOn: false, clickBPM: 60, clickAccentEvery: 8,
    clickSerial: 0, guideOn: false, guideHz: 146.83,
  };
}

/** Frequencies of the four drone strings, in pluck order. */
export function droneFrequencies(saHz, firstStringRatio, octaveShift) {
  const base = saHz * Math.pow(2, octaveShift);
  return [base * firstStringRatio / 2, base, base, base / 2];
}

const f32 = Math.fround;

export class KarplusStrongString {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.length = 100; this.index = 0; this.s = 0.3; this.previous = 0;
    this.c = 0; this.apX1 = 0; this.apY1 = 0; this.loopGain = 0.999; this.frequency = 0;
  }
  silence() { this.buffer.fill(0); this.previous = 0; this.apX1 = 0; this.apY1 = 0; }
  tune(frequency, sampleRate, t60, brightness) {
    this.frequency = frequency;
    this.s = brightness;
    const period = sampleRate / frequency;
    const n = Math.min(Math.max(Math.floor(period - f32(brightness) - 0.2), 2), this.capacity);
    const d = period - f32(brightness) - n;
    this.c = (1 - d) / (1 + d);
    if (n !== this.length) { this.length = n; this.index = 0; this.silence(); }
    this.loopGain = Math.pow(10, -3 * period / (t60 * sampleRate));
  }
  pluck(amplitude, softness, rng) {
    let lp = 0, lp2 = 0, mean = 0;
    const b = this.buffer, len = this.length;
    for (let i = 0; i < len; i++) {
      lp += softness * (rng.uniform() - lp);
      lp2 += softness * (lp - lp2);
      lp = lp2;
      mean += lp;
      b[i] = b[i] * 0.3 + lp;
    }
    mean /= len;
    let peak = 1e-6;
    for (let i = 0; i < len; i++) { b[i] -= mean; peak = Math.max(peak, Math.abs(b[i])); }
    const scale = amplitude / peak;
    for (let i = 0; i < len; i++) b[i] *= scale;
    this.index = 0;
  }
  tick() {
    const b = this.buffer, x = b[this.index];
    const lowpassed = (1 - this.s) * x + this.s * this.previous;
    this.previous = x;
    const y = this.c * lowpassed + this.apX1 - this.c * this.apY1;
    this.apX1 = lowpassed;
    this.apY1 = y;
    b[this.index] = y * this.loopGain;
    if (++this.index >= this.length) this.index = 0;
    return x;
  }
}

/** The smooth drone: soft harmonics with gentle swells in the tanpura cycle (SteadyDrone in Swift). */
export class SteadyDrone {
  static harmonicCount = 8;
  static harmonicLevels = [1, 0.5, 0.3, 0.18, 0.11, 0.07, 0.045, 0.03];
  static outputGain = 0.16;
  static maxVoices = 4;
  static swellCycle = [0, 1, 1, 2];

  constructor() {
    const V = SteadyDrone.maxVoices, n = V * SteadyDrone.harmonicCount;
    this.voiceCount = 0;
    this.phase = new Float64Array(V); this.increment = new Float64Array(V); this.bloom = new Float64Array(V);
    this.voiceLevel = new Float64Array(V); this.harmonicsInVoice = new Int32Array(V); this.blooming = new Uint8Array(V);
    this.amp = new Float64Array(n); this.ampStep = new Float64Array(n);
    this.lfoPhase = new Float64Array(n); this.lfoRate = new Float64Array(n);
    const rng = new SplitMix(99);
    for (let j = 0; j < n; j++) {
      this.lfoPhase[j] = (rng.uniform() + 1) * Math.PI;
      this.lfoRate[j] = 0.1 + 0.25 * (rng.uniform() + 1);
    }
    this.swellClock = 0; this.nextSwell = 0; this.started = false; this.bloomCount = 0;
  }

  tune(frequencies, levels, sampleRate) {
    this.voiceCount = Math.min(frequencies.length, SteadyDrone.maxVoices);
    for (let v = 0; v < this.voiceCount; v++) {
      this.increment[v] = 2 * Math.PI * frequencies[v] / sampleRate;
      this.voiceLevel[v] = v < levels.length ? levels[v] : 1;
      this.harmonicsInVoice[v] = Math.max(1, Math.min(SteadyDrone.harmonicCount, Math.trunc(sampleRate * 0.45 / frequencies[v])));
    }
    this.started = false;
  }

  advance(samples, sampleRate, bloomInterval = 1.1, bloomOn = false) {
    if (samples <= 0) return;
    const seconds = samples / sampleRate, H = SteadyDrone.harmonicCount;
    if (bloomOn && this.voiceCount > 0) {
      this.swellClock -= seconds;
      if (this.swellClock <= 0) {
        this.blooming[SteadyDrone.swellCycle[this.nextSwell] % this.voiceCount] = 1;
        this.bloomCount += 1;
        this.nextSwell = (this.nextSwell + 1) % SteadyDrone.swellCycle.length;
        this.swellClock += bloomInterval;
      }
    }
    for (let v = 0; v < this.voiceCount; v++) {
      if (this.blooming[v]) {
        this.bloom[v] += seconds / 0.18;
        if (this.bloom[v] >= 1) { this.bloom[v] = 1; this.blooming[v] = 0; }
      } else {
        this.bloom[v] *= Math.exp(-seconds / 1.6);
      }
    }
    const inverse = 1 / samples;
    for (let v = 0; v < this.voiceCount; v++) {
      const base = v * H;
      for (let k = 0; k < H; k++) {
        const j = base + k;
        this.lfoPhase[j] += 2 * Math.PI * this.lfoRate[j] * seconds;
        if (this.lfoPhase[j] > 2 * Math.PI) this.lfoPhase[j] -= 2 * Math.PI;
        let target = 0;
        if (k < this.harmonicsInVoice[v]) {
          const slow = k >= 2 ? 1 + 0.15 * Math.sin(this.lfoPhase[j]) : 1;
          const swell = k >= 1 ? 0.8 + 0.55 * this.bloom[v] : 1;
          target = SteadyDrone.outputGain * this.voiceLevel[v] * SteadyDrone.harmonicLevels[k] * slow * swell;
        }
        if (this.started) this.ampStep[j] = (target - this.amp[j]) * inverse;
        else { this.amp[j] = target; this.ampStep[j] = 0; }
      }
    }
    this.started = true;
  }

  tick() {
    let sum = 0;
    const H = SteadyDrone.harmonicCount, twoPi = 2 * Math.PI, amp = this.amp, step = this.ampStep;
    for (let v = 0; v < this.voiceCount; v++) {
      let ph = this.phase[v] + this.increment[v];
      if (ph >= twoPi) ph -= twoPi;
      this.phase[v] = ph;
      const twoCos = 2 * Math.cos(ph);
      let previous = 0, current = Math.sin(ph);
      const base = v * H, count = this.harmonicsInVoice[v];
      for (let k = 0; k < count; k++) {
        const j = base + k, a = amp[j];
        sum += a * current;
        amp[j] = a + step[j];
        const next = twoCos * current - previous;
        previous = current;
        current = next;
      }
    }
    return sum;
  }
}

/** The guide note: a voice-like "ooh" that cross-fades between notes (GuideVoice in Swift). */
export class GuideVoice {
  static harmonics = 8;
  constructor() {
    this.phases = [0, 0]; this.frequencies = [146.83, 146.83]; this.levels = [0, 0]; this.targets = [0, 0];
    this.amps = new Float64Array(16); this.active = 0; this.sampleRate = 48000;
    this.attack = 0.0005; this.release = 0.001; this.breathPhase = 0;
  }
  set(f, on, sampleRate) {
    this.sampleRate = sampleRate;
    this.attack = 1 - Math.exp(-1 / (0.10 * sampleRate));
    this.release = 1 - Math.exp(-1 / (0.06 * sampleRate));
    const changed = Math.abs(1200 * Math.log2(f / this.frequencies[this.active])) > 1;
    if (on && changed && this.levels[this.active] > 0.01) {
      this.targets[this.active] = 0;
      this.active = 1 - this.active;
      this.phases[this.active] = 0; this.levels[this.active] = 0;
    }
    if (changed || this.levels[this.active] < 0.001) {
      this.frequencies[this.active] = f;
      this.setTimbre(this.active, f);
    }
    this.targets[this.active] = on ? 1 : 0;
  }
  setTimbre(slot, f) {
    let energy = 0;
    const H = GuideVoice.harmonics;
    for (let k = 0; k < H; k++) {
      const fk = f * (k + 1);
      let a = 0;
      if (fk < 4000) {
        const formant = Math.exp(-Math.pow((fk - 500) / 300, 2)) + 0.6 * Math.exp(-Math.pow((fk - 1000) / 400, 2));
        a = Math.pow(k + 1, -0.8) * (0.35 + formant);
      }
      this.amps[slot * H + k] = a;
      energy += a * a;
    }
    const norm = 1 / Math.max(Math.sqrt(energy), 1e-6);
    for (let k = 0; k < H; k++) this.amps[slot * H + k] *= norm;
  }
  voice(slot) {
    let phase = this.phases[slot] + 2 * Math.PI * this.frequencies[slot] / this.sampleRate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    this.phases[slot] = phase;
    const twoCos = 2 * Math.cos(phase);
    let previous = 0, current = Math.sin(phase), v = 0;
    const base = slot * GuideVoice.harmonics;
    for (let k = 0; k < GuideVoice.harmonics; k++) {
      v += this.amps[base + k] * current;
      const next = twoCos * current - previous;
      previous = current;
      current = next;
    }
    return v;
  }
  tick() {
    const L = this.levels, T = this.targets;
    L[0] += (T[0] - L[0]) * (T[0] > L[0] ? this.attack : this.release);
    L[1] += (T[1] - L[1]) * (T[1] > L[1] ? this.attack : this.release);
    if (!(L[0] > 1e-4 || L[1] > 1e-4)) return 0;
    this.breathPhase += 2 * Math.PI * 0.3 / this.sampleRate;
    if (this.breathPhase > 2 * Math.PI) this.breathPhase -= 2 * Math.PI;
    const breath = 1 + 0.03 * Math.sin(this.breathPhase);
    let out = 0;
    if (L[0] > 1e-4) out += L[0] * this.voice(0);
    if (L[1] > 1e-4) out += L[1] * this.voice(1);
    return out * 0.45 * breath;
  }
}

export function softLimit(x) {
  const a = Math.abs(x);
  if (!(a > 0.7)) return x;
  return (x < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
}

export class TanpuraRenderer {
  static droneStringCount = 4;
  static referenceIndex = 4;
  static stringLevels = [0.8, 0.7, 0.7, 1.0, 0.9];

  constructor() {
    this.params = defaultParams();
    this.sampleRate = 48000;
    this.strings = Array.from({ length: 5 }, () => new KarplusStrongString(8192));
    this.steady = new SteadyDrone();
    this.guide = new GuideVoice();
    this.steadyLowpass = 0;
    this.gain = 0;
    this.pluckCount = 0;
    this.samplesUntilPluck = 0;
    this.nextString = 0;
    this.wasOn = false;
    this.tunedKey = '';
    this.handledReferenceSerial = 0;
    this.rng = new SplitMix(0x5EED);
    this.handledClickSerial = 0;
    this.samplesUntilClick = 0;
    this.clickBeat = 0;
    this.clickEnvelope = 0;
    this.clickPhase = 0;
    this.clickFrequency = 1175;
  }

  prepare(sampleRate) {
    this.sampleRate = sampleRate;
    this.tunedKey = '';
    for (const s of this.strings) s.silence();
    this.gain = 0; this.wasOn = false; this.clickEnvelope = 0;
  }

  retuneIfNeeded(p) {
    const key = `${p.saHz}|${p.firstStringRatio}|${p.octaveShift}|${this.sampleRate}`;
    if (key === this.tunedKey) return;
    this.tunedKey = key;
    const freqs = droneFrequencies(p.saHz, p.firstStringRatio, p.octaveShift);
    freqs.forEach((f, i) => this.strings[i].tune(f, this.sampleRate, 12, 0.3));
    this.steady.tune([freqs[0], freqs[1], freqs[3]], [0.55, 1.0, 0.75], this.sampleRate);
  }

  /** Renders `out.length` samples into out; `droneOnly` (optional) receives the drone as played. */
  render(out, droneOnly = null) {
    const p = this.params, count = out.length, sr = this.sampleRate;
    this.retuneIfNeeded(p);
    const plucked = p.style === Style.plucked;
    const strings = this.strings, levels = TanpuraRenderer.stringLevels;

    if (p.referenceSerial !== this.handledReferenceSerial) {
      this.handledReferenceSerial = p.referenceSerial;
      strings[4].tune(p.referenceHz, sr, 3.5, 0.25);
      strings[4].pluck(1, 0.35, this.rng);
    }
    if (p.clickSerial !== this.handledClickSerial) {
      this.handledClickSerial = p.clickSerial;
      this.samplesUntilClick = 0;
      this.clickBeat = 0;
    }
    if (p.droneOn && !this.wasOn) { this.samplesUntilPluck = 0; this.nextString = 0; }
    this.wasOn = p.droneOn;

    const targetGain = p.droneOn ? p.volume : 0;
    const smoothing = 1 - Math.exp(-1 / (0.12 * sr));
    const referenceLevel = Math.max(p.volume, 0.35);
    const clickDecay = Math.exp(-1 / (0.012 * sr));
    const beatSamples = Math.trunc(60 / Math.max(p.clickBPM, 20) * sr);
    const smoothActive = !plucked && (p.droneOn || this.gain > 1e-5);
    if (smoothActive) this.steady.advance(count, sr, p.pluckInterval, p.droneOn);
    this.guide.set(p.guideHz, p.guideOn, sr);
    const lowpassCoefficient = 1 - Math.exp(-2 * Math.PI * 2500 / sr);
    const guideLevel = Math.max(p.volume, 0.3) * 0.22;

    for (let i = 0; i < count; i++) {
      if (p.droneOn && plucked) {
        if (this.samplesUntilPluck <= 0) {
          strings[this.nextString].pluck(1, 0.2, this.rng);
          this.pluckCount += 1;
          this.nextString = (this.nextString + 1) % TanpuraRenderer.droneStringCount;
          const jitter = 1 + 0.04 * this.rng.uniform();
          this.samplesUntilPluck = Math.trunc(p.pluckInterval * jitter * sr);
        }
        this.samplesUntilPluck -= 1;
      }
      this.gain += (targetGain - this.gain) * smoothing;

      let drone = 0;
      if (plucked) {
        for (let s = 0; s < 4; s++) drone += strings[s].tick() * levels[s];
        drone *= 0.35;
      } else if (smoothActive) {
        this.steadyLowpass += lowpassCoefficient * (this.steady.tick() - this.steadyLowpass);
        drone = this.steadyLowpass;
      }
      const reference = strings[4].tick() * levels[4];
      const playedDrone = drone * this.gain;
      if (droneOnly) droneOnly[i] = playedDrone;
      const mixed = playedDrone + reference * 0.35 * referenceLevel + this.guide.tick() * guideLevel;
      let sample = softLimit(mixed);

      if (p.clickOn) {
        if (this.samplesUntilClick <= 0) {
          this.clickFrequency = this.clickBeat % Math.max(p.clickAccentEvery, 1) === 0 ? 1760 : 1175;
          this.clickEnvelope = 1;
          this.clickPhase = 0;
          this.clickBeat += 1;
          this.samplesUntilClick = beatSamples;
        }
        this.samplesUntilClick -= 1;
      }
      if (this.clickEnvelope > 1e-4) {
        sample += 0.4 * this.clickEnvelope * Math.sin(this.clickPhase);
        this.clickPhase += 2 * Math.PI * this.clickFrequency / sr;
        this.clickEnvelope *= clickDecay;
      }
      out[i] = sample;
    }
  }
}
