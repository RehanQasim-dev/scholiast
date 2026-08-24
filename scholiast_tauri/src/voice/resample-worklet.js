/* global sampleRate, AudioWorkletProcessor, registerProcessor */

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

function toInt16(value) {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  return Math.round(scaled);
}

class ResampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.position = 0;
    this.carry = new Float32Array(0);
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") this.flush();
    };
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    const src = new Float32Array(this.carry.length + input.length);
    src.set(this.carry, 0);
    src.set(input, this.carry.length);

    let position = this.position;
    while (position + 1 < src.length) {
      if (this.filled === CHUNK_SAMPLES) this.emit();
      const index = Math.floor(position);
      const frac = position - index;
      const value = src[index] * (1 - frac) + src[index + 1] * frac;
      this.buffer[this.filled++] = toInt16(value);
      position += this.step;
    }
    if (this.filled === CHUNK_SAMPLES) this.emit();

    this.carry = Float32Array.from([src[src.length - 1]]);
    this.position = position - (src.length - 1);
    return true;
  }

  flush() {
    if (this.filled > 0) this.emit();
  }

  emit() {
    const chunk = this.buffer.slice(0, this.filled);
    this.filled = 0;
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
  }
}

registerProcessor("resample-worklet", ResampleProcessor);
