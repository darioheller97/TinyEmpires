import React from 'react';

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
  display: 'flex',
  gap: '8px',
  background: 'rgba(0, 0, 0, 0.7)',
  border: '2px solid #8b6914',
  borderRadius: '8px',
  padding: '8px 16px',
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffd700',
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const ICON_BOX: React.CSSProperties = {
  width: '20px',
  height: '20px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
};

export default function ResourceBar({ resources }: Props) {
  return (
    <div style={BAR_STYLE}>
      <div style={ITEM_STYLE}>
        <span style={{ ...ICON_BOX, background: '#6b4226' }}>🪵</span>
        <span>{Math.floor(resources.wood)}</span>
      </div>
      <div style={ITEM_STYLE}>
        <span style={{ ...ICON_BOX, background: '#4a7c3f' }}>🌾</span>
        <span>{Math.floor(resources.food)}</span>
      </div>
      <div style={ITEM_STYLE}>
        <span style={{ ...ICON_BOX, background: '#8b6914' }}>🪙</span>
        <span>{Math.floor(resources.gold)}</span>
      </div>
      <div style={{ width: '1px', background: '#555', margin: '0 4px' }} />
      <div style={ITEM_STYLE}>
        <span>👥</span>
        <span>{resources.popUsed}/{resources.popCap}</span>
      </div>
    </div>
  );
}
