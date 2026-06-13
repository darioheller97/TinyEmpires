import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player, TECH_TREE } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS } from './schema/BuildingNode';
import { ResourceNode, ResourceType, HARVEST_RATE } from './schema/ResourceNode';
import { LairNode } from './schema/LairNode';
import { UnitNode, TROOP_STATS, TROOP_TYPES } from './schema/UnitNode';
import { Elevation } from './schema/Elevation';
import { generateMap, computeLandGrid, generateElevations } from './MapGenerator';

// Matches the four Tiny Swords faction palettes: Blue, Red, Yellow, Purple
const PLAYER_COLORS = ['#4488ff', '#ff4444', '#ffd700', '#aa44ff'];

const ECONOMY_INTERVAL_TICKS = 10;   // 1s at 10Hz
const COMBAT_COOLDOWN_TICKS = 3;     // attack every 0.3s while engaged
const RETALIATE_INTERVAL_TICKS = 5;  // towers/town hall strike besiegers
const AUTO_PRODUCE_INTERVAL_TICKS = 60;
const PVE_SPAWN_INTERVAL = 450;      // 45s between lair waves
const PVE_FIRST_WAVE_TICK = 1800;    // 3 min of peace before monsters stir
const PVE_MAX_ALIVE_PER_LAIR = 5;
const LAIR_RESPAWN_TICKS = 1800;     // destroyed lairs regrow after 3 min
const HEAL_INTERVAL_TICKS = 5;

const SPIDER_BOUNTY = { wood: 0, food: 120, gold: 30 };
const GOBLIN_BOUNTY = { wood: 0, food: 30, gold: 120 };

const VILLAGER_COST_FOOD = 15;
const VILLAGER_SPEED = 4.5;          // px per tick, walking off-road
// Units advance on a rhythm (NecroDancer-style beat) instead of gliding
const MOVE_BEAT_TICKS = 8;           // one step every 0.8s
const VILLAGER_HARVEST_INTERVAL = 10; // ticks between harvest ticks
const VILLAGER_SEARCH_RADIUS = 1400;  // from home city
const VILLAGER_CARRY_CAP = 9;         // units hauled before a villager returns home
const SHEEP_REGEN_INTERVAL_TICKS = 30; // ~3s between sheep flock growth
const SHEEP_REGEN_AMOUNT = 2;          // food units regrown per interval
const ARCHER_DEF_RANGE = 280;          // how far tower/capital archers can shoot
const ARCHER_DEF_DMG = 13;             // per archer shot (before armour)

/**
 * Rasterize a road spline into a 4-connected sequence of 64px tiles.
 * MUST stay identical to the client version (terrain.ts) — units hop
 * exactly along these tiles.
 */
export function computeTilePath(spline: { x: number; y: number }[]): { c: number; r: number }[] {
  const T = 64;
  const cells: { c: number; r: number }[] = [];
  spline.forEach(p => {
    const c = Math.floor(p.x / T), r = Math.floor(p.y / T);
    const last = cells[cells.length - 1];
    if (last && last.c === c && last.r === r) return;
    if (last && last.c !== c && last.r !== r) cells.push({ c, r: last.r }); // bridge corners
    cells.push({ c, r });
  });
  return cells;
}

