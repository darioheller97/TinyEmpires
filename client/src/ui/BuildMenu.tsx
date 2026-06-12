import React from 'react';
import { PANEL, BUTTON, BUTTON_DISABLED, ICONS, RES_ICON } from './skin';

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

const WRAP: React.CSSProperties = {
  ...PANEL,
  minWidth: '300px',
  maxWidth: '420px',
  fontSize: '13px',
};

const TITLE: React.CSSProperties = {
  fontSize: '14px',
  marginBottom: '6px',
  borderBottom: '2px solid rgba(74,47,20,0.3)',
  paddingBottom: '4px',
};

const ROW_BTN: React.CSSProperties = {
  ...BUTTON,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  fontSize: '12px',
  marginBottom: '2px',
};

const ROW_BTN_OFF: React.CSSProperties = {
  ...BUTTON_DISABLED,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  fontSize: '12px',
  marginBottom: '2px',
};

const SMALL_ICON: React.CSSProperties = { ...RES_ICON, width: 18, height: 18 };

function canAfford(cost: { wood: number; food: number; gold: number }, resources: { wood: number; food: number; gold: number }): boolean {
  return resources.wood >= cost.wood && resources.food >= cost.food && resources.gold >= cost.gold;
}

function Cost({ cost }: { cost: { wood: number; food: number; gold: number } }) {
  return (
    <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
      {cost.wood > 0 && <span><img src={ICONS.wood} style={SMALL_ICON} alt="w" />{cost.wood}</span>}
      {cost.food > 0 && <span><img src={ICONS.food} style={SMALL_ICON} alt="f" />{cost.food}</span>}
      {cost.gold > 0 && <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" />{cost.gold}</span>}
    </span>
  );
}

export default function BuildMenu({ visible, cityName, townHallLevel, buildSlots, usedSlots, resources, buildings, onBuild, onUpgradeTownHall }: Props) {
  if (!visible) return null;

  const slotsFull = usedSlots >= buildSlots;
  const upgradeCost = townHallLevel * 50;
  const canUpgrade = resources.gold >= upgradeCost;

  return (
    <div style={WRAP}>
      <div style={TITLE}>{cityName} — Castle Lv.{townHallLevel}</div>
      <div style={{ fontSize: '11px', opacity: 0.8, marginBottom: '6px' }}>
        Building slots: {usedSlots}/{buildSlots}
        {slotsFull ? ' — upgrade the castle to expand' : ''}
      </div>

      {buildings.map((b) => {
        const enabled = canAfford(b.cost, resources) && !slotsFull;
        return (
          <button
            key={b.type}
            style={enabled ? ROW_BTN : ROW_BTN_OFF}
            disabled={!enabled}
            onClick={() => onBuild(b.type)}
          >
            <span>{b.name}</span>
            <Cost cost={b.cost} />
          </button>
        );
      })}

      <button
        style={canUpgrade ? { ...ROW_BTN, marginTop: '8px' } : { ...ROW_BTN_OFF, marginTop: '8px' }}
        disabled={!canUpgrade}
        onClick={onUpgradeTownHall}
      >
        <span>Upgrade Castle</span>
        <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" />{upgradeCost}</span>
      </button>
    </div>
  );
}
