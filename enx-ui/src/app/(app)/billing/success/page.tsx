import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Stripe redirects here after a successful Checkout (see
// billing/handler.go's SuccessURL). This page does NOT itself confirm the
// payment -- that's the webhook's job (checkout.session.completed /
// invoice.paid), which can take a few seconds to land. Showing a
// provisional "we're processing this" message and sending the user back to
// /billing (where the real balance is fetched fresh) avoids claiming
// success before the ledger has actually been updated.
export default function BillingSuccessPage() {
  return (
    <div className="container mx-auto p-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Payment submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            We&apos;re processing your payment. Your account status and credit
            balance usually update within a few seconds.
          </p>
          <Link href="/billing">
            <Button className="w-full">Back to Subscription &amp; Credits</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
