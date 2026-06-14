// Navigation grid for RTS ("Open Field") mode: A* over the 64px tile grid.
// Blocked tiles = water (not land) + plateau/cliff discs. Built once per match
// from the same land grid + elevation discs the rest of the sim uses, so paths
// agree with what the client draws.

const TILE = 64;

export interface TileXY { c: number; r: number; }

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array; // 1 = impassable

  constructor(land: boolean[][], elevations: { x: number; y: number; r: number }[]) {
    this.rows = land.length;
    this.cols = land[0]?.length ?? 0;
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!land[r][c]) this.blocked[r * this.cols + c] = 1;
      }
    }
    // Stamp elevation discs as impassable (units route around plateaus).
    elevations.forEach(e => {
      const cc = Math.floor(e.x / TILE), cr = Math.floor(e.y / TILE);
      const rad = Math.ceil(e.r / TILE) + 1;
      for (let r = cr - rad; r <= cr + rad; r++) {
        for (let c = cc - rad; c <= cc + rad; c++) {
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          const px = (c + 0.5) * TILE, py = (r + 0.5) * TILE;
          if (Math.hypot(px - e.x, py - e.y) < e.r) this.blocked[r * this.cols + c] = 1;
        }
      }
    });
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  isBlocked(c: number, r: number): boolean {
    return !this.inBounds(c, r) || this.blocked[r * this.cols + c] === 1;
  }

  worldToTile(x: number, y: number): TileXY {
    return { c: Math.floor(x / TILE), r: Math.floor(y / TILE) };
  }

  tileCenter(c: number, r: number): { x: number; y: number } {
    return { x: (c + 0.5) * TILE, y: (r + 0.5) * TILE };
  }

  /** Nearest passable tile to (c,r) via a small spiral search (handles a target
   *  that lands on water/cliff, or a unit nudged onto a blocked edge). */
  nearestFree(c: number, r: number, maxRing = 6): TileXY | null {
    if (!this.isBlocked(c, r)) return { c, r };
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          if (!this.isBlocked(c + dc, r + dr)) return { c: c + dc, r: r + dr };
        }
      }
    }
    return null;
  }

  /**
   * A* from a start tile to a goal tile (8-connected). Returns a list of tile
   * waypoints (excluding the start), or null if unreachable. `maxExpansions`
   * caps work so a pathological request can't stall the tick.
   */
  findPath(sc: number, sr: number, gc: number, gr: number, maxExpansions = 6000): TileXY[] | null {
    const start = this.nearestFree(sc, sr);
    const goal = this.nearestFree(gc, gr);
    if (!start || !goal) return null;
    sc = start.c; sr = start.r; gc = goal.c; gr = goal.r;
    if (sc === gc && sr === gr) return [];

    const N = this.cols * this.rows;
    const sIdx = sr * this.cols + sc;
    const gIdx = gr * this.cols + gc;
    const came = new Int32Array(N).fill(-1);
    const gScore = new Float64Array(N).fill(Infinity);
    const closed = new Uint8Array(N);
    gScore[sIdx] = 0;

    const heap = new MinHeap();
    heap.push(sIdx, this.heuristic(sc, sr, gc, gr));

    let expansions = 0;
    while (heap.size > 0 && expansions < maxExpansions) {
      const cur = heap.pop();
      if (cur === gIdx) return this.reconstruct(came, gIdx);
      if (closed[cur]) continue;
      closed[cur] = 1;
      expansions++;
      const cc = cur % this.cols, cr = (cur - cc) / this.cols;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc, nr = cr + dr;
          if (this.isBlocked(nc, nr)) continue;
          // Prevent diagonal cutting through a blocked corner.
          if (dc !== 0 && dr !== 0 && (this.isBlocked(cc + dc, cr) || this.isBlocked(cc, cr + dr))) continue;
          const nIdx = nr * this.cols + nc;
          if (closed[nIdx]) continue;
          const step = dc !== 0 && dr !== 0 ? 1.41421356 : 1;
          const tentative = gScore[cur] + step;
          if (tentative < gScore[nIdx]) {
            came[nIdx] = cur;
            gScore[nIdx] = tentative;
            heap.push(nIdx, tentative + this.heuristic(nc, nr, gc, gr));
          }
        }
      }
    }
    return null;
  }

  private heuristic(c: number, r: number, gc: number, gr: number): number {
    // Octile distance (admissible for 8-connected movement).
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (dx + dy) + (1.41421356 - 2) * Math.min(dx, dy);
  }

  private reconstruct(came: Int32Array, goalIdx: number): TileXY[] {
    const path: TileXY[] = [];
    let cur = goalIdx;
    while (cur !== -1) {
      const c = cur % this.cols, r = (cur - c) / this.cols;
      path.push({ c, r });
      cur = came[cur];
    }
    path.reverse();
    path.shift(); // drop the start tile
    return path;
  }
}

// Tiny binary min-heap keyed by priority, storing tile indices. Allows duplicate
// pushes (lazy deletion via the `closed` set in A*).
class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size(): number { return this.idx.length; }

  push(index: number, priority: number): void {
    this.idx.push(index); this.pri.push(priority);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.pri[p] <= this.pri[i]) break;
      this.swap(i, p); i = p;
    }
  }

  pop(): number {
    const topIdx = this.idx[0];
    const lastI = this.idx.pop()!; const lastP = this.pri.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = lastI; this.pri[0] = lastP;
      let i = 0; const n = this.idx.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let m = i;
        if (l < n && this.pri[l] < this.pri[m]) m = l;
        if (r < n && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return topIdx;
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = ti;
    const tp = this.pri[a]; this.pri[a] = this.pri[b]; this.pri[b] = tp;
  }
}
