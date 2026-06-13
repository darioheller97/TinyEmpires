import React from 'react';
import { MinimapData } from '../game/GameScene';

export interface MinimapPing {
  id: number; x: number; y: number; color: string; ts: number;
}

interface Props {
  data: MinimapData | null;
  pings?: MinimapPing[];
  onNavigate: (x: number, y: number) => void;
}

const PING_MS = 2500;

const MINIMAP_W = 180;
const MINIMAP_H = 110;

const CONTAINER: React.CSSProperties = {
  width: MINIMAP_W,
  height: MINIMAP_H,
  background: 'rgba(0, 0, 0, 0.7)',
  border: '2px solid #8b6914',
  borderRadius: '6px',
  overflow: 'hidden',
  position: 'relative',
  cursor: 'pointer',
};

const CANVAS_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  imageRendering: 'pixelated',
};

export default function Minimap({ data, pings, onNavigate }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const pingCanvasRef = React.useRef<HTMLCanvasElement>(null);
  // Offscreen fog buffer at tile resolution, scaled up onto the minimap.
  const fogCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // Keep the latest pings in a ref so the rAF loop sees them without restarting.
  const pingsRef = React.useRef<MinimapPing[]>([]);
  pingsRef.current = pings || [];

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#2a4d6e';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!data) return;

    const scaleX = MINIMAP_W / data.width;
    const scaleY = MINIMAP_H / data.height;
    const fog = data.fog;
    const { cols, rows, tile } = data;
    const fogAt = (x: number, y: number): number => {
      if (!fog || cols === 0) return 2; // no fog yet ⇒ treat as visible
      const c = Math.floor(x / tile), r = Math.floor(y / tile);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return 0;
      return fog[r * cols + c];
    };

    // Curved roads, traced point-to-point; segments touching unexplored ground
    // are skipped so the map only reveals paths you've actually scouted.
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    data.roads.forEach(road => {
      const pts = road.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const fa = fogAt(a.x, a.y), fb = fogAt(b.x, b.y);
        if (fa === 0 || fb === 0) continue; // hidden under fog
        ctx.strokeStyle = (fa === 2 || fb === 2) ? '#b08a55' : '#6b5436'; // bright if in sight
        ctx.beginPath();
        ctx.moveTo(a.x * scaleX, a.y * scaleY);
        ctx.lineTo(b.x * scaleX, b.y * scaleY);
        ctx.stroke();
      }
    });

    data.lairs.forEach(l => {
      if (fogAt(l.x, l.y) === 0) return;
      ctx.fillStyle = l.alive ? (l.type === 'spider' ? '#aa88ff' : '#88cc44') : '#444444';
      ctx.beginPath();
      ctx.arc(l.x * scaleX, l.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    data.cities.forEach(c => {
      if (fogAt(c.x, c.y) === 0) return; // unscouted forts stay hidden
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x * scaleX - 3, c.y * scaleY - 3, 6, 6);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(c.x * scaleX - 3, c.y * scaleY - 3, 6, 6);
    });

    // Contested camps: diamonds coloured by holder; an orange ring while fought over.
    (data.objectives || []).forEach(o => {
      if (fogAt(o.x, o.y) === 0) return;
      const px = o.x * scaleX, py = o.y * scaleY, r = 3.4;
      ctx.beginPath();
      ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py);
      ctx.closePath();
      ctx.fillStyle = o.color;
      ctx.fill();
      ctx.lineWidth = o.contested ? 1.6 : 1;
      ctx.strokeStyle = o.contested ? '#ffa53a' : '#000';
      ctx.stroke();
    });

    // Fog veil: build it at tile resolution offscreen, then stretch over the map.
    // Unexplored = opaque dark, explored-but-unwatched = dim, visible = clear.
    if (fog && cols > 0 && rows > 0) {
      let fc = fogCanvasRef.current;
      if (!fc) { fc = document.createElement('canvas'); fogCanvasRef.current = fc; }
      if (fc.width !== cols || fc.height !== rows) { fc.width = cols; fc.height = rows; }
      const fctx = fc.getContext('2d');
      if (fctx) {
        const img = fctx.createImageData(cols, rows);
        const d = img.data;
        for (let i = 0; i < fog.length; i++) {
          const s = fog[i];
          const o = i * 4;
          d[o] = 8; d[o + 1] = 18; d[o + 2] = 30; // 0x081222 veil tint
          d[o + 3] = s === 0 ? 235 : s === 1 ? 110 : 0;
        }
        fctx.putImageData(img, 0, 0);
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fc, 0, 0, cols, rows, 0, 0, MINIMAP_W, MINIMAP_H);
        ctx.imageSmoothingEnabled = prevSmooth;
      }
    }

    // Camera viewport rectangle, so you can see where you're looking.
    if (data.view) {
      const vx = data.view.x * scaleX, vy = data.view.y * scaleY;
      const vw = data.view.w * scaleX, vh = data.view.h * scaleY;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.max(0.5, vx), Math.max(0.5, vy),
        Math.min(MINIMAP_W - 1, vw), Math.min(MINIMAP_H - 1, vh),
      );
    }
  }, [data]);

  // Animated alert pings: expanding rings on an overlay canvas, driven by rAF so
  // they pulse independently of the throttled map redraw.
  React.useEffect(() => {
    const canvas = pingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
      const now = Date.now();
      const w = data?.width || 0, h = data?.height || 0;
      if (w > 0 && h > 0) {
        for (const p of pingsRef.current) {
          const age = now - p.ts;
          if (age < 0 || age > PING_MS) continue;
          const t = age / PING_MS;
          const px = (p.x / w) * MINIMAP_W, py = (p.y / h) * MINIMAP_H;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 2 + t * 12, 0, Math.PI * 2);
          ctx.stroke();
          // A solid dot at the centre so the location reads even between rings.
          ctx.globalAlpha = 0.9 * (1 - t);
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    onNavigate(mx * data.width, my * data.height);
  };

  return (
    <div style={CONTAINER}>
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={CANVAS_STYLE}
        onClick={handleClick}
      />
      <canvas
        ref={pingCanvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={{ ...CANVAS_STYLE, position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}
