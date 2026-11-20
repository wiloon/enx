import { getAuthAdapter } from '@/auth'

export default function SignUpPage() {
  const { SignUpBody } = getAuthAdapter()

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignUpBody />
    </div>
  )
}
