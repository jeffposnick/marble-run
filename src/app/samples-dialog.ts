import { BOARD_SIZE, MAX_LEVEL } from "../config.ts";
import { PIECES, type PieceType } from "../model/pieces.ts";
import type { Sample } from "../model/samples.ts";

const SVG = "http://www.w3.org/2000/svg";

/** A small top-down map of a sample: each square shows its highest piece, brighter when higher. */
function miniMap(sample: Sample): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${BOARD_SIZE} ${BOARD_SIZE}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mini-map");
  const top = new Map<string, { type: PieceType; level: number }>();
  for (const [type, x, z, level] of sample.board.pieces) {
    const key = `${x},${z}`;
    if ((top.get(key)?.level ?? -1) < level) top.set(key, { type, level });
  }
  for (const [key, { type, level }] of top) {
    const [x, z] = key.split(",").map(Number) as [number, number];
    const cell = document.createElementNS(SVG, "rect");
    cell.setAttribute("x", String(x + 0.06));
    cell.setAttribute("y", String(z + 0.06));
    cell.setAttribute("width", "0.88");
    cell.setAttribute("height", "0.88");
    cell.setAttribute("rx", type === "finish" || type === "start" ? "0.44" : "0.15");
    cell.setAttribute("fill", `#${PIECES[type].color.toString(16).padStart(6, "0")}`);
    cell.setAttribute("fill-opacity", String(0.45 + 0.55 * (level / MAX_LEVEL)));
    svg.append(cell);
  }
  return svg;
}

/** Fills the samples dialog with one button per sample; `onPick` gets the chosen one. */
export function setupSamplesDialog(
  dialog: HTMLDialogElement,
  samples: readonly Sample[],
  onPick: (sample: Sample) => void,
): void {
  const list = dialog.querySelector("ul")!;
  for (const sample of samples) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = sample.name;
    const description = document.createElement("span");
    description.textContent = sample.description;
    const text = document.createElement("span");
    text.className = "sample-text";
    text.append(name, description);
    button.append(miniMap(sample), text);
    button.addEventListener("click", () => {
      dialog.close();
      onPick(sample);
    });
    item.append(button);
    list.append(item);
  }
}
