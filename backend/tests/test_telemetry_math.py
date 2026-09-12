"""
Unit tests for the replay's signal processing.

Synthetic arrays only — no FastF1, no network, no cache — so the whole file runs
in milliseconds and can be run on every save.

Each test corresponds to something that actually went wrong during development,
so a regression here is a bug we have already paid for once:

  · the racing line produced implied speeds of 2400 km/h and the car teleported
  · deceleration was rendered as a boolean, so the brake meter read 100% flat
  · a brake blip of a few metres was reported as a braking zone
  · sector boundaries drifted from the official split times
"""
import numpy as np
import pandas as pd
import pytest

from services.telemetry_math import (
    racing_line,
    long_g,
    drs_zones,
    brake_zones,
    mask_to_zones,
    sector_ends,
    RACING_LINE_POINTS,
)


def make_tel(x, y, speed=None, throttle=None, distance=None,
             seconds=None, brake=None, drs=None):
    """A FastF1-shaped telemetry frame: it is only ever used for its columns."""
    n = len(x)
    if distance is None:
        step = np.r_[0.0, np.hypot(np.diff(x), np.diff(y))]
        distance = np.cumsum(step)
    if seconds is None:
        seconds = np.linspace(0, 10, n)
    return pd.DataFrame({
        "X": np.asarray(x, float),
        "Y": np.asarray(y, float),
        "Speed": np.full(n, 100.0) if speed is None else np.asarray(speed, float),
        "Throttle": np.full(n, 50.0) if throttle is None else np.asarray(throttle, float),
        "Distance": np.asarray(distance, float),
        "Time": pd.to_timedelta(np.asarray(seconds, float), unit="s"),
        "Brake": np.zeros(n) if brake is None else np.asarray(brake, float),
        "DRS": np.zeros(n) if drs is None else np.asarray(drs, float),
    })


def circle(n=400, r=1000.0):
    """A closed circular 'circuit' — arc length is known exactly: 2*pi*r."""
    th = np.linspace(0, 2 * np.pi, n)
    x, y = r * np.cos(th), r * np.sin(th)
    dist = th * r                      # true distance travelled
    return x, y, dist


# --------------------------------------------------------------------------
# racing_line
# --------------------------------------------------------------------------

class TestRacingLine:
    def test_total_length_matches_geometry(self):
        x, y, dist = circle()
        _, _, _, _, total = racing_line(make_tel(x, y, distance=dist))
        assert total == pytest.approx(2 * np.pi * 1000.0, rel=0.01)

    def test_grid_is_evenly_spaced(self):
        x, y, dist = circle()
        s_grid, _, _, _, total = racing_line(make_tel(x, y, distance=dist))
        assert len(s_grid) == RACING_LINE_POINTS
        gaps = np.diff(s_grid)
        assert gaps.std() == pytest.approx(0.0, abs=1e-6)
        assert s_grid[0] == 0.0 and s_grid[-1] == pytest.approx(total)

    def test_distance_channel_is_monotone_and_spans_the_lap(self):
        """
        'D' must never go backwards. The traces plot every value against it, and
        a non-monotone axis makes the curve fold back on itself.
        """
        x, y, dist = circle()
        _, _, _, chans, _ = racing_line(make_tel(x, y, distance=dist))
        d = chans["D"]
        assert np.all(np.diff(d) >= 0)
        assert d[0] == pytest.approx(dist[0], abs=1.0)
        assert d[-1] == pytest.approx(dist[-1], abs=1.0)

    def test_distance_is_true_distance_not_scaled_arc_length(self):
        """
        The regression that made the graphs plot values up to 49 km/h away from
        what the car was doing: D was arc length scaled pro rata, which drifts
        from the real Distance channel wherever the smoothed line cuts a corner.
        """
        x, y, dist = circle()
        # a lap whose distance advances unevenly — pro-rata scaling would be wrong
        squashed = dist ** 1.3
        squashed = squashed / squashed[-1] * dist[-1]
        _, _, _, chans, _ = racing_line(make_tel(x, y, distance=squashed))
        pro_rata = np.linspace(squashed[0], squashed[-1], RACING_LINE_POINTS)
        # D must follow the real channel, not the straight line between its ends
        assert np.abs(chans["D"] - pro_rata).max() > 1.0

    def test_channels_are_carried_through(self):
        x, y, dist = circle()
        speed = np.linspace(80, 300, len(x))
        thr = np.linspace(0, 100, len(x))
        _, _, _, chans, _ = racing_line(make_tel(x, y, speed=speed, throttle=thr, distance=dist))
        assert chans["S"].min() == pytest.approx(80, abs=1.0)
        assert chans["S"].max() == pytest.approx(300, abs=1.0)
        assert chans["T"].min() == pytest.approx(0, abs=1.0)
        assert chans["T"].max() == pytest.approx(100, abs=1.0)

    def test_survives_duplicate_positions(self):
        """A parked car repeats X/Y; that must not produce NaNs or blow up."""
        x, y, dist = circle(n=200)
        x[50:60] = x[50]
        y[50:60] = y[50]
        _, xg, yg, chans, total = racing_line(make_tel(x, y, distance=dist))
        assert np.isfinite(xg).all() and np.isfinite(yg).all()
        assert np.isfinite(chans["D"]).all()
        assert total > 0


