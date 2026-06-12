import { Schema, type } from '@colyseus/schema';

export class LairNode extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('string')
  type: string = 'spider'; // 'spider' or 'goblin'

  @type('number')
  health: number = 500;

  @type('number')
  maxHealth: number = 500;

  constructor(id: string, x: number, y: number, type: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.type = type;
  }
}
