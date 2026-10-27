import { INTERNAL_NOTE_HREF_PREFIX } from './links'
import type { Note } from './types'

interface SceneElement {
  id?: string
  type?: string
  link?: string | null
  text?: string
  containerId?: string | null
  [key: string]: unknown
}

/** Refresh note-card labels for display without persisting a board write. */
export function sceneWithCurrentNoteTitles(sceneJson: string, notes: Note[]) {
  try {
    const scene = JSON.parse(sceneJson) as { elements?: SceneElement[]; [key: string]: unknown }
    const elements = scene.elements
    if (!Array.isArray(elements)) return sceneJson
    const noteById = new Map(notes.map((note) => [note.id, note]))
    const cards = new Map<string, string>()
    for (const element of elements) {
      if (element.type !== 'rectangle' || !element.id || !element.link?.startsWith(INTERNAL_NOTE_HREF_PREFIX)) continue
      let id = element.link.slice(INTERNAL_NOTE_HREF_PREFIX.length)
      try { id = decodeURIComponent(id) } catch { /* Use the stored ID when an old link is malformed. */ }
      const note = noteById.get(id)
      if (note) cards.set(element.id, `📝  ${note.title.trim() || 'Sem título'}`)
    }
    if (!cards.size) return sceneJson
    let changed = false
    const next = elements.map((element) => {
      const title = element.containerId ? cards.get(element.containerId) : undefined
      if (element.type !== 'text' || !title || element.text === title) return element
      changed = true
      return { ...element, text: title }
    })
    return changed ? JSON.stringify({ ...scene, elements: next }) : sceneJson
  } catch {
    return sceneJson
  }
}
