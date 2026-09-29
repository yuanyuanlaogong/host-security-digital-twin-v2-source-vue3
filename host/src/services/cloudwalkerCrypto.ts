function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/[\r\n\s]/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

class DerReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  readTag(): number {
    this.assertAvailable(1)
    return this.bytes[this.offset++] as number
  }

  readLength(): number {
    this.assertAvailable(1)
    const first = this.bytes[this.offset++] as number
    if ((first & 0x80) === 0) return first

    const count = first & 0x7f
    this.assertAvailable(count)
    let length = 0
    for (let i = 0; i < count; i += 1) {
      length = length * 256 + (this.bytes[this.offset + i] as number)
    }
    this.offset += count
    return length
  }

  readContent(expectedTag?: number): Uint8Array {
    const tag = this.readTag()
    if (expectedTag !== undefined && tag !== expectedTag) {
      throw new Error(`Invalid server public key DER tag: expected ${expectedTag}, received ${tag}`)
    }

    const length = this.readLength()
    this.assertAvailable(length)
    const content = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return content
  }

  private assertAvailable(length: number): void {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Server public key length is incomplete')
    }
  }
}

function removePositiveIntegerPadding(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  return bytes.slice(start)
}

function parseRsaPublicKey(publicKeyResponse: string): {
  modulus: Uint8Array
  exponent: Uint8Array
} {
  const decodedResponse = bytesToText(base64ToBytes(publicKeyResponse))
  const pemBody = decodedResponse.includes('-----')
    ? decodedResponse.replace(/-----[^-]+-----/g, '')
    : decodedResponse
  const der = base64ToBytes(pemBody)
  const reader = new DerReader(der)

  const sequence = reader.readContent(0x30)
  const keyReader = new DerReader(sequence)
  const modulus = removePositiveIntegerPadding(keyReader.readContent(0x02))
  const exponent = removePositiveIntegerPadding(keyReader.readContent(0x02))

  if (!modulus.length || !exponent.length) {
    throw new Error('Server public key does not contain RSA modulus or exponent')
  }
  return { modulus, exponent }
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

function bigIntToFixedBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let remaining = value
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let remaining = exponent
  let square = base % modulus
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * square) % modulus
    square = (square * square) % modulus
    remaining >>= 1n
  }
  return result
}

function randomNonZeroBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('The current browser cannot generate secure random bytes')
  }

  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  for (let i = 0; i < bytes.length; i += 1) {
    while (bytes[i] === 0) {
      const replacement = new Uint8Array(1)
      globalThis.crypto.getRandomValues(replacement)
      bytes[i] = replacement[0] as number
    }
  }
  return bytes
}

export async function encryptPassword(
  publicKeyResponse: string,
  password: string
): Promise<string> {
  const { modulus, exponent } = parseRsaPublicKey(publicKeyResponse)
  const data = new TextEncoder().encode(password)
  if (data.length > modulus.length - 11) {
    throw new Error('Password length exceeds the server public key limit')
  }

  const encoded = new Uint8Array(modulus.length)
  const padding = randomNonZeroBytes(encoded.length - data.length - 3)
  encoded[0] = 0x00
  encoded[1] = 0x02
  encoded.set(padding, 2)
  encoded.set(data, padding.length + 3)

  const encrypted = modPow(bytesToBigInt(encoded), bytesToBigInt(exponent), bytesToBigInt(modulus))
  return bytesToBase64(bigIntToFixedBytes(encrypted, modulus.length))
}
