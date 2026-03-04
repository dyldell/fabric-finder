import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <p className="footer-copyright">© 2026 Fabric Finder • Know what you're wearing</p>
        <p className="footer-disclosure">
          Fabric Finder participates in affiliate programs, including Amazon Associates.
          We may earn a commission when you purchase through links on our site, at no extra cost to you.
          This helps us keep the service free and continuously improve our fabric analysis technology.
        </p>
        <p className="footer-disclaimer">
          Fabric Finder is an independent product comparison tool. We are not affiliated with,
          endorsed by, or sponsored by any of the brands mentioned on this site. Brand names are
          used solely for product identification and comparison purposes. All trademarks are
          property of their respective owners.
        </p>
        <div className="footer-links">
          <a href="/about" className="footer-link">About</a>
          <span className="footer-separator">•</span>
          <a href="/privacy" className="footer-link">Privacy Policy</a>
          <span className="footer-separator">•</span>
          <a href="/terms" className="footer-link">Terms of Service</a>
        </div>
      </div>
    </footer>
  )
}
