import { db, getDeviceId, newId, saveLocalBoard, saveLocalFolder, saveLocalNote } from './database'
import { stripRetiredCanvasContent } from './legacyNoteContent'
import type { Board, EntityKind, Folder, Note, OutboxOperation, RemoteChange, SyncResponse } from './types'

const API = '/api'
const CONFLICT_BURST_WINDOW_MS = 15_000
type SyncOutcome = 'synced' | 'pending' | 'local' | 'offline' | 'unavailable' | 'access-expired'
type SyncAvailability = 'available' | 'local' | 'unavailable' | 'access-expired'
type SyncCall = SyncResponse | { error: SyncOutcome }

let running: Promise<SyncOutcome> | null = null

export async function apiIsAvailable() {
  try {
    const response = await fetch(`${API}/health`, { cache: 'no-store' })
    if (response.redirected || response.status === 401 || response.status === 403) return 'access-expired' satisfies SyncAvailability
    if (!response.ok) return isLocalOrigin() && response.status === 404 ? 'local' : 'unavailable'
    if (!response.headers.get('content-type')?.includes('application/json')) return isLocalOrigin() ? 'local' : 'access-expired'
    const payload = await response.json() as { status?: string }
    return payload.status === 'ok' ? 'available' : 'unavailable'
  } catch {
    return navigator.onLine ? isLocalOrigin() ? 'local' : 'unavailable' : 'unavailable'
  }
}

function isLocalOrigin() {
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
}

export function syncNow() {
  if (running) return running
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
  type AsyncLockRequest = (name: string, options: LockOptions, callback: () => Promise<SyncOutcome>) => Promise<SyncOutcome>
  const requestWithAsyncCallback = lockManager?.request as unknown as AsyncLockRequest | undefined
  const sync = requestWithAsyncCallback
    ? requestWithAsyncCallback.call(lockManager, 'five-notes-sync', { mode: 'exclusive' }, performSync)
    : performSync()
  running = sync.finally(() => { running = null })
  return running
}

async function performSync(): Promise<SyncOutcome> {
  if (!navigator.onLine) return 'offline'
  const availability = await apiIsAvailable()
  if (availability !== 'available') return availability

  const settings = await db.settings.get('cursor')
  let cursor = Number(settings?.value ?? 0)

  // Complete the first pull before publishing starter data with shared IDs.
  const initialPullComplete = await db.settings.get('initialPullComplete')
  if (initialPullComplete?.value !== 1) {
    let page = 0
    let hasMore = true
    while (hasMore && page < 8) {
      const response = await postSync([], cursor)
      if ('error' in response) return response.error
      await applyRemoteChanges(response.changes)
      cursor = response.cursor
      hasMore = response.hasMore
      await db.settings.put({ key: 'cursor', value: cursor })
      page += 1
    }
    if (hasMore) return 'pending'
    await db.settings.put({ key: 'initialPullComplete', value: 1 })
  }

  await compactLegacyOutbox()
  await enqueueLocalFirstRunData()
  let operations = await orderedOperations()
  let passes = 0
  let hasMore = true
  while ((operations.length || hasMore) && passes < 8) {
    const sent = boundedBatch(operations, getDeviceId(), cursor)
    if (operations.length && !sent.length) break
    const response = await postSync(sent, cursor)
    if ('error' in response) return response.error
    await applyAcks(response.acks, sent)
    for (const conflict of response.conflicts) await resolveConflict(conflict.operation, conflict.remote, conflict.remoteDeviceId)
    await applyRemoteChanges(response.changes)
    cursor = response.cursor
    await db.settings.put({ key: 'cursor', value: cursor })
    hasMore = response.hasMore
    passes += 1
    operations = await orderedOperations()

    // If the user edited an entity while its request was in flight, leave the
    // newest version queued. App.tsx will retry after its typing debounce.
    const sentByEntity = new Map(sent.map((operation) => [`${operation.entity}:${operation.entityId}`, operation]))
    if (operations.some((operation) => {
      const sentOperation = sentByEntity.get(`${operation.entity}:${operation.entityId}`)
      return sentOperation && (operation.opId !== sentOperation.opId || operation.updatedAt !== sentOperation.updatedAt)
    })) return 'pending'
  }
  return (await db.outbox.count()) || hasMore ? 'pending' : 'synced'
}

