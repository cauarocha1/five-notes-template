import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from './database'
import type { Board, Folder, Note } from './types'

export const MOBILE_LAYOUT_QUERY = '(max-width: 1000px)'

export function useFiveData() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [outboxUpdatedAt, setOutboxUpdatedAt] = useState('')
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [allFolders, allNotes, allBoards, operations] = await Promise.all([
        db.folders.toArray(), db.notes.toArray(), db.boards.toArray(), db.outbox.toArray(),
      ])
      const updatedAt = operations.reduce((latest, op) => op.updatedAt > latest ? op.updatedAt : latest, '')
      return { folders: allFolders, notes: allNotes, boards: allBoards, pendingCount: operations.length, outboxUpdatedAt: updatedAt }
    }).subscribe({
      next: (data) => {
        setFolders(data.folders.filter((item) => !item.deletedAt))
        setNotes(data.notes.filter((item) => !item.deletedAt))
        setBoards(data.boards.filter((item) => !item.deletedAt))
        setPendingCount(data.pendingCount)
        setOutboxUpdatedAt(data.outboxUpdatedAt)
      },
      error: (error) => console.error('five local data subscription failed', error),
    })
    return () => subscription.unsubscribe()
  }, [])
  return { folders, notes, boards, pendingCount, outboxUpdatedAt }
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}
