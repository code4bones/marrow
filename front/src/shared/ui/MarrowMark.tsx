interface MarrowMarkProps {
  size?: number;
  className?: string;
}

/** Brand mark (M-as-two-heads-and-a-smile) — outline weight, meant for 24-40px alongside text. Inherits color via currentColor. */
export function MarrowMark({ size = 20, className }: MarrowMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Marrow"
      className={className}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx={128} cy={128} r={98} strokeWidth={9} />
        <path d="M88 63 L88 160" strokeWidth={20} />
        <path d="M168 63 L168 160" strokeWidth={20} />
        <path d="M88 63 L128 150" strokeWidth={20} />
        <path d="M168 63 L128 150" strokeWidth={20} />
      </g>
      <g fill="currentColor">
        <circle cx={88} cy={36} r={20} />
        <circle cx={168} cy={36} r={20} />
      </g>
    </svg>
  );
}
