const { TextDecoder, TextEncoder, webcrypto } = require('util')

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder
global.crypto = webcrypto
