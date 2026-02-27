import './Logo.css'

const Logo = ({ size = 60 }) => {
  return (
    <svg
      className="fabric-finder-logo"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Woven fabric pattern - represents textile analysis */}
      <g className="logo-weave">
        {/* Vertical threads */}
        <rect x="20" y="10" width="8" height="80" rx="4" className="thread thread-1" />
        <rect x="36" y="10" width="8" height="80" rx="4" className="thread thread-2" />
        <rect x="52" y="10" width="8" height="80" rx="4" className="thread thread-1" />
        <rect x="68" y="10" width="8" height="80" rx="4" className="thread thread-2" />

        {/* Horizontal threads (weaving over/under) */}
        <rect x="10" y="20" width="80" height="8" rx="4" className="thread thread-3" opacity="0.9" />
        <rect x="10" y="36" width="80" height="8" rx="4" className="thread thread-4" opacity="0.9" />
        <rect x="10" y="52" width="80" height="8" rx="4" className="thread thread-3" opacity="0.9" />
        <rect x="10" y="68" width="80" height="8" rx="4" className="thread thread-4" opacity="0.9" />
      </g>

      {/* Central accent - represents "finding" or analysis */}
      <circle cx="50" cy="50" r="16" className="logo-center" />
      <circle cx="50" cy="50" r="10" className="logo-center-inner" />

      {/* Magnifying glass handle - subtle analysis symbol */}
      <line
        x1="60"
        y1="60"
        x2="70"
        y2="70"
        strokeWidth="4"
        strokeLinecap="round"
        className="logo-handle"
      />
    </svg>
  )
}

export default Logo
