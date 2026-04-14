import { createContext, useContext } from 'react'

export type TranscriberThemeMode = 'light' | 'dark'

export type TranscriberThemeContextValue = {
  theme: TranscriberThemeMode
  setTheme: (nextTheme: TranscriberThemeMode) => Promise<void>
  toggleTheme: () => Promise<void>
  isSavingTheme: boolean
  themeErrorMessage: string | null
  clearThemeError: () => void
}

export const TranscriberThemeContext = createContext<TranscriberThemeContextValue | undefined>(undefined)

export function useTranscriberTheme(): TranscriberThemeContextValue {
  const context = useContext(TranscriberThemeContext)

  if (!context) {
    throw new Error('useTranscriberTheme must be used within TranscriberThemeProvider')
  }

  return context
}
