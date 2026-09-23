// PM2 apps for Dualyne on a server that also runs other PM2 apps.
// Started by deploy/pm2/deploy.sh:  pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env
// Both apps listen on 127.0.0.1 only; Nginx is the public entry point.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

/** KEY=VALUE lines from the app's .env (the same file the build used). */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const env = readEnv(path.join(root, ".env"));
// Dualyne runs on its own Node 22 (installed by setup.sh), whatever Node the other apps use.
const node = process.env.DUALYNE_NODE || path.join(root, ".runtime/node/bin/node");
const apiPort = env.API_PORT || "4100";
const webPort = env.WEB_PORT || "3100";

module.exports = {
  apps: [
    {
      name: "dualyne-api",
      cwd: path.join(root, "apps/api"),
      script: "dist/server.js",
      interpreter: node,
      env: { ...env, NODE_ENV: "production", HOST: "127.0.0.1", API_PORT: apiPort },
      max_memory_restart: "700M",
      kill_timeout: 10000,
      time: true,
    },
    {
      name: "dualyne-web",
      // Next.js standalone output; static files are copied in by deploy.sh.
      cwd: path.join(root, "apps/web/.next/standalone"),
      script: "apps/web/server.js",
      interpreter: node,
      env: {
        ...env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: webPort,
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
      },
      max_memory_restart: "700M",
      time: true,
    },
  ],
};
