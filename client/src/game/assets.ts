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
const A2 = 'assets2';

// Remastered units: one spritesheet per (colour, class, state). Square frames
// (192px; Lancer 320px). Black skins the PvE enemies.
export const UNIT_COLORS = [...FACTION_COLORS, 'Black'] as const;
type UnitState = 'idle' | 'walk' | 'attack' | 'mine' | 'butcher' | 'carrywood' | 'carrymeat' | 'carrygold';
interface ClassDef { fw: number; frames: number; files: Partial<Record<UnitState, [string, number]>>; }
export const UNIT_CLASSES: Record<string, ClassDef> = {
  warrior: { fw: 192, frames: 8, files: { idle: ['Warrior/Warrior_Idle', 8], walk: ['Warrior/Warrior_Run', 6], attack: ['Warrior/Warrior_Attack1', 4] } },
  archer:  { fw: 192, frames: 8, files: { idle: ['Archer/Archer_Idle', 6], walk: ['Archer/Archer_Run', 4], attack: ['Archer/Archer_Shoot', 8] } },
  monk:    { fw: 192, frames: 11, files: { idle: ['Monk/Idle', 6], walk: ['Monk/Run', 4], attack: ['Monk/Heal', 11] } },
  lancer:  { fw: 320, frames: 12, files: { idle: ['Lancer/Lancer_Idle', 12], walk: ['Lancer/Lancer_Run', 6], attack: ['Lancer/Lancer_Right_Attack', 3] } },
  // Pawn gathers with the matching tool (axe=wood, pickaxe=gold, knife=sheep)
  // and hauls with the matching load (Run Wood/Meat/Gold).
  pawn:    { fw: 192, frames: 8, files: {
    idle: ['Pawn/Pawn_Idle', 8], walk: ['Pawn/Pawn_Run', 6],
    attack: ['Pawn/Pawn_Interact Axe', 6], mine: ['Pawn/Pawn_Interact Pickaxe', 6],
    butcher: ['Pawn/Pawn_Interact Knife', 4],
    carrywood: ['Pawn/Pawn_Run Wood', 6], carrymeat: ['Pawn/Pawn_Run Meat', 6], carrygold: ['Pawn/Pawn_Run Gold', 6],
  } },
};

const troopSheets: SheetDef[] = [];
UNIT_COLORS.forEach(c => {
  Object.entries(UNIT_CLASSES).forEach(([cls, def]) => {
    (Object.entries(def.files) as [UnitState, [string, number]][]).forEach(([state, [file]]) => {
      troopSheets.push({ key: `u_${c}_${cls}_${state}`, url: `${A2}/Units/${c}/${file}.png`, frameWidth: def.fw, frameHeight: def.fw });
    });
  });
});

