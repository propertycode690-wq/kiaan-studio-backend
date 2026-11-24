import { prisma } from '../../config/database.js'

export class SubscriptionsService {
  static async seedDefaultPlans() {
    const plans = [
      {
        slug: 'free',
        name: 'Free Creator',
        priceMonthly: 0,
        priceAnnual: 0,
        monthlyCredits: 25,
        maxConcurrentJobs: 1,
        featuresJson: ['25 welcome credits', 'Standard queue', 'Community support'],
        isActive: true
      },
      {
        slug: 'creator-pro',
        name: 'Creator Pro',
        priceMonthly: 29,
        priceAnnual: 290,
        monthlyCredits: 500,
        maxConcurrentJobs: 2,
        featuresJson: ['500 monthly credits', 'Priority GPU queue', 'Commercial license'],
        isActive: true
      },
      {
        slug: 'studio-ultimate',
        name: 'Studio Ultimate',
        priceMonthly: 99,
        priceAnnual: 990,
        monthlyCredits: 2500,
        maxConcurrentJobs: 5,
        featuresJson: ['2,500 monthly credits', 'Dedicated GPU queue', 'Full API access'],
        isActive: true
      }
    ]

    for (const plan of plans) {
      await prisma.subscriptionPlan.upsert({
        where: { slug: plan.slug },
        update: plan,
        create: plan
      })
    }
  }

  static async listPlans() {
    let plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' }
    })

    if (plans.length === 0) {
      await this.seedDefaultPlans()
      plans = await prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { priceMonthly: 'asc' }
      })
    }

    return plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      priceAnnual: Number(p.priceAnnual),
      monthlyCredits: p.monthlyCredits,
      maxConcurrentJobs: p.maxConcurrentJobs,
      features: Array.isArray(p.featuresJson) ? p.featuresJson : JSON.parse(p.featuresJson || '[]'),
      isActive: p.isActive
    }))
  }

  static async getCurrentSubscription(userId) {
    const sub = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' }
    })

    if (!sub) {
      return {
        hasActiveSubscription: false,
        status: 'FREE_TIER',
        plan: {
          slug: 'free',
          name: 'Free Creator',
          monthlyCredits: 25,
          maxConcurrentJobs: 1,
          priceMonthly: 0
        },
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false
      }
    }

    return {
      hasActiveSubscription: true,
      subscriptionId: sub.id,
      status: sub.status,
      plan: {
        id: sub.plan.id,
        slug: sub.plan.slug,
        name: sub.plan.name,
        monthlyCredits: sub.plan.monthlyCredits,
        maxConcurrentJobs: sub.plan.maxConcurrentJobs,
        priceMonthly: Number(sub.plan.priceMonthly),
        priceAnnual: Number(sub.plan.priceAnnual)
      },
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd
    }
  }

  static async createSubscriptionOrder(userId, { planSlug, billingCycle = 'monthly' }) {
    if (!planSlug) {
      const error = new Error('Plan slug is required')
      error.statusCode = 400
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { slug: planSlug }
    })

    if (!plan) {
      const error = new Error('Subscription plan not found')
      error.statusCode = 404
      error.code = 'PLAN_NOT_FOUND'
      throw error
    }

    const isAnnual = billingCycle === 'yearly' || billingCycle === 'annual'
    const price = isAnnual ? Number(plan.priceAnnual) : Number(plan.priceMonthly)
    const invoiceNumber = 'INV-SUB-' + Date.now() + '-' + Math.floor(Math.random() * 1000)

    const invoice = await prisma.invoice.create({
      data: {
        userId,
        invoiceNumber,
        amount: price,
        status: 'PENDING',
        description: 'Subscription: ' + plan.name + (isAnnual ? ' (Annual)' : ' (Monthly)')
      }
    })

    return {
      orderId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      plan: {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        monthlyCredits: plan.monthlyCredits
      },
      billingCycle: isAnnual ? 'annual' : 'monthly',
      amount: price,
      currency: 'USD',
      status: 'PENDING',
      message: 'Subscription order created. Payment gateways are pending integration in Phase 6.'
    }
  }

  static async listInvoices(userId) {
    const invoices = await prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })

    return invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      status: inv.status,
      description: inv.description,
      receiptUrl: inv.receiptUrl,
      date: inv.createdAt.toISOString(),
      createdAt: inv.createdAt.toISOString()
    }))
  }

  static async handleWebhook(payload, signature) {
    if (!signature) {
      const error = new Error('Missing webhook signature header')
      error.statusCode = 400
      error.code = 'INVALID_SIGNATURE'
      throw error
    }

    return {
      received: true,
      timestamp: new Date().toISOString()
    }
  }
}

export default SubscriptionsService
