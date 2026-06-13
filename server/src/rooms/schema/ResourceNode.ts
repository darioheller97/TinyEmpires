import { Schema, type } from '@colyseus/schema';

export type ResourceType = 'tree' | 'sheep' | 'gold';

export const HARVEST_RATE: Record<ResourceType, { wood: number; food: number; gold: number }> = {
  tree: { wood: 3, food: 0, gold: 0 },
  sheep: { wood: 0, food: 3, gold: 0 },
  gold: { wood: 0, food: 0, gold: 2 },
};

export class ResourceNode extends Schema {
  @type('string') id: string = '';
  @type('string') type: string = 'tree';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') amount: number = 100;
  @type('number') maxAmount: number = 100;

  constructor(id: string, type: ResourceType, x: number, y: number, amount: number) {
    super();
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.amount = amount;
    this.maxAmount = amount;
  }
}
