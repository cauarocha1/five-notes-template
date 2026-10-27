import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FileInput, FileText, Folder as FolderIcon, Inbox, MoreVertical, Pencil, Plus, Shapes, Trash2 } from 'lucide-react'
import type { Board, FileMove, Folder, Note } from '../lib/types'

interface Props {
  folders: Folder[]
  files?: Array<Note | Board>
  selectedId: string | null
  selectedFileId?: string | null
  noteCounts: Map<string, number>
  search?: string
  showFiles?: boolean
  onSelect: (folder: Folder) => void
  onSelectFile?: (file: Note | Board) => void
  onCreateNote: (folderId: string) => void
  onCreateBoard: (folderId: string) => void
  onAddFolder: (parentId: string | null) => void
  onRenameFolder: (folder: Folder) => void
  onDeleteFolder: (folder: Folder) => void
  onMoveFolder?: (folder: Folder) => void
  onMoveFiles?: (files: FileMove[], folderId: string) => Promise<number>
  onRenameFile?: (file: Note | Board) => void
  onMoveFile?: (file: Note | Board) => void
  onCopyFileLink?: (file: Note | Board) => void
  onDeleteFile?: (file: Note | Board) => void
}

export function FolderTree({ folders, files = [], selectedId, selectedFileId = null, noteCounts, search = '', showFiles = false, onSelect, onSelectFile = () => {}, onCreateNote, onCreateBoard, onAddFolder, onRenameFolder, onDeleteFolder, onMoveFolder = () => {}, onMoveFiles = async () => 0, onRenameFile = () => {}, onMoveFile = () => {}, onCopyFileLink = () => {}, onDeleteFile = () => {} }: Props) {
  const hadSavedExpansion = useRef((() => { try { return localStorage.getItem('five-folder-tree-expanded') !== null } catch { return false } })())
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('five-folder-tree-expanded') ?? '[]') as string[]) } catch { return new Set() }
  })
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null)
  const [openMenuFileId, setOpenMenuFileId] = useState<string | null>(null)
  const knownFolders = useRef(new Set<string>())
  const initializedFolders = useRef(false)
  const openMenuRef = useRef<HTMLDivElement>(null)
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const openFileMenuRef = useRef<HTMLDivElement>(null)
  const childrenByParent = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>()
    for (const folder of folders) {
      const children = byParent.get(folder.parentId) ?? []
      children.push(folder)
      byParent.set(folder.parentId, children)
    }
    for (const children of byParent.values()) children.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    return byParent
  }, [folders])
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const filesByFolder = useMemo(() => {
    const inbox = folders.find((folder) => folder.name === 'Entrada' && !folder.parentId)?.id
    const byFolder = new Map<string, Array<Note | Board>>()
    for (const file of files) {
      const folderId = file.folderId ?? inbox
      if (!folderId) continue
      const items = byFolder.get(folderId) ?? []
      items.push(file)
      byFolder.set(folderId, items)
    }
    for (const items of byFolder.values()) items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return byFolder
  }, [files, folders])
  const folderStructureKey = folders.map((folder) => `${folder.id}:${folder.parentId ?? ''}`).join('\u0000')
  useEffect(() => {
    if (!openMenuFolderId) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !openMenuRef.current?.contains(event.target)) setOpenMenuFolderId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpenMenuFolderId(null)
      menuButtonRefs.current.get(openMenuFolderId)?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuFolderId])
  useEffect(() => {
    if (!openMenuFileId) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !openFileMenuRef.current?.contains(event.target)) setOpenMenuFileId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuFileId(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuFileId])
  useEffect(() => {
    if (!folders.length) return
    if (!initializedFolders.current) {
      initializedFolders.current = true
      for (const folder of folders) knownFolders.current.add(folder.id)
      setExpanded((old) => {
        const next = new Set(old)
        if (!hadSavedExpansion.current) for (const folder of folders) next.add(folder.id)
        let selected = selectedId ? folderById.get(selectedId) : undefined
        const selectedPath = new Set<string>()
        while (selected && !selectedPath.has(selected.id)) {
          selectedPath.add(selected.id)
          next.add(selected.id)
          selected = selected.parentId ? folderById.get(selected.parentId) : undefined
        }
        return next
      })
      return
    }
    const newlyAdded = folders.filter((folder) => !knownFolders.current.has(folder.id))
    for (const folder of newlyAdded) knownFolders.current.add(folder.id)
    setExpanded((old) => {
      const next = new Set(old)
      for (const folder of newlyAdded) {
        let current: Folder | undefined = folder
        const visited = new Set<string>()
        while (current && !visited.has(current.id)) {
          visited.add(current.id)
          next.add(current.id)
          current = current.parentId ? folderById.get(current.parentId) : undefined
        }
      }
      let selected = selectedId ? folderById.get(selectedId) : undefined
      const selectedPath = new Set<string>()
      while (selected && !selectedPath.has(selected.id)) {
        selectedPath.add(selected.id)
        next.add(selected.id)
        selected = selected.parentId ? folderById.get(selected.parentId) : undefined
      }
      return next
    })
  }, [folderStructureKey, selectedId])
  useEffect(() => {
    try { localStorage.setItem('five-folder-tree-expanded', JSON.stringify([...expanded])) } catch { /* Expansion remains usable if storage is unavailable. */ }
  }, [expanded])
  useEffect(() => {
    if (!search.trim() || !showFiles) return
    setExpanded((current) => {
      const next = new Set(current)
      for (const file of files) {
        let folder = file.folderId ? folderById.get(file.folderId) : undefined
        const visited = new Set<string>()
        while (folder && !visited.has(folder.id)) {
          visited.add(folder.id)
          next.add(folder.id)
          folder = folder.parentId ? folderById.get(folder.parentId) : undefined
        }
      }
      return next.size === current.size ? current : next
    })
  }, [search, showFiles, files, folderById])
  const handleDrop = (event: React.DragEvent, targetFolderId: string) => {
    const folderId = event.dataTransfer.getData('application/x-five-folder')
    const fileData = event.dataTransfer.getData('application/x-five-file')
    if (!folderId && !fileData) return
    event.preventDefault()
    event.stopPropagation()
    if (folderId) {
      const source = folderById.get(folderId)
      if (source) onMoveFolder({ ...source, parentId: targetFolderId })
    } else {
      try {
        const move = JSON.parse(fileData) as FileMove
        if ((move.entity === 'note' || move.entity === 'board') && move.entityId) void onMoveFiles([move], targetFolderId)
      } catch { /* Ignore malformed drag payloads. */ }
    }
  }
  const renderFolder = (folder: Folder, ancestors = new Set<string>()) => {
    if (ancestors.has(folder.id)) return null
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(folder.id)
    const children = childrenByParent.get(folder.id) ?? []
    const isExpanded = expanded.has(folder.id)
    const isInbox = folder.name === 'Entrada' && !folder.parentId
    return (
      <div key={folder.id} className="folder-tree-entry">
        <div className={`folder-row ${selectedId === folder.id ? 'is-selected' : ''}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-five-folder', folder.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-five-folder') || event.dataTransfer.types.includes('application/x-five-file')) event.preventDefault() }} onDrop={(event) => handleDrop(event, folder.id)}>
          {children.length ? (
            <button className="tree-toggle icon-button" aria-label={isExpanded ? `Recolher ${folder.name}` : `Expandir ${folder.name}`} aria-expanded={isExpanded} onClick={() => setExpanded((old) => { const next = new Set(old); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next })}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : <span className="tree-spacer" />}
          <button className="folder-select" onClick={() => onSelect(folder)} aria-current={selectedId === folder.id ? 'page' : undefined}>
            {isInbox ? <Inbox size={15} /> : <FolderIcon size={15} />}
            <span>{folder.name}</span>
            <small>{noteCounts.get(folder.id) ?? 0}</small>
          </button>
          <div className="folder-menu-wrap" ref={openMenuFolderId === folder.id ? openMenuRef : undefined}>
            <button
              ref={(element) => { if (element) menuButtonRefs.current.set(folder.id, element); else menuButtonRefs.current.delete(folder.id) }}
              className="icon-button folder-actions-trigger"
              aria-label={`Ações da pasta ${folder.name}`}
              title={`Criar ou organizar em ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={openMenuFolderId === folder.id}
              aria-controls={`folder-menu-${folder.id}`}
              data-folder-actions-id={folder.id}
              onClick={() => setOpenMenuFolderId((current) => current === folder.id ? null : folder.id)}
            ><Plus size={15} /></button>
            {openMenuFolderId === folder.id && <div className="folder-menu-popover" id={`folder-menu-${folder.id}`} role="menu" aria-label={`Ações da pasta ${folder.name}`}>
              <button role="menuitem" onClick={() => { setOpenMenuFolderId(null); onCreateNote(folder.id) }}><FileText size={14} />Criar nova nota</button>
              <button role="menuitem" onClick={() => { setOpenMenuFolderId(null); onCreateBoard(folder.id) }}><Shapes size={14} />Criar novo quadro</button>
              <button role="menuitem" onClick={() => { setOpenMenuFolderId(null); onAddFolder(folder.id) }}><FolderIcon size={14} />Criar subpasta</button>
              {!isInbox && <button role="menuitem" onClick={() => { setOpenMenuFolderId(null); onMoveFolder(folder) }}><FolderIcon size={14} />Mover para…</button>}
              <button role="menuitem" onClick={() => { setOpenMenuFolderId(null); onRenameFolder(folder) }}><Pencil size={14} />Renomear</button>
              {!isInbox && <button role="menuitem" className="danger-action" onClick={() => { setOpenMenuFolderId(null); onDeleteFolder(folder) }}><Trash2 size={14} />Excluir pasta</button>}
            </div>}
          </div>
        </div>
        {showFiles && isExpanded && (filesByFolder.get(folder.id) ?? []).map((file) => {
          const isBoard = 'sceneJson' in file
          const itemKey = `${isBoard ? 'board' : 'note'}:${file.id}`
          return <div key={itemKey} className={`tree-file-entry${selectedFileId === file.id ? ' is-selected' : ''}`}>
            <button className="tree-file-row" draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-five-file', JSON.stringify({ entity: isBoard ? 'board' : 'note', entityId: file.id } satisfies FileMove)); event.dataTransfer.effectAllowed = 'move' }} onClick={() => onSelectFile(file)} aria-current={selectedFileId === file.id ? 'page' : undefined} title={file.title || 'Sem título'}>
              {isBoard ? <Shapes size={14} /> : <FileText size={14} />}<span>{file.title || 'Sem título'}</span>
            </button>
            <div className="tree-file-actions" ref={openMenuFileId === itemKey ? openFileMenuRef : undefined}>
              <button className="icon-button tree-file-actions-trigger" aria-label={`Ações: ${file.title || 'Sem título'}`} aria-haspopup="menu" aria-expanded={openMenuFileId === itemKey} onClick={() => setOpenMenuFileId((current) => current === itemKey ? null : itemKey)}><MoreVertical size={14} /></button>
              {openMenuFileId === itemKey && <div className="folder-menu-popover tree-file-menu" role="menu" aria-label={`Ações de ${file.title || 'Sem título'}`}>
                <button role="menuitem" onClick={() => { setOpenMenuFileId(null); onRenameFile(file) }}><Pencil size={14} />Renomear</button>
                <button role="menuitem" onClick={() => { setOpenMenuFileId(null); onMoveFile(file) }}><FileInput size={14} />Mover para…</button>
                <button role="menuitem" onClick={() => { setOpenMenuFileId(null); onCopyFileLink(file) }}><Copy size={14} />Copiar link</button>
                <button className="danger-action" role="menuitem" onClick={() => { setOpenMenuFileId(null); onDeleteFile(file) }}><Trash2 size={14} />Excluir</button>
              </div>}
            </div>
          </div>
        })}
        {isExpanded && children.length > 0 && <div className="folder-tree-children" role="group" aria-label={`Subpastas de ${folder.name}`}>{children.map((child) => renderFolder(child, nextAncestors))}</div>}
      </div>
    )
  }
  const roots = [...(childrenByParent.get(null) ?? [])]
  const reachable = new Set<string>()
  const markReachable = (folderId: string, ancestors = new Set<string>()) => {
    if (ancestors.has(folderId) || reachable.has(folderId)) return
    reachable.add(folderId)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(folderId)
    for (const child of childrenByParent.get(folderId) ?? []) markReachable(child.id, nextAncestors)
  }
  for (const root of roots) markReachable(root.id)
  for (const folder of folders) {
    if (reachable.has(folder.id)) continue
    roots.push(folder)
    markReachable(folder.id)
  }
  return <nav className="folder-tree" aria-label="Pastas">{roots.map((folder) => renderFolder(folder))}</nav>
}
