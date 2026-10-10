# WebSVG

WebSVG is a dependency-free browser runtime and projection protocol for **semantic SVG document sets**.

It separates three concerns that are often mixed together:

- **SVG** owns representation: geometry, grouping, text, local visual values, projection-local behavior and stable representation identities.
- **WebSVG manifest JSON** owns semantic bindings, relation definitions/rules, projection contracts and optional integration metadata.
- **Canonical CW / Structure**, when present, owns canonical semantics. WebSVG becomes a projection and edit surface over that model.

The current repository contains the runtime, viewer, projection infrastructure and a full MMDemo dogfooding set.

## Core invariant

**SVG says what is drawn. JSON says what it means and how representations relate to semantics.**

SVG does not own semantic references to other semantic objects.

A representation identity is local to the visual representation layer:

```xml
<g
  data-websvg-id="rep:timeline-step:sales.negotiate"
>
  ...
</g>
```

The manifest binds that representation to a semantic identity:

```json
{
  "representation_ref": "rep:timeline-step:sales.negotiate",
  "semantic_ref": "step:sales.negotiate",
  "kind": "step"
}
```

The same semantic identity may have several representations across several SVG files.

For example, the same Step can appear simultaneously in a timeline and in a matrix.

## Authority model

### SVG owns

- geometry
- text and authored visual hierarchy
- representation identities via `data-websvg-id`
- local values intrinsic to a visual datapoint
- projection-local metadata
- source geometry for pinned labels
- authored grouping

### Manifest JSON owns

- representation → semantic bindings
- representation → semantic relation bindings
- semantic relations
- binding rules
- relation generation/binding rules
- projection type declarations
- Structure bridge metadata

### Structure / CW owns, when present

- canonical semantic identities
- canonical node/link/event structure
- semantic authority for round-trip projection

WebSVG does not duplicate canonical truth.

## Representation identities

A WebSVG representation can be any SVG element or group:

- node
- box
- matrix cell
- row
- column
- lane
- path
- connector
- region
- entire group
- any other authored visual anchor

The canonical identity attribute is:

```text
data-websvg-id
```

Examples:

```text
rep:timeline-role:sales
rep:timeline-step:sales.negotiate
rep:matrix-role:sales
rep:matrix-step:sales.negotiate
rep:matrix-universal:Project
rep:matrix-cell:sales.negotiate:Project
rep:sequence:sales.qualify:sales.scope_solution
rep:handoff:sales.handoff_delivery:proc.check_availability
```

## Local visual values

Values intrinsic to a visual datapoint may remain in SVG.

Example:

```xml
<g
  class="matrix-cell"
  data-websvg-id="rep:matrix-cell:sales.negotiate:Quote"
  data-mode="W"
>
  ...
</g>
```

Here `W` is the cell's local displayed value.

The semantic Step → Universal relation is still owned by the manifest.

The current demo uses local values such as:

- `data-mode`
- `data-slot`

## Relations

Semantic relations are manifest-owned.

Visual connector geometry can still live in SVG:

```xml
<path
  data-websvg-id="rep:sequence:sales.qualify:sales.scope_solution"
  ...
/>
```

The manifest binds that representation to a semantic relation.

WebSVG 0.3 also supports compact relation rules so large document sets do not need hundreds of repetitive explicit binding records.

The MMDemo currently declares:

- `sequence`
- `handoff`
- `step_universal`

## Projection contract

WebSVG projection behavior is **declared, not hard-coded to SVG coordinates**.

The current projection metadata is intentionally representation-local and therefore belongs in SVG.

### Projection type

```xml
<svg data-websvg-projection="matrix">
```

or:

```xml
<svg data-websvg-projection="timeline">
```

The manifest document declaration also names its projection type:

```json
{
  "id": "mmdemo.step-universal.matrix",
  "file": "mmdemo_step_universal_matrix.svg",
  "projection_type": "matrix"
}
```

### Content

Geometry used for projection fit/reset bounds is marked explicitly:

```xml
<rect
  data-websvg-view="content-bounds"
  ...
/>
```

