from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.schemas.sensei import (
    ChatHistoryResponse,
    SaveMessageRequest,
    ChatHistoryMessage,
    SenseiChatRequest,
    SenseiChatResponse,
    SenseiContentRequest,
    SenseiContentResponse,
)
from app.services.chat_history_service import ChatHistoryService
from app.services.sensei_service import SenseiService

router = APIRouter()
sensei_service = SenseiService()
chat_history_service = ChatHistoryService()


@router.post("/content", response_model=SenseiContentResponse)
def get_content(payload: SenseiContentRequest, current_user: dict = Depends(get_current_user)):
    try:
        return sensei_service.get_content(payload, current_user["id"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to generate content") from exc


@router.post("/message", response_model=SenseiChatResponse)
def send_message(payload: SenseiChatRequest, current_user: dict = Depends(get_current_user)):
    try:
        return sensei_service.send_message(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to get Sensei response") from exc


# Chat History

@router.get("/history/{task_id}", response_model=ChatHistoryResponse)
def get_history(task_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return chat_history_service.get_history(task_id, current_user["id"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to load chat history") from exc


@router.post("/history/message", response_model=ChatHistoryMessage)
def save_message(payload: SaveMessageRequest, current_user: dict = Depends(get_current_user)):
    try:
        return chat_history_service.save_message(payload.task_id, current_user["id"], payload.role, payload.content, payload.sources)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to save message") from exc


@router.delete("/history/{task_id}", status_code=204)
def delete_history(task_id: int, current_user: dict = Depends(get_current_user)):
    try:
        chat_history_service.delete_history(task_id, current_user["id"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to delete chat history") from exc
