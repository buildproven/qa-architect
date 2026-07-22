#!/usr/bin/env node
/**
 * Generate RSA key pair for license signing
 * Usage: node scripts/generate-license-keys.js
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

console.log('🔐 Generating RSA key pair for license signing...\n')

// Generate 2048-bit RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
})

// The private key never belongs in the source checkout. Callers can point at a
// managed secret path explicitly; otherwise keep it under the user's config
// directory. The public key remains a package artifact in the current project.
const privateKeyPath =
  process.env.LICENSE_REGISTRY_PRIVATE_KEY_PATH ||
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'qa-architect',
    'private-key.pem'
  )
const publicKeyPath = path.join(process.cwd(), 'public-key.pem')

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 })
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 }) // Secure permissions
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })

console.log('✅ Keys generated successfully!\n')
console.log('📁 Private key (KEEP SECRET - deploy to server):')
console.log(`   ${privateKeyPath}\n`)
console.log('📁 Public key (distribute with CLI package):')
console.log(`   ${publicKeyPath}\n`)
console.log('⚠️  IMPORTANT:')
console.log('   1. Keep the private-key path outside the source checkout')
console.log(
  '   2. Deploy private key to Vercel as environment variable or secret file'
)
console.log('   3. Commit public-key.pem to the repo for CLI distribution\n')
