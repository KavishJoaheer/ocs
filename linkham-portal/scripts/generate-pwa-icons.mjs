import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const sourcePath = path.join(publicDir, "ocs-app-icon-source.png");

const ICON_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };
const HOME_SCREEN_LOGO_SCALE = 0.68;
const TAB_LOGO_SCALE = 0.8;

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

async function writeIcon(size, fileName, logoScale = HOME_SCREEN_LOGO_SCALE) {
  const logoSize = Math.min(Math.round(size * logoScale), size - 2);
  const logo = await loadLogoWithoutBlackBackground();
  const logoBuffer = await logo
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
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
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, fileName));

  console.log(`Wrote ${fileName} (${size}x${size})`);
}

const logo = await loadLogoWithoutBlackBackground();
await logo.png().toFile(path.join(publicDir, "ocs-app-icon-mark.png"));

await writeIcon(32, "favicon-32.png", TAB_LOGO_SCALE);
await sharp(path.join(publicDir, "favicon-32.png"))
  .resize(16, 16, { kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDir, "favicon-16.png"));
console.log("Wrote favicon-16.png (16x16)");

await writeIcon(64, "favicon-64.png", TAB_LOGO_SCALE);
await writeIcon(180, "apple-touch-icon.png");
await writeIcon(192, "icon-192.png");
await writeIcon(512, "favicon.png");
await writeIcon(1024, "icon-1024.png");
