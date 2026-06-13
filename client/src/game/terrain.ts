import Phaser from 'phaser';
import { autotileFrame, CLIFF_UP, CLIFF_LO } from './assets';

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
  roadSplines: { x: number; y: number }[][]; // one per physical road (island shaping)
  roadTilePaths: { c: number; r: number }[][]; // 4-connected single-width path units walk (sand)
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

  // ── Smooth coastlines: drop lone juts, fill lone holes (two passes) ──
  for (let pass = 0; pass < 2; pass++) {
    const ch: [number, number, number][] = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const n = (grid[r - 1][c] !== WATER ? 1 : 0) + (grid[r + 1][c] !== WATER ? 1 : 0)
          + (grid[r][c - 1] !== WATER ? 1 : 0) + (grid[r][c + 1] !== WATER ? 1 : 0);
        if (grid[r][c] !== WATER && n <= 1) ch.push([r, c, WATER]);        // lone land jut
        else if (grid[r][c] === WATER && n >= 3) ch.push([r, c, GRASS]);   // lone water hole
      }
    }
    ch.forEach(([r, c, v]) => { grid[r][c] = v; });
  }
  // Re-assert land beneath roads/cities so smoothing can't sever a connection
  const ensureLand = (c: number, r: number) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === WATER) grid[r][c] = GRASS;
  };
  input.roadSplines.forEach(sp => sp.forEach(p => ensureLand(Math.floor(p.x / TILE), Math.floor(p.y / TILE))));
  input.cities.forEach(n => {
    const c0 = Math.floor(n.x / TILE), r0 = Math.floor(n.y / TILE);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) ensureLand(c0 + dc, r0 + dr);
  });

  // ── Sand roads ──
  // Paint exactly the 4-connected single-tile path the server's units walk, so
  // roads are always one tile wide (flooring raw spline samples could land in
  // two rows on a near-axis run and render a 2-wide band).
  const markSand = (r: number, c: number) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER) grid[r][c] = SAND;
  };
  input.roadTilePaths.forEach(path => path.forEach(cell => markSand(cell.r, cell.c)));
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
  // Drop lone/skinny plateau cells (fewer than 2 orthogonal ELEV neighbours):
  // a 1-tile plateau renders as a rocky stump that reads as detached from the
  // land. Two passes peels off single-tile spurs so plateaus stay chunky.
  const elevAt = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === ELEV;
  for (let pass = 0; pass < 2; pass++) {
    const demote: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== ELEV) continue;
        const n = (elevAt(r - 1, c) ? 1 : 0) + (elevAt(r + 1, c) ? 1 : 0) + (elevAt(r, c - 1) ? 1 : 0) + (elevAt(r, c + 1) ? 1 : 0);
        if (n < 2) demote.push([r, c]);
      }
    }
    demote.forEach(([r, c]) => { grid[r][c] = GRASS; });
  }

  // ── Region labels: each landmass + each plateau gets its own grass ──
  const island: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const plateau: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const flood = (sr: number, sc: number, lab: number[][], id: number, match: (r: number, c: number) => boolean) => {
    const st: [number, number][] = [[sr, sc]]; lab[sr][sc] = id;
    while (st.length) {
      const [cr, cc] = st.pop()!;
      for (const [dr, dc] of N4) {
        const nr = cr + dr, nc = cc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && lab[nr][nc] < 0 && match(nr, nc)) { lab[nr][nc] = id; st.push([nr, nc]); }
      }
    }
  };
  let islN = 0, platN = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c] !== WATER && island[r][c] < 0) flood(r, c, island, islN++, (rr, cc) => grid[rr][cc] !== WATER);
    if (grid[r][c] === ELEV && plateau[r][c] < 0) flood(r, c, plateau, platN++, (rr, cc) => grid[rr][cc] === ELEV);
  }
  const FLAT = ['grass2', 'grass3', 'grass1'];
  const PLAT = ['grass1', 'grass3', 'grass2'];
  const flatSheet = (c: number, r: number): string => {
    const off = (island[r][c] + 1) * 7; // shift the noise per-island so they differ
    const v = (hash2(Math.floor(c / 5) + off, Math.floor(r / 5))
      + hash2(Math.floor((c + 2) / 4), Math.floor((r + 3) / 4) + off)) % 6;
    return v < 4 ? FLAT[0] : v < 5 ? FLAT[1] : FLAT[2];
  };

  // ── Render base grass / sand ──
  const isLand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== WATER;
  const isSand = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === SAND;
  const isElev = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === ELEV;

  // ── Cliff topology (south-facing drops) ──
  // A cell is a cliff "cap" when it has a one-tile rocky drop on its south edge:
  //  • coast  — land sitting above water
  //  • platDrop — elevated ground sitting above lower grass
  // The cap tile uses the elevated-grass bottom edge (the grass lip overhanging
  // the cliff): LIP[0] left corner, LIP[1/2] middle, LIP[3] right corner —
  // chosen by where the cliff run ends. The rocky face + a foot shadow render
  // below it in a later pass.
  const LIP = [32, 33, 34, 35];
  const southCoast = (r: number, c: number) => isLand(r, c) && !isLand(r + 1, c);
  const platDrop = (r: number, c: number) => isElev(r, c) && isLand(r + 1, c) && !isElev(r + 1, c);
  const cliffHere = (r: number, c: number) => southCoast(r, c) || platDrop(r, c);
  const cliffPart = (r: number, c: number, edge: (r: number, c: number) => boolean): number => {
    if (!edge(r, c - 1)) return 0;   // left end
    if (!edge(r, c + 1)) return 3;   // right end
    return (c & 1) ? 1 : 2;          // middle (alternate for variety)
  };

  // One tiled water background instead of thousands of per-cell images
  scene.add.tileSprite(0, 0, cols * TILE, rows * TILE, 'water_bg').setOrigin(0).setDepth(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === WATER) continue;
      const x = c * TILE, y = r * TILE;
      const sheet = grid[r][c] === ELEV ? PLAT[((plateau[r][c] % 3) + 3) % 3] : flatSheet(c, r);
      // Cliff caps get the grass-lip edge tile so the grass visibly overhangs
      // the rocky face; everything else autotiles against its own kind.
      const gFrame = cliffHere(r, c)
        ? LIP[cliffPart(r, c, cliffHere)]
        : autotileFrame('grass', isLand(r - 1, c), isLand(r + 1, c), isLand(r, c + 1), isLand(r, c - 1));
      scene.add.image(x, y, sheet, gFrame).setOrigin(0).setDepth(grid[r][c] === ELEV ? 6 : 2);
      if (grid[r][c] === SAND) {
        const sFrame = autotileFrame('sand', isSand(r - 1, c), isSand(r + 1, c), isSand(r, c + 1), isSand(r, c - 1));
        scene.add.image(x, y, 'tiles', sFrame).setOrigin(0).setDepth(3);
      }
    }
  }

  // ── Cliff faces + foot shadow ──
  // The cap tile above already shows the grass lip (rendered in the base pass);
  // here we drop the single rocky face (CLIFF_UP 41–44) below it, lay a soft
  // shadow at its foot to ground the cliff, and — for coastal drops — break a
  // foam ripple against it. Higher ground is terraced via separate plateau
  // discs, each its own one-tile step with grass above and below.
  const cliffTop = new Set<number>(); // cap cells (skip ambient foam over them)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cliffHere(r, c)) continue;
      const x = c * TILE;
      const i = cliffPart(r, c, cliffHere);
      scene.add.image(x, (r + 1) * TILE, 'grass1', CLIFF_UP[i]).setOrigin(0).setDepth(7 + r * 0.02);
      // Soft shadow at the foot of the cliff (above the lower ground/water, but
      // below the rocky face), adding depth where the cliff meets the ground.
      scene.add.image(x + TILE / 2, (r + 2) * TILE, 'shadow').setOrigin(0.5, 0.4)
        .setScale(0.5, 0.34).setAlpha(0.4).setDepth(5);
      if (southCoast(r, c)) {
        // a single small ripple lapping right at the foot of the cliff
        scene.add.sprite(x + TILE / 2, (r + 1) * TILE + TILE * 0.78, 'foam2').setOrigin(0.5)
          .setScale(0.5).setAlpha(0.85).setDepth(1)
          .play({ key: 'foam2_anim', startFrame: Math.floor(rng() * 16) });
      }
      cliffTop.add(r * cols + c);
    }
  }

  // ── Shadows cast by elevated ground onto the lower ground ──
  // Tilemap guide layers 3/5/7: each elevation tier drops a soft shadow on the
  // ground below it. Light comes from the upper-left, so shadow falls on lower
  // grass that sits south or east of a raised cell. Depth keeps it above the
  // flat grass (2) but below the cliff face (7) and the plateau top (6).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== GRASS && grid[r][c] !== SAND) continue;
      const south = isElev(r - 1, c);            // raised ground to the north → shadow falls here
      const east = isElev(r, c - 1);             // raised ground to the west
      const corner = isElev(r - 1, c - 1);
      if (!south && !east && !corner) continue;
      const p = cellCenter(c, r);
      scene.add.image(p.x, p.y - 6, 'shadow').setScale(0.42).setAlpha(0.45).setDepth(4.5);
    }
  }

  // ── Animated foam on coast tiles that aren't fronted by a cliff ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === WATER || cliffTop.has(r * cols + c)) continue;
      const coastal = !isLand(r - 1, c) || !isLand(r + 1, c) || !isLand(r, c - 1) || !isLand(r, c + 1);
      if (!coastal) continue;
      const p = cellCenter(c, r);
      scene.add.sprite(p.x, p.y, 'foam2').setScale(0.72).setAlpha(0.9).setDepth(1)
        .play({ key: 'foam2_anim', startFrame: Math.floor(rng() * 16) });
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
