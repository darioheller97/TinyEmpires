import React, { useState, useCallback, useRef, useEffect } from 'react';
import PhaserGame from './game/PhaserGame';
import GameScene, { SelectionInfo, MinimapData } from './game/GameScene';
import ResourceBar from './ui/ResourceBar';
import Minimap from './ui/Minimap';
import BuildMenu, { BuildOption } from './ui/BuildMenu';
import InfoPanel from './ui/InfoPanel';
import SpawnPanel from './ui/SpawnPanel';
import TechTreeModal, { TechOption } from './ui/TechTreeModal';
import MainMenu from './ui/MainMenu';
import Lobby, { LobbyView, LobbyPlayer } from './ui/Lobby';
import EndScreen from './ui/EndScreen';
import { PANEL as SKIN_PANEL } from './ui/skin';
import { GameClient, MatchSettings } from './network/GameClient';
import { playSfx, toggleMute } from './game/audio';

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
const BOTTOM_RIGHT: React.CSSProperties = {
  position: 'absolute', bottom: 16, right: 16, pointerEvents: 'auto',
};

// A bare clickable icon — no button panel behind it, just the pack art.
const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  width: 40, height: 40, imageRendering: 'pixelated', lineHeight: 0,
  filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.5))',
};

const BUILD_OPTIONS: BuildOption[] = [
  { type: 'house', name: 'House (+5 pop)', cost: { wood: 25, food: 10, gold: 0 } },
  { type: 'barracks', name: 'Barracks', cost: { wood: 50, food: 20, gold: 10 } },
  { type: 'archery', name: 'Archery', cost: { wood: 50, food: 15, gold: 15 } },
  { type: 'church', name: 'Church', cost: { wood: 45, food: 25, gold: 20 } },
  { type: 'defense_tower', name: 'Defense Tower', cost: { wood: 60, food: 15, gold: 20 } },
];

const PRODUCER_TYPES = ['barracks', 'archery', 'church'];

const TECH_OPTIONS: TechOption[] = [
  { id: 'dmg_knight', name: 'Knight Training', desc: '+25% Knight damage', cost: 50, category: 'unit' },
  { id: 'dmg_lancer', name: 'Lancer Training', desc: '+25% Lancer damage', cost: 50, category: 'unit' },
  { id: 'dmg_archer', name: 'Archer Training', desc: '+25% Archer damage', cost: 50, category: 'unit' },
  { id: 'hp_all', name: 'Veteran Armor', desc: '+20% all unit HP', cost: 80, category: 'unit' },
  { id: 'speed', name: 'Paved Roads', desc: '+25% villager speed', cost: 60, category: 'economy' },
  { id: 'prod_wood', name: 'Iron Axes', desc: '+50% wood production', cost: 40, category: 'economy' },
  { id: 'prod_food', name: 'Crop Rotation', desc: '+50% food production', cost: 40, category: 'economy' },
  { id: 'prod_gold', name: 'Deep Mining', desc: '+50% gold production', cost: 40, category: 'economy' },
  { id: 'town_hall_discount', name: 'Royal Charter', desc: 'Town hall upgrades cost 30% less', cost: 100, category: 'economy' },
];

type AppPhase = 'menu' | 'lobby' | 'game';

