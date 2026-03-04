import './Logo.css'

const Logo = ({ size = 60 }) => {
  return (
    <img
      src="/logo.svg"
      alt="Fabric Finder"
      className="fabric-finder-logo"
      width={size}
      height={size}
    />
  )
}

export default Logo
