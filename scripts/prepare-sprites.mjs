import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const source = new URL(
  "../assets/source/brain-bombs-atlas.png",
  import.meta.url,
);
const output = new URL("../public/sprites/", import.meta.url);
await mkdir(output, { recursive: true });
const input = source.pathname;
const { width: w, height: h } = await sharp(input).metadata();
const names = [
  "player-teal",
  "player-coral",
  "brain",
  "bomb",
  "crate",
  "steel",
  "fire",
  "speed",
];
for (const [i, name] of names.entries()) {
  const x = i % 4,
    y = Math.floor(i / 4);
  const left = Math.round((x * w) / 4),
    top = Math.round((y * h) / 2);
  const width = Math.round(((x + 1) * w) / 4) - left,
    height = Math.round(((y + 1) * h) / 2) - top;
  await sharp(input)
    .extract({ left, top, width, height })
    .resize(192, 192)
    .webp({ quality: 88 })
    .toFile(new URL(`${name}.webp`, output).pathname);
}
console.log("Prepared eight transparent game sprites.");
