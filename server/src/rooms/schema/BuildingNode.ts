import { Schema, type } from '@colyseus/schema';

// Resources are gathered by villagers from map nodes; city buildings are
// military/population only.
export const BUILDING_TYPES = ['house', 'barracks', 'defense_tower'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const BUILDING_COSTS: Record<BuildingType, { wood: number; food: number; gold: number }> = {
  house: { wood: 25, food: 10, gold: 0 },
  barracks: { wood: 50, food: 20, gold: 10 },
  defense_tower: { wood: 60, food: 15, gold: 20 },
};

export const BUILDING_NAMES: Record<BuildingType, string> = {
  house: 'House',
  barracks: 'Barracks',
  defense_tower: 'Defense Tower',
};

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
