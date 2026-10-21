import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const fast = process.env.DENOISE_FAST === '1';
const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });

const options = {
  entryPoints: {
    background: 'src/background/index.ts',
    'content/isolated': 'src/content/isolated.ts',
    'content/main-world': 'src/content/main-world.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
  define: {
    __FAST__: String(fast),
    // Message key shared by the two content-script worlds; random per build so pages can't recognise it.
    __CHANNEL__: JSON.stringify('_' + randomBytes(6).toString('hex')),
    __UNINSTALL_URL__: JSON.stringify(process.env.DENOISE_UNINSTALL_URL ?? ''),
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
  if (fast) console.log('Fast build: one budget "minute" is one second.');
}
