// Pitch pipeline — a line-for-line port of SrutiTrainer/Audio (PitchAnalyzer, YINDetector, PitchFrame,
// PitchSmoother, DroneLeakFilter, NoiseSuppressor, DroneCanceller). Keep in step with the Swift code:
// the iOS app and the website must hear the same thing. No DOM here: runs in a Web Worker and in Node.

// MARK: - Voicing gate (PitchFrame.swift)

export const VoicingGate = {
  minConfidence: 0.72,
  minRMSdB: -62.0,
  minSNRdB: 3.0,
  holdRMSdB: -70.0,
  holdSNRdB: 1.0,
  holdConfidence: 0.5,
  memorySeconds: 0.4,
  onsetFrames: 3,
  onsetToleranceCents: 60.0,
  droneSettleSeconds: 0.5,
  droneOnlySeconds: 0.5,

  /** Where a singer with this Sa can plausibly be: from just below mandra Sa to above tara Pa. */
  searchRange(saHz) {
    if (!(saHz > 0)) return [55, 1200];
    return [Math.max(50, 0.45 * saHz), Math.min(1400, 4.5 * saHz)];
  },
  isLoudEnoughToStart(rmsDB, snrDB) { return rmsDB >= this.minRMSdB && snrDB >= this.minSNRdB; },
  isLoudEnoughToHold(rmsDB, snrDB) { return rmsDB >= this.holdRMSdB && snrDB >= this.holdSNRdB; },
  isVoiced(rmsDB, confidence) { return rmsDB >= this.minRMSdB && confidence >= this.minConfidence; },
};

export const Gate = { voiced: 'voiced', quiet: 'quiet', unclear: 'unclear', leak: 'leak' };

// MARK: - YIN (YINDetector.swift)

export class YINDetector {
  static noiseFloorMargin = 0.1;

