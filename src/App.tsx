import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, Check, ChevronDown, Cloud, CloudOff, FileText, FolderPlus, Network, PanelLeftOpen, Plus, RefreshCw, Search, Shapes, Smartphone, Upload, X } from 'lucide-react'
import { EditorPane } from './components/EditorPane'
import { FolderTree } from './components/FolderTree'
import { GlobalSearch } from './components/GlobalSearch'
import { HomeScreen } from './components/HomeScreen'
import { KnowledgeMap } from './components/KnowledgeMap'
import { NoteList } from './components/NoteList'
import { QuickSearchPopover } from './components/QuickSearchPopover'
const BoardEditor = lazy(() => import('./components/BoardEditor').then((module) => ({ default: module.BoardEditor })))
import { db, moveFilesToFolder, moveFolderToParent, newId, patchLocalBoard, patchLocalNote, saveLocalBoard, saveLocalFolder, saveLocalNote, seedIfEmpty, softDeleteBoard, softDeleteFolder, softDeleteNote } from './lib/database'
import { MOBILE_LAYOUT_QUERY, useFiveData, useIsMobile } from './lib/hooks'
import { appendBoardEmbed, appendNoteLink, backlinksFor, linkedNotes, noteBodyText, parseBoardLinks, parseNoteLinks, removeBoardEmbed, removeNoteLink } from './lib/links'
import { stripRetiredCanvasContent } from './lib/legacyNoteContent'
import { exportBackup, importBackup, syncNow } from './lib/sync'
import { EMPTY_BOARD_SCENE } from './lib/boardFiles'
import { SEED_FOLDER_IDS, type Board, type FileMove, type Folder, type Note, type SyncStatus } from './lib/types'
import { restoreView, routeForView, type AppNavigationState, type FiveHistoryState, type MobilePage } from './lib/navigation'
import type { KnowledgeItem } from './lib/knowledgeGraph'

type Dialog =
  | { type: 'new-folder'; parentId: string | null }
  | { type: 'rename-folder'; folder: Folder }
  | { type: 'move-folder'; folder: Folder }
  | { type: 'rename-file'; item: Note | Board }
  | { type: 'move-file'; item: Note | Board }
  | { type: 'link-note' }
  | { type: 'link-board' }
  | { type: 'delete-folder'; folder: Folder }
  | { type: 'delete-note'; note: Note; fromMap?: boolean }
  | { type: 'delete-board'; board: Board; fromMap?: boolean }
  | null

