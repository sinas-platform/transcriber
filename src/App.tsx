import styles from './App.module.scss'

function App() {
  return (
    <div className={`app-root ${styles.app}`}>
      <header className={styles.appHeader}>
        <p className={styles.appEyebrow}>Transcriber</p>
        <h1 className={styles.appTitle}>Main layout</h1>
        <p className={styles.appSubtitle}>
          Mobile-first scaffold is ready for feature implementation.
        </p>
      </header>

      <main className={styles.appMain}>
        <section className={styles.appCard}>
          <h2>Recorder area</h2>
          <p>Primary transcription controls will live here.</p>
        </section>

        <section className={styles.appCard}>
          <h2>Transcript area</h2>
          <p>Transcript stream and actions will be rendered here.</p>
        </section>
      </main>

      <footer className={styles.appFooter}>
        <small>Footer placeholder</small>
      </footer>
    </div>
  )
}

export default App
