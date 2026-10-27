import { describe, expect, it } from 'vitest'
import { appendBoardEmbed, appendNoteLink, backlinksFor, displayBoardEmbeds, displayNoteLinks, formatBoardEmbed, formatNoteLink, linkedNotes, noteBodyText, parseBoardLinks, parseNoteLinks, preserveBoardEmbeds, removeBoardEmbed, removeNoteLink, stripBoardEmbeds } from '../src/lib/links'
import { stripRetiredCanvasContent } from '../src/lib/legacyNoteContent'
import type { Note } from '../src/lib/types'

const note = (id: string, body = ''): Note => ({
  id, folderId: null, title: id, body, revision: 0,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})

describe('conexões entre notas', () => {
  it('lê referências com e sem rótulo e ignora espaços vazios', () => {
    expect(parseNoteLinks('[[a]] e [[ b | Conceito B ]] e [[]]')).toEqual([
      { targetId: 'a', label: 'a', start: 0, end: 5 },
      { targetId: 'b', label: 'Conceito B', start: 8, end: 28 },
    ])
  })

  it('calcula links de saída e backlinks sem repetir a própria nota', () => {
    const current = note('a', '[[b|Conceito B]]')
    const incoming = note('c', 'Apoia [[a]] e [[b]]')
    const unrelated = note('d')
    expect(linkedNotes(current, [current, incoming, note('b'), unrelated]).map((item) => item.id)).toEqual(['b'])
    expect(backlinksFor(current, [current, incoming, unrelated]).map((item) => item.id)).toEqual(['c'])
  })

  it('mostra o título do destino e mantém o ID apenas no endereço interno', () => {
    const body = displayNoteLinks('Consulte [[uuid-2|Sem título]] depois.', () => 'Nota de aula')

    expect(body).toBe('Consulte [Nota de aula](https://five-note.invalid/note/uuid-2) depois.')
    expect(parseNoteLinks(body)).toEqual([{ targetId: 'uuid-2', label: 'Nota de aula', start: 9, end: 62 }])
    expect(formatNoteLink('uuid-2', 'Sem título')).toContain('[Sem título](')
  })

  it('mantém referências direcionais salvas como links markdown internos', () => {
    expect(parseNoteLinks('[[a|Ideia A]] aponta para [Ideia B](https://five-note.invalid/note/b)')).toEqual([
      { targetId: 'a', label: 'Ideia A', start: 0, end: 13 },
      { targetId: 'b', label: 'Ideia B', start: 26, end: 69 },
    ])
  })

  it('acrescenta uma relação ao fim da anotação sem duplicar vínculos existentes', () => {
    expect(appendNoteLink('Ideia principal.\n', 'b', 'Base de dados'))
      .toBe('Ideia principal.\n\n[Base de dados](https://five-note.invalid/note/b)')
    const existing = 'Texto.\n\n[Base de dados](https://five-note.invalid/note/b)'
    expect(appendNoteLink(existing, 'b', 'Base de dados')).toBe(existing)
    expect(appendNoteLink('', 'b', 'Base de dados')).toBe('[Base de dados](https://five-note.invalid/note/b)')
  })

  it('remove uma conexão entre notas preservando o restante do texto', () => {
    expect(removeNoteLink('Antes [Base de dados](https://five-note.invalid/note/base) depois.', 'base'))
      .toBe('Antes depois.')
    expect(removeNoteLink('[Base](https://five-note.invalid/note/base) e [[base|Base]]', 'base')).toBe('e')
    expect(removeNoteLink('Sem relação.', 'base')).toBe('Sem relação.')
  })

  it('não mostra os IDs internos no resumo de notas', () => {
    expect(noteBodyText('[[uuid-a|Sem título]] e [Conceito B](https://five-note.invalid/note/uuid-b)'))
      .toBe('Sem título e Conceito B')
  })

  it('remove dados antigos do canvas sem apagar o texto das notas', () => {
    const legacy = 'Antes.\n\n<!--five-system-design:v1:eyJ2ZXJzaW9uIjoxfQ==-->\n\n<!--!--five-canvas-block-->\n\n```five-canvas\n```\n\nDepois.'

    expect(stripRetiredCanvasContent(legacy)).toBe('Antes.\n\nDepois.')
    expect(noteBodyText(legacy)).toBe('Antes.\n\nDepois.')
  })

  it('mantém a posição dos links depois de remover um bloco visual legado', () => {
    const body = '<!--five-system-design:v1:eyJ2ZXJzaW9uIjoxfQ==-->\nVeja [[uuid-a|Minha nota]].'

    expect(displayNoteLinks(body)).toBe('Veja [Minha nota](https://five-note.invalid/note/uuid-a).')
  })

  it('recupera vínculos que o editor antigo serializou com barras de escape', () => {
    const legacy = String.raw`Veja \[\[uuid-a|Sem título]]`
    const escapedMarkdown = String.raw`\[Conceito B]\(https\://five-note.invalid/note/uuid-b)`

    expect(parseNoteLinks(legacy).map(({ targetId, label }) => ({ targetId, label }))).toEqual([
      { targetId: 'uuid-a', label: 'Sem título' },
    ])
    expect(parseNoteLinks(escapedMarkdown).map(({ targetId, label }) => ({ targetId, label }))).toEqual([
      { targetId: 'uuid-b', label: 'Conceito B' },
    ])
    expect(noteBodyText(`${legacy} e ${escapedMarkdown}`)).toBe('Veja Sem título e Conceito B')
  })

  it('guarda quadros como uma prévia clicável sem expor o ID no texto', () => {
    const embed = formatBoardEmbed('board-123', 'Arquitetura')
    expect(embed).toBe('![1.50](https://five-note.invalid/board/board-123 "Quadro: Arquitetura")')
    expect(parseBoardLinks(`Antes.\n\n${embed}\n\nDepois.`).map(({ targetId, label }) => ({ targetId, label }))).toEqual([
      { targetId: 'board-123', label: 'Arquitetura' },
    ])
    expect(displayBoardEmbeds(embed, () => 'System Design')).toContain('"Quadro: System Design"')
    expect(noteBodyText(`Antes. ${embed} Depois.`)).toBe('Antes. Quadro: Arquitetura Depois.')
  })

  it('acrescenta uma relação com quadro ao fim da nota sem duplicar', () => {
    expect(appendBoardEmbed('Contexto da aula.\n', 'board-1', 'Arquitetura'))
      .toBe('Contexto da aula.\n\n![1.50](https://five-note.invalid/board/board-1 "Quadro: Arquitetura")')
    const existing = 'Contexto.\n\n![1.50](https://five-note.invalid/board/board-1 "Quadro: Arquitetura")'
    expect(appendBoardEmbed(existing, 'board-1', 'Arquitetura')).toBe(existing)
    expect(appendBoardEmbed('', 'board-1', 'Arquitetura')).toBe('![1.50](https://five-note.invalid/board/board-1 "Quadro: Arquitetura")')
  })

  it('remove uma prévia de quadro mantendo os parágrafos vizinhos', () => {
    const body = 'Antes.\n\n![1.50](https://five-note.invalid/board/board-1 "Quadro: Arquitetura")\n\nDepois.'
    expect(removeBoardEmbed(body, 'board-1')).toBe('Antes.\n\nDepois.')
    expect(removeBoardEmbed('Texto e [Quadro: Mapa](https://five-note.invalid/board/board-1)continua.', 'board-1'))
      .toBe('Texto e continua.')
  })

  it('oculta cartões de quadro no texto e preserva as relações quando o texto muda', () => {
    const first = formatBoardEmbed('board-a', 'Arquitetura')
    const second = formatBoardEmbed('board-b', 'Fluxo')
    const body = `Texto antes.\n\n${first}\n\nTexto depois.\n\n${second}`
    const hidden = stripBoardEmbeds(body)
    expect(hidden).toBe('Texto antes.\n\nTexto depois.')
    expect(preserveBoardEmbeds('Texto editado.', parseBoardLinks(body))).toBe(`Texto editado.\n\n${first}\n\n${second}`)
  })

  it('lê o formato de imagem que o Milkdown grava para uma prévia de quadro', () => {
    const milkdownImage = '![1.65](https://five-note.invalid/board/board-123)'
    expect(parseBoardLinks(milkdownImage).map(({ targetId }) => targetId)).toEqual(['board-123'])
    expect(noteBodyText(milkdownImage)).toBe('Quadro: Quadro')
    expect(noteBodyText(milkdownImage, () => 'Arquitetura de cache')).toBe('Quadro: Arquitetura de cache')
  })
})
