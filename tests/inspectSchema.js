import fs from 'fs'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')

// Parse models and enums
const modelMatches = [...schema.matchAll(/model\s+(\w+)\s+\{([^}]+)\}/g)]
const enumMatches = [...schema.matchAll(/enum\s+(\w+)\s+\{([^}]+)\}/g)]

console.log('--- ENUMS (' + enumMatches.length + ') ---')
enumMatches.forEach(m => {
  const values = m[2].trim().split(/\s+/).filter(v => v.length > 0)
  console.log(`- ${m[1]}: [${values.join(', ')}]`)
})

console.log('\n--- MODELS (' + modelMatches.length + ') ---')
modelMatches.forEach(m => {
  const modelName = m[1]
  const body = m[2]
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
  
  const fields = []
  const uniqueConstraints = []
  const indexes = []
  const relations = []

  lines.forEach(line => {
    if (line.startsWith('@@unique')) {
      uniqueConstraints.push(line)
    } else if (line.startsWith('@@index')) {
      indexes.push(line)
    } else if (line.startsWith('@@map')) {
      // mapping
    } else {
      const parts = line.split(/\s+/)
      const fieldName = parts[0]
      const fieldType = parts[1]
      fields.push(`${fieldName} (${fieldType})`)
      if (line.includes('@relation')) {
        relations.push(line)
      }
      if (line.includes('@unique') && !uniqueConstraints.includes(fieldName)) {
        uniqueConstraints.push(`@unique on ${fieldName}`)
      }
    }
  })

  console.log(`\nModel: ${modelName}`)
  console.log(`  Total fields: ${fields.length}`)
  console.log(`  Unique constraints: ${uniqueConstraints.length ? uniqueConstraints.join('; ') : 'none'}`)
  console.log(`  Indexes: ${indexes.length ? indexes.join('; ') : 'none'}`)
  console.log(`  Relations: ${relations.length ? relations.length + ' relations' : 'none'}`)
})
