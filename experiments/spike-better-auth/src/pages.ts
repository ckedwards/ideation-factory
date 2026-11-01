// Minimal pages: sign in with an email code, the OAuth consent screen (where
// the token's purpose is chosen), and device-code approval for the cli.
const shell = (title: string, body: string, script: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.75rem 0 .25rem}input,button{font:inherit;padding:.4rem}button{margin-top:1rem}#msg{color:#b00;white-space:pre-wrap}</style>
</head><body><h1>${title}</h1>${body}<p id="msg"></p><script>
// The OAuth provider signs the query it redirects with; send back just the signed part.
function signedQuery(){const p=new URLSearchParams(location.search);if(!p.has('sig'))return undefined;const names=new Set(p.getAll('ba_param'));const out=new URLSearchParams();for(const[k,v]of p.entries())if(k==='sig'||k==='ba_param'||names.has(k))out.append(k,v);return out.toString()}
async function post(path,body){const r=await fetch('/api/auth'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'include'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}};if(!r.ok)throw new Error(j.message||j.error_description||j.error||t);return j}
function done(j){if(j&&(j.url||j.redirect_uri)){location.href=j.url||j.redirect_uri;return true}return false}
const $=(id)=>document.getElementById(id);const msg=(m)=>$('msg').textContent=m;
${script}
</script></body></html>`

// Under single sign-on: one button. An MCP client's authorize request comes
// back here with its query; after the provider, the browser returns to that
// same authorize request (Better Auth doesn't carry it through SSO itself).
export const ssoLoginPage = (providerId: string, providerName: string) =>
  shell(
    'Sign in',
    `<button id="go">Continue with ${providerName}</button>`,
    `$('go').onclick=async()=>{try{const p=new URLSearchParams(location.search);for(const k of ['sig','exp','ba_param','ba_iat','ba_pl'])p.delete(k);const callbackURL=p.has('client_id')?'/api/auth/oauth2/authorize?'+p:'/';done(await post('/sign-in/sso',{providerId:${JSON.stringify(providerId)},callbackURL}))}catch(x){msg(x.message)}};`,
  )

export const loginPage = () =>
  shell(
    'Sign in',
    `<form id="f1"><label>Email<input id="email" type="email" required></label><button>Send me a code</button></form>
<form id="f2" hidden><label>Code<input id="otp" inputmode="numeric" required></label>
<label>Handle (new accounts only)<input id="handle" pattern="[a-z0-9._-]{2,39}"></label><button>Sign in</button></form>`,
    `$('f1').onsubmit=async(e)=>{e.preventDefault();try{await post('/email-otp/send-verification-otp',{email:$('email').value,type:'sign-in'});$('f1').hidden=true;$('f2').hidden=false}catch(x){msg(x.message)}};
$('f2').onsubmit=async(e)=>{e.preventDefault();try{const body={email:$('email').value,otp:$('otp').value};if($('handle').value)body.username=$('handle').value;const q=signedQuery();if(q)body.oauth_query=q;const j=await post('/sign-in/email-otp',body);if(!done(j))msg('Signed in as '+(j.user&&j.user.email))}catch(x){msg(x.message)}};`,
  )

export const consentPage = () =>
  shell(
    'Allow access?',
    `<p><b id="client"></b> wants: <code id="scope"></code></p>
<form id="f"><fieldset><legend>Who will act with this token?</legend>
<label><input type="radio" name="p" value="me" checked> Me</label>
<label><input type="radio" name="p" value="bot-for-me"> A bot for me</label>
<label><input type="radio" name="p" value="bot"> A bot</label>
<label>Bot name<input id="bot" pattern="[a-z0-9][a-z0-9-]{0,38}"></label></fieldset>
<button>Allow</button> <button type="button" id="deny">Deny</button></form>`,
    `const p=new URLSearchParams(location.search);$('client').textContent=p.get('client_id');$('scope').textContent=p.get('scope');
$('f').onsubmit=async(e)=>{e.preventDefault();try{const purpose=document.querySelector('input[name=p]:checked').value;const b={purpose};if(purpose!=='me')b.bot=$('bot').value;await post('/ideaf/oauth-purpose',b);const j=await post('/oauth2/consent',{accept:true,oauth_query:signedQuery()});if(!done(j))msg(JSON.stringify(j))}catch(x){msg(x.message)}};
$('deny').onclick=async()=>{try{done(await post('/oauth2/consent',{accept:false,oauth_query:signedQuery()}))}catch(x){msg(x.message)}};`,
  )

export const devicePage = () =>
  shell(
    'Connect a device',
    `<p>Sign in first if you haven't: <a href="/login">sign in</a>.</p><form id="f"><label>Code shown in your terminal<input id="code" required></label><button>Approve</button></form>`,
    `const c=new URLSearchParams(location.search).get('user_code');if(c)$('code').value=c;
$('f').onsubmit=async(e)=>{e.preventDefault();try{const code=$('code').value.replace(/-/g,'');const r=await fetch('/api/auth/device?user_code='+encodeURIComponent(code),{credentials:'include'});if(!r.ok)throw new Error(await r.text());await post('/device/approve',{userCode:$('code').value.replace(/-/g,'')});msg('Approved. You can go back to your terminal.')}catch(x){msg(x.message)}};`,
  )
