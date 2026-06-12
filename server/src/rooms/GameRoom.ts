import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, BUILDING_PRODUCTION } from './schema/BuildingNode';
import { UnitNode, TroopType, TROOP_TYPES, TROOP_STATS } from './schema/UnitNode';

const PLAYER_COLORS = ['#4488ff', '#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff'];

interface HardcodedNode { id: string; x: number; y: number; name: string; }
interface HardcodedRoad { fromId: string; toId: string; via: { x: number; y: number }[]; }

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

const ECONOMY_INTERVAL_TICKS = 10;

function getBuildingsForCity(state: GameState, cityId: string): BuildingNode[] {
  const result: BuildingNode[] = [];
  state.buildings.forEach((b) => { if (b.cityId === cityId) result.push(b); });
  return result;
}

function countBuildingType(state: GameState, cityId: string, type: string): number {
  let count = 0;
  state.buildings.forEach((b) => { if (b.cityId === cityId && b.type === type) count++; });
  return count;
}

function getUnitsOnRoad(state: GameState, roadId: string): UnitNode[] {
  const result: UnitNode[] = [];
  state.units.forEach((u) => { if (u.roadId === roadId) result.push(u); });
  return result;
}

let idCounter = 0;
function nextId(prefix: string): string { return `${prefix}_${++idCounter}_${Date.now()}`; }

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
      this.state.intersections.set(is.id, new IntersectionNode(is.id, is.x, is.y));
    });
    MAP_ROADS.forEach((r, i) => {
      const fromNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.fromId);
      const toNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.toId);
      if (!fromNode || !toNode) return;
      const spline = buildSplinePoints({ x: fromNode.x, y: fromNode.y }, r.via, { x: toNode.x, y: toNode.y });
      this.state.roads.set(`road_${i}`, new Road(`road_${i}`, r.fromId, r.toId, spline));
    });
  }

  private setMessageHandlers(): void {
    this.onMessage('set_waypoint', (client, msg: { intersectionId: string; roadId: string; direction: number }) => {
      const intersection = this.state.intersections.get(msg.intersectionId);
      if (!intersection) return;
      const existing = intersection.waypoints.find(wp => wp.roadId === msg.roadId);
      if (existing) { existing.direction = msg.direction; }
      else {
        const wp = new Waypoint();
        wp.roadId = msg.roadId;
        wp.direction = msg.direction;
        intersection.waypoints.push(wp);
      }
    });

    this.onMessage('build_structure', (client, msg: { type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const bt = msg.type as BuildingType;
      if (!BUILDING_TYPES.includes(bt)) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      const existingB = getBuildingsForCity(this.state, city.id);
      if (existingB.length >= city.maxBuildings) return;
      const cost = BUILDING_COSTS[bt];
      if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return;
      player.wood -= cost.wood; player.food -= cost.food; player.gold -= cost.gold;
      const existingOfType = countBuildingType(this.state, city.id, bt);
      const angle = (existingOfType / city.maxBuildings) * Math.PI * 2;
      const bId = nextId('bld');
      const building = new BuildingNode(bId, city.id, bt, city.x + Math.cos(angle) * 80, city.y + Math.sin(angle) * 80);
      this.state.buildings.set(bId, building);
    });

    this.onMessage('upgrade_town_hall', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      const cost = city.townHallLevel * 50;
      if (player.gold < cost) return;
      player.gold -= cost;
      city.townHallLevel++;
      city.influenceRadius = 150 + (city.townHallLevel - 1) * 40;
      city.maxBuildings = 2 + (city.townHallLevel - 1);
      city.maxHealth = 1000 + (city.townHallLevel - 1) * 500;
    });

    // Spawn troops — find the player's first barracks and spawn on nearby road
    this.onMessage('spawn_troops', (client, msg: { type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const troopType = msg.type as TroopType;
      if (!TROOP_TYPES.includes(troopType)) return;

      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;

      const stats = TROOP_STATS[troopType];
      // Check resources
      if (player.food < stats.foodCost || player.gold < stats.goldCost) return;

      // Check population
      if (player.populationUsed + 1 > player.populationCap) return;

      // Find a barracks in this city
      const barracks = getBuildingsForCity(this.state, city.id).find(b => b.type === 'barracks');
      if (!barracks) return;

      // Deduct costs
      player.food -= stats.foodCost;
      player.gold -= stats.goldCost;
      player.populationUsed += 1;

      // Find outgoing road from this city
      const roadsArray = Array.from(this.state.roads.values());
      const targetRoad = roadsArray.find(r => r.fromId === city.id) || null;
      if (!targetRoad) return;

      const unit = new UnitNode(nextId('unit'), client.sessionId, troopType, targetRoad.id);
      unit.originNodeId = city.id;
      this.state.units.set(unit.id, unit);
    });

    // Radial menu: set waypoint at intersection
    this.onMessage('set_intersection_waypoint', (client, msg: { intersectionId: string; incomingRoadId: string; direction: number }) => {
      const intersection = this.state.intersections.get(msg.intersectionId);
      if (!intersection) return;

      // Map direction to actual outgoing road
      const outgoingRoads: Road[] = [];
      this.state.roads.forEach((r) => {
        if (r.fromId === msg.intersectionId) outgoingRoads.push(r);
      });

      // Sort by angle for Left/Straight/Right mapping
      // direction: 0 = straight, -1 = left, 1 = right
      // For a simple 2-road intersection (one in, one out), all directions map to the only outgoing
      let targetRoad: Road | null = null;
      if (outgoingRoads.length === 0) return;
      if (outgoingRoads.length === 1) {
        targetRoad = outgoingRoads[0];
      } else {
        // Multiple outgoing — sort by angle relative to incoming
        const incomingRoad: Road | undefined = undefined;
        this.state.roads.forEach((r) => {
          if (r.id === msg.incomingRoadId) targetRoad = outgoingRoads[0]; // simplified: pick first
        });
        targetRoad = outgoingRoads[0];
      }

      // Store the decision in the unit's waypoint system
      // For now, store in intersection waypoints as { roadId: incomingRoadId, direction }
      const existing = intersection.waypoints.find(wp => wp.roadId === msg.incomingRoadId);
      if (existing) {
        existing.direction = msg.direction;
      } else {
        const wp = new Waypoint();
        wp.roadId = msg.incomingRoadId;
        wp.direction = msg.direction;
        intersection.waypoints.push(wp);
      }
    });
  }

  onJoin(client: Client, options: any): void {
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    const player = new Player(client.sessionId, options.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[colorIndex]);
    const unowned = [...this.state.cities.values()].find(c => !c.ownerId);
    if (unowned) { unowned.ownerId = client.sessionId; player.connectedCityId = unowned.id; }
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean): void {
    const player = this.state.players.get(client.sessionId);
    if (player && player.connectedCityId) {
      const city = this.state.cities.get(player.connectedCityId);
      if (city) city.ownerId = '';
    }
    this.state.players.delete(client.sessionId);
  }

  onDispose(): void { clearInterval(this.tickInterval); }

  private gameTick(): void {
    this.state.tick++;
    if (this.state.tick % ECONOMY_INTERVAL_TICKS === 0) this.processEconomy();
    this.moveUnits();
  }

  private processEconomy(): void {
    const processedPlayers = new Set<string>();
    this.state.cities.forEach((city) => {
      if (!city.ownerId || processedPlayers.has(city.ownerId)) return;
      processedPlayers.add(city.ownerId);
      const player = this.state.players.get(city.ownerId);
      if (!player) return;
      if (player.lastEconomyTick >= this.state.tick) return;
      player.lastEconomyTick = this.state.tick;

      let wood = city.townHallLevel * 2;
      let food = city.townHallLevel * 1;
      let gold = Math.floor(city.townHallLevel * 0.5);
      const buildings = getBuildingsForCity(this.state, city.id);
      buildings.forEach((b) => {
        const prod = BUILDING_PRODUCTION[b.type as BuildingType];
        if (prod) { wood += prod.woodPerTick; food += prod.foodPerTick; gold += prod.goldPerTick; }
      });
      player.wood += wood; player.food += food; player.gold += gold;
      player.populationCap = 10 + countBuildingType(this.state, city.id, 'farm') * 5;
      player.wood = Math.max(0, player.wood);
      player.food = Math.max(0, player.food);
      player.gold = Math.max(0, player.gold);
    });
  }

  // ─── Unit Movement ────────────────────────────────────────────

  private moveUnits(): void {
    const toRemove: string[] = [];

    this.state.units.forEach((unit) => {
      const road = this.state.roads.get(unit.roadId);
      if (!road) { toRemove.push(unit.id); return; }

      const stats = TROOP_STATS[unit.type as TroopType];
      if (!stats) { toRemove.push(unit.id); return; }

      // Advance along road
      unit.t += stats.speed;

      if (unit.t >= 1.0) {
        // Reached the end of the road
        const targetNodeId = road.toId;
        const targetNode = this.state.cities.get(targetNodeId) || this.state.intersections.get(targetNodeId);

        if (!targetNode) {
          toRemove.push(unit.id);
          return;
        }

        // If it's a city, handle arrival (Phase 4 will have combat)
        if (this.state.cities.has(targetNodeId)) {
          // Unit arrived at city — attack logic in Phase 4
          // For now, remove unit on arrival (no combat yet)
          toRemove.push(unit.id);
          // Refund population
          const player = this.state.players.get(unit.ownerId);
          if (player) player.populationUsed = Math.max(0, player.populationUsed - 1);
          return;
        }

        // It's an intersection — find the next road
        const nextRoad = this.findNextRoad(unit, road, targetNodeId);

        if (nextRoad) {
          unit.roadId = nextRoad.id;
          unit.t = 0;
          unit.originNodeId = targetNodeId;
        } else {
          // No outgoing road — unit removed
          toRemove.push(unit.id);
          const player = this.state.players.get(unit.ownerId);
          if (player) player.populationUsed = Math.max(0, player.populationUsed - 1);
        }
      }
    });

    toRemove.forEach((id) => this.state.units.delete(id));
  }

  private findNextRoad(unit: UnitNode, currentRoad: Road, intersectionId: string): Road | null {
    const outgoing: Road[] = [];
    this.state.roads.forEach((r) => {
      if (r.fromId === intersectionId && r.id !== currentRoad.id && r.toId !== unit.originNodeId) {
        outgoing.push(r);
      }
    });

    if (outgoing.length === 0) return null;

    // Check waypoints from the intersection
    const intersection = this.state.intersections.get(intersectionId);
    if (intersection) {
      const waypoint = intersection.waypoints.find(wp => wp.roadId === currentRoad.id);
      if (waypoint) {
        // direction: 0 = straight (first), -1 = left (last), 1 = right (middle if 3)
        const idx = waypoint.direction === -1
          ? outgoing.length - 1
          : waypoint.direction === 1
            ? Math.min(1, outgoing.length - 1)
            : 0;
        return outgoing[idx] || outgoing[0];
      }
    }

    // Default: take the first new road
    return outgoing[0];
  }
}