async function orderedOperations() {
  const operations = await db.outbox.orderBy('updatedAt').toArray()
  const folders = new Map(operations.filter((op) => op.entity === 'folder').map((op) => [op.entityId, op]))
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    const operation = folders.get(id)
    const parentId = operation?.entity === 'folder' ? (operation.data as Folder).parentId : null
    return parentId && folders.has(parentId) ? 1 + depth(parentId, seen) : 0
  }
  return operations.sort((a, b) => {
    if (a.entity !== b.entity) return a.entity === 'folder' ? -1 : b.entity === 'folder' ? 1 : a.entity === 'note' ? -1 : 1
    if (a.entity === 'folder' && b.entity === 'folder') return depth(a.entityId) - depth(b.entityId) || a.updatedAt.localeCompare(b.updatedAt)
    return a.updatedAt.localeCompare(b.updatedAt)
  })
}

function boundedBatch(operations: OutboxOperation[], deviceId: string, cursor: number) {
  const batch: OutboxOperation[] = []
  const encoder = new TextEncoder()
  let bytes = encoder.encode(JSON.stringify({ deviceId, cursor, operations: [] })).length
  for (const operation of operations) {
    const operationBytes = encoder.encode(JSON.stringify(operation)).length + 1
    if (batch.length >= 50 || bytes + operationBytes > 7_000_000) break
    batch.push(operation)
    bytes += operationBytes
  }
  return batch
}

