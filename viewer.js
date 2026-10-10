import { WebSVG } from "./src/websvg.js";

const topbarEl = document.querySelector(".topbar");
const statusEl = document.querySelector("#status");
const workspaceEl = document.querySelector("#workspace");
const summaryEl = document.querySelector("#selection-summary");
const clearButton = document.querySelector("#clear-selection");
const focusButton = document.querySelector("#focus-selection");

const websvg = new WebSVG();
const rootUrl = new URL(".", import.meta.url);
const inputUrl = new URL("input/", rootUrl);

let currentSelection = null;
let currentRepresentationRef = null;
let focusActive = false;

const svgState = new WeakMap();
const navigation = {
  timelineRows: [],
  matrix: null
};

clearButton.addEventListener("click", clearSelection);

focusButton.addEventListener("click", () => {
  if (!currentSelection) return;
  focusActive = !focusActive;
  applyFocusState();
});

window.addEventListener("resize", updateViewerMetrics);

window.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) {
    return;
  }

  const directions = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down"
  };

  const direction = directions[event.key];
  if (!direction) return;

  if (navigateSelection(direction)) {
    event.preventDefault();
  }
});

function updateViewerMetrics() {
  const topbarHeight = topbarEl?.getBoundingClientRect().height || 52;
  const verticalChrome = topbarHeight + 24;
  const freeHeight = Math.max(300, window.innerHeight - verticalChrome);

  document.documentElement.style.setProperty(
    "--websvg-stage-height",
    `${freeHeight}px`
  );
}

function fail(error) {
  console.error(error);
  statusEl.textContent = "Failed";
  summaryEl.textContent = error instanceof Error ? error.message : String(error);
  workspaceEl.replaceChildren();
}

