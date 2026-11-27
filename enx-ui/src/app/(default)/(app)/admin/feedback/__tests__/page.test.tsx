import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminFeedbackPage from '../page'
import { apiService } from '@/services/api'
import type { AdminFeedback, ArticleChoiceGroup } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListFeedback: jest.fn(),
    adminResolveFeedback: jest.fn(),
    adminListArticleChoiceGroups: jest.fn(),
    adminResolveArticleChoiceGroup: jest.fn(),
  },
}))

const mockList = apiService.adminListFeedback as jest.Mock
const mockResolve = apiService.adminResolveFeedback as jest.Mock
const mockGroups = apiService.adminListArticleChoiceGroups as jest.Mock
const mockResolveGroup = apiService.adminResolveArticleChoiceGroup as jest.Mock

function record(overrides: Partial<AdminFeedback> = {}): AdminFeedback {
  return {
    id: 'f1',
    userId: 'u1',
    kind: 'page_report',
    url: 'https://x.com/a/status/1',
    host: 'x.com',
    text: '',
    context: { adapter: 'x', extVersion: '1.2.3' },
    details: { reason: 'no-article-node' },
    status: 'new',
    createdAt: Date.UTC(2026, 10, 9, 12, 0, 0),
    ...overrides,
  }
}

function page(feedback: AdminFeedback[], nextOffset: number | null = null) {
  return { success: true, data: { success: true, feedback, nextOffset } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminFeedbackPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('lists feedback newest first from the first page, linking each user to their page', async () => {
  mockList.mockResolvedValue(
    page([
      record({ id: 'f2', userId: 'u2', url: 'https://x.com/b', host: 'x.com' }),
      record(),
    ])
  )

  renderPage()

  const rows = await screen.findAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(within(rows[1]).getByText('https://x.com/b')).toBeInTheDocument()
  expect(within(rows[1]).getByRole('link', { name: 'u2' })).toHaveAttribute(
    'href',
    '/admin/users/u2'
  )
  expect(
    within(rows[2]).getByText('https://x.com/a/status/1')
  ).toBeInTheDocument()
  expect(within(rows[2]).getByText('Page report')).toBeInTheDocument()
  expect(
    within(rows[2]).getByText('reason: no-article-node')
  ).toBeInTheDocument()
  expect(
    within(rows[2]).getByText('adapter: x · extVersion: 1.2.3')
  ).toBeInTheDocument()
  expect(mockList).toHaveBeenCalledWith({
    kind: '',
    status: '',
    limit: 100,
    offset: 0,
  })
})

it('asks the server for the chosen kind and status and shows what it returns', async () => {
  mockList.mockResolvedValue(page([record()]))
  renderPage()
  await screen.findByText('https://x.com/a/status/1')

  mockList.mockResolvedValue(
    page([
      record({
        id: 'f9',
        status: 'resolved',
        url: 'https://example.com/resolved',
        host: 'example.com',
      }),
    ])
  )
  fireEvent.change(screen.getByLabelText('Kind'), {
    target: { value: 'page_report' },
  })
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'resolved' },
  })

  expect(
    await screen.findByText('https://example.com/resolved')
  ).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith({
    kind: 'page_report',
    status: 'resolved',
    limit: 100,
    offset: 0,
  })
  expect(screen.queryByText('https://x.com/a/status/1')).toBeNull()
})

it('pages through every record with the offset the server returns', async () => {
  mockList.mockImplementation(async ({ offset }: { offset: number }) =>
    offset === 0
      ? page([record({ id: 'first', url: 'https://x.com/first' })], 100)
      : page([record({ id: 'last', url: 'https://x.com/last' })], null)
  )

  renderPage()
  await screen.findByText('https://x.com/first')
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(await screen.findByText('https://x.com/last')).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith({
    kind: '',
    status: '',
    limit: 100,
    offset: 100,
  })
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(await screen.findByText('https://x.com/first')).toBeInTheDocument()
})

it('marks a record resolved and reloads the list', async () => {
  mockList.mockResolvedValueOnce(page([record()]))
  mockList.mockResolvedValue(page([record({ status: 'resolved' })]))
  mockResolve.mockResolvedValue({ success: true, data: { success: true } })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  )
  expect(mockResolve).toHaveBeenCalledWith('f1')
  expect(
    within(screen.getAllByRole('row')[1]).getByText('Resolved')
  ).toBeInTheDocument()
})

it('shows the error when resolving fails', async () => {
  mockList.mockResolvedValue(page([record()]))
  mockResolve.mockResolvedValue({ success: false, error: 'no such feedback' })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('no such feedback')
})

it('shows an empty state when nothing matches', async () => {
  mockList.mockResolvedValue(page([]))

  renderPage()

  expect(await screen.findByText('No feedback matches.')).toBeInTheDocument()
})

