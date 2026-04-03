import type { ReactNode } from 'react'
import styles from './AuthCard.module.scss'
import sinasLogo from '../../../icons/sinas-logo.svg'
import sinasLogoWhite from '../../../icons/sinas-logo-white.svg'

interface AuthCardProps {
  title?: string
  children: ReactNode
  subtitle?: string
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className={`app-root ${styles.page}`}>
      <main className={styles.card}>
        <header className={styles.header}>
          <img className={`${styles.logo} ${styles.logoLight}`} src={sinasLogo} alt="Sinas" />
          <img className={`${styles.logo} ${styles.logoDark}`} src={sinasLogoWhite} alt="Sinas" />
        </header>

        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subTitle}>{subtitle}</p> : null}
        {children}
      </main>
    </div>
  )
}
