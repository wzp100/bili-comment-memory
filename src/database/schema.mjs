export const VERSION = 2;
export const APPLICATION_ID = 1111706949;
export const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,uid TEXT NOT NULL UNIQUE,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS videos(id INTEGER PRIMARY KEY,bvid TEXT NOT NULL UNIQUE,title TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(
 id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),video_id INTEGER NOT NULL REFERENCES videos(id),
 rpid TEXT,fallback_fingerprint BLOB,body TEXT NOT NULL,time_text TEXT NOT NULL,published_at INTEGER,
 first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,parent TEXT,root TEXT,context TEXT NOT NULL DEFAULT '',complete INTEGER NOT NULL CHECK(complete IN(0,1)),
 CHECK(rpid IS NOT NULL OR fallback_fingerprint IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS comment_rpid ON comments(video_id,rpid) WHERE rpid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS comment_fingerprint ON comments(video_id,fallback_fingerprint) WHERE rpid IS NULL;
CREATE INDEX IF NOT EXISTS comment_user_time ON comments(user_id,first_seen_at DESC,id DESC,video_id);
CREATE INDEX IF NOT EXISTS comment_video_time ON comments(video_id,first_seen_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS comment_time ON comments(first_seen_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS user_video_stats(user_id INTEGER NOT NULL,video_id INTEGER NOT NULL,comment_count INTEGER NOT NULL,PRIMARY KEY(user_id,video_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS user_stats(user_id INTEGER PRIMARY KEY,comment_count INTEGER NOT NULL,video_count INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS comment_fts USING fts5(body,content='comments',content_rowid='id',tokenize='trigram',detail=none,columnsize=0);
CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
 INSERT INTO user_stats VALUES(new.user_id,1,CASE WHEN EXISTS(SELECT 1 FROM user_video_stats WHERE user_id=new.user_id AND video_id=new.video_id) THEN 0 ELSE 1 END)
 ON CONFLICT(user_id) DO UPDATE SET comment_count=comment_count+1,video_count=video_count+excluded.video_count;
 INSERT INTO user_video_stats VALUES(new.user_id,new.video_id,1) ON CONFLICT(user_id,video_id) DO UPDATE SET comment_count=comment_count+1;
 INSERT INTO comment_fts(rowid,body) VALUES(new.id,new.body);
END;
CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
 UPDATE user_stats SET comment_count=comment_count-1,video_count=video_count-(SELECT comment_count=1 FROM user_video_stats WHERE user_id=old.user_id AND video_id=old.video_id) WHERE user_id=old.user_id;
 UPDATE user_video_stats SET comment_count=comment_count-1 WHERE user_id=old.user_id AND video_id=old.video_id;
 DELETE FROM user_video_stats WHERE user_id=old.user_id AND video_id=old.video_id AND comment_count=0;
 DELETE FROM user_stats WHERE user_id=old.user_id AND comment_count=0;
 INSERT INTO comment_fts(comment_fts,rowid,body) VALUES('delete',old.id,old.body);
END;
CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE OF body ON comments WHEN old.body!=new.body BEGIN
 INSERT INTO comment_fts(comment_fts,rowid,body) VALUES('delete',old.id,old.body);
 INSERT INTO comment_fts(rowid,body) VALUES(new.id,new.body);
END;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_migrations VALUES(2);
PRAGMA user_version=2;
PRAGMA application_id=1111706949;
`;
