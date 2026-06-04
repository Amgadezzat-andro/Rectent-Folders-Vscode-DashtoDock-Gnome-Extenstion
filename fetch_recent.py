import sqlite3, sys

con = sqlite3.connect(sys.argv[1])
cur = con.execute(
    "SELECT value FROM ItemTable WHERE key IN "
    "('recently.opened','history.recentlyOpenedPathsList') "
    "ORDER BY CASE key WHEN 'recently.opened' THEN 0 ELSE 1 END"
)
row = cur.fetchone()
print(row[0] if row else "", end="")
