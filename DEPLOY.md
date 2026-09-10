# Deploying f1-pitwall

Two pieces: a **static frontend** (free, trivially) and a **Python API** (free tier,
with a MongoDB cache doing the heavy lifting).

---

## 0. First: rotate the MongoDB credential

`backend/.env` previously held a live Atlas password in plaintext. That cluster is
already gone, but **create a fresh one and never reuse the old password.**

1. MongoDB Atlas → create a free **M0** cluster
2. Database Access → add a user with a *new* strong password
3. Network Access → allow `0.0.0.0/0` (your API host has no fixed IP)
4. Copy the connection string into `backend/.env` (gitignored) and into your host's
   env vars

---

## 1. Why this is fast

FastF1's own cache only stores *raw downloads*. Even fully warm, `session.load()`
re-parses 20 drivers through pandas every request — **~7s measured**.

So we cache the **finished JSON** in MongoDB, gzipped:

| | |
|---|---|
| Cold, no cache | 30–60s |
| Warm FastF1 disk cache | ~7s |
| **MongoDB cache hit** | **~30ms** |
| Size per session | **~65 KB gzipped** (407 KB raw) |
| Atlas M0 free storage | 512 MB → room for ~7,000 sessions |

Because the cache lives in Atlas and not on disk, it survives container restarts —
which is what makes free **ephemeral-disk** hosts usable.

---

## 2. Deploy the API

### Render (simplest)

1. Push this repo to GitHub
2. Render → **New Web Service** → point at the repo, root directory `backend`
3. Runtime **Docker** (the `Dockerfile` is there), or Python with:
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Environment variables:
   ```
   MONGODB_URI       = <your Atlas string>
   ALLOWED_ORIGINS   = https://<your-frontend-domain>
   ```
5. Deploy, then check `https://<your-api>/health` — it reports cache status.

Free tier spins down when idle; the first request after that costs a few seconds of
container boot (**not** a data download, thanks to the cache).

### Alternatives

- **Google Cloud Run** — same Docker image, generous always-free tier, scales to zero.
- **Oracle Always Free VM** — most resources (2 OCPU / 12 GB), no cold starts, but you
  administer a Linux box **and** Oracle reclaims instances idle >7 days unless you
  convert the account to Pay-As-You-Go.

---

## 3. Deploy the frontend

Cloudflare Pages (or Vercel / Netlify — all equivalent here):

- Build command: `npm run build`
- Build output: `dist`
- Root directory: `ui`
- Environment variable: `VITE_API_BASE = https://<your-api-domain>`

Then add that Pages domain to `ALLOWED_ORIGINS` on the API and redeploy it.

---

## 4. Automatic updates after each race

`.github/workflows/warm-cache.yml` runs **every Monday 06:17 UTC** and pre-caches the
last 2 completed rounds, so a new race is instant for the first visitor.

Setup: GitHub repo → Settings → Secrets and variables → Actions → new secret
**`MONGODB_URI`** with your Atlas string.

Run it by hand any time from the Actions tab ("Run workflow"), where you can override
the season, how many rounds, and which sessions.

### Warming manually

```bash
cd backend
python scripts/warm_cache.py                        # current season, all completed rounds
python scripts/warm_cache.py --recent 2             # just the last 2 rounds
python scripts/warm_cache.py --year 2026 --round 13
python scripts/warm_cache.py --years 2023 2024 2025 2026 --sessions Q R
```

Re-running is safe — cached sessions are skipped unless you pass `--force`.

**Backfilling a few seasons takes a while** (30–60s per uncached session). Kick it off
locally once, then let the weekly Action keep it current.

---

## 5. Sanity checks

```bash
curl https://<your-api>/health          # {"ok":true,"cache":{...,"sessions":N}}
curl https://<your-api>/races/2026      # calendar
```

If `cache.connected` is `false`, the API still works — every request is just slow.
Check `MONGODB_URI` and that Atlas network access allows `0.0.0.0/0`.
