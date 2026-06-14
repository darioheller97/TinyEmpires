import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';
import { preloadAssets, createAnims, unitSkin, factionOf } from './assets';
import { buildTerrain, TerrainInfo, TILE, WATER, GRASS, ELEV } from './terrain';
import { initAudio, startAmbient, playSfx, setBattleIntensity, resetAmbient } from './audio';

interface NodeInfo { id: string; x: number; y: number; name: string; kind: 'city' | 'intersection' | 'lair'; }
interface RoadData { id: string; fromId: string; toId: string; splinePoints: { x: number; y: number }[]; tilePath: { c: number; r: number }[]; }

// Must stay identical to the server's computeTilePath (GameRoom.ts): rasterizes a
// spline into a 4-connected sequence of 64px tiles, bridging diagonal corners so
// units hop through the corner tile instead of cutting across it.
function computeTilePath(spline: { x: number; y: number }[]): { c: number; r: number }[] {
  const T = 64;
  const cells: { c: number; r: number }[] = [];
  spline.forEach(p => {
    const c = Math.floor(p.x / T), r = Math.floor(p.y / T);
    const last = cells[cells.length - 1];
    if (last && last.c === c && last.r === r) return;
    if (last && last.c !== c && last.r !== r) cells.push({ c, r: last.r });
    cells.push({ c, r });
  });
  return cells;
}

export interface CityData {
  id: string; x: number; y: number; name: string; ownerId: string;
  townHallLevel: number; influenceRadius: number; maxBuildings: number;
  health: number; maxHealth: number;
}
export interface BuildData {
  id: string; cityId: string; type: string; x: number; y: number; level: number;
  health: number; maxHealth: number; autoProduceType: string;
  produceReadyTick?: number; cooldownReadyIn?: number;
  constructing?: boolean; buildProgress?: number;
}
export interface LairData { id: string; x: number; y: number; type: string; health: number; maxHealth: number; }
// A drawn city: its container, live data, and the battlement archers (count
// scales with castle level), tracked so they can be rebuilt on level/owner change.
interface CityEntry {
  gfx: Phaser.GameObjects.Container;
  data: CityData;
  archers: Phaser.GameObjects.Sprite[];
  archerKey: string;
}

export type SelectionType = 'city' | 'intersection' | 'building' | 'resource' | 'army' | 'none';
export interface SelectionInfo {
  type: SelectionType; id: string; name: string; data?: any;
}

// A HUD notification (toast + optional minimap ping) emitted by the scene.
export interface GameEvent {
  id: number; kind: string; text: string;
  x?: number; y?: number; color?: string;
}

export interface MinimapData {
  width: number; height: number;
  // Fog mask: cols*rows bytes (0 unexplored, 1 explored, 2 visible) + grid dims.
  cols: number; rows: number; tile: number;
  fog: Uint8Array | null;
  cities: { x: number; y: number; color: string }[];
  lairs: { x: number; y: number; type: string; alive: boolean }[];
  // Contested camps: drawn as diamonds, coloured by holder (grey = neutral).
  objectives: { x: number; y: number; kind: string; color: string; contested: boolean }[];
  // Full curved road geometry (spline points), so the minimap traces real paths.
  roads: { pts: { x: number; y: number }[] }[];
  // Current camera viewport in world coords, drawn as a rectangle.
  view?: { x: number; y: number; w: number; h: number };
}

const DEPTH_ENTITY = 10; // + y*0.01 for painter's order
const COMBAT_BACK = 11;  // px a fighting unit backs off the clash tile (per side)

// Mirror of the server's counter triangle (attacker type → the type it beats),
// used client-side to emphasise favourable hits with extra juice. Kept in sync
// with RPS_ADVANTAGE in server/src/rooms/schema/UnitNode.ts.
const RPS_ADVANTAGE: Record<string, string> = { knight: 'archer', lancer: 'knight', archer: 'lancer' };

// Rhythm-cast tuning (the Rally ability is cast as an osu!-style beat combo).
const BEAT_PERIOD_MS = 800;       // 75 BPM, matches the march/beat clock
const RHYTHM_NOTES = 4;           // hits per cast
const RHYTHM_APPROACH_MS = 2 * BEAT_PERIOD_MS; // ring appears 2 beats early
const RHYTHM_PERFECT_MS = 95;     // |offset| under this = Perfect
const RHYTHM_GOOD_MS = 190;       // …under this = Good; beyond = Miss

interface UnitVisual {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Container; // pack-art bar (base + red fill)
  base: string;
  anim: string;
}

export default class GameScene extends Phaser.Scene {
  private client: GameClient | null = null;
  private mapBuilt = false;
  private rtsMode = false; // 'Open Field' RTS mode: free movement, real-time combat
  // RTS selection/command state
  private rtsSel = new Set<string>();
  private rtsDragStart: { x: number; y: number } | null = null;
  private rtsSelBox: Phaser.GameObjects.Graphics | null = null;
  private rtsSelRings: Phaser.GameObjects.Graphics | null = null;
  private rtsFormation: 'box' | 'line' = 'box';
  private rtsTrailGfx: Phaser.GameObjects.Graphics | null = null;
  private rtsTrailCount = -1;
  private rtsBuild: { type: string; img: Phaser.GameObjects.Image; ok: boolean } | null = null;
  private mapW = 1920;
  private mapH = 1216;

  private nodes: Map<string, NodeInfo> = new Map();
  private roadsById: Map<string, RoadData> = new Map();

