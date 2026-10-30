import { db } from './database.mjs';
import { scoreChunks } from './content.mjs';

export function retrieveSources(spaceId,materialIds,query,limit=10){
 const ids=(materialIds||[]).map(Number).filter(Number.isInteger);
 let rows;
 if(ids.length){const placeholders=ids.map(()=>'?').join(',');rows=db.prepare(`SELECT c.id chunk_id,c.content,c.page_number,c.heading,m.id material_id,m.name material_name,m.original_name,m.version FROM material_chunks c JOIN materials m ON m.id=c.material_id WHERE m.space_id=? AND m.process_status='ready' AND m.id IN (${placeholders})`).all(spaceId,...ids)}
 else rows=db.prepare(`SELECT c.id chunk_id,c.content,c.page_number,c.heading,m.id material_id,m.name material_name,m.original_name,m.version FROM material_chunks c JOIN materials m ON m.id=c.material_id WHERE m.space_id=? AND m.process_status='ready'`).all(spaceId);
 return scoreChunks(rows,query,limit).map((row,index)=>({...row,citation:`S${index+1}`}));
}
export function sourcesForQuery(spaceId,materialIds,query){const hits=retrieveSources(spaceId,materialIds,query,10);if(!hits.length)throw Object.assign(new Error('Não encontrei trechos processados nas fontes selecionadas. Confira se os arquivos terminaram de processar.'),{status:422});return hits;}
export function contextBlock(hits){return hits.map(h=>`[${h.citation}] Fonte: ${h.material_name}${h.page_number?`, página ${h.page_number}`:''}\n${h.content}`).join('\n\n');}
export function citationList(hits){return hits.map(({citation,material_id,material_name,page_number,chunk_id})=>({citation,materialId:material_id,materialName:material_name,page:page_number,chunkId:chunk_id}));}

export async function generate(prompt,{maxOutputTokens=2500}={}){
 const apiKey=process.env.OPENAI_API_KEY;if(!apiKey)throw Object.assign(new Error('A geração com IA precisa de OPENAI_API_KEY. Adicione a chave ao arquivo .env e reinicie o servidor.'),{status:503,code:'ai_not_configured'});
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',input:prompt,max_output_tokens:maxOutputTokens,store:false})});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error?.message||`O serviço de IA retornou HTTP ${response.status}.`),{status:502});
 const text=data.output_text||data.output?.flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join('')||'';
 if(!text.trim())throw Object.assign(new Error('O serviço de IA não retornou conteúdo. Tente novamente.'),{status:502});return text.trim();
}
export function parseJsonOutput(text){const cleaned=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();try{return JSON.parse(cleaned)}catch{}const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');if(start>=0&&end>start){try{return JSON.parse(cleaned.slice(start,end+1))}catch{}}const a=cleaned.indexOf('['),b=cleaned.lastIndexOf(']');if(a>=0&&b>a){try{return JSON.parse(cleaned.slice(a,b+1))}catch{}}throw Object.assign(new Error('A resposta gerada não pôde ser interpretada. Tente novamente.'),{status:502});}
export function scopedMaterial(spaceId,id){return db.prepare('SELECT * FROM materials WHERE id=? AND space_id=?').get(id,spaceId)}
