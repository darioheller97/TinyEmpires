import React, { CSSProperties } from 'react';
import { PANEL, BUTTON_GREEN } from './skin';
import { playSfx } from '../game/audio';

interface Props {
  won: boolean;
  onBackToMenu: () => void;
}

const OVERLAY: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)', pointerEvents: 'auto', zIndex: 50,
};
const CARD: CSSProperties = { ...PANEL, width: 360, padding: '24px 30px 28px', textAlign: 'center' };

export default function EndScreen({ won, onBackToMenu }: Props) {
  React.useEffect(() => {
    if (won) playSfx('victory', { volume: 0.7 });
    else playSfx('building_destroyed', { volume: 0.55 });
  }, [won]);
  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={{
          fontFamily: '"Trebuchet MS", Verdana, sans-serif', fontWeight: 800, fontSize: 40,
          color: won ? '#2e7d32' : '#b5302a', textShadow: '0 3px 0 rgba(0,0,0,0.35)', margin: '4px 0 18px',
        }}>{won ? 'Victory!' : 'Defeated'}</div>
        <div style={{ color: '#4a3417', fontSize: 15, marginBottom: 20 }}>
          {won ? 'Your empire stands alone.' : 'Your last capital has fallen.'}
        </div>
        <button style={{ ...BUTTON_GREEN, fontSize: 16, width: '100%' }} onClick={onBackToMenu}>Back to Menu</button>
      </div>
    </div>
  );
}
