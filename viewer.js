import { WebSVG } from "./src/websvg.js";

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

clearButton.addEventListener("click", clearSelection);
focusButton.addEventListener("click", () => {
  if (!currentSelection) return;
  focusActive = !focusActive;
  applyFocusState();
});

window.addEventListener("resize", () => {
  if (focusActive) fitFocusedDocuments();
});

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
    const svgFiles = Array.isArray(inventory.svg_files) ? inventory.svg_files : [];

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

    const relative = decodeURIComponent(url.pathname.slice(inputUrl.pathname.length));
    if (!relative || relative.includes("/")) continue;
    if (!/\.(?:svg|json)$/i.test(relative)) continue;
    names.add(relative);
  }

  const files = [...names].sort((a, b) => a.localeCompare(b));
  const manifests = files.filter(name => /\.json$/i.test(name));
  const svgFiles = files.filter(name => /\.svg$/i.test(name));

  if (manifests.length !== 1) {
    throw new Error(`input/ must contain exactly one JSON manifest; found ${manifests.length}`);
  }
  if (svgFiles.length === 0) {
    throw new Error("input/ contains no SVG files");
  }

  return { manifest: manifests[0], svgFiles };
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

    article.append(host);
    workspaceEl.append(article);

    hosts[id] = host;
    hosts[file] = host;
  }

  return hosts;
}

function prepareSvgDocuments() {
  for (const record of websvg.documents()) {
    const svg = record.svg;
    const originalViewBox = svg.getAttribute("viewBox");

    svgState.set(svg, { originalViewBox });

    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svg.classList.add("websvg-document-svg");
  }
}

function wireRepresentationClicks() {
  const identityAttribute = websvg.manifest.representation.identity_attribute || "data-websvg-id";
  const selector = `[${identityAttribute}]`;

  for (const record of websvg.documents()) {
    const elements = [];
    if (record.svg.matches(selector)) elements.push(record.svg);
    elements.push(...record.svg.querySelectorAll(selector));

    for (const element of elements) {
      element.classList.add("websvg-interactive");
      element.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const representationRef = element.getAttribute(identityAttribute);
        if (representationRef) selectRepresentation(representationRef);
      });
    }
  }
}

function selectRepresentation(representationRef) {
  const bindings = websvg.bindingsForRepresentation(representationRef);
  const semanticBinding = bindings.find(binding => typeof binding.semantic_ref === "string");
  const relationBinding = bindings.find(binding => typeof binding.relation_ref === "string");

  currentRepresentationRef = representationRef;

  if (semanticBinding) {
    currentSelection = websvg.selectSemantic(semanticBinding.semantic_ref);
    summaryEl.textContent = semanticSummary(currentSelection);
  } else if (relationBinding) {
    currentSelection = websvg.selectRelation(relationBinding.relation_ref);
    summaryEl.textContent = relationSummary(currentSelection, representationRef);
  } else {
    currentSelection = websvg.selectRepresentation(representationRef);
    summaryEl.textContent = representationRef;
  }

  focusButton.disabled = false;

  if (focusActive) {
    applyFocusState();
  } else {
    scrollToRepresentation(representationRef);
  }
}

function semanticSummary(selection) {
  const relationCount = selection.relations.length;
  const representationCount = selection.directRepresentationRefs.length;
  return `${selection.ref} · ${representationCount} representation${representationCount === 1 ? "" : "s"} · ${relationCount} link${relationCount === 1 ? "" : "s"}`;
}

function relationSummary(selection, representationRef) {
  const relation = selection.relation;
  const localValues = websvg.localValuesForRepresentation(representationRef);
  const mode = localValues
    .map(item => item.attributes["data-mode"])
    .find(Boolean);
  const suffix = mode ? ` · ${mode}` : "";
  return `${relation.from} → ${relation.to} · ${relation.type || relation.group || "relation"}${suffix}`;
}

