import { fireEvent, render, screen } from '@testing-library/react'
import WordEditor, { CHINESE_MAX, PRONUNCIATION_MAX } from '../WordEditor'

function renderEditor(
  over: Partial<React.ComponentProps<typeof WordEditor>> = {}
) {
  const props = {
    idPrefix: 't',
    initialChinese: 'n. 很有魅力的人',
    initialPronunciation: '/a/',
    saving: false,
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...over,
  }
  render(<WordEditor {...props} />)
  return props
}

it('starts from the current definition and pronunciation', () => {
  renderEditor()

  expect(screen.getByLabelText('Chinese definition')).toHaveValue(
    'n. 很有魅力的人'
  )
  expect(screen.getByLabelText('Pronunciation')).toHaveValue('/a/')
})

it('saves what was typed, and lets unchanged text be saved (that is an approval)', () => {
  const { onSave } = renderEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenLastCalledWith('n. 很有魅力的人', '/a/')

  fireEvent.change(screen.getByLabelText('Chinese definition'), {
    target: { value: 'v. 新' },
  })
  fireEvent.change(screen.getByLabelText('Pronunciation'), {
    target: { value: '' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenLastCalledWith('v. 新', '')
})

it('does not offer to save an empty definition', () => {
  const { onSave } = renderEditor()

  fireEvent.change(screen.getByLabelText('Chinese definition'), {
    target: { value: '   ' },
  })

  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.submit(screen.getByLabelText('Chinese definition').closest('form')!)
  expect(onSave).not.toHaveBeenCalled()
})

it('is busy while saving, and shows an error', () => {
  const { onSave } = renderEditor({
    saving: true,
    error: 'failed to update word',
  })

  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('failed to update word')
  fireEvent.submit(screen.getByLabelText('Chinese definition').closest('form')!)
  expect(onSave).not.toHaveBeenCalled()
})

it('cancels', () => {
  const { onCancel } = renderEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(onCancel).toHaveBeenCalled()
})

it('limits the text to what the server accepts', () => {
  renderEditor()

  expect(screen.getByLabelText('Chinese definition')).toHaveAttribute(
    'maxlength',
    String(CHINESE_MAX)
  )
  expect(screen.getByLabelText('Pronunciation')).toHaveAttribute(
    'maxlength',
    String(PRONUNCIATION_MAX)
  )
})
