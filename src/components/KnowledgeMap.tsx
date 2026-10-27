import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { ArrowLeft, ArrowUpRight, FileText, FolderInput, Link2, Minus, Network, Pencil, Plus, Save, Scan, Shapes, Target, Trash2, Unlink, X } from 'lucide-react'
import { buildKnowledgeEdges, KNOWLEDGE_NODE_HEIGHT, KNOWLEDGE_NODE_WIDTH, knowledgeFolderPath, layoutKnowledgeGraph } from '../lib/knowledgeGraph'
import type { Board, Folder, Note } from '../lib/types'
import type { KnowledgeItem } from '../lib/knowledgeGraph'

type SavedPositions = Record<string, { x: number; y: number }>
type ActiveDrag = { noteId: string; pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number; moved: boolean }
type ActivePan = { pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number; moved: boolean }
type ActionPane = 'edit' | 'move' | 'unlink' | null
const positionStorageKey = 'five-knowledge-map-positions-v1'
const cameraStorageKey = 'five-knowledge-map-camera-v1'

function readSavedCamera() {
  if (typeof window === 'undefined') return { x: 0, y: 0, zoom: 1 }
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(cameraStorageKey) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return { x: 0, y: 0, zoom: 1 }
    const view = parsed as { x?: unknown; y?: unknown; zoom?: unknown }
    if (!Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return { x: 0, y: 0, zoom: 1 }
    return { x: view.x as number, y: view.y as number, zoom: Math.min(1.8, Math.max(0.03, view.zoom as number)) }
  } catch {
    return { x: 0, y: 0, zoom: 1 }
  }
}

function readSavedPositions(): SavedPositions {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(positionStorageKey) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      if (!value || typeof value !== 'object') return false
      const position = value as { x?: unknown; y?: unknown }
      return Number.isFinite(position.x) && Number.isFinite(position.y)
    })) as SavedPositions
  } catch {
    return {}
  }
}

interface Props {
  notes: Note[]
  boards?: Board[]
  folders: Folder[]
  selectedId: string | null
  onSelect: (item: KnowledgeItem) => void
  onCreateRelation: (source: KnowledgeItem, target: KnowledgeItem) => Promise<'created' | 'exists' | 'error'>
  onRemoveRelation?: (source: KnowledgeItem, target: KnowledgeItem) => Promise<'removed' | 'error'>
  onRenameItem?: (item: KnowledgeItem, title: string) => Promise<boolean>
  onMoveItem?: (item: KnowledgeItem, folderId: string) => Promise<boolean>
  onDeleteItem?: (item: KnowledgeItem) => void
  onClose: () => void
}