function clearSelection() {
  focusActive = false;
  restoreAllDocuments();
  websvg.clearSelection();

  currentSelection = null;
  currentRepresentationRef = null;

  summaryEl.textContent = "Click an SVG element to follow its bindings";
  focusButton.disabled = true;
  focusButton.textContent = "Hide others";
}

function scrollToRepresentation(representationRef) {
  const item = websvg.representation(representationRef)[0];
  item?.element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center"
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
      if (relation.type === "contains") {
        if (relation.from === selection.ref && relation.to) {
          for (const ref of websvg.representationsForSemantic(relation.to)) {
            anchors.add(ref);
          }
        }
        continue;
      }

      for (const ref of websvg.representationsForRelation(relation.id)) {
        full.add(ref);
        anchors.add(ref);
      }

      const other = relation.from === selection.ref ? relation.to : relation.from;
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
  const identityAttribute = websvg.manifest.representation.identity_attribute || "data-websvg-id";
  const selector = `[${identityAttribute}]`;

  for (const record of websvg.documents()) {
    const svg = record.svg;
    const article = record.host?.closest(".svg-document");

    const anchorElements = new Set();
    const fullElements = new Set();

    for (const ref of refs.anchors) {
      for (const item of websvg.representation(ref)) {
        if (item.documentId === record.id) anchorElements.add(item.element);
      }
    }

    for (const ref of refs.full) {
      for (const item of websvg.representation(ref)) {
        if (item.documentId === record.id) fullElements.add(item.element);
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
      const result = element.matches?.(selector) || Boolean(element.querySelector?.(selector));
      subtreeContainsRepresentation.set(element, result);
      return result;
    };

    const walk = element => {
      if (fullElements.has(element)) {
        showSubtree(element);
        return;
      }

      const keepPath = pathElements.has(element) || anchorElements.has(element);
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

        if (fullElements.has(child) || pathElements.has(child) || anchorElements.has(child)) {
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
      if (child.localName === "defs" || child.localName === "style") {
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
    element.setAttribute("data-websvg-prev-display", element.style.display || "");
  }
  element.style.display = "none";
}

function showElement(element) {
  if (element.hasAttribute("data-websvg-focus-hidden")) {
    element.style.display = element.getAttribute("data-websvg-prev-display") || "";
    element.removeAttribute("data-websvg-focus-hidden");
    element.removeAttribute("data-websvg-prev-display");
  }
}

function showSubtree(element) {
  showElement(element);
  for (const hidden of element.querySelectorAll("[data-websvg-focus-hidden]")) {
    showElement(hidden);
  }
}

function restoreAllDocuments() {
  for (const record of websvg.documents()) {
    const svg = record.svg;
    const article = record.host?.closest(".svg-document");
    if (article) article.hidden = false;

    for (const hidden of svg.querySelectorAll("[data-websvg-focus-hidden]")) {
      showElement(hidden);
    }

    const state = svgState.get(svg);
    if (state?.originalViewBox) {
      svg.setAttribute("viewBox", state.originalViewBox);
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

    if (!box || box.width <= 0 || box.height <= 0) continue;

    const pad = Math.max(18, Math.min(54, Math.max(box.width, box.height) * 0.035));
    svg.setAttribute(
      "viewBox",
      `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`
    );
  }
}

async function start() {
  try {
    const inventory = await discoverInputFiles();
    const manifestUrl = new URL(inventory.manifest, inputUrl);

    const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`manifest load failed (${manifestResponse.status})`);
    }

    const manifest = await manifestResponse.json();
    const hosts = makeHosts(inventory.svgFiles, manifest.documents || []);

    await websvg.load(manifest, {
      baseUrl: manifestUrl.href,
      documentFiles: inventory.svgFiles,
      hosts
    });

    prepareSvgDocuments();
    wireRepresentationClicks();

    statusEl.textContent = `${websvg.manifest.document_set} · ${websvg.documents().length} SVG`;
  } catch (error) {
    fail(error);
  }
}

start();