export const SHEETS: SheetDef[] = [
  ...troopSheets,
  { key: 'tiles', url: `${A}/Terrain/Ground/Tilemap_Flat.png`, frameWidth: 64, frameHeight: 64 },
  // Remastered 9×6 grass/cliff tilesets (shade variants for less repetition)
  { key: 'grass1', url: `${A2}/Tileset/Tilemap_color1.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'grass2', url: `${A2}/Tileset/Tilemap_color2.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'grass3', url: `${A2}/Tileset/Tilemap_color3.png`, frameWidth: 64, frameHeight: 64 },
  // Remastered animated water edge + water rocks + bushes
  { key: 'foam2', url: `${A2}/Water/Foam.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'wrock1', url: `${A2}/Water/WaterRocks_01.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'wrock2', url: `${A2}/Water/WaterRocks_02.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'wrock3', url: `${A2}/Water/WaterRocks_03.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'wrock4', url: `${A2}/Water/WaterRocks_04.png`, frameWidth: 64, frameHeight: 64 },
  { key: 'bush1', url: `${A2}/Bushes/Bushe1.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'bush2', url: `${A2}/Bushes/Bushe2.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'bush3', url: `${A2}/Bushes/Bushe3.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'bush4', url: `${A2}/Bushes/Bushe4.png`, frameWidth: 128, frameHeight: 128 },
  // Remastered tree species (8-frame sway). Tree1/2 are tall (256), Tree3/4 short (192)
  { key: 'tree1', url: `${A2}/Trees/Tree1.png`, frameWidth: 192, frameHeight: 256 },
  { key: 'tree2', url: `${A2}/Trees/Tree2.png`, frameWidth: 192, frameHeight: 256 },
  { key: 'tree3', url: `${A2}/Trees/Tree3.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'tree4', url: `${A2}/Trees/Tree4.png`, frameWidth: 192, frameHeight: 192 },
  { key: 'sheep2', url: `${A2}/Sheep/Sheep_Idle.png`, frameWidth: 128, frameHeight: 128 },
  { key: 'sheep2move', url: `${A2}/Sheep/Sheep_Move.png`, frameWidth: 128, frameHeight: 128 },
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
  { key: 'water_bg', url: `${A2}/Water/WaterBg.png` },
  { key: 'shadow', url: `${A2}/Water/Shadow.png` },
  // In-world health bars (the React HUD uses CSS for its copies)
  { key: 'bar_base', url: `${A2}/UI/bar_base.png` },
  { key: 'bar_fill', url: `${A2}/UI/bar_fill.png` },
  { key: 'icon_arrow', url: `${A2}/UI/icon_arrow.png` },
  // Selection-marker corner brackets (pack pointers): 03 TL, 04 TR, 05 BL, 06 BR.
  { key: 'sel_tl', url: `${A}/UI/Pointers/03.png` },
  { key: 'sel_tr', url: `${A}/UI/Pointers/04.png` },
  { key: 'sel_bl', url: `${A}/UI/Pointers/05.png` },
  { key: 'sel_br', url: `${A}/UI/Pointers/06.png` },
  { key: 'rock1', url: `${A2}/Rocks/Rock1.png` },
  { key: 'rock2', url: `${A2}/Rocks/Rock2.png` },
  { key: 'rock3', url: `${A2}/Rocks/Rock3.png` },
  { key: 'rock4', url: `${A2}/Rocks/Rock4.png` },
  { key: 'stump1', url: `${A2}/Trees/Stump1.png` },
  { key: 'stump2', url: `${A2}/Trees/Stump2.png` },
  { key: 'stump3', url: `${A2}/Trees/Stump3.png` },
  { key: 'stump4', url: `${A2}/Trees/Stump4.png` },
  // Gold gems (replace the old gold sacks)
  { key: 'gem1', url: `${A2}/Gold/GoldStone1.png` },
  { key: 'gem2', url: `${A2}/Gold/GoldStone2.png` },
  { key: 'gem3', url: `${A2}/Gold/GoldStone3.png` },
  { key: 'gem4', url: `${A2}/Gold/GoldStone4.png` },
  { key: 'gem5', url: `${A2}/Gold/GoldStone5.png` },
  { key: 'gem6', url: `${A2}/Gold/GoldStone6.png` },
  { key: 'elevation', url: `${A}/Terrain/Ground/Tilemap_Elevation.png` },
  { key: 'icon_close', url: `${A}/UI/Icons/Regular_01.png` },
  { key: 'goldmine_destroyed', url: `${A}/Resources/Gold Mine/GoldMine_Destroyed.png` },
  { key: 'goldmine_active', url: `${A}/Resources/Gold Mine/GoldMine_Active.png` },
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
// Remastered buildings (per faction colour) — distinct Castle/Barracks/Tower/Houses
FACTION_COLORS.forEach(c => {
  IMAGES.push(
    { key: `castle2_${c}`, url: `${A2}/Buildings/${c}/Castle.png` },
    { key: `barracks2_${c}`, url: `${A2}/Buildings/${c}/Barracks.png` },
    { key: `tower2_${c}`, url: `${A2}/Buildings/${c}/Tower.png` },
    { key: `archery_${c}`, url: `${A2}/Buildings/${c}/Archery.png` },
    { key: `monastery_${c}`, url: `${A2}/Buildings/${c}/Monastery.png` },
    { key: `house2a_${c}`, url: `${A2}/Buildings/${c}/House1.png` },
    { key: `house2b_${c}`, url: `${A2}/Buildings/${c}/House2.png` },
    { key: `house2c_${c}`, url: `${A2}/Buildings/${c}/House3.png` },
  );
});
// Archer arrow projectile (64×64), one tinted variant per unit colour.
UNIT_COLORS.forEach(c => {
  IMAGES.push({ key: `arrow_${c}`, url: `${A2}/Units/${c}/Archer/Arrow.png` });
});
for (let i = 1; i <= 18; i++) {
  IMAGES.push({ key: `deco_${i}`, url: `${A}/Deco/${String(i).padStart(2, '0')}.png` });
}
for (let i = 1; i <= 8; i++) {
  IMAGES.push({ key: `cloud${i}`, url: `${A2}/Clouds/Clouds_0${i}.png` });
}

// Sound effects (ElevenLabs-generated, Tiny Swords pixel style). Loaded as
// `sfx_<name>`; played through game/audio.ts.
export const SFX = ['ui_click', 'build_place', 'unit_recruit', 'coins_gold', 'sword_clash', 'sword_clash2', 'sword_clash3', 'sword_clash4', 'bow_shot', 'bow_shot2', 'building_destroyed', 'victory', 'ambient_loop', 'music_bed', 'music_battle', 'beat_drum'] as const;

export function preloadAssets(scene: Phaser.Scene): void {
  SHEETS.forEach(s => scene.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight }));
  IMAGES.forEach(i => scene.load.image(i.key, i.url));
  SFX.forEach(name => scene.load.audio(`sfx_${name}`, `${A2}/sfx/${name}.mp3`));
}

function rowAnim(scene: Phaser.Scene, key: string, sheet: string, row: number, cols: number, count: number, frameRate: number, repeat = -1): void {
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(sheet, { start: row * cols, end: row * cols + count - 1 }),
    frameRate,
    repeat,
  });
}

