import { saveOutcome } from '@/lib/pageSave'

describe('saveOutcome', () => {
  it('reports a newly saved page with the address the server actually stored', () => {
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
      status: 'saved',
      savedUrl: 'https://www.infoq.com/articles/kube',
    })
  })

  it('reports a page that was already saved as already-saved, not as newly saved', () => {
    expect(
      saveOutcome({
        success: true,
        data: {
          success: true,
          created: false,
          page: {
            id: 'p1',
            url: 'https://www.infoq.com/articles/kube',
            title: 'Kube',
          },
        },
      })
    ).toEqual({
      status: 'already-saved',
      savedUrl: 'https://www.infoq.com/articles/kube',
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
      status: 'failed',
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
      status: 'failed',
      errorMessage: 'Your session has expired. Please login again.',
    })
  })
})
