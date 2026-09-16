import { useState } from 'react'
import { useAtom } from 'jotai'
import { countAtom } from '@/store/atoms'

export default function HelloWorld() {
  const [count, setCount] = useAtom(countAtom)
  const [message, setMessage] = useState('Hello World!')

  const handleClick = () => {
    setCount(count + 1)
    setMessage(`Clicked ${count + 1} times!`)
  }

  return (
    <div className="p-6 max-w-md mx-auto bg-background rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        Enx Chrome Extension
      </h1>
      <p className="text-muted-foreground mb-4">{message}</p>
      <button
        onClick={handleClick}
        className="bg-brand hover:bg-brand/90 text-brand-foreground font-medium py-2 px-4 rounded-sm transition-colors"
      >
        Click me! ({count})
      </button>
    </div>
  )
}
