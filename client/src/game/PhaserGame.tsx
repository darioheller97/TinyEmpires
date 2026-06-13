import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import GameScene, { SelectionInfo, MinimapData } from './GameScene';

interface Props {
  onResourceUpdate: (resources: { wood: number; food: number; gold: number; popUsed: number; popCap: number }) => void;
  onMapBounds: (bounds: { width: number; height: number }) => void;
  onSelectionChange: (selection: SelectionInfo) => void;
  onBuildingsUpdate?: (counts: Map<string, number>) => void;
  onTechsUpdate?: (techs: string[]) => void;
  onMinimapData?: (data: MinimapData) => void;
  onSceneReady?: (scene: GameScene) => void;
}

export default function PhaserGame({ onResourceUpdate, onMapBounds, onSelectionChange, onBuildingsUpdate, onTechsUpdate, onMinimapData, onSceneReady }: Props) {
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
        // Don't process pointer releases that happen over the DOM HUD
        input: { windowEvents: false },
        scene: [GameScene],
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

      game.registry.set('onResourceUpdate', onResourceUpdate);
      game.registry.set('onMapBounds', onMapBounds);
      game.registry.set('onSelectionChange', onSelectionChange);
      if (onBuildingsUpdate) game.registry.set('onBuildingsUpdate', onBuildingsUpdate);
      if (onTechsUpdate) game.registry.set('onTechsUpdate', onTechsUpdate);
      if (onMinimapData) game.registry.set('onMinimapData', onMinimapData);

      game.events.on('ready', () => {
        const scene = game.scene.getScene('GameScene') as GameScene;
        if (scene && onSceneReady) onSceneReady(scene);
      });
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
