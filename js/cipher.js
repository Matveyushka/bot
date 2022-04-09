import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import 'dotenv/config'

const pass = process.env.cpass
const ivbase = process.env.civbase

const encryptPassword = password => {
    const resizedIV = Buffer.allocUnsafe(16);
    const iv = createHash('sha256').update(ivbase).digest();
    iv.copy(resizedIV);
    const key = createHash('sha256').update(pass).digest();
    const cipher = createCipheriv('aes256', key, resizedIV);
    return cipher.update(password, 'utf-8', 'hex') + cipher.final('hex')
}

const decryptPassword = password => {
    const resizedIV = Buffer.allocUnsafe(16);
    const iv = createHash('sha256').update(ivbase).digest();
    iv.copy(resizedIV);
    const key = createHash('sha256').update(pass).digest();
    const decipher = createDecipheriv('aes256', key, resizedIV);
    return decipher.update(password, 'hex', 'utf-8') + decipher.final('utf-8')
}

export {
    encryptPassword,
    decryptPassword
}