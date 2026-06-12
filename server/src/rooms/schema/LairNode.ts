import { Schema, type } from '@colyseus/schema';

export class LairNode extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') type: string = 'spider';
  @type('number') health: number = 500;
  @type('number') maxHealth: number = 500;

  // Tick tracking for spawn cycles
  lastSpawnTick: number = 0;
  spawnIntervalTicks: number = 150; // 15 seconds at 10Hz

  // When destroyed, the lair regrows after this tick
  respawnAtTick: number = 0;

  // Which road leads from the lair into the network
  roadId: string = '';

  constructor(id: string, x: number, y: number, type: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.type = type;
  }
}
