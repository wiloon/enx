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
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        Enx Chrome Extension
      </h1>
      <p className="text-gray-600 mb-4">{message}</p>
      <button
        onClick={handleClick}
        className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors"
      >
        Click me! ({count})
      </button>
    </div>
  )
}
