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
          <CardTitle>支付已提交</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            我们正在处理你的付款，账户状态和积分余额通常会在几秒内更新。
          </p>
          <Link href="/billing">
            <Button className="w-full">返回订阅与积分</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
