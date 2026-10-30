import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'studyspace.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
const SQL = await initSqlJs();
const raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
raw.run('PRAGMA foreign_keys = ON');
let transactionDepth = 0;
let dirty = false;

export function persist() {
  if (transactionDepth || !dirty) return;
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, Buffer.from(raw.export()));
  fs.renameSync(temp, file);
  dirty = false;
}
export function transaction(fn) {
  raw.run('BEGIN'); transactionDepth++;
  try { const value = fn(); raw.run('COMMIT'); transactionDepth--; dirty = true; persist(); return value; }
  catch (error) { raw.run('ROLLBACK'); transactionDepth--; throw error; }
}
function bindArgs(args) { if (args.length === 1 && Array.isArray(args[0])) return args[0]; if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Uint8Array)) return args[0]; return args; }
export const db = {
  exec(sql) { raw.run(sql); dirty = true; persist(); },
  prepare(sql) {
    return {
      run(...args) { const stmt=raw.prepare(sql); try { stmt.bind(bindArgs(args)); while(stmt.step()){} } finally { stmt.free(); } const changes=raw.getRowsModified(); const id=raw.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0]??0; dirty=true; persist(); return { changes, lastInsertRowid:id }; },
      get(...args) { const stmt=raw.prepare(sql); try { stmt.bind(bindArgs(args)); return stmt.step()?stmt.getAsObject():undefined; } finally { stmt.free(); } },
      all(...args) { const stmt=raw.prepare(sql); const rows=[]; try { stmt.bind(bindArgs(args)); while(stmt.step()) rows.push(stmt.getAsObject()); return rows; } finally { stmt.free(); } }
    };
  }
};

