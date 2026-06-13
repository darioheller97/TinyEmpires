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

/** Play a one-shot effect by name (without the `sfx_` prefix). */
export function playSfx(name: string, opts: { volume?: number; throttleMs?: number } = {}): void {
  if (muted || !scene || !scene.cache.audio.exists(`sfx_${name}`)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prev = lastPlayed[name];
  if (opts.throttleMs && prev !== undefined && now - prev < opts.throttleMs) return;
  lastPlayed[name] = now;
  try { scene.sound.play(`sfx_${name}`, { volume: opts.volume ?? 0.55 }); } catch { /* ignore */ }
}

export function toggleMute(): boolean {
  muted = !muted;
  if (scene) scene.sound.mute = muted;
  return muted;
}

export function isAudioMuted(): boolean {
  return muted;
}
