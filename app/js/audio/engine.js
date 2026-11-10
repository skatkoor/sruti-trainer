// Main-thread side of the audio — the web counterpart of AudioEngineManager.swift.
// AudioContext + AudioWorklet (tanpura out, mic in) → MessageChannel → analysis Worker → frames back here.
//
// Like the iOS app's `.measurement` mode, the browser's own echo cancellation, noise suppression and
// automatic gain are turned off: they are built for calls and distort (or erase) held sung notes. When the
// tanpura plays from a loudspeaker, our own DroneCanceller removes it using the exact samples played.
import { defaultParams, droneFrequencies } from '../dsp/tanpura.js';
import { DroneCanceller } from '../dsp/pitch.js';

export const HOP = 512;

export class AudioEngine {
  constructor() {
    this.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.params = defaultParams();
    this.ctx = null;
    this.node = null;
    this.stream = null;
    this.sampleRate = 48000;
    this.running = false;
    this.replaying = false;
    this.exports = new Map();
    this.nextExport = 1;
    this.onFrames = null;
    this.onReplayFinished = null;
    this.onRecording = null;
    this.onEnded = null;
  }

  onWorker(m) {
    if (m.type === 'frames') this.onFrames?.(m.frames);
    else if (m.type === 'recording') this.onRecording?.(m);
    else if (m.type === 'exportRecent') {
      const resolve = this.exports.get(m.id);
      this.exports.delete(m.id);
      resolve?.(m.wav ? { blob: new Blob([m.wav], { type: 'audio/wav' }), name: `${m.name}.wav` } : null);
    }
  }

  static async micPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state; // 'granted' | 'denied' | 'prompt'
    } catch { return 'prompt'; }
  }

  /** The mic with all call processing off — preferring the computer's own mic, like the iOS app: a
   *  Bluetooth headset mic (AirPods) drops to call quality and takes the tanpura's sound down with it. */
  static async openMic() {
    const constraints = (deviceId) => ({
      audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    let stream = await navigator.mediaDevices.getUserMedia(constraints());
    const label = stream.getAudioTracks()[0]?.label ?? '';
    if (/airpods|bluetooth|headset|hands-free|buds|beats|hfp/i.test(label)) {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const builtIn = inputs.find((d) => /macbook|built-in|internal|imac/i.test(d.label) && d.deviceId !== 'default');
      if (builtIn) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia(constraints(builtIn.deviceId));
      }
    }
    return stream;
  }

  makeContext() {
    try { return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }); }
    catch { return new AudioContext({ latencyHint: 'interactive' }); }
  }

  /** Starts listening (call from a click: the AudioContext is created before any await). */
  async start({ record = false, replaySamples = null, replayContext = null } = {}) {
    if (this.running) this.stop();
    const ctx = replayContext ?? this.makeContext();
    this.ctx = ctx;
    try {
      if (!replaySamples) this.stream = await AudioEngine.openMic();
      await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
      await ctx.resume();
    } catch (err) {
      this.cleanup();
      throw err;
    }
    this.sampleRate = ctx.sampleRate;
    const node = new AudioWorkletNode(ctx, 'sruti-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit',
    });
    node.port.onmessage = (e) => { if (e.data.type === 'replayFinished') this.onReplayFinished?.(); };
    this.node = node;
    if (this.stream) {
      const src = ctx.createMediaStreamSource(this.stream);
      src.connect(node);
      this.source = src;
      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
    }
    node.connect(ctx.destination);

    // Mic → drone delay: the drone rendered now reaches the mic after the output and input latency.
    const track = this.stream?.getAudioTracks()[0];
    const inputLatency = track?.getSettings?.().latency ?? 0.01;
    const lagSeconds = Math.max(0, (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + inputLatency - DroneCanceller.envelopeDelay);
    this.lagSamples = Math.round(lagSeconds * ctx.sampleRate);

    const channel = new MessageChannel();
    node.port.postMessage({ type: 'analysisPort', port: channel.port1 }, [channel.port1]);
    this.worker.postMessage({
      type: 'start', sampleRate: ctx.sampleRate, lag: this.lagSamples, replay: !!replaySamples, record, port: channel.port2,
    }, [channel.port2]);
    this.replaying = !!replaySamples;
    const params = { ...this.params };
    if (replaySamples) { params.droneOn = false; params.guideOn = false; }
    node.port.postMessage({ type: 'params', params });
    if (replaySamples) node.port.postMessage({ type: 'replay', samples: replaySamples }, [replaySamples.buffer]);
    this.running = true;
  }

  stop() {
    if (!this.running && !this.ctx) return;
    this.running = false;
    this.worker.postMessage({ type: 'stop' });
    this.cleanup();
  }

  cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.node?.disconnect(); this.source?.disconnect(); } catch { /* already gone */ }
    this.node = null;
    this.source = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.replaying = false;
  }

  /** Tanpura / guide / click parameters (see TanpuraRenderer.Params). */
  setParams(partial) {
    Object.assign(this.params, partial);
    if (!this.node) return;
    const params = { ...this.params };
    if (this.replaying) { params.droneOn = false; params.guideOn = false; }
    this.node.port.postMessage({ type: 'params', params });
  }

  /** What the analyzer needs: Sa, drone strings (cancelled from the mic), drone + guide pitches (leak filter). */
  setAnalysisContext(context) { this.worker.postMessage({ type: 'context', context }); }

  exportRecent(seconds = 30) {
    return new Promise((resolve) => {
      const id = this.nextExport++;
      this.exports.set(id, resolve);
      this.worker.postMessage({ type: 'exportRecent', seconds, id });
    });
  }

  static droneFrequencies = droneFrequencies;
}
