import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';
import { preloadAssets, createAnims, unitSkin, factionOf } from './assets';
import { buildTerrain, TerrainInfo, TILE, WATER, GRASS, ELEV } from './terrain';
import { initAudio, startAmbient, playSfx } from './audio';

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

export type SelectionType = 'city' | 'intersection' | 'building' | 'resource' | 'none';
export interface SelectionInfo {
  type: SelectionType; id: string; name: string; data?: any;
}

export interface MinimapData {
  width: number; height: number;
  // Fog mask: cols*rows bytes (0 unexplored, 1 explored, 2 visible) + grid dims.
  cols: number; rows: number; tile: number;
  fog: Uint8Array | null;
  cities: { x: number; y: number; color: string }[];
  lairs: { x: number; y: number; type: string; alive: boolean }[];
  // Full curved road geometry (spline points), so the minimap traces real paths.
  roads: { pts: { x: number; y: number }[] }[];
}

const DEPTH_ENTITY = 10; // + y*0.01 for painter's order

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
  private mapW = 1920;
  private mapH = 1216;

  private nodes: Map<string, NodeInfo> = new Map();
  private roadsById: Map<string, RoadData> = new Map();

  private cityGfx: Map<string, CityEntry> = new Map();
  private buildingGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: BuildData }> = new Map();
  private lairGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: LairData }> = new Map();
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

  // Resource nodes (server-driven trees/sheep/gold)
  private resourceGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: any }> = new Map();

  // Terrain + fog of war
  private terrainInfo: TerrainInfo | null = null;
  private fogState: Uint8Array | null = null; // 0 unexplored, 1 explored, 2 visible
  private fogGfx: Phaser.GameObjects.Graphics | null = null;
  private lastFogUpdate = 0;
  private cloudSprites: { sprite: Phaser.GameObjects.Sprite; tile: number }[] = [];
  private minimapRoads: { pts: { x: number; y: number }[] }[] | null = null;

  constructor() { super({ key: 'GameScene' }); }

  preload(): void {
    preloadAssets(this);
  }

  create(): void {
    if (import.meta.env.DEV) (window as any).__scene = this;
    createAnims(this);
    initAudio(this);
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
  }

  update(time: number): void {
    // A steady 75 BPM pulse under the music so the track always has a beat.
    // It free-runs at the unit-step interval and gets re-anchored to the real
    // hop below, so when troops march the beat stays the one they move to.
    const BEAT_MS = 800;
    if (this.beatClock === 0) this.beatClock = time;
    while (time - this.beatClock >= BEAT_MS) {
      this.beatClock += BEAT_MS;
      playSfx('beat_drum', { volume: 0.7, throttleMs: 400, throttleKey: 'beat' });
    }

    this.unitGfx.forEach(u => {
      const pos = u.container.getData('worldPos') as { x: number; y: number } | undefined;
      if (!pos) return;
      const c = u.container;

      // Villagers stroll smoothly toward their free-roam target.
      if (c.getData('isVillager') === true) {
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
        // Re-anchor the metronome to this real step so the pulse lands exactly
        // on the beat the troops move to (the constant clock above keeps it
        // going when nothing is marching). Phase-only — the play is up there.
        if (Math.hypot(ddx, pos.y - c.y) > 4) this.beatClock = time;
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
      u.sprite.y = moving ? -12 * Math.sin(h * Math.PI) : 0;
      c.setDepth(DEPTH_ENTITY + c.y * 0.01);
    });
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
      const short = dest.kind === 'lair' ? (dest.name.startsWith('Spider') ? '🕷' : '👺') : dest.name.charAt(0);
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
    castle.setScale(0.7).setOrigin(0.5, 0.62).setTint(city.ownerId ? 0xffffff : 0x8f9aa6);
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
      const ar = this.add.sprite(dx, -56, `u_${acolor}_archer_idle`).setScale(0.62);
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
      container.add(this.add.image(0, 0, `${variant}_${color}`).setScale(0.55).setOrigin(0.5, 0.72));
    } else if (b.type === 'barracks') {
      container.add(this.add.image(0, 0, `barracks2_${color}`).setScale(0.5).setOrigin(0.5, 0.7));
    } else if (b.type === 'archery') {
      container.add(this.add.image(0, 0, `archery_${color}`).setScale(0.5).setOrigin(0.5, 0.7));
    } else if (b.type === 'church') {
      container.add(this.add.image(0, 0, `monastery_${color}`).setScale(0.5).setOrigin(0.5, 0.7));
    } else { // defense_tower — pack tower with an archer posted on top
      container.add(this.add.image(0, 0, `tower2_${color}`).setScale(0.5).setOrigin(0.5, 0.72));
      const ar = this.add.sprite(0, -34, `u_${color}_archer_idle`).setScale(0.4);
      ar.play(`u_${color}_archer_idle`);
      container.add(ar);
    }

    container.setDepth(DEPTH_ENTITY + b.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-26, -40, 52, 64), Phaser.Geom.Rectangle.Contains);
    const entry = { gfx: container, data: { ...b } };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('building', b.id, b.type, entry.data); });
    this.buildingGfx.set(b.id, entry);
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
    let desiredAnim = unit.status === 'fighting' || unit.status === 'sieging'
      ? 'attack' : unit.status === 'defending' ? 'idle' : 'walk';
    // Villagers: tool matches the resource (pickaxe=gold, knife=sheep, axe=wood)
    // while working; while hauling home they carry the matching load.
    if (unit.type === 'villager') {
      const res = unit.resourceType; // 'tree' | 'sheep' | 'gold'
      if (unit.carrying > 0 && desiredAnim === 'walk') {
        desiredAnim = res === 'gold' ? 'carrygold' : res === 'sheep' ? 'carrymeat' : 'carrywood';
      } else if (desiredAnim === 'attack') {
        desiredAnim = res === 'gold' ? 'mine' : res === 'sheep' ? 'butcher' : 'attack';
      }
    }

    if (existing) {
      if (pos) existing.container.setData('worldPos', pos);
      existing.container.setData('targetResourceId', unit.targetResourceId);
      const animKey = `${existing.base}_${desiredAnim}`;
      if (existing.anim !== animKey) {
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
      return;
    }
    if (!pos) return;

    const skin = unitSkin(unit.type, this.playerColors.get(unit.ownerId));
    const container = this.add.container(pos.x, pos.y);
    const sprite = this.add.sprite(0, 0, `${skin.base}_idle`).setScale(skin.scale);
    const animKey = `${skin.base}_${desiredAnim}`;
    sprite.play(animKey);
    const hpBar = this.makeBar(30, 9).setPosition(0, -34);
    hpBar.setVisible(false);
    container.add([sprite, hpBar]);
    container.setData('worldPos', pos);
    container.setData('ownerId', unit.ownerId);
    container.setData('isVillager', unit.type === 'villager');
    container.setData('targetResourceId', unit.targetResourceId);
    container.setDepth(DEPTH_ENTITY + pos.y * 0.01);
    // Click a pawn to flash the node it's currently gathering.
    if (unit.type === 'villager') {
      container.setInteractive(new Phaser.Geom.Circle(0, 0, 22), Phaser.Geom.Circle.Contains);
      container.on('pointerup', () => { if (!this.dragMoved) this.highlightVillagerResource(unit.id); });
    }
    this.unitGfx.set(unit.id, { container, sprite, hpBar, base: skin.base, anim: animKey });
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
      onComplete: () => arrow.destroy(),
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
    // Field archer units that are mid-attack already play the shoot anim — add
    // the flying arrow so the strike reads as ranged.
    this.unitGfx.forEach(u => {
      if (!u.container.visible || !u.base.includes('_archer') || !u.anim.endsWith('_attack')) return;
      const ownerId = u.container.getData('ownerId') as string;
      const target = this.nearestEnemyNear(u.container.x, u.container.y, ownerId, 240);
      if (!target) return;
      const color = u.base.split('_')[1];
      this.fireArrow(u.container.x, u.container.y - 12, target.x, target.y, color);
    });
  }

  private getUnitWorldPos(unit: any): { x: number; y: number } | null {
    if (unit.type === 'villager') return { x: unit.x, y: unit.y };
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
    const flag = this.add.text(end.x, end.y - 20, '🚩', { fontSize: '22px' }).setOrigin(0.5).setDepth(191);
    this.tweens.add({ targets: [g, flag], alpha: 0, duration: 1400, ease: 'Power2', onComplete: () => { g.destroy(); flag.destroy(); } });
  }

  private showFloatingDamage(x: number, y: number, amount: number, color: string = '#ff4444'): void {
    const txt = this.add.text(x, y - 24, `-${amount}`, {
      fontSize: '12px', color, fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: txt, y: y - 56, alpha: 0, duration: 800, ease: 'Power2',
      onComplete: () => txt.destroy(),
    });
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

    this.shakeAt(x, y, mine ? 0.008 : 0.006, 380);
    playSfx('building_destroyed', { volume: 0.5, x, y });
    playSfx(mine ? 'unit_recruit' : 'coins_gold', { volume: 0.6, x, y });
  }

  // ── Selection ──────────────────────────────────────────────
  private selectEntity(type: SelectionType, id: string, name: string, data?: any): void {
    if (type !== 'intersection') this.hideRadialMenu();
    playSfx('ui_click', { volume: 0.4, throttleMs: 60 });
    this.selection = { type, id, name, data };
    this.redrawSelectionRing();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
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
      if (data) {
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
    this.input.on('pointerdown', () => { this.dragMoved = false; });
    this.input.keyboard?.on('keydown-ESC', () => this.cancelTowerPlacement());
    // R rotates the selected crossroad's route arrow to the next exit.
    this.input.keyboard?.on('keydown-R', () => this.rotateIntersectionRoute());
    // Right-click sets a barracks' rally road: with a barracks selected, click the
    // outgoing road you want fresh troops to march down.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) return;
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
      if (best) { this.client?.setRally(cityId, best.id); this.flashRally(best); }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.dragMoved) return;
      if (this.towerPlace) {
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        const s = this.snapTile(w.x, w.y);
        if (this.towerSpotValid(s.x, s.y)) {
          this.client?.placeTower(this.towerPlace.cityId, s.x, s.y);
          playSfx('build_place', { volume: 0.55 });
          this.cancelTowerPlacement();
        }
        return; // swallow the click while placing
      }
      const hits = this.input.hitTestPointer(p);
      const hitInteractive = hits.some(h => (h as any).input && (h as any).input.enabled);
      if (!hitInteractive) this.clearSelection();
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
    const tower = this.add.image(0, 0, `tower2_${color}`).setScale(0.5).setOrigin(0.5, 0.72).setAlpha(0.75);
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

    if (!this.mapBuilt) {
      if (!state.roads || state.roads.size === 0) return;
      this.buildMapFromState(state);
    }

    const myId = this.client?.sessionId;
    state.cities.forEach((s: any, id: string) => {
      const entry = this.cityGfx.get(id);
      if (!entry) return;
      const prevHealth = entry.data.health;
      const prevOwner = entry.data.ownerId;
      // A fort changed hands — celebrate (or mourn) it.
      if (prevOwner !== s.ownerId) {
        const newReal = s.ownerId && s.ownerId !== 'pve';
        const mine = !!myId && s.ownerId === myId;
        const involved = (!!myId && (s.ownerId === myId || prevOwner === myId));
        const color = newReal ? (this.playerColors.get(s.ownerId) || '#cccccc') : '#9aa3ad';
        this.captureFlourish(entry.data.x, entry.data.y, color, mine, involved);
      }
      entry.data.ownerId = s.ownerId;
      entry.data.townHallLevel = s.townHallLevel;
      entry.data.influenceRadius = s.influenceRadius;
      entry.data.maxBuildings = s.maxBuildings;
      entry.data.health = s.health;
      entry.data.maxHealth = s.maxHealth;
      if (prevHealth > s.health) {
        this.showFloatingDamage(entry.data.x, entry.data.y - 40, prevHealth - s.health, '#ff8800');
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

    this.cityBuildingCounts.clear();
    const liveBuildings = new Set<string>();
    state.buildings.forEach((b: any) => {
      liveBuildings.add(b.id);
      this.drawBuilding({
        id: b.id, cityId: b.cityId, type: b.type, x: b.x, y: b.y,
        level: b.level || 1, health: b.health, maxHealth: b.maxHealth,
        autoProduceType: b.autoProduceType || '',
      });
      this.cityBuildingCounts.set(b.cityId, (this.cityBuildingCounts.get(b.cityId) || 0) + 1);
    });
    this.buildingGfx.forEach((entry, id) => {
      if (!liveBuildings.has(id)) {
        entry.gfx.destroy();
        this.buildingGfx.delete(id);
        playSfx('building_destroyed', { volume: 0.5, throttleMs: 300 });
        if (this.selection.type === 'building' && this.selection.id === id) this.clearSelection();
      }
    });
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
        if (pos) this.showFloatingDamage(pos.x, pos.y, prevHp - u.health);
        this.flashUnit(u.id);
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

    if (myId && state.players) {
      const me = state.players.get(myId);
      if (me) {
        const onResourceUpdate = this.game.registry.get('onResourceUpdate') as (r: any) => void;
        if (onResourceUpdate) onResourceUpdate({
          wood: me.wood, food: me.food, gold: me.gold,
          popUsed: me.populationUsed, popCap: me.populationCap,
        });
        const onTechsUpdate = this.game.registry.get('onTechsUpdate') as ((t: string[]) => void) | undefined;
        if (onTechsUpdate) {
          onTechsUpdate(me.researchedTechs ? me.researchedTechs.split(',') : []);
        }
      }
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
      const data: MinimapData = {
        width: this.mapW, height: this.mapH,
        cols: ti?.cols ?? 0, rows: ti?.rows ?? 0, tile: TILE,
        fog: this.fogState,
        cities: [], lairs: [], roads: this.minimapRoads,
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
      onMinimapData(data);
    }

    if (this.selection.type !== 'none') {
      this.redrawSelectionRing();
      const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
      if (onSelection) onSelection({ ...this.selection });
    }
  }
}
