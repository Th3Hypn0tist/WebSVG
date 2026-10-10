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
