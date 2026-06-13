import { Schema, type } from '@colyseus/schema';

/** A raised plateau / cliff region. Circular: blocks building placement and
 *  villager movement; rendered client-side as elevated grass with a cliff face. */
export class Elevation extends Schema {
  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('number')
  r: number = 0;

  constructor(x: number = 0, y: number = 0, r: number = 0) {
    super();
    this.x = x;
    this.y = y;
    this.r = r;
  }
}
