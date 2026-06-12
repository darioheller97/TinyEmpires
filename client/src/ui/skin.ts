import React from 'react';

// Shared Tiny Swords UI skin (carved wood panels + faction buttons)

export const PANEL: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '18px',
  borderImage: 'url(/assets/UI/Banners/Carved_9Slides.png) 64 fill stretch',
  imageRendering: 'pixelated',
  color: '#4a2f14',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
};

export const BUTTON: React.CSSProperties = {
  borderStyle: 'solid',
  borderWidth: '12px',
  borderImage: 'url(/assets/UI/Buttons/Button_Blue_9Slides.png) 64 fill stretch',
  imageRendering: 'pixelated',
  background: 'none',
  color: '#fff',
  textShadow: '0 1px 2px rgba(0,0,0,0.7)',
  fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  fontWeight: 700,
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
  color: '#ccc',
  cursor: 'not-allowed',
};

export const ICONS = {
  wood: '/assets/Resources/Resources/W_Idle_(NoShadow).png',
  food: '/assets/Resources/Resources/M_Idle_(NoShadow).png',
  gold: '/assets/Resources/Resources/G_Idle_(NoShadow).png',
};

export const RES_ICON: React.CSSProperties = {
  width: 26,
  height: 26,
  objectFit: 'contain',
  imageRendering: 'pixelated',
  verticalAlign: 'middle',
};
