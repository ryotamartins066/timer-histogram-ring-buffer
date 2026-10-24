# timer-histogram-ring-buffer

A bounded ring buffer for latency samples with exact interpolated percentiles.

```js
import { LatencyRingBuffer } from 'timer-histogram-ring-buffer';

const buf = new LatencyRingBuffer(1024);
buf.push(12);  // record a latency, in whatever unit you chose
buf.push(45);
buf.push(7);

buf.percentile(95);  // -> 45 (interpolated against current live window)
buf.stats();        // -> { min: 7, max: 45, mean: 21.333..., count: 3, capacity: 1024 }
```

## Why this exists

Services that record per-request latency need rolling aggregates without unbounded memory growth. A fixed-capacity ring buffer gives you a sliding window of the most recent samples, and a running sum lets `stats()` report mean in O(1). `percentile()` sorts a copy of the live slice and interpolates; for a capacity in the low thousands queried a few times per second, that is cheaper and simpler than maintaining a sorted structure through every overwrite.

The name says "histogram" but the implementation stores full-fidelity samples and returns **exact** interpolated percentiles from the current window. A histogram with fixed-width buckets would be approximate and is a different contract; mixing the two is the kind of compromise that breaks its own tests, so this library picks one reading.

## Edge you will hit

`percentile()` on an empty buffer returns `null`, not `0`, because `0` is a plausible latency and would be a silent lie. Callers that need a numeric default must check explicitly.

`push()` rejects `NaN`, `Infinity`, and negative numbers. A latency of `Infinity` is never useful and silently corrupts `mean()` and every percentile downstream, so it fails fast instead.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

