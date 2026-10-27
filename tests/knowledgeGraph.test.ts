import { describe, expect, it } from 'vitest'
import { buildKnowledgeEdges, KNOWLEDGE_NODE_HEIGHT, KNOWLEDGE_NODE_WIDTH, knowledgeFolderPath, layoutKnowledgeGraph } from '../src/lib/knowledgeGraph'
import type { Board, Note } from '../src/lib/types'

const note = (id: string, body = '', title = id, deletedAt: string | null = null): Note => ({
  id, folderId: null, title, body, revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt,
})
const board = (id: string, title = id): Board => ({
  id, folderId: null, title, sceneJson: '{"type":"excalidraw"}', revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})

describe('mapa do conhecimento', () => {
  it('mostra o caminho completo da pasta e protege ciclos nos dados', () => {
    const folders = [
      { id: 'study', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
      { id: 'software', parentId: 'study', name: 'Software', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
    ]
    expect(knowledgeFolderPath('software', folders)).toBe('Estudos / Software')
    expect(knowledgeFolderPath(null, folders)).toBe('Sem pasta')
  })

  it('cria uma linha por relação, mesmo quando as duas notas se citam', () => {
    const a = note('a', 'Conceito: [[b|Base de dados]] e novamente [[b]]')
    const b = note('b')
    const missingTarget = note('c', '[[apagada]]')
    const deleted = note('apagada', '', 'Apagada', '2026-01-02T00:00:00.000Z')

    expect(buildKnowledgeEdges([a, b, missingTarget, deleted])).toEqual([
      { sourceId: 'a', targetId: 'b' },
    ])
  })

  it('não duplica visualmente uma relação escrita nas duas direções', () => {
    expect(buildKnowledgeEdges([
      note('a', '[[b]]'),
      note('b', '[[a]]'),
    ])).toEqual([{ sourceId: 'a', targetId: 'b' }])
  })

  it('reconhece os vínculos legíveis recém-criados pelo editor', () => {
    const source = note('a', '[Conceito B](https://five-note.invalid/note/b)')
    const target = note('b')

    expect(buildKnowledgeEdges([source, target])).toEqual([{ sourceId: 'a', targetId: 'b' }])
  })

  it('inclui quadros inseridos nas notas como nós e conexões', () => {
    const source = note('a', '![Mapa](https://five-note.invalid/board/board-1)')
    const target = board('board-1', 'Mapa')
    const edges = buildKnowledgeEdges([source], [target])
    expect(edges).toEqual([{ sourceId: 'a', targetId: 'board-1' }])
    expect(layoutKnowledgeGraph([source, target], edges, 900, 600).positions).toHaveLength(2)
  })

  it('gera posições iniciais finitas e estáveis dentro do espaço de organização', () => {
    const notes = [note('b', '', 'Beta'), note('a', '', 'Alfa'), note('c', '', 'Gama')]
    const edges = [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'b', targetId: 'c' }]
    const first = layoutKnowledgeGraph(notes, edges, 1000, 700)
    const second = layoutKnowledgeGraph(notes, edges, 1000, 700)

    expect(first).toEqual(second)
    expect(first.positions.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
    for (const position of first.positions) {
      expect(Number.isFinite(position.x)).toBe(true)
      expect(Number.isFinite(position.y)).toBe(true)
      expect(position.x).toBeGreaterThanOrEqual(24)
      expect(position.y).toBeGreaterThanOrEqual(24)
      expect(position.x + KNOWLEDGE_NODE_WIDTH).toBeLessThanOrEqual(first.width - 24)
      expect(position.y + KNOWLEDGE_NODE_HEIGHT).toBeLessThanOrEqual(first.height - 24)
    }
  })

  it('empilha as notas em uma coluna em telas estreitas', () => {
    const notes = [note('a'), note('b'), note('c')]
    const layout = layoutKnowledgeGraph(notes, [], 362, 620)

    expect(new Set(layout.positions.map(({ x }) => x)).size).toBe(1)
    expect(layout.width).toBeLessThanOrEqual(374)
  })
})