const STATE_FR: Record<UnitState, number> = {
  idle: 8, walk: 12, attack: 12, mine: 12, butcher: 12, carrywood: 12, carrymeat: 12, carrygold: 12,
};

export function createAnims(scene: Phaser.Scene): void {
  // Remastered units: one anim per (colour, class, state), each from its own sheet.
  UNIT_COLORS.forEach(c => {
    Object.entries(UNIT_CLASSES).forEach(([cls, def]) => {
      (Object.entries(def.files) as [UnitState, [string, number]][]).forEach(([state, [, frames]]) => {
        scene.anims.create({
          key: `u_${c}_${cls}_${state}`,
          frames: scene.anims.generateFrameNumbers(`u_${c}_${cls}_${state}`, { start: 0, end: frames - 1 }),
          frameRate: STATE_FR[state], repeat: -1,
        });
      });
    });
  });
  rowAnim(scene, 'foam_anim', 'foam', 0, 8, 8, 8);
  // Remastered animated water edge (16 frames) + water rocks + bushes
  rowAnim(scene, 'foam2_anim', 'foam2', 0, 16, 16, 12);
  for (let i = 1; i <= 4; i++) {
    rowAnim(scene, `wrock${i}_anim`, `wrock${i}`, 0, 16, 16, 10);
    rowAnim(scene, `bush${i}_anim`, `bush${i}`, 0, 8, 8, 6);
  }
  rowAnim(scene, 'rocks1_anim', 'rocks1', 0, 8, 8, 6);
  rowAnim(scene, 'rocks2_anim', 'rocks2', 0, 8, 8, 6);
  rowAnim(scene, 'tree_anim', 'tree', 0, 4, 4, 5);
  rowAnim(scene, 'sheep_anim', 'sheep', 0, 6, 6, 7);
  // Remastered trees (8-frame sway) + sheep idle (6 frames)
  for (let i = 1; i <= 4; i++) rowAnim(scene, `tree${i}_anim`, `tree${i}`, 0, 8, 8, 6);
  rowAnim(scene, 'sheep2_anim', 'sheep2', 0, 6, 6, 7);
  rowAnim(scene, 'sheep2_move', 'sheep2move', 0, 4, 4, 8);
  rowAnim(scene, 'fire_anim', 'fire', 0, 7, 7, 10);
  rowAnim(scene, 'explosion_anim', 'explosion', 0, 9, 9, 14, 0);
  rowAnim(scene, 'dead_anim', 'dead', 0, 7, 7, 10, 0);
}

/** Unit class for a game unit type. */
export function unitClass(type: string): string {
  switch (type) {
    case 'knight': return 'warrior';
    case 'archer': return 'archer';
    case 'lancer': return 'lancer';
    case 'monk': return 'monk';
    case 'goblin': return 'warrior'; // PvE enemy
    case 'spider': return 'archer';  // PvE enemy
    default: return 'pawn';          // villager
  }
}

/** Remastered-unit anim base (`u_<colour>_<class>`) + on-screen scale.
 *  PvE enemies (goblin/spider) use the Black faction. */
export function unitSkin(type: string, ownerHex: string | undefined): { base: string; scale: number } {
  const enemy = type === 'goblin' || type === 'spider';
  const c = enemy ? 'Black' : factionOf(ownerHex);
  const cls = unitClass(type);
  // The lancer's figure fills a 320px frame but its body is the same pixel
  // footprint as the others, so it shares the standard scale — 0.42 rendered
  // it tiny. A hair smaller than the rest keeps the long lance from dominating.
  return { base: `u_${c}_${cls}`, scale: cls === 'lancer' ? 0.58 : 0.62 };
}

// ── Autotiling ──
// Both tilesets share the same 3×3-blob + 1-wide-strip + isolated-tile layout.
//  • grass: remastered 9-wide tileset (`grass1/2/3`), blob at cols 0–3, rows 0–3.
//  • sand:  old 10-wide Tilemap_Flat (`tiles`), sand block offset by +5.
// n/s/e/w = "neighbour is the same terrain". Cliff-body frames (rows 4–5 of the
// grass sheet) are addressed directly in terrain.ts, not through this function.
export function autotileFrame(kind: 'grass' | 'sand', n: boolean, s: boolean, e: boolean, w: boolean): number {
  let col: number, row: number;
  if (!e && !w) { col = 3; row = !n ? 0 : (!s ? 2 : 1); }
  else if (!n && !s) { row = 3; col = !w ? 0 : (!e ? 2 : 1); }
  else {
    col = !w ? 0 : (!e ? 2 : 1);
    row = !n ? 0 : (!s ? 2 : 1);
  }
  if (!n && !s && !e && !w) { col = 3; row = 3; }
  return kind === 'grass' ? row * 9 + col : row * 10 + col + 5;
}

// Cliff-face frames in the 9-wide grass sheet (south-facing edge). Two rows:
// upper rocky body (41–44) and lower body with foam base (50–53). Index by run
// position: 0 left end, 1/2 middle, 3 right end.
export const CLIFF_UP = [41, 42, 43, 44] as const;
export const CLIFF_LO = [50, 51, 52, 53] as const;
