import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db, FiveDatabase, moveFilesToFolder, moveFolderToParent, moveNotesToFolder, patchLocalBoard, patchLocalNote, saveLocalBoard, saveLocalNote, seedIfEmpty, softDeleteFolder } from '../src/lib/database'
import { importBackup, resolveConflict, syncNow } from '../src/lib/sync'
import { stripRetiredCanvasContent } from '../src/lib/legacyNoteContent'
import type { Board, Folder, Note, OutboxOperation } from '../src/lib/types'

const makeNote = (id: string, revision = 0): Note => ({
  id, folderId: null, title: 'Rascunho', body: '', revision,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})
const makeBoard = (id: string, revision = 0, sceneJson = '{"type":"excalidraw","elements":[]}'): Board => ({
  id, folderId: null, title: 'Diagrama', sceneJson, revision,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
})

beforeEach(async () => {
  await db.transaction('rw', db.folders, db.notes, db.boards, db.outbox, db.settings, async () => {
    await Promise.all([db.folders.clear(), db.notes.clear(), db.boards.clear(), db.outbox.clear(), db.settings.clear()])
  })
  localStorage.clear()
})

describe('cópia local e fila de sincronização', () => {
  it('migra a fila antiga para uma operação única por entidade', async () => {
    const name = `five-migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      folders: 'id, parentId, sortOrder, revision, updatedAt, deletedAt',
      notes: 'id, folderId, title, revision, updatedAt, deletedAt',
      outbox: 'opId, entityId, entity, updatedAt',
      settings: 'key',
    })
    const note = { ...makeNote('migration-note', 4), title: 'Título final', updatedAt: '2026-01-03T00:00:00.000Z' }
    await legacy.open()
    await legacy.table('notes').put(note)
    await legacy.table('outbox').bulkPut([
      { opId: 'old-op-1', deviceId: 'device-a', entity: 'note', entityId: note.id, baseRevision: 2, data: { ...note, title: 'Título antigo' }, updatedAt: '2026-01-01T00:00:00.000Z' },
      { opId: 'old-op-2', deviceId: 'device-a', entity: 'note', entityId: note.id, baseRevision: 3, data: note, updatedAt: note.updatedAt },
    ])
    legacy.close()

    const upgraded = new FiveDatabase(name)
    try {
      await upgraded.open()
      expect(await upgraded.outbox.toArray()).toHaveLength(1)
      expect(await upgraded.outbox.toCollection().first()).toMatchObject({
        entityId: note.id, baseRevision: 3, data: { title: 'Título final' },
      })
      await expect(upgraded.outbox.add({
        opId: 'duplicate-op', deviceId: 'device-a', entity: 'note', entityId: note.id,
        baseRevision: 4, data: note, updatedAt: note.updatedAt,
      })).rejects.toThrow()
    } finally {
      upgraded.close()
      await Dexie.delete(name)
    }
  })

  it('cria a estrutura inicial uma única vez', async () => {
    await Promise.all([seedIfEmpty(), seedIfEmpty()])
    expect(await db.folders.count()).toBe(6)
    expect((await db.notes.toArray()).map((item) => item.title)).toEqual(['Comece por aqui'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('não reescreve notas existentes ao carregar a estrutura inicial', async () => {
    await seedIfEmpty()
    const starter = (await db.notes.toArray())[0]
    const previousBody = `${starter.body.replace(/\bfive\b/g, 'Five')}\n\nMinha anotação pessoal.`
    await db.notes.put({ ...starter, body: previousBody, revision: 3 })

    await seedIfEmpty()

    expect(await db.notes.get(starter.id)).toMatchObject({ body: previousBody, revision: 3 })
    expect(await db.outbox.count()).toBe(0)
  })

  it('usa um bloqueio entre abas antes de sincronizar', async () => {
    const originalLock = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const requestLock = vi.fn(async (_name: string, _options: unknown, run: () => Promise<unknown>) => run())
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: requestLock } })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const health = String(input).endsWith('/health')
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => health ? { status: 'ok' } : { acks: [], changes: [], conflicts: [], cursor: 0, hasMore: false },
      } as Response
    }))
    await db.settings.put({ key: 'initialPullComplete', value: 1 })

    try {
      await expect(syncNow()).resolves.toBe('synced')
      expect(requestLock).toHaveBeenCalledOnce()
      expect(requestLock).toHaveBeenCalledWith('five-notes-sync', { mode: 'exclusive' }, expect.any(Function))
    } finally {
      vi.unstubAllGlobals()
      if (originalLock) Object.defineProperty(navigator, 'locks', originalLock)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('mantém o five em modo local quando a API de saúde está indisponível na inicialização', async () => {
    const localNote = makeNote('offline-startup')
    await saveLocalNote(localNote)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede indisponível') }))

    try {
      await expect(syncNow()).resolves.toBe('local')
      expect(await db.notes.get(localNote.id)).toMatchObject({ title: localNote.title, body: localNote.body })
      expect(await db.outbox.where('entityId').equals(localNote.id).count()).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    ['redirecionamento do Access', { ok: true, status: 200, redirected: true }],
    ['HTTP 401', { ok: false, status: 401, redirected: false }],
    ['HTTP 403', { ok: false, status: 403, redirected: false }],
  ])('identifica %s como sessão expirada e preserva a fila local', async (_name, result) => {
    const localNote = makeNote('access-expired-note')
    await saveLocalNote(localNote)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ...result,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok' }),
    }) as Response))

    try {
      await expect(syncNow()).resolves.toBe('access-expired')
      expect(await db.notes.get(localNote.id)).toMatchObject({ title: localNote.title })
      expect(await db.outbox.where('entityId').equals(localNote.id).count()).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('limpa canvas legado recebido pela sincronização e publica a nota limpa', async () => {
    const legacy = makeNote('legacy-note', 5)
    legacy.body = 'Texto que deve ficar.\n\n<!--five-system-design:v1:eyJ2ZXJzaW9uIjoxfQ==-->\n\n<!--!--five-canvas-block-->\n\n```five-canvas\n```'
    const uploaded: OutboxOperation[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/health')) return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
      } as Response

      const request = JSON.parse(String(init?.body)) as { operations: OutboxOperation[] }
      if (!request.operations.length) return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ acks: [], changes: [{ entity: 'note', entityId: legacy.id, data: legacy }], conflicts: [], cursor: 1, hasMore: false }),
      } as Response

      uploaded.push(...request.operations)
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ acks: request.operations.map((op) => ({ opId: op.opId, entity: op.entity, entityId: op.entityId, revision: 6 })), changes: [], conflicts: [], cursor: 2, hasMore: false }),
      } as Response
    }))

    try {
      await expect(syncNow()).resolves.toBe('synced')
      expect((await db.notes.get(legacy.id))?.body).toBe(stripRetiredCanvasContent(legacy.body))
      expect(uploaded).toHaveLength(1)
      expect(uploaded[0].data).toMatchObject({ body: 'Texto que deve ficar.' })
      expect(await db.outbox.count()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('mantém o último rascunho numa única operação pendente', async () => {
    await saveLocalNote(makeNote('note-a'))
    const original = await db.outbox.toCollection().first()
    await patchLocalNote('note-a', { title: 'System Design' })
    await patchLocalNote('note-a', { body: 'API, DB e filas' })
    const operations = await db.outbox.toArray()
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({ opId: original?.opId, baseRevision: null, data: { title: 'System Design', body: 'API, DB e filas' } })
    expect((await db.notes.get('note-a'))?.body).toBe('API, DB e filas')
  })

  it('move um grupo de notas atomicamente e registra a pasta nova na fila de sincronização', async () => {
    const movedFolder: Folder = { id: 'folder-destination', parentId: null, name: 'Projetos', sortOrder: 2, revision: 4, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const first = { ...makeNote('move-a', 3), folderId: null, title: 'Aula', body: 'Ideias para preservar' }
    const second = { ...makeNote('move-b'), folderId: null, title: 'Projeto' }
    await db.folders.put(movedFolder)
    await db.notes.bulkPut([first, second])

    await expect(moveNotesToFolder([first.id, second.id, first.id], movedFolder.id)).resolves.toBe(2)
    expect(await db.notes.bulkGet([first.id, second.id])).toMatchObject([
      { folderId: movedFolder.id, title: 'Aula', body: 'Ideias para preservar', revision: 3 },
      { folderId: movedFolder.id, title: 'Projeto' },
    ])
    expect(await db.outbox.where('entity').equals('note').toArray()).toHaveLength(2)
    expect(await db.outbox.where('entityId').equals(first.id).first()).toMatchObject({ baseRevision: 3, data: { folderId: movedFolder.id, body: 'Ideias para preservar' } })
    await expect(moveNotesToFolder([first.id, second.id], movedFolder.id)).resolves.toBe(0)
  })

  it('move notas e quadros juntos sem perder conteúdo e registra cada tipo na fila', async () => {
    const destination: Folder = { id: 'move-mixed-folder', parentId: null, name: 'Projetos', sortOrder: 2, revision: 2, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const note = { ...makeNote('move-mixed-note', 3), folderId: null, body: 'Conteúdo preservado.' }
    const board = { ...makeBoard('move-mixed-board', 4), folderId: null, sceneJson: '{"elements":[{"id":"shape-1"}]}' }
    await db.folders.put(destination)
    await db.notes.put(note)
    await db.boards.put(board)

    await expect(moveFilesToFolder([
      { entity: 'note', entityId: note.id },
      { entity: 'board', entityId: board.id },
      { entity: 'board', entityId: board.id },
    ], destination.id)).resolves.toBe(2)

    expect(await db.notes.get(note.id)).toMatchObject({ folderId: destination.id, body: 'Conteúdo preservado.', revision: 3 })
    expect(await db.boards.get(board.id)).toMatchObject({ folderId: destination.id, sceneJson: board.sceneJson, revision: 4 })
    expect(await db.outbox.where('entityId').equals(note.id).first()).toMatchObject({ entity: 'note', baseRevision: 3, data: { folderId: destination.id, body: note.body } })
    expect(await db.outbox.where('entityId').equals(board.id).first()).toMatchObject({ entity: 'board', baseRevision: 4, data: { folderId: destination.id, sceneJson: board.sceneJson } })
    await expect(moveFilesToFolder([{ entity: 'board', entityId: board.id }], destination.id)).resolves.toBe(0)
  })

  it('move pastas sem permitir ciclos e preserva a fila local', async () => {
    const parent: Folder = { id: 'folder-parent', parentId: null, name: 'Projetos', sortOrder: 0, revision: 3, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const child: Folder = { ...parent, id: 'folder-child', parentId: parent.id, name: 'Aplicativo', revision: 2 }
    const grandchild: Folder = { ...parent, id: 'folder-grandchild', parentId: child.id, name: 'Pesquisa' }
    await db.folders.bulkPut([parent, child, grandchild])

    await expect(moveFolderToParent(parent.id, grandchild.id)).resolves.toBe(false)
    await expect(moveFolderToParent(child.id, parent.id)).resolves.toBe(false)
    await expect(moveFolderToParent(child.id, null)).resolves.toBe(true)
    expect(await db.folders.get(child.id)).toMatchObject({ parentId: null, revision: 2 })
    expect(await db.outbox.where('entityId').equals(child.id).first()).toMatchObject({ entity: 'folder', baseRevision: 2, data: { parentId: null } })
  })

  it('exclui uma pasta atomicamente e realoca notas, quadros e subpastas ao destino certo', async () => {
    const parent: Folder = { id: 'delete-parent', parentId: null, name: 'Aulas', sortOrder: 0, revision: 3, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const folder: Folder = { ...parent, id: 'delete-folder', parentId: parent.id, name: 'Biologia', revision: 4 }
    const child: Folder = { ...parent, id: 'delete-child', parentId: folder.id, name: 'Células' }
    const note = { ...makeNote('delete-child-note', 5), folderId: folder.id, body: 'Conteúdo preservado' }
    const board = { ...makeBoard('delete-child-board', 6), folderId: folder.id, sceneJson: '{"type":"excalidraw","elements":[{"id":"keep"}]}' }
    await db.folders.bulkPut([parent, folder, child])
    await db.notes.put(note)
    await db.boards.put(board)

    await expect(softDeleteFolder(folder)).resolves.toMatchObject({ notes: 1, boards: 1, folders: 1, destinationId: parent.id })
    expect(await db.folders.get(folder.id)).toMatchObject({ deletedAt: expect.any(String) })
    expect(await db.folders.get(child.id)).toMatchObject({ parentId: parent.id })
    expect(await db.notes.get(note.id)).toMatchObject({ folderId: parent.id, body: note.body })
    expect(await db.boards.get(board.id)).toMatchObject({ folderId: parent.id, sceneJson: board.sceneJson })
    expect(await db.outbox.where('entityId').equals(board.id).first()).toMatchObject({ entity: 'board', data: { folderId: parent.id } })
    expect(await db.outbox.where('entityId').equals(note.id).first()).toMatchObject({ entity: 'note', data: { folderId: parent.id } })
  })

  it('envia arquivos de uma pasta raiz para Entrada e mantém subpastas na raiz', async () => {
    const inbox: Folder = { id: 'five-folder-inbox-v1', parentId: null, name: 'Entrada', sortOrder: 0, revision: 0, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const folder: Folder = { ...inbox, id: 'delete-root', name: 'Rascunhos' }
    const child: Folder = { ...inbox, id: 'delete-root-child', parentId: folder.id, name: 'Subpasta' }
    const note = { ...makeNote('delete-root-note'), folderId: folder.id }
    const board = { ...makeBoard('delete-root-board'), folderId: folder.id }
    await db.folders.bulkPut([inbox, folder, child])
    await db.notes.put(note)
    await db.boards.put(board)

    await expect(softDeleteFolder(folder)).resolves.toMatchObject({ destinationId: inbox.id })
    expect(await db.folders.get(child.id)).toMatchObject({ parentId: null })
    expect(await db.notes.get(note.id)).toMatchObject({ folderId: inbox.id })
    expect(await db.boards.get(board.id)).toMatchObject({ folderId: inbox.id })
  })

  it('salva e agrupa as alterações do quadro numa única operação local', async () => {
    await saveLocalBoard(makeBoard('board-a'))
    const original = await db.outbox.where('entityId').equals('board-a').first()
    await patchLocalBoard('board-a', { title: 'Sistema de cache' })
    await patchLocalBoard('board-a', { sceneJson: '{"type":"excalidraw","elements":[{"id":"shape"}]}' })
    expect(await db.outbox.where('entityId').equals('board-a').toArray()).toHaveLength(1)
    expect(await db.outbox.where('entityId').equals('board-a').first()).toMatchObject({
      opId: original?.opId, entity: 'board', baseRevision: null,
      data: { title: 'Sistema de cache', sceneJson: '{"type":"excalidraw","elements":[{"id":"shape"}]}' },
    })
  })

  it('usa a revisão confirmada pelo servidor como base da próxima escrita', async () => {
    await db.notes.put(makeNote('note-b', 4))
    await patchLocalNote('note-b', { body: 'alteração' })
    expect(await db.outbox.toCollection().first()).toMatchObject({ baseRevision: 4, data: { body: 'alteração' } })
  })

  it('pausa a fila quando uma nota muda durante a requisição de sincronização', async () => {
    await db.settings.put({ key: 'initialPullComplete', value: 1 })
    await saveLocalNote(makeNote('note-typing'))
    let syncRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
      } as Response

      syncRequests += 1
      const request = JSON.parse(String(init?.body)) as { operations: OutboxOperation[] }
      const original = request.operations[0]
      await new Promise((resolve) => setTimeout(resolve, 2))
      await patchLocalNote('note-typing', { title: 'Título completo' })
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          acks: [{ opId: original.opId, entity: 'note', entityId: original.entityId, revision: 1 }],
          changes: [], conflicts: [], cursor: 0, hasMore: false,
        }),
      } as Response
    }))

    try {
      await expect(syncNow()).resolves.toBe('pending')
      expect(syncRequests).toBe(1)
      expect(await db.outbox.toCollection().first()).toMatchObject({
        entityId: 'note-typing', baseRevision: 1, data: { title: 'Título completo' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reconcilia a operação pendente com a versão local antes de sincronizar', async () => {
    await db.settings.put({ key: 'initialPullComplete', value: 1 })
    const latest = { ...makeNote('legacy-queue', 3), title: 'Título mais recente', updatedAt: '2026-01-03T00:00:00.000Z' }
    await db.notes.put(latest)
    await db.outbox.put({ opId: 'legacy-op-2', deviceId: 'device-a', entity: 'note', entityId: latest.id, baseRevision: 2, data: { ...latest, title: 'Título antigo' }, updatedAt: '2026-01-01T00:00:00.000Z' })
    let sent: OutboxOperation[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
      } as Response
      const request = JSON.parse(String(init?.body)) as { operations: OutboxOperation[] }
      sent = request.operations
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          acks: sent.map((operation) => ({ opId: operation.opId, entity: operation.entity, entityId: operation.entityId, revision: 4 })),
          changes: [], conflicts: [], cursor: 0, hasMore: false,
        }),
      } as Response
    }))

    try {
      await expect(syncNow()).resolves.toBe('synced')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ baseRevision: 3, data: { title: 'Título mais recente' } })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('importa backup como alterações sincronizáveis', async () => {
    const folder = { id: 'imported-folder', parentId: null, name: 'Aulas', sortOrder: 0, revision: 3, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const note = { ...makeNote('imported-note', 2), folderId: folder.id, title: 'System Design', body: 'Anotação preservada.\n\n<!--five-system-design:v1:eyJ2ZXJzaW9uIjoxfQ==-->' }
    const contents = JSON.stringify({ format: 'five-backup', version: 1, folders: [folder], notes: [note] })
    const file = Object.assign(new File([contents], 'backup.json', { type: 'application/json' }), { text: async () => contents })
    await importBackup(file)
    expect(await db.folders.get(folder.id)).toMatchObject({ name: 'Aulas', revision: 0 })
    expect(await db.notes.get(note.id)).toMatchObject({ title: 'System Design', body: 'Anotação preservada.', revision: 0 })
    expect(await db.outbox.count()).toBe(2)
  })

  it('importa quadros do backup v2 sem duplicar dados dentro das notas', async () => {
    const folder: Folder = { id: 'board-folder', parentId: null, name: 'Aulas', sortOrder: 0, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const board: Board = { ...makeBoard('backup-board'), folderId: folder.id }
    const note = { ...makeNote('note-with-board'), folderId: folder.id, body: '[![Diagrama](https://five-note.invalid/board/backup-board)](https://five-note.invalid/board/backup-board)' }
    const contents = JSON.stringify({ format: 'five-backup', version: 2, folders: [folder], notes: [note], boards: [board] })
    const file = Object.assign(new File([contents], 'backup.json', { type: 'application/json' }), { text: async () => contents })

    await importBackup(file)

    expect(await db.boards.get(board.id)).toMatchObject({ title: 'Diagrama', sceneJson: board.sceneJson, revision: 0 })
    expect(await db.notes.get(note.id)).toMatchObject({ body: note.body })
    expect(await db.outbox.toArray()).toHaveLength(3)
  })

  it('rejeita backup inválido sem gravar parte dele', async () => {
    const contents = JSON.stringify({ format: 'five-backup', version: 1, folders: [], notes: [{ id: 'bad' }] })
    const file = Object.assign(new File([contents], 'backup.json'), { text: async () => contents })
    await expect(importBackup(file)).rejects.toThrow('inválidos')
    expect(await db.folders.count()).toBe(0)
    expect(await db.notes.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('preserva filhos ao criar uma cópia de pasta em conflito', async () => {
    const folder: Folder = { id: 'folder-a', parentId: null, name: 'Local', sortOrder: 0, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
    const child: Folder = { ...folder, id: 'folder-child', parentId: folder.id, name: 'Subpasta' }
    const note: Note = { ...makeNote('note-child', 1), folderId: folder.id }
    const operation: OutboxOperation = { opId: 'op-folder', deviceId: 'device-a', entity: 'folder', entityId: folder.id, baseRevision: 1, data: { ...folder, name: 'Mudança local' }, updatedAt: folder.updatedAt }
    await db.transaction('rw', db.folders, db.notes, db.outbox, async () => {
      await db.folders.bulkPut([folder, child])
      await db.notes.put(note)
      await db.outbox.put(operation)
    })
    await resolveConflict(operation, { ...folder, name: 'Mudança remota', revision: 2 })
    const conflictFolder = (await db.folders.toArray()).find((item) => item.id !== folder.id && item.name.includes('conflito'))
    expect(conflictFolder).toBeDefined()
    expect((await db.folders.get(child.id))?.parentId).toBe(conflictFolder?.id)
    expect((await db.notes.get(note.id))?.folderId).toBe(conflictFolder?.id)
    expect((await db.folders.get(folder.id))?.name).toBe('Mudança remota')
    expect((await db.outbox.toArray()).map((item) => `${item.entity}:${item.entityId}`)).toEqual(expect.arrayContaining([`folder:${child.id}`, `note:${note.id}`]))
  })

  it('não duplica nota quando o conflito remoto tem o mesmo conteúdo', async () => {
    const local = { ...makeNote('same-note', 1), title: 'Sistema de cache', body: 'Cache de leitura' }
    const remote = { ...local, revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' }
    const operation: OutboxOperation = { opId: 'op-same-note', deviceId: 'device-a', entity: 'note', entityId: local.id, baseRevision: 1, data: local, updatedAt: local.updatedAt }
    await db.notes.put(local)
    await db.outbox.put(operation)

    await resolveConflict(operation, remote)

    expect(await db.notes.toArray()).toEqual([remote])
    expect(await db.outbox.count()).toBe(0)
  })

  it('mantém uma única cópia durante conflitos repetidos da mesma edição', async () => {
    const local = { ...makeNote('typing-conflict', 1), title: 'Título local' }
    const firstRemote = { ...makeNote('typing-conflict', 2), title: 'Título remoto' }
    const firstOperation: OutboxOperation = {
      opId: 'typing-op-1', deviceId: 'device-a', entity: 'note', entityId: local.id,
      baseRevision: 1, data: local, updatedAt: local.updatedAt,
    }
    await db.notes.put(local)
    await db.outbox.put(firstOperation)

    await resolveConflict(firstOperation, firstRemote)
    const localAfterFirstConflict = { ...firstRemote, title: 'Título local atualizado' }
    await patchLocalNote(local.id, { title: localAfterFirstConflict.title })
    const secondOperation = (await db.outbox.where('entityId').equals(local.id).first())!
    const secondRemote = { ...firstRemote, title: 'Título remoto mais recente', revision: 3 }

    await resolveConflict(secondOperation, secondRemote)

    expect((await db.notes.toArray()).filter((note) => note.id !== local.id)).toHaveLength(1)
    expect(await db.notes.get(local.id)).toMatchObject({ title: 'Título local atualizado', revision: 3 })
    expect(await db.outbox.where('entityId').equals(local.id).first()).toMatchObject({
      baseRevision: 3, data: { title: 'Título local atualizado' },
    })
  })

  it('rebaseia corridas entre abas do mesmo aparelho sem criar cópia', async () => {
    const local = { ...makeNote('same-device-race', 1), title: 'Título digitado' }
    const remote = { ...makeNote('same-device-race', 2), title: 'Título anterior' }
    const operation: OutboxOperation = {
      opId: 'same-device-operation', deviceId: 'device-shared', entity: 'note', entityId: local.id,
      baseRevision: 1, data: local, updatedAt: local.updatedAt,
    }
    await db.notes.put(local)
    await db.outbox.put(operation)

    await resolveConflict(operation, remote, 'device-shared')

    expect(await db.notes.toArray()).toEqual([expect.objectContaining({ id: local.id, title: 'Título digitado', revision: 2 })])
    expect(await db.outbox.where('entityId').equals(local.id).first()).toMatchObject({ baseRevision: 2, data: { title: 'Título digitado' } })
  })

  it('preserva a versão local do quadro ao receber uma edição concorrente de outro aparelho', async () => {
    const local = makeBoard('shared-board', 1, '{"type":"excalidraw","elements":[{"text":"local"}]}')
    const remote = { ...makeBoard('shared-board', 2, '{"type":"excalidraw","elements":[{"text":"remoto"}]}'), title: 'Versão remota' }
    const operation: OutboxOperation = { opId: 'board-op', deviceId: 'device-a', entity: 'board', entityId: local.id, baseRevision: 1, data: local, updatedAt: local.updatedAt }
    await db.boards.put(local)
    await db.outbox.put(operation)

    await resolveConflict(operation, remote, 'device-b')

    expect(await db.boards.get(local.id)).toMatchObject({ revision: 2, title: 'Versão remota', sceneJson: remote.sceneJson })
    const recovery = (await db.boards.toArray()).find((board) => board.id !== local.id)
    expect(recovery).toMatchObject({ title: 'Conflito — Diagrama', sceneJson: local.sceneJson, revision: 0 })
    expect(await db.outbox.where('entity').equals('board').count()).toBe(1)
    expect((await db.outbox.where('entity').equals('board').first())?.entityId).toBe(recovery?.id)
  })

  it('reenvia como criação quando a nota não existe no remoto', async () => {
    const note = makeNote('orphan-note', 4)
    const operation: OutboxOperation = { opId: 'op-orphan', deviceId: 'device-a', entity: 'note', entityId: note.id, baseRevision: 3, data: note, updatedAt: note.updatedAt }
    await db.notes.put(note)
    await db.outbox.put(operation)
    await resolveConflict(operation, null)
    expect(await db.notes.get(note.id)).toMatchObject({ revision: 0 })
    expect(await db.outbox.toCollection().first()).toMatchObject({ entityId: note.id, baseRevision: null, data: { revision: 0 } })
    expect(await db.outbox.get(operation.opId)).toBeUndefined()
  })
})
