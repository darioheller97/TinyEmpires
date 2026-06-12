import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player, TECH_TREE } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, BUILDING_PRODUCTION } from './schema/BuildingNode';
import { LairNode } from './schema/LairNode';
import { UnitNode, TROOP_STATS, TROOP_TYPES, RPS_ADVANTAGE } from './schema/UnitNode';
import { generateMap } from './MapGenerator';

// Matches the four Tiny Swords faction palettes: Blue, Red, Yellow, Purple
const PLAYER_COLORS = ['#4488ff', '#ff4444', '#ffd700', '#aa44ff'];

const ECONOMY_INTERVAL_TICKS = 10;   // 1s at 10Hz
const COMBAT_COOLDOWN_TICKS = 3;     // attack every 0.3s while engaged
const RETALIATE_INTERVAL_TICKS = 5;  // towers/town hall strike besiegers
const AUTO_PRODUCE_INTERVAL_TICKS = 60;
const PVE_SPAWN_INTERVAL = 300;      // 30s between lair waves
const LAIR_RESPAWN_TICKS = 1800;     // destroyed lairs regrow after 3 min
const ENGAGE_RANGE_T = 0.04;         // engagement distance along a road
const HEAL_INTERVAL_TICKS = 5;

const SPIDER_BOUNTY = { wood: 0, food: 120, gold: 30 };
const GOBLIN_BOUNTY = { wood: 0, food: 30, gold: 120 };

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

let idCounter = 0;
function nextId(p: string): string { return `${p}_${++idCounter}_${Date.now()}`; }

export class GameRoom extends Room<GameState> {
  maxClients = 4;
  private tickInterval!: ReturnType<typeof setInterval>;
  // Maps each directed road to its opposite-direction twin
  private reverseRoad = new Map<string, string>();

  onCreate(options: any): void {
    console.log('GameRoom created!');
    this.setState(new GameState());
    this.initMap(typeof options?.mapSeed === 'number' ? options.mapSeed >>> 0 : undefined);
    this.setMessageHandlers();
    this.tickInterval = setInterval(() => this.gameTick(), 100);
  }

  private initMap(fixedSeed?: number): void {
    const seed = fixedSeed ?? (Math.random() * 0xffffffff) >>> 0;
    const map = generateMap(seed);
    this.state.mapSeed = seed;
    this.state.mapWidth = map.width;
    this.state.mapHeight = map.height;

    map.cities.forEach(c => {
      const city = new CityNode(c.id, c.x, c.y, c.name);
      city.maxBuildings = 2;
      this.state.cities.set(c.id, city);
    });
    map.intersections.forEach(n => {
      this.state.intersections.set(n.id, new IntersectionNode(n.id, n.x, n.y, n.name));
    });
    map.lairs.forEach(l => {
      const lair = new LairNode(l.id, l.x, l.y, l.type);
      lair.spawnIntervalTicks = PVE_SPAWN_INTERVAL;
      this.state.lairs.set(l.id, lair);
    });
    const allNodes = [...map.cities, ...map.intersections, ...map.lairs];
    map.edges.forEach((e, i) => {
      const aN = allNodes.find(n => n.id === e.a);
      const bN = allNodes.find(n => n.id === e.b);
      if (!aN || !bN) return;
      const fwd = buildSplinePoints({ x: aN.x, y: aN.y }, e.via, { x: bN.x, y: bN.y });
      const rev = [...fwd].reverse();
      const fId = `road_${i}f`, rId = `road_${i}r`;
      this.state.roads.set(fId, new Road(fId, e.a, e.b, fwd));
      this.state.roads.set(rId, new Road(rId, e.b, e.a, rev));
      this.reverseRoad.set(fId, rId);
      this.reverseRoad.set(rId, fId);
      const lair = this.state.lairs.get(e.a);
      if (lair) lair.roadId = fId;
    });
  }

  private getNodePos(id: string): { x: number; y: number } | null {
    const c = this.state.cities.get(id); if (c) return { x: c.x, y: c.y };
    const n = this.state.intersections.get(id); if (n) return { x: n.x, y: n.y };
    const l = this.state.lairs.get(id); if (l) return { x: l.x, y: l.y };
    return null;
  }

  // ─── Messages ───────────────────────────────────────────────

