# 🎓 F1 Replay: Codebase Study Plan

This curriculum divides the project into 6 logical "Levels", moving from the simple backend data to the complex frontend physics.

Follow this order to build your mental model layer-by-layer.

---

## 🟢 Level 1: The Source (Backend Data)
**Goal**: Understand where the data comes from.

### 1. `backend/database.py` (Depth: Skim)
- **Why**: Logic needs a home. This file just connects to MongoDB.
- **Study**: Look at lines 20-25 to see how it "pings" the database.

### 2. `backend/services/fastf1_service.py` (Depth: **Deep Dive**)
- **Why**: This is the core engine. It talks to the outside world.
- **Study**:
    - `get_race_calendar`: How it loops through rows.
    - `get_track_data`: How it downsamples points.
    - `get_lap_telemetry`: How it cleans bad data.
- **Practice**: Run the `test_script.py` I gave you earlier.

---

## 🟡 Level 2: The Gateway (Backend API)
**Goal**: Understand how data leaves the Python world.

### 3. `backend/main.py` (Depth: Understand Logic)
- **Why**: It defines the "Menu" of what the app can do.
- **Study**:
    - `app = FastAPI()`: The startup.
    - `@app.get("/track/...")`: How it matches URLs to functions.
    - Notice how it simply *calls* Level 1 functions. It does very little work itself.

---

## 🟠 Level 3: The Bridge (Frontend Connectivity)
**Goal**: Understand how React gets the data.

### 4. `ui/src/services/api.js` (Depth: Skim)
- **Why**: It's just a config file.
- **Study**: Note the `baseURL` pointing to localhost:8000.

### 5. `ui/src/services/raceService.js` (Depth: Understand Logic)
- **Why**: It matches the Python API one-to-one.
- **Study**: Compare `getTrackData` here with `@app.get("/track/...")` in `main.py`. They are mirror images.

---

## 🔴 Level 4: The UI Skeleton (Frontend Views)
**Goal**: Understand what the user sees.

### 6. `ui/src/App.jsx` (Depth: Skim)
- **Why**: It's the container.
- **Study**: See how it conditionally renders `<TrackMap />` only when a race is selected.

### 7. `ui/src/components/RaceSelector.jsx` (Depth: Understand Logic)
- **Why**: It triggers the first data load.
- **Study**:
    - `useEffect`: How it loads the calendar on startup.
    - `value={selectedRaceId}`: How it tracks what you picked.

---

## 🟣 Level 5: The Orchestrator (Frontend Logic)
**Goal**: Understand how the map works.

### 8. `ui/src/components/TrackMap.jsx` (Depth: **Deep Dive**)
- **Why**: It connects Data + Physics + Visuals.
- **Study**:
    - Don't look at the render code yet.
    - Look at how it calls `useRaceData` and `useRaceLoop`.
    - It's the "Manager" component.

### 9. `ui/src/hooks/useRaceData.js` (Depth: **Deep Dive**)
- **Why**: This does the math.
- **Study**:
    - `useEffect`: How it fetches the track.
    - **Rotation Logic**: The math intended to rotate the track 90 degrees.
    - `mapLayout`: How it calculates the SVG `viewBox`.

---

## ⚫ Level 6: The Physics Engine (Advanced)
**Goal**: Understand the animation.

### 10. `ui/src/hooks/useRaceLoop.js` (Depth: **Mastery Required**)
- **Why**: This is the hardest file. It runs 60 times a second.
- **Study**:
    - `requestAnimationFrame`: The loop command.
    - **Interpolation (LERP)**: The math `p1 + (p2 - p1) * t`. This is what makes the car move smoothly.
    - `virtualTimeRef`: How we basically invented "Time" inside the app.

### 11. `ui/src/components/Track/TrackCanvas.jsx` (Depth: Understand Logic)
- **Why**: It draws the result of Level 6.
- **Study**:
    - `<svg>`: The HTML tag for vector graphics.
    - `<path d={d} ... />`: The line that draws the track.
    - `<DriverDot />`: The car.

---

## 📝 How to Study
1.  **Open two windows**: Backend on left, Frontend on right.
2.  **Trace the path**: Start at Level 1, simplify a function, and follow usage up to Level 6.
3.  **Break things**:
    - Change `Color` in `DriverDot`.
    - Change `Speed` in `useRaceLoop`.
    - See what happens. Breaking code is the best way to learn it.
