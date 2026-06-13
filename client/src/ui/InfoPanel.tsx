import React from 'react';
import { SelectionInfo } from '../game/GameScene';
import { PANEL, RIBBON } from './skin';

interface Props {
  selection: SelectionInfo;
}

const WRAP: React.CSSProperties = {
  ...PANEL,
  minWidth: '190px',
  maxWidth: '270px',
  fontSize: '12px',
};

const NAME: React.CSSProperties = { ...RIBBON, fontSize: '13px', minWidth: '90px' };

const LABEL: React.CSSProperties = { opacity: 0.7, marginRight: '6px' };

const TYPE_LABELS: Record<string, string> = {
  city: 'City',
  intersection: 'Crossroads',
  building: 'Building',
  resource: 'Resource',
  none: '—',
};

const BUILDING_NAMES: Record<string, string> = {
  house: 'House',
  barracks: 'Barracks',
  defense_tower: 'Defense Tower',
};

export default function InfoPanel({ selection }: Props) {
  if (selection.type === 'none') {
    return (
      <div style={WRAP}>
        <div style={{ fontSize: '11px', opacity: 0.7 }}>No selection</div>
        <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '4px' }}>
          Click a city, crossroads, or building
        </div>
      </div>
    );
  }

  const typeLabel = TYPE_LABELS[selection.type] || selection.type;
  const name = selection.type === 'building'
    ? BUILDING_NAMES[selection.name] || selection.name
    : selection.name;

  return (
    <div style={WRAP}>
      <div style={NAME}>{name}</div>
      <div><span style={LABEL}>Type:</span>{typeLabel}</div>

      {selection.data && selection.type === 'city' && (
        <>
          <div><span style={LABEL}>Level:</span>{selection.data.townHallLevel}</div>
          <div><span style={LABEL}>Health:</span>{Math.floor(selection.data.health || 1000)}/{selection.data.maxHealth || 1000}</div>
          <div><span style={LABEL}>Owner:</span>{selection.data.ownerId ? selection.data.ownerId.slice(0, 8) : 'Unclaimed'}</div>
        </>
      )}

      {selection.data && selection.type === 'building' && (
        <div><span style={LABEL}>Health:</span>{Math.floor(selection.data.health || 200)}/{selection.data.maxHealth || 200}</div>
      )}

      {selection.data && selection.type === 'resource' && (
        <>
          <div><span style={LABEL}>Remaining:</span>{Math.ceil(selection.data.amount)}/{selection.data.maxAmount}</div>
          <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
            Hire villagers at your castle to gather this.
          </div>
        </>
      )}

      {selection.data && selection.type === 'intersection' && (
        <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px' }}>
          Pick a destination on the radial menu — your troops passing
          through will march that way.
        </div>
      )}
    </div>
  );
}
