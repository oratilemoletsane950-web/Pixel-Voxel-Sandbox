/**
 * Stable public world API (`./game/world`).
 *
 * The implementation is split into `./world/*` submodules; this facade keeps
 * every historical import path working so the app, renderer, tests and
 * settlements do not need to know how the world module is organised.
 */
export * from "./world/index";
