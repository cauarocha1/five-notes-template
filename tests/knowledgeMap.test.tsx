import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeMap } from '../src/components/KnowledgeMap'
import type { Board, Note } from '../src/lib/types'

const note = (id: string, title: string, body = '', folderId: string | null = null): Note => ({
  id, title, body, folderId, revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})

const board = (id: string, title: string): Board => ({
  id, title, sceneJson: '{"elements":[]}', folderId: null, revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})

const dispatchPointer = (element: Element, type: string, values: Record<string, number>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, values)
  fireEvent(element, event)
}

describe('mapa visual de notas', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('desenha linhas sem setas, identifica o tipo, seleciona com um clique e abre com dois', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula', '[Projeto](https://five-note.invalid/note/b)')
    const target = note('b', 'Projeto')
    const onSelect = vi.fn()
    const { container } = render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={async () => 'created'} onClose={() => {}} />)

    const path = container.querySelector('.map-edges path')
    expect(path).toHaveAttribute('d', expect.stringContaining(' C '))
    expect(path).not.toHaveAttribute('marker-end')
    expect(screen.getByText('2 arquivos · 1 conexão')).toBeInTheDocument()
    expect(screen.getAllByText('NOTA')).toHaveLength(2)
    const card = screen.getByRole('button', { name: 'Selecionar nota: Projeto' })
    fireEvent.click(card)
    expect(screen.getByRole('button', { name: 'Entrar em Projeto' })).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.doubleClick(card)
    expect(onSelect).toHaveBeenCalledWith(target)
  })

  it('identifica a pasta completa de cada anotação no cartão do mapa', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = note('nested', 'Definição', '', 'software')
    const folders = [
      { id: 'study', parentId: null, name: 'Estudos', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
      { id: 'software', parentId: 'study', name: 'Software', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
    ]
    render(<KnowledgeMap notes={[item]} folders={folders} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    expect(screen.getByText('Estudos / Software')).toBeInTheDocument()
  })

  it('permite arrastar cartões, move as linhas junto e salva as posições neste navegador', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula', '[Projeto](https://five-note.invalid/note/b)')
    const target = note('b', 'Projeto')
    const onSelect = vi.fn()
    const { container, unmount } = render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={async () => 'created'} onClose={() => {}} />)

    const card = screen.getByRole('button', { name: 'Selecionar nota: Projeto' })
    const svg = container.querySelector('svg.map-canvas')!
    const path = container.querySelector('.map-edges path')!
    const originalTransform = card.getAttribute('transform')
    const originalPath = path.getAttribute('d')
    dispatchPointer(card, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 1, clientX: 140, clientY: 130 })
    dispatchPointer(svg, 'pointerup', { pointerId: 1, clientX: 140, clientY: 130 })

    expect(card.getAttribute('transform')).not.toBe(originalTransform)
    expect(path.getAttribute('d')).not.toBe(originalPath)
    fireEvent.click(card)
    expect(onSelect).not.toHaveBeenCalled()
    const movedTransform = card.getAttribute('transform')
    unmount()

    const { unmount: unmountAgain } = render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Selecionar nota: Projeto' })).toHaveAttribute('transform', movedTransform)
    unmountAgain()
  })

  it('permite mover cartões pelo teclado sem abrir a nota', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = note('keyboard', 'Aula')
    const onSelect = vi.fn()
    render(<KnowledgeMap notes={[item]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    const card = screen.getByRole('button', { name: 'Selecionar nota: Aula' })
    const original = card.getAttribute('transform')

    fireEvent.keyDown(card, { key: 'ArrowRight' })
    expect(card.getAttribute('transform')).not.toBe(original)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('cria uma relação selecionando a anotação de origem e depois a de destino', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula')
    const target = note('b', 'Projeto')
    const onCreateRelation = vi.fn(async () => 'created' as const)
    const onSelect = vi.fn()
    render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={onCreateRelation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Conectar notas e quadros' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Aula' }))
    expect(screen.getByRole('status')).toHaveTextContent('Agora escolha o arquivo de destino')
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Projeto' }))

    await waitFor(() => expect(onCreateRelation).toHaveBeenCalledWith(source, target))
    expect(await screen.findByRole('status')).toHaveTextContent('Relação criada: Aula — Projeto.')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('mantém a seleção de conexão mesmo com pequeno movimento do ponteiro', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula')
    const target = note('b', 'Projeto')
    const onCreateRelation = vi.fn(async () => 'created' as const)
    const { container } = render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={onCreateRelation} onClose={() => {}} />)
    const svg = container.querySelector('svg.map-canvas')!

    fireEvent.click(screen.getByRole('button', { name: 'Conectar notas e quadros' }))
    const sourceCard = screen.getByRole('button', { name: 'Selecionar nota: Aula' })
    dispatchPointer(sourceCard, 'pointerdown', { pointerId: 7, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 7, clientX: 108, clientY: 104 })
    dispatchPointer(svg, 'pointerup', { pointerId: 7, clientX: 108, clientY: 104 })
    fireEvent.click(sourceCard)
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Projeto' }))

    await waitFor(() => expect(onCreateRelation).toHaveBeenCalledWith(source, target))
  })

  it('permite criar uma relação entre uma anotação e um quadro em qualquer direção', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula')
    const target = board('board-a', 'Diagrama')
    const onCreateRelation = vi.fn(async () => 'created' as const)
    render(<KnowledgeMap notes={[source]} boards={[target]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={onCreateRelation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Conectar notas e quadros' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar quadro: Diagrama' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Aula' }))

    await waitFor(() => expect(onCreateRelation).toHaveBeenCalledWith(target, source))
    expect(await screen.findByRole('status')).toHaveTextContent('Relação criada: Diagrama — Aula.')
  })

  it('orienta quando tentam relacionar dois quadros', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const first = board('board-a', 'Diagrama A')
    const second = board('board-b', 'Diagrama B')
    const onCreateRelation = vi.fn(async () => 'created' as const)
    render(<KnowledgeMap notes={[]} boards={[first, second]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={onCreateRelation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Conectar notas e quadros' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar quadro: Diagrama A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar quadro: Diagrama B' }))

    expect(screen.getByRole('status')).toHaveTextContent('Conecte uma nota a um quadro, ou duas notas entre si.')
    expect(onCreateRelation).not.toHaveBeenCalled()
  })

  it('sempre mostra notas e quadros de todas as pastas', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const local = note('local', 'Da pasta', '', 'folder-a')
    const remote = note('remote', 'De outra pasta', '', 'folder-b')
    render(<KnowledgeMap notes={[local, remote]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created' as const} onClose={() => {}} />)

    expect(screen.getByText('TODO O ESPAÇO')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Selecionar nota: Da pasta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Selecionar nota: De outra pasta' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Escopo do mapa' })).not.toBeInTheDocument()
  })

  it('seleciona e remove uma conexão com um controle explícito', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula', '[Projeto](https://five-note.invalid/note/b)')
    const target = note('b', 'Projeto')
    const onRemoveRelation = vi.fn(async () => 'removed' as const)
    render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created'} onRemoveRelation={onRemoveRelation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar conexão entre Aula e Projeto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover conexão selecionada' }))
    await waitFor(() => expect(onRemoveRelation).toHaveBeenCalledWith(source, target))
    expect(await screen.findByRole('status')).toHaveTextContent('Conexão removida: Aula — Projeto.')
  })

  it('navega pelo fundo com arraste e controla o zoom pela roda', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const { container } = render(<KnowledgeMap notes={[note('a', 'Aula')]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    const viewport = container.querySelector('.map-viewport')!
    const svg = container.querySelector('svg.map-canvas')!
    const originalViewBox = svg.getAttribute('viewBox')

    dispatchPointer(viewport, 'pointerdown', { pointerId: 21, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(viewport, 'pointermove', { pointerId: 21, clientX: 160, clientY: 145 })
    expect(svg.getAttribute('viewBox')).not.toBe(originalViewBox)
    dispatchPointer(viewport, 'pointerup', { pointerId: 21, clientX: 160, clientY: 145 })
    expect(viewport).not.toHaveClass('is-panning')

    fireEvent.wheel(viewport, { deltaY: -120, clientX: 160, clientY: 145 })
    expect(Number(screen.getByText(/^\d+%$/).textContent?.replace('%', ''))).toBeGreaterThan(100)
  })

  it('permite posicionar cartões fora da área inicial e preserva a câmera entre aberturas', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = note('infinite', 'Ideia livre')
    const props = { notes: [item], folders: [], selectedId: null, onSelect: () => {}, onCreateRelation: async () => 'created' as const, onClose: () => {} }
    const { container, unmount } = render(<KnowledgeMap {...props} />)
    const viewport = container.querySelector('.map-viewport')!
    const svg = container.querySelector('svg.map-canvas')!
    const card = screen.getByRole('button', { name: 'Selecionar nota: Ideia livre' })

    dispatchPointer(viewport, 'pointerdown', { pointerId: 51, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(viewport, 'pointermove', { pointerId: 51, clientX: 2600, clientY: 2100 })
    dispatchPointer(viewport, 'pointerup', { pointerId: 51, clientX: 2600, clientY: 2100 })
    const cameraAfterPan = svg.getAttribute('viewBox')!
    expect(cameraAfterPan.split(' ').slice(0, 2).map(Number).every((value) => value < 0)).toBe(true)

    dispatchPointer(card, 'pointerdown', { pointerId: 52, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 52, clientX: -1700, clientY: -1500 })
    dispatchPointer(svg, 'pointerup', { pointerId: 52, clientX: -1700, clientY: -1500 })
    const position = card.getAttribute('transform')!
    expect(position).toMatch(/translate\(-\d+/)

    unmount()
    const { container: reopened } = render(<KnowledgeMap {...props} />)
    expect(reopened.querySelector('svg.map-canvas')).toHaveAttribute('viewBox', cameraAfterPan)
    expect(screen.getByRole('button', { name: 'Selecionar nota: Ideia livre' })).toHaveAttribute('transform', position)
  })

  it('abre uma nota ou quadro com duplo clique', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = board('board-a', 'Diagrama')
    const onSelect = vi.fn()
    render(<KnowledgeMap notes={[]} boards={[item]} folders={[]} selectedId={null} onSelect={onSelect} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Selecionar quadro: Diagrama' }))
    expect(onSelect).toHaveBeenCalledWith(item)
  })

  it('mantém a seleção ao clicar depois do gesto de ponteiro usado para arrastar', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = note('pointer', 'Clique')
    render(<KnowledgeMap notes={[item]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created'} onClose={() => {}} />)
    const card = screen.getByRole('button', { name: 'Selecionar nota: Clique' })

    dispatchPointer(card, 'pointerdown', { pointerId: 31, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(card, 'pointerup', { pointerId: 31, clientX: 100, clientY: 100 })
    fireEvent.click(card)
    expect(screen.getByRole('button', { name: 'Entrar em Clique' })).toBeInTheDocument()
  })

  it('oferece renomear, mover, vincular e excluir pelo painel do cartão', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const item = note('a', 'Aula', '', 'inbox')
    const folders = [
      { id: 'inbox', parentId: null, name: 'Entrada', sortOrder: 0, revision: 0, updatedAt: '', deletedAt: null },
      { id: 'study', parentId: null, name: 'Estudos', sortOrder: 1, revision: 0, updatedAt: '', deletedAt: null },
    ]
    const onRenameItem = vi.fn(async () => true)
    const onMoveItem = vi.fn(async () => true)
    const onDeleteItem = vi.fn()
    render(<KnowledgeMap notes={[item]} folders={folders} selectedId={null} onSelect={() => {}} onCreateRelation={async () => 'created'} onRenameItem={onRenameItem} onMoveItem={onMoveItem} onDeleteItem={onDeleteItem} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Aula' }))

    fireEvent.click(screen.getByRole('button', { name: 'Editar Aula' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do arquivo' }), { target: { value: 'Aula revisada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onRenameItem).toHaveBeenCalledWith(item, 'Aula revisada'))

    fireEvent.click(screen.getByRole('button', { name: 'Mover Aula' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Pasta de destino do arquivo' }), { target: { value: 'study' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mover', exact: true }))
    await waitFor(() => expect(onMoveItem).toHaveBeenCalledWith(item, 'study'))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Aula' }))
    expect(onDeleteItem).toHaveBeenCalledWith(item)
  })

  it('vincula e desvincula arquivos a partir do painel de ações', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const source = note('a', 'Aula')
    const target = note('b', 'Projeto')
    const onCreateRelation = vi.fn(async () => 'created' as const)
    const onRemoveRelation = vi.fn(async () => 'removed' as const)
    const { rerender } = render(<KnowledgeMap notes={[source, target]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={onCreateRelation} onRemoveRelation={onRemoveRelation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Aula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vincular Aula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Projeto' }))
    await waitFor(() => expect(onCreateRelation).toHaveBeenCalledWith(source, target))

    fireEvent.click(screen.getByRole('button', { name: 'Sair do modo de conexão' }))
    const connectedSource = note('a', 'Aula', '[Projeto](https://five-note.invalid/note/b)')
    rerender(<KnowledgeMap notes={[connectedSource, target]} folders={[]} selectedId={null} onSelect={() => {}} onCreateRelation={onCreateRelation} onRemoveRelation={onRemoveRelation} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar nota: Aula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular Aula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular', exact: true }))
    await waitFor(() => expect(onRemoveRelation).toHaveBeenCalledWith(connectedSource, target))
  })
})