or:

```xml
<g data-websvg-view="content">
  ...
</g>
```

This prevents document titles, explanatory text or other chrome from affecting projection bounds.

### Chrome

Non-projection UI embedded in an authored SVG is marked:

```xml
<g data-websvg-view="chrome">
  ...
</g>
```

Chrome does not participate in projection fit/reset bounds.

### Pinned sources

Projection labels that should remain attached to viewer edges are marked with:

```text
data-websvg-pin-source
```

Example:

```xml
<g
  data-websvg-id="rep:matrix-universal:Project"
  data-websvg-pin-source="left"
>
  ...
</g>
```

The viewer can then render a fixed left gutter while the matrix content itself pans and zooms.

## Projection manifest

Projection behavior is declared under `projection_types`.

Example:

```json
{
  "matrix": {
    "family": "matrix",
    "axes": ["column", "row"],
    "content_selector": "[data-websvg-view=\"content-bounds\"]",
    "chrome_selector": "[data-websvg-view=\"chrome\"]",
    "focus_selector": ".matrix-cell",
    "fit_padding": 0,
    "pin_sources": [
      {
        "name": "left",
        "edge": "left"
      }
    ],
    "editor": {
      "selectable": true,
      "movable": true,
      "resizable": false,
      "linkable": true,
      "groupable": true,
      "reorderable": true,
      "editable_text": true
    }
  }
}
```

The manifest currently contains projection contracts for:

- matrix
- timeline
- flowchart
- swimlane
- state machine
- sequence diagram
- dependency graph
- hierarchy tree
- Gantt
- event chain
- value stream
- data flow
- process map
- decision tree

The catalog defines the protocol surface and editor capabilities.

Specialized viewer behavior is currently implemented primarily for **matrix** and **timeline**. Other projection types are contract-ready but not yet given projection-specific interaction modules.

## Structure bridge

WebSVG is designed to become a **Structure 2D projection/edit surface**.

The manifest can declare a Structure bridge:

```json
{
  "structure": {
    "bridge": "websvg-structure/0.1",
    "role": "projection_and_edit_surface",
    "semantic_authority": "cw_when_present",
    "representation_authority": "svg",
    "identity_bridge": "semantic_ref",
    "structure_repository": "Th3Hypn0tist/Structure",
    "round_trip": {
      "svg_to_structure": "derive",
      "structure_to_svg": "project"
    }
  }
}
```

The intended round trip is:

```text
early design
    ↓
structured SVG + WebSVG manifest
    ↓
Structure 2D
    ↓
derive / map
    ↓
CW candidate
    ↓
canonicalize + validate
    ↓
canonical CW
    ↓
project
    ↓
SVG + WebSVG manifest
```

Important authority rule:

**when canonical CW exists, CW is semantic authority; WebSVG remains representation/projection authority.**

The bridge is a contract, not a runtime dependency. WebSVG can run standalone.

## Editor direction

The projection manifest already declares generic editor capabilities such as:

- selectable
- movable
- resizable
- linkable
- groupable
- reorderable
- editable text

This is intentional.

The current viewer is being built so it can evolve into the base 2D editor for Structure without changing the representation identity or semantic binding model.

The target is not a separate drawing application bolted onto Structure.

The SVG representation layer itself becomes the editable projection surface.

## Viewer interaction

Current viewer behavior includes:

### Selection

Clicking a representation selects its semantic binding.

The same semantic identity is highlighted across all loaded SVG documents.

Selection states currently distinguish:

- primary selection
- relation geometry
- related semantic endpoints

Role selection is projection-aware and expands visually to role members where appropriate.

### Group focus

Repeated selection supports projection-group focus:

```text
click       → select
click again → isolate group / hide others
click again → show all
```

Focus is projection-aware rather than a global element filter.

Examples:

- timeline role → keep the role's complete timeline
- matrix grouping → keep the relevant projection group

### Zoom and pan

The viewer uses SVG `viewBox` navigation.

Matrix behavior currently includes:

