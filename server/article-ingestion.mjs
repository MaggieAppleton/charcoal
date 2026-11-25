import {lookup} from 'node:dns/promises'
import {get as httpGet} from 'node:http'
import {get as httpsGet} from 'node:https'
import {BlockList, isIP} from 'node:net'

const maxBytes = 1024 * 1024
const maxText = 32000
const redirectStatuses = new Set([301,302,303,307,308])
const unavailable = 'Could not read that post. Paste the text into your brief instead.'
const fail = (message = unavailable) => Object.assign(new Error(message), {status: 400})

const privateAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16],
  ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',3],
]) privateAddresses.addSubnet(address,prefix,'ipv4')
for (const [address, prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) {
  privateAddresses.addSubnet(address,prefix,'ipv6')
}
const globalIPv6 = new BlockList()
globalIPv6.addSubnet('2000::',3,'ipv6')

const publicAddress = ({address,family}) => isIP(address) === family && (family === 4
  ? !privateAddresses.check(address,'ipv4')
  : globalIPv6.check(address,'ipv6') && !privateAddresses.check(address,'ipv6'))

function publicURL(input, base) {
  let url
  try {
    if (typeof input === 'string' && input.length <= 2048) url = new URL(input,base)
  } catch {}
  if (!url || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw fail('Enter a public HTTP or HTTPS post link.')
  }
  const host = url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'')
  if (isIP(host) ? !publicAddress({address:host,family:isIP(host)}) :
    !host.includes('.') || /\.(?:localhost|local|internal|home\.arpa)$/i.test(host)) {
    throw fail('Enter a public HTTP or HTTPS post link.')
  }
  url.hash = ''
  if (url.href.length > 2048) throw fail('Enter a shorter post link.')
  return url
}

export function validArticleSource(value) {
  try {
    return value && typeof value.title === 'string' && value.title.length <= 300 && !!publicURL(value.url)
  } catch { return false }
}

async function resolvePublic(url, signal, resolveHost) {
  const host = url.hostname.replace(/^\[|\]$/g,'')
  const family = isIP(host)
  signal.throwIfAborted()
  let addresses = [{address:host,family}]
  if (!family) {
    let onAbort
    const abort = new Promise((_,reject) => {
      onAbort = () => reject(fail())
      signal.addEventListener('abort',onAbort,{once:true})
    })
    try {
      addresses = await Promise.race([resolveHost(host,{all:true}),abort])
    } finally {
      signal.removeEventListener('abort',onAbort)
    }
  }
  if (!addresses.length || !addresses.every(publicAddress)) throw fail('Enter a public HTTP or HTTPS post link.')
  return addresses.find(address=>address.family===4) ?? addresses[0]
}

async function request(url, address, signal) {
  const get = url.protocol === 'https:' ? httpsGet : httpGet
  // Keep Host and TLS verification tied to the URL. Dial only the address checked above.
  const response = await new Promise((resolve,reject) => {
    const req = get(url,{
      agent:false, signal, family:address.family,
      lookup:(_host,_opts,done)=>done(null,address.address,address.family),
      headers:{Accept:'text/html, text/plain','Accept-Encoding':'identity','User-Agent':'Charcoal article import'},
    },resolve)
    req.once('error',reject)
  })
  try {
    if (redirectStatuses.has(response.statusCode)) return {location:response.headers.location || ''}
    const type = response.headers['content-type'] ?? ''
    if (response.statusCode !== 200 || !/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(type) ||
      Number(response.headers['content-length']) > maxBytes ||
      ![undefined,'identity'].includes(response.headers['content-encoding'])) throw fail()
    const chunks = []
    let size = 0
    for await (const chunk of response) {
      size += chunk.length
      if (size > maxBytes) throw fail()
      chunks.push(chunk)
    }
    const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8'
    return {html:!/^text\/plain/i.test(type), body:new TextDecoder(charset).decode(Buffer.concat(chunks))}
  } finally {
    response.destroy()
  }
}

const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…',ndash:'–',mdash:'—',
  lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',copy:'©',shy:''}
function toText(html) {
  return html
    .replace(/<\/?(?:br|p|li|blockquote|section|div|h[1-6]|tr)\b[^<>]*>/gi,'\n')
    .replace(/<[^<>]*>/g,'')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(match,entity)=>{
      if (!entity.startsWith('#')) return Object.hasOwn(entities,entity) ? entities[entity] : match
      const hex = entity[1].toLowerCase() === 'x'
      const point = Number.parseInt(entity.slice(hex ? 2 : 1),hex ? 16 : 10)
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match
    })
    .replace(/[^\S\n]+/g,' ')
    .replace(/ *\n(?: *\n)* */g,'\n\n')
    .trim()
}

function readable(body, html) {
  if (!html) return {title:'',text:body.trim()}
  const clean = body.replace(/<!--[\s\S]*?(?:-->|$)/g,'')
    .replace(/<(script|style|noscript|template|svg)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
  const title = /<title\b[^<>]*>([^<]*)<\/title\s*>/i.exec(clean)?.[1] ?? ''
  const content = clean.replace(/<(head|nav|footer|aside|form)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
  const article = /<article\b[^<>]*>([\s\S]*?)(?:<\/article\s*>|$)/i.exec(content)?.[1]
  const main = /<main\b[^<>]*>([\s\S]*?)(?:<\/main\s*>|$)/i.exec(content)?.[1]
  return {title:toText(title).slice(0,300),text:toText(article ?? main ?? content)}
}

export async function fetchArticle(input,{resolveHost=lookup,readResponse=request,signal=AbortSignal.timeout(8000)}={}) {
  try {
    let url = publicURL(input)
    for (let redirects=0; redirects<=3; redirects++) {
      const address = await resolvePublic(url,signal,resolveHost)
      const response = await readResponse(url,address,signal)
      if (response.location !== undefined) {
        if (!response.location || redirects === 3) throw fail()
        url = publicURL(response.location,url)
        continue
      }
      const {title,text} = readable(response.body,response.html)
      if (!text) throw fail()
      return {url:url.href,title:title || url.hostname,text:text.slice(0,maxText)}
    }
  } catch (error) {
    throw error.status === 400 ? error : fail()
  }
}
