import json

from app.db.database import get_connection
from app.schemas.sensei import ChatHistoryMessage, ChatHistoryResponse, Source


class ChatHistoryService:
    def get_history(self, task_id: int, user_id: int) -> ChatHistoryResponse:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, role, content, sources_json FROM chat_messages "
                "WHERE task_id = %s AND user_id = %s ORDER BY created_at ASC",
                (task_id, user_id),
            )
            rows = cursor.fetchall()
            messages = [
                ChatHistoryMessage(
                    id=r["id"],
                    role=r["role"],
                    content=r["content"],
                    sources=[Source(**s) for s in json.loads(r["sources_json"])] if r.get("sources_json") else [],
                )
                for r in rows
            ]
            return ChatHistoryResponse(task_id=task_id, messages=messages)
        finally:
            cursor.close()
            conn.close()

    def save_message(
        self, task_id: int, user_id: int, role: str, content: str, sources: list | None = None
    ) -> ChatHistoryMessage:
        sources = sources or []
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "INSERT INTO chat_messages (user_id, task_id, role, content, sources_json) VALUES (%s, %s, %s, %s, %s)",
                (user_id, task_id, role, content, json.dumps([s.model_dump() for s in sources]) if sources else None),
            )
            conn.commit()
            message_id = cursor.lastrowid
            return ChatHistoryMessage(id=message_id, role=role, content=content, sources=sources)
        finally:
            cursor.close()
            conn.close()

    def delete_history(self, task_id: int, user_id: int) -> None:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM chat_messages WHERE task_id = %s AND user_id = %s",
                (task_id, user_id),
            )
            conn.commit()
        finally:
            cursor.close()
            conn.close()
