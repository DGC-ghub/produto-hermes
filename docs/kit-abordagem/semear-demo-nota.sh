#!/usr/bin/env bash
# Semeia 2 conversas FICTÍCIAS de clínica num banco TEMPORÁRIO só para a gravação (DGC-357).
# Uso: semear-demo-nota.sh /tmp/rec.db   (o banco já deve ter as migrations e o tenant 'dgc')
set -euo pipefail
DB="$1"
now=$(( $(date +%s) * 1000 ))
sqlite3 "$DB" <<SQL
INSERT INTO Conversation (id,tenantId,channel,contactId,status,createdAt,updatedAt)
 SELECT 'conv-nota-a', id, 'simulator', 'paciente-ficticio-1', 'open', $now, $now FROM Tenant WHERE slug='dgc';
INSERT INTO Conversation (id,tenantId,channel,contactId,status,createdAt,updatedAt)
 SELECT 'conv-nota-b', id, 'simulator', 'paciente-ficticio-2', 'open', $now, $now FROM Tenant WHERE slug='dgc';
INSERT INTO Message (id,conversationId,role,content,createdAt) VALUES
 ('na1','conv-nota-a','user','Oi! Vim hoje fazer a limpeza. Pode me mandar a nota?',$now+1),
 ('na2','conv-nota-a','assistant','Claro! Seu atendimento terminou agora há pouco. Vou pedir para a recepção gerar o pagamento e a nota.',$now+2),
 ('nb1','conv-nota-b','user','Boa tarde, terminei a consulta. Como pago?',$now+1),
 ('nb2','conv-nota-b','assistant','Boa tarde! A recepção vai gerar o Pix para você.',$now+2);
SQL
