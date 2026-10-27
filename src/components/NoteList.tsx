import { Copy, FileInput, FileText, MoreVertical, Pencil, Plus, Search, Shapes, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Board, FileMove, Folder, Note } from '../lib/types'
import { noteBodyText } from '../lib/links'
import { shortcutModifier } from '../lib/shortcuts'

interface Props {
  folder: Folder | null
  folders: Folder[]
  notes: Note[]
  boards: Board[]
  selectedId: string | null
  search: string
  searchRef: RefObject<HTMLInputElement | null>
  onSearch: (value: string) => void
  onSelect: (item: Note | Board) => void
  onNew: () => void
  onNewBoard: () => void
  onMoveFiles: (files: FileMove[], folderId: string) => Promise<number>
  onRenameItem?: (item: Note | Board) => void
  onMoveItem?: (item: Note | Board) => void
  onCopyItemLink?: (item: Note | Board) => void
  onDeleteItem?: (item: Note | Board) => void
}

export function NoteList({ folder, folders, notes, boards, selectedId, search, searchRef, onSearch, onSelect, onNew, onNewBoard, onMoveFiles, onRenameItem = () => {}, onMoveItem = () => {}, onCopyItemLink = () => {}, onDeleteItem = () => {} }: Props) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [activeItemMenu, setActiveItemMenu] = useState<string | null>(null)
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(() => new Set())
  const [moveTargetId, setMoveTargetId] = useState('')
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const createMenuRef = useRef<HTMLDivElement>(null)
  const files = [...notes, ...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selectedFiles = files.filter((item) => selectedFileKeys.has(fileKey(item)))
  const selectedFileMoves = selectedFiles.map((item): FileMove => ({ entity: 'sceneJson' in item ? 'board' : 'note', entityId: item.id }))
  const folderOptions = useMemo(() => folders.slice().sort((a, b) => folderPath(a.id, folders).localeCompare(folderPath(b.id, folders), 'pt-BR')), [folders])

  useEffect(() => {
    if (!createMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !createMenuRef.current?.contains(event.target) && !createButtonRef.current?.contains(event.target)) setCreateMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCreateMenuOpen(false)
      createButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [createMenuOpen])

  useEffect(() => {
    if (!activeItemMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.note-item-actions')) setActiveItemMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveItemMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [activeItemMenu])

  useEffect(() => {
    const visibleFileKeys = new Set([...notes, ...boards].map(fileKey))
    setSelectedFileKeys((current) => {
      const next = new Set([...current].filter((key) => visibleFileKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [notes, boards])

  const moveSelected = async () => {
    if (!moveTargetId || !selectedFileMoves.length) return
    const count = await onMoveFiles(selectedFileMoves, moveTargetId)
    if (count) {
      setSelectedFileKeys(new Set())
      setMoveTargetId('')
    }
  }

  return (
    <section className="note-list-panel" aria-label="Arquivos">
      <div className="list-heading">
        <div><p className="eyebrow">{search ? 'TODO O ESPAÇO' : 'PASTA'}</p><h2>{search ? 'Resultados' : folder?.name ?? 'Todas as notas'}</h2></div>
        <div className="create-file-menu-wrap">
          <button ref={createButtonRef} className="icon-button new-note-icon" aria-label="Criar nota ou quadro" title={`Criar nota ou quadro em ${search ? 'Entrada' : folder?.name ?? 'Entrada'}`} aria-haspopup="menu" aria-controls="create-file-menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((value) => !value)}><Plus size={18} /></button>
          {createMenuOpen && <div ref={createMenuRef} className="create-file-menu" id="create-file-menu" role="menu" aria-label="Tipo de arquivo"><button role="menuitem" onClick={() => { setCreateMenuOpen(false); onNew() }}><FileText size={15} /> Nota</button><button role="menuitem" onClick={() => { setCreateMenuOpen(false); onNewBoard() }}><Shapes size={15} /> Quadro</button></div>}
        </div>
      </div>
      <label className="search-field"><Search size={15} /><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar em todo o espaço" aria-label="Buscar em todo o espaço" /><kbd title={`Atalho para focar a busca: ${shortcutModifier}+K`}>{shortcutModifier} K</kbd></label>
      {selectedFiles.length > 0 && <div className="note-selection-toolbar" role="toolbar" aria-label="Mover arquivos selecionados"><span>{selectedFiles.length} {selectedFiles.length === 1 ? 'arquivo selecionado' : 'arquivos selecionados'}</span><select aria-label="Pasta de destino" value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)}><option value="">Mover para…</option>{folderOptions.map((target) => <option key={target.id} value={target.id}>{folderPath(target.id, folders)}</option>)}</select><button className="text-button" onClick={() => void moveSelected()} disabled={!moveTargetId}>Mover</button><button className="icon-button clear-note-selection" aria-label="Limpar seleção" title="Limpar seleção" onClick={() => { setSelectedFileKeys(new Set()); setMoveTargetId('') }}><X size={13} /></button></div>}
      <div className="note-items" role="list">
        {files.length ? files.map((item) => (
          <div key={`${'sceneJson' in item ? 'board' : 'note'}:${item.id}`} role="listitem">
            <div className={`note-list-row${selectedId === item.id ? ' is-current' : ''}${selectedFileKeys.has(fileKey(item)) ? ' is-move-selected' : ''}`}>
              <button className={`note-item ${selectedId === item.id ? 'is-selected' : ''}${'sceneJson' in item ? ' is-board-item' : ''}`} onClick={() => onSelect(item)} aria-current={selectedId === item.id ? 'page' : undefined}>
                {'sceneJson' in item ? <Shapes size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
                <span className="note-item-copy"><strong>{item.title || 'Sem título'}</strong><small>{'sceneJson' in item ? 'Quadro' : preview(item.body, boards)}</small></span>
                <time>{relativeTime(item.updatedAt)}</time>
              </button>
              <div className="note-item-actions" data-file-menu={fileKey(item)}>
                <button className="icon-button note-item-menu-trigger" aria-label={`Ações: ${item.title || 'Sem título'}`} aria-haspopup="menu" aria-expanded={activeItemMenu === fileKey(item)} onClick={() => setActiveItemMenu((current) => current === fileKey(item) ? null : fileKey(item))}><MoreVertical size={16} /></button>
                {activeItemMenu === fileKey(item) && <div className="folder-menu-popover note-item-menu" role="menu" aria-label={`Ações de ${item.title || 'Sem título'}`}>
                  <button role="menuitem" onClick={() => { setActiveItemMenu(null); onRenameItem(item) }}><Pencil size={14} /> Renomear</button>
                  <button role="menuitem" onClick={() => { setActiveItemMenu(null); onMoveItem(item) }}><FileInput size={14} /> Mover para…</button>
                  <button role="menuitem" onClick={() => { setActiveItemMenu(null); onCopyItemLink(item) }}><Copy size={14} /> Copiar link</button>
                  <button className="danger-action" role="menuitem" onClick={() => { setActiveItemMenu(null); onDeleteItem(item) }}><Trash2 size={14} /> Excluir</button>
                </div>}
              </div>
              <input className="note-selection-checkbox" type="checkbox" aria-label={`Selecionar ${'sceneJson' in item ? 'quadro' : 'nota'}: ${item.title || 'Sem título'}`} checked={selectedFileKeys.has(fileKey(item))} onChange={(event) => setSelectedFileKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(fileKey(item)); else next.delete(fileKey(item)); return next })} />
            </div>
          </div>
        )) : (
          <div className="empty-notes"><FileText size={18} /><p>{search ? 'Nenhum resultado neste espaço.' : 'Esta pasta está vazia.'}</p>{!search && <button className="text-button" onClick={() => { setCreateMenuOpen(true); window.setTimeout(() => createButtonRef.current?.focus(), 0) }}>Criar nota ou quadro</button>}</div>
        )}
      </div>
    </section>
  )
}

function preview(markdown: string, boards: Board[]) {
  return noteBodyText(markdown, (id) => boards.find((board) => board.id === id)?.title).replace(/[#>*_`~\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 88) || 'Sem conteúdo ainda'
}

function fileKey(item: Note | Board) {
  return `${'sceneJson' in item ? 'board' : 'note'}:${item.id}`
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diff) || diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function folderPath(folderId: string, folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parts: string[] = []
  const seen = new Set<string>()
  let current = byId.get(folderId)
  while (current && !seen.has(current.id) && parts.length < 32) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return parts.join(' / ') || 'Sem pasta'
}
