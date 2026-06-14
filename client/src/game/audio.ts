import Phaser from 'phaser';

// Tiny central sound layer. The Phaser scene owns the audio context; both the
// scene and the React HUD call playSfx() through this module singleton. Browsers
// block audio until a user gesture, so the ambient loop starts on first input.
//
// Three independent volume categories the player tunes from Settings:
//   music — the ambient bed + the dynamic battle layer
//   sfx   — one-shot effects (clashes, coins, builds, UI…)
//   beat  — just the marching drum
// Each is a 0..1 multiplier over the per-sound base levels, persisted locally.

let scene: Phaser.Scene | null = null;
let muted = false;
let ambientStarted = false;
const lastPlayed: Record<string, number> = {};

const AMBIENT_BASE = 0.16;
const BATTLE_MAX = 0.26;
let ambientSound: Phaser.Sound.BaseSound | null = null;
let battleSound: Phaser.Sound.BaseSound | null = null;
let battleVol = 0;
let bedDuck = 1; // the calm bed ducks under the battle layer so they don't pile up

function applyBedVolume(): void {
  if (!ambientSound) return;
  try { (ambientSound as Phaser.Sound.WebAudioSound).setVolume(AMBIENT_BASE * musicVol * bedDuck); } catch { /* ignore */ }
}

const load = (k: string): number => {
  try { const v = parseFloat(localStorage.getItem(k) || ''); return isNaN(v) ? 1 : Math.max(0, Math.min(1, v)); } catch { return 1; }
};
let musicVol = load('te_vol_music');
let sfxVol = load('te_vol_sfx');
let beatVol = load('te_vol_beat');

export function initAudio(s: Phaser.Scene): void {
  scene = s;
  s.sound.mute = muted;
}

/** Start the looping overworld music (once, after a user gesture). */
export function startAmbient(): void {
  if (ambientStarted || !scene) return;
  // Prefer the cozy medieval music bed; fall back to the old nature ambience.
  const key = scene.cache.audio.exists('sfx_music_bed') ? 'sfx_music_bed'
    : scene.cache.audio.exists('sfx_ambient_loop') ? 'sfx_ambient_loop' : null;
  if (!key) return;
  ambientStarted = true;
  try { ambientSound = scene.sound.add(key, { loop: true, volume: AMBIENT_BASE * musicVol }); ambientSound.play(); } catch { /* ignore */ }
  // Start the battle layer silent; setBattleIntensity() fades it in during fights.
  if (scene.cache.audio.exists('sfx_music_battle')) {
    try {
      battleSound = scene.sound.add('sfx_music_battle', { loop: true, volume: 0 });
      battleSound.play();
    } catch { /* ignore */ }
  }
}

/**
 * Drive the dynamic battle layer from combat intensity (0 calm … 1 pitched
 * battle). Eased toward the target so it swells and settles smoothly; call it
 * a couple of times a second.
 */
export function setBattleIntensity(t: number): void {
  if (!battleSound) return;
  const target = Math.max(0, Math.min(1, t)) * BATTLE_MAX * musicVol;
  battleVol += (target - battleVol) * 0.35;
  if (battleVol < 0.002) battleVol = 0;
  try { (battleSound as Phaser.Sound.WebAudioSound).setVolume(battleVol); } catch { /* ignore */ }
  // Crossfade: as the battle layer swells, duck the calm bed so the two tracks
  // blend into one piece of music instead of clashing as "two songs".
  const prominence = BATTLE_MAX > 0 ? battleVol / (BATTLE_MAX * (musicVol || 1)) : 0;
  bedDuck = 1 - 0.85 * Math.max(0, Math.min(1, prominence));
  applyBedVolume();
}

/**
 * Play a one-shot effect by name (without the `sfx_` prefix).
 * Pass x/y to make it spatial: skipped when off-screen, quieter the further it
 * is from the camera centre and the more the view is zoomed out. The throttle
 * (per sound) stops rapid events from stacking into a buzz.
 */
export function playSfx(name: string, opts: { volume?: number; throttleMs?: number; throttleKey?: string; x?: number; y?: number; rate?: number } = {}): void {
  if (muted || !scene || !scene.cache.audio.exists(`sfx_${name}`)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // Variant sounds (e.g. the sword-clash set) share one throttle bucket so
  // randomising the clip never multiplies the event density into a buzz.
  const key = opts.throttleKey ?? name;
  const prev = lastPlayed[key];
  if (opts.throttleMs && prev !== undefined && now - prev < opts.throttleMs) return;

  let vol = opts.volume ?? 0.55;
  // Category volume: the drum follows the beat slider, everything else the SFX slider.
  vol *= name === 'beat_drum' ? beatVol : sfxVol;
  if (vol <= 0.001) return;
  if (opts.x !== undefined && opts.y !== undefined) {
    const cam = scene.cameras.main;
    const view = cam.worldView;
    if (!Phaser.Geom.Rectangle.Contains(view, opts.x, opts.y)) return; // off-screen → silent
    const dist = Math.hypot(opts.x - view.centerX, opts.y - view.centerY);
    const maxD = Math.hypot(view.width, view.height) / 2 || 1;
    vol *= Phaser.Math.Clamp(1 - (dist / maxD) * 0.6, 0.3, 1);   // edge falloff
    vol *= Phaser.Math.Clamp(cam.zoom, 0.45, 1);                 // quieter zoomed out
  }
  lastPlayed[key] = now;
  try { scene.sound.play(`sfx_${name}`, { volume: vol, rate: opts.rate ?? 1 }); } catch { /* ignore */ }
}

/** A short camera shake (used for minigame combo juice). Safe if no scene yet. */
export function cameraPunch(intensity = 0.004, duration = 150): void {
  try { scene?.cameras.main.shake(duration, intensity); } catch { /* ignore */ }
}

// ── Per-category volume controls (0..1), persisted to localStorage ──
function persist(k: string, v: number): number { const c = Math.max(0, Math.min(1, v)); try { localStorage.setItem(k, String(c)); } catch { /* ignore */ } return c; }
export function setMusicVolume(v: number): void {
  musicVol = persist('te_vol_music', v);
  applyBedVolume();
}
export function setSfxVolume(v: number): void { sfxVol = persist('te_vol_sfx', v); }
export function setBeatVolume(v: number): void { beatVol = persist('te_vol_beat', v); }
export function getVolumes(): { music: number; sfx: number; beat: number } { return { music: musicVol, sfx: sfxVol, beat: beatVol }; }

/** Stop the looping tracks and allow a fresh start (call on scene teardown so a
 *  new match doesn't stack a second bed on top of the old one). */
export function resetAmbient(): void {
  try { ambientSound?.stop(); } catch { /* ignore */ }
  try { battleSound?.stop(); } catch { /* ignore */ }
  ambientSound = null; battleSound = null;
  battleVol = 0; bedDuck = 1; ambientStarted = false;
}

export function toggleMute(): boolean {
  muted = !muted;
  if (scene) scene.sound.mute = muted;
  return muted;
}

export function isAudioMuted(): boolean {
  return muted;
}
