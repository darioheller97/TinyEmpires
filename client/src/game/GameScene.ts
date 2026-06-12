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

export default class GameScene extends Phaser.Scene {
  private cameraTarget: { x: number; y: number } = { x: 800, y: 400 };
  private roads: Phaser.GameObjects.Graphics[] = [];
  private cities: Map<string, { gfx: Phaser.GameObjects.Container; data: CityData }> = new Map();
  private intersections: Map<string, { gfx: Phaser.GameObjects.Container; data: IntersectionData }> = new Map();
  private client: GameClient | null = null;

  // Hardcoded map (mirrors server)
  private mapCities: CityData[] = [
    { id: 'city_a', x: 300, y: 400, name: 'Red Keep', ownerId: '', townHallLevel: 1, influenceRadius: 150 },
    { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel', ownerId: '', townHallLevel: 1, influenceRadius: 150 },
  ];

  private mapIntersections: IntersectionData[] = [
    { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
  ];

  private mapRoads: RoadData[] = [
    {
      id: 'road_0',
      fromId: 'city_a',
      toId: 'cross_1',
      splinePoints: this.buildSplinePoints({ x: 300, y: 400 }, [{ x: 550, y: 400 }], { x: 800, y: 400 }),
    },
    {
      id: 'road_1',
      fromId: 'cross_1',
      toId: 'city_b',
      splinePoints: this.buildSplinePoints({ x: 800, y: 400 }, [{ x: 1050, y: 400 }], { x: 1300, y: 400 }),
    },
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
    // Set world bounds for camera
    this.cameras.main.setBounds(0, 0, 1600, 800);
    this.cameras.main.centerOn(800, 400);

    // Draw terrain background
    this.drawTerrain();

    // Draw roads
    this.mapRoads.forEach(road => this.drawRoad(road));

    // Draw intersections
    this.mapIntersections.forEach(is => this.drawIntersection(is));

    // Draw cities
    this.mapCities.forEach(city => this.drawCity(city));

    // Notify React about map bounds
    const onMapBounds = this.game.registry.get('onMapBounds') as (b: { width: number; height: number }) => void;
    if (onMapBounds) onMapBounds({ width: 1600, height: 800 });

    // Camera controls
    this.setupCameraControls();

    // Connect to server
    this.connectToServer();
  }

  private drawTerrain(): void {
    const gfx = this.add.graphics();
    // Tiled grass pattern
    const tileSize = 64;
    const cols = 25;
    const rows = 13;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isEven = (r + c) % 2 === 0;
        gfx.fillStyle(isEven ? 0x3d7a33 : 0x4a8c3f, 1);
        gfx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
  }

  private drawRoad(road: RoadData): void {
    const gfx = this.add.graphics();
    const pts = road.splinePoints;

    // Road fill (dirt path)
    gfx.lineStyle(16, 0x8b6f47, 1);
    if (pts.length > 1) {
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        gfx.lineTo(pts[i].x, pts[i].y);
      }
      gfx.strokePath();
    }

    // Road edge lines
    gfx.lineStyle(2, 0x6b4f2e, 0.6);
    if (pts.length > 1) {
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        gfx.lineTo(pts[i].x, pts[i].y);
      }
      gfx.strokePath();
    }

    this.roads.push(gfx);
  }

  private drawIntersection(is: IntersectionData): void {
    const container = this.add.container(is.x, is.y);

    // Circle pad
    const circle = this.add.circle(0, 0, 18, 0x5c4033, 1);
    const inner = this.add.circle(0, 0, 12, 0x8b6914, 1);
    const label = this.add.text(0, -30, is.name, {
      fontSize: '11px',
      color: '#ffd700',
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    container.add([circle, inner, label]);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 22), Phaser.Geom.Circle.Contains);

    // Click handler — future: radial menu
    container.on('pointerdown', () => {
      console.log(`Intersection clicked: ${is.id}`);
    });

    container.on('pointerover', () => {
      container.setScale(1.15);
    });
    container.on('pointerout', () => {
      container.setScale(1);
    });

    this.intersections.set(is.id, { gfx: container, data: is });
  }

  private drawCity(city: CityData): void {
    const container = this.add.container(city.x, city.y);

    // Influence zone (transparent circle)
    const influence = this.add.circle(0, 0, city.influenceRadius, 0x4488ff, 0.08);
    influence.setStrokeStyle(1, 0x4488ff, 0.2);

    // Castle base
    const base = this.add.rectangle(0, 0, 50, 40, 0x5a5a6e, 1);
    base.setStrokeStyle(2, 0x8888aa, 1);

    // Castle top (towers)
    const leftTower = this.add.rectangle(-18, -10, 14, 20, 0x6a6a7e, 1);
    const rightTower = this.add.rectangle(18, -10, 14, 20, 0x6a6a7e, 1);
    const centerKeystone = this.add.rectangle(0, -15, 10, 12, 0x7a7a8e, 1);

    // Colored banner based on ownership
    const bannerColor = city.ownerId ? Phaser.Display.Color.HexStringToColor('#ff4444').color : 0xcccccc;
    const banner = this.add.rectangle(0, -25, 20, 8, bannerColor, 1);

    // Name label
    const nameLabel = this.add.text(0, 35, city.name, {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    container.add([influence, base, leftTower, rightTower, centerKeystone, banner, nameLabel]);
    container.setInteractive(new Phaser.Geom.Rectangle(-30, -30, 60, 60), Phaser.Geom.Rectangle.Contains);

    container.on('pointerdown', () => {
      console.log(`City clicked: ${city.name}`);
    });

    this.cities.set(city.id, { gfx: container, data: city });
  }

  private setupCameraControls(): void {
    // Drag to pan
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.leftButtonDown()) {
        this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
      }
    });

    // Scroll to zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gx: number[], _gy: number[], dz: number[]) => {
      const delta = dz[0];
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - delta * 0.001, 0.5, 2);
      this.cameras.main.setZoom(zoom);
    });
  }

  private async connectToServer(): Promise<void> {
    const host = window.location.hostname;
    const port = '2567';
    const wsUrl = `${host}:${port}`;

    this.client = new GameClient(wsUrl);

    try {
      await this.client.connect();
      console.log('Connected to server');

      this.client.onStateChange((state) => {
        this.syncState(state);
      });
    } catch (err) {
      console.warn('Could not connect to server. Running in offline mode.');
    }
  }

  private syncState(state: any): void {
    // Sync city ownership
    if (state.cities) {
      state.cities.forEach((serverCity: any, id: string) => {
        const local = this.cities.get(id);
        if (local) {
          local.data.ownerId = serverCity.ownerId;
          local.data.townHallLevel = serverCity.townHallLevel;
          // Update visual banner color
          const banner = local.gfx.getAt(5) as Phaser.GameObjects.Rectangle;
          const color = serverCity.ownerId ? 0xff4444 : 0xcccccc;
          banner.setFillStyle(color);
        }
      });
    }

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
    }
  }

  update(): void {
    // Future: animate units along roads
  }
}
