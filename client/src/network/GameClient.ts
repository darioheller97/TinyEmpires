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

export interface MatchSettings {
  mapSize?: string;   // small | medium | large
  npcCount?: number;
  npcAggro?: number;
  npcPower?: number;
  aiLevel?: string;   // easy | normal | hard (rival AI skill)
}

// Friendly room code: no ambiguous 0/O/1/I. Must match the server charset.
function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class GameClient {
  private client: Colyseus.Client;
  private room: Colyseus.Room | null = null;
  private stateListeners: ((state: any) => void)[] = [];
  private onLeaveCb: (() => void) | null = null;

  constructor(wsUrl: string = resolveWsUrl()) {
    this.client = new Colyseus.Client(wsUrl);
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  get state(): any {
    return this.room?.state ?? null;
  }

  /** Host a new private lobby; returns the room code others type to join. */
  async createRoom(settings: MatchSettings = {}, name?: string): Promise<string> {
    const code = genCode();
    this.room = await this.client.joinOrCreate('game_room', { code, name, ...settings });
    this.attach();
    return code;
  }

  /** Join an existing lobby by its code. Throws if the code is invalid/full. */
  async joinByCode(code: string, name?: string): Promise<void> {
    this.room = await this.client.joinOrCreate('game_room', { code: code.toUpperCase(), name });
    this.attach();
  }

  /** Solo vs NPC: skips the lobby (server auto-readies + starts). */
  async createSolo(settings: MatchSettings = {}, name?: string): Promise<void> {
    const code = genCode();
    this.room = await this.client.joinOrCreate('game_room', { code, name, solo: true, ...settings });
    this.attach();
  }

  private attach(): void {
    if (!this.room) return;
    this.room.onStateChange((state) => { this.stateListeners.forEach(l => l(state)); });
    this.room.onError((code, message) => console.error('Room error:', code, message));
    this.room.onLeave(() => this.onLeaveCb?.());
  }

  // Multiple subscribers (React lobby + the Phaser scene) both listen.
  onStateChange(cb: (state: any) => void): void {
    this.stateListeners.push(cb);
    // Fire once immediately if state already exists (e.g. scene attaches late).
    if (this.room?.state) cb(this.room.state);
  }

  onLeave(cb: () => void): void { this.onLeaveCb = cb; }

  // ── Lobby messages ──
  selectColor(index: number): void { this.room?.send('select_color', { index }); }
  setReady(ready: boolean): void { this.room?.send('set_ready', { ready }); }
  setSettings(settings: MatchSettings): void { this.room?.send('set_settings', settings); }
  startMatch(): void { this.room?.send('start_match', {}); }

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
