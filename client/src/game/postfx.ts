import Phaser from 'phaser';

// ── Graphics quality (persisted) ────────────────────────────────────────────
// Visual polish is cosmetic, so the player can dial it down. We deliberately use
// overlay/blend techniques (not Phaser's built-in postFX pipeline, which is a
// no-op in this build) so the effects render identically on every machine.
//   off  — original look (plain night tint, no extras)
//   low  — warm/cool day-night grade + vignette
//   high — same grade + a stronger, deeper vignette
export type GfxQuality = 'off' | 'low' | 'high';
const GKEY = 'te_gfx_quality';

export function getGfxQuality(): GfxQuality {
  try {
    const v = localStorage.getItem(GKEY);
    if (v === 'off' || v === 'low' || v === 'high') return v;
  } catch { /* ignore */ }
  return (typeof window !== 'undefined' && window.innerWidth < 820) ? 'low' : 'high';
}

export function setGfxQuality(q: GfxQuality): void {
  try { localStorage.setItem(GKEY, q); } catch { /* ignore */ }
}

// ── Scene grade + vignette ──────────────────────────────────────────────────
export interface SceneFx {
  quality: GfxQuality;
  /** Re-grade for the day/night cycle (darkness 0 = day, 1 = night). */
  grade: (darkness: number) => void;
  destroy: () => void;
}

const VIGNETTE_KEY = 'fx_vignette';

/** Soft radial darkening overlay, generated once and stretched over the view. */
function ensureVignetteTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(VIGNETTE_KEY)) return;
  const S = 512;
  const tex = scene.textures.createCanvas(VIGNETTE_KEY, S, S);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.64);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(8,12,26,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Build the grade + vignette overlay for a quality level. `tint` is the
 *  existing screen-space day/night rectangle, which we re-colour each frame. */
export function applySceneFx(
  scene: Phaser.Scene,
  tint: Phaser.GameObjects.Rectangle,
  quality: GfxQuality,
): SceneFx {
  let vignette: Phaser.GameObjects.Image | null = null;
  const fit = () => {
    if (!vignette) return;
    const w = scene.scale.width, h = scene.scale.height;
    vignette.setPosition(w / 2, h / 2).setDisplaySize(w * 1.04, h * 1.04);
  };

  if (quality !== 'off') {
    ensureVignetteTexture(scene);
    vignette = scene.add.image(0, 0, VIGNETTE_KEY)
      .setScrollFactor(0).setDepth(57).setAlpha(0).setName('fx_vignette_ov');
    fit();
    scene.scale.on('resize', fit);
  }

  const grade = (darkness: number) => {
    const d = Phaser.Math.Clamp(darkness, 0, 1);
    if (quality === 'off') {
      // Original behaviour: a plain blue night veil, clear by day.
      const colour = d > 0.5 ? 0x0b1834 : 0x241a2e;
      tint.setFillStyle(colour, d * 0.3);
      return;
    }
    // Warm amber by day → cool blue by night, a touch richer than the original.
    const warm = Phaser.Display.Color.GetColor(
      Math.round(lerp(0x3a, 0x0b, d)),
      Math.round(lerp(0x2a, 0x18, d)),
      Math.round(lerp(0x12, 0x34, d)),
    );
    tint.setFillStyle(warm, 0.10 + 0.24 * d);
    if (vignette) vignette.setAlpha((quality === 'high' ? 0.36 : 0.22) + 0.34 * d);
  };

  const destroy = () => {
    scene.scale.off('resize', fit);
    vignette?.destroy();
  };

  return { quality, grade, destroy };
}
