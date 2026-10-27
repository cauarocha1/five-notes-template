import type { Board } from './types'

export const MAX_BOARD_JSON_BYTES = 750_000
export const BOARD_WARNING_BYTES = 650_000
export const EMPTY_BOARD_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'five',
  elements: [],
  appState: { theme: 'dark', viewBackgroundColor: '#ffffff' },
  files: {},
})

let loadedExcalidraw: Promise<typeof import('@excalidraw/excalidraw')> | undefined
const previewUrls = new Map<string, string>()

/** Render a local thumbnail with Excalidraw's SVG exporter; no preview data is persisted. */
export async function boardPreviewUrl(sceneJson: string, title = 'Quadro') {
  const cacheKey = `${sceneJson}\u0000${title}`
  const cached = previewUrls.get(cacheKey)
  if (cached) return cached
  loadedExcalidraw ??= import('@excalidraw/excalidraw')
  const { exportToSvg } = await loadedExcalidraw
  const scene = JSON.parse(sceneJson) as { elements?: never[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }
  if (!scene.elements?.length) {
    const text = escapeXml(title.trim() || 'Quadro sem título')
    const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 180"><rect x="1" y="1" width="718" height="178" rx="12" fill="#171719" stroke="#3b3b40"/><text x="28" y="70" fill="#ededf0" font-family="Segoe UI, sans-serif" font-size="22" font-weight="600">${text}</text><text x="28" y="112" fill="#9999a2" font-family="Segoe UI, sans-serif" font-size="14">Quadro vazio · toque para abrir</text></svg>`
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(placeholder)}`
    cachePreview(cacheKey, url)
    return url
  }
  const svg = await exportToSvg({
    elements: (scene.elements ?? []) as never[],
    appState: { ...(scene.appState ?? {}), exportWithDarkMode: true },
    files: (scene.files ?? {}) as never,
    exportPadding: 12,
  })
  const source = new XMLSerializer().serializeToString(svg)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  cachePreview(cacheKey, url)
  return url
}

export function boardPreviewProxy(boardById: () => Map<string, Board>) {
  return async (url: string) => {
    if (!url.startsWith('https://five-note.invalid/board/')) return url
    let id = url.slice('https://five-note.invalid/board/'.length)
    try { id = decodeURIComponent(id) } catch { /* Use the original ID. */ }
    const board = boardById().get(id)
    if (!board) return ''
    try { return await boardPreviewUrl(board.sceneJson, board.title) } catch (error) {
      console.error('five could not render a board preview', error)
      return ''
    }
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character)
}

function cachePreview(key: string, value: string) {
  previewUrls.set(key, value)
  if (previewUrls.size > 24) previewUrls.delete(previewUrls.keys().next().value as string)
}

export function downloadBoard(board: Board) {
  const blob = new Blob([board.sceneJson], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${safeFileName(board.title || 'quadro')}.excalidraw`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000)
}

function safeFileName(value: string) {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().replace(/\s+/g, '-') || 'quadro'
}