describe('article choice groups (ADR-073)', () => {
  function group(overrides: Partial<ArticleChoiceGroup> = {}) {
    return {
      host: 'x.com',
      selector: 'main > article',
      count: 3,
      total: 4,
      sampleUrl: 'https://x.com/a/status/1',
      ...overrides,
    }
  }

  function groupPage(
    groups: ArticleChoiceGroup[],
    nextOffset: number | null = null
  ) {
    return { success: true, data: { success: true, groups, nextOffset } }
  }

  async function showGroups() {
    renderPage()
    await screen.findByText('https://x.com/a/status/1')
    fireEvent.change(screen.getByLabelText('View'), {
      target: { value: 'article-choice-groups' },
    })
  }

  beforeEach(() => {
    mockList.mockResolvedValue(page([record()]))
  })

  it('shows one row per host and selector with the server-side count and a sample page', async () => {
    mockGroups.mockResolvedValue(
      groupPage([
        group(),
        group({
          host: 'example.com',
          selector: '#story',
          count: 1,
          total: 1,
          sampleUrl: 'https://example.com/news/2',
        }),
      ])
    )

    await showGroups()

    expect(await screen.findByText('#story')).toBeInTheDocument()
    expect(mockGroups).toHaveBeenCalledWith({
      status: '',
      limit: 100,
      offset: 0,
    })
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('x.com')).toBeInTheDocument()
    expect(within(rows[1]).getByText('main > article')).toBeInTheDocument()
    expect(within(rows[1]).getByText('3')).toBeInTheDocument()
    expect(
      within(rows[1]).getByText('https://x.com/a/status/1')
    ).toBeInTheDocument()
    expect(within(rows[2]).getByText('example.com')).toBeInTheDocument()
    expect(
      within(rows[2]).getByText('https://example.com/news/2')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Kind')).toBeNull()
  })

  it('asks the server for groups of the chosen status', async () => {
    mockGroups.mockResolvedValue(groupPage([group()]))
    await showGroups()
    await screen.findByText('main > article')

    mockGroups.mockResolvedValue(
      groupPage([group({ selector: '.resolved-only', count: 2 })])
    )
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'resolved' },
    })

    expect(await screen.findByText('.resolved-only')).toBeInTheDocument()
    expect(mockGroups).toHaveBeenLastCalledWith({
      status: 'resolved',
      limit: 100,
      offset: 0,
    })
    expect(screen.queryByText('main > article')).toBeNull()
  })

  it('pages through groups with the offset the server returns', async () => {
    mockGroups.mockImplementation(async ({ offset }: { offset: number }) =>
      offset === 0
        ? groupPage([group({ selector: '.first' })], 100)
        : groupPage([group({ selector: '.last' })], null)
    )

    await showGroups()
    await screen.findByText('.first')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('.last')).toBeInTheDocument()
    expect(mockGroups).toHaveBeenLastCalledWith({
      status: '',
      limit: 100,
      offset: 100,
    })
  })

  it('resolves every record in a group, whatever its status, and reloads', async () => {
    mockGroups.mockResolvedValueOnce(groupPage([group()]))
    mockGroups.mockResolvedValue(groupPage([]))
    mockResolveGroup.mockResolvedValue({
      success: true,
      data: { success: true, resolved: 4 },
    })

    await showGroups()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Resolve all 4' })
    )

    expect(
      await screen.findByText('No article choices match.')
    ).toBeInTheDocument()
    expect(mockResolveGroup).toHaveBeenCalledWith('x.com', 'main > article')
  })

  it('shows the error when resolving a group fails', async () => {
    mockGroups.mockResolvedValue(groupPage([group()]))
    mockResolveGroup.mockResolvedValue({
      success: false,
      error: 'no such article choice group',
    })

    await showGroups()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Resolve all 4' })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no such article choice group'
    )
  })

  it('goes back to the individual records, article choices included', async () => {
    mockGroups.mockResolvedValue(groupPage([group()]))
    await showGroups()
    await screen.findByText('main > article')

    mockList.mockResolvedValue(
      page([
        record({
          id: 'c1',
          kind: 'article_choice',
          url: 'https://x.com/c',
          details: { selector: 'main > article', autoSource: 'none' },
        }),
      ])
    )
    fireEvent.change(screen.getByLabelText('View'), {
      target: { value: 'records' },
    })
    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'article_choice' },
    })

    expect(await screen.findByText('https://x.com/c')).toBeInTheDocument()
    expect(mockList).toHaveBeenLastCalledWith({
      kind: 'article_choice',
      status: '',
      limit: 100,
      offset: 0,
    })
  })
})
