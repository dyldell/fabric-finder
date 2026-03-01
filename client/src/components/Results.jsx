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

  // Check if product contains fabrics with alternate names
  const getFabricEducationTooltip = () => {
    if (!data.fabrics) return null

    const fabricSynonyms = {
      'Elastane': { names: ['Spandex', 'Lycra'], primary: 'Elastane' },
      'Spandex': { names: ['Elastane', 'Lycra'], primary: 'Elastane' },
      'Lycra': { names: ['Elastane', 'Spandex'], primary: 'Elastane' },
      'Lycra Elastane': { names: ['Elastane', 'Spandex'], primary: 'Elastane' },
      'Nylon': { names: ['Polyamide'], primary: 'Nylon' },
      'Polyamide': { names: ['Nylon'], primary: 'Nylon' },
      'Rayon': { names: ['Viscose'], primary: 'Rayon' },
      'Viscose': { names: ['Rayon'], primary: 'Rayon' }
    }

    const foundSynonyms = data.fabrics
      .map(f => fabricSynonyms[f.type])
      .filter(Boolean)

    if (foundSynonyms.length === 0) return null

    // Get unique synonym groups
    const uniqueGroups = [...new Set(foundSynonyms.map(s => s.primary))]

    return uniqueGroups.map(primary => {
      const info = Object.values(fabricSynonyms).find(s => s.primary === primary)
      const allNames = [primary, ...info.names].join(', ')
      return `${allNames} are the same fiber`
    }).join(' • ')
  }

  const fabricEducation = getFabricEducationTooltip()

  // Get alternatives from backend
  const alternatives = data.alternatives || []

  return (
    <div className="results-container">
      <div className="results-card">
        {/* Product Info with Image */}
        {data.product_name && (
          <div className="product-info">
            {data.product_image && (
              <div className="product-image-container">
                <img
                  src={data.product_image}
                  alt={data.product_name}
                  className="scanned-product-image"
                  loading="eager"
                />
              </div>
            )}
            <div className="product-details">
              {data.brand && <div className="product-brand">{data.brand}</div>}
              <h2 className="product-name">{data.product_name}</h2>
              {data.product_type && data.gender && (
                <div className="product-category">
                  {data.gender}'s {data.product_type}
                </div>
              )}
              {data.price && <div className="product-price">{data.price}</div>}
            </div>
          </div>
        )}

        <div className="results-divider" />

        {/* Trust Signal: Analysis Confidence */}
        {data.fabrics && data.fabrics.length > 0 && (
          <div className="confidence-badge">
            <span className="confidence-icon">✓</span>
            <span className="confidence-text">
              {data.fabrics.length} {data.fabrics.length === 1 ? 'Fabric' : 'Fabrics'} Identified
            </span>
          </div>
        )}

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

            {/* Fabric Education Tooltip - only shown when relevant */}
            {fabricEducation && (
              <div className="fabric-education-tip">
                <span className="tip-icon">💡</span>
                <span className="tip-text">Did you know? {fabricEducation}</span>
              </div>
            )}
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
      {data.fabrics && data.fabrics.length > 0 && alternatives.length > 0 && (
        <div className="cheaper-section">
          <div className="section-label">FIND IT CHEAPER 💰</div>
          <h3 className="cheaper-heading">Similar fabrics, better prices</h3>
          <p className="cheaper-description">
            Real products with {data.fabrics[0]?.type || 'similar'} fabric composition.
            {data.brand && ` Alternatives to ${data.brand}.`}
          </p>

          <div className="product-grid">
            {alternatives.map((product, index) => (
              <a
                key={index}
                href={product.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="product-card"
              >
                {product.image && (
                  <div className="product-image-wrapper">
                    <img
                      src={product.image}
                      alt={product.title}
                      className="product-image"
                      loading="lazy"
                    />
                  </div>
                )}

                <div className="product-info-box">
                  {product.matchPercentage && (
                    <div className={`match-badge match-${Math.floor(product.matchPercentage / 10) * 10}`}>
                      {product.matchPercentage}% Match
                    </div>
                  )}

                  <div className="product-title">{product.title}</div>

                  <div className="product-meta">
                    {product.price && (
                      <div className="product-price">{product.price}</div>
                    )}

                    {product.rating && (
                      <div className="product-rating">
                        ⭐ {product.rating} {product.reviews ? `(${product.reviews})` : ''}
                      </div>
                    )}
                  </div>

                  {product.source && (
                    <div className="product-source">
                      via {product.source}
                    </div>
                  )}

                  {product.estimatedSavings && (
                    <div className="savings-badge">Save {product.estimatedSavings}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Results
