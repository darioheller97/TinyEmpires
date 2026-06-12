import { Schema, type, ArraySchema } from '@colyseus/schema';

export class RoadPoint extends Schema {
  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;
}

export class Road extends Schema {
  @type('string')
  id: string = '';

  @type('string')
  fromId: string = ''; // node id

  @type('string')
  toId: string = ''; // node id

  @type({ array: RoadPoint })
  splinePoints = new ArraySchema<RoadPoint>();

  @type('number')
  length: number = 0;

  constructor(id: string, fromId: string, toId: string, splinePoints: { x: number; y: number }[]) {
    super();
    this.id = id;
    this.fromId = fromId;
    this.toId = toId;
    splinePoints.forEach(p => {
      const rp = new RoadPoint();
      rp.x = p.x;
      rp.y = p.y;
      this.splinePoints.push(rp);
    });
    this.length = splinePoints.length;
  }
}
