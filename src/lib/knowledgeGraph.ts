import { parseBoardLinks, parseNoteLinks } from './links'
import type { Board, Folder, Note } from './types'

export type KnowledgeItem = Note | Board

export interface KnowledgeEdge {
  sourceId: string
  targetId: string
}

export interface KnowledgePosition {
  id: string
  x: number
  y: number
}

export interface KnowledgeLayout {
  width: number
  height: number
  positions: KnowledgePosition[]
}

export const KNOWLEDGE_NODE_WIDTH = 244
export const KNOWLEDGE_NODE_HEIGHT = 102

export function knowledgeFolderPath(folderId: string | null, folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parts: string[] = []
  const visited = new Set<string>()
  let current = folderId ? byId.get(folderId) : undefined
  while (current && !visited.has(current.id) && parts.length < 32) {
    visited.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return parts.join(' / ') || 'Sem pasta'
}

export function buildKnowledgeEdges(notes: Note[], boards: Board[] = []): KnowledgeEdge[] {
  const availableIds = new Set([...notes, ...boards].filter((item) => !item.deletedAt).map((item) => item.id))
  const unique = new Set<string>()
  const edges: KnowledgeEdge[] = []

  for (const note of notes) {
    if (note.deletedAt) continue
    for (const link of parseNoteLinks(note.body)) {
      if (link.targetId === note.id || !availableIds.has(link.targetId)) continue
      const key = [note.id, link.targetId].sort().join('\u0000')
      if (unique.has(key)) continue
      unique.add(key)
      edges.push({ sourceId: note.id, targetId: link.targetId })
    }
    for (const link of parseBoardLinks(note.body)) {
      if (!availableIds.has(link.targetId)) continue
      const key = [note.id, link.targetId].sort().join('\u0000')
      if (unique.has(key)) continue
      unique.add(key)
      edges.push({ sourceId: note.id, targetId: link.targetId })
    }
  }

  return edges
}

export function layoutKnowledgeGraph(notes: KnowledgeItem[], edges: KnowledgeEdge[], viewportWidth: number, viewportHeight: number): KnowledgeLayout {
  const ordered = notes.filter((note) => !note.deletedAt).slice().sort((a, b) => a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id))
  const preferredColumns = Math.ceil(Math.sqrt(ordered.length * 1.35))
  const columnsAvailable = Math.max(1, Math.floor((viewportWidth - 96) / 320))
  const columns = Math.max(1, Math.min(preferredColumns, columnsAvailable))
  const rows = Math.ceil(ordered.length / columns)
  const width = Math.max(360, viewportWidth, columns * 320 + 48)
  const height = Math.max(420, viewportHeight, rows * 190 + 80)
  if (!ordered.length) return { width, height, positions: [] }

  const paddingX = (width - columns * 320) / 2
  const paddingY = (height - rows * 190) / 2
  const positions = ordered.map((note, index) => ({
    id: note.id,
    x: paddingX + (index % columns) * 320 + 38,
    y: paddingY + Math.floor(index / columns) * 190 + 34,
  }))
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const initial = new Map(positions.map((position) => [position.id, { x: position.x, y: position.y }]))
  const pairs = edges.flatMap((edge) => {
    const source = positionById.get(edge.sourceId)
    const target = positionById.get(edge.targetId)
    return source && target ? [{ source, target }] : []
  })

  // A small deterministic force pass groups related notes without a graph library or random layout jitter.
  // Large note libraries keep the base grid so opening the map stays responsive.
  for (let iteration = 0; iteration < (positions.length <= 350 ? 48 : 0); iteration += 1) {
    const forces = new Map(positions.map((position) => [position.id, { x: 0, y: 0 }]))
    for (let i = 0; i < positions.length; i += 1) {
      const a = positions[i]!
      for (let j = i + 1; j < positions.length; j += 1) {
        const b = positions[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)
        if (distance < 1) { dx = 1; dy = 0; distance = 1 }
        const minimum = 286
        if (distance < minimum) {
          const push = (minimum - distance) * 0.018 / distance
          forces.get(a.id)!.x -= dx * push
          forces.get(a.id)!.y -= dy * push
          forces.get(b.id)!.x += dx * push
          forces.get(b.id)!.y += dy * push
        }
      }
    }
    for (const { source, target } of pairs) {
      let dx = target.x - source.x
      let dy = target.y - source.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const pull = (distance - 330) * 0.00065 / distance
      forces.get(source.id)!.x += dx * pull
      forces.get(source.id)!.y += dy * pull
      forces.get(target.id)!.x -= dx * pull
      forces.get(target.id)!.y -= dy * pull
    }
    for (const position of positions) {
      const force = forces.get(position.id)!
      const origin = initial.get(position.id)!
      position.x += force.x + (origin.x - position.x) * 0.012
      position.y += force.y + (origin.y - position.y) * 0.012
      position.x = Math.max(24, Math.min(width - KNOWLEDGE_NODE_WIDTH - 24, position.x))
      position.y = Math.max(24, Math.min(height - KNOWLEDGE_NODE_HEIGHT - 24, position.y))
    }
  }

  return { width, height, positions }
}
