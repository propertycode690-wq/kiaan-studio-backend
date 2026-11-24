import { prisma } from '../src/config/database.js'

async function check() {
  const users = await prisma.user.count()
  const projects = await prisma.project.count()
  const assets = await prisma.generatedAsset.count()
  const downloads = await prisma.downloadRecord.count()
  console.log(`DB Counts -> Users: ${users}, Projects: ${projects}, Assets: ${assets}, Downloads: ${downloads}`)
  await prisma.$disconnect()
}

check()
