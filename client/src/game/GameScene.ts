import Phaser from 'phaser';
import { GameClient } from '../network/GameClient';

interface CityData {
  id: string;
  x: number;
  y: number;
  name: string;
  ownerId: string;
  townHallLevel: number;
  influenceRadius: number;
  maxBuildings: number;
}

interface IntersectionData {
  id: string;
  x: number;
  y: number;
  name: string;
}

interface RoadData {
  id: string;
  fromId: string;
  toId: string;
  splinePoints: { x: number; y: number }[];
}

interface BuildData {
  id: string;
  cityId: string;
  type: string;
  x: number;
  y: number;
  level: number;
}

export type SelectionType = 'city' | 'intersection' | 'building' | 'none';

export interface SelectionInfo {
  type: SelectionType;
  id: string;
  name: string;
  data?: any;
}

export default class GameScene extends Phaser.Scene {
  private roads: Phaser.GameObjects.Graphics[] = [];
  private cities: Map<string, { gfx: Phaser.GameObjects.Container; data: CityData }> = new Map();
  private intersectionGfx: Map<string, { gfx: Phaser.GameObjects.Container; data: IntersectionData }> = new Map();
  private buildingGfx: Map<string, Phaser.GameObjects.Container> = new Map();
  private client: GameClient | null = null;
  private selection: SelectionInfo = { type: 'none', id: '', name: '' };
  private selectionRing: Phaser.GameObjects.Graphics | null = null;
  private cityBuildingCounts: Map<string, number> = new Map();

  // Hardcoded map
  private mapCities: CityData[] = [
    { id: 'city_a', x: 300, y: 400, name: 'Red Keep', ownerId: '', townHallLevel: 1, influenceRadius: 150, maxBuildings: 2 },
    { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel', ownerId: '', townHallLevel: 1, influenceRadius: 150, maxBuildings: 2 },
  ];
  private mapIntersections: IntersectionData[] = [
    { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
  ];
  private mapRoads: RoadData[] = [
    { id: 'road_0', fromId: 'city_a', toId: 'cross_1', splinePoints: this.buildSplinePoints({ x: 300, y: 400 }, [{ x: 550, y: 400 }], { x: 800, y: 400 }) },
    { id: 'road_1', fromId: 'cross_1', toId: 'city_b', splinePoints: this.buildSplinePoints({ x: 800, y: 400 }, [{ x: 1050, y: 400 }], { x: 1300, y: 400 }) },
  ];

  private buildSplinePoints(start: { x: number; y: number }, via: { x: number; y: number }[], end: { x: number; y: number }): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    const all = [start, ...via, end];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      const b = all[i + 1];
      const steps = 20;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return points;
  }

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, 1600, 800);
    this.cameras.main.centerOn(800, 400);

    this.drawTerrain();
    this.mapRoads.forEach(road => this.drawRoad(road));
    this.mapIntersections.forEach(is => this.drawIntersection(is));
    this.mapCities.forEach(city => this.drawCity(city));

    this.selectionRing = this.add.graphics();

    const onMapBounds = this.game.registry.get('onMapBounds') as (b: { width: number; height: number }) => void;
    if (onMapBounds) onMapBounds({ width: 1600, height: 800 });

