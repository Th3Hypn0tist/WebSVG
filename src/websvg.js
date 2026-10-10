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

function normalizeManifest(manifest) {
  assert(isObject(manifest), "manifest must be an object");
  assert(typeof manifest.schema === "string" && manifest.schema, "manifest.schema is required");
  assert(typeof manifest.document_set === "string" && manifest.document_set, "manifest.document_set is required");

  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  const semantics = isObject(manifest.semantics) ? manifest.semantics : {};
  const relations = manifest.relations ?? {};

  return { ...manifest, documents, semantics, relations };
}

function semanticDefinitions(manifest) {
  const definitions = new Map();

  for (const [kind, definition] of Object.entries(manifest.semantics || {})) {
    if (!isObject(definition)) continue;
    if (typeof definition.identity_attribute !== "string") continue;

    definitions.set(kind, {
      kind,
      identityAttribute: definition.identity_attribute,
      selectors: Array.isArray(definition.selectors) ? definition.selectors : []
    });
  }

  // Compatibility with the original flat MVP shape.
  if (
    definitions.size === 0 &&
    typeof manifest.semantics?.identity_attribute === "string"
  ) {
    definitions.set("semantic", {
      kind: "semantic",
      identityAttribute: manifest.semantics.identity_attribute,
      selectors: []
    });
  }

  return definitions;
}

function relationDefinition(manifest) {
  const relation = isObject(manifest.semantics?.relation)
    ? manifest.semantics.relation
    : null;

  if (relation) {
    return {
      sourceAttribute: relation.source_attribute || "data-from",
      targetAttribute: relation.target_attribute || "data-to",
      typeAttribute: relation.type_attribute || "data-relation",
      fallbackClassSemantics: isObject(relation.fallback_class_semantics)
        ? relation.fallback_class_semantics
        : {}
    };
  }

  return {
    sourceAttribute: manifest.semantics?.relation_from_attribute || "data-from",
    targetAttribute: manifest.semantics?.relation_to_attribute || "data-to",
    typeAttribute: manifest.semantics?.relation_type_attribute || "data-relation",
    fallbackClassSemantics: {}
  };
}

function modeDefinition(manifest) {
  const mode = isObject(manifest.semantics?.mode) ? manifest.semantics.mode : null;
  return {
    attribute: mode?.attribute || manifest.semantics?.relation_mode_attribute || "data-mode",
    values: isObject(mode?.values) ? mode.values : {}
  };
}

function documentFile(declaration) {
  if (!isObject(declaration)) return null;
  return declaration.file || declaration.src || null;
}

function documentIdForFile(file, declaration) {
  if (declaration?.id) return declaration.id;
  return file.replace(/\.svg$/i, "");
}

export class WebSVG {
  constructor(options = {}) {
    this.options = { ...options };
    this.events = new EventTarget();
    this.manifest = null;
    this.manifestUrl = null;
    this._documents = new Map();
    this._semanticDefinitions = new Map();
    this._semanticIndex = new Map();
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

    this.manifest = normalizeManifest(manifest);
    this._semanticDefinitions = semanticDefinitions(this.manifest);

    const declaredByFile = new Map();
    for (const declaration of this.manifest.documents) {
      const file = documentFile(declaration);
      if (file) declaredByFile.set(file, declaration);
    }

    const files = Array.isArray(options.documentFiles)
      ? [...options.documentFiles]
      : this.manifest.documents
          .map(documentFile)
          .filter(Boolean);

    assert(files.length > 0, "no SVG documents were supplied or declared");

    const uniqueFiles = [...new Set(files)];
    const hosts = options.hosts || {};

    for (const file of uniqueFiles) {
      assert(typeof file === "string" && /\.svg$/i.test(file), `not an SVG file: ${file}`);

      const declaration = declaredByFile.get(file) || {};
      const id = documentIdForFile(file, declaration);
      assert(!this._documents.has(id), `duplicate document id: ${id}`);

      const url = resolveUrl(file, baseUrl);
      const svg = document.importNode(await fetchSvg(url), true);
      const host = hosts[id] || hosts[file] || null;

      if (host) host.replaceChildren(svg);

      const record = {
        id,
        file,
        url,
        declaration,
        host,
        svg
      };

      this._documents.set(id, record);
      this._indexDocument(record);
    }

    this._relations = this._collectRelations();

    this.events.dispatchEvent(new CustomEvent("websvg:loaded", {
      detail: {
        documentSet: this.manifest.document_set,
        documentCount: this._documents.size,
        semanticKinds: this.semanticKinds()
      }
    }));

    return this;
  }

  reset() {
    this.clearSelection();
    this.manifest = null;
    this.manifestUrl = null;
    this._documents.clear();
    this._semanticDefinitions.clear();
    this._semanticIndex.clear();
    this._relations = [];
  }

  documents() {
    return Array.from(this._documents.values());
  }

  semanticKinds() {
    return [...this._semanticDefinitions.keys()];
  }

  identities(kind) {
    const index = this._semanticIndex.get(kind);
    return index ? [...index.keys()].sort() : [];
  }

