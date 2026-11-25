import assert from 'node:assert/strict'
import test from 'node:test'
import {fetchArticle, validArticleSource} from '../server/article-ingestion.mjs'

const url = 'https://example.com/post'
const publicIPv4 = {family:4,address:'93.184.216.34'}
const publicIPv6 = {family:6,address:'2606:4700::1111'}
const resolveHost = async () => [publicIPv4,publicIPv6]
const page = {html:true,body:`<!doctype html>
  <head><title>Hands &amp; Tools</title></head>
  <nav>Home | Archive</nav><main><article><h1>Hands &amp; Tools</h1>
  <p>Neighbours share spare parts &amp; tools.</p><p>A shelf keeps &#x1F527; close at hand.</p>
  <script>window.ad='Noise'</script><aside>Sign up</aside></article></main><footer>Copyright</footer>`}

test('imports readable article text, resolves each redirect, and passes the checked address to the transport', async () => {
  const checked = []
  const requested = []
  const article = await fetchArticle(url, {
    resolveHost:async(host,opts)=>{
      assert.deepEqual(opts,{all:true})
      checked.push(host)
      return resolveHost()
    },
    readResponse:async(target,address,signal)=>{
      requested.push(target.href)
      assert.deepEqual(address,publicIPv4)
      assert.equal(signal.aborted,false)
      return requested.length===1 ? {location:'https://www.example.com/articles/repair#part'} : page
    },
  })
  assert.deepEqual(checked,['example.com','www.example.com'])
  assert.deepEqual(requested,[url,'https://www.example.com/articles/repair'])
  assert.deepEqual(article,{
    url:requested[1],title:'Hands & Tools',
    text:'Hands & Tools\n\nNeighbours share spare parts & tools.\n\nA shelf keeps 🔧 close at hand.',
  })
  assert.equal(validArticleSource(article),true)
})

test('rejects credentials, local names, alternate ports and special IP addresses before contacting any host', async () => {
  const forbidden = [
    'javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com/post',
    'http://example.com:8000/post', 'http://localhost./post', 'http://host.local/post',
    'http://127.1/post', 'http://0x7f000001/post', 'http://169.254.169.254/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
    'http://[2002:7f00:1::]/',
  ]
  for (const input of forbidden) {
    let contacted = false
    const attempted = async () => { contacted = true; throw new Error('Unexpected contact') }
    await assert.rejects(fetchArticle(input,{resolveHost:attempted,readResponse:attempted}),/public HTTP/)
    assert.equal(contacted,false,input)
    assert.equal(validArticleSource({url:input,title:'Post'}),false,input)
  }
})

test('rejects a mixed public and private DNS answer and rechecks redirect destinations', async () => {
  const readResponse = async () => assert.fail('Must not connect')
  await assert.rejects(fetchArticle(url,{readResponse,resolveHost:async()=>[
    publicIPv4,{family:4,address:'192.168.3.4'},
  ]}),/public HTTP/)
  for (const location of ['http://127.0.0.1/', 'https://www.example.com/private']) {
    let visited = 0
    await assert.rejects(fetchArticle(url,{
      resolveHost:async host=>host==='example.com'?[publicIPv6]:[{family:6,address:'fe80::1'}],
      readResponse:async()=>{visited++;return {location}},
    }),/public HTTP/)
    assert.equal(visited,1)
  }
})

test('bounds redirects and article text and allows a plain text response', async () => {
  let requests=0
  await assert.rejects(fetchArticle(url,{resolveHost,readResponse:async()=>{
    requests++
    return {location:'/next'}
  }}),/Paste the text/)
  assert.equal(requests,4)
  const result=await fetchArticle(url,{resolveHost,readResponse:async()=>({html:false,body:'a'.repeat(50000)})})
  assert.equal(result.text.length,32000)
  assert.equal(result.title,'example.com')
  await assert.rejects(fetchArticle(url,{resolveHost,readResponse:async()=>({html:true,body:'<script>nothing</script>'})}),/Paste the text/)
})

test('times out slow resolution with a paste fallback', async () => {
  const controller = new AbortController()
  const imported = fetchArticle(url,{resolveHost:()=>new Promise(()=>{}),signal:controller.signal})
  controller.abort()
  await assert.rejects(imported,/Paste the text/)
})

test('a later abort after a successful IP or DNS import leaves no rejected promise or listener', async () => {
  const {getEventListeners} = await import('node:events')
  for (const target of ['https://93.184.216.34/post',url]) {
    const controller = new AbortController()
    const article = await fetchArticle(target,{signal:controller.signal,resolveHost,readResponse:async()=>page})
    assert.equal(article.title,'Hands & Tools')
    assert.equal(getEventListeners(controller.signal,'abort').length,0)
    controller.abort()
    await new Promise(resolve=>setImmediate(resolve))
  }
})
