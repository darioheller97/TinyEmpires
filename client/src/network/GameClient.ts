import * as Colyseus from 'colyseus.js';

export class GameClient {
  private client: Colyseus.Client;
  private room: Colyseus.Room | null = null;
  private onStateChangeCb: ((state: any) => void) | null = null;

  constructor(wsUrl: string) {
    this.client = new Colyseus.Client(wsUrl);
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  async connect(): Promise<void> {
    this.room = await this.client.joinOrCreate('game_room', {});

    this.room.onStateChange((state) => {
      if (this.onStateChangeCb) {
        this.onStateChangeCb(state);
      }
    });

    this.room.onError((err) => {
      console.error('Room error:', err);
    });
  }

  onStateChange(cb: (state: any) => void): void {
    this.onStateChangeCb = cb;
  }

  setWaypoint(intersectionId: string, roadId: string, direction: number): void {
    if (this.room) {
      this.room.send('set_waypoint', { intersectionId, roadId, direction });
    }
  }

  setIntersectionWaypoint(intersectionId: string, incomingRoadId: string, direction: number): void {
    if (this.room) {
      this.room.send('set_intersection_waypoint', { intersectionId, incomingRoadId, direction });
    }
  }

  buildStructure(type: string): void {
    if (this.room) {
      this.room.send('build_structure', { type });
    }
  }

  upgradeTownHall(): void {
    if (this.room) {
      this.room.send('upgrade_town_hall', {});
    }
  }

  spawnTroops(type: string): void {
    if (this.room) {
      this.room.send('spawn_troops', { type });
    }
  }

  researchTech(techId: string): void {
    if (this.room) {
      this.room.send('research_tech', { techId });
    }
  }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
  }
}