  get(identity, kind = null) {
    if (kind !== null) {
      return [...(this._semanticIndex.get(kind)?.get(identity) || [])];
    }

    const matches = [];
    for (const index of this._semanticIndex.values()) {
      matches.push(...(index.get(identity) || []));
    }
    return matches;
  }

  select(identity, kind = null) {
    this.clearSelection();

    const matches = this.get(identity, kind);
    for (const item of matches) {
      item.element.setAttribute("data-websvg-selected", "true");
    }

    this._selection = { identity, kind };

    this.events.dispatchEvent(new CustomEvent("websvg:selectionchange", {
      detail: { identity, kind, matches }
    }));

    return matches;
  }

  clearSelection() {
    if (this._selection) {
      for (const item of this.get(this._selection.identity, this._selection.kind)) {
        item.element.removeAttribute("data-websvg-selected");
      }
    }
    this._selection = null;
  }

  relations(identity = null, kind = null) {
    if (identity === null) {
      return this._relations.map(relation => ({ ...relation }));
    }

    return this._relations
      .filter(relation => this._relationTouches(relation, identity, kind))
      .map(relation => ({ ...relation }));
  }

  resolveRelation(relation) {
    assert(isObject(relation), "relation must be an object");

    const resolved = {};
    if (relation.from) resolved.from = this.get(relation.from);
    if (relation.to) resolved.to = this.get(relation.to);

    if (isObject(relation.refs)) {
      for (const [kind, identity] of Object.entries(relation.refs)) {
        resolved[kind] = this.get(identity, kind);
      }
    }

    return { ...relation, resolved };
  }

  _indexDocument(record) {
    for (const definition of this._semanticDefinitions.values()) {
      if (!this._semanticIndex.has(definition.kind)) {
        this._semanticIndex.set(definition.kind, new Map());
      }

      const kindIndex = this._semanticIndex.get(definition.kind);
      const selector = definition.selectors.length > 0
        ? definition.selectors.join(",")
        : `[${definition.identityAttribute}]`;

      const candidates = new Set();
      if (record.svg.matches(selector)) candidates.add(record.svg);
      for (const element of record.svg.querySelectorAll(selector)) candidates.add(element);

      for (const element of candidates) {
        const identity = element.getAttribute(definition.identityAttribute);
        if (!identity) continue;

        if (!kindIndex.has(identity)) kindIndex.set(identity, []);
        kindIndex.get(identity).push({
          kind: definition.kind,
          identity,
          documentId: record.id,
          document: record,
          element
        });
      }
    }
  }

  _collectRelations() {
    const relations = [];
    const relationSemantics = relationDefinition(this.manifest);
    const modeSemantics = modeDefinition(this.manifest);

    for (const record of this._documents.values()) {
      const selector =
        `[${relationSemantics.sourceAttribute}][${relationSemantics.targetAttribute}]`;

      const candidates = new Set();
      if (record.svg.matches(selector)) candidates.add(record.svg);
      for (const element of record.svg.querySelectorAll(selector)) candidates.add(element);

      for (const element of candidates) {
        let relationType = element.getAttribute(relationSemantics.typeAttribute);

        if (!relationType) {
          for (const [className, semanticType] of Object.entries(
            relationSemantics.fallbackClassSemantics
          )) {
            if (element.classList.contains(className)) {
              relationType = semanticType;
              break;
            }
          }
        }

        relations.push({
          source: "svg",
          documentId: record.id,
          element,
          from: element.getAttribute(relationSemantics.sourceAttribute),
          to: element.getAttribute(relationSemantics.targetAttribute),
          relation: relationType || "relation",
          mode: element.getAttribute(modeSemantics.attribute) || null
        });
      }
    }

    const manifestRelations = this.manifest.relations;

    if (Array.isArray(manifestRelations)) {
      for (const relation of manifestRelations) {
        if (!isObject(relation)) continue;
        relations.push(this._normalizeManifestRelation("relation", relation));
      }
    } else if (isObject(manifestRelations)) {
      for (const [group, items] of Object.entries(manifestRelations)) {
        if (!Array.isArray(items)) continue;
        for (const relation of items) {
          if (!isObject(relation)) continue;
          relations.push(this._normalizeManifestRelation(group, relation));
        }
      }
    }

    return relations;
  }

  _normalizeManifestRelation(group, relation) {
    const refs = {};

    for (const kind of this.semanticKinds()) {
      if (typeof relation[kind] === "string") refs[kind] = relation[kind];
    }

    return {
      source: "manifest",
      group,
      relation: relation.relation || group,
      from: typeof relation.from === "string" ? relation.from : null,
      to: typeof relation.to === "string" ? relation.to : null,
      refs,
      mode: relation.mode || null,
      raw: relation
    };
  }

  _relationTouches(relation, identity, kind) {
    if (relation.from === identity || relation.to === identity) return true;
    if (!isObject(relation.refs)) return false;

    if (kind !== null) return relation.refs[kind] === identity;
    return Object.values(relation.refs).includes(identity);
  }
}

export default WebSVG;
