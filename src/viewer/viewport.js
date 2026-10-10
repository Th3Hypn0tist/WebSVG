export function createViewportManager({
  websvg,
  workspaceEl,
  topbarEl,
  isFocusActive
}) {
  const svgState = new WeakMap();

  function makeHosts(svgFiles, declarations) {
    const declaredByFile = new Map(
      declarations
        .map(item => [item.file || item.src, item])
        .filter(([file]) => typeof file === "string")
    );

    const hosts = {};
    workspaceEl.replaceChildren();

    for (const file of svgFiles) {
      const declaration = declaredByFile.get(file) || {};
      const id = declaration.id || file.replace(/\.svg$/i, "");

      const article = document.createElement("section");
      article.className = "svg-document";
      article.setAttribute("aria-label", id);

      const host = document.createElement("div");
      host.className = "svg-host";

      article.append(createControls(), host);
      workspaceEl.append(article);

      hosts[id] = host;
      hosts[file] = host;
    }

    return hosts;
  }

  function createControls() {
    const controls = document.createElement("div");
    controls.className = "svg-controls";

    for (const [action, label, title] of [
      ["zoom-in", "+", "Zoom in"],
      ["zoom-out", "−", "Zoom out"],
      ["reset", "Reset", "Reset view"]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.viewportAction = action;
      button.textContent = label;
      button.title = title;
      controls.append(button);
    }

    return controls;
  }

  function prepare() {
    for (const record of websvg.documents()) {
      const svg = record.svg;
      const originalViewBox = parseViewBox(svg.getAttribute("viewBox"));

      if (!originalViewBox) {
        throw new Error(`WebSVG: SVG has no valid viewBox: ${record.file}`);
      }

      svgState.set(svg, {
        originalViewBox: cloneBox(originalViewBox),
        resetViewBox: cloneBox(originalViewBox),
        currentViewBox: cloneBox(originalViewBox),
        drag: null,
        suppressClickUntil: 0
      });

      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.classList.add("websvg-document-svg");

      wireControls(record);
      wireInteractions(record);
    }
  }

  function updateMetrics() {
    const topbarHeight = topbarEl?.getBoundingClientRect().height || 52;
    const freeHeight = Math.max(
      300,
      window.innerHeight - topbarHeight - 24
    );

    for (const record of websvg.documents()) {
      const article = record.host?.closest(".svg-document");
      const state = svgState.get(record.svg);

      if (!article || !state) continue;

      if (isFocusActive() && !article.hidden) {
        article.style.height = `${freeHeight}px`;
        continue;
      }

      const width =
        article.getBoundingClientRect().width || window.innerWidth;

      const ratio =
        state.originalViewBox.height / state.originalViewBox.width;

      const naturalHeight = Math.max(180, width * ratio);

      article.style.height =
        `${Math.min(freeHeight, naturalHeight)}px`;
    }
  }

  function restoreAllViewBoxes() {
    for (const record of websvg.documents()) {
      const state = svgState.get(record.svg);
      if (!state) continue;

      state.resetViewBox = cloneBox(state.originalViewBox);
      state.currentViewBox = cloneBox(state.originalViewBox);

      record.svg.setAttribute(
        "viewBox",
        boxString(state.originalViewBox)
      );

      emitViewportChange(record.svg);
    }
  }

  function fitFocusedDocuments() {
    if (!isFocusActive()) return;

    for (const record of websvg.documents()) {
      const article = record.host?.closest(".svg-document");
      if (article?.hidden) continue;

      let box;
      try {
        box = record.svg.getBBox();
      } catch {
        continue;
      }

      if (!box || box.width <= 0 || box.height <= 0) continue;

      const pad = Math.max(
        18,
        Math.min(54, Math.max(box.width, box.height) * 0.035)
      );

      setResetViewBox(record.svg, {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2
      });
    }
  }

  function ensureRepresentationVisible(ref) {
    const item = websvg.representation(ref)[0];
    if (!item) return;

    const bounds = elementBoundsInSvg(item.element);
    if (!bounds) return;

    ensureBoundsVisible(item.document.svg, bounds);
  }

  function ensureSemanticVisible(selection) {
    const byDocument = groupItems(selection.directRepresentationRefs || []);

    for (const items of byDocument.values()) {
      ensureItemsVisible(items);
    }
  }

  function ensureRelationVisible(selection) {
    const refs = [
      ...(selection.relationRepresentationRefs || []),
      ...(selection.endpointRepresentationRefs || [])
    ];

    const byDocument = groupItems(refs);

    for (const items of byDocument.values()) {
      ensureItemsVisible(items);
    }
  }

  function groupItems(refs) {
    const byDocument = new Map();

    for (const ref of refs) {
      for (const item of websvg.representation(ref)) {
        if (!byDocument.has(item.documentId)) {
          byDocument.set(item.documentId, []);
        }
        byDocument.get(item.documentId).push(item);
      }
    }

    return byDocument;
  }

  function ensureItemsVisible(items) {
    const boxes = items
      .map(item => elementBoundsInSvg(item.element))
      .filter(Boolean);

    if (!boxes.length) return;

    const minX = Math.min(...boxes.map(box => box.x));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxX = Math.max(...boxes.map(box => box.x + box.width));
    const maxY = Math.max(...boxes.map(box => box.y + box.height));

    ensureBoundsVisible(items[0].document.svg, {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    });
  }

  function ensureBoundsVisible(svg, bounds) {
    const state = svgState.get(svg);
    if (!state) return;

    const view = state.currentViewBox;
    const marginX = view.width * 0.12;
    const marginY = view.height * 0.12;

    const inside =
      bounds.x >= view.x + marginX &&
      bounds.y >= view.y + marginY &&
      bounds.x + bounds.width <= view.x + view.width - marginX &&
      bounds.y + bounds.height <= view.y + view.height - marginY;

    if (inside) return;

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    setViewBox(svg, {
      x: centerX - view.width / 2,
      y: centerY - view.height / 2,
      width: view.width,
      height: view.height
    });
  }

  function elementBoundsInSvg(element) {
    try {
      const box = element.getBBox();
      const matrix = element.getCTM();
      if (!matrix) return null;

      const points = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height]
      ].map(([x, y]) => ({
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f
      }));

      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);

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

  function isClickSuppressed(svg) {
    return (svgState.get(svg)?.suppressClickUntil || 0) > Date.now();
  }

  function wireControls(record) {
    const article = record.host?.closest(".svg-document");
    if (!article) return;

    for (const button of article.querySelectorAll("[data-viewport-action]")) {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        if (button.dataset.viewportAction === "zoom-in") {
          zoomCenter(record.svg, 0.72);
        } else if (button.dataset.viewportAction === "zoom-out") {
          zoomCenter(record.svg, 1.38);
        } else if (button.dataset.viewportAction === "reset") {
          resetViewport(record.svg);
        }
      });
    }
  }

  function wireInteractions(record) {
    const svg = record.svg;

    svg.addEventListener(
      "wheel",
      event => {
        const matrix =
          svg.querySelector(
            '[data-websvg-id^="rep:matrix-cell:"]'
          ) !== null;

        if (
          !matrix &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          return;
        }

        event.preventDefault();

        zoomAt(
          svg,
          event.clientX,
          event.clientY,
          event.deltaY < 0 ? 0.82 : 1.22
        );
      },
      { passive: false }
    );

    svg.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      zoomAt(svg, event.clientX, event.clientY, 0.58);
    });

    svg.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;

      const state = svgState.get(svg);
      if (!state) return;

      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startBox: cloneBox(state.currentViewBox),
        moved: false,
        captured: false
      };
    });

    svg.addEventListener("pointermove", event => {
      const state = svgState.get(svg);
      const drag = state?.drag;

      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.moved && Math.hypot(dx, dy) < 4) return;

      drag.moved = true;

      if (!drag.captured) {
        svg.setPointerCapture?.(event.pointerId);
        drag.captured = true;
      }

      svg.classList.add("is-panning");

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      setViewBox(svg, {
        x:
          drag.startBox.x -
          dx * (drag.startBox.width / rect.width),
        y:
          drag.startBox.y -
          dy * (drag.startBox.height / rect.height),
        width: drag.startBox.width,
        height: drag.startBox.height
      });
    });

    const finishDrag = event => {
      const state = svgState.get(svg);
      const drag = state?.drag;

      if (!drag || drag.pointerId !== event.pointerId) return;

      if (drag.moved) {
        state.suppressClickUntil = Date.now() + 180;
      }

      state.drag = null;
      svg.classList.remove("is-panning");

      if (
        drag.captured &&
        svg.hasPointerCapture?.(event.pointerId)
      ) {
        svg.releasePointerCapture(event.pointerId);
      }
    };

    svg.addEventListener("pointerup", finishDrag);
    svg.addEventListener("pointercancel", finishDrag);
  }

  function zoomCenter(svg, factor) {
    const rect = svg.getBoundingClientRect();

    zoomAt(
      svg,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      factor
    );
  }

  function zoomAt(svg, clientX, clientY, factor) {
    const state = svgState.get(svg);
    if (!state) return;

    const current = state.currentViewBox;
    const reset = state.resetViewBox;
    const minWidth = reset.width * 0.02;

    const targetWidth = Math.min(
      reset.width,
      Math.max(minWidth, current.width * factor)
    );

    const scale = targetWidth / current.width;

    const targetHeight = Math.min(
      reset.height,
      current.height * scale
    );

    const anchor =
      clientPointToSvg(svg, clientX, clientY);

    if (!anchor) return;

    const rx = Math.min(
      1,
      Math.max(
        0,
        (anchor.x - current.x) /
          current.width
      )
    );

    const ry = Math.min(
      1,
      Math.max(
        0,
        (anchor.y - current.y) /
          current.height
      )
    );

    setViewBox(svg, {
      x: anchor.x - targetWidth * rx,
      y: anchor.y - targetHeight * ry,
      width: targetWidth,
      height: targetHeight
    });
  }

  function clientPointToSvg(
    svg,
    clientX,
    clientY
  ) {
    const matrix =
      svg.getScreenCTM();

    if (!matrix) return null;

    try {
      const inverse = matrix.inverse();

      return {
        x:
          inverse.a * clientX +
          inverse.c * clientY +
          inverse.e,
        y:
          inverse.b * clientX +
          inverse.d * clientY +
          inverse.f
      };
    } catch {
      return null;
    }
  }

  function resetViewport(svg) {
    const state = svgState.get(svg);
    if (!state) return;

    setViewBox(svg, cloneBox(state.resetViewBox));
  }

  function setViewBox(svg, box) {
    const state = svgState.get(svg);
    if (!state) return;

    const constrained = constrainToReset(box, state.resetViewBox);
    state.currentViewBox = constrained;

    svg.setAttribute("viewBox", boxString(constrained));
    emitViewportChange(svg);
  }

  function setResetViewBox(svg, box) {
    const state = svgState.get(svg);
    if (!state) return;

    state.resetViewBox = cloneBox(box);
    state.currentViewBox = cloneBox(box);

    svg.setAttribute("viewBox", boxString(box));
    emitViewportChange(svg);
  }

  function getZoomScale(svg) {
    const state = svgState.get(svg);

    if (!state) return 1;

    return (
      state.originalViewBox.width /
      state.currentViewBox.width
    );
  }

  function emitViewportChange(svg) {
    svg.dispatchEvent(
      new CustomEvent(
        "websvg:viewportchange",
        { bubbles: false }
      )
    );
  }

  return {
    makeHosts,
    prepare,
    updateMetrics,
    restoreAllViewBoxes,
    fitFocusedDocuments,
    ensureRepresentationVisible,
    ensureSemanticVisible,
    ensureRelationVisible,
    isClickSuppressed,
    getZoomScale
  };
}

function parseViewBox(value) {
  const parts = String(value || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(value => !Number.isFinite(value))
  ) {
    return null;
  }

  const [x, y, width, height] = parts;

  if (width <= 0 || height <= 0) return null;

  return { x, y, width, height };
}

function cloneBox(box) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  };
}

function boxString(box) {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

function constrainToReset(box, reset) {
  if (!reset) return cloneBox(box);

  const width = Math.min(box.width, reset.width);
  const height = Math.min(box.height, reset.height);

  const maxX = reset.x + reset.width - width;
  const maxY = reset.y + reset.height - height;

  return {
    x: Math.min(Math.max(box.x, reset.x), maxX),
    y: Math.min(Math.max(box.y, reset.y), maxY),
    width,
    height
  };
}
