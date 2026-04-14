import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../features/auth/use-auth'
import {
  PREFERENCES_PERMISSION_ERROR,
  createPreferenceState,
  filterPreferenceStatesForUser,
  getPreferenceErrorMessage,
  isPreferenceAlreadyExistsError,
  isPreferenceNotFoundError,
  isPreferencePermissionError,
  listPreferenceStates,
  updatePreferenceState,
} from './preference-states'
import {
  TranscriberThemeContext,
  type TranscriberThemeContextValue,
  type TranscriberThemeMode,
} from './use-transcriber-theme'
import { getWorkspaceUrl } from './workspace'

const TRANSCRIBER_THEME_STORAGE_KEY = 'transcriber.theme'
const TRANSCRIBER_THEME_PREFERENCE_KEY = 'transcriber_theme'
const TRANSCRIBER_THEME_PREFERENCE_VISIBILITY = 'private'
const TRANSCRIBER_THEME_PREFERENCE_DESCRIPTION = 'Transcriber user theme preference'
const TRANSCRIBER_THEME_PREFERENCE_TAGS = ['user', 'preferences', 'theme', 'transcriber'] as const
const TRANSCRIBER_THEME_PREFERENCE_RELEVANCE_SCORE = 1.0
const DEFAULT_THEME: TranscriberThemeMode = 'light'

function applyTheme(theme: TranscriberThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

function readStoredTheme(): TranscriberThemeMode | null {
  if (typeof window === 'undefined') return null

  try {
    const value = window.localStorage.getItem(TRANSCRIBER_THEME_STORAGE_KEY)?.trim()
    if (value === 'dark') return 'dark'
    if (value === 'light') return 'light'
  } catch {
    // Ignore storage read failures.
  }

  return null
}

function writeStoredTheme(theme: TranscriberThemeMode): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(TRANSCRIBER_THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore storage write failures.
  }
}

function getInitialTheme(): TranscriberThemeMode {
  const storedTheme = readStoredTheme() ?? DEFAULT_THEME
  applyTheme(storedTheme)
  return storedTheme
}

type ThemePreferenceValue = {
  version: 1
  theme: TranscriberThemeMode
}

function normalizeThemePreferenceValue(value: unknown): ThemePreferenceValue {
  if (!value || typeof value !== 'object') {
    return {
      version: 1,
      theme: DEFAULT_THEME,
    }
  }

  const record = value as Record<string, unknown>
  const normalizedTheme = record.theme === 'dark' || record.mode === 'dark' ? 'dark' : 'light'

  return {
    version: 1,
    theme: normalizedTheme,
  }
}

