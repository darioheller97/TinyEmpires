import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { Player } from './Player';
import { CityNode } from './CityNode';
import { IntersectionNode } from './IntersectionNode';
import { Road } from './Road';
import { LairNode } from './LairNode';

export class GameState extends Schema {
  @type({ map: Player })
  players = new MapSchema<Player>();

  @type({ map: CityNode })
  cities = new MapSchema<CityNode>();

  @type({ map: IntersectionNode })
  intersections = new MapSchema<IntersectionNode>();

  @type({ map: Road })
  roads = new MapSchema<Road>();

  @type({ map: LairNode })
  lairs = new MapSchema<LairNode>();

  @type('number')
  tick: number = 0;
}
