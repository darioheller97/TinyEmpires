import React, { CSSProperties } from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_GREEN, BUTTON_RED, BUTTON_DISABLED } from './skin';

export interface LobbyPlayer {
  id: string; name: string; colorHex: string; colorIndex: number; ready: boolean; isHost: boolean;
}
export interface LobbyView {
  matchCode: string;
  players: LobbyPlayer[];
  mySessionId: string | null;
}

interface Props {
  lobby: LobbyView;
  onSelectColor: (index: number) => void;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

// Must match server PLAYER_COLORS order.
const COLORS = [
  { hex: '#4488ff', name: 'Blue' },
  { hex: '#ff4444', name: 'Red' },
  { hex: '#ffd700', name: 'Yellow' },
  { hex: '#aa44ff', name: 'Purple' },
];

const OVERLAY: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'radial-gradient(circle at 50% 35%, #3a6e4a 0%, #244a31 70%, #1b3724 100%)',
};
const CARD: CSSProperties = { ...PANEL, width: 440, padding: '14px 28px 24px', textAlign: 'center' };

export default function Lobby({ lobby, onSelectColor, onToggleReady, onStart, onLeave }: Props) {
  const me = lobby.players.find(p => p.id === lobby.mySessionId);
  const isHost = !!me?.isHost;
  const allReady = lobby.players.filter(p => !p.isHost).every(p => p.ready);
  const takenBy = (idx: number) => lobby.players.find(p => p.colorIndex === idx && p.id !== lobby.mySessionId);

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={RIBBON}>Lobby</div>

        <div style={{ margin: '10px 0 4px', fontSize: 13, color: '#4a3417' }}>Room code — share to invite</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6, color: '#4a3417' }}>{lobby.matchCode}</span>
          <button style={{ ...BUTTON, fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(lobby.matchCode)}>Copy</button>
        </div>

        {/* Player list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 14px' }}>
          {lobby.players.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
              background: '#efe3c8', border: '2px solid #6b4f2e', borderRadius: 6,
            }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: p.colorHex, border: '2px solid #4a3417' }} />
              <span style={{ flex: 1, textAlign: 'left', color: '#4a3417', fontWeight: 700 }}>
                {p.name}{p.id === lobby.mySessionId ? ' (you)' : ''}{p.isHost ? ' 👑' : ''}
              </span>
              <span style={{ color: p.ready ? '#2e7d32' : '#a06a2c', fontWeight: 700, fontSize: 13 }}>
                {p.ready ? 'Ready' : 'Not ready'}
              </span>
            </div>
          ))}
        </div>

        {/* Colour picker */}
        <div style={{ fontSize: 13, color: '#4a3417', marginBottom: 4 }}>Your colour</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
          {COLORS.map((c, i) => {
            const taken = takenBy(i);
            const mine = me?.colorIndex === i;
            return (
              <button key={i} disabled={!!taken} onClick={() => onSelectColor(i)} title={taken ? `${c.name} (taken)` : c.name}
                style={{
                  width: 40, height: 40, borderRadius: 8, background: c.hex,
                  border: mine ? '4px solid #fff' : '3px solid #4a3417',
                  opacity: taken ? 0.35 : 1, cursor: taken ? 'not-allowed' : 'pointer',
                  boxShadow: mine ? '0 0 0 2px #4a3417' : 'none',
                }} />
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={{ ...(me?.ready ? BUTTON_GREEN : BUTTON), fontSize: 16 }} onClick={onToggleReady}>
            {me?.ready ? '✓ Ready' : 'Ready up'}
          </button>
          {isHost && (
            <button style={{ ...(allReady ? BUTTON_GREEN : BUTTON_DISABLED), fontSize: 17 }}
              disabled={!allReady} onClick={onStart}>
              Start Match
            </button>
          )}
          {!isHost && <div style={{ fontSize: 13, color: '#4a3417' }}>Waiting for the host to start…</div>}
          <button style={{ ...BUTTON_RED, fontSize: 13 }} onClick={onLeave}>Leave</button>
        </div>
      </div>
    </div>
  );
}
