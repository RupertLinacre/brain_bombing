# Original game artwork

Generated using the **built-in imagegen tool** (not the CLI fallback). The source atlas was visually inspected and its real RGBA transparency confirmed. The generator returned 1774×887 despite a requested 2048×1024; cells are extracted proportionally. Conversion preserves alpha.

- Source: `assets/source/brain-bombs-atlas.png`
- Runtime sprites: `public/sprites/player-teal.webp`, `player-coral.webp`, `brain.webp`, `bomb.webp`, `crate.webp`, `steel.webp`, `fire.webp`, `speed.webp`.
- Rebuild optimized sprites with `npm run assets`.

## Exact prompt

```text
Use case: stylized-concept
Asset type: single game sprite atlas for Brain Bombs 2, a cute polished arcade arena game for children.
Primary request: Generate exactly one 2048x1024 PNG sprite atlas on an actual transparent background. Layout is exactly 4 columns by 2 rows of equal 512x512 cells. Every object is isolated and centered within its own cell with generous empty transparent padding.
Row 1 from left to right:
1. Cute cyan/teal bomber robot in a rounded helmet with a dark face visor and tiny antenna.
2. The same robot design and pose in coral red.
3. Glowing pink cartoon brain collectible.
4. Classic round charcoal bomb with a lit fuse.
Row 2 from left to right:
1. Wooden destructible crate with metal corners.
2. Indestructible dark blue steel block with bevels.
3. Orange flame power-up in a small hexagonal token.
4. Mint green winged sneaker speed power-up.
Style/medium: High quality soft 3D rendered arcade toys; consistent slightly elevated front view suitable for a top-down board; chunky clean silhouettes that remain clearly readable at 48px; appealing original robot character designs.
Lighting: Soft studio lighting and subtle soft contact shadows only immediately beneath each object.
Composition: Cell centers are x=256,768,1280,1792 and y=256,768. Each complete sprite, glow, fuse, wings, antenna, and its shadow stays fully within its own cell with at least 70 pixels of transparent edge padding. Keep the matching robots at identical scale.
Constraints: Real alpha transparency, no backdrop of any color, no painted checkerboard pattern. Exactly eight sprites total. No text, labels, grid lines, dividers, floor, scenery, logos, or watermark. No sprite overlaps another sprite or its cell edges. Do not copy the Bomberman character.
```
