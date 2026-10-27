import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeScreen } from '../src/components/HomeScreen'
import type { Board, Note } from '../src/lib/types'

const note: Note = {
  id: 'note-1', folderId: 'folder-1', title: 'Resumo da aula', body: '', revision: 0,
  updatedAt: '2026-10-03T12:00:00.000Z', deletedAt: null,
}

const board: Board = {
  id: 'board-1', folderId: 'folder-1', title: 'Arquitetura', sceneJson: '{}', revision: 0,
  updatedAt: '2026-10-03T13:00:00.000Z', deletedAt: null,
}

describe('tela inicial', () => {
  afterEach(cleanup)

  it('mostra itens recentes de notas e quadros com o contexto da pasta', () => {
    render(<HomeScreen notes={[note]} boards={[board]} folders={[{ id: 'folder-1', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: note.updatedAt, deletedAt: null }]} onCreateNote={vi.fn()} onCreateBoard={vi.fn()} onSearch={vi.fn()} onOpenItem={vi.fn()} onOpenMap={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Início' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir quadro: Arquitetura' })).toHaveTextContent('Estudos')
    expect(screen.getByRole('button', { name: 'Abrir nota: Resumo da aula' })).toHaveTextContent('Estudos')
  })

  it('não mostra voltar e expõe as ações principais', () => {
    const onCreateNote = vi.fn()
    const onCreateBoard = vi.fn()
    const onSearch = vi.fn()
    const onOpenMap = vi.fn()
    render(<HomeScreen notes={[]} boards={[]} folders={[]} onCreateNote={onCreateNote} onCreateBoard={onCreateBoard} onSearch={onSearch} onOpenItem={vi.fn()} onOpenMap={onOpenMap} />)

    expect(screen.queryByRole('button', { name: 'Voltar ao espaço anterior' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Nova nota/ }))
    fireEvent.click(screen.getByRole('button', { name: /Novo quadro/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar notas/ }))
    fireEvent.click(screen.getByRole('button', { name: /Mapa do conhecimento/ }))

    expect(onCreateNote).toHaveBeenCalledOnce()
    expect(onCreateBoard).toHaveBeenCalledOnce()
    expect(onSearch).toHaveBeenCalledOnce()
    expect(onOpenMap).toHaveBeenCalledOnce()
    expect(screen.getByText('Suas notas e quadros aparecerão aqui.')).toBeInTheDocument()
  })
})
