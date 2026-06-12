import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string')
  id: string = '';

  @type('string')
  name: string = 'unnamed';

  @type('string')
  colorHex: string = '#4488ff';

  @type('number')
  wood: number = 100;

  @type('number')
  food: number = 50;

  @type('number')
  gold: number = 20;

  @type('number')
  populationUsed: number = 0;

  @type('number')
  populationCap: number = 10;

  @type('string')
  connectedCityId: string = '';

  // Track last tick resource was applied to avoid double-generation
  lastEconomyTick: number = 0;

  constructor(id: string, name: string, colorHex: string) {
    super();
    this.id = id;
    this.name = name;
    this.colorHex = colorHex;
  }

  get buildingSlots(): number {
    return 2; // All players get 2 building slots per city initially
  }
}