  private cityGfx: Map<string, CityEntry> = new Map();
  private buildingGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: BuildData }> = new Map();
  private lairGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: LairData }> = new Map();
  private objectiveGfx: Map<string, { gfx: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Graphics; banner: Phaser.GameObjects.Container | null; data: { id: string; kind: string; x: number; y: number; ownerId: string; capture: number; contenderId: string; contested: boolean } }> = new Map();
  private unitGfx: Map<string, UnitVisual> = new Map();
  private cityHealthBars: Map<string, Phaser.GameObjects.Container> = new Map();
  private lairHealthBars: Map<string, Phaser.GameObjects.Container> = new Map();
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private selMarker: Phaser.GameObjects.Container | null = null;
  private selMarkerKey = '';
  private glowTarget: Phaser.GameObjects.Container | null = null;
  private glowTween: Phaser.Tweens.Tween | null = null;
  private towerPlace: { cityId: string; cx: number; cy: number; radius: number; ghost: Phaser.GameObjects.Container; tower: Phaser.GameObjects.Image; ring: Phaser.GameObjects.Graphics; highlight: Phaser.GameObjects.Graphics } | null = null;
  private routeArrowGfx: Phaser.GameObjects.Graphics | null = null;

  private selection: SelectionInfo = { type: 'none', id: '', name: '' };
  private cityBuildingCounts: Map<string, number> = new Map();
  private prevUnitHealth: Map<string, number> = new Map();
  private playerColors: Map<string, string> = new Map();
  private beatClock = 0; // running 75 BPM metronome phase (ms), re-anchored to unit hops

  private radialMenu: Phaser.GameObjects.Container | null = null;
  private myRoutes: Map<string, string> = new Map();
  private intersectionArrows: Map<string, Phaser.GameObjects.Image> = new Map();
  private dragMoved = false;

  // Interactive clash: lane army command state.
  private selArmyLaneKey = '';   // sorted from|to key of the selected lane
  private selArmyRoadId = '';    // a representative road id to send to the server
  private armyLaneGfx: Phaser.GameObjects.Graphics | null = null;
  private serverTick = 0;
  private myRallyReadyTick = 0;
  private prevRallyReadyTick = -1; // -1 = not yet initialised from server

  // Rhythm cast (Rally): osu!-style beat combo whose accuracy scales the buff.
  private castActive = false;
  private castLane = '';
  private castNotes: { target: number; judged: boolean; score: number }[] = [];
  private castGfx: Phaser.GameObjects.Container | null = null;
  private castRing: Phaser.GameObjects.Graphics | null = null;
  private castComboText: Phaser.GameObjects.Text | null = null;
  private lastCastPower = 1;

  // Resource nodes (server-driven trees/sheep/gold)
  private resourceGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: any }> = new Map();

  // Terrain + fog of war
  private terrainInfo: TerrainInfo | null = null;
  private fogState: Uint8Array | null = null; // 0 unexplored, 1 explored, 2 visible
  private fogGfx: Phaser.GameObjects.Graphics | null = null;
  private lastFogUpdate = 0;
  private cloudSprites: { sprite: Phaser.GameObjects.Sprite; tile: number }[] = [];
  private minimapRoads: { pts: { x: number; y: number }[] }[] | null = null;
  private dayNight: Phaser.GameObjects.Rectangle | null = null; // slow ambient tint overlay

  // Juice bookkeeping: a startup grace window so the first state sync doesn't pop
  // every existing unit/building; phase + tech diffing for level-up/win flourishes;
  // and a per-area throttle so big melees don't spawn a storm of impact bursts.
  private mapReadyAt = 0;
  private prevPhase = '';
  private myTechs: Set<string> | null = null;
  private lastBurstAt: Map<string, number> = new Map();
  // HUD event feed (toasts + minimap pings) + per-key throttle.
  private eventSeq = 0;
  private lastEventAt: Map<string, number> = new Map();
  private battleArrows: Phaser.GameObjects.Graphics | null = null;

  constructor() { super({ key: 'GameScene' }); }

  preload(): void {
    preloadAssets(this);
  }

  create(): void {
    if (import.meta.env.DEV) (window as any).__scene = this;
    createAnims(this);
    initAudio(this);
    // Stop the looping music when this scene/game tears down, so a new match
    // starts one fresh bed instead of stacking a second song on the old one.
    this.events.once('shutdown', () => resetAmbient());
    this.events.once('destroy', () => resetAmbient());
    // Use the Tiny Swords arrow over the game canvas (Phaser owns the canvas cursor).
    this.input.setDefaultCursor("url('/assets/UI/Pointers/01.png') 10 4, auto");
    this.input.once('pointerdown', () => startAmbient()); // browsers gate audio behind a gesture
    this.selectionRing = this.add.graphics().setDepth(40);
    this.routeArrowGfx = this.add.graphics().setDepth(30);
    this.setupCameraControls();
    // The connection is owned by React (menu/lobby established it); the scene
    // only mounts once a match is active, and receives the room via registry.
    this.client = (this.registry.get('gameClient') as GameClient) ?? null;
    if (this.client) this.client.onStateChange(state => this.syncState(state));
    // Cosmetic combat tick: archers (capital, towers, field units) loose arrows
    // at nearby enemies. Purely visual — the server owns the actual damage.
    this.time.addEvent({ delay: 700, loop: true, callback: () => this.tickArcherFx() });
    // Screen-space overlay for off-screen battle arrows (camera-locked).
    this.battleArrows = this.add.graphics().setScrollFactor(0).setDepth(220);
    this.time.addEvent({ delay: 120, loop: true, callback: () => this.tickBattleArrows() });
    // Swell the battle-music layer with how much fighting is going on.
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.updateBattleMusic() });
    // Slow day/night ambient tint (screen-space, subtle). Sized large so it
    // always covers the viewport regardless of window size.
    this.dayNight = this.add.rectangle(-200, -200, 6000, 6000, 0x0b1834, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(58);
  }

  update(time: number): void {
    // A steady 75 BPM pulse under the music so the track always has a beat.
    // It free-runs at the unit-step interval and gets re-anchored to the real
    // hop below, so when troops march the beat stays the one they move to.
    const BEAT_MS = 800;
    if (this.beatClock === 0) this.beatClock = time;
    while (time - this.beatClock >= BEAT_MS) {
      this.beatClock += BEAT_MS;
      // Open Field is real-time: no marching drum, no beat-locked swings.
      if (!this.rtsMode) {
        playSfx('beat_drum', { volume: 0.7, throttleMs: 400, throttleKey: 'beat' });
        this.swingCombatUnits(); // engaged units strike on the beat, with the drum
      }
    }
    if (this.castActive) this.updateRhythmCast();

    // Gentle day→dusk→night→dawn tint over a ~6-minute cycle. Starts at day.
    if (this.dayNight) {
      const phase = (time % 360000) / 360000;          // 0..1
      const darkness = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0 day → 1 night
      // Cool blue at night, a touch warmer (dusk/dawn) on the way there.
      const colour = darkness > 0.5 ? 0x0b1834 : 0x241a2e;
      this.dayNight.setFillStyle(colour, darkness * 0.3);
    }

    this.unitGfx.forEach(u => {
      const pos = u.container.getData('worldPos') as { x: number; y: number } | undefined;
      if (!pos) return;
      const c = u.container;

      // Villagers (always) and every unit in RTS mode glide smoothly toward
      // their free-roam target — no beat-locked hop.
      if (this.rtsMode || c.getData('isVillager') === true) {
        const dx = pos.x - c.x, dy = pos.y - c.y;
        if (Math.abs(dx) > 0.8) u.sprite.setFlipX(dx < 0);
        c.x += dx * 0.25; c.y += dy * 0.25;
        u.sprite.y = 0;
        c.setDepth(DEPTH_ENTITY + c.y * 0.01);
        return;
      }

      // Road units: the server snaps them tile-to-tile each beat. Instead of
      // chasing the new tile with a quick lerp (which reads as teleporting),
      // glide across the whole gap over the beat and add a little sine hop.
      const hopTo = c.getData('hopTo') as { x: number; y: number } | undefined;
      if (!hopTo || Math.hypot(hopTo.x - pos.x, hopTo.y - pos.y) > 2) {
        // New beat target. Calibrate the hop duration from the real beat interval.
        const last = c.getData('beatAt') as number | undefined;
        const dur = last !== undefined ? Phaser.Math.Clamp(time - last, 220, 900) : 520;
        c.setData('hopFrom', { x: c.x, y: c.y });
        c.setData('hopTo', pos);
        c.setData('hopStart', time);
        c.setData('hopDur', dur);
        c.setData('beatAt', time);
        const ddx = pos.x - c.x;
        if (Math.abs(ddx) > 0.8) u.sprite.setFlipX(ddx < 0);
        const stepping = Math.hypot(ddx, pos.y - c.y) > 4;
        // Remember the march heading so that when the column stops to fight we can
        // hold each rank's facing and pull it back off the clash tile.
        if (stepping) {
          const fl = Math.hypot(ddx, pos.y - c.y) || 1;
          c.setData('faceVec', { x: ddx / fl, y: (pos.y - c.y) / fl });
        }
        // Re-anchor the metronome to this real step so the pulse lands exactly
        // on the beat the troops move to (the constant clock above keeps it
        // going when nothing is marching). Phase-only — the play is up there.
        if (stepping) this.beatClock = time;
        // Kick up a little dust as columns march (some steps, on-screen only).
        if (stepping && Math.random() < 0.26) this.marchPuff(c.x, c.y);
      }
      const from = c.getData('hopFrom') as { x: number; y: number };
      const to = c.getData('hopTo') as { x: number; y: number };
      const dur = c.getData('hopDur') as number;
      const p = Phaser.Math.Clamp((time - (c.getData('hopStart') as number)) / dur, 0, 1);
      const moving = Math.hypot(to.x - from.x, to.y - from.y) > 4;
      // A discrete hop, not a glide: do the whole jump in the first slice of the
      // beat (quick arc to the next tile), then sit still until the next beat —
      // so units pop tile-to-tile on the rhythm instead of drifting up and down.
      const HOP = 0.42;
      const h = Phaser.Math.Clamp(p / HOP, 0, 1);
      const he = h * h * (3 - 2 * h); // ease in/out within the hop so the landing settles
      c.x = from.x + (to.x - from.x) * he;
      c.y = from.y + (to.y - from.y) * he;
      // Rank stagger: shift each unit a little perpendicular to its march so a
      // column reads as 2–3 ranks abreast rather than one overlapping file.
      const ro = (c.getData('rankOff') as number) || 0;
      if (c.getData('fighting') === true) {
        // Stopped to fight: two enemy ranks otherwise land on the same tile and
        // overlap. Hold the last march heading to pull each unit back off the
        // clash point (so the two lines part) and keep its perpendicular rank
        // offset — a readable melee instead of one stacked blob. (`moving` stays
        // true while engaged since it reflects the last hop's span, so this runs
        // in its place rather than gated behind it.)
        const fv = c.getData('faceVec') as { x: number; y: number } | undefined;
        if (fv) {
          c.x += -fv.x * COMBAT_BACK + -fv.y * ro;
          c.y += -fv.y * COMBAT_BACK + fv.x * ro;
        } else {
          c.y += ro; // no heading yet — at least spread the ranks vertically
        }
      } else if (ro && moving) {
        const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy) || 1;
        c.x += (-dy / l) * ro;
        c.y += (dx / l) * ro;
      }
      u.sprite.y = moving ? -12 * Math.sin(h * Math.PI) : 0;
      c.setDepth(DEPTH_ENTITY + c.y * 0.01);
    });

    // RTS is real-time (no beat swing), so engaged archers loose arrows on their
    // own cadence here rather than in swingCombatUnits.
    if (this.rtsMode) this.tickRtsArchers(time);

    // RTS: redraw selection rings under the currently selected units.
    if (this.rtsMode && this.rtsSel.size > 0) {
      this.ensureRtsGfx();
      const g = this.rtsSelRings!; g.clear(); g.lineStyle(2, 0x7CFC00, 0.9);
      this.rtsSel.forEach(id => {
        const u = this.unitGfx.get(id);
        if (!u) { this.rtsSel.delete(id); return; }
        g.strokeEllipse(u.container.x, u.container.y + 8, 30, 18);
      });
    } else if (this.rtsSelRings) {
      this.rtsSelRings.clear();
    }
  }

  // ── Map construction from server state ────────────────────
  private buildMapFromState(state: any): void {
    this.mapW = state.mapWidth || 1920;
    this.mapH = state.mapHeight || 1216;
    this.cameras.main.setBounds(0, 0, this.mapW, this.mapH);

    state.cities.forEach((c: any, id: string) => {
      this.nodes.set(id, { id, x: c.x, y: c.y, name: c.name, kind: 'city' });
    });
    state.intersections.forEach((n: any, id: string) => {
      this.nodes.set(id, { id, x: n.x, y: n.y, name: n.name, kind: 'intersection' });
    });
    state.lairs.forEach((l: any, id: string) => {
      const name = l.type === 'spider' ? 'Spider Cave' : 'Goblin Stump';
      this.nodes.set(id, { id, x: l.x, y: l.y, name, kind: 'lair' });
    });

    const drawnPairs = new Set<string>();
    const physicalSplines: { x: number; y: number }[][] = [];
    const physicalTilePaths: { c: number; r: number }[][] = [];
    state.roads.forEach((r: any, id: string) => {
      const pts = r.splinePoints.map((p: any) => ({ x: p.x, y: p.y }));
      const tilePath = computeTilePath(pts);
      this.roadsById.set(id, { id, fromId: r.fromId, toId: r.toId, splinePoints: pts, tilePath });
      const pairKey = [r.fromId, r.toId].sort().join('|');
      if (!drawnPairs.has(pairKey)) {
        drawnPairs.add(pairKey);
        physicalSplines.push(pts);
        physicalTilePaths.push(tilePath);
      }
    });

    this.terrainInfo = buildTerrain(this, {
      seed: state.mapSeed || 1,
      width: this.mapW,
      height: this.mapH,
      cities: [...state.cities.values()].map((c: any) => ({ x: c.x, y: c.y })),
      lairs: [...state.lairs.values()].map((l: any) => ({ x: l.x, y: l.y })),
      resources: [...state.resources.values()].map((r: any) => ({ x: r.x, y: r.y })),
      roadSplines: physicalSplines,
      roadTilePaths: physicalTilePaths,
      elevations: [...state.elevations].map((e: any) => ({ x: e.x, y: e.y, r: e.r })),
    });
    this.fogState = new Uint8Array(this.terrainInfo.cols * this.terrainInfo.rows);
    this.fogGfx = this.add.graphics().setDepth(60);
    this.buildClouds();

    state.lairs.forEach((l: any, id: string) => {
      this.drawLair({ id, x: l.x, y: l.y, type: l.type, health: l.health, maxHealth: l.maxHealth });
    });
    if (state.objectives) state.objectives.forEach((o: any, id: string) => {
      this.drawObjective({ id, kind: o.kind, x: o.x, y: o.y, ownerId: o.ownerId, capture: o.capture, contenderId: o.contenderId, contested: o.contested });
    });
    state.intersections.forEach((n: any, id: string) => {
      this.drawIntersection(this.nodes.get(id)!);
    });
    state.cities.forEach((c: any, id: string) => {
      this.drawCity({
        id, x: c.x, y: c.y, name: c.name, ownerId: c.ownerId,
        townHallLevel: c.townHallLevel, influenceRadius: c.influenceRadius,
        maxBuildings: c.maxBuildings, health: c.health, maxHealth: c.maxHealth,
      });
    });

    // Center camera on my own city
    const myId = this.client?.sessionId;
    let home: any = null;
    if (myId) state.cities.forEach((c: any) => { if (c.ownerId === myId) home = c; });
    this.cameras.main.centerOn(home ? home.x : this.mapW / 2, home ? home.y : this.mapH / 2);

    const onMapBounds = this.game.registry.get('onMapBounds') as (b: { width: number; height: number }) => void;
    if (onMapBounds) onMapBounds({ width: this.mapW, height: this.mapH });
    this.mapBuilt = true;
    // Grace window: suppress spawn/build pops for the initial flood of existing
    // entities that arrive in the first state sync after the map is built.
    this.mapReadyAt = this.time.now;
  }

  // ── Intersections + routing ───────────────────────────────
  private drawIntersection(node: NodeInfo): void {
    const container = this.add.container(node.x, node.y);
    // A clickable crossway signpost. The arrow points down the road the
    // player has routed troops along (faded & upward when none is set);
    // rotate it with R or the bottom-right control.
    const plate = this.add.circle(0, 0, 21, 0xf4e4c1, 0.97);
    plate.setStrokeStyle(4, 0x6b4f2e, 1);
    const arrow = this.add.image(0, 0, 'icon_arrow').setScale(0.5).setOrigin(0.5);
    const label = this.add.text(0, -32, node.name, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([plate, arrow, label]);
    container.setDepth(DEPTH_ENTITY + node.y * 0.01);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 24), Phaser.Geom.Circle.Contains);
    container.on('pointerup', () => { if (!this.dragMoved) this.onIntersectionClick(node); });
    container.on('pointerover', () => container.setScale(1.18));
    container.on('pointerout', () => container.setScale(1));
    this.intersectionArrows.set(node.id, arrow);
    this.applyRouteArrow(node.id);
  }

  // Point an intersection's signpost arrow down the routed road (bright), or
  // fade it pointing up when no route is set. Art points left by default.
  private applyRouteArrow(nodeId: string): void {
    const arrow = this.intersectionArrows.get(nodeId);
    const node = this.nodes.get(nodeId);
    if (!arrow || !node) return;
    const roadId = this.myRoutes.get(nodeId);
    const dest = roadId ? this.nodes.get(this.roadsById.get(roadId)?.toId ?? '') : undefined;
    if (dest) {
      arrow.setRotation(Math.atan2(dest.y - node.y, dest.x - node.x) + Math.PI);
      arrow.setAlpha(1).clearTint();
    } else {
      arrow.setRotation(Math.PI / 2); // upward (left-pointing art + PI/2)
      arrow.setAlpha(0.7);
    }
  }

  // Cycle the selected crossroad's route through its exits (then "off"),
  // rotating the signpost arrow. Bound to R and the bottom-right control.
  rotateIntersectionRoute(): void {
    if (this.selection.type !== 'intersection') return;
    const nodeId = this.selection.id;
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const outgoing = [...this.roadsById.values()].filter(r => r.fromId === nodeId);
    if (outgoing.length === 0) return;
    outgoing.sort((a, b) => {
      const da = this.nodes.get(a.toId), db = this.nodes.get(b.toId);
      const aa = da ? Math.atan2(da.y - node.y, da.x - node.x) : 0;
      const ab = db ? Math.atan2(db.y - node.y, db.x - node.x) : 0;
      return aa - ab;
    });
    const ids = [...outgoing.map(r => r.id), '']; // '' = clear the route
    const idx = ids.indexOf(this.myRoutes.get(nodeId) ?? '');
    const nextId = ids[(idx + 1) % ids.length];
    if (nextId) this.myRoutes.set(nodeId, nextId); else this.myRoutes.delete(nodeId);
    this.client?.setRoute(nodeId, nextId);
    this.applyRouteArrow(nodeId);
    this.drawRouteArrows();
    playSfx('ui_click', { volume: 0.35 });
  }

  private onIntersectionClick(node: NodeInfo): void {
    this.selectEntity('intersection', node.id, node.name, { x: node.x, y: node.y });
    this.showRadialMenu(node);
  }

  private showRadialMenu(node: NodeInfo): void {
    this.hideRadialMenu();
    const outgoing = [...this.roadsById.values()].filter(r => r.fromId === node.id);
    if (outgoing.length === 0) return;

    const container = this.add.container(node.x, node.y).setDepth(100);
    const bg = this.add.circle(0, 0, 64, 0x000000, 0.55);
    bg.setStrokeStyle(2, 0xffd700, 0.8);
    container.add(bg);

    outgoing.forEach(road => {
      const dest = this.nodes.get(road.toId);
      if (!dest) return;
      const angle = Math.atan2(dest.y - node.y, dest.x - node.x);
      const bx = Math.cos(angle) * 46;
      const by = Math.sin(angle) * 46;
      const isMine = this.myRoutes.get(node.id) === road.id;
      const btn = this.add.circle(bx, by, 15, isMine ? 0x8b6914 : 0x5c4033, 1);
      btn.setStrokeStyle(2, 0xffd700, isMine ? 1 : 0.5);
      btn.setInteractive(new Phaser.Geom.Circle(0, 0, 15), Phaser.Geom.Circle.Contains);
      const short = dest.name.charAt(0);
      const txt = this.add.text(bx, by, short, {
        fontSize: '12px', color: '#ffd700', fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      const nameTag = this.add.text(bx + Math.cos(angle) * 26, by + Math.sin(angle) * 26, dest.name, {
        fontSize: '9px', color: '#ffffff', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5);
      container.add([btn, txt, nameTag]);

      btn.on('pointerup', () => {
        this.client?.setRoute(node.id, road.id);
        this.myRoutes.set(node.id, road.id);
        this.applyRouteArrow(node.id);
        this.drawRouteArrows();
        this.hideRadialMenu();
      });
      btn.on('pointerover', () => btn.setFillStyle(0x8b6914));
      btn.on('pointerout', () => { if (!isMine) btn.setFillStyle(0x5c4033); });
    });

    const clearBtn = this.add.circle(0, 0, 11, 0x882222, 0.9);
    clearBtn.setInteractive(new Phaser.Geom.Circle(0, 0, 11), Phaser.Geom.Circle.Contains);
    const clearTxt = this.add.text(0, 0, '✕', { fontSize: '11px', color: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
    container.add([clearBtn, clearTxt]);
    clearBtn.on('pointerup', () => {
      this.client?.setRoute(node.id, '');
      this.myRoutes.delete(node.id);
      this.applyRouteArrow(node.id);
      this.drawRouteArrows();
      this.hideRadialMenu();
    });

    this.radialMenu = container;
  }

  private hideRadialMenu(): void {
    if (this.radialMenu) { this.radialMenu.destroy(); this.radialMenu = null; }
  }

  private drawRouteArrows(): void {
    if (!this.routeArrowGfx) return;
    this.routeArrowGfx.clear();
    this.routeArrowGfx.lineStyle(3, 0xffd700, 0.9);
    this.myRoutes.forEach((roadId) => {
      const road = this.roadsById.get(roadId);
      if (!road) return;
      const pts = road.splinePoints;
      [0.12, 0.22, 0.32].forEach(ratio => {
        const idx = Math.min(Math.floor(ratio * (pts.length - 1)), pts.length - 2);
        const p = pts[idx], next = pts[idx + 1];
        const angle = Math.atan2(next.y - p.y, next.x - p.x);
        const headLen = 9;
        [-0.5, 0.5].forEach(side => {
          this.routeArrowGfx!.beginPath();
          this.routeArrowGfx!.moveTo(p.x, p.y);
          this.routeArrowGfx!.lineTo(
            p.x - Math.cos(angle + side) * headLen,
            p.y - Math.sin(angle + side) * headLen
          );
          this.routeArrowGfx!.strokePath();
        });
      });
    });
  }

  // ── Cities ────────────────────────────────────────────────
  private drawCity(city: CityData): void {
    const container = this.add.container(city.x, city.y);
    // Influence is shown as a terrain-tile highlight on selection instead
    const influence = this.add.circle(0, 0, city.influenceRadius, 0x4488ff, 0);
    influence.setVisible(false);
    // Unclaimed cities show an intact but greyed-out (neutral) fort, not a ruin.
    const castle = this.add.image(0, 0, `castle2_${city.ownerId ? factionOf(this.playerColors.get(city.ownerId)) : 'Blue'}`);
    castle.setScale(this.castleScale(city.townHallLevel)).setOrigin(0.5, 0.62).setTint(city.ownerId ? 0xffffff : 0x8f9aa6);
    const fire = this.add.sprite(-42, -56, 'fire').setScale(0.9).setVisible(false);
    fire.play('fire_anim');
    const fire2 = this.add.sprite(48, -28, 'fire').setScale(0.7).setVisible(false);
    fire2.play('fire_anim');
    const nameLabel = this.add.text(0, 86, city.name, {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    const levelLabel = this.add.text(0, -118, `Lv.${city.townHallLevel}`, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    container.add([influence, castle, fire, fire2, nameLabel, levelLabel]);
    container.setDepth(DEPTH_ENTITY + city.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-108, -118, 216, 200), Phaser.Geom.Rectangle.Contains);
    const entry: CityEntry = { gfx: container, data: city, archers: [], archerKey: '' };
    // Defending archers on the battlements — count scales with castle level
    // (L1 one centre, L2 two, L3 three). Shown greyed on a neutral fort.
    this.layoutArchers(entry);
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('city', city.id, city.name, entry.data); });
    this.cityGfx.set(city.id, entry);
  }

  // Open Field renders units & buildings larger (tiles stay 64px). Beat mode is
  // unchanged. ~1.6× turns the 0.62 unit scale into roughly "size 1".
  private rtsScale(base: number): number { return this.rtsMode ? base * 1.6 : base; }

  // The keep grows with its town-hall level so progress reads at a glance.
  private castleScale(level: number): number {
    return this.rtsScale(0.7 + (Math.max(1, Math.min(3, level || 1)) - 1) * 0.08);
  }

  // Archer positions (container-relative x) for each castle level.
  private archerOffsets(level: number): number[] {
    const n = Math.max(1, Math.min(3, level || 1));
    return n === 1 ? [0] : n === 2 ? [-74, 74] : [-74, 0, 74];
  }

  // (Re)build the battlement archers when the count or owner colour changes;
  // otherwise just refresh their tint. Keyed so it's cheap on every sync.
  private layoutArchers(entry: CityEntry): void {
    const { gfx, data } = entry;
    const acolor = data.ownerId ? factionOf(this.playerColors.get(data.ownerId)) : 'Blue';
    const offsets = this.archerOffsets(data.townHallLevel);
    const key = `${acolor}:${offsets.length}`;
    if (key === entry.archerKey) {
      entry.archers.forEach(a => a.setTint(data.ownerId ? 0xffffff : 0x8f9aa6));
      return;
    }
    entry.archers.forEach(a => a.destroy());
    entry.archers = offsets.map(dx => {
      // Match the castle's RTS scale so the battlement archer isn't tiny and
      // stays seated on the (enlarged) parapet.
      const ar = this.add.sprite(this.rtsScale(dx), this.rtsScale(-56), `u_${acolor}_archer_idle`).setScale(this.rtsScale(0.62));
      if (dx > 0) ar.setFlipX(true);
      ar.play(`u_${acolor}_archer_idle`);
      if (!data.ownerId) ar.setTint(0x8f9aa6);
      gfx.add(ar);
      return ar;
    });
    entry.archerKey = key;
  }

  private refreshCityVisual(entry: CityEntry): void {
    const { gfx, data } = entry;
    const castle = gfx.getAt(1) as Phaser.GameObjects.Image;
    const key = `castle2_${data.ownerId ? factionOf(this.playerColors.get(data.ownerId)) : 'Blue'}`;
    if (castle.texture.key !== key) castle.setTexture(key);
    castle.setTint(data.ownerId ? 0xffffff : 0x8f9aa6); // grey when unclaimed
    castle.setScale(this.castleScale(data.townHallLevel)); // grows per level
    (gfx.getAt(5) as Phaser.GameObjects.Text).setText(`Lv.${data.townHallLevel}`);
    // Burning when badly damaged
    const burning = data.health < data.maxHealth * 0.7;
    (gfx.getAt(2) as Phaser.GameObjects.Sprite).setVisible(burning);
    (gfx.getAt(3) as Phaser.GameObjects.Sprite).setVisible(data.health < data.maxHealth * 0.4);
    // Rebuild/refresh battlement archers (count scales with level, colour with owner)
    this.layoutArchers(entry);
    this.updateBar(this.cityHealthBars, data.id, data.x, data.y + 104, 92, data.health, data.maxHealth, true);
  }

  private hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  // ── Buildings ─────────────────────────────────────────────
  private drawBuilding(b: BuildData): void {
    const existing = this.buildingGfx.get(b.id);
    if (existing) { Object.assign(existing.data, b); return; }
    const container = this.add.container(b.x, b.y);
    const city = this.cityGfx.get(b.cityId);
    const color = factionOf(city ? this.playerColors.get(city.data.ownerId) : undefined);

    if (b.type === 'house') {
      // Pick one of three house variants deterministically from the id
      const variant = ['house2a', 'house2b', 'house2c'][Math.abs(this.hashStr(b.id)) % 3];
      container.add(this.add.image(0, 0, `${variant}_${color}`).setScale(this.rtsScale(0.55)).setOrigin(0.5, 0.72));
    } else if (b.type === 'barracks') {
      container.add(this.add.image(0, 0, `barracks2_${color}`).setScale(this.rtsScale(0.5)).setOrigin(0.5, 0.7));
    } else if (b.type === 'archery') {
      container.add(this.add.image(0, 0, `archery_${color}`).setScale(this.rtsScale(0.5)).setOrigin(0.5, 0.7));
    } else if (b.type === 'church') {
      container.add(this.add.image(0, 0, `monastery_${color}`).setScale(this.rtsScale(0.5)).setOrigin(0.5, 0.7));
    } else { // defense_tower — pack tower with an archer posted on top
      container.add(this.add.image(0, 0, `tower2_${color}`).setScale(this.rtsScale(0.62)).setOrigin(0.5, 0.72));
      const ar = this.add.sprite(0, this.rtsScale(-44), `u_${color}_archer_idle`).setScale(this.rtsScale(0.42));
      ar.play(`u_${color}_archer_idle`);
      container.add(ar);
    }
    if ((b as any).constructing) container.setData('constructing', true);

    container.setDepth(DEPTH_ENTITY + b.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-26, -40, 52, 64), Phaser.Geom.Rectangle.Contains);
    const entry = { gfx: container, data: { ...b } };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('building', b.id, b.type, entry.data); });
    this.buildingGfx.set(b.id, entry);
    // Build-complete pop for my own new buildings (skip the post-load flood).
    if (city && city.data.ownerId === this.client?.sessionId && this.time.now - this.mapReadyAt > 1500) {
      this.spawnPop(container, 1, b.x, b.y + 4);
      playSfx('build_place', { volume: 0.45, throttleMs: 150, throttleKey: 'build', x: b.x, y: b.y });
    }
  }

  // ── Lairs ──────────────────────────────────────────────────
  private drawLair(l: LairData): void {
    if (this.lairGfx.has(l.id)) return;
    const container = this.add.container(l.x, l.y);
    const isSpider = l.type === 'spider';
    if (isSpider) {
      const cave = this.add.image(0, 0, 'goldmine_destroyed').setScale(0.7).setOrigin(0.5, 0.6);
      cave.setTint(0xbb99dd);
      container.add(cave);
    } else {
      container.add(this.add.image(0, 0, 'goblin_house').setScale(0.65).setOrigin(0.5, 0.65));
    }
    const label = this.add.text(0, 42, isSpider ? 'Spider Cave' : 'Goblin Stump', {
      fontSize: '11px', color: isSpider ? '#cba6ff' : '#9be564', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(label);
    container.setDepth(DEPTH_ENTITY + l.y * 0.01);
    this.lairGfx.set(l.id, { gfx: container, data: { ...l } });
  }

  private refreshLairVisual(entry: { gfx: Phaser.GameObjects.Container; data: LairData }): void {
    const { gfx, data } = entry;
    const destroyed = data.health <= 0;
    gfx.setAlpha(destroyed ? 0.35 : 1);
    const label = gfx.getAt(1) as Phaser.GameObjects.Text;
    const baseName = data.type === 'spider' ? 'Spider Cave' : 'Goblin Stump';
    label.setText(destroyed ? `${baseName} (razed)` : baseName);
    if (destroyed) {
      const bar = this.lairHealthBars.get(data.id);
      if (bar) { bar.destroy(); this.lairHealthBars.delete(data.id); }
    } else {
      this.updateBar(this.lairHealthBars, data.id, data.x, data.y + 52, 44, data.health, data.maxHealth);
    }
  }

  // ── Contested objectives (gold mine / mercenary camp / shrine) ──────
  private objMeta(kind: string): { sprite: string; scale: number; origin: number; name: string } {
    if (kind === 'merc') return { sprite: 'goblin_house', scale: 0.62, origin: 0.64, name: 'Mercenary Camp' };
    if (kind === 'shrine') return { sprite: 'monastery_Blue', scale: 0.5, origin: 0.62, name: 'Shrine' };
    return { sprite: 'goldmine_active', scale: 0.62, origin: 0.6, name: 'Gold Mine' };
  }

  private drawObjective(o: { id: string; kind: string; x: number; y: number; ownerId: string; capture: number; contenderId: string; contested: boolean }): void {
    if (this.objectiveGfx.has(o.id)) return;
    const meta = this.objMeta(o.kind);
    const container = this.add.container(o.x, o.y);
    // Soft capture-zone ring on the ground.
    const zone = this.add.graphics();
    zone.fillStyle(0xffe9a8, 0.05).fillCircle(0, 0, 58);
    zone.lineStyle(2, 0xffe9a8, 0.16).strokeCircle(0, 0, 58);
    container.add(zone);
    // A shrine glows; the pulse is tweened and recoloured on capture.
    if (o.kind === 'shrine') {
      const aura = this.add.graphics();
      aura.fillStyle(0xfff1b0, 0.22).fillCircle(0, -6, 30);
      aura.setData('kind', 'aura');
      container.add(aura);
      this.tweens.add({ targets: aura, alpha: { from: 0.35, to: 0.9 }, scale: { from: 0.85, to: 1.15 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const img = this.add.image(0, 0, meta.sprite).setScale(meta.scale).setOrigin(0.5, meta.origin);
    container.add(img);
    const label = this.add.text(0, 40, meta.name, {
      fontSize: '11px', color: '#ffe9a8', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(label);
    container.setDepth(DEPTH_ENTITY + o.y * 0.01);
    const bar = this.add.graphics().setDepth(DEPTH_ENTITY + o.y * 0.01 + 0.6);
    const entry = { gfx: container, bar, banner: null as Phaser.GameObjects.Container | null, data: { ...o } };
    this.objectiveGfx.set(o.id, entry);
    this.refreshObjective(entry);
  }

  private refreshObjective(entry: { gfx: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Graphics; banner: Phaser.GameObjects.Container | null; data: any }): void {
    const { gfx, bar, data } = entry;
    const owned = !!data.ownerId && this.playerColors.has(data.ownerId);
    // Ownership banner: a pennant in the holder's colour atop the camp.
    const wantOwner = owned ? data.ownerId : '';
    if (gfx.getData('bannerOwner') !== wantOwner) {
      const old = gfx.getData('bannerGfx') as Phaser.GameObjects.GameObject | undefined;
      if (old) old.destroy();
      if (owned) {
        const pen = this.makePennant(this.playerColors.get(data.ownerId));
        pen.setPosition(-9, -34);
        gfx.add(pen);
        gfx.setData('bannerGfx', pen);
      } else {
        gfx.setData('bannerGfx', undefined);
      }
      gfx.setData('bannerOwner', wantOwner);
    }
    // Capture / contest bar above the camp.
    bar.clear();
    const w = 48, h = 6, bx = data.x - w / 2, by = data.y - 46;
    const frac = Math.max(0, Math.min(1, (data.capture || 0) / 100));
    const showBar = data.contested || frac > 0.001 || owned;
    if (showBar) {
      bar.fillStyle(0x000000, 0.55).fillRect(bx - 1, by - 1, w + 2, h + 2);
      let col = 0x9aa3ad, fillFrac = frac;
      if (data.contested) { col = 0xffa53a; fillFrac = Math.max(0.18, frac); }
      else if (data.contenderId && this.playerColors.has(data.contenderId)) col = Phaser.Display.Color.HexStringToColor(this.playerColors.get(data.contenderId)!).color;
      else if (owned) { col = Phaser.Display.Color.HexStringToColor(this.playerColors.get(data.ownerId)!).color; fillFrac = 1; }
      bar.fillStyle(col, 0.95).fillRect(bx, by, w * fillFrac, h);
    }
  }

  // ── Resource nodes ─────────────────────────────────────────
  private drawResource(r: any): void {
    // Younger trees are smaller; they swell back as they age (server `age`).
    const treeMaturity = (age: number) => 0.45 + 0.55 * Math.min(1, (age || 0) / 30);
    const existing = this.resourceGfx.get(r.id);
    if (existing) {
      Object.assign(existing.data, { amount: r.amount, maxAmount: r.maxAmount, age: r.age });
      if (existing.data.type === 'tree') {
        const sp = existing.gfx.getAt(0) as Phaser.GameObjects.Sprite;
        sp.setScale((existing.data.baseScale as number) * treeMaturity(r.age));
      }
      return;
    }
    const container = this.add.container(r.x, r.y);
    if (r.type === 'tree') {
      const species = 1 + ((r.x * 7 + r.y * 13) % 4); // deterministic species (incl. birch)
      // Vary size per tree so a cluster reads like a real forest
      const baseScale = 0.55 + ((r.x * 17 + r.y * 31) % 100) / 100 * 0.4; // 0.55–0.95
      const t = this.add.sprite(0, 0, `tree${species}`).setScale(baseScale * treeMaturity(r.age)).setOrigin(0.5, 0.82);
      t.play({ key: `tree${species}_anim`, startFrame: (r.x + r.y) % 8 });
      container.add(t);
      (r as any)._baseScale = baseScale;
    } else if (r.type === 'sheep') {
      const s = this.add.sprite(0, 0, 'sheep2').setScale(0.7);
      s.play({ key: 'sheep2_anim', startFrame: (r.x + r.y) % 6 });
      container.add(s);
      this.wanderSheep(s);
    } else {
      // Gold deposit: a cluster of gemstones on the ground
      const g = (n: number) => `gem${1 + ((r.x * 3 + r.y * 5 + n) % 6)}`;
      container.add([
        this.add.image(0, 2, g(0)).setScale(0.55),
        this.add.image(-20, 12, g(1)).setScale(0.4),
        this.add.image(20, 14, g(2)).setScale(0.34),
      ]);
    }
    container.setDepth(DEPTH_ENTITY + r.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-28, -40, 56, 64), Phaser.Geom.Rectangle.Contains);
    const names: Record<string, string> = { tree: 'Forest', sheep: 'Sheep', gold: 'Gold Deposit' };
    const entry = { gfx: container, data: { id: r.id, type: r.type, x: r.x, y: r.y, amount: r.amount, maxAmount: r.maxAmount, age: r.age, baseScale: (r as any)._baseScale ?? 1 } };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('resource', r.id, names[r.type] || r.type, entry.data); });
    this.resourceGfx.set(r.id, entry);
  }

  // Sheep graze: idle, then amble a few px to a new spot with the walk anim,
  // facing the way they go. Callbacks bail once the sprite is destroyed.
  private wanderSheep(s: Phaser.GameObjects.Sprite): void {
    const idle = () => {
      if (!s.active) return;
      s.play({ key: 'sheep2_anim', startFrame: 0 });
      this.time.delayedCall(1400 + Math.random() * 3200, roam);
    };
    const roam = () => {
      if (!s.active) return;
      const tx = (Math.random() - 0.5) * 46, ty = (Math.random() - 0.5) * 26;
      s.setFlipX(tx < s.x);
      s.play('sheep2_move');
      this.tweens.add({ targets: s, x: tx, y: ty, duration: 1100 + Math.random() * 900, ease: 'Sine.inOut', onComplete: idle });
    };
    this.time.delayedCall(Math.random() * 2500, roam);
  }

  // Cloud blanket that hides never-explored (state 0) regions — a sparse grid of
  // big soft puffs (fewer, larger clouds read better than a swarm of small ones).
  private buildClouds(): void {
    if (!this.terrainInfo) return;
    const { cols, rows } = this.terrainInfo;
    const step = 360;
    for (let y = step / 2; y < rows * TILE; y += step) {
      for (let x = step / 2; x < cols * TILE; x += step) {
        const jx = x + (Math.random() - 0.5) * 120, jy = y + (Math.random() - 0.5) * 100;
        const s = this.add.sprite(jx, jy, `cloud${1 + Math.floor(Math.random() * 8)}`)
          .setDepth(61).setScale(1.0 + Math.random() * 0.5).setAlpha(0.97);
        if (Math.random() < 0.5) s.setFlipX(true);
        this.tweens.add({
          targets: s, x: jx + (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 14),
          duration: 4000 + Math.random() * 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        const c = Math.floor(jx / TILE), r = Math.floor(jy / TILE);
        this.cloudSprites.push({ sprite: s, tile: r * cols + c });
      }
    }
    this.buildDriftClouds();
  }

  // A handful of small clouds drift slowly across the whole map as ambience,
  // floating above the world (not tied to the fog), looping off-screen to off.
  private buildDriftClouds(): void {
    if (!this.terrainInfo) return;
    const { cols, rows } = this.terrainInfo;
    const W = cols * TILE, H = rows * TILE;
    for (let i = 0; i < 7; i++) {
      const y = Math.random() * H;
      const s = this.add.sprite(-200, y, `cloud${1 + Math.floor(Math.random() * 8)}`)
        .setDepth(92).setScale(0.35 + Math.random() * 0.3).setAlpha(0.4);
      const drift = (startX: number) => {
        const yy = Math.random() * H;
        s.setY(yy).setX(startX);
        this.tweens.add({
          targets: s, x: W + 220, duration: 60000 + Math.random() * 60000, ease: 'Linear',
          onComplete: () => drift(-220),
        });
      };
      drift(-220 - Math.random() * W); // stagger their entry across the map
    }
  }

  // ── Fog of war ─────────────────────────────────────────────
  private updateFog(state: any): void {
    if (!this.terrainInfo || !this.fogState || !this.fogGfx) return;
    if (this.time.now - this.lastFogUpdate < 400) return;
    this.lastFogUpdate = this.time.now;
    const { cols, rows } = this.terrainInfo;
    const fog = this.fogState;
    const myId = this.client?.sessionId;

    // Visible → explored, then re-mark from my vision sources
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
    const reveal = (x: number, y: number, radius: number) => {
      const rT = Math.ceil(radius / TILE);
      const cc = Math.floor(x / TILE), cr = Math.floor(y / TILE);
      for (let r = Math.max(0, cr - rT); r <= Math.min(rows - 1, cr + rT); r++) {
        for (let c = Math.max(0, cc - rT); c <= Math.min(cols - 1, cc + rT); c++) {
          const dx = c * TILE + TILE / 2 - x, dy = r * TILE + TILE / 2 - y;
          if (dx * dx + dy * dy <= radius * radius) fog[r * cols + c] = 2;
        }
      }
    };
    if (myId) {
      state.cities.forEach((c: any) => { if (c.ownerId === myId) reveal(c.x, c.y, (c.influenceRadius + 220) * 2); });
      state.units.forEach((u: any) => {
        if (u.ownerId !== myId) return;
        const pos = this.getUnitWorldPos(u);
        if (pos) reveal(pos.x, pos.y, 300);
      });
    }

    // Draw fog overlay. Unexplored gets a soft cloudy base (clouds layer on top);
    // explored-but-unwatched stays a dim veil.
    this.fogGfx.clear();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = fog[r * cols + c];
        if (s === 2) continue;
        // Unexplored is fully opaque (you can't see through it); the cloud layer
        // sits on top. Explored-but-unwatched is a lighter dim veil.
        this.fogGfx.fillStyle(s === 0 ? 0x0b1622 : 0x06101c, s === 0 ? 1 : 0.45);
        this.fogGfx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    // Clouds only over never-explored tiles
    this.cloudSprites.forEach(cl => cl.sprite.setVisible(fog[cl.tile] === 0));

    // Hide/show world entities by fog state
    const stateAt = (x: number, y: number): number => {
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return 0;
      return fog[r * cols + c];
    };
    this.unitGfx.forEach((u, id) => {
      const mine = !myId ? true : (u.container.getData('ownerId') === myId);
      u.container.setVisible(mine || stateAt(u.container.x, u.container.y) === 2);
    });
    this.resourceGfx.forEach(e => e.gfx.setVisible(stateAt(e.data.x, e.data.y) >= 1));
    this.lairGfx.forEach(e => {
      const vis = stateAt(e.data.x, e.data.y) >= 1;
      e.gfx.setVisible(vis);
      const bar = this.lairHealthBars.get(e.data.id);
      if (bar) bar.setVisible(vis);
    });
    this.cityGfx.forEach(e => {
      const vis = stateAt(e.data.x, e.data.y) >= 1;
      e.gfx.setVisible(vis);
      const bar = this.cityHealthBars.get(e.data.id);
      if (bar) bar.setVisible(vis);
    });
    this.buildingGfx.forEach(e => e.gfx.setVisible(stateAt(e.data.x, e.data.y) >= 1));
  }

  // Build a Tiny Swords health bar (wooden `bar_base` slot + red `bar_fill`).
  // The fill grows from the left; its width is set per-update by setBarRatio.
  private makeBar(width: number, height: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const base = this.add.image(0, 0, 'bar_base').setOrigin(0.5).setDisplaySize(width, height);
    const innerW = width * 0.82, innerH = height * 0.48;
    const fill = this.add.image(-innerW / 2, 0, 'bar_fill').setOrigin(0, 0.5);
    fill.setData('iw', innerW).setData('ih', innerH);
    c.add([base, fill]);
    c.setData('fill', fill);
    return c;
  }

  private setBarRatio(c: Phaser.GameObjects.Container, ratio: number): void {
    const fill = c.getData('fill') as Phaser.GameObjects.Image;
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    fill.setDisplaySize((fill.getData('iw') as number) * r, fill.getData('ih') as number);
  }

  // World-positioned bar for cities (big) and lairs (small). Hidden at full HP.
  private updateBar(store: Map<string, Phaser.GameObjects.Container>, id: string, cx: number, y: number, width: number, hp: number, maxHp: number, big = false): void {
    let bar = store.get(id);
    if (hp >= maxHp || hp <= 0) {
      if (bar) { bar.destroy(); store.delete(id); }
      return;
    }
    if (!bar) { bar = this.makeBar(width, big ? 18 : 12).setDepth(90); store.set(id, bar); }
    bar.setPosition(cx, y);
    this.setBarRatio(bar, hp / maxHp);
  }

  // ── Units ─────────────────────────────────────────────────
  private syncUnit(unit: any): void {
    const pos = this.getUnitWorldPos(unit);
    const existing = this.unitGfx.get(unit.id);
    const fighting = unit.status === 'fighting' || unit.status === 'sieging';
    const isVillager = unit.type === 'villager';
    let desiredAnim = fighting ? 'attack' : unit.status === 'defending' ? 'idle' : 'walk';
    // Villagers: tool matches the resource (pickaxe=gold, knife=sheep, axe=wood)
    // while working; while hauling home they carry the matching load.
    if (isVillager) {
      const res = unit.resourceType; // 'tree' | 'sheep' | 'gold'
      if (unit.status === 'building') {
        desiredAnim = 'build'; // hammer animation while raising a construction site
      } else if (unit.carrying > 0 && desiredAnim === 'walk') {
        desiredAnim = res === 'gold' ? 'carrygold' : res === 'sheep' ? 'carrymeat' : 'carrywood';
      } else if (desiredAnim === 'attack') {
        desiredAnim = res === 'gold' ? 'mine' : res === 'sheep' ? 'butcher' : 'attack';
      }
    } else if (fighting) {
      // Beat mode: strike once per beat (swingCombatUnits), holding idle between
      // blows. RTS is real-time with no beat swing, so loop the attack animation
      // continuously while engaged (otherwise units just stand idle and fighting).
      desiredAnim = this.rtsMode ? 'attack' : 'idle';
    }
    // A monk that healed in the last few ticks is actively channeling: loop its
    // Heal animation (mapped to the 'attack' state) regardless of march/fight.
    const healing = unit.type === 'monk' && unit.healingTick > 0
      && (this.serverTick - unit.healingTick) <= 6;
    if (healing) desiredAnim = 'attack';
    // A combatant's sprite is driven by the beat swing, not the status anim — but
    // a channeling monk loops its heal anim instead of being beat-swung. In RTS
    // there's no beat swing, so engaged units loop their attack anim like anyone.
    const combatant = fighting && !isVillager && !healing && !this.rtsMode;

    if (existing) {
      if (pos) existing.container.setData('worldPos', pos);
      existing.container.setData('targetResourceId', unit.targetResourceId);
      existing.container.setData('fighting', combatant);
      existing.container.setData('inCombat', fighting); // mode-agnostic (RTS archers fire on this)
      existing.container.setData('order', unit.order || '');
      existing.container.setData('laneKey', this.laneKeyOf(unit.roadId));
      const animKey = `${existing.base}_${desiredAnim}`;
      // While a beat-swing is mid-play, leave the sprite to swingCombatUnits().
      const midSwing = combatant && existing.anim === `${existing.base}_attack`;
      if (!midSwing && existing.anim !== animKey) {
        existing.sprite.play(animKey);
        existing.anim = animKey;
      }
      const ratio = unit.health / (unit.maxHealth || 100);
      const prevRatio = existing.container.getData('hpRatio') as number | undefined;
      if (prevRatio !== undefined && ratio < prevRatio - 0.001) {
        // One battle cue at a time: long throttle + spatial falloff so it never
        // buzzes, goes quiet off to the side, and fades when zoomed out.
        const clash = Phaser.Utils.Array.GetRandom(['sword_clash', 'sword_clash2', 'sword_clash3', 'sword_clash4']);
        playSfx(clash, { volume: 0.26, throttleMs: 650, throttleKey: 'sword_clash', x: existing.container.x, y: existing.container.y });
      }
      existing.container.setData('hpRatio', ratio);
      this.setBarRatio(existing.hpBar, ratio);
      existing.hpBar.setVisible(unit.health < unit.maxHealth);
      // Pop the heal glow once per server heal pulse (healingTick advances each
      // time the monk channels), aligned to the monk's current position.
      if (healing) {
        const lastFx = existing.container.getData('healFxTick') as number | undefined;
        if (unit.healingTick !== lastFx) {
          existing.container.setData('healFxTick', unit.healingTick);
          this.spawnHealEffect(existing.container.x, existing.container.y, this.playerColors.get(unit.ownerId));
        }
      }
      return;
    }
    if (!pos) return;

    const skin = unitSkin(unit.type, this.playerColors.get(unit.ownerId));
    const container = this.add.container(pos.x, pos.y);
    const sprite = this.add.sprite(0, 0, `${skin.base}_idle`).setScale(this.rtsScale(skin.scale));
    const animKey = `${skin.base}_${desiredAnim}`;
    sprite.play(animKey);
    const hpBar = this.makeBar(30, 9).setPosition(0, -34);
    hpBar.setVisible(false);
    container.add([sprite, hpBar]);
    // Marching columns read as ranks, not a single file: each unit holds a small
    // fixed perpendicular offset from the road centreline (applied in update()).
    const h = Math.abs(this.hashStr(unit.id));
    if (unit.type !== 'villager') container.setData('rankOff', ((h % 3) - 1) * 9);
    // Every fifth combatant carries a faction pennant ("standard bearers").
    if (unit.type !== 'villager' && h % 5 === 0) {
      container.add(this.makePennant(this.playerColors.get(unit.ownerId)));
    }
    container.setData('worldPos', pos);
    container.setData('ownerId', unit.ownerId);
    container.setData('isVillager', unit.type === 'villager');
    container.setData('unitType', unit.type);
    container.setData('fighting', combatant);
    container.setData('inCombat', fighting);
    container.setData('order', unit.order || '');
    container.setData('laneKey', this.laneKeyOf(unit.roadId));
    container.setData('targetResourceId', unit.targetResourceId);
    container.setDepth(DEPTH_ENTITY + pos.y * 0.01);
    // Click a pawn to flash the node it's currently gathering.
    if (unit.type === 'villager') {
      container.setInteractive(new Phaser.Geom.Circle(0, 0, 22), Phaser.Geom.Circle.Contains);
      container.on('pointerup', () => { if (!this.dragMoved) this.highlightVillagerResource(unit.id); });
    }
    this.unitGfx.set(unit.id, { container, sprite, hpBar, base: skin.base, anim: animKey });
    // Spawn pop: my freshly-trained units scale in with a dust ring + chime
    // (skip the initial flood of existing units right after the map builds).
    if (unit.ownerId === this.client?.sessionId && this.time.now - this.mapReadyAt > 1500) {
      this.spawnPop(sprite, skin.scale, pos.x, pos.y + 8);
      playSfx('unit_recruit', { volume: 0.4, throttleMs: 120, throttleKey: 'recruit', x: pos.x, y: pos.y });
    }
  }

  // Did the blow that just hit (defenderOwner/defenderType) come from a unit that
  // counters it on the RPS triangle? Inferred from the nearest enemy in melee reach.
  private isCounterHit(x: number, y: number, defenderOwner: string, defenderType: string): boolean {
    if (!RPS_ADVANTAGE[defenderType] && defenderType !== 'knight' && defenderType !== 'archer' && defenderType !== 'lancer') return false;
    let best = 72, attackerType = '';
    this.unitGfx.forEach(u => {
      if (!u.container.visible) return;
      if ((u.container.getData('ownerId') as string) === defenderOwner) return;
      if (u.container.getData('isVillager') === true) return;
      const d = Math.hypot(u.container.x - x, u.container.y - y);
      if (d < best) { best = d; attackerType = (u.container.getData('unitType') as string) || ''; }
    });
    return !!attackerType && RPS_ADVANTAGE[attackerType] === defenderType;
  }

  // Flash a ring around the resource node the clicked pawn is gathering.
  private highlightVillagerResource(unitId: string): void {
    const entry = this.unitGfx.get(unitId);
    if (!entry) return;
    const resId = entry.container.getData('targetResourceId') as string;
    const res = resId ? this.resourceGfx.get(resId) : undefined;
    playSfx('ui_click', { volume: 0.4, throttleMs: 60 });
    if (!res) return;
    const g = this.add.graphics().setDepth(199);
    g.lineStyle(3, 0xffe87a, 1).strokeCircle(res.data.x, res.data.y, 36);
    this.tweens.add({ targets: g, alpha: 0, duration: 2200, ease: 'Power2', onComplete: () => g.destroy() });
  }

  // Quick hit-flash: a white tint pop on a unit that just took damage.
  private flashUnit(id: string): void {
    const u = this.unitGfx.get(id);
    if (!u || !u.container.visible) return;
    const spr = u.sprite;
    spr.setTintFill(0xffffff);
    this.time.delayedCall(90, () => { if (spr.active) spr.clearTint(); });
  }

  // On every beat, engaged combatants play exactly one attack swing, then settle
  // back to idle — so strikes read in time with the march/drum instead of looping
  // a frantic, off-beat flurry. The server already lands blows once per beat.
  private swingCombatUnits(): void {
    this.unitGfx.forEach(u => {
      if (u.container.getData('fighting') !== true || !u.container.visible) return;
      const attackKey = `${u.base}_attack`;
      const anim = this.anims.get(attackKey);
      if (!anim) return;
      const frames = anim.frames.length || 4;
      // Fit the whole swing into ~40% of the beat so it's a crisp single strike,
      // then chain straight back to the idle stance until the next beat.
      const frameRate = Math.max(6, Math.round(frames / 0.4));
      u.sprite.play({ key: attackKey, repeat: 0, frameRate }).chain(`${u.base}_idle`);
      u.anim = attackKey;
      // Archers loose their arrow ON the beat, in time with the draw (so ranged
      // strikes read on the rhythm just like melee swings).
      if (u.base.includes('_archer')) {
        const ownerId = u.container.getData('ownerId') as string;
        const target = this.nearestEnemyNear(u.container.x, u.container.y, ownerId, 260);
        if (target) this.fireArrow(u.container.x, u.container.y - 12, target.x, target.y, u.base.split('_')[1]);
      }
    });
  }

  // RTS real-time archer fire: each engaged archer looses an arrow on its own
  // ~1s cadence at the nearest enemy in range (the server applies the damage).
  private tickRtsArchers(time: number): void {
    this.unitGfx.forEach(u => {
      if (u.container.getData('unitType') !== 'archer') return;
      if (u.container.getData('inCombat') !== true || !u.container.visible) return;
      const last = (u.container.getData('lastArrowMs') as number) || 0;
      if (time - last < 950) return;
      const ownerId = u.container.getData('ownerId') as string;
      const target = this.nearestEnemyNear(u.container.x, u.container.y, ownerId, 380);
      if (!target) return;
      u.container.setData('lastArrowMs', time);
      this.fireArrow(u.container.x, u.container.y - 12, target.x, target.y, u.base.split('_')[1]);
    });
  }

  // A monk's heal effect (pack art): a one-shot glow that blooms over the monk
  // each time it channels, tinted to the healer's faction, with a soft chime.
  private spawnHealEffect(x: number, y: number, hex?: string): void {
    const key = `u_${factionOf(hex)}_monk_heal_fx`;
    if (!this.anims.exists(key)) return;
    const fx = this.add.sprite(x, y - 6, key).setScale(0.62).setDepth(DEPTH_ENTITY + y * 0.01 + 0.6);
    fx.play(key);
    fx.once('animationcomplete', () => fx.destroy());
    playSfx('unit_recruit', { volume: 0.16, rate: 1.5, throttleMs: 380, throttleKey: 'heal', x, y });
  }

  private removeUnitVisual(id: string, died: boolean): void {
    const u = this.unitGfx.get(id);
    if (!u) return;
    if (died) {
      const fx = this.add.sprite(u.container.x, u.container.y, 'dead')
        .setScale(0.6)
        .setDepth(DEPTH_ENTITY + u.container.y * 0.01 + 0.5);
      fx.play('dead_anim');
      fx.once('animationcomplete', () => {
        this.tweens.add({ targets: fx, alpha: 0, delay: 1200, duration: 600, onComplete: () => fx.destroy() });
      });
    }
    u.container.destroy();
    this.unitGfx.delete(id);
  }

  // ── Archer combat FX (cosmetic) ───────────────────────────
  // Find the closest visible enemy unit within `range` of a point.
  private nearestEnemyNear(x: number, y: number, ownerId: string, range: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = range;
    this.unitGfx.forEach(u => {
      if (!u.container.visible) return;
      if ((u.container.getData('ownerId') as string) === ownerId) return;
      if (u.container.getData('isVillager') === true) return; // workers aren't targets
      const d = Math.hypot(u.container.x - x, u.container.y - y);
      if (d < bestD) { bestD = d; best = { x: u.container.x, y: u.container.y }; }
    });
    return best;
  }

  // Spawn an arrow that flies from the archer to the target and vanishes on hit.
  private fireArrow(fromX: number, fromY: number, toX: number, toY: number, color: string): void {
    const tex = this.textures.exists(`arrow_${color}`) ? `arrow_${color}` : 'arrow_Blue';
    const arrow = this.add.image(fromX, fromY, tex)
      .setScale(0.5)
      .setRotation(Math.atan2(toY - fromY, toX - fromX))
      .setDepth(DEPTH_ENTITY + Math.max(fromY, toY) * 0.01 + 1);
    const dist = Math.hypot(toX - fromX, toY - fromY);
    // One bowstring cue per volley: a shared throttle bucket collapses the
    // arrows a fort or cluster looses in the same tick into a single twang.
    const bow = Phaser.Utils.Array.GetRandom(['bow_shot', 'bow_shot2']);
    playSfx(bow, { volume: 0.3, throttleMs: 180, throttleKey: 'bow_shot', x: fromX, y: fromY });
    this.tweens.add({
      targets: arrow, x: toX, y: toY,
      duration: Math.max(140, dist * 1.4), ease: 'Linear',
      onComplete: () => { arrow.destroy(); this.impactBurst(toX, toY, false); },
    });
  }

  // Play an archer sprite's shoot animation once, then settle back to idle.
  private playShoot(ar: Phaser.GameObjects.Sprite | undefined, color: string): void {
    if (!ar) return;
    const attackKey = `u_${color}_archer_attack`;
    const idleKey = `u_${color}_archer_idle`;
    if (!this.anims.exists(attackKey)) return;
    ar.play(attackKey);
    this.time.delayedCall(660, () => { if (ar.active) ar.play(idleKey); });
  }

  private tickArcherFx(): void {
    // Capital forts: two battlement archers each volley the nearest foe.
    this.cityGfx.forEach(e => {
      if (!e.gfx.visible) return;
      // Neutral forts defend too — a sentinel id makes every unit a valid target.
      const target = this.nearestEnemyNear(e.data.x, e.data.y, e.data.ownerId || '__neutral__', 300);
      if (!target) return;
      const color = e.data.ownerId ? factionOf(this.playerColors.get(e.data.ownerId)) : 'Blue';
      e.archers.forEach(ar => {
        this.playShoot(ar, color);
        this.fireArrow(e.data.x + ar.x, e.data.y - 56, target.x, target.y, color);
      });
    });
    // Defense towers: single archer on top.
    this.buildingGfx.forEach(e => {
      if (e.data.type !== 'defense_tower' || !e.gfx.visible) return;
      const ownerId = this.cityGfx.get(e.data.cityId)?.data.ownerId;
      if (!ownerId) return;
      const target = this.nearestEnemyNear(e.data.x, e.data.y, ownerId, 280);
      if (!target) return;
      const color = factionOf(this.playerColors.get(ownerId));
      this.playShoot(e.gfx.getAt(1) as Phaser.GameObjects.Sprite, color);
      this.fireArrow(e.data.x, e.data.y - 34, target.x, target.y, color);
    });
    // (Field archers now loose their arrows on the beat in swingCombatUnits.)
  }

  // Draw the worn footpaths synced from the server (only when the set changes).
  private syncTrails(state: any): void {
    const n = state.trails.size as number;
    if (n === this.rtsTrailCount) return;
    this.rtsTrailCount = n;
    if (!this.rtsTrailGfx) this.rtsTrailGfx = this.add.graphics().setDepth(1);
    const g = this.rtsTrailGfx; g.clear(); g.fillStyle(0x9b7a4d, 0.33);
    const cols = Math.ceil(this.mapW / TILE);
    state.trails.forEach((_v: number, key: string) => {
      const idx = parseInt(key, 10);
      const c = idx % cols, r = Math.floor(idx / cols);
      g.fillRect(c * TILE + 4, r * TILE + 4, TILE - 8, TILE - 8);
    });
  }

  private getUnitWorldPos(unit: any): { x: number; y: number } | null {
    // RTS: every unit is free-position (x/y authoritative). Villagers always are.
    if (this.rtsMode || unit.type === 'villager') return { x: unit.x, y: unit.y };
    if (unit.atNodeId) {
      const node = this.nodes.get(unit.atNodeId);
      if (!node) return null;
      let hash = 0;
      for (let i = 0; i < unit.id.length; i++) hash = (hash * 31 + unit.id.charCodeAt(i)) >>> 0;
      const angle = (hash % 360) * Math.PI / 180;
      const radius = 50 + (hash % 3) * 14;
      return { x: node.x + Math.cos(angle) * radius, y: node.y + Math.sin(angle) * radius };
    }
    const road = this.roadsById.get(unit.roadId);
    if (!road || road.tilePath.length < 2) return null;
    const path = road.tilePath;
    // Mirror the server's slot count exactly (pairSlots = max(3, tilePath.length)).
    const slots = Math.max(3, path.length);
    // The server steps units in integer tile slots (slot = round(t * slots));
    // recover the same tile so the sprite lands exactly where the server placed it.
    const slot = Phaser.Math.Clamp(Math.round(unit.t * slots), 0, path.length - 1);
    const cell = path[slot];
    return { x: (cell.c + 0.5) * TILE, y: (cell.r + 0.5) * TILE };
  }

  // Briefly highlight the chosen rally road so the player sees where troops will go.
  private flashRally(road: RoadData): void {
    const pts = road.splinePoints;
    if (pts.length < 2) return;
    const g = this.add.graphics().setDepth(190);
    g.lineStyle(6, 0xffe87a, 0.95);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
    const end = pts[pts.length - 1];
    const flag = this.add.text(end.x, end.y - 20, '◆', { fontSize: '20px', color: '#ffe07a', stroke: '#2a1d0e', strokeThickness: 3 }).setOrigin(0.5).setDepth(191);
    this.tweens.add({ targets: [g, flag], alpha: 0, duration: 1400, ease: 'Power2', onComplete: () => { g.destroy(); flag.destroy(); } });
  }

  private showFloatingDamage(x: number, y: number, amount: number, color: string = '#ff4444', big = false): void {
    const txt = this.add.text(x, y - 24, `-${amount}`, {
      fontSize: big ? '18px' : '12px', color, fontFamily: 'monospace',
      stroke: '#000', strokeThickness: big ? 4 : 3, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);
    if (big) {
      txt.setScale(0.5);
      this.tweens.add({ targets: txt, scale: 1, duration: 180, ease: 'Back.Out' });
    }
    this.tweens.add({
      targets: txt, y: y - (big ? 64 : 56), alpha: 0, duration: big ? 950 : 800, ease: 'Power2',
      onComplete: () => txt.destroy(),
    });
  }

  // ── Juice primitives ──────────────────────────────────────
  // A quick spark burst at a clash point: an expanding ring + a few radiating
  // spark lines. `strong` (a counter-advantage hit) makes it bigger and gold.
  // Throttled per rounded tile so a packed melee never spawns a storm of these.
  private impactBurst(x: number, y: number, strong = false): void {
    const key = `${Math.round(x / 48)},${Math.round(y / 48)}`;
    const now = this.time.now;
    if (now - (this.lastBurstAt.get(key) ?? -1e9) < 110) return;
    this.lastBurstAt.set(key, now);
    const v = this.cameras.main.worldView;
    if (x < v.x - 80 || x > v.right + 80 || y < v.y - 80 || y > v.bottom + 80) return;
    const colour = strong ? 0xffd54a : 0xffffff;
    const n = strong ? 6 : 4;
    const len = strong ? 22 : 14;
    const g = this.add.graphics().setDepth(201);
    const a0 = Math.random() * Math.PI;
    const st = { r: strong ? 8 : 5, a: 1 };
    this.tweens.add({
      targets: st, r: strong ? 40 : 26, a: 0, duration: strong ? 240 : 190, ease: 'Cubic.Out',
      onUpdate: () => {
        g.clear();
        g.lineStyle(strong ? 3 : 2, colour, st.a);
        g.strokeCircle(x, y, st.r);
        for (let i = 0; i < n; i++) {
          const ang = a0 + (i / n) * Math.PI * 2;
          const r1 = st.r, r2 = st.r + len * st.a;
          g.lineBetween(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1, x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
        }
      },
      onComplete: () => g.destroy(),
    });
  }

  // A small recoil twitch on the unit's sprite (not its container, so it never
  // fights the beat-hop positioning). Pushes opposite the way it's facing.
  private recoilUnit(id: string): void {
    const u = this.unitGfx.get(id);
    if (!u || !u.container.visible) return;
    const spr = u.sprite;
    const dir = spr.flipX ? 1 : -1; // facing left ⇒ recoil right
    const baseX = (spr.getData('baseX') as number) ?? spr.x;
    spr.setData('baseX', baseX);
    this.tweens.killTweensOf(spr);
    this.tweens.add({ targets: spr, x: baseX + dir * 5, duration: 70, yoyo: true, ease: 'Quad.Out',
      onComplete: () => { if (spr.active) spr.x = baseX; } });
  }

  // A small faction pennant on a pole, carried beside a unit's head.
  private makePennant(colorHex: string | undefined): Phaser.GameObjects.Graphics {
    const col = Phaser.Display.Color.HexStringToColor(colorHex || '#dddddd').color;
    const g = this.add.graphics();
    g.lineStyle(2, 0x2a1d0e, 1).lineBetween(9, -6, 9, -34); // pole
    g.fillStyle(col, 1).fillTriangle(9, -34, 24, -30, 9, -25); // pennant
    g.fillStyle(0x000000, 0.18).fillTriangle(9, -30, 24, -30, 9, -25); // fold shade
    return g;
  }

  // A tiny dust puff under a marching unit's feet (sells "army on the move").
  private marchPuff(x: number, y: number): void {
    const v = this.cameras.main.worldView;
    if (x < v.x || x > v.right || y < v.y || y > v.bottom) return; // on-screen only
    const g = this.add.graphics().setDepth(DEPTH_ENTITY + y * 0.01 - 0.2);
    const st = { r: 2, a: 0.45 };
    this.tweens.add({
      targets: st, r: 9, a: 0, duration: 320, ease: 'Quad.Out',
      onUpdate: () => { g.clear(); g.fillStyle(0xe8dcc0, st.a).fillEllipse(x, y + 6, st.r * 2, st.r); },
      onComplete: () => g.destroy(),
    });
  }

  // A soft dust ring at ground level (unit spawn / building raise).
  private dustRing(x: number, y: number): void {
    const g = this.add.graphics().setDepth(DEPTH_ENTITY + y * 0.01 - 0.1);
    const st = { r: 6, a: 0.7 };
    this.tweens.add({
      targets: st, r: 26, a: 0, duration: 360, ease: 'Cubic.Out',
      onUpdate: () => { g.clear(); g.lineStyle(3, 0xe8dcc0, st.a).strokeEllipse(x, y + 8, st.r * 2, st.r); },
      onComplete: () => g.destroy(),
    });
  }

  // A celebratory expanding sparkle ring in a player's colour (level-up, tech).
  private sparkleRing(x: number, y: number, colorHex: string): void {
    const tint = Phaser.Display.Color.HexStringToColor(colorHex || '#ffe87a').color;
    const g = this.add.graphics().setDepth(206);
    const st = { r: 14, a: 1 };
    this.tweens.add({
      targets: st, r: 90, a: 0, duration: 620, ease: 'Cubic.Out',
      onUpdate: () => { g.clear(); g.lineStyle(4, tint, st.a).strokeCircle(x, y, st.r); },
      onComplete: () => g.destroy(),
    });
    // A few rising sparks.
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const s = this.add.graphics().setDepth(207);
      s.fillStyle(0xfff2ad, 1).fillCircle(0, 0, 2.5);
      s.setPosition(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12);
      this.tweens.add({ targets: s, x: x + Math.cos(ang) * 60, y: y + Math.sin(ang) * 60 - 20, alpha: 0,
        duration: 600, ease: 'Cubic.Out', onComplete: () => s.destroy() });
    }
  }

  // Spawn-in pop: a new unit/building scales up from small with a dust ring.
  private spawnPop(target: Phaser.GameObjects.GameObject & { setScale: (n: number) => any; scale: number }, finalScale: number, x: number, y: number): void {
    (target as any).setScale(finalScale * 0.45);
    (target as any).setAlpha?.(0.6);
    this.tweens.add({ targets: target, scale: finalScale, alpha: 1, duration: 230, ease: 'Back.Out' });
    this.dustRing(x, y);
  }

  // Push a notification to the HUD (toast + optional minimap ping). A throttle
  // key/window stops repeat events (e.g. a fort taking damage every beat) from
  // flooding the feed.
  private emitEvent(kind: string, text: string, opts: { x?: number; y?: number; color?: string; throttleKey?: string; throttleMs?: number } = {}): void {
    const key = opts.throttleKey ?? kind;
    const now = this.time.now;
    if (opts.throttleMs && now - (this.lastEventAt.get(key) ?? -1e9) < opts.throttleMs) return;
    this.lastEventAt.set(key, now);
    const cb = this.game.registry.get('onGameEvent') as ((e: GameEvent) => void) | undefined;
    if (cb) cb({ id: ++this.eventSeq, kind, text, x: opts.x, y: opts.y, color: opts.color });
  }

  // Screen-edge arrows pointing at off-screen battles involving my units, so a
  // fight in another lane never goes unnoticed. Drawn in screen space (camera-
  // locked) and refreshed on a timer.
  private tickBattleArrows(): void {
    if (!this.battleArrows) return;
    const g = this.battleArrows;
    g.clear();
    const myId = this.client?.sessionId;
    if (!myId) return;
    const view = this.cameras.main.worldView;
    // Cluster my off-screen fighting units into a few rough battle centres.
    const clusters: { x: number; y: number; n: number }[] = [];
    this.unitGfx.forEach(u => {
      if (u.container.getData('fighting') !== true) return;
      if (u.container.getData('ownerId') !== myId) return;
      const x = u.container.x, y = u.container.y;
      if (Phaser.Geom.Rectangle.Contains(view, x, y)) return; // on-screen already
      const c = clusters.find(c => Math.hypot(c.x - x, c.y - y) < 600);
      if (c) { c.x = (c.x * c.n + x) / (c.n + 1); c.y = (c.y * c.n + y) / (c.n + 1); c.n++; }
      else clusters.push({ x, y, n: 1 });
    });
    if (clusters.length === 0) return;
    const cam = this.cameras.main;
    const sw = cam.width, sh = cam.height;
    const cx = sw / 2, cy = sh / 2;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.time.now / 260));
    clusters.slice(0, 4).forEach(cl => {
      // Direction from screen centre to the battle, in screen space.
      const sx = (cl.x - cam.scrollX) * cam.zoom, sy = (cl.y - cam.scrollY) * cam.zoom;
      const ang = Math.atan2(sy - cy, sx - cx);
      const m = 30; // edge margin
      const hw = cx - m, hh = cy - m;
      // Clamp the centre→battle ray to the screen rectangle edge.
      const tx = Math.abs(Math.cos(ang)) < 1e-3 ? Infinity : hw / Math.abs(Math.cos(ang));
      const ty = Math.abs(Math.sin(ang)) < 1e-3 ? Infinity : hh / Math.abs(Math.sin(ang));
      const t = Math.min(tx, ty);
      const ex = cx + Math.cos(ang) * t, ey = cy + Math.sin(ang) * t;
      g.fillStyle(0xff5a4a, pulse);
      g.lineStyle(2, 0x3a1410, pulse);
      // A triangle pointing outward along `ang`.
      const s = 13;
      const p1 = { x: ex + Math.cos(ang) * s, y: ey + Math.sin(ang) * s };
      const p2 = { x: ex + Math.cos(ang + 2.5) * s, y: ey + Math.sin(ang + 2.5) * s };
      const p3 = { x: ex + Math.cos(ang - 2.5) * s, y: ey + Math.sin(ang - 2.5) * s };
      g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      g.strokeTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    });
  }

  // Combat intensity → battle-music layer. Counts engaged units (any side) and
  // ramps the layer in; a handful of duellists is mild, a big clash is loud.
  private updateBattleMusic(): void {
    let fighting = 0;
    this.unitGfx.forEach(u => { if (u.container.getData('fighting') === true) fighting++; });
    setBattleIntensity(Math.min(1, fighting / 6));
  }

  /** Shake the camera, but only when the event is on (or near) screen. */
  private shakeAt(x: number, y: number, intensity: number, duration: number): void {
    const v = this.cameras.main.worldView;
    const pad = 200;
    if (x < v.x - pad || x > v.right + pad || y < v.y - pad || y > v.bottom + pad) return;
    this.cameras.main.shake(duration, intensity);
  }

  // Big celebratory/ominous flourish when a fort changes hands: a colour shockwave,
  // a smoke burst, a rising banner, a screen shake and a sting.
  private captureFlourish(x: number, y: number, colorHex: string, mine: boolean, loud: boolean): void {
    const tint = Phaser.Display.Color.HexStringToColor(colorHex || '#ffffff').color;

    // Expanding shockwave ring in the new owner's colour.
    const ring = this.add.graphics().setDepth(205);
    const ringObj = { r: 20, a: 1 };
    this.tweens.add({
      targets: ringObj, r: 180, a: 0, duration: 700, ease: 'Cubic.Out',
      onUpdate: () => { ring.clear(); ring.lineStyle(5, tint, ringObj.a).strokeCircle(x, y, ringObj.r); },
      onComplete: () => ring.destroy(),
    });

    // Smoke/explosion burst at the keep.
    if (this.textures.exists('explosion')) {
      const boom = this.add.sprite(x, y - 20, 'explosion').setScale(1.3).setDepth(206);
      boom.play('explosion_anim');
      boom.once('animationcomplete', () => boom.destroy());
    }

    // Quiet variant (a distant, scouted capture): just the visual pop.
    if (!loud) {
      playSfx('building_destroyed', { volume: 0.3, x, y, throttleMs: 200, throttleKey: 'capture' });
      return;
    }

    // Rising banner — only when the capture involves the player.
    const label = mine ? 'Fortress Captured!' : 'Fortress Lost!';
    const banner = this.add.text(x, y - 70, label, {
      fontSize: '20px', color: mine ? '#ffe87a' : '#ff6a5a', fontFamily: '"Trebuchet MS", Verdana, sans-serif',
      fontStyle: 'bold', stroke: '#241405', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(210).setScale(0.4);
    this.tweens.add({ targets: banner, scale: 1, duration: 260, ease: 'Back.Out' });
    this.tweens.add({
      targets: banner, y: y - 120, alpha: 0, delay: 900, duration: 700, ease: 'Power2',
      onComplete: () => banner.destroy(),
    });

    // Flag-raise: a pennant in the new owner's colour climbs the keep and waves.
    const flag = this.add.graphics().setDepth(211);
    const drawFlag = (wave: number) => {
      flag.clear();
      flag.lineStyle(3, 0x3a2a14, 1).lineBetween(0, 0, 0, -34);          // pole
      flag.fillStyle(tint, 1);
      flag.fillTriangle(0, -34, 26 + wave, -28, 0, -20);                  // pennant
    };
    drawFlag(0);
    flag.setPosition(x, y - 6).setScale(1, 0); // rolled up, unfurls upward
    this.tweens.add({ targets: flag, scaleY: 1, duration: 320, ease: 'Back.Out' });
    let waveT = 0;
    const waveEv = this.time.addEvent({ delay: 90, loop: true, callback: () => { waveT++; drawFlag(Math.sin(waveT * 0.6) * 4); } });
    this.tweens.add({ targets: flag, alpha: 0, delay: 1600, duration: 600,
      onComplete: () => { waveEv.remove(); flag.destroy(); } });

    this.shakeAt(x, y, mine ? 0.008 : 0.006, 380);
    playSfx('building_destroyed', { volume: 0.5, x, y });
    playSfx(mine ? 'unit_recruit' : 'coins_gold', { volume: 0.6, x, y });
  }

  // Win moment: a camera zoom-punch, fireworks across the view, and a confetti
  // shower — only fired for the local winner. Defeat gets a brief dark dim.
  private victoryCelebration(won: boolean): void {
    const cam = this.cameras.main;
    if (!won) {
      cam.flash(600, 10, 10, 16); // brief dark wash
      return;
    }
    const z0 = cam.zoom;
    this.tweens.add({ targets: cam, zoom: z0 * 1.12, duration: 220, yoyo: true, ease: 'Quad.Out' });
    const myHex = this.client?.sessionId ? (this.playerColors.get(this.client.sessionId) || '#ffe87a') : '#ffe87a';
    const palette = ['#ffe87a', '#ff7a7a', '#7ad1ff', '#9cff7a', myHex];
    const v = cam.worldView;
    // Staggered firework bursts.
    for (let i = 0; i < 9; i++) {
      this.time.delayedCall(i * 260, () => {
        const fx = v.x + 60 + Math.random() * (v.width - 120);
        const fy = v.y + 50 + Math.random() * (v.height * 0.55);
        this.sparkleRing(fx, fy, Phaser.Utils.Array.GetRandom(palette));
        if (this.textures.exists('explosion')) {
          const boom = this.add.sprite(fx, fy, 'explosion').setScale(0.9 + Math.random() * 0.5).setDepth(208)
            .setTint(Phaser.Display.Color.HexStringToColor(Phaser.Utils.Array.GetRandom(palette)).color);
          boom.play('explosion_anim');
          boom.once('animationcomplete', () => boom.destroy());
        }
      });
    }
    // Confetti shower from the top of the view.
    for (let i = 0; i < 40; i++) {
      const cx = v.x + Math.random() * v.width;
      const cy = v.y - 20 - Math.random() * 60;
      const rect = this.add.rectangle(cx, cy, 5, 9, Phaser.Display.Color.HexStringToColor(Phaser.Utils.Array.GetRandom(palette)).color)
        .setDepth(209).setAngle(Math.random() * 360);
      this.tweens.add({
        targets: rect, y: cy + v.height + 80, angle: rect.angle + 360 + Math.random() * 360,
        x: cx + (Math.random() - 0.5) * 120, duration: 2200 + Math.random() * 1400, delay: Math.random() * 700,
        ease: 'Quad.In', onComplete: () => rect.destroy(),
      });
    }
    playSfx('victory', { volume: 0.5 });
  }

  // ── Selection ──────────────────────────────────────────────
  private selectEntity(type: SelectionType, id: string, name: string, data?: any): void {
    if (type !== 'intersection') this.hideRadialMenu();
    playSfx('ui_click', { volume: 0.4, throttleMs: 60 });
    this.selArmyLaneKey = ''; this.selArmyRoadId = ''; this.clearArmyLane();
    this.selection = { type, id, name, data };
    this.redrawSelectionRing();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
  }

  // ── Interactive clash: lane army selection + orders ──────────
  /** Canonical physical-lane key for a road (direction-independent). */
  private laneKeyOf(roadId: string): string {
    const r = this.roadsById.get(roadId) as any;
    return r ? [r.fromId, r.toId].sort().join('|') : '';
  }

  /** Click near a lane I have troops on → select that lane's army to command it. */
  private selectArmyAtPoint(world: { x: number; y: number }): boolean {
    const myId = this.client?.sessionId;
    if (!myId) return false;
    let bestRoad: any = null, bestD = 72 * 72;
    this.roadsById.forEach((r: any) => {
      for (const pt of r.splinePoints) {
        const d = Phaser.Math.Distance.Squared(world.x, world.y, pt.x, pt.y);
        if (d < bestD) { bestD = d; bestRoad = r; }
      }
    });
    if (!bestRoad) return false;
    const laneKey = this.laneKeyOf(bestRoad.id);
    let has = false;
    this.unitGfx.forEach(u => {
      if (has || u.container.getData('ownerId') !== myId || u.container.getData('isVillager')) return;
      if (u.container.getData('laneKey') === laneKey) has = true;
    });
    if (!has) return false;
    playSfx('ui_click', { volume: 0.4, throttleMs: 60 });
    this.selArmyLaneKey = laneKey;
    this.selArmyRoadId = bestRoad.id;
    this.drawArmyLane(bestRoad);
    this.refreshArmySelection();
    return true;
  }

  /** Recompute the selected army's size/health/order/cooldown and push to the HUD. */
  private refreshArmySelection(): void {
    const myId = this.client?.sessionId;
    if (!myId || !this.selArmyLaneKey) return;
    let count = 0, hpSum = 0, cx = 0, cy = 0, order = '';
    this.unitGfx.forEach(u => {
      if (u.container.getData('ownerId') !== myId || u.container.getData('isVillager')) return;
      if (u.container.getData('laneKey') !== this.selArmyLaneKey) return;
      count++;
      hpSum += (u.container.getData('hpRatio') as number) ?? 1;
      cx += u.container.x; cy += u.container.y;
      if (u.container.getData('order')) order = u.container.getData('order');
    });
    if (count === 0) { this.clearSelection(); return; }
    cx /= count; cy /= count;
    const rallyReadyIn = Math.max(0, Math.round((this.myRallyReadyTick - this.serverTick) * 0.1));
    const data = { lane: this.selArmyRoadId, laneKey: this.selArmyLaneKey, count, hpPct: Math.round((hpSum / count) * 100), order, rallyReadyIn, x: cx, y: cy };
    this.selection = { type: 'army', id: this.selArmyLaneKey, name: 'Army', data };
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
  }

  private drawArmyLane(road: any): void {
    if (!this.armyLaneGfx) this.armyLaneGfx = this.add.graphics().setDepth(39);
    const g = this.armyLaneGfx;
    g.clear();
    const pts = road.splinePoints as { x: number; y: number }[];
    if (!pts || pts.length < 2) return;
    g.lineStyle(10, 0xffe07a, 0.22);
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
  }

  private clearArmyLane(): void {
    if (this.armyLaneGfx) this.armyLaneGfx.clear();
  }

  /** Keyboard/HUD: order the selected army. command: '' push | 'hold' | 'fallback'. */
  private issueArmyOrder(command: string): void {
    if (this.selection.type !== 'army' || !this.selArmyRoadId) return;
    this.client?.armyOrder(this.selArmyRoadId, command);
    playSfx('ui_click', { volume: 0.4, throttleMs: 60 });
  }

  // ── Rhythm cast: the Rally ability is cast as an osu!-style beat combo ──
  /** Start the rhythm cast for the selected army (from the R key or HUD button). */
  castRally(): void {
    if (this.rtsMode) return; // no Rally rhythm-cast in Open Field (real-time mode)
    if (this.castActive || this.selection.type !== 'army' || !this.selArmyRoadId) return;
    if (this.serverTick < this.myRallyReadyTick) return; // still on cooldown
    this.castActive = true;
    this.castLane = this.selArmyRoadId;
    const now = this.time.now;
    // Lay notes on the upcoming downbeats, with enough lead for the first approach.
    let firstBeat = this.beatClock + BEAT_PERIOD_MS;
    while (firstBeat - now < BEAT_PERIOD_MS * 0.6) firstBeat += BEAT_PERIOD_MS;
    this.castNotes = [];
    for (let i = 0; i < RHYTHM_NOTES; i++) this.castNotes.push({ target: firstBeat + i * BEAT_PERIOD_MS, judged: false, score: 0 });
    this.buildCastOverlay();
    this.emitEvent('rallycast', 'Rally! Tap SPACE on each beat', { color: '#ffd54a', throttleMs: 300, throttleKey: 'rallycast' });
  }

  private buildCastOverlay(): void {
    const cam = this.cameras.main;
    const c = this.add.container(cam.width / 2, cam.height * 0.64).setScrollFactor(0).setDepth(310);
    const R = 36;
    const base = this.add.graphics();
    base.fillStyle(0x000000, 0.32).fillCircle(0, 0, R + 10);
    base.fillStyle(0xffe07a, 0.16).fillCircle(0, 0, R);
    base.lineStyle(4, 0xffe07a, 0.95).strokeCircle(0, 0, R);
    const prompt = this.add.text(0, -R - 30, 'RALLY — tap SPACE on the beat', {
      fontSize: '14px', color: '#ffe9a8', fontFamily: 'monospace', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);
    const ring = this.add.graphics();
    const combo = this.add.text(0, R + 24, '', { fontSize: '13px', color: '#fff', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    c.add([base, ring, prompt, combo]);
    this.castGfx = c; this.castRing = ring; this.castComboText = combo;
  }

  /** Per-frame: shrink the approach ring onto the beat and auto-miss late notes. */
  private updateRhythmCast(): void {
    if (this.selection.type !== 'army') { this.endRhythmCast(); return; } // army gone
    const now = this.time.now;
    this.castNotes.forEach(n => {
      if (!n.judged && now > n.target + RHYTHM_GOOD_MS) { n.judged = true; n.score = 0; this.spawnJudgment('MISS', '#ff6a5a'); }
    });
    const cur = this.castNotes.find(n => !n.judged);
    if (this.castRing) {
      this.castRing.clear();
      if (cur) {
        const dt = cur.target - now;
        const f = Phaser.Math.Clamp(dt / RHYTHM_APPROACH_MS, 0, 1);
        const r = 36 + f * 124; // 160 → 36 as the beat lands
        const close = dt < RHYTHM_GOOD_MS;
        this.castRing.lineStyle(5, close ? 0xfff1a8 : 0x9fd2ff, 0.95).strokeCircle(0, 0, r);
      }
    }
    if (this.castNotes.length > 0 && this.castNotes.every(n => n.judged)) this.finalizeRhythmCast();
  }

  /** A keypress/tap during the cast judges the current note by its beat offset. */
  private handleRhythmHit(): void {
    if (!this.castActive) return;
    const cur = this.castNotes.find(n => !n.judged);
    if (!cur) return;
    const offset = this.time.now - cur.target;
    if (offset < -(RHYTHM_GOOD_MS + 130)) return; // way too early — don't waste the note
    const a = Math.abs(offset);
    let score = 0, label = 'MISS', color = '#ff6a5a';
    if (a <= RHYTHM_PERFECT_MS) { score = 1; label = 'PERFECT'; color = '#7ad17a'; }
    else if (a <= RHYTHM_GOOD_MS) { score = 0.55; label = 'GOOD'; color = '#ffe07a'; }
    cur.judged = true; cur.score = score;
    this.spawnJudgment(label, color);
    const hits = this.castNotes.filter(n => n.judged && n.score > 0).length; // rising pitch with the streak
    if (score > 0) {
      playSfx(score >= 1 ? 'sword_clash' : 'sword_clash2', { volume: 0.45, rate: 0.92 + hits * 0.06, throttleMs: 20, throttleKey: 'rhythm' });
      if (score >= 1) this.cameras.main.shake(110, 0.0035); // light punch on a perfect note
    } else {
      playSfx('building_destroyed', { volume: 0.25, throttleMs: 30, throttleKey: 'rhythm' });
    }
  }

  private spawnJudgment(text: string, color: string, big = false): void {
    if (!this.castGfx) return;
    const t = this.add.text(this.castGfx.x, this.castGfx.y - 2, text, {
      fontSize: big ? '24px' : '18px', color, fontFamily: 'monospace', fontStyle: 'bold', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(322);
    this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 540, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  private finalizeRhythmCast(): void {
    const power = this.castNotes.reduce((s, n) => s + n.score, 0) / Math.max(1, this.castNotes.length);
    this.lastCastPower = power;
    this.client?.commanderRally(this.castLane, power);
    const tier = power >= 0.95 ? 'PERFECT RALLY!' : power >= 0.6 ? 'Great Rally!' : power > 0 ? 'Rally' : 'Weak Rally…';
    this.spawnJudgment(tier, power >= 0.6 ? '#ffd54a' : '#cfcfcf', true);
    this.endRhythmCast();
  }

  private endRhythmCast(): void {
    this.castActive = false;
    this.castNotes = [];
    if (this.castGfx) { this.castGfx.destroy(); this.castGfx = null; }
    this.castRing = null; this.castComboText = null;
  }

  /** Beat-timed rally flourish on an army's centre (fired when the cast confirms),
   *  its intensity scaled by how well the rhythm combo was hit. */
  private rallyPulse(x: number, y: number): void {
    const p = this.lastCastPower;
    this.sparkleRing(x, y, p >= 0.6 ? '#ffd54a' : '#b9c0c8');
    this.impactBurst(x, y, p >= 0.6);
    if (p >= 0.95) this.sparkleRing(x, y - 12, '#fff1a8');
    this.shakeAt(x, y, 0.003 + 0.004 * p, 160);
    this.emitEvent('rally', p >= 0.95 ? 'Perfect Rally!' : 'Rally!', { x, y, color: '#ffd54a', throttleMs: 400, throttleKey: 'rally' });
    playSfx('coins_gold', { volume: 0.4, x, y, throttleMs: 300, throttleKey: 'rally' });
  }

  // Make the active building/city glow so the player sees what's selected,
  // instead of a hard ring. Pulses gently via the WebGL glow post-FX.
  private setGlow(container: Phaser.GameObjects.Container | undefined | null): void {
    this.clearGlow();
    if (!container || !container.postFX) return;
    const fx = container.postFX.addGlow(0xffe9a8, 2, 0, false, 0.08, 14);
    this.glowTarget = container;
    this.glowTween = this.tweens.add({
      targets: fx, outerStrength: 6, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
  }

  private clearGlow(): void {
    if (this.glowTween) { this.glowTween.stop(); this.glowTween = null; }
    if (this.glowTarget && this.glowTarget.postFX) this.glowTarget.postFX.clear();
    this.glowTarget = null;
  }

  // Frame the selected object with the pack's four corner brackets, sized to
  // the object. Replaces the old yellow ring. half = distance from centre to
  // each corner. A gentle pulse draws the eye without being noisy.
  private showSelMarker(x: number, y: number, half: number): void {
    this.clearSelMarker();
    const m = this.add.container(x, y).setDepth(41);
    const s = 0.6;
    const corners: [string, number, number][] = [
      ['sel_tl', -half, -half], ['sel_tr', half, -half],
      ['sel_bl', -half, half], ['sel_br', half, half],
    ];
    corners.forEach(([key, dx, dy]) => m.add(this.add.image(dx, dy, key).setScale(s)));
    this.selMarker = m;
    this.tweens.add({ targets: m, scale: { from: 1.06, to: 1 }, duration: 260, ease: 'Back.out' });
  }

  private clearSelMarker(): void {
    if (this.selMarker) { this.selMarker.destroy(); this.selMarker = null; }
  }

  private redrawSelectionRing(): void {
    if (!this.selectionRing) return;
    const { type, id, data } = this.selection;
    // The marker + glow only change when the *selection* changes — rebuilding
    // them (and their tweens) on every state sync caused a stutter. Gate on a
    // selection key; the influence overlay below still refreshes each sync.
    const key = data ? `${type}:${id}` : '';
    if (key !== this.selMarkerKey) {
      this.clearSelMarker();
      this.clearGlow();
      this.selMarkerKey = key;
      // Armies are a moving column shown via the lane highlight, not a fixed marker.
      if (data && type !== 'army') {
        const half = type === 'city' ? 80 : type === 'building' ? 48 : type === 'intersection' ? 30 : 36;
        this.showSelMarker(data.x, data.y, half);
        if (type === 'city') this.setGlow(this.cityGfx.get(id)?.gfx);
        else if (type === 'building') this.setGlow(this.buildingGfx.get(id)?.gfx);
      }
    }
    this.selectionRing.clear();
    if (data && type === 'city' && this.terrainInfo) {
      // Influence zone as terrain tiles (land cells within radius)
      const { grid, cols, rows } = this.terrainInfo;
      const rad = data.influenceRadius;
      this.selectionRing.fillStyle(0xffe87a, 0.16);
      const c0 = Math.max(0, Math.floor((data.x - rad) / TILE));
      const c1 = Math.min(cols - 1, Math.floor((data.x + rad) / TILE));
      const r0 = Math.max(0, Math.floor((data.y - rad) / TILE));
      const r1 = Math.min(rows - 1, Math.floor((data.y + rad) / TILE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (grid[r][c] === WATER) continue;
          const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
          if (Math.hypot(cx - data.x, cy - data.y) > rad) continue;
          this.selectionRing.fillRect(c * TILE + 2, r * TILE + 2, TILE - 4, TILE - 4);
        }
      }
    }
  }

  private clearSelection(): void {
    this.hideRadialMenu();
    this.selArmyLaneKey = ''; this.selArmyRoadId = ''; this.clearArmyLane();
    this.selection = { type: 'none', id: '', name: '' };
    if (this.selectionRing) this.selectionRing.clear();
    this.clearSelMarker();
    this.selMarkerKey = '';
    this.clearGlow();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
  }

  // ── Camera ────────────────────────────────────────────────
  centerCamera(x: number, y: number): void {
    this.cameras.main.pan(x, y, 250, 'Power2');
  }

  private setupCameraControls(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.towerPlace) this.updateTowerGhost(p);
      if (this.rtsMode) {
        if (this.rtsBuild) { this.updateRtsBuildGhost(p); if (p.isDown && p.rightButtonDown()) this.panCamera(p); return; }
        // RTS: right-drag pans the camera, left-drag draws a selection box.
        if (p.isDown && p.rightButtonDown()) { this.dragMoved = true; this.panCamera(p); }
        else if (p.isDown && p.leftButtonDown()) this.rtsUpdateDrag(p);
        return;
      }
      if (p.isDown && p.leftButtonDown()) {
        const dx = p.x - p.prevPosition.x;
        const dy = p.y - p.prevPosition.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
        this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
        this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
      }
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _objs: unknown[], _dx: number, dy: number) => {
      this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.3, 2));
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragMoved = false;
      if (this.rtsMode && p.leftButtonDown()) this.rtsDragStart = { x: p.x, y: p.y };
    });
    this.input.keyboard?.on('keydown-ESC', () => this.cancelTowerPlacement());
    // R rotates the selected crossroad's route arrow to the next exit.
    this.input.keyboard?.on('keydown-R', () => this.rotateIntersectionRoute());
    // Right-click sets a barracks' rally road: with a barracks selected, click the
    // outgoing road you want fresh troops to march down.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) return;
      if (this.rtsMode) { if (this.rtsBuild) this.cancelRtsBuild(); else if (this.towerPlace) this.cancelTowerPlacement(); return; } // RTS: right = pan/command (or cancel build)
      if (this.towerPlace) { this.cancelTowerPlacement(); return; } // right-click aborts placement
      // Any production building (barracks/archery/church) can set the rally road.
      if (this.selection.type !== 'building' || !['barracks', 'archery', 'church'].includes(this.selection.data?.type)) return;
      const cityId = this.selection.data.cityId;
      const exits = [...this.roadsById.values()].filter(r => r.fromId === cityId);
      if (exits.length === 0) return;
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      let best: RoadData | null = null, bestD = Infinity;
      for (const road of exits) {
        for (const pt of road.splinePoints) {
          const d = Phaser.Math.Distance.Squared(world.x, world.y, pt.x, pt.y);
          if (d < bestD) { bestD = d; best = road; }
        }
      }
      // Per-building rally: this specific production building marches its troops here.
      if (best) { this.client?.setBuildingRally(this.selection.id, best.id); this.flashRally(best); }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.towerPlace && !this.dragMoved) {
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        const s = this.snapTile(w.x, w.y);
        if (this.towerSpotValid(s.x, s.y)) {
          this.client?.placeTower(this.towerPlace.cityId, s.x, s.y);
          playSfx('build_place', { volume: 0.55 });
          this.cancelTowerPlacement();
        }
        return; // swallow the click while placing
      }
      if (this.rtsMode) {
        if (p.button === 2) { if (!this.dragMoved) this.rtsRightCommand(p); return; } // right-click = command
        this.rtsEndDrag(p); // left release = finalize box/click selection
        return;
      }
      if (this.dragMoved) return;
      // During a rhythm cast, a tap anywhere is a beat hit (not a selection).
      if (this.castActive) { this.handleRhythmHit(); return; }
      const hits = this.input.hitTestPointer(p);
      const hitInteractive = hits.some(h => (h as any).input && (h as any).input.enabled);
      if (hitInteractive) return;
      // Empty-ground click: try to select my army on the nearest lane; only clear
      // the selection if there's no army to command there.
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      if (!this.selectArmyAtPoint(world)) this.clearSelection();
    });
    // Keyboard commands for the selected army (desktop): 1 push · 2 hold · 3 fall back · R Rally.
    this.input.keyboard?.on('keydown-ONE', () => this.issueArmyOrder(''));
    this.input.keyboard?.on('keydown-TWO', () => this.issueArmyOrder('hold'));
    this.input.keyboard?.on('keydown-THREE', () => this.issueArmyOrder('fallback'));
    this.input.keyboard?.on('keydown-R', () => this.castRally());
    this.input.keyboard?.on('keydown-SPACE', () => { if (this.castActive) this.handleRhythmHit(); });
    // RTS: F toggles the move formation; B/H/Y/U enter build placement; ESC cancels.
    this.input.keyboard?.on('keydown-F', () => { if (this.rtsMode) this.rtsFormation = this.rtsFormation === 'box' ? 'line' : 'box'; });
    this.input.keyboard?.on('keydown-B', () => this.startRtsBuild('barracks'));
    this.input.keyboard?.on('keydown-H', () => this.startRtsBuild('house'));
    this.input.keyboard?.on('keydown-Y', () => this.startRtsBuild('archery'));
    this.input.keyboard?.on('keydown-U', () => this.startRtsBuild('church'));
    this.input.keyboard?.on('keydown-ESC', () => { if (this.rtsMode) { this.cancelRtsBuild(); this.rtsApplySelection([]); } });
  }

  // ── RTS (Open Field) selection & commands ──
  private panCamera(p: Phaser.Input.Pointer): void {
    const dx = p.x - p.prevPosition.x, dy = p.y - p.prevPosition.y;
    this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
    this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
  }

  private ensureRtsGfx(): void {
    if (!this.rtsSelBox) this.rtsSelBox = this.add.graphics().setScrollFactor(0).setDepth(240);
    if (!this.rtsSelRings) this.rtsSelRings = this.add.graphics().setDepth(9);
  }

  private rtsUpdateDrag(p: Phaser.Input.Pointer): void {
    if (!this.rtsDragStart) return;
    const dx = p.x - this.rtsDragStart.x, dy = p.y - this.rtsDragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) this.dragMoved = true;
    if (!this.dragMoved) return;
    this.ensureRtsGfx();
    const g = this.rtsSelBox!; g.clear();
    g.lineStyle(1.5, 0x7CFC00, 0.95).fillStyle(0x7CFC00, 0.12);
    const x = Math.min(this.rtsDragStart.x, p.x), y = Math.min(this.rtsDragStart.y, p.y);
    g.fillRect(x, y, Math.abs(dx), Math.abs(dy)); g.strokeRect(x, y, Math.abs(dx), Math.abs(dy));
  }

  private rtsEndDrag(p: Phaser.Input.Pointer): void {
    if (this.rtsBuild) {
      if (!this.dragMoved) {
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        const s = this.snapTile(w.x, w.y);
        this.client?.buildAt(this.rtsBuild.type, s.x, s.y);
        playSfx('build_place', { volume: 0.5 });
      }
      this.cancelRtsBuild(); this.rtsDragStart = null; return;
    }
    const start = this.rtsDragStart; this.rtsDragStart = null;
    if (this.rtsSelBox) this.rtsSelBox.clear();
    if (this.dragMoved && start && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 6) {
      const a = this.cameras.main.getWorldPoint(Math.min(start.x, p.x), Math.min(start.y, p.y));
      const b = this.cameras.main.getWorldPoint(Math.max(start.x, p.x), Math.max(start.y, p.y));
      const ids: string[] = [];
      this.unitGfx.forEach((u, id) => {
        if (u.container.getData('isVillager') === true) return;
        if (u.container.getData('ownerId') !== this.client?.sessionId) return;
        const x = u.container.x, y = u.container.y;
        if (x >= a.x && x <= b.x && y >= a.y && y <= b.y) ids.push(id);
      });
      this.rtsApplySelection(ids);
      return;
    }
    // Single click: let an interactive entity (city/building) handle it; else
    // select a single unit under the cursor, or clear.
    const hits = this.input.hitTestPointer(p);
    if (hits.some(h => (h as any).input && (h as any).input.enabled)) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const one = this.rtsUnitAt(world, false);
    if (one) this.rtsApplySelection([one]);
    else { this.rtsApplySelection([]); this.clearSelection(); }
  }

  /** Nearest own (or enemy, if `enemy`) non-villager unit within 26px of a point. */
  private rtsUnitAt(world: { x: number; y: number }, enemy: boolean): string | null {
    let best: string | null = null, bestD = 26;
    this.unitGfx.forEach((u, id) => {
      if (u.container.getData('isVillager') === true) return;
      const own = u.container.getData('ownerId') === this.client?.sessionId;
      if (enemy ? own : !own) return;
      const d = Math.hypot(u.container.x - world.x, u.container.y - world.y);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  private rtsApplySelection(ids: string[]): void {
    this.rtsSel = new Set(ids);
    if (ids.length > 0) this.clearSelection(); // close any entity panel
    // Push a lightweight readout to React (count + formation).
    const cb = this.game.registry.get('onUnitSelection') as ((n: number, f: string) => void) | undefined;
    cb?.(this.rtsSel.size, this.rtsFormation);
  }

  private rtsRightCommand(p: Phaser.Input.Pointer): void {
    if (this.rtsSel.size === 0) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const ids = [...this.rtsSel];
    const enemy = this.rtsUnitAt(world, true);
    if (enemy) this.client?.attackMove(ids, world.x, world.y);
    else this.client?.moveUnits(ids, world.x, world.y, this.rtsFormation);
    this.pingMove(world.x, world.y, !!enemy);
  }

  // Enter free-placement mode for a building (RTS build-by-sight). A ghost
  // follows the cursor; left-click sends build_at (server validates sight/enemies).
  startRtsBuild(type: string): void {
    if (!this.rtsMode || !this.client) return;
    this.cancelRtsBuild();
    const color = factionOf(this.playerColors.get(this.client.sessionId || ''));
    const tex: Record<string, string> = { barracks: `barracks2_${color}`, house: `house2a_${color}`, archery: `archery_${color}`, church: `monastery_${color}` };
    const scl: Record<string, number> = { barracks: 0.5, house: 0.55, archery: 0.5, church: 0.5 };
    if (!tex[type]) return;
    const img = this.add.image(0, 0, tex[type]).setScale(this.rtsScale(scl[type])).setOrigin(0.5, 0.7).setAlpha(0.6).setDepth(196);
    this.rtsBuild = { type, img, ok: true };
  }
  private cancelRtsBuild(): void { if (this.rtsBuild) { this.rtsBuild.img.destroy(); this.rtsBuild = null; } }
  private updateRtsBuildGhost(p: Phaser.Input.Pointer): void {
    if (!this.rtsBuild) return;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const s = this.snapTile(w.x, w.y);
    this.rtsBuild.img.setPosition(s.x, s.y);
  }

  // A quick expanding ring where a move/attack order was issued.
  private pingMove(x: number, y: number, attack: boolean): void {
    const ring = this.add.graphics().setDepth(8);
    const col = attack ? 0xff5a4a : 0x7CFC00;
    let r = 4;
    const ev = this.time.addEvent({
      delay: 16, repeat: 14, callback: () => {
        r += 2.4; ring.clear(); ring.lineStyle(2, col, Math.max(0, 1 - r / 40)).strokeCircle(x, y, r);
        if (ev.getRepeatCount() === 0) ring.destroy();
      },
    });
  }

  // ── Tower placement (free placement inside the city's influence) ──
  beginTowerPlacement(cityId: string): void {
    const city = this.cityGfx.get(cityId);
    if (!city) return;
    this.cancelTowerPlacement();
    const d = city.data;
    const color = factionOf(this.playerColors.get(d.ownerId));
    // Towers reach 30% beyond the fort's influence ring (mirrors the server).
    const radius = d.influenceRadius * 1.3;
    const ring = this.add.graphics().setDepth(195);
    ring.lineStyle(3, 0xffe87a, 0.85).strokeCircle(d.x, d.y, radius);
    const highlight = this.add.graphics().setDepth(195.5);
    const tower = this.add.image(0, 0, `tower2_${color}`).setScale(0.62).setOrigin(0.5, 0.72).setAlpha(0.75);
    const ghost = this.add.container(d.x, d.y, [tower]).setDepth(196);
    this.towerPlace = { cityId, cx: d.x, cy: d.y, radius, ghost, tower, ring, highlight };
  }

  // Snap a world point to the centre of its terrain tile.
  private snapTile(x: number, y: number): { x: number; y: number } {
    return { x: (Math.floor(x / TILE) + 0.5) * TILE, y: (Math.floor(y / TILE) + 0.5) * TILE };
  }

  private towerSpotValid(x: number, y: number): boolean {
    if (!this.towerPlace || !this.terrainInfo) return false;
    if (Math.hypot(x - this.towerPlace.cx, y - this.towerPlace.cy) > this.towerPlace.radius) return false;
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    const g = this.terrainInfo.grid[r]?.[c];
    return g === GRASS || g === ELEV; // land, off water and roads
  }

  private updateTowerGhost(p: Phaser.Input.Pointer): void {
    if (!this.towerPlace) return;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const s = this.snapTile(w.x, w.y);
    this.towerPlace.ghost.setPosition(s.x, s.y);
    const ok = this.towerSpotValid(s.x, s.y);
    this.towerPlace.tower.setTint(ok ? 0xffffff : 0xff6666);
    // Outline the target tile so placement reads as grid-snapped, not free.
    const hl = this.towerPlace.highlight;
    hl.clear();
    hl.lineStyle(2, ok ? 0x7CFC00 : 0xff6666, 0.95).fillStyle(ok ? 0x7CFC00 : 0xff6666, 0.18);
    hl.fillRect(s.x - TILE / 2, s.y - TILE / 2, TILE, TILE);
    hl.strokeRect(s.x - TILE / 2, s.y - TILE / 2, TILE, TILE);
  }

  private cancelTowerPlacement(): void {
    if (!this.towerPlace) return;
    this.towerPlace.ghost.destroy();
    this.towerPlace.ring.destroy();
    this.towerPlace.highlight.destroy();
    this.towerPlace = null;
  }

  // ── Exposed for React ────────────────────────────────────
  getClient(): GameClient | null { return this.client; }

  // ── Network ───────────────────────────────────────────────
  private syncState(state: any): void {
    if (state.players) {
      state.players.forEach((p: any, id: string) => this.playerColors.set(id, p.colorHex));
    }
    this.serverTick = state.tick || 0;
    this.rtsMode = state.gameMode === 'rts';

    if (!this.mapBuilt) {
      // Beat mode waits for the road network; RTS has no roads, so wait for cities.
      if (this.rtsMode) { if (!state.cities || state.cities.size === 0) return; }
      else if (!state.roads || state.roads.size === 0) return;
      this.buildMapFromState(state);
    }

    const myId = this.client?.sessionId;
    state.cities.forEach((s: any, id: string) => {
      const entry = this.cityGfx.get(id);
      if (!entry) return;
      const prevHealth = entry.data.health;
      const prevOwner = entry.data.ownerId;
      const prevLevel = entry.data.townHallLevel;
      // A fort changed hands — celebrate (or mourn) it.
      if (prevOwner !== s.ownerId) {
        const newReal = s.ownerId && s.ownerId !== 'pve';
        const mine = !!myId && s.ownerId === myId;
        const involved = (!!myId && (s.ownerId === myId || prevOwner === myId));
        const color = newReal ? (this.playerColors.get(s.ownerId) || '#cccccc') : '#9aa3ad';
        this.captureFlourish(entry.data.x, entry.data.y, color, mine, involved);
        if (mine) this.emitEvent('capture', `Captured ${entry.data.name}!`, { x: entry.data.x, y: entry.data.y, color: '#7ad17a' });
        else if (prevOwner === myId) this.emitEvent('lost', `Lost ${entry.data.name}!`, { x: entry.data.x, y: entry.data.y, color: '#ff6a5a' });
      }
      // Town-hall level-up flourish for my own keep.
      if (myId && s.townHallLevel > prevLevel && s.ownerId === myId && this.time.now - this.mapReadyAt > 1500) {
        this.sparkleRing(entry.data.x, entry.data.y - 10, this.playerColors.get(myId) || '#ffe87a');
        playSfx('coins_gold', { volume: 0.5, x: entry.data.x, y: entry.data.y });
        this.emitEvent('levelup', `${entry.data.name} reached Lv.${s.townHallLevel}`, { x: entry.data.x, y: entry.data.y, color: '#ffe87a' });
      }
      entry.data.ownerId = s.ownerId;
      entry.data.townHallLevel = s.townHallLevel;
      entry.data.influenceRadius = s.influenceRadius;
      entry.data.maxBuildings = s.maxBuildings;
      entry.data.health = s.health;
      entry.data.maxHealth = s.maxHealth;
      if (prevHealth > s.health) {
        this.showFloatingDamage(entry.data.x, entry.data.y - 40, prevHealth - s.health, '#ff8800');
        // Raid warning when one of my forts is being hit (throttled per fort).
        if (myId && s.ownerId === myId) {
          this.emitEvent('attack', `${entry.data.name} is under attack!`, {
            x: entry.data.x, y: entry.data.y, color: '#ff5a4a',
            throttleKey: `attack_${id}`, throttleMs: 7000,
          });
        }
      }
      this.refreshCityVisual(entry);
    });

    state.lairs.forEach((s: any, id: string) => {
      const entry = this.lairGfx.get(id);
      if (!entry) return;
      entry.data.health = s.health;
      entry.data.maxHealth = s.maxHealth;
      this.refreshLairVisual(entry);
    });

    if (state.objectives) state.objectives.forEach((s: any, id: string) => {
      const entry = this.objectiveGfx.get(id);
      if (!entry) return;
      const prevOwner = entry.data.ownerId;
      if (prevOwner !== s.ownerId) {
        const meta = this.objMeta(s.kind);
        const newReal = s.ownerId && this.playerColors.has(s.ownerId);
        const mine = !!myId && s.ownerId === myId;
        const involved = !!myId && (s.ownerId === myId || prevOwner === myId);
        const color = newReal ? (this.playerColors.get(s.ownerId) || '#cccccc') : '#9aa3ad';
        this.captureFlourish(entry.data.x, entry.data.y, color, mine, involved);
        if (mine) this.emitEvent('obj_take', `Seized the ${meta.name}!`, { x: entry.data.x, y: entry.data.y, color: '#ffe07a' });
        else if (prevOwner === myId) this.emitEvent('obj_lost', `Lost the ${meta.name}!`, { x: entry.data.x, y: entry.data.y, color: '#ff6a5a' });
      }
      entry.data.ownerId = s.ownerId;
      entry.data.capture = s.capture;
      entry.data.contenderId = s.contenderId;
      entry.data.contested = s.contested;
      this.refreshObjective(entry);
    });

    this.cityBuildingCounts.clear();
    const liveBuildings = new Set<string>();
    state.buildings.forEach((b: any) => {
      liveBuildings.add(b.id);
      this.drawBuilding({
        id: b.id, cityId: b.cityId, type: b.type, x: b.x, y: b.y,
        level: b.level || 1, health: b.health, maxHealth: b.maxHealth,
        autoProduceType: b.autoProduceType || '', produceReadyTick: b.produceReadyTick || 0,
        constructing: b.constructing, buildProgress: b.buildProgress,
      });
      // Construction sites render translucent + blue-tinted until the pawn finishes.
      const be = this.buildingGfx.get(b.id);
      if (be) {
        be.data.constructing = b.constructing; be.data.buildProgress = b.buildProgress;
        const img = (be.gfx.list || [])[0] as any;
        be.gfx.setAlpha(b.constructing ? 0.55 : 1);
        if (img) { if (b.constructing && img.setTint) img.setTint(0x88bbff); else if (img.clearTint) img.clearTint(); }
      }
      this.cityBuildingCounts.set(b.cityId, (this.cityBuildingCounts.get(b.cityId) || 0) + 1);
    });
    // Keep a selected building's panel live (auto-produce state + recruit cooldown).
    if (this.selection.type === 'building') {
      const e = this.buildingGfx.get(this.selection.id);
      if (e) {
        e.data.cooldownReadyIn = Math.max(0, Math.round(((e.data.produceReadyTick || 0) - this.serverTick) * 0.1));
        const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void) | undefined;
        if (onSelection) onSelection({ type: 'building', id: this.selection.id, name: this.selection.name, data: e.data });
      }
    }
    this.buildingGfx.forEach((entry, id) => {
      if (!liveBuildings.has(id)) {
        entry.gfx.destroy();
        this.buildingGfx.delete(id);
        playSfx('building_destroyed', { volume: 0.5, throttleMs: 300 });
        if (this.selection.type === 'building' && this.selection.id === id) this.clearSelection();
      }
    });
    if (this.rtsMode && state.trails) this.syncTrails(state);
    const onBuildingsUpdate = this.game.registry.get('onBuildingsUpdate') as ((c: Map<string, number>) => void);
    if (onBuildingsUpdate) onBuildingsUpdate(new Map(this.cityBuildingCounts));

    // Resource nodes
    if (state.resources) {
      const liveRes = new Set<string>();
      state.resources.forEach((r: any) => {
        liveRes.add(r.id);
        this.drawResource(r);
      });
      this.resourceGfx.forEach((entry, id) => {
        if (!liveRes.has(id)) {
          entry.gfx.destroy();
          this.resourceGfx.delete(id);
          if (this.selection.type === 'resource' && this.selection.id === id) this.clearSelection();
        }
      });
    }

    const syncedIds = new Set<string>();
    state.units.forEach((u: any) => {
      syncedIds.add(u.id);
      const prevHp = this.prevUnitHealth.get(u.id) ?? u.maxHealth;
      if (prevHp > u.health) {
        const pos = this.getUnitWorldPos(u);
        if (pos) {
          const counter = this.isCounterHit(pos.x, pos.y, u.ownerId, u.type);
          this.showFloatingDamage(pos.x, pos.y, prevHp - u.health, counter ? '#ffd54a' : '#ff4444', counter);
          this.impactBurst(pos.x, pos.y, counter);
        }
        this.flashUnit(u.id);
        this.recoilUnit(u.id);
      }
      this.prevUnitHealth.set(u.id, u.health);
      this.syncUnit(u);
    });
    this.unitGfx.forEach((u, id) => {
      if (!syncedIds.has(id)) {
        // Low health on last sight ⇒ it died in battle, show the death effect
        const ratio = (u.container.getData('hpRatio') as number) ?? 1;
        this.removeUnitVisual(id, ratio <= 0.45);
        this.prevUnitHealth.delete(id);
      }
    });

    // Keep the selected army's HUD readout (size/health/order/cooldown) live.
    if (this.selection.type === 'army') this.refreshArmySelection();

    if (myId && state.players) {
      const me = state.players.get(myId);
      if (me) {
        const onResourceUpdate = this.game.registry.get('onResourceUpdate') as (r: any) => void;
        if (onResourceUpdate) onResourceUpdate({
          wood: me.wood, food: me.food, gold: me.gold,
          popUsed: me.populationUsed, popCap: me.populationCap,
        });
        // Rally cooldown tracking + cast flourish (fires for keyboard or HUD button).
        this.myRallyReadyTick = me.rallyReadyTick || 0;
        if (this.prevRallyReadyTick < 0) {
          this.prevRallyReadyTick = this.myRallyReadyTick; // first sight: no flourish
        } else if (this.myRallyReadyTick > this.prevRallyReadyTick) {
          if (this.selection.type === 'army' && this.selection.data) {
            this.rallyPulse(this.selection.data.x, this.selection.data.y);
          }
          this.prevRallyReadyTick = this.myRallyReadyTick;
        }
        const techs = me.researchedTechs ? me.researchedTechs.split(',').filter(Boolean) : [];
        const onTechsUpdate = this.game.registry.get('onTechsUpdate') as ((t: string[]) => void) | undefined;
        if (onTechsUpdate) onTechsUpdate(techs);
        // Research-complete sparkle on my capital for each newly-finished tech
        // (seed the set on first sight so the initial load doesn't fire).
        if (this.myTechs === null) {
          this.myTechs = new Set(techs);
        } else {
          const fresh = techs.filter((t: string) => !this.myTechs!.has(t));
          if (fresh.length) {
            fresh.forEach((t: string) => this.myTechs!.add(t));
            const home = [...this.cityGfx.values()].find(e => e.data.ownerId === myId);
            if (home) {
              this.sparkleRing(home.data.x, home.data.y - 10, this.playerColors.get(myId) || '#9cff7a');
              playSfx('coins_gold', { volume: 0.45, x: home.data.x, y: home.data.y });
            }
            this.emitEvent('tech', `Research complete (${fresh.length} new)`, { color: '#9cff7a' });
          }
        }
      }
    }

    // Match end: fireworks for the winner, a brief dark wash for the loser.
    if (state.phase && state.phase !== this.prevPhase) {
      if (state.phase === 'finished' && this.prevPhase === 'active') {
        this.victoryCelebration(!!myId && state.winnerId === myId);
      }
      this.prevPhase = state.phase;
    }

    this.updateFog(state);

    const onMinimapData = this.game.registry.get('onMinimapData') as ((d: MinimapData) => void) | undefined;
    if (onMinimapData) {
      // Curved road polylines never change after the map is built — cache once.
      if (!this.minimapRoads) {
        const roads: { pts: { x: number; y: number }[] }[] = [];
        const seen = new Set<string>();
        this.roadsById.forEach(r => {
          const key = [r.fromId, r.toId].sort().join('|');
          if (seen.has(key)) return;
          seen.add(key);
          roads.push({ pts: r.splinePoints.map(p => ({ x: p.x, y: p.y })) });
        });
        this.minimapRoads = roads;
      }
      const ti = this.terrainInfo;
      const vv = this.cameras.main.worldView;
      const data: MinimapData = {
        width: this.mapW, height: this.mapH,
        cols: ti?.cols ?? 0, rows: ti?.rows ?? 0, tile: TILE,
        fog: this.fogState,
        cities: [], lairs: [], objectives: [], roads: this.minimapRoads,
        view: { x: vv.x, y: vv.y, w: vv.width, h: vv.height },
      };
      this.cityGfx.forEach(entry => {
        data.cities.push({
          x: entry.data.x, y: entry.data.y,
          color: entry.data.ownerId ? (this.playerColors.get(entry.data.ownerId) || '#cccccc') : '#888888',
        });
      });
      this.lairGfx.forEach(entry => {
        data.lairs.push({ x: entry.data.x, y: entry.data.y, type: entry.data.type, alive: entry.data.health > 0 });
      });
      this.objectiveGfx.forEach(entry => {
        data.objectives.push({
          x: entry.data.x, y: entry.data.y, kind: entry.data.kind,
          color: entry.data.ownerId && this.playerColors.has(entry.data.ownerId) ? (this.playerColors.get(entry.data.ownerId) || '#cccccc') : '#9aa3ad',
          contested: !!entry.data.contested,
        });
      });
      onMinimapData(data);
    }

    if (this.selection.type !== 'none') {
      this.redrawSelectionRing();
      const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
      if (onSelection) onSelection({ ...this.selection });
    }
  }
}
