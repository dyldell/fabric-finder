import { useState, useEffect } from 'react'
import './Results.css'

const Results = ({ data }) => {
  const [animatedFabrics, setAnimatedFabrics] = useState([])

  useEffect(() => {
    // Animate fabric bars on mount
    if (data.fabrics) {
      data.fabrics.forEach((fabric, index) => {
        setTimeout(() => {
          setAnimatedFabrics(prev => [...prev, index])
        }, index * 100)
      })
    }
  }, [data])

  const getAmazonSearchUrl = (fabrics, productType = 'clothing') => {
    const fabricQuery = fabrics
      .map(f => `${f.percentage}% ${f.type.toLowerCase()}`)
      .join(' ')
    const searchTerm = `${productType} ${fabricQuery}`
    const affiliateTag = 'fabricfinder-20' // Replace with your actual tag
    return `https://www.amazon.com/s?k=${encodeURIComponent(searchTerm)}&tag=${affiliateTag}`
  }

  return (
    <div className="results-container">
      <div className="results-card">
        {/* Product Info */}
        {data.product_name && (
          <div className="product-info">
            {data.brand && <div className="product-brand">{data.brand}</div>}
            <h2 className="product-name">{data.product_name}</h2>
            {data.price && <div className="product-price">{data.price}</div>}
          </div>
        )}

        <div className="results-divider" />

        {/* Fabric Composition */}
        {data.fabrics && data.fabrics.length > 0 && (
          <div className="fabric-section">
            <div className="section-label">FABRIC COMPOSITION</div>

            <div className="fabric-list">
              {data.fabrics.map((fabric, index) => (
                <div key={index} className="fabric-row">
                  <div className="fabric-info">
                    <span className="fabric-name">
                      {fabric.type}
                      {fabric.quality && (
                        <span className="fabric-quality"> ({fabric.quality})</span>
                      )}
                    </span>
                    <span className="fabric-percentage">{fabric.percentage}%</span>
                  </div>
                  <div className="fabric-bar-track">
                    <div
                      className={`fabric-bar-fill ${animatedFabrics.includes(index) ? 'animate' : ''}`}
                      style={{ '--target-width': `${fabric.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quality Assessment */}
        {data.quality_tier && (
          <div className="quality-section">
            <div className="section-label">QUALITY ASSESSMENT</div>
            <div className="quality-text">{data.quality_tier}</div>
          </div>
        )}
      </div>

      {/* Find It Cheaper Section */}
      {data.fabrics && data.fabrics.length > 0 && (
        <div className="cheaper-section">
          <div className="section-label">FIND IT CHEAPER</div>
          <h3 className="cheaper-heading">Same fabrics, lower price</h3>
          <p className="cheaper-description">
            These searches are filtered by your exact fabric composition.
          </p>

          <div className="amazon-links">
            <a
              href={getAmazonSearchUrl(data.fabrics, "women's leggings")}
              target="_blank"
              rel="noopener noreferrer"
              className="amazon-link"
            >
              <span className="amazon-arrow">→ Amazon</span>
              <span className="amazon-search">
                Women's leggings {data.fabrics.map(f => `${f.percentage}% ${f.type}`).join(' ')}
              </span>
            </a>

            <a
              href={getAmazonSearchUrl(data.fabrics, "athletic wear")}
              target="_blank"
              rel="noopener noreferrer"
              className="amazon-link"
            >
              <span className="amazon-arrow">→ Amazon</span>
              <span className="amazon-search">
                Athletic wear {data.fabrics.map(f => `${f.percentage}% ${f.type}`).join(' ')}
              </span>
            </a>

            <a
              href={getAmazonSearchUrl(data.fabrics)}
              target="_blank"
              rel="noopener noreferrer"
              className="amazon-link"
            >
              <span className="amazon-arrow">→ Amazon</span>
              <span className="amazon-search">
                All products {data.fabrics.map(f => `${f.percentage}% ${f.type}`).join(' ')}
              </span>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default Results
