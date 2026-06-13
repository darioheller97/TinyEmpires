import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';
import { preloadAssets, createAnims, unitSkin, factionOf } from './assets';
import { buildTerrain, TerrainInfo, TILE, WATER } from './terrain';

interface NodeInfo { id: string; x: number; y: number; name: string; kind: 'city' | 'intersection' | 'lair'; }
interface RoadData { id: string; fromId: string; toId: string; splinePoints: { x: number; y: number }[]; }

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

export type SelectionType = 'city' | 'intersection' | 'building' | 'resource' | 'none';
export interface SelectionInfo {
  type: SelectionType; id: string; name: string; data?: any;
}

export interface MinimapData {
  width: number; height: number;
  cities: { x: number; y: number; color: string }[];
  lairs: { x: number; y: number; type: string; alive: boolean }[];
  roads: { x1: number; y1: number; x2: number; y2: number }[];
}

const DEPTH_ENTITY = 10; // + y*0.01 for painter's order

interface UnitVisual {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Rectangle;
  sheet: string;
  anim: string;
}

export default class GameScene extends Phaser.Scene {
  private client: GameClient | null = null;
  private mapBuilt = false;
  private mapW = 1920;
  private mapH = 1216;

  private nodes: Map<string, NodeInfo> = new Map();
  private roadsById: Map<string, RoadData> = new Map();

