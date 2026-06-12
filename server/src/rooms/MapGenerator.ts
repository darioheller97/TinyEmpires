// Procedural map generation: cities scattered on an island, roads mostly
// direct city-to-city links, intersections only where roads geometrically
// cross (rare), lairs attached to the nearest city.

export interface GenNode { id: string; x: number; y: number; name: string; }
export interface GenLair extends GenNode { type: string; }
export interface GenEdge { a: string; b: string; via: { x: number; y: number }[]; }

export interface GeneratedMap {
  seed: number;
  width: number;
  height: number;
  cities: GenNode[];
  intersections: GenNode[];
  lairs: GenLair[];
  edges: GenEdge[];
}

const CITY_NAMES = [
  'Westwatch', 'Eastgate', 'Northhold', 'Southspire', 'Ravenkeep', 'Goldcrest',
  'Thornvale', 'Stonegard', 'Brighthelm', 'Duskmere', 'Ironreach', 'Fernshade',
];
const CROSS_NAMES = ["King's Cross", "Queen's Fork", 'Old Junction', 'Wayfarer Cross'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Proper interior intersection of segments p1-p2 and p3-p4. */
function segIntersect(p1: any, p2: any, p3: any, p4: any): { x: number; y: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0.12 || t > 0.88 || u < 0.12 || u > 0.88) return null; // keep clear of endpoints
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

export function generateMap(seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const width = 1920, height = 1216;
  const margin = 240;

  // ── Cities ──
  const cityCount = 4;
  const cities: GenNode[] = [];
  const namePool = [...CITY_NAMES];
  let attempts = 0;
  while (cities.length < cityCount && attempts++ < 400) {
    const p = {
      x: margin + rng() * (width - margin * 2),
      y: margin + rng() * (height - margin * 2),
    };
    if (cities.some(c => dist(c, p) < 480)) continue;
    const name = namePool.splice(Math.floor(rng() * namePool.length), 1)[0];
    cities.push({ id: `city_${cities.length}`, x: Math.round(p.x), y: Math.round(p.y), name });
  }

  // ── Edges: each city links to its 2 nearest neighbours ──
  const pairs = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  cities.forEach(c => {
    const sorted = cities.filter(o => o !== c).sort((a, b) => dist(c, a) - dist(c, b));
    sorted.slice(0, 2).forEach(o => pairs.add(pairKey(c.id, o.id)));
  });

  // Ensure the graph is connected
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  cities.forEach(c => parent.set(c.id, c.id));
  pairs.forEach(p => { const [a, b] = p.split('|'); parent.set(find(a), find(b)); });
  for (let i = 1; i < cities.length; i++) {
    if (find(cities[i].id) !== find(cities[0].id)) {
      // Connect the two closest cities across the components
      let best: [GenNode, GenNode] | null = null;
      let bestD = Infinity;
      cities.forEach(a => cities.forEach(b => {
        if (find(a.id) === find(b.id)) return;
        const d = dist(a, b);
        if (d < bestD) { bestD = d; best = [a, b]; }
      }));
      const b = best as [GenNode, GenNode] | null;
      if (b) {
        pairs.add(pairKey(b[0].id, b[1].id));
        parent.set(find(b[0].id), find(b[1].id));
      }
    }
  }

  // ── Lairs, attached to their nearest city ──
  const lairs: GenLair[] = [];
  const lairTypes = [
    { type: 'spider', name: 'Spider Cave' },
    { type: 'goblin', name: 'Goblin Stump' },
  ];
  attempts = 0;
  while (lairs.length < lairTypes.length && attempts++ < 400) {
    const p = {
      x: 140 + rng() * (width - 280),
      y: 140 + rng() * (height - 280),
    };
    if (cities.some(c => dist(c, p) < 380)) continue;
    if (lairs.some(l => dist(l, p) < 500)) continue;
    const lt = lairTypes[lairs.length];
    lairs.push({ id: `lair_${lt.type}`, x: Math.round(p.x), y: Math.round(p.y), name: lt.name, type: lt.type });
  }

  interface Seg { a: GenNode; b: GenNode; }
  const nodeById = new Map<string, GenNode>();
  cities.forEach(c => nodeById.set(c.id, c));
  lairs.forEach(l => nodeById.set(l.id, l));

  let segments: Seg[] = [...pairs].map(p => {
    const [a, b] = p.split('|');
    return { a: nodeById.get(a)!, b: nodeById.get(b)! };
  });
  lairs.forEach(l => {
    const nearest = [...cities].sort((a, b) => dist(l, a) - dist(l, b))[0];
    segments.push({ a: l, b: nearest });
  });

  // ── Intersections only where segments actually cross (rare) ──
  const intersections: GenNode[] = [];
  let crossNamePool = [...CROSS_NAMES];
  for (let guard = 0; guard < 3; guard++) {
    let found = false;
    outer:
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const s1 = segments[i], s2 = segments[j];
        if (s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) continue;
        const hit = segIntersect(s1.a, s1.b, s2.a, s2.b);
        if (!hit) continue;
        const node: GenNode = {
          id: `cross_${intersections.length}`,
          x: Math.round(hit.x), y: Math.round(hit.y),
          name: crossNamePool.splice(0, 1)[0] || 'Crossroads',
        };
        intersections.push(node);
        nodeById.set(node.id, node);
        segments.splice(j, 1);
        segments.splice(i, 1);
        segments.push({ a: s1.a, b: node }, { a: node, b: s1.b }, { a: s2.a, b: node }, { a: node, b: s2.b });
        found = true;
        break outer;
      }
    }
    if (!found) break;
  }

  // ── Gentle curves via perpendicular jitter ──
  const edges: GenEdge[] = segments.map(s => {
    const via: { x: number; y: number }[] = [];
    const len = dist(s.a, s.b);
    const nx = -(s.b.y - s.a.y) / len, ny = (s.b.x - s.a.x) / len;
    [0.35, 0.7].forEach(t => {
      const off = (rng() - 0.5) * Math.min(120, len * 0.25);
      via.push({
        x: Math.round(s.a.x + (s.b.x - s.a.x) * t + nx * off),
        y: Math.round(s.a.y + (s.b.y - s.a.y) * t + ny * off),
      });
    });
    return { a: s.a.id, b: s.b.id, via };
  });

  return { seed, width, height, cities, intersections, lairs, edges };
}
