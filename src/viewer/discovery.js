export async function discoverInputFiles(inputUrl) {
  const response = await fetch(inputUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`input discovery failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (contentType.includes("application/json")) {
    return parseInventoryJson(body);
  }

  return parseDirectoryListing(body, inputUrl);
}

function parseInventoryJson(body) {
  const inventory = JSON.parse(body);

  if (!inventory.ok) {
    throw new Error(inventory.error || "input discovery failed");
  }

  const manifest = inventory.manifest;
  const svgFiles = Array.isArray(inventory.svg_files)
    ? inventory.svg_files
    : [];

  validateInventory(manifest, svgFiles);

  return { manifest, svgFiles };
}

function parseDirectoryListing(body, inputUrl) {
  const listing = new DOMParser().parseFromString(body, "text/html");
  const names = new Set();

  for (const anchor of listing.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let url;

    try {
      url = new URL(href, inputUrl);
    } catch {
      continue;
    }

    if (url.origin !== inputUrl.origin) continue;
    if (!url.pathname.startsWith(inputUrl.pathname)) continue;

    const relative = decodeURIComponent(
      url.pathname.slice(inputUrl.pathname.length)
    );

    if (!relative || relative.includes("/")) continue;
    if (!/\.(?:svg|json)$/i.test(relative)) continue;

    names.add(relative);
  }

  const files = [...names].sort((a, b) => a.localeCompare(b));
  const manifests = files.filter(name => /\.json$/i.test(name));
  const svgFiles = files.filter(name => /\.svg$/i.test(name));

  if (manifests.length !== 1) {
    throw new Error(
      `input/ must contain exactly one JSON manifest; found ${manifests.length}`
    );
  }

  validateInventory(manifests[0], svgFiles);

  return {
    manifest: manifests[0],
    svgFiles
  };
}

function validateInventory(manifest, svgFiles) {
  if (typeof manifest !== "string" || !/\.json$/i.test(manifest)) {
    throw new Error("input/ must contain exactly one JSON manifest");
  }

  if (!Array.isArray(svgFiles) || svgFiles.length === 0) {
    throw new Error("input/ contains no SVG files");
  }
}
