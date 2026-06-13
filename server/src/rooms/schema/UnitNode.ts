import { Schema, type } from '@colyseus/schema';

export const TROOP_TYPES = ['knight', 'lancer', 'archer', 'monk'] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

// PvE enemy types
export const PVE_TYPES = ['goblin', 'spider'] as const;
export type PveType = (typeof PVE_TYPES)[number];

export const RPS_ADVANTAGE: Record<string, string> = {
  knight: 'archer', lancer: 'knight', archer: 'lancer',
};

export interface TroopStats {
  health: number; speed: number; attack: number; foodCost: number;
  goldCost: number; range: number; healAmount: number;
}

export const TROOP_STATS: Record<string, TroopStats> = {
  knight: { health: 120, speed: 0.008, attack: 15, foodCost: 20, goldCost: 5,  range: 30,  healAmount: 0 },
  lancer: { health: 100, speed: 0.012, attack: 12, foodCost: 15, goldCost: 0,  range: 35,  healAmount: 0 },
  archer: { health: 70,  speed: 0.010, attack: 10, foodCost: 15, goldCost: 5,  range: 80,  healAmount: 0 },
  monk:   { health: 80,  speed: 0.007, attack: 3,  foodCost: 25, goldCost: 10, range: 40,  healAmount: 5 },
  goblin: { health: 60,  speed: 0.012, attack: 8,  foodCost: 0,  goldCost: 0,  range: 25,  healAmount: 0 },
  spider: { health: 80,  speed: 0.010, attack: 10, foodCost: 0,  goldCost: 0,  range: 30,  healAmount: 0 },
  villager: { health: 40, speed: 0, attack: 0, foodCost: 15, goldCost: 0, range: 0, healAmount: 0 },
};

export const TROOP_NAMES: Record<string, string> = {
  knight: 'Knight', lancer: 'Lancer', archer: 'Archer', monk: 'Monk',
  goblin: 'Goblin', spider: 'Spider',
};

export type UnitStatus = 'marching' | 'fighting' | 'sieging' | 'defending';

export class UnitNode extends Schema {
  @type('string') id: string = '';
  @type('string') ownerId: string = '';
  @type('string') type: string = 'knight';
  @type('string') roadId: string = '';
  @type('number') t: number = 0;
  @type('number') health: number = 100;
  @type('number') maxHealth: number = 100;
  @type('string') originNodeId: string = '';
  @type('number') roadsCrossed: number = 0;
  // marching | fighting | sieging | defending — drives client animation
  @type('string') status: string = 'marching';
  // Node id a sieging/defending unit is parked at ('' while on the road)
  @type('string') atNodeId: string = '';

  // Free-position coordinates (villagers walk off-road)
  @type('number') x: number = 0;
  @type('number') y: number = 0;

  // Villagers: what they gather (synced so the client picks work animations)
  @type('string') resourceType: string = '';

  lastCombatTick: number = 0;
  // PvE units head for this city
  targetNodeId: string = '';
  // Villagers: home city, current target node
  homeCityId: string = '';
  targetResourceId: string = '';

  constructor(id: string, ownerId: string, type: string, roadId: string) {
    super();
    this.id = id;
    this.ownerId = ownerId;
    this.type = type;
    this.roadId = roadId;
    this.t = 0;
    const stats = TROOP_STATS[type];
    if (stats) { this.health = stats.health; this.maxHealth = stats.health; }
  }

  get distanceTraveled(): number {
    return this.roadsCrossed + this.t;
  }

  get isPvE(): boolean {
    return this.ownerId === 'pve';
  }
}
