import esbuild from 'esbuild';
import process from 'process';

const isWatch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: false,  // set true locally if debugging
  minify: false,
  target: 'chrome89',
  platform: 'browser',
  legalComments: 'none',
  format: 'iife', // preserve side-effects and simple global init without ESM runtime
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function build() {
  try {
    const ctx = await esbuild.context({
      ...common,
      entryPoints: {
        content: 'src/entries/content-entry.js',  // Content script (injector)
        inject: 'src/entries/inject-entry.js',    // Page context bundle
        background: 'src/background.js',
        popup: 'src/ui/popup/popup.js',
        options: 'src/ui/options/options.js',
      },
      outdir: 'dist',
    });

    if (isWatch) {
      await ctx.watch();
      console.log('🔧 Watching for changes...');
    } else {
      await ctx.rebuild();
      console.log('✅ Build complete');
      await ctx.dispose();
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
