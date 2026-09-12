"""
Unit tests for the derived pit-lane geometry.

Synthetic inputs only — no FastF1, no network, no cache. Everything here runs
in well under a second, and each test pins a property that, if broken, shows up
on screen as "the pit lane looks wrong" rather than as an exception.
"""
import numpy as np
import pytest

from services.pit_geometry import (
    PIT_AMPLIFY,
    MAX_STOP_S,
    nearest_on_line,
    amplify_offset,
    resample_path,
    median_path,
    usable_stops,
    stationary_box,
    anchor_ends,
)

# A straight racing line along the x axis, y = 0.
LINE = np.column_stack([np.linspace(0, 100, 201), np.zeros(201)])


class TestNearestOnLine:
    def test_finds_the_foot_of_the_perpendicular(self):
        qx, qy, d = nearest_on_line([50.0], [12.0], LINE)
        assert qx[0] == pytest.approx(50.0, abs=0.5)
        assert qy[0] == pytest.approx(0.0)
        assert d[0] == pytest.approx(12.0, abs=0.01)

    def test_point_on_the_line_has_zero_distance(self):
        _, _, d = nearest_on_line([30.0], [0.0], LINE)
        assert d[0] == pytest.approx(0.0)

    def test_handles_many_points_across_the_chunk_boundary(self):
        n = 9000                                   # > the 4096 chunk size
        px = np.linspace(0, 100, n)
        py = np.full(n, 5.0)
        _, _, d = nearest_on_line(px, py, LINE)
        assert len(d) == n
        assert np.allclose(d, 5.0, atol=0.5)


class TestAmplifyOffset:
    """
    The transform that makes a 15 m pit lane visible on a map where 1 px is
    ~9 m. Its two load-bearing properties are: the ends stay welded to the
    track, and the exaggeration does not keep growing without bound.
    """

    def test_a_point_on_the_racing_line_does_not_move(self):
        # This is what keeps pit entry and pit exit attached to the circuit.
        x, y = amplify_offset([40.0], [0.0], LINE, d_ref=15.0)
        assert x[0] == pytest.approx(40.0, abs=0.6)
        assert y[0] == pytest.approx(0.0, abs=1e-9)

    def test_a_point_a_full_lane_width_out_is_amplified_fully(self):
        x, y = amplify_offset([40.0], [15.0], LINE, d_ref=15.0, amp=4.0)
        assert y[0] == pytest.approx(60.0, abs=0.01)     # 15 * 4
        assert x[0] == pytest.approx(40.0, abs=0.6)

    def test_half_a_lane_width_gets_a_tapered_multiplier(self):
        # k = 1 + (4-1) * 0.5 = 2.5  ->  7.5 * 2.5 = 18.75
        _, y = amplify_offset([40.0], [7.5], LINE, d_ref=15.0, amp=4.0)
        assert y[0] == pytest.approx(18.75, abs=0.02)

    def test_the_taper_is_continuous_approaching_the_line(self):
        # Points converging on the track must converge in the output too, or
        # the lane detaches with a visible step at pit entry.
        ys = np.array([6.0, 3.0, 1.0, 0.3, 0.0])
        _, out = amplify_offset(np.full(len(ys), 40.0), ys, LINE, d_ref=15.0)
        assert out[-1] == pytest.approx(0.0)
        assert np.all(np.diff(out) < 0)                  # monotone, no jump
        assert out[-2] < 1.5                             # still near the track

    def test_amplification_saturates_rather_than_growing(self):
        # Beyond one lane width the multiplier is capped, so a stray sample
        # far from the track is not flung off the map.
        _, y = amplify_offset([40.0], [150.0], LINE, d_ref=15.0, amp=4.0)
        assert y[0] == pytest.approx(600.0, abs=0.1)     # 150 * 4, not 150 * 40

    def test_offset_direction_is_preserved(self):
        _, y = amplify_offset([40.0, 40.0], [10.0, -10.0], LINE, d_ref=15.0)
        assert y[0] > 0 and y[1] < 0

    def test_default_amplification_is_the_documented_one(self):
        _, y = amplify_offset([40.0], [15.0], LINE, d_ref=15.0)
        assert y[0] == pytest.approx(15.0 * PIT_AMPLIFY, abs=0.01)

    def test_empty_input_is_not_an_error(self):
        x, y = amplify_offset([], [], LINE, d_ref=15.0)
        assert len(x) == 0 and len(y) == 0


