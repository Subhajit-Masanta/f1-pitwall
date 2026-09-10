# 🛠️ raceService.js – The Manager

> [!NOTE]
> This file is the **Brain** of your data layer. It organizes all the chaos of API calls into neat, named functions.

**Location**: `ui/src/services/raceService.js`

---

## 🏗️ 1. The Import

```javascript
import api from './api';
```
*   It imports the `api` tool we just studied.
*   It doesn't care about `localhost` or `headers` anymore. It just trusts `api` to handle that.

---

## ⚙️ 2. The Service Object

The file exports a single object called `raceService`. This object contains functions that match your Backend API **one-to-one**.

```javascript
export const raceService = {
    // ... functions go here
};
```

---

## 🔎 3. The Functions (One by One)

### A. `getCalendar(year)`
**Goal**: Get the list of races for the dropdown.

```javascript
getCalendar: async (year) => {
    const response = await api.get(`/races/${year}`);
    return response.data;
},
```
*   **Input**: `2023`
*   **Action**: Calls `GET /races/2023`.
*   **Output**: A list of races `[{name: "Bahrain", ...}, ...]`.

### B. `getSession(year, round)`
**Goal**: Get details about a specific race (FP1, Quali, etc - though currently used for race results).

```javascript
getSession: async (year, round) => {
    const response = await api.get(`/races/${year}/${round}`);
    return response.data;
},
```
*   **Input**: `2023`, `1`
*   **Action**: Calls `GET /races/2023/1`.

### C. `getTrackData(year, round, session)`
**Goal**: Get the massive list of X,Y coordinates to draw the map.

```javascript
getTrackData: async (year, round, session) => {
    const response = await api.get(`/track/${year}/${round}/${session}`);
    return response.data;
},
```
*   **Why is this separate?** Track data is heavy. We only fetch it when the user *clicks* a specific race.

### D. `getTelemetry(..., driverId)`
**Goal**: Get speed/gear data for *one specific car*.

```javascript
getTelemetry: async (year, round, session, driverId) => {
    const response = await api.get(`/telemetry/${year}/${round}/${session}/${driverId}`);
    return response.data;
}
```

---

## 🧠 Why do we need this file?
Why not just call `api.get(...)` inside our components?

| Direct Call (Bad) ❌ | Using Service (Good) ✅ |
| :--- | :--- |
| `api.get('/races/2023')` inside `App.jsx` | `raceService.getCalendar(2023)` inside `App.jsx` |
| If URL changes to `/calendar/2023`, you define it in **50 places**. | If URL changes, you fix it in **1 place** here. |
| Code looks messy. | Code looks like English: "Get Calendar". |

> [!TIP]
> **Rule of Thumb**: Components (UI) should never know *URLs*. They should only know *Functions*.

---

## � What is `response.data`?

> [!IMPORTANT]
> **Axios’s response object** looks like this:
> ```javascript
> {
>   data: ...,       // ✅ The actual API output (The JSON you want)
>   status: 200,     // ℹ️ "OK" status code
>   headers: {},     // ✉️ Metadata
>   config: {}       // ⚙️ Technical details
> }
> ```
> We use `return response.data` to **ignore** everything except the payload. We only care about the data your backend gave us.

---

## 🔗 The Big Picture: Who Does What? (Architecture)

In a Full-Stack architecture, these 4 pieces work together like a well-oiled machine. This is the **Separation of Concerns**.

You have 4 main pieces:

## raceService (frontend service, JS)
Lives in React side.
Simple job: give your React components easy functions like getCalendar(year) instead of writing axios.get(...) everywhere.

## api (axios instance, JS)
Still frontend.
Knows where your backend lives: http://127.0.0.1:8000.
Handles HTTP details (base URL, headers).

## main.py (FastAPI app / controller layer)
Backend entry point.
Defines API routes/endpoints: /races/{year}, /track/..., /telemetry/....
Takes HTTP request → calls your service functions → returns JSON back.

## fastf1_service.py (service/business logic layer)
Backend logic.
Talks to FastF1 library, processes data, formats it.
Does all the “heavy” work.

main.py stays clean because this file does the brain work.`main.py` stays clean. |

> [!WARNING]
> **Why 4 files?** If you shoved everything into one file, you would get a "Spaghetti Monster" that is impossible to maintain or debug. 🍝🚫

---

## 🎓 Interview Cheat Sheet

**Q: Why use a Service file instead of `fetch` inside components?**
> **A:** "I use the **Service Repository Pattern**. It separates the **Business Logic** (fetching data) from the **UI Logic** (displaying data). This makes the code **DRY** (Don't Repeat Yourself) and easy to test."

**Q: What is the role of this file?**
> **A:** "It acts as an **Abstraction Layer** over the HTTP Client. The UI components don't care if the data comes from Axios, Fetch, or a mock file; they just call `raceService.getCalendar()`."