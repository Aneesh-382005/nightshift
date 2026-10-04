// Unit test of the trust meter mapping. Run: npx tsx src/test-trust.ts
import assert from 'node:assert/strict';
import { GOLD, DIM_GREEN, litLeds, meter, trustView, trustWord } from './trust.js';

assert.deepEqual([0, 1, 2, 3, 4, 9].map(litLeds), [0, 2, 4, 6, 6, 6]);
assert.deepEqual(meter(1), [GOLD, GOLD, DIM_GREEN, DIM_GREEN, DIM_GREEN, DIM_GREEN, DIM_GREEN]);
assert.equal(meter(3).filter(c => c === GOLD).length, 6);
assert.equal(meter(3)[6], DIM_GREEN);
assert.equal(meter(0).length, 7);
for (const n of [0, 1, 3, 10, 99, 500]) assert.ok(trustWord(n).length <= 8, `${trustWord(n)} must fit the 8 char display`);
assert.equal(trustWord(2), 'TRUST 2');

let v = trustView({ runbookId: 'restart-web', successes: 2, level: 2 }, false)!;
assert.equal(v.lines[0], 'TRUST 2'); assert.equal(v.mode, 'solid'); assert.equal(v.leds!.filter(c => c === GOLD).length, 4);
assert.equal(v.lines[2], '1 more to earn');

v = trustView({ runbookId: 'restart-web', successes: 3, level: 1 }, true)!;
assert.equal(v.lines[0], 'EARNED'); assert.equal(v.mode, 'pulse'); assert.deepEqual(v.led, GOLD); assert.equal(v.leds, undefined);

v = trustView({ runbookId: 'restart-web', successes: 5, level: 1 }, false)!;
assert.equal(v.lines[0], 'TRUST 5'); assert.equal(v.lines[2], 'heals alone');   // later heals: meter, not EARNED again
assert.equal(trustView({ runbookId: 'x', successes: 3, level: 2 }, true)!.lines[0], 'TRUST 3');   // promoted flag alone is not enough
assert.equal(trustView(undefined, false), undefined);
console.log('trust mapping tests passed');
