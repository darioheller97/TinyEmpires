import React, { CSSProperties } from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_GREEN, BUTTON_DISABLED } from './skin';

interface Props {
  visible: boolean;
  count: number;
  hpPct: number;
  order: string;        // '' push | 'hold' | 'fallback'
  rallyReadyIn: number; // seconds until Rally is usable (0 = ready)
  onOrder: (command: string) => void;
  onRally: () => void;
}

const WRAP: CSSProperties = { ...PANEL, minWidth: 232, fontSize: 12 };
const ROW: CSSProperties = { display: 'flex', gap: 4, marginBottom: 4 };
const STANCES: { cmd: string; label: string; icon: string; tip: string }[] = [
  { cmd: '', label: 'Push', icon: '⚔', tip: 'Advance down the lane (default) — key 1' },
  { cmd: 'hold', label: 'Hold', icon: '🛡', tip: 'Brace in place: stop and take less damage — key 2' },
  { cmd: 'fallback', label: 'Fall Back', icon: '↩', tip: 'Retreat toward your nearest city — key 3' },
];

export default function ArmyOrders({ visible, count, hpPct, order, rallyReadyIn, onOrder, onRally }: Props) {
  if (!visible) return null;
  const rallyReady = rallyReadyIn <= 0;
  return (
    <div style={WRAP}>
      <div style={{ ...RIBBON, fontSize: 13 }}>Army · {count} unit{count === 1 ? '' : 's'}</div>
      <div style={{ fontSize: 10, opacity: 0.85, margin: '0 2px 6px' }}>
        Avg health {hpPct}% · pick a stance for this lane
      </div>
      <div style={ROW}>
        {STANCES.map(s => {
          const active = order === s.cmd;
          return (
            <button
              key={s.cmd || 'push'}
              style={{ ...(active ? BUTTON_GREEN : BUTTON), flex: 1, fontSize: 11, padding: '5px 2px' }}
              title={s.tip}
              onClick={() => onOrder(s.cmd)}
            >
              {s.icon} {s.label}
            </button>
          );
        })}
      </div>
      <button
        style={{ ...(rallyReady ? BUTTON_GREEN : BUTTON_DISABLED), width: '100%', fontSize: 12, marginTop: 2 }}
        disabled={!rallyReady}
        title="Rally: +25% damage & a heal to this army for a few beats (key R)"
        onClick={onRally}
      >
        {rallyReady ? '✊ Rally! (R)' : `✊ Rally — ${rallyReadyIn}s`}
      </button>
    </div>
  );
}
