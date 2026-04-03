import { useAuth } from '../features/auth/use-auth'
import styles from './HomePage.module.scss'

export function HomePage() {
  const { session, logout } = useAuth()

  return (
    <div className={`app-root ${styles.app}`}>
      <header className={styles.appHeader}>
        <p className={styles.appEyebrow}>Transcriber</p>
        <h1 className={styles.appTitle}>Main layout</h1>
        <p className={styles.appSubtitle}>Signed in as {session?.user.email}</p>
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
        <button type="button" className={styles.logoutButton} onClick={logout}>
          Logout
        </button>
      </footer>
    </div>
  )
}
