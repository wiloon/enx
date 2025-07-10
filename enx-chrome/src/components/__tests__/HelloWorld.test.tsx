import { render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'jotai'
import HelloWorld from '../HelloWorld'

describe('HelloWorld', () => {
  const renderWithProvider = (component: React.ReactElement) => {
    return render(<Provider>{component}</Provider>)
  }

  it('renders hello world message', () => {
    renderWithProvider(<HelloWorld />)
    expect(screen.getByText('Enx Chrome Extension')).toBeInTheDocument()
  })

  it('increments count when button is clicked', () => {
    renderWithProvider(<HelloWorld />)
    
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Click me! (0)')
    
    fireEvent.click(button)
    expect(button).toHaveTextContent('Click me! (1)')
    
    fireEvent.click(button)
    expect(button).toHaveTextContent('Click me! (2)')
  })

  it('updates message when button is clicked', () => {
    renderWithProvider(<HelloWorld />)
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    expect(screen.getByText('Clicked 1 times!')).toBeInTheDocument()
  })
})