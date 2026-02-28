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

  // Use alternatives from backend if available, otherwise fallback to local generation
  const getAlternatives = () => {
    if (data.alternatives && data.alternatives.length > 0) {
      return data.alternatives
    }

    // Fallback: generate basic alternatives if backend doesn't provide them
    const fabrics = data.fabrics || []
    const fabricQuery = fabrics.map(f => `${f.percentage}% ${f.type}`).join(' ')

    return [
      {
        category: 'Exact Fabric Match',
        description: `Athletic wear with ${fabricQuery}`,
        url: `https://www.amazon.com/s?k=${encodeURIComponent(`athletic wear ${fabricQuery}`)}&tag=fabricfinder-20`,
        estimatedSavings: '40-60%'
      }
    ]
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

            {/* Stacked Bar Chart */}
            <div className="fabric-bar-stacked">
              {data.fabrics.map((fabric, index) => (
                <div
                  key={index}
                  className={`fabric-segment fabric-segment-${index} ${animatedFabrics.includes(index) ? 'animate' : ''}`}
                  style={{
                    '--target-width': `${fabric.percentage}%`,
                    '--fabric-color': `var(--fabric-color-${index})`
                  }}
                />
              ))}
            </div>

            {/* Fabric Legend */}
            <div className="fabric-legend">
              {data.fabrics.map((fabric, index) => (
                <div key={index} className="fabric-legend-item">
                  <span
                    className="fabric-dot"
                    style={{ backgroundColor: `var(--fabric-color-${index})` }}
                  />
                  <span className="fabric-legend-text">
                    <strong>{fabric.percentage}%</strong> {fabric.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Features */}
        {data.features && data.features.length > 0 && (
          <div className="features-section">
            <div className="features-box">
              <span className="features-icon">ⓘ</span>
              <span className="features-text">
                Features {data.features.join(', ')}
              </span>
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
            {data.brand && ` Find alternatives to ${data.brand}.`}
          </p>

          <div className="amazon-links">
            {getAlternatives().map((alt, index) => (
              <a
                key={index}
                href={alt.url}
                target="_blank"
                rel="noopener noreferrer"
                className="amazon-link"
              >
                <div className="amazon-link-header">
                  <span className="amazon-arrow">→</span>
                  <span className="amazon-category">{alt.category}</span>
                  {alt.estimatedSavings && (
                    <span className="savings-badge">Save {alt.estimatedSavings}</span>
                  )}
                </div>
                <span className="amazon-description">{alt.description}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Results
