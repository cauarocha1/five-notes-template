import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export interface Env {
  FIVE_DB: D1Database
  ASSETS: { fetch(request: Request): Promise<Response> }
  ACCESS_ISSUER?: string
  ACCESS_AUD?: string
}

type Entity = 'folder' | 'note' | 'board'
type Row = Record<string, string | number | null>
type AccessJwk = JsonWebKey & { kid?: string }
interface Operation {
  opId: string
  deviceId: string
  entity: Entity
  entityId: string
  baseRevision: number | null
  data: Record<string, unknown>
  updatedAt: string
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

const jwksCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') && !isLocalRequest(url.hostname) && !await isValidAccessRequest(request, env)) {
      return json({ error: 'Sign in through five before using the API.' }, 401)
    }
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ status: 'ok' })
    if (url.pathname === '/api/sync' && request.method === 'POST') return handleSync(request, env)
    if (url.pathname === '/api/export' && request.method === 'GET') return handleExport(env)
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
    return env.ASSETS.fetch(request)
  },
}

function isLocalRequest(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function isValidAccessRequest(request: Request, env: Env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) return false
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as { kid?: string; alg?: string }
    const claims = JSON.parse(decodeBase64Url(parts[1])) as { iss?: string; aud?: string[] | string; exp?: number; nbf?: number }
    const issuer = env.ACCESS_ISSUER.replace(/\/$/, '')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud ?? []
    if (header.alg !== 'RS256' || !header.kid || claims.iss !== issuer || !audiences.includes(env.ACCESS_AUD)) return false
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds || (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + 60)) return false
    let keys = await getAccessKeys(issuer)
    let jwk = keys.find((key) => key.kid === header.kid)
    if (!jwk) {
      jwksCache.delete(issuer)
      keys = await getAccessKeys(issuer)
      jwk = keys.find((key) => key.kid === header.kid)
    }
    if (!jwk) return false
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const signature = decodeBase64UrlBytes(parts[2])
    const signedContent = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedContent)
  } catch {
    return false
  }
}

async function getAccessKeys(issuer: string) {
  const cached = jwksCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) return cached.keys
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error('Unable to load Access signing keys')
  const payload = await response.json() as { keys?: AccessJwk[] }
  if (!Array.isArray(payload.keys)) throw new Error('Invalid Access signing keys')
  jwksCache.set(issuer, { keys: payload.keys, expiresAt: Date.now() + 10 * 60_000 })
  return payload.keys
}

function decodeBase64Url(value: string) {
  return new TextDecoder().decode(decodeBase64UrlBytes(value))
}

function decodeBase64UrlBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

