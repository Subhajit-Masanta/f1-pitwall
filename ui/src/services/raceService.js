import api from './api';

export const raceService = {
    /** Race calendar for a season. */
    getCalendar: async (year) => (await api.get(`/races/${year}`)).data,

    /** Which sessions a race weekend had (FP1…Race). */
    getSessions: async (year, round) => (await api.get(`/sessions/${year}/${round}`)).data,

    /** Classification for a session — defaults to the race. */
    getResults: async (year, round, session = 'R') =>
        (await api.get(`/results/${year}/${round}`, { params: { session } })).data,

    /** Track outline + rotation + DRS zones + corners. */
    getTrackData: async (year, round, session) =>
        (await api.get(`/track/${year}/${round}/${session}`)).data,

    /** Lap telemetry. Pass 'fastest' to get whoever set the quickest lap. */
    getTelemetry: async (year, round, session, driverId = 'fastest') =>
        (await api.get(`/telemetry/${year}/${round}/${session}/${driverId}`)).data,

    /** Is the backend awake? */
    checkHealth: async () => (await api.get('/')).data,
};
