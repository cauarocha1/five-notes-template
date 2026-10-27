import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { undo } from '@milkdown/kit/prose/history'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import type { EditorView } from '@milkdown/kit/prose/view'
import { AlertCircle, ArrowLeft, Bold, Check, Clock3, Code2, Heading2, List, Network, Quote, Shapes, Trash2, Undo2, X } from 'lucide-react'
import { boardPreviewProxy } from '../lib/boardFiles'
import { displayBoardEmbeds, displayNoteLinks, formatBoardEmbed, formatNoteLink, INTERNAL_BOARD_HREF_PREFIX, INTERNAL_NOTE_HREF_PREFIX, parseBoardLinks } from '../lib/links'
import { stripRetiredCanvasContent } from '../lib/legacyNoteContent'
import type { Board, Folder, Note } from '../lib/types'

interface Props {
  note: Note | null
  emptyMessage: string
  linkedBoards: Board[]
  breadcrumb: Folder[]
  onNavigateFolder: (folder: Folder) => void
  backlinks: Note[]
  linked: Note[]
  linkTarget: Note | null
  boardLinkTarget: Board | null
  mobile: boolean
  onTitle: (title: string) => Promise<void>
  onBody: (body: string) => Promise<void>
  onSelectNote: (note: Note) => void
  onSelectBoard: (board: Board) => void
  onRequestLinkNote: () => void
  onRequestLinkBoard: () => void
  onLinkConsumed: () => void
  onBoardLinkConsumed: () => void
  onUnavailableBoard: () => void
  onRemoveNoteLink: (target: Note) => void
  onRemoveBoardLink: (target: Board) => void
  onDelete: () => void
  onBack: () => void
}

