import Phaser from 'phaser';

// Tiny Swords asset manifest (CC0, Pixel Frog) — loaded from /assets

export const FACTION_COLORS = ['Blue', 'Red', 'Yellow', 'Purple'] as const;
export type FactionColor = (typeof FACTION_COLORS)[number];

/** Map a player's hex color (from the server) to a faction palette. */
export function factionOf(hex: string | undefined): FactionColor {
  switch ((hex || '').toLowerCase()) {
    case '#ff4444': return 'Red';
    case '#ffd700': return 'Yellow';
    case '#aa44ff': return 'Purple';
    default: return 'Blue';
  }
}

interface SheetDef { key: string; url: string; frameWidth: number; frameHeight: number; }

const A = 'assets';

const troopSheets: SheetDef[] = [];
FACTION_COLORS.forEach(c => {
  troopSheets.push(
    { key: `warrior_${c}`, url: `${A}/Factions/Knights/Troops/Warrior/${c}/Warrior_${c}.png`, frameWidth: 192, frameHeight: 192 },
    // Note: the pack ships a misspelled "Archer_Purlple.png"
    { key: `archer_${c}`, url: `${A}/Factions/Knights/Troops/Archer/${c}/Archer_${c === 'Purple' ? 'Purlple' : c}.png`, frameWidth: 192, frameHeight: 192 },
    { key: `pawn_${c}`, url: `${A}/Factions/Knights/Troops/Pawn/${c}/Pawn_${c}.png`, frameWidth: 192, frameHeight: 192 },
  );
});
troopSheets.push(
  { key: 'torch', url: `${A}/Factions/Goblins/Troops/Torch/Red/Torch_Red.png`, frameWidth: 192, frameHeight: 192 },
  // Barrel uses 128px frames in a 6x6 grid (unlike the other troops)
  { key: 'barrel', url: `${A}/Factions/Goblins/Troops/Barrel/Purple/Barrel_Purple.png`, frameWidth: 128, frameHeight: 128 },
);

export const SHEETS: SheetDef[] = [
  ...troopSheets,
  { key: 'tiles', url: `${A}/Terrain/Ground/Tilemap_Flat.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'foam', url: `${A}/Terrain/Water/Foam/Foam.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'rocks1', url: `${A}/Terrain/Water/Rocks/Rocks_01.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'rocks2', url: `${A}/Terrain/Water/Rocks/Rocks_02.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'tree', url: `${A}/Resources/Trees/Tree.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'sheep', url: `${A}/Resources/Sheep/HappySheep_Bouncing.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'fire', url: `${A}/Effects/Fire/Fire.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'explosion', url: `${A}/Effects/Explosion/Explosions.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'dead', url: `${A}/Factions/Knights/Troops/Dead/Dead.png`, frameWidth: 128, frameHeight: 128 },
];

export const IMAGES: { key: string; url: string }[] = [
  { key: 'water', url: `${A}/Terrain/Water/Water.png` },
  { key: 'elevation', url: `${A}/Terrain/Ground/Tilemap_Elevation.png` },
  { key: 'icon_close', url: `${A}/UI/Icons/Regular_01.png` },
  { key: 'goldmine_destroyed', url: `${A}/Resources/Gold Mine/GoldMine_Destroyed.png` },
  { key: 'gold_pile', url: `${A}/Resources/Resources/G_Idle.png` },
  { key: 'goblin_house', url: `${A}/Factions/Goblins/Buildings/Wood_House/Goblin_House.png` },
  { key: 'castle_destroyed', url: `${A}/Factions/Knights/Buildings/Castle/Castle_Destroyed.png` },
  { key: 'res_wood', url: `${A}/Resources/Resources/W_Idle_(NoShadow).png` },
  { key: 'res_meat', url: `${A}/Resources/Resources/M_Idle_(NoShadow).png` },
  { key: 'res_gold', url: `${A}/Resources/Resources/G_Idle_(NoShadow).png` },
];
FACTION_COLORS.forEach(c => {
  IMAGES.push(
    { key: `castle_${c}`, url: `${A}/Factions/Knights/Buildings/Castle/Castle_${c}.png` },
    { key: `house_${c}`, url: `${A}/Factions/Knights/Buildings/House/House_${c}.png` },
    { key: `tower_${c}`, url: `${A}/Factions/Knights/Buildings/Tower/Tower_${c}.png` },
    { key: `wood_tower_${c}`, url: `${A}/Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_${c}.png` },
  );
});
for (let i = 1; i <= 18; i++) {
  IMAGES.push({ key: `deco_${i}`, url: `${A}/Deco/${String(i).padStart(2, '0')}.png` });
}

export function preloadAssets(scene: Phaser.Scene): void {
  SHEETS.forEach(s => scene.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight }));
  IMAGES.forEach(i => scene.load.image(i.key, i.url));
}

