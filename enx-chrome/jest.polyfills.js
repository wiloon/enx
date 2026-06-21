const { TextDecoder, TextEncoder, webcrypto } = require('crypto')

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder
global.crypto = webcrypto
