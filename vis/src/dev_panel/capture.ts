// Serialize the currently-displayed `.tree-svg` element and download it as
// an .svg file (optionally rasterized to PNG). The SVG string includes a
// clone of the live DOM, so transforms, computed sizes, and inline styles
// are preserved exactly as rendered — useful for inspecting layout bugs by
// opening the file in a viewer or editor.

function clone_svg(): SVGSVGElement | undefined {
  const live = document.querySelector("svg.tree-svg") as SVGSVGElement | null;
  if (!live) return undefined;
  const node = live.cloneNode(true) as SVGSVGElement;
  // Reset any pan/zoom transform from the SPA wrapper so the capture shows
  // the SVG at its intrinsic coordinate space.
  node.removeAttribute("style");
  // Ensure the clone has xmlns + width/height so viewers render it.
  node.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!node.hasAttribute("width"))
    node.setAttribute("width", String(live.getAttribute("width") ?? ""));
  if (!node.hasAttribute("height"))
    node.setAttribute("height", String(live.getAttribute("height") ?? ""));
  return node;
}

function trigger_download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to kick off the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function capture_svg(filename: string): boolean {
  const node = clone_svg();
  if (!node) return false;
  const xml = new XMLSerializer().serializeToString(node);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  trigger_download(`${filename}.svg`, blob);
  return true;
}

// Rasterise the serialized SVG to a PNG by drawing it onto a canvas.
export async function capture_png(filename: string): Promise<boolean> {
  const node = clone_svg();
  if (!node) return false;
  const xml = new XMLSerializer().serializeToString(node);
  const width = Number(node.getAttribute("width") ?? 0) || 800;
  const height = Number(node.getAttribute("height") ?? 0) || 600;

  const svg_blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svg_blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
    });
    const canvas = document.createElement("canvas");
    const scale = 2; // retina-ish
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    await new Promise<void>((resolve) =>
      canvas.toBlob((blob) => {
        if (blob) trigger_download(`${filename}.png`, blob);
        resolve();
      }, "image/png"),
    );
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
