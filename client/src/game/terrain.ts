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
  roadSplines: { x: number; y: number }[][]; // one per physical road
}

const TILE = 64;
const WATER = 0, GRASS = 1, SAND = 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTerrain(scene: Phaser.Scene, input: TerrainInput): void {
  const rng = mulberry32(input.seed);
  const cols = Math.ceil(input.width / TILE);
  const rows = Math.ceil(input.height / TILE);
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(WATER));
  const cellCenter = (c: number, r: number) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

  // ── Island: grass near cities, lairs, and along roads ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = cellCenter(c, r);
      const nearCity = input.cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 280);
      const nearLair = input.lairs.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 190);
      const nearRoad = !nearCity && !nearLair && input.roadSplines.some(spline =>
        spline.some((sp, i) => i % 3 === 0 && Math.hypot(sp.x - p.x, sp.y - p.y) < 170));
      if (nearCity || nearLair || nearRoad) grid[r][c] = GRASS;
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

  // ── Sand roads along splines ──
  input.roadSplines.forEach(spline => {
    spline.forEach(sp => {
      const c = Math.floor(sp.x / TILE), r = Math.floor(sp.y / TILE);
      if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER) grid[r][c] = SAND;
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

  // ── Forests: clusters of swaying trees on open grass ──
  const grassCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c] !== GRASS) continue;
    // keep clear of city surroundings
    const p = cellCenter(c, r);
    if (input.cities.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 200)) continue;
    if (input.lairs.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 120)) continue;
    grassCells.push([r, c]);
  }
  const clusters = 6;
  for (let k = 0; k < clusters && grassCells.length > 0; k++) {
    const [cr, cc] = grassCells[Math.floor(rng() * grassCells.length)];
    const center = cellCenter(cc, cr);
    const count = 3 + Math.floor(rng() * 5);
    for (let t = 0; t < count; t++) {
      const x = center.x + (rng() - 0.5) * 220;
      const y = center.y + (rng() - 0.5) * 180;
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      if (!isLand(r, c) || isSand(r, c)) continue;
      scene.add.sprite(x, y, 'tree')
        .setOrigin(0.5, 0.78)
        .setDepth(10 + y * 0.01)
        .play({ key: 'tree_anim', startFrame: Math.floor(rng() * 4) });
    }
  }

  // ── Scattered decorations (mushrooms, bushes, stones…) ──
  grassCells.forEach(([r, c]) => {
    if (rng() > 0.05) return;
    const p = cellCenter(c, r);
    const idx = 1 + Math.floor(rng() * 18);
    scene.add.image(p.x + (rng() - 0.5) * 30, p.y + (rng() - 0.5) * 30, `deco_${idx}`).setDepth(4);
  });
}
