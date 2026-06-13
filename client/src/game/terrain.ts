import Phaser from 'phaser';
import { autotileFrame, CLIFF_TOP, CLIFF_BOT } from './assets';

// Procedural terrain rendering: water everywhere, an organic grass island
// covering cities/roads/lairs, sand paths as roads, foam coastline, forests
// and decorations placed with the shared map seed (identical on all clients).

export interface TerrainInput {
  seed: number;
  width: number;
  height: number;
  cities: { x: number; y: number }[];
  lairs: { x: number; y: number }[];
  resources: { x: number; y: number }[];
  roadSplines: { x: number; y: number }[][]; // one per physical road
  elevations: { x: number; y: number; r: number }[]; // server-authored plateaus
}

export interface TerrainInfo {
  grid: number[][]; // [row][col]: 0 water, 1 grass, 2 sand, 3 elevated grass
  cols: number;
  rows: number;
  tile: number;
}

export const TILE = 64;
export const WATER = 0, GRASS = 1, SAND = 2, ELEV = 3;

// Pick a grass shade variant for a cell. Two overlapping low-frequency hashes
// give soft, non-grid-aligned meadow patches; the two greens dominate and the
// warmer shade is rare, so the field reads as varied rather than quilted.
function hash2(a: number, b: number): number {
  let h = (a * 73856093) ^ (b * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  return (h >>> 0);
}
function grassSheet(c: number, r: number): string {
  const v = (hash2(Math.floor(c / 5), Math.floor(r / 5))
    + hash2(Math.floor((c + 2) / 4), Math.floor((r + 3) / 4))) % 6;
  return v < 4 ? 'grass2' : v < 5 ? 'grass3' : 'grass1'; // ~67% / ~17% / ~17%
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTerrain(scene: Phaser.Scene, input: TerrainInput): TerrainInfo {
  const rng = mulberry32(input.seed);
  const cols = Math.ceil(input.width / TILE);
  const rows = Math.ceil(input.height / TILE);
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(WATER));
  const cellCenter = (c: number, r: number) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

  // ── Island: grass near cities, lairs, and along roads ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = cellCenter(c, r);
      const nearCity = input.cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 420);
      const nearLair = !nearCity && input.lairs.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 220);
      const nearRes = !nearCity && !nearLair && input.resources.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 180);
      const nearRoad = !nearCity && !nearLair && !nearRes && input.roadSplines.some(spline =>
        spline.some((sp, i) => i % 4 === 0 && Math.hypot(sp.x - p.x, sp.y - p.y) < 150));
      if (nearCity || nearLair || nearRes || nearRoad) grid[r][c] = GRASS;
    }
  }
  // Extra landmass blobs make the island shape less corridor-like
  const landCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] === GRASS) landCells.push([r, c]);
  for (let k = 0; k < 40 && landCells.length > 0; k++) {
    const [br, bc] = landCells[Math.floor(rng() * landCells.length)];
    const cr = br + Math.floor((rng() - 0.5) * 8);
    const cc = bc + Math.floor((rng() - 0.5) * 8);
    const rad = 1 + Math.floor(rng() * 3);
    for (let r = Math.max(1, cr - rad); r <= Math.min(rows - 2, cr + rad); r++) {
      for (let c = Math.max(1, cc - rad); c <= Math.min(cols - 2, cc + rad); c++) {
        if ((r - cr) ** 2 + (c - cc) ** 2 <= rad * rad && grid[r][c] === WATER) grid[r][c] = GRASS;
      }
    }
  }

  // Organic coastline: one randomized dilation pass
  const grown: [number, number][] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== WATER) continue;
      const touching = grid[r - 1][c] === GRASS || grid[r + 1][c] === GRASS || grid[r][c - 1] === GRASS || grid[r][c + 1] === GRASS;
      if (touching && rng() < 0.45) grown.push([r, c]);
    }
  }
  grown.forEach(([r, c]) => { grid[r][c] = GRASS; });

  // ── Sand roads along splines (kept 4-connected so tiles join up) ──
  const markSand = (r: number, c: number) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER) grid[r][c] = SAND;
  };
  input.roadSplines.forEach(spline => {
    let prev: { r: number; c: number } | null = null;
    spline.forEach(sp => {
      const c = Math.floor(sp.x / TILE), r = Math.floor(sp.y / TILE);
      markSand(r, c);
      // Diagonal step ⇒ bridge with an orthogonal neighbor, otherwise the
      // autotiler draws two disconnected path stubs
      if (prev && prev.r !== r && prev.c !== c) markSand(prev.r, c);
      prev = { r, c };
    });
  });
  // City plazas
  input.cities.forEach(n => {
    const c0 = Math.floor(n.x / TILE), r0 = Math.floor(n.y / TILE);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER) grid[r][c] = SAND;
    }
  });

  // ── Elevated plateaus (server-authored) bake into the grid as ELEV ──
  input.elevations.forEach(e => {
    const c0 = Math.floor((e.x - e.r) / TILE), c1 = Math.floor((e.x + e.r) / TILE);
    const r0 = Math.floor((e.y - e.r) / TILE), r1 = Math.floor((e.y + e.r) / TILE);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const p = cellCenter(c, r);
        // Only raise cells we already consider grass — never float on water/road
        if (grid[r][c] === GRASS && Math.hypot(p.x - e.x, p.y - e.y) <= e.r) grid[r][c] = ELEV;
      }
    }
  });

  // ── Render ──
  const isLand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER;
  const isSand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === SAND;
  const isElev = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === ELEV;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * TILE, y = r * TILE;
      scene.add.image(x, y, 'water_bg').setOrigin(0).setDepth(0);
      if (grid[r][c] === WATER) continue;
      const gFrame = autotileFrame('grass', isLand(r - 1, c), isLand(r + 1, c), isLand(r, c + 1), isLand(r, c - 1));
      // Plateau tops get a fixed deeper shade so they read as raised; flat grass
      // uses the patchy shade variants.
      const sheet = grid[r][c] === ELEV ? 'grass3' : grassSheet(c, r);
      scene.add.image(x, y, sheet, gFrame).setOrigin(0).setDepth(grid[r][c] === ELEV ? 6 : 2);
      if (grid[r][c] === SAND) {
        const sFrame = autotileFrame('sand', isSand(r - 1, c), isSand(r + 1, c), isSand(r, c + 1), isSand(r, c - 1));
        scene.add.image(x, y, 'tiles', sFrame).setOrigin(0).setDepth(3);
      }
    }
  }

  // ── Cliff faces on the south edge of each plateau (2 tiles tall) ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isElev(r, c) || isElev(r + 1, c)) continue; // only the southern rim
      const leftEnd = !isElev(r, c - 1), rightEnd = !isElev(r, c + 1);
      const part = leftEnd && rightEnd ? 'single' : leftEnd ? 'left' : rightEnd ? 'right' : 'mid';
      const x = c * TILE;
      scene.add.image(x, (r + 1) * TILE, 'grass3', CLIFF_TOP[part]).setOrigin(0).setDepth(5 + (r + 1) * TILE * 0.01);
      scene.add.image(x, (r + 2) * TILE, 'grass3', CLIFF_BOT[part]).setOrigin(0).setDepth(5 + (r + 2) * TILE * 0.01);
    }
  }

  // ── Animated foam on every coast tile (ocean and lakes alike) ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === WATER) continue;
      const coastal = !isLand(r - 1, c) || !isLand(r + 1, c) || !isLand(r, c - 1) || !isLand(r, c + 1);
      if (!coastal) continue;
      const p = cellCenter(c, r);
      scene.add.sprite(p.x, p.y, 'foam2').setDepth(1).play({ key: 'foam2_anim', startFrame: Math.floor(rng() * 16) });
    }
  }

  // ── Animated water rocks dotted across open water ──
  for (let i = 0; i < 26; i++) {
    const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
    if (grid[r][c] !== WATER) continue;
    const near = isLand(r - 1, c) || isLand(r + 1, c) || isLand(r, c - 1) || isLand(r, c + 1);
    if (near) continue;
    const p = cellCenter(c, r);
    const k = 1 + Math.floor(rng() * 4);
    scene.add.sprite(p.x, p.y, `wrock${k}`).setDepth(1).play({ key: `wrock${k}_anim`, startFrame: Math.floor(rng() * 16) });
  }

  // ── Scattered nature decorations (bushes, rocks, stumps) ──
  // Trees/sheep/gold come from server resource nodes, drawn by the scene.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((grid[r][c] !== GRASS && grid[r][c] !== ELEV) || rng() > 0.05) continue;
    const p = cellCenter(c, r);
    if (input.cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 170)) continue;
    const x = p.x + (rng() - 0.5) * 30, y = p.y + (rng() - 0.5) * 30;
    const roll = rng();
    if (roll < 0.55) {
      const k = 1 + Math.floor(rng() * 4);
      scene.add.sprite(x, y, `bush${k}`).setScale(0.5).setDepth(4).play({ key: `bush${k}_anim`, startFrame: Math.floor(rng() * 8) });
    } else if (roll < 0.85) {
      scene.add.image(x, y, `rock${1 + Math.floor(rng() * 4)}`).setDepth(4);
    } else {
      scene.add.image(x, y, `stump${1 + Math.floor(rng() * 4)}`).setScale(0.45).setOrigin(0.5, 0.7).setDepth(4);
    }
  }

  return { grid, cols, rows, tile: TILE };
}
