"""
Integration tests against real session data.

Slower than the unit tests (they load FastF1), so they are marked `slow`:

    pytest -m "not slow"      # fast loop, synthetic only
    pytest                    # everything

These assert the properties that were each, at some point, actually broken —
and every one of them was previously checked by hand in a browser, which is
precisely how a couple of them got through in the first place.
"""
import numpy as np
import pytest

from services.fastf1_service import (
    get_track_data,
    get_lap_telemetry,
    PLAYBACK_FPS,
)

pytestmark = pytest.mark.slow

YEAR, ROUND, SESSION = 2023, 1, "Q"      # Bahrain qualifying


@pytest.fixture(scope="module", autouse=True)
def no_cache():
    """
    Recompute everything.

    Without this the tests read payloads out of MongoDB and would happily pass
    with the maths completely broken — they would be testing the cache, not the
    code. Slower, but it is the difference between a real test and theatre.
    """
    import services.fastf1_service as svc
    get, set_ = svc.cache_get, svc.cache_set
    svc.cache_get = lambda key: None
    svc.cache_set = lambda key, payload: None
    yield
    svc.cache_get, svc.cache_set = get, set_


@pytest.fixture(scope="module")
def track():
    return get_track_data(YEAR, ROUND, SESSION)


@pytest.fixture(scope="module")
def lap():
    return get_lap_telemetry(YEAR, ROUND, SESSION, "fastest")


@pytest.fixture(scope="module")
def raw_lap():
    """Untouched FastF1 telemetry — the ground truth the payload is checked against."""
    import fastf1
    ses = fastf1.get_session(YEAR, ROUND, SESSION)
    ses.load()
    return ses.laps.pick_fastest().get_telemetry()


# --------------------------------------------------------------------------

def test_replay_ends_exactly_on_the_lap_time(lap):
    """
    np.arange stops BEFORE its endpoint, so every replay used to finish up to
    one frame (33ms) early — by a different amount per driver, which made a
    head-to-head delta wrong at the flag.
    """
    last = lap["telemetry"][-1]["time"]
    assert last == pytest.approx(lap["lap_seconds"], abs=1e-3)


def test_motion_is_smooth(lap):
    """
    The original stutter: position came from a sparse, noisy X/Y stream and the
    car lurched between fixes, with implied speeds of 2400 km/h. Driving the
    line by the clean Distance channel fixed it; this is the guard.
    """
    t = lap["telemetry"]
    x = np.array([p["x"] for p in t])
    y = np.array([p["y"] for p in t])
    v = np.array([p["speed"] for p in t])

    # X/Y are in tenths of a metre; frames are 1/PLAYBACK_FPS apart
    implied = np.hypot(np.diff(x), np.diff(y)) / 10.0 * PLAYBACK_FPS * 3.6

    assert np.corrcoef(implied, v[1:])[0, 1] > 0.99
    # and no teleports: the fastest implied step stays near the real top speed
    assert implied.max() < v.max() * 1.35


def test_distance_axis_is_monotone_and_spans_the_lap(track):
    """Every trace is plotted against D; it must never go backwards."""
    d = np.array([p["D"] for p in track["track_points"]])
    assert np.all(np.diff(d) >= 0)
    assert d[0] == pytest.approx(0.0, abs=1.0)
    assert d[-1] == pytest.approx(track["total_distance"], abs=1.0)


def test_plotted_speed_matches_the_real_lap(track, raw_lap):
    """
    The big one: D used to be arc length scaled pro rata, so the speed drawn at
    a given point on the chart was up to 49 km/h away from what the car was
    actually doing there (Monaco was the worst).

    This compares the payload against RAW FastF1 telemetry, not against itself —
    checking it for self-consistency would pass no matter how wrong the axis is.
    """
    pts = track["track_points"]
    d = np.array([p["D"] for p in pts])
    s = np.array([p["S"] for p in pts])
    t = np.array([p["T"] for p in pts])

    d_raw = raw_lap["Distance"].to_numpy().astype(float)
    v_raw = raw_lap["Speed"].to_numpy().astype(float)
    thr_raw = raw_lap["Throttle"].to_numpy().astype(float)

    assert np.abs(s - np.interp(d, d_raw, v_raw)).max() < 1.0    # km/h
    assert np.abs(t - np.interp(d, d_raw, thr_raw)).max() < 2.0  # percent
    # and the profile must be a real lap, not a flat line
    assert s.max() > 250 and s.min() < 150


def test_braking_is_a_real_magnitude(track):
    """
    FastF1's Brake channel is boolean, so the brake meter used to read 100%
    flat through every zone. Deceleration supplies the magnitude; F1 cars peak
    around 5-6g and never at 1g or 20g.
    """
    peak = track["peak_decel_g"]
    assert 3.0 < peak < 7.0

    a = np.array([p["A"] for p in track["track_points"]])
    assert a.min() < -2.0        # real braking present
    assert a.max() > 0.5         # real acceleration present


def test_zones_lie_inside_the_lap(track):
    total = track["total_distance"]
    for key in ("drs_zones", "brake_zones"):
        for z in track[key]:
            assert 0 <= z["start"] < z["end"] <= total + 1, f"{key} out of bounds"


def test_sectors_are_ordered(track):
    assert 0 < track["sector1_end"] < track["sector2_end"] < track["total_distance"]


def test_sector_times_sum_to_the_lap(lap):
    """The splits shown against each driver must add up to their own lap."""
    st = lap["sector_times"]
    if not all(st.get(k) for k in ("s1", "s2", "s3")):
        pytest.skip("session has no complete split times")
    assert st["s1"] + st["s2"] + st["s3"] == pytest.approx(lap["lap_seconds"], abs=0.05)
