import { Schema, type, ArraySchema } from '@colyseus/schema';

// One route preference per player per intersection: "when my units pass
// through, send them down targetRoadId". Per-player so enemies can't
// grief each other's routing.
export class Waypoint extends Schema {
  @type('string')
  ownerId: string = '';

  @type('string')
  targetRoadId: string = '';
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

  constructor(id: string, x: number, y: number, name: string = 'Crossroads') {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.name = name;
  }
}
