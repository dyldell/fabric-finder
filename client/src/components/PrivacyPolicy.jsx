import './PrivacyPolicy.css'

export default function PrivacyPolicy() {
  return (
    <div className="privacy-policy-container">
      <div className="privacy-policy-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last Updated: March 2, 2026</p>

        <section>
          <h2>1. Information We Collect</h2>
          <p>
            When you use Fabric Finder, we collect the product URLs you submit for analysis.
            We also collect anonymized usage data such as the number of scans performed
            and approximate location data for analytics purposes.
          </p>
        </section>

        <section>
          <h2>2. How We Use Your Information</h2>
          <p>
            We use the information we collect to:
          </p>
          <ul>
            <li>Analyze fabric composition from product pages</li>
            <li>Find similar, more affordable alternatives</li>
            <li>Improve our service and user experience</li>
            <li>Prevent abuse and enforce rate limits</li>
          </ul>
        </section>

        <section>
          <h2>3. Cookies</h2>
          <p>
            We use cookies for essential site functionality, including:
          </p>
          <ul>
            <li>Maintaining admin sessions (httpOnly cookies)</li>
            <li>Tracking scan usage for rate limiting</li>
            <li>Storing user preferences</li>
          </ul>
          <p>
            We also use third-party cookies from Google AdSense to display relevant advertisements.
            You can control cookies through your browser settings.
          </p>
        </section>

        <section>
          <h2>4. Third-Party Services</h2>
          <p>
            Fabric Finder uses the following third-party services:
          </p>
          <ul>
            <li><strong>Google AdSense:</strong> To display advertisements on our site</li>
            <li><strong>Amazon Associates:</strong> To provide product recommendations and earn affiliate commissions</li>
            <li><strong>Firecrawl:</strong> To scrape product information from retailer websites</li>
            <li><strong>Claude API (Anthropic):</strong> To analyze fabric composition using AI</li>
            <li><strong>Supabase:</strong> To cache analysis results and improve performance</li>
          </ul>
        </section>

        <section>
          <h2>5. Affiliate Disclosure</h2>
          <p>
            Fabric Finder participates in affiliate programs, including Amazon Associates.
            We may earn a commission when you purchase through links on our site, at no extra cost to you.
            This helps us keep the service free and continuously improve our fabric analysis technology.
          </p>
        </section>

        <section>
          <h2>6. Data Retention</h2>
          <p>
            We cache analyzed product data for up to 7 days to improve performance and reduce costs.
            After 7 days, cached data may be automatically deleted. We do not store personally
            identifiable information.
          </p>
        </section>

        <section>
          <h2>7. Security</h2>
          <p>
            We implement industry-standard security measures to protect your data, including:
          </p>
          <ul>
            <li>HTTPS encryption for all data transmission</li>
            <li>Rate limiting to prevent abuse</li>
            <li>SSRF protection to block malicious URLs</li>
            <li>HttpOnly cookies to prevent XSS attacks</li>
          </ul>
        </section>

        <section>
          <h2>8. Your Rights</h2>
          <p>
            You have the right to:
          </p>
          <ul>
            <li>Request deletion of your cached data</li>
            <li>Opt-out of analytics tracking</li>
            <li>Disable cookies through your browser settings</li>
          </ul>
          <p>
            To exercise these rights, please contact us at privacy@fabricfinder.fit
          </p>
        </section>

        <section>
          <h2>9. Children's Privacy</h2>
          <p>
            Fabric Finder is not intended for users under the age of 13. We do not knowingly
            collect information from children under 13.
          </p>
        </section>

        <section>
          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify users of
            significant changes by updating the "Last Updated" date at the top of this page.
          </p>
        </section>

        <section>
          <h2>11. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us at:
          </p>
          <p>
            <strong>Email:</strong> privacy@fabricfinder.fit<br />
            <strong>Website:</strong> fabricfinder.fit
          </p>
        </section>
      </div>
    </div>
  )
}
