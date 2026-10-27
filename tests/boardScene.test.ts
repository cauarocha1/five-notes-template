import { describe, expect, it } from 'vitest'
import { sceneWithCurrentNoteTitles } from '../src/lib/boardScene'
import type { Note } from '../src/lib/types'

const note: Note = {
  id: 'note/1', folderId: null, title: 'Aula atualizada', body: '', revision: 0,
  updatedAt: '2026-10-20T10:00:00.000Z', deletedAt: null,
}

describe('cartões de nota nos quadros', () => {
  it('atualiza o rótulo visível usando o título atual sem alterar outras partes da cena', () => {
    const scene = {
      type: 'excalidraw',
      elements: [
        { id: 'card', type: 'rectangle', link: 'https://five-note.invalid/note/note%2F1' },
        { id: 'label', type: 'text', containerId: 'card', text: '📝  Título antigo' },
        { id: 'other', type: 'text', text: 'Texto livre' },
      ],
      appState: { viewBackgroundColor: '#111111' },
    }
    const result = JSON.parse(sceneWithCurrentNoteTitles(JSON.stringify(scene), [note]))
    expect(result.elements[1].text).toBe('📝  Aula atualizada')
    expect(result.elements[2].text).toBe('Texto livre')
    expect(result.appState).toEqual(scene.appState)
  })

  it('mantém a cena original para links sem nota correspondente', () => {
    const sceneJson = JSON.stringify({ elements: [{ id: 'card', type: 'rectangle', link: 'https://five-note.invalid/note/missing' }] })
    expect(sceneWithCurrentNoteTitles(sceneJson, [])).toBe(sceneJson)
  })
})
