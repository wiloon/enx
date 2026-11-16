import { watchTomeshelfRecognition } from '@/content/tomeshelfWatch'

describe('watchTomeshelfRecognition (ADR-088)', () => {
  it('does nothing when tomeshelf is already present at startup', () => {
    const onRecognised = jest.fn()
    const watch = watchTomeshelfRecognition({
      isTomeshelf: () => true,
      onRecognised,
      root: document.head,
    })
    expect(onRecognised).not.toHaveBeenCalled()
    watch.disconnect()
  })

  it('fires once when the generator meta appears later', async () => {
    const onRecognised = jest.fn()
    let seen = false
    const watch = watchTomeshelfRecognition({
      isTomeshelf: () => seen,
      onRecognised,
      root: document.head,
    })
    expect(onRecognised).not.toHaveBeenCalled()
    seen = true
    document.head.appendChild(document.createElement('meta'))
    await Promise.resolve()
    expect(onRecognised).toHaveBeenCalledTimes(1)
    document.head.appendChild(document.createElement('meta'))
    await Promise.resolve()
    expect(onRecognised).toHaveBeenCalledTimes(1)
    watch.disconnect()
  })

  it('stops observing after disconnect', async () => {
    const onRecognised = jest.fn()
    let seen = false
    const watch = watchTomeshelfRecognition({
      isTomeshelf: () => seen,
      onRecognised,
      root: document.head,
    })
    watch.disconnect()
    seen = true
    document.head.appendChild(document.createElement('meta'))
    await Promise.resolve()
    expect(onRecognised).not.toHaveBeenCalled()
  })
})
