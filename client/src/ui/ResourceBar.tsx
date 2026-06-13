import React from 'react';
import { RIBBON_BAR, ICONS, RES_ICON } from './skin';

interface Props {
  resources: {
    wood: number;
    food: number;
    gold: number;
    popUsed: number;
    popCap: number;
  };
}

const BAR_STYLE: React.CSSProperties = {
  ...RIBBON_BAR,
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
  justifyContent: 'center',
  height: '52px',
  padding: '0 6px',
  fontSize: '16px',
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

export default function ResourceBar({ resources }: Props) {
  return (
    <div style={BAR_STYLE}>
      <div style={ITEM_STYLE}>
        <img src={ICONS.wood} alt="wood" style={RES_ICON} />
        <span>{Math.floor(resources.wood)}</span>
      </div>
      <div style={ITEM_STYLE}>
        <img src={ICONS.food} alt="food" style={RES_ICON} />
        <span>{Math.floor(resources.food)}</span>
      </div>
      <div style={ITEM_STYLE}>
        <img src={ICONS.gold} alt="gold" style={RES_ICON} />
        <span>{Math.floor(resources.gold)}</span>
      </div>
      <div style={ITEM_STYLE}>
        <span>👥</span>
        <span>{resources.popUsed}/{resources.popCap}</span>
      </div>
    </div>
  );
}
