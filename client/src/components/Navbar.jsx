import { Link } from 'react-router-dom'
import './Navbar.css'

const Navbar = () => {
  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo">Fabric Finder</Link>
      <div className="navbar-tagline">Know what you're wearing</div>
    </nav>
  )
}

export default Navbar
