// Exercise the gateway without an LLM.
//   npx tsx src/cli.ts devices
//   npx tsx src/cli.ts classify <device> <command...>
//   npx tsx src/cli.ts run <device> <command...> [--reason "why"] [--wait seconds]
//   npx tsx src/cli.ts get <grantId>
// A pending grant is approved by the warden, not by this tool:
//   spacetime call nightshift decide_grant <grantId> true 60 --server local
import { connectGate } from './hub.js';
import { Gateway } from './gateway.js';
import { classify, deviceTypeFor } from './policy.js';

const [cmd, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error('usage: cli.ts devices | classify <device> <command...> | run <device> <command...> [--reason r] | get <grantId>');
  process.exit(2);
}

if (cmd === 'classify') {
  const [device, ...words] = rest;
  if (!device || words.length === 0) usage();
  console.log(JSON.stringify(classify(words.join(' '), deviceTypeFor(device)), (_k, v) => (v instanceof RegExp ? v.source : v), 2));
  process.exit(0);
}
if (!cmd || !['devices', 'run', 'get'].includes(cmd)) usage();

let reason = 'cli test';
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--reason') reason = rest[++i] ?? reason;
  else if (rest[i] === '--wait') process.env.NS_WAIT_MS = String(Number(rest[++i]) * 1000);
  else args.push(rest[i]);
}

const conn = await connectGate();
const gw = new Gateway(conn);
try {
  if (cmd === 'devices') {
    console.log(JSON.stringify(gw.listDevices(), null, 2));
  } else if (cmd === 'run') {
    const [device, ...words] = args;
    if (!device || words.length === 0) usage();
    const out = await gw.runCommand({ device, command: words.join(' '), reason, requester: 'cli' });
    console.log(JSON.stringify(out, null, 2));
    if (out.status === 'pending') console.error(`approve: spacetime call nightshift decide_grant ${out.grantId} true 60 --server local`);
  } else if (cmd === 'get') {
    if (!args[0]) usage();
    console.log(JSON.stringify(await gw.getResult(BigInt(args[0])), null, 2));
  }
} finally {
  await new Promise(r => setTimeout(r, 200));
  conn.disconnect();
  process.exit(0);
}
