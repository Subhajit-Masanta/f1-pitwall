# 📟 TelemetryHUD.jsx – The Dashboard

> [!NOTE]
> This component acts like the **Head-Up Display (HUD)** in a video game. It visualizes the raw telemetry data (Speed, RPM, Gear) in real-time.

**Location**: `ui/src/components/TelemetryHUD.jsx`

---

## 🏗️ 1. The Props (Inputs)

The component receives 5 numbers as "Props".

```javascript
const TelemetryHUD = ({ speed, gear, rpm, throttle, brake }) => { ... }
```

| Prop | Type | Description |
| :--- | :--- | :--- |
| `speed` | Number | Car speed in KM/H (e.g., `305`). |
| `gear` | Number/String | Current gear (e.g., `1-8`) or `0` for Neutral. |
| `rpm` | Number | Engine revolutions (e.g., `11500`). |
| `throttle` | Number (0.0 - 1.0) | How much gas? (0% to 100%). |
| `brake` | Number (0.0 - 1.0) | How much brake? (0% to 100%). |

---

## 🎨 2. Styling (CSS-in-JS)

All styles are written directly in the file using standard CSS properties.

### The Container (The Glass Box)
Lines 32-49 create the "Glassmorphism" look.
```javascript
background: 'linear-gradient(135deg, rgba(20,20,30,0.95) 0%, ...)',
backdropFilter: 'blur(20px)', // The "Frosted Glass" effect
borderRadius: '24px',         // Rounded corners
boxShadow: '0 20px 60px ...', // The deep shadow behind it
```
**How to Customize:**
*   **Change Color**: Edit the `rgba(...)` values in `background`.
*   **Change Size**: Edit `width: '280px'`.
*   **Change Position**: Edit `bottom: 30` or `right: 30`.

---

## ⚙️ 3. Logic & Math

### A. RPM Calculation
We assume a max RPM to calculate the percentage for the bar.
```javascript
const MAX_RPM = 12500;
const rpmPercent = Math.min((rpm / MAX_RPM) * 100, 100);
```
**To Change Max RPM:** Change `12500` to `15000` (for older cars) or `12000` (for hybrid era).

### B. RPM Color (The "Shift Lights")
This function changes the bar color as you get faster.
```javascript
const getRpmColor = (pct) => {
    if (pct < 85) return '#00ff00'; // Green (Safe)
    if (pct < 95) return '#ff0000'; // Red (Warning)
    return '#8000ff';               // Purple (SHIFT NOW!)
};
```
**To Change Colors:** Just replace the HEX codes (e.g., `#00ff00`).

---

## 🕹️ 4. Visual Elements

### The Speedometer
*   **Font**: Uses `Titillium Web` (F1-style font).
*   **Gradient Text**: The speed number has a `linear-gradient` applied to the text itself (`WebkitBackgroundClip: 'text'`).

### The Gear Box
*   A square box (`70x70px`).
*   **Logic**: If `gear === 0`, it displays "N" (Neutral).

### The Pedals (Throttle/Brake)
Two bars side-by-side.
*   **Throttle**: Green (`#00ff00`).
*   **Brake**: Red (`#ff0000`).
*   **Animation**: `transition: 'width 0.05s linear'` makes them move smoothly instead of jumping.

---

## 🎓 Interview Cheat Sheet

**Q: How do you animate the bars efficiently?**
> **A:** "I use CSS transitions (`transition: width 0.05s`). This runs on the GPU and is much smoother than trying to animate it with JavaScript intervals."

**Q: What is `WebkitBackgroundClip: 'text'`?**
> **A:** "It is a CSS trick that clips the background color to the shape of the text. I used it to give the Speed Number a metallic gradient look."
