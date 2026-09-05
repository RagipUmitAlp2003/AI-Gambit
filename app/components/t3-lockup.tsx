type Props = { className?: string };

const ARM = "M0 0 L-17 -29.44 L-17 -52 L-40 -52 L-58 -88 L58 -88 L40 -52 L17 -52 L17 -29.44 L34 0 Z";

/** Ekran yüzeylerine uyum sağlayan Türkiye Teknoloji Takımı marka kilidi. */
export default function T3Lockup({ className }: Props) {
  return (
    <div
      className={className ? `t3-lockup ${className}` : "t3-lockup"}
      role="img"
      aria-label="Türkiye Teknoloji Takımı"
    >
      <svg className="t3-lockup-mark" viewBox="-112 -95 224 195" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id="t3ArmRed" gradientUnits="userSpaceOnUse" x1="-58" y1="-88" x2="34" y2="0">
            <stop offset="0" stopColor="#c1272d" />
            <stop offset="1" stopColor="#e8391a" />
          </linearGradient>
          <linearGradient id="t3ArmAmber" gradientUnits="userSpaceOnUse" x1="-58" y1="-88" x2="34" y2="0">
            <stop offset="0" stopColor="#fbba00" />
            <stop offset="1" stopColor="#ee7203" />
          </linearGradient>
          <linearGradient id="t3ArmBlue" gradientUnits="userSpaceOnUse" x1="-58" y1="-88" x2="34" y2="0">
            <stop offset="0" stopColor="#2ba7e0" />
            <stop offset="1" stopColor="#17357d" />
          </linearGradient>
        </defs>
        <g>
          <path fill="url(#t3ArmRed)" transform="translate(0 -4)" d={ARM} />
          <path fill="url(#t3ArmAmber)" transform="rotate(120) translate(0 -4)" d={ARM} />
          <path fill="url(#t3ArmBlue)" transform="rotate(240) translate(0 -4)" d={ARM} />
        </g>
      </svg>
      <span className="t3-lockup-word" aria-hidden="true">Türkiye<br />Teknoloji<br />Takımı</span>
    </div>
  );
}
