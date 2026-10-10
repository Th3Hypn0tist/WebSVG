const GROUP_PREFIXES = [
  "rep:timeline-role:",
  "rep:matrix-role:",
  "rep:matrix-universal:"
];

export function resolveGroupRepresentationRef(element) {
  let current = element;

  while (current instanceof Element) {
    const ref =
      current.getAttribute("data-websvg-id");

    if (
      ref &&
      GROUP_PREFIXES.some(prefix =>
        ref.startsWith(prefix)
      )
    ) {
      return ref;
    }

    current = current.parentElement;
  }

  return null;
}
