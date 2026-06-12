import React, { useRef, useEffect, useState } from 'react';
import PhaserGame from './game/PhaserGame';
import ResourceBar from './ui/ResourceBar';
import Minimap from './ui/Minimap';

const HUD_STYLES: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

const TOP_MIDDLE: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'auto',
};

const TOP_RIGHT: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 180,
  height: 180,
  pointerEvents: 'auto',
};

export default function App() {
  const [resources, setResources] = useState({ wood: 100, food: 50, gold: 20, popUsed: 0, popCap: 10 });
  const [mapBounds, setMapBounds] = useState({ width: 1600, height: 800 });

  const handleResourceUpdate = (r: typeof resources) => setResources(r);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <PhaserGame onResourceUpdate={handleResourceUpdate} onMapBounds={setMapBounds} />

      <div style={HUD_STYLES}>
        <div style={TOP_MIDDLE}>
          <ResourceBar resources={resources} />
        </div>
        <div style={TOP_RIGHT}>
          <Minimap mapWidth={mapBounds.width} mapHeight={mapBounds.height} />
        </div>
      </div>
    </div>
  );
}