class TestResamplePath:
    def test_spaces_points_by_arc_length(self):
        px = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
        out = resample_path(px, np.zeros(5), 5)
        assert out[:, 0] == pytest.approx([0, 1, 2, 3, 4])

    def test_a_stationary_run_does_not_swallow_the_samples(self):
        # 40 samples parked at x=1 (the pit box) then movement to x=5. A
        # time-based resample would spend most of its points on the stop.
        px = np.concatenate([np.linspace(0, 1, 10), np.full(40, 1.0), np.linspace(1, 5, 10)])
        out = resample_path(px, np.zeros(len(px)), 9)
        assert out[-1, 0] == pytest.approx(5.0, abs=0.01)
        # the midpoint by arc length should be well past the parked cluster
        assert out[4, 0] > 1.5

    def test_degenerate_paths_return_none(self):
        assert resample_path([1.0], [1.0], 5) is None
        assert resample_path([2.0, 2.0, 2.0], [3.0, 3.0, 3.0], 5) is None


class TestMedianPath:
    def test_an_outlier_trace_does_not_drag_the_result(self):
        # Four traces along y=10, one wild trace at y=500. A mean would land
        # near y=108; the median must stay at 10.
        good = [np.column_stack([np.linspace(0, 10, 20), np.full(20, 10.0)]) for _ in range(4)]
        bad = [np.column_stack([np.linspace(0, 10, 20), np.full(20, 500.0)])]
        out = median_path(good + bad, n=20)
        assert np.median(out[:, 1]) == pytest.approx(10.0, abs=0.5)

    def test_returns_the_requested_point_count(self):
        traces = [np.column_stack([np.linspace(0, 5, 7), np.zeros(7)]) for _ in range(3)]
        assert median_path(traces, n=31).shape == (31, 2)

    def test_no_usable_traces_returns_none(self):
        assert median_path([]) is None
        assert median_path([np.array([[1.0, 1.0]])]) is None


class TestUsableStops:
    def test_keeps_real_stops(self):
        # measured range across three circuits: 15.9 s .. 51.1 s
        stops = [{"in_s": 100.0, "out_s": 100.0 + d} for d in (15.9, 25.3, 51.1)]
        assert len(usable_stops(stops)) == 3

    def test_drops_red_flag_windows_by_duration(self):
        # Australia 2023's three red flags: 602 s, 941 s, 1369 s
        stops = [{"in_s": 0.0, "out_s": d} for d in (602.0, 941.0, 1369.0)]
        assert usable_stops(stops) == []

    def test_the_duration_cut_sits_between_the_two_populations(self):
        assert 51.1 < MAX_STOP_S < 602.0

    def test_drops_windows_overlapping_a_red_flag_span(self):
        # short enough to pass the duration filter, but inside a red flag
        stops = [{"in_s": 500.0, "out_s": 530.0}]
        spans = [{"code": "5", "start": 400.0, "end": 900.0}]
        assert usable_stops(stops, spans) == []

    def test_a_green_flag_span_is_not_a_reason_to_drop(self):
        stops = [{"in_s": 500.0, "out_s": 530.0}]
        spans = [{"code": "1", "start": 400.0, "end": 900.0}]
        assert len(usable_stops(stops, spans)) == 1

    def test_drops_zero_and_negative_durations(self):
        assert usable_stops([{"in_s": 10.0, "out_s": 10.0}]) == []
        assert usable_stops([{"in_s": 10.0, "out_s": 5.0}]) == []


