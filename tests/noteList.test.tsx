import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { NoteList } from '../src/components/NoteList'
import type { Board, FileMove, Folder, Note } from '../src/lib/types'

const note: Note = {
  id: 'note-1', folderId: 'folder-1', title: 'Aula', body: 'Resumo da aula', revision: 0,
  updatedAt: '2026-10-03T12:00:00.000Z', deletedAt: null,
}
const secondNote: Note = { ...note, id: 'note-2', folderId: 'folder-2', title: 'Projeto' }
const board: Board = { id: 'board-1', folderId: 'folder-1', title: 'Fluxo de sistema', sceneJson: '{"elements":[]}', revision: 0, updatedAt: note.updatedAt, deletedAt: null }
const folders: Folder[] = [
  { id: 'folder-1', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: note.updatedAt, deletedAt: null },
  { id: 'folder-2', parentId: 'folder-1', name: 'Software', sortOrder: 0, revision: 0, updatedAt: note.updatedAt, deletedAt: null },
]

const renderList = (search = '', onMoveFiles = vi.fn(async () => 2)) => render(<NoteList
  folder={{ id: 'folder-1', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: note.updatedAt, deletedAt: null }}
  folders={folders}
  notes={[note]}
  boards={[]}
  selectedId={note.id}
  search={search}
  searchRef={createRef<HTMLInputElement>()}
  onSearch={vi.fn()}
  onSelect={vi.fn()}
  onNew={vi.fn()}
  onNewBoard={vi.fn()}
  onMoveFiles={onMoveFiles}
/>)

describe('lista de arquivos', () => {
  afterEach(cleanup)

  it('explica que a busca percorre todo o espaço e mantém a lista semântica', () => {
    renderList('')
    expect(screen.getByRole('textbox', { name: 'Buscar em todo o espaço' })).toHaveAttribute('placeholder', 'Buscar em todo o espaço')
    expect(screen.getByRole('listitem')).toContainElement(screen.getByRole('button', { name: /Resumo da aula/ }))
  })

  it('fecha o menu de criação com Escape e devolve o foco ao botão', () => {
    renderList()
    const trigger = screen.getByRole('button', { name: 'Criar nota ou quadro' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Nota' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Quadro' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('fecha o menu quando o usuário clica fora dele', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Criar nota ou quadro' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('seleciona notas sem abri-las e move o grupo para a subpasta escolhida', async () => {
    const onMoveFiles = vi.fn(async () => 2)
    const onSelect = vi.fn()
    render(<NoteList
      folder={folders[0]!} folders={folders} notes={[note, secondNote]} boards={[]} selectedId={null} search=""
      searchRef={createRef<HTMLInputElement>()} onSearch={vi.fn()} onSelect={onSelect} onNew={vi.fn()} onNewBoard={vi.fn()} onMoveFiles={onMoveFiles}
    />)

    const selection = screen.getByRole('checkbox', { name: 'Selecionar nota: Aula' })
    fireEvent.click(selection)
    expect(selection.closest('.note-list-row')).toHaveClass('is-move-selected')
    expect(selection.closest('.note-list-row')?.querySelector('.note-item')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar nota: Projeto' }))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Pasta de destino' }), { target: { value: 'folder-2' } })
    expect(screen.getByRole('option', { name: 'Estudos / Software' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mover' }))
    await vi.waitFor(() => expect(onMoveFiles).toHaveBeenCalledWith(expect.arrayContaining([
      { entity: 'note', entityId: 'note-1' }, { entity: 'note', entityId: 'note-2' },
    ]), 'folder-2'))
    await vi.waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Selecionar nota: Aula' })).not.toBeChecked())
    expect(screen.getByRole('checkbox', { name: 'Selecionar nota: Aula' }).closest('.note-list-row')).not.toHaveClass('is-move-selected')
  })

  it('permite selecionar e mover quadros junto com notas', async () => {
    const onMoveFiles = vi.fn(async (_files: FileMove[], _folderId: string) => 2)
    const onSelect = vi.fn()
    render(<NoteList
      folder={folders[0]!} folders={folders} notes={[note]} boards={[board]} selectedId={null} search=""
      searchRef={createRef<HTMLInputElement>()} onSearch={vi.fn()} onSelect={onSelect} onNew={vi.fn()} onNewBoard={vi.fn()} onMoveFiles={onMoveFiles}
    />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar nota: Aula' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar quadro: Fluxo de sistema' }))
    expect(screen.getByRole('toolbar', { name: 'Mover arquivos selecionados' })).toHaveTextContent('2 arquivos selecionados')
    fireEvent.change(screen.getByRole('combobox', { name: 'Pasta de destino' }), { target: { value: 'folder-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mover' }))

    await vi.waitFor(() => expect(onMoveFiles).toHaveBeenCalledWith(expect.arrayContaining([
      { entity: 'note', entityId: 'note-1' }, { entity: 'board', entityId: 'board-1' },
    ]), 'folder-2'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
