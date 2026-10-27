import Dexie, { type Table } from 'dexie'
import { SEED_FOLDER_IDS, SEED_NOTE_ID, type Board, type FileMove, type Folder, type Note, type OutboxOperation } from './types'
import { stripRetiredCanvasContent } from './legacyNoteContent'

export class FiveDatabase extends Dexie {
  folders!: Table<Folder, string>
  notes!: Table<Note, string>
  boards!: Table<Board, string>
  outbox!: Table<OutboxOperation, string>
  settings!: Table<{ key: string; value: string | number }, string>

  constructor(name = 'five-notes') {
    super(name)
    this.version(1).stores({
      folders: 'id, parentId, sortOrder, revision, updatedAt, deletedAt',
      notes: 'id, folderId, title, revision, updatedAt, deletedAt',
      outbox: 'opId, entityId, entity, updatedAt',
      settings: 'key',
    })
    this.version(2).stores({
      folders: 'id, parentId, sortOrder, revision, updatedAt, deletedAt',
      notes: 'id, folderId, title, revision, updatedAt, deletedAt',
      outbox: 'opId, entityId, entity, updatedAt',
      settings: 'key',
    }).upgrade(async (transaction) => {
      const outbox = transaction.table('outbox')
      const operations = await outbox.toArray() as OutboxOperation[]
      const groups = new Map<string, OutboxOperation[]>()
      for (const operation of operations) {
        const key = `${operation.entity}:${operation.entityId}`
        const group = groups.get(key) ?? []
        group.push(operation)
        groups.set(key, group)
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue
        const latest = group.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b)
        const table = transaction.table(latest.entity === 'note' ? 'notes' : 'folders')
        const entity = await table.get(latest.entityId) as Note | Folder | undefined
        const next = entity ? { ...latest, data: entity, updatedAt: entity.updatedAt } : latest
        for (const operation of group) await outbox.delete(operation.opId)
        await outbox.put(next)
      }
    })
    this.version(3).stores({
      folders: 'id, parentId, sortOrder, revision, updatedAt, deletedAt',
      notes: 'id, folderId, title, revision, updatedAt, deletedAt',
      outbox: 'opId, entityId, entity, updatedAt, &[entity+entityId]',
      settings: 'key',
    })
    this.version(4).stores({
      folders: 'id, parentId, sortOrder, revision, updatedAt, deletedAt',
      notes: 'id, folderId, title, revision, updatedAt, deletedAt',
      boards: 'id, folderId, title, revision, updatedAt, deletedAt',
      outbox: 'opId, entityId, entity, updatedAt, &[entity+entityId]',
      settings: 'key',
    })
  }
}

export const db = new FiveDatabase()

const now = () => new Date().toISOString()

export async function seedIfEmpty() {
  const stamp = now()
  const folders: Folder[] = [
    { id: SEED_FOLDER_IDS.inbox, parentId: null, name: 'Entrada', sortOrder: 0, revision: 0, updatedAt: stamp, deletedAt: null },
    { id: SEED_FOLDER_IDS.study, parentId: null, name: 'Estudos', sortOrder: 1, revision: 0, updatedAt: stamp, deletedAt: null },
    { id: SEED_FOLDER_IDS.course, parentId: SEED_FOLDER_IDS.study, name: 'Curso', sortOrder: 0, revision: 0, updatedAt: stamp, deletedAt: null },
    { id: SEED_FOLDER_IDS.software, parentId: SEED_FOLDER_IDS.study, name: 'Software', sortOrder: 1, revision: 0, updatedAt: stamp, deletedAt: null },
    { id: SEED_FOLDER_IDS.projects, parentId: null, name: 'Projetos', sortOrder: 2, revision: 0, updatedAt: stamp, deletedAt: null },
    { id: SEED_FOLDER_IDS.personal, parentId: null, name: 'Pessoal', sortOrder: 3, revision: 0, updatedAt: stamp, deletedAt: null },
  ]
  const welcome: Note = {
    id: SEED_NOTE_ID,
    folderId: SEED_FOLDER_IDS.inbox,
    title: 'Comece por aqui',
    body: '# Seu espaço no five\n\nAnote primeiro. Organize depois. Esta nota está na **Entrada**.\n\n- Use as pastas para dar contexto às notas.\n- Use o botão **Vincular nota** para conectar esta nota a outra.\n- Suas notas são salvas neste aparelho enquanto você escreve.\n\nQuando o five estiver ligado à sua conta Cloudflare, ele também sincronizará entre seus dispositivos. Você pode apagar esta nota quando quiser.',
    revision: 0,
    updatedAt: stamp,
    deletedAt: null,
  }
  await db.transaction('rw', db.folders, db.notes, db.settings, async () => {
    if (await db.folders.count()) return
    await db.folders.bulkAdd(folders)
    await db.notes.add(welcome)
    await db.settings.put({ key: 'seeded', value: 1 })
  })
}

