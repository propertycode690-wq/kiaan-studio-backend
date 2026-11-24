import { prisma } from '../src/config/database.js'
import { hashPassword, normalizeEmail, sanitizeUser } from '../src/modules/auth/auth.utils.js'

async function provisionAdmin() {
  try {
    const args = process.argv.slice(2)
    const argMap = {}
    args.forEach(arg => {
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=')
        argMap[key] = val
      }
    })

    const email = normalizeEmail(process.env.ADMIN_EMAIL || argMap.email)
    const password = process.env.ADMIN_PASSWORD || argMap.password
    const fullName = (process.env.ADMIN_NAME || argMap.name || 'System Administrator').trim()

    if (!email || !email.includes('@')) {
      console.error('[Error] Valid admin email is required via ADMIN_EMAIL env or --email=... arg')
      process.exit(1)
    }

    if (!password || password.length < 8) {
      console.error('[Error] Admin password must be at least 8 characters long via ADMIN_PASSWORD env or --password=... arg')
      process.exit(1)
    }

    console.log(`[Admin Provisioning] Preparing account for ${email}...`)

    const passwordHash = await hashPassword(password)

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { wallet: true }
    })

    if (existingUser) {
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          passwordHash,
          fullName: fullName || existingUser.fullName
        }
      })
      console.log(`[Success] Existing account promoted to SUPER_ADMIN:`, JSON.stringify(sanitizeUser(updated), null, 2))
    } else {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
          }
        })

        await tx.creditWallet.create({
          data: {
            userId: user.id,
            balance: 99999,
            reservedBalance: 0
          }
        })

        return user
      })

      console.log(`[Success] New SUPER_ADMIN account provisioned:`, JSON.stringify(sanitizeUser(created), null, 2))
    }

    console.log('[Admin Provisioning] Done.')
  } catch (err) {
    console.error('[Admin Provisioning Error]:', err.message)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

provisionAdmin()
