# WebSVG

WebSVG is a small, dependency-free browser library for **semantic SVG document sets**.

SVG owns the visual document: geometry, groups, text, local visual/datapoint values, and stable **representation identities**.

JSON owns the semantic layer: bindings from representation identities to semantic identities, bindings from visual relation geometry to semantic relation identities, and the semantic relations themselves.

WebSVG is not canonical semantic authority and does not replace Structure. It is a lightweight design/viewer layer that can later feed CW derivation, while CW can also project into WebSVG.

## Core invariant

**SVG says what is drawn. JSON says what it means and what it is related to.**

A representation can be anything in SVG: a single cell, a box, a path, a group, or half of the picture.

Example SVG:

```xml
<g data-websvg-id="rep:timeline:sales">...</g>
```

Example JSON:

```json
{
  "representation_ref": "rep:timeline:sales",
  "semantic_ref": "abstraction:sales",
  "kind": "abstraction"
}
```

The same semantic identity may have multiple SVG representations across multiple files.

## Relations

Semantic relations live only in JSON.

SVG may contain a path or group that visually represents a relation, but that geometry is connected to the semantic relation through an explicit JSON binding:

```json
{
  "representation_ref": "rep:handoff:001",
  "relation_ref": "rel:handoff:001"
}
```

This prevents duplicate relation authority.

## Local datapoint values

Values intrinsic to a visual datapoint may stay in SVG.

For example a matrix cell may carry:

```xml
<g data-websvg-id="rep:matrix-cell:001" data-mode="R">...</g>
```

Here `R` is the cell's own displayed value. The semantic relation between the Step and Universal is still defined only in JSON.

## Demo

The repository root is directly deployable. Put WebSVG under any public path, for example `/r/svg/`.

```text
/
├── index.html
├── viewer.js
├── styles.css
├── src/
└── input/
    ├── *.svg
    └── exactly-one.websvg.json
```

The viewer resolves paths dynamically from its own URL. It discovers all SVG files in the public `input/` directory and requires exactly one JSON manifest.

The included MMDemo subset demonstrates:

- a large Sales region bound to `abstraction:sales`
- a Procurement region bound to `abstraction:procurement`
- the same Step represented in both timeline and matrix SVGs
- sequence and handoff paths bound to JSON relation identities
- matrix C/R/W values stored as local SVG datapoint values
- Step → Universal relations stored only in JSON

## Status

MVP / early dogfooding.


## Projection contract

WebSVG projection behavior is declared, not hard-coded.

SVG owns projection-local metadata:

- `data-websvg-projection` identifies the projection type.
- `data-websvg-view="content"` marks geometry that belongs to fit/reset/focus bounds.
- `data-websvg-view="chrome"` marks titles, explanatory text and other non-content UI.
- `data-websvg-pin-source="<name>"` marks source geometry for edge-pinned viewer labels.

The manifest owns the registry of projection types and their generic editor capabilities. Current catalog includes matrix, timeline, flowchart, swimlane, state machine, sequence diagram, dependency graph, hierarchy tree, Gantt, event chain, value stream, data flow, process map and decision tree.

## Structure bridge

WebSVG is designed to become a Structure 2D projection/edit surface.

The manifest declares an optional `structure` bridge contract. The important authority split remains:

- SVG owns representation geometry and projection behavior.
- JSON binds representation identities to semantic identities.
- When canonical CW exists, CW is semantic authority.
- Structure may derive/import an SVG+manifest design surface and project/export canonical structure back into WebSVG.
- `semantic_ref` is the identity bridge between WebSVG representation bindings and Structure/CW semantics.

The bridge does not make WebSVG depend on Structure at runtime. It defines the round-trip contract early enough that the viewer can evolve into an editor without changing identity semantics.
