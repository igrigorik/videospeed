import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'release');
const zipName = `videospeed-${pkg.version}.zip`;
const zipPath = path.join(releaseDir, zipName);

const CWS_SIZE_LIMIT = 128 * 1024 * 1024; // 128 MB

async function packageRelease() {
  // Verify dist exists
  if (!(await fs.pathExists(distDir))) {
    console.error('❌ dist/ directory not found. Run "npm run build:release" first.');
    process.exit(1);
  }

  // Validate manifest version matches package.json
  const manifest = await fs.readJson(path.join(distDir, 'manifest.json'));
  if (manifest.version !== pkg.version) {
    console.error(
      `❌ Version mismatch: manifest.json has ${manifest.version}, package.json has ${pkg.version}`
    );
    process.exit(1);
  }

  // Prepare release directory
  await fs.ensureDir(releaseDir);

  // Create zip
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.directory(distDir, false, (entry) => {
    // Exclude source maps and OS cruft
    if (entry.name.endsWith('.map') || entry.name === '.DS_Store') {
      return false;
    }
    return entry;
  });
  await archive.finalize();
  await done;

  const stats = await fs.stat(zipPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  if (stats.size > CWS_SIZE_LIMIT) {
    console.warn(`⚠️  Warning: ${zipName} is ${sizeMB} MB (Chrome Web Store limit is 128 MB)`);
  }

  console.log(`✅ Packaged ${zipName} (${sizeMB} MB) → release/`);
}

packageRelease().catch((err) => {
  console.error('❌ Packaging failed:', err);
  process.exit(1);
});