- mouse wheel zoom without Ctrl/Cmd
- zoom anchored exactly under the cursor
- drag pan
- `+`, `−` and Reset controls
- restrained incremental zoom factors

Other SVG projections retain Ctrl/Cmd + wheel zoom unless specialized otherwise.

### Keyboard navigation

Current projection-aware arrow navigation includes:

**Timeline**

- Left / Right → previous / next Step in the same timeline
- Up / Down → adjacent timeline, choosing the nearest Step by slot

**Matrix**

- Left / Right → previous / next existing Step cell in the row
- Up / Down → previous / next existing Universal cell in the column

Empty matrix cells are skipped.

### Matrix gutter

The matrix Universal labels are rendered as a fixed left gutter.

The SVG matrix itself zooms and pans beside that gutter.

The pinned labels:

- remain attached to the viewer edge
- track their source row vertically
- scale text size with zoom
- remain semantic selection targets

## Runtime modules

The viewer has been split into focused modules:

```text
viewer.js
src/
├── websvg.js
└── viewer/
    ├── discovery.js
    ├── projection.js
    ├── viewport.js
    ├── navigation.js
    ├── focus.js
    ├── groups.js
    ├── matrix-labels.js
    └── selection-visuals.js
```

Responsibilities:

- `websvg.js` — semantic SVG runtime, indexing, bindings, relations and selection
- `discovery.js` — input/manifest discovery
- `projection.js` — projection contract interpretation and content bounds
- `viewport.js` — viewBox, fit, zoom and pan
- `navigation.js` — projection-aware keyboard navigation
- `focus.js` — group isolation / Hide others
- `groups.js` — projection group resolution
- `matrix-labels.js` — matrix pinned gutter behavior
- `selection-visuals.js` — projection-specific selection expansion
- `viewer.js` — bootstrap and orchestration only

## WebSVG manifest

Current schema:

```text
websvg/0.3
```

Schema file:

```text
schema/websvg-manifest.schema.json
```

A document set can contain several SVG files but one WebSVG manifest.

The manifest currently supports:

- document declarations
- projection type per document
- representation identity configuration
- local visual-value attributes
- explicit bindings
- compact binding rules
- relation rules
- relation-to-representation binding rules
- explicit relations
- projection type registry
- editor capability declarations
- optional Structure bridge

## Deployment

The repository root is directly deployable under any public path.

Example:

```text
/r/svg/
├── index.html
├── viewer.js
├── styles.css
├── schema/
├── src/
└── input/
    ├── index.php
    ├── *.svg
    └── exactly-one.websvg.json
```

The runtime does not hard-code `aigm.fi` or `/r/svg/`.

All URLs are resolved relative to the deployed viewer.

`input/index.php` exposes a small JSON inventory when directory listing is disabled by the web server.

## MMDemo dogfooding set

The included demo is the full current MMDemo, not the earlier reduced test subset.

It currently contains two coordinated projections:

### Role timeline

A company-wide process surface with role lanes, Steps, sequence links and handoffs.

### Step × Business Universal matrix

A Step-to-Universal projection using local `C / R / W` cell values.

The same Step identities appear across both documents and are linked through the manifest.

The matrix also makes structural modelling errors visually obvious. For example, the dogfooding pass exposed that **Project is the universal work context for executable AIGMos BusinessIT work**, which was then corrected in the underlying model and reflected in the matrix.

## Design goals

WebSVG aims to remain:

- dependency-free
- local-first friendly
- runtime-independent
- deployment-path independent
- projection-driven rather than hard-coded
- semantically explicit
- round-trip capable with Structure/CW
- usable as a standalone viewer
- evolvable into an editor without replacing the identity model

## Non-goals

WebSVG is not:

- a semantic authority replacing CW
- a second canonical graph model
- a framework-specific UI layer
- a generic canvas engine
- a format where SVG secretly owns domain relations

## Status

Active dogfooding / pre-editor.

Matrix and timeline projections are already interactive. The projection protocol, Structure bridge and editor capability contract are now being established before generalizing the editor surface.
