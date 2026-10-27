import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FolderTree } from '../src/components/FolderTree'
import type { Folder } from '../src/lib/types'

const folders: Folder[] = [
  { id: 'study', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
  { id: 'software', parentId: 'study', name: 'Software', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
  { id: 'design', parentId: 'software', name: 'Design', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
]

describe('explorador de pastas', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('expande e recolhe subpastas em níveis aninhados', () => {
    const { container } = render(<FolderTree folders={folders} selectedId={null} noteCounts={new Map()} onSelect={vi.fn()} onCreateNote={vi.fn()} onCreateBoard={vi.fn()} onAddFolder={vi.fn()} onRenameFolder={vi.fn()} onDeleteFolder={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Estudos/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Software/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Design/ })).toBeInTheDocument()
    expect(container.querySelectorAll('.folder-tree-children')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Recolher Estudos' }))
    expect(screen.queryByRole('button', { name: /^Software/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Estudos' }))
    expect(screen.getByRole('button', { name: /^Software/ })).toBeInTheDocument()
  })

  it('expande a ancestral quando uma nova subpasta é criada dentro de uma pasta recolhida', () => {
    const props = { selectedId: 'software', noteCounts: new Map<string, number>(), onSelect: vi.fn(), onCreateNote: vi.fn(), onCreateBoard: vi.fn(), onAddFolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn() }
    const { rerender } = render(<FolderTree folders={folders} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recolher Software' }))
    expect(screen.queryByRole('button', { name: /^Design/ })).not.toBeInTheDocument()

    const nestedFolder: Folder = { id: 'architecture', parentId: 'software', name: 'Arquitetura', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null }
    rerender(<FolderTree folders={[...folders, nestedFolder]} selectedId="architecture" noteCounts={props.noteCounts} onSelect={props.onSelect} onCreateNote={props.onCreateNote} onCreateBoard={props.onCreateBoard} onAddFolder={props.onAddFolder} onRenameFolder={props.onRenameFolder} onDeleteFolder={props.onDeleteFolder} />)

    expect(screen.getByRole('button', { name: 'Recolher Software' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Arquitetura/ })).toBeInTheDocument()
  })

  it('mantém acessíveis pastas cujo pai está ausente ou tem referência circular', () => {
    const foldersWithOrphans: Folder[] = [
      { id: 'orphan', parentId: 'missing-parent', name: 'Pasta órfã', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
      { id: 'cycle-a', parentId: 'cycle-b', name: 'Ciclo A', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
      { id: 'cycle-b', parentId: 'cycle-a', name: 'Ciclo B', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
    ]
    render(<FolderTree folders={foldersWithOrphans} selectedId={null} noteCounts={new Map()} onSelect={vi.fn()} onCreateNote={vi.fn()} onCreateBoard={vi.fn()} onAddFolder={vi.fn()} onRenameFolder={vi.fn()} onDeleteFolder={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^Pasta órfã/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ciclo A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ciclo B/ })).toBeInTheDocument()
  })

  it('agrupa nota, quadro e operações da pasta no botão mais', () => {
    const onCreateNote = vi.fn()
    const onCreateBoard = vi.fn()
    const onAddFolder = vi.fn()
    const onRenameFolder = vi.fn()
    const onDeleteFolder = vi.fn()
    render(<FolderTree folders={folders} selectedId={null} noteCounts={new Map()} onSelect={vi.fn()} onCreateNote={onCreateNote} onCreateBoard={onCreateBoard} onAddFolder={onAddFolder} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Estudos' }))
    const menu = screen.getByRole('menu', { name: 'Ações da pasta Estudos' })
    expect(menu).toHaveTextContent('Criar nova nota')
    expect(menu).toHaveTextContent('Criar novo quadro')
    expect(menu).toHaveTextContent('Criar subpasta')
    expect(menu).toHaveTextContent('Renomear')
    expect(menu).toHaveTextContent('Excluir pasta')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Criar nova nota' }))
    expect(onCreateNote).toHaveBeenCalledWith('study')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Estudos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Criar novo quadro' }))
    expect(onCreateBoard).toHaveBeenCalledWith('study')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Estudos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Criar subpasta' }))
    expect(onAddFolder).toHaveBeenCalledWith('study')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Estudos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }))
    expect(onRenameFolder).toHaveBeenCalledWith(folders[0])

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Estudos' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir pasta' }))
    expect(onDeleteFolder).toHaveBeenCalledWith(folders[0])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('não permite excluir a pasta de sistema Entrada pelo menu', () => {
    const inbox: Folder = { id: 'inbox', parentId: null, name: 'Entrada', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null }
    render(<FolderTree folders={[inbox]} selectedId={null} noteCounts={new Map()} onSelect={vi.fn()} onCreateNote={vi.fn()} onCreateBoard={vi.fn()} onAddFolder={vi.fn()} onRenameFolder={vi.fn()} onDeleteFolder={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da pasta Entrada' }))
    expect(screen.getByRole('menu')).toHaveTextContent('Criar nova nota')
    expect(screen.queryByRole('menuitem', { name: 'Excluir pasta' })).not.toBeInTheDocument()
  })
})
