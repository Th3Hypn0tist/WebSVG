export function createNavigationController({
  websvg,
  selectRepresentation
}) {
  const state = {
    timelineRows: [],
    matrix: null
  };

  function build() {
    state.timelineRows = [];
    state.matrix = null;

    for (const record of websvg.documents()) {
      buildTimeline(record.svg);
      buildMatrix(record.svg);
    }
  }

  function navigate(direction, currentRepresentationRef) {
    if (!currentRepresentationRef) return false;

    if (
      currentRepresentationRef.startsWith("rep:timeline-step:")
    ) {
      return navigateTimeline(direction, currentRepresentationRef);
    }

    if (
      currentRepresentationRef.startsWith("rep:matrix-cell:")
    ) {
      return navigateMatrix(direction, currentRepresentationRef);
    }

    return false;
  }

  function buildTimeline(svg) {
    const rows = [
      ...svg.querySelectorAll(
        '.timeline[data-websvg-id^="rep:timeline-role:"]'
      )
    ];

    if (!rows.length) return;

    state.timelineRows = rows.map(row => ({
      element: row,
      steps: [
        ...row.querySelectorAll(
          '.process-step[data-websvg-id^="rep:timeline-step:"]'
        )
      ].sort((a, b) => stepSlot(a) - stepSlot(b))
    }));
  }

  function buildMatrix(svg) {
    const stepElements = [
      ...svg.querySelectorAll('[data-websvg-id^="rep:matrix-step:"]')
    ];

    const universalElements = [
      ...svg.querySelectorAll(
        '[data-websvg-id^="rep:matrix-universal:"]'
      )
    ];

    const cellElements = [
      ...svg.querySelectorAll('[data-websvg-id^="rep:matrix-cell:"]')
    ];

    if (!stepElements.length || !universalElements.length) return;

    const stepOrder = stepElements.map(element =>
      element
        .getAttribute("data-websvg-id")
        .slice("rep:matrix-step:".length)
    );

    const universalOrder = universalElements.map(element =>
      element
        .getAttribute("data-websvg-id")
        .slice("rep:matrix-universal:".length)
    );

    const cells = new Map();

    for (const element of cellElements) {
      const parsed = parseMatrixCellRef(
        element.getAttribute("data-websvg-id")
      );

      if (!parsed) continue;

      cells.set(cellKey(parsed.step, parsed.universal), element);
    }

    state.matrix = {
      stepOrder,
      universalOrder,
      cells
    };
  }

  function navigateTimeline(direction, currentRef) {
    const element = websvg.representation(currentRef)[0]?.element;
    if (!element) return false;

    const rowIndex = state.timelineRows.findIndex(
      row => row.element === element.closest(".timeline")
    );

    if (rowIndex < 0) return false;

    const row = state.timelineRows[rowIndex];
    const stepIndex = row.steps.indexOf(element);

    if (stepIndex < 0) return false;

    if (direction === "left" || direction === "right") {
      const delta = direction === "left" ? -1 : 1;
      return selectElement(row.steps[stepIndex + delta]);
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRow = state.timelineRows[rowIndex + delta];

      if (!targetRow?.steps.length) return false;

      const currentSlot = stepSlot(element);

      const target = targetRow.steps.reduce((best, candidate) => {
        if (!best) return candidate;

        const bestDistance =
          Math.abs(stepSlot(best) - currentSlot);

        const candidateDistance =
          Math.abs(stepSlot(candidate) - currentSlot);

        return candidateDistance < bestDistance
          ? candidate
          : best;
      }, null);

      return selectElement(target);
    }

    return false;
  }

  function navigateMatrix(direction, currentRef) {
    const matrix = state.matrix;
    const parsed = parseMatrixCellRef(currentRef);

    if (!matrix || !parsed) return false;

    const stepIndex = matrix.stepOrder.indexOf(parsed.step);
    const universalIndex =
      matrix.universalOrder.indexOf(parsed.universal);

    if (stepIndex < 0 || universalIndex < 0) return false;

    if (direction === "left" || direction === "right") {
      const delta = direction === "left" ? -1 : 1;

      for (
        let index = stepIndex + delta;
        index >= 0 && index < matrix.stepOrder.length;
        index += delta
      ) {
        const target = matrix.cells.get(
          cellKey(matrix.stepOrder[index], parsed.universal)
        );

        if (selectElement(target)) return true;
      }

      return false;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;

      for (
        let index = universalIndex + delta;
        index >= 0 && index < matrix.universalOrder.length;
        index += delta
      ) {
        const target = matrix.cells.get(
          cellKey(parsed.step, matrix.universalOrder[index])
        );

        if (selectElement(target)) return true;
      }

      return false;
    }

    return false;
  }

  function selectElement(element) {
    const ref = element?.getAttribute("data-websvg-id");
    if (!ref) return false;

    selectRepresentation(ref);
    return true;
  }

  return {
    build,
    navigate
  };
}

function stepSlot(element) {
  const slot = Number(element.getAttribute("data-slot"));

  return Number.isFinite(slot)
    ? slot
    : Number.MAX_SAFE_INTEGER;
}

function parseMatrixCellRef(ref) {
  const prefix = "rep:matrix-cell:";

  if (
    typeof ref !== "string" ||
    !ref.startsWith(prefix)
  ) {
    return null;
  }

  const tail = ref.slice(prefix.length);
  const separator = tail.lastIndexOf(":");

  if (
    separator <= 0 ||
    separator >= tail.length - 1
  ) {
    return null;
  }

  return {
    step: tail.slice(0, separator),
    universal: tail.slice(separator + 1)
  };
}

function cellKey(step, universal) {
  return `${step}\n${universal}`;
}
