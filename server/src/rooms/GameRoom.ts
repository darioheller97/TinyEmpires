import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player, TECH_TREE, TechId } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, BUILDING_PRODUCTION } from './schema/BuildingNode';
import { LairNode } from './schema/LairNode';
import { UnitNode, TROOP_STATS, RPS_ADVANTAGE } from './schema/UnitNode';

const PLAYER_COLORS = ['#4488ff', '#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff'];
const ECONOMY_INTERVAL_TICKS = 10;
const COMBAT_COOLDOWN_TICKS = 3;
const PVE_SPAWN_INTERVAL = 150; // ticks between PvE spawns

interface HNode { id: string; x: number; y: number; name: string; }
interface HRoad { fromId: string; toId: string; via: { x: number; y: number }[]; }

const MAP_CITIES: HNode[] = [
  { id: 'city_a', x: 300, y: 400, name: 'Red Keep' },
  { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel' },
];
const MAP_INTERSECTIONS: HNode[] = [
  { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
];
const MAP_LAIRS: (HNode & { type: string })[] = [
  { id: 'lair_spider', x: 200, y: 200, name: 'Spider Cave', type: 'spider' },
  { id: 'lair_goblin', x: 1400, y: 600, name: 'Goblin Stump', type: 'goblin' },
];
const MAP_ROADS: HRoad[] = [
  { fromId: 'city_a', toId: 'cross_1', via: [{ x: 550, y: 400 }] },
  { fromId: 'cross_1', toId: 'city_b', via: [{ x: 1050, y: 400 }] },
  { fromId: 'city_b', toId: 'cross_1', via: [{ x: 1050, y: 400 }] },
  { fromId: 'cross_1', toId: 'city_a', via: [{ x: 550, y: 400 }] },
  { fromId: 'lair_spider', toId: 'cross_1', via: [{ x: 500, y: 300 }] },
  { fromId: 'lair_goblin', toId: 'cross_1', via: [{ x: 1100, y: 500 }] },
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
  const r: BuildingNode[] = []; state.buildings.forEach(b => { if (b.cityId === cityId) r.push(b); }); return r;
}
function countBuildingType(state: GameState, cityId: string, type: string): number {
  let n = 0; state.buildings.forEach(b => { if (b.cityId === cityId && b.type === type) n++; }); return n;
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
    MAP_LAIRS.forEach(l => {
      const lair = new LairNode(l.id, l.x, l.y, l.type);
      lair.spawnIntervalTicks = PVE_SPAWN_INTERVAL;
      this.state.lairs.set(l.id, lair);
    });
    MAP_ROADS.forEach((r, i) => {
      const allNodes = [...MAP_CITIES, ...MAP_INTERSECTIONS, ...MAP_LAIRS];
      const fromN = allNodes.find(n => n.id === r.fromId);
      const toN = allNodes.find(n => n.id === r.toId);
      if (!fromN || !toN) return;
      const spline = buildSplinePoints({ x: fromN.x, y: fromN.y }, r.via, { x: toN.x, y: toN.y });
      const roadId = `road_${i}`;
      this.state.roads.set(roadId, new Road(roadId, r.fromId, r.toId, spline));
      // Link road back to lairs
      if (fromN.id.startsWith('lair_')) {
        const lair = this.state.lairs.get(fromN.id);
        if (lair) lair.roadId = roadId;
      }
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
      this.state.buildings.set(bId, new BuildingNode(bId, city.id, bt, city.x + Math.cos(angle) * 80, city.y + Math.sin(angle) * 80));
    });

    this.onMessage('upgrade_town_hall', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connectedCityId) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      let cost = city.townHallLevel * 50;
      if (player.hasTech('town_hall_discount')) cost = Math.floor(cost * 0.7);
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
      const tt = msg.type;
      if (!TROOP_STATS[tt]) return;
      const city = this.state.cities.get(player.connectedCityId);
      if (!city || city.ownerId !== client.sessionId) return;
      const stats = TROOP_STATS[tt];
      if (player.food < (stats.foodCost || 0) || player.gold < (stats.goldCost || 0)) return;
      if (player.populationUsed + 1 > player.populationCap) return;
      const barracks = getBuildingsForCity(this.state, city.id).find(b => b.type === 'barracks');
      if (!barracks) return;
      player.food -= stats.foodCost; player.gold -= stats.goldCost;
      player.populationUsed += 1;
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

    // Tech research
    this.onMessage('research_tech', (client, msg: { techId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const tech = TECH_TREE.find(t => t.id === msg.techId);
      if (!tech) return;
      if (player.hasTech(tech.id)) return;
      if (player.gold < tech.cost) return;
      player.gold -= tech.cost;
      player.addTech(tech.id);
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
    this.processPvESpawns();
    this.moveUnits();
    this.processCombat();
    this.processMonkHealing();
  }

  // ─── PvE Lair Spawning ──────────────────────────────────────

  private processPvESpawns(): void {
    this.state.lairs.forEach((lair) => {
      if (lair.health <= 0) return; // Destroyed lair
      if (this.state.tick - lair.lastSpawnTick < lair.spawnIntervalTicks) return;
      lair.lastSpawnTick = this.state.tick;

      if (!lair.roadId) return;
      const road = this.state.roads.get(lair.roadId);
      if (!road) return;

      // Find target based on resource hoarding
      let targetCityId: string | null = null;
      if (lair.type === 'spider') {
        targetCityId = this.findResourceHoardingCity('food');
      } else if (lair.type === 'goblin') {
        targetCityId = this.findResourceHoardingCity('gold');
      }

      if (!targetCityId) return;

      // Spawn 2-3 enemies
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const unit = new UnitNode(nextId('pve'), 'pve', lair.type, lair.roadId);
        unit.originNodeId = lair.id;
        unit.roadsCrossed = 0;
        this.state.units.set(unit.id, unit);
      }

      console.log(`Lair ${lair.type} spawned ${count} units targeting ${targetCityId}`);
    });
  }

  private findResourceHoardingCity(resource: 'food' | 'gold'): string | null {
    let bestCity: string | null = null;
    let bestAmount = 0;

    this.state.cities.forEach((city) => {
      if (!city.ownerId) return;
      const player = this.state.players.get(city.ownerId);
      if (!player) return;
      const amount = resource === 'food' ? player.food : player.gold;
      if (amount > bestAmount) {
        bestAmount = amount;
        bestCity = city.id;
      }
    });

    return bestCity;
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

      let w = city.townHallLevel * 2;
      let f = city.townHallLevel * 1;
      let g = Math.floor(city.townHallLevel * 0.5);

      getBuildingsForCity(this.state, city.id).forEach(b => {
        const p = BUILDING_PRODUCTION[b.type as BuildingType];
        if (p) { w += p.woodPerTick; f += p.foodPerTick; g += p.goldPerTick; }
      });

      // Tech boosts
      if (player.hasTech('prod_wood')) w = Math.floor(w * 1.5);
      if (player.hasTech('prod_food')) f = Math.floor(f * 1.5);
      if (player.hasTech('prod_gold')) g = Math.floor(g * 1.5);

      player.wood += w; player.food += f; player.gold += g;
      player.populationCap = 10 + countBuildingType(this.state, city.id, 'farm') * 5;
      player.wood = Math.max(0, player.wood);
      player.food = Math.max(0, player.food);
      player.gold = Math.max(0, player.gold);
    });
  }

  // ─── Unit Movement ──────────────────────────────────────────

  private moveUnits(): void {
    const toRemove: string[] = [];
    this.state.units.forEach(unit => {
      const road = this.state.roads.get(unit.roadId);
      if (!road) { toRemove.push(unit.id); return; }
      const stats = TROOP_STATS[unit.type];
      if (!stats) { toRemove.push(unit.id); return; }

      // Speed boost from tech
      let speed = stats.speed;
      if (!unit.isPvE) {
        const owner = this.state.players.get(unit.ownerId);
        if (owner && owner.hasTech('speed')) speed *= 1.2;
      }

      unit.t += speed;

      if (unit.t >= 1.0) {
        const targetId = road.toId;

        // Lair target — PvE units reaching a node check if it's the target city
        if (unit.isPvE && this.state.cities.has(targetId)) {
          this.pveAttackCity(unit, targetId, toRemove);
          return;
        }

        // Player unit arriving at a lair
        if (this.state.lairs.has(targetId) && unit.isPvE === false) {
          this.playerAttackLair(unit, targetId, toRemove);
          return;
        }

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
    toRemove.forEach(id => { this.state.units.delete(id); });
  }

  private pveAttackCity(unit: UnitNode, cityId: string, toRemove: string[]): void {
    const city = this.state.cities.get(cityId);
    if (!city) { toRemove.push(unit.id); return; }
    const stats = TROOP_STATS[unit.type];
    if (!stats) { toRemove.push(unit.id); return; }
    const dmg = Math.max(1, Math.floor(stats.attack * 0.4));
    city.health = Math.max(0, city.health - dmg);
    toRemove.push(unit.id);
    // Don't refund pop for PvE units
    if (city.health <= 0) this.conquerCity(city, 'pve');
  }

  private playerAttackLair(unit: UnitNode, lairId: string, toRemove: string[]): void {
    const lair = this.state.lairs.get(lairId);
    if (!lair) { toRemove.push(unit.id); return; }
    const stats = TROOP_STATS[unit.type];
    if (!stats) { toRemove.push(unit.id); return; }
    const dmg = Math.max(1, Math.floor(stats.attack * 0.3));
    lair.health = Math.max(0, lair.health - dmg);
    toRemove.push(unit.id);
    this.refundPop(unit.ownerId);
    if (lair.health <= 0) {
      console.log(`Lair ${lairId} destroyed by ${unit.ownerId}!`);
    }
  }

  private handleUnitArriveAtCity(unit: UnitNode, cityId: string, toRemove: string[]): void {
    const city = this.state.cities.get(cityId);
    if (!city) { toRemove.push(unit.id); return; }
    if (city.ownerId === unit.ownerId || (unit.isPvE && city.ownerId === 'pve')) {
      toRemove.push(unit.id);
      if (!unit.isPvE) this.refundPop(unit.ownerId);
      return;
    }
    const stats = TROOP_STATS[unit.type];
    if (!stats) { toRemove.push(unit.id); return; }

    // Tech damage boost
    let atk = stats.attack;
    if (!unit.isPvE) {
      const owner = this.state.players.get(unit.ownerId);
      if (owner) {
        if (owner.hasTech('dmg_knight') && unit.type === 'knight') atk = Math.floor(atk * 1.25);
        if (owner.hasTech('dmg_lancer') && unit.type === 'lancer') atk = Math.floor(atk * 1.25);
        if (owner.hasTech('dmg_archer') && unit.type === 'archer') atk = Math.floor(atk * 1.25);
      }
    }

    const dmg = Math.max(1, Math.floor(atk * 0.5));
    city.health = Math.max(0, city.health - dmg);
    toRemove.push(unit.id);
    if (!unit.isPvE) this.refundPop(unit.ownerId);
    if (city.health <= 0) this.conquerCity(city, unit.ownerId);
  }

  private conquerCity(city: CityNode, newOwnerId: string): void {
    const oldOwnerId = city.ownerId;
    const defender = oldOwnerId && oldOwnerId !== 'pve' ? this.state.players.get(oldOwnerId) : null;

    // Award bounty (PvE conquest gives no bounty)
    if (newOwnerId !== 'pve' && defender) {
      const attacker = this.state.players.get(newOwnerId);
      if (attacker) {
        attacker.wood += Math.floor(defender.wood * 0.1);
        attacker.food += Math.floor(defender.food * 0.1);
        attacker.gold += Math.floor(defender.gold * 0.1);
      }
    }

    // Destroy buildings
    const toRemove: string[] = [];
    this.state.buildings.forEach(b => { if (b.cityId === city.id) toRemove.push(b.id); });
    toRemove.forEach(id => this.state.buildings.delete(id));

    // Reset or destroy city
    if (newOwnerId === 'pve') {
      city.ownerId = '';
      city.townHallLevel = 1;
      city.influenceRadius = 150;
      city.maxBuildings = 2;
      city.health = 300;
      city.maxHealth = 1000;
      if (defender && defender.connectedCityId === city.id) defender.connectedCityId = '';
    } else {
      city.ownerId = newOwnerId;
      city.townHallLevel = 1;
      city.influenceRadius = 150;
      city.maxBuildings = 2;
      city.health = 500;
      city.maxHealth = 1000;
      const attacker = this.state.players.get(newOwnerId);
      if (attacker) attacker.connectedCityId = city.id;
      if (defender && defender.connectedCityId === city.id) defender.connectedCityId = '';
    }

    // Remove enemy units heading to this city
    const unitsToRemove: string[] = [];
    this.state.units.forEach(u => {
      const road = this.state.roads.get(u.roadId);
      if (road && road.toId === city.id && u.ownerId !== newOwnerId) {
        unitsToRemove.push(u.id);
      }
    });
    unitsToRemove.forEach(id => this.state.units.delete(id));
  }

  private refundPop(playerId?: string): void {
    if (!playerId || playerId === 'pve') return;
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
    // PvE units prefer roads that lead to cities
    if (unit.isPvE) {
      const cityRoads = outgoing.filter(r => r.toId.startsWith('city_'));
      if (cityRoads.length > 0) {
        // Pick the road that leads to the most-resource city
        return cityRoads[Math.floor(Math.random() * cityRoads.length)];
      }
    }
    return outgoing[0];
  }

  // ─── Combat ─────────────────────────────────────────────────

  private processCombat(): void {
    const roadUnits = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      const list = roadUnits.get(u.roadId) || [];
      list.push(u);
      roadUnits.set(u.roadId, list);
    });

    roadUnits.forEach((units) => {
      if (units.length < 2) return;
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
          this.fightGroups(byOwner.get(ownerIds[i])!, byOwner.get(ownerIds[j])!);
        }
      }
    });
  }

  private fightGroups(groupA: UnitNode[], groupB: UnitNode[]): void {
    let idxA = 0, idxB = 0;
    while (idxA < groupA.length && idxB < groupB.length) {
      const a = groupA[idxA], b = groupB[idxB];
      if (a.health <= 0) { idxA++; continue; }
      if (b.health <= 0) { idxB++; continue; }
      const tDiff = Math.abs(a.t - b.t);
      if (tDiff > 0.04) {
        if (a.t < b.t) idxA++; else idxB++;
        continue;
      }
      if (a.lastCombatTick > 0 && this.state.tick - a.lastCombatTick < COMBAT_COOLDOWN_TICKS) { idxA++; continue; }
      if (b.lastCombatTick > 0 && this.state.tick - b.lastCombatTick < COMBAT_COOLDOWN_TICKS) { idxB++; continue; }

      const aDmg = this.calcDamage(a, b);
      const bDmg = this.calcDamage(b, a);
      b.health = Math.max(0, b.health - aDmg);
      a.health = Math.max(0, a.health - bDmg);
      a.lastCombatTick = this.state.tick;
      b.lastCombatTick = this.state.tick;

      if (a.health <= 0) { this.state.units.delete(a.id); if (!a.isPvE) this.refundPop(a.ownerId); idxA++; }
      if (b.health <= 0) { this.state.units.delete(b.id); if (!b.isPvE) this.refundPop(b.ownerId); idxB++; }
    }
  }

  private calcDamage(attacker: UnitNode, defender: UnitNode): number {
    const aStats = TROOP_STATS[attacker.type];
    if (!aStats) return 0;
    let base = aStats.attack;

    // RPS multiplier (only for player units vs each other)
    if (!attacker.isPvE && !defender.isPvE) {
      if (RPS_ADVANTAGE[attacker.type] === defender.type) base *= 2;
      else if (RPS_ADVANTAGE[defender.type] === attacker.type) base *= 0.5;
    }

    // Tech damage boosts
    if (!attacker.isPvE) {
      const owner = this.state.players.get(attacker.ownerId);
      if (owner) {
        if (owner.hasTech('dmg_knight') && attacker.type === 'knight') base = Math.floor(base * 1.25);
        if (owner.hasTech('dmg_lancer') && attacker.type === 'lancer') base = Math.floor(base * 1.25);
        if (owner.hasTech('dmg_archer') && attacker.type === 'archer') base = Math.floor(base * 1.25);
      }
    }

    // Anti-snowball
    base *= Math.max(0.5, 1.0 - attacker.distanceTraveled * 0.12);
    if (defender.distanceTraveled < 0.5) base *= 0.8;
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
      const monks = units.filter(u => u.type === 'monk' && !u.isPvE);
      if (monks.length === 0) return;
      monks.forEach(monk => {
        units.forEach(other => {
          if (other.ownerId !== monk.ownerId) return;
          if (other.health >= other.maxHealth) return;
          if (Math.abs(other.t - monk.t) > 0.06) return;
          other.health = Math.min(other.maxHealth, other.health + 5);
        });
      });
    });
  }
}
