# 🖼️ App.jsx – The Container

> [!NOTE]
> This is step 1 of the User Interface. It is the "Parent" that holds everything else together.

**Location**: `ui/src/App.jsx`

---

## 🏗️ 1. The Structure

React apps are trees. `App.jsx` is the trunk.

```javascript
import { useState } from 'react';
import RaceSelector from './components/RaceSelector';
import TrackMap from './components/TrackMap';
```
*   **Imports**: It brings in the children components.
*   **State**: `useState(null)`.
    *   Initially, no race is selected (`null`).
    *   When the user picks one, this variable updates, and the whole app re-renders.

---

## 🎨 2. The Layout (JSX)

```javascript
return (
  <div style={{...}}>
    <h1>F1 Race Replay 🏎️</h1>

    {/* 1. The Selector */}
    <RaceSelector onSelectRace={setSelectedRace} />

    {/* 2. The Track Map (Conditional Rendering) */}
    {selectedRace && (
       <TrackMap ... />
    )}
  </div>
);
```

<RaceSelector onSelectRace={setSelectedRace} />

## You pass a function to the child component.

Meaning:
"Hey RaceSelector, when user selects a race, call my function and pass the selected race object."
This is basic parent-to-child → child-to-parent communication.


### Key Concept: Conditional Rendering
Notice line 22: `{selectedRace && ( ... )}`.
*   **If selectedRace is null**: The code stops. The Map is NOT created.
*   **If selectedRace exists**: The code matches, and `<TrackMap />` is created.

This prevents the app from crashing by trying to draw a map before we know which race to draw.

---

## 🔗 The Big Picture: Architecture

| Component | Role | Analogy |
| :--- | :--- | :--- |
| **App.jsx** | **State Holder** | The Mother. She holds the "Family Secret" (Which race is selected). |
| **RaceSelector** | **Trigger** | The Child who asks to change the channel. It calls `setSelectedRace`. |
| **TrackMap** | **Display** | The TV. It changes based on what the Mother allows. |

### Data Flow (The "Props" Chain)
1.  User clicks "Spa" in `RaceSelector`.
2.  `RaceSelector` calls `onSelectRace(spa_data)`.
3.  `App` updates `selectedRace`.
4.  `App` passes `selectedRace.round` DOWN to `TrackMap`.
5.  `TrackMap` draws the new track.

---

## 🎓 Interview Cheat Sheet

**Q: Where should I keep my state?**
> **A:** "I lift the state up to the **Common Ancestor** (`App.jsx`). Since both `RaceSelector` (who changes it) and `TrackMap` (who uses it) need access to the `selectedRace`, the state must live in their parent."

**Q: What is `{condition && <Component />}` called?**
> **A:** "That is **Short-circuit Evaluation** used for **Conditional Rendering**."

---

## 🔎 Deep Dive: What is `useState`?

> [!IMPORTANT]
> **Technical Definition**: `useState` is a React Hook that lets you add a "variable" to your component that **persists** between renders.

### The "Memory Box" Analogy 🧠📦

Imagine a standard JavaScript function:
```javascript
function myFunction() {
   let score = 0; // ❌ This is forgotten as soon as the function ends.
}
```
Every time you run `myFunction`, `score` resets to 0. It has no memory.

**React Components are just functions.**
So, if you want your component to "remember" that you selected the "Bahrain GP", you need a special memory box.

```javascript
import { useState } from 'react';

//     Variable     Setter               Initial Value
const [selectedRace, setSelectedRace] = useState(null);
```

1.  **`selectedRace`**: The value inside the box (e.g., "Bahrain").
2.  **`setSelectedRace`**: The magic button. When you press it (`setSelectedRace("Monaco")`):
    *   It updates the value.
    *   **CRITICAL**: It tells React "HAY! Data changed! Re-run this entire function to update the screen!" (Re-render).

### Why not just use `let selectedRace = null`?
If you used a normal variable, React **would not know** when it changed. The screen would stay blank forever.
**`useState` = Data + Notification System.**
