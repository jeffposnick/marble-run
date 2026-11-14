import { PIECE_TYPES, PIECES } from "../model/pieces.ts";
import type { Tool } from "./builder.ts";

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Creates one toggle button per piece plus the erase tool. Exactly one is pressed at a time. */
export function buildToolButtons(container: HTMLElement, onSelect: (tool: Tool) => void) {
  const buttons = new Map<Tool, HTMLButtonElement>();
  const make = (tool: Tool, label: string, key: string, swatch: string | null) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tool = tool;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-keyshortcuts", key);
    button.title = `${label} (${key})`;
    if (swatch) {
      const dot = document.createElement("span");
      dot.className = "swatch";
      dot.style.setProperty("--swatch", swatch);
      button.append(dot);
    } else {
      button.insertAdjacentHTML(
        "afterbegin",
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 20h10M5 15l9-9 5 5-9 9H8z"/></svg>',
      );
    }
    button.append(label);
    button.addEventListener("click", () => onSelect(tool));
    container.append(button);
    buttons.set(tool, button);
  };
  for (const type of PIECE_TYPES) {
    const spec = PIECES[type];
    make(type, spec.label, spec.key, `#${spec.color.toString(16).padStart(6, "0")}`);
  }
  make("erase", "Erase", "X", null);

  return {
    setActive(tool: Tool) {
      for (const [t, button] of buttons) button.setAttribute("aria-pressed", String(t === tool));
    },
  };
}

/**
 * Roving tab stop for the toolbar where the native `focusgroup` attribute is unsupported: one tab
 * stop, arrow keys move between controls (reversed in RTL), Home/End jump to the ends.
 */
export function installToolbarFallback(toolbar: HTMLElement): void {
  if ("focusGroup" in HTMLElement.prototype) return;
  const items = () => [...toolbar.querySelectorAll<HTMLButtonElement>("button")];
  items().forEach((b, i) => (b.tabIndex = i === 0 ? 0 : -1));
  toolbar.addEventListener("focusin", ({ target }) => {
    const list = items();
    if (target instanceof HTMLButtonElement && list.includes(target)) {
      for (const b of list) b.tabIndex = b === target ? 0 : -1;
    }
  });
  toolbar.addEventListener("keydown", (event) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const rtl = getComputedStyle(toolbar).direction === "rtl";
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
    };
    let next: number;
    if (event.key in steps) next = (current + steps[event.key]! + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]!.focus();
  });
}

/** Writes short messages to the polite live region, clearing them after a while. */
export function createAnnouncer(region: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string) => {
    region.textContent = message;
    clearTimeout(timer);
    timer = setTimeout(() => (region.textContent = ""), 4000);
  };
}

/** Saves to localStorage where available; private modes and blocked storage are tolerated. */
export const storage = {
  read(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown) : undefined;
    } catch {
      return undefined;
    }
  },
  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: building still works, it just isn't remembered.
    }
  },
};
