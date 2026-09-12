import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from database import check_db_connection, cache_stats
from services.session_data import (
    get_race_results,
    get_race_calendar,
    get_race_sessions,
    get_session_drivers,
)
from services.track_data import get_track_data
from services.lap_data import get_lap_telemetry
from services.race_data import get_race_data


# 1. Startup / shutdown (lifespan replaces the deprecated @app.on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    check_db_connection()   # runs once when the server boots
    yield
    # (nothing to clean up on shutdown yet)


# 2. Initialize the API (MUST BE FIRST)
app = FastAPI(lifespan=lifespan)   #creates the web application object.
# then fast api is just like template
                    
                    #FastAPI App / Controller + Routing    This is the entry point for your backend.


#Its only job is to define the HTTP Endpoints (Routes), API Gateway and Controller Layer
"""
It is the Application Entry Point. It initializes the FastAPI app, configures middleware (like CORS), 
and acts as the Router that maps incoming HTTP requests to the specific controller functions.
"""

# 3. Configure CORS
# NOTE: allow_origins=["*"] with allow_credentials=True is rejected by browsers,
# so we never use "*". Local dev always allowed; production origins come from ALLOWED_ORIGINS
# (comma-separated), e.g. "https://f1replay.pages.dev,https://f1.example.com".
_extra = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

# Compress responses. FastAPI does NOT do this by default, and without it the
# race payload goes over the wire at its raw size: measured 6.83 MB instead of
# 1.21 MB for 2023 Australia. Everything about the 2 Hz sample rate was chosen
# against the gzipped figure, so shipping it uncompressed threw that away.
# minimum_size skips the tiny JSON replies, where a gzip header costs more than
# it saves.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_extra,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

"""
@app.get("/users")
def get_users():
    return {"data": ["Subh", "Rahul", "Amit"]}
Let's break this.

Which part is the API?
/users -> API endpoint

@app.get -> API method/route

async def get_track(year: int, round: int, session: str)  the function receiving the request -> API handler

return {"data": ["Subh", "Rahul", "Amit"]} the returned JSON -> API response

Everything else (like database queries inside the function) is not the API, it's just backend logic """


# 4. Endpoints
# These are plain `def` (not async) on purpose: the service functions do blocking
# FastF1 work, and FastAPI runs sync path operations in a worker thread so one
# slow race load does not block every other request.
@app.get("/")
def root():
    return {"message": "F1 Pitwall API is live"}

@app.get("/health")
def health():
    """Liveness + cache status — handy after deploying."""
    return {"ok": True, "cache": cache_stats()}

@app.get("/results/{year}/{round}")
def get_results_endpoint(year: int, round: int, session: str = "R"):
    """
    Classification for a session (default: the race).
    Example: /results/2026/13  or  /results/2026/13?session=Q
    """
    try:
        return get_race_results(year, round, session)
    except Exception as e:
        return {"error": str(e)}

@app.get("/races/{year}")
def get_race_calendar_endpoint(year: int):
    try:
        return get_race_calendar(year)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@app.get("/sessions/{year}/{round}")
def get_sessions(year: int, round: int):
    return get_race_sessions(year, round)

@app.get("/track/{year}/{round}/{session}")
def get_track(year: int, round: int, session: str):
    """
    Get track coordinates (X, Y) for a specific session.
    Example: /track/2023/7/R
    """
    return get_track_data(year, round, session)

@app.get("/drivers/{year}/{round}/{session}")
def get_drivers(year: int, round: int, session: str):
    """Everyone who set a lap, ordered by their fastest — the head-to-head picker."""
    return get_session_drivers(year, round, session)


@app.get("/telemetry/{year}/{round}/{session}/{driver}")
def get_telemetry_endpoint(year: int, round: int, session: str, driver: str):
    """
    Get telemetry for a specific driver.
    """
    return get_lap_telemetry(year, round, session, driver)


@app.get("/race/{year}/{round}/{session}")
def get_race_endpoint(year: int, round: int, session: str = "R"):
    """
    A whole race, resampled for playback: every car's position, the running
    order, tyre stints, pit stops, the SC/VSC/red-flag timeline and weather.
    Example: /race/2023/3/R
    """
    return get_race_data(year, round, session)