  private setMessageHandlers(): void {
    this.onMessage('build_structure', (client, msg: { cityId: string; type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const bt = msg.type as BuildingType;
      if (!BUILDING_TYPES.includes(bt)) return;
      const city = this.state.cities.get(msg.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (this.buildingsOf(city.id).length >= city.maxBuildings) return;
      const cost = BUILDING_COSTS[bt];
      if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return;
      player.wood -= cost.wood; player.food -= cost.food; player.gold -= cost.gold;
      const count = this.buildingsOf(city.id).length;
      const angle = count * (Math.PI * 2 / 8) + Math.PI / 8;
      const radius = 70 + 22 * Math.floor(count / 8);
      const bId = nextId('bld');
      this.state.buildings.set(bId, new BuildingNode(bId, city.id, bt, city.x + Math.cos(angle) * radius, city.y + Math.sin(angle) * radius));
    });

    this.onMessage('upgrade_town_hall', (client, msg: { cityId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const city = this.state.cities.get(msg?.cityId || player.connectedCityId);
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

    this.onMessage('spawn_troops', (client, msg: { cityId: string; type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      this.trySpawnTroop(player, msg.cityId || player.connectedCityId, msg.type);
    });

    this.onMessage('set_auto_produce', (client, msg: { buildingId: string; troopType: string }) => {
      const building = this.state.buildings.get(msg.buildingId);
      if (!building || building.type !== 'barracks') return;
      const city = this.state.cities.get(building.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      const tt = msg.troopType;
      if (tt !== '' && !TROOP_TYPES.includes(tt as any)) return;
      building.autoProduceType = tt;
      building.lastAutoProduceTick = this.state.tick;
    });

    this.onMessage('set_route', (client, msg: { intersectionId: string; targetRoadId: string }) => {
      const is = this.state.intersections.get(msg.intersectionId);
      if (!is) return;
      const existingIdx = is.waypoints.findIndex(w => w.ownerId === client.sessionId);
      if (msg.targetRoadId === '') {
        if (existingIdx >= 0) is.waypoints.splice(existingIdx, 1);
        return;
      }
      const road = this.state.roads.get(msg.targetRoadId);
      if (!road || road.fromId !== is.id) return;
      const existing = existingIdx >= 0 ? is.waypoints[existingIdx] : undefined;
      if (existing) { existing.targetRoadId = msg.targetRoadId; }
      else {
        const wp = new Waypoint();
        wp.ownerId = client.sessionId;
        wp.targetRoadId = msg.targetRoadId;
        is.waypoints.push(wp);
      }
    });

    this.onMessage('research_tech', (client, msg: { techId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const tech = TECH_TREE.find(t => t.id === msg.techId);
      if (!tech || player.hasTech(tech.id) || player.gold < tech.cost) return;
      player.gold -= tech.cost;
      player.addTech(tech.id);
    });
  }

  private trySpawnTroop(player: Player, cityId: string, type: string): boolean {
    const stats = TROOP_STATS[type];
    if (!stats || !TROOP_TYPES.includes(type as any)) return false;
    const city = this.state.cities.get(cityId);
    if (!city || city.ownerId !== player.id) return false;
    if (player.food < stats.foodCost || player.gold < stats.goldCost) return false;
    if (player.populationUsed + 1 > player.populationCap) return false;
    const barracks = this.buildingsOf(city.id).find(b => b.type === 'barracks');
    if (!barracks) return false;
    const targetRoad = [...this.state.roads.values()].find(r => r.fromId === city.id);
    if (!targetRoad) return false;
    player.food -= stats.foodCost; player.gold -= stats.goldCost;
    player.populationUsed += 1;
    const unit = new UnitNode(nextId('unit'), player.id, type, targetRoad.id);
    unit.originNodeId = city.id;
    if (player.hasTech('hp_all')) {
      unit.maxHealth = Math.floor(unit.maxHealth * 1.2);
      unit.health = unit.maxHealth;
    }
    this.state.units.set(unit.id, unit);
    return true;
  }

  onJoin(client: Client, options: any): void {
    const ci = this.state.players.size % PLAYER_COLORS.length;
    const p = new Player(client.sessionId, options?.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[ci]);
    const uc = [...this.state.cities.values()].find(c => !c.ownerId);
    if (uc) {
      uc.ownerId = client.sessionId;
      uc.health = uc.maxHealth;
      p.connectedCityId = uc.id;
    }
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client, consented: boolean): void {
    this.state.cities.forEach(c => { if (c.ownerId === client.sessionId) c.ownerId = ''; });
    const toRemove: string[] = [];
    this.state.units.forEach(u => { if (u.ownerId === client.sessionId) toRemove.push(u.id); });
    toRemove.forEach(id => this.state.units.delete(id));
    this.state.intersections.forEach(is => {
      const idx = is.waypoints.findIndex(w => w.ownerId === client.sessionId);
      if (idx >= 0) is.waypoints.splice(idx, 1);
    });
    this.state.players.delete(client.sessionId);
  }

  onDispose(): void { clearInterval(this.tickInterval); }

  // ─── Game Tick ──────────────────────────────────────────────

  private gameTick(): void {
    this.state.tick++;
    if (this.state.tick % ECONOMY_INTERVAL_TICKS === 0) this.processEconomy();
    this.processLairs();
    this.processAutoProduce();
    this.moveUnits();
    this.processCombat();
    this.processSieges();
    if (this.state.tick % HEAL_INTERVAL_TICKS === 0) this.processMonkHealing();
    this.cleanupIdleGarrisons();
  }

  // ─── Economy ────────────────────────────────────────────────

  private processEconomy(): void {
    const income = new Map<string, { w: number; f: number; g: number; pop: number }>();
    this.state.cities.forEach(city => {
      if (!city.ownerId || !this.state.players.has(city.ownerId)) return;
      const acc = income.get(city.ownerId) || { w: 0, f: 0, g: 0, pop: 10 };
      acc.w += city.townHallLevel * 2;
      acc.f += city.townHallLevel;
      acc.g += city.townHallLevel * 0.5;
      this.buildingsOf(city.id).forEach(b => {
        const p = BUILDING_PRODUCTION[b.type as BuildingType];
        if (p) { acc.w += p.woodPerTick; acc.f += p.foodPerTick; acc.g += p.goldPerTick; }
        if (b.type === 'farm') acc.pop += 5;
      });
      income.set(city.ownerId, acc);
    });
    this.state.players.forEach(player => {
      const acc = income.get(player.id);
      if (!acc) { player.populationCap = 10; return; }
      let { w, f, g } = acc;
      if (player.hasTech('prod_wood')) w *= 1.5;
      if (player.hasTech('prod_food')) f *= 1.5;
      if (player.hasTech('prod_gold')) g *= 1.5;
      // Resources stay fractional server-side; the UI floors for display
      player.wood += w;
      player.food += f;
      player.gold += g;
      player.populationCap = acc.pop;
    });
  }

  private processAutoProduce(): void {
    this.state.buildings.forEach(b => {
      if (b.type !== 'barracks' || !b.autoProduceType) return;
      if (this.state.tick - b.lastAutoProduceTick < AUTO_PRODUCE_INTERVAL_TICKS) return;
      const city = this.state.cities.get(b.cityId);
      if (!city || !city.ownerId) { b.autoProduceType = ''; return; }
      const player = this.state.players.get(city.ownerId);
      if (!player) { b.autoProduceType = ''; return; }
      if (this.trySpawnTroop(player, city.id, b.autoProduceType)) {
        b.lastAutoProduceTick = this.state.tick;
      }
    });
  }

  // ─── PvE Lairs ──────────────────────────────────────────────

  private processLairs(): void {
    this.state.lairs.forEach(lair => {
      if (lair.health <= 0) {
        if (lair.respawnAtTick > 0 && this.state.tick >= lair.respawnAtTick) {
          lair.health = lair.maxHealth;
          lair.respawnAtTick = 0;
          lair.lastSpawnTick = this.state.tick;
        }
        return;
      }
      if (this.state.tick - lair.lastSpawnTick < lair.spawnIntervalTicks) return;
      lair.lastSpawnTick = this.state.tick;
      if (!lair.roadId) return;

      const targetCityId = lair.type === 'spider'
        ? this.findResourceHoardingCity('food')
        : this.findResourceHoardingCity('gold');
      if (!targetCityId) return;

      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const unit = new UnitNode(nextId('pve'), 'pve', lair.type, lair.roadId);
        unit.originNodeId = lair.id;
        unit.targetNodeId = targetCityId;
        // Stagger so the pack doesn't stack on one pixel
        unit.t = -i * 0.03;
        this.state.units.set(unit.id, unit);
      }
    });
  }

  private findResourceHoardingCity(resource: 'food' | 'gold'): string | null {
    let bestCity: string | null = null;
    let bestAmount = 0;
    this.state.cities.forEach(city => {
      if (!city.ownerId) return;
      const player = this.state.players.get(city.ownerId);
      if (!player) return;
      const amount = resource === 'food' ? player.food : player.gold;
      if (amount > bestAmount) { bestAmount = amount; bestCity = city.id; }
    });
    return bestCity;
  }

  // ─── Movement ───────────────────────────────────────────────

  private moveUnits(): void {
    const toRemove: string[] = [];
    this.state.units.forEach(unit => {
      if (unit.status === 'fighting' || unit.status === 'sieging' || unit.status === 'defending') return;
      const road = this.state.roads.get(unit.roadId);
      if (!road) { toRemove.push(unit.id); this.refundPop(unit.ownerId); return; }
      const stats = TROOP_STATS[unit.type];
      if (!stats) { toRemove.push(unit.id); return; }

      let speed = stats.speed;
      if (!unit.isPvE) {
        const owner = this.state.players.get(unit.ownerId);
        if (owner && owner.hasTech('speed')) speed *= 1.2;
      }
      unit.t += speed;
      if (unit.t < 1.0) return;

      const targetId = road.toId;
      if (this.state.cities.has(targetId)) {
        this.arriveAtCity(unit, targetId, toRemove);
      } else if (this.state.lairs.has(targetId)) {
        this.arriveAtLair(unit, targetId, toRemove);
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
    });
    toRemove.forEach(id => this.state.units.delete(id));
  }

  private arriveAtCity(unit: UnitNode, cityId: string, toRemove: string[]): void {
    const city = this.state.cities.get(cityId);
    if (!city) { toRemove.push(unit.id); this.refundPop(unit.ownerId); return; }

    if (city.ownerId === unit.ownerId) {
      // Home turf: garrison if there are besiegers to fight, otherwise stand down
      const besiegers = this.unitsAtNode(cityId).filter(u => u.ownerId !== unit.ownerId);
      if (besiegers.length > 0) {
        unit.t = 1; unit.status = 'defending'; unit.atNodeId = cityId;
      } else {
        toRemove.push(unit.id);
        this.refundPop(unit.ownerId);
      }
      return;
    }
    if (unit.isPvE && !city.ownerId) {
      // Monsters march through empty ruins toward their prey
      const road = this.state.roads.get(unit.roadId);
      const next = road ? this.findNextRoad(unit, road, cityId) : null;
      if (next) {
        unit.roadId = next.id; unit.t = 0;
        unit.originNodeId = cityId; unit.roadsCrossed++;
      } else {
        toRemove.push(unit.id);
      }
      return;
    }
    unit.t = 1; unit.status = 'sieging'; unit.atNodeId = cityId;
  }

  private arriveAtLair(unit: UnitNode, lairId: string, toRemove: string[]): void {
    const lair = this.state.lairs.get(lairId);
    if (!lair || lair.health <= 0 || unit.isPvE) {
      toRemove.push(unit.id);
      this.refundPop(unit.ownerId);
      return;
    }
    unit.t = 1; unit.status = 'sieging'; unit.atNodeId = lairId;
  }

  private findNextRoad(unit: UnitNode, current: Road, nodeId: string): Road | null {
    const reverseId = this.reverseRoad.get(current.id);
    const outgoing: Road[] = [];
    this.state.roads.forEach(r => {
      if (r.fromId === nodeId && r.id !== reverseId) outgoing.push(r);
    });
    if (outgoing.length === 0) return null;

    if (unit.isPvE) {
      const toTarget = outgoing.find(r => r.toId === unit.targetNodeId);
      if (toTarget) return toTarget;
      const cityRoads = outgoing.filter(r => {
        const c = this.state.cities.get(r.toId);
        return c && !!c.ownerId;
      });
      if (cityRoads.length > 0) return cityRoads[Math.floor(Math.random() * cityRoads.length)];
      return outgoing[Math.floor(Math.random() * outgoing.length)];
    }

    // Player routing preference set via the radial menu
    const is = this.state.intersections.get(nodeId);
    if (is) {
      const wp = is.waypoints.find(w => w.ownerId === unit.ownerId);
      if (wp && wp.targetRoadId !== reverseId) {
        const chosen = outgoing.find(r => r.id === wp.targetRoadId);
        if (chosen) return chosen;
      }
    }

    // Default: keep going as straight as possible, never wander into a lair
    const nonLair = outgoing.filter(r => !this.state.lairs.has(r.toId));
    const candidates = nonLair.length > 0 ? nonLair : outgoing;
    const from = this.getNodePos(current.fromId);
    const here = this.getNodePos(nodeId);
    if (!from || !here) return candidates[0];
    const travelAngle = Math.atan2(here.y - from.y, here.x - from.x);
    let best = candidates[0];
    let bestDiff = Infinity;
    candidates.forEach(r => {
      const dest = this.getNodePos(r.toId);
      if (!dest) return;
      const a = Math.atan2(dest.y - here.y, dest.x - here.x);
      let diff = Math.abs(a - travelAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    });
    return best;
  }

  // ─── Combat ─────────────────────────────────────────────────

  /** Canonical key shared by both directions of a physical road. */
  private pairKey(roadId: string): string {
    const rev = this.reverseRoad.get(roadId);
    if (!rev) return roadId;
    return roadId < rev ? roadId : rev;
  }

  /** Position along the canonical direction of the physical road. */
  private pairPos(unit: UnitNode): number {
    const key = this.pairKey(unit.roadId);
    return unit.roadId === key ? unit.t : 1 - unit.t;
  }

  private processCombat(): void {
    // Re-evaluate engagements every tick
    this.state.units.forEach(u => { if (u.status === 'fighting') u.status = 'marching'; });

    const groups = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      const key = u.atNodeId ? `node:${u.atNodeId}` : `road:${this.pairKey(u.roadId)}`;
      const list = groups.get(key) || [];
      list.push(u);
      groups.set(key, list);
    });

    const dead = new Set<string>();
    groups.forEach((units, key) => {
      if (units.length < 2) return;
      const atNode = key.startsWith('node:');
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const a = units[i], b = units[j];
          if (a.ownerId === b.ownerId) continue;
          if (dead.has(a.id) || dead.has(b.id)) continue;
          if (!atNode && Math.abs(this.pairPos(a) - this.pairPos(b)) > ENGAGE_RANGE_T) continue;

          // Engaged: both stop (unless parked at a node already)
          if (!a.atNodeId) a.status = 'fighting';
          if (!b.atNodeId) b.status = 'fighting';

          const aReady = this.state.tick - a.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          const bReady = this.state.tick - b.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          if (aReady) {
            b.health = Math.max(0, b.health - this.calcDamage(a, b));
            a.lastCombatTick = this.state.tick;
          }
          if (bReady) {
            a.health = Math.max(0, a.health - this.calcDamage(b, a));
            b.lastCombatTick = this.state.tick;
          }
          if (a.health <= 0) dead.add(a.id);
          if (b.health <= 0) dead.add(b.id);
        }
      }
    });

    dead.forEach(id => {
      const u = this.state.units.get(id);
      if (u && !u.isPvE) this.refundPop(u.ownerId);
      this.state.units.delete(id);
    });
  }

  private calcDamage(attacker: UnitNode, defender: UnitNode): number {
    const aStats = TROOP_STATS[attacker.type];
    if (!aStats) return 0;
    let base = aStats.attack;

    // Rock-paper-scissors (players only)
    if (!attacker.isPvE && !defender.isPvE) {
      if (RPS_ADVANTAGE[attacker.type] === defender.type) base *= 2;
      else if (RPS_ADVANTAGE[defender.type] === attacker.type) base *= 0.5;
    }

    if (!attacker.isPvE) {
      const owner = this.state.players.get(attacker.ownerId);
      if (owner) {
        if (owner.hasTech('dmg_knight') && attacker.type === 'knight') base *= 1.25;
        if (owner.hasTech('dmg_lancer') && attacker.type === 'lancer') base *= 1.25;
        if (owner.hasTech('dmg_archer') && attacker.type === 'archer') base *= 1.25;
      }
    }

    // Anti-snowball: attackers weaken with distance, defenders near home resist
    base *= Math.max(0.5, 1.0 - attacker.distanceTraveled * 0.12);
    if (defender.status === 'defending' || defender.distanceTraveled < 0.5) base *= 0.8;
    return Math.max(1, Math.floor(base));
  }

  // ─── Sieges ─────────────────────────────────────────────────

  private unitsAtNode(nodeId: string): UnitNode[] {
    const r: UnitNode[] = [];
    this.state.units.forEach(u => { if (u.atNodeId === nodeId) r.push(u); });
    return r;
  }

  private processSieges(): void {
    const byNode = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      if (u.status !== 'sieging') return;
      const list = byNode.get(u.atNodeId) || [];
      list.push(u);
      byNode.set(u.atNodeId, list);
    });

    byNode.forEach((besiegers, nodeId) => {
      const city = this.state.cities.get(nodeId);
      if (city) { this.siegeCity(city, besiegers); return; }
      const lair = this.state.lairs.get(nodeId);
      if (lair) this.siegeLair(lair, besiegers);
    });
  }

  private siegeCity(city: CityNode, besiegers: UnitNode[]): void {
    // Besiegers whose faction now owns the city stand down
    besiegers = besiegers.filter(u => {
      if (u.ownerId === city.ownerId) {
        this.state.units.delete(u.id);
        if (!u.isPvE) this.refundPop(u.ownerId);
        return false;
      }
      return true;
    });
    if (besiegers.length === 0) return;

    // Units busy fighting garrison defenders can't damage the walls
    let lastAttackerOwner = '';
    besiegers.forEach(u => {
      // City may have been conquered (and this unit removed) earlier in the loop
      if (!this.state.units.has(u.id) || u.ownerId === city.ownerId) return;
      if (this.state.tick - u.lastCombatTick < COMBAT_COOLDOWN_TICKS) return;
      const stats = TROOP_STATS[u.type];
      if (!stats) return;
      let atk = stats.attack;
      if (!u.isPvE) {
        const owner = this.state.players.get(u.ownerId);
        if (owner) {
          if (owner.hasTech('dmg_knight') && u.type === 'knight') atk *= 1.25;
          if (owner.hasTech('dmg_lancer') && u.type === 'lancer') atk *= 1.25;
          if (owner.hasTech('dmg_archer') && u.type === 'archer') atk *= 1.25;
        }
      }
      atk *= Math.max(0.5, 1.0 - u.distanceTraveled * 0.12);
      const dmg = Math.max(1, Math.floor(atk * (u.isPvE ? 0.4 : 0.5)));
      city.health = Math.max(0, city.health - dmg);
      u.lastCombatTick = this.state.tick;
      lastAttackerOwner = u.ownerId;
      if (city.health <= 0) {
        this.conquerCity(city, lastAttackerOwner);
      }
    });
    if (city.health <= 0) return;

    // Town hall + defense towers retaliate (focus the weakest besieger)
    if (city.ownerId && this.state.tick % RETALIATE_INTERVAL_TICKS === 0) {
      const hostiles = besiegers.filter(u => this.state.units.has(u.id) && u.ownerId !== city.ownerId);
      if (hostiles.length === 0) return;
      const towers = this.buildingsOf(city.id).filter(b => b.type === 'defense_tower').length;
      const defense = city.townHallLevel * 3 + towers * 10;
      const target = hostiles.reduce((lo, u) => (u.health < lo.health ? u : lo), hostiles[0]);
      target.health = Math.max(0, target.health - defense);
      if (target.health <= 0) {
        if (!target.isPvE) this.refundPop(target.ownerId);
        this.state.units.delete(target.id);
      }
    }
  }

  private siegeLair(lair: LairNode, besiegers: UnitNode[]): void {
    if (lair.health <= 0) {
      besiegers.forEach(u => { this.state.units.delete(u.id); this.refundPop(u.ownerId); });
      return;
    }
    besiegers.forEach(u => {
      if (lair.health <= 0) return;
      if (this.state.tick - u.lastCombatTick < COMBAT_COOLDOWN_TICKS) return;
      const stats = TROOP_STATS[u.type];
      if (!stats) return;
      const dmg = Math.max(1, Math.floor(stats.attack * 0.5));
      lair.health = Math.max(0, lair.health - dmg);
      u.lastCombatTick = this.state.tick;
      if (lair.health <= 0) {
        // Bounty to the slayer, lair regrows later
        const bounty = lair.type === 'spider' ? SPIDER_BOUNTY : GOBLIN_BOUNTY;
        const killer = this.state.players.get(u.ownerId);
        if (killer) {
          killer.wood += bounty.wood; killer.food += bounty.food; killer.gold += bounty.gold;
        }
        lair.respawnAtTick = this.state.tick + LAIR_RESPAWN_TICKS;
        console.log(`Lair ${lair.id} destroyed by ${u.ownerId}`);
      }
    });

    // The lair bites back
    if (lair.health > 0 && this.state.tick % RETALIATE_INTERVAL_TICKS === 0) {
      const alive = besiegers.filter(u => u.health > 0 && this.state.units.has(u.id));
      if (alive.length > 0) {
        const target = alive[Math.floor(Math.random() * alive.length)];
        target.health = Math.max(0, target.health - 8);
        if (target.health <= 0) {
          this.refundPop(target.ownerId);
          this.state.units.delete(target.id);
        }
      }
    }
  }

  private conquerCity(city: CityNode, newOwnerId: string): void {
    const oldOwnerId = city.ownerId;
    const defender = oldOwnerId ? this.state.players.get(oldOwnerId) : null;

    // 10% resource bounty (PvE razing pays nothing)
    if (newOwnerId !== 'pve' && defender) {
      const attacker = this.state.players.get(newOwnerId);
      if (attacker) {
        attacker.wood += Math.floor(defender.wood * 0.1);
        attacker.food += Math.floor(defender.food * 0.1);
        attacker.gold += Math.floor(defender.gold * 0.1);
      }
    }

    // Advanced buildings burn down
    const bldRemove: string[] = [];
    this.state.buildings.forEach(b => { if (b.cityId === city.id) bldRemove.push(b.id); });
    bldRemove.forEach(id => this.state.buildings.delete(id));

    city.townHallLevel = 1;
    city.influenceRadius = 150;
    city.maxBuildings = 2;
    city.maxHealth = 1000;
    if (newOwnerId === 'pve') {
      city.ownerId = '';
      city.health = 300;
    } else {
      city.ownerId = newOwnerId;
      city.health = 500;
      const attacker = this.state.players.get(newOwnerId);
      if (attacker && !attacker.connectedCityId) attacker.connectedCityId = city.id;
    }
    if (defender && defender.connectedCityId === city.id) {
      // Fall back to another city they still own, if any
      const fallback = [...this.state.cities.values()].find(c => c.ownerId === defender.id);
      defender.connectedCityId = fallback ? fallback.id : '';
    }

    // Clear out remaining hostile units at/heading to the city (pop refunded)
    const unitsToRemove: string[] = [];
    this.state.units.forEach(u => {
      const road = this.state.roads.get(u.roadId);
      const headingHere = road && road.toId === city.id;
      const parkedHere = u.atNodeId === city.id;
      if ((headingHere || parkedHere) && u.ownerId !== newOwnerId) unitsToRemove.push(u.id);
    });
    unitsToRemove.forEach(id => {
      const u = this.state.units.get(id);
      if (u && !u.isPvE) this.refundPop(u.ownerId);
      this.state.units.delete(id);
    });
  }

  // ─── Support ────────────────────────────────────────────────

  private processMonkHealing(): void {
    const monks: UnitNode[] = [];
    this.state.units.forEach(u => { if (u.type === 'monk' && !u.isPvE) monks.push(u); });
    if (monks.length === 0) return;

    monks.forEach(monk => {
      this.state.units.forEach(other => {
        if (other.id === monk.id || other.ownerId !== monk.ownerId) return;
        if (other.health >= other.maxHealth) return;
        const near = monk.atNodeId
          ? other.atNodeId === monk.atNodeId
          : this.pairKey(other.roadId) === this.pairKey(monk.roadId)
            && Math.abs(this.pairPos(other) - this.pairPos(monk)) <= 0.06;
        if (near) other.health = Math.min(other.maxHealth, other.health + 5);
      });
    });
  }

  /** Defenders garrisoned at a node with no enemies left go home. */
  private cleanupIdleGarrisons(): void {
    const toRemove: string[] = [];
    this.state.units.forEach(u => {
      if (u.status !== 'defending') return;
      const enemies = this.unitsAtNode(u.atNodeId).some(o => o.ownerId !== u.ownerId);
      if (!enemies) toRemove.push(u.id);
    });
    toRemove.forEach(id => {
      const u = this.state.units.get(id);
      if (u && !u.isPvE) this.refundPop(u.ownerId);
      this.state.units.delete(id);
    });
  }

  private refundPop(playerId?: string): void {
    if (!playerId || playerId === 'pve') return;
    const p = this.state.players.get(playerId);
    if (p) p.populationUsed = Math.max(0, p.populationUsed - 1);
  }

  private buildingsOf(cityId: string): BuildingNode[] {
    const r: BuildingNode[] = [];
    this.state.buildings.forEach(b => { if (b.cityId === cityId) r.push(b); });
    return r;
  }
}
