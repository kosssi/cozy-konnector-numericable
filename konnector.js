'use strict'

const cheerio = require('cheerio')
const moment = require('moment')

const {
    log,
    BaseKonnector,
    saveBills,
    request
} = require('cozy-konnector-libs')

const rq = request({
  cheerio: true,
  jar: true,
  json: false
})

const accountUrl = 'https://moncompte.numericable.fr'
const connectionUrl = 'https://connexion.numericable.fr'

module.exports = new BaseKonnector(function fetch (params) {
  return authenticate.call(this, params)
    .then(synchronize.bind(this, params))
})

function authenticate (params) {
  return fetchAppKey()
    .then(appKey => fetchAccessToken(appKey, params))
    .catch(handleErrorAndTerminate.bind(this, 'LOGIN_FAILED'))
    .then(authenticateWithToken)
    .catch(handleErrorAndTerminate.bind(this, 'UNKNOWN_ERROR'))
}

function handleErrorAndTerminate (criticalErrorMessage, sourceError) {
  log('error', sourceError.message)
  return this.terminate(criticalErrorMessage)
}

function fetchAppKey () {
  log('info', 'Fetching app key')
  return rq({
    followRedirect: true,
    method: 'GET',
    url: `${accountUrl}/pages/connection/Login.aspx`
  })
    .then(scrapAppKey)
}

function scrapAppKey ($) {
  const appKey = $('#PostForm input[name="appkey"]').attr('value')

  if (!appKey) throw new Error('Numericable: could not retrieve app key')

  return appKey
}

function fetchAccessToken (appKey, params) {
  log('info', `Logging in with appKey ${appKey}`)
  return rq({
    followRedirect: true,
    method: 'POST',
    jar: true,
    url: `${connectionUrl}/Oauth/Oauth.php`,
    form: {
      action: 'connect',
      linkSSO: `${connectionUrl}/pages/connection/Login.aspx?link=HOME`,
      appkey: appKey,
      isMobile: ''
    }
  }).then(() => rq({
    followRedirect: true,
    method: 'POST',
    jar: true,
    url: `${connectionUrl}/Oauth/login/`,
    form: {
      login: params.login,
      pwd: params.password
    }
  })).then(scrapAccessToken)
}

function scrapAccessToken ($) {
  const accessToken = $('#accessToken').attr('value')

  if (!accessToken) throw new Error('Token fetching failed')
  return accessToken
}

function authenticateWithToken (accessToken) {
  log('info', 'Authenticating by token')
  return rq({
    followRedirect: true,
    method: 'POST',
    jar: true,
    url: `${accountUrl}/pages/connection/Login.aspx?link=HOME`,
    qs: {
      accessToken: accessToken
    }
  })
}

function synchronize (params) {
  return fetchPage()
    .then(scrapBills)
    .then(bills => saveBills(bills, params, {
      minDateDelta: 1,
      maxDateDelta: 1,
      amountDelta: 0.1,
      identifiers: ['numericable']
    }))
    .catch(handleErrorAndTerminate.bind(this, 'UNKNOWN_ERROR'))
}

function fetchPage () {
  log('info', 'Fetching bills page')
  return rq({
    followRedirect: true,
    method: 'GET',
    jar: true,
    url: `${accountUrl}/pages/billing/Invoice.aspx`
  })
}

function buildBillFileName (momentBillDate) {
  return `Numericable-${momentBillDate.format('YYYY-MM-DD')}.pdf`
}

// Layer to parse the fetched page to extract bill data.
function scrapBills ($) {
  // Analyze bill listing table.
  log('info', 'Parsing bill page')

  const bills = $('#firstFact, #facture > div[id!="firstFact"]').map((index, element) => {
    const $element = $(element)
    const first = !index
    const billDate = first ? $element.find('h2 span').text() : $element.find('h3')
              .html()
              .substr(3)
    const billTotal = $element.find('p.right')
    const billLink = $element.find('a.linkBtn')
    const momentBillDate = moment(billDate, 'DD/MM/YYYY')

    // Add a new bill information object.
    return {
      date: momentBillDate.toDate(),
      amount: parseFloat(billTotal.html().replace(' €', '').replace(',', '.')),
      filename: buildBillFileName(momentBillDate),
      fileurl: accountUrl + billLink.attr('href'),
      vendor: 'Numéricable'
    }
  })
  .filter((index, bill) => bill.date && bill.amount && bill.fileurl)
  .toArray()

  log('info', bills.length ? `${bills.length} bill(s) retrieved` : 'no bills retrieved')

  return bills
}