export function TranscriberThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const workspaceUrl = getWorkspaceUrl()
  const currentUserId = session?.user.id ?? null
  const canUsePreferencesState = Boolean(workspaceUrl && session?.accessToken && currentUserId)

  const [theme, setThemeState] = useState<TranscriberThemeMode>(getInitialTheme)
  const [hasStoredPreference, setHasStoredPreference] = useState(false)
  const [isSavingTheme, setIsSavingTheme] = useState(false)
  const [themeReadErrorMessage, setThemeReadErrorMessage] = useState<string | null>(null)
  const [themeWriteErrorMessage, setThemeWriteErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    applyTheme(theme)
    writeStoredTheme(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false

    if (!canUsePreferencesState || !currentUserId) {
      return () => {
        cancelled = true
      }
    }

    const loadThemePreference = async (): Promise<void> => {
      setThemeReadErrorMessage(null)

      try {
        const states = await listPreferenceStates<ThemePreferenceValue>()
        if (cancelled) return

        const userStates = filterPreferenceStatesForUser(states, currentUserId)
        const themeState = userStates.find((state) => state.key === TRANSCRIBER_THEME_PREFERENCE_KEY)

        if (!themeState) {
          setHasStoredPreference(false)
          return
        }

        setHasStoredPreference(true)
        const normalizedPreference = normalizeThemePreferenceValue(themeState.value)
        setThemeState(normalizedPreference.theme)
      } catch (error) {
        if (cancelled) return

        setHasStoredPreference(false)
        if (isPreferencePermissionError(error)) {
          setThemeReadErrorMessage(PREFERENCES_PERMISSION_ERROR)
          return
        }

        setThemeReadErrorMessage(
          getPreferenceErrorMessage(error, 'Could not load transcriber theme preference.'),
        )
      }
    }

    void loadThemePreference()

    return () => {
      cancelled = true
    }
  }, [canUsePreferencesState, currentUserId, workspaceUrl])

  const value = useMemo<TranscriberThemeContextValue>(() => {
    const persistThemePreference = async (nextTheme: TranscriberThemeMode): Promise<void> => {
      if (!canUsePreferencesState) return

      const payload = {
        value: {
          version: 1,
          theme: nextTheme,
        },
        visibility: TRANSCRIBER_THEME_PREFERENCE_VISIBILITY,
        description: TRANSCRIBER_THEME_PREFERENCE_DESCRIPTION,
        tags: [...TRANSCRIBER_THEME_PREFERENCE_TAGS],
        relevance_score: TRANSCRIBER_THEME_PREFERENCE_RELEVANCE_SCORE,
        expires_at: null,
      } satisfies {
        value: ThemePreferenceValue
        visibility: string
        description: string
        tags: string[]
        relevance_score: number
        expires_at: null
      }

      setIsSavingTheme(true)

      try {
        if (hasStoredPreference) {
          try {
            await updatePreferenceState(TRANSCRIBER_THEME_PREFERENCE_KEY, payload)
          } catch (error) {
            if (!isPreferenceNotFoundError(error)) {
              throw error
            }

            await createPreferenceState({
              key: TRANSCRIBER_THEME_PREFERENCE_KEY,
              ...payload,
            })
          }
        } else {
          try {
            await createPreferenceState({
              key: TRANSCRIBER_THEME_PREFERENCE_KEY,
              ...payload,
            })
          } catch (error) {
            if (!isPreferenceAlreadyExistsError(error, TRANSCRIBER_THEME_PREFERENCE_KEY)) {
              throw error
            }

            await updatePreferenceState(TRANSCRIBER_THEME_PREFERENCE_KEY, payload)
          }
        }

        setHasStoredPreference(true)
      } finally {
        setIsSavingTheme(false)
      }
    }

    const setTheme = async (nextTheme: TranscriberThemeMode): Promise<void> => {
      setThemeWriteErrorMessage(null)
      setThemeState(nextTheme)
      writeStoredTheme(nextTheme)

      if (!canUsePreferencesState) return

      try {
        await persistThemePreference(nextTheme)
      } catch (error) {
        if (isPreferencePermissionError(error)) {
          setThemeWriteErrorMessage(PREFERENCES_PERMISSION_ERROR)
          return
        }

        setThemeWriteErrorMessage(
          getPreferenceErrorMessage(error, 'Could not save transcriber theme preference.'),
        )
      }
    }

    const toggleTheme = async (): Promise<void> => {
      const nextTheme = theme === 'light' ? 'dark' : 'light'
      await setTheme(nextTheme)
    }

    return {
      theme,
      setTheme,
      toggleTheme,
      isSavingTheme,
      themeErrorMessage: themeWriteErrorMessage ?? themeReadErrorMessage,
      clearThemeError: () => {
        setThemeReadErrorMessage(null)
        setThemeWriteErrorMessage(null)
      },
    }
  }, [
    canUsePreferencesState,
    hasStoredPreference,
    isSavingTheme,
    theme,
    themeReadErrorMessage,
    themeWriteErrorMessage,
  ])

  return <TranscriberThemeContext.Provider value={value}>{children}</TranscriberThemeContext.Provider>
}
