import React from 'react';
import { PANEL, RIBBON, BUTTON, BUTTON_DISABLED, BUTTON_RED, ICONS, RES_ICON } from './skin';

export interface TechOption {
  id: string;
  name: string;
  desc: string;
  cost: number;
  category: string;
}

interface Props {
  visible: boolean;
  researched: string[];
  gold: number;
  techs: TechOption[];
  onResearch: (techId: string) => void;
  onClose: () => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, pointerEvents: 'auto',
};

const MODAL: React.CSSProperties = {
  ...PANEL,
  minWidth: '380px',
  maxWidth: '520px',
  maxHeight: '80vh',
  overflowY: 'auto',
  fontSize: '12px',
};

const TECH_BTN: React.CSSProperties = {
  ...BUTTON,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  textAlign: 'left',
  fontSize: '12px',
  marginBottom: '3px',
};

const TECH_BTN_OFF: React.CSSProperties = { ...TECH_BTN, ...BUTTON_DISABLED, width: '100%' };
const TECH_BTN_DONE: React.CSSProperties = { ...TECH_BTN, ...BUTTON_RED, width: '100%', cursor: 'default' };

const SMALL_ICON: React.CSSProperties = { ...RES_ICON, width: 18, height: 18 };

export default function TechTreeModal({ visible, researched, gold, techs, onResearch, onClose }: Props) {
  if (!visible) return null;

  const categories = [...new Set(techs.map(t => t.category))];

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={{ ...RIBBON, fontSize: '17px' }}>Tech Tree</div>
        <div style={{ fontSize: '12px', textAlign: 'center', marginBottom: '10px' }}>
          <img src={ICONS.gold} style={SMALL_ICON} alt="g" /> {Math.floor(gold)}
        </div>

        {categories.map(cat => (
          <div key={cat}>
            <div style={{ fontSize: '13px', margin: '8px 0 4px' }}>
              {cat === 'unit' ? '⚔️ Unit Upgrades' : '🏗️ Economy'}
            </div>
            {techs.filter(t => t.category === cat).map(tech => {
              const isResearched = researched.includes(tech.id);
              const canAfford = gold >= tech.cost;
              const style = isResearched ? TECH_BTN_DONE : canAfford ? TECH_BTN : TECH_BTN_OFF;
              return (
                <button
                  key={tech.id}
                  style={style}
                  onClick={() => { if (!isResearched && canAfford) onResearch(tech.id); }}
                >
                  <span>
                    <span style={{ display: 'block' }}>{tech.name}</span>
                    <span style={{ display: 'block', fontSize: '10px', opacity: 0.8, fontWeight: 400 }}>{tech.desc}</span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {isResearched ? '✓' : <><img src={ICONS.gold} style={SMALL_ICON} alt="g" />{tech.cost}</>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        <button style={{ ...BUTTON_RED, display: 'block', margin: '10px auto 0', fontSize: '12px' }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
