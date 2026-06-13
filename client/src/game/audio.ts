import Phaser from 'phaser';

// Tiny central sound layer. The Phaser scene owns the audio context; both the
// scene and the React HUD call playSfx() through this module singleton. Browsers
// block audio until a user gesture, so the ambient loop starts on first input.

let scene: Phaser.Scene | null = null;
let muted = false;
let ambientStarted = false;
const lastPlayed: Record<string, number> = {};

export function initAudio(s: Phaser.Scene): void {
  scene = s;
  s.sound.mute = muted;
}

/** Start the looping overworld ambience (once, after a user gesture). */
export function startAmbient(): void {
  if (ambientStarted || !scene || !scene.cache.audio.exists('sfx_ambient_loop')) return;
  ambientStarted = true;
  try { scene.sound.add('sfx_ambient_loop', { loop: true, volume: 0.18 }).play(); } catch { /* ignore */ }
}

/**
 * Play a one-shot effect by name (without the `sfx_` prefix).
 * Pass x/y to make it spatial: skipped when off-screen, quieter the further it
 * is from the camera centre and the more the view is zoomed out. The throttle
 * (per sound) stops rapid events from stacking into a buzz.
 */
export function playSfx(name: string, opts: { volume?: number; throttleMs?: number; x?: number; y?: number } = {}): void {
  if (muted || !scene || !scene.cache.audio.exists(`sfx_${name}`)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prev = lastPlayed[name];
  if (opts.throttleMs && prev !== undefined && now - prev < opts.throttleMs) return;

  let vol = opts.volume ?? 0.55;
  if (opts.x !== undefined && opts.y !== undefined) {
    const cam = scene.cameras.main;
    const view = cam.worldView;
    if (!Phaser.Geom.Rectangle.Contains(view, opts.x, opts.y)) return; // off-screen → silent
    const dist = Math.hypot(opts.x - view.centerX, opts.y - view.centerY);
    const maxD = Math.hypot(view.width, view.height) / 2 || 1;
    vol *= Phaser.Math.Clamp(1 - (dist / maxD) * 0.6, 0.3, 1);   // edge falloff
    vol *= Phaser.Math.Clamp(cam.zoom, 0.45, 1);                 // quieter zoomed out
  }
  lastPlayed[name] = now;
  try { scene.sound.play(`sfx_${name}`, { volume: vol }); } catch { /* ignore */ }
}

export function toggleMute(): boolean {
  muted = !muted;
  if (scene) scene.sound.mute = muted;
  return muted;
}

export function isAudioMuted(): boolean {
  return muted;
}