export default function App() {
  const { folders, notes, boards, pendingCount, outboxUpdatedAt } = useFiveData()
  const mobile = useIsMobile()
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(SEED_FOLDER_IDS.inbox)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkTarget, setLinkTarget] = useState<Note | null>(null)
  const [boardLinkTarget, setBoardLinkTarget] = useState<Board | null>(null)
  const [boardSearch, setBoardSearch] = useState('')
  const [mobilePage, setMobilePage] = useState<MobilePage>(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches ? 'folders' : 'editor')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [homeOpen, setHomeOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking')
  const [syncBusy, setSyncBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [updateReady, setUpdateReady] = useState(false)
  const pendingNoteSelection = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const syncLock = useRef(false)
  const boardEditingRef = useRef(false)
  const boardReturnContext = useRef<{ noteId: string | null; page: MobilePage; boardId: string | null }>({ noteId: null, page: 'list', boardId: null })
  const mapReturnPage = useRef<MobilePage>('editor')
  const historyReady = useRef(false)
  const viewStateRef = useRef<AppNavigationState | null>(null)

  viewStateRef.current = {
    homeOpen, mapOpen, searchOpen, mobilePage, search, selectedFolderId, selectedNoteId, selectedBoardId,
    boardReturnContext: boardReturnContext.current, mapReturnPage: mapReturnPage.current,
  }
  const currentView = () => viewStateRef.current!

  const applyView = (view: AppNavigationState) => {
    setHomeOpen(view.homeOpen)
    setMapOpen(view.mapOpen)
    setSearchOpen(view.searchOpen)
    setMobilePage(view.mobilePage)
    setSearch(view.search)
    setSelectedFolderId(view.selectedFolderId)
    setSelectedNoteId(view.selectedNoteId)
    setSelectedBoardId(view.selectedBoardId)
    boardReturnContext.current = view.boardReturnContext
    mapReturnPage.current = view.mapReturnPage
    boardEditingRef.current = Boolean(view.selectedBoardId)
  }

  const recordView = (view: AppNavigationState, replace = false) => {
    const previous = (window.history.state ?? {}) as FiveHistoryState
    const index = replace ? previous.fiveIndex ?? 0 : (previous.fiveIndex ?? 0) + 1
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({ ...previous, fiveView: view, fiveIndex: index }, '', `${window.location.pathname}${window.location.search}${routeForView(view)}`)
    applyView(view)
  }

  const goBackTo = (fallback: AppNavigationState) => {
    const state = window.history.state as FiveHistoryState | null
    if ((state?.fiveIndex ?? 0) > 0) window.history.back()
    else recordView(fallback, true)
  }

  const updateSearch = (value: string) => {
    setSearch(value)
    if (!searchOpen) {
      const view = { ...currentView(), homeOpen: false, mapOpen: false, searchOpen: true, search: value, selectedNoteId: null, selectedBoardId: null, selectedFolderId: null, mobilePage: 'list' as MobilePage }
      recordView(view)
      return
    }
    const state = window.history.state as FiveHistoryState | null
    if (state?.fiveView) recordView({ ...state.fiveView, search: value }, true)
  }

  const enterSearch = () => {
    const view = { ...currentView(), homeOpen: false, mapOpen: false, searchOpen: true, search: '', selectedNoteId: null, selectedBoardId: null, selectedFolderId: null, mobilePage: 'list' as MobilePage, boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null } }
    recordView(view)
    window.setTimeout(() => searchRef.current?.focus(), 60)
  }

  useEffect(() => {
    if (!ready || historyReady.current) return
    const saved = (window.history.state as FiveHistoryState | null)?.fiveView
    const initial = restoreView(window.location.hash, saved, currentView())
    if (initial !== currentView()) applyView(initial)
    recordView(initial, true)
    historyReady.current = true
    const restore = (event: PopStateEvent) => {
      const state = event.state as FiveHistoryState | null
      const next = restoreView(window.location.hash, state?.fiveView, currentView())
      if (next) applyView(next)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [ready])

  useEffect(() => {
    const showUpdate = () => setUpdateReady(true)
    window.addEventListener('five:update-ready', showUpdate)
    return () => window.removeEventListener('five:update-ready', showUpdate)
  }, [])

  useEffect(() => {
    let mounted = true
    void seedIfEmpty().then(async () => {
      const storedNotes = await db.notes.toArray()
      await Promise.all(storedNotes.map(async (storedNote) => {
        const body = stripRetiredCanvasContent(storedNote.body)
        if (body !== storedNote.body) await patchLocalNote(storedNote.id, { body })
      }))
      const startNote = await db.notes.get('five-note-welcome-v1')
      const firstNote = startNote ?? await db.notes.orderBy('updatedAt').reverse().first()
      if (!mounted) return
      if (firstNote) {
        setSelectedNoteId(firstNote.id)
        setSelectedFolderId(firstNote.folderId)
      }
      setReady(true)
      try {
        const result = await syncNow()
        if (mounted) setSyncStatus(result)
      } catch (error) {
        console.error('five opened locally but its initial sync failed', error)
        if (mounted) setSyncStatus(navigator.onLine ? 'pending' : 'offline')
      }
    }).catch((error: unknown) => {
      console.error('five failed to open local storage', error)
      if (mounted) setBootError(error instanceof Error ? error.message : 'Erro desconhecido')
    })
    return () => { mounted = false }
  }, [])

  const runSync = useCallback(async () => {
    if (syncLock.current || boardEditingRef.current) return
    syncLock.current = true
    setSyncBusy(true)
    setSyncStatus('checking')
    try {
      setSyncStatus(await syncNow())
    } catch (error) {
      console.error('five could not sync local changes', error)
      setSyncStatus(navigator.onLine ? 'pending' : 'offline')
    } finally {
      setSyncBusy(false)
      syncLock.current = false
    }
  }, [])

  useEffect(() => {
    if (!ready || syncStatus === 'checking' || syncStatus === 'offline' || syncStatus === 'local' || syncStatus === 'unavailable' || syncStatus === 'access-expired') return
    if (!pendingCount && syncStatus !== 'pending') return
    const timer = window.setTimeout(() => { void runSync() }, 1_500)
    return () => window.clearTimeout(timer)
  }, [ready, pendingCount, outboxUpdatedAt, syncStatus, runSync])

  useEffect(() => {
    const refresh = () => { if (navigator.onLine && document.visibilityState === 'visible') void runSync() }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [runSync])

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const note of notes) if (note.folderId) map.set(note.folderId, (map.get(note.folderId) ?? 0) + 1)
    for (const board of boards) if (board.folderId) map.set(board.folderId, (map.get(board.folderId) ?? 0) + 1)
    return map
  }, [notes, boards])
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null
  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? null
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null
  const searchItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    const items = [...notes, ...boards].filter((item) => !query || ('sceneJson' in item
      ? item.title.toLocaleLowerCase('pt-BR').includes(query)
      : `${item.title}\n${noteBodyText(item.body)}`.toLocaleLowerCase('pt-BR').includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return items.map((item) => ({ ...item, folderLabel: folderPath(item.folderId, folderById) }))
  }, [notes, boards, search, folderById])
  const quickSearchItems = useMemo(() => {
    const query = quickSearch.trim().toLocaleLowerCase('pt-BR')
    if (!query) return []
    return [...notes, ...boards]
      .filter((item) => 'sceneJson' in item
        ? item.title.toLocaleLowerCase('pt-BR').includes(query)
        : `${item.title}\n${noteBodyText(item.body)}`.toLocaleLowerCase('pt-BR').includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((item) => ({ ...item, folderLabel: folderPath(item.folderId, folderById) }))
  }, [notes, boards, quickSearch, folderById])
  const recentSearchItems = useMemo(() => [...notes, ...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map((item) => ({ ...item, folderLabel: folderPath(item.folderId, folderById) })), [notes, boards, folderById])
  const noteList = useMemo(() => {
    if (searchOpen) return searchItems.filter((item): item is Note & { folderLabel: string } => !('sceneJson' in item))
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return notes
      .filter((note) => query ? `${note.title}\n${noteBodyText(note.body)}`.toLocaleLowerCase('pt-BR').includes(query) : (selectedFolderId ? note.folderId === selectedFolderId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [notes, search, selectedFolderId, searchOpen, searchItems])
  const fileList = useMemo(() => {
    if (searchOpen) return searchItems
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return [
      ...noteList,
      ...boards.filter((board) => query
        ? board.title.toLocaleLowerCase('pt-BR').includes(query)
        : selectedFolderId ? board.folderId === selectedFolderId : true),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [noteList, boards, search, selectedFolderId, searchOpen, searchItems])
  const recentFiles = useMemo(() => [...notes, ...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4), [notes, boards])
  useEffect(() => {
    if (!ready || !selectedNoteId || selectedBoardId) return
    if (notes.some((note) => note.id === selectedNoteId)) {
      if (pendingNoteSelection.current === selectedNoteId) pendingNoteSelection.current = null
      return
    }
    if (pendingNoteSelection.current === selectedNoteId) return
    const fallback = noteList[0] ?? notes[0] ?? null
    setSelectedNoteId(fallback?.id ?? null)
    if (fallback) setSelectedFolderId(fallback.folderId)
  }, [ready, selectedNoteId, selectedBoardId, notes, noteList])
  useEffect(() => {
    if (!ready) return
    const activeItem = selectedBoard ?? selectedNote
    if (!activeItem || activeItem.folderId === selectedFolderId) return
    recordView({ ...currentView(), selectedFolderId: activeItem.folderId }, true)
  }, [ready, selectedBoard?.id, selectedBoard?.folderId, selectedNote?.id, selectedNote?.folderId, selectedFolderId])
  const linked = useMemo(() => selectedNote ? linkedNotes(selectedNote, notes) : [], [selectedNote, notes])
  const backlinks = useMemo(() => selectedNote ? backlinksFor(selectedNote, notes) : [], [selectedNote, notes])
  const linkedBoards = useMemo(() => selectedNote ? boards.filter((board) => parseBoardLinks(selectedNote.body).some((link) => link.targetId === board.id)) : [], [selectedNote, boards])
  const breadcrumb = selectedNote ? folderBreadcrumbs(selectedNote.folderId, folderById) : []
  const syncLabel = syncStatus === 'offline' || !navigator.onLine
    ? pendingCount ? `Sem conexão · ${pendingCount} pendente${pendingCount === 1 ? '' : 's'}` : 'Sem conexão'
    : syncBusy ? 'Sincronizando…'
      : syncStatus === 'access-expired' ? 'Acesso expirado · dados locais preservados'
        : syncStatus === 'unavailable' ? 'Serviço indisponível · dados locais preservados'
          : pendingCount ? `Sincronização pendente (${pendingCount})`
            : syncStatus === 'synced' ? 'Sincronizado' : syncStatus === 'pending' ? 'Sincronização pendente' : syncStatus === 'local' ? 'Só neste aparelho' : 'Verificando…'
  const syncIcon = syncStatus === 'synced' ? <Cloud size={14} /> : ['local', 'offline', 'unavailable', 'access-expired'].includes(syncStatus) ? <CloudOff size={14} /> : <RefreshCw size={14} className={syncBusy || syncStatus === 'checking' ? 'spin' : ''} />

  const createNote = useCallback(async (targetFolderId?: string) => {
    const folderId = targetFolderId ?? (search ? SEED_FOLDER_IDS.inbox : (selectedFolderId ?? SEED_FOLDER_IDS.inbox))
    const stamp = new Date().toISOString()
    const note: Note = { id: newId(), folderId, title: '', body: '', revision: 0, updatedAt: stamp, deletedAt: null }
    await saveLocalNote(note)
    pendingNoteSelection.current = note.id
    const view = { ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedFolderId: folderId, selectedNoteId: note.id, selectedBoardId: null, boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null }, mobilePage: 'editor' as MobilePage }
    recordView(view)
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.note-title')?.focus(), 40)
  }, [search, selectedFolderId, searchOpen, homeOpen, mapOpen, mobilePage, selectedNoteId, selectedBoardId])

  const createBoard = useCallback(async (targetFolderId?: string, openEditor = true) => {
    const folderId = targetFolderId ?? (search ? SEED_FOLDER_IDS.inbox : (selectedFolderId ?? SEED_FOLDER_IDS.inbox))
    const stamp = new Date().toISOString()
    const board: Board = { id: newId(), folderId, title: '', sceneJson: EMPTY_BOARD_SCENE, revision: 0, updatedAt: stamp, deletedAt: null }
    await saveLocalBoard(board)
    if (!openEditor) return board
    const view = { ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedFolderId: folderId, selectedNoteId: null, selectedBoardId: board.id, boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null }, mobilePage: 'editor' as MobilePage }
    recordView(view)
    return board
  }, [search, selectedFolderId, searchOpen, homeOpen, mapOpen, mobilePage, selectedNoteId, selectedBoardId])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        enterSearch()
      }
      if (event.key === 'Escape') {
        if (dialog) setDialog(null)
        else if (searchOpen) goBackTo({ ...currentView(), searchOpen: false, search: '', mobilePage: selectedFolderId ? 'list' : 'folders' })
        else if (homeOpen) goBackTo({ ...currentView(), homeOpen: false })
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [mobile, mobilePage, mapOpen, searchOpen, dialog, homeOpen, selectedFolderId])

  async function createFolder(name: string, parentId: string | null) {
    const siblings = folders.filter((folder) => folder.parentId === parentId)
    const folder: Folder = { id: newId(), parentId, name: name.trim(), sortOrder: siblings.length, revision: 0, updatedAt: new Date().toISOString(), deletedAt: null }
    await saveLocalFolder(folder)
    setDialog(null)
    recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedFolderId: folder.id, selectedNoteId: null, selectedBoardId: null, boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null }, mobilePage: 'list' })
  }

  async function renameFolder(folder: Folder, name: string) {
    if (!name.trim()) return
    await saveLocalFolder({ ...folder, name: name.trim() })
    setDialog(null)
  }

  function removeFolder(folder: Folder) {
    setDialog({ type: 'delete-folder', folder })
  }

  async function confirmRemoveFolder(folder: Folder) {
    setDialog(null)
    const result = await softDeleteFolder(folder)
    const fallbackFolderId = folder.parentId && folders.some((item) => item.id === folder.parentId) ? folder.parentId : SEED_FOLDER_IDS.inbox
    if (selectedFolderId === folder.id) setSelectedFolderId(fallbackFolderId)
    if (selectedNote && selectedNote.folderId === folder.id) setSelectedNoteId(null)
    setNotice(`Pasta excluída. Notas e quadros foram para ${result.destinationId ? folderById.get(result.destinationId)?.name ?? 'a pasta de destino' : 'a Entrada'}; as subpastas foram preservadas.`)
    window.setTimeout(() => setNotice(''), 3500)
  }

  async function removeNote() {
    if (!selectedNote) return
    setDialog({ type: 'delete-note', note: selectedNote })
  }

  async function confirmRemoveNote(note: Note, fromMap = false) {
    setDialog(null)
    const oldFolder = note.folderId
    await softDeleteNote(note)
    const next = notes.filter((item) => item.id !== note.id && (item.folderId === oldFolder || item.folderId === SEED_FOLDER_IDS.inbox))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    recordView({ ...currentView(), selectedNoteId: next?.id ?? null, selectedBoardId: null, selectedFolderId: oldFolder ?? selectedFolderId, mobilePage: fromMap && mobile ? 'graph' : next ? 'editor' : 'list' }, true)
    setNotice('Nota excluída neste aparelho.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  function removeBoard(board: Board) {
    setDialog({ type: 'delete-board', board })
  }

  async function renameFile(item: Note | Board, title: string) {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const saved = 'sceneJson' in item
      ? await patchLocalBoard(item.id, { title: cleanTitle })
      : await patchLocalNote(item.id, { title: cleanTitle })
    if (saved) setDialog(null)
  }

  async function moveFile(item: Note | Board, folderId: string) {
    const entity = 'sceneJson' in item ? 'board' : 'note'
    if (await moveFilesToFolder([{ entity, entityId: item.id }], folderId)) setDialog(null)
  }

  async function copyFileLink(item: Note | Board) {
    const view = { ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, selectedNoteId: 'sceneJson' in item ? null : item.id, selectedBoardId: 'sceneJson' in item ? item.id : null, selectedFolderId: item.folderId, mobilePage: 'editor' as MobilePage }
    const address = `${window.location.origin}${window.location.pathname}${window.location.search}${routeForView(view)}`
    try {
      await navigator.clipboard.writeText(address)
      setNotice('Link copiado.')
    } catch {
      setNotice(`Não foi possível copiar. Endereço: ${address}`)
    }
    window.setTimeout(() => setNotice(''), 4500)
  }

  function requestFileDelete(item: Note | Board) {
    if ('sceneJson' in item) setDialog({ type: 'delete-board', board: item })
    else setDialog({ type: 'delete-note', note: item })
  }

  async function confirmRemoveBoard(board: Board, fromMap = false) {
    setDialog(null)
    await softDeleteBoard(board)
    if (selectedBoardId === board.id) await closeBoard()
    setNotice('Quadro excluído. As referências nas notas foram mantidas.')
    window.setTimeout(() => setNotice(''), 3500)
    if (fromMap && mobile) recordView({ ...currentView(), mobilePage: 'graph', mapOpen: false }, true)
  }

  function selectNote(note: Note, returnContext?: { noteId: string | null; page: MobilePage; boardId: string | null }) {
    const context = returnContext ?? { noteId: null, page: 'list' as MobilePage, boardId: null }
    recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, selectedBoardId: null, selectedNoteId: note.id, selectedFolderId: note.folderId, boardReturnContext: context, mobilePage: 'editor' })
  }

  function selectNoteFromBoard(note: Note) {
    const boardId = selectedBoardId
    selectNote(note, { noteId: null, page: 'editor', boardId })
  }

  function selectRelatedNote(note: Note) {
    selectNote(note)
  }

  function selectBoard(board: Board, returnNoteId: string | null = null, returnPage: MobilePage = 'list') {
    recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, selectedBoardId: board.id, selectedNoteId: returnNoteId, selectedFolderId: board.folderId, boardReturnContext: { noteId: returnNoteId, page: returnPage, boardId: null }, mobilePage: 'editor' })
  }

  function selectFile(item: Note | Board, returnPage: MobilePage = 'list') {
    if ('sceneJson' in item) selectBoard(item, null, returnPage)
    else void selectNote(item)
  }

  function openQuickSearchResult(item: Note | Board) {
    setQuickSearch('')
    setQuickSearchOpen(false)
    selectFile(item, mobilePage)
  }

  async function createMapRelation(source: KnowledgeItem, target: KnowledgeItem): Promise<'created' | 'exists' | 'error'> {
    const sourceIsBoard = 'sceneJson' in source
    const targetIsBoard = 'sceneJson' in target
    if (sourceIsBoard && targetIsBoard) return 'error'
    const noteId = sourceIsBoard ? target.id : source.id
    const current = await db.notes.get(noteId)
    if (!current || current.deletedAt || source.deletedAt || target.deletedAt) return 'error'
    const board = sourceIsBoard ? source : targetIsBoard ? target : null
    if (board && !await db.boards.get(board.id)) return 'error'
    if (!board && parseNoteLinks(current.body).some((link) => link.targetId === target.id)) return 'exists'
    if (board && parseBoardLinks(current.body).some((link) => link.targetId === board.id)) return 'exists'
    try {
      const body = board
        ? appendBoardEmbed(current.body, board.id, board.title.trim() || 'Sem título')
        : appendNoteLink(current.body, target.id, target.title.trim() || 'Sem título')
      const updated = await patchLocalNote(current.id, {
        body,
      })
      return updated ? 'created' : 'error'
    } catch (error) {
      console.error('five could not create a map relationship', error)
      return 'error'
    }
  }

  async function linkBoardToNote(board: Board) {
    setDialog(null)
    if (!selectedNote) return
    if (parseBoardLinks(selectedNote.body).some((link) => link.targetId === board.id)) {
      setNotice('Esse quadro já está vinculado à nota.')
      window.setTimeout(() => setNotice(''), 3500)
      return
    }
    setBoardLinkTarget(board)
  }

  async function unlinkNoteFromNote(target: Note) {
    if (!selectedNote) return
    await patchLocalNote(selectedNote.id, { body: removeNoteLink(selectedNote.body, target.id) })
  }

  async function unlinkBoardFromNote(target: Board) {
    if (!selectedNote) return
    await patchLocalNote(selectedNote.id, { body: removeBoardEmbed(selectedNote.body, target.id) })
  }

  async function moveSelectedFiles(files: FileMove[], folderId: string) {
    const moved = await moveFilesToFolder(files, folderId)
    if (moved) {
      setNotice(`${moved} ${moved === 1 ? 'arquivo movido' : 'arquivos movidos'} para ${folderById.get(folderId)?.name ?? 'a pasta escolhida'}.`)
      window.setTimeout(() => setNotice(''), 3500)
    }
    return moved
  }

  async function moveFolder(folder: Folder, parentId: string | null) {
    const moved = await moveFolderToParent(folder.id, parentId)
    setDialog(null)
    if (moved) {
      setNotice(`Pasta movida para ${parentId ? folderById.get(parentId)?.name ?? 'a pasta escolhida' : 'o nível principal'}.`)
      window.setTimeout(() => setNotice(''), 3500)
    } else {
      setNotice('Não foi possível mover a pasta para esse destino.')
      window.setTimeout(() => setNotice(''), 3500)
    }
    return moved
  }

  async function renameMapItem(item: KnowledgeItem, title: string) {
    const updated = 'sceneJson' in item
      ? await patchLocalBoard(item.id, { title })
      : await patchLocalNote(item.id, { title })
    if (updated) {
      setNotice('Nome atualizado.')
      window.setTimeout(() => setNotice(''), 3500)
    }
    return Boolean(updated)
  }

  async function moveMapItem(item: KnowledgeItem, folderId: string) {
    if (item.folderId === folderId) return true
    const entity = 'sceneJson' in item ? 'board' : 'note'
    const succeeded = await moveFilesToFolder([{ entity, entityId: item.id }], folderId) > 0
    if (succeeded) {
      setNotice(`Arquivo movido para ${folderById.get(folderId)?.name ?? 'a pasta escolhida'}.`)
      window.setTimeout(() => setNotice(''), 3500)
    }
    return succeeded
  }

  function requestMapItemDelete(item: KnowledgeItem) {
    if ('sceneJson' in item) setDialog({ type: 'delete-board', board: item, fromMap: true })
    else setDialog({ type: 'delete-note', note: item, fromMap: true })
  }

  async function removeMapRelation(source: KnowledgeItem, target: KnowledgeItem): Promise<'removed' | 'error'> {
    const sourceIsBoard = 'sceneJson' in source
    const targetIsBoard = 'sceneJson' in target
    if (sourceIsBoard && targetIsBoard) return 'error'
    try {
      if (!sourceIsBoard && !targetIsBoard) {
        let removed = false
        for (const [from, to] of [[source, target], [target, source]] as const) {
          const current = await db.notes.get(from.id)
          if (!current || current.deletedAt) continue
          const body = removeNoteLink(current.body, to.id)
          if (body === current.body) continue
          removed = Boolean(await patchLocalNote(current.id, { body })) || removed
        }
        return removed ? 'removed' : 'error'
      }
      const note = sourceIsBoard ? target : source
      const board = sourceIsBoard ? source : target
      const current = await db.notes.get(note.id)
      if (!current || current.deletedAt) return 'error'
      const body = removeBoardEmbed(current.body, board.id)
      if (body === current.body) return 'error'
      return await patchLocalNote(current.id, { body }) ? 'removed' : 'error'
    } catch (error) {
      console.error('five could not remove a map relationship', error)
      return 'error'
    }
  }

  async function closeBoard() {
    const context = boardReturnContext.current
    const returnNote = context.noteId ? notes.find((note) => note.id === context.noteId) : null
    const returnBoard = context.boardId ? boards.find((board) => board.id === context.boardId) : null
    const fallback = {
      ...currentView(), homeOpen: false, mapOpen: context.page === 'graph', searchOpen: false,
      selectedNoteId: returnNote?.id ?? null, selectedBoardId: returnBoard?.id ?? null,
      selectedFolderId: returnNote?.folderId ?? returnBoard?.folderId ?? selectedFolderId,
      mobilePage: returnNote || returnBoard ? 'editor' as MobilePage : context.page,
      boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null },
    }
    goBackTo(fallback)
    if (!returnBoard) window.setTimeout(() => { void runSync() }, 150)
  }

  function navigateBackFromNote() {
    const context = boardReturnContext.current
    const returnBoard = context.boardId && boards.some((board) => board.id === context.boardId) ? context.boardId : null
    const fallback = { ...currentView(), homeOpen: false, mapOpen: context.page === 'graph', searchOpen: false, selectedNoteId: context.noteId, selectedBoardId: returnBoard, mobilePage: returnBoard || context.noteId ? 'editor' as MobilePage : context.page === 'folders' ? 'folders' as MobilePage : 'list' as MobilePage, boardReturnContext: { noteId: null, page: 'list' as MobilePage, boardId: null } }
    goBackTo(fallback)
  }

  function requestBoardLink() {
    setBoardSearch('')
    setDialog({ type: 'link-board' })
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    try {
      await importBackup(file)
      setNotice('Backup importado para este aparelho. A sincronização foi iniciada.')
      void runSync()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível importar o backup.')
    }
    window.setTimeout(() => setNotice(''), 4500)
  }

  async function applyAppUpdate() {
    try {
      const flushes: Promise<void>[] = []
      window.dispatchEvent(new CustomEvent('five:flush-before-update', { detail: { flushes } }))
      await Promise.all(flushes)
      await db.transaction('r', db.folders, db.notes, db.boards, db.outbox, async () => {
        await Promise.all([db.folders.toArray(), db.notes.toArray(), db.boards.toArray(), db.outbox.toArray()])
      })
      window.dispatchEvent(new Event('five:apply-update'))
    } catch (error) {
      console.error('five kept the current version open because local writes did not finish', error)
      setNotice('Não foi possível concluir os salvamentos. A versão atual continua aberta; tente atualizar de novo.')
      window.setTimeout(() => setNotice(''), 5000)
    }
  }

  function chooseLink(note: Note) {
    setLinkTarget(note)
    setDialog(null)
    setLinkSearch('')
  }

  const consumeLink = useCallback(() => setLinkTarget(null), [])
  const consumeBoardLink = useCallback(() => setBoardLinkTarget(null), [])
  const statusClass = syncStatus === 'synced' ? 'status-good' : syncStatus === 'checking' ? 'status-checking' : 'status-warn'
  const showSidebar = !mobile && !sidebarCollapsed
  const showFolderScreen = mobile && !homeOpen && !searchOpen && !mapOpen && mobilePage === 'folders' && !selectedBoard
  const showNoteList = mobile && !homeOpen && !mapOpen && mobilePage === 'list'
  const showEditor = !homeOpen && !searchOpen && (mobile ? mobilePage === 'editor' : !mapOpen)
  const showMap = !homeOpen && (mobile ? mobilePage === 'graph' : mapOpen)
  const showGlobalSearch = !mobile && !homeOpen && searchOpen && !mapOpen

  const toggleMap = () => {
    if (mobile) {
      if (mobilePage === 'graph') goBackTo({ ...currentView(), mapOpen: false, mobilePage: mapReturnPage.current })
      else recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, mobilePage: 'graph', mapReturnPage: mobilePage })
      return
    }
    if (mapOpen) goBackTo({ ...currentView(), mapOpen: false })
    else recordView({ ...currentView(), homeOpen: false, mapOpen: true, searchOpen: false })
  }

  const closeMap = () => {
    goBackTo({ ...currentView(), mapOpen: false, mobilePage: mapReturnPage.current })
  }

  const openMapItem = (item: KnowledgeItem) => {
    if ('sceneJson' in item) {
      selectBoard(item, null, 'graph')
      return
    }
    void selectNote(item)
  }

  const openHome = () => {
    recordView({ ...currentView(), homeOpen: true, mapOpen: false, searchOpen: false })
  }

  const openMapFromHome = () => {
    recordView({ ...currentView(), homeOpen: false, mapOpen: !mobile, searchOpen: false, mobilePage: 'graph', mapReturnPage: mobilePage })
  }

  const openSearchFromHome = () => {
    enterSearch()
  }

  const selectFolder = (folder: Folder) => {
    recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedFolderId: folder.id, selectedNoteId: null, selectedBoardId: null, boardReturnContext: { noteId: null, page: 'list', boardId: null }, mobilePage: 'list' })
  }

  const renderFolderTree = (showFiles: boolean) => <FolderTree
    folders={folders}
    files={showFiles ? fileList : [...notes, ...boards]}
    selectedId={searchOpen || search ? null : selectedFolderId}
    selectedFileId={selectedNoteId ?? selectedBoardId}
    noteCounts={folderCounts}
    search={search}
    showFiles={showFiles && !searchOpen}
    onSelect={selectFolder}
    onSelectFile={(file) => selectFile(file, mobilePage)}
    onCreateNote={(folderId) => void createNote(folderId)}
    onCreateBoard={(folderId) => void createBoard(folderId)}
    onAddFolder={(parentId) => setDialog({ type: 'new-folder', parentId })}
    onRenameFolder={(folder) => setDialog({ type: 'rename-folder', folder })}
    onDeleteFolder={(folder) => void removeFolder(folder)}
    onMoveFolder={(folder) => {
      if (folder.parentId !== folderById.get(folder.id)?.parentId) void moveFolder(folder, folder.parentId)
      else setDialog({ type: 'move-folder', folder })
    }}
    onMoveFiles={moveSelectedFiles}
    onRenameFile={(file) => setDialog({ type: 'rename-file', item: file })}
    onMoveFile={(file) => setDialog({ type: 'move-file', item: file })}
    onCopyFileLink={(file) => void copyFileLink(file)}
    onDeleteFile={requestFileDelete}
  />

  if (!ready) return <div className="boot-screen"><div className="boot-brand">five</div>{bootError ? <div role="alert"><span>Não foi possível abrir as notas neste navegador.</span><small>{bootError}</small><button className="secondary-button" onClick={() => window.location.reload()}>Tentar novamente</button></div> : <span>Preparando seu espaço…</span>}</div>

  return (
    <div className={`app-shell is-two-pane${mapOpen ? ' is-map-open' : ''}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${homeOpen ? ' is-home-open' : ''}`}>
      {mobile && <div className="mobile-header">
        <button className="brand-button" aria-label="Mostrar pastas" title="Pastas" onClick={() => recordView({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedFolderId: null, selectedNoteId: null, selectedBoardId: null, mobilePage: 'folders' })}>five</button>
        <div className="mobile-header-actions">
          <button className="icon-button" aria-label="Abrir busca global" title="Buscar em todo o espaço" onClick={openSearchFromHome}><Search size={17} /></button>
          <button className="icon-button mobile-new" aria-label="Nova nota" onClick={() => void createNote()}><Plus size={18} /></button>
        </div>
      </div>}

      {showSidebar && <aside className={`sidebar ${mobile ? 'mobile-sidebar' : ''}`}>
        <div className="sidebar-brand"><div className="sidebar-brand-row"><button className="brand-lockup brand-home-button" aria-label="Ir para início" title="Início" onClick={openHome}>five</button><button className="icon-button sidebar-close-button" onClick={() => setSidebarCollapsed(true)} aria-label="Ocultar barra lateral" title="Ocultar barra lateral"><X size={18} /></button></div><p>seu espaço de ideias</p></div>
        <button className="capture-button" title={`Criar nota em ${search ? 'Entrada' : selectedFolder?.name ?? 'Entrada'}`} onClick={() => void createNote()}><Plus size={16} /><span>Nova nota</span></button>
        <div className="sidebar-section-label"><span>SEU ESPAÇO</span><button className="icon-button" aria-label="Criar pasta" onClick={() => setDialog({ type: 'new-folder', parentId: null })}><FolderPlus size={15} /></button></div>
        {renderFolderTree(true)}
        <div className="sidebar-footer">
          <button className="footer-action" onClick={() => void exportBackup()}><ArrowDownToLine size={15} /> Exportar backup</button>
          <button className="footer-action" onClick={() => backupInputRef.current?.click()}><Upload size={15} /> Importar backup</button>
          <input ref={backupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { void handleImport(event.target.files?.[0]); event.currentTarget.value = '' }} />
          <div className="device-note"><Smartphone size={14} /><span>{notes.length} notas · {boards.length} quadros</span></div>
        </div>
      </aside>}

      {homeOpen && <HomeScreen notes={notes} boards={boards} folders={folders} onCreateNote={() => void createNote(SEED_FOLDER_IDS.inbox)} onCreateBoard={() => void createBoard(SEED_FOLDER_IDS.inbox)} onSearch={openSearchFromHome} onOpenItem={(item) => selectFile(item, mobilePage)} onOpenMap={openMapFromHome} />}

      {showGlobalSearch && <GlobalSearch query={search} items={searchItems} recent={recentSearchItems} onSearch={updateSearch} onOpen={selectFile} />}

      {showFolderScreen && <section className="mobile-folder-screen" aria-label="Pastas">
        <header className="mobile-folder-heading"><div><p className="eyebrow">SEU ESPAÇO</p><h1>Pastas</h1></div><div><button className="icon-button" aria-label="Mapa do conhecimento" title="Mapa do conhecimento" onClick={toggleMap}><Network size={17} /></button><button className="icon-button" aria-label="Criar pasta" title="Criar pasta" onClick={() => setDialog({ type: 'new-folder', parentId: null })}><FolderPlus size={18} /></button></div></header>
        <p className="mobile-folder-hint">Escolha uma pasta para ver suas notas e quadros.</p>
        {!!recentFiles.length && <section className="mobile-recent-section" aria-label="Itens recentes"><h2>Recentes</h2><div className="mobile-recent-list">{recentFiles.map((item) => <button key={`${'sceneJson' in item ? 'board' : 'note'}:${item.id}`} className="mobile-recent-item" onClick={() => selectFile(item, 'folders')}>{'sceneJson' in item ? <Shapes size={15} /> : <FileText size={15} />}<span>{item.title || 'Sem título'}</span></button>)}</div></section>}
        {renderFolderTree(false)}
        <div className="mobile-folder-footer"><button className="footer-action" onClick={() => void exportBackup()}><ArrowDownToLine size={15} /> Exportar backup</button><button className="footer-action" onClick={() => backupInputRef.current?.click()}><Upload size={15} /> Importar backup</button><input ref={backupInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { void handleImport(event.target.files?.[0]); event.currentTarget.value = '' }} /></div>
      </section>}

      {showNoteList && <div className={`note-list-wrap ${mobile ? 'mobile-note-list' : ''}`}>
        {mobile && <div className="mobile-list-top"><button className="icon-button" onClick={() => goBackTo({ ...currentView(), homeOpen: false, mapOpen: false, searchOpen: false, search: '', selectedNoteId: null, selectedBoardId: null, mobilePage: 'folders' })} aria-label="Voltar às pastas"><ArrowLeft size={18} /></button><span>{searchOpen || search ? 'Resultados globais' : selectedFolder?.name ?? 'Notas'}</span><button className="icon-button" onClick={() => void createNote()} aria-label={`Nova nota em ${search ? 'Entrada' : selectedFolder?.name ?? 'Entrada'}`} title={`Nova nota em ${search ? 'Entrada' : selectedFolder?.name ?? 'Entrada'}`}><Plus size={18} /></button></div>}
        {mobile && <NoteList folder={selectedFolder} folders={folders} notes={noteList} boards={boards.filter((board) => fileList.some((item) => item.id === board.id))} selectedId={selectedNoteId ?? selectedBoardId} search={search} searchRef={searchRef} onSearch={updateSearch} onSelect={selectFile} onNew={() => void createNote()} onNewBoard={() => void createBoard()} onMoveFiles={moveSelectedFiles} onRenameItem={(item) => setDialog({ type: 'rename-file', item })} onMoveItem={(item) => setDialog({ type: 'move-file', item })} onCopyItemLink={(item) => void copyFileLink(item)} onDeleteItem={requestFileDelete} />}
      </div>}

      {showEditor && <div className={`editor-wrap ${mobile ? 'mobile-editor' : ''}`}>
        <EditorPane key={selectedNote?.id ?? 'empty'} note={selectedNote} emptyMessage={fileList.length ? search ? 'Selecione um resultado para abrir.' : 'Selecione uma nota ou um quadro para abrir.' : ''} linkedBoards={linkedBoards} breadcrumb={breadcrumb} onNavigateFolder={selectFolder} backlinks={backlinks} linked={linked} linkTarget={linkTarget} boardLinkTarget={boardLinkTarget} mobile={mobile} onTitle={async (title) => { if (selectedNote) await patchLocalNote(selectedNote.id, { title }) }} onBody={async (body) => { if (selectedNote) await patchLocalNote(selectedNote.id, { body }) }} onSelectNote={selectRelatedNote} onSelectBoard={(board) => selectBoard(board, selectedNote?.id ?? null, 'editor')} onRequestLinkNote={() => { setLinkSearch(''); setDialog({ type: 'link-note' }) }} onRequestLinkBoard={requestBoardLink} onLinkConsumed={consumeLink} onBoardLinkConsumed={consumeBoardLink} onUnavailableBoard={() => { setNotice('Este quadro foi removido. O vínculo continua visível na nota; restaure-o pelo backup para reabri-lo.'); window.setTimeout(() => setNotice(''), 4500) }} onRemoveNoteLink={(target) => void unlinkNoteFromNote(target)} onRemoveBoardLink={(target) => void unlinkBoardFromNote(target)} onDelete={() => void removeNote()} onBack={navigateBackFromNote} />
      </div>}

      {!mobile && <div className="topbar-overlay">
        <div className="topbar-left">{sidebarCollapsed && <button className="icon-button sidebar-toggle" onClick={() => setSidebarCollapsed(false)} aria-label="Mostrar barra lateral" aria-expanded={false} title="Mostrar barra lateral"><PanelLeftOpen size={16} /></button>}<span className="topbar-folder">{homeOpen ? 'Início' : searchOpen ? 'Busca global' : mapOpen ? 'Mapa de todo o espaço' : search ? 'Busca global' : selectedFolder?.name ?? 'Todas as notas'}</span>{!homeOpen && !mapOpen && !searchOpen && !search && <ChevronDown size={14} />}<button className={`topbar-map-button${mapOpen && !homeOpen ? ' is-active' : ''}`} onClick={() => homeOpen ? openMapFromHome() : toggleMap()} aria-pressed={mapOpen && !homeOpen} title={mapOpen && !homeOpen ? 'Voltar ao conteúdo' : 'Abrir mapa do conhecimento'}><Network size={15} /><span>{mapOpen && !homeOpen ? 'Notas' : 'Mapa'}</span></button></div>
        <div className="desktop-quick-search-wrap" onBlurCapture={(event) => {
          if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return
          setQuickSearchOpen(false)
          setQuickSearch('')
        }}>
          <label className="desktop-quick-search"><Search size={14} /><input value={quickSearch} onFocus={() => setQuickSearchOpen(true)} onChange={(event) => { setQuickSearch(event.target.value); setQuickSearchOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') { setQuickSearch(''); setQuickSearchOpen(false); event.currentTarget.blur() } }} placeholder="Buscar notas e quadros" aria-label="Buscar notas e quadros sem sair da tela" /></label>
          {quickSearchOpen && quickSearch.trim() && <QuickSearchPopover query={quickSearch} items={quickSearchItems} onOpen={openQuickSearchResult} />}
        </div>
        <div className="topbar-actions">
          <div className={`sync-status ${statusClass}`}><span className="status-icon">{syncIcon}</span><span>{syncLabel}</span></div>
          <button className="icon-button" onClick={() => void runSync()} title="Sincronizar agora" aria-label="Sincronizar agora" disabled={syncBusy}><RefreshCw size={15} className={syncBusy ? 'spin' : ''} /></button>
          <button className="icon-button" onClick={() => void exportBackup()} title="Exportar backup" aria-label="Exportar backup"><ArrowDownToLine size={16} /></button>
        </div>
      </div>}

      {!mobile && updateReady && <div className="update-ready-banner" role="status"><span>Atualização pronta. O Five salva as alterações locais antes de atualizar.</span><button className="secondary-button" onClick={() => void applyAppUpdate()}>Atualizar</button></div>}

      {showMap && <KnowledgeMap notes={notes} boards={boards} folders={folders} selectedId={selectedNoteId ?? selectedBoardId} onSelect={openMapItem} onCreateRelation={createMapRelation} onRemoveRelation={removeMapRelation} onRenameItem={renameMapItem} onMoveItem={moveMapItem} onDeleteItem={requestMapItemDelete} onClose={closeMap} />}

      {selectedBoard && !homeOpen && <Suspense fallback={<div className="board-loading-screen">Abrindo quadro…</div>}><BoardEditor key={selectedBoard.id} board={selectedBoard} notes={notes} offline={['offline', 'unavailable', 'access-expired', 'local'].includes(syncStatus) || !navigator.onLine} syncLabel={syncLabel} syncBusy={syncBusy} mobile={mobile} sidebarVisible={showSidebar} returnLabel={boardReturnContext.current.noteId ? 'Voltar à nota' : boardReturnContext.current.page === 'graph' ? 'Voltar ao mapa' : 'Voltar à lista'} onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)} onSave={async (sceneJson) => { await patchLocalBoard(selectedBoard.id, { sceneJson }) }} onTitle={async (title) => { await patchLocalBoard(selectedBoard.id, { title }) }} onClose={() => void closeBoard()} onDelete={() => removeBoard(selectedBoard)} onSelectNote={selectNoteFromBoard} onUnavailableNote={() => { setNotice('Esta nota foi removida. O cartão continua no quadro e pode ser corrigido ao restaurar o backup.'); window.setTimeout(() => setNotice(''), 4500) }} /></Suspense>}

      {mobile && (updateReady || ['pending', 'offline', 'access-expired', 'unavailable'].includes(syncStatus)) && <div className={`mobile-sync-strip ${statusClass}`} role="status"><span>{updateReady ? <RefreshCw size={14} /> : syncIcon} {updateReady ? 'Atualização disponível' : syncLabel}</span><button onClick={() => updateReady ? void applyAppUpdate() : void runSync()}>{updateReady ? 'Atualizar' : 'Tentar'}</button></div>}
      {notice && <div className="toast" role="status"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={14} /></button></div>}

      {dialog?.type === 'new-folder' && <FolderDialog title="Nova pasta" initial="" submitLabel="Criar pasta" onClose={() => setDialog(null)} onSubmit={(name) => void createFolder(name, dialog.parentId)} />}
      {dialog?.type === 'rename-folder' && <FolderDialog title="Renomear pasta" initial={dialog.folder.name} submitLabel="Salvar" onClose={() => setDialog(null)} onSubmit={(name) => void renameFolder(dialog.folder, name)} />}
      {dialog?.type === 'move-folder' && <FolderMoveDialog folder={dialog.folder} folders={folders} onClose={() => setDialog(null)} onMove={(parentId) => void moveFolder(dialog.folder, parentId)} />}
      {dialog?.type === 'rename-file' && <FolderDialog title={`Renomear ${'sceneJson' in dialog.item ? 'quadro' : 'nota'}`} inputLabel="Título" initial={dialog.item.title} submitLabel="Salvar" onClose={() => setDialog(null)} onSubmit={(name) => void renameFile(dialog.item, name)} />}
      {dialog?.type === 'move-file' && <FileMoveDialog item={dialog.item} folders={folders} onClose={() => setDialog(null)} onMove={(folderId) => void moveFile(dialog.item, folderId)} />}
      {dialog?.type === 'delete-folder' && <ConfirmDialog title={`Excluir a pasta “${dialog.folder.name}”?`} message={`Notas e quadros vão para ${dialog.folder.parentId ? folderById.get(dialog.folder.parentId)?.name ?? 'Entrada' : 'Entrada'}. As subpastas serão preservadas no nível da pasta excluída.`} confirmLabel="Excluir pasta" onClose={() => setDialog(null)} onConfirm={() => void confirmRemoveFolder(dialog.folder)} />}
      {dialog?.type === 'delete-note' && <ConfirmDialog title={`Excluir “${dialog.note.title || 'Sem título'}”?`} message="A nota deixa de aparecer nas listas e a exclusão será sincronizada com seus outros aparelhos." confirmLabel="Excluir nota" onClose={() => setDialog(null)} onConfirm={() => void confirmRemoveNote(dialog.note, Boolean(dialog.fromMap))} />}
      {dialog?.type === 'delete-board' && <ConfirmDialog title={`Excluir o quadro “${dialog.board.title || 'Sem título'}”?`} message="As referências nas notas serão mantidas, mas o desenho deixará de aparecer neste aparelho e nos demais após sincronizar." confirmLabel="Excluir quadro" onClose={() => setDialog(null)} onConfirm={() => void confirmRemoveBoard(dialog.board, Boolean(dialog.fromMap))} />}
      {dialog?.type === 'link-note' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="modal-card link-modal" role="dialog" aria-modal="true" aria-labelledby="link-title">
        <div className="modal-heading"><div><p className="eyebrow">CONEXÕES</p><h2 id="link-title">Vincular uma nota</h2></div><button className="icon-button" onClick={() => setDialog(null)} aria-label="Fechar"><X size={17} /></button></div>
        <label className="search-field modal-search"><Search size={15} /><input autoFocus value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="Buscar nota pelo título" /></label>
        <div className="link-picker-list">{notes.filter((note) => note.id !== selectedNoteId && note.title.toLocaleLowerCase('pt-BR').includes(linkSearch.toLocaleLowerCase('pt-BR'))).slice(0, 30).map((note) => <button key={note.id} className="link-picker-item" onClick={() => chooseLink(note)}><FileText size={15} /><span>{note.title || 'Sem título'}</span><small>{folderPath(note.folderId, folderById)}</small></button>)}{notes.length < 2 && <p className="empty-picker">Crie outra nota para criar conexões.</p>}</div>
      </section></div>}
      {dialog?.type === 'link-board' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="modal-card link-modal" role="dialog" aria-modal="true" aria-labelledby="board-link-title">
        <div className="modal-heading"><div><p className="eyebrow">QUADROS</p><h2 id="board-link-title">Vincular quadro</h2></div><button className="icon-button" onClick={() => setDialog(null)} aria-label="Fechar"><X size={17} /></button></div>
        <button className="link-picker-item board-create-option" onClick={() => { void createBoard(selectedNote?.folderId ?? undefined, false).then((created) => { if (created) void linkBoardToNote(created) }) }}><Plus size={15} /><span>Criar quadro vinculado</span><small>O quadro fica como arquivo independente, conectado a esta nota</small></button>
        <label className="search-field modal-search"><Search size={15} /><input autoFocus value={boardSearch} onChange={(event) => setBoardSearch(event.target.value)} placeholder="Buscar quadro pelo título" aria-label="Buscar quadro" /></label>
        <div className="link-picker-list">{boards.filter((board) => !linkedBoards.some((linkedBoard) => linkedBoard.id === board.id) && board.title.toLocaleLowerCase('pt-BR').includes(boardSearch.toLocaleLowerCase('pt-BR'))).slice(0, 30).map((board) => <button key={board.id} className="link-picker-item" onClick={() => void linkBoardToNote(board)}><Shapes size={15} /><span>{board.title || 'Sem título'}</span><small>{folderPath(board.folderId, folderById)}</small></button>)}{!boards.length && <p className="empty-picker">Crie o primeiro quadro para vinculá-lo a esta nota.</p>}{boards.length > 0 && !boards.some((board) => !linkedBoards.some((linkedBoard) => linkedBoard.id === board.id) && board.title.toLocaleLowerCase('pt-BR').includes(boardSearch.toLocaleLowerCase('pt-BR'))) && <p className="empty-picker">Nenhum quadro disponível para vincular.</p>}</div>
      </section></div>}
    </div>
  )
}