  constructor(sampleRate, windowSize = 2048, minHz = 60, maxHz = 1000, threshold = 0.12) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
    this.tauMax = Math.min(Math.ceil(sampleRate / minHz), windowSize / 2);
    this.searchTauMin = this.tauMin;
    this.searchTauMax = this.tauMax;
    this.integrationLength = windowSize - (this.tauMax + 2);
    this.diff = new Float64Array(this.tauMax + 2);
    this.cmnd = new Float64Array(this.tauMax + 2).fill(1);
  }

  setSearchRange(minHz, maxHz) {
    this.searchTauMin = Math.max(this.tauMin, Math.floor(this.sampleRate / maxHz));
    this.searchTauMax = Math.min(this.tauMax, Math.ceil(this.sampleRate / minHz));
    if (this.searchTauMax <= this.searchTauMin + 2) { this.searchTauMin = this.tauMin; this.searchTauMax = this.tauMax; }
  }

  /** Pitch of `samples` (≥ windowSize values) or null. */
  detect(samples) {
    this.computeCMND(samples);
    return this.pickFirstDip();
  }

  /** After `detect`: the deepest dip within ±cents of hz, or null. */
  dip(hz, cents = 120) {
    const lo = Math.max(this.searchTauMin + 1, Math.floor(this.sampleRate / (hz * Math.pow(2, cents / 1200))));
    const hi = Math.min(this.searchTauMax - 1, Math.ceil(this.sampleRate / (hz * Math.pow(2, -cents / 1200))));
    if (!(hi > lo)) return null;
    const c = this.cmnd;
    let best = -1, bestValue = Infinity;
    for (let t = lo; t <= hi; t++) {
      if (c[t] < bestValue && c[t] <= c[t - 1] && c[t] <= c[t + 1]) { bestValue = c[t]; best = t; }
    }
    if (best <= 0) return null;
    return this.refine(best);
  }

  computeCMND(x) {
    const n = this.integrationLength;
    // d'(τ) depends only on d(1…τ), so lags past the search range are never needed (same result as the
    // Swift code, which computes the whole range).
    const lastTau = Math.min(this.tauMax + 1, this.searchTauMax + 1);
    const d = this.diff;
    let e0 = 0;
    for (let j = 0; j < n; j++) e0 += x[j] * x[j];
    let eTau = e0;
    d[0] = 0;
    for (let tau = 1; tau <= lastTau; tau++) {
      const leaving = x[tau - 1], entering = x[tau + n - 1];
      eTau += entering * entering - leaving * leaving;
      let cross = 0;
      for (let j = 0; j < n; j++) cross += x[j] * x[j + tau];
      const v = e0 + eTau - 2 * cross;
      d[tau] = v > 0 ? v : 0;
    }
    const c = this.cmnd;
    c[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= lastTau; tau++) {
      running += d[tau];
      c[tau] = running > 0 ? d[tau] * tau / running : 1;
    }
  }

  pickFirstDip() {
    const lo = this.searchTauMin, hi = this.searchTauMax, c = this.cmnd;
    let globalMin = Infinity;
    for (let t = lo; t <= hi; t++) if (c[t] < globalMin) globalMin = c[t];
    const th = Math.max(this.threshold, globalMin + YINDetector.noiseFloorMargin);
    let best = -1;
    for (let tau = lo; tau <= hi; tau++) {
      if (c[tau] < th) {
        const limit = Math.min(hi, tau + Math.max(4, Math.floor(tau / 4)));
        best = tau;
        for (let t = tau + 1; t <= limit && c[t] < th; t++) if (c[t] < c[best]) best = t;
        break;
      }
    }
    if (best <= lo || best >= hi) return null;
    return this.refine(best);
  }

  refine(best) {
    const c = this.cmnd;
    const s0 = c[best - 1], s1 = c[best], s2 = c[best + 1];
    const denom = s0 - 2 * s1 + s2;
    let shift = denom !== 0 ? 0.5 * (s0 - s2) / denom : 0;
    shift = Math.min(Math.max(shift, -1), 1);
    const tau = best + shift;
    if (!(tau > 0)) return null;
    return { hz: this.sampleRate / tau, confidence: Math.min(Math.max(1 - s1, 0), 1) };
  }
}

// MARK: - Smoother (PitchSmoother.swift)

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class PitchSmoother {
  constructor() {
    this.medianLength = 5;
    this.silenceResetFrames = 3;
    this.octaveJumpConfirmFrames = 5;
    this.reset();
  }
  reset() { this.history = []; this.silentRun = 0; this.jumpRun = 0; }

  process(hz) {
    if (hz == null || !(hz > 0)) {
      this.silentRun += 1;
      if (this.silentRun >= this.silenceResetFrames) { this.history = []; this.jumpRun = 0; }
      return null;
    }
    this.silentRun = 0;
    const cents = 1200 * Math.log2(hz);
    if (this.history.length >= 3) {
      const reference = median(this.history.slice(-3));
      if (Math.abs(Math.abs(cents - reference) - 1200) <= 150) {
        this.jumpRun += 1;
        if (this.jumpRun < this.octaveJumpConfirmFrames) return null;
        this.history = [];
      }
    }
    this.jumpRun = 0;
    this.history.push(cents);
    if (this.history.length > this.medianLength) this.history.splice(0, this.history.length - this.medianLength);
    return Math.pow(2, median(this.history) / 1200);
  }
}

// MARK: - Leak filter (DroneLeakFilter.swift)

