import React from 'react';
import { GameEvent } from '../game/GameScene';

export type FeedItem = GameEvent & { ts: number };

interface Props {
  items: FeedItem[];
}

// Toast stack of recent game events (raids, captures, level-ups, research),
// centred near the top under the resource bar. Purely informational — clicks
// pass through to the game.
const WRAP: React.CSSProperties = {
  position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
  pointerEvents: 'none', zIndex: 20,
};

const PILL_BASE: React.CSSProperties = {
  background: 'rgba(31, 22, 11, 0.86)',
  color: '#f4e9d2',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: 13,
  padding: '6px 14px',
  borderRadius: 7,
  borderLeft: '4px solid #ffd54a',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
  textShadow: '0 1px 0 rgba(0,0,0,0.6)',
  animation: 'feedIn 220ms ease-out',
};

export default function EventFeed({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div style={WRAP}>
      <style>{`@keyframes feedIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {items.map(it => (
        <div key={it.id} style={{ ...PILL_BASE, borderLeftColor: it.color || '#ffd54a' }}>
          {it.text}
        </div>
      ))}
    </div>
  );
}