function folderPath(folderId: string | null, byId: Map<string, Folder>) {
  return folderBreadcrumbs(folderId, byId).map((folder) => folder.name).join(' / ') || 'Entrada'
}

function folderBreadcrumbs(folderId: string | null, byId: Map<string, Folder>) {
  const parts: Folder[] = []
  let current = folderId ? byId.get(folderId) : undefined
  const visited = new Set<string>()
  while (current && !visited.has(current.id) && parts.length < 20) {
    visited.add(current.id)
    parts.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  if (parts.length) return parts
  const inbox = [...byId.values()].find((folder) => folder.name === 'Entrada' && !folder.parentId)
  return inbox ? [inbox] : []
}

function FolderDialog({ title, initial, submitLabel, inputLabel = 'Nome da pasta', onClose, onSubmit }: { title: string; initial: string; submitLabel: string; inputLabel?: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial)
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal-card" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name) }}>
    <div className="modal-heading"><div><p className="eyebrow">ORGANIZAÇÃO</p><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={17} /></button></div>
    <label className="form-label">{inputLabel}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={inputLabel === 'Título' ? 'Título do item' : 'Ex.: Estudos de Software'} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!name.trim()}>{submitLabel}</button></div>
  </form></div>
}

function FolderMoveDialog({ folder, folders, onClose, onMove }: { folder: Folder; folders: Folder[]; onClose: () => void; onMove: (parentId: string | null) => void }) {
  const [parentId, setParentId] = useState(folder.parentId ?? '')
  const excluded = new Set([folder.id])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of folders) {
      if (candidate.parentId && excluded.has(candidate.parentId) && !excluded.has(candidate.id)) {
        excluded.add(candidate.id)
        changed = true
      }
    }
  }
  const folderById = new Map(folders.map((item) => [item.id, item]))
  const available = folders.filter((candidate) => !excluded.has(candidate.id)).sort((a, b) => folderPath(a.id, folderById).localeCompare(folderPath(b.id, folderById), 'pt-BR'))
  const selectedParent = parentId || null
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="move-folder-title">
    <div className="modal-heading"><div><p className="eyebrow">ORGANIZAÇÃO</p><h2 id="move-folder-title">Mover “{folder.name}”</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={17} /></button></div>
    <label className="form-label">Pasta de destino<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Nível principal</option>{available.map((candidate) => <option key={candidate.id} value={candidate.id}>{folderPath(candidate.id, folderById)}</option>)}</select></label>
    <p className="confirm-message">As notas, quadros e subpastas acompanham a pasta.</p>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={selectedParent === folder.parentId} onClick={() => onMove(selectedParent)}>Mover pasta</button></div>
  </section></div>
}

