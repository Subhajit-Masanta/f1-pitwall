"""
Which races a season is allowed to offer.

The rule is a date comparison, so it is testable without FastF1, a network or
a season — which matters, because the alternative is waiting for a real race
weekend to find out it is wrong.
"""
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from services.session_data import has_run, RACE_SETTLE

NOW = datetime(2026, 9, 26, 12, 0, 0)


def ts(*args, tz=None):
    """A schedule timestamp, the way pandas hands one over."""
    return pd.Timestamp(datetime(*args), tz=tz)


class TestHasRun:
    def test_a_race_from_last_month_has_run(self):
        assert has_run(ts(2026, 8, 30, 13, 0), ts(2026, 8, 30), NOW)

    def test_a_race_next_month_has_not(self):
        assert not has_run(ts(2026, 10, 18, 13, 0), ts(2026, 10, 18), NOW)

    def test_a_race_being_run_right_now_has_not(self):
        # The lights went out ninety minutes ago. There is nothing to replay
        # until it is over, and the timing data is not there either.
        assert not has_run(ts(2026, 9, 26, 10, 30), ts(2026, 9, 26), NOW)

    def test_it_waits_for_the_race_to_finish_not_to_start(self):
        start = NOW - RACE_SETTLE
        assert has_run(pd.Timestamp(start), ts(2026, 9, 26), NOW)
        assert not has_run(pd.Timestamp(start + timedelta(minutes=1)),
                           ts(2026, 9, 26), NOW)

    def test_this_morning_stays_available_all_day(self):
        # Finished hours ago; hiding it until tomorrow would be worse than
        # showing it.
        assert has_run(ts(2026, 9, 26, 6, 0), ts(2026, 9, 26), NOW)


class TestFallback:
    def test_falls_back_to_the_event_day_when_there_is_no_session_time(self):
        # Older seasons do not always carry Session5DateUtc.
        assert has_run(None, ts(2026, 9, 20), NOW)
        assert not has_run(None, ts(2026, 10, 4), NOW)

    def test_the_event_day_runs_to_the_END_of_that_day(self):
        # EventDate carries no time, so the race could be any hour of it.
        assert not has_run(None, ts(2026, 9, 26), NOW)
        assert has_run(None, ts(2026, 9, 25), NOW)

    def test_a_missing_session_time_is_NaT_not_just_None(self):
        assert has_run(pd.NaT, ts(2026, 9, 20), NOW)
        assert not has_run(pd.NaT, ts(2026, 10, 4), NOW)

    def test_no_dates_at_all_shows_the_race(self):
        # A missing timestamp is not evidence that a race has not happened.
        assert has_run(None, None, NOW)
        assert has_run(pd.NaT, pd.NaT, NOW)


class TestTimezones:
    def test_an_aware_timestamp_is_compared_in_utc(self):
        # Las Vegas starts Saturday night local, which is Sunday in UTC. Read
        # naively, an aware timestamp can land on the wrong side of the line.
        aware = pd.Timestamp(datetime(2026, 9, 26, 4, 0), tz=timezone.utc)
        assert has_run(aware, ts(2026, 9, 26), NOW)

        soon = pd.Timestamp(datetime(2026, 9, 26, 11, 0), tz=timezone.utc)
        assert not has_run(soon, ts(2026, 9, 26), NOW)

    def test_the_same_instant_decides_the_same_way_in_any_zone(self):
        utc = pd.Timestamp(datetime(2026, 9, 26, 4, 0), tz=timezone.utc)
        east = utc.tz_convert(timezone(timedelta(hours=9)))
        assert has_run(utc, None, NOW) == has_run(east, None, NOW)


@pytest.mark.parametrize("ahead_hours,expected", [(-4, True), (-2, False), (24, False)])
def test_the_boundary_holds_either_side(ahead_hours, expected):
    start = pd.Timestamp(NOW + timedelta(hours=ahead_hours))
    assert has_run(start, None, NOW) is expected
