import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const fixturePath = process.env.EVENTS_JSONL || path.join(__dirname, "fixtures", "events.jsonl");
const port = Number(process.env.PORT || 4173);
const replaySpeed = Number(process.env.REPLAY_SPEED || 2);
const bControlBase = process.env.B_CONTROL_URL || "http://localhost:8787";
const bProxyTimeoutMs = Number(process.env.B_PROXY_TIMEOUT_MS || 1200);

const clients = new Set();
const events = [];
const seenKeys = new Set();
const runCounters = new Map();
let fixtureOffset = 0;
let tailRemainder = "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function eventKey(event) {
  return [event.run_id, event.branch_id, event.step_idx, event.event].join("|");
}

function normalizeEvent(event) {
  return {
    ts: event.ts || new Date().toISOString(),
    run_id: event.run_id || "run_unknown",
    event: event.event,
    branch_id: event.branch_id || event.payload?.branch_id || "b_root",
    parent_branch_id: event.parent_branch_id ?? parentOf(event.branch_id || "b_root"),
    step_idx: Number(event.step_idx || 0),
    payload: event.payload || {},
  };
}

function addEvent(rawEvent, { broadcast = true, dedupe = true } = {}) {
  const event = normalizeEvent(rawEvent);
  const key = eventKey(event);
  if (dedupe && seenKeys.has(key)) {
    return null;
  }
  if (dedupe) {
    seenKeys.add(key);
  }
  events.push(event);
  events.sort(compareEvents);
  if (broadcast) {
    broadcastEvent(event);
  }
  return event;
}

function eventTimestamp(event) {
  const timestamp = Date.parse(event.ts);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareEvents(a, b) {
  if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
  const tsDelta = eventTimestamp(a) - eventTimestamp(b);
  if (tsDelta !== 0) return tsDelta;
  if (a.step_idx !== b.step_idx) return a.step_idx - b.step_idx;
  return a.event.localeCompare(b.event);
}

function replayDelay(event, replayStart) {
  return Math.max(0, Math.round((eventTimestamp(event) - replayStart) / Math.max(replaySpeed, 0.1)));
}

function loadFixture() {
  if (!fs.existsSync(fixturePath)) return [];
  const text = fs.readFileSync(fixturePath, "utf8");
  fixtureOffset = Buffer.byteLength(text);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const loaded = [];
  for (const line of lines) {
    try {
      const event = addEvent(JSON.parse(line), { broadcast: false });
      if (event) loaded.push(event);
    } catch (error) {
      console.error(`Skipping invalid fixture line: ${error.message}`);
    }
  }
  return loaded;
}

function parseJsonlChunk(chunk) {
  tailRemainder += chunk;
  const lines = tailRemainder.split(/\r?\n/);
  tailRemainder = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      addEvent(JSON.parse(line), { broadcast: true });
    } catch (error) {
      console.error(`Skipping invalid tailed event: ${error.message}`);
    }
  }
}

function startJsonlTail() {
  setInterval(() => {
    fs.stat(fixturePath, (statError, stat) => {
      if (statError || !stat.isFile()) return;
      if (stat.size < fixtureOffset) {
        fixtureOffset = 0;
        tailRemainder = "";
      }
      if (stat.size <= fixtureOffset) return;

      const stream = fs.createReadStream(fixturePath, {
        start: fixtureOffset,
        end: stat.size - 1,
        encoding: "utf8",
      });
      stream.on("data", parseJsonlChunk);
      stream.on("end", () => {
        fixtureOffset = stat.size;
      });
      stream.on("error", (error) => {
        console.error(`Unable to tail events file: ${error.message}`);
      });
    });
  }, 1000).unref();
}

function parentOf(branchId) {
  if (!branchId || branchId === "b_root" || !branchId.includes(".")) return null;
  return branchId.split(".").slice(0, -1).join(".");
}

function branchIdsInEvent(event) {
  return [
    event.branch_id,
    event.parent_branch_id,
    event.payload?.branch_id,
    event.payload?.winning_branch,
    ...(Array.isArray(event.payload?.children) ? event.payload.children : []),
  ].filter((branchId) => typeof branchId === "string" && branchId.length > 0);
}

function nextChildren(run_id, sourceBranch, count = 2) {
  const prefix = `${sourceBranch}.`;
  let maxSuffix = 0;
  for (const event of events) {
    if (event.run_id !== run_id) continue;
    for (const branchId of branchIdsInEvent(event)) {
      if (!branchId.startsWith(prefix)) continue;
      const suffix = branchId.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        maxSuffix = Math.max(maxSuffix, Number(suffix));
      }
    }
  }
  return Array.from({ length: count }, (_, index) => `${sourceBranch}.${maxSuffix + index + 1}`);
}

function nextReplayChildren(sourceBranch, count = 2) {
  const prefix = `${sourceBranch}.replay`;
  let maxReplay = 0;
  for (const event of events) {
    for (const branchId of branchIdsInEvent(event)) {
      if (!branchId.startsWith(prefix)) continue;
      const match = branchId.slice(prefix.length).match(/^(\d+)\./);
      if (match) {
        maxReplay = Math.max(maxReplay, Number(match[1]));
      }
    }
  }
  const replayId = maxReplay + 1;
  return Array.from({ length: count }, (_, index) => `${sourceBranch}.replay${replayId}.${index + 1}`);
}

