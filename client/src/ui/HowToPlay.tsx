import React, { CSSProperties } from 'react';
import { PANEL, RIBBON, BUTTON_GREEN } from './skin';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const OVERLAY: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)', pointerEvents: 'auto', zIndex: 60,
};
const CARD: CSSProperties = { ...PANEL, width: 460, maxWidth: '92vw', padding: '14px 26px 22px' };
const ROW: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '11px 2px', fontSize: 14, lineHeight: 1.35 };
const ICON: CSSProperties = { fontSize: 20, width: 26, textAlign: 'center', flexShrink: 0 };

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🏰', title: 'Win by conquest', body: 'Capture every rival fortress. Lose your last fort and your empire falls.' },
  { icon: '⚔️', title: 'Train & march', body: 'Click a Barracks, Archery or Church to train troops — they auto-march your roads on the beat.' },
  { icon: '➡️', title: 'Steer at crossroads', body: 'Right-click a road, or click a crossroads sign, to aim your army down a lane toward an enemy fort.' },
  { icon: '✊', title: 'Counters matter', body: 'Knights beat Archers · Archers beat Lancers · Lancers beat Knights. Scout, then compose to counter.' },
  { icon: '🪙', title: 'Grow your economy', body: 'Hire villagers from your castle to gather wood, food and gold. Spend gold on tech (top-left) and keep upgrades.' },
];

export default function HowToPlay({ visible, onClose }: Props) {
  if (!visible) return null;
  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={{ ...RIBBON, fontSize: 16, minWidth: 160 }}>How to Play</div>
        <div style={{ color: '#4a3417' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={ROW}>
              <span style={ICON}>{s.icon}</span>
              <span><b>{s.title}.</b> {s.body}</span>
            </div>
          ))}
        </div>
        <button style={{ ...BUTTON_GREEN, fontSize: 16, width: '100%', marginTop: 8 }} onClick={onClose}>
          Got it — to battle!
        </button>
      </div>
    </div>
  );
}
