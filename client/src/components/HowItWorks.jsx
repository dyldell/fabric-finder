import { motion } from 'framer-motion'
import './HowItWorks.css'

const HowItWorks = () => {
  const steps = [
    {
      number: "1",
      title: "Paste a Product Link",
      description: "Copy the URL of any clothing item from your favorite premium brand — Vuori, Lululemon, Skims, or anywhere else."
    },
    {
      number: "2",
      title: "We Analyze the Fabric",
      description: "Our AI reads the exact fabric composition — the same percentages of cotton, polyester, elastane, and more."
    },
    {
      number: "3",
      title: "Get Cheaper Matches",
      description: "We find items with the exact same fabric blend at a fraction of the price. Same quality, smarter spending."
    }
  ]

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15
      }
    }
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 100, damping: 20 }
    }
  }

  return (
    <section className="how-it-works">
      <motion.div
        className="how-it-works-header"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        <h2>How Fabric Finder Works</h2>
        <p className="subtitle">We don't find alternatives — we find the exact same fabrics for less money.</p>
      </motion.div>

      <motion.div
        className="steps-grid"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
      >
        {steps.map((step) => (
          <motion.div
            key={step.number}
            className="step-card"
            variants={itemVariants}
          >
            <div className="step-number">{step.number}</div>
            <div className="step-content">
              <h3 className="step-title">{step.title}</h3>
              <p className="step-description">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}

export default HowItWorks