export function EditorPane({ note, emptyMessage, linkedBoards, breadcrumb, onNavigateFolder, backlinks, linked, linkTarget, boardLinkTarget, mobile, onTitle, onBody, onSelectNote, onSelectBoard, onRequestLinkNote, onRequestLinkBoard, onLinkConsumed, onBoardLinkConsumed, onUnavailableBoard, onRemoveNoteLink, onRemoveBoardLink, onDelete, onBack }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<Crepe | null>(null)
  const onBodyRef = useRef(onBody)
  const onRequestLinkNoteRef = useRef(onRequestLinkNote)
  const onRequestLinkBoardRef = useRef(onRequestLinkBoard)
  const linkedBoardsRef = useRef(linkedBoards)
  const plainBody = note ? stripRetiredCanvasContent(note.body) : ''
  const readableBody = displayBoardEmbeds(displayNoteLinks(plainBody, (id) => linked.find((item) => item.id === id)?.title), (id) => linkedBoards.find((item) => item.id === id)?.title)
  const outline = useMemo(() => note ? markdownOutline(plainBody) : [], [note?.id, plainBody])
  const editorBody = useRef(readableBody)
  const latestBody = useRef(readableBody)
  const editorReady = useRef(false)
  const [editorInitialized, setEditorInitialized] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [localSaveState, setLocalSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveGeneration = useRef(0)

  const runEditorCommand = (run: (view: EditorView) => void) => {
    const instance = editor.current
    if (!instance || !editorReady.current) return
    instance.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      run(view)
      view.focus()
    })
  }

  useEffect(() => {
    onBodyRef.current = onBody
    onRequestLinkNoteRef.current = onRequestLinkNote
    onRequestLinkBoardRef.current = onRequestLinkBoard
    linkedBoardsRef.current = linkedBoards
  }, [onBody, onRequestLinkNote, onRequestLinkBoard, linkedBoards])

  const saveLocally = useCallback(async (operation: () => Promise<void>) => {
    const generation = ++saveGeneration.current
    setLocalSaveState('saving')
    try {
      await operation()
      if (saveGeneration.current === generation) setLocalSaveState('saved')
    } catch (error) {
      console.error('five could not save this note locally', error)
      if (saveGeneration.current === generation) setLocalSaveState('error')
    }
  }, [])

  const applyBody = (markdown: string) => {
    const instance = editor.current
    if (!instance || !editorReady.current || markdown === editorBody.current) return
    const previous = editorBody.current
    editorBody.current = markdown
    try {
      instance.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const parse = ctx.get(parserCtx)
        const document = parse(markdown)
        const current = view.state.doc
        const start = current.content.findDiffStart(document.content)
        if (start === null) return
        const end = current.content.findDiffEnd(document.content)
        if (!end) return
        // Patch only the changed range. Replacing the whole document on a new
        // connection used to reset the caret and make continued typing erratic.
        view.dispatch(view.state.tr.replace(start, end.a, document.slice(start, end.b)))
      })
    } catch (error) {
      editorBody.current = previous
      console.error('five could not apply a synced note body', error)
    }
  }

  useEffect(() => {
    if (!note || !root.current) return
    latestBody.current = readableBody
    editorBody.current = readableBody
    editorReady.current = false
    setEditorInitialized(false)
    const instance = new Crepe({
      root: root.current,
      defaultValue: '',
      featureConfigs: {
        [Crepe.Feature.ImageBlock]: { proxyDomURL: boardPreviewProxy(() => new Map(linkedBoardsRef.current.map((board) => [board.id, board]))) },
        [Crepe.Feature.Placeholder]: { text: 'Comece a escrever…', mode: 'block' },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            const fiveGroup = builder.addGroup('five', 'Five')
            fiveGroup.addItem('link-note', {
              label: 'Vincular nota',
              icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
              onRun: (ctx) => {
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
                onRequestLinkNoteRef.current()
              },
            })
            fiveGroup.addItem('link-board', {
              label: 'Vincular quadro',
              icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="4" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="13" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
              onRun: (ctx) => {
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
                onRequestLinkBoardRef.current()
              },
            })
          },
        },
      },
    })
    editor.current = instance
    let disposed = false
    const creation = instance.create().then(() => {
      if (disposed) return
      editorReady.current = true
      setEditorInitialized(true)
      instance.on((listener) => listener.markdownUpdated((_ctx, markdown) => {
        if (markdown === editorBody.current) return
        editorBody.current = markdown
        latestBody.current = markdown
        void saveLocally(() => onBodyRef.current(markdown))
      }))
      editorBody.current = ''
      applyBody(latestBody.current)
    }).catch((error) => {
      if (!disposed) console.error('five could not initialize the note editor', error)
    })
    return () => {
      disposed = true
      editorReady.current = false
      editor.current = null
      void creation.then(() => instance.destroy()).catch(() => {})
    }
  }, [note?.id, saveLocally])

  useEffect(() => {
    const flushBeforeUpdate = (event: Event) => {
      const flushes = (event as CustomEvent<{ flushes?: Promise<void>[] }>).detail?.flushes
      if (!flushes || !note) return
      flushes.push(saveLocally(() => onBodyRef.current(latestBody.current)))
    }
    window.addEventListener('five:flush-before-update', flushBeforeUpdate)
    return () => window.removeEventListener('five:flush-before-update', flushBeforeUpdate)
  }, [note?.id, saveLocally])

  useEffect(() => {
    if (!note) return
    latestBody.current = readableBody
    applyBody(readableBody)
  }, [note?.id, readableBody])

  useEffect(() => {
    const container = root.current
    if (!container || !editorInitialized) return
    const makeCardsAccessible = () => {
      for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="https://five-note.invalid/note/"]')) {
        link.classList.add('five-note-link-card')
      }
      const references = parseBoardLinks(plainBody)
      const cards = [...container.querySelectorAll<HTMLElement>('.milkdown-image-block, .milkdown-image-inline')]
      cards.forEach((card, index) => {
        let href = boardHrefAtElement(editor.current, card)
        const fallbackReference = references[index]
        if (!href?.startsWith(INTERNAL_BOARD_HREF_PREFIX) && fallbackReference) {
          href = `${INTERNAL_BOARD_HREF_PREFIX}${encodeURIComponent(fallbackReference.targetId)}`
        }
        if (!href?.startsWith(INTERNAL_BOARD_HREF_PREFIX)) return
        let targetId = href.slice(INTERNAL_BOARD_HREF_PREFIX.length)
        try { targetId = decodeURIComponent(targetId) } catch { /* Keep the stored ID when an old link is malformed. */ }
        const board = linkedBoardsRef.current.find((item) => item.id === targetId)
        const image = card.querySelector<HTMLImageElement>('img[data-type="image-block"], img.image-inline, img')
        const savedTitle = image?.alt.replace(/^Quadro:\s*/i, '').trim() || 'Sem título'
        const reference = references.find((item) => item.targetId === targetId)
        const label = `Quadro: ${board?.title.trim() || reference?.label || savedTitle}`
        if (image) image.alt = label
        card.setAttribute('role', 'link')
        card.setAttribute('tabindex', '0')
        card.setAttribute('aria-label', label)
        card.dataset.fiveBoardCard = 'true'
        card.dataset.fiveBoardHref = href
      })
    }
    makeCardsAccessible()
    const observer = new MutationObserver(makeCardsAccessible)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [editorInitialized, readableBody])

  useEffect(() => {
    if (!root.current || !editorInitialized || !outline.length) return
    const headings = root.current.querySelectorAll<HTMLElement>('h1, h2, h3')
    outline.forEach((entry, index) => {
      const heading = headings[index]
      if (!heading) return
      heading.id = entry.id
      heading.tabIndex = -1
    })
  }, [outline, editorInitialized, readableBody])

  useEffect(() => {
    const instance = editor.current
    if (!instance || !linkTarget || !editorInitialized) return
    instance.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to } = view.state.selection
      const label = linkTarget.title || 'Sem título'
      const href = `${INTERNAL_NOTE_HREF_PREFIX}${encodeURIComponent(linkTarget.id)}`
      const linkMark = view.state.schema.marks.link
      if (!linkMark) {
        view.dispatch(view.state.tr.insertText(formatNoteLink(linkTarget.id, label), from, to))
      } else {
        const transaction = view.state.tr.insertText(label, from, to)
          .addMark(from, from + label.length, linkMark.create({ href, title: null }))
        view.dispatch(transaction)
      }
      view.focus()
    })
    onLinkConsumed()
  }, [linkTarget?.id, editorInitialized, onLinkConsumed])

  useEffect(() => {
    const instance = editor.current
    if (!instance || !boardLinkTarget || !editorInitialized) return
    instance.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parsed = ctx.get(parserCtx)(formatBoardEmbed(boardLinkTarget.id, boardLinkTarget.title || 'Sem título'))
      const first = parsed.firstChild
      const card = first?.type.name === 'image-block' ? first : first?.firstChild?.type.name === 'image-block' ? first.firstChild : null
      if (card) view.dispatch(view.state.tr.replaceSelectionWith(card, false))
      view.focus()
    })
    onBoardLinkConsumed()
  }, [boardLinkTarget?.id, editorInitialized, onBoardLinkConsumed])

  const openBoardCard = (element: Element) => {
    const href = element.getAttribute('data-five-board-href') || boardHrefAtElement(editor.current, element)
    if (!href?.startsWith(INTERNAL_BOARD_HREF_PREFIX)) return
    let targetId = href.slice(INTERNAL_BOARD_HREF_PREFIX.length)
    try { targetId = decodeURIComponent(targetId) } catch { return }
    const target = linkedBoards.find((item) => item.id === targetId)
    if (target) onSelectBoard(target)
    else onUnavailableBoard()
  }

  if (!note) return <section className="editor-empty"><h2>Um lugar para pensar.</h2><p>{emptyMessage}</p></section>

  return (
    <main className="editor-panel">
      <div className="editor-topline">
        {mobile && <button className="icon-button mobile-back" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} /></button>}
        {!mobile && <button className="icon-button" onClick={onBack} aria-label="Voltar" title="Voltar"><ArrowLeft size={18} /></button>}
        <nav className="breadcrumb" aria-label="Caminho da nota">
          {breadcrumb.map((folder, index) => <span className="breadcrumb-segment" key={folder.id}>
            {index > 0 && <span className="breadcrumb-divider" aria-hidden="true">/</span>}
            <button type="button" className="breadcrumb-link" onClick={() => onNavigateFolder(folder)} aria-label={`Abrir pasta ${folder.name}`}>{folder.name}</button>
          </span>)}
          <span className="breadcrumb-divider" aria-hidden="true">/</span>
          <span className="breadcrumb-current" aria-current="page">{note.title || 'Sem título'}</span>
        </nav>
        <div className="editor-top-actions">
          {outline.length >= 3 && <div className="outline-control"><button className={`editor-outline-trigger${outlineOpen ? ' is-active' : ''}`} aria-expanded={outlineOpen} onClick={() => { setConnectionsOpen(false); setOutlineOpen((current) => !current) }}>Sumário <span>{outline.length}</span></button>{outlineOpen && <nav className="outline-popover" aria-label="Sumário da nota">{outline.map((entry) => <button key={entry.id} className={`outline-entry depth-${entry.level}`} onClick={() => { const heading = document.getElementById(entry.id); heading?.scrollIntoView({ behavior: 'smooth', block: 'start' }); heading?.focus({ preventScroll: true }); setOutlineOpen(false) }}>{entry.title}</button>)}</nav>}</div>}
          <button className={`editor-connections-trigger${connectionsOpen ? ' is-active' : ''}`} aria-label={`Conexões${linked.length + linkedBoards.length + backlinks.length ? `: ${linked.length + linkedBoards.length + backlinks.length}` : ''}`} aria-expanded={connectionsOpen} onClick={() => { setOutlineOpen(false); setConnectionsOpen((current) => !current) }}><Network size={15} /><span>Conexões</span>{linked.length + linkedBoards.length + backlinks.length > 0 && <small>{linked.length + linkedBoards.length + backlinks.length}</small>}</button>
          <span className={`save-hint ${localSaveState === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">{localSaveState === 'saving' ? <Clock3 size={13} /> : localSaveState === 'error' ? <AlertCircle size={13} /> : <Check size={13} />}{localSaveState === 'saving' ? 'Salvando…' : localSaveState === 'error' ? 'Falha ao salvar neste aparelho' : 'Salvo neste aparelho'}</span>
          <button className="icon-button" aria-label="Excluir nota" title="Excluir nota" onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="editor-scroll" onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (!(event.target instanceof Element)) return
        const card = event.target.closest<HTMLElement>('.milkdown-image-block[role="link"], .milkdown-image-inline[role="link"]')
        if (!card) return
        event.preventDefault()
        openBoardCard(card)
      }} onClickCapture={(event) => {
        if (!(event.target instanceof Element)) return
        const card = event.target.closest<HTMLElement>('.milkdown-image-block[role="link"], .milkdown-image-inline[role="link"]')
        if (card) {
          event.preventDefault()
          event.stopPropagation()
          openBoardCard(card)
          return
        }
        const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
        const href = anchor?.getAttribute('href')
        if (!anchor || !href || (!href.startsWith(INTERNAL_NOTE_HREF_PREFIX) && !href.startsWith(INTERNAL_BOARD_HREF_PREFIX))) return
        event.preventDefault()
        event.stopPropagation()
        const noteLink = href.startsWith(INTERNAL_NOTE_HREF_PREFIX)
        let targetId = href.slice(noteLink ? INTERNAL_NOTE_HREF_PREFIX.length : INTERNAL_BOARD_HREF_PREFIX.length)
        try { targetId = decodeURIComponent(targetId) } catch { return }
        if (noteLink) {
          const target = linked.find((item) => item.id === targetId)
          if (target) onSelectNote(target)
        } else {
          const target = linkedBoards.find((item) => item.id === targetId)
          if (target) onSelectBoard(target)
          else onUnavailableBoard()
        }
      }}>
        <div className="document-content">
          <input className="note-title" aria-label="Título da nota" value={note.title} onChange={(event) => { void saveLocally(() => onTitle(event.target.value)) }} onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const body = root.current?.querySelector<HTMLElement>('.ProseMirror')
            if (body) body.focus()
            else editor.current?.editor.action((ctx) => ctx.get(editorViewCtx).focus())
          }} placeholder="Título da nota" />
          <div className="document-meta">Atualizada em {new Date(note.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>
          {mobile && <div className="mobile-format-toolbar" role="toolbar" aria-label="Formatação da nota">
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { const mark = view.state.schema.marks.strong; if (mark) toggleMark(mark)(view.state, view.dispatch, view) })} aria-label="Negrito" title="Negrito"><Bold size={17} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { const heading = view.state.schema.nodes.heading; if (heading) setBlockType(heading, { level: 2 })(view.state, view.dispatch, view) })} aria-label="Título de seção" title="Título de seção"><Heading2 size={17} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { const list = view.state.schema.nodes.bullet_list; if (list) wrapInList(list)(view.state, view.dispatch, view) })} aria-label="Lista com marcadores" title="Lista com marcadores"><List size={17} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { const quote = view.state.schema.nodes.blockquote; if (quote) wrapIn(quote)(view.state, view.dispatch, view) })} aria-label="Citação" title="Citação"><Quote size={16} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { const code = view.state.schema.nodes.code_block; if (code) setBlockType(code)(view.state, view.dispatch, view) })} aria-label="Bloco de código" title="Bloco de código"><Code2 size={16} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand((view) => { undo(view.state, view.dispatch) })} aria-label="Desfazer" title="Desfazer"><Undo2 size={16} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={onRequestLinkNote} aria-label="Vincular nota" title="Vincular nota"><Network size={16} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={onRequestLinkBoard} aria-label="Vincular quadro" title="Vincular quadro"><Shapes size={16} /></button>
          </div>}
          <div ref={root} className="milkdown-host" aria-label="Conteúdo da nota" />
        </div>
      </div>
      {connectionsOpen && <section className="connections-panel" role="dialog" aria-label="Conexões desta nota">
        <header><div><p className="eyebrow">NOTA</p><h2>Conexões</h2></div><button className="icon-button" onClick={() => setConnectionsOpen(false)} aria-label="Fechar conexões"><X size={16} /></button></header>
        <div className="connections-panel-content">
          {(linked.length > 0 || linkedBoards.length > 0) && <section className="connection-section"><h3>Esta nota menciona</h3>
            {linked.map((item) => <div key={item.id} className="connection-row-wrap"><button className="connection-row" onClick={() => onSelectNote(item)}><span>{item.title || 'Sem título'}</span><span>↗</span></button><button className="icon-button connection-remove" onClick={() => onRemoveNoteLink(item)} aria-label={`Remover vínculo com ${item.title || 'Sem título'}`} title="Remover vínculo"><X size={13} /></button></div>)}
            {linkedBoards.map((board) => <div key={board.id} className="connection-row-wrap"><button className="connection-row" onClick={() => onSelectBoard(board)}><Shapes size={14} /><span>{board.title || 'Sem título'}</span><span>↗</span></button><button className="icon-button connection-remove" onClick={() => onRemoveBoardLink(board)} aria-label={`Remover vínculo com o quadro ${board.title || 'Sem título'}`} title="Remover vínculo"><X size={13} /></button></div>)}
          </section>}
          {backlinks.length > 0 && <section className="connection-section"><h3>Mencionada por</h3>{backlinks.map((item) => <button key={item.id} className="connection-row" onClick={() => onSelectNote(item)}><span>{item.title || 'Sem título'}</span><span>↗</span></button>)}</section>}
          {!linked.length && !linkedBoards.length && !backlinks.length && <p className="connections-empty">Esta nota ainda não tem conexões.</p>}
        </div>
        <footer><button className="secondary-button" onClick={onRequestLinkNote}><Network size={14} /> Vincular nota</button><button className="secondary-button" onClick={onRequestLinkBoard}><Shapes size={14} /> Vincular quadro</button></footer>
      </section>}
    </main>
  )
}

interface OutlineEntry {
  id: string
  level: number
  title: string
}

function markdownOutline(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let inCodeBlock = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    const match = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (!match?.[1] || !match[2]) continue
    const title = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`~]/g, '').trim()
    if (!title) continue
    const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'secao'
    entries.push({ id: `five-heading-${slug}-${entries.length + 1}`, level: match[1].length, title })
  }
  return entries
}

function boardHrefAtElement(instance: Crepe | null, element: Element): string | null {
  if (!instance) return null
  let href: string | null = null
  try {
    instance.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const position = view.posAtDOM(element, 0)
      for (const candidate of [position, position - 1, position + 1]) {
        if (candidate < 0 || candidate > view.state.doc.content.size) continue
        const node = view.state.doc.nodeAt(candidate)
        if ((node?.type.name === 'image-block' || node?.type.name === 'image-inline') && typeof node.attrs.src === 'string') {
          href = node.attrs.src
          return
        }
      }
    })
  } catch (error) {
    console.error('five could not resolve this board preview', error)
  }
  return href as string | null
}
