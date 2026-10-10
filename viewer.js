import { WebSVG } from "./src/websvg.js";
import { discoverInputFiles } from "./src/viewer/discovery.js";
import { createViewportManager } from "./src/viewer/viewport.js";
import { createNavigationController } from "./src/viewer/navigation.js";
import { createFocusController } from "./src/viewer/focus.js";
import { createMatrixLabelManager } from "./src/viewer/matrix-labels.js";
import { resolveGroupRepresentationRef } from "./src/viewer/groups.js";
import { createProjectionSelectionVisuals } from "./src/viewer/selection-visuals.js";

const topbarEl = document.querySelector(".topbar");
const statusEl = document.querySelector("#status");
const workspaceEl = document.querySelector("#workspace");
const summaryEl = document.querySelector("#selection-summary");
const clearButton = document.querySelector("#clear-selection");
const focusButton = document.querySelector("#focus-selection");

const websvg = new WebSVG();
const rootUrl = new URL(".", import.meta.url);
const inputUrl = new URL("input/", rootUrl);

let currentSelection = null;
let currentRepresentationRef = null;
let focusActive = false;
let focusedGroupRepresentationRef = null;

const viewport = createViewportManager({
  websvg,
  workspaceEl,
  topbarEl,
  isFocusActive: () => focusActive
});

const focus = createFocusController({
  websvg,
  viewport
});

const navigation = createNavigationController({
  websvg,
  selectRepresentation
});

const matrixLabels = createMatrixLabelManager({
  websvg,
  viewport,
  selectRepresentation: handleRepresentationClick
});

const projectionSelectionVisuals =
  createProjectionSelectionVisuals({
    websvg
  });

clearButton.addEventListener("click", clearSelection);

focusButton.addEventListener("click", () => {
  if (!currentSelection) return;

  if (focusActive) {
    focusActive = false;
    focusedGroupRepresentationRef = null;
    applyFocus();
    return;
  }

  const item =
    websvg.representation(
      currentRepresentationRef
    )[0];

  focusedGroupRepresentationRef =
    resolveGroupRepresentationRef(
      item?.element
    );

  focusActive = true;
  applyFocus();
});

window.addEventListener("resize", () => {
  viewport.updateMetrics();

  if (focusActive) {
    viewport.fitFocusedDocuments();
  }

  matrixLabels.refreshAll();
});

window.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (isTextInput(event.target)) return;

  const direction = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down"
  }[event.key];

  if (!direction) return;

  if (
    navigation.navigate(
      direction,
      currentRepresentationRef
    )
  ) {
    event.preventDefault();
  }
});

function isTextInput(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function wireRepresentationClicks() {
  const identityAttribute =
    websvg.manifest.representation.identity_attribute ||
    "data-websvg-id";

  const selector = `[${identityAttribute}]`;

  for (const record of websvg.documents()) {
    const elements = [];

    if (record.svg.matches(selector)) {
      elements.push(record.svg);
    }

    elements.push(
      ...record.svg.querySelectorAll(selector)
    );

    for (const element of elements) {
      element.classList.add("websvg-interactive");

      element.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        if (
          viewport.isClickSuppressed(record.svg)
        ) {
          return;
        }

        const ref =
          element.getAttribute(
            identityAttribute
          );

        if (ref) {
          handleRepresentationClick(
            ref,
            element
          );
        }
      });
    }
  }
}

function handleRepresentationClick(
  representationRef,
  sourceElement = null
) {
  const element =
    sourceElement ||
    websvg.representation(
      representationRef
    )[0]?.element;

  const groupRef =
    resolveGroupRepresentationRef(
      element
    );

  const repeated =
    representationRef ===
    currentRepresentationRef;

  if (repeated && groupRef) {
    if (
      focusActive &&
      focusedGroupRepresentationRef ===
        groupRef
    ) {
      focusActive = false;
      focusedGroupRepresentationRef = null;
      applyFocus();
      return;
    }

    if (!focusActive) {
      focusActive = true;
      focusedGroupRepresentationRef =
        groupRef;
      applyFocus();
      return;
    }
  }

  if (
    focusActive &&
    groupRef &&
    groupRef !==
      focusedGroupRepresentationRef
  ) {
    focusedGroupRepresentationRef =
      groupRef;
  }

  selectRepresentation(
    representationRef
  );
}

