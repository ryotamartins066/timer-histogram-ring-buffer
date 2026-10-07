/**
 * Latency ring buffer that stores fixed-size samples and computes percentiles.
 *
 * Design choices, and why:
 *
 * - Samples are pushed at full fidelity. We do NOT bucket into a histogram here,
 *   despite the project name "Timer Histogram Ring Buffer". The contract below
 *   says percentile() returns an exact interpolated value from the live samples,
 *   and that is what we implement. Bucketing would be a different library with a
 *   different (approximate) contract; mixing the two is how comparator-style libs
 *   end up with conflicting rules. We pick one reading and commit to it.
 *
 * - Insertion is O(1) amortized. percentile() sorts a copy of the live slice,
 *   so it is O(k log k) where k = current count. For the intended use case
 *   (capacity in the low thousands, queried a few times per second) this is
 *   cheaper and simpler than maintaining a sorted structure with rotations,
 *   and it avoids per-insert allocation churn on the hot path.
 *
 * - No clock dependency. This module only stores numbers; it never reads the
 *   wall clock. Whoever calls push() decides what "latency" means.
 */

/**
 * @typedef {Object} RingStats
 * @property {number} min      Smallest sample currently in the buffer.
 * @property {number} max      Largest sample currently in the buffer.
 * @property {number} mean     Arithmetic mean of live samples.
 * @property {number} count    Number of live samples (<= capacity).
 * @property {number} capacity Configured capacity.
 */

export class LatencyRingBuffer {
  /**
   * @param {number} capacity Maximum number of live samples retained.
   *   Must be a positive integer.
   */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this._buf = new Array(capacity);
    this._head = 0;      // next write index
    this._count = 0;     // live samples (saturates at capacity)
    this._sum = 0;       // running sum of live samples; kept to keep mean O(1)
  }

  /**
   * Append a latency sample. When the buffer is full the oldest sample is
   * overwritten, so memory use stays bounded for the lifetime of the instance.
   *
   * @param {number} value Non-negative finite number. We reject NaN/Infinity
   *   because they silently corrupt sum/mean and any downstream percentile,
   *   and a latency of "Infinity" is never a useful signal.
   */
  push(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`sample must be a non-negative finite number, got ${value}`);
    }
    const idx = this._head;
    if (this._count === this.capacity) {
      // Overwrite the oldest entry; subtract it from the running sum first.
      this._sum -= this._buf[idx];
    } else {
      this._count += 1;
    }
    this._buf[idx] = value;
    this._sum += value;
    this._head = (idx + 1) % this.capacity;
  }

  /**
   * Live samples in insertion order, oldest first. Returns a fresh array so
   * callers cannot mutate internal state.
   *
   * @returns {number[]}
   */
  toArray() {
    if (this._count === 0) return [];
    const out = new Array(this._count);
    const start = (this._head - this._count + this.capacity) % this.capacity;
    for (let i = 0; i < this._count; i++) {
      out[i] = this._buf[(start + i) % this.capacity];
    }
    return out;
  }

  /**
   * Approximate percentile using linear interpolation against the nearest-ranks
   * method. Returns null if the buffer is empty.
   *
   * @param {number} p Percentile in [0, 100].
   * @returns {number|null}
   */
  percentile(p) {
    if (this._count === 0) return null;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
      throw new RangeError(`p must be a number in [0, 100], got ${p}`);
    }
    const sorted = this.toArray().sort((a, b) => a - b);
    if (this._count === 1) return sorted[0];
    // Nearest-ranks with linear interpolation. rank ranges over [0, n-1].
    const rank = (p / 100) * (this._count - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    const frac = rank - lo;
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
  }

  /**
   * @returns {RingStats}
   */
  stats() {
    if (this._count === 0) {
      return { min: 0, max: 0, mean: 0, count: 0, capacity: this.capacity };
    }
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this._count; i++) {
      const v = this._buf[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      min,
      max,
      mean: this._sum / this._count,
      count: this._count,
      capacity: this.capacity,
    };
  }

  /** Number of samples currently retained. */
  get count() {
    return this._count;
  }

  /** Remove all samples and reset counters. Capacity is unchanged. */
  clear() {
    this._buf.fill(undefined);
    this._head = 0;
    this._count = 0;
    this._sum = 0;
  }
}
