'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { apiService, SubscriptionPlan, TopupTier } from '@/services/api'
import { SUBSCRIPTION_PLANS, TOPUP_TIERS, subscriptionStatusLabel } from './plans'

export default function BillingPage() {
  // Tracks which button (if any) triggered a checkout/portal redirect, so
  // only that button shows "跳转中..." and every button disables while a
  // redirect is in flight (avoids a second click firing a second Checkout
  // Session before the page navigates away).
  const [redirecting, setRedirecting] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['billing-me'],
    queryFn: async () => {
      const resp = await apiService.getBillingMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load billing status')
    },
  })

  const goToCheckout = async (
    key: string,
    request: () => ReturnType<typeof apiService.createSubscriptionCheckout>
  ) => {
    setCheckoutError(null)
    setRedirecting(key)
    const resp = await request()
    if (resp.success && resp.data?.url) {
      window.location.href = resp.data.url
      return
    }
    setCheckoutError(resp.error || '未能创建结账会话，请稍后重试')
    setRedirecting(null)
  }

  const handleSubscribe = (plan: SubscriptionPlan) =>
    goToCheckout(`subscription-${plan}`, () =>
      apiService.createSubscriptionCheckout(plan)
    )

  const handleTopup = (tier: TopupTier) =>
    goToCheckout(`topup-${tier}`, () => apiService.createTopupCheckout(tier))

  const handleManageBilling = () =>
    goToCheckout('portal', () => apiService.createPortalSession())

  const status = data?.subscription.status ?? 'none'
  const isActive = status === 'active'
  const badgeVariant =
    status === 'active'
      ? 'default'
      : status === 'past_due'
        ? 'destructive'
        : 'secondary'

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">订阅与积分</h1>
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:underline"
        >
          返回首页
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            当前状态
            {!isLoading && !error && (
              <Badge variant={badgeVariant}>
                {subscriptionStatusLabel(status, data?.subscription.plan)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-muted-foreground">加载中...</p>}
          {error && (
            <p className="text-destructive">
              {error instanceof Error ? error.message : '加载账单状态失败'}
            </p>
          )}
          {data && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">订阅积分余额</div>
                <div className="text-lg font-medium">
                  {data.credits.subscriptionBalance}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">充值积分余额</div>
                <div className="text-lg font-medium">
                  {data.credits.topupBalance}
                </div>
              </div>
            </div>
          )}
        </CardContent>
        {(status === 'active' || status === 'past_due') && (
          <CardFooter>
            <Button
              variant="outline"
              onClick={handleManageBilling}
              disabled={redirecting !== null}
            >
              {redirecting === 'portal' ? '跳转中...' : '管理订阅 / 账单'}
            </Button>
          </CardFooter>
        )}
      </Card>

      {checkoutError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {checkoutError}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">升级订阅</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SUBSCRIPTION_PLANS.map((option) => (
            <Card key={option.plan}>
              <CardHeader>
                <CardTitle>{option.name}</CardTitle>
                <CardDescription>{option.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{option.priceLabel}</div>
                <div className="text-sm text-muted-foreground">
                  每期 {option.creditsLabel} 积分
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={() => handleSubscribe(option.plan)}
                  disabled={isActive || redirecting !== null}
                >
                  {redirecting === `subscription-${option.plan}`
                    ? '跳转中...'
                    : isActive
                      ? '已订阅'
                      : '订阅'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">购买 AI 翻译积分</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TOPUP_TIERS.map((option) => (
            <Card key={option.tier}>
              <CardHeader>
                <CardTitle>{option.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{option.priceLabel}</div>
                <div className="text-sm text-muted-foreground">
                  {option.creditsLabel} 积分
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleTopup(option.tier)}
                  disabled={redirecting !== null}
                >
                  {redirecting === `topup-${option.tier}` ? '跳转中...' : '购买'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
