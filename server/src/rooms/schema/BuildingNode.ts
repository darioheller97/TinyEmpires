import { Schema, type } from '@colyseus/schema';

// Resources are gathered by villagers from map nodes; city buildings are
// military/population only.
export const BUILDING_TYPES = ['house', 'barracks', 'archery', 'church', 'defense_tower'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const BUILDING_COSTS: Record<BuildingType, { wood: number; food: number; gold: number }> = {
  house: { wood: 25, food: 10, gold: 0 },
  barracks: { wood: 50, food: 20, gold: 10 },
  archery: { wood: 50, food: 15, gold: 15 },
  church: { wood: 45, food: 25, gold: 20 },
  defense_tower: { wood: 60, food: 15, gold: 20 },
};

export const BUILDING_NAMES: Record<BuildingType, string> = {
  house: 'House',
  barracks: 'Barracks',
  archery: 'Archery',
  church: 'Church',
  defense_tower: 'Defense Tower',
};

// Which troop types each production building can train.
export const PRODUCES: Record<string, string[]> = {
  barracks: ['knight', 'lancer'],
  archery: ['archer'],
  church: ['monk'],
};

/** The building type that can train a given troop. */
export function producerFor(troopType: string): string | null {
  for (const b of Object.keys(PRODUCES)) if (PRODUCES[b].includes(troopType)) return b;
  return null;
}

export class BuildingNode extends Schema {
  @type('string')
  id: string = '';

  @type('string')
  cityId: string = '';

  @type('string')
  type: string = 'lumber_mill';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('number')
  level: number = 1;

  @type('number')
  health: number = 200;

  @type('number')
  maxHealth: number = 200;

  // Barracks only: troop type to auto-produce ('' = off)
  @type('string')
  autoProduceType: string = '';

  lastAutoProduceTick: number = 0;

  constructor(id: string, cityId: string, type: BuildingType, x: number, y: number) {
    super();
    this.id = id;
    this.cityId = cityId;
    this.type = type;
    this.x = x;
    this.y = y;
  }
}
