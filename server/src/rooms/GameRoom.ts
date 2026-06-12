import { Room, Client } from '@colyseus/core';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { CityNode } from './schema/CityNode';
import { IntersectionNode, Waypoint } from './schema/IntersectionNode';
import { Road } from './schema/Road';

const PLAYER_COLORS = ['#4488ff', '#ff4444', '#44ff44', '#ffaa00', '#ff44ff', '#44ffff'];

interface HardcodedNode {
  id: string;
  x: number;
  y: number;
  name: string;
}

interface HardcodedRoad {
  fromId: string;
  toId: string;
  via: { x: number; y: number }[];
}

// Hardcoded map: two cities connected by a road through one intersection
const MAP_CITIES: HardcodedNode[] = [
  { id: 'city_a', x: 300, y: 400, name: 'Red Keep' },
  { id: 'city_b', x: 1300, y: 400, name: 'Blue Citadel' },
];

const MAP_INTERSECTIONS: HardcodedNode[] = [
  { id: 'cross_1', x: 800, y: 400, name: "King's Cross" },
];

const MAP_ROADS: HardcodedRoad[] = [
  {
    fromId: 'city_a',
    toId: 'cross_1',
    via: [{ x: 550, y: 400 }],
  },
  {
    fromId: 'cross_1',
    toId: 'city_b',
    via: [{ x: 1050, y: 400 }],
  },
];

function buildSplinePoints(start: { x: number; y: number }, via: { x: number; y: number }[], end: { x: number; y: number }): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const all = [start, ...via, end];
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i];
    const b = all[i + 1];
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      points.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
    }
  }
  return points;
}

export class GameRoom extends Room<GameState> {
  maxClients = 10;
  private tickInterval!: ReturnType<typeof setInterval>;

  onCreate(options: any): void {
    console.log('GameRoom created!');
    this.setState(new GameState());
    this.initMap();

    // Game tick at 10 Hz (100ms)
    this.tickInterval = setInterval(() => this.gameTick(), 100);

    this.onMessage('set_waypoint', (client, message: { intersectionId: string; roadId: string; direction: number }) => {
      const intersection = this.state.intersections.get(message.intersectionId);
      if (!intersection) return;
      const existing = intersection.waypoints.find(wp => wp.roadId === message.roadId);
      if (existing) {
        existing.direction = message.direction;
      } else {
        const wp = new Waypoint();
        wp.roadId = message.roadId;
        wp.direction = message.direction;
        intersection.waypoints.push(wp);
      }
    });
  }

  private initMap(): void {
    MAP_CITIES.forEach((c) => {
      const city = new CityNode(c.id, c.x, c.y, c.name);
      this.state.cities.set(c.id, city);
    });

    MAP_INTERSECTIONS.forEach((is) => {
      const intersection = new IntersectionNode(is.id, is.x, is.y);
      this.state.intersections.set(is.id, intersection);
    });

    MAP_ROADS.forEach((r, i) => {
      const fromNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.fromId);
      const toNode = [...MAP_CITIES, ...MAP_INTERSECTIONS].find(n => n.id === r.toId);
      if (!fromNode || !toNode) return;

      const spline = buildSplinePoints(
        { x: fromNode.x, y: fromNode.y },
        r.via,
        { x: toNode.x, y: toNode.y }
      );
      const road = new Road(`road_${i}`, r.fromId, r.toId, spline);
      this.state.roads.set(road.id, road);
    });
  }

  onJoin(client: Client, options: any): void {
    console.log(`Player ${client.sessionId} joined.`);

    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    const player = new Player(client.sessionId, options.name || `Player ${this.state.players.size + 1}`, PLAYER_COLORS[colorIndex]);

    const unowned = [...this.state.cities.values()].find(c => !c.ownerId);
    if (unowned) {
      unowned.ownerId = client.sessionId;
      player.connectedCityId = unowned.id;
    }

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean): void {
    console.log(`Player ${client.sessionId} left.`);

    const player = this.state.players.get(client.sessionId);
    if (player && player.connectedCityId) {
      const city = this.state.cities.get(player.connectedCityId);
      if (city) {
        city.ownerId = '';
      }
    }

    this.state.players.delete(client.sessionId);
  }

  onDispose(): void {
    clearInterval(this.tickInterval);
    console.log('GameRoom disposed.');
  }

  private gameTick(): void {
    this.state.tick++;
  }
}
