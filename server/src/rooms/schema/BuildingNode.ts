import { Schema, type } from '@colyseus/schema';

export const BUILDING_TYPES = ['lumber_mill', 'farm', 'gold_mine', 'barracks', 'defense_tower'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const BUILDING_COSTS: Record<BuildingType, { wood: number; food: number; gold: number }> = {
  lumber_mill: { wood: 30, food: 5, gold: 0 },
  farm: { wood: 20, food: 0, gold: 0 },
  gold_mine: { wood: 40, food: 10, gold: 0 },
  barracks: { wood: 50, food: 20, gold: 10 },
  defense_tower: { wood: 60, food: 15, gold: 20 },
};

export const BUILDING_PRODUCTION: Record<BuildingType, { woodPerTick: number; foodPerTick: number; goldPerTick: number }> = {
  lumber_mill: { woodPerTick: 2, foodPerTick: 0, goldPerTick: 0 },
  farm: { woodPerTick: 0, foodPerTick: 3, goldPerTick: 0 },
  gold_mine: { woodPerTick: 0, foodPerTick: 0, goldPerTick: 1 },
  barracks: { woodPerTick: 0, foodPerTick: 0, goldPerTick: 0 },
  defense_tower: { woodPerTick: 0, foodPerTick: 0, goldPerTick: 0 },
};

export const BUILDING_NAMES: Record<BuildingType, string> = {
  lumber_mill: 'Lumber Mill',
  farm: 'Farm',
  gold_mine: 'Gold Mine',
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

  constructor(id: string, cityId: string, type: BuildingType, x: number, y: number) {
    super();
    this.id = id;
    this.cityId = cityId;
    this.type = type;
    this.x = x;
    this.y = y;
  }
}
