export type RecordingSourceRoute = '/' | '/recordings'

export type RecordingSourceState = {
  from?: RecordingSourceRoute
}

export function readRecordingSource(state: unknown): RecordingSourceRoute | null {
  if (!state || typeof state !== 'object') return null

  const from = (state as RecordingSourceState).from
  if (from === '/' || from === '/recordings') return from

  return null
}

export function buildRecordingSourceState(source: RecordingSourceRoute): RecordingSourceState
export function buildRecordingSourceState(
  source: RecordingSourceRoute | null | undefined,
): RecordingSourceState | undefined
export function buildRecordingSourceState(
  source: RecordingSourceRoute | null | undefined,
): RecordingSourceState | undefined {
  if (!source) return undefined
  return { from: source }
}