async function handleSync(request: Request, env: Env) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 8_000_000) return json({ error: 'Sync request is too large' }, 413)
  let input: { deviceId?: unknown; cursor?: unknown; operations?: unknown }
  try {
    const body = await request.text()
    if (new TextEncoder().encode(body).byteLength > 8_000_000) return json({ error: 'Sync request is too large' }, 413)
    input = JSON.parse(body) as typeof input
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof input.deviceId !== 'string' || input.deviceId.length > 100 || !Number.isSafeInteger(input.cursor) || Number(input.cursor) < 0 || !Array.isArray(input.operations) || input.operations.length > 50) {
    return json({ error: 'Invalid sync request' }, 400)
  }

  const acks: { opId: string; entity: Entity; entityId: string; revision: number }[] = []
  const conflicts: { operation: Operation; remote: Record<string, unknown> | null; remoteDeviceId: string | null }[] = []
  for (const candidate of input.operations) {
    if (!isOperation(candidate, input.deviceId)) return json({ error: 'Invalid operation' }, 400)
    const operation = candidate
    const prior = await env.FIVE_DB.prepare('SELECT accepted_revision FROM sync_ops WHERE op_id = ? AND device_id = ? AND entity = ? AND entity_id = ?')
      .bind(operation.opId, operation.deviceId, operation.entity, operation.entityId).first<{ accepted_revision: number }>()
    if (prior) {
      acks.push({ opId: operation.opId, entity: operation.entity, entityId: operation.entityId, revision: prior.accepted_revision })
      continue
    }

    const result = await applyOperation(env.FIVE_DB, operation)
    if (result.applied) {
      acks.push({ opId: operation.opId, entity: operation.entity, entityId: operation.entityId, revision: result.revision })
    } else {
      const rebased = await applyIfWrittenBySameDevice(env.FIVE_DB, operation)
      if (rebased) {
        acks.push({ opId: operation.opId, entity: operation.entity, entityId: operation.entityId, revision: rebased.revision })
      } else {
        const remote = await readEntity(env.FIVE_DB, operation.entity, operation.entityId)
        const remoteDeviceId = remote
          ? await deviceForRevision(env.FIVE_DB, operation.entity, operation.entityId, Number(remote.revision))
          : null
        console.warn('Sync revision conflict', {
          entity: operation.entity,
          entityId: operation.entityId,
          baseRevision: operation.baseRevision,
          remoteRevision: remote ? Number(remote.revision) : null,
          deviceId: operation.deviceId,
          remoteDeviceId,
        })
        conflicts.push({ operation, remote, remoteDeviceId })
      }
    }
  }

  const cursor = Number(input.cursor)
  const rows = await env.FIVE_DB.prepare(`
    SELECT c.sequence, c.entity, c.entity_id, c.revision,
      (SELECT s.device_id FROM sync_ops s WHERE s.entity = c.entity AND s.entity_id = c.entity_id AND s.accepted_revision = c.revision LIMIT 1) AS writer_device_id,
      n.id AS n_id, n.folder_id AS n_folder_id, n.title AS n_title, n.body_md AS n_body_md,
      n.updated_at AS n_updated_at, n.deleted_at AS n_deleted_at,
      f.id AS f_id, f.parent_id AS f_parent_id, f.name AS f_name, f.sort_order AS f_sort_order,
      f.updated_at AS f_updated_at, f.deleted_at AS f_deleted_at,
      b.id AS b_id, b.folder_id AS b_folder_id, b.title AS b_title, b.scene_json AS b_scene_json,
      b.updated_at AS b_updated_at, b.deleted_at AS b_deleted_at
    FROM change_log c
    LEFT JOIN notes n ON c.entity = 'note' AND n.id = c.entity_id
    LEFT JOIN folders f ON c.entity = 'folder' AND f.id = c.entity_id
    LEFT JOIN boards b ON c.entity = 'board' AND b.id = c.entity_id
    WHERE c.sequence > ? ORDER BY c.sequence ASC LIMIT 201
  `).bind(cursor).all<Row>()
  const sourceChanges = rows.results ?? []
  const changes: { sequence: number; entity: Entity; entityId: string; revision: number; data: Record<string, unknown> | null }[] = []
  const encoder = new TextEncoder()
  let responseBytes = 0
  for (const row of sourceChanges) {
    const entity = row.entity as Entity
    const revision = Number(row.revision)
    const data = entity === 'note'
      ? row.n_id ? {
        id: row.n_id, folderId: row.n_folder_id, title: row.n_title, body: row.n_body_md,
        revision, updatedAt: row.n_updated_at, deletedAt: row.n_deleted_at,
      } : null
      : entity === 'folder' ? row.f_id ? {
        id: row.f_id, parentId: row.f_parent_id, name: row.f_name, sortOrder: Number(row.f_sort_order),
        revision, updatedAt: row.f_updated_at, deletedAt: row.f_deleted_at,
      } : null
      : row.b_id ? {
        id: row.b_id, folderId: row.b_folder_id, title: row.b_title, sceneJson: row.b_scene_json,
        revision, updatedAt: row.b_updated_at, deletedAt: row.b_deleted_at,
      } : null
    const change = { sequence: Number(row.sequence), entity, entityId: String(row.entity_id), revision, data, deviceId: row.writer_device_id ? String(row.writer_device_id) : null }
    const changeBytes = encoder.encode(JSON.stringify(change)).byteLength
    if (changes.length >= 200 || (changes.length > 0 && responseBytes + changeBytes > 3_000_000)) break
    changes.push(change)
    responseBytes += changeBytes
  }
  const nextCursor = changes.length ? changes[changes.length - 1].sequence : cursor
  return json({ acks, conflicts, changes, cursor: nextCursor, hasMore: sourceChanges.length > changes.length })
}

