import { Schema, type, ArraySchema } from '@colyseus/schema';

export class Waypoint extends Schema {
  @type('string')
  roadId: string = '';

  @type('number')
  direction: number = 0; // 0 = straight, -1 = left, 1 = right
}

export class IntersectionNode extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('string')
  name: string = 'Crossroads';

  @type({ array: Waypoint })
  waypoints = new ArraySchema<Waypoint>();

  constructor(id: string, x: number, y: number) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
  }
}
