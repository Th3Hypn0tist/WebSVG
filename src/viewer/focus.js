export function createFocusController({
  websvg,
  viewport
}) {
  function apply({
    active,
    selection,
    currentRepresentationRef
  }) {
    restore();

    if (!active || !selection) {
      viewport.updateMetrics();
      return;
    }

    const refs = collectRelevantRefs(
      selection,
      currentRepresentationRef
    );

    const identityAttribute =
      websvg.manifest.representation.identity_attribute ||
      "data-websvg-id";

    const selector = `[${identityAttribute}]`;

    for (const record of websvg.documents()) {
      focusDocument(record, refs, selector);
    }

    viewport.updateMetrics();
    viewport.fitFocusedDocuments();
  }

  function restore() {
    for (const record of websvg.documents()) {
      const article = record.host?.closest(".svg-document");
      if (article) article.hidden = false;

      for (
        const hidden of record.svg.querySelectorAll(
          "[data-websvg-focus-hidden]"
        )
      ) {
        showElement(hidden);
      }
    }

    viewport.restoreAllViewBoxes();
  }

  function collectRelevantRefs(selection, currentRef) {
    const full = new Set();
    const anchors = new Set();

    if (selection.type === "semantic") {
      for (const ref of selection.directRepresentationRefs || []) {
        full.add(ref);
        anchors.add(ref);
      }

      for (const relation of selection.relations || []) {
        for (const ref of websvg.representationsForRelation(relation.id)) {
          full.add(ref);
          anchors.add(ref);
        }

        const other =
          relation.from === selection.ref
            ? relation.to
            : relation.from;

        if (!other) continue;

        for (const ref of websvg.representationsForSemantic(other)) {
          anchors.add(ref);
        }
      }
    } else if (selection.type === "relation") {
      for (const ref of selection.relationRepresentationRefs || []) {
        full.add(ref);
        anchors.add(ref);
      }

      for (const ref of selection.endpointRepresentationRefs || []) {
        anchors.add(ref);
      }
    } else if (selection.type === "representation") {
      full.add(selection.ref);
      anchors.add(selection.ref);
    }

    if (currentRef) {
      full.add(currentRef);
      anchors.add(currentRef);
    }

    return { full, anchors };
  }

  function focusDocument(record, refs, selector) {
    const svg = record.svg;
    const article = record.host?.closest(".svg-document");

    const anchorElements = new Set();
    const fullElements = new Set();

    addElements(refs.anchors, record.id, anchorElements);
    addElements(refs.full, record.id, fullElements);

    if (!anchorElements.size) {
      if (article) article.hidden = true;
      return;
    }

    if (article) article.hidden = false;

    const pathElements = new Set([svg]);

    for (const element of anchorElements) {
      let current = element;

      while (current && current !== svg) {
        pathElements.add(current);
        current = current.parentElement;
      }
    }

    const containsCache = new WeakMap();

    const containsRepresentation = element => {
      if (containsCache.has(element)) {
        return containsCache.get(element);
      }

      const result =
        element.matches?.(selector) ||
        Boolean(element.querySelector?.(selector));

      containsCache.set(element, result);
      return result;
    };

    const walk = element => {
      if (fullElements.has(element)) {
        showSubtree(element);
        return;
      }

      const keepPath =
        pathElements.has(element) ||
        anchorElements.has(element);

      if (!keepPath) {
        hideElement(element);
        return;
      }

      showElement(element);

      for (const child of element.children) {
        if (
          child.localName === "defs" ||
          child.localName === "style"
        ) {
          showSubtree(child);
          continue;
        }

        if (
          fullElements.has(child) ||
          pathElements.has(child) ||
          anchorElements.has(child)
        ) {
          walk(child);
          continue;
        }

        if (containsRepresentation(child)) {
          hideElement(child);
        } else {
          showSubtree(child);
        }
      }
    };

    for (const child of svg.children) {
      if (
        child.localName === "defs" ||
        child.localName === "style"
      ) {
        showSubtree(child);
      } else {
        walk(child);
      }
    }
  }

  function addElements(refs, documentId, target) {
    for (const ref of refs) {
      for (const item of websvg.representation(ref)) {
        if (item.documentId === documentId) {
          target.add(item.element);
        }
      }
    }
  }

  return {
    apply,
    restore
  };
}

function hideElement(element) {
  if (!element.hasAttribute("data-websvg-focus-hidden")) {
    element.setAttribute("data-websvg-focus-hidden", "true");
    element.setAttribute(
      "data-websvg-prev-display",
      element.style.display || ""
    );
  }

  element.style.display = "none";
}

function showElement(element) {
  if (!element.hasAttribute("data-websvg-focus-hidden")) return;

  element.style.display =
    element.getAttribute("data-websvg-prev-display") || "";

  element.removeAttribute("data-websvg-focus-hidden");
  element.removeAttribute("data-websvg-prev-display");
}

function showSubtree(element) {
  showElement(element);

  for (
    const hidden of element.querySelectorAll(
      "[data-websvg-focus-hidden]"
    )
  ) {
    showElement(hidden);
  }
}
