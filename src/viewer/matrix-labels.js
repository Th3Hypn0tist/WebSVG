export function createMatrixLabelManager({
  websvg,
  viewport,
  selectRepresentation
}) {
  const matrices = new Map();

  function prepare() {
    for (const record of websvg.documents()) {
      const stepElements = [
        ...record.svg.querySelectorAll(
          '[data-websvg-id^="rep:matrix-step:"]'
        )
      ];

      const universalElements = [
        ...record.svg.querySelectorAll(
          '[data-websvg-id^="rep:matrix-universal:"]'
        )
      ];

      if (!stepElements.length || !universalElements.length) {
        continue;
      }

      const article = record.host?.closest(".svg-document");
      if (!article) continue;

      article.classList.add("matrix-label-view");
      record.svg.classList.add("matrix-label-source");

      const layer = document.createElement("div");
      layer.className = "matrix-label-layer";
      layer.setAttribute("aria-hidden", "true");

      const roleLayer = document.createElement("div");
      roleLayer.className = "matrix-label-role-layer";

      const stepLayer = document.createElement("div");
      stepLayer.className = "matrix-label-step-layer";

      const universalLayer = document.createElement("div");
      universalLayer.className = "matrix-label-universal-layer";

      layer.append(roleLayer, stepLayer, universalLayer);
      article.append(layer);

      const roles = buildRoleLabels(record.svg, roleLayer);
      const steps = buildStepLabels(stepElements, stepLayer);
      const universals = buildUniversalLabels(
        universalElements,
        universalLayer
      );

      matrices.set(record.svg, {
        record,
        article,
        layer,
        roles,
        steps,
        universals
      });
    }

    refreshAll();
  }

  function buildRoleLabels(svg, layer) {
    return [
      ...svg.querySelectorAll(
        '[data-websvg-id^="rep:matrix-role:"]'
      )
    ].map(source => {
      const text =
        source.querySelector(".role")?.textContent?.trim() ||
        source
          .getAttribute("data-websvg-id")
          .slice("rep:matrix-role:".length);

      const header = source.querySelector(".header-bg");
      const width = Number(header?.getAttribute("width")) || 58;
      const x = Number(header?.getAttribute("x")) || 0;

      return createLabel({
        source,
        layer,
        className: "matrix-pinned-label matrix-role-label",
        text,
        anchor: {
          x: x + width / 2,
          y: 0
        }
      });
    });
  }

  function buildStepLabels(elements, layer) {
    return elements.map(source => {
      const texts = [
        ...source.querySelectorAll(".step-head")
      ];

      const descriptive =
        texts.find(element =>
          element.getAttribute("transform")?.includes("rotate")
        ) ||
        texts[0];

      const sequence =
        texts.find(element =>
          /^\d+$/.test(element.textContent?.trim() || "")
        );

      const label =
        descriptive?.textContent?.trim() ||
        source
          .getAttribute("data-websvg-id")
          .slice("rep:matrix-step:".length);

      const text = sequence
        ? `${sequence.textContent.trim()} · ${label}`
        : label;

      return createLabel({
        source,
        layer,
        className: "matrix-pinned-label matrix-step-label",
        text,
        anchor: {
          x: 29,
          y: 0
        }
      });
    });
  }

  function buildUniversalLabels(elements, layer) {
    return elements.map(source => {
      const text =
        source.querySelector(".u")?.textContent?.trim() ||
        source
          .getAttribute("data-websvg-id")
          .slice("rep:matrix-universal:".length);

      return createLabel({
        source,
        layer,
        className: "matrix-pinned-label matrix-universal-label",
        text,
        anchor: {
          x: 0,
          y: 15
        }
      });
    });
  }

  function createLabel({
    source,
    layer,
    className,
    text,
    anchor
  }) {
    const label = document.createElement("button");
    label.type = "button";
    label.className = className;
    label.textContent = text;
    label.tabIndex = -1;

    const representationRef =
      source.getAttribute("data-websvg-id");

    if (representationRef) {
      label.dataset.representationRef = representationRef;

      label.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        selectRepresentation(representationRef);
      });
    }

    layer.append(label);

    return {
      source,
      label,
      anchor
    };
  }

  function refreshAll() {
    for (const svg of matrices.keys()) {
      refresh(svg);
    }
  }

  function refresh(svg) {
    const matrix = matrices.get(svg);
    if (!matrix || matrix.article.hidden) return;

    const hostRect =
      matrix.record.host.getBoundingClientRect();

    if (hostRect.width <= 0 || hostRect.height <= 0) {
      return;
    }

    const zoom =
      viewport.getZoomScale(svg);

    const roleFont = clamp(
      11 * Math.sqrt(zoom),
      11,
      24
    );

    const stepFont = clamp(
      10 * Math.sqrt(zoom),
      10,
      22
    );

    const universalFont = clamp(
      12 * Math.sqrt(zoom),
      12,
      26
    );

    for (const item of matrix.roles) {
      const point =
        sourcePoint(item.source, item.anchor);

      positionHorizontalLabel({
        item,
        point,
        hostRect,
        top: 5,
        fontSize: roleFont,
        minX: 118
      });
    }

    for (const item of matrix.steps) {
      const point =
        sourcePoint(item.source, item.anchor);

      positionHorizontalLabel({
        item,
        point,
        hostRect,
        top: 31,
        fontSize: stepFont,
        minX: 118
      });
    }

    for (const item of matrix.universals) {
      const point =
        sourcePoint(item.source, item.anchor);

      positionVerticalLabel({
        item,
        point,
        hostRect,
        left: 6,
        fontSize: universalFont,
        minY: 76
      });
    }
  }

  function positionHorizontalLabel({
    item,
    point,
    hostRect,
    top,
    fontSize,
    minX
  }) {
    if (!point) {
      item.label.hidden = true;
      return;
    }

    const x = point.x - hostRect.left;
    const visible =
      x >= minX &&
      x <= hostRect.width - 12;

    item.label.hidden = !visible;

    if (!visible) return;

    item.label.style.left = `${x}px`;
    item.label.style.top = `${top}px`;
    item.label.style.fontSize = `${fontSize}px`;

    mirrorHighlight(item);
  }

  function positionVerticalLabel({
    item,
    point,
    hostRect,
    left,
    fontSize,
    minY
  }) {
    if (!point) {
      item.label.hidden = true;
      return;
    }

    const y = point.y - hostRect.top;
    const visible =
      y >= minY &&
      y <= hostRect.height - 10;

    item.label.hidden = !visible;

    if (!visible) return;

    item.label.style.left = `${left}px`;
    item.label.style.top = `${y}px`;
    item.label.style.fontSize = `${fontSize}px`;

    mirrorHighlight(item);
  }

  function mirrorHighlight(item) {
    const state =
      item.source.getAttribute(
        "data-websvg-highlight"
      );

    if (state) {
      item.label.dataset.websvgHighlight = state;
    } else {
      delete item.label.dataset.websvgHighlight;
    }
  }

  function sourcePoint(element, anchor) {
    const matrix = element.getScreenCTM();
    if (!matrix) return null;

    return {
      x:
        matrix.a * anchor.x +
        matrix.c * anchor.y +
        matrix.e,
      y:
        matrix.b * anchor.x +
        matrix.d * anchor.y +
        matrix.f
    };
  }

  function isMatrix(svg) {
    return matrices.has(svg);
  }

  return {
    prepare,
    refresh,
    refreshAll,
    isMatrix
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
