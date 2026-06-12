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
  autoProduceType: string;
  onSpawn: (type: string) => void;
  onSetAutoProduce: (troopType: string) => void;
}

const PANEL: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.8)',
  border: '2px solid #8b6914',
  borderRadius: '8px',
  padding: '8px 12px',
  fontFamily: 'monospace',
  color: '#ffd700',
  minWidth: '230px',
};

const TITLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 'bold',
  marginBottom: '6px',
  borderBottom: '1px solid #555',
  paddingBottom: '4px',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  marginBottom: '3px',
};

const BUTTON: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flex: 1,
  background: 'rgba(60, 40, 20, 0.8)',
  border: '1px solid #6b4f2e',
  borderRadius: '4px',
  color: '#ddd',
  padding: '5px 8px',
  cursor: 'pointer',
  fontSize: '11px',
  fontFamily: 'monospace',
};

const DISABLED_BUTTON: React.CSSProperties = {
  ...BUTTON,
  opacity: 0.4,
  cursor: 'not-allowed',
};

const AUTO_BTN: React.CSSProperties = {
  width: '34px',
  background: 'rgba(40, 40, 60, 0.8)',
  border: '1px solid #555',
  borderRadius: '4px',
  color: '#888',
  cursor: 'pointer',
  fontSize: '10px',
  fontFamily: 'monospace',
};

const AUTO_BTN_ON: React.CSSProperties = {
  ...AUTO_BTN,
  border: '1px solid #44cc44',
  color: '#44cc44',
  background: 'rgba(20, 60, 20, 0.8)',
};

const SPAWN_OPTIONS: SpawnOption[] = [
  { type: 'knight', name: 'Knight', foodCost: 20, goldCost: 5 },
  { type: 'lancer', name: 'Lancer', foodCost: 15, goldCost: 0 },
  { type: 'archer', name: 'Archer', foodCost: 15, goldCost: 5 },
  { type: 'monk', name: 'Monk', foodCost: 25, goldCost: 10 },
];

export default function SpawnPanel({ visible, resources, autoProduceType, onSpawn, onSetAutoProduce }: Props) {
  if (!visible) return null;

  return (
    <div style={PANEL}>
      <div style={TITLE}>Barracks — Spawn Troops</div>
      <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '4px' }}>
        Pop: {resources.popUsed}/{resources.popCap} · AUTO re-trains every 6s
      </div>
      {SPAWN_OPTIONS.map((opt) => {
        const canAfford = resources.food >= opt.foodCost && resources.gold >= opt.goldCost;
        const hasSpace = resources.popUsed < resources.popCap;
        const enabled = canAfford && hasSpace;
        const autoOn = autoProduceType === opt.type;
        return (
          <div style={ROW} key={opt.type}>
            <button
              style={enabled ? BUTTON : DISABLED_BUTTON}
              disabled={!enabled}
              onClick={() => onSpawn(opt.type)}
            >
              <span>{opt.name}</span>
              <span>{opt.foodCost}F {opt.goldCost > 0 ? `${opt.goldCost}G` : ''}</span>
            </button>
            <button
              style={autoOn ? AUTO_BTN_ON : AUTO_BTN}
              title={autoOn ? 'Auto-produce on — click to stop' : 'Auto-produce this unit'}
              onClick={() => onSetAutoProduce(autoOn ? '' : opt.type)}
            >
              {autoOn ? '⟳ON' : '⟳'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
