const DEFAULT_SEMANTICS = Object.freeze({
  identity_attribute: "data-semantic-id",
  kind_attribute: "data-kind",
  relation_from_attribute: "data-from",
  relation_to_attribute: "data-to",
  relation_type_attribute: "data-relation",
  relation_mode_attribute: "data-mode"
});

function assert(condition, message) {
  if (!condition) throw new Error(`WebSVG: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveUrl(value, base) {
  return new URL(value, base).href;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WebSVG: failed to load manifest ${url} (${response.status})`);
  }
  return response.json();
}

async function fetchSvg(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WebSVG: failed to load SVG ${url} (${response.status})`);
  }

  const source = await response.text();
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`WebSVG: invalid SVG ${url}`);

  const svg = doc.documentElement;
  assert(svg?.localName === "svg", `document is not SVG: ${url}`);
  return svg;
}

function normalizedManifest(manifest) {
  assert(isObject(manifest), "manifest must be an object");
  assert(typeof manifest.schema === "string", "manifest.schema is required");
  assert(typeof manifest.document_set === "string", "manifest.document_set is required");
  assert(Array.isArray(manifest.documents), "manifest.documents must be an array");

  const ids = new Set();
  for (const document of manifest.documents) {
    assert(isObject(document), "each manifest document must be an object");
    assert(typeof document.id === "string" && document.id, "document.id is required");
    assert(typeof document.src === "string" && document.src, `document.src is required for ${document.id}`);
    assert(!ids.has(document.id), `duplicate document id: ${document.id}`);
    ids.add(document.id);
  }

  return {
    ...manifest,
    semantics: {
      ...DEFAULT_SEMANTICS,
      ...(isObject(manifest.semantics) ? manifest.semantics : {})
    },
    relations: Array.isArray(manifest.relations) ? manifest.relations : []
  };
}

export class WebSVG {
  constructor(options = {}) {
    this.options = { ...options };
    this.events = new EventTarget();
    this.manifest = null;
    this.manifestUrl = null;
    this._documents = new Map();
    this._identityIndex = new Map();
    this._relations = [];
    this._selection = null;
  }

  async load(manifestOrUrl, options = {}) {
    this.reset();

    let manifest;
    let baseUrl;

    if (typeof manifestOrUrl === "string") {
      this.manifestUrl = new URL(manifestOrUrl, document.baseURI).href;
      manifest = await fetchJson(this.manifestUrl);
      baseUrl = this.manifestUrl;
    } else {
      manifest = manifestOrUrl;
      baseUrl = options.baseUrl
        ? new URL(options.baseUrl, document.baseURI).href
        : document.baseURI;
    }

    this.manifest = normalizedManifest(manifest);
    const hosts = options.hosts || {};

    for (const declaration of this.manifest.documents) {
      const url = resolveUrl(declaration.src, baseUrl);
      const svg = await fetchSvg(url);
      const imported = document.importNode(svg, true);

      const host = hosts[declaration.id] || null;
      if (host) {
        host.replaceChildren(imported);
      }

      const record = {
        id: declaration.id,
        src: declaration.src,
        url,
        declaration,
        host,
        svg: imported
      };

      this._documents.set(record.id, record);
      this._indexDocument(record);
    }

    this._relations = this._collectRelations();

    this.events.dispatchEvent(new CustomEvent("websvg:loaded", {
      detail: {
        documentSet: this.manifest.document_set,
        documentCount: this._documents.size
      }
    }));

    return this;
  }

  reset() {
    this.clearSelection();
    this.manifest = null;
    this.manifestUrl = null;
    this._documents.clear();
    this._identityIndex.clear();
    this._relations = [];
  }

  documents() {
    return Array.from(this._documents.values());
  }

  get(identity) {
    return [...(this._identityIndex.get(identity) || [])];
  }

  select(identity) {
    this.clearSelection();

    const matches = this.get(identity);
    for (const item of matches) {
      item.element.setAttribute("data-websvg-selected", "true");
    }

    this._selection = identity;

    this.events.dispatchEvent(new CustomEvent("websvg:selectionchange", {
      detail: { identity, matches }
    }));

    return matches;
  }

  clearSelection() {
    if (this._selection !== null) {
      for (const item of this.get(this._selection)) {
        item.element.removeAttribute("data-websvg-selected");
      }
    }
    this._selection = null;
  }

  relations(identity = null) {
    if (identity === null) return this._relations.map(relation => ({ ...relation }));

    return this._relations
      .filter(relation => relation.from === identity || relation.to === identity)
      .map(relation => ({ ...relation }));
  }

  resolveRelation(relation) {
    assert(isObject(relation), "relation must be an object");
    return {
      ...relation,
      source: this.get(relation.from),
      target: this.get(relation.to)
    };
  }

  _indexDocument(record) {
    const identityAttribute = this.manifest.semantics.identity_attribute;
    const elements = [
      ...(record.svg.hasAttribute(identityAttribute) ? [record.svg] : []),
      ...record.svg.querySelectorAll(`[${identityAttribute}]`)
    ];

    for (const element of elements) {
      const identity = element.getAttribute(identityAttribute);
      if (!identity) continue;

      if (!this._identityIndex.has(identity)) {
        this._identityIndex.set(identity, []);
      }

      this._identityIndex.get(identity).push({
        documentId: record.id,
        document: record,
        element,
        kind: element.getAttribute(this.manifest.semantics.kind_attribute)
      });
    }
  }

  _collectRelations() {
    const semantics = this.manifest.semantics;
    const relations = [];

    for (const record of this._documents.values()) {
      const selector = `[${semantics.relation_from_attribute}][${semantics.relation_to_attribute}]`;
      const elements = [
        ...(record.svg.matches(selector) ? [record.svg] : []),
        ...record.svg.querySelectorAll(selector)
      ];

      for (const element of elements) {
        relations.push({
          source: "svg",
          documentId: record.id,
          element,
          from: element.getAttribute(semantics.relation_from_attribute),
          to: element.getAttribute(semantics.relation_to_attribute),
          relation: element.getAttribute(semantics.relation_type_attribute) || "relation",
          mode: element.getAttribute(semantics.relation_mode_attribute) || null
        });
      }
    }

    for (const relation of this.manifest.relations) {
      if (!isObject(relation)) continue;
      if (typeof relation.from !== "string" || typeof relation.to !== "string") continue;

      relations.push({
        source: "manifest",
        from: relation.from,
        to: relation.to,
        relation: relation.relation || "relation",
        mode: relation.mode || null,
        ...relation
      });
    }

    return relations;
  }
}

export default WebSVG;