# --------------------------------------------------------------------------
# long_g
# --------------------------------------------------------------------------

class TestLongitudinalG:
    def test_constant_deceleration_is_recovered(self):
        """10 m/s^2 of braking is 1.0194 g, and the sign must be negative."""
        secs = np.linspace(0, 5, 200)
        v_ms = 80.0 - 10.0 * secs
        tel = make_tel(np.arange(200.0), np.zeros(200),
                       speed=v_ms * 3.6, seconds=secs,
                       distance=np.cumsum(np.r_[0.0, np.diff(secs) * v_ms[:-1]]))
        _, g = long_g(tel)
        mid = g[20:-20]                       # ignore smoothing edges
        assert mid.mean() == pytest.approx(-10.0 / 9.81, rel=0.02)

    def test_acceleration_is_positive(self):
        secs = np.linspace(0, 5, 200)
        v_ms = 20.0 + 8.0 * secs
        tel = make_tel(np.arange(200.0), np.zeros(200),
                       speed=v_ms * 3.6, seconds=secs,
                       distance=np.cumsum(np.r_[0.0, np.diff(secs) * v_ms[:-1]]))
        _, g = long_g(tel)
        assert g[20:-20].mean() > 0

    def test_duplicate_timestamps_do_not_produce_infinities(self):
        """np.gradient over a repeated timestamp divides by zero."""
        secs = np.linspace(0, 5, 100)
        secs[40] = secs[39]
        tel = make_tel(np.arange(100.0), np.zeros(100), seconds=secs)
        _, g = long_g(tel)
        assert np.isfinite(g).all()


# --------------------------------------------------------------------------
# zone detection
# --------------------------------------------------------------------------

class TestZones:
    def _tel(self, n=100, spacing=10.0, **kw):
        return make_tel(np.arange(float(n)), np.zeros(n),
                        distance=np.arange(n) * spacing, **kw)

    def test_contiguous_run_becomes_one_zone(self):
        mask = np.zeros(100, bool)
        mask[20:40] = True                      # 190m at 10m spacing
        zones = mask_to_zones(mask, self._tel(), min_length_m=50)
        assert len(zones) == 1
        assert zones[0]["start"] == pytest.approx(200.0)
        assert zones[0]["end"] == pytest.approx(390.0)

    def test_short_blip_is_dropped(self):
        mask = np.zeros(100, bool)
        mask[20:22] = True                      # 10m — below the threshold
        assert mask_to_zones(mask, self._tel(), min_length_m=50) == []

    def test_separate_runs_stay_separate(self):
        mask = np.zeros(100, bool)
        mask[10:30] = True
        mask[60:85] = True
        assert len(mask_to_zones(mask, self._tel(), min_length_m=50)) == 2

    def test_drs_open_codes_only(self):
        """FastF1: 0/1 closed, 8 eligible-but-closed, 10/12/14 open."""
        drs = np.zeros(100)
        drs[10:40] = 8                          # eligible, NOT open
        drs[50:90] = 12                         # open
        zones = drs_zones(self._tel(drs=drs), min_length_m=50)
        assert len(zones) == 1
        assert zones[0]["start"] == pytest.approx(500.0)

    def test_brake_zones_use_the_pedal_flag(self):
        brake = np.zeros(100)
        brake[30:60] = 1
        zones = brake_zones(self._tel(brake=brake), min_length_m=25)
        assert len(zones) == 1
        assert zones[0]["start"] == pytest.approx(300.0)


# --------------------------------------------------------------------------
# sector boundaries
# --------------------------------------------------------------------------

class TestSectorEnds:
    def test_boundaries_follow_the_official_split_times(self):
        t = np.linspace(0, 90, 500)
        d = t / 90.0 * 5000.0                   # constant speed, so t maps linearly
        lap = {"Sector1Time": pd.Timedelta(seconds=30),
               "Sector2Time": pd.Timedelta(seconds=40)}
        s1, s2 = sector_ends(lap, t, d, 5000.0)
        assert s1 == pytest.approx(5000.0 * 30 / 90, rel=1e-3)
        assert s2 == pytest.approx(5000.0 * 70 / 90, rel=1e-3)

    def test_ordering_always_holds(self):
        t = np.linspace(0, 90, 500)
        d = t / 90.0 * 5000.0
        lap = {"Sector1Time": pd.Timedelta(seconds=28),
               "Sector2Time": pd.Timedelta(seconds=35)}
        s1, s2 = sector_ends(lap, t, d, 5000.0)
        assert 0 < s1 < s2 < 5000.0

    def test_missing_splits_fall_back_without_crashing(self):
        t = np.linspace(0, 90, 500)
        d = t / 90.0 * 5000.0
        lap = {"Sector1Time": None, "Sector2Time": None}
        s1, s2 = sector_ends(lap, t, d, 5000.0)
        assert 0 < s1 < s2 < 5000.0
