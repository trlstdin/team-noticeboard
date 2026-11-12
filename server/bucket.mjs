import {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';
export class SqliteBucket{
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT NOT NULL)')}
 async head(key){const row=this.db.prepare('SELECT etag FROM objects WHERE key=?').get(key);return row?{etag:row.etag}:null}
 async get(key){const row=this.db.prepare('SELECT value,etag FROM objects WHERE key=?').get(key);return row?{etag:row.etag,json:async()=>JSON.parse(row.value),text:async()=>row.value}:null}
 async put(key,value,options={}){this.db.exec('BEGIN IMMEDIATE');try{const old=this.db.prepare('SELECT etag FROM objects WHERE key=?').get(key);if(options.onlyIf?.etagMatches!==undefined&&old?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&old){this.db.exec('ROLLBACK');return null}const etag=randomUUID();this.db.prepare('INSERT INTO objects(key,value,etag) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,etag=excluded.etag').run(key,value,etag);this.db.exec('COMMIT');return {etag}}catch(error){this.db.exec('ROLLBACK');throw error}}
 close(){this.db.close()}
}
