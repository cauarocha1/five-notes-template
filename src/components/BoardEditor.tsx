import { useCallback, useEffect, useRef, useState } from 'react'
import { convertToExcalidrawElements, Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { AlertCircle, ArrowLeft, ArrowDownToLine, Check, Cloud, CloudOff, FilePlus2, PanelLeftOpen, RefreshCw, Search, Shapes, Trash2, X } from 'lucide-react'
import type { Board, Note } from '../lib/types'
import { BOARD_WARNING_BYTES, MAX_BOARD_JSON_BYTES, downloadBoard } from '../lib/boardFiles'
import { sceneWithCurrentNoteTitles } from '../lib/boardScene'
import { INTERNAL_NOTE_HREF_PREFIX, parseBoardLinks } from '../lib/links'
import '@excalidraw/excalidraw/index.css'

interface Props {
  board: Board
  notes: Note[]
  offline: boolean
  syncLabel: string
  syncBusy: boolean
  mobile: boolean
  sidebarVisible: boolean
  returnLabel: string
  onToggleSidebar: () => void
  onSave: (sceneJson: string) => Promise<void>
  onTitle: (title: string) => Promise<void>
  onClose: () => void
  onDelete: () => void
  onSelectNote: (note: Note) => void
  onUnavailableNote: () => void
}

type Scene = { elements: readonly OrderedExcalidrawElement[]; appState: AppState; files: BinaryFiles }

function serializeScene(scene: Scene) {
  return serializeAsJSON(scene.elements as readonly ExcalidrawElement[], scene.appState, scene.files, 'database')
}

export function BoardEditor({ board, notes, offline, syncLabel, syncBusy, mobile, sidebarVisible, returnLabel, onToggleSidebar, onSave, onTitle, onClose, onDelete, onSelectNote, onUnavailableNote }: Props) {
  const [title, setTitle] = useState(board.title)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'warning' | 'large' | 'error'>('saved')
  const [notePickerOpen, setNotePickerOpen] = useState(false)
  const [noteSearch, setNoteSearch] = useState('')
  const linkedNotes = notes.filter((note) => parseBoardLinks(note.body).some((link) => link.targetId === board.id))
  const linkedNoteIds = new Set(linkedNotes.map((note) => note.id))
  const availableNotes = notes.filter((note) => !linkedNoteIds.has(note.id))
  const sceneRef = useRef<Scene | null>(null)
  const lastSavedRef = useRef(board.sceneJson)
  const timerRef = useRef<number | null>(null)
  const saveInFlight = useRef<Promise<void> | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const closingRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const titleWriteGeneration = useRef(0)

  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  const freshEmptyBoard = (() => {
    try { return ((JSON.parse(board.sceneJson) as { elements?: unknown[] }).elements?.length ?? 0) === 0 }
    catch { return false }
  })()

  useEffect(() => { setTitle(board.title) }, [board.id, board.title])

  useEffect(() => {
    const api = apiRef.current
    const scene = sceneRef.current
    if (!api || !scene) return
    const serialized = serializeScene(scene)
    const refreshed = sceneWithCurrentNoteTitles(serialized, notes)
    if (refreshed === serialized) return
    const parsed = JSON.parse(refreshed) as { elements: OrderedExcalidrawElement[] }
    const nextScene = { ...scene, elements: parsed.elements }
    sceneRef.current = nextScene
    // The current display snapshot becomes the comparison baseline. A title
    // refresh alone must not enqueue a write to the board's sync queue.
    lastSavedRef.current = serializeScene(nextScene)
    api.updateScene({ elements: nextScene.elements as readonly ExcalidrawElement[], captureUpdate: 'NEVER' })
  }, [notes])

  const persist = useCallback(async () => {
    const scene = sceneRef.current
    if (!scene) return true
    const inFlight = saveInFlight.current
    if (inFlight) {
      await inFlight
      return persist()
    }
    const sceneJson = serializeScene(scene)
    const size = new TextEncoder().encode(sceneJson).byteLength
    if (size > MAX_BOARD_JSON_BYTES) {
      setSaveState('large')
      return false
    }
    if (sceneJson === lastSavedRef.current) return true
    setSaveState('saving')
    const write = onSave(sceneJson).then(() => {
      lastSavedRef.current = sceneJson
      setSaveState(size >= BOARD_WARNING_BYTES ? 'warning' : 'saved')
    }).catch((error: unknown) => {
      console.error('five could not save this board locally', error)
      setSaveState('error')
      throw error
    })
    saveInFlight.current = write
    try {
      await write
      return true
    } finally {
      if (saveInFlight.current === write) saveInFlight.current = null
    }
  }, [onSave])

  useEffect(() => {
    const flushBeforeUpdate = (event: Event) => {
      const flushes = (event as CustomEvent<{ flushes?: Promise<void>[] }>).detail?.flushes
      if (!flushes) return
      flushes.push(persist().then(() => undefined))
    }
    window.addEventListener('five:flush-before-update', flushBeforeUpdate)
    return () => window.removeEventListener('five:flush-before-update', flushBeforeUpdate)
  }, [persist])

  const scheduleSave = useCallback((scene: Scene, immediate = false) => {
    sceneRef.current = scene
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void persist().catch(() => {})
    }, immediate ? 80 : 500)
  }, [persist])

  const close = useCallback(async () => {
    if (closingRef.current) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    try {
      if (saveInFlight.current) await saveInFlight.current
      const saved = await persist()
      if (!saved) return
      closingRef.current = true
      onClose()
    } catch {
      // Keep the editor open while the local write is failing so the drawing stays available.
    }
  }, [onClose, persist])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const scene = sceneRef.current
    if (!scene) return
    const sceneJson = serializeScene(scene)
    const size = new TextEncoder().encode(sceneJson).byteLength
    if (sceneJson === lastSavedRef.current || size > MAX_BOARD_JSON_BYTES) return
    void onSaveRef.current(sceneJson).catch((error: unknown) => {
      console.error('five could not flush the board before navigation', error)
    })
  }, [])

  const initialData = useCallback(async () => {
    try {
      const parsed = JSON.parse(sceneWithCurrentNoteTitles(board.sceneJson, notes)) as Record<string, unknown>
      const appState = parsed.appState as Record<string, unknown> | undefined
      const elements = parsed.elements as unknown[] | undefined
      if (!elements?.length && appState?.viewBackgroundColor === '#111111') appState.viewBackgroundColor = '#ffffff'
      return parsed as never
    } catch {
      return null
    }
  }, [board.id, board.sceneJson, notes])

  const insertNoteCard = (note: Note) => {
    const api = apiRef.current
    if (!api) return
    const appState = api.getAppState()
    const zoom = appState.zoom.value || 1
    const x = -appState.scrollX + appState.width / (2 * zoom) - 140
    const y = -appState.scrollY + appState.height / (2 * zoom) - 43
    const elements = convertToExcalidrawElements([{
      type: 'rectangle',
      x,
      y,
      width: 280,
      height: 86,
      backgroundColor: '#1e1e21',
      strokeColor: '#686870',
      fillStyle: 'solid',
      label: { text: `📝  ${note.title || 'Sem título'}`, fontSize: 18, textAlign: 'center', verticalAlign: 'middle' },
      link: `${INTERNAL_NOTE_HREF_PREFIX}${encodeURIComponent(note.id)}`,
    }])
    const next = [...api.getSceneElements(), ...elements]
    api.updateScene({ elements: next, captureUpdate: 'IMMEDIATELY' })
    scheduleSave({ elements: next, appState, files: api.getFiles() }, true)
    setNotePickerOpen(false)
    setNoteSearch('')
  }

  return <main className="board-editor-overlay" aria-label={`Editando quadro ${title || 'Sem título'}`}>
    <header className="board-editor-header">
      <button className="icon-button" onClick={() => void close()} aria-label={returnLabel} title={returnLabel}><ArrowLeft size={18} /></button>
      {!sidebarVisible && !mobile && <button className="icon-button board-sidebar-toggle" onClick={onToggleSidebar} aria-label="Mostrar barra lateral" aria-expanded={false} title="Mostrar barra lateral"><PanelLeftOpen size={16} /></button>}
      <Shapes size={17} />
      <input aria-label="Título do quadro" value={title} onChange={(event) => {
        const nextTitle = event.target.value
        const generation = ++titleWriteGeneration.current
        setTitle(nextTitle)
        setSaveState('saving')
        void onTitle(nextTitle).then(() => {
          if (titleWriteGeneration.current === generation) setSaveState('saved')
        }).catch((error: unknown) => {
          console.error('five could not save this board title locally', error)
          if (titleWriteGeneration.current === generation) setSaveState('error')
        })
      }} placeholder="Título do quadro" />
      <span className={`board-save-state ${saveState === 'error' || saveState === 'large' ? 'is-warning' : ''}`} role="status" aria-live="polite" aria-label={`Salvamento local: ${saveState === 'saving' ? 'Salvando' : saveState === 'large' ? 'Limite de 750 KB' : saveState === 'error' ? 'Falha ao salvar' : saveState === 'warning' ? 'Quadro próximo do limite' : 'Salvo neste aparelho'}`}>
        {saveState === 'saving' ? <RefreshCw size={14} className="spin" /> : saveState === 'error' || saveState === 'large' ? <AlertCircle size={14} /> : <Check size={14} />}
        <span className="board-save-label">{saveState === 'saving' ? 'Salvando…' : saveState === 'large' ? 'Limite de 750 KB' : saveState === 'error' ? 'Falha ao salvar' : saveState === 'warning' ? 'Quadro próximo do limite' : 'Salvo neste aparelho'}</span>
      </span>
      <span className={`board-sync-state${syncBusy ? ' is-busy' : ''}`} title={`Estado da sincronização: ${syncLabel}`} aria-label={`Estado da sincronização: ${syncLabel}`} role="status" aria-live="polite">
        {syncBusy ? <RefreshCw size={13} className="spin" /> : offline ? <CloudOff size={13} /> : <Cloud size={13} />}
        <span>{mobile ? syncLabel.startsWith('Sincronização pendente') ? 'Pendente' : syncLabel.startsWith('Sem conexão') ? 'Offline' : syncLabel : syncLabel}</span>
      </span>
      <button className="icon-button board-insert-note" onClick={() => { setNoteSearch(''); setNotePickerOpen(true) }} title="Notas vinculadas e inserir nota" aria-label="Notas vinculadas e inserir nota"><FilePlus2 size={16} /></button>
      <button className="icon-button" onClick={onDelete} title="Excluir quadro" aria-label="Excluir quadro"><Trash2 size={16} /></button>
      <button className="icon-button" onClick={() => downloadBoard({ ...board, title, sceneJson: sceneRef.current ? serializeScene(sceneRef.current) : board.sceneJson })} title="Exportar arquivo Excalidraw" aria-label="Exportar arquivo Excalidraw"><ArrowDownToLine size={17} /></button>
    </header>
    {saveState === 'large' && <div className="board-size-warning" role="alert">Este desenho passou de 750 KB e não foi salvo. Remova alguns elementos para continuar.</div>}
    {saveState === 'error' && <div className="board-size-warning" role="alert">Não foi possível salvar localmente. Mantenha este quadro aberto e tente novamente.</div>}
    <div className="board-excalidraw" onPointerUp={() => {
      const scene = sceneRef.current
      if (scene) scheduleSave(scene, true)
    }}>
      <Excalidraw
        theme="dark"
        langCode="pt-BR"
        name={title || 'five'}
        initialData={initialData}
        excalidrawAPI={(api) => {
          apiRef.current = api
          if (freshEmptyBoard) window.setTimeout(() => {
            if (api.getAppState().viewBackgroundColor !== '#ffffff') api.updateScene({ appState: { theme: 'dark', viewBackgroundColor: '#ffffff' }, captureUpdate: 'IMMEDIATELY' })
            api.refresh()
          }, 1_000)
        }}
        onChange={(elements, appState, files) => {
          if (freshEmptyBoard && elements.length === 0 && appState.viewBackgroundColor !== '#ffffff') {
            apiRef.current?.updateScene({ appState: { theme: 'dark', viewBackgroundColor: '#ffffff' }, captureUpdate: 'IMMEDIATELY' })
          }
          scheduleSave({ elements, appState, files })
        }}
        onPaste={(data, event) => {
          if (!data.files?.length) return false
          event?.preventDefault()
          return true
        }}
        onLinkOpen={(element, event) => {
          const href = element.link
          if (!href?.startsWith(INTERNAL_NOTE_HREF_PREFIX)) return
          event.detail.nativeEvent.preventDefault()
          let targetId = href.slice(INTERNAL_NOTE_HREF_PREFIX.length)
          try { targetId = decodeURIComponent(targetId) } catch { return }
          const target = notes.find((note) => note.id === targetId)
          if (!target) {
            onUnavailableNote()
            return
          }
          void (async () => { if (await persist()) onSelectNote(target) })()
        }}
        UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false } }}
        autoFocus
      />
    </div>
    {notePickerOpen && <div className="modal-backdrop board-note-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNotePickerOpen(false) }}><section className="modal-card link-modal" role="dialog" aria-modal="true" aria-labelledby="board-note-picker-title">
      <div className="modal-heading"><div><p className="eyebrow">QUADRO</p><h2 id="board-note-picker-title">Notas do quadro</h2></div><button className="icon-button" onClick={() => setNotePickerOpen(false)} aria-label="Fechar"><X size={17} /></button></div>
      <h3 className="link-picker-section-title">Mencionam este quadro</h3>
      <div className="link-picker-list board-backlinks">{linkedNotes.map((note) => <button key={note.id} className="link-picker-item" onClick={() => {
        void (async () => { if (await persist()) { setNotePickerOpen(false); onSelectNote(note) } })()
      }}><Shapes size={15} /><span>{note.title || 'Sem título'}</span></button>)}{!linkedNotes.length && <p className="empty-picker">Nenhuma nota menciona este quadro ainda.</p>}</div>
      <h3 className="link-picker-section-title">Inserir nota no quadro</h3>
      <label className="search-field modal-search"><Search size={15} /><input autoFocus value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} placeholder="Buscar nota pelo título" /></label>
      <div className="link-picker-list">{availableNotes.filter((note) => note.title.toLocaleLowerCase('pt-BR').includes(noteSearch.toLocaleLowerCase('pt-BR'))).slice(0, 40).map((note) => <button key={note.id} className="link-picker-item" onClick={() => insertNoteCard(note)}><FilePlus2 size={15} /><span>{note.title || 'Sem título'}</span></button>)}{!availableNotes.length && <p className="empty-picker">Todas as notas disponíveis já estão conectadas.</p>}</div>
    </section></div>}
  </main>
}