    this.setupCameraControls();
    this.connectToServer();
  }

  private drawTerrain(): void {
    const gfx = this.add.graphics();
    const tileSize = 64;
    const cols = 25;
    const rows = 13;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        gfx.fillStyle((r + c) % 2 === 0 ? 0x3d7a33 : 0x4a8c3f, 1);
        gfx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
  }

  private drawRoad(road: RoadData): void {
    const gfx = this.add.graphics();
    const pts = road.splinePoints;
    gfx.lineStyle(16, 0x8b6f47, 1);
    if (pts.length > 1) {
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.strokePath();
    }
    gfx.lineStyle(2, 0x6b4f2e, 0.6);
    if (pts.length > 1) {
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.strokePath();
    }
    this.roads.push(gfx);
  }

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
    container.on('pointerdown', () => this.selectEntity('intersection', is.id, is.name, is));
    container.on('pointerover', () => container.setScale(1.15));
    container.on('pointerout', () => { if (this.selection.id !== is.id) container.setScale(1); });
    this.intersectionGfx.set(is.id, { gfx: container, data: is });
  }

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

  private drawBuilding(b: BuildData): void {
    if (this.buildingGfx.has(b.id)) return;

    const container = this.add.container(b.x, b.y);
    const colors: Record<string, number> = {
      lumber_mill: 0x8b5e3c,
      farm: 0x7cb342,
      gold_mine: 0xfdd835,
      barracks: 0x8d6e63,
      defense_tower: 0x78909c,
    };
    const iconChars: Record<string, string> = {
      lumber_mill: '🌲',
      farm: '🌾',
      gold_mine: '💎',
      barracks: '⚔️',
      defense_tower: '🏰',
    };

    const color = colors[b.type] || 0x666666;
    const rect = this.add.rectangle(0, 0, 20, 20, color, 0.9);
    rect.setStrokeStyle(1, 0xffffff, 0.5);
    const label = this.add.text(0, 0, b.type === 'lumber_mill' ? 'W' : b.type === 'farm' ? 'F' : b.type === 'gold_mine' ? 'G' : b.type === 'barracks' ? 'B' : 'D', {
      fontSize: '10px', color: '#fff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    container.add([rect, label]);
    container.setInteractive(new Phaser.Geom.Rectangle(-12, -12, 24, 24), Phaser.Geom.Rectangle.Contains);
    container.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.selectEntity('building', b.id, b.type, b);
    });

    this.buildingGfx.set(b.id, container);
  }

  private selectEntity(type: SelectionType, id: string, name: string, data?: any): void {
    this.selection = { type, id, name, data };

    // Update selection ring
    if (this.selectionRing) {
      this.selectionRing.clear();
      if (type === 'city') {
        const city = this.cities.get(id)?.data;
        if (city) {
          this.selectionRing.lineStyle(2, 0xffff00, 0.8);
          this.selectionRing.strokeCircle(city.x, city.y, city.influenceRadius);
          this.selectionRing.lineStyle(3, 0xffff00, 1);
          this.selectionRing.strokeRect(city.x - 30, city.y - 30, 60, 60);
        }
      } else if (type === 'intersection') {
        const is = this.intersectionGfx.get(id)?.data;
        if (is) {
          this.selectionRing.lineStyle(3, 0xffff00, 1);
          this.selectionRing.strokeCircle(is.x, is.y, 22);
        }
      } else if (type === 'building') {
        const b = data as BuildData;
        if (b) {
          this.selectionRing.lineStyle(2, 0xffff00, 1);
          this.selectionRing.strokeRect(b.x - 14, b.y - 14, 28, 28);
        }
      }
    }

    // Notify React
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection(this.selection);
  }

  private setupCameraControls(): void {
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.leftButtonDown()) {
        this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
      }
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gx: number[], _gy: number[], dz: number[]) => {
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dz[0] * 0.001, 0.5, 2);
      this.cameras.main.setZoom(zoom);
    });
    // Deselect on background click
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // If no interactive object was hit
      const hits = this.input.hitTestPointer(pointer);
      if (hits.length === 0 || (hits.length === 1 && hits[0] === this.children.list[0])) {
        this.clearSelection();
      }
    });
  }

  private clearSelection(): void {
    this.selection = { type: 'none', id: '', name: '' };
    if (this.selectionRing) this.selectionRing.clear();
    const onSelection = this.game.registry.get('onSelectionChange') as ((s: SelectionInfo) => void);
    if (onSelection) onSelection(this.selection);
  }

  // Exposed for React
  getClient(): GameClient | null { return this.client; }
  getCityBuildingCount(cityId: string): number { return this.cityBuildingCounts.get(cityId) || 0; }

  private async connectToServer(): Promise<void> {
    const host = window.location.hostname;
    const port = '2567';
    this.client = new GameClient(`ws://${host}:${port}`);

    try {
      await this.client.connect();
      console.log('Connected to server');
      this.client.onStateChange((state) => this.syncState(state));
    } catch (err) {
      console.warn('Could not connect to server. Running in offline mode.');
    }
  }

  private syncState(state: any): void {
    // Sync cities
    if (state.cities) {
      state.cities.forEach((serverCity: any, id: string) => {
        const local = this.cities.get(id);
        if (local) {
          local.data.ownerId = serverCity.ownerId;
          local.data.townHallLevel = serverCity.townHallLevel;
          local.data.influenceRadius = serverCity.influenceRadius;
          if (serverCity.maxBuildings !== undefined) local.data.maxBuildings = serverCity.maxBuildings;
          const banner = local.gfx.getAt(5) as Phaser.GameObjects.Rectangle;
          banner.setFillStyle(serverCity.ownerId ? 0xff4444 : 0xcccccc);
          const levelLabel = local.gfx.getAt(7) as Phaser.GameObjects.Text;
          levelLabel.setText(`Lv.${serverCity.townHallLevel}`);
          const influence = local.gfx.getAt(0) as Phaser.GameObjects.Arc;
          influence.setRadius(serverCity.influenceRadius);
        }
      });
    }

    // Sync buildings
    this.cityBuildingCounts.clear();
    this.cities.forEach((_, cid) => this.cityBuildingCounts.set(cid, 0));
    if (state.buildings) {
      state.buildings.forEach((b: any) => {
        this.drawBuilding({
          id: b.id,
          cityId: b.cityId,
          type: b.type,
          x: b.x,
          y: b.y,
          level: b.level || 1,
        });
        // Track count per city
        const cur = this.cityBuildingCounts.get(b.cityId) || 0;
        this.cityBuildingCounts.set(b.cityId, cur + 1);
      });
    }

    // Notify React about building counts
    const onBuildingsUpdate = this.game.registry.get('onBuildingsUpdate') as ((c: Map<string, number>) => void);
    if (onBuildingsUpdate) onBuildingsUpdate(this.cityBuildingCounts);

    // Sync player resources
    if (state.players) {
      const myId = this.client?.sessionId;
      if (myId) {
        const player = state.players.get(myId);
        if (player) {
          const onResourceUpdate = this.game.registry.get('onResourceUpdate') as (r: any) => void;
          if (onResourceUpdate) {
            onResourceUpdate({
              wood: player.wood,
              food: player.food,
              gold: player.gold,
              popUsed: player.populationUsed,
              popCap: player.populationCap,
            });
          }
        }
      }

      // Sync player color to own city banner
      state.players.forEach((player: any) => {
        if (player.connectedCityId) {
          const city = this.cities.get(player.connectedCityId);
          if (city) {
            const banner = city.gfx.getAt(5) as Phaser.GameObjects.Rectangle;
            try {
              banner.setFillStyle(Phaser.Display.Color.HexStringToColor(player.colorHex).color);
            } catch (_) {}
          }
        }
      });
    }

    // Re-draw selection ring if something is selected
    if (this.selection.type !== 'none') {
      this.selectEntity(this.selection.type, this.selection.id, this.selection.name, this.selection.data);
    }
  }
}
