import React from 'react';
import { MinimapData } from '../game/GameScene';

interface Props {
  data: MinimapData | null;
  onNavigate: (x: number, y: number) => void;
}

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

export default function Minimap({ data, onNavigate }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1a3a14';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!data) return;

    const scaleX = MINIMAP_W / data.width;
    const scaleY = MINIMAP_H / data.height;

    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 2;
    data.roads.forEach(r => {
      ctx.beginPath();
      ctx.moveTo(r.x1 * scaleX, r.y1 * scaleY);
      ctx.lineTo(r.x2 * scaleX, r.y2 * scaleY);
      ctx.stroke();
    });

    data.lairs.forEach(l => {
      ctx.fillStyle = l.alive ? (l.type === 'spider' ? '#aa88ff' : '#88cc44') : '#444444';
      ctx.beginPath();
      ctx.arc(l.x * scaleX, l.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    data.cities.forEach(c => {
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x * scaleX - 3, c.y * scaleY - 3, 6, 6);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(c.x * scaleX - 3, c.y * scaleY - 3, 6, 6);
    });
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
    </div>
  );
}
