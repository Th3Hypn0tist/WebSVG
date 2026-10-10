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
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`WebSVG: failed to load manifest ${url} (${response.status})`);
  }
  return response.json();
}

async function fetchSvg(url) {
  const response = await fetch(url, { cache: "no-store" });
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
  assert(Array.isArray(manifest.bindings), "manifest.bindings must be an array");

  return {
    ...manifest,
    documents: Array.isArray(manifest.documents) ? manifest.documents : [],
    representation: isObject(manifest.representation) ? manifest.representation : {},
    bindings: manifest.bindings,
    relations: manifest.relations ?? {}
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

function flattenRelations(relations) {
  const out = [];

  if (Array.isArray(relations)) {
    for (const relation of relations) {
      if (isObject(relation)) out.push({ ...relation });
    }
    return out;
  }

  if (!isObject(relations)) return out;

  for (const [group, items] of Object.entries(relations)) {
    if (!Array.isArray(items)) continue;
    for (const relation of items) {
      if (!isObject(relation)) continue;
      out.push({ group, ...relation });
    }
  }

  return out;
}

export class WebSVG {
  constructor(options = {}) {
    this.options = { ...options };
    this.events = new EventTarget();

    this.manifest = null;
    this.manifestUrl = null;

    this._documents = new Map();
    this._representations = new Map();
    this._bindingsByRepresentation = new Map();
    this._semanticBindings = new Map();
    this._semanticKinds = new Map();
    this._relationBindings = new Map();
    this._relations = [];
    this._relationsById = new Map();
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
    this._relations = flattenRelations(this.manifest.relations);

    for (const relation of this._relations) {
      assert(typeof relation.id === "string" && relation.id, "every relation requires id");
      assert(!this._relationsById.has(relation.id), `duplicate relation id: ${relation.id}`);
      this._relationsById.set(relation.id, relation);
    }

    const declaredByFile = new Map();
    for (const declaration of this.manifest.documents) {
      const file = documentFile(declaration);
      if (file) declaredByFile.set(file, declaration);
    }

    const files = Array.isArray(options.documentFiles)
      ? [...options.documentFiles]
      : this.manifest.documents.map(documentFile).filter(Boolean);

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
      this._indexRepresentations(record);
    }

    this._indexBindings();

    this.events.dispatchEvent(new CustomEvent("websvg:loaded", {
      detail: {
        documentSet: this.manifest.document_set,
        documentCount: this._documents.size,
        representationCount: this._representations.size,
        bindingCount: this.manifest.bindings.length,
        relationCount: this._relations.length,
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
    this._representations.clear();
    this._bindingsByRepresentation.clear();
    this._semanticBindings.clear();
    this._semanticKinds.clear();
    this._relationBindings.clear();
    this._relations = [];
    this._relationsById.clear();
  }

  documents() {
    return Array.from(this._documents.values());
  }

  representationIds() {
    return [...this._representations.keys()].sort();
  }

  representation(ref) {
    return [...(this._representations.get(ref) || [])];
  }

  bindingsForRepresentation(ref) {
    return [...(this._bindingsByRepresentation.get(ref) || [])];
  }

  semanticKinds() {
    return [...this._semanticKinds.keys()].sort();
  }

  semanticRefs(kind = null) {
    if (kind === null) {
      return [...this._semanticBindings.keys()].sort();
    }
    return [...(this._semanticKinds.get(kind) || [])].sort();
  }

  representationsForSemantic(semanticRef) {
    const refs = new Set();

    for (const binding of this._semanticBindings.get(semanticRef) || []) {
      refs.add(binding.representation_ref);
    }

    return [...refs];
  }

  representationsForRelation(relationRef) {
    const refs = new Set();

    for (const binding of this._relationBindings.get(relationRef) || []) {
      refs.add(binding.representation_ref);
    }

    return [...refs];
  }

  relation(relationRef) {
    return this._relationsById.get(relationRef) || null;
  }

  relations(semanticRef = null) {
    if (semanticRef === null) {
      return this._relations.map(relation => ({ ...relation }));
    }

    return this._relations
      .filter(relation => relation.from === semanticRef || relation.to === semanticRef)
      .map(relation => ({ ...relation }));
  }

  localValuesForRepresentation(representationRef) {
    const configured = Array.isArray(this.manifest?.representation?.local_value_attributes)
      ? this.manifest.representation.local_value_attributes
      : [];

    const values = [];

    for (const item of this.representation(representationRef)) {
      const attributes = {};
      for (const attribute of configured) {
        if (item.element.hasAttribute(attribute)) {
          attributes[attribute] = item.element.getAttribute(attribute);
        }
      }

      values.push({
        documentId: item.documentId,
        elementId: item.element.id || null,
        attributes
      });
    }

    return values;
  }

  selectSemantic(semanticRef) {
    this.clearSelection();

    const directRepresentationRefs = this.representationsForSemantic(semanticRef);
    const relations = this.relations(semanticRef);
    const relationRepresentationRefs = new Set();
    const endpointRepresentationRefs = new Set();

    for (const relation of relations) {
      for (const ref of this.representationsForRelation(relation.id)) {
        relationRepresentationRefs.add(ref);
      }

      const other = relation.from === semanticRef ? relation.to : relation.from;
      if (other) {
        for (const ref of this.representationsForSemantic(other)) {
          endpointRepresentationRefs.add(ref);
        }
      }
    }

    this._markRepresentations(directRepresentationRefs, "primary");
    this._markRepresentations([...relationRepresentationRefs], "relation");
    this._markRepresentations([...endpointRepresentationRefs], "related");

    this._selection = {
      type: "semantic",
      ref: semanticRef,
      directRepresentationRefs,
      relationRepresentationRefs: [...relationRepresentationRefs],
      endpointRepresentationRefs: [...endpointRepresentationRefs],
      relations
    };

    this._emitSelection();
    return this._selection;
  }

  selectRelation(relationRef) {
    this.clearSelection();

    const relation = this.relation(relationRef);
    assert(relation, `unknown relation: ${relationRef}`);

    const relationRepresentationRefs = this.representationsForRelation(relationRef);
    const endpointRepresentationRefs = new Set();

    for (const semanticRef of [relation.from, relation.to]) {
      if (!semanticRef) continue;
      for (const ref of this.representationsForSemantic(semanticRef)) {
        endpointRepresentationRefs.add(ref);
      }
    }

    this._markRepresentations(relationRepresentationRefs, "primary");
    this._markRepresentations([...endpointRepresentationRefs], "related");

    this._selection = {
      type: "relation",
      ref: relationRef,
      relation,
      relationRepresentationRefs,
      endpointRepresentationRefs: [...endpointRepresentationRefs]
    };

    this._emitSelection();
    return this._selection;
  }

  selectRepresentation(representationRef) {
    const bindings = this.bindingsForRepresentation(representationRef);

    const semanticBinding = bindings.find(binding => typeof binding.semantic_ref === "string");
    if (semanticBinding) return this.selectSemantic(semanticBinding.semantic_ref);

    const relationBinding = bindings.find(binding => typeof binding.relation_ref === "string");
    if (relationBinding) return this.selectRelation(relationBinding.relation_ref);

    this.clearSelection();
    this._markRepresentations([representationRef], "primary");

    this._selection = {
      type: "representation",
      ref: representationRef,
      bindings,
      localValues: this.localValuesForRepresentation(representationRef)
    };

    this._emitSelection();
    return this._selection;
  }

  clearSelection() {
    for (const items of this._representations.values()) {
      for (const item of items) {
        item.element.removeAttribute("data-websvg-highlight");
      }
    }
    this._selection = null;
  }

  _emitSelection() {
    this.events.dispatchEvent(new CustomEvent("websvg:selectionchange", {
      detail: this._selection
    }));
  }

  _markRepresentations(refs, state) {
    for (const ref of refs) {
      for (const item of this.representation(ref)) {
        item.element.setAttribute("data-websvg-highlight", state);
      }
    }
  }

  _indexRepresentations(record) {
    const attribute = this.manifest.representation.identity_attribute || "data-websvg-id";
    const selector = `[${attribute}]`;

    const candidates = new Set();
    if (record.svg.matches(selector)) candidates.add(record.svg);
    for (const element of record.svg.querySelectorAll(selector)) candidates.add(element);

    for (const element of candidates) {
      const ref = element.getAttribute(attribute);
      if (!ref) continue;

      if (!this._representations.has(ref)) {
        this._representations.set(ref, []);
      }

      this._representations.get(ref).push({
        representationRef: ref,
        documentId: record.id,
        document: record,
        element
      });
    }
  }

  _indexBindings() {
    for (const binding of this.manifest.bindings) {
      assert(isObject(binding), "every binding must be an object");
      assert(
        typeof binding.representation_ref === "string" && binding.representation_ref,
        "binding.representation_ref is required"
      );

      const representationRef = binding.representation_ref;
      assert(
        this._representations.has(representationRef),
        `binding points to missing representation: ${representationRef}`
      );

      if (!this._bindingsByRepresentation.has(representationRef)) {
        this._bindingsByRepresentation.set(representationRef, []);
      }
      this._bindingsByRepresentation.get(representationRef).push(binding);

      if (typeof binding.semantic_ref === "string") {
        if (!this._semanticBindings.has(binding.semantic_ref)) {
          this._semanticBindings.set(binding.semantic_ref, []);
        }
        this._semanticBindings.get(binding.semantic_ref).push(binding);

        const kind = typeof binding.kind === "string" && binding.kind
          ? binding.kind
          : "semantic";

        if (!this._semanticKinds.has(kind)) {
          this._semanticKinds.set(kind, new Set());
        }
        this._semanticKinds.get(kind).add(binding.semantic_ref);
      }

      if (typeof binding.relation_ref === "string") {
        assert(
          this._relationsById.has(binding.relation_ref),
          `binding points to missing relation: ${binding.relation_ref}`
        );

        if (!this._relationBindings.has(binding.relation_ref)) {
          this._relationBindings.set(binding.relation_ref, []);
        }
        this._relationBindings.get(binding.relation_ref).push(binding);
      }
    }
  }
}

export default WebSVG;
