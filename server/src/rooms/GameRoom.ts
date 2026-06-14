import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player, TECH_TREE } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';
import { BuildingNode, BuildingType, BUILDING_TYPES, BUILDING_COSTS, PRODUCES, producerFor } from './schema/BuildingNode';
import { ResourceNode, ResourceType, HARVEST_RATE } from './schema/ResourceNode';
import { LairNode } from './schema/LairNode';
import { ObjectiveNode } from './schema/ObjectiveNode';
import { UnitNode, TROOP_STATS, TROOP_TYPES, RPS_ADVANTAGE } from './schema/UnitNode';
import { Elevation } from './schema/Elevation';
import { generateMap, computeLandGrid, generateElevations } from './MapGenerator';
import { NavGrid } from './NavGrid';

// Matches the four Tiny Swords faction palettes: Blue, Red, Yellow, Purple
const PLAYER_COLORS = ['#4488ff', '#ff4444', '#ffd700', '#aa44ff'];

const ECONOMY_INTERVAL_TICKS = 10;   // 1s at 10Hz
const COMBAT_COOLDOWN_TICKS = 3;     // attack every 0.3s while engaged
const RETALIATE_INTERVAL_TICKS = 5;  // towers/town hall strike besiegers
const AUTO_PRODUCE_INTERVAL_TICKS = 60;
// Per-unit recruit cooldown (ticks, 10/s): a building can't train again until it
// elapses. Knights 20s, archers 15s, lancers 10s, monks 30s. The 'fast_recruit'
// tech trims them 20%.
const RECRUIT_COOLDOWN: Record<string, number> = { knight: 200, archer: 150, lancer: 100, monk: 300 };
const FAST_RECRUIT_MULT = 0.8;
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
const GOLD_REGEN_AMOUNT = 3;           // gold a vein slowly refills per interval
const ARCHER_DEF_RANGE = 280;          // how far tower/capital archers can shoot
const ARCHER_DEF_DMG = 13;             // per archer shot (before armour)
const PVE_KILL_GOLD = 4;               // tiny gold a slain monster drops to its killer
const AI_INTERVAL_TICKS = 20;          // bot empires reassess every ~2s
const TREE_GROW_INTERVAL_TICKS = 50;   // ~5s between tree growth ticks
const TREE_AGE_CAP = 40;               // older trees hold more wood, to this cap

// ── Anti-snowball: diminishing per-city stipend ──
// Each extra city an empire holds yields a little less passive town-hall income,
// so the leader's economy can't run away (active villager gathering is untouched).
// 1 city ×1.0 · 2 ×0.86ea · 3 ×0.72ea · 4 ×0.58ea · 5+ floored at ×0.45.
const CITY_DIMINISH_STEP = 0.14;
const CITY_DIMINISH_FLOOR = 0.45;

// ── Contested mid-game objectives (gold mine / mercenary camp / shrine) ──
const OBJ_CAPTURE_RADIUS = 150;        // px: military units this close contest it
const OBJ_CAPTURE_THRESHOLD = 100;     // meter value at which ownership flips
const OBJ_CAPTURE_RATE = 9;            // meter gained per beat by a lone holder (+ per extra unit)
const OBJ_DECAY_RATE = 6;              // meter lost per beat when nobody contests
const OBJ_MINE_GOLD = 3;               // gold/economy-tick a held gold mine yields
const OBJ_MINE_WOOD = 2;               // wood/economy-tick a held gold mine yields
const OBJ_MERC_INTERVAL = 240;         // ticks (~24s) between free mercenaries
const OBJ_SHRINE_DAMAGE_MULT = 1.15;   // combat damage buff while a shrine is held

