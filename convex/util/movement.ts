import { WorldMap } from '../aiTown/worldMap';
import { HomeRegion } from '../../data/characters';

/** Pick a wander tile; if home is set, stay inside that radius (clamped to map). */
export function wanderDestination(worldMap: WorldMap, home?: HomeRegion) {
  if (home) {
    const radius = Math.max(1, home.radius);
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const x = Math.round(home.x + Math.cos(angle) * dist);
      const y = Math.round(home.y + Math.sin(angle) * dist);
      if (x >= 1 && y >= 1 && x < worldMap.width - 1 && y < worldMap.height - 1) {
        return { x, y };
      }
    }
    return {
      x: Math.min(worldMap.width - 2, Math.max(1, Math.round(home.x))),
      y: Math.min(worldMap.height - 2, Math.max(1, Math.round(home.y))),
    };
  }
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
