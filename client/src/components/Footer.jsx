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
        <div className="footer-links">
          <a href="/privacy" className="footer-link">Privacy Policy</a>
          <span className="footer-separator">•</span>
          <a href="/terms" className="footer-link">Terms of Service</a>
        </div>
      </div>
    </footer>
  )
}
