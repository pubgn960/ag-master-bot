
const { spawn } = require(" child_process\);
const url = \postgresql://\:\@\:\/\\;
const child = spawn(\npx.cmd\, [\vitest\, \run\, \src/tests/integration/phaseB_concurrency.test.ts\], {
 env: { ...process.env, DATABASE_URL: url },
 stdio: \inherit\
});
child.on(\exit\, (code) => process.exit(code));

