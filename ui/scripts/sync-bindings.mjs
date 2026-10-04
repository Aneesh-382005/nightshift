// Copies generated bindings so they resolve this package's own `spacetimedb` install.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../agents/common/src/module_bindings');
const dst = resolve(here, '../src/module_bindings');
if (!existsSync(src)) {
  if (existsSync(dst)) { console.log('sync-bindings: source missing, keeping existing copy'); process.exit(0); }
  console.error('sync-bindings: ' + src + ' not found'); process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('sync-bindings: copied to src/module_bindings');
