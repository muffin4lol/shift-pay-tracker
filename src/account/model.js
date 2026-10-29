export const defaults = Object.freeze({theme:'light', notifications:false, density:'comfortable', currency:'EUR'});
export function validateProfile(profile) {
  const displayName = profile.display_name.trim();
  if (!displayName || displayName.length > 80) throw Error('Display name must contain 1–80 characters.');
  if (typeof profile.bio !== 'string' || profile.bio.length > 1000) throw Error('Bio must be 1,000 characters or fewer.');
  const avatar = profile.avatar_url.trim();
  if (avatar) {
    let url; try {url = new URL(avatar);} catch {throw Error('Avatar must be a valid HTTPS URL.');}
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || avatar.length > 2048) throw Error('Avatar must be an HTTPS URL without credentials, under 2,048 characters.');
  }
  return {display_name:displayName, avatar_url:avatar, bio:profile.bio};
}
export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Preferences must be an object.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 16384) throw Error('Preferences must fit within 16 KB.');
  for (const [key, allowed] of Object.entries({theme:['light','dark'], density:['comfortable','compact'], currency:['EUR','GBP','USD','CAD','AUD']})) {
    if (key in value && !allowed.includes(value[key])) throw Error(`Invalid ${key}.`);
  }
  if ('notifications' in value && typeof value.notifications !== 'boolean') throw Error('Notifications must be true or false.');
  return value;
}
export function accessError(error) {
  const message = error?.message || 'The request could not be completed.';
  if (/access restricted|hook.*(error|reject)|hook_error|not.*allowlist/i.test(message)) return 'Access restricted. Your email must be approved by an administrator.';
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect, or this account is unavailable.';
  return message;
}

export function configurationProblem(url, key, requireAuth=false, allowLocal=false) {
  if (!url && !key) return requireAuth ? 'This release requires account configuration.' : null;
  if (!url || !key) return 'Configure both public Supabase values before building.';
  let parsed;
  try {parsed=new URL(url);} catch {return 'The Supabase project URL is invalid.';}
  if (parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash ||
      (parsed.protocol!=='https:' && !(allowLocal && parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname)))) {
    return 'Use the HTTPS Supabase project URL, without credentials, paths or query parameters.';
  }
  if (key.startsWith('sb_publishable_') && key.length>25) return null;
  // Legacy anon keys are public JWTs. Reject service-role JWTs before bundling.
  try {
    const segment=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const payload=JSON.parse(atob(segment));
    if(payload.role==='anon')return null;
  } catch { /* fall through to the safe configuration error */ }
  return 'Use a public publishable key or legacy anon key. Secret and service-role keys must never be bundled.';
}
