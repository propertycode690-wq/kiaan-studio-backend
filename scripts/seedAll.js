import { prisma } from '../src/config/database.js'
import { hashPassword, normalizeEmail } from '../src/modules/auth/auth.utils.js'
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service.js'
import { AdminService } from '../src/modules/admin/admin.service.js'

async function seedAll() {
  console.log('\n======================================================')
  console.log('   KIAAN STUDIO — REPRODUCIBLE SEED SCRIPT')
  console.log('======================================================\n')

  try {
    // 1. Seed Subscription Plans
    console.log('[1/5] Seeding default subscription plans...')
    await SubscriptionsService.seedDefaultPlans()
    console.log('  ✓ Subscription plans ready (Free, Creator Pro, Studio Ultimate)')

    // 2. Seed AI Model Catalog
    console.log('[2/5] Seeding AI model catalog...')
    await AdminService.listModels()
    console.log('  ✓ AI models seeded (FLUX.1 Schnell, FLUX.1 Dev, SD-XL, Wan 2.1 T2V, Wan 2.1 I2V)')

    // 3. Seed GPU Fleet Nodes
    console.log('[3/5] Seeding default GPU worker nodes...')
    await AdminService.listGpuNodes()
    console.log('  ✓ GPU fleet nodes initialized (NVIDIA A100 SXM4 80GB, NVIDIA RTX 4090 24GB)')

    // 4. Seed Global System Settings
    console.log('[4/5] Seeding global system settings...')
    await AdminService.getSystemSettings()
    console.log('  ✓ Global system settings initialized')

    // 5. Seed Super Admin Account
    console.log('[5/5] Provisioning local Super Admin account...')
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@kiaanstudio.local')
    const adminPass = process.env.ADMIN_PASSWORD || 'AdminPassword123!'
    const passwordHash = await hashPassword(adminPass)

    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!existingAdmin) {
      await prisma.$transaction(async (tx) => {
        const admin = await tx.user.create({
          data: {
            email: adminEmail,
            fullName: 'Platform Super Administrator',
            passwordHash,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
          }
        })
        await tx.creditWallet.create({
          data: {
            userId: admin.id,
            balance: 100000
          }
        })
      })
      console.log(`  ✓ Super Admin created: ${adminEmail} (password: ${adminPass})`)
    } else {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { role: 'SUPER_ADMIN', status: 'ACTIVE' }
      })
      console.log(`  ✓ Existing admin elevated to SUPER_ADMIN: ${adminEmail}`)
    }

    console.log('\n======================================================')
    console.log('   REPRODUCIBLE SEED COMPLETE: SYSTEM READY')
    console.log('======================================================\n')
  } catch (error) {
    console.error('Fatal seed failure:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

seedAll()