function selectRepresentation(representationRef) {
  const bindings =
    websvg.bindingsForRepresentation(
      representationRef
    );

  const semanticBinding =
    bindings.find(
      binding =>
        typeof binding.semantic_ref ===
        "string"
    );

  const relationBinding =
    bindings.find(
      binding =>
        typeof binding.relation_ref ===
        "string"
    );

  currentRepresentationRef =
    representationRef;

  if (semanticBinding) {
    currentSelection =
      websvg.selectSemantic(
        semanticBinding.semantic_ref
      );

    summaryEl.textContent =
      semanticSummary(currentSelection);
  } else if (relationBinding) {
    currentSelection =
      websvg.selectRelation(
        relationBinding.relation_ref
      );

    summaryEl.textContent =
      relationSummary(
        currentSelection,
        representationRef
      );
  } else {
    currentSelection =
      websvg.selectRepresentation(
        representationRef
      );

    summaryEl.textContent =
      representationRef;
  }

  projectionSelectionVisuals.apply(
    currentSelection
  );

  focusButton.disabled = false;

  if (focusActive) {
    applyFocus();
    matrixLabels.refreshAll();
    return;
  }

  keepSelectionVisible();
  matrixLabels.refreshAll();
}

function keepSelectionVisible() {
  if (!currentSelection) return;

  if (
    currentSelection.type ===
    "semantic"
  ) {
    viewport.ensureSemanticVisible(
      currentSelection
    );
    return;
  }

  if (
    currentSelection.type ===
    "relation"
  ) {
    viewport.ensureRelationVisible(
      currentSelection
    );
    return;
  }

  viewport.ensureRepresentationVisible(
    currentRepresentationRef
  );
}

function applyFocus() {
  focus.apply({
    active: focusActive,
    selection: currentSelection,
    currentRepresentationRef,
    groupRepresentationRef:
      focusedGroupRepresentationRef
  });

  focusButton.textContent =
    focusActive
      ? "Show all"
      : "Hide others";

  if (!focusActive) {
    keepSelectionVisible();
  }

  matrixLabels.refreshAll();
}

function clearSelection() {
  focusActive = false;
  focusedGroupRepresentationRef = null;

  focus.restore();
  projectionSelectionVisuals.clear();
  websvg.clearSelection();

  currentSelection = null;
  currentRepresentationRef = null;

  summaryEl.textContent =
    "Click SVG · arrows navigate structure";

  focusButton.disabled = true;
  focusButton.textContent = "Hide others";

  viewport.updateMetrics();
}

function semanticSummary(selection) {
  const representationCount =
    selection.directRepresentationRefs
      .length;

  const relationCount =
    selection.relations.length;

  return (
    `${selection.ref} · ` +
    `${representationCount} representation` +
    `${representationCount === 1 ? "" : "s"} · ` +
    `${relationCount} link` +
    `${relationCount === 1 ? "" : "s"}`
  );
}

function relationSummary(
  selection,
  representationRef
) {
  const relation =
    selection.relation;

  const mode =
    websvg
      .localValuesForRepresentation(
        representationRef
      )
      .map(
        item =>
          item.attributes["data-mode"]
      )
      .find(Boolean);

  return (
    `${relation.from} → ${relation.to} · ` +
    `${relation.type || relation.group || "relation"}` +
    `${mode ? ` · ${mode}` : ""}`
  );
}

function fail(error) {
  console.error(error);

  statusEl.textContent = "Failed";
  summaryEl.textContent =
    error instanceof Error
      ? error.message
      : String(error);

  workspaceEl.replaceChildren();
}

async function start() {
  try {
    const inventory =
      await discoverInputFiles(
        inputUrl
      );

    const manifestUrl =
      new URL(
        inventory.manifest,
        inputUrl
      );

    const response =
      await fetch(
        manifestUrl,
        { cache: "no-store" }
      );

    if (!response.ok) {
      throw new Error(
        `manifest load failed (${response.status})`
      );
    }

    const manifest =
      await response.json();

    const hosts =
      viewport.makeHosts(
        inventory.svgFiles,
        manifest.documents || []
      );

    await websvg.load(manifest, {
      baseUrl: manifestUrl.href,
      documentFiles:
        inventory.svgFiles,
      hosts
    });

    viewport.prepare();
    viewport.updateMetrics();

    matrixLabels.prepare();

    for (const record of websvg.documents()) {
      record.svg.addEventListener(
        "websvg:viewportchange",
        () => matrixLabels.refresh(record.svg)
      );
    }

    navigation.build();
    wireRepresentationClicks();

    statusEl.textContent =
      `${websvg.manifest.document_set} · ` +
      `${websvg.documents().length} SVG`;
  } catch (error) {
    fail(error);
  }
}

start();
