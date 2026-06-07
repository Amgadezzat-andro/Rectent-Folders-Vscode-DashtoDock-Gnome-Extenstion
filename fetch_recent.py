import sqlite3, sys, os, json, glob

db_path = sys.argv[1]

# Try SQLite DB first — populated by older VS Code versions
try:
    con = sqlite3.connect(db_path)
    cur = con.execute(
        "SELECT value FROM ItemTable WHERE key IN "
        "('recently.opened','history.recentlyOpenedPathsList') "
        "ORDER BY CASE key WHEN 'recently.opened' THEN 0 ELSE 1 END"
    )
    row = cur.fetchone()
    if row:
        parsed = json.loads(row[0])
        if parsed.get('entries'):
            print(row[0], end='')
            sys.exit(0)
except Exception:
    pass

# Fallback: scan workspaceStorage/*/workspace.json sorted by mtime.
# This is how VS Code builds its own "Open Recent" list.
ws_dir = os.path.join(os.path.dirname(os.path.dirname(db_path)), 'workspaceStorage')
items = []
for wj in glob.glob(os.path.join(ws_dir, '*/workspace.json')):
    try:
        d = json.load(open(wj))
        uri = d.get('folder') or d.get('workspace', '')
        if uri.startswith('file://'):
            key = 'folderUri' if 'folder' in d else 'workspaceUri'
            items.append((os.path.getmtime(wj), {key: uri}))
    except Exception:
        pass

items.sort(reverse=True)
print(json.dumps({'entries': [e for _, e in items]}), end='')
