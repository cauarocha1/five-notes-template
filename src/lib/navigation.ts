export type MobilePage = 'folders' | 'list' | 'editor' | 'graph'

export interface AppNavigationState {
  homeOpen: boolean
  mapOpen: boolean
  searchOpen: boolean
  mobilePage: MobilePage
  search: string
  selectedFolderId: string | null
  selectedNoteId: string | null
  selectedBoardId: string | null
  boardReturnContext: { noteId: string | null; page: MobilePage; boardId: string | null }
  mapReturnPage: MobilePage
}

export interface FiveHistoryState extends Record<string, unknown> {
  fiveView?: AppNavigationState
  fiveIndex?: number
}

export function routeForView(view: AppNavigationState) {
  if (view.homeOpen) return '#home'
  if (view.searchOpen) return '#search'
  if (view.mapOpen || view.mobilePage === 'graph') return '#map'
  if (view.selectedBoardId) return `#board/${encodeURIComponent(view.selectedBoardId)}`
  if (view.selectedNoteId) return `#note/${encodeURIComponent(view.selectedNoteId)}`
  if (view.mobilePage === 'folders') return '#folders'
  return `#folder/${encodeURIComponent(view.selectedFolderId ?? 'all')}`
}

export function viewFromRoute(hash: string, current: AppNavigationState): AppNavigationState | null {
  const route = hash.replace(/^#/, '')
  if (route === 'home') return { ...current, homeOpen: true, mapOpen: false, searchOpen: false }
  if (route === 'search') return { ...current, homeOpen: false, mapOpen: false, searchOpen: true, selectedNoteId: null, selectedBoardId: null, mobilePage: 'list' }
  if (route === 'map') return { ...current, homeOpen: false, mapOpen: true, searchOpen: false, mobilePage: 'graph' }
  if (route === 'folders') return { ...current, homeOpen: false, mapOpen: false, searchOpen: false, selectedNoteId: null, selectedBoardId: null, mobilePage: 'folders' }
  const item = route.match(/^(note|board)\/(.+)$/)
  if (item?.[1] && item[2]) {
    let id = item[2]
    try { id = decodeURIComponent(id) } catch { /* Keep the route ID if it is malformed. */ }
    return {
      ...current,
      homeOpen: false,
      mapOpen: false,
      searchOpen: false,
      selectedNoteId: item[1] === 'note' ? id : null,
      selectedBoardId: item[1] === 'board' ? id : null,
      mobilePage: 'editor',
    }
  }
  const folder = route.match(/^folder\/(.+)$/)
  if (folder?.[1]) {
    let id = folder[1]
    try { id = decodeURIComponent(id) } catch { /* Keep the route ID if it is malformed. */ }
    return { ...current, homeOpen: false, mapOpen: false, searchOpen: false, selectedFolderId: id === 'all' ? null : id, selectedNoteId: null, selectedBoardId: null, mobilePage: 'list' }
  }
  return null
}

export function restoreView(hash: string, saved: AppNavigationState | undefined, current: AppNavigationState): AppNavigationState {
  if (saved && savedViewMatchesRoute(hash, saved)) return saved
  return viewFromRoute(hash, saved ?? current) ?? saved ?? current
}

function savedViewMatchesRoute(hash: string, view: AppNavigationState) {
  if (routeForView(view) !== hash) return false
  if (view.searchOpen) return view.mobilePage === 'list' && !view.selectedNoteId && !view.selectedBoardId
  if (view.mapOpen || view.mobilePage === 'graph') return hash === '#map'
  if (view.selectedNoteId || view.selectedBoardId) return view.mobilePage === 'editor'
  if (view.mobilePage === 'folders') return hash === '#folders'
  if (view.mobilePage === 'list') return hash.startsWith('#folder/')
  return true
}
