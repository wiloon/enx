import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface PriceCardProps {
  name: string
  priceLabel: string
  creditsLabel?: string
  description?: string
  children?: ReactNode
  // The button slot. /pricing passes a link and /billing a checkout button,
  // so the card itself never knows about payment.
  action?: ReactNode
}

// One price tier, shared by the public /pricing page and the signed-in
// /billing page so the two cannot drift apart visually.
export default function PriceCard({
  name,
  priceLabel,
  creditsLabel,
  description,
  children,
  action,
}: PriceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div>
          <div className="text-2xl font-bold">{priceLabel}</div>
          {creditsLabel && (
            <div className="text-sm text-muted-foreground">{creditsLabel}</div>
          )}
        </div>
        {children}
      </CardContent>
      {action && <CardFooter>{action}</CardFooter>}
    </Card>
  )
}