export class DroneLeakFilter {
  constructor(droneHz) {
    this.pitchClasses = droneHz.map(DroneLeakFilter.pitchClass);
    this.toleranceCents = 30.0;
    this.startSNRdB = 7.0;
    this.holdSNRdB = 3.0;
    this.startOverDroneDB = -6.0;
    this.holdOverDroneDB = -12.0;
  }
  isLeak(hz, snrDB) { return snrDB < this.startSNRdB && this.isDronePitch(hz); }
  hasFadedIntoLeak(hz, snrDB) { return snrDB < this.holdSNRdB && this.isDronePitch(hz); }
  isDronePitch(hz) {
    const pc = DroneLeakFilter.pitchClass(hz);
    return this.pitchClasses.some((c) => {
      const d = Math.abs(pc - c) % 1200;
      return Math.min(d, 1200 - d) <= this.toleranceCents;
    });
  }
  static pitchClass(hz) {
    const cents = 1200 * Math.log2(hz / 16.351597831287414);
    const r = cents % 1200;
    return r < 0 ? r + 1200 : r;
  }
}

// MARK: - FFT (stands in for vDSP_fft_zrip)

/** In-place radix-2 complex FFT of size n (power of two). */
class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = Math.sin(2 * Math.PI * i / n); }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** inverse=false: X_k = Σ x_n e^{−2πikn/N}; inverse=true: the unnormalised inverse (no 1/N). */
  transform(re, im, inverse) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = sign * this.sin[k * step];
          const a = start + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

// MARK: - Noise suppressor (NoiseSuppressor.swift)

export class NoiseSuppressor {
  constructor(sampleRate, windowSize = 2048) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    let size = 1;
    while (size < windowSize * 2) size <<= 1;
    this.fftSize = size;
    this.gainFloor = 0.12;
    this.ddAlpha = 0.9;
    this.bias = 2.5;
    this.minimumNoiseMeanSquare = Math.pow(10, -85.0 / 10);
    this.bins = size / 2 + 1;
    this.binHz = sampleRate / size;
    this.statsLo = Math.max(1, Math.floor(60 / this.binHz));
    this.statsHi = Math.min(this.bins - 1, Math.floor(5000 / this.binHz));
    const floorSum = Math.pow(10, -85.0 / 10) * windowSize * (2 * size) * 2.5;
    this.floorPerBin = floorSum / (this.statsHi - this.statsLo + 1);
    this.framesPerSub = 24;
    this.subCount = 6;
    this.rise = 1.03;
    this.riseAtStart = 1.15;
    this.fft = new FFT(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    const b = this.bins;
    this.power = new Float64Array(b);
    this.smoothed = new Float64Array(b);
    this.noise = new Float64Array(b).fill(this.floorPerBin);
    this.cleanPower = new Float64Array(b);
    this.frozen = new Uint8Array(b);
    this.current = new Float64Array(b).fill(Infinity);
    this.subMins = new Float64Array(b * this.subCount).fill(Infinity);
    this.frameInSub = 0;
    this.subWrite = 0;
    this.framesSeen = 0;
  }

  reset() {
    this.framesSeen = 0; this.frameInSub = 0; this.subWrite = 0;
    this.smoothed.fill(0); this.noise.fill(this.floorPerBin); this.cleanPower.fill(0); this.current.fill(Infinity);
    this.subMins.fill(Infinity);
  }

  /** Denoises windowSize samples of `input` into `output`; returns { snrDB, noiseDBFS }. */
  process(input, output, voicedHz) {
    const N = this.fftSize, half = N / 2, W = this.windowSize, re = this.re, im = this.im;
    for (let i = 0; i < W; i++) { re[i] = input[i]; im[i] = 0; }
    for (let i = W; i < N; i++) { re[i] = 0; im[i] = 0; }
    this.fft.transform(re, im, false);
    // vDSP's real FFT is scaled by 2: power = |2X|², so every threshold matches the Swift code.
    const power = this.power;
    for (let k = 0; k <= half; k++) power[k] = 4 * (re[k] * re[k] + im[k] * im[k]);

    this.markFrozen(voicedHz);
    this.updateBackground();

    let signalSum = 0, noiseSum = 0;
    const noise = this.noise, clean = this.cleanPower, dd = this.ddAlpha, floorG = this.gainFloor;
    for (let k = 0; k <= half; k++) {
      const p = power[k], n = noise[k];
      let g = 1;
      if (n > 0) {
        const post = p / n;
        const prio = dd * clean[k] / n + (1 - dd) * Math.max(post - 1, 0);
        g = Math.max(floorG, prio / (1 + prio));
      }
      clean[k] = g * g * p;
      if (k >= this.statsLo && k <= this.statsHi) { signalSum += p; noiseSum += n; }
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < half) { re[N - k] *= g; im[N - k] *= g; }
    }
    this.fft.transform(re, im, true);
    for (let i = 0; i < W; i++) output[i] = re[i] / N;

