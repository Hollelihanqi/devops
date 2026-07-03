import * as crypto from 'crypto'

/**
 * API Key 对称加密：AES-256-GCM。
 * 密文格式 "iv.authTag.cipher"（均 base64），密钥 = sha256(secret)。
 * secret 取 AI_KEY_SECRET（未配置时回退 JWT_SECRET），轮换 secret 会使已存 Key 失效，需重新配置。
 */

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decryptSecret(encrypted: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('密文格式不合法')
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/** 脱敏展示：gw-sk-ab****cd34，只用于回显，永不返回明文 */
export function maskKey(key: string): string {
  if (key.length <= 10) return '****'
  return `${key.slice(0, 8)}****${key.slice(-4)}`
}