async function discoverInputFiles() {
  const response = await fetch(inputUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`input discovery failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (contentType.includes("application/json")) {
    const inventory = JSON.parse(body);

    if (!inventory.ok) {
      throw new Error(inventory.error || "input discovery failed");
    }

    const manifest = inventory.manifest;
    const svgFiles = Array.isArray(inventory.svg_files)
      ? inventory.svg_files
      : [];

    if (typeof manifest !== "string" || !/\.json$/i.test(manifest)) {
      throw new Error("input/ must contain exactly one JSON manifest");
    }

    if (svgFiles.length === 0) {
      throw new Error("input/ contains no SVG files");
    }

    return { manifest, svgFiles };
  }

  const listing = new DOMParser().parseFromString(body, "text/html");
  const names = new Set();

  for (const anchor of listing.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let url;
    try {
      url = new URL(href, inputUrl);
    } catch {
      continue;
    }

    if (url.origin !== inputUrl.origin) continue;
    if (!url.pathname.startsWith(inputUrl.pathname)) continue;

    const relative = decodeURIComponent(
      url.pathname.slice(inputUrl.pathname.length)
    );

    if (!relative || relative.includes("/")) continue;
    if (!/\.(?:svg|json)$/i.test(relative)) continue;

    names.add(relative);
  }

  const files = [...names].sort((a, b) => a.localeCompare(b));
  const manifests = files.filter(name => /\.json$/i.test(name));
  const svgFiles = files.filter(name => /\.svg$/i.test(name));

  if (manifests.length !== 1) {
    throw new Error(
      `input/ must contain exactly one JSON manifest; found ${manifests.length}`
    );
  }

  if (svgFiles.length === 0) {
    throw new Error("input/ contains no SVG files");
  }

  return { manifest: manifests[0], svgFiles };
}

function createViewportControls() {
  const controls = document.createElement("div");
  controls.className = "svg-controls";

  for (const [action, label, title] of [
    ["zoom-in", "+", "Zoom in"],
    ["zoom-out", "−", "Zoom out"],
    ["reset", "Reset", "Reset view"]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.viewportAction = action;
    button.textContent = label;
    button.title = title;
    controls.append(button);
  }

  return controls;
}

function makeHosts(svgFiles, declarations) {
  const declaredByFile = new Map(
    declarations
      .map(item => [item.file || item.src, item])
      .filter(([file]) => typeof file === "string")
  );

  const hosts = {};
  workspaceEl.replaceChildren();

  for (const file of svgFiles) {
    const declaration = declaredByFile.get(file) || {};
    const id = declaration.id || file.replace(/\.svg$/i, "");

    const article = document.createElement("section");
    article.className = "svg-document";
    article.setAttribute("aria-label", id);

    const host = document.createElement("div");
    host.className = "svg-host";

    article.append(createViewportControls(), host);
    workspaceEl.append(article);

    hosts[id] = host;
    hosts[file] = host;
  }

  return hosts;
}

function parseViewBox(value) {
  const parts = String(value || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value))) {
    return null;
  }

  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;

  return { x, y, width, height };
}

function cloneBox(box) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  };
}

function boxString(box) {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

function constrainToReset(box, reset) {
  if (!reset) return cloneBox(box);

  const width = Math.min(box.width, reset.width);
  const height = Math.min(box.height, reset.height);

  const maxX = reset.x + reset.width - width;
  const maxY = reset.y + reset.height - height;

  return {
    x: Math.min(Math.max(box.x, reset.x), maxX),
    y: Math.min(Math.max(box.y, reset.y), maxY),
    width,
    height
  };
}

function setViewBox(svg, box) {
  const state = svgState.get(svg);
  if (!state) return;

  const constrained = constrainToReset(box, state.resetViewBox);
  state.currentViewBox = constrained;
  svg.setAttribute("viewBox", boxString(constrained));
}

function setResetViewBox(svg, box) {
  const state = svgState.get(svg);
  if (!state) return;

  state.resetViewBox = cloneBox(box);
  state.currentViewBox = cloneBox(box);
  svg.setAttribute("viewBox", boxString(box));
}

function resetViewport(svg) {
  const state = svgState.get(svg);
  if (!state) return;

  setViewBox(svg, cloneBox(state.resetViewBox));
}

function zoomAt(svg, clientX, clientY, factor) {
  const state = svgState.get(svg);
  if (!state) return;

  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const current = state.currentViewBox;
  const reset = state.resetViewBox;

  const minWidth = reset.width * 0.02;
  const targetWidth = Math.min(
    reset.width,
    Math.max(minWidth, current.width * factor)
  );

  const scale = targetWidth / current.width;
  const targetHeight = Math.min(reset.height, current.height * scale);

  const rx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const ry = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

  const anchorX = current.x + current.width * rx;
  const anchorY = current.y + current.height * ry;

  setViewBox(svg, {
    x: anchorX - targetWidth * rx,
    y: anchorY - targetHeight * ry,
    width: targetWidth,
    height: targetHeight
  });
}

function zoomCenter(svg, factor) {
  const rect = svg.getBoundingClientRect();

  zoomAt(
    svg,
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    factor
  );
}

function wireViewportControls(record) {
  const article = record.host?.closest(".svg-document");
  if (!article) return;

  for (const button of article.querySelectorAll("[data-viewport-action]")) {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.viewportAction;

      if (action === "zoom-in") zoomCenter(record.svg, 0.72);
      if (action === "zoom-out") zoomCenter(record.svg, 1.38);
      if (action === "reset") resetViewport(record.svg);
    });
  }
}

function wireViewportInteractions(record) {
  const svg = record.svg;

  svg.addEventListener("wheel", event => {
    if (!event.ctrlKey && !event.metaKey) return;

    event.preventDefault();

    zoomAt(
      svg,
      event.clientX,
      event.clientY,
      event.deltaY < 0 ? 0.82 : 1.22
    );
  }, { passive: false });

  svg.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();

    zoomAt(svg, event.clientX, event.clientY, 0.58);
  });

  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    const state = svgState.get(svg);
    if (!state) return;

    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBox: cloneBox(state.currentViewBox),
      moved: false
    };

    svg.setPointerCapture?.(event.pointerId);
  });

  svg.addEventListener("pointermove", event => {
    const state = svgState.get(svg);
    const drag = state?.drag;

    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < 4) return;

    drag.moved = true;
    svg.classList.add("is-panning");

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    setViewBox(svg, {
      x: drag.startBox.x - dx * (drag.startBox.width / rect.width),
      y: drag.startBox.y - dy * (drag.startBox.height / rect.height),
      width: drag.startBox.width,
      height: drag.startBox.height
    });
  });

  const finishDrag = event => {
    const state = svgState.get(svg);
    const drag = state?.drag;

    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.moved) {
      state.suppressClickUntil = Date.now() + 180;
    }

    state.drag = null;
    svg.classList.remove("is-panning");

    if (svg.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  };

  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
}

function prepareSvgDocuments() {
  for (const record of websvg.documents()) {
    const svg = record.svg;
    const originalViewBox = parseViewBox(svg.getAttribute("viewBox"));

    if (!originalViewBox) {
      throw new Error(
        `WebSVG: SVG has no valid viewBox: ${record.file}`
      );
    }

    svgState.set(svg, {
      originalViewBox: cloneBox(originalViewBox),
      resetViewBox: cloneBox(originalViewBox),
      currentViewBox: cloneBox(originalViewBox),
      drag: null,
      suppressClickUntil: 0
    });

    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("websvg-document-svg");

    wireViewportControls(record);
    wireViewportInteractions(record);
  }
}

function wireRepresentationClicks() {
  const identityAttribute =
    websvg.manifest.representation.identity_attribute || "data-websvg-id";

  const selector = `[${identityAttribute}]`;

  for (const record of websvg.documents()) {
    const elements = [];

    if (record.svg.matches(selector)) {
      elements.push(record.svg);
    }

    elements.push(...record.svg.querySelectorAll(selector));

    for (const element of elements) {
      element.classList.add("websvg-interactive");

      element.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const state = svgState.get(record.svg);
        if (state?.suppressClickUntil > Date.now()) return;

        const representationRef = element.getAttribute(identityAttribute);

        if (representationRef) {
          selectRepresentation(representationRef);
        }
      });
    }
  }
}

function buildNavigationModel() {
  navigation.timelineRows = [];
  navigation.matrix = null;

  for (const record of websvg.documents()) {
    const svg = record.svg;

    const rows = [
      ...svg.querySelectorAll(
        '.timeline[data-websvg-id^="rep:timeline-role:"]'
      )
    ];

    if (rows.length > 0) {
      navigation.timelineRows = rows.map(row => ({
        element: row,
        ref: row.getAttribute("data-websvg-id"),
        steps: [
          ...row.querySelectorAll(
            '.process-step[data-websvg-id^="rep:timeline-step:"]'
          )
        ].sort((a, b) => stepSlot(a) - stepSlot(b))
      }));
    }

    const matrixSteps = [
      ...svg.querySelectorAll('[data-websvg-id^="rep:matrix-step:"]')
    ];

    const matrixUniversals = [
      ...svg.querySelectorAll('[data-websvg-id^="rep:matrix-universal:"]')
    ];

    const matrixCells = [
      ...svg.querySelectorAll('[data-websvg-id^="rep:matrix-cell:"]')
    ];

    if (matrixSteps.length > 0 && matrixUniversals.length > 0) {
      const stepOrder = matrixSteps.map(element =>
        element.getAttribute("data-websvg-id").slice("rep:matrix-step:".length)
      );

      const universalOrder = matrixUniversals.map(element =>
        element
          .getAttribute("data-websvg-id")
          .slice("rep:matrix-universal:".length)
      );

      const cells = new Map();

      for (const element of matrixCells) {
        const ref = element.getAttribute("data-websvg-id");
        const parsed = parseMatrixCellRef(ref);

        if (parsed) {
          cells.set(`${parsed.step}\n${parsed.universal}`, element);
        }
      }

      navigation.matrix = {
        svg,
        stepOrder,
        universalOrder,
        cells
      };
    }
  }
}

function stepSlot(element) {
  const slot = Number(element.getAttribute("data-slot"));
  return Number.isFinite(slot) ? slot : Number.MAX_SAFE_INTEGER;
}

function parseMatrixCellRef(ref) {
  const prefix = "rep:matrix-cell:";

  if (typeof ref !== "string" || !ref.startsWith(prefix)) {
    return null;
  }

  const tail = ref.slice(prefix.length);
  const separator = tail.lastIndexOf(":");

  if (separator <= 0 || separator >= tail.length - 1) {
    return null;
  }

  return {
    step: tail.slice(0, separator),
    universal: tail.slice(separator + 1)
  };
}

function navigateSelection(direction) {
  if (!currentRepresentationRef) return false;

  if (currentRepresentationRef.startsWith("rep:timeline-step:")) {
    return navigateTimeline(direction);
  }

  if (currentRepresentationRef.startsWith("rep:matrix-cell:")) {
    return navigateMatrix(direction);
  }

  return false;
}

function navigateTimeline(direction) {
  const item = websvg.representation(currentRepresentationRef)[0];
  const element = item?.element;

  if (!element) return false;

  const rowIndex = navigation.timelineRows.findIndex(
    row => row.element === element.closest(".timeline")
  );

  if (rowIndex < 0) return false;

  const row = navigation.timelineRows[rowIndex];
  const stepIndex = row.steps.indexOf(element);

  if (stepIndex < 0) return false;

  if (direction === "left" || direction === "right") {
    const delta = direction === "left" ? -1 : 1;
    const target = row.steps[stepIndex + delta];

    if (!target) return false;

    return selectElementRepresentation(target);
  }

  if (direction === "up" || direction === "down") {
    const delta = direction === "up" ? -1 : 1;
    const targetRow = navigation.timelineRows[rowIndex + delta];

    if (!targetRow || targetRow.steps.length === 0) return false;

    const currentSlot = stepSlot(element);

    const target = targetRow.steps.reduce((best, candidate) => {
      if (!best) return candidate;

      const bestDistance = Math.abs(stepSlot(best) - currentSlot);
      const candidateDistance = Math.abs(stepSlot(candidate) - currentSlot);

      return candidateDistance < bestDistance ? candidate : best;
    }, null);

    return target ? selectElementRepresentation(target) : false;
  }

  return false;
}

function navigateMatrix(direction) {
  const matrix = navigation.matrix;
  const parsed = parseMatrixCellRef(currentRepresentationRef);

  if (!matrix || !parsed) return false;

  const stepIndex = matrix.stepOrder.indexOf(parsed.step);
  const universalIndex = matrix.universalOrder.indexOf(parsed.universal);

  if (stepIndex < 0 || universalIndex < 0) return false;

  if (direction === "left" || direction === "right") {
    const delta = direction === "left" ? -1 : 1;

    for (
      let index = stepIndex + delta;
      index >= 0 && index < matrix.stepOrder.length;
      index += delta
    ) {
      const step = matrix.stepOrder[index];
      const target = matrix.cells.get(
        `${step}\n${parsed.universal}`
      );

      if (target) {
        return selectElementRepresentation(target);
      }
    }

    return false;
  }

  if (direction === "up" || direction === "down") {
    const delta = direction === "up" ? -1 : 1;

    for (
      let index = universalIndex + delta;
      index >= 0 && index < matrix.universalOrder.length;
      index += delta
    ) {
      const universal = matrix.universalOrder[index];
      const target = matrix.cells.get(
        `${parsed.step}\n${universal}`
      );

      if (target) {
        return selectElementRepresentation(target);
      }
    }

    return false;
  }

  return false;
}

function selectElementRepresentation(element) {
  const ref = element?.getAttribute("data-websvg-id");

  if (!ref) return false;

  selectRepresentation(ref);
  return true;
}

function selectRepresentation(representationRef) {
  const bindings = websvg.bindingsForRepresentation(representationRef);

  const semanticBinding = bindings.find(
    binding => typeof binding.semantic_ref === "string"
  );

  const relationBinding = bindings.find(
    binding => typeof binding.relation_ref === "string"
  );

  currentRepresentationRef = representationRef;

  if (semanticBinding) {
    currentSelection = websvg.selectSemantic(
      semanticBinding.semantic_ref
    );

    summaryEl.textContent = semanticSummary(currentSelection);
  } else if (relationBinding) {
    currentSelection = websvg.selectRelation(
      relationBinding.relation_ref
    );

    summaryEl.textContent = relationSummary(
      currentSelection,
      representationRef
    );
  } else {
    currentSelection = websvg.selectRepresentation(
      representationRef
    );

    summaryEl.textContent = representationRef;
  }

  focusButton.disabled = false;

  if (focusActive) {
    applyFocusState();
  } else {
    ensureRepresentationVisible(representationRef);
  }
}

function semanticSummary(selection) {
  const relationCount = selection.relations.length;
  const representationCount = selection.directRepresentationRefs.length;

  return (
    `${selection.ref} · ${representationCount} representation` +
    `${representationCount === 1 ? "" : "s"} · ` +
    `${relationCount} link${relationCount === 1 ? "" : "s"}`
  );
}

function relationSummary(selection, representationRef) {
  const relation = selection.relation;

  const localValues =
    websvg.localValuesForRepresentation(representationRef);

  const mode = localValues
    .map(item => item.attributes["data-mode"])
    .find(Boolean);

  const suffix = mode ? ` · ${mode}` : "";

  return (
    `${relation.from} → ${relation.to} · ` +
    `${relation.type || relation.group || "relation"}${suffix}`
  );
}

function clearSelection() {
  focusActive = false;
  restoreAllDocuments();
  websvg.clearSelection();

  currentSelection = null;
  currentRepresentationRef = null;

  summaryEl.textContent =
    "Click an SVG element · arrows navigate structure";

  focusButton.disabled = true;
  focusButton.textContent = "Hide others";
}

function elementBoundsInSvg(element) {
  try {
    const box = element.getBBox();
    const matrix = element.getCTM();

    if (!matrix) return null;

    const points = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height]
    ].map(([x, y]) => ({
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    }));

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  } catch {
    return null;
  }
}

function ensureRepresentationVisible(representationRef) {
  const item = websvg.representation(representationRef)[0];

  if (!item) return;

  const svg = item.document.svg;
  const state = svgState.get(svg);
  const bounds = elementBoundsInSvg(item.element);

  if (!state || !bounds) {
    item.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center"
    });
    return;
  }

  const view = state.currentViewBox;
  const marginX = view.width * 0.12;
  const marginY = view.height * 0.12;

  const inside =
    bounds.x >= view.x + marginX &&
    bounds.y >= view.y + marginY &&
    bounds.x + bounds.width <= view.x + view.width - marginX &&
    bounds.y + bounds.height <= view.y + view.height - marginY;

  if (!inside) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    setViewBox(svg, {
      x: centerX - view.width / 2,
      y: centerY - view.height / 2,
      width: view.width,
      height: view.height
    });
  }

  item.document.host?.closest(".svg-document")?.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function relevantRepresentationSets(selection) {
  const full = new Set();
  const anchors = new Set();

  if (!selection) return { full, anchors };

  if (selection.type === "semantic") {
    for (const ref of selection.directRepresentationRefs) {
      full.add(ref);
      anchors.add(ref);
    }

    for (const relation of selection.relations) {
      for (const ref of websvg.representationsForRelation(relation.id)) {
        full.add(ref);
        anchors.add(ref);
      }

      const other =
        relation.from === selection.ref
          ? relation.to
          : relation.from;

      if (other) {
        for (const ref of websvg.representationsForSemantic(other)) {
          anchors.add(ref);
        }
      }
    }
  } else if (selection.type === "relation") {
    for (const ref of selection.relationRepresentationRefs) {
      full.add(ref);
      anchors.add(ref);
    }

    for (const ref of selection.endpointRepresentationRefs) {
      anchors.add(ref);
    }
  } else if (selection.type === "representation") {
    full.add(selection.ref);
    anchors.add(selection.ref);
  }

  if (currentRepresentationRef) {
    full.add(currentRepresentationRef);
    anchors.add(currentRepresentationRef);
  }

  return { full, anchors };
}

function applyFocusState() {
  restoreAllDocuments();

  if (!focusActive || !currentSelection) {
    focusButton.textContent = "Hide others";
    return;
  }

  const refs = relevantRepresentationSets(currentSelection);

  const identityAttribute =
    websvg.manifest.representation.identity_attribute ||
    "data-websvg-id";

  const selector = `[${identityAttribute}]`;

  for (const record of websvg.documents()) {
    const svg = record.svg;
    const article = record.host?.closest(".svg-document");

    const anchorElements = new Set();
    const fullElements = new Set();

    for (const ref of refs.anchors) {
      for (const item of websvg.representation(ref)) {
        if (item.documentId === record.id) {
          anchorElements.add(item.element);
        }
      }
    }

    for (const ref of refs.full) {
      for (const item of websvg.representation(ref)) {
        if (item.documentId === record.id) {
          fullElements.add(item.element);
        }
      }
    }

    if (anchorElements.size === 0) {
      if (article) article.hidden = true;
      continue;
    }

    if (article) article.hidden = false;

    const pathElements = new Set([svg]);

    for (const element of anchorElements) {
      let current = element;

      while (current && current !== svg) {
        pathElements.add(current);
        current = current.parentElement;
      }
    }

    const subtreeContainsRepresentation = new WeakMap();

    const containsRepresentation = element => {
      if (subtreeContainsRepresentation.has(element)) {
        return subtreeContainsRepresentation.get(element);
      }

      const result =
        element.matches?.(selector) ||
        Boolean(element.querySelector?.(selector));

      subtreeContainsRepresentation.set(element, result);
      return result;
    };

    const walk = element => {
      if (fullElements.has(element)) {
        showSubtree(element);
        return;
      }

      const keepPath =
        pathElements.has(element) ||
        anchorElements.has(element);

      if (!keepPath) {
        hideElement(element);
        return;
      }

      showElement(element);

      for (const child of element.children) {
        const tag = child.localName;

        if (tag === "defs" || tag === "style") {
          showSubtree(child);
          continue;
        }

        if (
          fullElements.has(child) ||
          pathElements.has(child) ||
          anchorElements.has(child)
        ) {
          walk(child);
          continue;
        }

        if (containsRepresentation(child)) {
          hideElement(child);
        } else {
          showSubtree(child);
        }
      }
    };

    for (const child of svg.children) {
      if (
        child.localName === "defs" ||
        child.localName === "style"
      ) {
        showSubtree(child);
      } else {
        walk(child);
      }
    }
  }

  fitFocusedDocuments();
  focusButton.textContent = "Show all";
}

function hideElement(element) {
  if (!element.hasAttribute("data-websvg-focus-hidden")) {
    element.setAttribute("data-websvg-focus-hidden", "true");
    element.setAttribute(
      "data-websvg-prev-display",
      element.style.display || ""
    );
  }

  element.style.display = "none";
}

function showElement(element) {
  if (element.hasAttribute("data-websvg-focus-hidden")) {
    element.style.display =
      element.getAttribute("data-websvg-prev-display") || "";

    element.removeAttribute("data-websvg-focus-hidden");
    element.removeAttribute("data-websvg-prev-display");
  }
}

function showSubtree(element) {
  showElement(element);

  for (
    const hidden of element.querySelectorAll(
      "[data-websvg-focus-hidden]"
    )
  ) {
    showElement(hidden);
  }
}

function restoreAllDocuments() {
  for (const record of websvg.documents()) {
    const svg = record.svg;
    const article = record.host?.closest(".svg-document");

    if (article) article.hidden = false;

    for (
      const hidden of svg.querySelectorAll(
        "[data-websvg-focus-hidden]"
      )
    ) {
      showElement(hidden);
    }

    const state = svgState.get(svg);

    if (state?.originalViewBox) {
      state.resetViewBox = cloneBox(state.originalViewBox);
      state.currentViewBox = cloneBox(state.originalViewBox);

      svg.setAttribute(
        "viewBox",
        boxString(state.originalViewBox)
      );
    }
  }
}

function fitFocusedDocuments() {
  if (!focusActive) return;

  for (const record of websvg.documents()) {
    const article = record.host?.closest(".svg-document");

    if (article?.hidden) continue;

    const svg = record.svg;

    let box;

    try {
      box = svg.getBBox();
    } catch {
      continue;
    }

    if (!box || box.width <= 0 || box.height <= 0) {
      continue;
    }

    const pad = Math.max(
      18,
      Math.min(
        54,
        Math.max(box.width, box.height) * 0.035
      )
    );

    setResetViewBox(svg, {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2
    });
  }
}

async function start() {
  try {
    const inventory = await discoverInputFiles();
    const manifestUrl = new URL(
      inventory.manifest,
      inputUrl
    );

    const manifestResponse = await fetch(
      manifestUrl,
      { cache: "no-store" }
    );

    if (!manifestResponse.ok) {
      throw new Error(
        `manifest load failed (${manifestResponse.status})`
      );
    }

    const manifest = await manifestResponse.json();
    const hosts = makeHosts(
      inventory.svgFiles,
      manifest.documents || []
    );

    await websvg.load(manifest, {
      baseUrl: manifestUrl.href,
      documentFiles: inventory.svgFiles,
      hosts
    });

    updateViewerMetrics();
    prepareSvgDocuments();
    buildNavigationModel();
    wireRepresentationClicks();

    statusEl.textContent =
      `${websvg.manifest.document_set} · ` +
      `${websvg.documents().length} SVG · arrows navigate`;
  } catch (error) {
    fail(error);
  }
}

start();
