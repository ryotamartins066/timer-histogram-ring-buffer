import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatencyRingBuffer } from '../src/index.js';

test('constructor rejects non-positive capacity', () => {
  assert.throws(() => new LatencyRingBuffer(0), RangeError);
  assert.throws(() => new LatencyRingBuffer(-1), RangeError);
  assert.throws(() => new LatencyRingBuffer(2.5), RangeError);
});

test('push and toArray round-trip', () => {
  const r = new LatencyRingBuffer(3);
  r.push(1);
  r.push(2);
  assert.deepEqual(r.toArray(), [1, 2]);
});

test('toArray is empty before any push', () => {
  assert.deepEqual(new LatencyRingBuffer(4).toArray(), []);
});

test('overwrites oldest sample when full and keeps order', () => {
  const r = new LatencyRingBuffer(3);
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4); // evicts 1
  r.push(5); // evicts 2
  assert.deepEqual(r.toArray(), [3, 4, 5]);
});

test('count saturates at capacity', () => {
  const r = new LatencyRingBuffer(2);
  r.push(1);
  assert.equal(r.count, 1);
  r.push(2);
  assert.equal(r.count, 2);
  r.push(3);
  assert.equal(r.count, 2);
});

test('stats reflects live window after overflow', () => {
  const r = new LatencyRingBuffer(2);
  r.push(10);
  r.push(20);
  r.push(30); // evicts 10
  const s = r.stats();
  assert.equal(s.count, 2);
  assert.equal(s.min, 20);
  assert.equal(s.max, 30);
  assert.equal(s.mean, 25);
  assert.equal(s.capacity, 2);
});

test('stats on empty buffer', () => {
  const s = new LatencyRingBuffer(4).stats();
  assert.deepEqual(s, { min: 0, max: 0, mean: 0, count: 0, capacity: 4 });
});

test('percentile returns null when empty', () => {
  assert.equal(new LatencyRingBuffer(2).percentile(50), null);
});

test('percentile validates input range', () => {
  const r = new LatencyRingBuffer(2);
  r.push(1);
  assert.throws(() => r.percentile(-1), RangeError);
  assert.throws(() => r.percentile(100.1), RangeError);
  assert.throws(() => r.percentile(NaN), RangeError);
});

test('percentile with one sample returns that sample', () => {
  const r = new LatencyRingBuffer(4);
  r.push(42);
  assert.equal(r.percentile(0), 42);
  assert.equal(r.percentile(50), 42);
  assert.equal(r.percentile(100), 42);
});

test('percentile endpoints and median on known data', () => {
  const r = new LatencyRingBuffer(8);
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) r.push(v);
  assert.equal(r.percentile(0), 1);
  assert.equal(r.percentile(100), 8);
  assert.equal(r.percentile(50), 4.5); // even count interpolates
});

test('percentile interpolates correctly for odd-count p25', () => {
  const r = new LatencyRingBuffer(5);
  for (const v of [1, 2, 3, 4, 5]) r.push(v);
  assert.equal(r.percentile(25), 2);
  assert.equal(r.percentile(75), 4);
});

test('percentile reads only the live window after overflow', () => {
  const r = new LatencyRingBuffer(3);
  r.push(100);
  r.push(200);
  r.push(300);
  r.push(400); // evicts 100; live window is 200,300,400
  assert.equal(r.percentile(50), 300);
  assert.equal(r.percentile(0), 200);
  assert.equal(r.percentile(100), 400);
});

test('push rejects non-finite or negative values', () => {
  const r = new LatencyRingBuffer(2);
  assert.throws(() => r.push(NaN), RangeError);
  assert.throws(() => r.push(Infinity), RangeError);
  assert.throws(() => r.push(-1), RangeError);
  assert.throws(() => r.push('5'), RangeError);
});

test('clear empties the buffer but keeps capacity', () => {
  const r = new LatencyRingBuffer(3);
  r.push(1);
  r.push(2);
  r.clear();
  assert.equal(r.count, 0);
  assert.deepEqual(r.toArray(), []);
  assert.equal(r.percentile(50), null);
  assert.equal(r.capacity, 3);
  r.push(7); // must be usable again
  assert.deepEqual(r.toArray(), [7]);
});

test('toArray returns a copy that does not alias internal state', () => {
  const r = new LatencyRingBuffer(3);
  r.push(1);
  r.push(2);
  const a = r.toArray();
  a.push(999);
  assert.deepEqual(r.toArray(), [1, 2]);
});
