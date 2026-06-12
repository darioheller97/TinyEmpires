import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import GameScene from './GameScene';

interface Props {
  onResourceUpdate: (resources: { wood: number; food: number; gold: number; popUsed: number; popCap: number }) => void;
  onMapBounds: (bounds: { width: number; height: number }) => void;
}

export default function PhaserGame({ onResourceUpdate, onMapBounds }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: window.innerWidth,
        height: window.innerHeight,
        parent: containerRef.current,
        backgroundColor: '#2d5a27',
        physics: {
          default: 'arcade',
          arcade: {
            gravity: { x: 0, y: 0 },
            debug: false,
          },
        },
        scene: [GameScene],
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

      // Expose callbacks to the scene via registry
      game.registry.set('onResourceUpdate', onResourceUpdate);
      game.registry.set('onMapBounds', onMapBounds);
    }

    const handleResize = () => {
      if (gameRef.current) {
        gameRef.current.scale.resize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