async function applyIfWrittenBySameDevice(db: D1Database, operation: Operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await readEntity(db, operation.entity, operation.entityId)
    if (!remote) return null
    const revision = Number(remote.revision)
    const writer = await deviceForRevision(db, operation.entity, operation.entityId, revision)
    if (writer !== operation.deviceId) return null
    const result = await applyOperation(db, { ...operation, baseRevision: revision })
    if (result.applied) return result
  }
  return null
}

async function deviceForRevision(db: D1Database, entity: Entity, entityId: string, revision: number) {
  const row = await db.prepare(`SELECT device_id FROM sync_ops
    WHERE entity = ? AND entity_id = ? AND accepted_revision = ? LIMIT 1`)
    .bind(entity, entityId, revision).first<{ device_id: string }>()
  return row?.device_id ?? null
}

function isOperation(value: unknown, deviceId: string): value is Operation {
  if (!value || typeof value !== 'object') return false
  const op = value as Partial<Operation>
  if (op.deviceId !== deviceId || typeof op.opId !== 'string' || op.opId.length > 100 || typeof op.entityId !== 'string' || op.entityId.length > 100) return false
  if (op.entity !== 'note' && op.entity !== 'folder' && op.entity !== 'board') return false
  if (!(op.baseRevision === null || (Number.isSafeInteger(op.baseRevision) && Number(op.baseRevision) >= 1))) return false
  if (!op.data || typeof op.data !== 'object' || typeof op.updatedAt !== 'string') return false
  if (JSON.stringify(op.data).length > 1_700_000) return false
  if (op.entity === 'note') return typeof op.data.id === 'string' && op.data.id === op.entityId &&
    (op.data.folderId === null || typeof op.data.folderId === 'string') && typeof op.data.title === 'string' && op.data.title.length <= 500 &&
    typeof op.data.body === 'string' && op.data.body.length <= 850_000
  if (op.entity === 'board') return typeof op.data.id === 'string' && op.data.id === op.entityId &&
    (op.data.folderId === null || typeof op.data.folderId === 'string') && typeof op.data.title === 'string' && op.data.title.length <= 500 &&
    typeof op.data.sceneJson === 'string' && new TextEncoder().encode(op.data.sceneJson).byteLength <= 750_000 &&
    Number.isSafeInteger(op.data.revision)
  return typeof op.data.id === 'string' && op.data.id === op.entityId &&
    (op.data.parentId === null || typeof op.data.parentId === 'string') && typeof op.data.name === 'string' && op.data.name.length <= 200 &&
    Number.isSafeInteger(op.data.sortOrder)
}

