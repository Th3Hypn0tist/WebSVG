export function createProjectionManager({ websvg }) {
  const records = new Map();

  function prepare() {
    records.clear();

    const registry =
      websvg.manifest?.projection_types || {};

    for (const record of websvg.documents()) {
      const declaredType =
        record.declaration?.projection_type ||
        record.svg.getAttribute(
          "data-websvg-projection"
        ) ||
        record.declaration?.type ||
        null;

      const config =
        declaredType && registry[declaredType]
          ? registry[declaredType]
          : {};

      const contentSelector =
        config.content_selector ||
        '[data-websvg-view="content"]';

      const chromeSelector =
        config.chrome_selector ||
        '[data-websvg-view="chrome"]';

      const contentElements = [
        ...record.svg.querySelectorAll(
          contentSelector
        )
      ];

      const chromeElements = [
        ...record.svg.querySelectorAll(
          chromeSelector
        )
      ];

      for (const element of chromeElements) {
        element.style.display = "none";
        element.setAttribute(
          "data-websvg-projection-hidden",
          "true"
        );
      }

      const projection = {
        record,
        type: declaredType,
        config,
        contentSelector,
        chromeSelector,
        contentElements,
        chromeElements
      };

      records.set(record.id, projection);
      records.set(record.svg, projection);
    }
  }

  function projectionFor(value) {
    if (!value) return null;
    return records.get(value) || null;
  }

  function typeOf(value) {
    return projectionFor(value)?.type || null;
  }

  function configOf(value) {
    return projectionFor(value)?.config || {};
  }

  function contentBounds(value) {
    const projection =
      projectionFor(value);

    if (!projection) return null;

    const elements =
      projection.contentElements.length
        ? projection.contentElements
        : [projection.record.svg];

    return unionBounds(
      projection.record.svg,
      elements
    );
  }

  function visibleContentBounds(value) {
    const projection =
      projectionFor(value);

    if (!projection) return null;

    const focusSelector =
      projection.config.focus_selector;

    const candidates =
      typeof focusSelector === "string" &&
      focusSelector
        ? [
            ...projection.record.svg.querySelectorAll(
              focusSelector
            )
          ]
        : projection.contentElements;

    const elements =
      candidates.length
        ? candidates.filter(
            element =>
              element.style.display !==
              "none"
          )
        : [projection.record.svg];

    return unionBounds(
      projection.record.svg,
      elements
    );
  }

  function pinSources(value, name = null) {
    const projection =
      projectionFor(value);

    if (!projection) return [];

    const selector = name
      ? `[data-websvg-pin-source="${cssEscape(name)}"]`
      : "[data-websvg-pin-source]";

    return [
      ...projection.record.svg.querySelectorAll(
        selector
      )
    ];
  }

  function pinDefinition(value, name) {
    const pins =
      configOf(value).pin_sources;

    if (!Array.isArray(pins)) {
      return null;
    }

    return (
      pins.find(pin => pin?.name === name) ||
      null
    );
  }

  function editorCapabilities(value) {
    return {
      ...(configOf(value).editor || {})
    };
  }

  return {
    prepare,
    projectionFor,
    typeOf,
    configOf,
    contentBounds,
    visibleContentBounds,
    pinSources,
    pinDefinition,
    editorCapabilities
  };
}

function unionBounds(svg, elements) {
  const boxes = elements
    .map(element =>
      elementBoundsInRoot(svg, element)
    )
    .filter(Boolean);

  if (!boxes.length) return null;

  const minX =
    Math.min(...boxes.map(box => box.x));

  const minY =
    Math.min(...boxes.map(box => box.y));

  const maxX =
    Math.max(
      ...boxes.map(
        box => box.x + box.width
      )
    );

  const maxY =
    Math.max(
      ...boxes.map(
        box => box.y + box.height
      )
    );

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function elementBoundsInRoot(svg, element) {
  try {
    const box = element.getBBox();

    const elementMatrix =
      element.getScreenCTM();

    const rootMatrix =
      svg.getScreenCTM();

    if (!elementMatrix || !rootMatrix) {
      return null;
    }

    const matrix =
      rootMatrix
        .inverse()
        .multiply(elementMatrix);

    const points = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [
        box.x + box.width,
        box.y + box.height
      ]
    ].map(([x, y]) => ({
      x:
        matrix.a * x +
        matrix.c * y +
        matrix.e,
      y:
        matrix.b * x +
        matrix.d * y +
        matrix.f
    }));

    const xs =
      points.map(point => point.x);

    const ys =
      points.map(point => point.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  } catch {
    return null;
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replace(
    /["\\]/g,
    "\\$&"
  );
}
