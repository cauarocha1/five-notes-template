import { FileText, Shapes } from 'lucide-react'
import type { Board, Note } from '../lib/types'

type SearchItem = (Note | Board) & { folderLabel: string }

interface Props {
  query: string
  items: SearchItem[]
  onOpen: (item: Note | Board) => void
}

export function QuickSearchPopover({ query, items, onOpen }: Props) {
  const term = query.trim()
  if (!term) return null

  return <section className="quick-search-popover" aria-label="Resultados da busca rápida">
    <p className="quick-search-popover-heading">{items.length ? `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'}` : 'Nenhum resultado'}</p>
    {items.length ? <ul className="quick-search-result-list">
      {items.map((item) => {
        const isBoard = 'sceneJson' in item
        const title = item.title.trim() || 'Sem título'
        return <li key={`${isBoard ? 'board' : 'note'}:${item.id}`}>
          <button className="quick-search-result" onClick={() => onOpen(item)} aria-label={`Abrir ${isBoard ? 'quadro' : 'nota'}: ${title}`}>
            {isBoard ? <Shapes size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            <span><strong>{title}</strong><small>{isBoard ? 'Quadro' : 'Nota'} · {item.folderLabel}</small></span>
          </button>
        </li>
      })}
    </ul> : <p className="quick-search-empty">Tente outro título ou trecho do conteúdo.</p>}
  </section>
}
