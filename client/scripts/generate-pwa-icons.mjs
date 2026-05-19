import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const sourcePath = path.join(publicDir, "ocs-app-icon-source.png");

const ICON_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };
const LOGO_SCALE = 0.68;

async function loadLogoWithoutBlackBackground() {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = data;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];

    if (red < 48 && green < 48 && blue < 48) {
      pixels[index + 3] = 0;
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  });
}

async function writeIcon(size, fileName) {
  const logoSize = Math.round(size * LOGO_SCALE);
  const logo = await loadLogoWithoutBlackBackground();
  const logoBuffer = await logo
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: ICON_BACKGROUND,
    },
  })
    .composite([{ input: logoBuffer, gravity: "center" }])
    .png()
    .toFile(path.join(publicDir, fileName));

  console.log(`Wrote ${fileName} (${size}x${size})`);
}

const logo = await loadLogoWithoutBlackBackground();
await logo.png().toFile(path.join(publicDir, "ocs-app-icon-mark.png"));

await writeIcon(180, "apple-touch-icon.png");
await writeIcon(192, "icon-192.png");
await writeIcon(512, "favicon.png");
await writeIcon(64, "favicon-64.png");
await writeIcon(1024, "icon-1024.png");
