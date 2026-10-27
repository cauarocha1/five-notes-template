import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { EditorPane } from '../src/components/EditorPane'
import { appendNoteLink, formatBoardEmbed, formatNoteLink } from '../src/lib/links'
import type { Note } from '../src/lib/types'

vi.mock('../src/lib/boardFiles', () => ({
  boardPreviewProxy: () => async (url: string) => url.includes('/board/') ? 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' : url,
}))

const makeNote = (id: string, title: string, body: string): Note => ({
  id, title, body, folderId: null, revision: 0, updatedAt: '2026-10-01T12:00:00.000Z', deletedAt: null,
})

const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalRangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')

const renderEditor = (note: Note, overrides: Partial<ComponentProps<typeof EditorPane>> = {}) => render(<EditorPane
  note={note} emptyMessage="" linkedBoards={[]} breadcrumb={[{ id: 'folder-studies', name: 'Estudos' }]} onNavigateFolder={vi.fn()} backlinks={[]} linked={[]} linkTarget={null} mobile={false}
  onTitle={vi.fn(async () => {})} onBody={vi.fn(async () => {})} onSelectNote={vi.fn()} onSelectBoard={vi.fn()} onRequestLinkNote={vi.fn()} onRequestLinkBoard={vi.fn()} onLinkConsumed={vi.fn()} onBoardLinkConsumed={vi.fn()} onUnavailableBoard={vi.fn()} onRemoveNoteLink={vi.fn()} onRemoveBoardLink={vi.fn()} onDelete={vi.fn()} onBack={vi.fn()}
  {...overrides}
/>)

