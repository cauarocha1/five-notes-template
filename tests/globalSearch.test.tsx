import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GlobalSearch } from '../src/components/GlobalSearch'
import type { Board, Note } from '../src/lib/types'

const note: Note & { folderLabel: string } = {
  id: 'note-1', folderId: 'folder-1', title: 'Anotações de aula', body: 'Resumo', revision: 0,
  updatedAt: '2026-10-20T10:00:00.000Z', deletedAt: null, folderLabel: 'Estudos / Curso',
}
const board: Board & { folderLabel: string } = {
  id: 'board-1', folderId: 'folder-1', title: 'Mapa da aula', sceneJson: '{}', revision: 0,
  updatedAt: '2026-10-20T11:00:00.000Z', deletedAt: null, folderLabel: 'Estudos / Curso',
}

describe('busca global', () => {
  afterEach(cleanup)

  it('abre numa tela própria e só navega depois que a pessoa escolhe um resultado', () => {
    const onOpen = vi.fn()
    render(<GlobalSearch query="" items={[note, board]} recent={[note, board]} onSearch={vi.fn()} onOpen={onOpen} />)

    expect(screen.getByRole('heading', { name: 'Buscar em todo o espaço' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Buscar em todas as notas e quadros' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Itens recentes' })).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Abrir nota: Anotações de aula' })).toHaveTextContent('Estudos / Curso')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir quadro: Mapa da aula' }))
    expect(onOpen).toHaveBeenCalledWith(board)
  })

  it('lista resultados para o termo digitado e mostra o estado vazio', () => {
    const onSearch = vi.fn()
    const view = render(<GlobalSearch query="xyz" items={[]} recent={[note]} onSearch={onSearch} onOpen={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Resultados da busca' })).toBeInTheDocument()
    expect(screen.getByText('Nenhuma nota ou quadro corresponde à busca.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar em todas as notas e quadros' }), { target: { value: 'aula' } })
    expect(onSearch).toHaveBeenCalledWith('aula')
    view.rerender(<GlobalSearch query="aula" items={[note]} recent={[note]} onSearch={onSearch} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Abrir nota: Anotações de aula' })).toBeInTheDocument()
  })
})
