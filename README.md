# f1-pitwall

Replay any Formula 1 session from real telemetry — the way you'd watch it from
the pit wall.

Pick a Grand Prix and a mode:

- **Fastest Qualifying Lap** — the quickest lap of the session, replayed on a
  track map with sector splits, DRS zones, corner markers and a live onboard
  telemetry strip (speed, gear, throttle, brake, RPM, DRS).
- **Full Race** — final classification, grid, positions gained/lost and points.

Data covers **2018–2026**. Telemetry needs car-position data, which F1 has
published since 2018.

## Stack

| | |
|---|---|
| Frontend | React + Vite, SVG track + a GPU-composited car marker |
| Backend | FastAPI + [FastF1](https://github.com/theOehrly/Fast-F1) |
| Cache | MongoDB Atlas — stores the *processed* JSON per session (~65 KB gzipped), so a repeat load is ~30 ms instead of ~7 s |

## Run it locally

```bash
# backend
cd backend
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn main:app --reload      # :8000

# frontend
cd ui
npm install
npm run dev                                            # :5173
```

Works without MongoDB — every request is just slower. See
[`RUN.md`](RUN.md) for detail.

## Deploy

Static frontend (Cloudflare Pages / Vercel) + a small API (Render / Cloud Run) +
a free Atlas M0 cache. A GitHub Action re-warms the cache every Monday so new
races load instantly. Full walkthrough in [`DEPLOY.md`](DEPLOY.md).

## Roadmap

- Ghost car / two-driver comparison with track dominance
- Speed trace + draggable scrubber
- Session & driver pickers (FP1–3, Sprint, any driver)
- All 20 cars on track for the Full Race mode
- Shareable URLs

## Credits

Timing and telemetry via [FastF1](https://github.com/theOehrly/Fast-F1).
Not affiliated with Formula 1, the FIA, or any team.