function buildSplinePoints(a: { x: number; y: number }, via: { x: number; y: number }[], b: { x: number; y: number }): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const all = [a, ...via, b];
  for (let i = 0; i < all.length - 1; i++) {
    const p0 = all[i], p1 = all[i + 1];
    // Sample ≤40px apart so tile rasterization never skips a cell, but keep the
    // point count modest for the (now multi-segment) orthogonal roads.
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(2, Math.ceil(len / 40));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
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
  // Tile slots per physical road (keyed by pairKey)
  private pairSlots = new Map<string, number>();
  // Plateau discs that block building placement and villager movement
  private elevations: { x: number; y: number; r: number }[] = [];

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
      lair.lastSpawnTick = PVE_FIRST_WAVE_TICK - PVE_SPAWN_INTERVAL;
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
      // Slots = the road's rasterized tile path (fId < rId always, so the
      // canonical pair direction is the forward spline — mirrored client-side)
      this.pairSlots.set(fId, Math.max(3, computeTilePath(fwd).length));
      const lair = this.state.lairs.get(e.a);
      if (lair) lair.roadId = fId;
    });
    map.resources.forEach(r => {
      this.state.resources.set(r.id, new ResourceNode(r.id, r.type, r.x, r.y, r.amount));
    });

    // ── Plateaus / cliffs: land grid → elevation discs (server-authoritative) ──
    const roadSplines: { x: number; y: number }[][] = [];
    map.edges.forEach(e => {
      const aN = allNodes.find(n => n.id === e.a);
      const bN = allNodes.find(n => n.id === e.b);
      if (aN && bN) roadSplines.push(buildSplinePoints({ x: aN.x, y: aN.y }, e.via, { x: bN.x, y: bN.y }));
    });
    const land = computeLandGrid(seed, map.width, map.height, map.cities, map.lairs, map.resources, roadSplines);
    this.elevations = generateElevations(seed, land, map.cities, map.lairs, map.resources, roadSplines);
    this.elevations.forEach(e => this.state.elevations.push(new Elevation(e.x, e.y, e.r)));
  }

  /** True if the point sits on (or just inside the margin of) a plateau/cliff. */
  private onElevation(x: number, y: number, margin = 0): boolean {
    return this.elevations.some(e => Math.hypot(e.x - x, e.y - y) < e.r + margin);
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
      // Ring sits clear of the castle sprite (~90px tall above the node); skip
      // any slot that would land on a plateau/cliff.
      const count = this.buildingsOf(city.id).length;
      const radius = 130 + 30 * Math.floor(count / 8);
      let bx = 0, by = 0;
      for (let k = 0; k < 8; k++) {
        const angle = (count + k) * (Math.PI * 2 / 8) + Math.PI / 8;
        bx = city.x + Math.cos(angle) * radius;
        by = city.y + Math.sin(angle) * radius;
        if (!this.onElevation(bx, by, 24)) break;
      }
      const bId = nextId('bld');
      this.state.buildings.set(bId, new BuildingNode(bId, city.id, bt, bx, by));
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

    this.onMessage('spawn_villager', (client, msg: { cityId: string; resourceType: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!['tree', 'sheep', 'gold'].includes(msg.resourceType)) return;
      const city = this.state.cities.get(msg.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (player.food < VILLAGER_COST_FOOD) return;
      if (player.populationUsed + 1 > player.populationCap) return;
      player.food -= VILLAGER_COST_FOOD;
      player.populationUsed += 1;
      const unit = new UnitNode(nextId('vil'), client.sessionId, 'villager', '');
      unit.x = city.x; unit.y = city.y + 40;
      unit.homeCityId = city.id;
      unit.resourceType = msg.resourceType;
      unit.status = 'marching';
      this.state.units.set(unit.id, unit);
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

    this.onMessage('set_rally', (client, msg: { cityId: string; roadId: string }) => {
      const city = this.state.cities.get(msg.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (msg.roadId === '') { city.rallyRoadId = ''; return; }
      const road = this.state.roads.get(msg.roadId);
      if (!road || road.fromId !== city.id) return; // must be an outgoing road
      city.rallyRoadId = msg.roadId;
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
    const exits = [...this.state.roads.values()].filter(r => r.fromId === city.id);
    const targetRoad = exits.find(r => r.id === city.rallyRoadId) || exits[0];
    if (!targetRoad) return false;
    if (!this.isSlotFree(targetRoad.id, 0)) return false; // exit tile occupied
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
    this.processVillagers();
    this.moveUnits();
    this.processCombat();
    this.processSieges();
    this.processDefenseArchers();
    if (this.state.tick % HEAL_INTERVAL_TICKS === 0) this.processMonkHealing();
    if (this.state.tick % SHEEP_REGEN_INTERVAL_TICKS === 0) this.processSheepRegen();
    this.cleanupIdleGarrisons();
  }

  // ─── Economy ────────────────────────────────────────────────

  private processEconomy(): void {
    const income = new Map<string, { w: number; f: number; g: number; pop: number }>();
    this.state.cities.forEach(city => {
      if (!city.ownerId || !this.state.players.has(city.ownerId)) return;
      const acc = income.get(city.ownerId) || { w: 0, f: 0, g: 0, pop: 10 };
      // Small town-hall trickle; the real income comes from villagers
      acc.w += city.townHallLevel;
      acc.f += city.townHallLevel * 0.5;
      acc.g += city.townHallLevel * 0.25;
      this.buildingsOf(city.id).forEach(b => {
        if (b.type === 'house') acc.pop += 5;
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

      // Don't flood the map: each lair keeps a small standing warband
      let alive = 0;
      this.state.units.forEach(u => { if (u.isPvE && u.type === lair.type) alive++; });
      if (alive >= PVE_MAX_ALIVE_PER_LAIR) return;

      const targetCityId = lair.type === 'spider'
        ? this.findResourceHoardingCity('food')
        : this.findResourceHoardingCity('gold');
      if (!targetCityId) return;

      const count = 2 + Math.floor(Math.random() * 2);
      const slots = this.slotsOf(lair.roadId);
      for (let i = 0; i < count; i++) {
        if (!this.isSlotFree(lair.roadId, i)) continue; // tile taken
        const unit = new UnitNode(nextId('pve'), 'pve', lair.type, lair.roadId);
        unit.originNodeId = lair.id;
        unit.targetNodeId = targetCityId;
        unit.t = i / slots; // one per tile, marching out in file
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

  // ─── Villagers (off-road gatherers) ─────────────────────────

  private processVillagers(): void {
    this.state.units.forEach(unit => {
      if (unit.type !== 'villager') return;
      const player = this.state.players.get(unit.ownerId);
      if (!player) { this.state.units.delete(unit.id); return; }
      const home = this.state.cities.get(unit.homeCityId);

      let vSpeed = VILLAGER_SPEED;
      if (player.hasTech('speed')) vSpeed *= 1.25;

      // Full backpack (or nothing left to gather) → haul it home and bank it.
      if (unit.carrying >= VILLAGER_CARRY_CAP || (unit.carrying > 0 && !this.hasGatherTarget(unit, home))) {
        unit.status = 'marching';
        if (!home) return;
        // Aim for the city doorstep and measure distance to that same point, so
        // the villager actually reaches the deposit threshold (don't compare to
        // the city centre while walking to a point 50px below it).
        const dropX = home.x, dropY = home.y + 40;
        const dh = Math.hypot(dropX - unit.x, dropY - unit.y);
        if (dh > 26) { this.stepToward(unit, dropX, dropY, vSpeed); return; }
        const rate = HARVEST_RATE[unit.resourceType as ResourceType];
        if (rate) {
          player.wood += rate.wood * unit.carrying / 3;
          player.food += rate.food * unit.carrying / 3;
          player.gold += rate.gold * unit.carrying / 3;
        }
        unit.carrying = 0;
        return;
      }

      // (Re)acquire a target node
      let target = unit.targetResourceId ? this.state.resources.get(unit.targetResourceId) : undefined;
      if (!target || target.amount <= 0) {
        unit.targetResourceId = '';
        let best: ResourceNode | undefined;
        let bestD = Infinity;
        this.state.resources.forEach(r => {
          if (r.type !== unit.resourceType || r.amount <= 0) return;
          if (home && Math.hypot(r.x - home.x, r.y - home.y) > VILLAGER_SEARCH_RADIUS) return;
          const d = Math.hypot(r.x - unit.x, r.y - unit.y);
          if (d < bestD) { bestD = d; best = r; }
        });
        if (best) { unit.targetResourceId = best.id; target = best; }
      }

      if (!target) {
        // Nothing to gather and empty-handed: drift home and wait
        unit.status = 'marching';
        if (home) this.stepToward(unit, home.x, home.y + 50, vSpeed);
        return;
      }

      const d = Math.hypot(target.x - unit.x, target.y - unit.y);
      if (d > 28) {
        unit.status = 'marching';
        this.stepToward(unit, target.x, target.y + 14, vSpeed);
        return;
      }

      // Working the node: load the backpack (banked later, on the trip home)
      unit.status = 'fighting'; // client plays the work/swing animation
      if (this.state.tick % VILLAGER_HARVEST_INTERVAL === 0) {
        const take = Math.min(3, target.amount, VILLAGER_CARRY_CAP - unit.carrying);
        unit.carrying += take;
        target.amount -= take;
        // Sheep flocks regrow (handled by processSheepRegen); trees/gold deplete.
        if (target.amount <= 0 && target.type !== 'sheep') {
          this.state.resources.delete(target.id);
          unit.targetResourceId = '';
        }
      }
    });
  }

  /** Any reachable, non-empty node of this villager's resource still left? */
  private hasGatherTarget(unit: UnitNode, home: CityNode | undefined): boolean {
    let found = false;
    this.state.resources.forEach(r => {
      if (found || r.type !== unit.resourceType || r.amount <= 0) return;
      if (home && Math.hypot(r.x - home.x, r.y - home.y) > VILLAGER_SEARCH_RADIUS) return;
      found = true;
    });
    return found;
  }

  /** Sheep flocks slowly regrow so food never runs out permanently. */
  private processSheepRegen(): void {
    this.state.resources.forEach(r => {
      if (r.type === 'sheep' && r.amount < r.maxAmount) {
        r.amount = Math.min(r.maxAmount, r.amount + SHEEP_REGEN_AMOUNT);
      }
    });
  }

  private stepToward(unit: UnitNode, tx: number, ty: number, speed: number): void {
    const d = Math.hypot(tx - unit.x, ty - unit.y);
    if (d < 1) return;
    const step = Math.min(speed, d);
    let nx = unit.x + (tx - unit.x) / d * step;
    let ny = unit.y + (ty - unit.y) / d * step;
    // Slide around any plateau the straight step would walk into.
    const e = this.elevations.find(el => Math.hypot(el.x - nx, el.y - ny) < el.r + 16);
    if (e) {
      const ax = nx - e.x, ay = ny - e.y, al = Math.hypot(ax, ay) || 1;
      nx = e.x + ax / al * (e.r + 16);
      ny = e.y + ay / al * (e.r + 16);
      const tnx = -ay / al, tny = ax / al; // tangent
      const s = Math.sign((tx - unit.x) * tnx + (ty - unit.y) * tny) || 1;
      nx += tnx * s * step * 0.7;
      ny += tny * s * step * 0.7;
    }
    unit.x = nx;
    unit.y = ny;
  }

  // ─── Movement ───────────────────────────────────────────────

  private slotsOf(roadId: string): number {
    return this.pairSlots.get(this.pairKey(roadId)) || 12;
  }

  private isSlotFree(roadId: string, slot: number): boolean {
    const key = this.canonSlotKey(roadId, slot);
    let free = true;
    this.state.units.forEach(u => {
      if (u.type === 'villager' || u.atNodeId) return;
      if (this.pairKey(u.roadId) !== this.pairKey(roadId)) return;
      const s = Math.round(u.t * this.slotsOf(u.roadId));
      if (this.canonSlotKey(u.roadId, s) === key) free = false;
    });
    return free;
  }

  /** Slot index in the canonical (pair-shared) frame for occupancy checks. */
  private canonSlotKey(roadId: string, slot: number): string {
    const key = this.pairKey(roadId);
    const slots = this.pairSlots.get(key) || 12;
    const canon = roadId === key ? slot : slots - slot;
    return `${key}:${canon}`;
  }

  /** Beat-stepped, tile-based road movement: one unit per tile. */
  private moveUnits(): void {
    if (this.state.tick % MOVE_BEAT_TICKS !== 0) return;
    const toRemove: string[] = [];

    // Occupancy of road tiles by canonical slot
    const occ = new Map<string, string>();
    const roadUnits: UnitNode[] = [];
    this.state.units.forEach(u => {
      if (u.type === 'villager' || u.atNodeId) return;
      const slots = this.slotsOf(u.roadId);
      occ.set(this.canonSlotKey(u.roadId, Math.round(u.t * slots)), u.id);
      roadUnits.push(u);
    });
    // Front units step first so columns flow instead of accordioning
    roadUnits.sort((a, b) => b.t - a.t);

    for (const unit of roadUnits) {
      if (unit.status === 'fighting' || unit.status === 'sieging' || unit.status === 'defending') continue;
      const road = this.state.roads.get(unit.roadId);
      if (!road) { toRemove.push(unit.id); this.refundPop(unit.ownerId); continue; }
      if (!TROOP_STATS[unit.type]) { toRemove.push(unit.id); continue; }

      // Everyone marches to the same drum: exactly one tile per beat
      const slots = this.slotsOf(unit.roadId);
      const slot = Math.round(unit.t * slots);
      if (slot + 1 >= slots) {
        const targetId = road.toId;
        const fromKey = this.canonSlotKey(unit.roadId, slot);
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
            occ.set(this.canonSlotKey(nextRoad.id, 0), unit.id);
          } else {
            toRemove.push(unit.id);
            this.refundPop(unit.ownerId);
          }
        }
        occ.delete(fromKey);
        continue;
      }

      const nextKey = this.canonSlotKey(unit.roadId, slot + 1);
      if (occ.has(nextKey)) continue; // tile taken — wait (or fight, if it's an enemy)
      occ.delete(this.canonSlotKey(unit.roadId, slot));
      unit.t = (slot + 1) / slots;
      occ.set(nextKey, unit.id);
    }
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
    // Re-evaluate engagements every tick (villagers manage their own status)
    this.state.units.forEach(u => { if (u.status === 'fighting' && u.type !== 'villager') u.status = 'marching'; });

    const groups = new Map<string, UnitNode[]>();
    this.state.units.forEach(u => {
      if (u.type === 'villager') return; // gatherers don't fight
      const key = u.atNodeId ? `node:${u.atNodeId}` : `road:${this.pairKey(u.roadId)}`;
      const list = groups.get(key) || [];
      list.push(u);
      groups.set(key, list);
    });

    const dead = new Set<string>();
    groups.forEach((units, key) => {
      if (units.length < 2) return;
      const atNode = key.startsWith('node:');
      const slots = this.pairSlots.get(key.slice(5)) || 12;
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const a = units[i], b = units[j];
          if (a.ownerId === b.ownerId) continue;
          if (dead.has(a.id) || dead.has(b.id)) continue;

          // Tile gap along the shared road (0 when both parked at a node).
          const tileGap = atNode ? 0 : Math.abs(this.pairPos(a) - this.pairPos(b)) * slots;
          const aReach = (TROOP_STATS[a.type]?.rangeTiles ?? 1) + 0.25;
          const bReach = (TROOP_STATS[b.type]?.rangeTiles ?? 1) + 0.25;
          const aCanHit = tileGap <= aReach;
          const bCanHit = tileGap <= bReach;
          if (!aCanHit && !bCanHit) continue; // still out of range — keep marching to close

          const aReady = this.state.tick - a.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          const bReady = this.state.tick - b.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          // A unit only stops to fight when it can actually strike; one that's
          // being shot from afar keeps advancing until it's in melee range.
          if (aCanHit) {
            if (!a.atNodeId) a.status = 'fighting';
            if (aReady) { b.health = Math.max(0, b.health - this.calcDamage(a, b)); a.lastCombatTick = this.state.tick; }
          }
          if (bCanHit) {
            if (!b.atNodeId) b.status = 'fighting';
            if (bReady) { a.health = Math.max(0, a.health - this.calcDamage(b, a)); b.lastCombatTick = this.state.tick; }
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
    const dStats = TROOP_STATS[defender.type];
    if (!aStats) return 0;
    let base = aStats.attack;

    // Unit-damage techs (players only)
    if (!attacker.isPvE) {
      const owner = this.state.players.get(attacker.ownerId);
      if (owner) {
        if (owner.hasTech('dmg_knight') && attacker.type === 'knight') base *= 1.25;
        if (owner.hasTech('dmg_lancer') && attacker.type === 'lancer') base *= 1.25;
        if (owner.hasTech('dmg_archer') && attacker.type === 'archer') base *= 1.25;
      }
    }

    // Armour soaks damage; the attacker's penetration ignores a fraction of it.
    // Knights (high armour) shrug off arrows; lancers (high pen) punch through.
    const armor = (dStats?.armor ?? 0) * (1 - aStats.armorPen);
    let dmg = base - armor;

    // Anti-snowball: attackers weaken with distance, defenders near home resist
    dmg *= Math.max(0.5, 1.0 - attacker.distanceTraveled * 0.10);
    if (defender.status === 'defending' || defender.distanceTraveled < 0.5) dmg *= 0.85;
    return Math.max(1, Math.floor(dmg));
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
    // The fort itself deals no damage — its archers (processDefenseArchers) do,
    // and they shoot besiegers (at the node, in range) and passers-by alike.
  }

  // World position of any unit: villagers carry x/y; parked units sit at their
  // node; road units interpolate their road's spline at t.
  private unitWorldPos(u: UnitNode): { x: number; y: number } {
    if (u.type === 'villager') return { x: u.x, y: u.y };
    if (u.atNodeId) {
      const n = this.state.cities.get(u.atNodeId) || this.state.intersections.get(u.atNodeId) || this.state.lairs.get(u.atNodeId);
      if (n) return { x: n.x, y: n.y };
    }
    const road = this.state.roads.get(u.roadId);
    const pts = road?.splinePoints;
    if (!pts || pts.length === 0) return { x: u.x, y: u.y };
    const last = pts.length - 1;
    const f = Math.max(0, Math.min(1, u.t)) * last;
    const i = Math.floor(f), frac = f - i;
    const a = pts[i], b = pts[Math.min(last, i + 1)];
    if (!a || !b) return { x: u.x, y: u.y };
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  // Tower & capital archers shoot the nearest enemies passing within range.
  // The capital fort fields two archers; each defense tower fields one.
  private processDefenseArchers(): void {
    if (this.state.tick % RETALIATE_INTERVAL_TICKS !== 0) return;
    this.state.cities.forEach(city => {
      if (!city.ownerId || !this.state.players.has(city.ownerId)) return;
      const owner = this.state.players.get(city.ownerId);
      const dmg = ARCHER_DEF_DMG * (owner?.hasTech('dmg_archer') ? 1.25 : 1);
      this.archersShoot(city.x, city.y, city.ownerId, 2, dmg);            // capital: 2 archers
      this.buildingsOf(city.id).forEach(b => {
        if (b.type === 'defense_tower') this.archersShoot(b.x, b.y, city.ownerId, 1, dmg); // tower: 1
      });
    });
  }

  private archersShoot(x: number, y: number, ownerId: string, shots: number, dmg: number): void {
    const inRange: { u: UnitNode; d: number }[] = [];
    this.state.units.forEach(u => {
      if (u.ownerId === ownerId || u.type === 'villager' || u.health <= 0) return;
      const p = this.unitWorldPos(u);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= ARCHER_DEF_RANGE) inRange.push({ u, d });
    });
    if (inRange.length === 0) return;
    inRange.sort((a, b) => a.d - b.d); // focus the closest threats
    for (let s = 0; s < shots && s < inRange.length; s++) {
      const t = inRange[s].u;
      const armor = (TROOP_STATS[t.type]?.armor ?? 0) * 0.9; // archers have low penetration
      t.health = Math.max(0, t.health - Math.max(1, Math.floor(dmg - armor)));
      if (t.health <= 0) {
        if (!t.isPvE) this.refundPop(t.ownerId);
        this.state.units.delete(t.id);
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