    this.framesSeen += 1;
    const floorSum = this.minimumNoiseMeanSquare * W * (2 * N) * this.bias;
    const snr = 10 * Math.log10(Math.max(signalSum, 1e-30) / Math.max(noiseSum, floorSum));
    const noiseMeanSquare = noiseSum / this.bias * 2 / (4 * N) / W;
    const noiseDB = noiseMeanSquare > 0 ? 10 * Math.log10(noiseMeanSquare) : -120;
    return { snrDB: snr, noiseDBFS: noiseDB };
  }

  markFrozen(hz) {
    const f = this.frozen;
    f.fill(0);
    if (hz == null || !(hz > 0)) return;
    for (let h = 1; h * hz < 5000; h++) {
      const c = h * hz / this.binHz;
      const w = 2.5 + 0.03 * c;
      const lo = Math.max(0, Math.floor(c - w)), hi = Math.min(this.bins - 1, Math.ceil(c + w));
      for (let k = lo; k <= hi; k++) f[k] = 1;
    }
  }

  updateBackground() {
    const a = 0.5, b = this.bins, power = this.power, sm = this.smoothed, cur = this.current, fr = this.frozen;
    for (let k = 0; k < b; k++) {
      sm[k] = this.framesSeen === 0 ? power[k] : a * sm[k] + (1 - a) * power[k];
      if (!fr[k] && sm[k] < cur[k]) cur[k] = sm[k];
    }
    const riseLimit = this.framesSeen < 94 ? this.riseAtStart : this.rise;
    const noise = this.noise, subs = this.subMins;
    for (let k = 0; k < b; k++) {
      if (fr[k]) continue;
      let m = cur[k];
      for (let s = 0, j = k; s < this.subCount; s++, j += b) if (subs[j] < m) m = subs[j];
      if (!Number.isFinite(m)) continue;
      const target = Math.max(this.bias * m, this.floorPerBin);
      if (target < noise[k]) noise[k] = target;
      else noise[k] = Math.min(target, noise[k] * riseLimit);
    }
    this.frameInSub += 1;
    if (this.frameInSub >= this.framesPerSub) {
      this.frameInSub = 0;
      subs.set(cur, this.subWrite * b);
      this.subWrite = (this.subWrite + 1) % this.subCount;
      cur.fill(Infinity);
    }
  }
}

// MARK: - Drone canceller (DroneCanceller.swift)

export const SteadyHarmonicCount = 8;

