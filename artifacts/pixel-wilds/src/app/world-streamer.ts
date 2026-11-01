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
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;

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
  private worker: Worker;
  private readonly planner: ChunkStreamPlanner;
  private timer: number | undefined;
  private requestId = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    { points: Array<{ x: number; z: number }>; timeout: number }
  >();
  /** Chunks that repeatedly failed, so one poison chunk cannot stall the ring. */
  private readonly attempts = new Map<string, number>();
  private readonly blocked = new Set<string>();

  constructor(
    private readonly options: {
      seed: number;
      radius: number;
      structures?: boolean;
      world: () => WorldData;
      center: () => ChunkPoint;
      look: () => StreamLook | null;
      onWorld: (world: WorldData) => void;
      onError?: (message: string) => void;
    },
  ) {
    this.planner = new ChunkStreamPlanner(options.radius);
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("../game/world/chunk-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (worker !== this.worker) return;
      this.receive(event.data);
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      this.options.onError?.(event.message || "Chunk worker stopped; restarting generation");
      this.restartWorker();
    };
    return worker;
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
    for (const request of this.pending.values()) window.clearTimeout(request.timeout);
    this.pending.clear();
    this.worker.terminate();
  }

  private pump(): void {
    if (this.disposed || this.pending.size >= MAX_IN_FLIGHT) return;
    const world = this.options.world();
    const center = this.options.center();
    const pruned = this.planner.prune(world, center);
    const current = pruned ?? world;
    if (pruned) this.options.onWorld(pruned);

    const candidates = this.planner.missing(
      current,
      center,
      this.options.look(),
      BATCH_SIZE + this.blocked.size,
    );
    const points = candidates
      .filter((point) => !this.blocked.has(chunkKey(point.x, point.z)))
      .slice(0, BATCH_SIZE)
      .map(({ x, z }) => ({ x, z }));
    if (points.length === 0) return;
    const requestId = ++this.requestId;
    const timeout = window.setTimeout(() => {
      if (this.disposed || !this.pending.has(requestId)) return;
      this.failRequest(requestId, "Chunk generation timed out");
      // A hung worker cannot process later requests; replace it so the rest
      // of the visible ring can still arrive.
      this.restartWorker();
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(requestId, { points, timeout });
    this.worker.postMessage({
      type: "generate",
      requestId,
      seed: current.seed,
      structures: current.structures ?? this.options.structures,
      points,
    });
  }

  private receive(message: WorkerResponse): void {
    if (this.disposed) return;
    const request = this.pending.get(message.requestId);
    if (!request) return;
    window.clearTimeout(request.timeout);
    this.pending.delete(message.requestId);
    if (message.type === "error") {
      this.failRequest(message.requestId, message.message, request);
      this.pump();
      return;
    }

    const current = this.options.world();
    const chunks = { ...current.chunks };
    let changed = false;
    for (const chunk of message.chunks) {
      if (!request.points.some((point) => point.x === chunk.cx && point.z === chunk.cz)) continue;
      applyEditsToChunk(current, chunk);
      chunks[chunkKey(chunk.cx, chunk.cz)] = chunk;
      changed = true;
    }
    if (changed) this.options.onWorld({ ...current, chunks });
    this.pump();
  }

  /**
   * Records a failed batch. A chunk is skipped only after repeated failures;
   * otherwise a single bad batch would be selected forever and no later chunk
   * in the prefetch ring would ever be requested.
   */
  private failRequest(
    requestId: number,
    message: string,
    request = this.pending.get(requestId),
  ): void {
    if (request) {
      window.clearTimeout(request.timeout);
      this.pending.delete(requestId);
    }
    if (!request) return;
    for (const point of request.points) {
      const key = chunkKey(point.x, point.z);
      const attempts = (this.attempts.get(key) ?? 0) + 1;
      this.attempts.set(key, attempts);
      if (attempts < MAX_ATTEMPTS) continue;
      this.blocked.add(key);
      this.options.onError?.(`${message} (skipping chunk ${point.x},${point.z})`);
    }
  }

  private restartWorker(): void {
    if (this.disposed) return;
    for (const requestId of [...this.pending.keys()]) {
      this.failRequest(requestId, "Chunk worker restarted");
    }
    this.worker.terminate();
    this.worker = this.createWorker();
    this.pump();
  }
}
