import * as THREE from "three";
import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  BLOCK_ID,
  BLOCK_INFO,
  FACE_BOTTOM,
  FACE_SIDE,
  FACE_TOP,
  TILES_PER_BLOCK,
  TILE_SIZE,
  WORLD_BLOCK_TYPES,
  tileIndex,
  type BlockInfo,
} from "./blocks";

/**
 * Procedural 16 x 16 pixel textures, packed into a single atlas so a whole
 * chunk can be drawn with one material. Three tiles per block: side, top, bottom.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

type Ctx = CanvasRenderingContext2D;

function drawTile(ctx: Ctx, ox: number, oy: number, info: BlockInfo, face: number, seed: number): void {
  const rand = rng(seed);
  const S = TILE_SIZE;
  const [sideColor, topColor] = info.colors;
  const base = face === FACE_TOP ? topColor : sideColor;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  };
  const fill = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox, oy, S, S);
  };
  const speckle = (amount: number, palette: string[] = info.speckle) => {
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const roll = rand();
        if (roll < amount) px(x, y, palette[Math.floor(rand() * palette.length)]);
        else if (roll < amount + 0.25) px(x, y, shade(base, 0.93 + rand() * 0.14));
      }
    }
  };

  switch (info.pattern) {
    case "grass": {
      const dirt = BLOCK_INFO.dirt;
      if (face === FACE_TOP) {
        fill(topColor);
        speckle(0.3, ["#6f9248", "#9ab868", "#5f8240"]);
      } else if (face === FACE_BOTTOM) {
        fill(dirt.colors[0]);
        speckle(0.3, dirt.speckle);
      } else {
        fill(dirt.colors[0]);
        speckle(0.3, dirt.speckle);
        for (let x = 0; x < S; x += 1) {
          const depth = 3 + Math.floor(rand() * 3);
          for (let y = 0; y < depth; y += 1) px(x, y, y === depth - 1 ? "#6f9248" : rand() < 0.3 ? "#9ab868" : topColor);
        }
      }
      break;
    }
    case "log": {
      if (face === FACE_SIDE || (face !== FACE_TOP && face !== FACE_BOTTOM)) {
        fill(sideColor);
        for (let x = 0; x < S; x += 1) {
          const dark = rand() < 0.35;
          for (let y = 0; y < S; y += 1) {
            if (dark && rand() < 0.8) px(x, y, info.speckle[0]);
            else if (rand() < 0.12) px(x, y, info.speckle[2]);
          }
        }
      } else {
        fill(topColor);
        for (let y = 0; y < S; y += 1) {
          for (let x = 0; x < S; x += 1) {
            const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
            if (d > 6) px(x, y, sideColor);
            else if (Math.floor(d) % 2 === 1) px(x, y, shade(topColor, 0.82));
          }
        }
      }
      break;
    }
    case "planks": {
      fill(base);
      for (let row = 0; row < 4; row += 1) {
        const y = row * 4 + 3;
        for (let x = 0; x < S; x += 1) px(x, y, shade(base, 0.72));
        const seam = Math.floor(rand() * S);
        for (let k = 0; k < 3; k += 1) px(seam, row * 4 + k, shade(base, 0.8));
        for (let k = 0; k < 6; k += 1) px(Math.floor(rand() * S), row * 4 + Math.floor(rand() * 3), shade(base, 0.9 + rand() * 0.2));
      }
      break;
    }
    case "bricks": {
      fill(base);
      const mortar = face === FACE_TOP ? shade(base, 1.1) : shade(info.name === "brick" ? "#cfc8b8" : "#b4b6a8", 1);
      for (let row = 0; row < 4; row += 1) {
        const y = row * 4;
        for (let x = 0; x < S; x += 1) px(x, y, mortar);
        const offset = row % 2 === 0 ? 0 : 4;
        for (let x = offset; x < S + 8; x += 8) for (let k = 1; k < 4; k += 1) if (x < S) px(x, y + k, mortar);
        for (let k = 0; k < 8; k += 1) px(Math.floor(rand() * S), y + 1 + Math.floor(rand() * 3), shade(base, 0.9 + rand() * 0.2));
      }
      break;
    }
    case "cobble": {
      const points = Array.from({ length: 7 }, () => [rand() * S, rand() * S, 0.82 + rand() * 0.3]);
      for (let y = 0; y < S; y += 1) {
        for (let x = 0; x < S; x += 1) {
          let best = 99; let second = 99; let tone = 1;
          for (const [qx, qy, t] of points) {
            for (const wx of [-S, 0, S]) for (const wy of [-S, 0, S]) {
              const d = Math.hypot(x - (qx + wx), y - (qy + wy));
              if (d < best) { second = best; best = d; tone = t; } else if (d < second) second = d;
            }
          }
          px(x, y, second - best < 1.3 ? shade(base, 0.62) : shade(base, tone));
        }
      }
      break;
    }
    case "ore": {
      fill(base);
      speckle(0.25);
      for (let k = 0; k < 6; k += 1) {
        const cx = 1 + Math.floor(rand() * 13);
        const cy = 1 + Math.floor(rand() * 13);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (rand() < 0.85) px(cx + dx, cy + dy, info.fleck ?? "#000");
      }
      break;
    }
    case "leaves": {
      fill(base);
      for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
        const roll = rand();
        if (roll < 0.28) px(x, y, info.speckle[1]);
        else if (roll < 0.55) px(x, y, info.speckle[0]);
        else if (roll < 0.62) px(x, y, shade(base, 0.7));
      }
      break;
    }
    case "cactus": {
      fill(base);
      for (const x of [2, 7, 8, 13]) for (let y = 0; y < S; y += 1) px(x, y, shade(base, 0.78));
      for (let k = 0; k < 14; k += 1) px(Math.floor(rand() * S), Math.floor(rand() * S), "#d8e6a6");
      if (face === FACE_TOP) { fill(topColor); for (let k = 0; k < 10; k += 1) px(Math.floor(rand() * S), Math.floor(rand() * S), shade(base, 0.8)); }
      break;
    }
    case "thatch": {
      fill(base);
      for (let y = 0; y < S; y += 1) {
        for (let x = 0; x < S; x += 1) if (rand() < 0.45) px(x, y, rand() < 0.5 ? info.speckle[0] : info.speckle[1]);
        if (y % 3 === 2) for (let x = 0; x < S; x += 1) px(x, y, shade(base, 0.78));
      }
      break;
    }
    case "farmland": {
      if (face === FACE_TOP) {
        fill(topColor);
        for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
          if (y % 4 === 1) px(x, y, shade(topColor, 0.62));
          else if (rand() < 0.2) px(x, y, info.speckle[0]);
        }
      } else { fill(sideColor); speckle(0.3); }
      break;
    }
    case "shingles": {
      fill(base);
      for (let row = 0; row < 4; row += 1) {
        const y = row * 4;
        for (let x = 0; x < S; x += 1) px(x, y + 3, shade(base, 0.62));
        const offset = row % 2 === 0 ? 0 : 4;
        for (let x = offset; x < S; x += 8) for (let k = 0; k < 3; k += 1) px(x, y + k, shade(base, 0.72));
        for (let k = 0; k < 6; k += 1) px(Math.floor(rand() * S), y + Math.floor(rand() * 3), shade(base, 1.05 + rand() * 0.15));
      }
      break;
    }
    case "water": {
      fill(base);
      for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
        const wave = Math.sin((x + y * 0.7) * 0.9 + seed) * 0.5 + 0.5;
        if (wave > 0.82) px(x, y, info.speckle[0]);
        else if (rand() < 0.1) px(x, y, info.speckle[2]);
      }
      break;
    }
    case "glass": {
      fill(topColor);
      for (let i = 0; i < S; i += 1) { px(i, 0, sideColor); px(i, S - 1, sideColor); px(0, i, sideColor); px(S - 1, i, sideColor); }
      for (let i = 3; i < 9; i += 1) px(i, 12 - i, "#ffffff");
      break;
    }
    case "flower": {
      fill(topColor);
      speckle(0.25, ["#6f9a5a", "#93b56a", "#4f7c4f"]);
      const colors = ["#f4d276", "#d8796e", "#e9e9f2", "#a98bd8"];
      for (let k = 0; k < 4; k += 1) {
        const cx = 2 + Math.floor(rand() * 11);
        const cy = 2 + Math.floor(rand() * 11);
        const color = colors[Math.floor(rand() * colors.length)];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px(cx + dx, cy + dy, color);
        px(cx, cy + 2, "#3f6a3f");
      }
      break;
    }
    case "wheat": {
      fill(sideColor);
      for (let x = 0; x < S; x += 2) {
        for (let y = 0; y < S; y += 1) px(x, y, y < 5 ? "#e7d25f" : shade(topColor, 0.85 + rand() * 0.2));
      }
      break;
    }
    case "bedrock": {
      fill(base);
      for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) px(x, y, info.speckle[Math.floor(rand() * 3)]);
      break;
    }
    case "bands": {
      fill(base);
      for (let y = 0; y < S; y += 1) {
        const band = Math.floor(y / 3) % 2 === 0;
        for (let x = 0; x < S; x += 1) {
          if (band && rand() < 0.5) px(x, y, info.speckle[1]);
          else if (rand() < 0.2) px(x, y, info.speckle[0]);
        }
      }
      break;
    }
    case "snow": {
      fill(face === FACE_TOP ? "#f2f4e4" : "#e4eaea");
      for (let k = 0; k < 24; k += 1) px(Math.floor(rand() * S), Math.floor(rand() * S), rand() < 0.5 ? "#cfdde6" : "#ffffff");
      break;
    }
    case "door": {
      // A ledged plank door: frame, two recessed panels, an iron latch.
      fill(base);
      const frame = shade(base, 0.62);
      const edge = shade(base, 0.8);
      for (let i = 0; i < S; i += 1) {
        px(i, 0, frame); px(i, S - 1, frame); px(0, i, frame); px(S - 1, i, frame);
        px(i, 1, shade(base, 0.78)); px(i, S - 2, shade(base, 0.78));
      }
      if (face !== FACE_TOP && face !== FACE_BOTTOM) {
        for (const [y0, y1] of [[2, 7], [9, 14]]) {
          for (let x = 3; x <= 12; x += 1) { px(x, y0, frame); px(x, y1, frame); }
          for (let y = y0; y <= y1; y += 1) { px(3, y, frame); px(12, y, frame); }
          for (let y = y0 + 1; y < y1; y += 1) for (let x = 4; x < 12; x += 1) {
            if (rand() < 0.18) px(x, y, edge);
          }
        }
        px(11, 8, "#d8b04a");
        px(12, 8, "#b98f36");
      }
      break;
    }
    case "chair": {
      // Cross-braced side panels; the top reads as a round seat.
      fill(base);
      if (face === FACE_TOP || face === FACE_BOTTOM) {
        for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (d > 6.5) px(x, y, shade(base, 0.6));
          else if (rand() < 0.16) px(x, y, shade(base, 0.86 + rand() * 0.24));
        }
      } else {
        const brace = shade(base, 0.66);
        for (let i = 3; i < S - 3; i += 1) {
          px(i, Math.round(3 + ((i - 3) * 9) / (S - 7)), brace);
          px(i, Math.round(12 - ((i - 3) * 9) / (S - 7)), brace);
        }
        for (let x = 1; x < S; x += 1) { px(x, 1, shade(base, 0.7)); px(x, S - 2, shade(base, 0.7)); }
        if (rand() < 0.5) for (let k = 0; k < 10; k += 1) px(Math.floor(rand() * S), Math.floor(rand() * S), shade(base, 1.06));
      }
      break;
    }
    case "table": {
      // A thick apron under the top edge and two legs, so it reads as furniture.
      fill(base);
      if (face === FACE_TOP || face === FACE_BOTTOM) {
        for (let i = 0; i < S; i += 1) { px(i, 0, shade(base, 0.72)); px(i, S - 1, shade(base, 0.72)); px(0, i, shade(base, 0.78)); px(S - 1, i, shade(base, 0.78)); }
        for (let y = 2; y < S - 2; y += 1) for (let x = 2; x < S - 2; x += 1) {
          if (rand() < 0.12) px(x, y, shade(base, 0.88 + rand() * 0.22));
          else if (y === 5 || y === 10) px(x, y, shade(base, 0.82));
        }
      } else {
        for (let x = 0; x < S; x += 1) for (let y = 0; y < 4; y += 1) px(x, y, shade(base, 0.7));
        for (const legX of [1, 13]) {
          for (let x = legX; x < legX + 2; x += 1) for (let y = 4; y < S - 1; y += 1) px(x, y, shade(base, 0.78));
        }
        for (let y = 4; y < S - 1; y += 1) { px(3, y, shade(base, 0.62)); px(12, y, shade(base, 0.62)); }
      }
      break;
    }
    case "marble": {
      // Pale stone with soft grey veins wandering across the face.
      fill(base);
      for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
        if (rand() < 0.1) px(x, y, shade(base, 0.94 + rand() * 0.08));
      }
      const veins = 3;
      for (let vein = 0; vein < veins; vein += 1) {
        let vx = rand() * S;
        let vy = rand() * S;
        let angle = rand() * Math.PI * 2;
        for (let step = 0; step < 26; step += 1) {
          angle += (rand() - 0.5) * 0.9;
          vx += Math.cos(angle) * 1.2;
          vy += Math.sin(angle) * 1.2;
          const px0 = Math.round(vx);
          const py0 = Math.round(vy);
          if (px0 < 0 || px0 >= S || py0 < 0 || py0 >= S) break;
          px(px0, py0, info.speckle[1]);
          if (rand() < 0.5 && px0 + 1 < S) px(px0 + 1, py0, shade(info.speckle[1], 1.12));
        }
      }
      break;
    }
    default: {
      fill(base);
      speckle(0.28);
    }
  }
}

/** Builds the atlas and returns a nearest-filtered texture ready for a material. */
export function createAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * TILE_SIZE;
  canvas.height = ATLAS_ROWS * TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available for the texture atlas.");

  for (const name of WORLD_BLOCK_TYPES) {
    const info = BLOCK_INFO[name];
    const id = BLOCK_ID[name];
    for (let face = 0; face < TILES_PER_BLOCK; face += 1) {
      const tile = tileIndex(id, face);
      const ox = (tile % ATLAS_COLUMNS) * TILE_SIZE;
      const oy = Math.floor(tile / ATLAS_COLUMNS) * TILE_SIZE;
      drawTile(ctx, ox, oy, info, face, id * 17 + face * 101 + 7);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