export function KnowledgeMap({ notes, boards = [], folders, selectedId, onSelect, onCreateRelation, onRemoveRelation = async () => 'error', onRenameItem, onMoveItem, onDeleteItem, onClose }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 900, height: 600 })
  const [initialCamera] = useState(readSavedCamera)
  const [zoom, setZoom] = useState(initialCamera.zoom)
  const [camera, setCamera] = useState({ x: initialCamera.x, y: initialCamera.y })
  const [isPanning, setIsPanning] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | null>(selectedId)
  const [actionPane, setActionPane] = useState<ActionPane>(null)
  const [editTitle, setEditTitle] = useState('')
  const [moveFolderId, setMoveFolderId] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [connectionMode, setConnectionMode] = useState(false)
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null)
  const [savedPositions, setSavedPositions] = useState<SavedPositions>(readSavedPositions)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const activePanRef = useRef<ActivePan | null>(null)
  const draggedNoteRef = useRef<string | null>(null)
  const activeNotes = useMemo(() => notes.filter((note) => !note.deletedAt), [notes])
  const activeBoards = useMemo(() => boards.filter((board) => !board.deletedAt), [boards])
  const activeItems = useMemo(() => [...activeNotes, ...activeBoards], [activeNotes, activeBoards])
  const edges = useMemo(() => buildKnowledgeEdges(activeNotes, activeBoards), [activeNotes, activeBoards])
  const layout = useMemo(() => layoutKnowledgeGraph(activeItems, edges, viewport.width, viewport.height), [activeItems, edges, viewport])
  const itemById = useMemo(() => new Map(activeItems.map((item) => [item.id, item])), [activeItems])
  const positions = useMemo(() => layout.positions.map((position) => {
    const saved = savedPositions[position.id]
    if (!saved) return position
    return {
      ...position,
      x: saved.x,
      y: saved.y,
    }
  }), [layout.positions, savedPositions])
  const positionById = useMemo(() => new Map(positions.map((position) => [position.id, position])), [positions])
  const edgeKey = (sourceId: string, targetId: string) => [sourceId, targetId].sort().join('\u0000')
  const selectedEdge = edges.find((edge) => edgeKey(edge.sourceId, edge.targetId) === selectedEdgeKey) ?? null
  const selectedItem = activeItemId ? itemById.get(activeItemId) ?? null : null
  const relatedItems = selectedItem ? edges.flatMap((edge) => {
    const relatedId = edge.sourceId === selectedItem.id ? edge.targetId : edge.targetId === selectedItem.id ? edge.sourceId : null
    const item = relatedId ? itemById.get(relatedId) : null
    return item ? [item] : []
  }) : []
  const folderOptions = useMemo(() => folders.slice().sort((a, b) => knowledgeFolderPath(a.id, folders).localeCompare(knowledgeFolderPath(b.id, folders), 'pt-BR')), [folders])

  useEffect(() => {
    try {
      window.localStorage.setItem(positionStorageKey, JSON.stringify(savedPositions))
    } catch {
      // Keep dragging usable when browser storage is unavailable or full.
    }
  }, [savedPositions])

  useEffect(() => {
    try {
      window.localStorage.setItem(cameraStorageKey, JSON.stringify({ x: camera.x, y: camera.y, zoom }))
    } catch {
      // Keep map navigation available if browser storage is unavailable or full.
    }
  }, [camera, zoom])

  useEffect(() => {
    if (selectedEdgeKey && !edges.some((edge) => edgeKey(edge.sourceId, edge.targetId) === selectedEdgeKey)) setSelectedEdgeKey(null)
  }, [edges, selectedEdgeKey])

  useEffect(() => {
    if (selectedId) setActiveItemId(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (activeItemId && !itemById.has(activeItemId)) {
      setActiveItemId(null)
      setActionPane(null)
    }
  }, [activeItemId, itemById])

  useEffect(() => {
    if (selectedItem) {
      setEditTitle(selectedItem.title)
      setMoveFolderId(selectedItem.folderId ?? '')
    }
    setActionPane(null)
  }, [activeItemId])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = () => {
      const bounds = element.getBoundingClientRect()
      setViewport({ width: Math.max(320, bounds.width), height: Math.max(320, bounds.height) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const setClampedZoom = (next: number, anchorX = viewport.width / 2, anchorY = viewport.height / 2) => {
    const clamped = Math.min(1.8, Math.max(0.03, next))
    setCamera((current) => ({
      x: current.x + anchorX / zoom - anchorX / clamped,
      y: current.y + anchorY / zoom - anchorY / clamped,
    }))
    setZoom(clamped)
  }
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    setClampedZoom(zoom * Math.exp(-event.deltaY * 0.0012), event.clientX - bounds.left, event.clientY - bounds.top)
  }
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target
    if (target instanceof Element && target.closest('.map-node, .map-edge-hit, .map-item-actions')) return
    event.preventDefault()
    setActiveItemId(null)
    setSelectedEdgeKey(null)
    setActionPane(null)
    setIsPanning(true)
    activePanRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: camera.x, startY: camera.y, moved: false }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is optional. */ }
  }
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = activePanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const deltaX = event.clientX - pan.startClientX
    const deltaY = event.clientY - pan.startClientY
    if (Math.hypot(deltaX, deltaY) > 3) pan.moved = true
    setCamera({ x: pan.startX - deltaX / zoom, y: pan.startY - deltaY / zoom })
  }
  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePanRef.current?.pointerId !== event.pointerId) return
    activePanRef.current = null
    setIsPanning(false)
  }
  const moveDraggedNote = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = activeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startClientX
    const deltaY = event.clientY - drag.startClientY
    if (Math.hypot(deltaX, deltaY) > 3) drag.moved = true
    const x = drag.startX + deltaX / zoom
    const y = drag.startY + deltaY / zoom
    setSavedPositions((current) => ({ ...current, [drag.noteId]: { x, y } }))
  }
  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = activeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) draggedNoteRef.current = drag.noteId
    activeDragRef.current = null
  }
  const fitMap = () => {
    if (!positions.length) {
      setZoom(1)
      setCamera({ x: 0, y: 0 })
      setSelectedEdgeKey(null)
      return
    }
    const margin = 72
    const minX = Math.min(...positions.map((position) => position.x))
    const minY = Math.min(...positions.map((position) => position.y))
    const maxX = Math.max(...positions.map((position) => position.x + KNOWLEDGE_NODE_WIDTH))
    const maxY = Math.max(...positions.map((position) => position.y + KNOWLEDGE_NODE_HEIGHT))
    const contentWidth = maxX - minX + margin * 2
    const contentHeight = maxY - minY + margin * 2
    const nextZoom = Math.max(0.03, Math.min(1, (viewport.width - 24) / contentWidth, (viewport.height - 24) / contentHeight))
    const visibleWidth = viewport.width / nextZoom
    const visibleHeight = viewport.height / nextZoom
    setZoom(nextZoom)
    setCamera({ x: minX - margin + (contentWidth - visibleWidth) / 2, y: minY - margin + (contentHeight - visibleHeight) / 2 })
    setSelectedEdgeKey(null)
  }
  const centerSelection = () => {
    const position = activeItemId ? positionById.get(activeItemId) : null
    if (!viewportRef.current || !position) return fitMap()
    setCamera({ x: position.x + KNOWLEDGE_NODE_WIDTH / 2 - viewport.width / zoom / 2, y: position.y + KNOWLEDGE_NODE_HEIGHT / 2 - viewport.height / zoom / 2 })
  }
  const selectEdge = (key: string) => {
    if (connectionMode) return
    setActiveItemId(null)
    setActionPane(null)
    setSelectedEdgeKey(key)
  }
  const toggleConnectionMode = () => {
    activeDragRef.current = null
    draggedNoteRef.current = null
    setSelectedEdgeKey(null)
    if (connectionMode) {
      setConnectionMode(false)
      setConnectionSourceId(null)
      setConnectionStatus('Modo de conexão encerrado.')
    } else {
      setConnectionMode(true)
      setConnectionStatus('Clique no arquivo de origem e depois no arquivo de destino.')
    }
  }
  const removeSelectedRelation = () => {
    if (!selectedEdge || connectionBusy) return
    const source = itemById.get(selectedEdge.sourceId)
    const target = itemById.get(selectedEdge.targetId)
    if (!source || !target) return
    setConnectionBusy(true)
    void onRemoveRelation(source, target).then((result) => {
      setSelectedEdgeKey(null)
      setConnectionStatus(result === 'removed' ? `Conexão removida: ${source.title || 'Sem título'} — ${target.title || 'Sem título'}.` : 'Não foi possível remover a conexão.')
    }).catch(() => setConnectionStatus('Não foi possível remover a conexão.')).finally(() => setConnectionBusy(false))
  }
  const activateItem = (item: KnowledgeItem) => {
    if (!connectionMode) {
      onSelect(item)
      return
    }
    if (connectionBusy) return
    if (!connectionSourceId) {
      setConnectionSourceId(item.id)
      setConnectionStatus(`Origem: ${item.title || 'Sem título'}. Agora escolha o arquivo de destino.`)
      return
    }
    if (connectionSourceId === item.id) {
      setConnectionSourceId(null)
      setConnectionStatus('Seleção de origem cancelada. Escolha um arquivo para começar.')
      return
    }
    const source = itemById.get(connectionSourceId)
    if (!source) {
      setConnectionSourceId(null)
      setConnectionStatus('O arquivo de origem não está mais disponível. Escolha outro.')
      return
    }
    if ('sceneJson' in source && 'sceneJson' in item) {
      setConnectionSourceId(null)
      setConnectionStatus('Conecte uma nota a um quadro, ou duas notas entre si.')
      return
    }
    const alreadyConnected = edges.some((edge) =>
      (edge.sourceId === connectionSourceId && edge.targetId === item.id)
      || (edge.sourceId === item.id && edge.targetId === connectionSourceId),
    )
    if (alreadyConnected) {
      setConnectionSourceId(null)
      setConnectionStatus('Esses arquivos já estão conectados.')
      return
    }
    setConnectionBusy(true)
    void onCreateRelation(source, item)
      .then((result) => {
        setConnectionSourceId(null)
        setConnectionStatus(result === 'created' ? `Relação criada: ${source.title || 'Sem título'} — ${item.title || 'Sem título'}.` : result === 'exists' ? 'Esses arquivos já estão conectados.' : 'Não foi possível salvar a relação.')
      })
      .catch(() => {
        setConnectionSourceId(null)
        setConnectionStatus('Não foi possível salvar a relação.')
      })
      .finally(() => setConnectionBusy(false))
  }

  const beginConnectionFrom = (item: KnowledgeItem) => {
    setSelectedEdgeKey(null)
    setConnectionMode(true)
    setConnectionSourceId(item.id)
    setConnectionStatus(`Origem: ${item.title || 'Sem título'}. Agora escolha o arquivo de destino.`)
    setActionPane(null)
  }

  const saveItemTitle = async () => {
    if (!selectedItem || !onRenameItem || !editTitle.trim() || actionBusy) return
    setActionBusy(true)
    try {
      const saved = await onRenameItem(selectedItem, editTitle.trim())
      setConnectionStatus(saved ? 'Nome atualizado.' : 'Não foi possível atualizar o nome.')
      if (saved) setActionPane(null)
    } catch {
      setConnectionStatus('Não foi possível atualizar o nome.')
    } finally {
      setActionBusy(false)
    }
  }

  const moveItem = async () => {
    if (!selectedItem || !onMoveItem || !moveFolderId || actionBusy) return
    setActionBusy(true)
    try {
      const moved = await onMoveItem(selectedItem, moveFolderId)
      setConnectionStatus(moved ? `Arquivo movido para ${knowledgeFolderPath(moveFolderId, folders)}.` : 'Não foi possível mover o arquivo.')
      if (moved) setActionPane(null)
    } catch {
      setConnectionStatus('Não foi possível mover o arquivo.')
    } finally {
      setActionBusy(false)
    }
  }

  const unlinkItem = async (related: KnowledgeItem) => {
    if (!selectedItem || actionBusy) return
    setActionBusy(true)
    try {
      const result = await onRemoveRelation(selectedItem, related)
      setConnectionStatus(result === 'removed' ? `Relação removida com ${related.title || 'Sem título'}.` : 'Não foi possível remover essa relação.')
    } catch {
      setConnectionStatus('Não foi possível remover essa relação.')
    } finally {
      setActionBusy(false)
    }
  }

  const handleItemClick = (event: ReactMouseEvent<SVGGElement>, item: KnowledgeItem) => {
    event.stopPropagation()
    if (draggedNoteRef.current === item.id) {
      draggedNoteRef.current = null
      return
    }
    if (connectionMode) {
      activateItem(item)
      return
    }
    setSelectedEdgeKey(null)
    setActiveItemId(item.id)
  }

  const handleItemDoubleClick = (event: ReactMouseEvent<SVGGElement>, item: KnowledgeItem) => {
    event.stopPropagation()
    if (connectionMode || draggedNoteRef.current === item.id) return
    setActiveItemId(item.id)
    onSelect(item)
  }

  return (
    <main className="knowledge-map" aria-label="Mapa de conexões entre notas e quadros">
      <header className="map-toolbar">
        <div className="map-title-group">
          <button className="icon-button map-back" onClick={onClose} aria-label="Voltar às notas"><ArrowLeft size={17} /></button>
          <div><p className="eyebrow">TODO O ESPAÇO</p><h1><Network size={17} /> Mapa do conhecimento</h1></div>
          <span className="map-count">{activeItems.length} {activeItems.length === 1 ? 'arquivo' : 'arquivos'} · {edges.length} {edges.length === 1 ? 'conexão' : 'conexões'}</span>
        </div>
        <div className="map-controls" aria-label="Controles do mapa">
          <button className={`icon-button map-connect-button${connectionMode ? ' is-active' : ''}`} onClick={toggleConnectionMode} aria-label={connectionMode ? 'Sair do modo de conexão' : 'Conectar notas e quadros'} aria-pressed={connectionMode} title={connectionMode ? 'Sair do modo de conexão' : 'Conectar notas e quadros'} disabled={connectionBusy}><Link2 size={15} /></button>
          {selectedEdge && !connectionMode && <button className="icon-button map-remove-edge" onClick={removeSelectedRelation} aria-label="Remover conexão selecionada" title="Remover conexão selecionada" disabled={connectionBusy}><Trash2 size={15} /></button>}
          <button className="icon-button" onClick={() => setClampedZoom(zoom - 0.15)} aria-label="Diminuir zoom" title="Diminuir zoom"><Minus size={15} /></button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => setClampedZoom(zoom + 0.15)} aria-label="Aumentar zoom" title="Aumentar zoom"><Plus size={15} /></button>
          <button className="icon-button" onClick={centerSelection} aria-label="Centralizar arquivo selecionado" title="Centralizar arquivo selecionado"><Target size={15} /></button>
          <button className="icon-button" onClick={fitMap} aria-label="Ajustar mapa à tela" title="Ajustar mapa à tela"><Scan size={15} /></button>
        </div>
      </header>

      <div className="map-caption">
        <span>{connectionMode ? connectionBusy ? 'Salvando relação…' : connectionSourceId ? 'Agora clique no arquivo de destino.' : 'Modo Conectar: escolha a origem e depois o destino.' : selectedEdge ? 'Conexão selecionada. Use Remover conexão para desfazer o vínculo.' : 'Um clique mostra as ações. Dois cliques entram no arquivo. Arraste o fundo e use a roda para navegar e ajustar o zoom.'}</span>
        {connectionStatus && <span className="map-connection-status" role="status" aria-live="polite">{connectionStatus}</span>}
      </div>

      <div
        className={`map-viewport${isPanning ? ' is-panning' : ''}`}
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onWheel={handleWheel}
      >
        {activeItems.length ? <svg
          className={`map-canvas${connectionMode ? ' is-connecting' : ''}`}
          width={viewport.width}
          height={viewport.height}
          viewBox={`${camera.x} ${camera.y} ${viewport.width / zoom} ${viewport.height / zoom}`}
          role="group"
          aria-label={`Mapa com ${activeItems.length} ${activeItems.length === 1 ? 'arquivo' : 'arquivos'} e ${edges.length} ${edges.length === 1 ? 'conexão' : 'conexões'}`}
          onPointerMove={moveDraggedNote}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <g className="map-edges">
            {edges.map((edge) => {
              const source = positionById.get(edge.sourceId)
              const target = positionById.get(edge.targetId)
              if (!source || !target) return null
              const x1 = source.x + KNOWLEDGE_NODE_WIDTH / 2
              const y1 = source.y + KNOWLEDGE_NODE_HEIGHT / 2
              const x2 = target.x + KNOWLEDGE_NODE_WIDTH / 2
              const y2 = target.y + KNOWLEDGE_NODE_HEIGHT / 2
              const dx = x2 - x1
              const dy = y2 - y1
              const startT = Math.min((KNOWLEDGE_NODE_WIDTH / 2) / Math.max(1, Math.abs(dx)), (KNOWLEDGE_NODE_HEIGHT / 2) / Math.max(1, Math.abs(dy)))
              const endT = startT
              const startX = x1 + dx * startT
              const startY = y1 + dy * startT
              const endX = x2 - dx * endT
              const endY = y2 - dy * endT
              const key = edgeKey(edge.sourceId, edge.targetId)
              const sourceItem = itemById.get(edge.sourceId)
              const targetItem = itemById.get(edge.targetId)
              const label = `conexão entre ${sourceItem?.title || 'Sem título'} e ${targetItem?.title || 'Sem título'}`
              const bend = Math.max(42, Math.min(132, Math.max(Math.abs(dx), Math.abs(dy)) * .34))
              const d = Math.abs(dx) >= Math.abs(dy)
                ? `M ${startX} ${startY} C ${startX + Math.sign(dx || 1) * bend} ${startY}, ${endX - Math.sign(dx || 1) * bend} ${endY}, ${endX} ${endY}`
                : `M ${startX} ${startY} C ${startX} ${startY + Math.sign(dy || 1) * bend}, ${endX} ${endY - Math.sign(dy || 1) * bend}, ${endX} ${endY}`
              return <g key={key} className={selectedEdgeKey === key ? 'map-edge is-selected' : 'map-edge'}>
                <path className="map-edge-line" d={d} aria-hidden="true" />
                <path className="map-edge-hit" d={d} role="button" tabIndex={0} aria-label={`Selecionar ${label}`} aria-pressed={selectedEdgeKey === key} onClick={() => selectEdge(key)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectEdge(key) } }} />
              </g>
            })}
          </g>
          <g className="map-nodes">
            {positions.map((position) => {
              const item = itemById.get(position.id)
              if (!item) return null
              const folderPath = knowledgeFolderPath(item.folderId, folders)
              const isBoard = 'sceneJson' in item
              const title = item.title.trim() || 'Sem título'
              const displayTitle = title.length > 28 ? `${title.slice(0, 27)}…` : title
              return <g
                key={item.id}
                className={`map-node${isBoard ? ' is-board-node' : ''}${activeItemId === item.id || selectedId === item.id ? ' is-selected' : ''}${connectionSourceId === item.id ? ' is-link-source' : ''}${activeDragRef.current?.noteId === item.id ? ' is-dragging' : ''}`}
                transform={`translate(${position.x} ${position.y})`}
                role="button"
                tabIndex={0}
                aria-label={`Selecionar ${isBoard ? 'quadro' : 'nota'}: ${title}`}
                aria-pressed={connectionMode && connectionSourceId === item.id}
                aria-description={connectionMode ? `Clique para escolher ${isBoard ? 'este quadro' : 'esta nota'} na relação.` : 'Clique para selecionar. Dê dois cliques ou use Entrar para abrir. Arraste para mover este cartão.'}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  draggedNoteRef.current = null
                  if (connectionMode) return
                  activeDragRef.current = { noteId: item.id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: position.x, startY: position.y, moved: false }
                  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is optional. */ }
                }}
                onClick={(event) => handleItemClick(event, item)}
                onDoubleClick={(event) => handleItemDoubleClick(event, item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateItem(item); return }
                  const delta = event.shiftKey ? 72 : 18
                  const offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
                  const offset = offsets[event.key]
                  if (!offset) return
                  event.preventDefault()
                  setSavedPositions((current) => ({ ...current, [item.id]: {
                    x: position.x + offset[0],
                    y: position.y + offset[1],
                  } }))
                }}
              >
                <title>{`${title} · ${folderPath}`}</title>
                <rect width={KNOWLEDGE_NODE_WIDTH} height={KNOWLEDGE_NODE_HEIGHT} rx="9" />
                {isBoard ? <><rect className="map-node-type-icon" x="15" y="10" width="13" height="10" rx="2" /><path className="map-node-type-icon-line" d="M17 22h9" /></> : <><rect className="map-node-type-icon" x="16" y="9" width="11" height="14" rx="1.5" /><path className="map-node-type-icon-line" d="M19 14h5M19 18h5" /></>}
                <text className="map-node-kind" x="34" y="19">{isBoard ? 'QUADRO' : 'NOTA'}</text>
                <text className="map-node-folder" x="15" y="42">{folderPath.length > 36 ? `${folderPath.slice(0, 35)}…` : folderPath}</text>
                <text className="map-node-title" x="15" y="66">{displayTitle}</text>
                <text className="map-node-hint" x="15" y="87">Abrir {isBoard ? 'quadro' : 'nota'}</text>
              </g>
            })}
          </g>
        </svg> : <div className="map-empty"><Network size={24} /><h2>Seu mapa começa com uma nota</h2><p>Crie notas e quadros para visualizar suas conexões.</p></div>}
        {selectedItem && !connectionMode && <section className="map-item-actions" aria-label={`Ações para ${selectedItem.title || 'Sem título'}`} onWheel={(event) => event.stopPropagation()}>
          <div className="map-item-actions-heading">
            <span className="map-item-type">{'sceneJson' in selectedItem ? <Shapes size={13} /> : <FileText size={13} />}{'sceneJson' in selectedItem ? 'Quadro' : 'Nota'} · {knowledgeFolderPath(selectedItem.folderId, folders)}</span>
            <strong>{selectedItem.title || 'Sem título'}</strong>
            <button className="icon-button" aria-label="Fechar ações do arquivo" title="Fechar" onClick={() => { setActiveItemId(null); setActionPane(null) }}><X size={15} /></button>
          </div>
          <div className="map-item-action-buttons">
            <button className="map-item-action" aria-label={`Entrar em ${selectedItem.title || 'Sem título'}`} onClick={() => onSelect(selectedItem)}><ArrowUpRight size={14} />Entrar</button>
            {onRenameItem && <button className={`map-item-action${actionPane === 'edit' ? ' is-active' : ''}`} aria-label={`Editar ${selectedItem.title || 'Sem título'}`} onClick={() => { setActionPane(actionPane === 'edit' ? null : 'edit'); setEditTitle(selectedItem.title) }}><Pencil size={14} />Editar</button>}
            {onMoveItem && <button className={`map-item-action${actionPane === 'move' ? ' is-active' : ''}`} aria-label={`Mover ${selectedItem.title || 'Sem título'}`} onClick={() => { setActionPane(actionPane === 'move' ? null : 'move'); setMoveFolderId(selectedItem.folderId ?? '') }}><FolderInput size={14} />Mover</button>}
            <button className="map-item-action" aria-label={`Vincular ${selectedItem.title || 'Sem título'}`} onClick={() => beginConnectionFrom(selectedItem)}><Link2 size={14} />Linkar</button>
            <button className={`map-item-action${actionPane === 'unlink' ? ' is-active' : ''}`} aria-label={`Desvincular ${selectedItem.title || 'Sem título'}`} onClick={() => setActionPane(actionPane === 'unlink' ? null : 'unlink')}><Unlink size={14} />Desvincular</button>
            {onDeleteItem && <button className="map-item-action is-danger" aria-label={`Excluir ${selectedItem.title || 'Sem título'}`} onClick={() => onDeleteItem(selectedItem)}><Trash2 size={14} />Excluir</button>}
          </div>
          {actionPane === 'edit' && onRenameItem && <form className="map-item-action-form" onSubmit={(event) => { event.preventDefault(); void saveItemTitle() }}>
            <input aria-label="Nome do arquivo" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={180} />
            <button className="map-item-action" type="submit" disabled={!editTitle.trim() || actionBusy}><Save size={14} />Salvar</button>
          </form>}
          {actionPane === 'move' && onMoveItem && <div className="map-item-action-form">
            <select aria-label="Pasta de destino do arquivo" value={moveFolderId} onChange={(event) => setMoveFolderId(event.target.value)}><option value="">Escolher pasta…</option>{folderOptions.map((folder) => <option key={folder.id} value={folder.id}>{knowledgeFolderPath(folder.id, folders)}</option>)}</select>
            <button className="map-item-action" onClick={() => void moveItem()} disabled={!moveFolderId || actionBusy}><FolderInput size={14} />Mover</button>
          </div>}
          {actionPane === 'unlink' && <div className="map-unlink-list" aria-label="Conexões deste arquivo">
            {relatedItems.length ? relatedItems.map((related) => <div key={related.id} className="map-unlink-row"><span>{'sceneJson' in related ? <Shapes size={13} /> : <FileText size={13} />}{related.title || 'Sem título'}</span><button className="map-item-action" onClick={() => void unlinkItem(related)} disabled={actionBusy}><Unlink size={13} />Desvincular</button></div>) : <span className="map-no-links">Este arquivo ainda não tem conexões.</span>}
          </div>}
        </section>}
      </div>
    </main>
  )
}
