import { useEffect, useRef } from 'react'
import { FileText, Search, Shapes, X } from 'lucide-react'
import type { Board, Note } from '../lib/types'
import { noteBodyText } from '../lib/links'

type SearchItem = (Note | Board) & { folderLabel: string }

interface Props {
  query: string
  items: SearchItem[]
  recent: SearchItem[]
  onSearch: (query: string) => void
  onOpen: (item: Note | Board) => void
}

export function GlobalSearch({ query, items, recent, onSearch, onOpen }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = query.trim() ? items : recent
  useEffect(() => { inputRef.current?.focus() }, [])
  return <main className="global-search-screen" aria-labelledby="global-search-title">
    <header className="global-search-heading">
      <p className="eyebrow">TODO O ESPAÇO</p>
      <h1 id="global-search-title">Buscar em todo o espaço</h1>
      <p>Encontre notas e quadros pelo título ou pelo conteúdo das notas.</p>
      <label className="global-search-field">
        <Search size={19} aria-hidden="true" />
        <input ref={inputRef} type="search" value={query} onChange={(event) => onSearch(event.target.value)} placeholder="O que você está procurando?" aria-label="Buscar em todas as notas e quadros" />
        {query && <button type="button" onClick={() => onSearch('')} aria-label="Limpar busca"><X size={16} /></button>}
      </label>
    </header>
    <section className="global-search-results" aria-label={query.trim() ? 'Resultados da busca' : 'Itens recentes'}>
      <div className="home-section-heading"><h2>{query.trim() ? 'Resultados' : 'Recentes'}</h2><span>{visible.length} {visible.length === 1 ? 'item' : 'itens'}</span></div>
      {visible.length ? <div className="home-recent-list" role="list">
        {visible.map((item) => {
          const isBoard = 'sceneJson' in item
          const title = item.title.trim() || 'Sem título'
          return <div key={`${isBoard ? 'board' : 'note'}:${item.id}`} role="listitem">
            <button className="home-recent-item global-search-result" onClick={() => onOpen(item)} aria-label={`Abrir ${isBoard ? 'quadro' : 'nota'}: ${title}`}>
              {isBoard ? <Shapes size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
              <span className="home-recent-copy"><strong>{title}</strong><small>{isBoard ? 'Quadro' : noteBodyText(item.body).replace(/[#>*_`~\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Nota'} · {item.folderLabel}</small></span>
              <span className="global-search-open">Abrir</span>
            </button>
          </div>
        })}
      </div> : <p className="global-search-empty">{query.trim() ? 'Nenhuma nota ou quadro corresponde à busca.' : 'Suas notas e quadros recentes aparecerão aqui.'}</p>}
    </section>
  </main>
}