  private cityGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: CityData }> = new Map();
  private buildingGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: BuildData }> = new Map();
  private lairGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: LairData }> = new Map();
  private unitGfx: Map<string, UnitVisual> = new Map();
  private cityHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private lairHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private routeArrowGfx: Phaser.GameObjects.Graphics | null = null;

  private selection: SelectionInfo = { type: 'none', id: '', name: '' };
  private cityBuildingCounts: Map<string, number> = new Map();
  private prevUnitHealth: Map<string, number> = new Map();
  private playerColors: Map<string, string> = new Map();

  private radialMenu: Phaser.GameObjects.Container | null = null;
  private myRoutes: Map<string, string> = new Map();
  private dragMoved = false;

  // Resource nodes (server-driven trees/sheep/gold)
  private resourceGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: any }> = new Map();

  // Terrain + fog of war
  private terrainInfo: TerrainInfo | null = null;
  private fogState: Uint8Array | null = null; // 0 unexplored, 1 explored, 2 visible
  private fogGfx: Phaser.GameObjects.Graphics | null = null;
  private lastFogUpdate = 0;

  constructor() { super({ key: 'GameScene' }); }

  preload(): void {
    preloadAssets(this);
  }

  create(): void {
    if (import.meta.env.DEV) (window as any).__scene = this;
    createAnims(this);
    this.selectionRing = this.add.graphics().setDepth(40);
    this.routeArrowGfx = this.add.graphics().setDepth(30);
    this.setupCameraControls();
    this.connectToServer();
  }

  update(): void {
    // Road units hop tile-to-tile on the beat; villagers stroll smoothly
    this.unitGfx.forEach(u => {
      const pos = u.container.getData('worldPos') as { x: number; y: number } | undefined;
      if (!pos) return;
      const villager = u.container.getData('isVillager') === true;
      const dx = pos.x - u.container.x;
      const dy = pos.y - u.container.y;
      if (Math.abs(dx) > 0.8) u.sprite.setFlipX(dx < 0);
      const lerp = villager ? 0.25 : 0.45;
      u.container.x += dx * lerp;
      u.container.y += dy * lerp;
      const dist = Math.hypot(dx, dy);
      u.sprite.y = !villager && dist > 4 ? -Math.min(8, dist * 0.22) : 0;
      u.container.setDepth(DEPTH_ENTITY + u.container.y * 0.01);
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
    state.roads.forEach((r: any, id: string) => {
      const pts = r.splinePoints.map((p: any) => ({ x: p.x, y: p.y }));
      this.roadsById.set(id, { id, fromId: r.fromId, toId: r.toId, splinePoints: pts });
      const pairKey = [r.fromId, r.toId].sort().join('|');
      if (!drawnPairs.has(pairKey)) {
        drawnPairs.add(pairKey);
        physicalSplines.push(pts);
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
    });
    this.fogState = new Uint8Array(this.terrainInfo.cols * this.terrainInfo.rows);
    this.fogGfx = this.add.graphics().setDepth(60);

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
    const circle = this.add.circle(0, 0, 16, 0xb8945e, 0.85);
    circle.setStrokeStyle(2, 0x6b4f2e, 0.9);
    const post = this.add.image(0, -8, 'deco_16').setScale(0.8); // signpost-ish deco
    const label = this.add.text(0, -34, node.name, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([circle, post, label]);
    container.setDepth(DEPTH_ENTITY + node.y * 0.01);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 24), Phaser.Geom.Circle.Contains);
    container.on('pointerup', () => { if (!this.dragMoved) this.onIntersectionClick(node); });
    container.on('pointerover', () => container.setScale(1.15));
    container.on('pointerout', () => container.setScale(1));
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
    const castle = this.add.image(0, 0, city.ownerId ? `castle_${factionOf(this.playerColors.get(city.ownerId))}` : 'castle_destroyed');
    castle.setScale(0.55).setOrigin(0.5, 0.6);
    const fire = this.add.sprite(-30, -40, 'fire').setScale(0.8).setVisible(false);
    fire.play('fire_anim');
    const fire2 = this.add.sprite(34, -20, 'fire').setScale(0.6).setVisible(false);
    fire2.play('fire_anim');
    const nameLabel = this.add.text(0, 64, city.name, {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    const levelLabel = this.add.text(0, -86, `Lv.${city.townHallLevel}`, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    container.add([influence, castle, fire, fire2, nameLabel, levelLabel]);
    container.setDepth(DEPTH_ENTITY + city.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-80, -85, 160, 150), Phaser.Geom.Rectangle.Contains);
    const entry = { gfx: container, data: city };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('city', city.id, city.name, entry.data); });
    this.cityGfx.set(city.id, entry);
  }

  private refreshCityVisual(entry: { gfx: Phaser.GameObjects.Container; data: CityData }): void {
    const { gfx, data } = entry;
    const castle = gfx.getAt(1) as Phaser.GameObjects.Image;
    const key = data.ownerId ? `castle_${factionOf(this.playerColors.get(data.ownerId))}` : 'castle_destroyed';
    if (castle.texture.key !== key) castle.setTexture(key);
    (gfx.getAt(5) as Phaser.GameObjects.Text).setText(`Lv.${data.townHallLevel}`);
    // Burning when badly damaged
    const burning = data.health < data.maxHealth * 0.7;
    (gfx.getAt(2) as Phaser.GameObjects.Sprite).setVisible(burning);
    (gfx.getAt(3) as Phaser.GameObjects.Sprite).setVisible(data.health < data.maxHealth * 0.4);
    this.updateBar(this.cityHealthBars, data.id, data.x, data.y + 78, 60, data.health, data.maxHealth);
  }

  // ── Buildings ─────────────────────────────────────────────
  private drawBuilding(b: BuildData): void {
    const existing = this.buildingGfx.get(b.id);
    if (existing) { Object.assign(existing.data, b); return; }
    const container = this.add.container(b.x, b.y);
    const city = this.cityGfx.get(b.cityId);
    const color = factionOf(city ? this.playerColors.get(city.data.ownerId) : undefined);

    if (b.type === 'barracks') {
      container.add(this.add.image(0, 0, `house_${color}`).setScale(0.55).setOrigin(0.5, 0.68));
    } else if (b.type === 'defense_tower') {
      container.add(this.add.image(0, 0, `tower_${color}`).setScale(0.5).setOrigin(0.5, 0.72));
    } else if (b.type === 'gold_mine') {
      container.add(this.add.image(0, 0, 'goldmine').setScale(0.55).setOrigin(0.5, 0.6));
    } else if (b.type === 'farm') {
      const s1 = this.add.sprite(-12, 0, 'sheep').setScale(0.45);
      s1.play({ key: 'sheep_anim', startFrame: 0 });
      const s2 = this.add.sprite(14, 8, 'sheep').setScale(0.38);
      s2.play({ key: 'sheep_anim', startFrame: 3 });
      container.add([this.add.image(0, 6, 'deco_8').setScale(0.9), s1, s2]);
    } else { // lumber_mill
      const tree = this.add.sprite(0, -8, 'tree').setScale(0.5).setOrigin(0.5, 0.7);
      tree.play('tree_anim');
      container.add([tree, this.add.image(16, 10, 'res_wood').setScale(0.28)]);
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
    const existing = this.resourceGfx.get(r.id);
    if (existing) { Object.assign(existing.data, { amount: r.amount, maxAmount: r.maxAmount }); return; }
    const container = this.add.container(r.x, r.y);
    if (r.type === 'tree') {
      const t = this.add.sprite(0, 0, 'tree').setOrigin(0.5, 0.75);
      t.play({ key: 'tree_anim', startFrame: (r.x + r.y) % 4 });
      if ((r.x * 7 + r.y * 13) % 10 < 3) t.setTint(0xf3cd7e); // golden variety
      else if ((r.x * 7 + r.y * 13) % 10 < 5) t.setTint(0xcfe8a0); // pale green
      container.add(t);
    } else if (r.type === 'sheep') {
      const s = this.add.sprite(0, 0, 'sheep').setScale(0.7);
      s.play({ key: 'sheep_anim', startFrame: (r.x + r.y) % 6 });
      container.add(s);
    } else {
      // Gold deposit: a cluster of nugget piles on the ground
      container.add([
        this.add.image(0, 2, 'gold_pile').setScale(0.55),
        this.add.image(-20, 12, 'gold_pile').setScale(0.38),
        this.add.image(20, 14, 'gold_pile').setScale(0.32),
      ]);
    }
    container.setDepth(DEPTH_ENTITY + r.y * 0.01);
    container.setInteractive(new Phaser.Geom.Rectangle(-28, -40, 56, 64), Phaser.Geom.Rectangle.Contains);
    const names: Record<string, string> = { tree: 'Forest', sheep: 'Sheep', gold: 'Gold Deposit' };
    const entry = { gfx: container, data: { id: r.id, type: r.type, x: r.x, y: r.y, amount: r.amount, maxAmount: r.maxAmount } };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('resource', r.id, names[r.type] || r.type, entry.data); });
    this.resourceGfx.set(r.id, entry);
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

    // Draw fog overlay
    this.fogGfx.clear();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = fog[r * cols + c];
        if (s === 2) continue;
        // Unexplored is fully opaque — you don't know what's out there
        this.fogGfx.fillStyle(s === 0 ? 0x0d1b2a : 0x06101c, s === 0 ? 1 : 0.4);
        this.fogGfx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }

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

  private updateBar(store: Map<string, Phaser.GameObjects.Graphics>, id: string, cx: number, y: number, width: number, hp: number, maxHp: number): void {
    let bar = store.get(id);
    if (hp >= maxHp) {
      if (bar) { bar.destroy(); store.delete(id); }
      return;
    }
    if (!bar) { bar = this.add.graphics().setDepth(45); store.set(id, bar); }
    const x = cx - width / 2;
    const ratio = Math.max(0, hp / maxHp);
    bar.clear();
    bar.fillStyle(0x000000, 0.6);
    bar.fillRect(x - 1, y - 1, width + 2, 7);
    bar.fillStyle(ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444, 1);
    bar.fillRect(x, y, width * ratio, 5);
  }

  // ── Units ─────────────────────────────────────────────────
  private syncUnit(unit: any): void {
    const pos = this.getUnitWorldPos(unit);
    const existing = this.unitGfx.get(unit.id);
    let desiredAnim = unit.status === 'fighting' || unit.status === 'sieging'
      ? 'attack' : unit.status === 'defending' ? 'idle' : 'walk';
    // Villagers at work: hammer swing for mining, horizontal chop for the rest
    if (unit.type === 'villager' && desiredAnim === 'attack' && unit.resourceType !== 'gold') {
      desiredAnim = 'chop';
    }

    if (existing) {
      if (pos) existing.container.setData('worldPos', pos);
      const animKey = `${existing.sheet}_${desiredAnim}`;
      if (existing.anim !== animKey) {
        existing.sprite.play(animKey);
        existing.anim = animKey;
      }
      const ratio = unit.health / (unit.maxHealth || 100);
      existing.container.setData('hpRatio', ratio);
      existing.hpBar.setScale(Math.max(0, ratio), 1);
      existing.hpBar.setFillStyle(ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444);
      existing.hpBar.setVisible(unit.health < unit.maxHealth);
      return;
    }
    if (!pos) return;

    const skin = unitSkin(unit.type, this.playerColors.get(unit.ownerId));
    const container = this.add.container(pos.x, pos.y);
    const sprite = this.add.sprite(0, 0, skin.sheet).setScale(0.65);
    if (skin.tint) sprite.setTint(skin.tint);
    const animKey = `${skin.sheet}_${desiredAnim}`;
    sprite.play(animKey);
    const hpBar = this.add.rectangle(0, -34, 22, 4, 0x44cc44, 0.9);
    hpBar.setVisible(false);
    container.add([sprite, hpBar]);
    container.setData('worldPos', pos);
    container.setData('ownerId', unit.ownerId);
    container.setData('isVillager', unit.type === 'villager');
    container.setDepth(DEPTH_ENTITY + pos.y * 0.01);
    this.unitGfx.set(unit.id, { container, sprite, hpBar, sheet: skin.sheet, anim: animKey });
  }

  private removeUnitVisual(id: string, died: boolean): void {
    const u = this.unitGfx.get(id);
    if (!u) return;
    if (died) {
      const isBarrel = u.sheet === 'barrel';
      const fx = this.add.sprite(u.container.x, u.container.y, isBarrel ? 'explosion' : 'dead')
        .setScale(isBarrel ? 0.7 : 0.6)
        .setDepth(DEPTH_ENTITY + u.container.y * 0.01 + 0.5);
      fx.play(isBarrel ? 'explosion_anim' : 'dead_anim');
      fx.once('animationcomplete', () => {
        if (isBarrel) { fx.destroy(); return; }
        this.tweens.add({ targets: fx, alpha: 0, delay: 1200, duration: 600, onComplete: () => fx.destroy() });
      });
    }
    u.container.destroy();
    this.unitGfx.delete(id);
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
    if (!road || road.splinePoints.length < 2) return null;
    const pts = road.splinePoints;
    const t = Phaser.Math.Clamp(unit.t, 0, 0.999);
    const idx = t * (pts.length - 1);
    const i = Math.floor(idx);
    const frac = idx - i;
    const p0 = pts[Math.min(i, pts.length - 1)];
    const p1 = pts[Math.min(i + 1, pts.length - 1)];
    return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac };
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

  // ── Selection ──────────────────────────────────────────────
  private selectEntity(type: SelectionType, id: string, name: string, data?: any): void {
    if (type !== 'intersection') this.hideRadialMenu();
    this.selection = { type, id, name, data };
    this.redrawSelectionRing();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
  }

  private redrawSelectionRing(): void {
    if (!this.selectionRing) return;
    this.selectionRing.clear();
    const { type, data } = this.selection;
    if (!data) return;
    this.selectionRing.lineStyle(2, 0xffff00, 0.9);
    if (type === 'city') {
      // Influence zone as terrain tiles (land cells within radius)
      if (this.terrainInfo) {
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
      this.selectionRing.lineStyle(3, 0xffff00, 1);
      this.selectionRing.strokeCircle(data.x, data.y, 70);
    } else if (type === 'resource') {
      this.selectionRing.strokeCircle(data.x, data.y, 30);
    } else if (type === 'intersection') {
      this.selectionRing.strokeCircle(data.x, data.y, 24);
    } else if (type === 'building') {
      this.selectionRing.strokeCircle(data.x, data.y, 34);
    }
  }

  private clearSelection(): void {
    this.hideRadialMenu();
    this.selection = { type: 'none', id: '', name: '' };
    if (this.selectionRing) this.selectionRing.clear();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection({ ...this.selection });
  }

  // ── Camera ────────────────────────────────────────────────
  centerCamera(x: number, y: number): void {
    this.cameras.main.pan(x, y, 250, 'Power2');
  }

  private setupCameraControls(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
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
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.dragMoved) return;
      const hits = this.input.hitTestPointer(p);
      const hitInteractive = hits.some(h => (h as any).input && (h as any).input.enabled);
      if (!hitInteractive) this.clearSelection();
    });
  }

  // ── Exposed for React ────────────────────────────────────
  getClient(): GameClient | null { return this.client; }

  // ── Network ───────────────────────────────────────────────
  private async connectToServer(): Promise<void> {
    this.client = new GameClient();
    try {
      await this.client.connect();
      this.client.onStateChange(state => this.syncState(state));
    } catch (e) {
      console.warn('Could not connect to server', e);
    }
  }

  private syncState(state: any): void {
    if (state.players) {
      state.players.forEach((p: any, id: string) => this.playerColors.set(id, p.colorHex));
    }

    if (!this.mapBuilt) {
      if (!state.roads || state.roads.size === 0) return;
      this.buildMapFromState(state);
    }

    state.cities.forEach((s: any, id: string) => {
      const entry = this.cityGfx.get(id);
      if (!entry) return;
      const prevHealth = entry.data.health;
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

    const myId = this.client?.sessionId;
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
      const data: MinimapData = { width: this.mapW, height: this.mapH, cities: [], lairs: [], roads: [] };
      this.cityGfx.forEach(entry => {
        data.cities.push({
          x: entry.data.x, y: entry.data.y,
          color: entry.data.ownerId ? (this.playerColors.get(entry.data.ownerId) || '#cccccc') : '#888888',
        });
      });
      this.lairGfx.forEach(entry => {
        data.lairs.push({ x: entry.data.x, y: entry.data.y, type: entry.data.type, alive: entry.data.health > 0 });
      });
      const seen = new Set<string>();
      this.roadsById.forEach(r => {
        const key = [r.fromId, r.toId].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        const a = r.splinePoints[0], b = r.splinePoints[r.splinePoints.length - 1];
        data.roads.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
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
