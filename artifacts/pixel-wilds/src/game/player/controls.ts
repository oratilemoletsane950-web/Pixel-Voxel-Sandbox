/**
 * Player-facing tuning constants.
 *
 * Kept in one place so input handling (App), the 3D renderer (GameWorld) and
 * the 2D fallback all agree on reach, turn speed and double-tap timing.
 */

/** Block-interaction reach: 4 m (8 blocks), a comfortable arm-plus-tool distance. */
export const REACH_BLOCKS = 8;
/** Arrow-key turning speed, radians per second (about 150°/s). */
export const TURN_SPEED = 2.6;
/** Two quick taps trigger a movement action (Space = flight, W = forward sprint). */
export const DOUBLE_TAP_MS = 340;
export const HOTBAR_SLOTS = 10;
export const RENDER_RADIUS_KEY = 'pixel-wilds-render-radius';