async function postSync(operations: OutboxOperation[], cursor: number) {
  try {
    const response = await fetch(`${API}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), cursor, operations }),
    })
    if (response.redirected || response.status === 401 || response.status === 403) return { error: 'access-expired' } satisfies SyncCall
    if (!response.ok) return { error: 'unavailable' } satisfies SyncCall
    if (!response.headers.get('content-type')?.includes('application/json')) return { error: isLocalOrigin() ? 'local' : 'access-expired' } satisfies SyncCall
    return await response.json() as SyncResponse
  } catch {
    return { error: navigator.onLine ? 'unavailable' : 'offline' } satisfies SyncCall
  }
}

async function enqueueLocalFirstRunData() {
  const zeroFolders = await db.folders.where('revision').equals(0).toArray()
  const zeroNotes = await db.notes.where('revision').equals(0).toArray()
  const zeroBoards = await db.boards.where('revision').equals(0).toArray()
  for (const folder of zeroFolders) await saveLocalFolder(folder)
  for (const note of zeroNotes) await saveLocalNote(note)
  for (const board of zeroBoards) await saveLocalBoard(board)
}

async function applyAcks(acks: SyncResponse['acks'], sent: OutboxOperation[]) {
  const sentById = new Map(sent.map((operation) => [operation.opId, operation]))
  for (const ack of acks) {
    const original = sentById.get(ack.opId)
    if (!original) continue
    await db.transaction('rw', db.folders, db.notes, db.boards, db.outbox, async () => {
      const pending = await db.outbox.where('entityId').equals(ack.entityId).first()
      if (ack.entity === 'note') {
        const entity = await db.notes.get(ack.entityId)
        if (entity) await db.notes.put({ ...entity, revision: ack.revision })
      } else if (ack.entity === 'folder') {
        const entity = await db.folders.get(ack.entityId)
        if (entity) await db.folders.put({ ...entity, revision: ack.revision })
      } else {
        const entity = await db.boards.get(ack.entityId)
        if (entity) await db.boards.put({ ...entity, revision: ack.revision })
      }
      if (pending?.opId === ack.opId) {
        if (pending.updatedAt === original.updatedAt) {
          await db.outbox.delete(ack.opId)
        } else {
          await db.outbox.delete(ack.opId)
          await db.outbox.put({ ...pending, opId: newId(), baseRevision: ack.revision })
        }
      }
    })
  }
}

async function compactLegacyOutbox() {
  const marker = await db.settings.get('outboxCompactedV1')
  if (marker?.value === 1) return
  await db.transaction('rw', db.notes, db.folders, db.boards, db.outbox, db.settings, async () => {
    const operations = await db.outbox.toArray()
    const byEntity = new Map<string, OutboxOperation[]>()
    for (const operation of operations) {
      const key = `${operation.entity}:${operation.entityId}`
      const group = byEntity.get(key) ?? []
      group.push(operation)
      byEntity.set(key, group)
    }
    for (const group of byEntity.values()) {
      const latest = group.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b)
      const table = latest.entity === 'note' ? db.notes : latest.entity === 'folder' ? db.folders : db.boards
      const entity = await table.get(latest.entityId)
      if (!entity) {
        for (const operation of group) await db.outbox.delete(operation.opId)
        continue
      }
      const baseRevision = entity.revision || null
      const next: OutboxOperation = {
        ...latest,
        opId: group.length > 1 || latest.baseRevision !== baseRevision ? newId() : latest.opId,
        baseRevision,
        data: entity,
        updatedAt: entity.updatedAt,
      }
      const alreadyCanonical = group.length === 1 && latest.opId === next.opId &&
        latest.baseRevision === next.baseRevision && latest.updatedAt === next.updatedAt &&
        JSON.stringify(latest.data) === JSON.stringify(next.data)
      if (alreadyCanonical) continue
      for (const operation of group) await db.outbox.delete(operation.opId)
      await db.outbox.put(next)
    }
    await db.settings.put({ key: 'outboxCompactedV1', value: 1 })
  })
}

async function applyRemoteChanges(changes: RemoteChange[]) {
  for (const change of changes) {
    let remoteData = change.data
    let removedCanvasData = false
    if (change.entity === 'note' && remoteData) {
      const remoteNote = remoteData as Note
      const body = stripRetiredCanvasContent(remoteNote.body)
      if (body !== remoteNote.body) {
        remoteData = { ...remoteNote, body }
        removedCanvasData = true
      }
    }
    const pending = await db.outbox.where('entityId').equals(change.entityId).first()
    if (pending) {
      if (remoteData && remoteData.revision > (pending.baseRevision ?? 0)) await resolveConflict(pending, remoteData, change.deviceId)
      if (removedCanvasData) {
        const cleanNote = await db.notes.get(change.entityId)
        if (cleanNote) await saveLocalNote(cleanNote)
      }
      continue
    }
    if (remoteData) {
      const table = change.entity === 'note' ? db.notes : change.entity === 'folder' ? db.folders : db.boards
      const current = await table.get(change.entityId)
      if (!current || current.revision < remoteData.revision) {
        if (removedCanvasData) await saveLocalNote(remoteData as Note)
        else await table.put(remoteData as never)
      } else if (removedCanvasData && change.entity === 'note') {
        const cleanBody = stripRetiredCanvasContent((current as Note).body)
        if (cleanBody !== (current as Note).body) await saveLocalNote({ ...current, body: cleanBody } as Note)
      }
    }
  }
}

export async function resolveConflict(operation: OutboxOperation, remote: Note | Folder | Board | null, remoteDeviceId?: string | null) {
  if (operation.entity === 'board') {
    await resolveBoardConflict(operation, remote as Board | null, remoteDeviceId)
    return
  }
  if (operation.entity === 'note') {
    const rawRemoteNote = remote as Note | null
    const cleanRemoteBody = rawRemoteNote ? stripRetiredCanvasContent(rawRemoteNote.body) : null
    const removedCanvasData = Boolean(rawRemoteNote && cleanRemoteBody !== rawRemoteNote.body)
    const remoteNote = rawRemoteNote && cleanRemoteBody !== null ? { ...rawRemoteNote, body: cleanRemoteBody } : null
    await db.transaction('rw', db.notes, db.outbox, db.settings, async () => {
      const local = await db.notes.get(operation.entityId)
      const pending = await db.outbox.where('entityId').equals(operation.entityId).toArray()
      if (!remoteNote) {
        if (local) {
          const retry = { ...local, revision: 0, updatedAt: new Date().toISOString() }
          await db.notes.put(retry)
          for (const item of pending) await db.outbox.delete(item.opId)
          await db.outbox.put({ ...operation, opId: newId(), baseRevision: null, data: retry, updatedAt: retry.updatedAt })
        } else for (const item of pending) await db.outbox.delete(item.opId)
        return
      }
      const hasLocalContentChanges = local && (
        local.folderId !== remoteNote.folderId ||
        local.title !== remoteNote.title ||
        local.body !== remoteNote.body ||
        Boolean(local.deletedAt) !== Boolean(remoteNote.deletedAt)
      )
      if (local && hasLocalContentChanges) {
        const conflictKey = `conflict-window:note:${operation.entityId}`
        const lastConflict = await db.settings.get(conflictKey)
        const now = Date.now()
        const conflictIsRecent = typeof lastConflict?.value === 'number' && now - lastConflict.value < CONFLICT_BURST_WINDOW_MS
        if (conflictIsRecent || remoteDeviceId === operation.deviceId) {
          // Edits from another tab/device identity of this same device are one
          // editing stream. Rebase the newest local state instead of creating
          // a recovery note for a race between in-flight writes.
          const rebased: Note = { ...local, revision: remoteNote.revision, updatedAt: new Date(now).toISOString() }
          await db.notes.put(rebased)
          for (const item of pending) await db.outbox.delete(item.opId)
          await db.outbox.put({
            opId: newId(), deviceId: getDeviceId(), entity: 'note', entityId: rebased.id,
            baseRevision: remoteNote.revision, data: rebased, updatedAt: rebased.updatedAt,
          })
          await db.settings.put({ key: conflictKey, value: now })
          return
        }

        const copy: Note = { ...local, id: newId(), title: `Conflito — ${local.title}`, revision: 0, updatedAt: new Date(now).toISOString(), deletedAt: null }
        await db.notes.add(copy)
        await db.outbox.add({ opId: newId(), deviceId: getDeviceId(), entity: 'note', entityId: copy.id, baseRevision: null, data: copy, updatedAt: copy.updatedAt })
        await db.settings.put({ key: conflictKey, value: now })
      }
      await db.notes.put(remoteNote)
      for (const item of pending) await db.outbox.delete(item.opId)
    })
    if (removedCanvasData) {
      const cleanNote = await db.notes.get(operation.entityId)
      if (cleanNote) await saveLocalNote(cleanNote)
    }
    return
  }

  const local = await db.folders.get(operation.entityId)
  const remoteFolder = remote as Folder | null
  if (!remoteFolder) {
    await db.transaction('rw', db.folders, db.outbox, async () => {
      if (local) {
        const retry = { ...local, revision: 0, updatedAt: new Date().toISOString() }
        await db.folders.put(retry)
        await db.outbox.delete(operation.opId)
        await db.outbox.put({ ...operation, opId: newId(), baseRevision: null, data: retry, updatedAt: retry.updatedAt })
      } else await db.outbox.delete(operation.opId)
    })
    return
  }
  if (local) {
    if (remoteDeviceId === operation.deviceId) {
      const localMatchesRemote = local.parentId === remoteFolder.parentId && local.name === remoteFolder.name &&
        local.sortOrder === remoteFolder.sortOrder && Boolean(local.deletedAt) === Boolean(remoteFolder.deletedAt)
      await db.transaction('rw', db.folders, db.outbox, async () => {
        const pending = await db.outbox.where('entityId').equals(operation.entityId).toArray()
        if (localMatchesRemote) {
          await db.folders.put(remoteFolder)
          for (const item of pending) await db.outbox.delete(item.opId)
          return
        }
        const rebased: Folder = { ...local, revision: remoteFolder.revision, updatedAt: new Date().toISOString() }
        await db.folders.put(rebased)
        for (const item of pending) await db.outbox.delete(item.opId)
        await db.outbox.put({
          ...operation, opId: newId(), deviceId: getDeviceId(), baseRevision: remoteFolder.revision,
          data: rebased, updatedAt: rebased.updatedAt,
        })
      })
      return
    }
    const copy: Folder = { ...local, id: newId(), name: `${local.name} (conflito)`, revision: 0, updatedAt: new Date().toISOString(), deletedAt: null }
    const children = await db.folders.where('parentId').equals(local.id).toArray()
    const notes = await db.notes.where('folderId').equals(local.id).toArray()
    await db.transaction('rw', db.folders, db.notes, db.outbox, async () => {
      await db.folders.add(copy)
      await db.outbox.add({ opId: newId(), deviceId: getDeviceId(), entity: 'folder', entityId: copy.id, baseRevision: null, data: copy, updatedAt: copy.updatedAt })
      for (const child of children) await saveLocalFolder({ ...child, parentId: copy.id })
      for (const note of notes) await saveLocalNote({ ...note, folderId: copy.id })
      await db.folders.put(remoteFolder)
      await db.outbox.delete(operation.opId)
    })
  }
}

async function resolveBoardConflict(operation: OutboxOperation, remote: Board | null, remoteDeviceId?: string | null) {
  const local = await db.boards.get(operation.entityId)
  const pending = await db.outbox.where('entityId').equals(operation.entityId).toArray()
  if (!remote) {
    await db.transaction('rw', db.boards, db.outbox, async () => {
      if (local) {
        const retry = { ...local, revision: 0, updatedAt: new Date().toISOString() }
        await db.boards.put(retry)
        for (const item of pending) await db.outbox.delete(item.opId)
        await db.outbox.put({ ...operation, opId: newId(), baseRevision: null, data: retry, updatedAt: retry.updatedAt })
      } else for (const item of pending) await db.outbox.delete(item.opId)
    })
    return
  }
  if (!local) {
    await db.transaction('rw', db.boards, db.outbox, async () => {
      await db.boards.put(remote)
      for (const item of pending) await db.outbox.delete(item.opId)
    })
    return
  }

  const sameContent = local.folderId === remote.folderId && local.title === remote.title &&
    local.sceneJson === remote.sceneJson && Boolean(local.deletedAt) === Boolean(remote.deletedAt)
  await db.transaction('rw', db.boards, db.outbox, async () => {
    const current = await db.boards.get(operation.entityId)
    const currentPending = await db.outbox.where('entityId').equals(operation.entityId).toArray()
    if (!current) {
      await db.boards.put(remote)
      for (const item of currentPending) await db.outbox.delete(item.opId)
      return
    }
    if (sameContent) {
      await db.boards.put(remote)
      for (const item of currentPending) await db.outbox.delete(item.opId)
      return
    }
    if (remoteDeviceId === operation.deviceId) {
      const rebased = { ...current, revision: remote.revision, updatedAt: new Date().toISOString() }
      await db.boards.put(rebased)
      for (const item of currentPending) await db.outbox.delete(item.opId)
      await db.outbox.put({
        opId: newId(), deviceId: getDeviceId(), entity: 'board', entityId: rebased.id,
        baseRevision: remote.revision, data: rebased, updatedAt: rebased.updatedAt,
      })
      return
    }
    const copy: Board = { ...current, id: newId(), title: `Conflito — ${current.title || 'Quadro sem título'}`, revision: 0, updatedAt: new Date().toISOString(), deletedAt: null }
    await db.boards.add(copy)
    await db.outbox.add({ opId: newId(), deviceId: getDeviceId(), entity: 'board', entityId: copy.id, baseRevision: null, data: copy, updatedAt: copy.updatedAt })
    await db.boards.put(remote)
    for (const item of currentPending) await db.outbox.delete(item.opId)
  })
}

export async function exportBackup() {
  const [folders, notes, boards] = await Promise.all([db.folders.toArray(), db.notes.toArray(), db.boards.toArray()])
  const backup = {
    format: 'five-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    folders,
    notes,
    boards,
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `five-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000)
}

export async function importBackup(file: File) {
  if (file.size > 50 * 1024 * 1024) throw new Error('O backup é maior que o limite de 50 MB.')
  let parsed: { format?: string; version?: number; folders?: Folder[]; notes?: Note[]; boards?: Board[] }
  try {
    parsed = JSON.parse(await file.text()) as typeof parsed
  } catch {
    throw new Error('Não foi possível ler o arquivo JSON do backup.')
  }
  if (parsed.format !== 'five-backup' || (parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.folders) || !Array.isArray(parsed.notes) || (parsed.version === 2 && !Array.isArray(parsed.boards))) {
    throw new Error('Este arquivo não é um backup válido do five.')
  }
  const isFolder = (value: unknown): value is Folder => !!value && typeof value === 'object' &&
    typeof (value as Folder).id === 'string' && typeof (value as Folder).name === 'string' &&
    ((value as Folder).parentId === null || typeof (value as Folder).parentId === 'string') && Number.isSafeInteger((value as Folder).sortOrder) &&
    Number.isSafeInteger((value as Folder).revision) && (value as Folder).revision >= 0 && typeof (value as Folder).updatedAt === 'string' &&
    ((value as Folder).deletedAt === null || typeof (value as Folder).deletedAt === 'string')
  const isNote = (value: unknown): value is Note => !!value && typeof value === 'object' &&
    typeof (value as Note).id === 'string' && typeof (value as Note).title === 'string' && typeof (value as Note).body === 'string' &&
    ((value as Note).folderId === null || typeof (value as Note).folderId === 'string') && (value as Note).body.length <= 850_000 &&
    Number.isSafeInteger((value as Note).revision) && (value as Note).revision >= 0 && typeof (value as Note).updatedAt === 'string' &&
    ((value as Note).deletedAt === null || typeof (value as Note).deletedAt === 'string')
  const boards = parsed.boards ?? []
  const isBoard = (value: unknown): value is Board => !!value && typeof value === 'object' &&
    typeof (value as Board).id === 'string' && typeof (value as Board).title === 'string' &&
    typeof (value as Board).sceneJson === 'string' && new TextEncoder().encode((value as Board).sceneJson).byteLength <= 750_000 &&
    (() => { try { return JSON.parse((value as Board).sceneJson)?.type === 'excalidraw' } catch { return false } })() &&
    ((value as Board).folderId === null || typeof (value as Board).folderId === 'string') &&
    Number.isSafeInteger((value as Board).revision) && (value as Board).revision >= 0 && typeof (value as Board).updatedAt === 'string' &&
    ((value as Board).deletedAt === null || typeof (value as Board).deletedAt === 'string')
  if (parsed.folders.length > 20_000 || parsed.notes.length > 100_000 || boards.length > 20_000 || !parsed.folders.every(isFolder) || !parsed.notes.every(isNote) || !boards.every(isBoard)) {
    throw new Error('O backup contém itens inválidos ou excede o limite de importação.')
  }
  const folderIds = new Set(parsed.folders.map((folder) => folder.id))
  if (folderIds.size !== parsed.folders.length || new Set(parsed.notes.map((note) => note.id)).size !== parsed.notes.length || new Set(boards.map((board) => board.id)).size !== boards.length ||
    parsed.folders.some((folder) => folder.parentId === folder.id || (folder.parentId && !folderIds.has(folder.parentId))) ||
    parsed.notes.some((note) => note.folderId && !folderIds.has(note.folderId)) || boards.some((board) => board.folderId && !folderIds.has(board.folderId))) {
    throw new Error('O backup contém pastas repetidas ou referências inválidas.')
  }
  await db.transaction('rw', db.folders, db.notes, db.boards, db.outbox, async () => {
    for (const folder of parsed.folders!) {
      const existing = await db.folders.get(folder.id)
      await saveLocalFolder({ ...folder, revision: existing?.revision ?? 0 })
    }
    for (const note of parsed.notes!) {
      const existing = await db.notes.get(note.id)
      await saveLocalNote({ ...note, revision: existing?.revision ?? 0 })
    }
    for (const board of boards) {
      const existing = await db.boards.get(board.id)
      await saveLocalBoard({ ...board, revision: existing?.revision ?? 0 })
    }
  })
}

export function toEntity(kind: EntityKind, data: Note | Folder) {
  return { entity: kind, data }
}
