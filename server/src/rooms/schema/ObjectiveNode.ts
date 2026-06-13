import { Schema, type } from '@colyseus/schema';

// A contested mid-game objective: a neutral camp sitting on a busy lane that
// players capture by holding it (presence-based tug-of-war) and keep for a
// passive reward. Three flavours:
//   'mine'   — a steady trickle of gold to the holder (comeback economy)
//   'merc'   — periodically gifts the holder a free mercenary unit
//   'shrine' — grants the holder a global combat-damage buff while held
export class ObjectiveNode extends Schema {
  @type('string') id: string = '';
  @type('string') kind: string = 'mine';   // mine | merc | shrine
  @type('number') x: number = 0;
  @type('number') y: number = 0;

  // '' = neutral/unheld; otherwise the holding player's id.
  @type('string') ownerId: string = '';
  // Capture meter 0..100 toward the current sole contender; flips owner at 100.
  @type('number') capture: number = 0;
  // Who the meter is filling toward ('' = nobody / decaying).
  @type('string') contenderId: string = '';
  // True when two or more rival sides stand on it — the meter freezes.
  @type('boolean') contested: boolean = false;

  // Tick bookkeeping for merc-camp spawns (not synced).
  lastSpawnTick: number = 0;

  constructor(id: string, kind: string, x: number, y: number) {
    super();
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.y = y;
  }
}
