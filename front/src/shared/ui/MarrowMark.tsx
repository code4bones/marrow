interface MarrowMarkProps {
  size?: number;
  className?: string;
}

/** Brand mark (M-as-two-heads-and-a-smile) — outline weight, meant for 24-40px alongside text. Inherits color via currentColor. Mirrors brand-icons/logo.svg exactly — keep in sync if that file changes. */
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
        <circle cx={128} cy={128} r={100} strokeWidth={4.1} />
        <path d="M88 63 L88 147" strokeWidth={12.7} />
        <path d="M168 63 L168 147" strokeWidth={12.7} />
        <path d="M88 63 L118 134" strokeWidth={12.7} />
        <path d="M168 63 L138 134" strokeWidth={12.7} />
        <path d="M83.5 170 Q128 212 172.5 170" strokeWidth={9.1} />
      </g>
      <g fill="currentColor">
        <circle cx={88} cy={36} r={15.5} />
        <circle cx={168} cy={36} r={15.5} />
      </g>
    </svg>
  );
}
