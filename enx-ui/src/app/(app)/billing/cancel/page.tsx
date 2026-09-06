import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Stripe redirects here when the user backs out of Checkout (see
// billing/handler.go's CancelURL). Nothing changed on the backend -- this
// is just a way back.
export default function BillingCancelPage() {
  return (
    <div className="container mx-auto p-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>已取消</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            结账已取消，没有产生任何费用。
          </p>
          <Link href="/billing">
            <Button className="w-full">返回订阅与积分</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
