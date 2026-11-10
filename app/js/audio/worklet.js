// Real-time audio thread (AudioWorklet) — the web counterpart of AudioEngineManager's drone source node
// and mic sink node. Renders the tanpura to the speakers and hands the mic samples, together with the
// drone exactly as played (sample-aligned), to the analysis worker. Nothing heavy happens here.
import { TanpuraRenderer } from '../dsp/tanpura.js';

const BLOCK = 512;

class SrutiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tanpura = new TanpuraRenderer();
    this.tanpura.prepare(sampleRate);
    this.analysis = null;
    this.mic = new Float32Array(BLOCK);
    this.ref = new Float32Array(BLOCK);
    this.fill = 0;
    this.sample = 0;
    this.drone = new Float32Array(128);
    this.replay = null;
    this.replayPos = 0;
    this.replayDone = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'params') Object.assign(this.tanpura.params, m.params);
      else if (m.type === 'analysisPort') this.analysis = m.port;
      else if (m.type === 'replay') { this.replay = m.samples; this.replayPos = 0; this.replayDone = false; }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    if (!ch0) return true;
    const n = ch0.length;
    if (this.drone.length !== n) this.drone = new Float32Array(n);
    this.tanpura.render(ch0, this.drone);

    const input = inputs[0] && inputs[0][0];
    const replay = this.replay;
    for (let i = 0; i < n; i++) {
      let v;
      if (replay) {
        v = this.replayPos < replay.length ? replay[this.replayPos++] : 0;
        ch0[i] += v;                   // the recording is played aloud, as on iOS
      } else {
        v = input ? input[i] : 0;
      }
      this.mic[this.fill] = v;
      this.ref[this.fill] = this.drone[i];
      if (++this.fill === BLOCK) this.flush();
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    if (replay && !this.replayDone && this.replayPos >= replay.length) {
      this.replayDone = true;
      this.port.postMessage({ type: 'replayFinished' });
    }
    return true;
  }

  flush() {
    if (this.analysis) {
      const mic = this.mic.slice(0, this.fill), ref = this.ref.slice(0, this.fill);
      this.analysis.postMessage({ mic, ref, start: this.sample }, [mic.buffer, ref.buffer]);
    }
    this.sample += this.fill;
    this.fill = 0;
  }
}

registerProcessor('sruti-processor', SrutiProcessor);
