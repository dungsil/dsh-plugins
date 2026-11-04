const paths = {
  down: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6',
  left: 'M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12',
  right: 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4',
}

export function Chevron({ direction }: { direction: keyof typeof paths }) {
  return (
    <svg
      className="dsh-codex-chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth="1"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[direction]} stroke="currentColor" />
    </svg>
  )
}
