import { FileText, Network, Plus, Search, Shapes } from 'lucide-react'
import { useMemo } from 'react'
import type { Board, Folder, Note } from '../lib/types'

type HomeItem = Note | Board

interface Props {
  notes: Note[]
  boards: Board[]
  folders: Folder[]
  onCreateNote: () => void
  onCreateBoard: () => void
  onSearch: () => void
  onOpenItem: (item: HomeItem) => void
  onOpenMap: () => void
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function HomeScreen({ notes, boards, folders, onCreateNote, onCreateBoard, onSearch, onOpenItem, onOpenMap }: Props) {
  const recentItems = useMemo(() => [
    ...notes.filter((note) => !note.deletedAt),
    ...boards.filter((board) => !board.deletedAt),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [notes, boards])
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders])

  return <main className="home-screen" aria-labelledby="home-title">
    <div className="home-screen-content">
      <header className="home-screen-header">
        <p className="eyebrow">FIVE · SEU ESPAÇO DE IDEIAS</p>
        <h1 id="home-title">Início</h1>
        <p className="home-intro">Retome uma ideia ou comece algo novo.</p>
      </header>

      <section className="home-actions" aria-label="Ações rápidas">
        <button className="home-action" onClick={onCreateNote} title="Criar nota em Entrada"><span className="home-action-icon"><Plus size={17} /></span><span><strong>Nova nota</strong><small>Em Entrada</small></span></button>
        <button className="home-action" onClick={onCreateBoard} title="Criar quadro em Entrada"><span className="home-action-icon"><Shapes size={17} /></span><span><strong>Novo quadro</strong><small>Em Entrada</small></span></button>
        <button className="home-action" onClick={onSearch}><span className="home-action-icon"><Search size={16} /></span><span><strong>Buscar notas</strong><small>Em todo o espaço</small></span></button>
        <button className="home-action" onClick={onOpenMap}><span className="home-action-icon"><Network size={17} /></span><span><strong>Mapa do conhecimento</strong><small>Ver conexões do espaço</small></span></button>
      </section>

      <section className="home-recent" aria-labelledby="home-recent-title">
        <div className="home-section-heading"><h2 id="home-recent-title">Recentes</h2><span>{recentItems.length} {recentItems.length === 1 ? 'item' : 'itens'}</span></div>
        {recentItems.length ? <div className="home-recent-list" role="list">
          {recentItems.map((item) => {
            const isBoard = 'sceneJson' in item
            const title = item.title.trim() || 'Sem título'
            const folder = item.folderId ? folderById.get(item.folderId) : null
            const kind = isBoard ? 'quadro' : 'nota'
            return <div key={`${kind}-${item.id}`} role="listitem">
              <button className="home-recent-item" onClick={() => onOpenItem(item)} aria-label={`Abrir ${kind}: ${title}`}>
                {isBoard ? <Shapes size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                <span className="home-recent-copy"><strong>{title}</strong><small>{isBoard ? 'Quadro' : 'Nota'} · {folder ?? 'Sem pasta'}</small></span>
                <time dateTime={item.updatedAt}>{formatUpdatedAt(item.updatedAt)}</time>
              </button>
            </div>
          })}
        </div> : <p className="home-empty">Suas notas e quadros aparecerão aqui.</p>}
      </section>
    </div>
  </main>
}
