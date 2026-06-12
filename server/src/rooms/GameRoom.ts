import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, BUILDING_PRODUCTION } from './schema/BuildingNode';
import { UnitNode, TroopType, TROOP_TYPES, TROOP_STATS, RPS_ADVANTAGE } from './schema/UnitNode';

const PLAYER_COLORS = ['#4488ff', '#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff'];
const ECONOMY_INTERVAL_TICKS = 10;
const COMBAT_COOLDOWN_TICKS = 3; // Fight every 3 ticks (300ms)

interface HNode { id: string; x: number; y: number; name: string; }
interface HRoad { fromId: string; toId: string; via: { x: number; y: number }[]; }

// Bidirectional roads — both cities can send troops
const MAP_CITIES: HNode[] = [
  { id: 'city_a', x: 300, y: 400, name: 'Red Keep' },
  { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel' },
];
const MAP_INTERSECTIONS: HNode[] = [
  { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
];
const MAP_ROADS: HRoad[] = [
  { fromId: 'city_a', toId: 'cross_1', via: [{ x: 550, y: 400 }] },
  { fromId: 'cross_1', toId: 'city_b', via: [{ x: 1050, y: 400 }] },
  { fromId: 'city_b', toId: 'cross_1', via: [{ x: 1050, y: 400 }] },
  { fromId: 'cross_1', toId: 'city_a', via: [{ x: 550, y: 400 }] },
];

// Re-index roads to use the full bidirectional set
const ROAD_INDEX = [
  { id: 'road_0', fromId: 'city_a', toId: 'cross_1' },
  { id: 'road_1', fromId: 'cross_1', toId: 'city_b' },
  { id: 'road_2', fromId: 'city_b', toId: 'cross_1' },
  { id: 'road_3', fromId: 'cross_1', toId: 'city_a' },
];

function buildSplinePoints(a: { x: number; y: number }, via: { x: number; y: number }[], b: { x: number; y: number }): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const all = [a, ...via, b];
  for (let i = 0; i < all.length - 1; i++) {
    const p0 = all[i], p1 = all[i + 1];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
  }
  return pts;
}

function getBuildingsForCity(state: GameState, cityId: string): BuildingNode[] {
  const r: BuildingNode[] = [];
  state.buildings.forEach(b => { if (b.cityId === cityId) r.push(b); }); return r;
}
function countBuildingType(state: GameState, cityId: string, type: string): number {
  let n = 0; state.buildings.forEach(b => { if (b.cityId === cityId && b.type === type) n++; }); return n;
}
function getNodeName(state: GameState, nodeId: string): string {
  const c = state.cities.get(nodeId); if (c) return c.name;
  const is = state.intersections.get(nodeId); if (is) return is.name;
  return nodeId;
}
function getUnitsOnRoad(state: GameState, roadId: string): UnitNode[] {
  const r: UnitNode[] = [];
  state.units.forEach(u => { if (u.roadId === roadId) r.push(u); }); return r;
}

let idCounter = 0;
function nextId(p: string): string { return `${p}_${++idCounter}_${Date.now()}`; }

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
    MAP_CITIES.forEach(c => {
      const city = new CityNode(c.id, c.x, c.y, c.name);
      city.maxBuildings = 2;
      this.state.cities.set(c.id, city);
    });
    MAP_INTERSECTIONS.forEach(is => {
      this.state.intersections.set(is.id, new IntersectionNode(is.id, is.x, is.y));
    });
    MAP_ROADS.forEach((r, i) => {
      const fromN = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.fromId);
      const toN = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.toId);
      if (!fromN || !toN) return;
      const spline = buildSplinePoints({ x: fromN.x, y: fromN.y }, r.via, { x: toN.x, y: toN.y });
      const roadId = `road_${i}`;
      this.state.roads.set(roadId, new Road(roadId, r.fromId, r.toId, spline));
    });
  }

  private setMessageHandlers(): void {
    this.onMessage('set_waypoint', (client, msg: { intersectionId: string; roadId: string; direction: number }) => {
      const is = this.state.intersections.get(msg.intersectionId);
      if (!is) return;
      const ex = is.waypoints.find(w => w.roadId === msg.roadId);
      if (ex) { ex.direction = msg.direction; }
      else { const wp = new Waypoint(); wp.roadId = msg.roadId; wp.direction = msg.direction; is.waypoints.push(wp); }
    });

    this.onMessage('build_structure', (client, msg: { type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const bt = msg.type as BuildingType;
      if (!BUILDING_TYPES.includes(bt)) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (getBuildingsForCity(this.state, city.id).length >= city.maxBuildings) return;
      const cost = BUILDING_COSTS[bt];
      if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return;
      player.wood -= cost.wood; player.food -= cost.food; player.gold -= cost.gold;
      const eot = countBuildingType(this.state, city.id, bt);
      const angle = (eot / city.maxBuildings) * Math.PI * 2;
      const bId = nextId('bld');
      const bld = new BuildingNode(bId, city.id, bt, city.x + Math.cos(angle) * 80, city.y + Math.sin(angle) * 80);
      this.state.buildings.set(bId, bld);
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
      city.health = city.maxHealth;
    });

    this.onMessage('spawn_troops', (client, msg: { type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const tt = msg.type as TroopType;
      if (!TROOP_TYPES.includes(tt)) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      const stats = TROOP_STATS[tt];
      if (player.food < stats.foodCost || player.gold < stats.goldCost) return;
      if (player.populationUsed + 1 > player.populationCap) return;
      const barracks = getBuildingsForCity(this.state, city.id).find(b => b.type === 'barracks');
      if (!barracks) return;

      player.food -= stats.foodCost; player.gold -= stats.goldCost;
      player.populationUsed += 1;

      // Find outgoing road from this city
      const roadsArr = Array.from(this.state.roads.values());
      const targetRoad = roadsArr.find(r => r.fromId === city.id) || null;
      if (!targetRoad) return;

      const unit = new UnitNode(nextId('unit'), client.sessionId, tt, targetRoad.id);
      unit.originNodeId = city.id;
      this.state.units.set(unit.id, unit);
    });

    this.onMessage('set_intersection_waypoint', (client, msg: { intersectionId: string; incomingRoadId: string; direction: number }) => {
      const is = this.state.intersections.get(msg.intersectionId);
      if (!is) return;
      const ex = is.waypoints.find(w => w.roadId === msg.incomingRoadId);
      if (ex) { ex.direction = msg.direction; }
      else { const wp = new Waypoint(); wp.roadId = msg.incomingRoadId; wp.direction = msg.direction; is.waypoints.push(wp); }
    });
  }

  onJoin(client: Client, options: any): void {
    const ci = this.state.players.size % PLAYER_COLORS.length;
    const p = new Player(client.sessionId, options.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[ci]);
    const uc = [...this.state.cities.values()].find(c => !c.ownerId);
    if (uc) { uc.ownerId = client.sessionId; p.connectedCityId = uc.id; }
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client, consented: boolean): void {
    const p = this.state.players.get(client.sessionId);
    if (p && p.connectedCityId) { const c = this.state.cities.get(p.connectedCityId); if (c) c.ownerId = ''; }
    // Remove all units belonging to this player
    const toRemove: string[] = [];
    this.state.units.forEach(u => { if (u.ownerId === client.sessionId) toRemove.push(u.id); });
    toRemove.forEach(id => this.state.units.delete(id));
    this.state.players.delete(client.sessionId);
  }

  onDispose(): void { clearInterval(this.tickInterval); }

  // ─── Game Tick ──────────────────────────────────────────────

  private gameTick(): void {
    this.state.tick++;
    if (this.state.tick % ECONOMY_INTERVAL_TICKS === 0) this.processEconomy();
    this.moveUnits();
    this.processCombat();
    this.processMonkHealing();
  }

  // ─── Economy ────────────────────────────────────────────────

  private processEconomy(): void {
    const done = new Set<string>();
    this.state.cities.forEach(city => {
      if (!city.ownerId || done.has(city.ownerId)) return;
      done.add(city.ownerId);
      const player = this.state.players.get(city.ownerId);
      if (!player) return;
      if (player.lastEconomyTick >= this.state.tick) return;
      player.lastEconomyTick = this.state.tick;
      let w = city.townHallLevel * 2, f = city.townHallLevel * 1, g = Math.floor(city.townHallLevel * 0.5);
      getBuildingsForCity(this.state, city.id).forEach(b => {
        const p = BUILDING_PRODUCTION[b.type as BuildingType];
        if (p) { w += p.woodPerTick; f += p.foodPerTick; g += p.goldPerTick; }
      });
      player.wood += w; player.food += f; player.gold += g;
      player.populationCap = 10 + countBuildingType(this.state, city.id, 'farm') * 5;
      player.wood = Math.max(0, player.wood); player.food = Math.max(0, player.food); player.gold = Math.max(0, player.gold);
    });
  }

  // ─── Unit Movement ──────────────────────────────────────────

  private moveUnits(): void {
    const toRemove: string[] = [];
    this.state.units.forEach(unit => {
      const road = this.state.roads.get(unit.roadId);
      if (!road) { toRemove.push(unit.id); return; }
      const stats = TROOP_STATS[unit.type as TroopType];
      if (!stats) { toRemove.push(unit.id); return; }
      unit.t += stats.speed;

      if (unit.t >= 1.0) {
        const targetId = road.toId;
        if (this.state.cities.has(targetId)) {
          this.handleUnitArriveAtCity(unit, targetId, toRemove);
        } else {
          const nextRoad = this.findNextRoad(unit, road, targetId);
          if (nextRoad) {
            unit.roadId = nextRoad.id;
            unit.t = 0;
            unit.originNodeId = targetId;
            unit.roadsCrossed++;
          } else {
            toRemove.push(unit.id);
            this.refundPop(unit.ownerId);
          }
        }
      }
    });
    toRemove.forEach(id => { const u = this.state.units.get(id); this.state.units.delete(id); });
  }

  private handleUnitArriveAtCity(unit: UnitNode, cityId: string, toRemove: string[]): void {
    const city = this.state.cities.get(cityId);
    if (!city) { toRemove.push(unit.id); return; }

    // Unit arrived at its own city — safe arrival, despawn and refund
    if (city.ownerId === unit.ownerId) {
      toRemove.push(unit.id);
      this.refundPop(unit.ownerId);
      return;
    }

    // Unit arrived at enemy city — attack the city
    const stats = TROOP_STATS[unit.type as TroopType];
    if (!stats) { toRemove.push(unit.id); return; }

    const dmg = Math.max(1, Math.floor(stats.attack * 0.5)); // 50% attack vs buildings
    city.health = Math.max(0, city.health - dmg);

    console.log(`Unit ${unit.type} hit ${city.name} for ${dmg} damage (health: ${city.health}/${city.maxHealth})`);

    // Unit is consumed on attack
    toRemove.push(unit.id);
    this.refundPop(unit.ownerId);

    // Check for conquest
    if (city.health <= 0) {
      this.conquerCity(city, unit.ownerId);
    }
  }

  private conquerCity(city: CityNode, attackerId: string): void {
    const defenderId = city.ownerId;
    const defender = defenderId ? this.state.players.get(defenderId) : null;

    console.log(`City ${city.name} conquered by ${attackerId}!`);

    // Award 10% resource bounty to attacker
    if (defender) {
      const bounty = {
        wood: Math.floor(defender.wood * 0.1),
        food: Math.floor(defender.food * 0.1),
        gold: Math.floor(defender.gold * 0.1),
      };
      const attacker = this.state.players.get(attackerId);
      if (attacker) {
        attacker.wood += bounty.wood;
        attacker.food += bounty.food;
        attacker.gold += bounty.gold;
      }
    }

    // Remove all buildings in this city
    const toRemove: string[] = [];
    this.state.buildings.forEach(b => { if (b.cityId === city.id) toRemove.push(b.id); });
    toRemove.forEach(id => this.state.buildings.delete(id));

    // Reset city
    city.ownerId = attackerId;
    city.townHallLevel = 1;
    city.influenceRadius = 150;
    city.maxBuildings = 2;
    city.health = 500; // Reset to partial health for the new owner
    city.maxHealth = 1000;

    // Update attacker's connected city
    const attackerPlayer = this.state.players.get(attackerId);
    if (attackerPlayer) {
      attackerPlayer.connectedCityId = city.id;
    }

    // Remove defender's connection if they owned it
    if (defender && defender.connectedCityId === city.id) {
      defender.connectedCityId = '';
    }

    // Remove all units heading TO this city (they've lost their target)
    const unitsToRemove: string[] = [];
    this.state.units.forEach(u => {
      const road = this.state.roads.get(u.roadId);
      if (road && road.toId === city.id && u.ownerId !== attackerId) {
        unitsToRemove.push(u.id);
      }
    });
    unitsToRemove.forEach(id => { this.state.units.delete(id); this.refundPop(undefined); });
  }

  private refundPop(playerId?: string): void {
    if (!playerId) return;
    const p = this.state.players.get(playerId);
    if (p) p.populationUsed = Math.max(0, p.populationUsed - 1);
  }

  private findNextRoad(unit: UnitNode, current: Road, intersectionId: string): Road | null {
    const outgoing: Road[] = [];
    this.state.roads.forEach(r => {
      if (r.fromId === intersectionId && r.id !== current.id && r.toId !== unit.originNodeId) outgoing.push(r);
    });
    if (outgoing.length === 0) return null;
    const is = this.state.intersections.get(intersectionId);
    if (is) {
      const wp = is.waypoints.find(w => w.roadId === current.id);
      if (wp) {
        const idx = wp.direction === -1 ? outgoing.length - 1 : wp.direction === 1 ? Math.min(1, outgoing.length - 1) : 0;
        return outgoing[idx] || outgoing[0];
      }
    }
    return outgoing[0];
  }

  // ─── Combat ─────────────────────────────────────────────────

  private processCombat(): void {
    // Group units by road
    const roadUnits = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      const list = roadUnits.get(u.roadId) || [];
      list.push(u);
      roadUnits.set(u.roadId, list);
    });

    roadUnits.forEach((units) => {
      if (units.length < 2) return;

      // Split by owner
      const byOwner = new Map<string, UnitNode[]>();
      units.forEach(u => {
        const list = byOwner.get(u.ownerId) || [];
        list.push(u);
        byOwner.set(u.ownerId, list);
      });

      if (byOwner.size < 2) return;

      const ownerIds = Array.from(byOwner.keys());
      for (let i = 0; i < ownerIds.length; i++) {
        for (let j = i + 1; j < ownerIds.length; j++) {
          const groupA = byOwner.get(ownerIds[i])!;
          const groupB = byOwner.get(ownerIds[j])!;
          this.fightGroups(groupA, groupB);
        }
      }
    });
  }

  private fightGroups(groupA: UnitNode[], groupB: UnitNode[]): void {
    let idxA = 0, idxB = 0;

    while (idxA < groupA.length && idxB < groupB.length) {
      const a = groupA[idxA];
      const b = groupB[idxB];

      // Check if both alive and combat cooldown ready
      if (a.health <= 0 || b.health <= 0) {
        if (a.health <= 0) idxA++;
        if (b.health <= 0) idxB++;
        continue;
      }

      // Check proximity on the road
      const tDiff = Math.abs(a.t - b.t);
      const aStats = TROOP_STATS[a.type as TroopType];
      const bStats = TROOP_STATS[b.type as TroopType];
      if (!aStats || !bStats) { idxA++; idxB++; continue; }

      const engagementRange = 0.04; // ~one road segment
      if (tDiff > engagementRange) {
        // Units too far apart — advance the smaller t
        if (a.t < b.t) idxA++; else idxB++;
        continue;
      }

      // Combat cooldown
      if (a.lastCombatTick > 0 && this.state.tick - a.lastCombatTick < COMBAT_COOLDOWN_TICKS) {
        idxA++; continue;
      }
      if (b.lastCombatTick > 0 && this.state.tick - b.lastCombatTick < COMBAT_COOLDOWN_TICKS) {
        idxB++; continue;
      }

      // Compute damage
      const aDmg = this.calcDamage(a, b);
      const bDmg = this.calcDamage(b, a);

      b.health = Math.max(0, b.health - aDmg);
      a.health = Math.max(0, a.health - bDmg);

      a.lastCombatTick = this.state.tick;
      b.lastCombatTick = this.state.tick;

      // Remove dead units
      if (a.health <= 0) {
        this.state.units.delete(a.id);
        this.refundPop(a.ownerId);
        idxA++;
      }
      if (b.health <= 0) {
        this.state.units.delete(b.id);
        this.refundPop(b.ownerId);
        idxB++;
      }
    }
  }

  private calcDamage(attacker: UnitNode, defender: UnitNode): number {
    const aStats = TROOP_STATS[attacker.type as TroopType];
    if (!aStats) return 0;

    let base = aStats.attack;

    // RPS multiplier
    if (RPS_ADVANTAGE[attacker.type] === defender.type) {
      base *= 2; // Advantage: 2x damage
    } else if (RPS_ADVANTAGE[defender.type] === attacker.type) {
      base *= 0.5; // Disadvantage: 0.5x damage
    }

    // Anti-snowball: distance penalty
    const dist = attacker.distanceTraveled;
    const distMultiplier = Math.max(0.5, 1.0 - dist * 0.12);
    base *= distMultiplier;

    // Defender's advantage: if defender is close to their origin
    const defDist = defender.distanceTraveled;
    if (defDist < 0.5) {
      base *= 0.8; // Attacker does less damage when fighting near defender's home
    }

    return Math.max(1, Math.floor(base));
  }

  private processMonkHealing(): void {
    const roadUnits = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      const list = roadUnits.get(u.roadId) || [];
      list.push(u);
      roadUnits.set(u.roadId, list);
    });

    roadUnits.forEach((units) => {
      const monks = units.filter(u => u.type === 'monk');
      if (monks.length === 0) return;

      monks.forEach(monk => {
        const stats = TROOP_STATS['monk'];
        units.forEach(other => {
          if (other.ownerId !== monk.ownerId) return;
          if (other.health >= other.maxHealth) return;
          if (Math.abs(other.t - monk.t) > 0.06) return; // Healing range
          other.health = Math.min(other.maxHealth, other.health + stats.healAmount);
        });
      });
    });
  }
}
