import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';
import { CityNode } from './CityNode';
import { IntersectionNode } from './IntersectionNode';
import { Road } from './Road';
import { LairNode } from './LairNode';
import { BuildingNode } from './BuildingNode';
import { UnitNode } from './UnitNode';

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

  @type({ map: BuildingNode })
  buildings = new MapSchema<BuildingNode>();

  @type({ map: UnitNode })
  units = new MapSchema<UnitNode>();

  @type('number')
  tick: number = 0;

  @type('number')
  mapSeed: number = 0;

  @type('number')
  mapWidth: number = 1920;

  @type('number')
  mapHeight: number = 1216;
}