describe('editor de anotações', () => {
  beforeEach(() => {
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 0, 0) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
  })

  afterEach(async () => {
    cleanup()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    if (originalRangeGetClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeGetClientRects)
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    if (originalRangeGetBoundingClientRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeGetBoundingClientRect)
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
    else Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('mostra um botão Voltar no cabeçalho da nota no computador', () => {
    const onBack = vi.fn()
    const view = renderEditor(makeNote('back-button', 'Aula', 'Conteúdo'), { onBack })

    fireEvent.click(view.getByRole('button', { name: 'Voltar' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('permite navegar para uma pasta pelo caminho da nota', () => {
    const onNavigateFolder = vi.fn()
    const view = renderEditor(makeNote('breadcrumb', 'Aula', 'Conteúdo'), {
      breadcrumb: [{ id: 'folder-studies', name: 'Estudos' }, { id: 'folder-course', name: 'Curso' }],
      onNavigateFolder,
    })

    fireEvent.click(view.getByRole('button', { name: 'Abrir pasta Estudos' }))

    expect(onNavigateFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'folder-studies', name: 'Estudos' }))
    expect(view.getByRole('button', { name: 'Abrir pasta Curso' })).toBeInTheDocument()
  })

  it('continua editável quando outra tela adiciona uma conexão à nota', async () => {
    const user = userEvent.setup()
    const original = makeNote('source', 'Aula', '# Anotação\n\nTexto que já existia.')
    const target = makeNote('target', 'Projeto', '')
    const onBody = vi.fn(async () => {})
    const view = renderEditor(original, { onBody })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())
    expect(onBody).not.toHaveBeenCalled()

    const connected = { ...original, body: appendNoteLink(original.body, target.id, target.title) }
    view.rerender(<EditorPane
      note={connected} emptyMessage="" linkedBoards={[]} breadcrumb={[{ id: 'folder-studies', name: 'Estudos' }]} onNavigateFolder={vi.fn()} backlinks={[]} linked={[target]} linkTarget={null} mobile={false}
      onTitle={vi.fn(async () => {})} onBody={onBody} onSelectNote={vi.fn()} onSelectBoard={vi.fn()} onRequestLinkNote={vi.fn()} onRequestLinkBoard={vi.fn()} onLinkConsumed={vi.fn()} onBoardLinkConsumed={vi.fn()} onUnavailableBoard={vi.fn()} onRemoveNoteLink={vi.fn()} onRemoveBoardLink={vi.fn()} onDelete={vi.fn()} onBack={vi.fn()}
    />)

    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await waitFor(() => expect(editable).toHaveTextContent('Projeto'))
    expect(onBody).not.toHaveBeenCalled()
    await user.click(editable)
    await user.keyboard(' Mais texto')
    await waitFor(() => expect(editable).toHaveTextContent('Mais texto'))
    expect(editable.textContent).toContain('Texto que já existia.')
    expect(editable.textContent).toContain('Projeto')
    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('Mais texto')))
  })

  it('insere a nota vinculada como um link legível sem exibir o identificador interno', async () => {
    const user = userEvent.setup()
    const original = makeNote('source-2', 'Aula', 'Conteúdo')
    const target = makeNote('target-2', 'Projeto de aula', '')
    const onBody = vi.fn(async () => {})
    const onLinkConsumed = vi.fn()
    const view = renderEditor(original, { onBody, onLinkConsumed, linkTarget: target })

    await waitFor(() => expect(onLinkConsumed).toHaveBeenCalled())
    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('[Projeto de aula](https://five-note.invalid/note/target-2)')))
    const editable = view.container.querySelector<HTMLElement>('.ProseMirror')!
    await user.click(editable)
    await user.keyboard(' continuação')
    await waitFor(() => expect(editable).toHaveTextContent('continuação'))
    expect(editable.textContent).not.toContain('target-2')
    expect(editable.textContent).not.toMatch(/ {8,}/)
    expect(view.container.querySelector('a[href="https://five-note.invalid/note/target-2"]')).toHaveClass('five-note-link-card')
    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('continuação')))
  })

  it('oferece formatação por toque e grava o título de seção em Markdown', async () => {
    const user = userEvent.setup()
    const note = makeNote('mobile-format', 'Aula', 'Texto para organizar.')
    const onBody = vi.fn(async () => {})
    const view = renderEditor(note, { mobile: true, onBody })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())

    expect(view.getByRole('toolbar', { name: 'Formatação da nota' })).toBeInTheDocument()
    await user.click(view.getByRole('button', { name: 'Título de seção' }))
    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('## Texto para organizar.')))
    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await user.click(editable)
    await user.keyboard(' texto novo')
    await waitFor(() => expect(editable).toHaveTextContent('texto novo'))
    await user.click(view.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(editable).not.toHaveTextContent('texto novo'))
  })

  it('oferece vínculo de nota e quadro pela barra de toque e pelo menu slash', async () => {
    const user = userEvent.setup()
    const note = makeNote('mobile-links', 'Aula', '')
    const onRequestLinkNote = vi.fn()
    const onRequestLinkBoard = vi.fn()
    const view = renderEditor(note, { mobile: true, onRequestLinkNote, onRequestLinkBoard })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())

    expect(view.getByRole('toolbar', { name: 'Formatação da nota' })).toBeInTheDocument()
    await user.click(view.getByRole('button', { name: 'Vincular nota' }))
    await user.click(view.getByRole('button', { name: 'Vincular quadro' }))
    expect(onRequestLinkNote).toHaveBeenCalledTimes(1)
    expect(onRequestLinkBoard).toHaveBeenCalledTimes(1)

    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await user.click(editable)
    await user.keyboard('/')
    const slashMenu = view.container.querySelector('.milkdown-slash-menu')!
    await waitFor(() => expect(slashMenu).toHaveTextContent('Vincular nota'))
    expect(slashMenu).toHaveTextContent('Vincular quadro')
    await user.click(within(slashMenu).getByText('Vincular nota', { exact: true }))
    expect(onRequestLinkNote).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(editable).not.toHaveTextContent('/'))
  })

  it('preserva títulos e listas suportados ao colar HTML no editor', async () => {
    const user = userEvent.setup()
    const note = makeNote('html-paste', 'Colagem', '')
    const onBody = vi.fn(async () => {})
    const view = renderEditor(note, { onBody })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())

    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await user.click(editable)
    fireEvent.paste(editable, {
      clipboardData: {
        getData: (type: string) => type === 'text/html'
          ? '<h2>Aula colada</h2><ul><li><p>Primeiro item</p></li><li><p>Segundo item</p></li></ul>'
          : type === 'text/plain' ? 'Aula colada\n\n- Primeiro item\n- Segundo item' : '',
      },
    })

    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('## Aula colada')))
    expect(onBody).toHaveBeenCalledWith(expect.stringContaining('* Primeiro item'))
    expect(onBody).toHaveBeenCalledWith(expect.stringContaining('* Segundo item'))
  })

  it('mostra o quadro como um cartão Markdown clicável no corpo e nas conexões', async () => {
    const user = userEvent.setup()
    const board = { id: 'board-1', title: 'Arquitetura', folderId: null, sceneJson: '{"elements":[]}', revision: 0, updatedAt: '', deletedAt: null }
    const original = makeNote('with-board', 'Aula', `Texto da aula. ${formatBoardEmbed(board.id, board.title)}`)
    const onBody = vi.fn(async () => {})
    const onSelectBoard = vi.fn()
    const view = renderEditor(original, { linkedBoards: [board], onBody, onSelectBoard })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())
    expect(onBody).not.toHaveBeenCalled()

    const editable = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    expect(editable).toHaveTextContent('Texto da aula.')
    const boardCard = await view.findByRole('link', { name: 'Quadro: Arquitetura' })
    expect(boardCard.querySelector('img')).toHaveAttribute('alt', 'Quadro: Arquitetura')
    expect(boardCard.querySelector('img')).toHaveAttribute('src', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E')
    expect(view.container.querySelectorAll('.milkdown-image-block, .milkdown-image-inline')).toHaveLength(1)
    expect(view.queryByRole('region', { name: 'Conexões desta nota' })).not.toBeInTheDocument()

    await user.click(boardCard)
    expect(onSelectBoard).toHaveBeenCalledWith(board)

    await user.click(editable)
    await user.keyboard(' Continuação')
    await waitFor(() => expect(onBody).toHaveBeenCalledWith(expect.stringContaining('Continuação')))
    expect(onBody).toHaveBeenCalledWith(expect.stringContaining(formatBoardEmbed(board.id, board.title)))
  })

  it('mostra vínculos e backlinks apenas quando o usuário abre conexões', async () => {
    const user = userEvent.setup()
    const source = makeNote('connections-source', 'Aula', '')
    const target = makeNote('connections-target', 'Projeto', '')
    const backlink = makeNote('connections-backlink', 'Referência', '[Aula](https://five-note.invalid/note/connections-source)')
    const onRemoveNoteLink = vi.fn()
    const view = renderEditor(source, { linked: [target], backlinks: [backlink], onRemoveNoteLink })
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())

    expect(view.queryByRole('dialog', { name: 'Conexões desta nota' })).not.toBeInTheDocument()
    await user.click(view.getByRole('button', { name: 'Conexões: 2' }))
    const panel = view.getByRole('dialog', { name: 'Conexões desta nota' })
    expect(panel).toHaveTextContent('Esta nota menciona')
    expect(panel).toHaveTextContent('Mencionada por')
    await user.click(view.getByRole('button', { name: 'Remover vínculo com Projeto' }))
    expect(onRemoveNoteLink).toHaveBeenCalledWith(target)
  })

  it('oferece sumário navegável para notas longas com ao menos três títulos', async () => {
    const user = userEvent.setup()
    const longBody = ['# Introdução', 'texto longo para completar a nota '.repeat(20), '## Conceito', 'texto '.repeat(25), '## Exemplo', 'texto '.repeat(25), '### Resultado', 'texto '.repeat(25)].join('\n\n')
    const view = renderEditor(makeNote('long-note', 'Manual', longBody))
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())
    const outlineButton = view.getByRole('button', { name: /Sumário/ })
    await user.click(outlineButton)
    expect(view.getByRole('navigation', { name: 'Sumário da nota' })).toHaveTextContent('Introdução')
    expect(view.getByRole('navigation', { name: 'Sumário da nota' })).toHaveTextContent('Resultado')
  })

  it('não salva novamente uma nota estruturada só por abri-la', async () => {
    const board = { id: 'board-rich', title: 'Arquitetura', folderId: null, sceneJson: '{"elements":[]}', revision: 0, updatedAt: '', deletedAt: null }
    const related = makeNote('related-rich', 'Consistência', '')
    const original = makeNote('rich-note', 'System Design', [
      '# System Design',
      '',
      `Conceito relacionado: ${formatNoteLink(related.id, related.title)}.`,
      '',
      '## Filas',
      '',
      '- produtor',
      '- consumidor',
      '',
      formatBoardEmbed(board.id, board.title),
    ].join('\n'))
    const onBody = vi.fn(async () => {})
    const view = renderEditor(original, { linkedBoards: [board], linked: [related], onBody })

    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument())
    expect(onBody).not.toHaveBeenCalled()
  })
})
