import React from 'react';
import { PANEL, RIBBON } from './skin';

interface Props {
  visible: boolean;
  count: number;
  formation: string;
  onSelect: (type: string) => void;
}

// Each formation gets a tiny dot-diagram so the shape reads at a glance.
// Filled dots = melee (front), hollow dots = ranged/support (back).
interface Dot { x: number; y: number; ranged?: boolean }
const DIAGRAMS: Record<string, Dot[]> = {
  box: [
    { x: 8, y: 8 }, { x: 18, y: 8 }, { x: 8, y: 18 }, { x: 18, y: 18 },
  ],
  line: [
    { x: 5, y: 13 }, { x: 11, y: 13 }, { x: 17, y: 13 }, { x: 23, y: 13 },
  ],
  wedge: [
    { x: 13, y: 5 }, { x: 8, y: 13 }, { x: 18, y: 13 }, { x: 4, y: 21, ranged: true }, { x: 13, y: 21, ranged: true }, { x: 22, y: 21, ranged: true },
  ],
  vanguard: [
    { x: 6, y: 8 }, { x: 13, y: 8 }, { x: 20, y: 8 },
    { x: 6, y: 18, ranged: true }, { x: 13, y: 18, ranged: true }, { x: 20, y: 18, ranged: true },
  ],
};

const FORMATIONS: { type: string; name: string }[] = [
  { type: 'box', name: 'Square' },
  { type: 'line', name: 'Line' },
  { type: 'wedge', name: 'Wedge' },
  { type: 'vanguard', name: 'Vanguard' },
];

function Diagram({ type }: { type: string }) {
  const dots = DIAGRAMS[type] || [];
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" style={{ display: 'block' }}>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x} cy={d.y} r={3}
          fill={d.ranged ? 'none' : '#3a2a16'}
          stroke="#3a2a16"
          strokeWidth={1.4}
        />
      ))}
    </svg>
  );
}

const CELL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  width: 58, padding: '6px 4px', cursor: 'pointer',
  border: '2px solid transparent', borderRadius: 6, background: 'transparent',
};

export default function FormationMenu({ visible, count, formation, onSelect }: Props) {
  if (!visible || count < 2) return null;
  return (
    <div style={{ ...PANEL, width: 252, padding: '2px 8px 8px' }}>
      <div style={RIBBON}>Formation — {count} selected</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginTop: 4 }}>
        {FORMATIONS.map(f => {
          const active = f.type === formation;
          return (
            <button
              key={f.type}
              style={{
                ...CELL,
                borderColor: active ? '#caa46a' : 'transparent',
                background: active ? 'rgba(202,164,106,0.28)' : 'transparent',
              }}
              onClick={() => onSelect(f.type)}
              title={f.name}
            >
              <Diagram type={f.type} />
              <span style={{ fontSize: 11, color: '#3a2a16' }}>{f.name}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, opacity: 0.7, textAlign: 'center', marginTop: 4, color: '#3a2a16' }}>
        Melee hold the front · archers fall back · press F to cycle
      </div>
    </div>
  );
}
