import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardEditor } from '../src/components/BoardEditor'
import { formatBoardEmbed } from '../src/lib/links'
import type { Board, Note } from '../src/lib/types'

const updateSceneMock = vi.hoisted(() => vi.fn())

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: { excalidrawAPI: (api: unknown) => void }) => {
    props.excalidrawAPI({
      getAppState: () => ({ zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 800, height: 600 }),
      getSceneElements: () => [],
      getFiles: () => ({}),
      updateScene: updateSceneMock,
      refresh: vi.fn(),
    })
    return null
  },
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  serializeAsJSON: (elements: unknown[]) => JSON.stringify({ type: 'excalidraw', elements }),
}))

const board: Board = { id: 'board-1', title: 'Arquitetura', folderId: null, sceneJson: '{"type":"excalidraw","elements":[]}', revision: 0, updatedAt: '', deletedAt: null }
const makeNote = (id: string, title: string, body: string): Note => ({ id, title, body, folderId: null, revision: 0, updatedAt: '', deletedAt: null })
const props = (notes: Note[], onSelectNote = vi.fn()) => ({
  board, notes, offline: true, syncLabel: 'Sem conexão', syncBusy: false, mobile: false, sidebarVisible: true,
  returnLabel: 'Voltar à lista', onToggleSidebar: vi.fn(), onSave: vi.fn(async () => {}), onTitle: vi.fn(async () => {}),
  onClose: vi.fn(), onDelete: vi.fn(), onSelectNote, onUnavailableNote: vi.fn(),
})

describe('integração de notas e quadros', () => {
  it('mostra as notas que mencionam o quadro e permite voltar para uma delas', async () => {
    const user = userEvent.setup()
    const linked = makeNote('note-1', 'Anotações de arquitetura', `Contexto.\n\n${formatBoardEmbed(board.id, board.title)}`)
    const onSelectNote = vi.fn()
    const view = render(<BoardEditor {...props([linked], onSelectNote)} />)

    await user.click(view.getByRole('button', { name: 'Notas vinculadas e inserir nota' }))
    expect(view.getByRole('dialog', { name: 'Notas do quadro' })).toBeInTheDocument()
    await user.click(view.getByRole('button', { name: 'Anotações de arquitetura' }))
    await waitFor(() => expect(onSelectNote).toHaveBeenCalledWith(linked))
    cleanup()
  })

  it('insere uma nota no Excalidraw com referência pelo ID', async () => {
    const user = userEvent.setup()
    const note = makeNote('note-2', 'Plano do projeto', '')
    const componentProps = props([note])
    const view = render(<BoardEditor {...componentProps} />)

    await user.click(view.getByRole('button', { name: 'Notas vinculadas e inserir nota' }))
    await user.click(view.getByRole('button', { name: 'Plano do projeto' }))
    await waitFor(() => expect(componentProps.onSave).toHaveBeenCalled())
    expect(componentProps.onSave).toHaveBeenCalledWith(expect.stringContaining('five-note.invalid/note/note-2'))
    expect(updateSceneMock).toHaveBeenCalledWith(expect.objectContaining({
      elements: [expect.objectContaining({ type: 'rectangle', x: 260, y: 257, width: 280, height: 86 })],
    }))
    cleanup()
  })
})
