// Keeps the dev server running inside the app container. When `next dev`
// crashed, the container used to stop, and Docker gave the new one a new
// network. rustfs shares the app's network and stayed in the old one, so
// localhost:9050 answered nothing until somebody recreated it. Starting the
// dev server again in here keeps the container, and so the network, alive.
// docker-compose.yml runs it as `node scripts/dev-server.mjs npm run dev`.

import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
// A crash on start would otherwise loop as fast as the machine can.
const PAUSE_MS = Number(process.env.DEV_SERVER_PAUSE_MS ?? 2000);
// docker compose stop kills everything after ten seconds; be out before that.
const GRACE_MS = 5000;

let child;
let stopping = false;

// The child leads its own process group, so one signal reaches npm, the shell,
// next dev and the next-server it forks. A next-server left behind would hold
// the port the next start needs.
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone already.
  }
}

function start() {
  const proc = spawn(command, args, { stdio: "inherit", detached: true });
  child = proc;
  proc.on("exit", (code, signal) => {
    killGroup(proc.pid, "SIGKILL");
    if (stopping) process.exit(0);
    console.log(`The dev server stopped (${signal ?? `exit ${code}`}): starting it again.`);
    setTimeout(start, PAUSE_MS);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
  killGroup(child.pid, "SIGTERM");
  setTimeout(() => {
    killGroup(child.pid, "SIGKILL");
    process.exit(0);
  }, GRACE_MS).unref();
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
start();
