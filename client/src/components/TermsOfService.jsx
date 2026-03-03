import './LegalPage.css'

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last Updated: March 3, 2026</p>

        <section>
          <h2>1. Acceptance of Terms</h2>
          <p>By accessing and using Fabric Finder ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Service.</p>
        </section>

        <section>
          <h2>2. Description of Service</h2>
          <p>Fabric Finder is a web application that:</p>
          <ul>
            <li>Analyzes clothing product URLs to extract fabric composition</li>
            <li>Suggests alternative products with similar fabric compositions</li>
            <li>Provides affiliate links to purchase suggested products</li>
          </ul>
        </section>

        <section>
          <h2>3. User Obligations</h2>
          <p>You agree to:</p>
          <ul>
            <li>Provide valid, publicly accessible product URLs</li>
            <li>Respect our usage limits (3 scans per month for free users)</li>
            <li>Not attempt to bypass security measures or abuse the system</li>
            <li>Not use the Service for illegal or unauthorized purposes</li>
            <li>Not scrape, reverse engineer, or automate access to the Service</li>
          </ul>
        </section>

        <section>
          <h2>4. Usage Limits</h2>
          <p><strong>Free Users:</strong> 3 product scans per calendar month</p>
          <p><strong>Admin Users:</strong> Unlimited scans (by invitation only)</p>
          <p>We reserve the right to modify limits at any time. Attempts to bypass limits may result in permanent ban.</p>
        </section>

        <section>
          <h2>5. Accuracy Disclaimer</h2>
          <p><strong>Important:</strong> Fabric compositions are extracted using AI and web scraping. While we strive for accuracy:</p>
          <ul>
            <li>Results may contain errors or inaccuracies</li>
            <li>We are not liable for incorrect fabric information</li>
            <li>Always verify fabric details on the original product page before purchasing</li>
            <li>Suggested alternatives may not be exact matches</li>
          </ul>
        </section>

        <section>
          <h2>6. Affiliate Disclosure</h2>
          <p>Fabric Finder participates in the Amazon Associates program. When you click affiliate links and make purchases:</p>
          <ul>
            <li>We may earn a small commission at no extra cost to you</li>
            <li>This helps us keep the Service free</li>
            <li>Commissions do not influence our recommendations</li>
          </ul>
        </section>

        <section>
          <h2>7. Intellectual Property</h2>
          <p>All content, features, and functionality of Fabric Finder are owned by Fabric Finder and protected by copyright, trademark, and other intellectual property laws.</p>
          <p>You may not:</p>
          <ul>
            <li>Copy, modify, or distribute our code or content</li>
            <li>Create derivative works</li>
            <li>Use our branding without permission</li>
          </ul>
        </section>

        <section>
          <h2>8. Service Availability</h2>
          <p>We strive for 99% uptime, but we do not guarantee:</p>
          <ul>
            <li>Uninterrupted access to the Service</li>
            <li>Error-free operation</li>
            <li>Availability of specific features</li>
          </ul>
          <p>We may modify, suspend, or discontinue the Service at any time without notice.</p>
        </section>

        <section>
          <h2>9. Limitation of Liability</h2>
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
          <ul>
            <li>Fabric Finder is provided "AS IS" without warranties of any kind</li>
            <li>We are not liable for any damages arising from your use of the Service</li>
            <li>We are not responsible for third-party websites or products</li>
            <li>Our total liability shall not exceed $100</li>
          </ul>
        </section>

        <section>
          <h2>10. Termination</h2>
          <p>We may terminate or suspend your access immediately, without notice, for:</p>
          <ul>
            <li>Violation of these Terms</li>
            <li>Abusive or fraudulent behavior</li>
            <li>Any other reason at our sole discretion</li>
          </ul>
        </section>

        <section>
          <h2>11. Governing Law</h2>
          <p>These Terms are governed by the laws of the United States. Any disputes shall be resolved in the courts of [Your State/Jurisdiction].</p>
        </section>

        <section>
          <h2>12. Changes to Terms</h2>
          <p>We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the new Terms.</p>
        </section>

        <section>
          <h2>13. Contact</h2>
          <p>Questions about these Terms? Contact us at:</p>
          <p><strong>Email:</strong> legal@fabricfinder.fit</p>
        </section>
      </div>
    </div>
  )
}
