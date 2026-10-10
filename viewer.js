import { WebSVG } from "./src/websvg.js";

const statusEl = document.querySelector("#status");
const workspaceEl = document.querySelector("#workspace");
const documentsEl = document.querySelector("#documents");
const semanticsEl = document.querySelector("#semantics");
const selectionEl = document.querySelector("#selection");
const clearButton = document.querySelector("#clear-selection");

const websvg = new WebSVG();
const rootUrl = new URL(".", import.meta.url);
const inputUrl = new URL("input/", rootUrl);

clearButton.addEventListener("click", () => {
  websvg.clearSelection();
  selectionEl.textContent = "none";
});

function fail(error) {
  console.error(error);
  statusEl.textContent = "Failed";
  workspaceEl.replaceChildren();

  const pre = document.createElement("pre");
  pre.className = "error";
  pre.textContent = error instanceof Error ? error.stack || error.message : String(error);
  workspaceEl.append(pre);
}

async function discoverInputFiles() {
  const response = await fetch(inputUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`input discovery failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  // Preferred deployment path: input/index.php returns a tiny JSON inventory.
  if (contentType.includes("application/json")) {
    let inventory;
    try {
      inventory = JSON.parse(body);
    } catch {
      throw new Error("input discovery returned invalid JSON");
    }

    if (!inventory.ok) {
      throw new Error(inventory.error || "input discovery failed");
    }

    const manifest = inventory.manifest;
    const svgFiles = Array.isArray(inventory.svg_files)
      ? inventory.svg_files
      : [];

    if (typeof manifest !== "string" || !/\.json$/i.test(manifest)) {
      throw new Error("input discovery did not return exactly one JSON manifest");
    }

    if (svgFiles.length === 0) {
      throw new Error("input/ contains no SVG files");
    }

    return { manifest, svgFiles };
  }

  // Fallback for servers that expose a normal directory index.
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
    throw new Error(
      `input/ must contain exactly one JSON manifest; found ${manifests.length}`
    );
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

    const article = document.createElement("article");
    article.className = "svg-document";

    const heading = document.createElement("header");
    heading.textContent = declaration.type
      ? `${id} · ${declaration.type}`
      : id;

    const host = document.createElement("div");
    host.className = "svg-host";

    article.append(heading, host);
    workspaceEl.append(article);

    hosts[id] = host;
    hosts[file] = host;
  }

  return hosts;
}

function renderDocuments() {
  documentsEl.replaceChildren();

  for (const record of websvg.documents()) {
    const div = document.createElement("div");
    div.className = "document-entry";
    div.textContent = `${record.id} — ${record.file}`;
    documentsEl.append(div);
  }
}

function renderSemantics() {
  semanticsEl.replaceChildren();

  for (const kind of websvg.semanticKinds()) {
    const refs = websvg.semanticRefs(kind);

    const wrapper = document.createElement("div");
    wrapper.className = "kind";

    const title = document.createElement("div");
    title.className = "kind-title";

    const kindLabel = document.createElement("span");
    kindLabel.textContent = kind;

    const count = document.createElement("span");
    count.textContent = String(refs.length);

    title.append(kindLabel, count);

    const list = document.createElement("div");
    list.className = "identity-list";

    for (const semanticRef of refs) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = semanticRef;
      button.title = semanticRef;

      button.addEventListener("click", () => {
        showSemanticSelection(semanticRef);
      });

      list.append(button);
    }

    wrapper.append(title, list);
    semanticsEl.append(wrapper);
  }
}

function showSemanticSelection(semanticRef) {
  const result = websvg.selectSemantic(semanticRef);

  selectionEl.textContent = JSON.stringify({
    type: result.type,
    semantic_ref: semanticRef,
    representations: result.directRepresentationRefs,
    relation_count: result.relations.length,
    relations: result.relations.map(relation => ({
      id: relation.id,
      type: relation.type || relation.group || "relation",
      from: relation.from || null,
      to: relation.to || null,
      label: relation.label || null
    }))
  }, null, 2);

  scrollToFirstRepresentation(result.directRepresentationRefs);
}

function showRelationSelection(relationRef) {
  const result = websvg.selectRelation(relationRef);

  selectionEl.textContent = JSON.stringify({
    type: result.type,
    relation_ref: relationRef,
    relation: result.relation,
    representations: result.relationRepresentationRefs,
    endpoint_representations: result.endpointRepresentationRefs
  }, null, 2);

  scrollToFirstRepresentation([
    ...result.relationRepresentationRefs,
    ...result.endpointRepresentationRefs
  ]);
}

function showRepresentationSelection(representationRef) {
  const result = websvg.selectRepresentation(representationRef);

  if (result.type === "semantic") {
    showSemanticSelection(result.ref);
    return;
  }

  if (result.type === "relation") {
    showRelationSelection(result.ref);
    return;
  }

  selectionEl.textContent = JSON.stringify({
    type: result.type,
    representation_ref: representationRef,
    bindings: result.bindings,
    local_values: result.localValues
  }, null, 2);

  scrollToFirstRepresentation([representationRef]);
}

function scrollToFirstRepresentation(refs) {
  for (const ref of refs) {
    const item = websvg.representation(ref)[0];
    if (!item) continue;

    item.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center"
    });
    return;
  }
}

function wireRepresentationClicks() {
  for (const record of websvg.documents()) {
    for (const element of record.svg.querySelectorAll("[data-websvg-id]")) {
      element.classList.add("websvg-interactive");

      element.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const ref = element.getAttribute("data-websvg-id");
        if (ref) showRepresentationSelection(ref);
      });
    }
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

    renderDocuments();
    renderSemantics();
    wireRepresentationClicks();

    statusEl.textContent =
      `${websvg.manifest.document_set} · ${websvg.documents().length} SVG · ${websvg.representationIds().length} representations · ${websvg.relations().length} JSON relations`;
  } catch (error) {
    fail(error);
  }
}

start();
