import { useState } from 'react';
import { useIsNarrow } from './hooks/useResponsive';
import { ChevronLeft } from 'lucide-react';

import Landing from './components/Landing';
import RaceSelector from './components/RaceSelector';
import TrackMap from './components/TrackMap';
import RaceResults from './components/RaceResults';
import FpsMeter from './components/FpsMeter';
import { F1, MAXW } from './theme';

const MODE_LABEL = {
  quali: 'Fastest Qualifying Lap',
  race: 'Full Race',
};

function App() {
  const [mode, setMode] = useState(null);          // null | 'quali' | 'race'
  const [selectedRace, setSelectedRace] = useState(null);
  const [year, setYear] = useState(2026);
  const narrow = useIsNarrow(720);

  const leave = () => { setMode(null); setSelectedRace(null); };

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

      {!mode && <Landing onPick={setMode} />}

      {mode && (
        <>
          <RaceSelector onSelectRace={setSelectedRace} onYearChange={setYear} year={year} />

          {!selectedRace && (
            <div style={{
              marginTop: 18, border: `1px solid ${F1.line}`, padding: '56px 24px',
              textAlign: 'center', fontSize: 13, color: F1.dim, letterSpacing: 1.5,
            }}>
              SELECT A GRAND PRIX
            </div>
          )}

          {selectedRace && mode === 'quali' && (
            <div style={{ marginTop: 18 }}>
              <TrackMap
                year={year}
                round={selectedRace.round}
                session="Q"
                raceName={selectedRace.name}
              />
            </div>
          )}

          {selectedRace && mode === 'race' && (
            <div style={{ marginTop: 18 }}>
              <RaceResults
                year={year}
                round={selectedRace.round}
                raceName={selectedRace.name}
              />
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
