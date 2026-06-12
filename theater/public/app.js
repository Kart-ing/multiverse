(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const EVENT_ORDER = {
    run_started: 0,
    fork: 1,
    step: 2,
    verifier_score: 3,
    branch_died: 4,
    commit: 5,
    run_finished: 6
  };

  const CAUSES = {
    verifier_rejected: { short: "verifier", label: "Verifier rejected" },
    budget_killed: { short: "budget", label: "Budget killed" },
    error: { short: "error", label: "Runtime error" }
  };

  const WORLD_FIXTURE = [
    {
      step: 0,
      files: [
        ["README.md", "clean"],
        ["src/multiverse/types.py", "clean"],
        ["events.jsonl", "0 events"]
      ]
    },
    {
      step: 2,
      files: [
        ["README.md", "clean"],
        ["src/multiverse/types.py", "clean"],
        ["events.jsonl", "fork recorded"]
      ]
    },
    {
      step: 4,
      files: [
        ["README.md", "clean"],
        ["src/multiverse/types.py", "staged"],
        ["demo/task.md", "candidate"]
      ]
    },
    {
      step: 7,
      files: [
        ["README.md", "staged"],
        ["src/multiverse/types.py", "verified"],
        ["demo/task.md", "verified"]
      ]
    },
    {
      step: 9,
      files: [
        ["README.md", "real"],
        ["src/multiverse/types.py", "real"],
        ["events.jsonl", "commit flushed"]
      ]
    }
  ];

  const FALLBACK_BENCHMARKS = {
    off: {
      success_rate: 0.35,
      wall_clock_ms: 142000,
      real_world_writes: 17
    },
    on: {
      success_rate: 0.85,
      wall_clock_ms: 69000,
      real_world_writes: 3
    }
  };

  const FIXTURE_EVENTS = [
    {
      ts: "2026-06-12T13:05:20.000Z",
      run_id: "run_fixture",
      event: "run_started",
      branch_id: "b_root",
      step_idx: 0,
      payload: { task_id: "theatrical_demo" }
    },
    {
      ts: "2026-06-12T13:05:21.000Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root",
      step_idx: 1,
      payload: {
        tool: "plan",
        args_summary: "inspect task and choose strategy",
        result_summary: "uncertain between direct edit, search, and minimal patch",
        effect_class: "read",
        latency_ms: 420
      }
    },
    {
      ts: "2026-06-12T13:05:22.000Z",
      run_id: "run_fixture",
      event: "fork",
      branch_id: "b_root",
      step_idx: 2,
      payload: {
        children: ["b_root.1", "b_root.2", "b_root.3"],
        reason: "low confidence: 0.41 - trying 3 approaches",
        entropy: 0.59
      }
    },
    {
      ts: "2026-06-12T13:05:23.000Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.1",
      step_idx: 3,
      payload: {
        tool: "read_file",
        args_summary: "open existing README and docs",
        result_summary: "finds a stale task description",
        effect_class: "read",
        latency_ms: 610
      }
    },
    {
      ts: "2026-06-12T13:05:23.200Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.2",
      step_idx: 3,
      payload: {
        tool: "search_repo",
        args_summary: "find harness entrypoints",
        result_summary: "locates fork_at contract and benchmark notes",
        effect_class: "read",
        latency_ms: 540
      }
    },
    {
      ts: "2026-06-12T13:05:23.400Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.3",
      step_idx: 3,
      payload: {
        tool: "write_file",
        args_summary: "attempt direct demo output",
        result_summary: "staged a file outside the requested workspace",
        effect_class: "write",
        latency_ms: 480
      }
    },
    {
      ts: "2026-06-12T13:05:24.000Z",
      run_id: "run_fixture",
      event: "verifier_score",
      branch_id: "b_root.3",
      step_idx: 4,
      payload: {
        branch_id: "b_root.3",
        score: 0.18,
        verdict: "fail",
        detail: "wrong file path: staged output would touch reality incorrectly"
      }
    },
    {
      ts: "2026-06-12T13:05:24.100Z",
      run_id: "run_fixture",
      event: "branch_died",
      branch_id: "b_root.3",
      step_idx: 4,
      payload: {
        cause: "verifier_rejected",
        detail: "that universe sent the wrong file - it never happened"
      }
    },
    {
      ts: "2026-06-12T13:05:25.000Z",
      run_id: "run_fixture",
      event: "fork",
      branch_id: "b_root.2",
      step_idx: 5,
      payload: {
        children: ["b_root.2.1", "b_root.2.2"],
        reason: "ambiguous patch surface - race two safe edits",
        entropy: 0.34
      }
    },
    {
      ts: "2026-06-12T13:05:25.300Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.1",
      step_idx: 6,
      payload: {
        tool: "apply_patch",
        args_summary: "rewrite broad docs",
        result_summary: "patch grows too large for demo budget",
        effect_class: "write",
        latency_ms: 1320
      }
    },
    {
      ts: "2026-06-12T13:05:26.000Z",
      run_id: "run_fixture",
      event: "branch_died",
      branch_id: "b_root.1",
      step_idx: 7,
      payload: {
        cause: "budget_killed",
        detail: "deadline budget exhausted before verification"
      }
    },
    {
      ts: "2026-06-12T13:05:26.200Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.2.1",
      step_idx: 7,
      payload: {
        tool: "apply_patch",
        args_summary: "minimal app and benchmark view",
        result_summary: "all UI surfaces stay inside theater/public",
        effect_class: "write",
        latency_ms: 810
      }
    },
    {
      ts: "2026-06-12T13:05:26.300Z",
      run_id: "run_fixture",
      event: "step",
      branch_id: "b_root.2.2",
      step_idx: 7,
      payload: {
        tool: "run_tests",
        args_summary: "syntax and smoke checks",
        result_summary: "fixture reducer misses duplicate protection",
        effect_class: "read",
        latency_ms: 740
      }
    },
    {
      ts: "2026-06-12T13:05:27.000Z",
      run_id: "run_fixture",
      event: "branch_died",
      branch_id: "b_root.2.2",
      step_idx: 8,
      payload: {
        cause: "error",
        detail: "test caught non-idempotent event insert"
      }
    },
    {
      ts: "2026-06-12T13:05:27.100Z",
      run_id: "run_fixture",
      event: "verifier_score",
      branch_id: "b_root.2.1",
      step_idx: 8,
      payload: {
        branch_id: "b_root.2.1",
        score: 0.94,
        verdict: "pass",
        detail: "visual contract met; writes staged and verified"
      }
    },
    {
      ts: "2026-06-12T13:05:28.000Z",
      run_id: "run_fixture",
      event: "commit",
      branch_id: "b_root.2.1",
      step_idx: 9,
      payload: {
        winning_branch: "b_root.2.1",
        staged_effects_flushed: 3
      }
    },
    {
      ts: "2026-06-12T13:05:28.800Z",
      run_id: "run_fixture",
      event: "run_finished",
      branch_id: "b_root.2.1",
      step_idx: 10,
      payload: { status: "finished" }
    },
    {
      ts: "2026-06-12T13:05:28.800Z",
      run_id: "run_fixture",
      event: "run_finished",
      branch_id: "b_root.2.1",
      step_idx: 10,
      payload: { status: "finished" }
    }
  ];

  const refs = {
    svg: document.getElementById("timelineSvg"),
    runButton: document.getElementById("runButton"),
    streamStatus: document.getElementById("streamStatus"),
    streamStatusText: document.getElementById("streamStatusText"),
    universeCount: document.getElementById("universeCount"),
    deadCount: document.getElementById("deadCount"),
    commitLabel: document.getElementById("commitLabel"),
    detailTitle: document.getElementById("detailTitle"),
    detailFacts: document.getElementById("detailFacts"),
    worldStep: document.getElementById("worldStep"),
    worldBranch: document.getElementById("worldBranch"),
    worldFiles: document.getElementById("worldFiles"),
    scrubber: document.getElementById("timeScrubber"),
    scrubberOutput: document.getElementById("scrubberOutput"),
    forkButton: document.getElementById("forkButton"),
    benchmarkStatus: document.getElementById("benchmarkStatus"),
    successOff: document.getElementById("successOff"),
    successOn: document.getElementById("successOn"),
    wallOff: document.getElementById("wallOff"),
    wallOn: document.getElementById("wallOn"),
    wallLabel: document.getElementById("wallLabel"),
    writesOff: document.getElementById("writesOff"),
    writesOn: document.getElementById("writesOn"),
    writesLabel: document.getElementById("writesLabel")
  };

  const app = {
    seen: new Map(),
    events: [],
    model: emptyModel(),
    selectedKey: null,
    selectedNode: null,
    viewStep: 0,
    lockToLive: true,
    source: null,
    fixtureTimer: null,
    fixturePlaying: false,
    fixtureLoaded: false,
    forkSequence: 1,
    forkOverlays: [],
    worldRequestSeq: 0
  };

  function emptyModel() {
    return {
      runId: null,
      branches: new Map(),
      nodes: [],
      maxStep: 0,
      commitBranch: null,
      commitStep: null,
      runFinished: false,
      commitLineage: []
    };
  }

  function createBranch(id) {
    return {
      id,
      parentId: parentFromBranchId(id),
      children: new Set(),
      status: "live",
      birthStep: id === "b_root" ? 0 : null,
      lastStep: 0,
      latestTool: "waiting",
      forkReason: null,
      death: null,
      verifier: null
    };
  }

  function ensureBranch(model, id) {
    const branchId = id || "b_root";
    if (!model.branches.has(branchId)) {
      model.branches.set(branchId, createBranch(branchId));
    }
    const branch = model.branches.get(branchId);
    if (branch.parentId) {
      const parent = ensureBranch(model, branch.parentId);
      parent.children.add(branchId);
    }
    return branch;
  }

  function parentFromBranchId(branchId) {
    if (!branchId || branchId === "b_root") {
      return null;
    }
    const index = branchId.lastIndexOf(".");
    return index > -1 ? branchId.slice(0, index) : "b_root";
  }

  function branchTokens(branchId) {
    if (branchId === "b_root") {
      return [];
    }
    return branchId
      .replace(/^b_root\.?/, "")
      .split(".")
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  }

  function compareBranchIds(left, right) {
    if (left === right) {
      return 0;
    }
    if (left === "b_root") {
      return -1;
    }
    if (right === "b_root") {
      return 1;
    }
    const a = branchTokens(left);
    const b = branchTokens(right);
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i += 1) {
      if (a[i] === undefined) {
        return -1;
      }
      if (b[i] === undefined) {
        return 1;
      }
      if (typeof a[i] === "number" && typeof b[i] === "number") {
        if (a[i] !== b[i]) {
          return a[i] - b[i];
        }
      } else {
        const result = String(a[i]).localeCompare(String(b[i]));
        if (result !== 0) {
          return result;
        }
      }
    }
    return 0;
  }

  function eventKey(event) {
    return [
      event.run_id || "run_unknown",
      branchIdForEvent(event),
      Number(event.step_idx) || 0,
      event.event || "unknown"
    ].join("|");
  }

  function branchIdForEvent(event) {
    if (event.event === "commit") {
      return event.payload && event.payload.winning_branch
        ? event.payload.winning_branch
        : event.branch_id || "b_root";
    }
    if (event.event === "verifier_score" && event.payload && event.payload.branch_id) {
      return event.payload.branch_id;
    }
    return event.branch_id || "b_root";
  }

  function normalizeEvent(raw, fallbackType) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const event = {
      ts: raw.ts || new Date().toISOString(),
      run_id: raw.run_id || app.model.runId || "run_live",
      event: raw.event || fallbackType || "step",
      branch_id: raw.branch_id || (raw.payload && raw.payload.branch_id) || "b_root",
      parent_branch_id: raw.parent_branch_id,
      step_idx: Number(raw.step_idx || 0),
      payload: raw.payload && typeof raw.payload === "object" ? raw.payload : {}
    };
    return event;
  }

  function compareEvents(a, b) {
    const stepDiff = Number(a.step_idx) - Number(b.step_idx);
    if (stepDiff !== 0) {
      return stepDiff;
    }
    const orderDiff = (EVENT_ORDER[a.event] ?? 99) - (EVENT_ORDER[b.event] ?? 99);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    const timeDiff = (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return branchIdForEvent(a).localeCompare(branchIdForEvent(b));
  }

  function ingestEvent(raw, fallbackType) {
    const event = normalizeEvent(raw, fallbackType);
    if (!event) {
      return false;
    }
    const key = eventKey(event);
    if (app.seen.has(key)) {
      return false;
    }
    app.seen.set(key, event);
    app.events.push(event);
    rebuildModel();
    if (app.lockToLive) {
      app.viewStep = app.model.maxStep;
    }
    render();
    return true;
  }

  function rebuildModel() {
    const model = emptyModel();
    ensureBranch(model, "b_root");

    app.events.slice().sort(compareEvents).forEach((event) => {
      model.runId = event.run_id || model.runId;
      model.maxStep = Math.max(model.maxStep, Number(event.step_idx) || 0);
      const branchId = branchIdForEvent(event);
      const branch = ensureBranch(model, branchId);
      branch.lastStep = Math.max(branch.lastStep, event.step_idx);

      if (event.event === "run_started") {
        branch.birthStep = 0;
      }

      if (event.event === "fork") {
        branch.forkReason = event.payload.reason || "forked alternate futures";
        addNode(model, event, branch.id, "fork");
        const children = Array.isArray(event.payload.children) ? event.payload.children : [];
        children.forEach((childId) => {
          const child = ensureBranch(model, childId);
          child.birthStep = child.birthStep === null ? event.step_idx : Math.min(child.birthStep, event.step_idx);
          child.lastStep = Math.max(child.lastStep, event.step_idx);
          branch.children.add(childId);
        });
      }

      if (event.event === "step") {
        branch.latestTool = event.payload.tool || "tool";
        addNode(model, event, branch.id, "step");
      }

      if (event.event === "verifier_score") {
        branch.verifier = event.payload;
        addNode(model, event, branch.id, "verifier");
      }

      if (event.event === "branch_died") {
        branch.status = "dead";
        branch.death = {
          step_idx: event.step_idx,
          cause: event.payload.cause || "error",
          detail: event.payload.detail || "branch stopped"
        };
        addNode(model, event, branch.id, "death");
      }

      if (event.event === "commit") {
        model.commitBranch = event.payload.winning_branch || event.branch_id || branch.id;
        model.commitStep = event.step_idx;
        ensureBranch(model, model.commitBranch);
        addNode(model, event, model.commitBranch, "commit");
      }

      if (event.event === "run_finished") {
        model.runFinished = true;
      }
    });

    model.branches.forEach((branch) => {
      if (branch.birthStep === null) {
        branch.birthStep = firstKnownStepForBranch(model, branch.id);
      }
      branch.lastStep = Math.max(branch.lastStep, branch.birthStep);
    });

    model.commitLineage = model.commitBranch ? lineageForBranch(model.commitBranch) : [];
    app.model = model;
  }

  function firstKnownStepForBranch(model, branchId) {
    const event = app.events
      .filter((item) => branchIdForEvent(item) === branchId)
      .sort(compareEvents)[0];
    return event ? Number(event.step_idx) || 0 : 0;
  }

  function addNode(model, event, branchId, type) {
    model.nodes.push({
      key: eventKey({ ...event, branch_id: branchId }),
      event,
      branch_id: branchId,
      step_idx: Number(event.step_idx) || 0,
      type
    });
  }

  function lineageForBranch(branchId) {
    const lineage = [];
    let current = branchId;
    while (current) {
      lineage.unshift(current);
      current = parentFromBranchId(current);
    }
    return lineage;
  }

  function isDescendantOf(branchId, ancestorId) {
    return branchId === ancestorId || branchId.startsWith(`${ancestorId}.`);
  }

  function computeLayout(model) {
    const branchIds = Array.from(model.branches.keys()).sort(compareBranchIds);
    const maxStep = Math.max(10, Math.ceil(model.maxStep), Math.ceil(app.viewStep));
    const left = 148;
    const top = 82;
    const laneGap = 86;
    const stepGap = 128;
    const right = 238;
    const bottom = 90;
    const width = left + maxStep * stepGap + right;
    const height = top + branchIds.length * laneGap + bottom;
    const lanes = new Map();
    branchIds.forEach((id, index) => lanes.set(id, top + index * laneGap));
    return {
      branchIds,
      maxStep,
      left,
      top,
      laneGap,
      stepGap,
      right,
      bottom,
      width,
      height,
      lanes,
      xForStep: (step) => left + Number(step) * stepGap,
      yForBranch: (branchId) => lanes.get(branchId) ?? top
    };
  }

  function svgEl(tag, attrs = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => {
      if (value !== undefined && value !== null) {
        element.setAttribute(name, String(value));
      }
    });
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  }

  function classNames(...items) {
    return items.filter(Boolean).join(" ");
  }

  function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function render() {
    const model = app.model;
    const layout = computeLayout(model);
    refs.svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    refs.svg.setAttribute("width", layout.width);
    refs.svg.setAttribute("height", layout.height);
    refs.svg.replaceChildren();

    drawDefs(refs.svg);
    drawAxis(refs.svg, layout);
    drawBranches(refs.svg, model, layout);
    drawNodes(refs.svg, model, layout);

    refs.universeCount.textContent = String(model.branches.size);
    refs.deadCount.textContent = String(
      Array.from(model.branches.values()).filter((branch) => branch.status === "dead").length
    );
    refs.commitLabel.textContent = model.commitBranch ? compactBranch(model.commitBranch) : "pending";

    const max = Math.max(0, Math.ceil(model.maxStep));
    refs.scrubber.max = String(max);
    refs.scrubber.value = String(Math.min(Math.ceil(app.viewStep), max));
    refs.scrubberOutput.textContent = `step ${refs.scrubber.value}`;

    reconcileSelection();
    renderDetails();
    renderWorldState();
  }

  function drawDefs(svg) {
    const defs = svgEl("defs");
    const gold = svgEl("linearGradient", { id: "goldSweep", x1: "0", x2: "1", y1: "0", y2: "0" });
    gold.append(
      svgEl("stop", { offset: "0%", "stop-color": "#ff9f1c" }),
      svgEl("stop", { offset: "52%", "stop-color": "#ffd24a" }),
      svgEl("stop", { offset: "100%", "stop-color": "#fff4b0" })
    );
    defs.append(gold);
    svg.append(defs);
  }

  function drawAxis(svg, layout) {
    const axis = svgEl("g", { "data-testid": "timeline-axis", "data-autogui": "timeline-axis" });
    axis.append(svgEl("line", {
      x1: layout.left,
      y1: 42,
      x2: layout.xForStep(layout.maxStep),
      y2: 42,
      class: "axis-line"
    }));
    for (let step = 0; step <= layout.maxStep; step += 1) {
      const x = layout.xForStep(step);
      axis.append(svgEl("line", {
        x1: x,
        y1: 52,
        x2: x,
        y2: layout.height - 48,
        stroke: "rgba(246, 251, 255, 0.08)",
        "stroke-width": 2
      }));
      axis.append(svgEl("text", {
        x,
        y: 30,
        class: "axis-label",
        "text-anchor": "middle"
      }, `t${step}`));
    }
    svg.append(axis);
  }

  function drawBranches(svg, model, layout) {
    const group = svgEl("g", { "data-testid": "timeline-branches", "data-autogui": "timeline-branches" });

    layout.branchIds.forEach((branchId) => {
      const branch = model.branches.get(branchId);
      const y = layout.yForBranch(branchId);
      const x1 = layout.xForStep(branch.birthStep);
      const x2 = layout.xForStep(Math.max(branch.lastStep, branch.birthStep + 1));
      const committed = model.commitLineage.includes(branchId);
      const oldFuture = isOldFuture(branchId, branch.lastStep);
      const future = branch.birthStep > app.viewStep;
      const branchClass = classNames(
        "branch-path",
        branch.status === "dead" && "dead",
        committed && "committed",
        future && "future",
        oldFuture && "old-future"
      );
      group.append(svgEl("path", {
        d: `M ${x1} ${y} L ${x2} ${y}`,
        class: branchClass,
        "data-testid": `branch-path-${safeId(branchId)}`,
        "data-autogui": `branch:${branchId}`
      }));

      group.append(svgEl("text", {
        x: 18,
        y: y + 6,
        class: "lane-label",
        "data-testid": `lane-label-${safeId(branchId)}`,
        "data-autogui": `lane-label:${branchId}`
      }, compactBranch(branchId)));

      if (branch.parentId && model.branches.has(branch.parentId)) {
        const parentY = layout.yForBranch(branch.parentId);
        const x = layout.xForStep(branch.birthStep);
        const splitCommitted = committed && model.commitLineage.includes(branch.parentId);
        const splitClass = classNames(
          "split-path",
          branch.status === "dead" && "dead",
          splitCommitted && "committed",
          future && "future",
          oldFuture && "old-future"
        );
        group.append(svgEl("path", {
          d: `M ${x} ${parentY} C ${x + 36} ${parentY}, ${x + 36} ${y}, ${x} ${y}`,
          class: splitClass,
          "data-testid": `split-path-${safeId(branch.parentId)}-${safeId(branchId)}`,
          "data-autogui": `split:${branch.parentId}->${branchId}`
        }));
      }
    });

    if (model.commitBranch && model.commitStep !== null) {
      const y = layout.yForBranch(model.commitBranch);
      const x1 = layout.xForStep(model.commitStep);
      const x2 = Math.max(x1 + 180, layout.width - 72);
      group.append(svgEl("path", {
        d: `M ${x1} ${y} L ${x2} ${y}`,
        class: "reality-trunk",
        "data-testid": "reality-trunk",
        "data-autogui": "reality-trunk"
      }));
      group.append(svgEl("text", {
        x: x2 - 6,
        y: y - 20,
        class: "reality-label",
        "text-anchor": "end",
        "data-testid": "reality-label",
        "data-autogui": "reality-label"
      }, "REALITY"));
    }

    svg.append(group);
  }

  function drawNodes(svg, model, layout) {
    const group = svgEl("g", { "data-testid": "timeline-nodes", "data-autogui": "timeline-nodes" });
    const latestLiveKeys = latestLiveNodeKeys(model);

    model.nodes.slice().sort((a, b) => a.step_idx - b.step_idx || compareBranchIds(a.branch_id, b.branch_id)).forEach((node) => {
      const branch = model.branches.get(node.branch_id);
      const x = layout.xForStep(node.step_idx);
      const y = layout.yForBranch(node.branch_id);
      const committed = Boolean(model.commitBranch && model.commitLineage.includes(node.branch_id) && node.step_idx <= model.commitStep);
      const dead = branch && branch.status === "dead";
      const future = node.step_idx > app.viewStep;
      const oldFuture = isOldFuture(node.branch_id, node.step_idx);
      const selected = app.selectedKey === node.key;
      const liveHead = latestLiveKeys.has(node.key);
      const nodeClass = classNames(
        "timeline-node",
        node.type,
        committed && "committed",
        dead && "dead",
        selected && "selected",
        liveHead && "live-head",
        future && "future",
        oldFuture && "old-future"
      );
      const nodeGroup = svgEl("g", {
        class: nodeClass,
        transform: `translate(${x} ${y})`,
        tabindex: "0",
        role: "button",
        "aria-label": `${node.type} ${node.branch_id} step ${node.step_idx}`,
        "data-node-key": node.key,
        "data-testid": `timeline-node-${safeId(node.branch_id)}-${safeId(node.step_idx)}-${node.type}`,
        "data-autogui": `timeline-node:${node.branch_id}:${node.step_idx}:${node.type}`
      });

      if (liveHead) {
        nodeGroup.append(svgEl("circle", { class: "head-ring", r: 18, cx: 0, cy: 0 }));
      }

      if (node.type === "fork") {
        nodeGroup.append(svgEl("rect", {
          class: "node-core",
          x: -12,
          y: -12,
          width: 24,
          height: 24,
          rx: 4,
          transform: "rotate(45)"
        }));
      } else {
        nodeGroup.append(svgEl("circle", { class: "node-core", r: node.type === "commit" ? 16 : 13, cx: 0, cy: 0 }));
      }

      if (node.type === "death") {
        appendCauseIcon(nodeGroup, node.event.payload.cause || "error", -8, -8, 16);
      }

      if (node.type === "verifier") {
        appendCheckIcon(nodeGroup, -8, -8, 16);
      }

      const label = labelForNode(node);
      if (label) {
        nodeGroup.append(svgEl("text", {
          x: 20,
          y: node.type === "death" ? -20 : -18,
          class: "node-label",
          "data-testid": `node-label-${safeId(node.branch_id)}-${safeId(node.step_idx)}-${node.type}`,
          "data-autogui": `node-label:${node.branch_id}:${node.step_idx}:${node.type}`
        }, label));
      }

      nodeGroup.addEventListener("click", () => selectNode(node.key, false));
      nodeGroup.addEventListener("mouseenter", () => selectNode(node.key, false));
      nodeGroup.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node.key, false);
        }
      });
      group.append(nodeGroup);
    });

    svg.append(group);
  }

  function latestLiveNodeKeys(model) {
    const keys = new Set();
    model.branches.forEach((branch, branchId) => {
      if (branch.status === "dead" || model.runFinished || model.commitBranch) {
        return;
      }
      const nodes = model.nodes
        .filter((node) => node.branch_id === branchId && node.type !== "death")
        .sort((a, b) => b.step_idx - a.step_idx);
      if (nodes[0]) {
        keys.add(nodes[0].key);
      }
    });
    return keys;
  }

  function appendCauseIcon(group, cause, x, y, size) {
    const icon = svgEl("g", {
      transform: `translate(${x} ${y})`,
      "data-testid": `cause-icon-${safeId(cause)}`,
      "data-autogui": `cause-icon:${cause}`
    });
    if (cause === "budget_killed") {
      icon.append(svgEl("circle", { class: "cause-icon", cx: size / 2, cy: size / 2, r: size / 2 - 1 }));
      icon.append(svgEl("path", { class: "cause-icon", d: `M ${size / 2} ${size / 2} V 3 M ${size / 2} ${size / 2} L ${size - 3} ${size / 2}` }));
    } else if (cause === "verifier_rejected") {
      icon.append(svgEl("path", { class: "cause-icon", d: `M 3 3 L ${size - 3} ${size - 3} M ${size - 3} 3 L 3 ${size - 3}` }));
    } else {
      icon.append(svgEl("path", { class: "cause-icon-fill", d: `M ${size / 2} 2 L ${size - 2} ${size - 2} H 2 Z` }));
      icon.append(svgEl("path", { class: "cause-icon", d: `M ${size / 2} 6 V 10 M ${size / 2} 13 V 14` }));
    }
    group.append(icon);
  }

  function appendCheckIcon(group, x, y, size) {
    group.append(svgEl("path", {
      class: "cause-icon",
      transform: `translate(${x} ${y})`,
      d: `M 3 ${size / 2} L ${size / 2 - 1} ${size - 4} L ${size - 2} 4`,
      "data-testid": "verifier-check-icon",
      "data-autogui": "verifier-check-icon"
    }));
  }

  function labelForNode(node) {
    if (node.type === "step") {
      return truncate(node.event.payload.tool || "tool", 18);
    }
    if (node.type === "fork") {
      const children = Array.isArray(node.event.payload.children) ? node.event.payload.children.length : 0;
      return `FORK x${children}`;
    }
    if (node.type === "death") {
      const cause = CAUSES[node.event.payload.cause] || CAUSES.error;
      return `DIED: ${cause.short}`;
    }
    if (node.type === "commit") {
      return "COMMIT";
    }
    if (node.type === "verifier") {
      const score = Number(node.event.payload.score);
      return Number.isFinite(score) ? `score ${score.toFixed(2)}` : "verifier";
    }
    return "";
  }

  function truncate(value, limit) {
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit - 1)}.` : text;
  }

  function compactBranch(branchId) {
    return branchId === "b_root" ? "b_root" : branchId.replace("b_root.", "b.");
  }

  function isOldFuture(branchId, stepIdx) {
    return app.forkOverlays.some((overlay) => {
      if (stepIdx <= overlay.step_idx || !isDescendantOf(branchId, overlay.branch_id)) {
        return false;
      }
      return !overlay.children.some((child) => isDescendantOf(branchId, child));
    });
  }

  function reconcileSelection() {
    const nodesByKey = new Map(app.model.nodes.map((node) => [node.key, node]));
    if (app.selectedKey && nodesByKey.has(app.selectedKey)) {
      app.selectedNode = nodesByKey.get(app.selectedKey);
      return;
    }
    const visibleNodes = app.model.nodes
      .filter((node) => node.step_idx <= app.viewStep)
      .sort((a, b) => b.step_idx - a.step_idx || compareBranchIds(a.branch_id, b.branch_id));
    const fallback = visibleNodes[0] || app.model.nodes[0] || null;
    app.selectedNode = fallback;
    app.selectedKey = fallback ? fallback.key : null;
  }

  function selectNode(key, keepLiveLock) {
    const node = app.model.nodes.find((item) => item.key === key);
    if (!node) {
      return;
    }
    app.selectedKey = key;
    app.selectedNode = node;
    app.lockToLive = keepLiveLock;
    if (!keepLiveLock) {
      app.viewStep = Math.max(app.viewStep, Math.min(node.step_idx, app.model.maxStep));
    }
    render();
  }

  function renderDetails() {
    const node = app.selectedNode;
    refs.detailFacts.replaceChildren();
    if (!node) {
      refs.detailTitle.textContent = "Waiting for run";
      refs.forkButton.disabled = true;
      appendFact("Status", "Open the app with a backend or use fixture fallback");
      return;
    }

    const event = node.event;
    refs.detailTitle.textContent = `${event.event} on ${compactBranch(node.branch_id)}`;
    appendFact("Branch", node.branch_id);
    appendFact("Step", String(node.step_idx));
    appendFact("Event", event.event);

    if (event.event === "step") {
      appendFact("Tool", event.payload.tool || "tool");
      appendFact("Args", event.payload.args_summary || "none");
      appendFact("Result", event.payload.result_summary || "pending");
      appendFact("Effect", event.payload.effect_class || "unknown");
      appendFact("Latency", event.payload.latency_ms ? `${event.payload.latency_ms} ms` : "pending");
    }

    if (event.event === "fork") {
      const children = Array.isArray(event.payload.children) ? event.payload.children.join(", ") : "pending";
      appendFact("Children", children);
      appendFact("Reason", event.payload.reason || "low confidence");
      appendFact("Entropy", event.payload.entropy !== undefined ? String(event.payload.entropy) : "unknown");
    }

    if (event.event === "verifier_score") {
      appendFact("Verdict", event.payload.verdict || "pending");
      appendFact("Score", event.payload.score !== undefined ? String(event.payload.score) : "unknown");
      appendFact("Detail", event.payload.detail || "none");
    } else {
      const branch = app.model.branches.get(node.branch_id);
      if (branch && branch.verifier) {
        appendFact("Verifier", `${branch.verifier.verdict || "score"} ${branch.verifier.score ?? ""}`.trim());
        appendFact("Verifier detail", branch.verifier.detail || "none");
      }
    }

    if (event.event === "branch_died") {
      const cause = CAUSES[event.payload.cause] || CAUSES.error;
      appendFact("Cause", cause.label);
      appendFact("Detail", event.payload.detail || "none");
    }

    if (event.event === "commit") {
      appendFact("Winner", event.payload.winning_branch || node.branch_id);
      appendFact("Writes flushed", String(event.payload.staged_effects_flushed ?? 0));
    }

    refs.forkButton.disabled = !canForkFrom(node);
  }

  function appendFact(label, value) {
    refs.detailFacts.append(svgSafeTextElement("dt", label), svgSafeTextElement("dd", value || "unknown"));
  }

  function svgSafeTextElement(tagName, value) {
    const element = document.createElement(tagName);
    element.textContent = String(value);
    return element;
  }

  function canForkFrom(node) {
    if (!node) {
      return false;
    }
    return node.step_idx <= app.model.maxStep && ["step", "fork", "verifier", "commit"].includes(node.type);
  }

  function renderFixtureWorldState(branch, step) {
    const snapshot = WORLD_FIXTURE
      .slice()
      .reverse()
      .find((item) => item.step <= step) || WORLD_FIXTURE[0];
    refs.worldStep.textContent = String(step);
    refs.worldBranch.textContent = branch;
    refs.worldFiles.replaceChildren();
    snapshot.files.forEach(([file, status]) => {
      appendWorldFile(file, status);
    });
  }

  function appendWorldFile(file, status, title = "") {
    const item = document.createElement("li");
    item.setAttribute("data-testid", `world-file-${safeId(file)}`);
    item.setAttribute("data-autogui", `world-file:${file}`);
    if (title) {
      item.title = title;
    }
    const name = document.createElement("span");
    name.textContent = file;
    const state = document.createElement("span");
    state.textContent = status;
    item.append(name, state);
    refs.worldFiles.append(item);
  }

  async function renderWorldState() {
    const selected = app.selectedNode;
    const branch = selected ? selected.branch_id : "b_root";
    const step = Math.floor(Number(app.viewStep) || 0);
    const requestSeq = ++app.worldRequestSeq;
    refs.worldStep.textContent = String(step);
    refs.worldBranch.textContent = branch;
    refs.worldFiles.replaceChildren();
    appendWorldFile("loading replay state", "pending");

    try {
      const response = await fetch("/api/world_state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          run_id: selected?.event?.run_id || app.model.runId || "run_fixture",
          branch_id: branch,
          step_idx: step
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      if (requestSeq !== app.worldRequestSeq) {
        return;
      }
      const files = Array.isArray(body?.workspace?.files)
        ? body.workspace.files
        : Array.isArray(body?.files)
          ? body.files
          : [];
      if (files.length === 0) {
        throw new Error("empty world_state response");
      }
      refs.worldFiles.replaceChildren();
      files.forEach((file) => {
        const filePath = file.path || file.name || "unknown";
        const status = file.status || file.kind || `${Number(file.size_bytes || 0)} bytes`;
        const title = file.text || file.summary || "";
        appendWorldFile(filePath, status, title);
      });
    } catch {
      if (requestSeq === app.worldRequestSeq) {
        renderFixtureWorldState(branch, step);
      }
    }
  }

  function setStreamStatus(kind, text) {
    refs.streamStatus.className = `stream-status ${kind}`;
    refs.streamStatusText.textContent = text;
  }

  function connectEvents() {
    if (window.location.protocol === "file:") {
      setStreamStatus("fallback", "Fixture fallback: local file");
      startFixturePlayback();
      return;
    }
    if (!("EventSource" in window)) {
      setStreamStatus("fallback", "Fixture fallback: no EventSource");
      startFixturePlayback();
      return;
    }

    try {
      const source = new EventSource("/events");
      app.source = source;
      let sawEvent = false;

      source.onopen = () => setStreamStatus("live", "Connected to /events");
      source.onmessage = (message) => {
        sawEvent = true;
        handleIncomingData(message.data);
      };

      ["run_started", "step", "fork", "branch_died", "commit", "run_finished", "verifier_score"].forEach((type) => {
        source.addEventListener(type, (message) => {
          sawEvent = true;
          handleIncomingData(message.data, type);
        });
      });

      source.onerror = () => {
        if (!sawEvent && !app.fixtureLoaded) {
          setStreamStatus("fallback", "Fixture fallback: /events unavailable");
          source.close();
          startFixturePlayback();
        } else {
          setStreamStatus("error", "SSE interrupted");
        }
      };

      window.setTimeout(() => {
        if (!sawEvent && app.events.length === 0 && !app.fixtureLoaded) {
          setStreamStatus("fallback", "Fixture fallback: waiting on /events");
          source.close();
          startFixturePlayback();
        }
      }, 1300);
    } catch (error) {
      setStreamStatus("fallback", "Fixture fallback: /events failed");
      startFixturePlayback();
    }
  }

  function handleIncomingData(data, fallbackType) {
    if (!data) {
      return;
    }
    String(data)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed)) {
            parsed.forEach((event) => ingestEvent(event, fallbackType));
          } else {
            ingestEvent(parsed, fallbackType);
          }
        } catch (error) {
          console.warn("Ignoring malformed event", error);
        }
      });
  }

  function startFixturePlayback(reset = true) {
    if (app.fixturePlaying) {
      return;
    }
    app.fixtureLoaded = true;
    app.fixturePlaying = true;
    setStreamStatus("fallback", "Fixture replay at 2x");
    if (reset) {
      clearEvents();
    }
    let index = 0;
    const tick = () => {
      if (index >= FIXTURE_EVENTS.length) {
        app.fixturePlaying = false;
        window.clearInterval(app.fixtureTimer);
        app.fixtureTimer = null;
        setStreamStatus("fallback", "Fixture replay complete");
        return;
      }
      ingestEvent(FIXTURE_EVENTS[index]);
      index += 1;
    };
    tick();
    app.fixtureTimer = window.setInterval(tick, 360);
  }

  function clearEvents() {
    if (app.fixtureTimer) {
      window.clearInterval(app.fixtureTimer);
      app.fixtureTimer = null;
    }
    app.seen.clear();
    app.events = [];
    app.model = emptyModel();
    app.selectedKey = null;
    app.selectedNode = null;
    app.viewStep = 0;
    app.lockToLive = true;
    app.forkOverlays = [];
    rebuildModel();
    render();
  }

  async function runTask() {
    refs.runButton.disabled = true;
    refs.runButton.querySelector("span").textContent = "Running";
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: "trap_file", speculation: true })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      clearEvents();
      setStreamStatus("live", "Run started; waiting on /events");
      if (app.source && app.source.readyState === EventSource.CLOSED) {
        connectEvents();
      }
      window.setTimeout(() => {
        if (app.events.length === 0) {
          startFixturePlayback();
        }
      }, 1500);
    } catch (error) {
      startFixturePlayback();
    } finally {
      refs.runButton.disabled = false;
      refs.runButton.querySelector("span").textContent = "Run Task";
    }
  }

  async function forkFromHere() {
    const node = app.selectedNode;
    if (!canForkFrom(node)) {
      return;
    }
    refs.forkButton.disabled = true;
    refs.forkButton.querySelector("span").textContent = "Forking";
    const request = {
      branch_id: node.branch_id,
      step_idx: node.step_idx,
      n: 2
    };
    let children = null;
    try {
      const response = await fetch("/api/fork_at", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        children = Array.isArray(body.children) ? body.children : null;
        setStreamStatus("live", "POST /api/fork_at accepted");
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      setStreamStatus("fallback", "Local fork fallback");
      children = null;
    }

    if (!children || children.length === 0) {
      children = localForkChildren(node.branch_id);
      injectLocalFork(node, children);
    } else {
      app.forkOverlays.push({ branch_id: node.branch_id, step_idx: node.step_idx, children });
      const forkStep = nextAvailableForkStep(node.branch_id, node.step_idx);
      ingestEvent({
        ts: new Date().toISOString(),
        run_id: app.model.runId || "run_live",
        event: "fork",
        branch_id: node.branch_id,
        step_idx: forkStep,
        payload: {
          children,
          reason: "operator forked from scrubbed history",
          entropy: 0.5
        }
      });
    }

    app.lockToLive = true;
    app.viewStep = app.model.maxStep;
    render();
    refs.forkButton.querySelector("span").textContent = "Fork From Here";
  }

  function localForkChildren(branchId) {
    const existing = Array.from(app.model.branches.keys()).filter((id) => parentFromBranchId(id) === branchId);
    const base = existing.length + app.forkSequence;
    app.forkSequence += 2;
    return [`${branchId}.${base}`, `${branchId}.${base + 1}`];
  }

  function nextAvailableForkStep(branchId, stepIdx) {
    let step = Number(stepIdx) || 0;
    const runId = app.model.runId || "run_live";
    while (app.seen.has([runId, branchId, step, "fork"].join("|"))) {
      step += 1;
    }
    return step;
  }

  function injectLocalFork(node, children) {
    const runId = app.model.runId || "run_fixture";
    const forkStep = nextAvailableForkStep(node.branch_id, node.step_idx);
    const base = new Date();
    app.forkOverlays.push({ branch_id: node.branch_id, step_idx: node.step_idx, children });
    const synthetic = [
      {
        ts: base.toISOString(),
        run_id: runId,
        event: "fork",
        branch_id: node.branch_id,
        step_idx: forkStep,
        payload: {
          children,
          reason: "operator forked from scrubbed history",
          entropy: 0.47
        }
      },
      {
        ts: new Date(base.getTime() + 300).toISOString(),
        run_id: runId,
        event: "step",
        branch_id: children[0],
        step_idx: forkStep + 1,
        payload: {
          tool: "replay_workspace",
          args_summary: `replay ${node.branch_id} until step ${node.step_idx}`,
          result_summary: "workspace restored from recorded tool results",
          effect_class: "read",
          latency_ms: 260
        }
      },
      {
        ts: new Date(base.getTime() + 500).toISOString(),
        run_id: runId,
        event: "step",
        branch_id: children[1],
        step_idx: forkStep + 1,
        payload: {
          tool: "try_alt_patch",
          args_summary: "alternate future with broader write",
          result_summary: "verifier sees extra side effects",
          effect_class: "write",
          latency_ms: 430
        }
      },
      {
        ts: new Date(base.getTime() + 900).toISOString(),
        run_id: runId,
        event: "branch_died",
        branch_id: children[1],
        step_idx: forkStep + 2,
        payload: {
          cause: "verifier_rejected",
          detail: "alternate future wrote outside the replay target"
        }
      },
      {
        ts: new Date(base.getTime() + 1100).toISOString(),
        run_id: runId,
        event: "verifier_score",
        branch_id: children[0],
        step_idx: forkStep + 2,
        payload: {
          branch_id: children[0],
          score: 0.96,
          verdict: "pass",
          detail: "replayed state verified; staged writes are safe"
        }
      },
      {
        ts: new Date(base.getTime() + 1400).toISOString(),
        run_id: runId,
        event: "commit",
        branch_id: children[0],
        step_idx: forkStep + 3,
        payload: {
          winning_branch: children[0],
          staged_effects_flushed: 2
        }
      }
    ];
    synthetic.forEach((event, index) => {
      window.setTimeout(() => ingestEvent(event), index * 280);
    });
  }

  async function loadBenchmarks() {
    try {
      const response = await fetch("/api/benchmarks", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      renderBenchmarks(normalizeBenchmarks(data), "live /api/benchmarks");
    } catch (error) {
      renderBenchmarks(FALLBACK_BENCHMARKS, "fixture benchmarks");
    }
  }

  function normalizeBenchmarks(data) {
    if (data && data.off && data.on) {
      return data;
    }
    if (Array.isArray(data)) {
      const off = data.find((item) => item.speculation === false || item.speculation_enabled === false || item.mode === "off");
      const on = data.find((item) => item.speculation === true || item.speculation_enabled === true || item.mode === "on");
      if (off && on) {
        return { off, on };
      }
    }
    return FALLBACK_BENCHMARKS;
  }

  function renderBenchmarks(data, sourceLabel) {
    const off = data.off || FALLBACK_BENCHMARKS.off;
    const on = data.on || FALLBACK_BENCHMARKS.on;
    const offSuccess = percent(off.success_rate ?? off.success ?? 0);
    const onSuccess = percent(on.success_rate ?? on.success ?? 0);
    const offWall = Number(off.wall_clock_ms ?? off.wall_clock ?? off.wall_ms ?? 0);
    const onWall = Number(on.wall_clock_ms ?? on.wall_clock ?? on.wall_ms ?? 0);
    const offWrites = Number(off.real_world_writes ?? off.writes ?? 0);
    const onWrites = Number(on.real_world_writes ?? on.writes ?? 0);

    refs.benchmarkStatus.textContent = sourceLabel;
    refs.successOff.textContent = `${Math.round(offSuccess)}%`;
    refs.successOn.textContent = `${Math.round(onSuccess)}%`;

    const wallMax = Math.max(offWall, onWall, 1);
    refs.wallOff.style.width = `${Math.max(4, (offWall / wallMax) * 100)}%`;
    refs.wallOn.style.width = `${Math.max(4, (onWall / wallMax) * 100)}%`;
    refs.wallLabel.textContent = `${formatMs(offWall)} -> ${formatMs(onWall)}`;

    const writeMax = Math.max(offWrites, onWrites, 1);
    refs.writesOff.style.width = `${Math.max(4, (offWrites / writeMax) * 100)}%`;
    refs.writesOn.style.width = `${Math.max(4, (onWrites / writeMax) * 100)}%`;
    refs.writesLabel.textContent = `${offWrites} -> ${onWrites}`;
  }

  function percent(value) {
    const numeric = Number(value) || 0;
    return numeric <= 1 ? numeric * 100 : numeric;
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return "--";
    }
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
    }
    return `${Math.round(ms)}ms`;
  }

  refs.runButton.addEventListener("click", runTask);
  refs.forkButton.addEventListener("click", forkFromHere);
  refs.scrubber.addEventListener("input", () => {
    app.lockToLive = Number(refs.scrubber.value) >= app.model.maxStep;
    app.viewStep = Number(refs.scrubber.value) || 0;
    render();
  });

  rebuildModel();
  render();
  loadBenchmarks();
  connectEvents();
})();
