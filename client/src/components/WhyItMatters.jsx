import { motion } from 'framer-motion'
import './WhyItMatters.css'

const WhyItMatters = () => {
  return (
    <motion.section
      className="why-it-matters"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
    >
      <div className="why-container">
        <h2>Why Fabric Composition Matters</h2>

        <div className="why-content">
          <motion.div
            className="why-point"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1, type: "spring", stiffness: 100, damping: 20 }}
          >
            <div className="point-icon">✓</div>
            <p>
              The secret behind premium clothing isn't the logo — it's the fabric.
              A $98 Vuori shirt and a $28 Amazon shirt can use the exact same blend of fabrics.
            </p>
          </motion.div>

          <motion.div
            className="why-point"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, type: "spring", stiffness: 100, damping: 20 }}
          >
            <div className="point-icon">✓</div>
            <p>
              When two garments share the same fabric percentages (e.g., 60% Cotton, 35% Polyester, 5% Elastane),
              they feel, breathe, and stretch the same way.
            </p>
          </motion.div>

          <motion.div
            className="why-point"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, type: "spring", stiffness: 100, damping: 20 }}
          >
            <div className="point-icon">✓</div>
            <p>
              Fabric Finder helps you skip the markup and keep the quality.
            </p>
          </motion.div>
        </div>
      </div>
    </motion.section>
  )
}

export default WhyItMatters
