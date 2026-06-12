import React from 'react';

export interface SpawnOption {
  type: string;
  name: string;
  foodCost: number;
  goldCost: number;
}

interface Props {
  visible: boolean;
  resources: { food: number; gold: number; popUsed: number; popCap: number };
  onSpawn: (type: string) => void;
}

const PANEL: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.8)',
  border: '2px solid #8b6914',
  borderRadius: '8px',
  padding: '8px 12px',
  fontFamily: 'monospace',
  color: '#ffd700',
  minWidth: '200px',
};

const TITLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 'bold',
  marginBottom: '6px',
  borderBottom: '1px solid #555',
  paddingBottom: '4px',
};

const BUTTON: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  background: 'rgba(60, 40, 20, 0.8)',
  border: '1px solid #6b4f2e',
  borderRadius: '4px',
  color: '#ddd',
  padding: '5px 8px',
  marginBottom: '3px',
  cursor: 'pointer',
  fontSize: '11px',
  fontFamily: 'monospace',
};

const DISABLED_BUTTON: React.CSSProperties = {
  ...BUTTON,
  opacity: 0.4,
  cursor: 'not-allowed',
};

const SPAWN_OPTIONS: SpawnOption[] = [
  { type: 'knight', name: 'Knight', foodCost: 20, goldCost: 5 },
  { type: 'lancer', name: 'Lancer', foodCost: 15, goldCost: 0 },
  { type: 'archer', name: 'Archer', foodCost: 15, goldCost: 5 },
  { type: 'monk', name: 'Monk', foodCost: 25, goldCost: 10 },
];

export default function SpawnPanel({ visible, resources, onSpawn }: Props) {
  if (!visible) return null;

  return (
    <div style={PANEL}>
      <div style={TITLE}>Spawn Troops</div>
      <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '4px' }}>
        Pop: {resources.popUsed}/{resources.popCap}
      </div>
      {SPAWN_OPTIONS.map((opt) => {
        const canAfford = resources.food >= opt.foodCost && resources.gold >= opt.goldCost;
        const hasSpace = resources.popUsed < resources.popCap;
        const enabled = canAfford && hasSpace;
        return (
          <button
            key={opt.type}
            style={enabled ? BUTTON : DISABLED_BUTTON}
            disabled={!enabled}
            onClick={() => onSpawn(opt.type)}
          >
            <span>{opt.name}</span>
            <span>{opt.foodCost}F {opt.goldCost > 0 ? `${opt.goldCost}G` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
