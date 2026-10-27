import { describe, expect, it } from 'vitest'
import { restoreView, routeForView, viewFromRoute, type AppNavigationState } from '../src/lib/navigation'

const base: AppNavigationState = {
  homeOpen: false, mapOpen: false, searchOpen: false, mobilePage: 'list', search: 'aula',
  selectedFolderId: 'folder-1', selectedNoteId: null, selectedBoardId: null,
  boardReturnContext: { noteId: null, page: 'list', boardId: null }, mapReturnPage: 'list',
}

describe('rotas de navegação', () => {
  it('preserva a busca na navegação e recupera o estado próprio do histórico', () => {
    const searchView = { ...base, searchOpen: true, selectedFolderId: null }
    expect(routeForView(searchView)).toBe('#search')
    expect(viewFromRoute('#search', base)).toMatchObject({ searchOpen: true, selectedNoteId: null, selectedBoardId: null })
    expect(searchView.search).toBe('aula')
  })

  it('gera endereços estáveis para notas, quadros e pastas', () => {
    expect(routeForView({ ...base, selectedNoteId: 'nota/um' })).toBe('#note/nota%2Fum')
    expect(routeForView({ ...base, selectedBoardId: 'quadro 1' })).toBe('#board/quadro%201')
    expect(viewFromRoute('#folder/folder-2', base)?.selectedFolderId).toBe('folder-2')
  })

  it('prefere a rota visível quando ela diverge de um estado antigo do navegador', () => {
    const stale = { ...base, homeOpen: true, selectedFolderId: null }
    expect(restoreView('#note/note-2', stale, base)).toMatchObject({ homeOpen: false, selectedNoteId: 'note-2', mobilePage: 'editor' })
    const search = { ...base, searchOpen: true, search: 'conceito', selectedFolderId: null }
    expect(restoreView('#search', search, base).search).toBe('conceito')
  })

  it('repara uma rota de nota ou quadro salva com a tela móvel de pastas', () => {
    const staleNote = { ...base, mobilePage: 'folders' as const, selectedNoteId: 'note-3' }
    expect(restoreView('#note/note-3', staleNote, base)).toMatchObject({ selectedNoteId: 'note-3', mobilePage: 'editor' })

    const staleBoard = { ...base, mobilePage: 'folders' as const, selectedBoardId: 'board-4' }
    expect(restoreView('#board/board-4', staleBoard, base)).toMatchObject({ selectedBoardId: 'board-4', mobilePage: 'editor' })
  })

  it('reconstrói a busca global quando o histórico guarda conteúdo selecionado junto da rota de busca', () => {
    const staleSearch = { ...base, searchOpen: true, selectedNoteId: 'note-5', mobilePage: 'editor' as const }
    expect(restoreView('#search', staleSearch, base)).toMatchObject({ searchOpen: true, selectedNoteId: null, selectedBoardId: null, mobilePage: 'list' })
  })
})
