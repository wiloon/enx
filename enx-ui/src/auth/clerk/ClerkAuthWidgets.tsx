import { SignIn, SignUp } from '@clerk/nextjs'

export function SignInBody({
  forceRedirectUrl,
}: {
  forceRedirectUrl?: string
}) {
  return <SignIn forceRedirectUrl={forceRedirectUrl} />
}

export function SignUpBody() {
  return <SignUp />
}
