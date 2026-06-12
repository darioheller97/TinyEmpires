import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';

interface CityData {
  id: string; x: number; y: number; name: string; ownerId: string;
  townHallLevel: number; influenceRadius: number; maxBuildings: number;
  health?: number; maxHealth?: number;
}
interface IntersectionData {
  id: string; x: number; y: number; name: string;
}
interface RoadData {
  id: string; fromId: string; toId: string; splinePoints: { x: number; y: number }[];
}
interface BuildData {
  id: string; cityId: string; type: string; x: number; y: number; level: number;
}
interface LairData {
  id: string; x: number; y: number; type: string; health: number; maxHealth: number;
}
interface UnitData {
  id: string; ownerId: string; type: string; roadId: string; t: number;
  health: number; maxHealth: number;
}

export type SelectionType = 'city' | 'intersection' | 'building' | 'unit' | 'none';
export interface SelectionInfo {
  type: SelectionType; id: string; name: string; data?: any;
}

const TROOP_COLORS: Record<string, number> = {
  knight: 0x4477cc, lancer: 0xcc4444, archer: 0x44cc44, monk: 0xcccc44,
};
const TROOP_LABELS: Record<string, string> = {
  knight: 'K', lancer: 'L', archer: 'A', monk: 'M',
};

export default class GameScene extends Phaser.Scene {
  private roads: Phaser.GameObjects.Graphics[] = [];
  private roadArrowGfx: Phaser.GameObjects.Graphics | null = null;
  private cities: Map<string, { gfx: Phaser.GameObjects.Container; data: CityData }> = new Map();
  private intersectionGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: IntersectionData }> = new Map();
  private buildingGfx: Map<string, Phaser.GameObjects.Container> = new Map();
  private lairGfx: Map<string, Phaser.GameObjects.Container> = new Map();
  private unitGfx: Map<string, Phaser.GameObjects.Container> = new Map();
  private client: GameClient | null = null;
  private selection: SelectionInfo = { type: 'none', id: '', name: '' };
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private cityBuildingCounts: Map<string, number> = new Map();

  // Radial menu state
  private radialMenu: Phaser.GameObjects.Container | null = null;
  private radialTarget: { intersectionId: string; incomingRoadId: string; x: number; y: number } | null = null;

  // Combat visual state
  private prevUnitHealth: Map<string, number> = new Map();
  private cityHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private floatingTextPool: Phaser.GameObjects.Text[] = [];

  // Hardcoded map
  private mapCities: CityData[] = [
    { id: 'city_a', x: 300, y: 400, name: 'Red Keep', ownerId: '', townHallLevel: 1, influenceRadius: 150, maxBuildings: 2 },
    { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel', ownerId: '', townHallLevel: 1, influenceRadius: 150, maxBuildings: 2 },
  ];
  private mapIntersections: IntersectionData[] = [
    { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
  ];
  private mapLairs: LairData[] = [
    { id: 'lair_spider', x: 200, y: 200, type: 'spider', health: 500, maxHealth: 500 },
    { id: 'lair_goblin', x: 1400, y: 600, type: 'goblin', health: 500, maxHealth: 500 },
  ];
  private mapRoads: RoadData[] = [
    { id: 'road_0', fromId: 'city_a', toId: 'cross_1', splinePoints: this.buildSplinePoints({ x: 300, y: 400 }, [{ x: 550, y: 400 }], { x: 800, y: 400 }) },
    { id: 'road_1', fromId: 'cross_1', toId: 'city_b', splinePoints: this.buildSplinePoints({ x: 800, y: 400 }, [{ x: 1050, y: 400 }], { x: 1300, y: 400 }) },
    { id: 'road_2', fromId: 'city_b', toId: 'cross_1', splinePoints: this.buildSplinePoints({ x: 1300, y: 400 }, [{ x: 1050, y: 400 }], { x: 800, y: 400 }) },
    { id: 'road_3', fromId: 'cross_1', toId: 'city_a', splinePoints: this.buildSplinePoints({ x: 800, y: 400 }, [{ x: 550, y: 400 }], { x: 300, y: 400 }) },
    { id: 'road_4', fromId: 'lair_spider', toId: 'cross_1', splinePoints: this.buildSplinePoints({ x: 200, y: 200 }, [{ x: 500, y: 300 }], { x: 800, y: 400 }) },
    { id: 'road_5', fromId: 'lair_goblin', toId: 'cross_1', splinePoints: this.buildSplinePoints({ x: 1400, y: 600 }, [{ x: 1100, y: 500 }], { x: 800, y: 400 }) },
  ];

  private buildSplinePoints(start: { x: number; y: number }, via: { x: number; y: number }[], end: { x: number; y: number }): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    const all = [start, ...via, end];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i]; const b = all[i + 1];
      for (let s = 0; s <= 20; s++) {
        const t = s / 20;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return points;
  }

  constructor() { super({ key: 'GameScene' }); }

  create(): void {
    this.cameras.main.setBounds(0, 0, 1600, 800);
    this.cameras.main.centerOn(800, 400);
    this.drawTerrain();
    this.mapRoads.forEach(r => this.drawRoad(r));
    this.drawRoadArrows();
    this.mapIntersections.forEach(is => this.drawIntersection(is));
    this.mapLairs.forEach(l => this.drawLair(l));
    this.mapCities.forEach(city => this.drawCity(city));
    this.selectionRing = this.add.graphics();
    this.roadArrowGfx = this.add.graphics();

    const onMapBounds = this.game.registry.get('onMapBounds') as (b: { width: number; height: number }) => void;
    if (onMapBounds) onMapBounds({ width: 1600, height: 800 });
    this.setupCameraControls();
    this.connectToServer();
  }

  update(): void {
    // Update unit positions each frame for smooth movement
    this.unitGfx.forEach((container, id) => {
      const pos = container.getData('worldPos') as { x: number; y: number } | undefined;
      if (pos) {
        container.setPosition(pos.x, pos.y);
      }
    });
  }

  // ── Terrain ───────────────────────────────────────────────
  private drawTerrain(): void {
    const gfx = this.add.graphics();
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 25; c++) {
        gfx.fillStyle((r + c) % 2 === 0 ? 0x3d7a33 : 0x4a8c3f, 1);
        gfx.fillRect(c * 64, r * 64, 64, 64);
      }
    }
  }

  // ── Roads ─────────────────────────────────────────────────
  private drawRoad(road: RoadData): void {
    const gfx = this.add.graphics();
    const pts = road.splinePoints;
    gfx.lineStyle(16, 0x8b6f47, 1);
    if (pts.length > 1) {
      gfx.beginPath(); gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.strokePath();
    }
    gfx.lineStyle(2, 0x6b4f2e, 0.6);
    if (pts.length > 1) {
      gfx.beginPath(); gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.strokePath();
    }
    this.roads.push(gfx);
  }

  private drawRoadArrows(): void {
    if (!this.roadArrowGfx) return;
    this.roadArrowGfx.clear();
    const waypointData = this.game.registry.get('waypointData') as Map<string, number> | undefined;
    if (!waypointData) return;

    this.roadArrowGfx.lineStyle(3, 0xffd700, 0.8);
    this.mapRoads.forEach((road) => {
      const pts = road.splinePoints;
      // Draw arrow at 60% and 80% of the road
      [0.6, 0.8].forEach((ratio) => {
        const idx = Math.floor(ratio * (pts.length - 1));
        if (idx >= pts.length - 1) return;
        const p = pts[idx];
        const next = pts[Math.min(idx + 1, pts.length - 1)];
        const angle = Math.atan2(next.y - p.y, next.x - p.x);
        const len = 8;
        const ax = p.x + Math.cos(angle) * len;
        const ay = p.y + Math.sin(angle) * len;
        this.roadArrowGfx!.beginPath();
        this.roadArrowGfx!.moveTo(p.x, p.y);
        this.roadArrowGfx!.lineTo(ax, ay);
        this.roadArrowGfx!.strokePath();
        // Arrowhead
        const headLen = 6;
        const headAngle = 0.6;
        this.roadArrowGfx!.beginPath();
        this.roadArrowGfx!.moveTo(ax, ay);
        this.roadArrowGfx!.lineTo(
          ax - Math.cos(angle - headAngle) * headLen,
          ay - Math.sin(angle - headAngle) * headLen
        );
        this.roadArrowGfx!.moveTo(ax, ay);
        this.roadArrowGfx!.lineTo(
          ax - Math.cos(angle + headAngle) * headLen,
          ay - Math.sin(angle + headAngle) * headLen
        );
        this.roadArrowGfx!.strokePath();
      });
    });
  }

  // ── Intersections ─────────────────────────────────────────
  private drawIntersection(is: IntersectionData): void {
    const container = this.add.container(is.x, is.y);
    const circle = this.add.circle(0, 0, 18, 0x5c4033, 1);
    const inner = this.add.circle(0, 0, 12, 0x8b6914, 1);
    const label = this.add.text(0, -30, is.name, {
      fontSize: '11px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([circle, inner, label]);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 22), Phaser.Geom.Circle.Contains);
    container.on('pointerdown', () => this.onIntersectionClick(is));
    container.on('pointerover', () => container.setScale(1.15));
    container.on('pointerout', () => { if (this.selection.id !== is.id) container.setScale(1); });
    this.intersectionGfx.set(is.id, { gfx: container, data: is });
  }

  private onIntersectionClick(is: IntersectionData): void {
    this.selectEntity('intersection', is.id, is.name, is);
    this.showRadialMenu(is);
  }

  private showRadialMenu(is: IntersectionData): void {
    this.hideRadialMenu();

    // Find the incoming road
    const incomingRoad = this.mapRoads.find(r => r.toId === is.id) || null;
    if (!incomingRoad) return;

    this.radialTarget = { intersectionId: is.id, incomingRoadId: incomingRoad.id, x: is.x, y: is.y };

    const container = this.add.container(is.x, is.y);
    const bg = this.add.circle(0, 0, 50, 0x000000, 0.6);
    bg.setStrokeStyle(2, 0xffd700, 0.8);

    // Three directional buttons
    const opts: { label: string; direction: number; angle: number }[] = [
      { label: '←', direction: -1, angle: -Math.PI / 2 },
      { label: '↑', direction: 0, angle: 0 },
      { label: '→', direction: 1, angle: Math.PI / 2 },
    ];

    opts.forEach((opt) => {
      const radius = 32;
      const bx = Math.sin(opt.angle) * radius;
      const by = -Math.cos(opt.angle) * radius;
      const btn = this.add.circle(bx, by, 14, 0x5c4033, 1);
      btn.setStrokeStyle(2, 0xffd700, 0.6);
      btn.setInteractive(new Phaser.Geom.Circle(0, 0, 14), Phaser.Geom.Circle.Contains);
      const txt = this.add.text(bx, by, opt.label, {
        fontSize: '14px', color: '#ffd700', fontFamily: 'monospace',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add([btn, txt]);

      btn.on('pointerdown', () => {
        if (this.radialTarget) {
          this.client?.setIntersectionWaypoint(this.radialTarget.intersectionId, this.radialTarget.incomingRoadId, opt.direction);
          // Store for arrow rendering
          const wayData = this.game.registry.get('waypointData') as Map<string, number> || new Map();
          wayData.set(this.radialTarget.incomingRoadId, opt.direction);
          this.game.registry.set('waypointData', wayData);
          this.drawRoadArrows();
        }
        this.hideRadialMenu();
      });

      btn.on('pointerover', () => btn.setFillStyle(0x8b6914));
      btn.on('pointerout', () => btn.setFillStyle(0x5c4033));
    });

    // Close button (small X)
    const closeX = 36;
    const closeY = -36;
    const closeBtn = this.add.circle(closeX, closeY, 10, 0x882222, 0.8);
    closeBtn.setInteractive(new Phaser.Geom.Circle(0, 0, 10), Phaser.Geom.Circle.Contains);
    const closeTxt = this.add.text(closeX, closeY, '✕', {
      fontSize: '10px', color: '#fff', fontFamily: 'monospace'
    }).setOrigin(0.5);
    container.add([closeBtn, closeTxt]);
    closeBtn.on('pointerdown', () => this.hideRadialMenu());

    container.setDepth(100);
    this.radialMenu = container;
  }

  private hideRadialMenu(): void {
    if (this.radialMenu) {
      this.radialMenu.destroy();
      this.radialMenu = null;
    }
    this.radialTarget = null;
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
    const centerKeystone = this.add.rectangle(0, -15, 10, 12, 0x7a7a8e, 1);
    const bannerColor = city.ownerId ? 0xff4444 : 0xcccccc;
    const banner = this.add.rectangle(0, -25, 20, 8, bannerColor, 1);
    const nameLabel = this.add.text(0, 35, city.name, {
      fontSize: '12px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    const levelLabel = this.add.text(0, -40, `Lv.${city.townHallLevel}`, {
      fontSize: '10px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    container.add([influence, base, leftTower, rightTower, centerKeystone, banner, nameLabel, levelLabel]);
    container.setInteractive(new Phaser.Geom.Rectangle(-30, -30, 60, 60), Phaser.Geom.Rectangle.Contains);
    container.on('pointerdown', () => this.selectEntity('city', city.id, city.name, city));
    container.on('pointerover', () => container.setScale(1.08));
    container.on('pointerout', () => { if (this.selection.id !== city.id) container.setScale(1); });
    this.cities.set(city.id, { gfx: container, data: city });
  }

  // ── Buildings ─────────────────────────────────────────────
  private drawBuilding(b: BuildData): void {
    if (this.buildingGfx.has(b.id)) return;
    const container = this.add.container(b.x, b.y);
    const colors: Record<string, number> = {
      lumber_mill: 0x8b5e3c, farm: 0x7cb342, gold_mine: 0xfdd835,
      barracks: 0x8d6e63, defense_tower: 0x78909c,
    };
    const color = colors[b.type] || 0x666666;
    const rect = this.add.rectangle(0, 0, 20, 20, color, 0.9);
    rect.setStrokeStyle(1, 0xffffff, 0.5);
    const char = b.type === 'lumber_mill' ? 'W' : b.type === 'farm' ? 'F' : b.type === 'gold_mine' ? 'G' : b.type === 'barracks' ? 'B' : 'D';
    const label = this.add.text(0, 0, char, {
      fontSize: '10px', color: '#fff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add([rect, label]);
    container.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 24, 24), Phaser.Geom.Rectangle.Contains);
    container.on('pointerdown', () => this.selectEntity('building', b.id, b.type, b));
    this.buildingGfx.set(b.id, container);
  }

  // ── Lairs ──────────────────────────────────────────────────
  private drawLair(l: LairData): void {
    if (this.lairGfx.has(l.id)) return;
    const container = this.add.container(l.x, l.y);
    const isSpider = l.type === 'spider';
    // Cave/stump base
    const base = this.add.circle(0, 0, 22, isSpider ? 0x2a2a3a : 0x3a2a1a, 1);
    base.setStrokeStyle(2, isSpider ? 0x555577 : 0x6b4f2e, 1);
    const inner = this.add.circle(0, 0, 14, isSpider ? 0x444466 : 0x5a3a1a, 1);
    const icon = this.add.text(0, 0, isSpider ? '🕷' : '👺', { fontSize: '16px' }).setOrigin(0.5);
    const label = this.add.text(0, -30, isSpider ? 'Spider Cave' : 'Goblin Stump', {
      fontSize: '10px', color: isSpider ? '#aa88ff' : '#88cc44', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([base, inner, icon, label]);
    container.setDepth(50);
    this.lairGfx.set(l.id, container);
  }

  // ── Units ─────────────────────────────────────────────────
  private drawUnit(unit: UnitData, playerColor?: string): void {
    const existing = this.unitGfx.get(unit.id);
    if (existing) {
      const pos = this.getUnitWorldPos(unit);
      if (pos) existing.setData('worldPos', pos);
      // Update health bar
      const hpBar = existing.getData('hpBar') as Phaser.GameObjects.Rectangle;
      const maxHp = unit.maxHealth || 100;
      const ratio = unit.health / maxHp;
      hpBar.setScale(ratio, 1);
      hpBar.setFillStyle(ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444);
      hpBar.setVisible(unit.health < unit.maxHealth);
      return;
    }

    const pos = this.getUnitWorldPos(unit);
    if (!pos) return;

    const container = this.add.container(pos.x, pos.y);
    const color = TROOP_COLORS[unit.type] || 0xffffff;
    const body = this.add.circle(0, 0, 6, color, 1);
    body.setStrokeStyle(1, 0xffffff, 0.6);
    const label = this.add.text(0, 0, TROOP_LABELS[unit.type] || '?', {
      fontSize: '7px', color: '#fff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    // Health bar — only visible when damaged
    const hpBar = this.add.rectangle(0, -9, 12, 3, 0x44cc44, 0.8);
    hpBar.setVisible(false);
    container.add([body, label, hpBar]);
    container.setData('worldPos', pos);
    container.setData('hpBar', hpBar);
    container.setData('maxHealth', unit.maxHealth);
    container.setDepth(50);
    this.unitGfx.set(unit.id, container);
  }

  private getUnitWorldPos(unit: UnitData): { x: number; y: number } | null {
    const road = this.mapRoads.find(r => r.id === unit.roadId);
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

  private removeUnit(id: string): void {
    const existing = this.unitGfx.get(id);
    if (existing) { existing.destroy(); this.unitGfx.delete(id); }
  }

  private showFloatingDamage(x: number, y: number, amount: number, color: string = '#ff4444'): void {
    const txt = this.add.text(x, y - 10, `-${amount}`, {
      fontSize: '11px', color, fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);

    this.tweens.add({
      targets: txt,
      y: y - 40,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => txt.destroy(),
    });
  }

  private updateCityHealthBar(cityData: CityData): void {
    const cityId = cityData.id;
    let bar = this.cityHealthBars.get(cityId);

    const hp = cityData.health ?? cityData.maxHealth ?? 1000;
    const maxHp = cityData.maxHealth ?? 1000;
    // Only show when city is damaged
    if (hp >= maxHp) {
      if (bar) { bar.destroy(); this.cityHealthBars.delete(cityId); }
      return;
    }

    if (!bar) {
      bar = this.add.graphics();
      this.cityHealthBars.set(cityId, bar);
    }

    const barWidth = 50;
    const barHeight = 5;
    const x = cityData.x - barWidth / 2;
    const y = cityData.y + 48;
    const ratio = hp / maxHp;

    bar.clear();
    bar.fillStyle(0x000000, 0.6);
    bar.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);
    bar.fillStyle(ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444, 1);
    bar.fillRect(x, y, barWidth * ratio, barHeight);
    bar.setDepth(45);
  }

  // ── Selection ──────────────────────────────────────────────
  private selectEntity(type: SelectionType, id: string, name: string, data?: any): void {
    // Hide radial menu when selecting something other than intersection
    if (type !== 'intersection') this.hideRadialMenu();

    this.selection = { type, id, name, data };
    if (this.selectionRing) {
      this.selectionRing.clear();
      if (type === 'city' && data) {
        this.selectionRing.lineStyle(2, 0xffff00, 0.8);
        this.selectionRing.strokeCircle(data.x, data.y, data.influenceRadius);
        this.selectionRing.lineStyle(3, 0xffff00, 1);
        this.selectionRing.strokeRect(data.x - 30, data.y - 30, 60, 60);
      } else if (type === 'intersection' && data) {
        this.selectionRing.lineStyle(3, 0xffff00, 1);
        this.selectionRing.strokeCircle(data.x, data.y, 22);
      } else if (type === 'building' && data) {
        this.selectionRing.lineStyle(2, 0xffff00, 1);
        this.selectionRing.strokeRect(data.x - 14, data.y - 14, 28, 28);
      }
    }
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection(this.selection);
  }

  private clearSelection(): void {
    this.hideRadialMenu();
    this.selection = { type: 'none', id: '', name: '' };
    if (this.selectionRing) this.selectionRing.clear();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection(this.selection);
  }

  // ── Camera ────────────────────────────────────────────────
  private setupCameraControls(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && p.leftButtonDown()) {
        this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / this.cameras.main.zoom;
      }
    });
    this.input.on('wheel', (_p: any, _gx: any, _gy: any, dz: number[]) => {
      this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - dz[0] * 0.001, 0.5, 2));
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Only deselect if clicking on pure background (no interactive objects hit)
      if (p.downElement === this.game.canvas) {
        const hits = this.input.hitTestPointer(p);
        let hitInteractive = false;
        for (const hit of hits) {
          if ((hit as any).input && (hit as any).input.enabled) { hitInteractive = true; break; }
        }
        if (!hitInteractive && p.leftButtonDown()) {
          this.clearSelection();
        }
      }
    });
  }

  // ── Exposed for React ────────────────────────────────────
  getClient(): GameClient | null { return this.client; }
  getCityBuildingCount(cityId: string): number { return this.cityBuildingCounts.get(cityId) || 0; }

  // ── Network ───────────────────────────────────────────────
  private async connectToServer(): Promise<void> {
    const host = window.location.hostname;
    const port = '2567';
    this.client = new GameClient(`ws://${host}:${port}`);
    try {
      await this.client.connect();
      this.client.onStateChange((state) => this.syncState(state));
    } catch (_) {
      console.warn('Offline mode');
    }
  }

  private syncState(state: any): void {
    // Cities
    if (state.cities) {
      state.cities.forEach((s: any, id: string) => {
        const local = this.cities.get(id);
        if (local) {
          const prevHealth = (local.data.health ?? s.maxHealth ?? 1000) as number;
          local.data.ownerId = s.ownerId;
          local.data.townHallLevel = s.townHallLevel;
          local.data.influenceRadius = s.influenceRadius;
          local.data.health = s.health || s.maxHealth;
          local.data.maxHealth = s.maxHealth;
          if (s.maxBuildings !== undefined) local.data.maxBuildings = s.maxBuildings;

          // Floating damage for city
          const currentHp = local.data.health ?? prevHealth;
          if (prevHealth > 0 && currentHp < prevHealth) {
            this.showFloatingDamage(local.data.x, local.data.y, prevHealth - currentHp, '#ff8800');
          }

          const banner = local.gfx.getAt(5) as Phaser.GameObjects.Rectangle;
          banner.setFillStyle(s.ownerId ? 0xff4444 : 0xcccccc);
          (local.gfx.getAt(7) as Phaser.GameObjects.Text).setText(`Lv.${s.townHallLevel}`);
          (local.gfx.getAt(0) as Phaser.GameObjects.Arc).setRadius(s.influenceRadius);

          // City health bar
          this.updateCityHealthBar(local.data);
        }
      });
    }

    // Buildings
    this.cityBuildingCounts.clear();
    this.cities.forEach((_, cid) => this.cityBuildingCounts.set(cid, 0));
    if (state.buildings) {
      state.buildings.forEach((b: any) => {
        this.drawBuilding({ id: b.id, cityId: b.cityId, type: b.type, x: b.x, y: b.y, level: b.level || 1 });
        this.cityBuildingCounts.set(b.cityId, (this.cityBuildingCounts.get(b.cityId) || 0) + 1);
      });
      const onBuildingsUpdate = this.game.registry.get('onBuildingsUpdate') as ((c: Map<string, number>) => void);
      if (onBuildingsUpdate) onBuildingsUpdate(this.cityBuildingCounts);
    }

    // Units
    if (state.units) {
      const syncedIds = new Set<string>();
      state.units.forEach((u: any) => {
        syncedIds.add(u.id);
        // Detect damage for floating numbers
        const prevHp = this.prevUnitHealth.get(u.id) ?? u.maxHealth;
        if (prevHp > 0 && u.health < prevHp) {
          const pos = this.getUnitWorldPos({ id: u.id, ownerId: u.ownerId, type: u.type, roadId: u.roadId, t: u.t, health: u.health, maxHealth: u.maxHealth });
          if (pos) this.showFloatingDamage(pos.x, pos.y, prevHp - u.health);
        }
        this.prevUnitHealth.set(u.id, u.health);
        let color: string | undefined;
        if (state.players) state.players.forEach((p: any) => { if (p.id === u.ownerId) color = p.colorHex; });
        this.drawUnit({ id: u.id, ownerId: u.ownerId, type: u.type, roadId: u.roadId, t: u.t, health: u.health, maxHealth: u.maxHealth }, color);
      });
      // Clean up stale health tracking
      this.prevUnitHealth.forEach((_, id) => { if (!syncedIds.has(id)) this.prevUnitHealth.delete(id); });
      // Remove stale unit graphics
      this.unitGfx.forEach((_, id) => { if (!syncedIds.has(id)) this.removeUnit(id); });
    }

    // Players / Resources
    if (state.players) {
      const myId = this.client?.sessionId;
      if (myId) {
        const player = state.players.get(myId);
        if (player) {
          const onResourceUpdate = this.game.registry.get('onResourceUpdate') as (r: any) => void;
          if (onResourceUpdate) onResourceUpdate({
            wood: player.wood, food: player.food, gold: player.gold,
            popUsed: player.populationUsed, popCap: player.populationCap,
          });
        }
      }
      state.players.forEach((p: any) => {
        if (p.connectedCityId) {
          const city = this.cities.get(p.connectedCityId);
          if (city) {
            const banner = city.gfx.getAt(5) as Phaser.GameObjects.Rectangle;
            try { banner.setFillStyle(Phaser.Display.Color.HexStringToColor(p.colorHex).color); } catch (_) {}
          }
        }
      });
    }

    // Redraw selection ring if something selected
    if (this.selection.type !== 'none') {
      this.selectEntity(this.selection.type, this.selection.id, this.selection.name, this.selection.data);
    }
  }
}
