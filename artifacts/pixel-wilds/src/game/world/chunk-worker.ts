/**
 * Off-main-thread chunk generation.
 *
 * The worker owns one seed's Terrain instance. It receives small batches of
 * coordinates and returns generated chunks with their typed arrays transferred
 * back to the page. Saved edits are applied on the main thread because edits
 * belong to the session, not to the deterministic generator.
 */
import type { Chunk } from "../chunk";
import { generateChunk } from "../worldgen/generate";
import { getTerrain } from "./terrain-registry";

interface GenerateRequest {
  type: "generate";
  requestId: number;
  seed: number;
  structures?: boolean;
  points: Array<{ x: number; z: number }>;
}

type WorkerRequest = GenerateRequest;

interface GenerateResponse {
  type: "chunks";
  requestId: number;
  chunks: Chunk[];
}

interface ErrorResponse {
  type: "error";
  requestId: number;
  message: string;
}

type WorkerResponse = GenerateResponse | ErrorResponse;

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || request.type !== "generate") return;
  try {
    const terrain = getTerrain(request.seed);
    const chunks: Chunk[] = [];
    for (const point of request.points) {
      chunks.push(generateChunk(terrain, point.x, point.z, { structures: request.structures }));
    }
    scope.postMessage(
      { type: "chunks", requestId: request.requestId, chunks },
      chunks.map((chunk) => chunk.blocks.buffer as ArrayBuffer),
    );
  } catch (error) {
    scope.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Chunk generation failed.",
    });
  }
};
