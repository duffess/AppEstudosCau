import crypto from 'node:crypto';
const secret=process.env.SESSION_SECRET||'study-space-development-secret-change-this-before-deployment';
export function passwordHash(password){const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.pbkdf2Sync(password,salt,210000,64,'sha512').toString('hex');return `${salt}:${hash}`;}
export function verifyPassword(password,stored){const [salt,hash]=String(stored||'').split(':');if(!salt||!hash)return false;const actual=crypto.pbkdf2Sync(password,salt,210000,64,'sha512').toString('hex');return crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(actual,'hex'));}
export function createToken(user){const body=Buffer.from(JSON.stringify({uid:user.id,exp:Date.now()+7*24*3600*1000})).toString('base64url');const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');return `${body}.${sig}`;}
export function readToken(token){try{const [body,sig]=String(token||'').split('.');const expected=crypto.createHmac('sha256',secret).update(body).digest();const actual=Buffer.from(sig,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(expected,actual))return null;const data=JSON.parse(Buffer.from(body,'base64url').toString());return data.exp>Date.now()?data:null;}catch{return null;}}
export function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
export function randomToken(){return crypto.randomBytes(32).toString('base64url');}
export function cookieOptions(req){return {httpOnly:true,sameSite:'lax',secure:Boolean(req.secure),path:'/',maxAge:7*24*3600*1000};}
