# 🏎️ useRaceLoop.js - Deep Dive

This hook is the **Animation Engine** of the F1 Replay. It runs 60 times per second and smoothly moves the car.

---

## 📦 What It Receives (Inputs)

```javascript
useRaceLoop(telemetry, playbackSpeed)
```

| Input | Type | Example | Purpose |
|-------|------|---------|---------|
| `telemetry` | Array | `[{time: 0.2, x: 100, y: 50, speed: 280...}, ...]` | Raw data points |
| `playbackSpeed` | Number | `1`, `2`, `10` | How fast to play |

---

## 📤 What It Returns (Outputs)

```javascript
const { driverPos, driverStats, isPlaying, setIsPlaying } = useRaceLoop(...);
```

| Output | Type | Example | Purpose |
|--------|------|---------|---------|
| `driverPos` | Object | `{x: 150, y: -75}` | Current car position |
| `driverStats` | Object | `{speed: 295, gear: 7, drs: 0...}` | Current telemetry |
| `isPlaying` | Boolean | `true` / `false` | Is animation running? |
| `setIsPlaying` | Function | `setIsPlaying(true)` | Start/stop control |

---

## 🧠 Core Concepts

### 1. State vs Refs

**State** (`useState`) triggers UI re-renders. Use for things we SHOW.
**Refs** (`useRef`) don't trigger re-renders. Use for internal tracking.

```javascript
// STATE: User sees this
const [driverPos, setDriverPos] = useState(null);

// REF: Internal clock, user doesn't see
const virtualTimeRef = useRef(0);
```

**Rule:** If you call `setState` 60 times/second, React re-renders 60 times. That's correct here because we WANT the dot to move smoothly.

---

### 2. The Virtual Clock

```javascript
virtualTimeRef.current += deltaTime * speedRef.current;
```

| Variable | Meaning |
|----------|---------|
| `deltaTime` | Real seconds since last frame (e.g., `0.016s` at 60FPS) |
| `speedRef.current` | Playback multiplier (e.g., `2x`) |
| `virtualTimeRef.current` | "Race time" (e.g., "We are at 1:25 into the lap") |

**Example:**
- Frame 1: `virtualTime = 0 + 0.016 * 2 = 0.032`
- Frame 2: `virtualTime = 0.032 + 0.016 * 2 = 0.064`
- ...and so on

---

### 3. Finding the Right Data Points

Telemetry data looks like this:
```javascript
[
  { time: 0.1, x: 100, y: 50, speed: 50 },   // Point 0
  { time: 0.5, x: 200, y: 60, speed: 150 },  // Point 1
  { time: 1.0, x: 350, y: 80, speed: 280 },  // Point 2
  ...
]
```

If `virtualTime = 0.7`, we need to find:
- `p1` = Point 1 (time: 0.5) - The PAST point
- `p2` = Point 2 (time: 1.0) - The FUTURE point

```javascript
const idx = telemetry.findIndex(p => p.time > elapsed);
// idx = 2 (first point whose time > 0.7)
// p1 = telemetry[idx - 1] = Point 1
// p2 = telemetry[idx] = Point 2
```

---

### 4. LERP (Linear Interpolation)

**Problem:** We know the car was at Point 1 at `t=0.5s` and Point 2 at `t=1.0s`. Where is it at `t=0.7s`?

**Solution:** Calculate the percentage and blend.

```javascript
const timeWindow = p2.time - p1.time;     // 1.0 - 0.5 = 0.5s gap
const timeSinceP1 = elapsed - p1.time;   // 0.7 - 0.5 = 0.2s passed
const t = timeSinceP1 / timeWindow;     // 0.2 / 0.5 = 0.4 (40%)
```

**The Magic Formula:**
```javascript
x = p1.x + (p2.x - p1.x) * t;
// = 200 + (350 - 200) * 0.4
// = 200 + 60
// = 260
```

The car is at `x = 260`! 🎯

---

## 🔧 How to Modify

### Add a New Stat (e.g., `Distance`)

**Step 1:** Backend (`fastf1_service.py`)
```python
"distance": float(row.Distance) if row.Distance else 0.0,
```

**Step 2:** Hook (`useRaceLoop.js`) in `setDriverStats`:
```javascript
distance: p1.distance + (p2.distance - p1.distance) * t,
```

**Step 3:** Connector (`TrackMap.jsx`):
```jsx
<TelemetryHUD ... distance={driverStats.distance} />
```

**Step 4:** UI (`TelemetryHUD.jsx`):
```jsx
<div>Distance: {distance.toFixed(0)}m</div>
```

---

## ⚠️ Common Mistakes

| Mistake | Why It's Bad | Fix |
|---------|--------------|-----|
| Using `useState` for `previousTime` | Re-renders 60x/sec for nothing | Use `useRef` |
| Not capping `deltaTime` | Tab pause = 10s jump | `Math.min(deltaTime, 0.1)` |
| Forgetting to cancel animation | Memory leak | `return () => cancelAnimationFrame(...)` |

---

## 📊 Visual Timeline

```
Telemetry:  [P0]-------[P1]-------[P2]-------[P3]
Time:        0.1        0.5        1.0        1.5
                          ^
                          |
                     virtualTime = 0.7
                     We LERP between P1 and P2
```
