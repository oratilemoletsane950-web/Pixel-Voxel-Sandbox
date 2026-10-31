/**
 * Full-screen regional map and waypoint planner.
 *
 * The canvas is painted from the chunks currently held by the world session.
 * The HUD owns no map state: the screen supplies waypoints and callbacks, so
 * the same panel can later render a cached exploration atlas without changing
 * the rendering contract.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { BLOCK_TYPES } from "../game/blocks";
import { CHUNK_SIZE, chunkIndex } from "../game/chunk";
import type { Waypoint, WaypointPoint } from "../game/map/waypoints";
import { sortWaypoints, waypointDistance } from "../game/map/waypoints";
import type { Position } from "../game/physics";
import type { WorldData } from "../game/world";
import { BLOCK_COLORS } from "./block-palette";

const MAP_PIXELS = 720;

export function MapPanel({
  open,
  world,
  player,
  heading,
  waypoints,
  onAdd,
  onRemove,
  onClose,
}: {
  open: boolean;
  world: WorldData;
  player: Position | null;
  heading: number;
  waypoints: Waypoint[];
  onAdd: (point: WaypointPoint, label: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [label, setLabel] = useState("");

  const bounds = useMemo(() => {
    const chunks = Object.values(world.chunks);
    if (chunks.length === 0) return null;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const chunk of chunks) {
      minX = Math.min(minX, chunk.cx);
      minZ = Math.min(minZ, chunk.cz);
      maxX = Math.max(maxX, chunk.cx);
      maxZ = Math.max(maxZ, chunk.cz);
    }
    return {
      minX: minX * CHUNK_SIZE,
      minZ: minZ * CHUNK_SIZE,
      blocksX: (maxX - minX + 1) * CHUNK_SIZE,
      blocksZ: (maxZ - minZ + 1) * CHUNK_SIZE,
    };
  }, [world]);

  const scale = bounds
    ? Math.max(1.5, Math.min(4, MAP_PIXELS / Math.max(bounds.blocksX, bounds.blocksZ)))
    : 3;

  const ordered = useMemo(
    () => sortWaypoints(waypoints, player ?? { x: 0, y: 0, z: 0 }),
    [player, waypoints],
  );

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;
    const width = Math.ceil(bounds.blocksX * scale);
    const height = Math.ceil(bounds.blocksZ * scale);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#17342c";
    context.fillRect(0, 0, width, height);

    for (const chunk of Object.values(world.chunks)) {
      const originX = (chunk.cx * CHUNK_SIZE - bounds.minX) * scale;
      const originZ = (chunk.cz * CHUNK_SIZE - bounds.minZ) * scale;
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          let block: string | undefined;
          for (let y = chunk.maxY; y >= 0; y -= 1) {
            const id = chunk.blocks[chunkIndex(lx, y, lz)];
            if (id !== 0) {
              block = BLOCK_TYPES[id];
              break;
            }
          }
          if (!block) continue;
          const color = BLOCK_COLORS[block as keyof typeof BLOCK_COLORS]?.[0] ?? "#6f8577";
          context.fillStyle = color;
          context.fillRect(originX + lx * scale, originZ + lz * scale, Math.ceil(scale), Math.ceil(scale));
        }
      }
    }

    if (player) {
      const px = (player.x - bounds.minX) * scale;
      const pz = (player.z - bounds.minZ) * scale;
      context.save();
      context.translate(px, pz);
      context.rotate(heading);
      context.fillStyle = "#fff7df";
      context.strokeStyle = "#17342c";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, -8);
      context.lineTo(6, 6);
      context.lineTo(0, 3);
      context.lineTo(-6, 6);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }

    for (const waypoint of waypoints) {
      const wx = (waypoint.x - bounds.minX) * scale;
      const wz = (waypoint.z - bounds.minZ) * scale;
      context.beginPath();
      context.arc(wx, wz, 6, 0, Math.PI * 2);
      context.fillStyle = waypoint.color;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = "#fff7df";
      context.stroke();
    }
  }, [bounds, heading, open, player, scale, waypoints, world]);

  if (!open) return null;

  const addAt = (point: WaypointPoint) => {
    onAdd(point, label);
    setLabel("");
  };

  return (
    <section className="map-overlay" role="dialog" aria-modal="true" aria-labelledby="map-title" data-testid="panel-map">
      <header className="map-head">
        <div>
          <p className="menu-eyebrow">Explored region</p>
          <h2 id="map-title">World map</h2>
        </div>
        <button className="chip" type="button" onClick={onClose} data-testid="button-close-map">
          Close · M
        </button>
      </header>

      <div className="map-body">
        <div className="map-canvas-wrap">
          {bounds ? (
            <canvas
              ref={canvasRef}
              className="map-canvas"
              style={{ aspectRatio: `${bounds.blocksX} / ${bounds.blocksZ}` }}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.blocksX;
                const z = bounds.minZ + ((event.clientY - rect.top) / rect.height) * bounds.blocksZ;
                addAt({ x, y: player?.y ?? 0, z });
              }}
              data-testid="canvas-world-map"
            />
          ) : (
            <p className="map-empty">Walk a little and the land will appear here.</p>
          )}
          <p className="map-hint">Click the map to pin a waypoint · north is up · M closes</p>
        </div>

        <aside className="map-side">
          <label className="field">
            <span>Waypoint name</span>
            <input
              value={label}
              maxLength={28}
              placeholder="Lookout point"
              onChange={(event) => setLabel(event.target.value)}
              data-testid="input-waypoint-name"
            />
          </label>
          <button
            className="menu-action is-primary is-compact"
            type="button"
            disabled={!player}
            onClick={() => player && addAt(player)}
            data-testid="button-add-waypoint"
          >
            <strong>Pin here</strong>
            <span>at your current position</span>
          </button>

          <div className="map-waypoints">
            {ordered.length === 0 ? (
              <p className="map-empty">No waypoints yet.</p>
            ) : (
              ordered.map((waypoint) => (
                <div className="map-waypoint" key={waypoint.id}>
                  <span className="map-dot" style={{ background: waypoint.color }} />
                  <span className="map-waypoint-body">
                    <strong>{waypoint.label}</strong>
                    <small>
                      {waypoint.x.toFixed(0)}, {waypoint.z.toFixed(0)}
                      {player ? ` · ${waypointDistance(waypoint, player).toFixed(0)} m` : ""}
                    </small>
                  </span>
                  <button
                    className="chip is-quiet"
                    type="button"
                    aria-label={`Delete ${waypoint.label}`}
                    onClick={() => onRemove(waypoint.id)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