// Troop sheet layout: row 0 idle, row 1 walk, row 2 attack
const TROOP_ANIM: Record<string, { cols: number; idle: number; walk: number; attack: number }> = {
  warrior: { cols: 6, idle: 6, walk: 6, attack: 6 },
  archer: { cols: 8, idle: 6, walk: 6, attack: 8 },
  pawn: { cols: 6, idle: 6, walk: 6, attack: 6 },
  torch: { cols: 7, idle: 7, walk: 6, attack: 6 },
};

function rowAnim(scene: Phaser.Scene, key: string, sheet: string, row: number, cols: number, count: number, frameRate: number, repeat = -1): void {
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(sheet, { start: row * cols, end: row * cols + count - 1 }),
    frameRate,
    repeat,
  });
}

export function createAnims(scene: Phaser.Scene): void {
  // Troops (all palette variants share the layout)
  Object.entries(TROOP_ANIM).forEach(([base, def]) => {
    const sheets = base === 'torch' || base === 'barrel'
      ? [base]
      : FACTION_COLORS.map(c => `${base}_${c}`);
    sheets.forEach(sheet => {
      rowAnim(scene, `${sheet}_idle`, sheet, 0, def.cols, def.idle, 8);
      rowAnim(scene, `${sheet}_walk`, sheet, 1, def.cols, def.walk, 10);
      rowAnim(scene, `${sheet}_attack`, sheet, 2, def.cols, def.attack, 12);
      // Pawns have a second work row (horizontal chop) used by villagers
      if (base === 'pawn') rowAnim(scene, `${sheet}_chop`, sheet, 3, def.cols, 6, 12);
    });
  });
  // Barrel goblin: 6-col 128px grid — row 2 idle (out), row 4 hop, row 5 lit fuse
  scene.anims.create({ key: 'barrel_idle', frames: scene.anims.generateFrameNumbers('barrel', { start: 12, end: 12 }), frameRate: 1, repeat: -1 });
  scene.anims.create({ key: 'barrel_walk', frames: scene.anims.generateFrameNumbers('barrel', { start: 24, end: 26 }), frameRate: 8, repeat: -1 });
  scene.anims.create({ key: 'barrel_attack', frames: scene.anims.generateFrameNumbers('barrel', { start: 30, end: 32 }), frameRate: 10, repeat: -1 });
  rowAnim(scene, 'foam_anim', 'foam', 0, 8, 8, 8);
  rowAnim(scene, 'rocks1_anim', 'rocks1', 0, 8, 8, 6);
  rowAnim(scene, 'rocks2_anim', 'rocks2', 0, 8, 8, 6);
  rowAnim(scene, 'tree_anim', 'tree', 0, 4, 4, 5);
  rowAnim(scene, 'sheep_anim', 'sheep', 0, 6, 6, 7);
  rowAnim(scene, 'fire_anim', 'fire', 0, 7, 7, 10);
  rowAnim(scene, 'explosion_anim', 'explosion', 0, 9, 9, 14, 0);
  rowAnim(scene, 'dead_anim', 'dead', 0, 7, 7, 10, 0);
}

/** Sprite sheet base + tint for a unit type. */
export function unitSkin(type: string, ownerHex: string | undefined): { sheet: string; tint?: number } {
  const c = factionOf(ownerHex);
  switch (type) {
    case 'villager': return { sheet: `pawn_${c}` };
    case 'knight': return { sheet: `warrior_${c}` };
    case 'archer': return { sheet: `archer_${c}` };
    case 'lancer': return { sheet: `pawn_${c}` };
    case 'monk': return { sheet: `pawn_${c}`, tint: 0xaaffd8 };
    case 'goblin': return { sheet: 'torch' };
    case 'spider': return { sheet: 'barrel' };
    default: return { sheet: `pawn_${c}` };
  }
}

// ── Autotiling for Tilemap_Flat (10x4 grid; grass at col 0, sand at col 5) ──
// 3x3 rounded block + 1-wide strips at col/row 3 + isolated tile at (3,3).
export function autotileFrame(kind: 'grass' | 'sand', n: boolean, s: boolean, e: boolean, w: boolean): number {
  const off = kind === 'grass' ? 0 : 5;
  let col: number, row: number;
  if (!e && !w) { col = 3; row = !n ? 0 : (!s ? 2 : 1); }
  else if (!n && !s) { row = 3; col = !w ? 0 : (!e ? 2 : 1); }
  else {
    col = !w ? 0 : (!e ? 2 : 1);
    row = !n ? 0 : (!s ? 2 : 1);
  }
  if (!n && !s && !e && !w) { col = 3; row = 3; }
  return row * 10 + col + off;
}
