import esbuild from 'esbuild';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const isWatch = process.argv.includes('--watch');
const isRelease = process.env.RELEASE === '1';

const common = {
  bundle: true,
  sourcemap: isRelease ? false : false, // set true locally if debugging
  minify: isRelease,
  target: 'chrome114',
  platform: 'browser',
  legalComments: 'none',
  format: 'iife', // preserve side-effects and simple global init without ESM runtime
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function copyStaticFiles() {
  const outDir = path.resolve(rootDir, 'dist');

  try {
    // Ensure the output directory exists and is clean
    await fs.emptyDir(outDir);

    // Inject version from package.json into manifest
    const manifest = await fs.readJson(path.join(rootDir, 'manifest.json'));
    manifest.version = pkg.version;
    await fs.writeJson(path.join(outDir, 'manifest.json'), manifest, { spaces: 2 });
    console.log(`✅ Manifest version set to ${pkg.version}${isRelease ? ' (release)' : ''}`);

    // Paths to copy
    const pathsToCopy = {
      'src/assets': path.join(outDir, 'assets'),
      'src/ui': path.join(outDir, 'ui'),
      'src/styles': path.join(outDir, 'styles'),
      'LICENSE': path.join(outDir, 'LICENSE'),
      'CONTRIBUTING.md': path.join(outDir, 'CONTRIBUTING.md'),
      'PRIVACY.md': path.join(outDir, 'PRIVACY.md'),
      'README.md': path.join(outDir, 'README.md')
    };

    // Perform copy operations
    for (const [src, dest] of Object.entries(pathsToCopy)) {
      await fs.copy(path.join(rootDir, src), dest, {
        filter: (src) => !path.basename(src).endsWith('.js')
      });
    }

    console.log('✅ Static files copied');
  } catch (error) {
    console.error('❌ Error copying static files:', error);
    process.exit(1);
  }
}

async function build() {
  try {
    await copyStaticFiles();

    const esbuildConfig = {
      ...common,
      entryPoints: {
        'content': 'src/entries/content-entry.js',
        'inject': 'src/entries/inject-entry.js',
        'background': 'src/background.js',
        'ui/popup/popup': 'src/ui/popup/popup.js',
        'ui/options/options': 'src/ui/options/options.js'
      },
      outdir: 'dist',
    };

    if (isWatch) {
      const ctx = await esbuild.context(esbuildConfig);
      await ctx.watch();
      console.log('🔧 Watching for changes...');
    } else {
      await esbuild.build(esbuildConfig);
      console.log('✅ Build complete');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
