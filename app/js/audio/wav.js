// WAV encode (32-bit float mono, like the iOS app's recordings) and a sample ring buffer (RingBuffer.swift).

export function encodeWav(samples, sampleRate) {
  const bytes = samples.length * 4;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  new Float32Array(buf, 44, samples.length).set(samples);
  return buf;
}

/** Concatenates Float32Array chunks. */
export function concat(chunks) {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export class RingBuffer {
  constructor(capacity) { this.capacity = capacity; this.storage = new Float32Array(capacity); this.reset(); }
  reset() { this.writeIndex = 0; this.written = 0; this.storage.fill(0); }
  write(samples) {
    let src = samples;
    if (src.length > this.capacity) src = src.subarray(src.length - this.capacity);
    let remaining = src.length, o = 0;
    while (remaining > 0) {
      const chunk = Math.min(remaining, this.capacity - this.writeIndex);
      this.storage.set(src.subarray(o, o + chunk), this.writeIndex);
      this.writeIndex = (this.writeIndex + chunk) % this.capacity;
      o += chunk; remaining -= chunk;
    }
    this.written += samples.length;
  }
  /** `count` samples ending at absolute position `end` (exclusive) into `out`; false if not in the buffer. */
  copy(count, end, out) {
    if (count > this.capacity || end > this.written || end - count < Math.max(0, this.written - this.capacity) || end - count < 0) return false;
    let start = (this.writeIndex - (this.written - (end - count))) % this.capacity;
    if (start < 0) start += this.capacity;
    const first = Math.min(count, this.capacity - start);
    out.set(this.storage.subarray(start, start + first), 0);
    if (first < count) out.set(this.storage.subarray(0, count - first), first);
    return true;
  }
}
