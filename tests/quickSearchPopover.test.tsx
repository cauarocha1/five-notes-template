import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickSearchPopover } from '../src/components/QuickSearchPopover'
import type { Board, Note } from '../src/lib/types'

const note: Note & { folderLabel: string } = {
  id: 'note-1', folderId: 'folder-1', title: 'Anotações de aula', body: 'Resumo de biologia', revision: 0,
  updatedAt: '2026-10-20T10:00:00.000Z', deletedAt: null, folderLabel: 'Estudos / Curso',
}
const board: Board & { folderLabel: string } = {
  id: 'board-1', folderId: 'folder-1', title: 'Mapa da aula', sceneJson: '{}', revision: 0,
  updatedAt: '2026-10-20T11:00:00.000Z', deletedAt: null, folderLabel: 'Estudos / Curso',
}

describe('busca rápida do cabeçalho', () => {
  afterEach(cleanup)

  it('não mostra um popover redundante antes de digitar', () => {
    const view = render(<QuickSearchPopover query="" items={[]} onOpen={vi.fn()} />)

    expect(view.container).toBeEmptyDOMElement()
  })

  it('mostra resultados de notas e quadros e abre somente o resultado escolhido', () => {
    const onOpen = vi.fn()
    render(<QuickSearchPopover query="aula" items={[note, board]} onOpen={onOpen} />)

    expect(screen.getByRole('region', { name: 'Resultados da busca rápida' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir nota: Anotações de aula' })).toHaveTextContent('Estudos / Curso')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir quadro: Mapa da aula' }))
    expect(onOpen).toHaveBeenCalledWith(board)
  })
})
