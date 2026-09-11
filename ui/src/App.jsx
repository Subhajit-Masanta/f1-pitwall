import { useCallback, useEffect, useState } from 'react';
import { useIsNarrow } from './hooks/useResponsive';
import { ChevronLeft } from 'lucide-react';

import Landing from './components/Landing';
import RaceSelector from './components/RaceSelector';
import TrackMap from './components/TrackMap';
import RaceResults from './components/RaceResults';
import FpsMeter from './components/FpsMeter';
import { F1, MAXW } from './theme';
import { useRoute, navigate, buildPath, MODE_LABEL } from './lib/router';

const DEFAULT_YEAR = 2026;

/**
 * The URL is the single source of truth for mode / year / round, so every view
 * is linkable and the browser's back button does the obvious thing. Nothing is
 * mirrored into state — the route IS the state.
 */
function App() {
  const route = useRoute();
  const narrow = useIsNarrow(720);

  const { mode, round, a, b } = route;
  const year = route.year || DEFAULT_YEAR;

  // Display-only: what the round in the URL is actually called. Never routes.
  const [raceInfo, setRaceInfo] = useState(null);

  // A mode without a year is incomplete; fill it in so the URL is always
  // shareable in the exact form the app reads back.
  useEffect(() => {
    if (mode && !route.year) {
      navigate(buildPath({ mode, year: DEFAULT_YEAR }), { replace: true });
    }
  }, [mode, route.year]);

  const go = useCallback((next) => {
    navigate(buildPath({ mode, year, round, a, b, ...next }));
  }, [mode, year, round, a, b]);

  const leave = () => navigate('/');

  return (
    <div style={{ background: F1.bg, minHeight: '100vh', color: F1.text }}>
     <div style={{
      maxWidth: MAXW, margin: '0 auto',
      padding: narrow ? '20px 16px 56px' : '32px 40px 72px',
     }}>
      {import.meta.env.DEV && <FpsMeter />}

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={{ width: 4, height: 20, background: F1.red }} />
        <h1 style={{
          margin: 0, fontSize: narrow ? 17 : 19, fontWeight: 700, letterSpacing: 2,
          textTransform: 'uppercase', cursor: mode ? 'pointer' : 'default',
        }} onClick={mode ? leave : undefined}>
          Pitwall
        </h1>
        {mode && (
          <>
            <span style={{ color: F1.faint }}>/</span>
            <span style={{ fontSize: 12, color: F1.dim, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              {MODE_LABEL[mode]}
            </span>
            <button onClick={leave} style={backBtn}>
              <ChevronLeft size={13} /> MODES
            </button>
          </>
        )}
      </header>

      {!mode && <Landing onPick={(id) => navigate(buildPath({ mode: id, year: DEFAULT_YEAR }))} />}

      {mode && (
        <>
          <RaceSelector
            year={year}
            round={round}
            onYearChange={(y) => go({ year: y, round: null, a: null, b: null })}
            onSelectRound={(r) => go({ round: r, a: null, b: null })}
            onRaceResolved={setRaceInfo}
          />

          {!round && (
            <div style={{
              marginTop: 18, border: `1px solid ${F1.line}`, padding: '56px 24px',
              textAlign: 'center', fontSize: 13, color: F1.dim, letterSpacing: 1.5,
            }}>
              SELECT A GRAND PRIX
            </div>
          )}

          {round && (mode === 'lap' || mode === 'compare') && (
            <div style={{ marginTop: 18 }}>
              <TrackMap
                // Changing the reference driver changes which lap everything is
                // measured against, so the stage is rebuilt rather than patched.
                key={`${mode}-${year}-${round}-${a || 'fastest'}`}
                year={year}
                round={round}
                session="Q"
                mode={mode}
                raceName={raceInfo?.name}
                referenceDriver={mode === 'compare' ? a : null}
                compareWith={mode === 'compare' ? b : null}
                onPickDriver={(slot, v) => go({ [slot]: v })}
              />
            </div>
          )}

          {round && mode === 'race' && (
            <div style={{ marginTop: 18 }}>
              <RaceResults year={year} round={round} raceName={raceInfo?.name} />
            </div>
          )}
        </>
      )}
     </div>
    </div>
  );
}

const backBtn = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
  background: 'transparent', border: `1px solid ${F1.line}`, color: F1.dim,
  padding: '7px 13px', cursor: 'pointer',
  fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
};

export default App;
