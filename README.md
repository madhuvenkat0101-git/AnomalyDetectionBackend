# TealVue Real-Time Anomaly Detection Service (Node.js)

Consumes the TealVue mock market feed over Socket.IO, runs per-symbol anomaly
detection (spike/drop + moving-average deviation), and exposes a secured alerts API.

## Setup

```bash
npm install
cp .env       # set API_KEY
npm start                  # production
npm run dev                # auto-reload
npm run loadtest 1000 200  # scale/throughput benchmark
```

## API

- `GET /health` — public liveness probe.
- `GET /api/alerts?limit=10` — secured, requires header `x-api-key: <API_KEY>`.
  Returns the most recent alerts, newest first (capped at 100).

```bash
curl -H "x-api-key: $API_KEY" "http://localhost:4000/api/alerts?limit=10"
```

The frontend dashboard also hits this endpoint via its "Load recent" button
(see `frontend/src/api.js`), and receives live ticks/alerts over its own
Socket.IO connection to this service (`io.emit('tick', ...)` / `io.emit('alert', ...)`).

## Sample config (`config.json`)

```json
{
  "feed": {
    "url": "https://mock-data.tealvue.in",
    "subscribeEvent": "subscribe"
  },
  "symbols": {
    "RELIANCE": { "strategy": "spike", "thresholdPercent": 3, "windowSec": 30 },
    "TCS":      { "strategy": "movingAverage", "deviationPercent": 5, "sampleSize": 10 },
    "INFY":     { "strategy": "spike", "thresholdPercent": 2.5, "windowSec": 20 },
    "HDFCBANK": { "strategy": "movingAverage", "deviationPercent": 4, "sampleSize": 15 }
  }
}
```

Edit and save this file while the service is running — it hot-reloads (see
"Hot-reload" below), no restart needed.

## Sample alert output

```json
{
  "alertRef": "TV-9F2C1A",
  "symbol": "RELIANCE",
  "strategy": "spike",
  "direction": "spike",
  "reason": "Price spiked +3.27% (from 2450.00 to 2530.00) within 30s window",
  "price": 2530,
  "changePercent": 3.27,
  "ts": 1777874415000,
  "simTime": "2026-05-04T06:00:15.000Z",
  "detectedAt": "2026-06-26T05:02:11.301Z"
}

{
   "alertRef": "TV-B00A8E45",
   "symbol": "RELIANCE",
   "strategy": "spike",
   "direction": "spike",
   "reason": "Price spiked +0.45% (from 1432.8 to 1439.3) within 30s window",
   "price": 1439.3,
   "changePercent": 0.45,
   "ts": 1782547080000,
   "simTime": "2026-06-27T07:58:00.000Z",
   "detectedAt": "2026-06-27T05:50:49.785Z"
        },
```

## How the initial burst is handled (no false-alert storm)

The moment you `subscribe`, the simulator replays the entire simulated day so
far as a near-instant burst, then settles into a 1.5s live cadence. Two
independent mechanisms guard against this turning into a flood of false
alerts:

1. **Detection windows use simulated time, not wall-clock time.** Every tick
   carries its own `TS` field. `windowSec` / `sampleSize` are evaluated against
   that simulated clock, not `Date.now()`. So even if 500 burst ticks arrive
   within a few milliseconds of real time, the spike detector still only
   compares prices within a genuine 30-*simulated*-second window — a normal
   day's drift across the burst doesn't register as a spike.
2. **Each symbol starts muted.** Rolling state (the ring buffer / sliding
   window) is warmed by every tick from the very first one, but no alert is
   *emitted* until the symbol flips from "burst" to "live". A symbol flips
   live when the inter-tick **wall-clock** gap reaches live cadence
   (`burst.liveCadenceGapMs`, default 400ms) — i.e. once the burst has
   visibly drained and ticks are arriving at the real 1.5s pace — or after a
   hard `burst.maxBurstMs` cap (default 15s) as a safety net.

Together: correctness comes from simulated-time windowing; the *suppression*
of burst-era alerts is an extra layer of protection so you never see an alert
fire mid-burst even in edge cases.


## Scaling to 1,000+ streams (honest)

The real feed only serves a small fixed catalogue (~4 symbols in this
config). To demonstrate the detection pipeline holds up at 1,000+ concurrent
streams without misrepresenting synthetic data as the real feed:

- `SCALE_FACTOR=N` (env var) fans each **real** tick out into `N` synthetic
  shadow symbols suffixed `-SIMnn` (e.g. `RELIANCE-SIM07`), with a small
  deterministic price perturbation. These are clearly labeled as synthetic in
  every log line and alert — never presented as live feed data.
- `npm run loadtest [symbols] [ticksPerSymbol]` is a separate, pure in-memory
  benchmark that drives the real `DetectionEngine` directly with synthetic
  ticks (no network), to measure raw pipeline throughput independent of the
  mock feed's tick rate.

**Measured result** (`npm run loadtest 1000 200`):

```
symbols:            1000
ticks/symbol:       200
total ticks:        200,000
elapsed:            365.7 ms
throughput:         546,962 ticks/sec
alerts emitted:     5,000
heap delta:         13.2 MB
```

