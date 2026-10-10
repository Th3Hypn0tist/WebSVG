# WebSVG

WebSVG is a small, dependency-free browser library for **semantic SVG document sets**.

It treats SVG as the native visual document and keeps semantic metadata on the real SVG DOM. A companion JSON manifest describes document membership, interpretation rules, and cross-document relations.

WebSVG is **not** a canonical semantic authority and it does not replace Structure. Its first role is to make structured SVGs directly viewable and inspectable during early design work. Later, Structure can derive an unlocked CW candidate from such design material, while canonical CW can also be projected back to SVG.

## Core rules

- SVG DOM stays real SVG DOM; no private scene graph becomes the source of truth.
- Semantic elements are identified generically with `data-semantic-id`.
- Local DOM identity remains `id`; cross-document identity uses `data-semantic-id`.
- Relations use generic `data-from`, `data-to`, `data-relation`, and optional `data-mode`.
- Unknown SVG attributes and metadata are left untouched.
- Domain concepts are not hardcoded into the core.
- Geometry, color, proximity, and rendering do not define semantic meaning.
- One manifest may bind multiple related SVG documents into one document set.

## MVP

The MVP can:

- load a `.websvg.json` manifest,
- load multiple SVG files,
- mount the actual parsed SVG DOM into supplied host elements,
- index semantic identities across all loaded documents,
- find every representation of one semantic identity,
- select/highlight the same semantic identity across documents,
- enumerate semantic relations from SVG metadata and the manifest,
- resolve relation endpoints by semantic identity,
- emit browser events when loading or semantic selection changes.

## Manifest

Minimal example:

```json
{
  "schema": "websvg/0.1",
  "document_set": "example",
  "documents": [
    { "id": "timeline", "src": "./timeline.svg" },
    { "id": "matrix", "src": "./matrix.svg" }
  ],
  "semantics": {
    "identity_attribute": "data-semantic-id",
    "kind_attribute": "data-kind"
  },
  "relations": []
}
```

See `schema/websvg-manifest.schema.json` and `examples/`.

## Usage

```html
<div id="timeline"></div>
<div id="matrix"></div>

<script type="module">
  import { WebSVG } from "./src/websvg.js";

  const websvg = new WebSVG();

  await websvg.load("./examples/demo.websvg.json", {
    hosts: {
      timeline: document.querySelector("#timeline"),
      matrix: document.querySelector("#matrix")
    }
  });

  websvg.select("step:sales.prepare_quote");
</script>
```

## API

### `new WebSVG(options?)`

Creates an isolated WebSVG runtime.

### `load(manifestOrUrl, { hosts }?)`

Loads a manifest object or URL and its SVG documents. `hosts` is an object keyed by manifest document id. When a host is supplied, the parsed SVG root is mounted there.

### `get(identity)`

Returns all indexed SVG elements matching one cross-document semantic identity.

### `select(identity)`

Marks all matching elements with `data-websvg-selected="true"` and emits `websvg:selectionchange`.

### `clearSelection()`

Clears the current semantic selection.

### `relations(identity?)`

Returns normalized relations. With an identity, returns only relations touching that semantic identity.

### `resolveRelation(relation)`

Returns relation metadata plus resolved source/target SVG elements from every loaded document.

### `documents()`

Returns loaded document records.

## Browser events

WebSVG dispatches these events on its `events` EventTarget:

- `websvg:loaded`
- `websvg:selectionchange`

## Status

MVP / early dogfooding. The public contract is intentionally small.
