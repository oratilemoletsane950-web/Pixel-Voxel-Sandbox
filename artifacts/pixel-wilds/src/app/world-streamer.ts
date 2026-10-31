/**
 * Browser-side chunk streamer: a tiny worker client around ChunkStreamPlanner.
 *
 * Only the page applies saved edits and publishes a new WorldData. The worker
 * never mutates React state and never sees the player's edit map.
 */
import { chunkKey, type Chunk } from "../game/chunk";
import { applyEditsToChunk } from "../game/world/streaming";
import { ChunkStreamPlanner, type ChunkPoint, type StreamLook } from "../game/world/stream-plan";
import type { WorldData } from "../game/world/types";

const BATCH_SIZE = 3;
const MAX_IN_FLIGHT = 2;
const POLL_MS = 60;

interface WorkerChunks {
  type: "chunks";
  requestId: number;
  chunks: Chunk[];
}

interface WorkerError {
  type: "error";
  requestId: number;
  message: string;
}

type WorkerResponse = WorkerChunks | WorkerError;

export class WorldStreamer {
  private readonly worker: Worker;
  private readonly planner: ChunkStreamPlanner;
  private timer: number | undefined;
  private requestId = 0;
  private inFlight = 0;
  private disposed = false;
  private readonly pending = new Map<number, Array<{ x: number; z: number }>>();

  constructor(
    private readonly options: {
      seed: number;
      radius: number;
      world: () => WorldData;
      center: () => ChunkPoint;
      look: () => StreamLook | null;
      onWorld: (world: WorldData) => void;
      onError?: (message: string) => void;
    },
  ) {
    this.planner = new ChunkStreamPlanner(options.radius);
    this.worker = new Worker(new URL("../game/world/chunk-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      this.options.onError?.(event.message || "Chunk worker stopped.");
    };
  }

  start(): void {
    if (this.disposed) return;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), POLL_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.worker.terminate();
  }

  private pump(): void {
    if (this.disposed || this.inFlight >= MAX_IN_FLIGHT) return;
    const world = this.options.world();
    const center = this.options.center();
    const pruned = this.planner.prune(world, center);
    const current = pruned ?? world;
    if (pruned) this.options.onWorld(pruned);

    const points = this.planner.missing(current, center, this.options.look(), BATCH_SIZE);
    if (points.length === 0) return;
    this.inFlight += 1;
    const requestId = ++this.requestId;
    this.pending.set(requestId, points.map(({ x, z }) => ({ x, z })));
    this.worker.postMessage({
      type: "generate",
      requestId,
      seed: current.seed,
      points: points.map(({ x, z }) => ({ x, z })),
    });
  }

  private receive(message: WorkerResponse): void {
    if (this.disposed) return;
    const points = this.pending.get(message.requestId);
    this.pending.delete(message.requestId);
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (!points) return;
    if (message.type === "error") {
      this.options.onError?.(message.message);
      this.pump();
      return;
    }

    const current = this.options.world();
    const chunks = { ...current.chunks };
    let changed = false;
    for (const chunk of message.chunks) {
      if (!points.some((point) => point.x === chunk.cx && point.z === chunk.cz)) continue;
      applyEditsToChunk(current, chunk);
      chunks[chunkKey(chunk.cx, chunk.cz)] = chunk;
      changed = true;
    }
    if (changed) this.options.onWorld({ ...current, chunks });
    this.pump();
  }
}
