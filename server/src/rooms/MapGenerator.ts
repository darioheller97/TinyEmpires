// Procedural map generation: cities scattered on an island, roads mostly
// direct city-to-city links, intersections only where roads geometrically
// cross (rare), lairs attached to the nearest city.

export interface GenNode { id: string; x: number; y: number; name: string; }
export interface GenLair extends GenNode { type: string; }
export interface GenEdge { a: string; b: string; via: { x: number; y: number }[]; }
export interface GenResource { id: string; type: 'tree' | 'sheep' | 'gold'; x: number; y: number; amount: number; }
export interface GenObjective { id: string; kind: 'mine' | 'merc' | 'shrine'; x: number; y: number; }

export interface GeneratedMap {
  seed: number;
  width: number;
  height: number;
  cities: GenNode[];
  intersections: GenNode[];
  lairs: GenLair[];
  edges: GenEdge[];
  resources: GenResource[];
  objectives: GenObjective[];
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

// Map-size presets. More cities than players gives neutral forts to capture.
const MAP_PRESETS: Record<string, { width: number; height: number; cities: number; spacing: number }> = {
  small:  { width: 3400, height: 2200, cities: 4, spacing: 880 },
  medium: { width: 4800, height: 3008, cities: 6, spacing: 1040 },
  large:  { width: 6400, height: 4000, cities: 8, spacing: 1180 },
};

export interface MapOpts { size?: string; npcCount?: number; }

export function generateMap(seed: number, opts: MapOpts = {}): GeneratedMap {
  const rng = mulberry32(seed);
  const preset = MAP_PRESETS[opts.size ?? 'medium'] ?? MAP_PRESETS.medium;
  const width = preset.width, height = preset.height;
  const margin = Math.round(width * 0.1);

  // ── Cities ──
  const cityCount = preset.cities;
  const cities: GenNode[] = [];
  const namePool = [...CITY_NAMES];
  let attempts = 0;
  while (cities.length < cityCount && attempts++ < 600) {
    const p = {
      x: margin + rng() * (width - margin * 2),
      y: margin + rng() * (height - margin * 2),
    };
    if (cities.some(c => dist(c, p) < preset.spacing)) continue;
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
  const wantLairs = Math.max(0, opts.npcCount ?? 2);
  attempts = 0;
  while (lairs.length < wantLairs && attempts++ < 800) {
    const p = {
      x: 300 + rng() * (width - 600),
      y: 300 + rng() * (height - 600),
    };
    if (cities.some(c => dist(c, p) < 800)) continue;
    if (lairs.some(l => dist(l, p) < 1000)) continue;
    const lt = lairTypes[lairs.length % lairTypes.length];
    const n = Math.floor(lairs.length / lairTypes.length);
    lairs.push({
      id: `lair_${lt.type}_${lairs.length}`, x: Math.round(p.x), y: Math.round(p.y),
      name: n > 0 ? `${lt.name} ${n + 1}` : lt.name, type: lt.type,
    });
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
  for (let guard = 0; guard < 24; guard++) {
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

  // ── Orthogonal routing: roads run straight, turning in coarse ~4-tile steps
  //    instead of a fine 1-up-1-right diagonal staircase. ──
  const STEP = 256; // 4 tiles per straight run before a turn
  const staircaseVia = (a: GenNode, b: GenNode): { x: number; y: number }[] => {
    const via: { x: number; y: number }[] = [];
    let x = a.x, y = a.y;
    const sx = Math.sign(b.x - x), sy = Math.sign(b.y - y);
    let guard = 0;
    while ((x !== b.x || y !== b.y) && guard++ < 500) {
      // Advance whichever axis is lagging behind the straight diagonal, so the
      // staircase hugs the direct line with long axis-aligned runs.
      const px = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x);
      const py = b.y === a.y ? 1 : (y - a.y) / (b.y - a.y);
      if (y === b.y || (px <= py && x !== b.x)) x += sx * Math.min(STEP, Math.abs(b.x - x));
      else y += sy * Math.min(STEP, Math.abs(b.y - y));
      if (x !== b.x || y !== b.y) via.push({ x: Math.round(x), y: Math.round(y) });
    }
    return via;
  };
  const edges: GenEdge[] = segments.map(s => ({ a: s.a.id, b: s.b.id, via: staircaseVia(s.a, s.b) }));

  // ── Resource nodes ──
  const resources: GenResource[] = [];
  let resId = 0;
  const distToSegment = (p: { x: number; y: number }, a: GenNode, b: GenNode): number => {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return dist(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
  };
  const clearOfRoads = (p: { x: number; y: number }, min: number) =>
    segments.every(s => distToSegment(p, s.a, s.b) >= min);
  const clearOfResources = (p: { x: number; y: number }, min: number) =>
    resources.every(r => Math.hypot(r.x - p.x, r.y - p.y) >= min);

  const addCluster = (cx: number, cy: number, type: GenResource['type'], count: number, spread: number, amount: number) => {
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < 12; a++) {
        const p = { x: cx + (rng() - 0.5) * spread * 2, y: cy + (rng() - 0.5) * spread * 1.6 };
        if (p.x < 120 || p.x > width - 120 || p.y < 120 || p.y > height - 120) continue;
        if (!clearOfRoads(p, 80) || !clearOfResources(p, 56)) continue;
        if (cities.some(c => dist(c, p) < 170)) continue;
        if (lairs.some(l => dist(l, p) < 150)) continue;
        resources.push({ id: `res_${resId++}`, type, x: Math.round(p.x), y: Math.round(p.y), amount });
        break;
      }
    }
  };

  // Around each city: a forest, a sheep flock, and a gold deposit to farm
  cities.forEach(c => {
    const baseAngle = rng() * Math.PI * 2;
    [0, 1, 2].forEach(k => {
      const angle = baseAngle + (k * Math.PI * 2) / 3 + (rng() - 0.5) * 0.5;
      const d = 230 + rng() * 130;
      const cx = c.x + Math.cos(angle) * d;
      const cy = c.y + Math.sin(angle) * d;
      if (k === 0) addCluster(cx, cy, 'tree', 6 + Math.floor(rng() * 4), 150, 120);
      if (k === 1) addCluster(cx, cy, 'sheep', 3 + Math.floor(rng() * 2), 110, 160);
      if (k === 2) addCluster(cx, cy, 'gold', 2, 90, 320);
    });
  });
  // Wild forests scattered across the map
  for (let i = 0; i < 16; i++) {
    const p = { x: 200 + rng() * (width - 400), y: 200 + rng() * (height - 400) };
    if (cities.some(c => dist(c, p) < 500)) continue;
    if (lairs.some(l => dist(l, p) < 300)) continue;
    addCluster(p.x, p.y, 'tree', 4 + Math.floor(rng() * 5), 180, 120);
    if (rng() < 0.3) addCluster(p.x + 150, p.y + 100, 'sheep', 2, 90, 160);
    if (rng() < 0.2) addCluster(p.x - 150, p.y - 100, 'gold', 1, 60, 320);
  }

  // ── Contested objectives: capture-and-hold camps on the busy central lanes ──
  // Sited at road-lane midpoints near the map centre so marching armies pass
  // right over them; the trailing player gets a comeback target and the leader
  // has to split forces to hold them.
  // Contested camps are disabled for now (the reward/capture code stays dormant).
  const objCount = 0;
  const OBJ_KINDS: GenObjective['kind'][] = ['mine', 'merc', 'shrine'];
  const objectives: GenObjective[] = [];
  const center = { x: width / 2, y: height / 2 };
  const objSpacing = preset.spacing * 0.55;
  const laneMidpoints = edges.map(e => {
    const a = nodeById.get(e.a)!, b = nodeById.get(e.b)!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Snap to the via point nearest the geometric midpoint = a real on-road spot.
    const pts = [...e.via, mid];
    return pts.reduce((p, q) => (dist(q, mid) < dist(p, mid) ? q : p), pts[0]);
  })
    .filter(p => cities.every(c => dist(c, p) >= 340) && lairs.every(l => dist(l, p) >= 300))
    .sort((p, q) => dist(p, center) - dist(q, center));
  for (const p of laneMidpoints) {
    if (objectives.length >= objCount) break;
    if (objectives.some(o => dist(o, p) < objSpacing)) continue;
    const kind = OBJ_KINDS[objectives.length % OBJ_KINDS.length];
    objectives.push({ id: `obj_${objectives.length}`, kind, x: Math.round(p.x), y: Math.round(p.y) });
  }

  return { seed, width, height, cities, intersections, lairs, edges, resources, objectives };
}

const TILE = 64;
export interface GenElevation { x: number; y: number; r: number; }

/**
 * Land/water grid — a faithful port of the client's island generation in
 * `client/src/game/terrain.ts` (must stay in sync so the server's elevation
 * placement lands on what the client also draws as grass). `true` = land.
 * Uses a FRESH mulberry32(seed) stream, exactly like the client.
 */
export function computeLandGrid(
  seed: number, width: number, height: number,
  cities: { x: number; y: number }[], lairs: { x: number; y: number }[],
  resources: { x: number; y: number }[], roadSplines: { x: number; y: number }[][],
): boolean[][] {
  const rng = mulberry32(seed);
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  const grid: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  const cc = (c: number, r: number) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = cc(c, r);
      const nearCity = cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 420);
      const nearLair = !nearCity && lairs.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 220);
      const nearRes = !nearCity && !nearLair && resources.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 180);
      const nearRoad = !nearCity && !nearLair && !nearRes && roadSplines.some(spline =>
        spline.some((sp, i) => i % 4 === 0 && Math.hypot(sp.x - p.x, sp.y - p.y) < 150));
      if (nearCity || nearLair || nearRes || nearRoad) grid[r][c] = true;
    }
  }
  // Landmass blobs (identical rng usage/order to the client)
  const landCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c]) landCells.push([r, c]);
  for (let k = 0; k < 40 && landCells.length > 0; k++) {
    const [br, bc] = landCells[Math.floor(rng() * landCells.length)];
    const cr = br + Math.floor((rng() - 0.5) * 8);
    const ccc = bc + Math.floor((rng() - 0.5) * 8);
    const rad = 1 + Math.floor(rng() * 3);
    for (let r = Math.max(1, cr - rad); r <= Math.min(rows - 2, cr + rad); r++) {
      for (let c = Math.max(1, ccc - rad); c <= Math.min(cols - 2, ccc + rad); c++) {
        if ((r - cr) ** 2 + (c - ccc) ** 2 <= rad * rad && !grid[r][c]) grid[r][c] = true;
      }
    }
  }
  // Coastline dilation (rng only when touching, matching the client short-circuit)
  const grown: [number, number][] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c]) continue;
      const touching = grid[r - 1][c] || grid[r + 1][c] || grid[r][c - 1] || grid[r][c + 1];
      if (touching && rng() < 0.45) grown.push([r, c]);
    }
  }
  grown.forEach(([r, c]) => { grid[r][c] = true; });
  return grid;
}

