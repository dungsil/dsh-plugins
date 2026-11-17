import { LOADING, NAV } from './dom.js'

/** Indicator and controls reuse the native lightbox close control and thumbnail spinner tokens. */
export const STYLES = `
button[${LOADING}] {
  position: relative;
  min-width: 48px;
  min-height: 48px;
}
[${LOADING}-indicator] {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: var(--dsw-alias-label-tertiary);
}
[${LOADING}-indicator] > svg {
  box-sizing: content-box;
  padding: 6px;
  border-radius: 50%;
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-shadow-lv1);
  animation: dungsil-image-loading-rotate 0.9s linear infinite;
}
@keyframes dungsil-image-loading-rotate {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  [${LOADING}-indicator] > svg { animation: none; }
}
[${NAV}-stage] {
  padding-inline: 76px;
}
[${NAV}] {
  position: absolute;
  top: 50%;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-top: -18px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l2-darkmode-thin);
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
[${NAV}="previous"] { left: 20px; }
[${NAV}="next"] { right: 20px; }
[${NAV}]:disabled {
  opacity: 0.4;
  cursor: default;
}
[${NAV}]:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 3px;
}
`
