import React, { useState, useCallback } from 'react';
import PhaserGame from './game/PhaserGame';
import { SelectionInfo } from './game/GameScene';
import ResourceBar from './ui/ResourceBar';
import Minimap from './ui/Minimap';
import BuildMenu, { BuildOption } from './ui/BuildMenu';
import InfoPanel from './ui/InfoPanel';
import SpawnPanel from './ui/SpawnPanel';
import TechTreeModal, { TechOption } from './ui/TechTreeModal';
import { GameClient } from './network/GameClient';

// Styles
const HUD_WRAPPER: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none',
};
const TOP_MIDDLE: React.CSSProperties = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto',
};
const TOP_RIGHT: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12, width: 180, height: 180, pointerEvents: 'auto',
};
const TOP_LEFT: React.CSSProperties = {
  position: 'absolute', top: 12, left: 12, pointerEvents: 'auto',
};
const BOTTOM_MIDDLE: React.CSSProperties = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto',
};
const BOTTOM_LEFT: React.CSSProperties = {
  position: 'absolute', bottom: 16, left: 16, pointerEvents: 'auto',
};

const TECH_BTN: React.CSSProperties = {
  background: 'rgba(0,0,0,0.7)', border: '2px solid #8b6914', borderRadius: '6px',
  color: '#ffd700', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace',
  fontSize: '11px',
};

const BUILD_OPTIONS: BuildOption[] = [
  { type: 'lumber_mill', name: 'Lumber Mill', cost: { wood: 30, food: 5, gold: 0 } },
  { type: 'farm', name: 'Farm', cost: { wood: 20, food: 0, gold: 0 } },
  { type: 'gold_mine', name: 'Gold Mine', cost: { wood: 40, food: 10, gold: 0 } },
  { type: 'barracks', name: 'Barracks', cost: { wood: 50, food: 20, gold: 10 } },
  { type: 'defense_tower', name: 'Defense Tower', cost: { wood: 60, food: 15, gold: 20 } },
];

const TECH_OPTIONS: TechOption[] = [
  { id: 'dmg_knight', name: 'Knight Training', desc: '+25% Knight damage', cost: 50, category: 'unit' },
  { id: 'dmg_lancer', name: 'Lancer Training', desc: '+25% Lancer damage', cost: 50, category: 'unit' },
  { id: 'dmg_archer', name: 'Archer Training', desc: '+25% Archer damage', cost: 50, category: 'unit' },
  { id: 'hp_all', name: 'Veteran Armor', desc: '+20% all unit HP', cost: 80, category: 'unit' },
  { id: 'speed', name: 'Paved Roads', desc: '+20% move speed', cost: 60, category: 'unit' },
  { id: 'prod_wood', name: 'Iron Axes', desc: '+50% wood production', cost: 40, category: 'economy' },
  { id: 'prod_food', name: 'Crop Rotation', desc: '+50% food production', cost: 40, category: 'economy' },
  { id: 'prod_gold', name: 'Deep Mining', desc: '+50% gold production', cost: 40, category: 'economy' },
  { id: 'town_hall_discount', name: 'Royal Charter', desc: 'Town hall upgrades cost 30% less', cost: 100, category: 'economy' },
];

export default function App() {
  const [resources, setResources] = useState({ wood: 100, food: 50, gold: 20, popUsed: 0, popCap: 10 });
  const [mapBounds, setMapBounds] = useState({ width: 1600, height: 800 });
  const [selection, setSelection] = useState<SelectionInfo>({ type: 'none', id: '', name: '' });
  const [buildingCounts, setBuildingCounts] = useState<Map<string, number>>(new Map());
  const [client, setClient] = useState<GameClient | null>(null);
  const [techTreeVisible, setTechTreeVisible] = useState(false);
  const [researchedTechs, setResearchedTechs] = useState<string[]>([]);

  const handleResourceUpdate = useCallback((r: typeof resources) => setResources(r), []);
  const handleSelectionChange = useCallback((s: SelectionInfo) => setSelection(s), []);
  const handleBuildingsUpdate = useCallback((counts: Map<string, number>) => setBuildingCounts(counts), []);

  const handleSceneReady = useCallback((getClient: () => GameClient | null) => {
    const check = () => { const c = getClient(); if (c) setClient(c); else setTimeout(check, 500); };
    check();
  }, []);

  // Expose researched techs from the Phaser scene's registry
  const handleResearchedUpdate = useCallback((techs: string[]) => setResearchedTechs(techs), []);

  const handleBuild = useCallback((type: string) => client?.buildStructure(type), [client]);
  const handleUpgradeTownHall = useCallback(() => client?.upgradeTownHall(), [client]);
  const handleSpawn = useCallback((type: string) => client?.spawnTroops(type), [client]);
  const handleResearch = useCallback((techId: string) => {
    client?.researchTech(techId);
    // Optimistic update
    if (!researchedTechs.includes(techId)) {
      setResearchedTechs(prev => [...prev, techId]);
    }
  }, [client, researchedTechs]);

  const isOwnCity = selection.type === 'city' && selection.data?.ownerId && client?.sessionId
    ? selection.data.ownerId === client.sessionId : false;
  const selectionData = selection.data || {};
  const buildingCount = selection.type === 'city' ? (buildingCounts.get(selection.id) || 0) : 0;
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
        <div style={TOP_LEFT}>
          <button style={TECH_BTN} onClick={() => setTechTreeVisible(true)}>
            📜 Tech Tree
          </button>
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

      <TechTreeModal
        visible={techTreeVisible}
        researched={researchedTechs}
        gold={resources.gold}
        techs={TECH_OPTIONS}
        onResearch={handleResearch}
        onClose={() => setTechTreeVisible(false)}
      />
    </div>
  );
}
