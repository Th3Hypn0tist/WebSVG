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
  pre.textContent = error instanceof Error
    ? error.stack || error.message
    : String(error);

  workspaceEl.append(pre);
}

async function discoverInputFiles() {
  const response = await fetch(inputUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`input directory listing failed (${response.status})`);
  }

  const html = await response.text();
  const listing = new DOMParser().parseFromString(html, "text/html");
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

  return {
    manifest: manifests[0],
    svgFiles
  };
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
    const identities = websvg.identities(kind);

    const wrapper = document.createElement("div");
    wrapper.className = "kind";

    const title = document.createElement("div");
    title.className = "kind-title";

    const kindLabel = document.createElement("span");
    kindLabel.textContent = kind;

    const count = document.createElement("span");
    count.textContent = String(identities.length);

    title.append(kindLabel, count);

    const list = document.createElement("div");
    list.className = "identity-list";

    for (const identity of identities) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = identity;
      button.title = `${kind}: ${identity}`;

      button.addEventListener("click", () => {
        const matches = websvg.select(identity, kind);

        selectionEl.textContent = JSON.stringify({
          kind,
          identity,
          representations: matches.map(match => ({
            document: match.documentId,
            element_id: match.element.id || null
          })),
          relations: websvg.relations(identity, kind).map(relation => ({
            source: relation.source,
            group: relation.group || null,
            relation: relation.relation,
            from: relation.from || null,
            to: relation.to || null,
            refs: relation.refs || null,
            mode: relation.mode || null
          }))
        }, null, 2);

        matches[0]?.element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center"
        });
      });

      list.append(button);
    }

    wrapper.append(title, list);
    semanticsEl.append(wrapper);
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

    statusEl.textContent =
      `${websvg.manifest.document_set} · ${websvg.documents().length} SVG · ${websvg.semanticKinds().length} semantic kinds`;
  } catch (error) {
    fail(error);
  }
}

start();
