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
  cooldownReadyIn: number; // seconds until this building can train again (0 = ready)
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

// Counter triangle (mirrors the server): knight ▶ archer ▶ lancer ▶ knight.
// Shown per unit so the player can compose against what they scout.
const COUNTER: Record<string, { strong: string; weak: string }> = {
  knight: { strong: 'Archers', weak: 'Lancers' },
  archer: { strong: 'Lancers', weak: 'Knights' },
  lancer: { strong: 'Knights', weak: 'Archers' },
};
const ROLE_NOTE: Record<string, string> = { monk: 'Heals nearby allies' };

function CounterLine({ type }: { type: string }) {
  const c = COUNTER[type];
  if (!c) {
    return <div style={COUNTER_ROW}>{ROLE_NOTE[type] || ''}</div>;
  }
  return (
    <div style={COUNTER_ROW}>
      <span style={{ color: '#2e7d32', fontWeight: 700 }}>▲ {c.strong}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ color: '#b5302a', fontWeight: 700 }}>▼ {c.weak}</span>
    </div>
  );
}

const COUNTER_ROW: React.CSSProperties = {
  display: 'flex', gap: '6px', alignItems: 'center',
  fontSize: '10px', margin: '0 2px 5px', opacity: 0.95,
};

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

export default function SpawnPanel({ visible, producer, resources, autoProduceType, cooldownReadyIn, onSpawn, onSetAutoProduce }: Props) {
  if (!visible) return null;
  const allowed = PRODUCES[producer] || [];
  const options = SPAWN_OPTIONS.filter(o => allowed.includes(o.type));
  if (options.length === 0) return null;
  const cooling = cooldownReadyIn > 0;

  return (
    <div style={WRAP}>
      <div style={{ ...RIBBON, fontSize: '13px' }}>{PRODUCER_NAMES[producer] || 'Train'}</div>
      <div style={{ fontSize: '10px', opacity: 0.85, marginBottom: '4px' }}>
        Pop {resources.popUsed}/{resources.popCap}
        {cooling
          ? <span style={{ color: '#b5302a', fontWeight: 700 }}> · recruiting… {cooldownReadyIn}s</span>
          : <span> · toggle = auto-train</span>}
      </div>
      {options.map((opt) => {
        const enabled = !cooling && resources.food >= opt.foodCost && resources.gold >= opt.goldCost
          && resources.popUsed < resources.popCap;
        const autoOn = autoProduceType === opt.type;
        const c = COUNTER[opt.type];
        const tip = c ? `${opt.name}: strong vs ${c.strong}, weak vs ${c.weak}`
          : ROLE_NOTE[opt.type] ? `${opt.name}: ${ROLE_NOTE[opt.type]}` : opt.name;
        return (
          <div key={opt.type} style={{ marginBottom: '4px' }}>
            <div style={ROW}>
              <button style={enabled ? SPAWN_BTN : SPAWN_BTN_OFF} disabled={!enabled} title={tip} onClick={() => onSpawn(opt.type)}>
                <span>{opt.name}</span>
                <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                  <span><img src={ICONS.food} style={SMALL_ICON} alt="f" />{opt.foodCost}</span>
                  {opt.goldCost > 0 && <span><img src={ICONS.gold} style={SMALL_ICON} alt="g" />{opt.goldCost}</span>}
                </span>
              </button>
              <button
                style={{ ...(autoOn ? BUTTON_RED : BUTTON), width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                title={autoOn ? 'Auto-train on — click to cancel' : 'Auto-train this unit'}
                onClick={() => onSetAutoProduce(autoOn ? '' : opt.type)}
              >
                {autoOn
                  ? <img src="/assets/UI/Icons/Regular_01.png" alt="cancel" width={18} height={18} style={{ imageRendering: 'pixelated', display: 'block' }} />
                  : <span style={{ fontSize: '11px', fontWeight: 700 }}>Auto</span>}
              </button>
            </div>
            <CounterLine type={opt.type} />
          </div>
        );
      })}
      <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '4px' }}>
        Right-click a road to aim <b>this building's</b> troops
      </div>
    </div>
  );
}
