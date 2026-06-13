import React, { useState, CSSProperties } from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_GREEN } from './skin';
import { MatchSettings } from '../network/GameClient';

interface Props {
  onCreate: (settings: MatchSettings) => void;
  onSolo: (settings: MatchSettings) => void;
  onJoin: (code: string) => void;
  error?: string;
  busy?: boolean;
}

const OVERLAY: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'radial-gradient(circle at 50% 35%, #3a6e4a 0%, #244a31 70%, #1b3724 100%)',
};
const CARD: CSSProperties = { ...PANEL, width: 460, padding: '14px 30px 26px', textAlign: 'center' };
const TITLE: CSSProperties = {
  fontFamily: '"Trebuchet MS", Verdana, sans-serif', fontWeight: 800, fontSize: 40, color: '#fff',
  textShadow: '0 3px 0 rgba(0,0,0,0.5)', margin: '6px 0 22px', letterSpacing: 1,
};
const STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' };
const BTN: CSSProperties = { ...BUTTON, fontSize: 17, minHeight: 30 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0' };
const SEG_WRAP: CSSProperties = { display: 'flex', gap: 4 };
const LABEL: CSSProperties = { fontSize: 14, color: '#4a3417', fontWeight: 700 };

function Segmented<T extends string | number>(
  { value, options, onChange }: { value: T; options: { label: string; val: T }[]; onChange: (v: T) => void },
) {
  return (
    <div style={SEG_WRAP}>
      {options.map(o => (
        <button
          key={String(o.val)}
          onClick={() => onChange(o.val)}
          style={{
            border: '2px solid #6b4f2e', background: o.val === value ? '#caa46a' : '#efe3c8',
            color: '#4a3417', fontWeight: 700, fontSize: 12, padding: '4px 8px', cursor: 'pointer',
            borderRadius: 4, imageRendering: 'pixelated',
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

const DEFAULTS: MatchSettings = { mapSize: 'medium', npcCount: 2, npcAggro: 1, npcPower: 1, aiLevel: 'normal' };

function SettingsForm({ settings, set }: { settings: MatchSettings; set: (s: MatchSettings) => void }) {
  return (
    <div style={{ textAlign: 'left', margin: '6px 0 16px' }}>
      <div style={ROW}>
        <span style={LABEL}>Map size</span>
        <Segmented value={settings.mapSize!} onChange={v => set({ ...settings, mapSize: v })}
          options={[{ label: 'Small', val: 'small' }, { label: 'Medium', val: 'medium' }, { label: 'Large', val: 'large' }]} />
      </div>
      <div style={ROW}>
        <span style={LABEL}>NPC camps</span>
        <Segmented value={settings.npcCount!} onChange={v => set({ ...settings, npcCount: v })}
          options={[0, 1, 2, 3, 4].map(n => ({ label: String(n), val: n }))} />
      </div>
      <div style={ROW}>
        <span style={LABEL}>NPC aggression</span>
        <Segmented value={settings.npcAggro!} onChange={v => set({ ...settings, npcAggro: v })}
          options={[{ label: 'Calm', val: 0.5 }, { label: 'Normal', val: 1 }, { label: 'Fierce', val: 2 }]} />
      </div>
      <div style={ROW}>
        <span style={LABEL}>NPC power</span>
        <Segmented value={settings.npcPower!} onChange={v => set({ ...settings, npcPower: v })}
          options={[{ label: 'Weak', val: 0.6 }, { label: 'Normal', val: 1 }, { label: 'Brutal', val: 1.6 }]} />
      </div>
      <div style={ROW}>
        <span style={LABEL}>Rival AI</span>
        <Segmented value={settings.aiLevel!} onChange={v => set({ ...settings, aiLevel: v })}
          options={[{ label: 'Easy', val: 'easy' }, { label: 'Normal', val: 'normal' }, { label: 'Hard', val: 'hard' }]} />
      </div>
    </div>
  );
}

export default function MainMenu({ onCreate, onSolo, onJoin, error, busy }: Props) {
  const [view, setView] = useState<'home' | 'create' | 'solo' | 'join'>('home');
  const [settings, setSettings] = useState<MatchSettings>(DEFAULTS);
  const [code, setCode] = useState('');

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={RIBBON}>Tiny Empires</div>
        {view === 'home' && (
          <>
            <div style={TITLE}>Road to Conquest</div>
            <div style={STACK}>
              <button style={BTN} onClick={() => setView('create')} disabled={busy}>Create Game</button>
              <button style={BTN} onClick={() => setView('join')} disabled={busy}>Join Game</button>
              <button style={BTN} onClick={() => setView('solo')} disabled={busy}>Solo vs NPC</button>
            </div>
          </>
        )}

        {(view === 'create' || view === 'solo') && (
          <>
            <div style={{ ...TITLE, fontSize: 26, margin: '14px 0 8px' }}>
              {view === 'create' ? 'New Lobby' : 'Solo vs NPC'}
            </div>
            <SettingsForm settings={settings} set={setSettings} />
            <div style={STACK}>
              <button style={{ ...BUTTON_GREEN, fontSize: 17 }} disabled={busy}
                onClick={() => view === 'create' ? onCreate(settings) : onSolo(settings)}>
                {view === 'create' ? 'Create Lobby' : 'Start'}
              </button>
              <button style={BTN} onClick={() => setView('home')} disabled={busy}>Back</button>
            </div>
          </>
        )}

        {view === 'join' && (
          <>
            <div style={{ ...TITLE, fontSize: 26, margin: '14px 0 12px' }}>Join by Code</div>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 5))}
              placeholder="CODE"
              style={{
                fontSize: 28, letterSpacing: 6, textAlign: 'center', width: '70%', padding: '8px',
                fontWeight: 800, color: '#4a3417', border: '3px solid #6b4f2e', borderRadius: 6,
                background: '#efe3c8', textTransform: 'uppercase',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && code.length >= 4) onJoin(code); }}
            />
            {error && <div style={{ color: '#b5302a', fontWeight: 700, marginTop: 10 }}>{error}</div>}
            <div style={{ ...STACK, marginTop: 16 }}>
              <button style={{ ...BUTTON_GREEN, fontSize: 17 }} disabled={busy || code.length < 4}
                onClick={() => onJoin(code)}>Join</button>
              <button style={BTN} onClick={() => { setView('home'); setCode(''); }} disabled={busy}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
