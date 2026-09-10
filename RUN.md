# Running f1-pitwall (`backend/` + `ui/`)

## Backend (FastAPI + FastF1)

The Python env is a **3.12 virtualenv** at `backend/.venv` (FastF1 is unreliable
on 3.13/3.14).

```powershell
cd backend
.\.venv\Scripts\Activate.ps1        # or: .venv\Scripts\python.exe -m uvicorn ...
uvicorn main:app --reload --port 8000
```

- First load of any race downloads data into `backend/cache/` (~20-40s), then it's instant.
- Runs fine without MongoDB — the DB connection is optional and only prints a warning.
- Docs: http://127.0.0.1:8000/docs

To recreate the venv from scratch:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Frontend (React + Vite)

```powershell
cd ui
npm install
npm run dev            # http://localhost:5173
```

The frontend calls the backend at `http://127.0.0.1:8000` (hard-coded in
`src/services/api.js`). CORS allows `localhost:5173` / `127.0.0.1:5173`.

## Secrets

`backend/.env` is gitignored. Copy `backend/.env.example` to `backend/.env` and
fill in your own MongoDB URI. **The old committed credential should be rotated.**
