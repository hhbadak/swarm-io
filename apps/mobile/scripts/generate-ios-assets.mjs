import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const source = path.resolve(mobileRoot, '..', 'web', 'icon.svg');
const assetRoot = path.resolve(mobileRoot, 'ios', 'App', 'App', 'Assets.xcassets');
const appIcon = path.join(assetRoot, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const splashRoot = path.join(assetRoot, 'Splash.imageset');

await sharp(source, { density: 384 })
  .resize(1024, 1024)
  .flatten({ background: '#050819' })
  .png()
  .toFile(appIcon);

const core = await sharp(source, { density: 384 }).resize(820, 820).png().toBuffer();
const splash = await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: '#030611' }
}).composite([{ input: core, gravity: 'centre' }]).png().toBuffer();

for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await sharp(splash).toFile(path.join(splashRoot, name));
}

console.log('SWARM.IO iOS icon and splash assets generated.');