// ── Interactive clash: lane army orders + Rally commander ability ──
const HOLD_BRACE_MULT = 0.85;          // damage taken while an army holds (braces)
const RALLY_COOLDOWN_TICKS = 300;      // 30s between Rally casts
// Rally strength scales with the rhythm-cast accuracy (0..1 power factor):
// a sloppy cast still helps a little, a perfect combo is a big swing.
const RALLY_DMG_MIN = 1.10, RALLY_DMG_MAX = 1.45;   // attack multiplier floor/ceiling
const RALLY_HEAL_MIN = 3, RALLY_HEAL_MAX = 20;       // instant heal floor/ceiling
const RALLY_BUFF_BEATS_MIN = 2, RALLY_BUFF_BEATS_MAX = 4; // buff duration in beats

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
  // Round-robin cursor per `${intersectionId}:${ownerId}` used to fan units
  // out across exits when the player hasn't set a routing waypoint.
  private spreadCursor = new Map<string, number>();
  // Plateau discs that block building placement and villager movement
  private elevations: { x: number; y: number; r: number }[] = [];
  // RTS mode: land grid + A* navigation (built once at match start).
  private land: boolean[][] = [];
  private nav: NavGrid | null = null;
  // RTS footpaths: per-tile wear from villager traffic (tileIndex -> wear).
  private trailWear = new Map<number, number>();
  // Seed chosen by the host, applied when the match actually starts.
  private pendingSeed: number | undefined = undefined;
  private started = false;
  private aiCount = 0; // AI opponent empires to spawn at match start (solo = 1)

  onCreate(options: any): void {
    console.log('GameRoom created!', options?.code ?? '(no code)');
    this.setState(new GameState());
    this.state.phase = 'lobby';
    this.state.matchCode = String(options?.code || this.genCode()).toUpperCase();
    this.applySettings(options);
    this.pendingSeed = typeof options?.mapSeed === 'number' ? options.mapSeed >>> 0 : undefined;
    this.setMessageHandlers();
    // Map generation + sim tick are deferred to startMatch() (the host presses
    // Start once everyone is ready; solo games auto-start in onJoin).
  }

  private genCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  private applySettings(opts: any): void {
    if (!opts) return;
    if (typeof opts.mapSize === 'string') this.state.mapSize = opts.mapSize;
    if (typeof opts.npcCount === 'number') this.state.npcCount = Math.max(0, Math.min(6, opts.npcCount | 0));
    if (typeof opts.npcAggro === 'number') this.state.npcAggro = Math.max(0.25, Math.min(3, opts.npcAggro));
    if (typeof opts.npcPower === 'number') this.state.npcPower = Math.max(0.25, Math.min(3, opts.npcPower));
    if (typeof opts.aiLevel === 'string' && ['easy', 'normal', 'hard'].includes(opts.aiLevel)) this.state.aiLevel = opts.aiLevel;
    if (typeof opts.gameMode === 'string' && ['beat', 'rts'].includes(opts.gameMode)) this.state.gameMode = opts.gameMode;
  }

  /** True while this match is the free-movement RTS ("Open Field") mode. */
  private get isRts(): boolean { return this.state.gameMode === 'rts'; }

  // Rival-AI tuning by difficulty: income, whether it plays smart (counters +
  // target selection + defends), cadence, starting stash, and keep-upgrade buffer.
  private aiCfg(): { econ: number; smart: boolean; slow: boolean; stash: number; upgradeBuffer: number } {
    switch (this.state.aiLevel) {
      case 'easy': return { econ: 0.6, smart: false, slow: true, stash: 0.8, upgradeBuffer: 220 };
      case 'hard': return { econ: 1.5, smart: true, slow: false, stash: 1.4, upgradeBuffer: 90 };
      default: return { econ: 1.0, smart: true, slow: false, stash: 1.0, upgradeBuffer: 150 };
    }
  }

  private firstFreeColorIndex(): number {
    const used = new Set<number>();
    this.state.players.forEach(p => { if (p.colorIndex >= 0) used.add(p.colorIndex); });
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  // Build the map, claim a capital for each player, and start the sim.
  private startMatch(): void {
    if (this.started || this.state.phase !== 'lobby') return;
    this.started = true;
    this.initMap(this.pendingSeed);
    const cities = [...this.state.cities.values()];
    this.state.players.forEach(p => {
      if (p.colorIndex < 0) p.colorIndex = this.firstFreeColorIndex();
      p.colorHex = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
      const city = cities.find(c => !c.ownerId);
      if (city) { city.ownerId = p.id; city.health = city.maxHealth; p.connectedCityId = city.id; }
    });
    // AI rival empires take the next free capitals (placed far from the host).
    for (let i = 0; i < this.aiCount; i++) {
      const ci = this.firstFreeColorIndex();
      const bot = new Player(`bot_${i + 1}`, 'Enemy AI', PLAYER_COLORS[ci % PLAYER_COLORS.length]);
      bot.colorIndex = ci; bot.isBot = true;
      const stash = this.aiCfg().stash;
      bot.wood = 120 * stash; bot.food = 90 * stash; bot.gold = 30 * stash; // starting stash so it gets moving
      const city = cities.find(c => !c.ownerId);
      if (city) { city.ownerId = bot.id; city.health = city.maxHealth; bot.connectedCityId = city.id; }
      this.state.players.set(bot.id, bot);
    }
    this.state.phase = 'active';
    this.lock(); // no late joins once the match is running
    this.tickInterval = setInterval(() => this.gameTick(), 100);
  }

  private initMap(fixedSeed?: number): void {
    const seed = fixedSeed ?? (Math.random() * 0xffffffff) >>> 0;
    const map = generateMap(seed, { size: this.state.mapSize, npcCount: this.state.npcCount });
    this.state.mapSeed = seed;
    this.state.mapWidth = map.width;
    this.state.mapHeight = map.height;

    map.cities.forEach(c => {
      const city = new CityNode(c.id, c.x, c.y, c.name);
      city.maxBuildings = this.isRts ? 12 : 2;
      this.state.cities.set(c.id, city);
    });
    // RTS (Open Field) has no pre-built road network — paths emerge from villager
    // foot traffic — so intersections/roads are skipped (cities + terrain only).
    if (!this.isRts) map.intersections.forEach(n => {
      this.state.intersections.set(n.id, new IntersectionNode(n.id, n.x, n.y, n.name));
    });
    // NPC aggression scales wave frequency + how soon the first wave comes.
    const aggro = this.state.npcAggro || 1;
    const interval = Math.max(60, Math.round(PVE_SPAWN_INTERVAL / aggro));
    const firstWave = Math.max(120, Math.round(PVE_FIRST_WAVE_TICK / aggro));
    map.lairs.forEach(l => {
      const lair = new LairNode(l.id, l.x, l.y, l.type);
      lair.spawnIntervalTicks = interval;
      lair.lastSpawnTick = firstWave - interval;
      this.state.lairs.set(l.id, lair);
    });
    const allNodes = [...map.cities, ...map.intersections, ...map.lairs];
    if (!this.isRts) map.edges.forEach((e, i) => {
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
    map.objectives.forEach(o => {
      this.state.objectives.set(o.id, new ObjectiveNode(o.id, o.kind, o.x, o.y));
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
    this.land = land;
    // RTS mode navigates the open field; build the A* grid once per match.
    if (this.isRts) this.nav = new NavGrid(land, this.elevations);
  }

  /** True if the point sits on (or just inside the margin of) a plateau/cliff. */
  private onElevation(x: number, y: number, margin = 0): boolean {
    return this.elevations.some(e => Math.hypot(e.x - x, e.y - y) < e.r + margin);
  }

  /** True when (x,y) sits on a road spline (within margin). */
  private nearRoad(x: number, y: number, margin: number): boolean {
    for (const road of this.state.roads.values()) {
      const pts = road.splinePoints;
      for (let i = 0; i < pts.length; i += 2) {
        const p = pts[i];
        if (p && Math.hypot(p.x - x, p.y - y) < margin) return true;
      }
    }
    return false;
  }

  /** A spot is blocked for building if it overlaps a plateau, a road, another
   *  building, a resource node, or sits too close to the city core. */
  private spotBlocked(x: number, y: number, city: CityNode): boolean {
    if (this.onElevation(x, y, 26)) return true;
    if (this.nearRoad(x, y, 46)) return true;
    if (Math.hypot(city.x - x, city.y - y) < 96) return true;
    for (const b of this.state.buildings.values()) {
      if (Math.hypot(b.x - x, b.y - y) < 76) return true;
    }
    for (const r of this.state.resources.values()) {
      if (Math.hypot(r.x - x, r.y - y) < 60) return true;
    }
    return false;
  }

  /** Search the ring around a city for a clear building plot. */
  private findBuildSpot(city: CityNode, count: number): { x: number; y: number } {
    let fx = city.x, fy = city.y;
    for (let ring = 0; ring < 5; ring++) {
      const radius = 132 + ring * 52 + 26 * Math.floor(count / 8);
      for (let k = 0; k < 12; k++) {
        const angle = (count + k) * (Math.PI * 2 / 12) + Math.PI / 7;
        const bx = city.x + Math.cos(angle) * radius;
        const by = city.y + Math.sin(angle) * radius;
        if (!this.spotBlocked(bx, by, city)) return { x: bx, y: by };
        fx = bx; fy = by; // remember a fallback even if blocked
      }
    }
    return { x: fx, y: fy };
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
      // Auto-place on a clear grass plot around the city (off roads, buffered
      // from other buildings/resources, never on a plateau).
      const count = this.buildingsOf(city.id).length;
      const { x: bx, y: by } = this.findBuildSpot(city, count);
      const bId = nextId('bld');
      this.state.buildings.set(bId, new BuildingNode(bId, city.id, bt, bx, by));
      this.recomputeInfluence(city);
    });

    // Towers are placed by the player anywhere inside the city's influence.
    this.onMessage('place_tower', (client, msg: { cityId: string; x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const city = this.state.cities.get(msg?.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (this.buildingsOf(city.id).length >= city.maxBuildings) return;
      if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
      // Snap to the centre of the clicked tile so towers sit on the grid.
      const T = 64;
      const x = (Math.floor(msg.x / T) + 0.5) * T;
      const y = (Math.floor(msg.y / T) + 0.5) * T;
      // Towers reach 30% beyond the fort's influence; must land on a clear plot.
      if (Math.hypot(city.x - x, city.y - y) > city.influenceRadius * 1.3) return;
      if (this.spotBlocked(x, y, city)) return;
      const cost = BUILDING_COSTS['defense_tower' as BuildingType];
      if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return;
      player.wood -= cost.wood; player.food -= cost.food; player.gold -= cost.gold;
      const bId = nextId('bld');
      this.state.buildings.set(bId, new BuildingNode(bId, city.id, 'defense_tower', x, y));
      this.recomputeInfluence(city);
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
      this.recomputeInfluence(city);
      city.maxBuildings = (this.isRts ? 12 : 2) + (city.townHallLevel - 1) * 2; // +2 build slots per upgrade
      city.maxHealth = 1000 + (city.townHallLevel - 1) * 500;
      city.health = city.maxHealth;
    });

    this.onMessage('spawn_troops', (client, msg: { buildingId?: string; cityId?: string; type: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Train at the named building; else fall back to any producer of this type.
      let building = msg.buildingId ? this.state.buildings.get(msg.buildingId) : undefined;
      if (!building) {
        const prod = producerFor(msg.type);
        building = this.buildingsOf(msg.cityId || player.connectedCityId).find(b => b.type === prod);
      }
      if (building) this.trySpawnTroop(player, building, msg.type);
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

    // Per-building rally: aim a single production building's troops down a lane,
    // so two barracks in one city can push to different fronts.
    this.onMessage('set_building_rally', (client, msg: { buildingId: string; roadId: string }) => {
      const b = this.state.buildings.get(msg.buildingId);
      if (!b) return;
      const city = this.state.cities.get(b.cityId);
      if (!city || city.ownerId !== client.sessionId) return;
      if (msg.roadId === '') { b.rallyRoadId = ''; return; }
      const road = this.state.roads.get(msg.roadId);
      if (!road || road.fromId !== city.id) return; // must be an outgoing road of this city
      b.rallyRoadId = msg.roadId;
    });

    // RTS (Open Field): move a unit selection to a point in formation.
    this.onMessage('move_units', (client, msg: { ids: string[]; x: number; y: number; formation?: string }) => {
      if (!this.isRts) return;
      this.issueMoveOrder(client.sessionId, msg.ids, msg.x, msg.y, msg.formation || 'box', 'move');
    });
    // RTS: attack-move — advance to a point, engaging enemies met on the way.
    this.onMessage('attack_move', (client, msg: { ids: string[]; x: number; y: number }) => {
      if (!this.isRts) return;
      this.issueMoveOrder(client.sessionId, msg.ids, msg.x, msg.y, 'box', 'attackmove');
    });
    // RTS: build-by-sight — place a construction site at a free position.
    this.onMessage('build_at', (client, msg: { type: string; x: number; y: number }) => {
      if (!this.isRts) return;
      const player = this.state.players.get(client.sessionId);
      if (player) this.tryBuildAt(player, msg.type, msg.x, msg.y);
    });

    // Reactive command: order my whole army on a lane to push / hold / fall back.
    this.onMessage('army_order', (client, msg: { lane: string; command: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const command = msg.command === 'hold' || msg.command === 'fallback' ? msg.command : '';
      this.unitsOnLane(msg.lane, client.sessionId).forEach(u => { u.order = command; });
    });

    // Rally commander ability: a beat of fury for my army on a lane (cooldown).
    // The client casts it as a rhythm combo; `power` (0..1) = the hit accuracy,
    // which scales the buff strength. Clamp server-side; cooldown is fixed.
    this.onMessage('commander_rally', (client, msg: { lane: string; power?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.tick < player.rallyReadyTick) return;
      const army = this.unitsOnLane(msg.lane, client.sessionId);
      if (army.length === 0) return;
      const power = Math.max(0, Math.min(1, msg.power ?? 1));
      const dmgMult = RALLY_DMG_MIN + (RALLY_DMG_MAX - RALLY_DMG_MIN) * power;
      const heal = Math.round(RALLY_HEAL_MIN + (RALLY_HEAL_MAX - RALLY_HEAL_MIN) * power);
      const buffTicks = Math.round((RALLY_BUFF_BEATS_MIN + (RALLY_BUFF_BEATS_MAX - RALLY_BUFF_BEATS_MIN) * power) * MOVE_BEAT_TICKS);
      army.forEach(u => {
        u.rallyBuffUntil = this.state.tick + buffTicks;
        u.rallyBuffMult = dmgMult;
        u.health = Math.min(u.maxHealth, u.health + heal);
      });
      player.rallyReadyTick = this.state.tick + RALLY_COOLDOWN_TICKS;
    });

    // "Work song" guitar minigame: the player keeps a combo going to speed up
    // their villagers' movement & gathering by up to +20%. The client sends the
    // live boost percent (0..20); clamp it. 0 = back to normal.
    this.onMessage('set_villager_boost', (client, msg: { boost: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const pct = Math.max(0, Math.min(20, Number(msg.boost) || 0));
      player.villagerBoost = 1 + pct / 100;
    });

    this.onMessage('research_tech', (client, msg: { techId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const tech = TECH_TREE.find(t => t.id === msg.techId);
      if (!tech || player.hasTech(tech.id) || player.gold < tech.cost) return;
      player.gold -= tech.cost;
      player.addTech(tech.id);
    });

    // ── Lobby handlers (only meaningful while phase === 'lobby') ──
    this.onMessage('select_color', (client, msg: { index: number }) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const idx = (msg?.index ?? -1) | 0;
      if (idx < 0 || idx >= PLAYER_COLORS.length) return;
      let taken = false;
      this.state.players.forEach(o => { if (o.id !== p.id && o.colorIndex === idx) taken = true; });
      if (taken) return;
      p.colorIndex = idx;
      p.colorHex = PLAYER_COLORS[idx];
    });

    this.onMessage('set_ready', (client, msg: { ready: boolean }) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !!msg?.ready;
    });

    this.onMessage('set_settings', (client, msg: any) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.isHost) return;
      this.applySettings(msg);
    });

    this.onMessage('start_match', (client) => {
      if (this.state.phase !== 'lobby') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.isHost) return;
      // Every non-host player must be ready (host readies by pressing Start).
      let allReady = true;
      this.state.players.forEach(o => { if (o.id !== p.id && !o.ready) allReady = false; });
      if (!allReady) return;
      this.startMatch();
    });
  }

  /** Recruit cooldown for a unit type, trimmed by the War Drums tech. */
  private recruitCooldown(player: Player, type: string): number {
    const base = RECRUIT_COOLDOWN[type] ?? 100;
    // Open Field is a bigger-army mode — train a touch faster than Beat.
    const modeMult = this.isRts ? 0.6 : 1;
    return Math.round(base * modeMult * (player.hasTech('fast_recruit') ? FAST_RECRUIT_MULT : 1));
  }

  // Train a unit at a SPECIFIC production building: respects its recruit cooldown
  // and sends the troop down that building's own rally road (so two barracks can
  // push to different lanes). Falls back to the city rally / first exit.
  private trySpawnTroop(player: Player, building: BuildingNode, type: string): boolean {
    const stats = TROOP_STATS[type];
    if (!stats || !TROOP_TYPES.includes(type as any)) return false;
    if (!PRODUCES[building.type]?.includes(type)) return false;     // this building can't train it
    if (building.constructing) return false;                        // not finished building yet
    if (this.state.tick < building.produceReadyTick) return false;  // still cooling down
    const city = this.state.cities.get(building.cityId);
    if (!city || city.ownerId !== player.id) return false;
    if (player.food < stats.foodCost || player.gold < stats.goldCost) return false;
    if (player.populationUsed + 1 > player.populationCap) return false;

    let unit: UnitNode;
    if (this.isRts) {
      // Free-movement spawn: pop out next to the producing building and idle
      // until the player gives a move/attack order (no roads in Open Field).
      const ang = Math.random() * Math.PI * 2, rad = 36 + Math.random() * 18;
      unit = new UnitNode(nextId('unit'), player.id, type, '');
      unit.x = building.x + Math.cos(ang) * rad;
      unit.y = building.y + Math.sin(ang) * rad + 28; // bias below the building
      unit.status = 'marching';
    } else {
      const exits = [...this.state.roads.values()].filter(r => r.fromId === city.id);
      const targetRoad = exits.find(r => r.id === (building.rallyRoadId || city.rallyRoadId)) || exits[0];
      if (!targetRoad) return false;
      if (!this.isSlotFree(targetRoad.id, 0)) return false; // exit tile occupied
      unit = new UnitNode(nextId('unit'), player.id, type, targetRoad.id);
    }
    player.food -= stats.foodCost; player.gold -= stats.goldCost;
    player.populationUsed += 1;
    unit.originNodeId = city.id;
    if (player.hasTech('hp_all')) {
      unit.maxHealth = Math.floor(unit.maxHealth * 1.2);
      unit.health = unit.maxHealth;
    }
    this.state.units.set(unit.id, unit);
    building.produceReadyTick = this.state.tick + this.recruitCooldown(player, type);
    return true;
  }

  onJoin(client: Client, options: any): void {
    // Once a match is running the room is locked, but guard anyway.
    if (this.state.phase !== 'lobby') throw new Error('Match already in progress');
    const isFirst = this.state.players.size === 0;
    const p = new Player(client.sessionId, options?.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[0]);
    p.isHost = isFirst;
    p.colorIndex = this.firstFreeColorIndex();
    p.colorHex = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    this.state.players.set(client.sessionId, p);
    // Solo games skip the lobby entirely: ready + start immediately, with one
    // AI rival empire so there's actually someone to conquer.
    if (options?.solo) { p.ready = true; this.aiCount = 1; this.startMatch(); }
  }

  onLeave(client: Client, consented: boolean): void {
    const leaving = this.state.players.get(client.sessionId);
    this.state.cities.forEach(c => { if (c.ownerId === client.sessionId) c.ownerId = ''; });
    this.state.objectives.forEach(o => { if (o.ownerId === client.sessionId) { o.ownerId = ''; o.capture = 0; o.contenderId = ''; } });
    const toRemove: string[] = [];
    this.state.units.forEach(u => { if (u.ownerId === client.sessionId) toRemove.push(u.id); });
    toRemove.forEach(id => this.state.units.delete(id));
    this.state.intersections.forEach(is => {
      const idx = is.waypoints.findIndex(w => w.ownerId === client.sessionId);
      if (idx >= 0) is.waypoints.splice(idx, 1);
    });
    this.state.players.delete(client.sessionId);
    // Hand the host crown to whoever remains, so the lobby can still start.
    if (leaving?.isHost) {
      const next = this.state.players.values().next().value as Player | undefined;
      if (next) next.isHost = true;
    }
    // A mid-match departure may leave a single empire standing.
    this.checkVictory();
  }

  onDispose(): void { clearInterval(this.tickInterval); }

  // ─── Game Tick ──────────────────────────────────────────────

  private gameTick(): void {
    this.state.tick++;
    if (this.state.tick % ECONOMY_INTERVAL_TICKS === 0) this.processEconomy();
    if (this.state.tick % AI_INTERVAL_TICKS === 0) this.processAI();
    this.processLairs();
    this.processAutoProduce();
    this.processVillagers();
    if (this.isRts) {
      // RTS: free 2D movement + real-time combat (no beat gate, no road locking).
      if (this.state.tick % AI_INTERVAL_TICKS === 0) this.rtsBotCommand();
      this.rtsMoveUnits();
      this.rtsCombat();
      this.processBuildSites();
      this.processTrails();
    } else {
      this.moveUnits();
      this.processCombat();
    }
    this.processSieges();
    this.processObjectives();
    this.processDefenseArchers();
    if (this.state.tick % HEAL_INTERVAL_TICKS === 0) this.processMonkHealing();
    if (this.state.tick % SHEEP_REGEN_INTERVAL_TICKS === 0) this.processSheepRegen();
    if (this.state.tick % TREE_GROW_INTERVAL_TICKS === 0) this.processTreeGrowth();
    this.cleanupIdleGarrisons();
  }

  // ─── RTS (Open Field) systems ───

  // Build-by-sight: validate placement (visible, clear of enemies, on land,
  // not overlapping) then drop a construction site + dispatch a pawn to raise it.
  private tryBuildAt(player: Player, type: string, x: number, y: number): boolean {
    if (!this.nav || !BUILDING_TYPES.includes(type as BuildingType)) return false;
    const t = this.nav.worldToTile(x, y);
    if (this.nav.isBlocked(t.c, t.r)) return false;                 // water / cliff
    const cx = this.nav.tileCenter(t.c, t.r).x, cy = this.nav.tileCenter(t.c, t.r).y;
    for (const b of this.state.buildings.values()) if (Math.hypot(b.x - cx, b.y - cy) < 64) return false; // overlap
    if (!this.rtsCanSee(player.id, cx, cy)) return false;           // must be in sight
    if (this.rtsEnemyNear(player.id, cx, cy, 260)) return false;    // no enemy close
    const cost = BUILDING_COSTS[type as BuildingType];
    if (player.wood < cost.wood || player.food < cost.food || player.gold < cost.gold) return false;
    let home: CityNode | undefined, hd = Infinity;
    this.state.cities.forEach(c => { if (c.ownerId !== player.id) return; const d = Math.hypot(c.x - cx, c.y - cy); if (d < hd) { hd = d; home = c; } });
    if (!home) return false;
    if (this.buildingsOf(home.id).length >= home.maxBuildings) return false; // city's build slots full
    player.wood -= cost.wood; player.food -= cost.food; player.gold -= cost.gold;
    const bId = nextId('bld');
    const b = new BuildingNode(bId, home.id, type as BuildingType, cx, cy);
    b.constructing = true; b.buildProgress = 0; b.health = 1; b.maxHealth = 200;
    this.state.buildings.set(bId, b);
    this.assignBuilder(player.id, b);
    return true;
  }

  /** True if (x,y) is within sight of any of the player's units/buildings/cities. */
  private rtsCanSee(ownerId: string, x: number, y: number): boolean {
    const R = 560;
    for (const c of this.state.cities.values()) if (c.ownerId === ownerId && Math.hypot(c.x - x, c.y - y) < R) return true;
    for (const u of this.state.units.values()) if (u.ownerId === ownerId && Math.hypot(u.x - x, u.y - y) < R) return true;
    for (const b of this.state.buildings.values()) {
      const c = this.state.cities.get(b.cityId);
      if (c && c.ownerId === ownerId && Math.hypot(b.x - x, b.y - y) < R) return true;
    }
    return false;
  }

  /** True if an enemy unit/city sits within `r` of (x,y). */
  private rtsEnemyNear(ownerId: string, x: number, y: number, r: number): boolean {
    for (const u of this.state.units.values()) if (u.ownerId !== ownerId && u.type !== 'villager' && u.health > 0 && Math.hypot(u.x - x, u.y - y) < r) return true;
    for (const c of this.state.cities.values()) if (c.ownerId && c.ownerId !== ownerId && Math.hypot(c.x - x, c.y - y) < r) return true;
    return false;
  }

  /** Dispatch the nearest free pawn to channel a construction site. */
  private assignBuilder(ownerId: string, b: BuildingNode): void {
    let best: UnitNode | undefined, bd = Infinity;
    this.state.units.forEach(u => {
      if (u.ownerId !== ownerId || u.type !== 'villager' || u.health <= 0 || u.status === 'building') return;
      const d = Math.hypot(u.x - b.x, u.y - b.y);
      if (d < bd) { bd = d; best = u; }
    });
    if (best) { best.status = 'building'; best.buildTargetId = b.id; best.carrying = 0; best.targetResourceId = ''; b.builderId = best.id; }
  }

  // Construction sites advance while their assigned pawn channels beside them.
  private processBuildSites(): void {
    const BUILD_TIME = 80; // ~8s of channeling to finish
    this.state.buildings.forEach(b => {
      if (!b.constructing) return;
      let builder = b.builderId ? this.state.units.get(b.builderId) : undefined;
      if (!builder || builder.health <= 0 || builder.status !== 'building') {
        const city = this.state.cities.get(b.cityId);
        if (city) this.assignBuilder(city.ownerId, b); // builder lost — reassign
        return;
      }
      if (Math.hypot(builder.x - b.x, builder.y - b.y) <= 44) {
        b.buildProgress = Math.min(1, b.buildProgress + 1 / BUILD_TIME);
        b.health = Math.max(1, Math.round(b.maxHealth * b.buildProgress));
        if (b.buildProgress >= 1) {
          b.constructing = false; b.health = b.maxHealth; b.builderId = '';
          builder.status = 'marching'; builder.buildTargetId = '';
        }
      }
    });
  }

  // Footpaths emerge from villager traffic (Settlers-style): each tick a villager
  // wears its tile a little; wear decays so abandoned routes fade. Tiles past a
  // visible threshold sync to the client (drawn as paths) and grant a speed bonus.
  private processTrails(): void {
    if (!this.nav) return;
    const cols = this.nav.cols;
    this.state.units.forEach(u => {
      if (u.type !== 'villager' || u.health <= 0) return;
      const t = this.nav!.worldToTile(u.x, u.y);
      if (this.nav!.isBlocked(t.c, t.r)) return;
      const idx = t.r * cols + t.c;
      this.trailWear.set(idx, Math.min(GameRoom.TRAIL_MAX, (this.trailWear.get(idx) || 0) + GameRoom.TRAIL_GAIN));
    });
    if (this.state.tick % 5 !== 0) return; // decay + sync at 2 Hz to limit churn
    const drop: number[] = [];
    this.trailWear.forEach((w, idx) => {
      const nw = w - GameRoom.TRAIL_DECAY;
      if (nw <= 0) { drop.push(idx); return; }
      this.trailWear.set(idx, nw);
      const key = String(idx);
      const visible = nw >= GameRoom.TRAIL_VISIBLE;
      if (visible && !this.state.trails.has(key)) this.state.trails.set(key, 1);
      else if (!visible && this.state.trails.has(key)) this.state.trails.delete(key);
    });
    drop.forEach(idx => { this.trailWear.delete(idx); this.state.trails.delete(String(idx)); });
  }

  private static TRAIL_GAIN = 1.2;
  private static TRAIL_DECAY = 0.25; // per 5-tick sync pass (~0.5/s)
  private static TRAIL_VISIBLE = 6;  // wear at which a path shows + speeds units
  private static TRAIL_MAX = 30;
  private static TRAIL_SPEED_MULT = 1.25;

  // Real-time attack cadence (ticks between strikes) + reach (px) per type.
  // Knights hit hard but slowly; lancers/archers faster; archers reach far.
  private static RTS_ATTACK_INTERVAL: Record<string, number> = { knight: 16, lancer: 9, archer: 11, monk: 9999, goblin: 11, spider: 10 };
  private static RTS_RANGE_PX: Record<string, number> = { knight: 66, lancer: 76, archer: 340, monk: 66, goblin: 60, spider: 66 };
  private static RTS_AGGRO_PX = 430; // how far a unit notices an enemy to engage

  private rtsCombat(): void {
    const dead: string[] = [];
    this.state.units.forEach(u => {
      if (u.type === 'villager' || u.health <= 0) return;
      // Monks never fight (they heal — see processMonkHealing); follow orders.
      if (u.type === 'monk') { u.engaged = false; return; }
      // A pure 'move' order ignores enemies (a-move/idle units defend & engage).
      if (u.orderKind === 'move') { u.engaged = false; return; }

      const range = GameRoom.RTS_RANGE_PX[u.type] ?? 66;
      const enemy = this.rtsNearestEnemyUnit(u, GameRoom.RTS_AGGRO_PX);
      let tx = 0, ty = 0, reach = range, onUnit: UnitNode | null = null, onCity: CityNode | null = null, onLair: LairNode | null = null;

      if (enemy) {
        onUnit = enemy; tx = enemy.x; ty = enemy.y;
      } else if (u.orderKind === 'attackmove' || u.isPvE) {
        // No enemy unit nearby: seek a city/lair to siege.
        const siege = this.rtsSiegeTarget(u);
        if (siege.city) { onCity = siege.city; tx = siege.city.x; ty = siege.city.y; reach = range + 80; }
        else if (siege.lair) { onLair = siege.lair; tx = siege.lair.x; ty = siege.lair.y; reach = range + 50; }
      }

      if (!onUnit && !onCity && !onLair) {
        if (u.status === 'fighting') u.status = 'marching';
        u.engaged = false;
        return;
      }

      u.engaged = true;
      const dist = Math.hypot(tx - u.x, ty - u.y);
      if (dist > reach) {
        // Chase: steer straight toward the target (aggro range is short).
        u.status = 'marching';
        this.stepToward(u, tx, ty, this.rtsSpeed(u.type) * this.trailSpeedBonus(u.x, u.y));
        return;
      }

      // In range: hold and strike on cadence.
      u.status = 'fighting';
      const interval = GameRoom.RTS_ATTACK_INTERVAL[u.type] ?? 12;
      if (this.state.tick - u.lastCombatTick < interval) return;
      u.lastCombatTick = this.state.tick;
      if (onUnit) {
        onUnit.health = Math.max(0, onUnit.health - this.calcDamage(u, onUnit));
        if (onUnit.health <= 0) { this.awardKillGold(u, onUnit); dead.push(onUnit.id); }
      } else if (onCity) {
        const dmg = Math.max(1, Math.floor(TROOP_STATS[u.type]?.attack ?? 5));
        onCity.health = Math.max(0, onCity.health - dmg);
        if (onCity.health <= 0) this.conquerCity(onCity, u.isPvE ? 'pve' : u.ownerId);
      } else if (onLair) {
        const dmg = Math.max(1, Math.floor((TROOP_STATS[u.type]?.attack ?? 5) * 0.5));
        onLair.health = Math.max(0, onLair.health - dmg);
        if (onLair.health <= 0) {
          const bounty = onLair.type === 'spider' ? SPIDER_BOUNTY : GOBLIN_BOUNTY;
          const killer = this.state.players.get(u.ownerId);
          if (killer) { killer.wood += bounty.wood; killer.food += bounty.food; killer.gold += bounty.gold; }
          onLair.respawnAtTick = this.state.tick + LAIR_RESPAWN_TICKS;
        }
      }
    });
    dead.forEach(id => {
      const u = this.state.units.get(id);
      if (u && !u.isPvE) this.refundPop(u.ownerId);
      this.state.units.delete(id);
    });
  }

  // Minimal RTS bot behaviour: once a bot has a small warband of idle troops,
  // send them on an attack-move to the nearest enemy/neutral city. (Recruiting
  // and economy are still handled by the shared processAI.)
  private rtsBotCommand(): void {
    this.state.players.forEach(p => {
      if (!p.isBot) return;
      const idle: UnitNode[] = [];
      this.state.units.forEach(u => {
        if (u.ownerId !== p.id || u.type === 'villager' || u.health <= 0) return;
        if (u.engaged || u.orderKind === 'attackmove' || u.tx >= 0) return; // already busy/moving
        idle.push(u);
      });
      if (idle.length < 4) return; // muster a warband before attacking
      let cx = 0, cy = 0; idle.forEach(u => { cx += u.x; cy += u.y; }); cx /= idle.length; cy /= idle.length;
      let best: CityNode | undefined, bestD = Infinity;
      this.state.cities.forEach(c => {
        if (c.ownerId === p.id) return;
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best) this.issueMoveOrder(p.id, idle.map(u => u.id), best.x, best.y, 'box', 'attackmove');
    });
  }

  /** Nearest living enemy (different owner) non-villager unit within `radius`. */
  private rtsNearestEnemyUnit(u: UnitNode, radius: number): UnitNode | null {
    let best: UnitNode | null = null, bestD = radius;
    this.state.units.forEach(o => {
      if (o.ownerId === u.ownerId || o.type === 'villager' || o.health <= 0) return;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < bestD) { bestD = d; best = o; }
    });
    return best;
  }

  /** A siege target for an attack-moving/PvE unit: an enemy/neutral city (PvE
   *  hunts its assigned city across the map; players siege what's near), else a
   *  living lair nearby. */
  private rtsSiegeTarget(u: UnitNode): { city?: CityNode; lair?: LairNode } {
    if (u.isPvE) {
      const target = u.targetNodeId && this.state.cities.get(u.targetNodeId);
      if (target && target.health > 0) return { city: target };
      // fall back to nearest player-held city
      let best: CityNode | undefined, bestD = Infinity;
      this.state.cities.forEach(c => {
        if (!c.ownerId || c.ownerId === 'pve') return;
        const d = Math.hypot(c.x - u.x, c.y - u.y);
        if (d < bestD) { bestD = d; best = c; }
      });
      return { city: best };
    }
    // Player attack-move: siege the nearest enemy/neutral city within aggro.
    let bestCity: CityNode | undefined, bestCityD = GameRoom.RTS_AGGRO_PX + 160;
    this.state.cities.forEach(c => {
      if (c.ownerId === u.ownerId) return;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < bestCityD) { bestCityD = d; bestCity = c; }
    });
    if (bestCity) return { city: bestCity };
    let bestLair: LairNode | undefined, bestLairD = GameRoom.RTS_AGGRO_PX;
    this.state.lairs.forEach(l => {
      if (l.health <= 0) return;
      const d = Math.hypot(l.x - u.x, l.y - u.y);
      if (d < bestLairD) { bestLairD = d; bestLair = l; }
    });
    return { lair: bestLair };
  }

  // Free-movement speed (px/tick) per unit type. Knights are a touch heavier.
  private rtsSpeed(type: string): number {
    switch (type) {
      case 'knight': return 3.4;
      case 'lancer': return 4.6;
      case 'archer': return 4.0;
      case 'monk': return 3.6;
      case 'goblin': return 4.2;
      case 'spider': return 4.0;
      default: return 4.0;
    }
  }

  // Advance every non-villager unit toward its destination (cached A* waypoints),
  // then gently separate overlapping units so they don't stack into one blob.
  private rtsMoveUnits(): void {
    if (!this.nav) return;
    const movers: UnitNode[] = [];
    this.state.units.forEach(u => {
      if (u.type === 'villager' || u.health <= 0) return;
      // Engaged units are steered by combat (chase/hold); others follow commands.
      if (!u.engaged && u.tx >= 0) this.rtsStepAlongPath(u);
      movers.push(u);
    });
    this.rtsSeparate(movers);
  }

  private rtsStepAlongPath(u: UnitNode): void {
    const speed = this.rtsSpeed(u.type) * this.trailSpeedBonus(u.x, u.y);
    if (u.navStep < u.navPath.length) {
      const wp = u.navPath[u.navStep];
      this.stepToward(u, wp.x, wp.y, speed);
      if (Math.hypot(wp.x - u.x, wp.y - u.y) < 20) u.navStep++;
      return;
    }
    // Final approach straight to the exact target (slides around plateaus).
    this.stepToward(u, u.tx, u.ty, speed);
    if (Math.hypot(u.tx - u.x, u.ty - u.y) < 12) {
      u.tx = -1; u.ty = -1; u.navPath = []; u.navStep = 0;
      u.orderKind = ''; // arrived — idle (combat may re-acquire)
    }
  }

  // Boids-lite: push apart units closer than a min spacing, never onto a blocked
  // tile (water/cliff). O(n²) over combat units — unit counts stay modest.
  private rtsSeparate(units: UnitNode[]): void {
    const MIN = 26;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d === 0) { dx = 1; dy = 0; d = 1; }
        if (d >= MIN) continue;
        const push = (MIN - d) / 2, ux = dx / d, uy = dy / d;
        this.rtsNudge(a, -ux * push, -uy * push);
        this.rtsNudge(b, ux * push, uy * push);
      }
    }
  }

  private rtsNudge(u: UnitNode, dx: number, dy: number): void {
    if (!this.nav) { u.x += dx; u.y += dy; return; }
    const t = this.nav.worldToTile(u.x + dx, u.y + dy);
    if (!this.nav.isBlocked(t.c, t.r)) { u.x += dx; u.y += dy; }
  }

  // Speed multiplier when standing on a worn footpath.
  private trailSpeedBonus(x: number, y: number): number {
    if (!this.nav) return 1;
    const t = this.nav.worldToTile(x, y);
    return this.state.trails.has(String(t.r * this.nav.cols + t.c)) ? GameRoom.TRAIL_SPEED_MULT : 1;
  }

  // Role rank for formation layering: melee take the front slots, ranged/support
  // settle into the back rows (lower number = nearer the front, toward the foe).
  private static ROLE_RANK: Record<string, number> = { knight: 0, lancer: 1, archer: 2, monk: 3 };

  // Formation slots in *local* space: `lx` = lateral (right of heading), `ly` =
  // depth (+ = toward the move target / front), `rank` = row from the front
  // (0 = front line). The caller rotates these onto the move heading and assigns
  // melee to the low-rank (front) slots.
  private formationSlots(n: number, formation: string): { lx: number; ly: number; rank: number }[] {
    const S = 46, out: { lx: number; ly: number; rank: number }[] = [];
    if (formation === 'line') {
      for (let i = 0; i < n; i++) out.push({ lx: (i - (n - 1) / 2) * S, ly: 0, rank: 0 });
      return out;
    }
    if (formation === 'wedge') {
      // Arrowhead: a 1-wide tip at the front, each rank behind it one pair wider.
      let placed = 0, r = 0;
      while (placed < n) {
        const inRow = Math.min(r * 2 + 1, n - placed);
        for (let c = 0; c < inRow; c++) { out.push({ lx: (c - (inRow - 1) / 2) * S, ly: 0, rank: r }); placed++; }
        r++;
      }
      const rows = r;
      out.forEach(s => { s.ly = (rows - 1 - s.rank) * S * 0.9; });
      const meanLy = out.reduce((a, s) => a + s.ly, 0) / out.length;
      out.forEach(s => { s.ly -= meanLy; });
      return out;
    }
    // box (compact square) or vanguard (wide + shallow → a clear front/back split)
    const cols = formation === 'vanguard'
      ? Math.max(2, Math.ceil(n / 2))
      : Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      out.push({ lx: (c - (cols - 1) / 2) * S, ly: ((rows - 1) / 2 - r) * S, rank: r });
    }
    return out;
  }

  // Issue a move/attack-move order: orient a role-layered formation along the
  // move heading (front rows toward the target), then A* a path to each slot.
  private issueMoveOrder(ownerId: string, ids: string[], x: number, y: number, formation: string, kind: string): void {
    if (!this.nav) return;
    const units = (ids || [])
      .map(id => this.state.units.get(id))
      .filter((u): u is UnitNode => !!u && u.ownerId === ownerId && u.type !== 'villager' && u.health > 0);
    if (units.length === 0) return;
    // Heading = from the group's centre toward the destination (default: "up").
    let cx = 0, cy = 0; units.forEach(u => { cx += u.x; cy += u.y; }); cx /= units.length; cy /= units.length;
    let hx = x - cx, hy = y - cy; const hl = Math.hypot(hx, hy);
    if (hl < 1) { hx = 0; hy = -1; } else { hx /= hl; hy /= hl; }
    const right = { x: hy, y: -hx };
    const slots = this.formationSlots(units.length, formation);
    // Melee to the front slots, ranged/support to the back.
    const sortedUnits = [...units].sort((a, b) => (GameRoom.ROLE_RANK[a.type] ?? 9) - (GameRoom.ROLE_RANK[b.type] ?? 9));
    const sortedSlots = [...slots].sort((a, b) => a.rank - b.rank);
    sortedUnits.forEach((u, i) => {
      const s = sortedSlots[i];
      const dx = s.lx * right.x + s.ly * hx;
      const dy = s.lx * right.y + s.ly * hy;
      this.rtsSetDestination(u, x + dx, y + dy, kind);
    });
  }

  private rtsSetDestination(u: UnitNode, x: number, y: number, kind: string): void {
    if (!this.nav) return;
    x = Math.max(16, Math.min(this.state.mapWidth - 16, x));
    y = Math.max(16, Math.min(this.state.mapHeight - 16, y));
    u.tx = x; u.ty = y; u.orderKind = kind; u.repathTick = this.state.tick;
    const s = this.nav.worldToTile(u.x, u.y);
    const g = this.nav.worldToTile(x, y);
    const path = this.nav.findPath(s.c, s.r, g.c, g.r);
    u.navPath = path ? path.map(t => this.nav!.tileCenter(t.c, t.r)) : [];
    u.navStep = 0;
  }

  // ─── Economy ────────────────────────────────────────────────

  private processEconomy(): void {
    const income = new Map<string, { w: number; f: number; g: number; pop: number }>();
    // Count each empire's cities first so extra cities can yield diminishing
    // passive income (anti-snowball; villager gathering stays at full value).
    const cityCount = new Map<string, number>();
    this.state.cities.forEach(c => {
      if (c.ownerId && this.state.players.has(c.ownerId)) cityCount.set(c.ownerId, (cityCount.get(c.ownerId) || 0) + 1);
    });
    this.state.cities.forEach(city => {
      if (!city.ownerId || !this.state.players.has(city.ownerId)) return;
      const acc = income.get(city.ownerId) || { w: 0, f: 0, g: 0, pop: 10 };
      // Diminishing-returns factor: the nth city of an empire trickles less.
      const n = cityCount.get(city.ownerId) || 1;
      const factor = Math.max(CITY_DIMINISH_FLOOR, 1 - (n - 1) * CITY_DIMINISH_STEP);
      // Small town-hall trickle; the real income comes from villagers
      acc.w += city.townHallLevel * factor;
      acc.f += city.townHallLevel * 0.5 * factor;
      acc.g += city.townHallLevel * 0.25 * factor;
      this.buildingsOf(city.id).forEach(b => {
        if (b.type === 'house') acc.pop += 5;
      });
      income.set(city.ownerId, acc);
    });
    // Held gold mines pour a steady stream into the owner's coffers — a strong,
    // readable comeback faucet for a player who's been pushed off their cities.
    this.state.objectives.forEach(obj => {
      if (obj.kind !== 'mine' || !obj.ownerId || !this.state.players.has(obj.ownerId)) return;
      const acc = income.get(obj.ownerId) || { w: 0, f: 0, g: 0, pop: 10 };
      acc.g += OBJ_MINE_GOLD;
      acc.w += OBJ_MINE_WOOD;
      income.set(obj.ownerId, acc);
    });
    this.state.players.forEach(player => {
      const acc = income.get(player.id);
      if (!acc) { player.populationCap = this.isRts ? 40 : 10; return; }
      let { w, f, g } = acc;
      if (player.hasTech('prod_wood')) w *= 1.5;
      if (player.hasTech('prod_food')) f *= 1.5;
      if (player.hasTech('prod_gold')) g *= 1.5;
      // Resources stay fractional server-side; the UI floors for display
      player.wood += w;
      player.food += f;
      player.gold += g;
      // Open Field fields larger armies — a higher base cap on top of houses.
      player.populationCap = this.isRts ? acc.pop + 30 : acc.pop;
      // Bots don't micro villagers, so a flat stipend keeps them building and
      // producing; difficulty scales the income (easy poorer, hard richer).
      if (player.isBot) { const m = this.aiCfg().econ; player.wood += 7 * m; player.food += 6 * m; player.gold += 4 * m; }
    });
  }

  private processAutoProduce(): void {
    this.state.buildings.forEach(b => {
      const makes = PRODUCES[b.type];
      if (!makes || !b.autoProduceType) return;
      if (!makes.includes(b.autoProduceType)) { b.autoProduceType = ''; return; } // not trainable here
      if (this.state.tick < b.produceReadyTick) return; // recruit cooldown gates the cadence
      const city = this.state.cities.get(b.cityId);
      if (!city || !city.ownerId) { b.autoProduceType = ''; return; }
      const player = this.state.players.get(city.ownerId);
      if (!player) { b.autoProduceType = ''; return; }
      this.trySpawnTroop(player, b, b.autoProduceType); // sets produceReadyTick on success
    });
  }

  // ─── AI opponents ───────────────────────────────────────────
  // A lightweight bot empire: build production, auto-train a balanced army,
  // rally toward the nearest enemy/neutral fort, and upgrade when flush.
  private processAI(): void {
    const cfg = this.aiCfg();
    const cycle = Math.floor(this.state.tick / AI_INTERVAL_TICKS);
    // A smart bot adapts its barracks output to counter the enemy's main unit.
    const counter = cfg.smart ? this.botCounterUnit() : '';
    this.state.players.forEach(bot => {
      if (!bot.isBot || bot.eliminated) return;
      if (cfg.slow && cycle % 2 === 1) return; // easy bots think at half speed
      this.state.cities.forEach(city => {
        if (city.ownerId !== bot.id) return;
        const builds = this.buildingsOf(city.id);
        const has = (t: string) => builds.some(b => b.type === t);
        // Build order: barracks → archery → house → church.
        if (builds.length < city.maxBuildings) {
          if (!has('barracks')) this.botBuild(bot, city, 'barracks');
          else if (!has('archery')) this.botBuild(bot, city, 'archery');
          else if (!has('house')) this.botBuild(bot, city, 'house');
          else if (!has('church')) this.botBuild(bot, city, 'church');
        }
        // Keep producers training an army. A smart bot biases the barracks toward
        // whatever beats the enemy's dominant melee unit; archers always flow.
        const bar = builds.find(b => b.type === 'barracks');
        if (bar) {
          if (counter === 'knight' || counter === 'lancer') bar.autoProduceType = counter;
          else if (!bar.autoProduceType) bar.autoProduceType = Math.random() < 0.5 ? 'knight' : 'lancer';
        }
        const arc = builds.find(b => b.type === 'archery');
        if (arc && !arc.autoProduceType) arc.autoProduceType = 'archer';
        // Hold troops home to defend a threatened fort, else push to a good target.
        if (cfg.smart && this.botThreatened(city)) city.rallyRoadId = '';
        else this.botSetRally(bot, city, cfg.smart);
        // Upgrade the keep when it can comfortably afford it (sooner on hard).
        if (city.townHallLevel < 3 && bot.gold > city.townHallLevel * 50 + cfg.upgradeBuffer) {
          bot.gold -= city.townHallLevel * 50;
          city.townHallLevel++;
          this.recomputeInfluence(city);
          city.maxBuildings = (this.isRts ? 12 : 2) + (city.townHallLevel - 1) * 2;
          city.maxHealth = 1000 + (city.townHallLevel - 1) * 500;
          city.health = city.maxHealth;
        }
      });
    });
  }

  // The unit type that best counters the enemy's most common combat unit, so a
  // smart bot fields a composition that punishes whatever it's facing.
  private botCounterUnit(): string {
    const counts: Record<string, number> = { knight: 0, lancer: 0, archer: 0 };
    this.state.units.forEach(u => {
      const p = this.state.players.get(u.ownerId);
      if (!p || p.isBot || u.type === 'villager') return; // count human/neutral foes
      if (counts[u.type] !== undefined) counts[u.type]++;
    });
    let top = '', n = 0;
    for (const t of ['knight', 'lancer', 'archer']) if (counts[t] > n) { n = counts[t]; top = t; }
    const counter: Record<string, string> = { archer: 'knight', knight: 'lancer', lancer: 'archer' };
    return n > 0 ? counter[top] : '';
  }

  // A fort is threatened if it's taking damage or an enemy is parked on it.
  private botThreatened(city: CityNode): boolean {
    if (city.health < city.maxHealth * 0.96) return true;
    let siege = false;
    this.state.units.forEach(u => {
      if (siege || u.type === 'villager' || u.ownerId === city.ownerId) return;
      if (u.atNodeId === city.id) siege = true;
    });
    return siege;
  }

  private botBuild(bot: Player, city: CityNode, type: BuildingType): void {
    const cost = BUILDING_COSTS[type];
    if (bot.wood < cost.wood || bot.food < cost.food || bot.gold < cost.gold) return;
    bot.wood -= cost.wood; bot.food -= cost.food; bot.gold -= cost.gold;
    const { x, y } = this.findBuildSpot(city, this.buildingsOf(city.id).length);
    const bId = nextId('bld');
    this.state.buildings.set(bId, new BuildingNode(bId, city.id, type, x, y));
    this.recomputeInfluence(city);
  }

  private botSetRally(bot: Player, city: CityNode, smart = false): void {
    const exits = [...this.state.roads.values()].filter(r => r.fromId === city.id);
    if (exits.length === 0) return;
    let target: CityNode | null = null;
    if (smart) {
      // Prefer the nearest neutral fort to expand cheaply; otherwise pick the
      // weakest enemy fort (low HP, slight distance penalty) to finish it off.
      let neutral: CityNode | null = null, nD = Infinity, enemy: CityNode | null = null, eScore = Infinity;
      this.state.cities.forEach(c => {
        if (c.ownerId === bot.id) return;
        const d = Math.hypot(c.x - city.x, c.y - city.y);
        if (!c.ownerId || c.ownerId === 'pve') { if (d < nD) { nD = d; neutral = c; } }
        else { const score = c.health + d * 0.15; if (score < eScore) { eScore = score; enemy = c; } }
      });
      target = neutral || enemy;
    } else {
      let bestD = Infinity;
      this.state.cities.forEach(c => {
        if (c.ownerId === bot.id) return;
        const d = Math.hypot(c.x - city.x, c.y - city.y);
        if (d < bestD) { bestD = d; target = c; }
      });
    }
    if (!target) return;
    const t = target as CityNode;
    const tx = t.x - city.x, ty = t.y - city.y, tl = Math.hypot(tx, ty) || 1;
    let best = exits[0], bestDot = -Infinity;
    for (const r of exits) {
      const dest = this.getNodePos(r.toId); if (!dest) continue;
      const dx = dest.x - city.x, dy = dest.y - city.y, dl = Math.hypot(dx, dy) || 1;
      const dot = (tx / tl) * (dx / dl) + (ty / tl) * (dy / dl);
      if (dot > bestDot) { bestDot = dot; best = r; }
    }
    city.rallyRoadId = best.id;
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
      if (!this.isRts && !lair.roadId) return;

      // Don't flood the map: each lair keeps a small standing warband
      let alive = 0;
      this.state.units.forEach(u => { if (u.isPvE && u.type === lair.type) alive++; });
      if (alive >= PVE_MAX_ALIVE_PER_LAIR) return;

      const targetCityId = lair.type === 'spider'
        ? this.findResourceHoardingCity('food')
        : this.findResourceHoardingCity('gold');
      if (!targetCityId) return;

      const count = 2 + Math.floor(Math.random() * 2);
      const power = this.state.npcPower || 1;
      if (this.isRts) {
        // Free-movement spawn: pop out around the lair, hunt the target city.
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2, rad = 30 + Math.random() * 24;
          const unit = new UnitNode(nextId('pve'), 'pve', lair.type, '');
          unit.x = lair.x + Math.cos(ang) * rad;
          unit.y = lair.y + Math.sin(ang) * rad;
          unit.originNodeId = lair.id;
          unit.targetNodeId = targetCityId;
          if (power !== 1) { unit.maxHealth = Math.round(unit.maxHealth * power); unit.health = unit.maxHealth; }
          this.state.units.set(unit.id, unit);
        }
        return;
      }
      const slots = this.slotsOf(lair.roadId);
      for (let i = 0; i < count; i++) {
        if (!this.isSlotFree(lair.roadId, i)) continue; // tile taken
        const unit = new UnitNode(nextId('pve'), 'pve', lair.type, lair.roadId);
        unit.originNodeId = lair.id;
        unit.targetNodeId = targetCityId;
        unit.t = i / slots; // one per tile, marching out in file
        if (power !== 1) { unit.maxHealth = Math.round(unit.maxHealth * power); unit.health = unit.maxHealth; }
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
      // Work-song minigame boost (1.0 … 1.2) speeds movement and gathering alike.
      const boost = player.villagerBoost || 1;
      vSpeed *= boost;

      // RTS: a pawn dispatched to a construction site walks there and channels
      // it (processBuildSites credits progress while it stands adjacent).
      if (this.isRts && unit.status === 'building' && unit.buildTargetId) {
        const site = this.state.buildings.get(unit.buildTargetId);
        if (!site || !site.constructing) { unit.status = 'marching'; unit.buildTargetId = ''; }
        else { if (Math.hypot(site.x - unit.x, site.y - unit.y) > 40) this.stepToward(unit, site.x, site.y + 22, vSpeed); return; }
      }

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
        let bestScore = -Infinity;
        this.state.resources.forEach(r => {
          if (r.type !== unit.resourceType || r.amount <= 0) return;
          if (home && Math.hypot(r.x - home.x, r.y - home.y) > VILLAGER_SEARCH_RADIUS) return;
          const d = Math.hypot(r.x - unit.x, r.y - unit.y);
          // Woodcutters favour the biggest trees (most wood), lightly weighing
          // distance; other gatherers just take the nearest node.
          const score = unit.resourceType === 'tree' ? (r.amount - d * 0.15) : -d;
          if (score > bestScore) { bestScore = score; best = r; }
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
        const take = Math.min(3 * boost, target.amount, VILLAGER_CARRY_CAP - unit.carrying);
        unit.carrying += take;
        target.amount -= take;
        // Everything regrows now: sheep + gold via processSheepRegen, trees
        // reset to saplings via processTreeGrowth — depleted gold deposits stay
        // on the map at 0 and slowly refill rather than vanishing for good.
        if (target.amount <= 0) {
          if (target.type === 'gold') { unit.targetResourceId = ''; }
          else if (target.type === 'tree') { target.age = 0; unit.targetResourceId = ''; } // chopped → sapling
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
      } else if (r.type === 'gold' && r.amount < r.maxAmount) {
        r.amount = Math.min(r.maxAmount, r.amount + GOLD_REGEN_AMOUNT); // veins slowly refill
      }
    });
  }

  /** Trees age and regrow in place: the older a tree, the more wood it holds
   *  (its cap rises with age), so a long-standing forest yields more. A freshly
   *  chopped tree is reset to a sapling (age 0) and grows back over time. */
  private processTreeGrowth(): void {
    this.state.resources.forEach(r => {
      if (r.type !== 'tree') return;
      if (r.age < TREE_AGE_CAP) r.age++;
      const cap = 40 + r.age * 3;        // sapling 40 → old growth 160
      r.maxAmount = cap;
      if (r.amount < cap) r.amount = Math.min(cap, r.amount + 2);
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
      // Reactive orders: hold braces in place; fallback retreats homeward (even
      // out of a fight); push/'' marches normally.
      if (unit.order === 'hold') continue;
      const retreating = unit.order === 'fallback';
      if (retreating) this.faceHome(unit);
      if (!retreating && (unit.status === 'fighting' || unit.status === 'sieging' || unit.status === 'defending')) continue;
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
          const nextRoad = retreating ? this.findRetreatRoad(unit, targetId) : this.findNextRoad(unit, road, targetId);
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

    // A retreating army stops to garrison the moment it reaches a friendly fort
    // (order cleared); if the fort isn't mine, keep routing homeward instead.
    if (unit.order === 'fallback') {
      if (city.ownerId === unit.ownerId) { unit.order = ''; unit.t = 1; unit.status = 'defending'; unit.atNodeId = cityId; return; }
      const next = this.findRetreatRoad(unit, cityId);
      if (next) { unit.roadId = next.id; unit.t = 0; unit.originNodeId = cityId; unit.roadsCrossed++; return; }
      unit.order = '';
    }

    if (city.ownerId === unit.ownerId) {
      // Friendly/captured fort: defend if it's under siege, otherwise march on
      // through toward the front. At a dead-end spur, turn back instead of
      // despawning so troops keep patrolling rather than vanishing.
      const besiegers = this.unitsAtNode(cityId).filter(u => u.ownerId !== unit.ownerId);
      if (besiegers.length > 0) {
        unit.t = 1; unit.status = 'defending'; unit.atNodeId = cityId;
        return;
      }
      const road = this.state.roads.get(unit.roadId);
      let next = road ? this.findNextRoad(unit, road, cityId) : null;
      if (!next && road) next = this.state.roads.get(this.reverseRoad.get(road.id) || '') || null;
      if (next) {
        unit.roadId = next.id; unit.t = 0; unit.originNodeId = cityId; unit.roadsCrossed++;
      } else {
        toRemove.push(unit.id); this.refundPop(unit.ownerId);
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

    // No waypoint set: fan units out to cover as many roads as possible.
    // Rank the exits straightest-first, then hand them out round-robin per
    // player so consecutive units take different roads (the first carries
    // straight on, the next peels off, …). Never wander into a lair.
    const nonLair = outgoing.filter(r => !this.state.lairs.has(r.toId));
    const candidates = nonLair.length > 0 ? nonLair : outgoing;
    if (candidates.length <= 1) return candidates[0];
    const from = this.getNodePos(current.fromId);
    const here = this.getNodePos(nodeId);
    const ranked = [...candidates];
    if (from && here) {
      const travelAngle = Math.atan2(here.y - from.y, here.x - from.x);
      const deviation = (r: Road): number => {
        const dest = this.getNodePos(r.toId);
        if (!dest) return Math.PI;
        let diff = Math.abs(Math.atan2(dest.y - here.y, dest.x - here.x) - travelAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff;
      };
      ranked.sort((a, b) => deviation(a) - deviation(b));
    }
    const key = `${nodeId}:${unit.ownerId}`;
    const cursor = this.spreadCursor.get(key) ?? 0;
    this.spreadCursor.set(key, cursor + 1);
    return ranked[cursor % ranked.length];
  }

  // ─── Lane army orders (reactive command) ────────────────────
  // A "lane army" = one player's non-villager units on one physical road
  // (both directions share a pairKey). Reuses the processCombat grouping idea.
  private unitsOnLane(roadId: string, ownerId: string): UnitNode[] {
    const lane = this.pairKey(roadId);
    const out: UnitNode[] = [];
    this.state.units.forEach(u => {
      if (u.ownerId === ownerId && u.type !== 'villager' && !u.atNodeId && this.pairKey(u.roadId) === lane) out.push(u);
    });
    return out;
  }

  /** The player's own city nearest the given unit (for homeward retreat). */
  private nearestOwnedCity(unit: UnitNode): CityNode | null {
    const here = this.unitWorldPos(unit);
    let best: CityNode | null = null, bestD = Infinity;
    this.state.cities.forEach(c => {
      if (c.ownerId !== unit.ownerId) return;
      const d = Math.hypot(c.x - here.x, c.y - here.y);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  }

  /** Turn a falling-back unit around so its road points homeward (one-shot). */
  private faceHome(unit: UnitNode): void {
    const road = this.state.roads.get(unit.roadId);
    const home = this.nearestOwnedCity(unit);
    if (!road || !home) return;
    const toPos = this.getNodePos(road.toId), fromPos = this.getNodePos(road.fromId);
    if (!toPos || !fromPos) return;
    // If the road's start is closer to home than its end, the enemy is ahead —
    // flip onto the reverse road so advancing now carries the army homeward.
    if (Math.hypot(fromPos.x - home.x, fromPos.y - home.y) < Math.hypot(toPos.x - home.x, toPos.y - home.y)) {
      const rev = this.reverseRoad.get(unit.roadId);
      if (rev) { unit.roadId = rev; unit.t = 1 - unit.t; unit.originNodeId = road.toId; }
    }
  }

  /** At a node, the outgoing road whose far end is nearest the unit's home. */
  private findRetreatRoad(unit: UnitNode, nodeId: string): Road | null {
    const home = this.nearestOwnedCity(unit);
    const reverseId = this.reverseRoad.get(unit.roadId);
    let best: Road | null = null, bestD = Infinity;
    this.state.roads.forEach(r => {
      if (r.fromId !== nodeId || r.id === reverseId) return;
      if (this.state.lairs.has(r.toId)) return;
      const p = this.getNodePos(r.toId);
      if (!p || !home) return;
      const d = Math.hypot(p.x - home.x, p.y - home.y);
      if (d < bestD) { bestD = d; best = r; }
    });
    return best || this.state.roads.get(reverseId || '') || null;
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
    // Blows land on the beat so combat reads rhythmically with the march/music.
    const onBeat = this.state.tick % MOVE_BEAT_TICKS === 0;

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

          const aReady = onBeat && this.state.tick - a.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          const bReady = onBeat && this.state.tick - b.lastCombatTick >= COMBAT_COOLDOWN_TICKS;
          // A unit only stops to fight when it can actually strike; one that's
          // being shot from afar keeps advancing until it's in melee range.
          if (aCanHit) {
            if (!a.atNodeId) a.status = 'fighting';
            if (aReady) { b.health = Math.max(0, b.health - this.calcDamage(a, b)); a.lastCombatTick = this.state.tick; if (b.health <= 0) this.awardKillGold(a, b); }
          }
          if (bCanHit) {
            if (!b.atNodeId) b.status = 'fighting';
            if (bReady) { a.health = Math.max(0, a.health - this.calcDamage(b, a)); b.lastCombatTick = this.state.tick; if (a.health <= 0) this.awardKillGold(b, a); }
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
    } else {
      base *= (this.state.npcPower || 1); // NPC power scales enemy damage
    }

    // Counter triangle: knight > archer > lancer > knight. A favourable matchup
    // hits ~1.5x, an unfavourable one ~0.7x, so unit composition matters.
    if (RPS_ADVANTAGE[attacker.type] === defender.type) base *= 1.5;
    else if (RPS_ADVANTAGE[defender.type] === attacker.type) base *= 0.7;

    // A held shrine empowers all of the holder's troops in battle.
    if (!attacker.isPvE && this.holdsShrine(attacker.ownerId)) base *= OBJ_SHRINE_DAMAGE_MULT;

    // Rally commander ability: a rallied attacker hits harder for a few beats
    // (the multiplier was set by the cast's rhythm accuracy).
    if (!attacker.isPvE && attacker.rallyBuffUntil > this.state.tick) base *= attacker.rallyBuffMult;

    // Armour soaks damage; the attacker's penetration ignores a fraction of it.
    // Knights (high armour) shrug off arrows; lancers (high pen) punch through.
    const armor = (dStats?.armor ?? 0) * (1 - aStats.armorPen);
    let dmg = base - armor;

    // Anti-snowball: attackers weaken with distance, defenders near home resist
    dmg *= Math.max(0.5, 1.0 - attacker.distanceTraveled * 0.10);
    if (defender.status === 'defending' || defender.distanceTraveled < 0.5) dmg *= 0.85;
    // A braced army on Hold soaks more — the reward for standing firm.
    if (defender.order === 'hold') dmg *= HOLD_BRACE_MULT;
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

  // ─── Contested objectives ───────────────────────────────────
  // Capture-and-hold camps on the central lanes. A side captures by being the
  // only military presence nearby (tug-of-war meter); two rival sides freeze it
  // (contested). A defender parking a couple of units denies the leader without
  // having to out-army them — that's the anti-snowball lever.
  private processObjectives(): void {
    if (this.state.objectives.size === 0) return;
    const onBeat = this.state.tick % MOVE_BEAT_TICKS === 0;

    // Tally military presence near each objective, per owning side.
    const near = new Map<string, Map<string, number>>();
    this.state.units.forEach(u => {
      if (u.type === 'villager' || u.health <= 0) return;
      const side = u.isPvE ? 'pve' : u.ownerId;
      if (!side) return;
      const pos = this.unitWorldPos(u);
      this.state.objectives.forEach(obj => {
        if (Math.hypot(obj.x - pos.x, obj.y - pos.y) > OBJ_CAPTURE_RADIUS) return;
        let m = near.get(obj.id);
        if (!m) { m = new Map(); near.set(obj.id, m); }
        m.set(side, (m.get(side) || 0) + 1);
      });
    });

    this.state.objectives.forEach(obj => {
      // Merc camps gift the holder a free unit on a timer (any tick).
      if (obj.kind === 'merc' && obj.ownerId && this.state.players.has(obj.ownerId)
          && this.state.tick - obj.lastSpawnTick >= OBJ_MERC_INTERVAL) {
        if (this.spawnMercenary(obj.ownerId)) obj.lastSpawnTick = this.state.tick;
      }
      if (!onBeat) return;

      const m = near.get(obj.id);
      // Only real players contest objectives (PvE just denies, never captures).
      const playerSides = m ? [...m.keys()].filter(s => s !== 'pve' && this.state.players.has(s)) : [];
      const pvePresent = !!m && (m.get('pve') || 0) > 0;

      if (playerSides.length >= 2 || (playerSides.length === 1 && pvePresent && playerSides[0] !== obj.ownerId)) {
        // Two empires (or an empire vs lurking monsters at a neutral camp) → standoff.
        obj.contested = true;
        return;
      }
      obj.contested = false;

      if (playerSides.length === 1) {
        const side = playerSides[0];
        const count = m!.get(side) || 1;
        if (side === obj.ownerId) {
          // The owner is standing on it — settle the meter back to a clean hold.
          obj.capture = 0; obj.contenderId = '';
        } else {
          // A single challenger pushes the capture meter toward themselves.
          if (obj.contenderId !== side) { obj.contenderId = side; obj.capture = 0; }
          obj.capture += OBJ_CAPTURE_RATE + Math.min(3, count - 1) * 2;
          if (obj.capture >= OBJ_CAPTURE_THRESHOLD) {
            obj.ownerId = side; obj.capture = 0; obj.contenderId = '';
          }
        }
      } else {
        // Nobody present — the meter bleeds back toward neutral; long-abandoned
        // unheld progress fades, but an owned camp stays owned until contested.
        if (obj.capture > 0) obj.capture = Math.max(0, obj.capture - OBJ_DECAY_RATE);
        if (obj.capture === 0) obj.contenderId = '';
      }
    });
  }

  // A merc camp's gift: a free unit dropped into the holder's army at their
  // capital, joining the rally flow. Rotates type so it stays composition-neutral.
  private spawnMercenary(ownerId: string): boolean {
    const player = this.state.players.get(ownerId);
    if (!player) return false;
    const city = this.state.cities.get(player.connectedCityId)
      || [...this.state.cities.values()].find(c => c.ownerId === ownerId);
    if (!city) return false;
    const exits = [...this.state.roads.values()].filter(r => r.fromId === city.id);
    const targetRoad = exits.find(r => r.id === city.rallyRoadId) || exits[0];
    if (!targetRoad || !this.isSlotFree(targetRoad.id, 0)) return false;
    const types = ['knight', 'archer', 'lancer'];
    const type = types[(this.state.tick / OBJ_MERC_INTERVAL | 0) % types.length];
    const unit = new UnitNode(nextId('merc'), ownerId, type, targetRoad.id);
    unit.originNodeId = city.id;
    // Mercs are free of resources but still count as army population, so the
    // population bookkeeping (refundPop on death) stays balanced.
    player.populationUsed += 1;
    if (player.hasTech('hp_all')) { unit.maxHealth = Math.floor(unit.maxHealth * 1.2); unit.health = unit.maxHealth; }
    this.state.units.set(unit.id, unit);
    return true;
  }

  /** Does this player currently hold any shrine? (cheap — few objectives). */
  private holdsShrine(ownerId: string): boolean {
    for (const obj of this.state.objectives.values()) {
      if (obj.kind === 'shrine' && obj.ownerId === ownerId) return true;
    }
    return false;
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
      const claimed = !!city.ownerId && this.state.players.has(city.ownerId);
      // Neutral forts are garrisoned too: they loose arrows at any military unit
      // that strays into range. A sentinel "owner" no real unit shares means
      // archersShoot treats everyone (PvE and players alike) as a target.
      const defId = claimed ? city.ownerId : '__neutral__';
      const owner = claimed ? this.state.players.get(city.ownerId) : undefined;
      const techMul = owner?.hasTech('dmg_archer') ? 1.25 : 1;
      // The fortress-top archers are a weak last-ditch defence: 50% of a normal
      // field archer's punch. Dedicated defense towers keep their full bite.
      const capitalDmg = Math.max(1, Math.round(TROOP_STATS.archer.attack * 0.5 * techMul));
      const towerDmg = ARCHER_DEF_DMG * techMul;
      // Archer count scales with castle level: L1 one, L2 two, L3+ three.
      const archerShots = claimed ? Math.max(1, Math.min(3, city.townHallLevel)) : 1;
      this.archersShoot(city.x, city.y, defId, archerShots, capitalDmg);  // weak last-ditch archers
      if (claimed) this.buildingsOf(city.id).forEach(b => {              // towers need an owner to exist
        if (b.type === 'defense_tower') this.archersShoot(b.x, b.y, defId, 1, towerDmg); // tower: 1
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
      const armor = (TROOP_STATS[t.type]?.armor ?? 0) * 0.5; // fort archers punch through ~half the armour (knights aren't immune)
      t.health = Math.max(0, t.health - Math.max(1, Math.floor(dmg - armor)));
      if (t.health <= 0) {
        if (!t.isPvE) this.refundPop(t.ownerId);
        else { const p = this.state.players.get(ownerId); if (p) p.gold += PVE_KILL_GOLD; } // bounty to the defending player
        this.state.units.delete(t.id);
      }
    }
  }

  // A slain monster drops a little gold to the player who killed it.
  private awardKillGold(killer: UnitNode, victim: UnitNode): void {
    if (!victim.isPvE || killer.isPvE) return;
    const p = this.state.players.get(killer.ownerId);
    if (p) p.gold += PVE_KILL_GOLD;
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
    city.maxBuildings = this.isRts ? 12 : 2;
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

    // The defender's pawns flee the fallen fort, running to their nearest other
    // fort (where they re-home and resume gathering). If they have nowhere to
    // run, they'll be cleared when their empire is eliminated below.
    if (oldOwnerId) {
      const refuge = [...this.state.cities.values()].filter(c => c.ownerId === oldOwnerId && c.id !== city.id);
      if (refuge.length > 0) {
        this.state.units.forEach(u => {
          if (u.type !== 'villager' || u.ownerId !== oldOwnerId || u.homeCityId !== city.id) return;
          let best = refuge[0], bestD = Infinity;
          refuge.forEach(c => { const d = Math.hypot(c.x - u.x, c.y - u.y); if (d < bestD) { bestD = d; best = c; } });
          u.homeCityId = best.id;
          u.targetResourceId = ''; // re-acquire resources near the new home
          u.status = 'marching';
        });
      }
    }

    this.checkVictory();
  }

  // Conquest victory: a player is alive while they hold at least one city.
  // Losing your last city eliminates you; the last empire standing wins.
  private checkVictory(): void {
    if (this.state.phase !== 'active') return;
    const cityCount = new Map<string, number>();
    this.state.cities.forEach(c => { if (c.ownerId) cityCount.set(c.ownerId, (cityCount.get(c.ownerId) || 0) + 1); });
    this.state.players.forEach(p => {
      if (!p.eliminated && (cityCount.get(p.id) || 0) === 0) {
        p.eliminated = true;
        const rm: string[] = [];
        this.state.units.forEach(u => { if (u.ownerId === p.id) rm.push(u.id); });
        rm.forEach(id => this.state.units.delete(id));
        // Release any camps the fallen empire held back to neutral.
        this.state.objectives.forEach(o => { if (o.ownerId === p.id) { o.ownerId = ''; o.capture = 0; o.contenderId = ''; } });
      }
    });
    const alive = [...this.state.players.values()].filter(p => !p.eliminated && (cityCount.get(p.id) || 0) > 0);
    if (alive.length <= 1) {
      this.state.phase = 'finished';
      this.state.winnerId = alive.length === 1 ? alive[0].id : '';
      if (this.tickInterval) clearInterval(this.tickInterval);
    }
  }

  // ─── Support ────────────────────────────────────────────────

  private processMonkHealing(): void {
    const monks: UnitNode[] = [];
    this.state.units.forEach(u => { if (u.type === 'monk' && !u.isPvE) monks.push(u); });
    if (monks.length === 0) return;

    monks.forEach(monk => {
      let healedAny = false;
      this.state.units.forEach(other => {
        if (other.id === monk.id || other.ownerId !== monk.ownerId) return;
        if (other.health >= other.maxHealth) return;
        const near = this.isRts
          ? Math.hypot(other.x - monk.x, other.y - monk.y) <= 90 // free-position proximity
          : monk.atNodeId
            ? other.atNodeId === monk.atNodeId
            : this.pairKey(other.roadId) === this.pairKey(monk.roadId)
              && Math.abs(this.pairPos(other) - this.pairPos(monk)) <= 0.06;
        if (near) { other.health = Math.min(other.maxHealth, other.health + 5); healedAny = true; }
      });
      // Stamp the heal tick so the client can play the channel anim + effect.
      if (healedAny) monk.healingTick = this.state.tick;
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

  // Influence (and thus build range) grows with the town-hall level and with
  // every building/tower the player raises — a bigger settlement projects
  // further. Towers may be placed out to 1.3× this radius.
  private recomputeInfluence(city: CityNode): void {
    city.influenceRadius = 150 + (city.townHallLevel - 1) * 40 + this.buildingsOf(city.id).length * 16;
  }
}
