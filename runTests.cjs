const { execSync } = require("child_process");
const url = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}/${process.env.PGDATABASE}`;
try {
  execSync("npx vitest run src/tests/integration/phaseB_concurrency.test.ts", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit"
  });
} catch(e) {
  process.exit(1);
}