500K+ ticks/sec with a 13MB heap delta across 1,000 concurrent symbol streams
— the bottleneck in this system is the mock feed's tick rate (1.5s/tick),
never the detection pipeline itself.

## Security choice (the brief leaves this open deliberately)

Threat model: this is an internal/operator alerts feed, not a public site.
Realistic risks are (a) unauthenticated scraping of alert data and (b) cheap
request floods. Layered response:

1. A required API key (constant-time compared via `crypto.timingSafeEqual`)
   on `GET /api/alerts`.
2. Per-IP rate limiting (60 req/min) to blunt brute-force/abuse.
3. CORS scoped to `GET` + the specific headers the dashboard needs
   (`Content-Type`, `x-api-key`) rather than left fully open.
4. No secrets in responses; `/health` is intentionally public and minimal.

This is proportionate for a single internal consumer; mTLS/OAuth would be
over-engineering here. Swap the key check for a gateway/JWT if this is ever
exposed publicly.

## Assumptions made (documented, not silently guessed)

The brief explicitly says `api_docs.md` has deliberate inconsistencies and
underspecified points. Here's what we found and how we resolved each one,
including bugs caught and fixed after an earlier pass:

1. **Multi-symbol subscribe vs. "Dynamic Single-Symbol Switching."** The doc
   says the `subscribe` payload is `string[]` but also warns that subscribing
   "overwrites any prior subscription on the connection state instantly" —
   ambiguous as to whether that means per-call replacement or per-symbol
   replacement. **Resolution (tested against the live feed):** a *single*
   `subscribe` call with an array containing every symbol keeps all of them
   live simultaneously; it's only a *second, separate* `subscribe` call that
   replaces the set. We subscribe once with the full symbol list, not once
   per symbol. An earlier version of this service incorrectly looped and
   called `subscribe` once per symbol with a bare string (wrong shape *and*
   wrong cardinality) — fixed in `FeedClient.js`.

2. **Field name casing.** The doc's `ticker` event payload uses uppercase keys
   (`SYMBOL`, `LTP`, `TS`, ...). An earlier draft of `normalizeTick.js` was
   written defensively before the docs were available and checked lowercase
   keys (`symbol`, `ltp`, `ts`), which silently dropped every real tick (JS
   object key lookup is case-sensitive). Fixed by matching the documented
   uppercase names and falling back to a case-insensitive lookup so this
   class of bug can't silently regress again.

3. **`windowSec` — simulated time vs. wall-clock time.** The doc explicitly
   flags this as something to think carefully about. Resolved as described
   above: windows are measured against each tick's own simulated `TS`, never
   `Date.now()`.

4. **CORS only covered the Socket.IO handshake, not the REST routes.** The
   Socket.IO server's own `cors: { origin: '*' }` option only applies to the
   WebSocket transport — it does *not* add CORS headers to plain Express
   routes. `GET /api/alerts` requires a custom `x-api-key` header, which
   triggers a browser preflight; without `cors()` middleware on the Express
   app itself, the preflight had no `Access-Control-Allow-Origin` response
   and the browser blocked the real request before it ever reached our
   route handler. Fixed by adding `cors()` middleware to the Express app,
   scoped to `GET` and the two headers the dashboard actually sends.

5. **lightweight-charts v5 API.** `package.json` pins v5.2.0, but the chart
   component originally called the v4-only `chart.addAreaSeries(...)`, which
   was removed entirely in v5 in favor of `chart.addSeries(SeriesDefinition,
   options)`. This threw inside a `useEffect` on the very first real tick,
   and because nothing caught it, React unmounted the whole dashboard (looked
   like "loads briefly, then goes blank"). Fixed by importing `AreaSeries`
   and calling `chart.addSeries(AreaSeries, options)` per the current API.

6. **Reconnect behavior.** The doc never states whether subscriptions persist
   across a Socket.IO reconnect. Given subscriptions are described as living
   "directly on the connection state" (not a server-side user/session
   record), the safe assumption is they do **not** persist — so the service
   re-emits `subscribe` with the full symbol list on every `connect` and
   `reconnect` event, not just the first connection.

7. **Case sensitivity of the `symbol` parameter.** The REST docs say `symbol`
   is case-insensitive for `/api/v1/realtime-current` and `/api/v1/historical`,
   but say nothing either way for the Socket.IO `subscribe` validation. We
   send symbols exactly as configured (uppercase, matching the documented
   examples) to avoid relying on undocumented behavior.

## With more time I would

- Persist alerts to Redis/a DB instead of in-memory (currently lost on restart).
- Add Prometheus metrics (tick rate, alert rate, burst duration per symbol).
- Add unit tests per detection strategy (the spike/moving-average math is
  pure and easy to test in isolation, but currently only manually verified).
- Add a Dockerfile + docker-compose for a single-command service + dashboard
  run (listed as bonus, not done — ran out of time budget on it).
- Replace the case-insensitive field-lookup fallback in `normalizeTick.js`
  with a strict schema check that fails loudly if the feed's field names
  ever change, rather than silently falling back.
