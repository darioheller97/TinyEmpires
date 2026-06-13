import React from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_DISABLED, ICONS, RES_ICON } from './skin';

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
  resources: { wood: number; food: number; gold: number; popUsed: number; popCap: number };
  buildings: BuildOption[];
  onBuild: (type: string) => void;
  onUpgradeTownHall: () => void;
  onHireVillager: (resourceType: string) => void;
}

const WRAP: React.CSSProperties = {
  ...PANEL,
  minWidth: '340px',
  maxWidth: '460px',
};

const ROW_BTN: React.CSSProperties = {
  ...BUTTON,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  marginBottom: '2px',
  minHeight: '20px',
};

const ROW_BTN_OFF: React.CSSProperties = { ...ROW_BTN, ...BUTTON_DISABLED, width: '100%' };

const SMALL_ICON: React.CSSProperties = { ...RES_ICON, width: 20, height: 20 };

const VILLAGER_OPTIONS = [
  { resourceType: 'tree', name: '🪓 Woodcutter' },
  { resourceType: 'sheep', name: '🐑 Shepherd' },
  { resourceType: 'gold', name: '⛏️ Miner' },
];
const VILLAGER_COST = 15;

function canAfford(cost: { wood: number; food: number; gold: number }, r: { wood: number; food: number; gold: number }): boolean {
  return r.wood >= cost.wood && r.food >= cost.food && r.gold >= cost.gold;
}

function Cost({ cost }: { cost: { wood: number; food: number; gold: number } }) {
  return (
    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
      {cost.wood > 0 && <span><img src={ICONS.wood} style={SMALL_ICON} alt="w" /> {cost.wood}</span>}
      {cost.food > 0 && <span><img src={ICONS.food} style={SMALL_ICON} alt="f" /> {cost.food}</span>}
      {cost.gold > 0 && <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" /> {cost.gold}</span>}
    </span>
  );
}

export default function BuildMenu({ visible, cityName, townHallLevel, buildSlots, usedSlots, resources, buildings, onBuild, onUpgradeTownHall, onHireVillager }: Props) {
  if (!visible) return null;

  const slotsFull = usedSlots >= buildSlots;
  const upgradeCost = townHallLevel * 50;
  const canUpgrade = resources.gold >= upgradeCost;
  const popFree = resources.popUsed < resources.popCap;

  return (
    <div style={WRAP}>
      <div style={RIBBON}>{cityName} — Castle Lv.{townHallLevel}</div>
      <div style={{ fontSize: '12px', opacity: 0.85, marginBottom: '6px' }}>
        Building slots: {usedSlots}/{buildSlots}{slotsFull ? ' — upgrade the castle to expand' : ''}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ flex: 1 }}>
          {buildings.map((b) => {
            const enabled = canAfford(b.cost, resources) && !slotsFull;
            return (
              <button key={b.type} style={enabled ? ROW_BTN : ROW_BTN_OFF} disabled={!enabled} onClick={() => onBuild(b.type)}>
                <span>{b.name}</span>
                <Cost cost={b.cost} />
              </button>
            );
          })}
          <button
            style={canUpgrade ? ROW_BTN : ROW_BTN_OFF}
            disabled={!canUpgrade}
            onClick={onUpgradeTownHall}
          >
            <span>Upgrade Castle</span>
            <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" /> {upgradeCost}</span>
          </button>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', opacity: 0.85, marginBottom: '2px' }}>Hire villagers ({VILLAGER_COST} food):</div>
          {VILLAGER_OPTIONS.map(v => {
            const enabled = resources.food >= VILLAGER_COST && popFree;
            return (
              <button key={v.resourceType} style={enabled ? ROW_BTN : ROW_BTN_OFF} disabled={!enabled} onClick={() => onHireVillager(v.resourceType)}>
                <span>{v.name}</span>
                <span><img src={ICONS.food} style={SMALL_ICON} alt="f" /> {VILLAGER_COST}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
