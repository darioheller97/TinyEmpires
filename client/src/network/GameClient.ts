import * as Colyseus from 'colyseus.js';

/**
 * Resolve the WebSocket endpoint:
 * - VITE_WS_URL env override wins
 * - dev: Vite serves the page on :3000, Colyseus runs on :2567
 * - prod: server serves the client, so connect back to the same origin
 *   (wss when the page is https, e.g. behind the TinyEmpires.icetea.me proxy)
 */
export function resolveWsUrl(): string {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  if (import.meta.env.DEV) return `ws://${window.location.hostname}:2567`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

export class GameClient {
  private client: Colyseus.Client;
  private room: Colyseus.Room | null = null;
  private onStateChangeCb: ((state: any) => void) | null = null;

  constructor(wsUrl: string = resolveWsUrl()) {
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

  setRoute(intersectionId: string, targetRoadId: string): void {
    this.room?.send('set_route', { intersectionId, targetRoadId });
  }

  setRally(cityId: string, roadId: string): void {
    this.room?.send('set_rally', { cityId, roadId });
  }

  buildStructure(cityId: string, type: string): void {
    this.room?.send('build_structure', { cityId, type });
  }

  placeTower(cityId: string, x: number, y: number): void {
    this.room?.send('place_tower', { cityId, x, y });
  }

  upgradeTownHall(cityId: string): void {
    this.room?.send('upgrade_town_hall', { cityId });
  }

  spawnTroops(cityId: string, type: string): void {
    this.room?.send('spawn_troops', { cityId, type });
  }

  spawnVillager(cityId: string, resourceType: string): void {
    this.room?.send('spawn_villager', { cityId, resourceType });
  }

  setAutoProduce(buildingId: string, troopType: string): void {
    this.room?.send('set_auto_produce', { buildingId, troopType });
  }

  researchTech(techId: string): void {
    this.room?.send('research_tech', { techId });
  }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
  }
}
