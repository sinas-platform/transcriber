import { Menu, Mic } from 'lucide-react'
import styles from './HomePage.module.scss'
import sinasLogo from '../icons/sinas-logo.svg'

export function HomePage() {
  return (
    <div className={`app-root ${styles.screen}`}>
      <header className={styles.topBar}>
        <button type="button" className={styles.iconButton} aria-label="Open menu">
          <Menu size={24} />
        </button>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src={sinasLogo} alt="Sinas" />
        </div>
      </header>

      <main className={styles.main}>
        <button type="button" className={styles.recordButton}>
          <Mic size={32} strokeWidth={2.2} />
          <span className={styles.recordLabel}>
            <span className={styles.recordLabelLine}>START</span>
            <span className={styles.recordLabelLine}>RECORDING</span>
          </span>
        </button>
      </main>
    </div>
  )
}
