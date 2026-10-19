---
name: Procedural world placement
description: Pixel Wilds' natural features should be generated from seeded terrain and local ecological conditions.
---

Natural features should not use hand-authored coordinate lists or predetermined placement. Seeded terrain and local conditions should determine where landforms, plants, and other wilderness features appear.

**Why:** The user explicitly said that game rules should decide where assets are placed instead of using predetermined assets.

**How to apply:** When adding natural world content, derive placement from the seed, biome, moisture, slope, soil, or other local terrain conditions, and keep results consistent across streamed chunk boundaries.
