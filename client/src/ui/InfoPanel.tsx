import React from 'react';
import { SelectionInfo } from '../game/GameScene';

interface Props {
  selection: SelectionInfo;
}

const PANEL: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.8)',
  border: '2px solid #8b6914',
  borderRadius: '8px',
  padding: '10px 14px',
  fontFamily: 'monospace',
  color: '#ddd',
  minWidth: '180px',
  maxWidth: '260px',
  fontSize: '12px',
};

const NAME: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#ffd700',
  marginBottom: '6px',
  borderBottom: '1px solid #555',
  paddingBottom: '4px',
};

const LABEL: React.CSSProperties = {
  color: '#aaa',
  marginRight: '6px',
};

const TYPE_LABELS: Record<string, string> = {
  city: 'City',
  intersection: 'Intersection',
  building: 'Building',
  none: '—',
};

const BUILDING_NAMES: Record<string, string> = {
  lumber_mill: 'Lumber Mill',
  farm: 'Farm',
  gold_mine: 'Gold Mine',
  barracks: 'Barracks',
  defense_tower: 'Defense Tower',
};

export default function InfoPanel({ selection }: Props) {
  if (selection.type === 'none') {
    return (
      <div style={PANEL}>
        <div style={{ color: '#888', fontSize: '11px' }}>No selection</div>
        <div style={{ color: '#666', fontSize: '10px', marginTop: '4px' }}>
          Click a city, intersection, or building
        </div>
      </div>
    );
  }

  const typeLabel = TYPE_LABELS[selection.type] || selection.type;
  const name = selection.type === 'building'
    ? BUILDING_NAMES[selection.name] || selection.name
    : selection.name;

  return (
    <div style={PANEL}>
      <div style={NAME}>{name}</div>
      <div><span style={LABEL}>Type:</span>{typeLabel}</div>

      {selection.data && selection.type === 'city' && (
        <>
          <div><span style={LABEL}>Level:</span>{selection.data.townHallLevel}</div>
          <div><span style={LABEL}>Health:</span>{Math.floor(selection.data.health || 1000)}/{selection.data.maxHealth || 1000}</div>
          <div><span style={LABEL}>Owner:</span>{selection.data.ownerId ? selection.data.ownerId.slice(0, 8) + '...' : 'Unclaimed'}</div>
          <div><span style={LABEL}>Influence:</span>{selection.data.influenceRadius}</div>
        </>
      )}

      {selection.data && selection.type === 'building' && (
        <>
          <div><span style={LABEL}>Level:</span>{selection.data.level || 1}</div>
          <div><span style={LABEL}>Health:</span>{Math.floor(selection.data.health || 200)}/{selection.data.maxHealth || 200}</div>
        </>
      )}

      {selection.data && selection.type === 'intersection' && (
        <div style={{ color: '#888', fontSize: '10px', marginTop: '4px' }}>
          Click to set waypoints (coming in Phase 3)
        </div>
      )}
    </div>
  );
}
