import Phaser from 'phaser';
import { autotileFrame } from './assets';

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
}

export interface TerrainInfo {
  grid: number[][]; // [row][col]: 0 water, 1 grass, 2 sand
  cols: number;
  rows: number;
  tile: number;
}

export const TILE = 64;
export const WATER = 0, GRASS = 1, SAND = 2;

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

  // ── Render ──
  const isLand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER;
  const isSand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === SAND;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * TILE, y = r * TILE;
      scene.add.image(x, y, 'water').setOrigin(0).setDepth(0);
      if (grid[r][c] === WATER) continue;
      const gFrame = autotileFrame('grass', isLand(r - 1, c), isLand(r + 1, c), isLand(r, c + 1), isLand(r, c - 1));
      scene.add.image(x, y, 'tiles', gFrame).setOrigin(0).setDepth(2);
      if (grid[r][c] === SAND) {
        const sFrame = autotileFrame('sand', isSand(r - 1, c), isSand(r + 1, c), isSand(r, c + 1), isSand(r, c - 1));
        scene.add.image(x, y, 'tiles', sFrame).setOrigin(0).setDepth(3);
      }
    }
  }

  // ── Foam along the coastline (animated, under the grass) ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === WATER) continue;
      const coastal = !isLand(r - 1, c) || !isLand(r + 1, c) || !isLand(r, c - 1) || !isLand(r, c + 1);
      if (!coastal || rng() > 0.6) continue;
      const p = cellCenter(c, r);
      scene.add.sprite(p.x, p.y, 'foam').setDepth(1).play({ key: 'foam_anim', startFrame: Math.floor(rng() * 8) });
    }
  }

  // ── Water rocks ──
  for (let i = 0; i < 10; i++) {
    const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
    if (grid[r][c] !== WATER) continue;
    const near = isLand(r - 1, c) || isLand(r + 1, c) || isLand(r, c - 1) || isLand(r, c + 1);
    if (near) continue;
    const p = cellCenter(c, r);
    scene.add.sprite(p.x, p.y, rng() < 0.5 ? 'rocks1' : 'rocks2')
      .setDepth(1).play({ key: rng() < 0.5 ? 'rocks1_anim' : 'rocks2_anim', startFrame: Math.floor(rng() * 8) });
  }

  // ── Mountains / plateaus (complete stamps from the elevation sheet) ──
  const stamps = [
    { x: 0, y: 0, w: 192, h: 192 },    // big plateau
    { x: 0, y: 256, w: 192, h: 128 },  // low plateau
    { x: 192, y: 0, w: 64, h: 192 },   // rock pillar
  ];
  const placed: { x: number; y: number }[] = [];
  const areaIsGrass = (px: number, py: number, w: number, h: number): boolean => {
    for (let y = py; y < py + h; y += TILE) {
      for (let x = px; x < px + w; x += TILE) {
        const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
        if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] !== GRASS) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < 60 && placed.length < 9; i++) {
    const stamp = stamps[Math.floor(rng() * stamps.length)];
    const px = Math.floor(rng() * (cols - 4)) * TILE;
    const py = Math.floor(rng() * (rows - 4)) * TILE;
    const center = { x: px + stamp.w / 2, y: py + stamp.h / 2 };
    if (!areaIsGrass(px, py, stamp.w, stamp.h)) continue;
    if (input.cities.some(n => Math.hypot(n.x - center.x, n.y - center.y) < 320)) continue;
    if (input.lairs.some(n => Math.hypot(n.x - center.x, n.y - center.y) < 220)) continue;
    if (input.resources.some(n => Math.hypot(n.x - center.x, n.y - center.y) < 130)) continue;
    if (placed.some(p => Math.hypot(p.x - center.x, p.y - center.y) < 320)) continue;
    placed.push(center);
    const img = scene.add.image(px - stamp.x, py - stamp.y, 'elevation').setOrigin(0);
    img.setCrop(stamp.x, stamp.y, stamp.w, stamp.h);
    img.setDepth(10 + (py + stamp.h) * 0.01);
  }

  // ── Scattered decorations (mushrooms, bushes, stones…) ──
  // Trees/sheep/gold come from server resource nodes, drawn by the scene.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c] !== GRASS || rng() > 0.05) continue;
    const p = cellCenter(c, r);
    if (input.cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 180)) continue;
    const idx = 1 + Math.floor(rng() * 18);
    const d = scene.add.image(p.x + (rng() - 0.5) * 30, p.y + (rng() - 0.5) * 30, `deco_${idx}`).setDepth(4);
    if (rng() < 0.25) d.setTint(0xf3cd7e); // autumn-tinted variety
  }

  return { grid, cols, rows, tile: TILE };
}