export function newId() {
  return crypto.randomUUID()
}

export async function saveLocalNote(note: Note) {
  const stamp = now()
  const next = { ...note, body: stripRetiredCanvasContent(note.body), updatedAt: stamp }
  await db.transaction('rw', db.notes, db.outbox, async () => {
    await db.notes.put(next)
    const existing = await db.outbox.where('entityId').equals(note.id).filter((operation) => operation.entity === 'note').first()
    await db.outbox.put({
      opId: existing?.opId ?? newId(),
      deviceId: getDeviceId(),
      entity: 'note',
      entityId: note.id,
      baseRevision: existing ? existing.baseRevision : (note.revision || null),
      data: next,
      updatedAt: stamp,
    })
  })
  return next
}

export async function patchLocalNote(id: string, patch: Partial<Note>) {
  const stamp = now()
  return db.transaction('rw', db.notes, db.outbox, async () => {
    const current = await db.notes.get(id)
    if (!current) return null
    const next = { ...current, ...patch, body: stripRetiredCanvasContent(patch.body ?? current.body), updatedAt: stamp }
    await db.notes.put(next)
    const existing = await db.outbox.where('entityId').equals(id).filter((operation) => operation.entity === 'note').first()
    await db.outbox.put({
      opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'note', entityId: id,
      baseRevision: existing ? existing.baseRevision : (current.revision || null), data: next, updatedAt: stamp,
    })
    return next
  })
}

export async function moveFilesToFolder(files: FileMove[], folderId: string) {
  const uniqueFiles = [...new Map(files.map((file) => [`${file.entity}:${file.entityId}`, file])).values()]
  return db.transaction('rw', db.folders, db.notes, db.boards, db.outbox, async () => {
    const folder = await db.folders.get(folderId)
    if (!folder || folder.deletedAt) return 0

    let moved = 0
    for (const file of uniqueFiles) {
      const current = file.entity === 'note'
        ? await db.notes.get(file.entityId)
        : await db.boards.get(file.entityId)
      if (!current || current.deletedAt || current.folderId === folderId) continue
      const stamp = now()
      const next = { ...current, folderId, updatedAt: stamp }
      if (file.entity === 'note') await db.notes.put(next as Note)
      else await db.boards.put(next as Board)
      const existing = await db.outbox.where('entityId').equals(file.entityId).filter((operation) => operation.entity === file.entity).first()
      await db.outbox.put({
        opId: existing?.opId ?? newId(),
        deviceId: getDeviceId(),
        entity: file.entity,
        entityId: file.entityId,
        baseRevision: existing ? existing.baseRevision : (current.revision || null),
        data: next,
        updatedAt: stamp,
      })
      moved += 1
    }
    return moved
  })
}

export function moveNotesToFolder(noteIds: string[], folderId: string) {
  return moveFilesToFolder(noteIds.map((entityId) => ({ entity: 'note', entityId })), folderId)
}

/** Move a folder and its complete subtree without changing the contained files. */
export async function moveFolderToParent(folderId: string, parentId: string | null) {
  return db.transaction('rw', db.folders, db.outbox, async () => {
    const folder = await db.folders.get(folderId)
    if (!folder || folder.deletedAt || folder.parentId === parentId) return false
    if (parentId) {
      const parent = await db.folders.get(parentId)
      if (!parent || parent.deletedAt || parent.id === folderId) return false
      let current: Folder | undefined = parent
      const visited = new Set<string>()
      while (current && !visited.has(current.id)) {
        if (current.id === folderId) return false
        visited.add(current.id)
        current = current.parentId ? await db.folders.get(current.parentId) : undefined
      }
    }
    await putFolderAndQueue({ ...folder, parentId }, folder)
    return true
  })
}

export async function saveLocalFolder(folder: Folder) {
  const stamp = now()
  const next = { ...folder, updatedAt: stamp }
  await db.transaction('rw', db.folders, db.outbox, async () => {
    await db.folders.put(next)
    const existing = await db.outbox.where('entityId').equals(folder.id).filter((operation) => operation.entity === 'folder').first()
    await db.outbox.put({
      opId: existing?.opId ?? newId(),
      deviceId: getDeviceId(),
      entity: 'folder',
      entityId: folder.id,
      baseRevision: existing ? existing.baseRevision : (folder.revision || null),
      data: next,
      updatedAt: stamp,
    })
  })
  return next
}

