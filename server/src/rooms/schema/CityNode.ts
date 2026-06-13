import { Schema, type, ArraySchema } from '@colyseus/schema';

export class CityNode extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('string')
  name: string = 'City';

  @type('string')
  ownerId: string = '';

  @type('number')
  townHallLevel: number = 1;

  @type('number')
  influenceRadius: number = 150;

  @type('number')
  health: number = 1000;

  @type('number')
  maxHealth: number = 1000;

  // Building slot limit increases with town hall level
  @type('number')
  maxBuildings: number = 2;

  // Preferred outgoing road for newly spawned troops ('' = first available)
  @type('string')
  rallyRoadId: string = '';

  constructor(id: string, x: number, y: number, name: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.name = name;
  }
}