raw.run(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_resets (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS spaces (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notebooks (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6f9777', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subjects (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 notebook_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL, name TEXT NOT NULL,
 priority INTEGER NOT NULL DEFAULT 3, estimated_minutes INTEGER NOT NULL DEFAULT 45,
 mastery REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', exam_date TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(space_id,name)
);
CREATE TABLE IF NOT EXISTS materials (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, notebook_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL,
 name TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, file_path TEXT NOT NULL,
 file_size INTEGER NOT NULL, source_url TEXT, version INTEGER NOT NULL DEFAULT 1,
 process_status TEXT NOT NULL DEFAULT 'queued', process_error TEXT, extracted_text TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS material_versions (
 id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, original_name TEXT NOT NULL, file_path TEXT NOT NULL,
 mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, process_status TEXT NOT NULL DEFAULT 'queued',
 process_error TEXT, extracted_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(material_id,version)
);
CREATE TABLE IF NOT EXISTS material_chunks (
 id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL, page_number INTEGER, heading TEXT, content TEXT NOT NULL,
 UNIQUE(material_id,chunk_index)
);
CREATE TABLE IF NOT EXISTS processing_jobs (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 job_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS generated_materials (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, title TEXT NOT NULL,
 kind TEXT NOT NULL, body TEXT NOT NULL, generation_config TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS generated_material_versions (
 id INTEGER PRIMARY KEY, generated_material_id INTEGER NOT NULL REFERENCES generated_materials(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(generated_material_id,version)
);
CREATE TABLE IF NOT EXISTS generated_sources (
 generated_material_id INTEGER NOT NULL REFERENCES generated_materials(id) ON DELETE CASCADE,
 chunk_id INTEGER REFERENCES material_chunks(id) ON DELETE SET NULL,
 citation_label TEXT NOT NULL, material_name TEXT NOT NULL DEFAULT '', page_number INTEGER,
 excerpt TEXT NOT NULL DEFAULT '', PRIMARY KEY(generated_material_id,chunk_id)
);
CREATE TABLE IF NOT EXISTS questions (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
 prompt TEXT NOT NULL, question_type TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '[]',
 answer_json TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'medium',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS question_sources (
 question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 chunk_id INTEGER NOT NULL REFERENCES material_chunks(id) ON DELETE CASCADE,
 citation_label TEXT NOT NULL, PRIMARY KEY(question_id,chunk_id)
);
CREATE TABLE IF NOT EXISTS attempts (
 id INTEGER PRIMARY KEY, question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
 space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, session_id INTEGER,
 answer_json TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0,
 score REAL NOT NULL DEFAULT 0, feedback TEXT NOT NULL DEFAULT '',
 duration_seconds INTEGER NOT NULL DEFAULT 0, attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS flashcards (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
 front TEXT NOT NULL, back TEXT NOT NULL, source_chunk_id INTEGER REFERENCES material_chunks(id) ON DELETE SET NULL,
 due_at TEXT, interval_days INTEGER NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
 repetitions INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS study_sessions (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL, review_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL, session_type TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, duration_minutes INTEGER NOT NULL DEFAULT 0,
 questions_total INTEGER NOT NULL DEFAULT 0, questions_correct INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS session_questions (
 session_id INTEGER NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
 question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,question_id)
);
CREATE TABLE IF NOT EXISTS review_cycles (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
 study_session_id INTEGER REFERENCES study_sessions(id) ON DELETE SET NULL,
 started_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
 space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
 stage INTEGER NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
 completed_at TEXT, score REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(cycle_id,stage)
);
CREATE TABLE IF NOT EXISTS plans (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL DEFAULT 'Plano semanal', week_start TEXT NOT NULL,
 target_minutes INTEGER NOT NULL DEFAULT 300, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(space_id,week_start)
);
CREATE TABLE IF NOT EXISTS plan_items (
 id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
 review_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL,
 scheduled_for TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'new', title TEXT NOT NULL,
 estimated_minutes INTEGER NOT NULL DEFAULT 30, status TEXT NOT NULL DEFAULT 'planned',
 sort_order INTEGER NOT NULL DEFAULT 0, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS preferences (
 space_id INTEGER PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
 daily_minutes INTEGER NOT NULL DEFAULT 90, weekly_minutes INTEGER NOT NULL DEFAULT 450,
 available_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]', preferred_start TEXT NOT NULL DEFAULT '18:00',
 notifications INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS domain_events (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subject_space ON subjects(space_id);
CREATE INDEX IF NOT EXISTS idx_material_space ON materials(space_id,created_at);
CREATE INDEX IF NOT EXISTS idx_chunk_material ON material_chunks(material_id,chunk_index);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(space_id,due_at,status);
CREATE INDEX IF NOT EXISTS idx_plan_day ON plan_items(space_id,scheduled_for,status);
CREATE INDEX IF NOT EXISTS idx_attempt_subject ON attempts(space_id,subject_id,attempted_at);
`);
const sessionColumns=raw.exec('PRAGMA table_info(study_sessions)')[0]?.values.map(row=>row[1])||[];
if(!sessionColumns.includes('review_id'))raw.run('ALTER TABLE study_sessions ADD COLUMN review_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL');
const generatedSourceColumns=raw.exec('PRAGMA table_info(generated_sources)')[0]?.values.map(row=>row[1])||[];
if(!generatedSourceColumns.includes('material_name')){
 raw.run('CREATE TABLE generated_sources_new (generated_material_id INTEGER NOT NULL REFERENCES generated_materials(id) ON DELETE CASCADE,chunk_id INTEGER REFERENCES material_chunks(id) ON DELETE SET NULL,citation_label TEXT NOT NULL,material_name TEXT NOT NULL DEFAULT \'\',page_number INTEGER,excerpt TEXT NOT NULL DEFAULT \'\',PRIMARY KEY(generated_material_id,chunk_id))');
 raw.run(`INSERT INTO generated_sources_new(generated_material_id,chunk_id,citation_label,material_name,page_number,excerpt) SELECT gs.generated_material_id,gs.chunk_id,gs.citation_label,COALESCE(m.name,''),c.page_number,COALESCE(c.content,'') FROM generated_sources gs LEFT JOIN material_chunks c ON c.id=gs.chunk_id LEFT JOIN materials m ON m.id=c.material_id`);
 raw.run('DROP TABLE generated_sources');raw.run('ALTER TABLE generated_sources_new RENAME TO generated_sources');
}
dirty = true; persist();

export function logEvent(spaceId, type, payload={}) {
  db.prepare('INSERT INTO domain_events(space_id,event_type,payload) VALUES(?,?,?)').run(spaceId,type,JSON.stringify(payload));
}
export function toISODate(date=new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function addDays(value, days) { const date=new Date(`${value}T12:00:00`); date.setDate(date.getDate()+days); return toISODate(date); }
export function mondayOf(value=toISODate()) { const d=new Date(`${value}T12:00:00`); const offset=(d.getDay()+6)%7; d.setDate(d.getDate()-offset); return toISODate(d); }
