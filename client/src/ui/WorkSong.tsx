import React, { useEffect, useRef, useState, CSSProperties } from 'react';
import { playSfx, cameraPunch } from '../game/audio';

// "Work Song" — a little Guitar-Hero/osu!-style minigame. While it's open the
// player keeps a WASD combo going to speed up ALL their villagers' movement and
// gathering, from +1% up to +20% with the combo. It's endless and gets faster
// as the combo climbs; one miss resets the combo (and the boost) to 1.
interface Props {
  visible: boolean;
  onClose: () => void;
  onBoost: (pct: number) => void; // called with the live boost % (0 when closed)
}

const LANES = ['w', 'a', 's', 'd'] as const;
const LANE_COLORS = ['#5cc2ff', '#7ad17a', '#ffd54a', '#ff7a8a'];
const CW = 260, CH = 380, HIT_Y = CH - 64, HIT_WINDOW = 30;

interface Note { lane: number; y: number; dead?: boolean; }

const comboBoost = (combo: number) => Math.min(20, Math.max(1, combo));

export default function WorkSong({ visible, onClose, onBoost }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRef = useRef<(lane: number) => void>(() => {});
  const [combo, setCombo] = useState(1);
  const [lastHit, setLastHit] = useState<{ label: string; color: string; n: number }>({ label: '', color: '#fff', n: 0 });
  const flashRef = useRef<number[]>([0, 0, 0, 0]); // per-lane hit-flash timers

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const S = { notes: [] as Note[], lastSpawn: 0, combo: 1, raf: 0, running: true };
    setCombo(1); setLastHit({ label: '', color: '#fff', n: 0 });
    onBoost(1); // opening the song gives the minimum boost

    const apply = () => { setCombo(S.combo); onBoost(comboBoost(S.combo)); };
    const miss = () => { if (S.combo > 1) playSfx('building_destroyed', { volume: 0.3, throttleMs: 60, throttleKey: 'work' }); S.combo = 1; setLastHit({ label: 'MISS', color: '#ff6a5a', n: Date.now() }); apply(); };
    const hitLane = (lane: number) => {
      // the lowest note in this lane that's within the hit window
      let best: Note | null = null;
      for (const n of S.notes) { if (n.dead || n.lane !== lane) continue; if (Math.abs(n.y - HIT_Y) <= HIT_WINDOW + 14 && (!best || n.y > best.y)) best = n; }
      if (best) {
        best.dead = true; S.combo++;
        flashRef.current[lane] = Date.now();
        const perfect = Math.abs(best.y - HIT_Y) <= HIT_WINDOW * 0.5;
        setLastHit({ label: perfect ? 'PERFECT' : 'GOOD', color: perfect ? '#7ad17a' : '#ffe07a', n: Date.now() });
        // A pluck that climbs the scale as the combo grows — the higher you go,
        // the higher the note. Every 10th hit lands a chime + a light screenshake.
        playSfx('bow_shot', { volume: 0.36, rate: 0.8 + Math.min(S.combo, 24) * 0.05, throttleMs: 15, throttleKey: 'work' });
        if (S.combo % 10 === 0) { playSfx('coins_gold', { volume: 0.45 }); cameraPunch(0.006, 200); }
        apply();
      } else { miss(); }
    };

    let last = performance.now();
    const loop = (t: number) => {
      if (!S.running) return;
      const dt = Math.min(50, t - last); last = t;
      const lvl = Math.min(20, S.combo);
      const spawnInt = Math.max(430, 900 - (lvl - 1) * 26);      // faster spawns at higher combo
      const speed = 0.16 + (lvl - 1) * 0.011;                    // px/ms, faster at higher combo
      S.lastSpawn += dt;
      if (S.lastSpawn >= spawnInt) { S.lastSpawn = 0; S.notes.push({ lane: Math.floor(Math.random() * 4), y: -18 }); }
      for (const n of S.notes) if (!n.dead) n.y += speed * dt;
      // a note slipping past the hit line is a miss
      let slipped = false;
      for (const n of S.notes) if (!n.dead && n.y > HIT_Y + HIT_WINDOW + 14) { n.dead = true; slipped = true; }
      if (slipped) miss();
      S.notes = S.notes.filter(n => !n.dead && n.y < CH + 24);

      // ── draw ──
      ctx.clearRect(0, 0, CW, CH);
      const laneW = CW / 4;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.10)';
        ctx.fillRect(i * laneW, 0, laneW, CH);
        // hit pad
        const flash = Math.max(0, 1 - (Date.now() - flashRef.current[i]) / 160);
        ctx.fillStyle = `rgba(255,233,168,${0.12 + flash * 0.55})`;
        ctx.fillRect(i * laneW + 4, HIT_Y - HIT_WINDOW, laneW - 8, HIT_WINDOW * 2);
        ctx.strokeStyle = 'rgba(255,233,168,0.6)'; ctx.lineWidth = 2;
        ctx.strokeRect(i * laneW + 4, HIT_Y - HIT_WINDOW, laneW - 8, HIT_WINDOW * 2);
        // key letter
        ctx.fillStyle = '#fff7e0'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
        ctx.fillText(LANES[i].toUpperCase(), i * laneW + laneW / 2, HIT_Y + 6);
      }
      for (const n of S.notes) {
        if (n.dead) continue;
        const x = n.lane * laneW + 8, w = laneW - 16;
        ctx.fillStyle = LANE_COLORS[n.lane];
        ctx.beginPath(); (ctx as any).roundRect(x, n.y - 12, w, 24, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
      }
      S.raf = requestAnimationFrame(loop);
    };

    const onKey = (e: KeyboardEvent) => {
      const li = LANES.indexOf(e.key.toLowerCase() as any);
      if (li < 0) return;
      e.preventDefault();
      hitLane(li);
    };
    window.addEventListener('keydown', onKey);
    S.raf = requestAnimationFrame(loop);
    hitRef.current = hitLane; // expose for canvas taps (touch)
    return () => { S.running = false; cancelAnimationFrame(S.raf); window.removeEventListener('keydown', onKey); onBoost(0); };
  }, [visible]);

  if (!visible) return null;
  const boost = comboBoost(combo);
  const tapCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const lane = Math.max(0, Math.min(3, Math.floor(((e.clientX - rect.left) / rect.width) * 4)));
    hitRef.current(lane);
  };
  return (
    <div style={WRAP}>
      <div style={CARD}>
        <div style={HEADER}>
          <span style={{ color: '#ffe9a8', fontWeight: 800 }}>Combo ×{combo}</span>
          <span style={{ color: '#9be57a', fontWeight: 800 }}>Villagers +{boost}%</span>
          <button style={CLOSE} onClick={onClose} title="Done">✕</button>
        </div>
        <div style={{ position: 'relative' }}>
          <canvas ref={canvasRef} width={CW} height={CH} style={CANVAS} onPointerDown={tapCanvas} />
          {lastHit.label && (
            <div key={lastHit.n} style={{ ...JUDGE, color: lastHit.color }}>{lastHit.label}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Floating, semi-transparent so the player can still watch the battlefield.
const WRAP: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', pointerEvents: 'none', zIndex: 64,
};
const CARD: CSSProperties = {
  pointerEvents: 'auto', width: CW + 16, padding: 8, borderRadius: 10,
  background: 'rgba(16,22,33,0.62)', border: '1px solid rgba(255,233,168,0.35)',
  display: 'flex', flexDirection: 'column', gap: 6,
};
const HEADER: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontFamily: 'monospace', padding: '0 4px' };
const CLOSE: CSSProperties = { background: 'none', border: 'none', color: '#fff', fontSize: 16, fontWeight: 800, lineHeight: 1, padding: '0 2px', textShadow: '0 1px 2px #000' };
const CANVAS: CSSProperties = { borderRadius: 8, background: 'rgba(18,26,38,0.5)', border: '1px solid rgba(255,233,168,0.25)', display: 'block', imageRendering: 'pixelated' };
const JUDGE: CSSProperties = { position: 'absolute', top: 8, left: 0, right: 0, textAlign: 'center', fontFamily: 'monospace', fontWeight: 800, fontSize: 20, textShadow: '0 2px 3px #000', pointerEvents: 'none' };
