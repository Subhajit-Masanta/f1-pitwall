import api from './api';

export const raceService = {
    /** Race calendar for a season. */
    getCalendar: async (year) => (await api.get(`/races/${year}`)).data,

    /** The weekend's replayable sessions, in running order, with short codes. */
    getSessions: async (year, round) => (await api.get(`/sessions/${year}/${round}`)).data,

    /** Classification for a session — defaults to the race. */
    getResults: async (year, round, session = 'R') =>
        (await api.get(`/results/${year}/${round}`, { params: { session } })).data,

    /** Track outline + rotation + DRS zones + corners. */
    getTrackData: async (year, round, session) =>
        (await api.get(`/track/${year}/${round}/${session}`)).data,

    /** Everyone who set a lap, ordered by their fastest — the head-to-head picker. */
    getDrivers: async (year, round, session) =>
        (await api.get(`/drivers/${year}/${round}/${session}`)).data,

    /** Lap telemetry. Pass 'fastest' to get whoever set the quickest lap. */
    getTelemetry: async (year, round, session, driverId = 'fastest') =>
        (await api.get(`/telemetry/${year}/${round}/${session}/${driverId}`)).data,

    /**
     * A whole race: every car's position at 2 Hz, the running order, tyre
     * stints, pit stops, the SC/VSC/red-flag timeline and weather.
     * ~1.2 MB gzipped, so this is one request and then everything is local.
     */
    getRace: async (year, round, session = 'R') =>
        (await api.get(`/race/${year}/${round}/${session}`)).data,

    /** Is the backend awake? */
    checkHealth: async () => (await api.get('/')).data,
};
