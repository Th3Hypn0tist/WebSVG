export function createMatrixLabelManager({
  websvg,
  projection,
  viewport,
  selectRepresentation
}) {
  const matrices = new Map();

  function prepare() {
    matrices.clear();

    for (const record of websvg.documents()) {
      if (
        projection?.typeOf(record) !==
        "matrix"
      ) {
        continue;
      }

      const article =
        record.host?.closest(
          ".svg-document"
        );

      if (!article) continue;

      article.classList.add(
        "matrix-label-view"
      );

      record.svg.classList.add(
        "matrix-label-source"
      );

      const layer =
        document.createElement("div");

      layer.className =
        "matrix-label-layer";

      const universalLayer =
        document.createElement("div");

      universalLayer.className =
        "matrix-label-universal-layer";

      layer.append(universalLayer);
      article.append(layer);

      const sources =
        projection.pinSources(
          record,
          "left"
        );

      const universals =
        sources.map(source =>
          createUniversalLabel(
            source,
            universalLayer
          )
        );

      matrices.set(record.svg, {
        record,
        article,
        layer,
        universals
      });
    }

    refreshAll();
  }

  function createUniversalLabel(
    source,
    layer
  ) {
    const ref =
      source.getAttribute(
        "data-websvg-id"
      );

    const text =
      source
        .querySelector(".u")
        ?.textContent
        ?.trim() ||
      ref?.replace(
        "rep:matrix-universal:",
        ""
      ) ||
      "";

    const label =
      document.createElement("button");

    label.type = "button";
    label.className =
      "matrix-pinned-label matrix-universal-label";
    label.textContent = text;
    label.tabIndex = -1;

    if (ref) {
      label.dataset.representationRef =
        ref;

      label.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          selectRepresentation(
            ref,
            source
          );
        }
      );
    }

    layer.append(label);

    return {
      source,
      label
    };
  }

  function refreshAll() {
    for (const svg of matrices.keys()) {
      refresh(svg);
    }
  }

  function refresh(svg) {
    const matrix =
      matrices.get(svg);

    if (
      !matrix ||
      matrix.article.hidden
    ) {
      return;
    }

    const hostRect =
      matrix.record.host
        .getBoundingClientRect();

    if (
      hostRect.width <= 0 ||
      hostRect.height <= 0
    ) {
      return;
    }

    const zoom =
      viewport.getZoomScale(svg);

    const fontSize =
      clamp(
        12 * Math.sqrt(zoom),
        12,
        22
      );

    for (
      const item of
        matrix.universals
    ) {
      const point =
        sourcePoint(
          item.source,
          0,
          15
        );

      if (!point) {
        item.label.hidden = true;
        continue;
      }

      const y =
        point.y - hostRect.top;

      const visible =
        y >= 0 &&
        y <= hostRect.height;

      item.label.hidden =
        !visible;

      if (!visible) continue;

      item.label.style.top =
        `${y}px`;

      item.label.style.fontSize =
        `${fontSize}px`;

      mirrorHighlight(item);
    }
  }

  function mirrorHighlight(item) {
    const state =
      item.source.getAttribute(
        "data-websvg-highlight"
      ) ||
      item.source.getAttribute(
        "data-websvg-group-highlight"
      );

    if (state) {
      item.label.dataset.websvgHighlight =
        state;
    } else {
      delete item.label.dataset
        .websvgHighlight;
    }
  }

  function sourcePoint(
    element,
    x,
    y
  ) {
    const matrix =
      element.getScreenCTM();

    if (!matrix) return null;

    return {
      x:
        matrix.a * x +
        matrix.c * y +
        matrix.e,
      y:
        matrix.b * x +
        matrix.d * y +
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
  return Math.min(
    max,
    Math.max(min, value)
  );
}
