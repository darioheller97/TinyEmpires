import React from 'react';

// Shared Tiny Swords UI skin: carved wood panels, ribbon headers,
// faction buttons. Tuned for readability (big bold text, strong contrast).

export const PANEL: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '22px',
  borderImage: 'url(/assets/UI/Banners/Carved_9Slides.png) 64 fill stretch',
  imageRendering: 'pixelated',
  color: '#3b2410',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: '14px',
};

/** Yellow ribbon strip for panel titles (white text, dark outline). */
export const RIBBON: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '0 28px',
  borderImage: 'url(/assets/UI/Ribbons/Ribbon_Yellow_3Slides.png) 0 88 fill stretch',
  imageRendering: 'pixelated',
  color: '#fff',
  textShadow: '0 2px 0 rgba(0,0,0,0.55)',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
  fontSize: '15px',
  textAlign: 'center',
  lineHeight: '34px',
  height: '34px',
  margin: '-30px auto 6px',
  width: 'fit-content',
  minWidth: '120px',
  padding: '0 6px',
  whiteSpace: 'nowrap',
};

export const BUTTON: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '14px',
  borderImage: 'url(/assets/UI/Buttons/Button_Blue_9Slides.png) 64 fill stretch',
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
  borderImage: 'url(/assets/UI/Buttons/Button_Red_9Slides.png) 64 fill stretch',
};

export const BUTTON_DISABLED: React.CSSProperties = {
  ...BUTTON,
  borderImage: 'url(/assets/UI/Buttons/Button_Disable_9Slides.png) 64 fill stretch',
  color: '#e8e8e8',
  cursor: 'not-allowed',
};

export const ICONS = {
  wood: '/assets/Resources/Resources/W_Idle_(NoShadow).png',
  food: '/assets/Resources/Resources/M_Idle_(NoShadow).png',
  gold: '/assets/Resources/Resources/G_Idle_(NoShadow).png',
};

export const RES_ICON: React.CSSProperties = {
  width: 28,
  height: 28,
  objectFit: 'contain',
  imageRendering: 'pixelated',
  verticalAlign: 'middle',
};