export default function App() {
  // ── Lifecycle / connection ──
  const [appPhase, setAppPhase] = useState<AppPhase>('menu');
  const [roomPhase, setRoomPhase] = useState<string>('');
  const [winnerId, setWinnerId] = useState<string>('');
  const [lobbyView, setLobbyView] = useState<LobbyView | null>(null);
  const [menuError, setMenuError] = useState('');
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<GameClient | null>(null);

  // ── Game HUD state ──
  const [resources, setResources] = useState({ wood: 100, food: 50, gold: 20, popUsed: 0, popCap: 10 });
  const [selection, setSelection] = useState<SelectionInfo>({ type: 'none', id: '', name: '' });
  const [buildingCounts, setBuildingCounts] = useState<Map<string, number>>(new Map());
  const [techTreeVisible, setTechTreeVisible] = useState(false);
  const [researchedTechs, setResearchedTechs] = useState<string[]>([]);
  const [minimapData, setMinimapData] = useState<MinimapData | null>(null);
  const [muted, setMuted] = useState(false);
  const sceneRef = useRef<GameScene | null>(null);
  const prevGold = useRef(20);

  // Single state subscriber: drives lobby view + phase transitions.
  const handleState = useCallback((state: any) => {
    const sid = clientRef.current?.sessionId ?? null;
    const players: LobbyPlayer[] = [];
    state.players?.forEach((p: any) => players.push({
      id: p.id, name: p.name, colorHex: p.colorHex, colorIndex: p.colorIndex, ready: p.ready, isHost: p.isHost,
    }));
    setLobbyView({ matchCode: state.matchCode, players, mySessionId: sid });
    setRoomPhase(state.phase);
    setWinnerId(state.winnerId || '');
  }, []);

  // Map the server phase onto the app phase.
  useEffect(() => {
    if (!clientRef.current) return;
    if (roomPhase === 'lobby') setAppPhase('lobby');
    else if (roomPhase === 'active' || roomPhase === 'finished') setAppPhase('game');
  }, [roomPhase]);

  const backToMenu = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    sceneRef.current = null;
    setAppPhase('menu'); setRoomPhase(''); setWinnerId(''); setLobbyView(null);
    setSelection({ type: 'none', id: '', name: '' });
  }, []);

  const startClient = useCallback(async (fn: (c: GameClient) => Promise<unknown>) => {
    setBusy(true); setMenuError('');
    const c = new GameClient();
    clientRef.current = c;
    c.onStateChange(handleState);
    c.onLeave(() => { if (clientRef.current === c) backToMenu(); });
    try {
      await fn(c);
    } catch (e) {
      console.warn('connect failed', e);
      setMenuError('Could not join — check the code and try again.');
      clientRef.current = null;
      setBusy(false);
      return;
    }
    setBusy(false);
  }, [handleState, backToMenu]);

  const handleCreate = useCallback((s: MatchSettings) => startClient(c => c.createRoom(s)), [startClient]);
  const handleJoin = useCallback((code: string) => startClient(c => c.joinByCode(code)), [startClient]);
  const handleSolo = useCallback((s: MatchSettings) => startClient(c => c.createSolo(s)), [startClient]);

  // ── Game HUD handlers ──
  const handleResourceUpdate = useCallback((r: typeof resources) => {
    if (r.gold > prevGold.current + 4) playSfx('coins_gold', { volume: 0.4, throttleMs: 1000 });
    prevGold.current = r.gold;
    setResources(r);
  }, []);
  const handleSelectionChange = useCallback((s: SelectionInfo) => setSelection(s), []);
  const handleBuildingsUpdate = useCallback((counts: Map<string, number>) => setBuildingCounts(counts), []);
  const handleTechsUpdate = useCallback((techs: string[]) => setResearchedTechs(techs), []);
  const handleMinimapData = useCallback((d: MinimapData) => setMinimapData(d), []);
  const handleSceneReady = useCallback((scene: GameScene) => { sceneRef.current = scene; }, []);
  const handleMapBounds = useCallback(() => {}, []);

  const client = () => clientRef.current;

  const handleBuild = useCallback((type: string) => {
    if (selection.type !== 'city') return;
    if (type === 'defense_tower') { sceneRef.current?.beginTowerPlacement(selection.id); playSfx('ui_click', { volume: 0.4 }); return; }
    client()?.buildStructure(selection.id, type); playSfx('build_place', { volume: 0.55 });
  }, [selection]);
  const handleUpgradeTownHall = useCallback(() => {
    if (selection.type === 'city') { client()?.upgradeTownHall(selection.id); playSfx('build_place', { volume: 0.55 }); }
  }, [selection]);
  const handleSpawn = useCallback((type: string) => {
    if (selection.type === 'building' && selection.data?.cityId) {
      client()?.spawnTroops(selection.data.cityId, type);
      playSfx('unit_recruit', { volume: 0.5 });
    }
  }, [selection]);
  const handleSetAutoProduce = useCallback((troopType: string) => {
    if (selection.type === 'building') { client()?.setAutoProduce(selection.id, troopType); playSfx('ui_click', { volume: 0.4 }); }
  }, [selection]);
  const handleHireVillager = useCallback((resourceType: string) => {
    if (selection.type === 'city') { client()?.spawnVillager(selection.id, resourceType); playSfx('unit_recruit', { volume: 0.5 }); }
  }, [selection]);
  const handleResearch = useCallback((techId: string) => {
    client()?.researchTech(techId); playSfx('build_place', { volume: 0.5 });
  }, []);
  const handleToggleMute = useCallback(() => setMuted(toggleMute()), []);
  const handleRotateRoute = useCallback(() => { sceneRef.current?.rotateIntersectionRoute(); }, []);
  const handleNavigate = useCallback((x: number, y: number) => { sceneRef.current?.centerCamera(x, y); }, []);

  // ── Menu / Lobby screens ──
  if (appPhase === 'menu') {
    return <MainMenu onCreate={handleCreate} onSolo={handleSolo} onJoin={handleJoin} error={menuError} busy={busy} />;
  }
  if (appPhase === 'lobby' && lobbyView) {
    return (
      <Lobby
        lobby={lobbyView}
        onSelectColor={i => clientRef.current?.selectColor(i)}
        onToggleReady={() => {
          const me = lobbyView.players.find(p => p.id === lobbyView.mySessionId);
          clientRef.current?.setReady(!me?.ready);
        }}
        onStart={() => clientRef.current?.startMatch()}
        onLeave={backToMenu}
      />
    );
  }

  // ── Game ──
  const mySessionId = clientRef.current?.sessionId ?? null;
  const isOwnCity = selection.type === 'city' && !!selection.data?.ownerId && !!mySessionId
    && selection.data.ownerId === mySessionId;
  const selectionData = selection.data || {};
  const buildingCount = selection.type === 'city' ? (buildingCounts.get(selection.id) || 0) : 0;
  const isProducerSelected = selection.type === 'building' && PRODUCER_TYPES.includes(selection.name);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <PhaserGame
        client={clientRef.current!}
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
        <div style={{ ...TOP_LEFT, display: 'flex', gap: '8px' }}>
          <button
            style={ICON_BTN}
            onClick={() => { playSfx('ui_click', { volume: 0.4 }); setTechTreeVisible(true); }}
            title="Tech Tree"
          >
            <img src="/assets2/UI/icon_gold.png" alt="Tech Tree" width={40} height={40} style={{ imageRendering: 'pixelated', display: 'block' }} />
          </button>
          <button
            style={{ ...ICON_BTN, opacity: muted ? 0.4 : 1 }}
            onClick={handleToggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            <img src="/assets2/UI/icon_music.png" alt={muted ? 'Unmute' : 'Mute'} width={40} height={40} style={{ imageRendering: 'pixelated', display: 'block' }} />
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
            onHireVillager={handleHireVillager}
          />
          <SpawnPanel
            visible={isProducerSelected}
            producer={isProducerSelected ? selection.name : ''}
            resources={resources}
            autoProduceType={isProducerSelected ? (selectionData.autoProduceType || '') : ''}
            onSpawn={handleSpawn}
            onSetAutoProduce={handleSetAutoProduce}
          />
        </div>
        <div style={BOTTOM_LEFT}>
          <InfoPanel selection={selection} />
        </div>
        {selection.type === 'intersection' && (
          <div style={BOTTOM_RIGHT}>
            <div style={{ ...SKIN_PANEL, width: 168, padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 13 }}>Unit Routing</div>
              <button style={{ ...ICON_BTN, width: 52, height: 52 }} onClick={handleRotateRoute} title="Rotate route (R)">
                <img src="/assets2/UI/icon_arrow.png" alt="route" width={52} height={52} style={{ imageRendering: 'pixelated', display: 'block' }} />
              </button>
              <div style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.25 }}>
                Click or press <b>R</b> to aim troops down a road. No arrow = units spread out.
              </div>
            </div>
          </div>
        )}
      </div>

      <TechTreeModal
        visible={techTreeVisible}
        researched={researchedTechs}
        gold={resources.gold}
        techs={TECH_OPTIONS}
        onResearch={handleResearch}
        onClose={() => setTechTreeVisible(false)}
      />

      {roomPhase === 'finished' && (
        <EndScreen won={winnerId === mySessionId} onBackToMenu={backToMenu} />
      )}
    </div>
  );
}
