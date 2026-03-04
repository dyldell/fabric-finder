import './About.css'

export default function About() {
  return (
    <div className="about-page">
      {/* Hero Section */}
      <section className="about-hero">
        <div className="about-hero-content">
          <h1 className="about-hero-title">Know What You're Paying For</h1>
          <p className="about-hero-subtitle">
            Stop overpaying for premium brands. Fabric Finder analyzes clothing fabrics
            and finds cheaper alternatives with the same quality.
          </p>
        </div>
      </section>

      <div className="about-container">
        {/* How It Works - 4 Cards */}
        <section className="about-section">
          <h2 className="section-title">How It Works</h2>
          <div className="cards-grid">
            <div className="feature-card">
              <div className="card-number">01</div>
              <h3 className="card-title">Paste URL</h3>
              <p className="card-description">
                Copy any clothing product URL from Lululemon, Alo Yoga, Patagonia, Vuori, or thousands of other brands
              </p>
            </div>

            <div className="feature-card">
              <div className="card-number">02</div>
              <h3 className="card-title">AI Analysis</h3>
              <p className="card-description">
                Our AI extracts the exact fabric composition (e.g., "87% Nylon, 13% Spandex") in seconds
              </p>
            </div>

            <div className="feature-card">
              <div className="card-number">03</div>
              <h3 className="card-title">Find Alternatives</h3>
              <p className="card-description">
                We search the entire web for items with matching fabrics at better prices
              </p>
            </div>

            <div className="feature-card">
              <div className="card-number">04</div>
              <h3 className="card-title">Save Money</h3>
              <p className="card-description">
                Buy the same quality fabrics without the premium brand markup—save 50-70% on average
              </p>
            </div>
          </div>
        </section>

        {/* Why Use It - 4 Cards */}
        <section className="about-section about-section-gray">
          <h2 className="section-title">Why Fabric Finder?</h2>
          <div className="cards-grid">
            <div className="feature-card">
              <div className="card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <h3 className="card-title">Fabric-First Matching</h3>
              <p className="card-description">
                We match based on actual material composition, not vague product descriptions
              </p>
            </div>

            <div className="feature-card">
              <div className="card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <h3 className="card-title">Fast & Accurate</h3>
              <p className="card-description">
                Results in under 30 seconds powered by Claude AI
              </p>
            </div>

            <div className="feature-card">
              <div className="card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <h3 className="card-title">Privacy First</h3>
              <p className="card-description">
                Minimal tracking—scan counts only for free tier limits
              </p>
            </div>

            <div className="feature-card">
              <div className="card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <h3 className="card-title">Free to Use</h3>
              <p className="card-description">
                3 free scans per month, no credit card required
              </p>
            </div>
          </div>
        </section>

        {/* Real Example */}
        <section className="about-section">
          <h2 className="section-title">Real Example</h2>
          <div className="example-container">
            <div className="example-card example-before">
              <span className="example-label">Premium Brand</span>
              <h3 className="example-product">Lululemon Align Leggings</h3>
              <p className="example-fabric">81% Nylon, 19% Lycra Elastane</p>
              <p className="example-price">$128</p>
            </div>

            <div className="example-arrow">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </div>

            <div className="example-card example-after">
              <span className="example-label example-label-success">Fabric Match</span>
              <h3 className="example-product">Amazon Basics Athletic Leggings</h3>
              <p className="example-fabric">80% Nylon, 20% Spandex</p>
              <p className="example-price example-price-success">$24.99</p>
              <p className="example-savings">Save $103 (80%)</p>
            </div>
          </div>
        </section>

        {/* Disclosure */}
        <section className="about-section about-section-disclosure">
          <div className="disclosure-content">
            <h3 className="disclosure-title">How We Make Money</h3>
            <p className="disclosure-text">
              Fabric Finder is free to use. We earn a small commission when you purchase through
              Amazon affiliate links (at no extra cost to you). This helps us keep the service
              free and accurate.
            </p>
            <p className="disclosure-note">
              <strong>Important:</strong> Our recommendations are never influenced by commissions.
              We show the best fabric matches, period.
            </p>
          </div>
        </section>

        {/* Contact */}
        <section className="about-section">
          <div className="contact-content">
            <h3 className="contact-title">Questions or Feedback?</h3>
            <p className="contact-text">
              Email us at <a href="mailto:hello@fabricfinder.fit" className="contact-link">hello@fabricfinder.fit</a>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
