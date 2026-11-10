// The pitch roll graph — a Canvas port of SrutiTrainer/UI/PitchRollView.swift. Redrawn every animation
// frame while listening; reads AppState directly. Keep in step with Swift.
import { GraphViewport, PitchHistory, Sruti, intonationCents, Swara, zoneOf, noteCents } from '../music.js';
import { COLORS, zoneColor, alpha } from './palette.js';

const LEFT = 44, RIGHT = 8, MAX_JOIN_CENTS = 150, MAX_BRIDGE_SECONDS = 0.15;
const FONT = '"SF Pro Rounded", ui-rounded, system-ui, -apple-system, sans-serif';

export class PitchGraph {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;
    this.viewport = new GraphViewport();
    this.ctx = canvas.getContext('2d');
    this.running = false;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** Keep redrawing at display rate while listening; otherwise draw on demand. */
  sync() {
    if (this.state.isListening && !this.running) {
      this.running = true;
      const loop = () => {
        if (!this.state.isListening) { this.running = false; this.draw(); return; }
        this.draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } else if (!this.running) {
      this.draw();
    }
  }

  draw() {
    const canvas = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const st = this.state, s = st.settings;
    const preview = st.exercise && !st.session && !st.isListening ? st.exercisePreview : [];
    const exerciseCents = st.exercise ? st.exerciseSteps.map((x) => noteCents(x.note, s.intonation)) : [];
    const previewSpan = Math.min(Math.max((preview.length ? preview[preview.length - 1].end : 0) + 0.6, 4), 30);
    // Laptop screens are wide: show more seconds so the line moves at the same speed as on the phone.
    const pastSeconds = preview.length ? previewSpan * 0.04 / 0.96 : Math.min(8 * Math.max(w / 520, 1), 16);
    const nowFraction = preview.length ? 0.04 : (exerciseCents.length ? 0.55 : 0.8);
    const config = {
      sruti: s.sruti, intonation: s.intonation, raga: st.raga, tolerance: s.tolerance, range: st.graphRange,
      targetCents: st.targetCents, live: st.isListening, autoZoom: s.graphRange === 'auto', pastSeconds, nowFraction,
      exerciseCents, preview,
    };

    const plot = { x: LEFT, y: 10, w: w - LEFT - RIGHT, h: h - 20 };
    if (plot.w <= 0 || plot.h <= 0) return;
    const history = st.history, session = st.session;
    const date = performance.now() / 1000;
    const now = history.now(date, config.live);
    const nowX = plot.x + plot.w * config.nowFraction;
    const secondsPerPoint = config.pastSeconds / (plot.w * config.nowFraction);
    const futureEnd = now + (plot.x + plot.w - nowX) * secondsPerPoint;
    let upcoming = null;
    if (config.preview.length) upcoming = config.preview.map((p) => ({ ...p, start: now + 0.15 + p.start, end: now + 0.15 + p.end }));
    else if (session) upcoming = session.upcoming(now, futureEnd - now + 0.5);

    let lower, upper;
    if (config.autoZoom) {
      const leftEdge = now - config.pastSeconds;
      const targets = new Set();
      for (const p of history.points) if (p.time >= leftEdge && p.targetCents != null) targets.add(p.targetCents);
      if (upcoming) {
        for (const u of upcoming) if (u.start < futureEnd) targets.add(u.cents);
        if (upcoming.length > 1) targets.add(upcoming[1].cents);
        for (const c of config.exerciseCents) targets.add(c);
      } else {
        targets.add(config.targetCents);
      }
      const recent = history.sustainedVoiceHz(now - GraphViewport.recentVoiceSeconds, GraphViewport.sustainedSeconds)
        .map((hz) => Sruti.centsOfHz(config.sruti, hz));
      const desired = GraphViewport.desiredRange([...targets], recent);
      [lower, upper] = this.viewport.update(desired, date, config.live);
    } else {
      [lower, upper] = config.range;
    }

    const x = (t) => nowX - (now - t) / secondsPerPoint;
    const y = (c) => plot.y + plot.h * (upper - c) / (upper - lower);

    this.drawSwaraLines(g, plot, config, lower, upper, y);

    g.save();
    g.beginPath();
    g.rect(plot.x, plot.y, plot.w, plot.h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(nowX, plot.y); g.lineTo(nowX, plot.y + plot.h); g.stroke();
    g.setLineDash([]);
    this.drawTarget(g, plot, history, config, futureEnd, upcoming, x, y);
    this.drawTrace(g, history, config, now, x, y);
    g.restore();
  }

  drawSwaraLines(g, plot, config, lower, upper, y) {
    const labels = [];
    for (let octave = -3; octave <= 3; octave++) {
      for (const swara of config.raga.swaras) {
        const cents = intonationCents(config.intonation, Swara.position(swara)) + 1200 * octave;
        if (cents < lower || cents > upper) continue;
        const yy = y(cents), isSa = swara === 's';
        g.strokeStyle = `rgba(255,255,255,${isSa ? 0.32 : 0.13})`;
        g.lineWidth = isSa ? 1.5 : 1;
        g.beginPath(); g.moveTo(plot.x, yy); g.lineTo(plot.x + plot.w, yy); g.stroke();
        labels.push({ y: yy, text: Swara.notationLabel(swara, octave), isSa });
      }
    }
    labels.sort((a, b) => (a.isSa === b.isSa ? 0 : a.isSa ? -1 : 1));
    const drawn = [];
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const l of labels) {
      if (!drawn.every((d) => Math.abs(d - l.y) >= 15)) continue;
      g.font = `${l.isSa ? 700 : 600} 13px ${FONT}`;
      g.fillStyle = `rgba(255,255,255,${l.isSa ? 0.95 : 0.65})`;
      g.fillText(l.text, plot.x - 6, l.y);
      drawn.push(l.y);
    }
  }

  drawNoteTag(g, label, arrow, px, py, trailing) {
    g.font = `700 13px ${FONT}`;
    const text = arrow ? `${label} →` : label;
    const tw = g.measureText(text).width;
    const width = tw + 10, height = 18;
    const ox = trailing ? px - width : px, oy = py - height / 2;
    g.beginPath();
    g.roundRect(ox, oy, width, height, height / 2);
    g.fillStyle = 'rgb(18,28,20)';
    g.fill();
    g.strokeStyle = alpha(COLORS.target, 0.6);
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = COLORS.target;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, ox + width / 2, py + 0.5);
  }

