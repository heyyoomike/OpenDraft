/** Shared focus scopes for custom overlays. Native <dialog> keeps its own scope. */
const layers: HTMLElement[] = [];
const listeners = new Set<() => void>();
const blocked = new Map<HTMLElement, { inert: boolean; hidden: string | null }>();

/**
 * The layer the writer is looking at: the one painted highest, and among
 * layers painted at the same level, the one opened last.
 *
 * Opening order alone is not enough. Two dialogs can be up at once (the
 * recovery prompt at start-up, then the format picker for a new screenplay),
 * and they need not be stacked in the order they opened: the recovery prompt
 * sits at z-index 3500 so that nothing covers it. When the last one opened was
 * treated as active, the prompt on screen was made inert and ignored every
 * click, which went through to the picker hidden underneath.
 */
export function pickTopLayer<T>(candidates: readonly T[], paintLevel: (layer: T) => number): T | undefined {
  let top: T | undefined;
  let topLevel = -Infinity;
  for (const layer of candidates) {
    const level = paintLevel(layer);
    // `>=`: a tie goes to the later one, which keeps opening order — and with
    // it a nested scope above the one it opened from (see registerModal).
    if (level >= topLevel) { top = layer; topLevel = level; }
  }
  return top;
}

/** The z-index a layer is painted at among the page's other overlays: that of
 * its outermost positioned ancestor that sets one. Overlays are siblings near
 * the root, so that is the one the browser compares. */
function paintLevel(element: HTMLElement): number {
  const view = element.ownerDocument.defaultView;
  if (!view) return 0;
  let level = 0;
  for (let node: HTMLElement | null = element; node && node !== node.ownerDocument.body; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    const z = Number.parseInt(style.zIndex, 10);
    if (style.position !== 'static' && Number.isFinite(z)) level = z;
  }
  return level;
}

/** The custom layer on top in `doc`, if any. */
function topLayer(doc: Document): HTMLElement | undefined {
  return pickTopLayer(layers.filter(layer => layer.ownerDocument === doc), paintLevel);
}

/** Where a popup opened in `doc` goes: its top dialog, or its body. A panel
 * popped out into its own window passes that window's document. */
export function modalPortalContainer(doc: Document = document): HTMLElement {
  const dialogs = doc.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const native = dialogs[dialogs.length - 1];
  const custom = topLayer(doc);
  // Registered scopes follow opening order, which may differ from DOM order.
  return native && !layers.includes(native) && (!custom || !native.contains(custom))
    ? native : custom ?? native ?? doc.body;
}

export function subscribeModalLayers(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function reconcile() {
  for (const [element, original] of blocked) {
    element.inert = original.inert;
    if (original.hidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', original.hidden);
  }
  blocked.clear();
  // Move persistent popup/live-region hosts before deciding which siblings
  // belong to the background; a host moved into the modal must not stay inert.
  listeners.forEach(listener => listener());
  // The document the last dialog opened in, and the layer on top there.
  const latest = layers[layers.length - 1];
  const active = latest && topLayer(latest.ownerDocument);
  if (active) {
    let branch: HTMLElement = active;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
        blocked.set(sibling, { inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      branch = branch.parentElement;
      if (branch === branch.ownerDocument.body) break;
    }
  }
}

export function registerModal(element: HTMLElement): () => void {
  // Children mount before parents: an already registered nested scope stays on top.
  const child = layers.findIndex(layer => element.contains(layer));
  layers.splice(child < 0 ? layers.length : child, 0, element);
  reconcile();
  return () => {
    const index = layers.indexOf(element);
    if (index >= 0) layers.splice(index, 1);
    reconcile();
  };
}

export function isTopModal(element: HTMLElement): boolean {
  return modalPortalContainer(element.ownerDocument) === element;
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]',
  )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}
