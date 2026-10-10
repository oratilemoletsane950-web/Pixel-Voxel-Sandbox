---
name: WebGL fallback
description: Why the voxel game includes a 2D renderer as a fallback to the 3D WebGL scene.
---

When WebGL2 is unavailable, keep the voxel world playable through the 2D isometric canvas fallback rather than showing a renderer error.

**Why:** the built-in preview capture browser could not create a WebGL context, so the initial 3D-only app showed an error screen despite the game's frontend loading.

**How to apply:** preserve the 2D fallback when modifying rendering or interactions, and verify that both rendering paths continue to use the same world state.