export class DroneCanceller {
  static envelopeDelay = 0.04;

  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.shortAlpha = 1 - Math.exp(-1 / (0.02 * sampleRate));
    this.coherenceAlpha = 1 - Math.exp(-1 / (0.3 * sampleRate));
    this.followAlpha = 1 - Math.exp(-1 / (0.15 * sampleRate));
    this.minCoherence = 0.9;
    this._frequencies = [];
    this.count = 0;
  }

  static partials(strings, harmonics = SteadyHarmonicCount) {
    const out = [];
    for (const s of strings) for (let h = 1; h <= harmonics; h++) out.push(h * s);
    return out;
  }

  get frequencies() { return this._frequencies; }
  set frequencies(list) {
    const same = list.length === this._frequencies.length && list.every((f, i) => f === this._frequencies[i]);
    if (same) return;
    this._frequencies = [...list];
    this.build();
  }

  build() {
    const unique = [];
    for (const f of [...this._frequencies].sort((a, b) => a - b)) {
      if (!(f > 40 && f < this.sampleRate * 0.45)) continue;
      if (unique.length && Math.abs(unique[unique.length - 1] - f) < 0.5) continue;
      unique.push(f);
    }
    const n = unique.length;
    this.count = n;
    this.hz = Float64Array.from(unique);
    const z = () => new Float64Array(n);
    this.stepRe = z(); this.stepIm = z();
    for (let i = 0; i < n; i++) {
      const w = 2 * Math.PI * unique[i] / this.sampleRate;
      this.stepRe[i] = Math.cos(w); this.stepIm[i] = Math.sin(w);
    }
    this.oscRe = new Float64Array(n).fill(1); this.oscIm = z();
    this.m1Re = z(); this.m1Im = z(); this.mRe = z(); this.mIm = z();
    this.r1Re = z(); this.r1Im = z(); this.rRe = z(); this.rIm = z();
    this.smrRe = z(); this.smrIm = z(); this.smm = z(); this.srr = z();
    this.hRe = z(); this.hIm = z();
    this.slrRe = z(); this.slrIm = z(); this.sll = z();
    this.leftMSC = z(); this.leftSmoothP = z(); this.droneP = z(); this.leftP = z();
  }

  get isActive() { return this.count > 0; }

  reset() { this.build(); }

  voiceOverDroneDB(hz) {
    let drone = 0, left = 0;
    for (let i = 0; i < this.count; i++) {
      const f = this.hz[i], h = Math.round(f / hz);
      if (!(h >= 1 && Math.abs(f - h * hz) <= 2 + 0.015 * f)) continue;
      drone += this.droneP[i]; left += this.leftP[i];
    }
    if (!(drone > 1e-13)) return null;
    return 10 * Math.log10(Math.max(left, 1e-20) / drone);
  }

  isDroneOnly(hz) {
    let coherent = 0, total = 0;
    for (let i = 0; i < this.count; i++) {
      const f = this.hz[i], h = Math.round(f / hz);
      if (!(h >= 1 && Math.abs(f - h * hz) <= 2 + 0.015 * f)) continue;
      total += this.leftSmoothP[i];
      if (this.leftMSC[i] >= 0.95) coherent += this.leftSmoothP[i];
    }
    return total > 1e-13 && coherent >= 0.8 * total;
  }

  /** Cancels the drone from x[offset…offset+count) in place; reference[refOffset…] is the aligned drone. */
  process(x, offset, reference, refOffset, count, singing) {
    const P = this.count;
    if (P === 0) return;
    const s = this.shortAlpha, ca = this.coherenceAlpha, fa = this.followAlpha, minC = this.minCoherence;
    const { oscRe, oscIm, stepRe, stepIm, m1Re, m1Im, mRe, mIm, r1Re, r1Im, rRe, rIm, smrRe, smrIm, smm, srr,
      hRe, hIm, slrRe, slrIm, sll } = this;
    for (let n = 0; n < count; n++) {
      const v = x[offset + n], ref = reference[refOffset + n];
      let estimate = 0;
      const last = n === count - 1;
      for (let i = 0; i < P; i++) {
        const oR = oscRe[i], oI = oscIm[i];
        const cRe = 2 * oR, cIm = -2 * oI;
        m1Re[i] += s * (v * cRe - m1Re[i]); m1Im[i] += s * (v * cIm - m1Im[i]);
        const mr = (mRe[i] += s * (m1Re[i] - mRe[i])), mi = (mIm[i] += s * (m1Im[i] - mIm[i]));
        r1Re[i] += s * (ref * cRe - r1Re[i]); r1Im[i] += s * (ref * cIm - r1Im[i]);
        const rr = (rRe[i] += s * (r1Re[i] - rRe[i])), ri = (rIm[i] += s * (r1Im[i] - rIm[i]));
        const xyRe = mr * rr + mi * ri, xyIm = mi * rr - mr * ri;
        const sR = (smrRe[i] += ca * (xyRe - smrRe[i])), sI = (smrIm[i] += ca * (xyIm - smrIm[i]));
        const mm = (smm[i] += ca * (mr * mr + mi * mi - smm[i]));
        const r2 = (srr[i] += ca * (rr * rr + ri * ri - srr[i]));
        const cross2 = sR * sR + sI * sI;
        if (!singing && r2 > 1e-14 && cross2 >= minC * mm * r2) {
          hRe[i] += fa * (sR / r2 - hRe[i]);
          hIm[i] += fa * (sI / r2 - hIm[i]);
        }
        const h_r = hRe[i], h_i = hIm[i];
        const eRe = h_r * rr - h_i * ri, eIm = h_r * ri + h_i * rr;
        estimate += eRe * oR - eIm * oI;
        const lRe = mr - eRe, lIm = mi - eIm;
        slrRe[i] += ca * (lRe * rr + lIm * ri - slrRe[i]);
        slrIm[i] += ca * (lIm * rr - lRe * ri - slrIm[i]);
        sll[i] += ca * (lRe * lRe + lIm * lIm - sll[i]);
        if (last) {
          this.droneP[i] = eRe * eRe + eIm * eIm;
          this.leftP[i] = lRe * lRe + lIm * lIm;
          const lr2 = slrRe[i] * slrRe[i] + slrIm[i] * slrIm[i];
          this.leftMSC[i] = sll[i] * r2 > 1e-28 ? lr2 / (sll[i] * r2) : 0;
          this.leftSmoothP[i] = sll[i];
        }
        oscRe[i] = oR * stepRe[i] - oI * stepIm[i];
        oscIm[i] = oR * stepIm[i] + oI * stepRe[i];
      }
      x[offset + n] = v - estimate;
    }
    for (let i = 0; i < P; i++) {
      const m = 1 / Math.sqrt(oscRe[i] * oscRe[i] + oscIm[i] * oscIm[i]);
      oscRe[i] *= m; oscIm[i] *= m;
    }
  }
}

