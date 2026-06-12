import React from 'react';

export interface BuildOption {
  type: string;
  name: string;
  cost: { wood: number; food: number; gold: number };
}

interface Props {
  visible: boolean;
  cityName: string;
  townHallLevel: number;
  buildSlots: number;
  usedSlots: number;
  resources: { wood: number; food: number; gold: number };
  buildings: BuildOption[];
  onBuild: (type: string) => void;
  onUpgradeTownHall: () => void;
}

const PANEL: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.8)',
  border: '2px solid #8b6914',
  borderRadius: '8px',
  padding: '10px 14px',
  fontFamily: 'monospace',
  color: '#ffd700',
  minWidth: '280px',
  maxWidth: '400px',
};

const TITLE: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  marginBottom: '8px',
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
  padding: '6px 8px',
  marginBottom: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'monospace',
};

const DISABLED_BUTTON: React.CSSProperties = {
  ...BUTTON,
  opacity: 0.4,
  cursor: 'not-allowed',
};

const SLOT_INFO: React.CSSProperties = {
  fontSize: '11px',
  color: '#aaa',
  marginBottom: '6px',
};

const COST_STYLE: React.CSSProperties = {
  fontSize: '10px',
  color: '#aaa',
  marginLeft: '8px',
};

function canAfford(cost: { wood: number; food: number; gold: number }, resources: { wood: number; food: number; gold: number }): boolean {
  return resources.wood >= cost.wood && resources.food >= cost.food && resources.gold >= cost.gold;
}

export default function BuildMenu({ visible, cityName, townHallLevel, buildSlots, usedSlots, resources, buildings, onBuild, onUpgradeTownHall }: Props) {
  if (!visible) return null;

  const slotsFull = usedSlots >= buildSlots;
  const upgradeCost = townHallLevel * 50;
  const canUpgrade = resources.gold >= upgradeCost;

  return (
    <div style={PANEL}>
      <div style={TITLE}>{cityName} — Town Hall Lv.{townHallLevel}</div>
      <div style={SLOT_INFO}>Building slots: {usedSlots}/{buildSlots}</div>

      {slotsFull ? (
        <div style={{ color: '#ff6666', fontSize: '11px', marginBottom: '6px' }}>
          All building slots used. Upgrade Town Hall to expand.
        </div>
      ) : null}

      {buildings.map((b) => {
        const affordable = canAfford(b.cost, resources);
        const style = (affordable && !slotsFull) ? BUTTON : DISABLED_BUTTON;
        return (
          <button
            key={b.type}
            style={style}
            disabled={!affordable || slotsFull}
            onClick={() => onBuild(b.type)}
          >
            <span>
              {b.name}
              <span style={COST_STYLE}>
                ({b.cost.wood}W {b.cost.food}F {b.cost.gold}G)
              </span>
            </span>
            <span>+ Build</span>
          </button>
        );
      })}

      <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '6px' }}>
        <button
          style={canUpgrade ? { ...BUTTON, background: 'rgba(100, 80, 20, 0.8)', border: '1px solid #ffd700' } : { ...DISABLED_BUTTON }}
          disabled={!canUpgrade}
          onClick={onUpgradeTownHall}
        >
          <span>Upgrade Town Hall</span>
          <span>{upgradeCost}G</span>
        </button>
      </div>
    </div>
  );
}