  drawTarget(g, plot, history, config, futureEnd, upcoming, x, y) {
    const segments = [];
    for (const p of history.points) {
      if (p.targetCents == null) continue;
      const last = segments[segments.length - 1];
      if (last && last.cents === p.targetCents) last.end = p.time;
      else {
        if (last) last.end = p.time;
        segments.push({ start: p.time, end: p.time, cents: p.targetCents });
      }
    }
    if (upcoming) for (const u of upcoming) segments.push({ start: u.start, end: u.end, cents: u.cents });
    else segments.push({ start: segments.length ? segments[segments.length - 1].end : -Infinity, end: futureEnd, cents: config.targetCents });

    const tol = config.tolerance;
    for (const seg of segments) {
      const x0 = Math.max(x(seg.start), plot.x), x1 = Math.min(x(seg.end), plot.x + plot.w);
      if (!(x1 > x0)) continue;
      const band = (c) => [x0, y(seg.cents + c), x1 - x0, y(seg.cents - c) - y(seg.cents + c)];
      g.fillStyle = alpha(COLORS.near, 0.07); g.fillRect(...band(tol.yellow));
      g.fillStyle = alpha(COLORS.target, 0.18); g.fillRect(...band(tol.green));
      const yy = y(seg.cents);
      g.strokeStyle = alpha(COLORS.target, 0.9);
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
    }

    if (upcoming) {
      const right = plot.x + plot.w;
      for (let i = 0; i < upcoming.length; i++) {
        const seg = upcoming[i];
        const startX = x(seg.start) + 2;
        if (!(startX > x(history.lastTime) + 1)) continue;
        const yy = y(seg.cents);
        if (startX < right - 40) this.drawNoteTag(g, seg.label, false, startX, yy, false);
        else if (i === 1 || startX < right) {
          this.drawNoteTag(g, seg.label, true, right - 2, yy, true);
          if (i >= 1) break;
        }
      }
    }
  }

  drawTrace(g, history, config, now, x, y) {
    const paths = { green: [], yellow: [], red: [] };
    let previous = null, previousTime = -Infinity, previousCents = 0, head = null;
    const leftEdge = now - config.pastSeconds - 0.5;
    for (const [a, b] of history.voicedRuns(leftEdge)) {
      for (let i = a; i < b; i++) {
        const point = history.points[i];
        if (point.hz == null) continue;
        const cents = Sruti.centsOfHz(config.sruti, point.hz);
        const zone = zoneOf(cents - (point.targetCents ?? config.targetCents), config.tolerance);
        const p = [x(point.time), y(cents)];
        if (previous && point.time - previousTime <= MAX_BRIDGE_SECONDS && Math.abs(cents - previousCents) <= MAX_JOIN_CENTS) {
          paths[zone].push(previous, p);
        }
        previous = p;
        previousTime = point.time;
        previousCents = cents;
        head = { p, zone, time: point.time };
      }
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const zone of ['green', 'yellow', 'red']) {
      const segs = paths[zone];
      if (!segs.length) continue;
      g.beginPath();
      for (let i = 0; i < segs.length; i += 2) { g.moveTo(segs[i][0], segs[i][1]); g.lineTo(segs[i + 1][0], segs[i + 1][1]); }
      g.strokeStyle = alpha(zoneColor(zone), 0.22); g.lineWidth = 11; g.stroke();
      g.strokeStyle = zoneColor(zone); g.lineWidth = 4; g.stroke();
    }
    if (head && now - head.time < 0.2) {
      g.beginPath();
      g.arc(head.p[0], head.p[1], 7, 0, 2 * Math.PI);
      g.fillStyle = zoneColor(head.zone);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2;
      g.stroke();
    }
  }
}

export { PitchHistory };
