import React, { useState, useCallback, useRef } from 'react';
import PhaserGame from './game/PhaserGame';
import GameScene, { SelectionInfo, MinimapData } from './game/GameScene';
import ResourceBar from './ui/ResourceBar';
import Minimap from './ui/Minimap';
import BuildMenu, { BuildOption } from './ui/BuildMenu';
import InfoPanel from './ui/InfoPanel';
import SpawnPanel from './ui/SpawnPanel';
import TechTreeModal, { TechOption } from './ui/TechTreeModal';
import { BUTTON as SKIN_BUTTON } from './ui/skin';

// Styles
const HUD_WRAPPER: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none',
};
const TOP_MIDDLE: React.CSSProperties = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto',
};
const TOP_RIGHT: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12, pointerEvents: 'auto',
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
  ...SKIN_BUTTON,
  fontSize: '13px',
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
  const [selection, setSelection] = useState<SelectionInfo>({ type: 'none', id: '', name: '' });
  const [buildingCounts, setBuildingCounts] = useState<Map<string, number>>(new Map());
  const [techTreeVisible, setTechTreeVisible] = useState(false);
  const [researchedTechs, setResearchedTechs] = useState<string[]>([]);
  const [minimapData, setMinimapData] = useState<MinimapData | null>(null);
  const sceneRef = useRef<GameScene | null>(null);

  const handleResourceUpdate = useCallback((r: typeof resources) => setResources(r), []);
  const handleSelectionChange = useCallback((s: SelectionInfo) => setSelection(s), []);
  const handleBuildingsUpdate = useCallback((counts: Map<string, number>) => setBuildingCounts(counts), []);
  const handleTechsUpdate = useCallback((techs: string[]) => setResearchedTechs(techs), []);
  const handleMinimapData = useCallback((d: MinimapData) => setMinimapData(d), []);
  const handleSceneReady = useCallback((scene: GameScene) => { sceneRef.current = scene; }, []);
  const handleMapBounds = useCallback(() => {}, []);

  const client = () => sceneRef.current?.getClient() ?? null;

  const handleBuild = useCallback((type: string) => {
    if (selection.type === 'city') client()?.buildStructure(selection.id, type);
  }, [selection]);
  const handleUpgradeTownHall = useCallback(() => {
    if (selection.type === 'city') client()?.upgradeTownHall(selection.id);
  }, [selection]);
  const handleSpawn = useCallback((type: string) => {
    if (selection.type === 'building' && selection.data?.cityId) {
      client()?.spawnTroops(selection.data.cityId, type);
    }
  }, [selection]);
  const handleSetAutoProduce = useCallback((troopType: string) => {
    if (selection.type === 'building') client()?.setAutoProduce(selection.id, troopType);
  }, [selection]);
  const handleResearch = useCallback((techId: string) => {
    client()?.researchTech(techId);
  }, []);
  const handleNavigate = useCallback((x: number, y: number) => {
    sceneRef.current?.centerCamera(x, y);
  }, []);

  const mySessionId = client()?.sessionId ?? null;
  const isOwnCity = selection.type === 'city' && !!selection.data?.ownerId && !!mySessionId
    && selection.data.ownerId === mySessionId;
  const selectionData = selection.data || {};
  const buildingCount = selection.type === 'city' ? (buildingCounts.get(selection.id) || 0) : 0;
  const isBarracksSelected = selection.type === 'building' && selection.name === 'barracks';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <PhaserGame
        onResourceUpdate={handleResourceUpdate}
        onMapBounds={handleMapBounds}
        onSelectionChange={handleSelectionChange}
        onBuildingsUpdate={handleBuildingsUpdate}
        onTechsUpdate={handleTechsUpdate}
        onMinimapData={handleMinimapData}
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
          <Minimap data={minimapData} onNavigate={handleNavigate} />
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
            autoProduceType={isBarracksSelected ? (selectionData.autoProduceType || '') : ''}
            onSpawn={handleSpawn}
            onSetAutoProduce={handleSetAutoProduce}
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
