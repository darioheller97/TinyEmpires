import React, { CSSProperties, useState } from 'react';
import { PANEL, RIBBON, BUTTON } from './skin';
import { getVolumes, setMusicVolume, setSfxVolume, setBeatVolume } from '../game/audio';

interface Props {
  visible: boolean;
  onHowToPlay: () => void;
  onClose: () => void;
}

const OVERLAY: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.45)', pointerEvents: 'auto', zIndex: 62,
};
const CARD: CSSProperties = { ...PANEL, width: 320, padding: '12px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, color: '#4a3417', fontSize: 13 };
const LABEL: CSSProperties = { width: 96, fontWeight: 700 };
const RANGE: CSSProperties = { flex: 1, accentColor: '#7a5a2a' };
const VAL: CSSProperties = { width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={ROW}>
      <span style={LABEL}>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} style={RANGE}
        onChange={e => onChange(parseFloat(e.target.value))} />
      <span style={VAL}>{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function SettingsMenu({ visible, onHowToPlay, onClose }: Props) {
  const init = getVolumes();
  const [music, setMusic] = useState(init.music);
  const [sfx, setSfx] = useState(init.sfx);
  const [beat, setBeat] = useState(init.beat);
  if (!visible) return null;
  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={{ ...RIBBON, fontSize: 15, minWidth: 130 }}>Settings</div>
        <div style={{ fontSize: 12, color: '#4a3417', fontWeight: 700, margin: '2px 0 -2px' }}>Volume</div>
        <Slider label="Music" value={music} onChange={v => { setMusic(v); setMusicVolume(v); }} />
        <Slider label="Effects" value={sfx} onChange={v => { setSfx(v); setSfxVolume(v); }} />
        <Slider label="Beat" value={beat} onChange={v => { setBeat(v); setBeatVolume(v); }} />
        <button style={{ ...BUTTON, width: '100%', fontSize: 14, marginTop: 4 }} onClick={onHowToPlay}>How to Play</button>
        <button style={{ ...BUTTON, width: '100%', fontSize: 14 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