async function applyOperation(db: D1Database, operation: Operation) {
  const { entity, entityId, data, baseRevision, opId, deviceId, updatedAt } = operation
  const acceptedRevision = baseRevision === null ? 1 : baseRevision + 1
  let mutation: D1PreparedStatement
  if (entity === 'note') {
    if (baseRevision === null) {
      mutation = db.prepare(`INSERT INTO notes (id, folder_id, title, body_md, revision, updated_at, deleted_at)
        SELECT ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
        .bind(entityId, data.folderId ?? null, data.title, data.body, updatedAt, data.deletedAt ?? null, entityId, opId)
    } else {
      mutation = db.prepare(`UPDATE notes SET folder_id = ?, title = ?, body_md = ?, revision = revision + 1, updated_at = ?, deleted_at = ?
        WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
        .bind(data.folderId ?? null, data.title, data.body, updatedAt, data.deletedAt ?? null, entityId, baseRevision, opId)
    }
  } else if (entity === 'board' && baseRevision === null) {
    mutation = db.prepare(`INSERT INTO boards (id, folder_id, title, scene_json, revision, updated_at, deleted_at)
      SELECT ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM boards WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
      .bind(entityId, data.folderId ?? null, data.title, data.sceneJson, updatedAt, data.deletedAt ?? null, entityId, opId)
  } else if (entity === 'board') {
    mutation = db.prepare(`UPDATE boards SET folder_id = ?, title = ?, scene_json = ?, revision = revision + 1, updated_at = ?, deleted_at = ?
      WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
      .bind(data.folderId ?? null, data.title, data.sceneJson, updatedAt, data.deletedAt ?? null, entityId, baseRevision, opId)
  } else if (baseRevision === null) {
    mutation = db.prepare(`INSERT INTO folders (id, parent_id, name, sort_order, revision, updated_at, deleted_at)
      SELECT ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
      .bind(entityId, data.parentId ?? null, data.name, data.sortOrder ?? 0, updatedAt, data.deletedAt ?? null, entityId, opId)
  } else {
    mutation = db.prepare(`UPDATE folders SET parent_id = ?, name = ?, sort_order = ?, revision = revision + 1, updated_at = ?, deleted_at = ?
      WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM sync_ops WHERE op_id = ?)`)
      .bind(data.parentId ?? null, data.name, data.sortOrder ?? 0, updatedAt, data.deletedAt ?? null, entityId, baseRevision, opId)
  }

  const entityName = entity
  const statements = [
    mutation,
    db.prepare(`INSERT INTO change_log (entity, entity_id, revision, updated_at)
      SELECT ?, ?, ?, ? WHERE changes() > 0`).bind(entityName, entityId, acceptedRevision, updatedAt),
    db.prepare(`INSERT INTO sync_ops (op_id, device_id, entity, entity_id, accepted_revision, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(opId, deviceId, entityName, entityId, acceptedRevision, new Date().toISOString()),
  ]
  await db.batch(statements)
  const ack = await db.prepare('SELECT accepted_revision FROM sync_ops WHERE op_id = ?').bind(opId).first<{ accepted_revision: number }>()
  return ack ? { applied: true, revision: ack.accepted_revision } : { applied: false, revision: 0 }
}

async function readEntity(db: D1Database, entity: Entity, id: string) {
  if (entity === 'note') {
    const row = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first<Row>()
    return row ? { id: row.id, folderId: row.folder_id, title: row.title, body: row.body_md, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at } : null
  }
  if (entity === 'board') {
    const row = await db.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first<Row>()
    return row ? { id: row.id, folderId: row.folder_id, title: row.title, sceneJson: row.scene_json, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at } : null
  }
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<Row>()
  return row ? { id: row.id, parentId: row.parent_id, name: row.name, sortOrder: row.sort_order, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at } : null
}

async function handleExport(env: Env) {
  const [folders, notes, boards] = await Promise.all([
    env.FIVE_DB.prepare('SELECT * FROM folders ORDER BY parent_id, sort_order').all(),
    env.FIVE_DB.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all(),
    env.FIVE_DB.prepare('SELECT * FROM boards ORDER BY updated_at DESC').all(),
  ])
  const folderRows = (folders.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id, parentId: row.parent_id, name: row.name, sortOrder: row.sort_order, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  }))
  const noteRows = (notes.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id, folderId: row.folder_id, title: row.title, body: row.body_md, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  }))
  const boardRows = (boards.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id, folderId: row.folder_id, title: row.title, sceneJson: row.scene_json, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  }))
  return json({ format: 'five-backup', version: 2, exportedAt: new Date().toISOString(), folders: folderRows, notes: noteRows, boards: boardRows })
}
