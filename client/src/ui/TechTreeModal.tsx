import React from 'react';

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
  background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, pointerEvents: 'auto',
};

const MODAL: React.CSSProperties = {
  background: 'rgba(20, 15, 8, 0.95)', border: '3px solid #8b6914',
  borderRadius: '12px', padding: '20px', fontFamily: 'monospace',
  color: '#ffd700', minWidth: '340px', maxWidth: '500px',
  maxHeight: '80vh', overflowY: 'auto',
};

const TITLE: React.CSSProperties = {
  fontSize: '18px', fontWeight: 'bold', textAlign: 'center',
  borderBottom: '2px solid #8b6914', paddingBottom: '10px', marginBottom: '12px',
};

const TECH_BUTTON: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  width: '100%', background: 'rgba(60,40,20,0.8)', border: '1px solid #6b4f2e',
  borderRadius: '6px', color: '#ddd', padding: '8px 12px',
  marginBottom: '6px', cursor: 'pointer', fontSize: '12px',
  fontFamily: 'monospace', textAlign: 'left',
};

const DISABLED_BUTTON: React.CSSProperties = {
  ...TECH_BUTTON, opacity: 0.35, cursor: 'not-allowed',
};

const DONE_BUTTON: React.CSSProperties = {
  ...TECH_BUTTON, border: '1px solid #44cc44', background: 'rgba(20,60,20,0.8)',
  cursor: 'default',
};

const CLOSE: React.CSSProperties = {
  display: 'block', margin: '12px auto 0', background: 'rgba(100,20,20,0.8)',
  border: '1px solid #cc4444', borderRadius: '4px', color: '#ddd',
  padding: '6px 20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px',
};

const CAT_HEADER: React.CSSProperties = {
  fontSize: '14px', color: '#ffd700', margin: '10px 0 6px', fontWeight: 'bold',
};

export default function TechTreeModal({ visible, researched, gold, techs, onResearch, onClose }: Props) {
  if (!visible) return null;

  const categories = [...new Set(techs.map(t => t.category))];

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={TITLE}>Tech Tree</div>
        <div style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', marginBottom: '10px' }}>
          Gold: {Math.floor(gold)}
        </div>

        {categories.map(cat => (
          <div key={cat}>
            <div style={CAT_HEADER}>{cat === 'unit' ? '⚔️ Unit Upgrades' : '🏗️ Economy'}</div>
            {techs.filter(t => t.category === cat).map(tech => {
              const isResearched = researched.includes(tech.id);
              const canAfford = gold >= tech.cost;
              let style: React.CSSProperties;
              if (isResearched) style = DONE_BUTTON;
              else if (canAfford) style = TECH_BUTTON;
              else style = DISABLED_BUTTON;

              return (
                <div
                  key={tech.id}
                  style={style}
                  onClick={() => { if (!isResearched && canAfford) onResearch(tech.id); }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{tech.name}</div>
                    <div style={{ fontSize: '10px', color: '#999' }}>{tech.desc}</div>
                  </div>
                  <div style={{ color: isResearched ? '#44cc44' : '#ffd700', whiteSpace: 'nowrap' }}>
                    {isResearched ? '✓ DONE' : `${tech.cost}G`}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <button style={CLOSE} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