function nowEvent({ run_id, event, branch_id, step_idx, payload }) {
  return addEvent({
    ts: new Date().toISOString(),
    run_id,
    event,
    branch_id,
    parent_branch_id: parentOf(branch_id),
    step_idx,
    payload,
  }, { dedupe: false });
}

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function proxyJson(pathname, { method = "GET", body } = {}) {
  if (!bControlBase) {
    throw new Error("B_CONTROL_URL is empty");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bProxyTimeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(new URL(pathname, bControlBase), {
      method,
      headers: body === undefined ? { accept: "application/json" } : {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`B control API returned HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackTasks() {
  return [
    {
      task_id: "trap_file",
      title: "Trap file rescue",
      prompt: "Choose the approved packet without letting stale draft writes touch reality.",
    },
    {
      task_id: "alternate_future",
      title: "Fork alternate future",
      prompt: "Rewind a verified run and race two replay branches from the selected step.",
    },
  ];
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const target = path.resolve(publicDir, `.${requested}`);
  const relativeTarget = path.relative(publicDir, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(target);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(target).pipe(res);
  });
}

function connectSse(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));

  const replayEvents = [...events];
  const replayStart = replayEvents.reduce(
    (min, event) => Math.min(min, eventTimestamp(event)),
    replayEvents[0] ? eventTimestamp(replayEvents[0]) : 0,
  );
  replayEvents.forEach((event) => {
    const delay = replayDelay(event, replayStart);
    setTimeout(() => {
      if (clients.has(res)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }, delay);
  });
}

function nextRunId() {
  const base = "run_live";
  const count = (runCounters.get(base) || 0) + 1;
  runCounters.set(base, count);
  return `${base}_${String(count).padStart(2, "0")}`;
}

function injectRun(body = {}) {
  const run_id = nextRunId();
  const sequence = [
    ["run_started", "b_root", 0, { task_id: body.task_id || "trap_file", title: "Live replay: rescue the client packet" }],
    ["step", "b_root", 1, { tool: "read_file", args_summary: "Open instructions.md", result_summary: "Found ambiguous send instruction", effect_class: "READ", latency_ms: 81 }],
    ["fork", "b_root", 2, { children: ["b_root.1", "b_root.2", "b_root.3"], reason: "confidence 0.38 - three plausible next actions", entropy: 0.82 }],
    ["step", "b_root.1", 3, { tool: "send_email", args_summary: "Stage draft attachment", result_summary: "Irreversible action blocked in sandbox", effect_class: "IRREVERSIBLE", latency_ms: 172 }],
    ["step", "b_root.2", 3, { tool: "search_workspace", args_summary: "Find approved packet", result_summary: "Found FINAL zip inputs", effect_class: "READ", latency_ms: 155 }],
    ["step", "b_root.3", 3, { tool: "write_file", args_summary: "Build packet from notes", result_summary: "Sandbox missing invoice", effect_class: "SPECULATABLE_WRITE", latency_ms: 139 }],
    ["verifier_score", "b_root.1", 4, { branch_id: "b_root.1", score: 0.22, verdict: "fail", detail: "Tried irreversible write too early." }],
    ["branch_died", "b_root.1", 5, { cause: "verifier_rejected", detail: "blocked real-world effect never touched reality" }],
    ["verifier_score", "b_root.3", 4, { branch_id: "b_root.3", score: 0.48, verdict: "fail", detail: "Missing signed invoice." }],
    ["branch_died", "b_root.3", 5, { cause: "error", detail: "incomplete packet" }],
    ["step", "b_root.2", 4, { tool: "archive_files", args_summary: "Zip packet + invoice", result_summary: "Sandbox ready for commit", effect_class: "SPECULATABLE_WRITE", latency_ms: 226 }],
    ["verifier_score", "b_root.2", 5, { branch_id: "b_root.2", score: 0.94, verdict: "pass", detail: "Approved packet and invoice present." }],
    ["commit", "b_root.2", 6, { winning_branch: "b_root.2", staged_effects_flushed: 1 }],
    ["run_finished", "b_root.2", 7, { status: "success", summary: "Winning universe became reality." }],
  ];
  sequence.forEach(([event, branch_id, step_idx, payload], index) => {
    setTimeout(() => nowEvent({ run_id, event, branch_id, step_idx, payload }), index * 450);
  });
  return run_id;
}

function injectForkAt(body) {
  const sourceBranch = body.branch_id || "b_root.2";
  const requestedStep = Number(body.step_idx);
  const sourceStep = Number.isFinite(requestedStep) ? requestedStep : 4;
  const run_id = body.run_id || `run_time_travel_${Date.now().toString(36)}`;
  const childCount = Number(body.n || 2);
  const children = nextReplayChildren(sourceBranch, childCount);
  const sequence = [
    ["fork", sourceBranch, sourceStep, { children, reason: `rewind to ${sourceBranch} step ${sourceStep}; try alternate future`, entropy: 0.67 }],
    ["step", children[0], sourceStep + 1, { tool: "write_file", args_summary: "Alternate future: build zip", result_summary: "Sandbox wrote complete packet", effect_class: "SPECULATABLE_WRITE", latency_ms: 182 }],
    ["step", children[1], sourceStep + 1, { tool: "write_file", args_summary: "Alternate future: export PDF", result_summary: "Sandbox omitted invoice", effect_class: "SPECULATABLE_WRITE", latency_ms: 167 }],
    ["verifier_score", children[0], sourceStep + 2, { branch_id: children[0], score: 0.91, verdict: "pass", detail: "Alternate future passes after rewind." }],
    ["verifier_score", children[1], sourceStep + 2, { branch_id: children[1], score: 0.41, verdict: "fail", detail: "Still missing invoice." }],
    ["branch_died", children[1], sourceStep + 3, { cause: "verifier_rejected", detail: "alternate future rejected" }],
    ["commit", children[0], sourceStep + 4, { winning_branch: children[0], staged_effects_flushed: 1 }],
  ];
  sequence.forEach(([event, branch_id, step_idx, payload], index) => {
    setTimeout(() => nowEvent({ run_id, event, branch_id, step_idx, payload }), index * 350);
  });
  return { run_id, children };
}

function worldStateFor({ run_id, branch_id, step_idx } = {}) {
  const branchId = branch_id || "b_root";
  const selectedRunId = run_id || "run_fixture";
  const stepIdx = step_idx || 0;
  const step = Number(stepIdx || 0);
  const files = [
    { path: "instructions.md", kind: "file", text: "Ambiguous delivery instruction", size_bytes: 30, status: "read" },
    { path: "client_packet_FINAL.md", kind: "file", text: step >= 3 ? "Approved source packet" : "", size_bytes: step >= 3 ? 22 : 0, status: step >= 3 ? "present" : "hidden" },
    { path: "invoice_signed.pdf", kind: "file", text: "", size_bytes: step >= 4 ? 18420 : 0, status: step >= 4 ? "present" : "pending" },
    { path: "packet.zip", kind: "file", text: "", size_bytes: branchId.includes("2") && step >= 6 ? 42192 : 0, status: branchId.includes("2") && step >= 6 ? "staged" : "absent" },
  ];
  return {
    run_id: selectedRunId,
    branch_id: branchId,
    step_idx: step,
    workspace: { files },
    db: { path: null, tables: [] },
    events: events.filter((event) => event.run_id === selectedRunId && event.branch_id === branchId && event.step_idx <= step),
  };
}

function benchmarks() {
  return {
    source: "fixture",
    updated_at: new Date().toISOString(),
    success_rate: { off: 35, on: 85 },
    wall_clock_seconds: { off: 92, on: 58 },
    real_world_writes: { off: 8, on: 1 },
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    connectSse(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    sendJson(res, 200, { events });
    return;
  }

  if (req.method === "GET" && url.pathname === "/fixtures/events.jsonl") {
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(fixturePath).pipe(res);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/tasks" || url.pathname === "/tasks")) {
    try {
      sendJson(res, 200, await proxyJson("/tasks"));
    } catch {
      sendJson(res, 200, fallbackTasks());
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/benchmarks") {
    sendJson(res, 200, benchmarks());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/world_state") {
    const body = await readJson(req).catch((error) => ({ error: error.message }));
    if (body.error) return sendJson(res, 400, body);
    try {
      sendJson(res, 200, await proxyJson("/api/world_state", { method: "POST", body }));
    } catch {
      sendJson(res, 200, worldStateFor(body));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/world_state") {
    sendJson(res, 200, worldStateFor({
      run_id: url.searchParams.get("run_id"),
      branch_id: url.searchParams.get("branch_id"),
      step_idx: url.searchParams.get("step_idx"),
    }));
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/run" || url.pathname === "/run")) {
    const body = await readJson(req).catch((error) => ({ error: error.message }));
    if (body.error) return sendJson(res, 400, body);
    const request = {
      task_id: body.task_id || "trap_file",
      speculation: body.speculation ?? true,
    };
    try {
      sendJson(res, 200, await proxyJson("/run", { method: "POST", body: request }));
    } catch {
      const run_id = injectRun(request);
      sendJson(res, 200, { run_id, source: "fixture" });
    }
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/fork_at" || url.pathname === "/fork_at")) {
    const body = await readJson(req).catch((error) => ({ error: error.message }));
    if (body.error) return sendJson(res, 400, body);
    const request = {
      branch_id: body.branch_id || "b_root",
      step_idx: Number(body.step_idx || 0),
      n: Number(body.n || 2),
    };
    try {
      sendJson(res, 200, await proxyJson("/fork_at", { method: "POST", body: request }));
    } catch {
      sendJson(res, 200, injectForkAt({ ...body, ...request }));
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url.pathname);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
}

loadFixture();
startJsonlTail();

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: error.message });
  });
});

server.listen(port, () => {
  console.log(`Multiverse Theater running at http://localhost:${port}`);
  console.log(`SSE replaying ${events.length} fixture events from ${fixturePath}`);
});
