const esbuild = require('esbuild');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const minify = args.includes('--minify');

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  minify,
  sourcemap: !minify,
};

if (watch) {
  esbuild.context(config).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(config).catch(() => process.exit(1));
}
