import type { Board, Note } from './types'
import { stripRetiredCanvasContent } from './legacyNoteContent'

export interface NoteLink {
  targetId: string
  label: string
  start: number
  end: number
}

export const INTERNAL_NOTE_HREF_PREFIX = 'https://five-note.invalid/note/'
export const INTERNAL_BOARD_HREF_PREFIX = 'https://five-note.invalid/board/'

export interface BoardLink {
  targetId: string
  label: string
  start: number
  end: number
}

export function parseBoardLinks(markdown: string): BoardLink[] {
  markdown = stripRetiredCanvasContent(markdown)
  const links: BoardLink[] = []
  // Read both the legacy image syntax and the visible Markdown card syntax.
  const pattern = /!?\[((?:\\.|[^\]])*)\]\(https:\/\/five-note\.invalid\/board\/([^\s)]+)(?:\s+"((?:\\.|[^"])*)")?\)/g
  for (const match of markdown.matchAll(pattern)) {
    let targetId = match[2] ?? ''
    try { targetId = decodeURIComponent(targetId) } catch { /* Ignore malformed escapes and keep the stored ID. */ }
    if (!targetId) continue
    const visibleLabel = (match[3] || match[1] || 'Quadro').replace(/\\(.)/g, '$1')
    links.push({ targetId, label: visibleLabel.replace(/^Quadro:\s*/i, ''), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
  }
  return links
}

export function formatBoardEmbed(boardId: string, title: string) {
  const label = `Quadro: ${title.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/"/g, '\\"')}`
  const url = `${INTERNAL_BOARD_HREF_PREFIX}${encodeURIComponent(boardId)}`
  return `![1.50](${url} "${label}")`
}

export function appendBoardEmbed(markdown: string, boardId: string, title: string) {
  if (parseBoardLinks(markdown).some((link) => link.targetId === boardId)) return markdown
  const content = markdown.trimEnd()
  return `${content}${content ? '\n\n' : ''}${formatBoardEmbed(boardId, title)}`
}

export function removeBoardEmbed(markdown: string, boardId: string) {
  return removeReferences(markdown, parseBoardLinks(markdown), boardId)
}

/** Strip board cards for consumers that present relationships separately; the editor renders cards inline. */
export function stripBoardEmbeds(markdown: string) {
  markdown = stripRetiredCanvasContent(markdown)
  const boardIds = [...new Set(parseBoardLinks(markdown).map((link) => link.targetId))]
  return boardIds.reduce((result, boardId) => removeBoardEmbed(result, boardId), markdown)
}

/** Restore board references after a plain-text editor replaces content with stripped Markdown. */
export function preserveBoardEmbeds(markdown: string, references: BoardLink[]) {
  const existing = new Set(parseBoardLinks(markdown).map((link) => link.targetId))
  let result = markdown
  for (const reference of references) {
    if (existing.has(reference.targetId)) continue
    result = appendBoardEmbed(result, reference.targetId, reference.label || 'Quadro')
    existing.add(reference.targetId)
  }
  return result
}

export function displayBoardEmbeds(markdown: string, titleForId: (boardId: string) => string | undefined = () => undefined) {
  markdown = stripRetiredCanvasContent(markdown)
  return parseBoardLinks(markdown).reverse().reduce((result, link) => {
    const title = titleForId(link.targetId)?.trim() || link.label.replace(/^Quadro:\s*/i, '') || 'Quadro'
    return `${result.slice(0, link.start)}${formatBoardEmbed(link.targetId, title)}${result.slice(link.end)}`
  }, markdown)
}

/** Remove data from the retired embedded canvas while preserving note text. */
export function parseNoteLinks(markdown: string): NoteLink[] {
  markdown = stripRetiredCanvasContent(markdown)
  const links: NoteLink[] = []
  const wikiPattern = /\\?\[\\?\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  const markdownPattern = /\\?\[((?:\\.|[^\]])+)\\?\]\s*\\?\(https\\?:\/\/five-note\.invalid\/note\/([^)\s\\]+)\\?\)/g
  for (const match of markdown.matchAll(wikiPattern)) {
    const targetId = match[1]?.trim()
    if (!targetId) continue
    links.push({
      targetId,
      label: match[2]?.trim() || targetId,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  for (const match of markdown.matchAll(markdownPattern)) {
    const encodedId = match[2]?.trim()
    if (!encodedId) continue
    let targetId = encodedId
    try { targetId = decodeURIComponent(encodedId) } catch { /* Keep malformed IDs out of the way of note editing. */ }
    links.push({
      targetId,
      label: (match[1] ?? '').replace(/\\(.)/g, '$1'),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  return links.sort((a, b) => a.start - b.start)
}

export function formatNoteLink(noteId: string, title: string) {
  const label = title.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
  return `[${label}](${INTERNAL_NOTE_HREF_PREFIX}${encodeURIComponent(noteId)})`
}

export function appendNoteLink(markdown: string, noteId: string, title: string) {
  if (parseNoteLinks(markdown).some((link) => link.targetId === noteId)) return markdown
  const content = markdown.trimEnd()
  return `${content}${content ? '\n\n' : ''}${formatNoteLink(noteId, title)}`
}

export function removeNoteLink(markdown: string, noteId: string) {
  return removeReferences(markdown, parseNoteLinks(markdown), noteId)
}

function removeReferences(markdown: string, links: Array<{ targetId: string; start: number; end: number }>, targetId: string) {
  let result = stripRetiredCanvasContent(markdown)
  for (const link of links.filter((item) => item.targetId === targetId).reverse()) {
    if (link.start < 0 || link.end > result.length) continue
    const before = result.slice(0, link.start)
    const after = result.slice(link.end)
    const needsSpace = Boolean(before && after && /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(after))
    const trailingSpace = before.match(/[ \t]+$/)?.[0] ?? ''
    const leadingSpace = after.match(/^[ \t]+/)?.[0] ?? ''
    if (trailingSpace && leadingSpace) result = `${before.slice(0, -trailingSpace.length)} ${after.slice(leadingSpace.length)}`
    else result = `${before}${needsSpace ? ' ' : ''}${after}`
  }
  return result.replace(/[ \t]+(?=\r?\n)/g, '').replace(/\r?\n(?:[ \t]*\r?\n){2,}/g, '\n\n').trim()
}

export function displayNoteLinks(markdown: string, titleForId: (noteId: string) => string | undefined = () => undefined) {
  markdown = stripRetiredCanvasContent(markdown)
  return parseNoteLinks(markdown).reverse().reduce((result, link) => {
    const currentTitle = titleForId(link.targetId)?.trim()
    const savedLabel = link.label !== link.targetId ? link.label : ''
    const visibleLabel = currentTitle || savedLabel || 'Nota relacionada'
    return `${result.slice(0, link.start)}${formatNoteLink(link.targetId, visibleLabel)}${result.slice(link.end)}`
  }, markdown)
}

export function noteBodyText(markdown: string, titleForBoardId: (boardId: string) => string | undefined = () => undefined) {
  markdown = stripRetiredCanvasContent(markdown).replace(/<br\s*\/?>/gi, '\n')
  markdown = parseBoardLinks(markdown).reverse().reduce((result, link) => {
    const title = titleForBoardId(link.targetId)?.trim() || (Number.isFinite(Number(link.label)) ? 'Quadro' : link.label.replace(/^Quadro:\s*/i, '') || 'Sem título')
    const label = `Quadro: ${title}`
    return `${result.slice(0, link.start)}${label}${result.slice(link.end)}`
  }, markdown)
  return parseNoteLinks(markdown).reverse().reduce((result, link) => {
    const visibleLabel = link.label !== link.targetId ? link.label : 'Nota relacionada'
    return `${result.slice(0, link.start)}${visibleLabel}${result.slice(link.end)}`
  }, markdown).trim()
}

export function notesReferencingBoard(board: Board, notes: Note[]) {
  return notes.filter((note) => parseBoardLinks(note.body).some((link) => link.targetId === board.id))
}

export function backlinksFor(note: Note, allNotes: Note[]) {
  return allNotes.filter((other) => other.id !== note.id && parseNoteLinks(other.body).some((link) => link.targetId === note.id))
}

export function linkedNotes(note: Note, allNotes: Note[]) {
  const ids = new Set(parseNoteLinks(note.body).map((link) => link.targetId))
  return allNotes.filter((other) => ids.has(other.id))
}

export function insertNoteLink(markdown: string, cursor: number, noteId: string, title: string) {
  return `${markdown.slice(0, cursor)}${formatNoteLink(noteId, title)}${markdown.slice(cursor)}`
}
