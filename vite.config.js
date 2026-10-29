import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {configurationProblem} from './src/account/model.js';
export default defineConfig(({mode,command})=>{
  const env={...loadEnv(mode,process.cwd(),''),...process.env};
  const url=env.VITE_SUPABASE_URL?.trim(),key=env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const problem=configurationProblem(url,key,env.VITE_REQUIRE_AUTH==='true',command==='serve');
  if(problem)throw Error(problem);
  const origin=url?new URL(url).origin:'';
  const policy=["default-src 'self'","script-src 'self'","style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:","font-src 'self'",`connect-src 'self' ${origin}`,
    "object-src 'none'","base-uri 'self'","form-action 'self'"].join('; ');
  return {plugins:[react(),tailwindcss(),{
    name:'production-content-security-policy',
    transformIndexHtml(){return command==='build'?[{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:policy},injectTo:'head-prepend'}]:[];},
  }],base:env.BASE_PATH||'./'};
});
