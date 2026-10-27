import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBoard } from '../src/lib/boardFiles'
import type { Board } from '../src/lib/types'

const board: Board = {
  id: 'board-export', folderId: null, title: 'Arquitetura / API',
  sceneJson: '{"type":"excalidraw","elements":[]}', revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

afterEach(() => {
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreate })
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevoke })
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.useRealTimers()
})

describe('exportação de quadro', () => {
  it('baixa a cena Excalidraw com nome seguro e revoga a URL temporária', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:five-board')
    const revoke = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true)
      expect(this.download).toBe('Arquitetura-API.excalidraw')
      expect(this.href).toBe('blob:five-board')
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke })

    downloadBoard(board)

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[0]).toMatchObject({ type: 'application/json' })
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download="Arquitetura-API.excalidraw"]')).toBeNull()
    vi.advanceTimersByTime(1_000)
    expect(revoke).toHaveBeenCalledWith('blob:five-board')
  })
})
