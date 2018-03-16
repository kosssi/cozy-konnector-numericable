// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://c66eacf8636a43918e4567d7f3a71704:60de65edc61e4785b4863e3f449d7e2d@sentry.cozycloud.cc/26'

const konnector = require('./konnector')

module.exports = konnector
