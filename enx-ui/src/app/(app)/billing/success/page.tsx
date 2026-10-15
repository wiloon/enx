import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Stripe redirects here after a successful Checkout (see
// billing/handler.go's SuccessURL). This page does NOT itself confirm the
// payment -- that's the webhook's job (checkout.session.completed /
// invoice.paid), which can take a few seconds to land. Showing a
// provisional "we're processing this" message and sending the user back to
// /billing (where the real balance is fetched fresh) avoids claiming
// success before the ledger has actually been updated.
export default function BillingSuccessPage() {
  return (
    <div className="container mx-auto max-w-md p-6 md:p-8">
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">Payment submitted</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            We&apos;re processing your payment. Your account status and credit
            balance usually update within a few seconds.
          </p>
          <Link href="/billing">
            <Button className="w-full">Back to Billing</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
