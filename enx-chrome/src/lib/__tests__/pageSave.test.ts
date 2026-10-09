import { saveOutcome } from '@/lib/pageSave'

describe('saveOutcome', () => {
  it('keeps the id and the address the server actually stored', () => {
    expect(
      saveOutcome({
        success: true,
        data: {
          success: true,
          created: true,
          page: {
            id: 'p1',
            url: 'https://www.infoq.com/articles/kube',
            title: 'Kube',
          },
        },
      })
    ).toEqual({
      ok: true,
      page: { id: 'p1', url: 'https://www.infoq.com/articles/kube' },
    })
  })

  it('treats a page that was already saved as saved', () => {
    expect(
      saveOutcome({
        success: true,
        data: {
          success: true,
          created: false,
          page: { id: 'p1', url: 'https://www.infoq.com/articles/kube' },
        },
      })
    ).toEqual({
      ok: true,
      page: { id: 'p1', url: 'https://www.infoq.com/articles/kube' },
    })
  })

  it("reports a refusal as failed and carries the server's own message", () => {
    expect(
      saveOutcome({
        success: false,
        status: 422,
        error: 'You can save up to 1000 pages. Delete some to save more.',
      })
    ).toEqual({
      ok: false,
      errorMessage: 'You can save up to 1000 pages. Delete some to save more.',
    })
  })

  it('reports an expired session as failed with the message the background gave', () => {
    expect(
      saveOutcome({
        success: false,
        sessionExpired: true,
        error: 'Your session has expired. Please login again.',
      })
    ).toEqual({
      ok: false,
      errorMessage: 'Your session has expired. Please login again.',
    })
  })

  it('reports a success reply with no page as failed rather than saved', () => {
    expect(saveOutcome({ success: true, data: { success: true } })).toEqual({
      ok: false,
      errorMessage: undefined,
    })
  })
})
