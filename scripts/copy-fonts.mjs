import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const OUT = join(process.cwd(), 'public', 'fonts')
await mkdir(OUT, { recursive: true })

const JOBS = [
  { pkg: '@fontsource/manrope', prefix: 'manrope', weights: [400, 500, 600, 700, 800] },
  { pkg: '@fontsource/jetbrains-mono', prefix: 'jetbrains-mono', weights: [400, 500, 600] },
]

for (const job of JOBS) {
  const first = require.resolve(
    `${job.pkg}/files/${job.prefix}-latin-${job.weights[0]}-normal.woff2`,
  )
  const dir = dirname(first)
  for (const w of job.weights) {
    const name = `${job.prefix}-latin-${w}-normal.woff2`
    await cp(join(dir, name), join(OUT, name))
  }
}

console.log('Fonts kopiert nach public/fonts')
