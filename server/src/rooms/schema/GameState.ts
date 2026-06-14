import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { Player } from './Player';
import { CityNode } from './CityNode';
import { IntersectionNode } from './IntersectionNode';
import { Road } from './Road';
import { LairNode } from './LairNode';
import { BuildingNode } from './BuildingNode';
import { UnitNode } from './UnitNode';
import { ResourceNode } from './ResourceNode';
import { ObjectiveNode } from './ObjectiveNode';
import { Elevation } from './Elevation';

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

  @type({ map: ResourceNode })
  resources = new MapSchema<ResourceNode>();

  // Contested mid-game camps (gold mine / mercenary camp / shrine).
  @type({ map: ObjectiveNode })
  objectives = new MapSchema<ObjectiveNode>();

  @type([Elevation])
  elevations = new ArraySchema<Elevation>();

  @type('number')
  tick: number = 0;

  @type('number')
  mapSeed: number = 0;

  @type('number')
  mapWidth: number = 1920;

  @type('number')
  mapHeight: number = 1216;

  // ── Lobby / match lifecycle ──
  // 'lobby'   : players gathering, picking colours, readying up (no sim).
  // 'active'  : match running (sim tick alive).
  // 'finished': someone won; client shows the end screen.
  @type('string') phase: string = 'lobby';
  @type('string') matchCode: string = '';
  @type('string') winnerId: string = '';

  // Host-chosen match settings (applied at start_match).
  @type('string') mapSize: string = 'medium';  // small | medium | large
  @type('number') npcCount: number = 2;         // number of lairs (0 = pure PvP)
  @type('number') npcAggro: number = 1;         // wave frequency / first-wave scaling
  @type('number') npcPower: number = 1;         // enemy HP/damage multiplier
  @type('string') aiLevel: string = 'normal';   // easy | normal | hard (rival AI skill)

  // Game mode: 'beat' = original rhythm/road-locked lane pusher;
  // 'rts' = real-time free-movement "Open Field" mode (units roam, build by sight).
  @type('string') gameMode: string = 'beat';     // beat | rts

  // Worn footpaths (RTS mode): tile index (r*cols+c) -> wear value above the
  // visible-path threshold. Carved by villager/pawn traffic; decays over time.
  @type({ map: 'number' }) trails = new MapSchema<number>();
}
