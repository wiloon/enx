import { SignIn } from '@clerk/nextjs'

// ADR-020: when the sign-in is started from the ENX extension
// (`/sign-in?src=extension`), send the user to /extension/connected
// afterwards so the extension can close this tab and switch them back to the
// tab they came from. Otherwise Clerk's default post-sign-in redirect applies.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const { src } = await searchParams
  const forceRedirectUrl =
    src === 'extension' ? '/extension/connected' : undefined

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignIn forceRedirectUrl={forceRedirectUrl} />
    </div>
  )
}
