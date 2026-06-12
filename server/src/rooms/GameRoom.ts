import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, BUILDING_PRODUCTION } from './schema/BuildingNode';

const PLAYER_COLORS = ['#4488ff', '#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff'];

interface HardcodedNode {
  id: string;
  x: number;
  y: number;
  name: string;
}

interface HardcodedRoad {
  fromId: string;
  toId: string;
  via: { x: number; y: number }[];
}

const MAP_CITIES: HardcodedNode[] = [
  { id: 'city_a', x: 300, y: 400, name: 'Red Keep' },
  { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel' },
];

const MAP_INTERSECTIONS: HardcodedNode[] = [
  { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
];

const MAP_ROADS: HardcodedRoad[] = [
  { fromId: 'city_a', toId: 'cross_1', via: [{ x: 550, y: 400 }] },
  { fromId: 'cross_1', toId: 'city_b', via: [{ x: 1050, y: 400 }] },
];

function buildSplinePoints(start: { x: number; y: number }, via: { x: number; y: number }[], end: { x: number; y: number }): { x: number; y: number }[] {
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

// Economy fires once per second (every 10 ticks at 100ms)
const ECONOMY_INTERVAL_TICKS = 10;

// Helper: get all buildings for a city
function getBuildingsForCity(state: GameState, cityId: string): BuildingNode[] {
  const result: BuildingNode[] = [];
  state.buildings.forEach((b) => {
    if (b.cityId === cityId) result.push(b);
  });
  return result;
}

// Helper: count building types for a city
function countBuildingType(state: GameState, cityId: string, type: string): number {
  let count = 0;
  state.buildings.forEach((b) => {
    if (b.cityId === cityId && b.type === type) count++;
  });
  return count;
}

let buildingIdCounter = 0;
function nextBuildingId(): string {
  return `bld_${++buildingIdCounter}_${Date.now()}`;
}

export class GameRoom extends Room<GameState> {
  maxClients = 10;
  private tickInterval!: ReturnType<typeof setInterval>;

  onCreate(options: any): void {
    console.log('GameRoom created!');
    this.setState(new GameState());
    this.initMap();
    this.setMessageHandlers();

    this.tickInterval = setInterval(() => this.gameTick(), 100);
  }

  private initMap(): void {
    MAP_CITIES.forEach((c) => {
      const city = new CityNode(c.id, c.x, c.y, c.name);
      city.maxBuildings = 2;
      this.state.cities.set(c.id, city);
    });

    MAP_INTERSECTIONS.forEach((is) => {
      const intersection = new IntersectionNode(is.id, is.x, is.y);
      this.state.intersections.set(is.id, intersection);
    });

    MAP_ROADS.forEach((r, i) => {
      const fromNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.fromId);
      const toNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.toId);
      if (!fromNode || !toNode) return;

      const spline = buildSplinePoints(
        { x: fromNode.x, y: fromNode.y },
        r.via,
        { x: toNode.x, y: toNode.y }
      );
      const road = new Road(`road_${i}`, r.fromId, r.toId, spline);
      this.state.roads.set(road.id, road);
    });
  }

  private setMessageHandlers(): void {
    this.onMessage('set_waypoint', (client, message: { intersectionId: string; roadId: string; direction: number }) => {
      const intersection = this.state.intersections.get(message.intersectionId);
      if (!intersection) return;
      const existing = intersection.waypoints.find(wp => wp.roadId === message.roadId);
      if (existing) {
        existing.direction = message.direction;
      } else {
        const wp = new Waypoint();
        wp.roadId = message.roadId;
        wp.direction = message.direction;
        intersection.waypoints.push(wp);
      }
    });

    // Build a structure in the player's city
    this.onMessage('build_structure', (client, message: { type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;

      const buildingType = message.type as BuildingType;
      if (!BUILDING_TYPES.includes(buildingType)) return;

      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;

      // Check building slot limit
      const existingBuildings = getBuildingsForCity(this.state, city.id);
      if (existingBuildings.length >= city.maxBuildings) {
        console.log(`City ${city.id} at building slot limit (${city.maxBuildings})`);
        return;
      }

      // Check resource cost
      const cost = BUILDING_COSTS[buildingType];
      if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return;

      // Deduct cost
      player.wood -= cost.wood;
      player.food -= cost.food;
      player.gold -= cost.gold;

      // Place building at a spot within influence radius
      const bId = nextBuildingId();
      const existingOfType = countBuildingType(this.state, city.id, buildingType);
      // Stagger building positions radially around the city
      const angle = (existingOfType / city.maxBuildings) * Math.PI * 2;
      const radius = 80;
      const bx = city.x + Math.cos(angle) * radius;
      const by = city.y + Math.sin(angle) * radius;

      const building = new BuildingNode(bId, city.id, buildingType, bx, by);
      this.state.buildings.set(bId, building);

      console.log(`Player ${client.sessionId} built ${buildingType} at city ${city.id}`);
    });

    // Upgrade town hall (costs gold)
    this.onMessage('upgrade_town_hall', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;

      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;

      const upgradeCost = city.townHallLevel * 50;
      if (player.gold < upgradeCost) return;

      player.gold -= upgradeCost;
      city.townHallLevel++;
      city.influenceRadius = 150 + (city.townHallLevel - 1) * 40;
      city.maxBuildings = 2 + (city.townHallLevel - 1);
      city.maxHealth = 1000 + (city.townHallLevel - 1) * 500;

      console.log(`Player ${client.sessionId} upgraded ${city.name} to level ${city.townHallLevel}`);
    });
  }

  onJoin(client: Client, options: any): void {
    console.log(`Player ${client.sessionId} joined.`);

    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    const player = new Player(client.sessionId, options.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[colorIndex]);

    const unowned = [...this.state.cities.values()].find(c => !c.ownerId);
    if (unowned) {
      unowned.ownerId = client.sessionId;
      player.connectedCityId = unowned.id;
    }

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean): void {
    console.log(`Player ${client.sessionId} left.`);

    const player = this.state.players.get(client.sessionId);
    if (player && player.connectedCityId) {
      const city = this.state.cities.get(player.connectedCityId);
      if (city) {
        city.ownerId = '';
      }
    }

    this.state.players.delete(client.sessionId);
  }

  onDispose(): void {
    clearInterval(this.tickInterval);
    console.log('GameRoom disposed.');
  }

  private gameTick(): void {
    this.state.tick++;

    // Economy runs every ECONOMY_INTERVAL_TICKS
    if (this.state.tick % ECONOMY_INTERVAL_TICKS === 0) {
      this.processEconomy();
    }
  }

  private processEconomy(): void {
    // Track which players we've already processed (in case of multiple cities)
    const processedPlayers = new Set<string>();

    this.state.cities.forEach((city) => {
      if (!city.ownerId) return;
      if (processedPlayers.has(city.ownerId)) return;
      processedPlayers.add(city.ownerId);

      const player = this.state.players.get(city.ownerId);
      if (!player) return;

      // Only process once per economy cycle
      if (player.lastEconomyTick >= this.state.tick) return;
      player.lastEconomyTick = this.state.tick;

      // Base production from town hall
      let woodPerTick = city.townHallLevel * 2;   // 2 per level
      let foodPerTick = city.townHallLevel * 1;    // 1 per level
      let goldPerTick = Math.floor(city.townHallLevel * 0.5); // 1 every 2 levels

      // Add production from buildings
      const buildings = getBuildingsForCity(this.state, city.id);
      buildings.forEach((b) => {
        const prod = BUILDING_PRODUCTION[b.type as BuildingType];
        if (prod) {
          woodPerTick += prod.woodPerTick;
          foodPerTick += prod.foodPerTick;
          goldPerTick += prod.goldPerTick;
        }
      });

      // Apply production (as integers for now)
      player.wood += woodPerTick;
      player.food += foodPerTick;
      player.gold += goldPerTick;

      // Calculate population cap: base 10 + 5 per farm
      const farmCount = countBuildingType(this.state, city.id, 'farm');
      player.populationCap = 10 + farmCount * 5;

      // Clamp resources (no negative)
      player.wood = Math.max(0, player.wood);
      player.food = Math.max(0, player.food);
      player.gold = Math.max(0, player.gold);
    });
  }
}
