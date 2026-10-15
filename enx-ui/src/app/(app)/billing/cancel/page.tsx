import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Stripe redirects here when the user backs out of Checkout (see
// billing/handler.go's CancelURL). Nothing changed on the backend -- this
// is just a way back.
export default function BillingCancelPage() {
  return (
    <div className="container mx-auto max-w-md p-6 md:p-8">
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">Canceled</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Checkout was canceled and you were not charged.
          </p>
          <Link href="/billing">
            <Button className="w-full">Back to Billing</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
