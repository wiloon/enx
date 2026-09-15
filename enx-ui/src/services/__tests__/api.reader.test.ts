import { ApiService } from '../api'

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  }
}

describe('ApiService reader documents', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('POSTs content to /api/reader/documents and returns the new id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(201, { success: true, id: 'doc-1' })
    )

    const result = await service.createReaderDocument('hello world')

    expect(result.success).toBe(true)
    expect(result.data?.id).toBe('doc-1')
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/reader/documents')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ content: 'hello world' })
  })

  it('surfaces the backend message when content is too long', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(400, {
        success: false,
        message: 'reader: content exceeds maximum length',
      })
    )

    const result = await service.createReaderDocument('x'.repeat(20001))

    expect(result.success).toBe(false)
    expect(result.error).toBe('reader: content exceeds maximum length')
  })

  it('GETs the document list from /api/reader/documents', async () => {
    const documents = [
      { id: 'doc-2', createdAt: '2026-09-15T00:00:00Z' },
      { id: 'doc-1', createdAt: '2026-09-14T00:00:00Z' },
    ]
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true, documents })
    )

    const result = await service.listReaderDocuments()

    expect(result.success).toBe(true)
    expect(result.data?.documents).toEqual(documents)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/reader/documents')
    expect(init.method).toBeUndefined()
  })

  it('GETs a single document by id', async () => {
    const doc = {
      id: 'doc-1',
      content: 'full text',
      createdAt: '2026-09-14T00:00:00Z',
      expiresAt: '2026-09-21T00:00:00Z',
    }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true, ...doc })
    )

    const result = await service.getReaderDocument('doc-1')

    expect(result.success).toBe(true)
    expect(result.data?.content).toBe('full text')
    const [url] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/reader/documents/doc-1')
  })

  it('returns a failure when a document is not found', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(404, { success: false, message: 'document not found' })
    )

    const result = await service.getReaderDocument('missing')

    expect(result.success).toBe(false)
    expect(result.error).toBe('document not found')
  })

  it('DELETEs a document by id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true })
    )

    const result = await service.deleteReaderDocument('doc-1')

    expect(result.success).toBe(true)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/reader/documents/doc-1')
    expect(init.method).toBe('DELETE')
  })
})