async function putFolderAndQueue(folder: Folder, current: Folder) {
  const stamp = now()
  const next = { ...folder, updatedAt: stamp }
  await db.folders.put(next)
  const existing = await db.outbox.where('entityId').equals(folder.id).filter((operation) => operation.entity === 'folder').first()
  await db.outbox.put({
    opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'folder', entityId: folder.id,
    baseRevision: existing ? existing.baseRevision : (current.revision || null), data: next, updatedAt: stamp,
  })
}

export async function saveLocalBoard(board: Board) {
  const stamp = now()
  const next = { ...board, updatedAt: stamp }
  await db.transaction('rw', db.boards, db.outbox, async () => {
    await db.boards.put(next)
    const existing = await db.outbox.where('entityId').equals(board.id).filter((operation) => operation.entity === 'board').first()
    await db.outbox.put({
      opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'board', entityId: board.id,
      baseRevision: existing ? existing.baseRevision : (board.revision || null), data: next, updatedAt: stamp,
    })
  })
  return next
}

export async function patchLocalBoard(id: string, patch: Partial<Board>) {
  const stamp = now()
  return db.transaction('rw', db.boards, db.outbox, async () => {
    const current = await db.boards.get(id)
    if (!current) return null
    const next = { ...current, ...patch, updatedAt: stamp }
    await db.boards.put(next)
    const existing = await db.outbox.where('entityId').equals(id).filter((operation) => operation.entity === 'board').first()
    await db.outbox.put({
      opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'board', entityId: id,
      baseRevision: existing ? existing.baseRevision : (current.revision || null), data: next, updatedAt: stamp,
    })
    return next
  })
}

export async function softDeleteBoard(board: Board) {
  return saveLocalBoard({ ...board, deletedAt: now() })
}

export async function softDeleteNote(note: Note) {
  return saveLocalNote({ ...note, deletedAt: now() })
}

export async function softDeleteFolder(folder: Folder) {
  const stamp = now()
  return db.transaction('rw', db.folders, db.notes, db.boards, db.outbox, async () => {
    const current = await db.folders.get(folder.id)
    if (!current || current.deletedAt) return { notes: 0, boards: 0, folders: 0, destinationId: SEED_FOLDER_IDS.inbox }
    const parent = current.parentId ? await db.folders.get(current.parentId) : undefined
    const destinationId = parent && !parent.deletedAt ? parent.id : SEED_FOLDER_IDS.inbox
    const destination = await db.folders.get(destinationId)
    const fileDestination = destination && !destination.deletedAt ? destination.id : null
    const children = await db.folders.where('parentId').equals(current.id).toArray()
    const notes = await db.notes.where('folderId').equals(current.id).toArray()
    const boards = await db.boards.where('folderId').equals(current.id).toArray()

    await putFolderAndQueue({ ...current, deletedAt: stamp }, current)
    for (const child of children) await putFolderAndQueue({ ...child, parentId: parent && !parent.deletedAt ? parent.id : null }, child)
    for (const note of notes) {
      const next = { ...note, folderId: fileDestination, updatedAt: stamp }
      await db.notes.put(next)
      const existing = await db.outbox.where('entityId').equals(note.id).filter((operation) => operation.entity === 'note').first()
      await db.outbox.put({ opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'note', entityId: note.id, baseRevision: existing ? existing.baseRevision : (note.revision || null), data: next, updatedAt: stamp })
    }
    for (const board of boards) {
      const next = { ...board, folderId: fileDestination, updatedAt: stamp }
      await db.boards.put(next)
      const existing = await db.outbox.where('entityId').equals(board.id).filter((operation) => operation.entity === 'board').first()
      await db.outbox.put({ opId: existing?.opId ?? newId(), deviceId: getDeviceId(), entity: 'board', entityId: board.id, baseRevision: existing ? existing.baseRevision : (board.revision || null), data: next, updatedAt: stamp })
    }
    return { notes: notes.length, boards: boards.length, folders: children.length, destinationId: fileDestination ? destinationId : null }
  })
}

export function getDeviceId() {
  let id = localStorage.getItem('five-device-id')
  if (!id) {
    id = newId()
    localStorage.setItem('five-device-id', id)
  }
  return id
}
