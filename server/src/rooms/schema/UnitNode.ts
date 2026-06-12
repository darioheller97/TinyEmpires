import { Schema, type } from '@colyseus/schema';

export const TROOP_TYPES = ['knight', 'lancer', 'archer', 'monk'] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

// RPS classification
export const RPS_CLASS: Record<TroopType, string> = {
  knight: 'knight',
  lancer: 'lancer',
  archer: 'archer',
  monk: 'monk',
};

// RPS advantage: attacker → defender
export const RPS_ADVANTAGE: Record<string, string> = {
  knight: 'archer',   // knights are strong against archers
  lancer: 'knight',   // lancers are strong against knights
  archer: 'lancer',   // archers are strong against lancers
};

export interface TroopStats {
  health: number;
  speed: number;      // t-increment per tick on the road
  attack: number;
  foodCost: number;
  goldCost: number;
  range: number;      // for archers
  healAmount: number; // for monks
}

export const TROOP_STATS: Record<TroopType, TroopStats> = {
  knight:  { health: 120, speed: 0.008, attack: 15, foodCost: 20, goldCost: 5,  range: 30,  healAmount: 0 },
  lancer:  { health: 100, speed: 0.012, attack: 12, foodCost: 15, goldCost: 0,  range: 35,  healAmount: 0 },
  archer:  { health: 70,  speed: 0.010, attack: 10, foodCost: 15, goldCost: 5,  range: 80,  healAmount: 0 },
  monk:    { health: 80,  speed: 0.007, attack: 3,  foodCost: 25, goldCost: 10, range: 40,  healAmount: 5 },
};

export const TROOP_NAMES: Record<TroopType, string> = {
  knight: 'Knight',
  lancer: 'Lancer',
  archer: 'Archer',
  monk: 'Monk',
};

export class UnitNode extends Schema {
  @type('string')
  id: string = '';

  @type('string')
  ownerId: string = '';

  @type('string')
  type: string = 'knight';

  @type('string')
  roadId: string = '';

  // Position along the road spline, 0 = fromId, 1 = toId
  @type('number')
  t: number = 0;

  @type('number')
  health: number = 100;

  @type('number')
  maxHealth: number = 100;

  // The node we came from (prevents U-turns)
  @type('string')
  originNodeId: string = '';

  constructor(id: string, ownerId: string, type: TroopType, roadId: string) {
    super();
    this.id = id;
    this.ownerId = ownerId;
    this.type = type;
    this.roadId = roadId;
    this.t = 0;
    this.health = TROOP_STATS[type].health;
    this.maxHealth = TROOP_STATS[type].health;
  }
}
