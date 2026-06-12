import React, { useState, useCallback } from 'react';
import PhaserGame from './game/PhaserGame';
import { SelectionInfo } from './game/GameScene';
import ResourceBar from './ui/ResourceBar';
import Minimap from './ui/Minimap';
import BuildMenu, { BuildOption } from './ui/BuildMenu';
import InfoPanel from './ui/InfoPanel';
import SpawnPanel from './ui/SpawnPanel';
import { GameClient } from './network/GameClient';

// Styles
const HUD_WRAPPER: React.CSSProperties = {
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

const BOTTOM_MIDDLE: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'auto',
};

const BOTTOM_LEFT: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  pointerEvents: 'auto',
};

// Available buildings list
const BUILD_OPTIONS: BuildOption[] = [
  { type: 'lumber_mill', name: 'Lumber Mill', cost: { wood: 30, food: 5, gold: 0 } },
  { type: 'farm', name: 'Farm', cost: { wood: 20, food: 0, gold: 0 } },
  { type: 'gold_mine', name: 'Gold Mine', cost: { wood: 40, food: 10, gold: 0 } },
  { type: 'barracks', name: 'Barracks', cost: { wood: 50, food: 20, gold: 10 } },
  { type: 'defense_tower', name: 'Defense Tower', cost: { wood: 60, food: 15, gold: 20 } },
];

export default function App() {
  const [resources, setResources] = useState({ wood: 100, food: 50, gold: 20, popUsed: 0, popCap: 10 });
  const [mapBounds, setMapBounds] = useState({ width: 1600, height: 800 });
  const [selection, setSelection] = useState<SelectionInfo>({ type: 'none', id: '', name: '' });
  const [buildingCounts, setBuildingCounts] = useState<Map<string, number>>(new Map());
  const [client, setClient] = useState<GameClient | null>(null);

  const handleResourceUpdate = useCallback((r: typeof resources) => setResources(r), []);
  const handleSelectionChange = useCallback((s: SelectionInfo) => setSelection(s), []);
  const handleBuildingsUpdate = useCallback((counts: Map<string, number>) => setBuildingCounts(counts), []);

  const handleSceneReady = useCallback((getClient: () => GameClient | null) => {
    // Poll for client until scene connects
    const check = () => {
      const c = getClient();
      if (c) {
        setClient(c);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  }, []);

  const handleBuild = useCallback((type: string) => {
    client?.buildStructure(type);
  }, [client]);

  const handleUpgradeTownHall = useCallback(() => {
    client?.upgradeTownHall();
  }, [client]);

  const handleSpawn = useCallback((type: string) => {
    client?.spawnTroops(type);
  }, [client]);

  // Determine if build menu should show (only for player-owned cities)
  const isOwnCity = selection.type === 'city' && selection.data?.ownerId && client?.sessionId
    ? selection.data.ownerId === client.sessionId
    : false;
  const selectionData = selection.data || {};

  // Count buildings in the selected city
  const buildingCount = selection.type === 'city' ? (buildingCounts.get(selection.id) || 0) : 0;

  // Spawn panel: visible when barracks is selected
  const isBarracksSelected = selection.type === 'building' && selection.name === 'barracks';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <PhaserGame
        onResourceUpdate={handleResourceUpdate}
        onMapBounds={setMapBounds}
        onSelectionChange={handleSelectionChange}
        onBuildingsUpdate={handleBuildingsUpdate}
        onSceneReady={handleSceneReady}
      />

      <div style={HUD_WRAPPER}>
        <div style={TOP_MIDDLE}>
          <ResourceBar resources={resources} />
        </div>
        <div style={TOP_RIGHT}>
          <Minimap mapWidth={mapBounds.width} mapHeight={mapBounds.height} />
        </div>
        <div style={{ ...BOTTOM_MIDDLE, display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <BuildMenu
            visible={isOwnCity}
            cityName={selection.name}
            townHallLevel={selectionData.townHallLevel || 1}
            buildSlots={selectionData.maxBuildings || 2}
            usedSlots={buildingCount}
            resources={resources}
            buildings={BUILD_OPTIONS}
            onBuild={handleBuild}
            onUpgradeTownHall={handleUpgradeTownHall}
          />
          <SpawnPanel
            visible={isBarracksSelected}
            resources={resources}
            onSpawn={handleSpawn}
          />
        </div>
        <div style={BOTTOM_LEFT}>
          <InfoPanel selection={selection} />
        </div>
      </div>
    </div>
  );
}
