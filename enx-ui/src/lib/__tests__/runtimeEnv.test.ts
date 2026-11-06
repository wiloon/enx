import { serverRuntimeEnv } from '../runtimeEnv'

it('provides the published extension ID and install link without deployment overrides', () => {
  const originalId = process.env.ENX_EXTENSION_ID
  const originalUrl = process.env.ENX_EXTENSION_WEB_STORE_URL
  delete process.env.ENX_EXTENSION_ID
  delete process.env.ENX_EXTENSION_WEB_STORE_URL
  try {
    expect(serverRuntimeEnv()).toMatchObject({
      ENX_EXTENSION_ID: 'combdcldlodkikjfhjbdbogjlfmnbjkf',
      ENX_EXTENSION_WEB_STORE_URL:
        'https://chromewebstore.google.com/detail/catglish-learn-english-as/combdcldlodkikjfhjbdbogjlfmnbjkf',
    })
  } finally {
    if (originalId === undefined) delete process.env.ENX_EXTENSION_ID
    else process.env.ENX_EXTENSION_ID = originalId
    if (originalUrl === undefined)
      delete process.env.ENX_EXTENSION_WEB_STORE_URL
    else process.env.ENX_EXTENSION_WEB_STORE_URL = originalUrl
  }
})

it('uses the published install link when deployment configuration is empty', () => {
  const originalUrl = process.env.ENX_EXTENSION_WEB_STORE_URL
  process.env.ENX_EXTENSION_WEB_STORE_URL = ''
  try {
    expect(serverRuntimeEnv().ENX_EXTENSION_WEB_STORE_URL).toBe(
      'https://chromewebstore.google.com/detail/catglish-learn-english-as/combdcldlodkikjfhjbdbogjlfmnbjkf'
    )
  } finally {
    if (originalUrl === undefined)
      delete process.env.ENX_EXTENSION_WEB_STORE_URL
    else process.env.ENX_EXTENSION_WEB_STORE_URL = originalUrl
  }
})
