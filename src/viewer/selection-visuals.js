export function createProjectionSelectionVisuals({ websvg }) {
  const decorated = new Set();

  function clear() {
    for (const element of decorated) {
      element.removeAttribute(
        "data-websvg-group-highlight"
      );
    }

    decorated.clear();
  }

  function apply(selection) {
    clear();

    if (
      selection?.type !== "semantic" ||
      typeof selection.ref !== "string" ||
      !selection.ref.startsWith("role:")
    ) {
      return;
    }

    const roleToken =
      selection.ref.slice("role:".length);

    decorateTimelineRole(roleToken);
    decorateMatrixRole(roleToken);
  }

  function decorateTimelineRole(roleToken) {
    const ref =
      `rep:timeline-role:${roleToken}`;

    for (const item of websvg.representation(ref)) {
      for (
        const step of item.element.querySelectorAll(
          '[data-websvg-id^="rep:timeline-step:"]'
        )
      ) {
        mark(step, "primary");
      }

      for (
        const sequence of item.element.querySelectorAll(
          '[data-websvg-id^="rep:sequence:"]'
        )
      ) {
        mark(sequence, "relation");
      }
    }
  }

  function decorateMatrixRole(roleToken) {
    const roleRef =
      `rep:matrix-role:${roleToken}`;

    const stepRefs = new Set();

    for (const item of websvg.representation(roleRef)) {
      for (
        const step of item.element.querySelectorAll(
          '[data-websvg-id^="rep:matrix-step:"]'
        )
      ) {
        const ref =
          step.getAttribute("data-websvg-id");

        if (!ref) continue;

        stepRefs.add(ref);
      }
    }

    const allRefs =
      websvg.representationIds();

    for (const stepRef of stepRefs) {
      const stepId =
        stepRef.slice(
          "rep:matrix-step:".length
        );

      const cellPrefix =
        `rep:matrix-cell:${stepId}:`;

      for (const ref of allRefs) {
        if (!ref.startsWith(cellPrefix)) {
          continue;
        }

        for (const item of websvg.representation(ref)) {
          mark(item.element, "primary");
        }
      }
    }
  }

  function mark(element, state) {
    element.setAttribute(
      "data-websvg-group-highlight",
      state
    );

    decorated.add(element);
  }

  return {
    apply,
    clear
  };
}
