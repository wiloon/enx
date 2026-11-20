import { selectWorkerAuth } from '@/lib/auth/selectWorkerAuth'

describe('selectWorkerAuth', () => {
  it('selects the Clerk worker adapter for the clerk provider', () => {
    const worker = selectWorkerAuth({
      provider: 'clerk',
      publishableKey: 'pk_test_x',
      syncHost: 'https://clerk.example',
    })
    expect(typeof worker.createClient).toBe('function')
    expect(typeof worker.classifyLoaded).toBe('function')
    expect(typeof worker.subject).toBe('function')
    expect(typeof worker.registerSessionChangeListener).toBe('function')
  })
})