// MARK: - Biquad (PitchAnalyzer.swift)

export class Biquad {
  constructor(b0, b1, b2, a1, a2) { Object.assign(this, { b0, b1, b2, a1, a2 }); this.z1 = 0; this.z2 = 0; }
  static highPass(cutoff, q, sampleRate) {
    const w0 = 2 * Math.PI * cutoff / sampleRate, alpha = Math.sin(w0) / (2 * q), c = Math.cos(w0), a0 = 1 + alpha;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0);
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
  copyState(o) { this.z1 = o.z1; this.z2 = o.z2; }
}

// MARK: - Pitch analyzer (PitchAnalyzer.swift)

export class PitchAnalyzer {
  constructor(sampleRate, windowSize = 2048, hopSize = 512, saHz = null) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.hopSize = hopSize;
    this.detector = new YINDetector(sampleRate, windowSize, 50, 1400);
    this.suppressor = new NoiseSuppressor(sampleRate, windowSize);
    this.canceller = new DroneCanceller(sampleRate);
    this.smoother = new PitchSmoother();
    this.leakFilter = null;
    this._droneStrings = [];
    this.droneSettleUntil = -Infinity;
    this.droneOnlyFrames = 0;
    this.highPass = [];
    this.history = new Float32Array(windowSize);
    this.clean = new Float32Array(windowSize);
    this.chunk = new Float32Array(1024);
    this.filled = 0;
    this.sinceHop = 0;
    this.totalSamples = 0;
    this.lastVoicedHz = null;
    this.lastVoicedTime = -Infinity;
    this.onset = [];
    this._saHz = saHz;
    this.configureForSa();
  }

  get saHz() { return this._saHz; }
  set saHz(v) { if (v !== this._saHz) { this._saHz = v; this.configureForSa(); } }

  get droneStrings() { return this._droneStrings; }
  set droneStrings(list) {
    const old = this._droneStrings;
    if (list.length === old.length && list.every((f, i) => f === old[i])) return;
    this._droneStrings = [...list];
    this.canceller.frequencies = DroneCanceller.partials(list);
    this.droneSettleUntil = this.totalSamples / this.sampleRate + VoicingGate.droneSettleSeconds;
  }

  reset() {
    this.smoother.reset(); this.suppressor.reset(); this.canceller.reset();
    for (const b of this.highPass) b.reset();
    this.filled = 0; this.sinceHop = 0; this.lastVoicedHz = null; this.lastVoicedTime = -Infinity;
    this.onset = []; this.droneOnlyFrames = 0;
  }

  skip(sample) {
    if (sample === this.totalSamples) return;
    this.totalSamples = sample; this.filled = 0; this.sinceHop = 0; this.onset = [];
  }

  configureForSa() {
    const [lo, hi] = VoicingGate.searchRange(this._saHz);
    this.detector.setSearchRange(lo, hi);
    const cutoff = Math.min(Math.max(lo * 0.8, 40), 80);
    const old = this.highPass;
    this.highPass = [Biquad.highPass(cutoff, 0.5412, this.sampleRate), Biquad.highPass(cutoff, 1.3066, this.sampleRate)];
    for (let i = 0; i < this.highPass.length && i < old.length; i++) this.highPass[i].copyState(old[i]);
  }

  /** Feeds consecutive mic samples (Float32Array); `reference` (same length) is the aligned drone or null. */
  process(samples, reference = null) {
    const frames = [];
    const count = samples.length, chunk = this.chunk;
    let i = 0;
    while (i < count) {
      const n = Math.min(this.hopSize - this.sinceHop, count - i, chunk.length);
      const hp = this.highPass;
      for (let j = 0; j < n; j++) {
        let x = samples[i + j];
        for (let s = 0; s < hp.length; s++) x = hp[s].process(x);
        chunk[j] = x;
      }
      if (reference && this.canceller.isActive) {
        const singing = (this.lastVoicedHz != null
          && this.totalSamples / this.sampleRate - this.lastVoicedTime <= VoicingGate.memorySeconds)
          || this.onset.length > 0;
        this.canceller.process(chunk, 0, reference, i, n, singing);
      }
      this.append(n);
      i += n;
      this.sinceHop += n;
      this.totalSamples += n;
      if (this.sinceHop === this.hopSize) {
        this.sinceHop = 0;
        if (this.filled === this.windowSize) frames.push(this.analyzeWindow(this.totalSamples / this.sampleRate));
      }
    }
    return frames;
  }

  append(n) {
    const h = this.history, W = this.windowSize;
    if (this.filled + n > W) {
      const drop = this.filled + n - W;
      h.copyWithin(0, drop, this.filled);
      this.filled -= drop;
    }
    h.set(this.chunk.subarray(0, n), this.filled);
    this.filled += n;
  }

  analyzeWindow(time) {
    const h = this.history, W = this.windowSize;
    let sum = 0;
    for (let k = 0; k < W; k++) sum += h[k] * h[k];
    const rms = Math.sqrt(sum / W);
    const rmsDB = 20 * Math.log10(Math.max(rms, 1e-9));
    const continuing = this.lastVoicedHz != null && time - this.lastVoicedTime <= VoicingGate.memorySeconds;
    const freeze = continuing ? this.lastVoicedHz : (this.onset.length ? this.onset[this.onset.length - 1] : null);
    const stats = this.suppressor.process(h, this.clean, freeze);
    const result = this.detector.detect(this.clean);
    const trackDip = continuing ? this.detector.dip(this.lastVoicedHz) : null;
    const [gate, chosen] = this.voicing(result, trackDip, continuing, rmsDB, stats.snrDB);
    if (gate === Gate.voiced && chosen) { this.lastVoicedHz = chosen.hz; this.lastVoicedTime = time; }
    const smoothed = this.smoother.process(gate === Gate.voiced && chosen ? chosen.hz : null);
    const shown = chosen ?? result;
    return {
      time, hz: smoothed, rawHz: shown ? shown.hz : null, confidence: shown ? shown.confidence : 0,
      rms, rmsDB, gate, snrDB: stats.snrDB, noiseDB: stats.noiseDBFS,
    };
  }

  voicing(result, trackDip, continuing, rmsDB, snrDB) {
    const canStart = VoicingGate.isLoudEnoughToStart(rmsDB, snrDB);
    const canHold = VoicingGate.isLoudEnoughToHold(rmsDB, snrDB);
    const clear = result ? result.confidence >= VoicingGate.minConfidence : false;
    const lf = this.leakFilter;

    if (continuing && trackDip && this.isDroneOnly(trackDip.hz)) this.droneOnlyFrames += 1;
    else this.droneOnlyFrames = 0;
    const droneOnly = this.droneOnlyFrames >= Math.trunc(VoicingGate.droneOnlySeconds * this.sampleRate / this.hopSize);
    if (continuing && canHold && !droneOnly && trackDip && trackDip.confidence >= VoicingGate.holdConfidence
      && !(lf ? lf.hasFadedIntoLeak(trackDip.hz, snrDB) : false)
      && !this.onlyDroneResidue(trackDip.hz, lf ? lf.holdOverDroneDB : null)) {
      this.onset = [];
      if (clear && canStart && result && !PitchAnalyzer.isOctaveBelow(result.hz, trackDip.hz)) return [Gate.voiced, result];
      return [Gate.voiced, trackDip];
    }

    if (!(clear && canStart && result && this.plausibleStart(result, snrDB))) {
      this.onset = [];
      return [rmsDB < VoicingGate.minRMSdB ? Gate.quiet : Gate.unclear, result];
    }
    const r = result;
    if (this.totalSamples / this.sampleRate < this.droneSettleUntil) { this.onset = []; return [Gate.leak, r]; }
    if (lf && (lf.isLeak(r.hz, snrDB) || this.isDroneOnly(r.hz) || this.onlyDroneResidue(r.hz, lf.startOverDroneDB))) {
      this.onset = [];
      return [Gate.leak, r];
    }
    this.onset.push(r.hz);
    if (this.onset.length > VoicingGate.onsetFrames) this.onset.shift();
    if (this.onset.length !== VoicingGate.onsetFrames) return [Gate.unclear, r];
    const ref = this.onset[this.onset.length >> 1];
    if (!this.onset.every((f) => Math.abs(1200 * Math.log2(f / ref)) <= VoicingGate.onsetToleranceCents)) return [Gate.unclear, r];
    this.onset = [];
    return [Gate.voiced, r];
  }

  isDroneOnly(hz) {
    const lf = this.leakFilter;
    if (!lf || !this.canceller.isActive || !lf.isDronePitch(hz)) return false;
    return this.canceller.isDroneOnly(hz);
  }

  onlyDroneResidue(hz, threshold) {
    const lf = this.leakFilter;
    if (threshold == null || !lf || !this.canceller.isActive || !lf.isDronePitch(hz)) return false;
    const over = this.canceller.voiceOverDroneDB(hz);
    if (over == null) return false;
    return over < threshold;
  }

  plausibleStart(r, snrDB) {
    const sa = this._saHz;
    if (!(sa != null && r.hz < 0.7 * sa)) return true;
    return r.confidence >= 0.82 && snrDB >= 6;
  }

  static isOctaveBelow(hz, reference) { return Math.abs(1200 * Math.log2(reference / hz) - 1200) <= 150; }

  /** Offline convenience: one frame per hop. */
  analyze(signal, reference = null) {
    return this.process(signal, reference && reference.length >= signal.length ? reference : null);
  }
}
