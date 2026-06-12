import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';

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

export type SelectionType = 'city' | 'intersection' | 'building' | 'none';
export interface SelectionInfo {
  type: SelectionType; id: string; name: string; data?: any;
}

export interface MinimapData {
  width: number; height: number;
  cities: { x: number; y: number; color: string }[];
  lairs: { x: number; y: number; type: string; alive: boolean }[];
  roads: { x1: number; y1: number; x2: number; y2: number }[];
}

const MAP_W = 1600;
const MAP_H = 800;

const TROOP_LABELS: Record<string, string> = {
  knight: 'K', lancer: 'L', archer: 'A', monk: 'M', spider: 'S', goblin: 'G',
};
const PVE_COLORS: Record<string, number> = { spider: 0x7755aa, goblin: 0x558822 };

export default class GameScene extends Phaser.Scene {
  private client: GameClient | null = null;
  private mapBuilt = false;

  // Static map data mirrored from server state
  private nodes: Map<string, NodeInfo> = new Map();
  private roadsById: Map<string, RoadData> = new Map();

  // Render objects
  private cityGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: CityData }> = new Map();
  private buildingGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: BuildData }> = new Map();
  private lairGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: LairData }> = new Map();
  private unitGfx: Map<string, Phaser.GameObjects.Container> = new Map();
  private cityHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private lairHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private routeArrowGfx: Phaser.GameObjects.Graphics | null = null;

  private selection: SelectionInfo = { type: 'none', id: '', name: '' };
  private cityBuildingCounts: Map<string, number> = new Map();
  private prevUnitHealth: Map<string, number> = new Map();
  private playerColors: Map<string, string> = new Map();

  // Radial routing menu
  private radialMenu: Phaser.GameObjects.Container | null = null;
  // My chosen outgoing road per intersection (mirrors server waypoints)
  private myRoutes: Map<string, string> = new Map();

  private dragMoved = false;

  constructor() { super({ key: 'GameScene' }); }

  create(): void {
    if (import.meta.env.DEV) (window as any).__scene = this;
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.centerOn(MAP_W / 2, MAP_H / 2);
    this.drawTerrain();
    this.selectionRing = this.add.graphics().setDepth(40);
    this.routeArrowGfx = this.add.graphics().setDepth(30);
    this.setupCameraControls();
    this.connectToServer();
  }

  update(): void {
    // Smooth out the 10Hz server updates
    this.unitGfx.forEach(container => {
      const pos = container.getData('worldPos') as { x: number; y: number } | undefined;
      if (pos) {
        container.x += (pos.x - container.x) * 0.25;
        container.y += (pos.y - container.y) * 0.25;
      }
    });
  }

  // ── Terrain ───────────────────────────────────────────────
  private drawTerrain(): void {
    const gfx = this.add.graphics();
    for (let r = 0; r < Math.ceil(MAP_H / 64); r++) {
      for (let c = 0; c < Math.ceil(MAP_W / 64); c++) {
        gfx.fillStyle((r + c) % 2 === 0 ? 0x3d7a33 : 0x4a8c3f, 1);
        gfx.fillRect(c * 64, r * 64, 64, 64);
      }
    }
  }

  // ── Map construction from server state ────────────────────
  private buildMapFromState(state: any): void {
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
    state.roads.forEach((r: any, id: string) => {
      const pts = r.splinePoints.map((p: any) => ({ x: p.x, y: p.y }));
      this.roadsById.set(id, { id, fromId: r.fromId, toId: r.toId, splinePoints: pts });
      const pairKey = [r.fromId, r.toId].sort().join('|');
      if (!drawnPairs.has(pairKey)) {
        drawnPairs.add(pairKey);
        this.drawRoad(pts);
      }
    });

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

    const onMapBounds = this.game.registry.get('onMapBounds') as (b: { width: number; height: number }) => void;
    if (onMapBounds) onMapBounds({ width: MAP_W, height: MAP_H });
    this.mapBuilt = true;
  }

  private drawRoad(pts: { x: number; y: number }[]): void {
    if (pts.length < 2) return;
    const gfx = this.add.graphics();
    gfx.lineStyle(16, 0x8b6f47, 1);
    gfx.beginPath(); gfx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
    gfx.strokePath();
    gfx.lineStyle(2, 0x6b4f2e, 0.6);
    gfx.beginPath(); gfx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
    gfx.strokePath();
  }

  // ── Intersections + routing ───────────────────────────────
  private drawIntersection(node: NodeInfo): void {
    const container = this.add.container(node.x, node.y);
    const circle = this.add.circle(0, 0, 18, 0x5c4033, 1);
    const inner = this.add.circle(0, 0, 12, 0x8b6914, 1);
    const label = this.add.text(0, -30, node.name, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([circle, inner, label]);
    container.setDepth(20);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 22), Phaser.Geom.Circle.Contains);
    container.on('pointerup', () => { if (!this.dragMoved) this.onIntersectionClick(node); });
    container.on('pointerover', () => container.setScale(1.15));
    container.on('pointerout', () => container.setScale(1));
  }

  private onIntersectionClick(node: NodeInfo): void {
    this.selectEntity('intersection', node.id, node.name, { x: node.x, y: node.y });
    this.showRadialMenu(node);
  }

  /** Radial menu: one button per outgoing road, placed in its travel direction. */
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

    // Center button clears the route (units pick the straightest path)
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

  /** Persistent chevrons along my chosen outgoing road at each intersection. */
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
    const influence = this.add.circle(0, 0, city.influenceRadius, 0x4488ff, 0.08);
    influence.setStrokeStyle(1, 0x4488ff, 0.2);
    const base = this.add.rectangle(0, 0, 50, 40, 0x5a5a6e, 1);
    base.setStrokeStyle(2, 0x8888aa, 1);
    const leftTower = this.add.rectangle(-18, -10, 14, 20, 0x6a6a7e, 1);
    const rightTower = this.add.rectangle(18, -10, 14, 20, 0x6a6a7e, 1);
    const keystone = this.add.rectangle(0, -15, 10, 12, 0x7a7a8e, 1);
    const banner = this.add.rectangle(0, -25, 20, 8, 0xcccccc, 1);
    const nameLabel = this.add.text(0, 35, city.name, {
      fontSize: '12px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    const levelLabel = this.add.text(0, -40, `Lv.${city.townHallLevel}`, {
      fontSize: '10px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    container.add([influence, base, leftTower, rightTower, keystone, banner, nameLabel, levelLabel]);
    container.setDepth(20);
    container.setInteractive(new Phaser.Geom.Rectangle(-30, -45, 60, 75), Phaser.Geom.Rectangle.Contains);
    const entry = { gfx: container, data: city };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('city', city.id, city.name, entry.data); });
    container.on('pointerover', () => container.setScale(1.08));
    container.on('pointerout', () => container.setScale(1));
    this.cityGfx.set(city.id, entry);
  }

  private refreshCityVisual(entry: { gfx: Phaser.GameObjects.Container; data: CityData }): void {
    const { gfx, data } = entry;
    const banner = gfx.getAt(5) as Phaser.GameObjects.Rectangle;
    const ownerColor = data.ownerId ? this.playerColors.get(data.ownerId) : undefined;
    banner.setFillStyle(ownerColor ? Phaser.Display.Color.HexStringToColor(ownerColor).color : 0xcccccc);
    (gfx.getAt(7) as Phaser.GameObjects.Text).setText(`Lv.${data.townHallLevel}`);
    const influence = gfx.getAt(0) as Phaser.GameObjects.Arc;
    influence.setRadius(data.influenceRadius);
    if (ownerColor) {
      const c = Phaser.Display.Color.HexStringToColor(ownerColor).color;
      influence.setFillStyle(c, 0.07);
      influence.setStrokeStyle(1, c, 0.25);
    } else {
      influence.setFillStyle(0xffffff, 0.04);
      influence.setStrokeStyle(1, 0xffffff, 0.12);
    }
    this.updateBar(this.cityHealthBars, data.id, data.x, data.y + 48, 50, data.health, data.maxHealth);
  }

  // ── Buildings ─────────────────────────────────────────────
  private drawBuilding(b: BuildData): void {
    const existing = this.buildingGfx.get(b.id);
    if (existing) { Object.assign(existing.data, b); return; }
    const container = this.add.container(b.x, b.y);
    const colors: Record<string, number> = {
      lumber_mill: 0x8b5e3c, farm: 0x7cb342, gold_mine: 0xfdd835,
      barracks: 0x8d6e63, defense_tower: 0x78909c,
    };
    const color = colors[b.type] || 0x666666;
    const rect = this.add.rectangle(0, 0, 20, 20, color, 0.9);
    rect.setStrokeStyle(1, 0xffffff, 0.5);
    const char = b.type === 'lumber_mill' ? 'W' : b.type === 'farm' ? 'F' : b.type === 'gold_mine' ? 'G' : b.type === 'barracks' ? 'B' : 'T';
    const label = this.add.text(0, 0, char, {
      fontSize: '10px', color: '#fff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add([rect, label]);
    container.setDepth(20);
    container.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 24, 24), Phaser.Geom.Rectangle.Contains);
    const entry = { gfx: container, data: { ...b } };
    container.on('pointerup', () => { if (!this.dragMoved) this.selectEntity('building', b.id, b.type, entry.data); });
    this.buildingGfx.set(b.id, entry);
  }

  // ── Lairs ──────────────────────────────────────────────────
  private drawLair(l: LairData): void {
    if (this.lairGfx.has(l.id)) return;
    const container = this.add.container(l.x, l.y);
    const isSpider = l.type === 'spider';
    const base = this.add.circle(0, 0, 22, isSpider ? 0x2a2a3a : 0x3a2a1a, 1);
    base.setStrokeStyle(2, isSpider ? 0x555577 : 0x6b4f2e, 1);
    const inner = this.add.circle(0, 0, 14, isSpider ? 0x444466 : 0x5a3a1a, 1);
    const icon = this.add.text(0, 0, isSpider ? '🕷' : '👺', { fontSize: '16px' }).setOrigin(0.5);
    const label = this.add.text(0, -30, isSpider ? 'Spider Cave' : 'Goblin Stump', {
      fontSize: '10px', color: isSpider ? '#aa88ff' : '#88cc44', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([base, inner, icon, label]);
    container.setDepth(20);
    this.lairGfx.set(l.id, { gfx: container, data: { ...l } });
  }

  private refreshLairVisual(entry: { gfx: Phaser.GameObjects.Container; data: LairData }): void {
    const { gfx, data } = entry;
    const destroyed = data.health <= 0;
    gfx.setAlpha(destroyed ? 0.35 : 1);
    const label = gfx.getAt(3) as Phaser.GameObjects.Text;
    const baseName = data.type === 'spider' ? 'Spider Cave' : 'Goblin Stump';
    label.setText(destroyed ? `${baseName} (razed)` : baseName);
    if (destroyed) {
      const bar = this.lairHealthBars.get(data.id);
      if (bar) { bar.destroy(); this.lairHealthBars.delete(data.id); }
    } else {
      this.updateBar(this.lairHealthBars, data.id, data.x, data.y + 30, 44, data.health, data.maxHealth);
    }
  }

  /** Shared damaged-only health bar rendering. */
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
    if (existing) {
      if (pos) existing.setData('worldPos', pos);
      const hpBar = existing.getData('hpBar') as Phaser.GameObjects.Rectangle;
      const ratio = unit.health / (unit.maxHealth || 100);
      hpBar.setScale(Math.max(0, ratio), 1);
      hpBar.setFillStyle(ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444);
      hpBar.setVisible(unit.health < unit.maxHealth);
      return;
    }
    if (!pos) return;

    const isPvE = unit.ownerId === 'pve';
    const ownerHex = this.playerColors.get(unit.ownerId);
    const color = isPvE
      ? (PVE_COLORS[unit.type] ?? 0x999999)
      : ownerHex ? Phaser.Display.Color.HexStringToColor(ownerHex).color : 0xffffff;

    const container = this.add.container(pos.x, pos.y);
    const body = this.add.circle(0, 0, 6, color, 1);
    body.setStrokeStyle(1, isPvE ? 0x000000 : 0xffffff, 0.7);
    const label = this.add.text(0, 0, TROOP_LABELS[unit.type] || '?', {
      fontSize: '7px', color: '#fff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    const hpBar = this.add.rectangle(0, -9, 12, 3, 0x44cc44, 0.8);
    hpBar.setVisible(false);
    container.add([body, label, hpBar]);
    container.setData('worldPos', pos);
    container.setData('hpBar', hpBar);
    container.setDepth(50);
    this.unitGfx.set(unit.id, container);
  }

  private getUnitWorldPos(unit: any): { x: number; y: number } | null {
    // Garrisoned / besieging units cluster in a ring around their node
    if (unit.atNodeId) {
      const node = this.nodes.get(unit.atNodeId);
      if (!node) return null;
      let hash = 0;
      for (let i = 0; i < unit.id.length; i++) hash = (hash * 31 + unit.id.charCodeAt(i)) >>> 0;
      const angle = (hash % 360) * Math.PI / 180;
      const radius = 32 + (hash % 3) * 8;
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
    const txt = this.add.text(x, y - 10, `-${amount}`, {
      fontSize: '11px', color, fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: txt, y: y - 40, alpha: 0, duration: 800, ease: 'Power2',
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
      this.selectionRing.strokeCircle(data.x, data.y, data.influenceRadius);
      this.selectionRing.lineStyle(3, 0xffff00, 1);
      this.selectionRing.strokeRect(data.x - 30, data.y - 30, 60, 60);
    } else if (type === 'intersection') {
      this.selectionRing.strokeCircle(data.x, data.y, 22);
    } else if (type === 'building') {
      this.selectionRing.strokeRect(data.x - 14, data.y - 14, 28, 28);
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
    this.input.on('wheel', (_p: any, _gx: any, _gy: any, dz: number[]) => {
      this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - dz[0] * 0.001, 0.5, 2));
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
      const onConnectionLost = this.game.registry.get('onConnectionLost') as (() => void) | undefined;
      if (onConnectionLost) onConnectionLost();
    }
  }

  private syncState(state: any): void {
    // Player colors first — everything else tints by them
    if (state.players) {
      state.players.forEach((p: any, id: string) => this.playerColors.set(id, p.colorHex));
    }

    if (!this.mapBuilt) {
      if (!state.roads || state.roads.size === 0) return;
      this.buildMapFromState(state);
    }

    // Cities
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
        this.showFloatingDamage(entry.data.x, entry.data.y, prevHealth - s.health, '#ff8800');
      }
      this.refreshCityVisual(entry);
    });

    // Lairs
    state.lairs.forEach((s: any, id: string) => {
      const entry = this.lairGfx.get(id);
      if (!entry) return;
      entry.data.health = s.health;
      entry.data.maxHealth = s.maxHealth;
      this.refreshLairVisual(entry);
    });

    // Buildings
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

    // Units
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
    this.prevUnitHealth.forEach((_, id) => { if (!syncedIds.has(id)) this.prevUnitHealth.delete(id); });
    this.unitGfx.forEach((gfx, id) => {
      if (!syncedIds.has(id)) { gfx.destroy(); this.unitGfx.delete(id); }
    });

    // My resources + techs
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

    // Minimap
    const onMinimapData = this.game.registry.get('onMinimapData') as ((d: MinimapData) => void) | undefined;
    if (onMinimapData) {
      const data: MinimapData = { width: MAP_W, height: MAP_H, cities: [], lairs: [], roads: [] };
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

    // Keep React's copy of the selection fresh
    if (this.selection.type !== 'none') {
      this.redrawSelectionRing();
      const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
      if (onSelection) onSelection({ ...this.selection });
    }
  }
}
