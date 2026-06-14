import { Schema, type } from '@colyseus/schema';

export const TECH_TREE = [
  { id: 'dmg_knight', name: 'Knight Training', desc: '+25% Knight damage', cost: 50, category: 'unit' },
  { id: 'dmg_lancer', name: 'Lancer Training', desc: '+25% Lancer damage', cost: 50, category: 'unit' },
  { id: 'dmg_archer', name: 'Archer Training', desc: '+25% Archer damage', cost: 50, category: 'unit' },
  { id: 'hp_all', name: 'Veteran Armor', desc: '+20% all unit HP', cost: 80, category: 'unit' },
  { id: 'fast_recruit', name: 'War Drums', desc: 'Recruit units 20% faster', cost: 70, category: 'unit' },
  { id: 'speed', name: 'Paved Roads', desc: '+25% villager speed', cost: 60, category: 'economy' },
  { id: 'prod_wood', name: 'Iron Axes', desc: '+50% wood production', cost: 40, category: 'economy' },
  { id: 'prod_food', name: 'Crop Rotation', desc: '+50% food production', cost: 40, category: 'economy' },
  { id: 'prod_gold', name: 'Deep Mining', desc: '+50% gold production', cost: 40, category: 'economy' },
  { id: 'town_hall_discount', name: 'Royal Charter', desc: 'Town hall upgrades cost 30% less', cost: 100, category: 'economy' },
] as const;

export type TechId = (typeof TECH_TREE)[number]['id'];

export class Player extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = 'unnamed';
  @type('string') colorHex: string = '#4488ff';
  @type('number') wood: number = 100;
  @type('number') food: number = 90;
  @type('number') gold: number = 20;
  @type('number') populationUsed: number = 0;
  @type('number') populationCap: number = 10;
  @type('string') connectedCityId: string = '';
  // Lobby state
  @type('boolean') ready: boolean = false;
  @type('number') colorIndex: number = -1; // -1 = unassigned; index into PLAYER_COLORS
  @type('boolean') isHost: boolean = false;
  @type('boolean') eliminated: boolean = false;
  @type('boolean') isBot: boolean = false;
  // Tick the Rally commander ability becomes usable again (synced for the cooldown UI).
  @type('number') rallyReadyTick: number = 0;
  // Villager speed/gather multiplier (1..1.2) driven by the "work song" minigame.
  @type('number') villagerBoost: number = 1;
  lastEconomyTick: number = 0;

  // Tech flags (comma-separated string since Colyseus MapSchema is complex)
  @type('string')
  researchedTechs: string = '';

  constructor(id: string, name: string, colorHex: string) {
    super();
    this.id = id;
    this.name = name;
    this.colorHex = colorHex;
  }

  hasTech(techId: TechId): boolean {
    return this.researchedTechs.split(',').includes(techId);
  }

  addTech(techId: TechId): void {
    if (!this.hasTech(techId)) {
      const list = this.researchedTechs ? this.researchedTechs.split(',') : [];
      list.push(techId);
      this.researchedTechs = list.join(',');
    }
  }

  get buildingSlots(): number { return 2; }
}
