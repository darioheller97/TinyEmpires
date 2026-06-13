import React from 'react';

// Shared Tiny Swords UI skin, built from the remastered free pack's UI Elements
// (parchment banner, swallowtail ribbons, rounded faction buttons). The 9-slice
// PNGs under /assets2/UI are repacked from the pack's spaced reference sheets.
// Tuned for readability (big bold text, strong contrast).

const U = '/assets2/UI';

export const PANEL: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '26px',
  borderImage: `url(${U}/panel.png) 36 fill stretch`,
  imageRendering: 'pixelated',
  color: '#4a3417',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: '14px',
};

/** Swallowtail ribbon strip for panel titles (white text, dark outline). */
export const RIBBON: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 38px',
  borderImage: `url(${U}/ribbon_yellow.png) 0 62 fill stretch`,
  imageRendering: 'pixelated',
  color: '#fff',
  textShadow: '0 2px 0 rgba(0,0,0,0.55)',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: '15px',
  textAlign: 'center',
  lineHeight: '40px',
  height: '40px',
  margin: '-34px auto 6px',
  width: 'fit-content',
  minWidth: '130px',
  padding: '0 4px',
  whiteSpace: 'nowrap',
};

/** Wide blue ribbon banner for the top resource bar. */
export const RIBBON_BAR: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 56px',
  borderImage: `url(${U}/ribbon_blue.png) 0 62 fill stretch`,
  imageRendering: 'pixelated',
  color: '#fff',
  textShadow: '0 2px 0 rgba(0,0,0,0.6)',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
};

export const BUTTON: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '17px 16px',
  borderImage: `url(${U}/btn_blue.png) 47 45 fill stretch`,
  imageRendering: 'pixelated',
  background: 'none',
  color: '#fff',
  textShadow: '0 2px 0 rgba(0,0,0,0.55)',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: '14px',
  cursor: 'pointer',
  padding: '0 4px',
};

export const BUTTON_RED: React.CSSProperties = {
  ...BUTTON,
  borderImage: `url(${U}/btn_red.png) 47 45 fill stretch`,
};

export const BUTTON_GREEN: React.CSSProperties = {
  ...BUTTON,
  borderImage: `url(${U}/btn_green.png) 47 45 fill stretch`,
};

export const BUTTON_DISABLED: React.CSSProperties = {
  ...BUTTON,
  borderImage: `url(${U}/btn_disabled.png) 47 45 fill stretch`,
  color: '#eaeaea',
  cursor: 'not-allowed',
};

export const ICONS = {
  wood: `${U}/res_wood.png`,
  food: `${U}/res_food.png`,
  gold: `${U}/res_gold.png`,
};

export const RES_ICON: React.CSSProperties = {
  width: 28,
  height: 28,
  objectFit: 'contain',
  imageRendering: 'pixelated',
  verticalAlign: 'middle',
};
