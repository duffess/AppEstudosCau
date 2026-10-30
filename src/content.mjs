import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

const MAX_TEXT=1_500_000;
export async function extractDocument(filePath, extension) {
  const ext=extension.toLowerCase();
  let text='';
  if(ext==='pdf') {
    const buffer=await fs.readFile(filePath);
    const renderPage=async page=>{const data=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});let lastY,text='';for(const item of data.items){if(lastY===item.transform[5]||!lastY)text+=item.str;else text+='\n'+item.str;lastY=item.transform[5]}return `[[PAGE:${page.pageNumber}]]\n${text}`};
    const result=await pdfParse(buffer,{max:0,pagerender:renderPage});
    text=result.text;
  } else if(ext==='docx') {
    const result=await mammoth.extractRawText({path:filePath}); text=result.value;
  } else if(ext==='pptx') {
    const zip=new AdmZip(filePath);
    const slides=zip.getEntries().filter(entry=>/^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).sort((a,b)=>Number(a.entryName.match(/slide(\d+)/)[1])-Number(b.entryName.match(/slide(\d+)/)[1]));
    text=slides.map((slide,index)=>`Slide ${index+1}\n${xmlText(slide.getData().toString('utf8'))}`).join('\n\n');
  } else if(ext==='txt'||ext==='md'||ext==='csv') {
    text=await fs.readFile(filePath,'utf8');
  } else if(ext==='doc'||ext==='ppt') {
    throw new Error(`O formato .${ext} é legado. Converta para .${ext==='doc'?'docx':'pptx'} para processar o texto.`);
  } else if(['png','jpg','jpeg','webp','tif','tiff'].includes(ext)) {
    throw new Error('OCR de imagem ainda não está habilitado. Adicione um PDF com texto ou uma versão editável do documento.');
  } else throw new Error('Formato de arquivo não suportado para extração de texto.');
  text=text.replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!text) throw new Error('Nenhum texto foi encontrado. Este arquivo pode ser uma digitalização; OCR não está habilitado.');
  return text.slice(0,MAX_TEXT);
}
function xmlText(xml){return xml.replace(/<a:br\s*\/>/g,'\n').replace(/<\/a:p>/g,'\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
function chunkText(text,max,overlap){const paragraphs=text.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);const chunks=[];let current='';for(const paragraph of paragraphs){if(current&&current.length+paragraph.length+2>max){chunks.push(current.trim());current=current.slice(-overlap)+'\n'+paragraph}else current+=(current?'\n\n':'')+paragraph;while(current.length>max){const split=current.lastIndexOf(' ',max);const cut=split>max*.55?split:max;chunks.push(current.slice(0,cut).trim());current=current.slice(Math.max(0,cut-overlap)).trim()}}if(current.trim())chunks.push(current.trim());return chunks}
export function splitChunks(text,max=1100,overlap=130){const markers=[...text.matchAll(/\[\[PAGE:(\d+)\]\]/g)];if(!markers.length)return chunkText(text,max,overlap).map(content=>({content,page_number:null}));const parts=[];for(let index=0;index<markers.length;index++){const start=markers[index].index+markers[index][0].length;const end=index+1<markers.length?markers[index+1].index:text.length;const page=Number(markers[index][1]);for(const content of chunkText(text.slice(start,end),max,overlap))parts.push({content,page_number:page})}return parts}
export function scoreChunks(chunks,query,limit=8){
  const terms=[...new Set(query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)||[])];
  return chunks.map(row=>{const content=String(row.content||'');const normalized=content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');let score=0;for(const t of terms){let pos=0;while((pos=normalized.indexOf(t,pos))!==-1){score+=1;pos+=t.length}}return {...row,score:terms.length?score/Math.sqrt(Math.max(1,content.length)):0}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
function publicIPv4(address){if(net.isIP(address)!==4)return false;const parts=address.split('.').map(Number);const [a,b]=parts;return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===192&&b===0)||(a===192&&b===2)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&parts[2]===113));}
export async function fetchReference(url){
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('Importações externas precisam usar HTTPS.');if(parsed.username||parsed.password||parsed.port&&parsed.port!=='443')throw new Error('A URL contém credenciais ou uma porta não permitida.');const host=parsed.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||net.isIP(host))throw new Error('Este endereço não é permitido.');
  const answers=await dns.lookup(host,{all:true,verbatim:true});const ip=answers.find(a=>publicIPv4(a.address));if(!ip||answers.some(a=>!publicIPv4(a.address)))throw new Error('O domínio não resolveu para um endereço público permitido.');
  const response=await new Promise((resolve,reject)=>{const request=https.get(parsed,{lookup:(_hostname,_options,callback)=>callback(null,ip.address,4),headers:{'User-Agent':'StudySpace/1.0 (user-requested study material import)','Accept':'text/html,text/plain,application/pdf'},timeout:15000},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>20*1024*1024){request.destroy(new Error('A página excede o limite de 20 MB.'));return}chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))});request.on('timeout',()=>request.destroy(new Error('A fonte demorou demais para responder.')));request.on('error',reject)});
  if(response.status<200||response.status>=300)throw new Error(`A fonte respondeu com HTTP ${response.status}; redirecionamentos não são seguidos.`);const mime=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();if(mime==='application/pdf')return {name:decodeURIComponent(path.basename(parsed.pathname))||'referencia.pdf',mime,extension:'pdf',body:response.body};if(mime==='text/plain'||mime==='text/markdown'||mime==='text/csv')return {name:decodeURIComponent(path.basename(parsed.pathname))||'referencia.txt',mime:'text/plain',extension:'txt',body:response.body};if(mime==='text/html'||mime==='application/xhtml+xml'){let text=response.body.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(p|div|h[1-6]|li|tr|section)\s*>/gi,'\n\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();if(!text)throw new Error('Não foi possível extrair texto da página.');const title=(response.body.toString('utf8').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||decodeURIComponent(path.basename(parsed.pathname))||host).replace(/<[^>]+>/g,' ').trim().slice(0,160);return {name:`${title||host}.txt`,mime:'text/plain',extension:'txt',body:Buffer.from(text.slice(0,MAX_TEXT))}}
  throw new Error('A URL precisa apontar para uma página HTML, PDF ou arquivo de texto.');
}
export async function serveStoredFile(relativePath){return path.resolve(process.cwd(),relativePath)}
