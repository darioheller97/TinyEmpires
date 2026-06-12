import React from 'react';

interface Props {
  mapWidth: number;
  mapHeight: number;
}

const MINIMAP_W = 180;
const MINIMAP_H = 180;

const CONTAINER: React.CSSProperties = {
  width: MINIMAP_W,
  height: MINIMAP_H,
  background: 'rgba(0, 0, 0, 0.7)',
  border: '2px solid #8b6914',
  borderRadius: '6px',
  overflow: 'hidden',
  position: 'relative',
};

const CANVAS_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  imageRendering: 'pixelated',
};

export default function Minimap({ mapWidth, mapHeight }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = MINIMAP_W / mapWidth;
    const scaleY = MINIMAP_H / mapHeight;

    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    // Background
    ctx.fillStyle = '#1a3a14';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    // City A
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(300 * scaleX - 3, 400 * scaleY - 3, 6, 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = '6px monospace';
    ctx.fillText('A', 300 * scaleX + 4, 400 * scaleY + 3);

    // City B
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(1300 * scaleX - 3, 400 * scaleY - 3, 6, 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = '6px monospace';
    ctx.fillText('B', 1300 * scaleX + 4, 400 * scaleY + 3);

    // Intersection
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(800 * scaleX - 2, 400 * scaleY - 2, 4, 4);

    // Roads
    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(300 * scaleX, 400 * scaleY);
    ctx.lineTo(800 * scaleX, 400 * scaleY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(800 * scaleX, 400 * scaleY);
    ctx.lineTo(1300 * scaleX, 400 * scaleY);
    ctx.stroke();
  }, [mapWidth, mapHeight]);

  return (
    <div style={CONTAINER}>
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={CANVAS_STYLE}
      />
    </div>
  );
}
