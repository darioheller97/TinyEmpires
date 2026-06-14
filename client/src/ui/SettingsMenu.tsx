import React, { CSSProperties, useState } from 'react';
import { PANEL, RIBBON, BUTTON } from './skin';
import { getVolumes, setMusicVolume, setSfxVolume, setBeatVolume } from '../game/audio';
import { getGfxQuality, setGfxQuality, GfxQuality } from '../game/postfx';

interface Props {
  visible: boolean;
  onHowToPlay: () => void;
  onGraphicsQuality: (q: GfxQuality) => void;
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

const GFX_OPTS: { q: GfxQuality; label: string }[] = [
  { q: 'off', label: 'Off' },
  { q: 'low', label: 'Low' },
  { q: 'high', label: 'High' },
];

function QualityPicker({ value, onChange }: { value: GfxQuality; onChange: (q: GfxQuality) => void }) {
  return (
    <div style={ROW}>
      <span style={LABEL}>Quality</span>
      <div style={{ flex: 1, display: 'flex', gap: 6 }}>
        {GFX_OPTS.map(o => {
          const on = o.q === value;
          return (
            <button key={o.q} onClick={() => onChange(o.q)}
              style={{ ...BUTTON, flex: 1, fontSize: 12, padding: '4px 0',
                background: on ? 'rgb(202,164,106)' : 'rgb(239,227,200)', fontWeight: on ? 700 : 400 }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SettingsMenu({ visible, onHowToPlay, onGraphicsQuality, onClose }: Props) {
  const init = getVolumes();
  const [music, setMusic] = useState(init.music);
  const [sfx, setSfx] = useState(init.sfx);
  const [beat, setBeat] = useState(init.beat);
  const [gfx, setGfx] = useState<GfxQuality>(getGfxQuality());
  if (!visible) return null;
  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={{ ...RIBBON, fontSize: 15, minWidth: 130 }}>Settings</div>
        <div style={{ fontSize: 12, color: '#4a3417', fontWeight: 700, margin: '2px 0 -2px' }}>Volume</div>
        <Slider label="Music" value={music} onChange={v => { setMusic(v); setMusicVolume(v); }} />
        <Slider label="Effects" value={sfx} onChange={v => { setSfx(v); setSfxVolume(v); }} />
        <Slider label="Beat" value={beat} onChange={v => { setBeat(v); setBeatVolume(v); }} />
        <div style={{ fontSize: 12, color: '#4a3417', fontWeight: 700, margin: '4px 0 -2px' }}>Graphics</div>
        <QualityPicker value={gfx} onChange={q => { setGfx(q); setGfxQuality(q); onGraphicsQuality(q); }} />
        <button style={{ ...BUTTON, width: '100%', fontSize: 14, marginTop: 4 }} onClick={onHowToPlay}>How to Play</button>
        <button style={{ ...BUTTON, width: '100%', fontSize: 14 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
