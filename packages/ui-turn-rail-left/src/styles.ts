// DSH 0.2.1-rc.5 has no rail-position setting or rail Slot.
// Keep its native rail and change only these version-specific CSS selectors.
// Physical left is intentional, including in RTL layouts.
export const STYLES = `
nav.SNx2jG_frame {
  left: 12px;
  right: auto;
}
nav.SNx2jG_frame .SNx2jG_mark::before {
  left: 0;
  right: auto;
  transform-origin: 0% 50%;
}
nav.SNx2jG_frame > .SNx2jG_preview {
  left: calc(100% + 12px);
  right: auto;
}
`
