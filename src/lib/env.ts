type EnvKey = 'VITE_API_BASE_URL' | 'VITE_X_API_KEY'

declare global {
  interface Window {
    __ENV__?: Partial<Record<EnvKey, string>>
  }
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || /^__.*__$/.test(value)
}

export function env(key: EnvKey): string | undefined {
  const runtime = window.__ENV__?.[key]
  if (runtime && !isPlaceholder(runtime)) return runtime

  const buildTime = (import.meta.env[key] as string | undefined)?.trim()
  return buildTime || undefined
}
