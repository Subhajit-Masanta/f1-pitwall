import { useState } from 'react';
import { useIsNarrow } from './hooks/useResponsive';
import { ChevronLeft } from 'lucide-react';

import Landing from './components/Landing';
import RaceSelector from './components/RaceSelector';
import TrackMap from './components/TrackMap';
import RaceResults from './components/RaceResults';
import FpsMeter from './components/FpsMeter';
import { F1 } from './theme';

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
    <div style={{
      background: F1.bg, minHeight: '100vh', color: F1.text,
      padding: narrow ? '18px 14px 48px' : '26px 30px 60px',
    }}>
      {import.meta.env.DEV && <FpsMeter />}

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 4, height: 20, background: F1.red }} />
        <h1 style={{
          margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: 3,
          textTransform: 'uppercase', cursor: mode ? 'pointer' : 'default',
        }} onClick={mode ? leave : undefined}>
          Pitwall
        </h1>
        {mode && (
          <>
            <span style={{ color: F1.faint }}>/</span>
            <span style={{ fontSize: 11, color: F1.dim, letterSpacing: 2, textTransform: 'uppercase' }}>
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
              marginTop: 14, border: `1px solid ${F1.line}`, padding: '48px 22px',
              textAlign: 'center', fontSize: 12, color: F1.dim, letterSpacing: 2,
            }}>
              SELECT A GRAND PRIX
            </div>
          )}

          {selectedRace && mode === 'quali' && (
            <div style={{ marginTop: 14 }}>
              <TrackMap
                year={year}
                round={selectedRace.round}
                session="Q"
                raceName={selectedRace.name}
              />
            </div>
          )}

          {selectedRace && mode === 'race' && (
            <div style={{ marginTop: 14 }}>
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
  );
}

const backBtn = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
  background: 'transparent', border: `1px solid ${F1.line}`, color: F1.dim,
  padding: '6px 12px', cursor: 'pointer',
  fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
};

export default App;
