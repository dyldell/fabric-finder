import './About.css'

export default function About() {
  return (
    <div className="about-page">
      <div className="about-hero">
        <h1>Know What You're Paying For</h1>
        <p className="about-tagline">
          Stop overpaying for premium brands. Fabric Finder analyzes clothing fabrics
          and finds cheaper alternatives with the same quality.
        </p>
      </div>

      <div className="about-container">
        {/* How It Works - Visual Cards */}
        <section className="how-it-works">
          <h2>How It Works</h2>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">1</div>
              <div className="step-icon">🔗</div>
              <h3>Paste URL</h3>
              <p>Copy any clothing product URL from Lululemon, Alo Yoga, Patagonia, Vuori, or thousands of other brands</p>
            </div>

            <div className="step-card">
              <div className="step-number">2</div>
              <div className="step-icon">🤖</div>
              <h3>AI Analysis</h3>
              <p>Our AI extracts the exact fabric composition (e.g., "87% Nylon, 13% Spandex") in seconds</p>
            </div>

            <div className="step-card">
              <div className="step-number">3</div>
              <div className="step-icon">🔍</div>
              <h3>Find Alternatives</h3>
              <p>We search Amazon, eBay, and Google Shopping for items with matching fabrics at better prices</p>
            </div>

            <div className="step-card">
              <div className="step-number">4</div>
              <div className="step-icon">💰</div>
              <h3>Save Money</h3>
              <p>Buy the same quality fabrics without the premium brand markup. Save 50-70% on average</p>
            </div>
          </div>
        </section>

        {/* Why Use It */}
        <section className="why-section">
          <h2>Why Fabric Finder?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <span className="feature-icon">🎯</span>
              <h3>Fabric-First Matching</h3>
              <p>We match based on actual material composition, not vague product descriptions</p>
            </div>

            <div className="feature-card">
              <span className="feature-icon">⚡</span>
              <h3>Fast & Accurate</h3>
              <p>Results in under 30 seconds powered by Claude AI</p>
            </div>

            <div className="feature-card">
              <span className="feature-icon">🔒</span>
              <h3>Privacy First</h3>
              <p>No email, no personal data, no tracking—just paste and analyze</p>
            </div>

            <div className="feature-card">
              <span className="feature-icon">✨</span>
              <h3>100% Free</h3>
              <p>3 free scans per month, no credit card required</p>
            </div>
          </div>
        </section>

        {/* Real Example */}
        <section className="example-section">
          <h2>Real Example</h2>
          <div className="example-card">
            <div className="example-before">
              <span className="example-label">Premium Brand</span>
              <h3>Lululemon Align Leggings</h3>
              <p className="example-fabric">81% Nylon, 19% Lycra Elastane</p>
              <p className="example-price">$128</p>
            </div>
            <div className="example-arrow">→</div>
            <div className="example-after">
              <span className="example-label success">Fabric Match</span>
              <h3>Amazon Basics Athletic Leggings</h3>
              <p className="example-fabric">80% Nylon, 20% Spandex</p>
              <p className="example-price success">$24.99</p>
              <p className="example-savings">Save $103 (80%)</p>
            </div>
          </div>
        </section>

        {/* Affiliate Disclosure */}
        <section className="disclosure-section">
          <h3>💡 How We Make Money</h3>
          <p>
            Fabric Finder is free to use. We earn a small commission when you purchase through
            Amazon affiliate links (at no extra cost to you). This helps us keep the service
            free and accurate.
          </p>
          <p className="disclosure-note">
            <strong>Important:</strong> Our recommendations are never influenced by commissions.
            We show the best fabric matches, period.
          </p>
        </section>

        {/* Contact */}
        <section className="contact-section">
          <h3>Questions or Feedback?</h3>
          <p>Email us at <a href="mailto:hello@fabricfinder.fit">hello@fabricfinder.fit</a></p>
        </section>
      </div>
    </div>
  )
}
