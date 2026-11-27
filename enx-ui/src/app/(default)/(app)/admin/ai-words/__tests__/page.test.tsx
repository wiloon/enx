import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminAiWordsPage from '../page'
import { apiService } from '@/services/api'
import type { AdminWordRow } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListAiWords: jest.fn(),
    adminEditWord: jest.fn(),
    deleteWord: jest.fn(),
  },
}))

const list = apiService.adminListAiWords as jest.Mock
const edit = apiService.adminEditWord as jest.Mock
const remove = apiService.deleteWord as jest.Mock

const row = (over: Partial<AdminWordRow> = {}): AdminWordRow => ({
  found: true,
  id: 'w-rizzler',
  english: 'rizzler',
  chinese: 'n. 很有魅力的人',
  pronunciation: '',
  source: 'ai',
  aiQuality: 9,
  aiPromptVersion: 'v1',
  users: 3,
  lookups: 12,
  ...over,
})

const queue = (words: AdminWordRow[], total = words.length) => ({
  success: true,
  data: { words, total },
})

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminAiWordsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.resetAllMocks()
})

it('lists the unreviewed definitions with their usage and the model confidence', async () => {
  list.mockResolvedValue(queue([row()]))
  renderPage()

  expect(await screen.findByText('rizzler')).toBeInTheDocument()
  expect(screen.getByText('n. 很有魅力的人')).toBeInTheDocument()
  expect(
    screen.getByText(/3 users · 12 lookups · AI confidence 9\/10/)
  ).toBeInTheDocument()
  expect(list).toHaveBeenCalledWith(false, 25, 0)
})

it('says so when there is nothing to review', async () => {
  list.mockResolvedValue(queue([]))
  renderPage()

  expect(await screen.findByText('Nothing to review.')).toBeInTheDocument()
})

it('reports a failure to load', async () => {
  list.mockResolvedValue({ success: false, error: 'Forbidden' })
  renderPage()

  expect(await screen.findByText('Forbidden')).toBeInTheDocument()
})

it('switches to the reviewed definitions, which are already approved', async () => {
  list
    .mockResolvedValueOnce(queue([row()]))
    .mockResolvedValue(
      queue([
        row({ english: 'doomscroll', id: 'w2', adminEditedAt: 1700000000000 }),
      ])
    )
  renderPage()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('tab', { name: 'Reviewed' }))

  expect(await screen.findByText('doomscroll')).toBeInTheDocument()
  expect(list).toHaveBeenLastCalledWith(true, 25, 0)
  expect(screen.getByRole('tab', { name: 'Reviewed' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  // Nothing to approve on a definition that was already reviewed.
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
})

it('approves by saving the definition unchanged', async () => {
  list.mockResolvedValue(queue([row({ pronunciation: '/ˈrɪzlər/' })]))
  edit.mockResolvedValue({
    success: true,
    data: { success: true, word: row() },
  })
  renderPage()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith('rizzler', 'n. 很有魅力的人', '/ˈrɪzlər/')
  )
  // The queue is read again, so the approved word leaves it.
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1))
})

it('edits the definition and saves the new text', async () => {
  list.mockResolvedValue(queue([row()]))
  edit.mockResolvedValue({
    success: true,
    data: { success: true, word: row() },
  })
  renderPage()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Chinese definition'), {
    target: { value: 'n. 魅力十足的人' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith('rizzler', 'n. 魅力十足的人', '')
  )
})

it('keeps the editor open and shows the server message when a save is refused', async () => {
  list.mockResolvedValue(queue([row()]))
  edit.mockResolvedValue({ success: false, error: 'chinese must not be empty' })
  renderPage()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'chinese must not be empty'
  )
  expect(screen.getByLabelText('Chinese definition')).toBeInTheDocument()
})

it('cancels an edit without saving', async () => {
  list.mockResolvedValue(queue([row()]))
  renderPage()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.queryByLabelText('Chinese definition')).toBeNull()
  expect(edit).not.toHaveBeenCalled()
})

describe('rejecting', () => {
  it('asks for confirmation first, and deletes only after it', async () => {
    list.mockResolvedValue(queue([row()]))
    remove.mockResolvedValue({
      success: true,
      data: { success: true, deleted: true },
    })
    renderPage()
    await screen.findByText('rizzler')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Reject rizzler' })
    expect(dialog).toHaveTextContent('every user')
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm reject' })
    )

    await waitFor(() => expect(remove).toHaveBeenCalledWith('rizzler'))
  })

  it('does nothing when the confirmation is cancelled', async () => {
    list.mockResolvedValue(queue([row()]))
    renderPage()
    await screen.findByText('rizzler')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })

  it('shows the server message when the delete fails', async () => {
    list.mockResolvedValue(queue([row()]))
    remove.mockResolvedValue({ success: false, error: 'failed to delete word' })
    renderPage()
    await screen.findByText('rizzler')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'failed to delete word'
    )
  })
})

describe('paging', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      row({ id: `w${i}`, english: `word${i}` })
    )

  it('pages through a long queue', async () => {
    list.mockImplementation(async (_reviewed, _limit, offset) =>
      offset === 0 ? queue(many(25), 30) : queue(many(5), 30)
    )
    renderPage()
    await screen.findByText('word0')

    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Showing 26–30 of 30')).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith(false, 25, 25)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('steps back when the last row of a later page is gone', async () => {
    list.mockImplementation(async (_reviewed, _limit, offset) =>
      offset === 0 ? queue(many(25), 26) : queue([], 25)
    )
    renderPage()
    await screen.findByText('word0')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(false, 25, 0))
    expect(await screen.findByText('word0')).toBeInTheDocument()
  })
})
