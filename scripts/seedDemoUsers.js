import { prisma } from '../src/config/database.js'
import { hashPassword, normalizeEmail, sanitizeUser } from '../src/modules/auth/auth.utils.js'

async function seedDemoUsers() {
  try {
    console.log('[Demo Seed] Starting demo users provisioning...')

    const demoUsers = [
      {
        email: 'user@gmail.com',
        password: 'password = 12345678'.includes('12345678') ? '12345678' : '12345678',
        fullName: 'Demo Creator',
        role: 'CREATOR',
        balance: 250
      },
      {
        email: 'admin@gmail.com',
        password: 'password = 12345678'.includes('12345678') ? '12345678' : '12345678',
        fullName: 'System Administrator',
        role: 'SUPER_ADMIN',
        balance: 99999
      }
    ]

    for (const target of demoUsers) {
      const email = normalizeEmail(target.email)
      const passwordHash = await hashPassword(target.password)

      const existing = await prisma.user.findUnique({
        where: { email },
        include: { wallet: true }
      })

      if (existing) {
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: {
            role: target.role,
            status: 'ACTIVE',
            passwordHash,
            fullName: target.fullName
          }
        })
        console.log(`[Demo Seed] Updated existing account (${target.role}): ${email}`)
      } else {
        await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email,
              passwordHash,
              fullName: target.fullName,
              role: target.role,
              status: 'ACTIVE'
            }
          })

          await tx.creditWallet.create({
            data: {
              userId: newUser.id,
              balance: target.balance,
              reservedBalance: 0
            }
          })
        })
        console.log(`[Demo Seed] Created new account (${target.role}): ${email}`)
      }
    }

    console.log('[Demo Seed] Success! Both demo accounts are ready in MySQL:')
    console.log('  1. User  : user@gmail.com  | Password: 12345678')
    console.log('  2. Admin : admin@gmail.com | Password: 12345678')
  } catch (err) {
    console.error('[Demo Seed Error]:', err.message)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

seedDemoUsers()
