// Pitch analysis off the main thread — the web counterpart of AudioEngineManager's analysis queue.
// Receives mic + played-drone blocks straight from the AudioWorklet, runs the PitchAnalyzer, and sends
// frames to the page in batches at ≤ 60 Hz. Also keeps the last 32 s of mic audio (for "Download the last
// 30 seconds") and records sessions when asked.
import { PitchAnalyzer, DroneLeakFilter } from '../dsp/pitch.js';
import { RingBuffer, encodeWav, concat } from './wav.js';

const WINDOW = 2048, HOP = 512;
let sampleRate = 48000;
let analyzer = null;
let ring = new RingBuffer(48000 * 32);
let refRing = new RingBuffer(48000 * 4);
let lag = 0;
let replaying = false;
let context = { saHz: null, droneStrings: [], leakPitches: [], echoCancel: true };
let pending = [];
let lastPublish = -Infinity;
let recording = null;
let refChunk = new Float32Array(512);
let port = null;

function applyContext() {
  if (!analyzer) return;
  analyzer.saHz = context.saHz;
  const cancel = context.echoCancel && !replaying;
  analyzer.droneStrings = cancel ? context.droneStrings : [];
  analyzer.leakFilter = context.echoCancel && context.leakPitches.length ? new DroneLeakFilter(context.leakPitches) : null;
}

function onBlock({ mic, ref, out, start }) {
  if (!analyzer) return;
  ring.write(mic);
  refRing.write(ref);
  const n = mic.length, end = start + n;
  if (recording) {
    recording.mic.push(mic);
    if (recording.withRef) {
      const r = new Float32Array(n);
      if (!refRing.copy(n, end - lag, r)) r.fill(0);
      recording.ref.push(r);
    }
  }
  // The drone that reached the mic in this block was played `lag` samples earlier.
  let reference = null;
  if (!replaying && context.echoCancel && context.droneStrings.length && end - lag > n) {
    if (refChunk.length !== n) refChunk = new Float32Array(n);
    if (refRing.copy(n, end - lag, refChunk)) reference = refChunk;
  }
  // Everything played at these very samples, for OwnSoundDetector (which allows for any delay itself).
  const played = !replaying && context.echoCancel ? out : null;
  const frames = analyzer.process(mic, reference, played);
  for (const f of frames) pending.push(f);
  const now = end / sampleRate;
  if (pending.length && now - lastPublish >= 1 / 60) {
    lastPublish = now;
    self.postMessage({ type: 'frames', frames: pending });
    pending = [];
  }
}

function stamp() {
  const d = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      sampleRate = m.sampleRate;
      lag = m.lag;
      replaying = !!m.replay;
      ring = new RingBuffer(Math.round(sampleRate * 32));
      refRing = new RingBuffer(Math.round(sampleRate * 4));
      analyzer = new PitchAnalyzer(sampleRate, WINDOW, HOP);
      applyContext();
      pending = [];
      lastPublish = -Infinity;
      recording = m.record ? { name: `Session ${stamp()}`, mic: [], ref: [], withRef: !replaying } : null;
      port = m.port;
      port.onmessage = (ev) => onBlock(ev.data);
      break;
    case 'context':
      context = m.context;
      applyContext();
      break;
    case 'stop': {
      if (port) port.onmessage = null;
      port = null;
      analyzer = null;
      if (recording && recording.mic.length) {
        const mic = encodeWav(concat(recording.mic), sampleRate);
        const ref = recording.withRef && context.droneStrings.length ? encodeWav(concat(recording.ref), sampleRate) : null;
        self.postMessage({ type: 'recording', name: recording.name, lag, mic, ref }, [mic, ...(ref ? [ref] : [])]);
      }
      recording = null;
      break;
    }
    case 'exportRecent': {
      const written = ring.written;
      const count = Math.min(Math.round(m.seconds * sampleRate), written, ring.capacity);
      let wav = null;
      if (count > sampleRate) {
        const samples = new Float32Array(count);
        if (ring.copy(count, written, samples)) wav = encodeWav(samples, sampleRate);
      }
      self.postMessage({ type: 'exportRecent', id: m.id, wav, name: `Sruti Trainer last ${m.seconds}s ${stamp()}` }, wav ? [wav] : []);
      break;
    }
  }
};
