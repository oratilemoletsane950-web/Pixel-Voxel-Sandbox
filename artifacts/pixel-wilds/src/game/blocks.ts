/**
 * Public block API.
 *
 * This file is the stable import path: `./game/blocks`. Internals live in
 * `./blocks/*` and can be reorganised without touching the game, the mesher,
 * the renderer or the tests.
 */
export * from "./blocks/types";
export * from "./blocks/registry";
export * from "./blocks/atlas";
export { BLOCK_DEFINITIONS, defineBlock } from "./blocks/definitions";
export type { BlockDefinition, BlockTraits, BlockIdentity } from "./blocks/definitions";