class TestStationaryBox:
    def test_finds_the_stop_and_its_duration(self):
        # Realistic pit-lane speeds: the limit is 80 km/h, which is ~220
        # FastF1 units/s. Approaching at a tenth of that would itself read as
        # stationary, so the fixture has to move at a plausible pace.
        approach = np.linspace(0, 4400, 20)          # 80 km/h for 2 s
        park = np.full(9, 4400.0)                    # stopped, ~4 s
        leave = np.linspace(4400, 8800, 20)
        px = np.concatenate([approach, park, leave])
        py = np.concatenate([np.linspace(0, 200, 20), np.full(9, 200.0),
                             np.linspace(200, 0, 20)])
        t = np.linspace(0, 12, len(px))
        x, y, secs = stationary_box(px, py, t)
        assert x == pytest.approx(4400.0, abs=30.0)
        assert y == pytest.approx(200.0, abs=5.0)
        assert secs > 2.0

    def test_the_box_is_the_stop_not_the_approach(self):
        # The whole point: the centroid must land where the car STOOD, not
        # somewhere along the way in.
        px = np.concatenate([np.linspace(0, 5000, 25), np.full(10, 5000.0)])
        py = np.zeros(len(px))
        t = np.linspace(0, 10, len(px))
        x, _, _ = stationary_box(px, py, t)
        assert x == pytest.approx(5000.0, abs=50.0)

    def test_a_car_that_never_stops_returns_none(self):
        t = np.arange(0, 10, 0.5)
        px = np.linspace(0, 4000, len(t))
        assert stationary_box(px, np.zeros(len(t)), t) is None

    def test_too_few_samples_returns_none(self):
        assert stationary_box([1.0, 2.0], [1.0, 2.0], [0.0, 1.0]) is None


class TestAnchorEnds:
    """
    The fix for a bug that put the drawn pit lane 58 m from the track at BOTH
    ends — a loop floating beside the circuit instead of branching off it.
    """

    def test_both_ends_land_on_the_racing_line(self):
        path = np.column_stack([np.linspace(20, 60, 10), np.full(10, 15.0)])
        out = anchor_ends(path, LINE)
        _, _, d = nearest_on_line(out[:, 0], out[:, 1], LINE)
        assert d[0] == pytest.approx(0.0, abs=0.01)
        assert d[-1] == pytest.approx(0.0, abs=0.01)

    def test_the_original_path_is_preserved_in_the_middle(self):
        path = np.column_stack([np.linspace(20, 60, 10), np.full(10, 15.0)])
        out = anchor_ends(path, LINE, ramp=6)
        assert np.allclose(out[6:16], path)

    def test_offsets_ramp_smoothly_to_zero(self):
        # A step from 0 straight to full offset would draw a kink at pit entry.
        path = np.column_stack([np.linspace(20, 60, 10), np.full(10, 15.0)])
        out = anchor_ends(path, LINE, ramp=6)
        _, _, d = nearest_on_line(out[:, 0], out[:, 1], LINE)
        head = d[:7]
        assert np.all(np.diff(head) >= -0.01)        # monotone rise
        assert head[-1] == pytest.approx(15.0, abs=0.1)

    def test_anchored_then_amplified_keeps_the_ends_attached(self):
        # The property that actually matters on screen.
        path = np.column_stack([np.linspace(20, 60, 10), np.full(10, 15.0)])
        out = anchor_ends(path, LINE)
        ax, ay = amplify_offset(out[:, 0], out[:, 1], LINE, d_ref=15.0)
        _, _, d = nearest_on_line(ax, ay, LINE)
        assert d[0] == pytest.approx(0.0, abs=0.01)
        assert d[-1] == pytest.approx(0.0, abs=0.01)
        assert d.max() == pytest.approx(60.0, abs=1.0)   # middle still x4

    def test_degenerate_path_is_returned_unchanged(self):
        assert anchor_ends(np.array([[1.0, 1.0]]), LINE).shape == (1, 2)
