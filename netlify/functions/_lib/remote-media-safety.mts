const clean=(value:unknown,max=1800)=>String(value??'').trim().slice(0,max);

function isPrivateIpv4(host:string){
  const parts=host.split('.').map(Number);
  if(parts.length!==4||parts.some((n)=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b]=parts;
  return (
    a===10||
    a===127||
    a===0||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&b===168)||
    (a===100&&b>=64&&b<=127)
  );
}

function isBlockedHostname(host:string){
  const value=host.toLowerCase().replace(/\.$/,'');
  if(!value)return true;
  if(
    value==='localhost'||
    value.endsWith('.localhost')||
    value.endsWith('.local')||
    value.endsWith('.internal')||
    value.endsWith('.home')||
    value==='metadata.google.internal'||
    value==='metadata'
  )return true;
  if(isPrivateIpv4(value))return true;

  const ipv6=value.replace(/^\[/,'').replace(/\]$/,'').toLowerCase();
  if(
    ipv6==='::1'||
    ipv6==='::'||
    ipv6.startsWith('fe80:')||
    ipv6.startsWith('fc')||
    ipv6.startsWith('fd')
  )return true;

  return false;
}

export function validateRemoteMediaUrl(value:string){
  const raw=clean(value,2200);
  let url:URL;
  try{url=new URL(raw);}catch{
    throw Object.assign(new Error('Remote media URL is invalid.'),{code:'REMOTE_MEDIA_URL_INVALID'});
  }

  if(url.protocol!=='https:'){
    throw Object.assign(new Error('Remote media must use HTTPS.'),{code:'REMOTE_MEDIA_HTTPS_REQUIRED'});
  }
  if(url.username||url.password){
    throw Object.assign(new Error('Credential-bearing remote media URLs are not allowed.'),{code:'REMOTE_MEDIA_CREDENTIAL_URL_BLOCKED'});
  }
  if(url.port&&url.port!=='443'){
    throw Object.assign(new Error('Non-standard remote media ports are blocked.'),{code:'REMOTE_MEDIA_PORT_BLOCKED'});
  }
  if(isBlockedHostname(url.hostname)){
    throw Object.assign(new Error('Remote media host is not allowed.'),{code:'REMOTE_MEDIA_HOST_BLOCKED'});
  }

  return url;
}

export async function safeRemoteMediaFetch(
  value:string,
  init:RequestInit={},
  maxRedirects=3
):Promise<Response>{
  let current=validateRemoteMediaUrl(value);

  for(let redirect=0;redirect<=maxRedirects;redirect++){
    const response=await fetch(current.toString(),{
      ...init,
      redirect:'manual'
    });

    if([301,302,303,307,308].includes(response.status)){
      if(redirect>=maxRedirects){
        throw Object.assign(new Error('Remote media exceeded the redirect limit.'),{code:'REMOTE_MEDIA_REDIRECT_LIMIT'});
      }
      const location=response.headers.get('location');
      if(!location){
        throw Object.assign(new Error('Remote media redirect did not include a destination.'),{code:'REMOTE_MEDIA_REDIRECT_INVALID'});
      }
      current=validateRemoteMediaUrl(new URL(location,current).toString());
      continue;
    }

    return response;
  }

  throw Object.assign(new Error('Remote media fetch failed safely.'),{code:'REMOTE_MEDIA_FETCH_FAILED'});
}
