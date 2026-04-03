type ErrorLike = {
  message?: string
  response?: {
    data?: {
      detail?: string
    }
  }
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as ErrorLike
  return candidate.response?.data?.detail || candidate.message || fallback
}
