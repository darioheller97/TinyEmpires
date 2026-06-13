import React from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_DISABLED, BUTTON_RED, ICONS, RES_ICON } from './skin';

export interface SpawnOption {
  type: string;
  name: string;
  foodCost: number;
  goldCost: number;
}

interface Props {
  visible: boolean;
  producer: string; // building type: barracks | archery | church
  resources: { food: number; gold: number; popUsed: number; popCap: number };
  autoProduceType: string;
  onSpawn: (type: string) => void;
  onSetAutoProduce: (troopType: string) => void;
}

// What each production building can train, and its display name.
const PRODUCES: Record<string, string[]> = {
  barracks: ['knight', 'lancer'],
  archery: ['archer'],
  church: ['monk'],
};
const PRODUCER_NAMES: Record<string, string> = { barracks: 'Barracks', archery: 'Archery', church: 'Church' };

const WRAP: React.CSSProperties = {
  ...PANEL,
  minWidth: '250px',
  fontSize: '12px',
};

const ROW: React.CSSProperties = { display: 'flex', gap: '4px', marginBottom: '2px' };

const SPAWN_BTN: React.CSSProperties = {
  ...BUTTON,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flex: 1,
  fontSize: '12px',
};

const SPAWN_BTN_OFF: React.CSSProperties = {
  ...BUTTON_DISABLED,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flex: 1,
  fontSize: '12px',
};

const SMALL_ICON: React.CSSProperties = { ...RES_ICON, width: 18, height: 18 };

const SPAWN_OPTIONS: SpawnOption[] = [
  { type: 'knight', name: 'Knight', foodCost: 20, goldCost: 5 },
  { type: 'lancer', name: 'Lancer', foodCost: 15, goldCost: 0 },
  { type: 'archer', name: 'Archer', foodCost: 15, goldCost: 5 },
  { type: 'monk', name: 'Monk', foodCost: 25, goldCost: 10 },
];

export default function SpawnPanel({ visible, producer, resources, autoProduceType, onSpawn, onSetAutoProduce }: Props) {
  if (!visible) return null;
  const allowed = PRODUCES[producer] || [];
  const options = SPAWN_OPTIONS.filter(o => allowed.includes(o.type));
  if (options.length === 0) return null;

  return (
    <div style={WRAP}>
      <div style={{ ...RIBBON, fontSize: '13px' }}>{PRODUCER_NAMES[producer] || 'Train'}</div>
      <div style={{ fontSize: '10px', opacity: 0.8, marginBottom: '4px' }}>
        Pop {resources.popUsed}/{resources.popCap} · ⟳ auto-trains every 6s
      </div>
      {options.map((opt) => {
        const enabled = resources.food >= opt.foodCost && resources.gold >= opt.goldCost
          && resources.popUsed < resources.popCap;
        const autoOn = autoProduceType === opt.type;
        return (
          <div style={ROW} key={opt.type}>
            <button style={enabled ? SPAWN_BTN : SPAWN_BTN_OFF} disabled={!enabled} onClick={() => onSpawn(opt.type)}>
              <span>{opt.name}</span>
              <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                <span><img src={ICONS.food} style={SMALL_ICON} alt="f" />{opt.foodCost}</span>
                {opt.goldCost > 0 && <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" />{opt.goldCost}</span>}
              </span>
            </button>
            <button
              style={{ ...(autoOn ? BUTTON_RED : BUTTON), width: '46px', fontSize: '11px' }}
              title={autoOn ? 'Auto-produce on — click to stop' : 'Auto-produce this unit'}
              onClick={() => onSetAutoProduce(autoOn ? '' : opt.type)}
            >
              {autoOn ? '⟳on' : '⟳'}
            </button>
          </div>
        );
      })}
      <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px' }}>
        🚩 Right-click a road to set the rally point
      </div>
    </div>
  );
}
