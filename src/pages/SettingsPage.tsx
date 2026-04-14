import { ArrowLeft, Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranscriberTheme } from '../lib/use-transcriber-theme'
import styles from './SettingsPage.module.scss'

type ThemeOption = {
  value: 'light' | 'dark'
  label: string
  description: string
  Icon: typeof Sun
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright interface for daytime use.',
    Icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Low-glare interface for darker spaces.',
    Icon: Moon,
  },
]

function joinClasses(...classNames: Array<string | undefined | false>): string {
  return classNames.filter(Boolean).join(' ')
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { theme, setTheme, isSavingTheme, themeErrorMessage, clearThemeError } = useTranscriberTheme()

  return (
    <div className={`app-root ${styles.screen}`}>
      <main className={styles.main}>
        <header className={styles.header}>
          <button
            type='button'
            className={styles.backButton}
            onClick={() => {
              void navigate(-1)
            }}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>Manage how Transcriber looks and feels.</p>
        </header>

        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Appearance</h2>
            <p className={styles.sectionSubtitle}>Choose your theme.</p>
          </div>

          <div className={styles.themeOptions} role='radiogroup' aria-label='Theme'>
            {THEME_OPTIONS.map((option) => {
              const Icon = option.Icon
              const isActive = theme === option.value

              return (
                <label
                  key={option.value}
                  className={joinClasses(styles.themeOption, isActive && styles.themeOptionActive)}
                >
                  <input
                    className={styles.themeOptionInput}
                    type='radio'
                    name='theme'
                    value={option.value}
                    checked={isActive}
                    onChange={() => {
                      clearThemeError()
                      void setTheme(option.value)
                    }}
                    disabled={isSavingTheme}
                  />

                  <span className={styles.themeOptionBody}>
                    <span className={styles.themeIconWrap}>
                      <Icon size={16} />
                    </span>
                    <span className={styles.themeText}>
                      <span className={styles.themeLabel}>{option.label}</span>
                      <span className={styles.themeDescription}>{option.description}</span>
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          {isSavingTheme ? <p className={styles.statusText}>Saving preference...</p> : null}
          {themeErrorMessage ? <p className={styles.errorText}>{themeErrorMessage}</p> : null}
        </section>
      </main>
    </div>
  )
}
