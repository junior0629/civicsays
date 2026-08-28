// =========================================================================
// CivicSays — Icon helper
// Usage: <svg class="icon"><use href="/assets/icons.svg#i-home"></use></svg>
//        <svg class="icon"><use href="assets/icons.svg#i-search"></use></svg>
// For absolute paths on GitHub Pages, use `getIcon(name)` instead.
// =========================================================================

const ICON_BASE = new URL('../assets/icons.svg', import.meta.url).href;

/**
 * Returns the full href to an icon in the sprite.
 * @param {string} name  icon name (without "i-" prefix, e.g. "home", "search")
 * @returns {string}
 */
export function iconHref(name) {
  return `${ICON_BASE}#i-${name}`;
}

/**
 * Creates an <svg><use></use></svg> element for the given icon.
 * @param {string} name
 * @param {object} [opts]  { className, size, label }
 * @returns {SVGSVGElement}
 */
export function icon(name, opts = {}) {
  const { className = 'icon', size, label } = opts;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add(className);
  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', iconHref(name));
  svg.appendChild(use);
  return svg;
}

/**
 * Inlines the icon sprite once at the start of <body> so other code can
 * reference icons via short fragment hrefs. Idempotent.
 */
export function injectSprite() {
  if (document.getElementById('__icon_sprite__')) return;
  fetch(ICON_BASE)
    .then((r) => r.text())
    .then((svgText) => {
      const div = document.createElement('div');
      div.id = '__icon_sprite__';
      div.style.display = 'none';
      div.innerHTML = svgText;
      document.body.prepend(div);
    })
    .catch(() => {
      // Fail silently — icons just won't render.
    });
}
