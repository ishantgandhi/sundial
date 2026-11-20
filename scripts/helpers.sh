q() { docker exec -i sundial-db-1 psql -U postgres -d sundial_history -t -A -c "$1"; }
T1=$(q "SELECT committed_at + interval '1 second' FROM changes WHERE action='update' AND row_key->>'id'='2' AND new_row->>'status'='shipped' ORDER BY id ASC LIMIT 1")
T4=$(q "SELECT committed_at + interval '1 second' FROM changes WHERE action='delete' AND row_key->>'id'='3' ORDER BY id ASC LIMIT 1")
echo "T1=$T1  T4=$T4"