function FileMoveDialog({ item, folders, onClose, onMove }: { item: Note | Board; folders: Folder[]; onClose: () => void; onMove: (folderId: string) => void }) {
  const [folderId, setFolderId] = useState(item.folderId ?? '')
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const options = [...folders].sort((a, b) => folderPath(a.id, folderById).localeCompare(folderPath(b.id, folderById), 'pt-BR'))
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="move-file-title">
    <div className="modal-heading"><div><p className="eyebrow">ORGANIZAÇÃO</p><h2 id="move-file-title">Mover “{item.title || 'Sem título'}”</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={17} /></button></div>
    <label className="form-label">Pasta de destino<select value={folderId} onChange={(event) => setFolderId(event.target.value)}>{options.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folderById)}</option>)}</select></label>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!folderId || folderId === item.folderId} onClick={() => onMove(folderId)}>Mover</button></div>
  </section></div>
}

function ConfirmDialog({ title, message, confirmLabel, onClose, onConfirm }: { title: string; message: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
    <div className="modal-heading"><div><p className="eyebrow">CONFIRMAÇÃO</p><h2 id="confirm-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={17} /></button></div>
    <p className="confirm-message" id="confirm-message">{message}</p>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button danger-button" onClick={onConfirm}>{confirmLabel}</button></div>
  </section></div>
}