/** Place a handful of plateau discs on solid land, well clear of cities, roads,
 *  resources and each other. Separate rng stream so it can't desync the client. */
export function generateElevations(
  seed: number, grid: boolean[][],
  cities: { x: number; y: number }[], lairs: { x: number; y: number }[],
  resources: { x: number; y: number }[], roadSplines: { x: number; y: number }[][],
): GenElevation[] {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const rows = grid.length, cols = grid[0].length;
  const isLand = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c];
  const minRoadDist = (p: { x: number; y: number }) => {
    let m = Infinity;
    roadSplines.forEach(s => s.forEach((sp, i) => { if (i % 2 === 0) m = Math.min(m, Math.hypot(sp.x - p.x, sp.y - p.y)); }));
    return m;
  };
  // Require a solid land core around the centre; the client clips plateau edges
  // to its own grass cells, so partial-disc overhang into water just renders smaller.
  const coreLand = (c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!isLand(c + dc, r + dr)) return false;
    return true;
  };
  const out: GenElevation[] = [];
  for (let a = 0; a < 900 && out.length < 11; a++) {
    const rt = 2 + Math.floor(rng() * 2); // 2–3 tiles ⇒ 128–192px radius
    const c = 2 + Math.floor(rng() * (cols - 4));
    const r = 2 + Math.floor(rng() * (rows - 4));
    const p = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
    if (!coreLand(c, r)) continue;
    const rad = rt * TILE;
    if (cities.some(ci => Math.hypot(ci.x - p.x, ci.y - p.y) < 240)) continue;
    if (lairs.some(l => Math.hypot(l.x - p.x, l.y - p.y) < 200)) continue;
    if (resources.some(re => Math.hypot(re.x - p.x, re.y - p.y) < rad + 50)) continue;
    if (minRoadDist(p) < 95) continue; // sit beside roads, not on them
    if (out.some(e => Math.hypot(e.x - p.x, e.y - p.y) < e.r + rad + 70)) continue;
    out.push({ x: Math.round(p.x), y: Math.round(p.y), r: rad });
  }
  return out;
}
